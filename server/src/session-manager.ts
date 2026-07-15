import { GeminiTranslationSession } from './gemini-translation-session.js';
import { QwenTranslationSession, type VoiceConfig } from './qwen-translation-session.js';
import { EventEmitter } from 'events';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Per-language hotword corpus: language code -> phrase map. */
type Hotwords = Record<string, Record<string, unknown>>;

function loadHotwords(): Hotwords {
  const hotwordsPath = path.join(__dirname, 'hotwords.json');
  if (existsSync(hotwordsPath)) {
    try {
      return JSON.parse(readFileSync(hotwordsPath, 'utf-8')) as Hotwords;
    } catch {
      return {};
    }
  }
  return {};
}

const HOTWORDS = loadHotwords();

interface LanguageEntry {
  code: string;
  label: string;
}

const LANGUAGES: LanguageEntry[] = [
  { code: 'zh-Hans', label: '中文 (Mandarin)' },
  { code: 'ko', label: '한국어 (Korean)' },
  { code: 'pt-BR', label: 'Português (Portuguese)' },
  { code: 'es', label: 'Español (Spanish)' },
  { code: 'fa', label: 'فارسی (Farsi)' },
];

interface UsageInfo {
  languageCode: string;
  inputMinutes: number;
  outputMinutes: number;
}

/**
 * Minimal structural contract every provider session satisfies. Both
 * QwenTranslationSession and GeminiTranslationSession extend EventEmitter and
 * implement connect/sendAudio/disconnect/getUsage, so they are assignable here.
 */
interface ManagedSession extends EventEmitter {
  connect(): Promise<void>;
  sendAudio(pcmBuffer: Buffer): void;
  disconnect(): Promise<void>;
  getUsage(): UsageInfo;
  /** Guard flag set by the backoff-aware _reconnectSession. */
  _reconnecting?: boolean;
}

type SessionConstructor = new (
  apiKey: string,
  code: string,
  hotwords?: Hotwords,
  voiceConfig?: VoiceConfig,
) => ManagedSession;

interface ProviderEntry {
  label: string;
  SessionClass: SessionConstructor;
}

const PROVIDERS: Record<string, ProviderEntry> = {
  gemini: {
    label: 'Gemini Live Translate',
    SessionClass: GeminiTranslationSession as SessionConstructor,
  },
  qwen: {
    label: 'Qwen Live Translate',
    SessionClass: QwenTranslationSession as SessionConstructor,
  },
};

interface ClosedInfo {
  languageCode?: string;
  reason?: string;
}

interface SessionStats {
  isRunning: boolean;
  isPaused: boolean;
  provider: string | null;
  elapsedSeconds: number;
  activeLanguages: string[];
  totalInputMinutes: number;
  totalOutputMinutes: number;
  estimatedCost: number | null;
}

export class SessionManager extends EventEmitter {
  sessions: Map<string, ManagedSession>;
  enabledLanguages: Set<string>;
  provider: string | null;
  isRunning: boolean;
  isPaused: boolean;
  startTime: number | null;
  private _apiKey!: string;
  private _voiceConfig!: VoiceConfig;
  private _SessionClass!: SessionConstructor;
  /** Base delay (ms) for exponential reconnect backoff. */
  private _reconnectBaseDelay = 2000;
  /** Per-language reconnect attempt counter (reset to 0 on a successful reconnect). */
  private _reconnectAttempts = new Map<string, number>();

  constructor() {
    super();
    this.sessions = new Map();
    this.enabledLanguages = new Set(LANGUAGES.map((l) => l.code));
    this.provider = null;
    this.isRunning = false;
    this.isPaused = false;
    this.startTime = null;
  }

  static get LANGUAGES(): LanguageEntry[] {
    return LANGUAGES;
  }

  static get PROVIDERS(): Record<string, ProviderEntry> {
    return PROVIDERS;
  }

  setEnabledLanguages(codes: string[]): void {
    this.enabledLanguages = new Set(codes);
  }

  async start(
    apiKeys: Record<string, string>,
    provider: string,
    voiceConfig: VoiceConfig = {},
  ): Promise<void> {
    if (this.isRunning) return;

    const apiKey = apiKeys[provider];
    if (!apiKey) {
      throw new Error(`No API key configured for provider: ${provider}`);
    }

    const { SessionClass } = PROVIDERS[provider];
    if (!SessionClass) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    this.provider = provider;
    this._apiKey = apiKey;
    this._voiceConfig = voiceConfig;
    this._SessionClass = SessionClass;

    const promises: Promise<void>[] = [];

    for (const code of this.enabledLanguages) {
      try {
        const session = this._createSession(code);
        this.sessions.set(code, session);
        promises.push(
          session.connect().catch((err: unknown) => {
            this.sessions.delete(code);
            return undefined;
          }),
        );
      } catch (err) {
        this.emit('error', { languageCode: code, error: (err as Error).message || err });
      }
    }

    const results = await Promise.all(promises);
    const connected = results.filter((r) => r === undefined);
    if (connected.length === 0 && this.enabledLanguages.size > 0) {
      throw new Error(`All ${this.enabledLanguages.size} language sessions failed to connect`);
    }
    this.isRunning = true;
    this.isPaused = false;
    this.startTime = Date.now();
    this.emit('started');
  }

  _createSession(code: string): ManagedSession {
    const session: ManagedSession =
      this.provider === 'qwen'
        ? new this._SessionClass(this._apiKey, code, HOTWORDS, this._voiceConfig)
        : new this._SessionClass(this._apiKey, code);

    session.on('audio', (buffer: Buffer) => {
      this.emit('audio', { languageCode: code, buffer });
    });

    session.on('inputTranscription', (text: string) => {
      this.emit('transcription', { languageCode: code, type: 'input', text });
    });

    session.on('outputTranscription', (text: string) => {
      this.emit('transcription', { languageCode: code, type: 'output', text });
    });

    session.on('error', (err: unknown) => {
      this.emit('error', { languageCode: code, error: err });
    });

    session.on('closed', (info: ClosedInfo) => {
      this.emit('sessionClosed', info);
      const reason = info?.reason || '';
      if (
        this.isRunning &&
        /GoAway|duration|expired|session|repeat|rate|limit/i.test(reason)
      ) {
        this._reconnectSession(code, reason);
      }
    });

    return session;
  }

  /**
   * Backoff-aware reconnect. Replaces v1's immediate reconnect which caused
   * reconnect storms under rate limits.
   *
   * - Deferred: the new session is created inside setTimeout, never inline.
   * - Guarded: the `_reconnecting` flag + removeAllListeners() prevent re-entry
   *   from a second close event during the hold.
   * - Exponential: delay grows 2s → 4s → 8s … capped at 60s; the attempt
   *   counter resets to 0 once a reconnect succeeds.
   */
  _reconnectSession(code: string, reason = 'session expired'): void {
    const old = this.sessions.get(code);
    if (!old || old._reconnecting) return;
    old._reconnecting = true;
    const attempts = (this._reconnectAttempts.get(code) ?? 0) + 1;
    this._reconnectAttempts.set(code, attempts);
    const delay = Math.min(60000, this._reconnectBaseDelay * 2 ** (attempts - 1));
    console.log(`[${code}] ${reason} — reconnecting in ${delay}ms (attempt ${attempts})`);
    old.removeAllListeners();
    old.disconnect?.();
    setTimeout(() => {
      if (!this.isRunning) return;
      try {
        const session = this._createSession(code);
        this.sessions.set(code, session);
        session
          .connect()
          .then(() => this._reconnectAttempts.delete(code))
          .catch((err: unknown) => {
            this.emit('error', { languageCode: code, error: (err as Error).message });
            this.sessions.delete(code);
          });
      } catch (err) {
        this.emit('error', { languageCode: code, error: (err as Error).message });
      }
    }, delay);
  }

  sendAudio(pcmBuffer: Buffer): void {
    if (!this.isRunning || this.isPaused) return;
    for (const session of this.sessions.values()) {
      session.sendAudio(pcmBuffer);
    }
  }

  pause(): void {
    this.isPaused = true;
    this.emit('paused');
  }

  resume(): void {
    this.isPaused = false;
    this.emit('resumed');
  }

  async stop(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      promises.push(session.disconnect());
    }
    await Promise.all(promises);
    this.sessions.clear();
    this.isRunning = false;
    this.isPaused = false;
    this.emit('stopped');
  }

  getStats(): SessionStats {
    const sessionUsages: UsageInfo[] = [];
    for (const [, session] of this.sessions) {
      sessionUsages.push(session.getUsage());
    }
    const totalInput = sessionUsages.reduce((sum, u) => sum + u.inputMinutes, 0);
    const totalOutput = sessionUsages.reduce((sum, u) => sum + u.outputMinutes, 0);
    const elapsed = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;

    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      provider: this.provider,
      elapsedSeconds: elapsed,
      activeLanguages: Array.from(this.sessions.keys()),
      totalInputMinutes: totalInput,
      totalOutputMinutes: totalOutput,
      estimatedCost:
        this.provider === 'gemini' ? totalInput * 0.0053 + totalOutput * 0.0315 : null,
    };
  }
}
