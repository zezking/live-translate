import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RiverTranscript } from './RiverTranscript.js';
import type { Turn } from '../types.js';

const turns = (active: number | null): Turn[] => [
  { id: 'host-0', speaker: 'host', original: '你好', translation: '', active: active === 0 },
  { id: 'joiner-1', speaker: 'joiner', original: '안녕', translation: '你好呀', active: active === 1 },
];

describe('RiverTranscript', () => {
  it('renders own turn as the original (no subtitle)', () => {
    const { getByText, queryByText } = render(<RiverTranscript turns={turns(null)} role="host" names={{ host: 'Enze', joiner: '아버님' }} />);
    expect(getByText('你好')).toBeTruthy(); // host own original = main
    expect(queryByText('안녕')).toBeTruthy(); // partner original appears as subtitle
  });

  it('renders partner turn with translation as main + original as subtitle', () => {
    const { getByText } = render(<RiverTranscript turns={turns(null)} role="host" names={{ host: 'Enze', joiner: '아버님' }} />);
    expect(getByText('你好呀')).toBeTruthy(); // joiner translation (main, on host device)
  });

  it('marks the active turn with the active data attribute', () => {
    const { container } = render(<RiverTranscript turns={turns(1)} role="host" names={{ host: 'Enze', joiner: '아버님' }} />);
    const active = container.querySelectorAll('[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain('你好呀');
  });

  it('shows the speaker label in their color class', () => {
    const { container } = render(<RiverTranscript turns={turns(null)} role="joiner" names={{ host: 'Enze', joiner: '아버님' }} />);
    // host label = terracotta (text-primary), joiner label = warm green (text-[#3a7a5a])
    expect(container.querySelector('.text-primary, [class*="text-primary"]')).not.toBeNull();
    expect(container.querySelector('[class*="text-[#3a7a5a]"]')).not.toBeNull();
  });
});
