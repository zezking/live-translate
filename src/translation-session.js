import { GoogleGenAI, Modality } from '@google/genai';
import { EventEmitter } from 'events';

export class TranslationSession extends EventEmitter {
  constructor(apiKey, languageCode) {
    super();
    this.apiKey = apiKey;
    this.languageCode = languageCode;
    this.session = null;
    this.isActive = false;
    this.inputMinutes = 0;
    this.outputMinutes = 0;
  }

  async connect() {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });

    this.session = await ai.live.connect({
      model: 'gemini-3.5-live-translate-preview',
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        translationConfig: {
          targetLanguageCode: this.languageCode,
          echoTargetLanguage: false,
        },
      },
      callbacks: {
        onopen: () => {
          this.isActive = true;
          this.emit('connected', this.languageCode);
        },
        onmessage: (message) => {
          const content = message.serverContent;
          if (content?.inputTranscription?.text) {
            this.emit('inputTranscription', content.inputTranscription.text);
          }
          if (content?.outputTranscription?.text) {
            this.emit('outputTranscription', content.outputTranscription.text);
          }
          if (content?.modelTurn?.parts) {
            for (const part of content.modelTurn.parts) {
              if (part.inlineData) {
                const audioBuffer = Buffer.from(part.inlineData.data, 'base64');
                this.outputMinutes += audioBuffer.length / (24000 * 2);
                this.emit('audio', audioBuffer);
              }
            }
          }
        },
        onerror: (e) => {
          this.emit('error', { languageCode: this.languageCode, error: e.message });
        },
        onclose: (e) => {
          this.isActive = false;
          this.emit('closed', { languageCode: this.languageCode, reason: e.reason });
        },
      },
    });
  }

  sendAudio(pcmBuffer) {
    if (!this.session || !this.isActive) return;
    this.inputMinutes += pcmBuffer.length / (16000 * 2);
    this.session.sendRealtimeInput({
      audio: {
        data: pcmBuffer.toString('base64'),
        mimeType: 'audio/pcm;rate=16000',
      },
    });
  }

  async disconnect() {
    if (this.session) {
      this.session.close();
      this.session = null;
      this.isActive = false;
    }
  }

  getUsage() {
    return {
      languageCode: this.languageCode,
      inputMinutes: this.inputMinutes,
      outputMinutes: this.outputMinutes,
    };
  }
}
