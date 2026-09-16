import { describe, it, expect } from 'vitest';
import { formatTranscript, transcriptFilename } from './transcript.js';
import type { Turn } from './types.js';

// Sep 14 2026, 15:42 local time.
const now = new Date(2026, 8, 14, 15, 42);

function turn(id: string, lang: string, original: string, translation = ''): Turn {
  return { id, lang, original, translation, active: false };
}

describe('formatTranscript', () => {
  it('renders a header with the language pair and local timestamp', () => {
    const out = formatTranscript({ turns: [], languages: ['en', 'ko'], locale: 'en', now });
    expect(out).toContain('Conversation transcript');
    expect(out).toContain('English ↔ 한국어');
    expect(out).toContain('2026-09-14 15:42');
  });

  it('renders each spoken original followed by its translation', () => {
    const turns = [
      turn('en-0', 'en', 'Hello, how are you?', '안녕하세요, 어떻게 지내세요?'),
      turn('ko-1', 'ko', '잘 지내요.', "I'm doing well."),
    ];
    const out = formatTranscript({ turns, languages: ['en', 'ko'], locale: 'en', now });
    expect(out).toContain('English: Hello, how are you?');
    expect(out).toContain('→ 안녕하세요, 어떻게 지내세요?');
    expect(out).toContain('한국어: 잘 지내요.');
    expect(out).toContain("→ I'm doing well.");
  });

  it('omits the arrow line when a turn never received a translation', () => {
    const out = formatTranscript({ turns: [turn('en-0', 'en', 'Hello')], languages: ['en', 'ko'], locale: 'en', now });
    expect(out).toContain('English: Hello');
    expect(out).not.toContain('→');
  });

  it('skips turns with no spoken text', () => {
    const out = formatTranscript({
      turns: [turn('en-0', 'en', '   '), turn('en-1', 'en', 'Hi', '안녕')],
      languages: ['en', 'ko'],
      locale: 'en',
      now,
    });
    expect(out.match(/English:/g)?.length).toBe(1);
  });

  it('localises the header title', () => {
    const out = formatTranscript({ turns: [], languages: ['en', 'ko'], locale: 'ko', now });
    expect(out).toContain('대화 기록');
  });
});

describe('transcriptFilename', () => {
  it('uses date + minute precision with filesystem-safe separators', () => {
    expect(transcriptFilename(now)).toBe('transcript-2026-09-14_15-42.txt');
  });
});
