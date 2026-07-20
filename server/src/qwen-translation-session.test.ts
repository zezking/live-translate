import { describe, it, expect } from 'vitest';
import { QwenTranslationSession } from './qwen-translation-session.js';

describe('QwenTranslationSession full-value emission (replace semantics)', () => {
  it('emits the full current output value (not an incremental delta)', () => {
    // The client REPLACES the turn field with each emitted value, so the session
    // must send the full current cumulative text — not a diff suffix.
    const s = new QwenTranslationSession('key', 'zh-Hans');
    const out: string[] = []; s.on('outputTranscription', (t: string) => out.push(t));
    for (const e of [
      { type: 'response.audio_transcript.text', text: '你好' },
      { type: 'response.audio_transcript.text', text: '你好世界' },
    ]) (s as any)._handleMessage(e);
    expect(out).toEqual(['你好', '你好世界']); // full values, not ['你好','世界']
  });

  it('emits outputTranscription from response.text.text (text-only modality channel)', () => {
    // audio sessions emit `response.audio_transcript.text`; text-only sessions
    // emit `response.text.text` (verified against the live API). Both share the
    // full-value emission path.
    const s = new QwenTranslationSession('key', 'ko', {}, { sourceLanguage: 'zh', modalities: ['text'] });
    const out: string[] = []; s.on('outputTranscription', (t: string) => out.push(t));
    for (const e of [
      { type: 'response.text.text', text: '안녕하세요,' },
      { type: 'response.text.text', text: '안녕하세요, 저는 오늘의 강사입니다.' },
    ]) (s as any)._handleMessage(e);
    expect(out).toEqual(['안녕하세요,', '안녕하세요, 저는 오늘의 강사입니다.']);
  });

  it('emits inputTranscription as the full value from `stash` (no duplication on revision)', () => {
    // Live ASR partials arrive in `stash` (cumulative); `text` is empty until
    // finalize. Emit the full value so a revision (Hello, it is one. -> Hello.)
    // overwrites at the client rather than concatenating.
    const s = new QwenTranslationSession('key', 'ko', {}, { sourceLanguage: 'en', modalities: ['text'] });
    const input: string[] = []; s.on('inputTranscription', (t: string) => input.push(t));
    for (const e of [
      { type: 'conversation.item.input_audio_transcription.text', text: '', stash: 'Hello' },
      { type: 'conversation.item.input_audio_transcription.text', text: '', stash: 'Hello, it is one.' },
      { type: 'conversation.item.input_audio_transcription.text', text: '', stash: 'Hello.' }, // revision
    ]) (s as any)._handleMessage(e);
    expect(input).toEqual(['Hello', 'Hello, it is one.', 'Hello.']);
  });

  it('does not re-emit an unchanged value', () => {
    const s = new QwenTranslationSession('key', 'ko', {}, { sourceLanguage: 'en', modalities: ['text'] });
    const input: string[] = []; s.on('inputTranscription', (t: string) => input.push(t));
    for (const e of [
      { type: 'conversation.item.input_audio_transcription.text', text: '', stash: 'Hello' },
      { type: 'conversation.item.input_audio_transcription.text', text: '', stash: 'Hello' }, // unchanged
    ]) (s as any)._handleMessage(e);
    expect(input).toEqual(['Hello']);
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
