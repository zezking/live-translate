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
