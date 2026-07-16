import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import {
  ConversationSession,
  type Role,
  type SessionFactory,
  type ParticipantSocket,
} from './conversation-session.js';
import { QwenTranslationSession } from './qwen-translation-session.js';
import { ActiveSpeakerRouter } from './active-speaker-router.js';

class StubSession extends EventEmitter {
  role: Role;
  sourceLang: string;
  targetLang: string;
  sentAudio: Buffer[] = [];
  reconfigured: unknown[] = [];
  connectCalled = false;
  disconnectCalled = false;

  constructor(role: Role, sourceLang: string, targetLang: string) {
    super();
    this.role = role;
    this.sourceLang = sourceLang;
    this.targetLang = targetLang;
  }

  async connect(): Promise<void> {
    this.connectCalled = true;
  }

  sendAudio(pcm: Buffer): void {
    this.sentAudio.push(pcm);
  }

  async disconnect(): Promise<void> {
    this.disconnectCalled = true;
  }

  reconfigure(opts: unknown): void {
    this.reconfigured.push(opts);
  }
}

interface StubWs extends ParticipantSocket {
  sent: Record<string, unknown>[];
  closed: boolean;
  listeners: Record<string, Array<(...args: unknown[]) => void>>;
  emit(event: string, ...args: unknown[]): void;
}

function stubWs(): StubWs {
  const ws: StubWs = {
    readyState: 1,
    sent: [],
    closed: false,
    listeners: {},
    send: (m: string) => {
      ws.sent.push(JSON.parse(m) as Record<string, unknown>);
    },
    close: () => {
      ws.closed = true;
    },
    on: (ev: string, fn: (...args: unknown[]) => void) => {
      (ws.listeners[ev] = ws.listeners[ev] || []).push(fn);
    },
    emit: (ev: string, ...args: unknown[]) => {
      (ws.listeners[ev] || []).forEach((fn) => fn(...args));
    },
  };
  return ws;
}

function makeSession(opts: { routerFactory?: () => ActiveSpeakerRouter } = {}) {
  const sessions: Record<Role, StubSession | undefined> = {
    host: undefined,
    joiner: undefined,
  };
  const sessionFactory: SessionFactory = (role, src, tgt) => {
    const s = new StubSession(role, src, tgt);
    sessions[role] = s;
    return s;
  };
  const session = new ConversationSession({
    apiKey: 'key',
    sessionFactory,
    routerFactory: opts.routerFactory,
    names: { host: 'Enze', joiner: '아버님' },
  });
  return { session, sessions };
}

describe('ConversationSession', () => {
  it('start connects host(zh->ko) and joiner(ko->zh)', async () => {
    const { session, sessions } = makeSession();
    await session.start();
    expect(sessions.host!.sourceLang).toBe('zh');
    expect(sessions.host!.targetLang).toBe('ko');
    expect(sessions.joiner!.sourceLang).toBe('ko');
    expect(sessions.joiner!.targetLang).toBe('zh');
  });

  it('attachParticipant sends roomInfo + status', async () => {
    const { session } = makeSession();
    await session.start();
    const hostWs = stubWs();
    session.attachParticipant('host', hostWs);
    const types = hostWs.sent.map((m) => m.type);
    expect(types).toContain('roomInfo');
    expect(types).toContain('status');
  });

  it('inputTranscription routes to own device (original) and other device (original subtitle)', async () => {
    const { session, sessions } = makeSession();
    await session.start();
    const hostWs = stubWs();
    const joinerWs = stubWs();
    session.attachParticipant('host', hostWs);
    session.attachParticipant('joiner', joinerWs);

    sessions.host!.emit('inputTranscription', '你好');
    const hostMsgs = hostWs.sent.filter((m) => m.type === 'delta');
    const joinerMsgs = joinerWs.sent.filter((m) => m.type === 'delta');
    expect(hostMsgs[0].speaker).toBe('host');
    expect(hostMsgs[0].field).toBe('original');
    expect(hostMsgs[0].text).toBe('你好');
    expect(joinerMsgs[0].field).toBe('original');
    expect(joinerMsgs[0].text).toBe('你好');
  });

  it('outputTranscription routes to the OTHER device only as translation', async () => {
    const { session, sessions } = makeSession();
    await session.start();
    const hostWs = stubWs();
    const joinerWs = stubWs();
    session.attachParticipant('host', hostWs);
    session.attachParticipant('joiner', joinerWs);

    sessions.host!.emit('outputTranscription', '안녕하세요');
    const joinerTrans = joinerWs.sent.filter(
      (m) => m.type === 'delta' && m.field === 'translation',
    );
    expect(joinerTrans[0].text).toBe('안녕하세요');
    const hostTrans = hostWs.sent.filter(
      (m) => m.type === 'delta' && m.field === 'translation',
    );
    expect(hostTrans.length).toBe(0);
  });

  it('audio is sent to other device only when voice-over is on', async () => {
    const { session, sessions } = makeSession();
    await session.start();
    const hostWs = stubWs();
    const joinerWs = stubWs();
    session.attachParticipant('host', hostWs);
    session.attachParticipant('joiner', joinerWs);

    sessions.host!.emit('audio', Buffer.from([1, 2, 3, 4]));
    expect(joinerWs.sent.filter((m) => m.type === 'audio').length).toBe(0);

    await session.setConfig({ voiceOver: true });
    sessions.host!.emit('audio', Buffer.from([5, 6, 7, 8]));
    const audios = joinerWs.sent.filter((m) => m.type === 'audio');
    expect(audios.length).toBe(1);
  });

  it('handleAudio feeds only the dominant speaker session and emits turnEnd on switch', async () => {
    const clock = { t: 1000 };
    const { session, sessions } = makeSession({
      routerFactory: () => new ActiveSpeakerRouter({ holdMs: 400, now: () => clock.t }),
    });
    await session.start();
    const hostWs = stubWs();
    const joinerWs = stubWs();
    session.attachParticipant('host', hostWs);
    session.attachParticipant('joiner', joinerWs);

    const loud = Buffer.alloc(3200, 0x7f); // sample 0x7f7f = 32639
    const med = Buffer.alloc(3200, 0x40); // sample 0x4040 = 16448
    session.handleAudio('host', med);
    clock.t += 100;
    session.handleAudio('host', med);
    clock.t += 100;
    expect(sessions.host!.sentAudio.length).toBeGreaterThanOrEqual(1);
    expect(sessions.joiner!.sentAudio.length).toBe(0);

    clock.t += 400; // hold window expired; host energy is now stale
    session.handleAudio('joiner', loud);
    clock.t += 100;
    session.handleAudio('joiner', loud);
    expect(sessions.joiner!.sentAudio.length).toBeGreaterThanOrEqual(1);
    const turnEnds = hostWs.sent
      .filter((m) => m.type === 'turnEnd')
      .concat(joinerWs.sent.filter((m) => m.type === 'turnEnd'));
    expect(turnEnds.length).toBeGreaterThanOrEqual(1);
  });

  it('setConfig replaces both sessions (reconnect-on-change) when config changes', async () => {
    const factoryCalls: Array<{ role: Role; session: StubSession }> = [];
    const sessionFactory: SessionFactory = (role, src, tgt) => {
      const s = new StubSession(role, src, tgt);
      factoryCalls.push({ role, session: s });
      return s;
    };
    const session = new ConversationSession({
      apiKey: 'key',
      sessionFactory,
      names: { host: 'Enze', joiner: '아버님' },
    });
    await session.start();
    expect(factoryCalls.length).toBe(2);
    const oldHost = factoryCalls[0].session;
    await session.setConfig({ voiceOver: true, voiceClone: true });
    expect(factoryCalls.length).toBe(4);
    const newHost = factoryCalls[2].session;
    const newJoiner = factoryCalls[3].session;
    expect(newHost.role).toBe('host');
    expect(newJoiner.role).toBe('joiner');
    expect(newHost.connectCalled).toBe(true);
    expect(newJoiner.connectCalled).toBe(true);
    expect(oldHost.disconnectCalled).toBe(true);
    expect(newHost.reconfigured.length).toBe(0);
  });

  it('default sessionFactory bakes voice-over config into modalities + voiceClone (on)', () => {
    const session = new ConversationSession({
      apiKey: 'key',
      config: { voiceOver: true, voiceClone: true },
    });
    const s = session['_sessionFactory']('host', 'zh', 'ko');
    expect(s instanceof QwenTranslationSession).toBe(true);
    const q = s as QwenTranslationSession;
    expect(q['_modalities']).toEqual(['text', 'audio']);
    expect(q.enableVoiceClone).toBe(true);
  });

  it('default sessionFactory bakes voice-over config into modalities + voiceClone (off)', () => {
    const session = new ConversationSession({
      apiKey: 'key',
      config: { voiceOver: false, voiceClone: false },
    });
    const s = session['_sessionFactory']('host', 'zh', 'ko');
    expect(s instanceof QwenTranslationSession).toBe(true);
    const q = s as QwenTranslationSession;
    expect(q['_modalities']).toEqual(['text']);
    expect(q.enableVoiceClone).toBe(false);
  });

  it('stop() isolates disconnect failures — a throwing disconnect does not abort the other role', async () => {
    const { session, sessions } = makeSession();
    await session.start();
    const hostWs = stubWs();
    const joinerWs = stubWs();
    session.attachParticipant('host', hostWs);
    session.attachParticipant('joiner', joinerWs);
    // host's disconnect throws
    sessions.host!.disconnect = async () => {
      throw new Error('boom');
    };
    await session.stop();
    expect(sessions.joiner!.disconnectCalled).toBe(true);
    expect(joinerWs.closed).toBe(true);
  });

  it('Qwen session closed (GoAway) triggers reconnection (no reconfigure)', async () => {
    const factoryCalls: Array<{ role: Role; session: StubSession }> = [];
    const sessionFactory: SessionFactory = (role, src, tgt) => {
      const s = new StubSession(role, src, tgt);
      factoryCalls.push({ role, session: s });
      return s;
    };
    const session = new ConversationSession({
      apiKey: 'key',
      sessionFactory,
      names: { host: 'Enze', joiner: '아버님' },
      config: { voiceOver: true, voiceClone: true },
      reconnectBaseDelay: 5,
    });
    await session.start();
    expect(factoryCalls.length).toBe(2);
    const originalHost = factoryCalls[0].session;
    // simulate Qwen closing the host session mid-conversation
    originalHost.emit('closed', { reason: 'GoAway' });
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(factoryCalls.length).toBe(3);
    const newHost = factoryCalls[2].session;
    expect(newHost.role).toBe('host');
    expect(newHost.connectCalled).toBe(true);
    expect(newHost.reconfigured.length).toBe(0);
  });

  it('unauthorized close reason does NOT trigger reconnect', async () => {
    const factoryCalls: StubSession[] = [];
    const sessionFactory: SessionFactory = (role, src, tgt) => {
      const s = new StubSession(role, src, tgt);
      factoryCalls.push(s);
      return s;
    };
    const session = new ConversationSession({
      apiKey: 'key',
      sessionFactory,
      names: { host: 'Enze', joiner: '아버님' },
      reconnectBaseDelay: 5,
    });
    await session.start();
    expect(factoryCalls.length).toBe(2);
    // simulate an auth-failure close on the host session
    factoryCalls[0].emit('closed', { reason: 'unauthorized 1008' });
    await new Promise<void>((r) => setTimeout(r, 30));
    expect(factoryCalls.length).toBe(2);
  });
});
