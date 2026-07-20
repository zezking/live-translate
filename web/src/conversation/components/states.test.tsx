import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { StatusLine } from './StatusLine.js';
import { StateOverlay } from './StateOverlay.js';
import { I18nProvider } from '../i18n.js';

const wrap = (ui: React.ReactNode) => <I18nProvider locale="en">{ui}</I18nProvider>;

describe('StatusLine (single-device)', () => {
  it('idle → hold-to-talk hint', () => {
    const { getByText } = render(wrap(<StatusLine status="ready" paused={false} activeDirection={null} />));
    expect(getByText(/Hold a button to talk/)).toBeTruthy();
  });
  it('held direction → Listening… (native)', () => {
    const { getByText } = render(wrap(<StatusLine status="ready" paused={false} activeDirection="ko" />));
    expect(getByText(/Listening… \(한국어\)/)).toBeTruthy();
  });
  it('paused wins over held', () => {
    const { getByText } = render(wrap(<StatusLine status="ready" paused={true} activeDirection="en" />));
    expect(getByText(/Paused/)).toBeTruthy();
  });
});

describe('StateOverlay (single-device)', () => {
  it('paused offers resume; ended offers begin-another', () => {
    const onResume = vi.fn();
    const onBeginAnother = vi.fn();
    const p = render(wrap(<StateOverlay kind="paused" onResume={onResume} onBeginAnother={() => {}} />));
    fireEvent.click(p.getByText(/Tap to resume/i));
    expect(onResume).toHaveBeenCalled();
    const e = render(wrap(<StateOverlay kind="ended" onResume={() => {}} onBeginAnother={onBeginAnother} />));
    fireEvent.click(e.getByText(/another conversation/i));
    expect(onBeginAnother).toHaveBeenCalled();
  });
});
