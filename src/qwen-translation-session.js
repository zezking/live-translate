import WebSocket from 'ws';
import { EventEmitter } from 'events';

const LANG_MAP = {
  'zh-Hans': 'zh',
  'pt-BR': 'pt',
};

function mapLang(code) {
  return LANG_MAP[code] || code;
}

export class QwenTranslationSession extends EventEmitter {
  constructor(apiKey, languageCode) {
    super();
    this.apiKey = apiKey;
    this.languageCode = languageCode;
    this.ws = null;
    this.isActive = false;
    this.inputMinutes = 0;
    this.outputMinutes = 0;
    this._audioParts = [];
    this._lastOutputText = '';
    this._lastInputText = '';
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
        const sessionUpdate = {
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            voice: 'default',
            input_audio_transcription: {
              language: 'en',
              model: 'qwen3-asr-flash-realtime',
            },
            translation: {
              language: targetLang,
            },
            enable_voice_clone: true,
            voice_clone_options: {
              frequency: 'once',
            },
          },
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
