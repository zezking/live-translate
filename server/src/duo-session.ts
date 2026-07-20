import { EventEmitter } from 'events';
import { QwenTranslationSession } from './qwen-translation-session.js';
import type { ConversationWsMessage } from '@v2/shared';

/** Minimal contract for a directional translation session (real Qwen or stub). */
export type TranslationSession = EventEmitter & {
  connect(): Promise<void>;
  sendAudio(pcm: Buffer): void;
  disconnect(): Promise<void>;
};

export type SessionFactory = (sourceLanguage: string, targetLanguage: string) => TranslationSession;

export interface DuoConfig {
  voiceOver: boolean;
  voiceClone: boolean;
}

/** Outbound sink for the single attached client socket. */
export interface DuoClient {
  send(msg: ConversationWsMessage): void;
}

export interface DuoSessionOptions {
  apiKey: string;
  languages: [string, string];
  config?: Partial<DuoConfig>;
  sessionFactory?: SessionFactory;
  reconnectBaseDelay?: number;
}

/** Payload emitted with the `closed` event from a translation session. */
export interface SessionClosedInfo {
  reason?: string;
}

/**
 * Single-device conversation: two warm one-directional Qwen sessions (A→B and
 * B→A). The client picks the active direction explicitly (push-to-talk);
 * incoming PCM is routed to that direction's session. Config changes are
 * applied by reconnecting both sessions (Qwen rejects mid-stream updates).
 */
export class DuoSession extends EventEmitter {
  private _apiKey: string;
  private _languages: [string, string];
  private _config: DuoConfig;
  private _reconnectBaseDelay: number;
  private _sessionFactory: SessionFactory;
  private _sessions: [TranslationSession | null, TranslationSession | null] = [null, null];
  private _client: DuoClient | null = null;
  private _direction: 0 | 1 | null = null;
  private _started = false;
  private _reconnectAttempts: [number, number] = [0, 0];
  private _reconnecting: [boolean, boolean] = [false, false];

  constructor({
    apiKey,
    languages,
    config = {},
    sessionFactory,
    reconnectBaseDelay = 2000,
  }: DuoSessionOptions) {
    super();
    this._apiKey = apiKey;
    this._languages = languages;
    this._config = { voiceOver: !!config.voiceOver, voiceClone: !!config.voiceClone };
    this._reconnectBaseDelay = reconnectBaseDelay;
    this._sessionFactory =
      sessionFactory ||
      ((src, tgt) => {
        const modalities = this._config.voiceOver ? ['text', 'audio'] : ['text'];
        return new QwenTranslationSession(apiKey, tgt, {}, {
          sourceLanguage: src,
          modalities,
          enableVoiceClone: this._config.voiceOver && this._config.voiceClone,
        });
      });
  }

  attach(client: DuoClient): void {
    this._client = client;
    client.send({ type: 'config', ...this._config });
  }

  async start(): Promise<void> {
    for (const i of [0, 1] as const) this._sessions[i] = this._makeSession(i);
    await Promise.all(this._sessions.map((s) => s!.connect()));
    this._started = true;
  }

  setDirection(from: string | null): void {
    let next: 0 | 1 | null = null;
    if (from !== null) {
      if (from === this._languages[0]) next = 0;
      else if (from === this._languages[1]) next = 1;
      else return; // language outside the pair — ignore
    }
    const prev = this._direction;
    if (prev === next) return;
    if (prev !== null) this._send({ type: 'turnEnd', lang: this._languages[prev] });
    this._direction = next;
  }

  handleAudio(pcm: Buffer): void {
    if (!this._started || this._direction === null) return;
    this._sessions[this._direction]?.sendAudio(pcm);
  }

  async setConfig({ voiceOver, voiceClone }: Partial<DuoConfig> = {}): Promise<void> {
    const next: DuoConfig = {
      voiceOver: voiceOver !== undefined ? !!voiceOver : this._config.voiceOver,
      voiceClone: voiceClone !== undefined ? !!voiceClone : this._config.voiceClone,
    };
    const changed =
      next.voiceOver !== this._config.voiceOver || next.voiceClone !== this._config.voiceClone;
    this._config = next;
    this._send({ type: 'config', ...this._config });
    if (changed && this._started) {
      for (const i of [0, 1] as const) this._send({ type: 'turnEnd', lang: this._languages[i] });
      await Promise.allSettled(([0, 1] as const).map((i) => this._replaceSession(i)));
    }
  }

  async stop(): Promise<void> {
    this._started = false;
    this._send({ type: 'status', state: 'ended' });
    await Promise.allSettled(
      ([0, 1] as const).map(async (i) => {
        try {
          await this._sessions[i]?.disconnect();
        } catch {
          /* ignore */
        }
      }),
    );
  }

  // ---- internals ----

  private _send(msg: ConversationWsMessage): void {
    this._client?.send(msg);
  }

  private _makeSession(i: 0 | 1): TranslationSession {
    const s = this._sessionFactory(this._languages[i], this._languages[1 - i]);
    this._wire(i, s);
    return s;
  }

  private _wire(i: 0 | 1, s: TranslationSession): void {
    const src = this._languages[i];
    const tgt = this._languages[1 - i];
    s.on('inputTranscription', (text: string) =>
      this._send({ type: 'delta', field: 'original', lang: src, text }),
    );
    s.on('outputTranscription', (text: string) =>
      this._send({ type: 'delta', field: 'translation', lang: tgt, text }),
    );
    s.on('audio', (buf: Buffer) => {
      if (this._config.voiceOver) this._send({ type: 'audio', data: buf.toString('base64') });
    });
    s.on('error', (error: unknown) => this.emit('error', { direction: src, error }));
    s.on('closed', (info: SessionClosedInfo) => {
      if (this._started) this._reconnectDirection(i, info);
    });
  }

  private async _replaceSession(i: 0 | 1): Promise<void> {
    const old = this._sessions[i];
    if (old) {
      try {
        old.removeAllListeners();
      } catch {
        /* ignore */
      }
      try {
        await old.disconnect();
      } catch {
        /* ignore */
      }
    }
    const s = this._makeSession(i);
    this._sessions[i] = s;
    try {
      await s.connect();
    } catch (err) {
      this.emit('error', {
        direction: this._languages[i],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private _reconnectDirection(i: 0 | 1, info: SessionClosedInfo = {}): void {
    if (this._reconnecting[i] || !this._started) return;
    const reason = info.reason || '';
    if (/unauthorized|1008/i.test(reason)) return; // don't reconnect auth errors
    this._reconnecting[i] = true;
    const attempts = this._reconnectAttempts[i] + 1;
    this._reconnectAttempts[i] = attempts;
    const delay = Math.min(60000, this._reconnectBaseDelay * 2 ** (attempts - 1));
    console.log(
      `[duo:${this._languages[i]}] session closed (${reason}) — reconnecting in ${delay}ms (attempt ${attempts})`,
    );
    setTimeout(() => {
      this._reconnecting[i] = false;
      if (!this._started) return;
      this._replaceSession(i)
        .then(() => {
          this._reconnectAttempts[i] = 0;
        })
        .catch((err: unknown) =>
          this.emit('error', {
            direction: this._languages[i],
            error: err instanceof Error ? err.message : String(err),
          }),
        );
    }, delay);
  }
}
