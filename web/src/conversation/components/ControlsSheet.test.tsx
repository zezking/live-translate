import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ControlsSheet } from './ControlsSheet.js';
import { I18nProvider } from '../i18n.js';

const wrap = (ui: React.ReactNode) => <I18nProvider locale="en">{ui}</I18nProvider>;
const base = {
  open: true, role: 'host' as const, config: { voiceOver: false, voiceClone: false },
  devices: [{ deviceId: 'd1', kind: 'audioinput', label: 'AirPods', groupId: 'g' } as MediaDeviceInfo],
  selectedDeviceId: 'd1',
  paused: false, onClose: () => {}, onVoiceOver: () => {}, onVoiceClone: () => {},
  onMic: () => {}, onPause: () => {}, onResume: () => {}, onEnd: () => {},
};

describe('ControlsSheet', () => {
  it('host sees voice-over + end', () => {
    const { getByText } = render(wrap(<ControlsSheet {...base} />));
    expect(getByText(/Voice-over/)).toBeTruthy();
    expect(getByText(/End conversation/)).toBeTruthy();
  });
  it('joiner does NOT see voice-over or end', () => {
    const { queryByText } = render(wrap(<ControlsSheet {...base} role="joiner" />));
    expect(queryByText(/Voice-over/)).toBeNull();
    expect(queryByText(/End conversation/)).toBeNull();
  });
  it('tapping End fires onEnd', () => {
    const onEnd = vi.fn();
    const { getByText } = render(wrap(<ControlsSheet {...base} onEnd={onEnd} />));
    fireEvent.click(getByText(/End conversation/));
    expect(onEnd).toHaveBeenCalled();
  });
  it('tapping Pause fires onPause and label becomes Resume', () => {
    const onPause = vi.fn();
    const { getByText, rerender } = render(wrap(<ControlsSheet {...base} onPause={onPause} />));
    fireEvent.click(getByText(/Pause/));
    expect(onPause).toHaveBeenCalled();
    rerender(wrap(<ControlsSheet {...base} paused={true} />));
    expect(getByText(/Resume/)).toBeTruthy();
  });
});
