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

  it('emits outputTranscription from response.text.text (text-only modality channel)', () => {
    // With modalities ['text'] (voice-over off), Qwen delivers the translation via
    // `response.text.text` — `response.audio_transcript.text` only fires when the
    // session includes the audio modality (verified against the live API). The two
    // channels are mutually exclusive, so they share the cumulative-delta tracker.
    const s = new QwenTranslationSession('key', 'ko', {}, { sourceLanguage: 'zh', modalities: ['text'] });
    const out: string[] = []; s.on('outputTranscription', (t: string) => out.push(t));
    for (const e of [
      { type: 'response.text.text', text: '안녕하세요,' },
      { type: 'response.text.text', text: '안녕하세요, 저는' },
      { type: 'response.text.done' },
      { type: 'response.text.text', text: '안녕하세요, 저는 오늘의 강사입니다.' },
    ]) (s as any)._handleMessage(e);
    expect(out.join('')).toBe('안녕하세요, 저는 오늘의 강사입니다.');
  });

  it('emits inputTranscription from the `stash` field (live ASR partials)', () => {
    // The live API delivers running ASR in `stash` with `text` empty until
    // finalize (verified against qwen3.5-livetranslate-flash-realtime). The
    // handler must read `stash`, else source-language "original" deltas never
    // emit. `stash` is cumulative for the utterance, so the startsWith-diff
    // applies; `text` (committed) is included when present.
    const s = new QwenTranslationSession('key', 'ko', {}, { sourceLanguage: 'en', modalities: ['text'] });
    const input: string[] = []; s.on('inputTranscription', (t: string) => input.push(t));
    for (const e of [
      { type: 'conversation.item.input_audio_transcription.text', text: '', stash: 'Hello' },
      { type: 'conversation.item.input_audio_transcription.text', text: '', stash: 'Hello. It is' },
      { type: 'conversation.item.input_audio_transcription.completed' },
      { type: 'conversation.item.input_audio_transcription.text', text: '', stash: 'Welcome' },
    ]) (s as any)._handleMessage(e);
    // First utterance accumulates, then a fresh utterance after .completed.
    expect(input.join('|')).toBe('Hello|. It is|Welcome');
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
