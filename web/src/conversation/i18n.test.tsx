import { describe, it, expect } from 'vitest';
import { STRINGS } from './i18n.js';

describe('i18n (single-device)', () => {
  it('STRINGS has matching en + ko keys', () => {
    expect(Object.keys(STRINGS.ko).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });

  it('keeps the keys the single-device UI uses', () => {
    const required = [
      'title', 'setup_subtitle', 'begin', 'connecting', 'hold_to_talk', 'listening',
      'paused', 'tap_resume', 'reconnecting', 'ended', 'warm_close', 'begin_another',
      'pause', 'resume', 'end', 'mic', 'mic_blocked', 'unauthorized',
      'admin_password', 'admin_continue', 'voice_over', 'voice_clone',
    ] as const;
    for (const key of required) {
      expect(STRINGS.en[key], `en.${key}`).toBeTruthy();
      expect(STRINGS.ko[key], `ko.${key}`).toBeTruthy();
    }
  });
});
