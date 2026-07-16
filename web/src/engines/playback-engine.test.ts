import { describe, it, expect } from 'vitest';
import { PlaybackEngine } from './playback-engine.js';

function fakeCtx() {
  let t = 100;
  const sources: any[] = [];
  const ctx: any = { state: 'running', get currentTime() { return t; },
    createBuffer(_ch: number, len: number, _sr: number) { return { length: len, duration: len / 24000, getChannelData: () => new Float32Array(len) }; },
    createBufferSource() { const s: any = { startedAt: null, connect() {}, start(when: number) { this.startedAt = when; }, stop() { s._stopped = true; } }; sources.push(s); return s; },
    createGain() { return { gain: { value: 1 }, connect() {} }; }, resume() { return Promise.resolve(); }, close() {} };
  return { ctx, sources, advance(sec: number) { t += sec; } };
}

describe('PlaybackEngine', () => {
  it('schedules chunks gaplessly and stops all', async () => {
    const { ctx, sources, advance } = fakeCtx();
    const eng = new PlaybackEngine({ AudioContextCtor: (() => ctx) as any, sampleRate: 24000 });
    await eng.ensureContext();
    // base64 of 4800 bytes (=2400 samples =0.1s @24kHz) of zeros
    const b64 = btoa(String.fromCharCode(...new Uint8Array(4800)));
    eng.queueAudio(b64);        // 0.1s chunk
    eng.queueAudio(b64);        // next, gapless
    expect(sources[0].startedAt).toBe(100);
    expect(sources[1].startedAt).toBeCloseTo(100.1, 5);   // scheduled after first
    eng.stopAll();
    expect(sources.every((s) => s._stopped)).toBe(true);
  });
});
