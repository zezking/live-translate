import WebSocket from 'ws';
import { EventEmitter } from 'events';

const LANG_MAP: Record<string, string> = {
  'zh-Hans': 'zh',
  'pt-BR': 'pt',
};

function mapLang(code: string): string {
  return LANG_MAP[code] || code;
}

export interface VoiceOption {
  value: string;
  label: string;
  description: string;
}

const VOICE_LIST: VoiceOption[] = [
  { value: 'Tina', label: 'Tina', description: 'Sweet and warm — like a cup of milk tea' },
  { value: 'Ethan', label: 'Ethan', description: 'Standard Mandarin, sunny and warm' },
  { value: 'Serena', label: 'Serena', description: 'Gentle young woman' },
  { value: 'Maia', label: 'Maia', description: 'Intellect meets gentleness' },
  { value: 'Andre', label: 'Andre', description: 'Magnetic, natural, and steady male voice' },
  { value: 'Harvey', label: 'Harvey', description: 'Low, mellow voice — warm and rich' },
  { value: 'Theo Calm', label: 'Theo Calm', description: 'Calm and reassuring' },
  { value: 'Raymond', label: 'Raymond', description: 'Bright male voice' },
  { value: 'Liora Mira', label: 'Liora Mira', description: 'Gentle and warm, everyday charm' },
  { value: 'Cindy', label: 'Cindy', description: 'Soft, sweet young woman' },
  { value: 'Evan', label: 'Evan', description: 'Young, warm male voice' },
  { value: 'Jennifer', label: 'Jennifer', description: 'Premium American English female' },
  { value: 'Mione', label: 'Mione', description: 'Mature British English female' },
  { value: 'Aiden', label: 'Aiden', description: 'American English male, friendly' },
  { value: 'Katerina', label: 'Katerina', description: 'Mature, expressive female voice' },
  { value: 'Mia', label: 'Mia', description: 'Gentle and reflective' },
  { value: 'Emilien', label: 'Emilien', description: 'Romantic French male voice' },
  { value: 'Sonrisa', label: 'Sonrisa', description: 'Warm Latin American female' },
  { value: 'Bodega', label: 'Bodega', description: 'Warm Spanish male voice' },
  { value: 'Sohee', label: 'Sohee', description: 'Warm Korean female voice' },
];

const SUPPORTED_VOICES: string[] = VOICE_LIST.map((v) => v.value);

export interface VoiceConfig {
  enableVoiceClone?: boolean;
  voice?: string;
  sourceLanguage?: string;
  modalities?: string[];
}

/** Per-language hotword corpus: language code -> phrase map. */
type Hotwords = Record<string, Record<string, unknown>>;

/** Minimal shape of a Qwen realtime WebSocket message (JSON-parsed). */
interface QwenWsMessage {
  type: string;
  text?: string;
  delta?: string;
  /** Live ASR partial (cumulative for the utterance); `text` is empty until finalize. */
  stash?: string;
  error?: { message?: string };
}

export interface UsageInfo {
  languageCode: string;
  inputMinutes: number;
  outputMinutes: number;
}

export interface SessionErrorPayload {
  languageCode: string;
  error: string;
}

export interface SessionClosedPayload {
  languageCode: string;
  reason: string;
}

interface QwenSessionConfig {
  modalities: string[];
  input_audio_transcription: { language: string; model: string };
  translation: { language: string; corpus?: { phrases: Record<string, unknown> } };
  voice?: string;
  enable_voice_clone?: boolean;
  voice_clone_options?: { frequency: string };
}

export class QwenTranslationSession extends EventEmitter {
  apiKey: string;
  languageCode: string;
  hotwords: Hotwords;
  enableVoiceClone: boolean;
  voiceName: string;
  sourceLanguage: string;
  _modalities: string[];
  ws: WebSocket | null;
  isActive: boolean;
  inputMinutes: number;
  outputMinutes: number;
  private _audioParts: Buffer[];
  private _lastOutputText: string;
  private _lastInputText: string;

  constructor(
    apiKey: string,
    languageCode: string,
    hotwords: Hotwords = {},
    voiceConfig: VoiceConfig = {},
  ) {
    super();
    this.apiKey = apiKey;
    this.languageCode = languageCode;
    this.hotwords = hotwords;
    this.enableVoiceClone = voiceConfig.enableVoiceClone !== false;
    this.voiceName = SUPPORTED_VOICES.includes(voiceConfig.voice ?? '')
      ? voiceConfig.voice!
      : 'Tina';
    this.sourceLanguage = voiceConfig.sourceLanguage ?? 'en';
    this._modalities = voiceConfig.modalities ?? ['text', 'audio'];
    this.ws = null;
    this.isActive = false;
    this.inputMinutes = 0;
    this.outputMinutes = 0;
    this._audioParts = [];
    this._lastOutputText = '';
    this._lastInputText = '';
  }

  static get VOICE_LIST(): VoiceOption[] {
    return VOICE_LIST;
  }

  async connect(): Promise<void> {
    const targetLang = mapLang(this.languageCode);
    const url = `wss://ws-r7nxaponiv4jkf1t.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-livetranslate-flash-realtime`;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const doResolve = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const doReject = (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      // Capture this socket so handlers reference the instance they were
      // registered on, not the mutable `this.ws`. A teardown (disconnect /
      // session replacement) can null `this.ws` while the socket is still
      // CONNECTING; its late 'open'/'message'/'close' events must be ignored
      // rather than crash on `this.ws.send` / spuriously emit 'closed'.
      const ws = this.ws;

      ws.on('open', () => {
        if (this.ws !== ws) return; // stale — session replaced/closed during connect
        const sessionConfig = this._buildSessionConfig(targetLang);

        const sessionUpdate = {
          type: 'session.update',
          session: sessionConfig,
        };
        ws.send(JSON.stringify(sessionUpdate));
      });

      ws.on('message', (data) => {
        if (this.ws !== ws) return; // stale
        const msg = JSON.parse(data.toString()) as QwenWsMessage;
        this._handleMessage(msg);
        if (msg.type === 'session.updated') {
          this.isActive = true;
          this.emit('connected', this.languageCode);
          doResolve();
        }
        if (msg.type === 'error') {
          doReject(new Error(msg.error?.message || JSON.stringify(msg)));
        }
      });

      ws.on('error', (err: Error) => {
        this.emit('error', { languageCode: this.languageCode, error: err.message });
        doReject(err);
      });

      ws.on('close', (code: number, reason: Buffer) => {
        this.isActive = false;
        if (!settled) {
          doReject(new Error(`WebSocket closed before session updated: ${reason}`));
        }
        // Only surface 'closed' for the active socket — a stale (replaced)
        // socket closing must not trigger a spurious reconnect.
        if (this.ws === ws) {
          this.emit('closed', {
            languageCode: this.languageCode,
            reason: reason.toString(),
            code,
          });
        }
      });
    });
  }

  private _buildTranslationConfig(targetLang: string): {
    language: string;
    corpus?: { phrases: Record<string, unknown> };
  } {
    const config: { language: string; corpus?: { phrases: Record<string, unknown> } } = {
      language: targetLang,
    };
    const phrases = this.hotwords[targetLang];
    if (phrases && Object.keys(phrases).length > 0) {
      config.corpus = { phrases };
    }
    return config;
  }

  _buildSessionConfig(targetLang: string): QwenSessionConfig {
    const sessionConfig: QwenSessionConfig = {
      modalities: this._modalities,
      input_audio_transcription: {
        language: mapLang(this.sourceLanguage),
        model: 'qwen3-asr-flash-realtime',
      },
      translation: this._buildTranslationConfig(targetLang),
    };

    if (this.enableVoiceClone) {
      sessionConfig.voice = 'default';
      sessionConfig.enable_voice_clone = true;
      sessionConfig.voice_clone_options = { frequency: 'once' };
    } else {
      sessionConfig.voice = this.voiceName;
      sessionConfig.enable_voice_clone = false;
    }

    return sessionConfig;
  }

  _handleMessage(msg: QwenWsMessage): void {
    switch (msg.type) {
      case 'session.created':
      case 'session.updated':
        break;

      case 'conversation.item.input_audio_transcription.text': {
        // Live ASR partials arrive in `stash` (cumulative for the utterance);
        // `text` is empty until finalize (verified against the live API). Emit
        // the FULL current value so the client can REPLACE (not append) — Qwen
        // revises its hypothesis mid-utterance, and a diff/delta would
        // concatenate the revision and duplicate words.
        const newText = (msg.text || '') + (msg.stash || '');
        if (newText !== this._lastInputText) {
          this._lastInputText = newText;
          this.emit('inputTranscription', newText);
        }
        break;
      }
      case 'conversation.item.input_audio_transcription.completed':
        // Do NOT reset _lastInputText — transcript is cumulative.
        break;

      case 'response.audio_transcript.text':
      case 'response.text.text': {
        // Output text channel is modality-dependent and mutually exclusive:
        // audio sessions emit `response.audio_transcript.text`; text-only sessions
        // emit `response.text.text`. Emit the FULL cumulative value (replace, not
        // delta) for the same revision-dedup reason as input.
        const newText = msg.text || '';
        if (newText !== this._lastOutputText) {
          this._lastOutputText = newText;
          this.emit('outputTranscription', newText);
        }
        break;
      }
      case 'response.audio_transcript.done':
        // Do NOT reset _lastOutputText — transcript is cumulative.
        break;

      case 'response.audio.delta': {
        const audioBuffer = Buffer.from(msg.delta || '', 'base64');
        this.outputMinutes += audioBuffer.length / (24000 * 2);
        this.emit('audio', audioBuffer);
        break;
      }
      case 'response.audio.done':
        break;

      case 'response.text.done':
        break;

      case 'response.done':
        break;

      case 'error':
        this.emit('error', {
          languageCode: this.languageCode,
          error: msg.error?.message || JSON.stringify(msg),
        });
        break;

      case 'session.finished':
        this.isActive = false;
        break;

      default:
        break;
    }
  }

  sendAudio(pcmBuffer: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isActive) return;
    this.inputMinutes += pcmBuffer.length / (16000 * 2);
    const event = {
      type: 'input_audio_buffer.append',
      audio: pcmBuffer.toString('base64'),
    };
    this.ws.send(JSON.stringify(event));
  }

  async disconnect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'session.finish' }));
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          resolve();
        }, 3000);
        const handler = (data: unknown) => {
          const msg = JSON.parse(
            data instanceof Buffer ? data.toString() : String(data),
          ) as QwenWsMessage;
          if (msg.type === 'session.finished') {
            clearTimeout(timeout);
            this.ws!.off('message', handler);
            resolve();
          }
        };
        this.ws!.on('message', handler);
      });
      this.ws.close();
    }
    this.ws = null;
    this.isActive = false;
  }

  getUsage(): UsageInfo {
    return {
      languageCode: this.languageCode,
      inputMinutes: this.inputMinutes,
      outputMinutes: this.outputMinutes,
    };
  }
}
