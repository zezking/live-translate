import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Fake `ws` WebSocket: records sends and lets the test drive events via
 * `instance.emit(...)`. Instances register themselves as `FakeWs.last` so a
 * test can grab the socket created inside `connect()`.
 */
class FakeWs {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static last: FakeWs | null = null;

  url: string;
  readyState = 0; // CONNECTING
  sent: unknown[] = [];
  closed = false;
  private listeners: Record<string, Array<(...a: unknown[]) => void>> = {};

  constructor(url: string) {
    this.url = url;
    FakeWs.last = this;
  }
  on(ev: string, fn: (...a: unknown[]) => void): void {
    (this.listeners[ev] ||= []).push(fn);
  }
  emit(ev: string, ...args: unknown[]): void {
    (this.listeners[ev] || []).forEach((fn) => fn(...args));
  }
  send(data: unknown): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
}

vi.mock('ws', () => ({ default: FakeWs, __esModule: true }));

// Imported AFTER vi.mock so it picks up the fake.
const { QwenTranslationSession } = await import('./qwen-translation-session.js');

describe('QwenTranslationSession connect/teardown race', () => {
  beforeEach(() => {
    FakeWs.last = null;
  });

  it('does not throw when open fires after disconnect nulled this.ws', async () => {
    // Reproduces the crash: a second client connecting triggers DuoSession.stop()
    // -> disconnect() on a Qwen session still mid-connect (readyState CONNECTING),
    // which skips close() but sets this.ws = null. The pending 'open' must be a
    // no-op, not a null-deref crash.
    const s = new QwenTranslationSession('key', 'ko', {}, { sourceLanguage: 'en', modalities: ['text'] });
    void s.connect(); // this.ws = fake (CONNECTING) synchronously
    const fake = FakeWs.last!;
    await s.disconnect(); // readyState != OPEN -> this.ws = null
    expect(fake.sent).toHaveLength(0);

    expect(() => fake.emit('open')).not.toThrow();
    expect(fake.sent).toHaveLength(0); // no session.update on a stale socket
  });

  it('ignores message/close from a replaced socket', async () => {
    const s = new QwenTranslationSession('key', 'ko', {}, { sourceLanguage: 'en', modalities: ['text'] });
    void s.connect();
    const fake = FakeWs.last!;
    await s.disconnect();

    const closed: unknown[] = [];
    s.on('closed', (info: unknown) => closed.push(info));
    // A late message must not throw; a late close must not emit (socket is stale).
    expect(() => fake.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' })))).not.toThrow();
    fake.emit('close', 1006, Buffer.from(''));
    expect(closed).toHaveLength(0);
  });
});
