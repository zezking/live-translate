import { EventEmitter } from 'events';
import { QwenTranslationSession } from './qwen-translation-session.js';
import { ActiveSpeakerRouter } from './active-speaker-router.js';
import type { ConversationWsMessage } from '@v2/shared';

export type Role = 'host' | 'joiner';

const ROLES = ['host', 'joiner'] as const;

export interface ConversationConfig {
  voiceOver: boolean;
  voiceClone: boolean;
}

export interface ConversationNames {
  host: string;
  joiner: string;
}

/** Minimal contract for a directional translation session (real Qwen or stub). */
export type TranslationSession = EventEmitter & {
  connect(): Promise<void>;
  sendAudio(pcm: Buffer): void;
  disconnect(): Promise<void>;
};

/** Minimal socket shape used for a participant WebSocket (real `ws` or stub). */
export interface ParticipantSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export type SessionFactory = (
  role: Role,
  sourceLanguage: string,
  targetLanguage: string,
) => TranslationSession;

export type RouterFactory = () => ActiveSpeakerRouter;

/** Payload emitted with the `closed` event from a translation session. */
export interface SessionClosedInfo {
  reason?: string;
}

export interface ConversationSessionOptions {
  apiKey: string;
  sessionFactory?: SessionFactory;
  routerFactory?: RouterFactory;
  names?: ConversationNames;
  config?: Partial<ConversationConfig>;
  reconnectBaseDelay?: number;
}

/**
 * Orchestrates a two-person conversation: a host (zh->ko) and a joiner (ko->zh),
 * each backed by a one-directional Qwen realtime session. Routes input/output
 * transcription, voice-over audio, and turn boundaries via an ActiveSpeakerRouter.
 *
 * Voice-over / voice-clone config changes are applied by *reconnecting* the
 * underlying sessions (Qwen rejects mid-stream `session.update`).
 */
export class ConversationSession extends EventEmitter {
  private _apiKey: string;
  private _names: ConversationNames;
  private _config: ConversationConfig;
  private _reconnectBaseDelay: number;
  private _sessionFactory: SessionFactory;
  private _routerFactory: RouterFactory;
  private _router: ActiveSpeakerRouter;
  private _sessions: Partial<Record<Role, TranslationSession>> = {};
  private _participants: Record<Role, ParticipantSocket | null> = { host: null, joiner: null };
  private _prevDominant: Role | null = null;
  private _started = false;
  private _reconnectAttempts: Record<Role, number> = { host: 0, joiner: 0 };
  private _reconnecting: Record<Role, boolean> = { host: false, joiner: false };

  constructor({
    apiKey,
    sessionFactory,
    routerFactory,
    names = { host: 'Host', joiner: 'Partner' },
    config = { voiceOver: false, voiceClone: false },
    reconnectBaseDelay = 2000,
  }: ConversationSessionOptions) {
    super();
    this._apiKey = apiKey;
    this._names = names;
    this._config = {
      voiceOver: !!config.voiceOver,
      voiceClone: !!config.voiceClone,
    };
    this._reconnectBaseDelay = reconnectBaseDelay;
    this._sessionFactory =
      sessionFactory ||
      ((role, src, tgt) => {
        void role;
        const modalities = this._config.voiceOver ? ['text', 'audio'] : ['text'];
        return new QwenTranslationSession(apiKey, tgt, {}, {
          sourceLanguage: src,
          modalities,
          enableVoiceClone: this._config.voiceOver && this._config.voiceClone,
        });
      });
    this._routerFactory = routerFactory || (() => new ActiveSpeakerRouter());
    this._router = this._routerFactory();
  }

  async start(): Promise<void> {
    const created = ROLES.map((role) => {
      const src = role === 'host' ? 'zh' : 'ko';
      const tgt = role === 'host' ? 'ko' : 'zh';
      const s = this._sessionFactory(role, src, tgt);
      this._sessions[role] = s;
      this._wire(role, s);
      return s;
    });
    await Promise.all(created.map((s) => s.connect()));
    this._started = true;
  }

  private _wire(role: Role, session: TranslationSession): void {
    const other: Role = role === 'host' ? 'joiner' : 'host';
    session.on('inputTranscription', (text: string) => {
      // own device: own bubble original; other device: subtitle original
      this._send(role, { type: 'delta', speaker: role, field: 'original', text });
      this._send(other, { type: 'delta', speaker: role, field: 'original', text });
    });
    session.on('outputTranscription', (text: string) => {
      this._send(other, { type: 'delta', speaker: role, field: 'translation', text });
    });
    session.on('audio', (buf: Buffer) => {
      if (!this._config.voiceOver) return;
      this._send(other, { type: 'audio', data: buf.toString('base64') });
    });
    session.on('error', (error: unknown) => this.emit('error', { role, error }));
    session.on('closed', (info: SessionClosedInfo) => {
      this.emit('sessionClosed', { role, info });
      if (this._started) this._reconnectRole(role, info);
    });
  }

  private _send(role: Role, msg: ConversationWsMessage): void {
    const ws = this._participants[role];
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  private _broadcast(msg: ConversationWsMessage): void {
    for (const role of ROLES) this._send(role, msg);
  }

  private _broadcastStatus(): void {
    const host = !!this._participants.host;
    const joiner = !!this._participants.joiner;
    this._broadcast({
      type: 'status',
      state: host && joiner ? 'listening' : 'waiting',
      host,
      joiner,
    });
  }

  attachParticipant(role: Role, ws: ParticipantSocket): void {
    this._participants[role] = ws;
    this._send(role, { type: 'roomInfo', names: this._names });
    this._send(role, { type: 'config', ...this._config });
    this._broadcastStatus();
    ws.on('message', (data: unknown, isBinary: unknown) => {
      if (!isBinary) return;
      const buf = data instanceof Buffer ? data : Buffer.from(data as ArrayBuffer);
      this.handleAudio(role, buf);
    });
    ws.on('close', () => {
      if (this._participants[role] === ws) {
        this._participants[role] = null;
        this._broadcastStatus();
      }
    });
    ws.on('error', () => {
      if (this._participants[role] === ws) {
        this._participants[role] = null;
        this._broadcastStatus();
      }
    });
  }

  handleAudio(role: Role, pcmBuffer: Buffer): void {
    if (!this._started) return;
    const dominant = this._router.feed(role, pcmBuffer);
    if (dominant !== this._prevDominant) {
      const prev = this._prevDominant;
      if (prev) this._broadcast({ type: 'turnEnd', speaker: prev });
      this._prevDominant = dominant;
    }
    if (dominant === role) {
      this._sessions[role]?.sendAudio(pcmBuffer);
    }
  }

  private async _replaceSession(role: Role): Promise<void> {
    const old = this._sessions[role];
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
    const src = role === 'host' ? 'zh' : 'ko';
    const tgt = role === 'host' ? 'ko' : 'zh';
    const s = this._sessionFactory(role, src, tgt);
    this._sessions[role] = s;
    this._wire(role, s);
    try {
      await s.connect();
    } catch (err) {
      this.emit('error', {
        role,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async setConfig({ voiceOver, voiceClone }: Partial<ConversationConfig> = {}): Promise<void> {
    const next: ConversationConfig = {
      voiceOver: voiceOver !== undefined ? !!voiceOver : this._config.voiceOver,
      voiceClone: voiceClone !== undefined ? !!voiceClone : this._config.voiceClone,
    };
    const changed =
      next.voiceOver !== this._config.voiceOver || next.voiceClone !== this._config.voiceClone;
    this._config = next;
    this._broadcast({ type: 'config', ...this._config });
    if (changed && this._started) {
      for (const role of ROLES) this._broadcast({ type: 'turnEnd', speaker: role });
      await Promise.allSettled(ROLES.map((role) => this._replaceSession(role)));
      this._broadcastStatus();
    }
  }

  async stop(): Promise<void> {
    this._started = false;
    this._broadcast({ type: 'status', state: 'ended', host: false, joiner: false });
    await Promise.allSettled(
      ROLES.map(async (role) => {
        const s = this._sessions[role];
        if (s) {
          try {
            await s.disconnect();
          } catch {
            /* ignore */
          }
        }
        const ws = this._participants[role];
        if (ws) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }
      }),
    );
  }

  private _reconnectRole(role: Role, info: SessionClosedInfo = {}): void {
    if (this._reconnecting[role] || !this._started) return;
    const reason = info.reason || '';
    if (/unauthorized|1008/i.test(reason)) return; // don't reconnect auth errors
    this._reconnecting[role] = true;
    const attempts = (this._reconnectAttempts[role] || 0) + 1;
    this._reconnectAttempts[role] = attempts;
    const delay = Math.min(60000, this._reconnectBaseDelay * 2 ** (attempts - 1));
    console.log(
      `[conversation:${role}] session closed (${reason}) — reconnecting in ${delay}ms (attempt ${attempts})`,
    );
    setTimeout(() => {
      this._reconnecting[role] = false;
      if (!this._started) return;
      this._replaceSession(role)
        .then(() => {
          this._reconnectAttempts[role] = 0;
          this._broadcastStatus();
        })
        .catch((err: unknown) =>
          this.emit('error', {
            role,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
    }, delay);
  }
}
