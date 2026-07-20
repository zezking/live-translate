import { describe, it, expect } from 'vitest';
import { LANGUAGES, nativeName, colorFor } from './languages.js';

describe('languages', () => {
  it('offers the 5 supported languages with unique codes and native PTT phrases', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en', 'ko', 'zh', 'ja', 'es']);
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(5);
    for (const l of LANGUAGES) {
      expect(l.native.length).toBeGreaterThan(0);
      expect(l.ptt.length).toBeGreaterThan(0);
    }
  });

  it('nativeName falls back to the code for unknown languages', () => {
    expect(nativeName('ko')).toBe('한국어');
    expect(nativeName('xx')).toBe('xx');
  });

  it('colorFor returns the pair colors by position', () => {
    expect(colorFor(0)).toBe('#c0623a');
    expect(colorFor(1)).toBe('#3a7a5a');
  });
});
