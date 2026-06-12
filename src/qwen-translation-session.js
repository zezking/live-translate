import WebSocket from 'ws';
import { EventEmitter } from 'events';

const LANG_MAP = {
  'zh-Hans': 'zh',
  'pt-BR': 'pt',
};

function mapLang(code) {
  return LANG_MAP[code] || code;
}

const VOICE_LIST = [
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

const SUPPORTED_VOICES = VOICE_LIST.map((v) => v.value);

export class QwenTranslationSession extends EventEmitter {
  constructor(apiKey, languageCode, hotwords = {}, voiceConfig = {}) {
    super();
    this.apiKey = apiKey;
    this.languageCode = languageCode;
    this.hotwords = hotwords;
    this.enableVoiceClone = voiceConfig.enableVoiceClone !== false;
    this.voiceName = SUPPORTED_VOICES.includes(voiceConfig.voice)
      ? voiceConfig.voice
      : 'Tina';
    this.ws = null;
    this.isActive = false;
    this.inputMinutes = 0;
    this.outputMinutes = 0;
    this._audioParts = [];
    this._lastOutputText = '';
    this._lastInputText = '';
  }

  static get VOICE_LIST() {
    return VOICE_LIST;
  }

  async connect() {
    const targetLang = mapLang(this.languageCode);
    const url = `wss://ws-r7nxaponiv4jkf1t.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-livetranslate-flash-realtime`;

    return new Promise((resolve, reject) => {
      let settled = false;
      const doResolve = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const doReject = (err) => {
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

      this.ws.on('open', () => {
        const sessionConfig = {
          modalities: ['text', 'audio'],
          input_audio_transcription: {
            language: 'en',
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

        const sessionUpdate = {
          type: 'session.update',
          session: sessionConfig,
        };
        this.ws.send(JSON.stringify(sessionUpdate));
      });

      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
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

      this.ws.on('error', (err) => {
        this.emit('error', { languageCode: this.languageCode, error: err.message });
        doReject(err);
      });

      this.ws.on('close', (code, reason) => {
        this.isActive = false;
        if (!settled) {
          doReject(new Error(`WebSocket closed before session updated: ${reason}`));
        }
        this.emit('closed', { languageCode: this.languageCode, reason: reason.toString() });
      });
    });
  }

  _buildTranslationConfig(targetLang) {
    const config = { language: targetLang };
    const phrases = this.hotwords[targetLang];
    if (phrases && Object.keys(phrases).length > 0) {
      config.corpus = { phrases };
    }
    return config;
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'session.created':
      case 'session.updated':
        break;

      case 'conversation.item.input_audio_transcription.text': {
        const newText = msg.text || '';
        const delta = newText.slice(this._lastInputText.length);
        this._lastInputText = newText;
        if (delta) this.emit('inputTranscription', delta);
        break;
      }
      case 'conversation.item.input_audio_transcription.completed':
        this._lastInputText = '';
        break;

      case 'response.audio_transcript.text': {
        const newText = msg.text || '';
        const delta = newText.slice(this._lastOutputText.length);
        this._lastOutputText = newText;
        if (delta) this.emit('outputTranscription', delta);
        break;
      }
      case 'response.audio_transcript.done':
        this._lastOutputText = '';
        break;

      case 'response.audio.delta': {
        const audioBuffer = Buffer.from(msg.delta, 'base64');
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
        this.emit('error', { languageCode: this.languageCode, error: msg.error?.message || JSON.stringify(msg) });
        break;

      case 'session.finished':
        this.isActive = false;
        break;

      default:
        break;
    }
  }

  sendAudio(pcmBuffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isActive) return;
    this.inputMinutes += pcmBuffer.length / (16000 * 2);
    const event = {
      type: 'input_audio_buffer.append',
      audio: pcmBuffer.toString('base64'),
    };
    this.ws.send(JSON.stringify(event));
  }

  async disconnect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'session.finish' }));
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve();
        }, 3000);
        const handler = (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'session.finished') {
            clearTimeout(timeout);
            this.ws.off('message', handler);
            resolve();
          }
        };
        this.ws.on('message', handler);
      });
      this.ws.close();
    }
    this.ws = null;
    this.isActive = false;
  }

  getUsage() {
    return {
      languageCode: this.languageCode,
      inputMinutes: this.inputMinutes,
      outputMinutes: this.outputMinutes,
    };
  }
}
