import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { DuoSession, type SessionFactory } from './duo-session.js';
import type { ConversationWsMessage } from '@v2/shared';

class StubSession extends EventEmitter {
  src: string;
  tgt: string;
  sentAudio: Buffer[] = [];
  connectCalled = false;
  disconnectCalled = false;
  constructor(src: string, tgt: string) {
    super();
    this.src = src;
    this.tgt = tgt;
  }
  async connect(): Promise<void> { this.connectCalled = true; }
  sendAudio(pcm: Buffer): void { this.sentAudio.push(pcm); }
  async disconnect(): Promise<void> { this.disconnectCalled = true; }
}

function make(opts: { voiceOver?: boolean } = {}) {
  vi.useFakeTimers();
  const made: StubSession[] = [];
  const factory: SessionFactory = (src, tgt) => {
    const s = new StubSession(src, tgt);
    made.push(s);
    return s as never;
  };
  const session = new DuoSession({
    apiKey: 'key',
    languages: ['en', 'ko'],
    config: { voiceOver: opts.voiceOver ?? false, voiceClone: false },
    sessionFactory: factory,
    reconnectBaseDelay: 1000,
  });
  const sent: ConversationWsMessage[] = [];
  session.attach({ send: (m) => sent.push(m) });
  return { session, made, sent };
}

describe('DuoSession', () => {
  it('start creates both directions (A→B, B→A) and connects both', async () => {
    const { session, made } = make();
    await session.start();
    expect(made.map((s) => `${s.src}>${s.tgt}`)).toEqual(['en>ko', 'ko>en']);
    expect(made.every((s) => s.connectCalled)).toBe(true);
  });

  it('attach immediately echoes config', () => {
    const { sent } = make();
    expect(sent[0]).toEqual({ type: 'config', voiceOver: false, voiceClone: false });
  });

  it('routes PCM only to the active direction; drops it when none', async () => {
    const { session, made } = make();
    await session.start();
    session.handleAudio(Buffer.from([1]));
    expect(made[0].sentAudio).toHaveLength(0);
    session.setDirection('en');
    session.handleAudio(Buffer.from([2]));
    session.setDirection('ko');
    session.handleAudio(Buffer.from([3]));
    expect(made[0].sentAudio).toEqual([Buffer.from([2])]);
    expect(made[1].sentAudio).toEqual([Buffer.from([3])]);
  });

  it('emits turnEnd with the previous source language on switch and release', async () => {
    const { session, sent } = make();
    await session.start();
    session.setDirection('en');
    session.setDirection('ko');
    session.setDirection(null);
    const ends = sent.filter((m) => m.type === 'turnEnd');
    expect(ends).toEqual([{ type: 'turnEnd', lang: 'en' }, { type: 'turnEnd', lang: 'ko' }]);
  });

  it('ignores a direction outside the pair', async () => {
    const { session, sent } = make();
    await session.start();
    session.setDirection('fr');
    session.handleAudio(Buffer.from([1]));
    expect(sent.filter((m) => m.type === 'turnEnd')).toHaveLength(0);
  });

  it('maps inputTranscription → original delta (src lang), outputTranscription → translation delta (tgt lang)', async () => {
    const { session, made, sent } = make();
    await session.start();
    made[0].emit('inputTranscription', 'hello');
    made[0].emit('outputTranscription', '안녕');
    expect(sent).toContainEqual({ type: 'delta', field: 'original', lang: 'en', text: 'hello' });
    expect(sent).toContainEqual({ type: 'delta', field: 'translation', lang: 'ko', text: '안녕' });
  });

  it('relays audio only when voiceOver is on', async () => {
    const off = make();
    await off.session.start();
    off.made[0].emit('audio', Buffer.from([9]));
    expect(off.sent.filter((m) => m.type === 'audio')).toHaveLength(0);

    const on = make({ voiceOver: true });
    await on.session.start();
    on.made[0].emit('audio', Buffer.from([9]));
    expect(on.sent).toContainEqual({ type: 'audio', data: Buffer.from([9]).toString('base64') });
  });

  it('setConfig change broadcasts config, turnEnds both, and replaces both sessions', async () => {
    const { session, made, sent } = make();
    await session.start();
    await session.setConfig({ voiceOver: true });
    expect(sent).toContainEqual({ type: 'config', voiceOver: true, voiceClone: false });
    expect(sent.filter((m) => m.type === 'turnEnd')).toHaveLength(2);
    expect(made[0].disconnectCalled && made[1].disconnectCalled).toBe(true);
    expect(made).toHaveLength(4); // 2 original + 2 replacements
  });

  it('reconnects a closed session with backoff, but not on 1008/unauthorized', async () => {
    const { session, made } = make();
    await session.start();
    made[0].emit('closed', { reason: '1008' });
    vi.advanceTimersByTime(5000);
    expect(made).toHaveLength(2); // no reconnect
    made[1].emit('closed', { reason: 'network blip' });
    expect(made).toHaveLength(2);
    vi.advanceTimersByTime(1001);
    await vi.advanceTimersByTimeAsync(0);
    expect(made).toHaveLength(3); // direction 1 replaced
  });

  it('stop sends status ended and disconnects both', async () => {
    const { session, made, sent } = make();
    await session.start();
    await session.stop();
    expect(sent).toContainEqual({ type: 'status', state: 'ended' });
    expect(made.every((s) => s.disconnectCalled)).toBe(true);
  });
});
