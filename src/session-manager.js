import { GeminiTranslationSession } from './gemini-translation-session.js';
import { QwenTranslationSession } from './qwen-translation-session.js';
import { EventEmitter } from 'events';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadHotwords() {
  const hotwordsPath = path.join(__dirname, 'hotwords.json');
  if (existsSync(hotwordsPath)) {
    try {
      return JSON.parse(readFileSync(hotwordsPath, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

const HOTWORDS = loadHotwords();

const LANGUAGES = [
  { code: 'zh-Hans', label: '中文 (Mandarin)' },
  { code: 'ko', label: '한국어 (Korean)' },
  { code: 'pt-BR', label: 'Português (Portuguese)' },
  { code: 'es', label: 'Español (Spanish)' },
  { code: 'fa', label: 'فارسی (Farsi)' },
];

const PROVIDERS = {
  gemini: {
    label: 'Gemini Live Translate',
    SessionClass: GeminiTranslationSession,
  },
  qwen: {
    label: 'Qwen Live Translate',
    SessionClass: QwenTranslationSession,
  },
};

export class SessionManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
    this.enabledLanguages = new Set(LANGUAGES.map((l) => l.code));
    this.provider = null;
    this.isRunning = false;
    this.isPaused = false;
    this.startTime = null;
  }

  static get LANGUAGES() {
    return LANGUAGES;
  }

  static get PROVIDERS() {
    return PROVIDERS;
  }

  setEnabledLanguages(codes) {
    this.enabledLanguages = new Set(codes);
  }

  async start(apiKeys, provider, voiceConfig = {}) {
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
    const promises = [];

    for (const code of this.enabledLanguages) {
      const session = provider === 'qwen'
        ? new SessionClass(apiKey, code, HOTWORDS, voiceConfig)
        : new SessionClass(apiKey, code);

      session.on('audio', (buffer) => {
        this.emit('audio', { languageCode: code, buffer });
      });

      session.on('inputTranscription', (text) => {
        this.emit('transcription', { languageCode: code, type: 'input', text });
      });

      session.on('outputTranscription', (text) => {
        this.emit('transcription', { languageCode: code, type: 'output', text });
      });

      session.on('error', (err) => {
        this.emit('error', { languageCode: code, error: err });
      });

      session.on('closed', (info) => {
        this.emit('sessionClosed', info);
      });

      this.sessions.set(code, session);
      promises.push(
        session.connect().catch((err) => {
          this.sessions.delete(code);
          return null;
        }),
      );
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

  sendAudio(pcmBuffer) {
    if (!this.isRunning || this.isPaused) return;
    for (const session of this.sessions.values()) {
      session.sendAudio(pcmBuffer);
    }
  }

  pause() {
    this.isPaused = true;
    this.emit('paused');
  }

  resume() {
    this.isPaused = false;
    this.emit('resumed');
  }

  async stop() {
    const promises = [];
    for (const session of this.sessions.values()) {
      promises.push(session.disconnect());
    }
    await Promise.all(promises);
    this.sessions.clear();
    this.isRunning = false;
    this.isPaused = false;
    this.emit('stopped');
  }

  getStats() {
    const sessionUsages = [];
    for (const [code, session] of this.sessions) {
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
      estimatedCost: this.provider === 'gemini'
        ? totalInput * 0.0053 + totalOutput * 0.0315
        : null,
    };
  }
}
