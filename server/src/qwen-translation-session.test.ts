import { describe, it, expect } from 'vitest';
import { QwenTranslationSession } from './qwen-translation-session.js';

describe('QwenTranslationSession delta handling', () => {
  it('does not duplicate cumulative output across .done', () => {
    const s = new QwenTranslationSession('key', 'zh-Hans');
    const out: string[] = []; s.on('outputTranscription', (t: string) => out.push(t));
    for (const e of [
      { type: 'response.audio_transcript.text', text: '你好' },
      { type: 'response.audio_transcript.text', text: '你好世界' },
      { type: 'response.audio_transcript.done' },
      { type: 'response.audio_transcript.text', text: '你好世界今天' },
    ]) (s as any)._handleMessage(e);
    expect(out.join('')).toBe('你好世界今天');
  });
});

describe('QwenTranslationSession config', () => {
  it('uses sourceLanguage in the input transcription config', () => {
    const s = new QwenTranslationSession('key', 'ko', {}, { sourceLanguage: 'zh', modalities: ['text'] });
    const cfg = (s as any)._buildSessionConfig('ko');
    expect(cfg.input_audio_transcription.language).toBe('zh');
    expect(cfg.modalities).toEqual(['text']);
  });
  it('defaults sourceLanguage=en and modalities=[text,audio] (church-mode compat)', () => {
    const s = new QwenTranslationSession('key', 'ko', {}, {});
    const cfg = (s as any)._buildSessionConfig('ko');
    expect(cfg.input_audio_transcription.language).toBe('en');
    expect(cfg.modalities).toEqual(['text', 'audio']);
  });
});
