import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { SessionManager } from './session-manager.js';

/**
 * Fake provider session — stands in for Qwen/Gemini so no real WebSocket opens.
 * Extends EventEmitter so the `closed` listener wired in `_createSession` works.
 */
class FakeSession extends EventEmitter {
  languageCode: string;
  isActive = true;
  inputMinutes = 0;
  outputMinutes = 0;
  _reconnecting = false;
  connectCalls = 0;
  disconnectCalls = 0;

  constructor(_apiKey: string, code: string) {
    super();
    this.languageCode = code;
  }

  async connect(): Promise<void> {
    this.connectCalls++;
  }

  sendAudio(): void {
    // no-op
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls++;
    this.isActive = false;
  }

  getUsage() {
    return {
      languageCode: this.languageCode,
      inputMinutes: this.inputMinutes,
      outputMinutes: this.outputMinutes,
    };
  }
}

/** Standalone view of the private internals we poke at in tests (cast via `unknown`). */
interface TestManager {
  _createSession: (code: string) => FakeSession;
  _reconnectSession: (code: string, reason?: string) => void;
  _apiKey: string;
  _SessionClass: unknown;
  _voiceConfig: Record<string, unknown>;
  provider: string | null;
  isRunning: boolean;
  sessions: Map<string, FakeSession>;
  _reconnectAttempts: Map<string, number>;
  _reconnectBaseDelay: number;
}

/** Wire up a SessionManager with a fake session class so _createSession returns FakeSessions. */
function setupManager(code = 'zh-Hans'): { mgr: SessionManager; tm: TestManager; session: FakeSession } {
  const mgr = new SessionManager();
  const tm = mgr as unknown as TestManager;
  // Bypass start() — set the internal state _createSession / _reconnectSession depend on.
  tm._SessionClass = FakeSession;
  tm._apiKey = 'test-key';
  tm.provider = 'gemini';
  tm._voiceConfig = {};
  tm.isRunning = true;

  // Create the initial session — this wires the `closed` listener onto it.
  const session = tm._createSession(code);
  tm.sessions.set(code, session);
  return { mgr, tm, session };
}

describe('SessionManager reconnect backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('defers reconnect via setTimeout (not synchronous)', () => {
    const { tm, session } = setupManager();
    const createSpy = vi.spyOn(tm, '_createSession');

    // Trigger the close→reconnect path.
    session.emit('closed', { languageCode: 'zh-Hans', reason: 'session expired' });

    // Immediately after: the reconnect must NOT have happened synchronously.
    expect(createSpy).not.toHaveBeenCalled();
    // The old session is marked as reconnecting.
    expect(session._reconnecting).toBe(true);
    // The old session was torn down (listeners removed + disconnected).
    expect(session.disconnectCalls).toBe(1);
    expect(session.listenerCount('closed')).toBe(0);

    // Advance just before the first backoff window (2000ms) — still pending.
    vi.advanceTimersByTime(1999);
    expect(createSpy).not.toHaveBeenCalled();

    // Cross the threshold.
    vi.advanceTimersByTime(1);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('guards against double-scheduling when close fires repeatedly during the hold', () => {
    const { tm, session } = setupManager();
    const createSpy = vi.spyOn(tm, '_createSession');

    // First close schedules the reconnect (and removeAllListeners on the old session).
    session.emit('closed', { languageCode: 'zh-Hans', reason: 'session expired' });
    // Second emit cannot reach the handler (listeners removed), but a direct second
    // call to _reconnectSession (simulating another code path) must also be a no-op.
    session.emit('closed', { languageCode: 'zh-Hans', reason: 'session expired' });
    tm._reconnectSession('zh-Hans', 'session expired');

    vi.advanceTimersByTime(60000);

    // Exactly one new session created despite three trigger attempts.
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('attempt 1 backoff delay is 2000ms (base delay)', () => {
    const { tm } = setupManager('ko');
    const createSpy = vi.spyOn(tm, '_createSession');

    tm._reconnectSession('ko', 'session expired');
    expect(tm._reconnectAttempts.get('ko')).toBe(1);

    // 1ms short of the base delay — must not fire yet.
    vi.advanceTimersByTime(1999);
    expect(createSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('attempt 2 backoff delay is 4000ms (exponential growth)', () => {
    const { tm } = setupManager('ko');
    const createSpy = vi.spyOn(tm, '_createSession');
    // Simulate one prior failed attempt so the next call is attempt 2.
    tm._reconnectAttempts.set('ko', 1);

    tm._reconnectSession('ko', 'rate limit exceeded');
    expect(tm._reconnectAttempts.get('ko')).toBe(2);

    // 2 * base = 4000ms; advancing only the base delay (2000) must not fire.
    vi.advanceTimersByTime(3999);
    expect(createSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('reconnects for rate-limit reasons (expanded regex includes rate|limit)', () => {
    const { tm, session } = setupManager();
    const createSpy = vi.spyOn(tm, '_createSession');

    session.emit('closed', { languageCode: 'zh-Hans', reason: 'rate limit exceeded' });
    expect(session._reconnecting).toBe(true);

    vi.advanceTimersByTime(2000);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT reconnect for an unrelated close reason', () => {
    const { tm, session } = setupManager();
    const createSpy = vi.spyOn(tm, '_createSession');

    session.emit('closed', { languageCode: 'zh-Hans', reason: 'normal closure' });
    expect(session._reconnecting).toBe(false);

    vi.advanceTimersByTime(60000);
    expect(createSpy).not.toHaveBeenCalled();
  });
});
