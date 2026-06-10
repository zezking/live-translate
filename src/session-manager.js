import { TranslationSession } from './translation-session.js';
import { EventEmitter } from 'events';

const LANGUAGES = [
  { code: 'zh-Hans', label: '中文 (Mandarin)' },
  { code: 'ko', label: '한국어 (Korean)' },
  { code: 'pt-BR', label: 'Português (Portuguese)' },
  { code: 'es', label: 'Español (Spanish)' },
];

export class SessionManager extends EventEmitter {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
    this.sessions = new Map();
    this.enabledLanguages = new Set(LANGUAGES.map((l) => l.code));
    this.isRunning = false;
    this.isPaused = false;
    this.startTime = null;
  }

  static get LANGUAGES() {
    return LANGUAGES;
  }

  setEnabledLanguages(codes) {
    this.enabledLanguages = new Set(codes);
  }

  async start() {
    if (this.isRunning) return;

    const promises = [];
    for (const code of this.enabledLanguages) {
      const session = new TranslationSession(this.apiKey, code);

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
        this.emit('error', err);
      });

      session.on('closed', (info) => {
        this.emit('sessionClosed', info);
      });

      this.sessions.set(code, session);
      promises.push(session.connect());
    }

    await Promise.all(promises);
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
      elapsedSeconds: elapsed,
      activeLanguages: Array.from(this.sessions.keys()),
      totalInputMinutes: totalInput,
      totalOutputMinutes: totalOutput,
      estimatedCost: totalInput * 0.0053 + totalOutput * 0.0315,
    };
  }
}
