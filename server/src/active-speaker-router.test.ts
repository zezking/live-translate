import { describe, it, expect } from 'vitest';
import { ActiveSpeakerRouter } from './active-speaker-router.js';

const loud = Buffer.alloc(3200, 0x7f); // sample 0x7f7f = 32639
const med = Buffer.alloc(3200, 0x40); // sample 0x4040 = 16448
const silent = Buffer.alloc(3200, 0x00); // sample 0

describe('ActiveSpeakerRouter', () => {
  it('single speaker becomes dominant', () => {
    const r = new ActiveSpeakerRouter({ now: () => 1000 });
    r.feed('host', loud);
    expect(r.active()).toBe('host');
  });

  it('silence yields null', () => {
    const r = new ActiveSpeakerRouter({ now: () => 1000 });
    r.feed('host', silent);
    expect(r.active()).toBe(null);
  });

  it('hold prevents flapping; switches after hold window', () => {
    let t = 1000;
    const r = new ActiveSpeakerRouter({ holdMs: 400, now: () => t });
    r.feed('host', med);
    t += 100; // host dominant
    expect(r.active()).toBe('host');
    r.feed('joiner', loud);
    t += 100; // joiner louder, within hold
    r.feed('joiner', loud);
    t += 100;
    expect(r.active()).toBe('host'); // held during hold window
    t += 300; // total 600ms since switch > 400
    r.feed('joiner', loud);
    expect(r.active()).toBe('joiner'); // switches after hold expires
  });

  it('stale speaker energy decays to zero', () => {
    let t = 1000;
    const r = new ActiveSpeakerRouter({ holdMs: 400, staleMs: 300, now: () => t });
    r.feed('host', loud);
    t += 100;
    expect(r.active()).toBe('host');
    t += 500; // host went silent long ago
    r.feed('joiner', med); // joiner now the only fresh voice
    t += 50;
    r.feed('joiner', med);
    expect(r.active()).toBe('joiner'); // stale host loses dominance
  });
});
