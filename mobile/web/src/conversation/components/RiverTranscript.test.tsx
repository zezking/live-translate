import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RiverTranscript } from './RiverTranscript.js';
import type { Turn } from '../types.js';

const turns = (active: number | null): Turn[] => [
  { id: 'en-0', lang: 'en', original: 'How long have you been here?', translation: '얼마나 오래 다니셨어요?', active: active === 0 },
  { id: 'ko-1', lang: 'ko', original: '작년부터요.', translation: 'Since last year.', active: active === 1 },
];

describe('RiverTranscript (single-device)', () => {
  it('every turn shows original as main AND translation as subtitle', () => {
    const { getByText } = render(<RiverTranscript turns={turns(null)} languages={['en', 'ko']} />);
    expect(getByText('How long have you been here?')).toBeTruthy();
    expect(getByText('얼마나 오래 다니셨어요?')).toBeTruthy();
    expect(getByText('작년부터요.')).toBeTruthy();
    expect(getByText('Since last year.')).toBeTruthy();
  });

  it('labels turns with the native language name in the pair-position color', () => {
    const { container } = render(<RiverTranscript turns={turns(null)} languages={['en', 'ko']} />);
    expect(container.querySelector('[class*="text-primary"]')?.textContent).toBe('English');
    expect(container.querySelector('[class*="text-[#3a7a5a]"]')?.textContent).toBe('한국어');
  });

  it('marks the active turn', () => {
    const { container } = render(<RiverTranscript turns={turns(1)} languages={['en', 'ko']} />);
    const active = container.querySelectorAll('[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain('작년부터요.');
  });
});
