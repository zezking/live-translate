import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ControlsSheet } from './ControlsSheet.js';
import { I18nProvider } from '../i18n.js';

const wrap = (ui: React.ReactNode) => <I18nProvider locale="en">{ui}</I18nProvider>;
const base = {
  open: true,
  config: { voiceOver: false, voiceClone: false },
  devices: [{ deviceId: 'd1', kind: 'audioinput', label: 'AirPods', groupId: 'g' } as MediaDeviceInfo],
  selectedDeviceId: 'd1',
  paused: false,
  onClose: () => {}, onVoiceOver: () => {}, onVoiceClone: () => {},
  onMic: () => {}, onPause: () => {}, onResume: () => {}, onEnd: () => {},
};

describe('ControlsSheet (single-device)', () => {
  it('always shows voice-over + end (no role gating)', () => {
    const { getByText } = render(wrap(<ControlsSheet {...base} />));
    expect(getByText(/Voice-over/)).toBeTruthy();
    expect(getByText(/End conversation/)).toBeTruthy();
  });
  it('voice-clone appears only when voice-over is on', () => {
    const off = render(wrap(<ControlsSheet {...base} />));
    expect(off.queryByText(/Voice cloning/)).toBeNull();
    const on = render(wrap(<ControlsSheet {...base} config={{ voiceOver: true, voiceClone: false }} />));
    expect(on.getByText(/Voice cloning/)).toBeTruthy();
  });
  it('end fires onEnd; pause label flips to Resume when paused', () => {
    const onEnd = vi.fn();
    const { getByText, rerender } = render(wrap(<ControlsSheet {...base} onEnd={onEnd} />));
    fireEvent.click(getByText(/End conversation/));
    expect(onEnd).toHaveBeenCalled();
    rerender(wrap(<ControlsSheet {...base} paused={true} />));
    expect(getByText(/Resume/)).toBeTruthy();
  });
});
