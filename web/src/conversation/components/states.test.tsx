import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { StatusLine } from './StatusLine.js';
import { StateOverlay } from './StateOverlay.js';
import { I18nProvider } from '../i18n.js';
import type { ConversationState } from '../types.js';

const wrap = (ui: React.ReactNode) => <I18nProvider locale="en">{ui}</I18nProvider>;

describe('StatusLine', () => {
  it('shows Listening when status is listening and not paused', () => {
    const { getByText } = render(wrap(<StatusLine status="listening" paused={false} />));
    expect(getByText(/Listening/)).toBeTruthy();
  });
  it('shows Paused when paused (regardless of status)', () => {
    const { getByText } = render(wrap(<StatusLine status="listening" paused={true} />));
    expect(getByText(/Paused/)).toBeTruthy();
  });
});

describe('StateOverlay', () => {
  it('paused overlay offers a resume button', () => {
    const onResume = vi.fn();
    const { getByText } = render(wrap(<StateOverlay kind="paused" names={{ host: 'a', joiner: 'b' }} onResume={onResume} onBeginAnother={() => {}} />));
    fireEvent.click(getByText(/resume|Tap to resume/i));
    expect(onResume).toHaveBeenCalled();
  });
  it('ended overlay offers begin-another', () => {
    const onBeginAnother = vi.fn();
    const { getByText } = render(wrap(<StateOverlay kind="ended" names={{ host: 'a', joiner: 'b' }} onResume={() => {}} onBeginAnother={onBeginAnother} />));
    fireEvent.click(getByText(/another conversation/i));
    expect(onBeginAnother).toHaveBeenCalled();
  });
  it('partner-away overlay shows the partner name + copy', () => {
    const { getByText } = render(wrap(<StateOverlay kind="partnerAway" names={{ host: 'Enze', joiner: '아버님' }} onResume={() => {}} onBeginAnother={() => {}} />));
    // the <p> text is "{partner} stepped away…" (the <span> alone is just the name) — match the whole phrase.
    // RTL's default matcher only joins direct text-node children, so a plain regex can't span the
    // <span> boundary; match the <p> by its full textContent instead (same assertion semantics).
    expect(getByText((_, el) => el?.tagName === 'P' && /아버님 stepped/i.test(el.textContent ?? ''))).toBeTruthy();
  });
});
