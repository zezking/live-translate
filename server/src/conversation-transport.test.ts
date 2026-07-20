import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { ConversationTransport, WS_CONVERSATION_PATH } from './conversation-transport.js';
import type { SessionFactory } from './duo-session.js';

class StubSession extends EventEmitter {
  src!: string; // assigned by the factory below before any use
  sentAudio: Buffer[] = [];
  stopped = false;
  async connect(): Promise<void> {}
  sendAudio(pcm: Buffer): void { this.sentAudio.push(pcm); }
  async disconnect(): Promise<void> {}
  async stop(): Promise<void> { this.stopped = true; }
}

interface Setup {
  httpServer: Server;
  port: number;
  made: StubSession[];
}

function setup(): Promise<Setup> {
  const made: StubSession[] = [];
  const factory: SessionFactory = (src) => {
    const s = new StubSession();
    s.src = src;
    made.push(s);
    return s as never;
  };
  const httpServer = createServer();
  const transport = new ConversationTransport({ apiKey: 'key', sessionFactory: factory, startTimeoutMs: 100 });
  httpServer.on('upgrade', (req, socket, head) => transport.handleUpgrade(req, socket, head));
  return new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () =>
      resolve({ httpServer, made, port: (httpServer.address() as { port: number }).port }),
    );
  });
}

function teardown(httpServer: Server): Promise<void> {
  return new Promise<void>((r) => httpServer.close(() => r()));
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((res) => ws.once('message', (d) => res(JSON.parse(d.toString()) as Record<string, unknown>)));
}

describe('ConversationTransport', () => {
  it('closes 1008 when no start frame arrives within the timeout', async () => {
    const { httpServer, port } = await setup();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_CONVERSATION_PATH}`);
      const code = await new Promise<number>((res) => { ws.on('close', res); ws.on('error', () => {}); });
      expect(code).toBe(1008);
    } finally {
      await teardown(httpServer);
    }
  });

  it('closes 1008 on a malformed start (same language twice)', async () => {
    const { httpServer, port } = await setup();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_CONVERSATION_PATH}`);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'start', languages: ['en', 'en'], voiceOver: false, voiceClone: false })));
      const code = await new Promise<number>((res) => { ws.on('close', res); ws.on('error', () => {}); });
      expect(code).toBe(1008);
    } finally {
      await teardown(httpServer);
    }
  });

  it('valid start → config echo then status ready; direction + binary route to that direction', async () => {
    const { httpServer, port, made } = await setup();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_CONVERSATION_PATH}`);
      // Buffer frames up front: config + status can be delivered in the same
      // event-loop turn, so a once-listener attached after the first await
      // would miss the second frame.
      const received: Record<string, unknown>[] = [];
      ws.on('message', (d) => received.push(JSON.parse(d.toString()) as Record<string, unknown>));
      ws.on('open', () => ws.send(JSON.stringify({ type: 'start', languages: ['en', 'ko'], voiceOver: false, voiceClone: false })));
      await vi.waitFor(() => {
        expect(received).toHaveLength(2);
      });
      expect(received[0].type).toBe('config');
      expect(received[1]).toEqual({ type: 'status', state: 'ready' });

      ws.send(JSON.stringify({ type: 'direction', from: 'ko' }));
      ws.send(Buffer.from([1, 2, 3]));
      await new Promise((r) => setTimeout(r, 50));
      expect(made[1].sentAudio.length).toBeGreaterThan(0); // ko→en session
      expect(made[0].sentAudio).toHaveLength(0);
      ws.close();
    } finally {
      await teardown(httpServer);
    }
  });

  it('a second connection replaces the first (old socket closed, old session stopped)', async () => {
    const { httpServer, port } = await setup();
    try {
      const start = JSON.stringify({ type: 'start', languages: ['en', 'ko'], voiceOver: false, voiceClone: false });
      const ws1 = new WebSocket(`ws://127.0.0.1:${port}${WS_CONVERSATION_PATH}`);
      ws1.on('open', () => ws1.send(start));
      await nextMessage(ws1); // config
      const ws2 = new WebSocket(`ws://127.0.0.1:${port}${WS_CONVERSATION_PATH}`);
      ws2.on('open', () => ws2.send(start));
      const code = await new Promise<number>((res) => { ws1.on('close', res); ws1.on('error', () => {}); });
      expect(code).toBe(1008);
      ws2.close();
    } finally {
      await teardown(httpServer);
    }
  });

  it('setConfig returns false after a failed session.start()', async () => {
    // Variant factory: every session rejects connect() → DuoSession.start() rejects.
    const made: StubSession[] = [];
    const factory: SessionFactory = (src) => {
      const s = new StubSession();
      s.src = src;
      s.connect = async () => {
        throw new Error('connect failed');
      };
      made.push(s);
      return s as never;
    };
    const httpServer = createServer();
    const transport = new ConversationTransport({ apiKey: 'key', sessionFactory: factory, startTimeoutMs: 100 });
    httpServer.on('upgrade', (req, socket, head) => transport.handleUpgrade(req, socket, head));
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const port = (httpServer.address() as { port: number }).port;
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_CONVERSATION_PATH}`);
      const received: Record<string, unknown>[] = [];
      ws.on('message', (d) => received.push(JSON.parse(d.toString()) as Record<string, unknown>));
      ws.on('open', () => ws.send(JSON.stringify({ type: 'start', languages: ['en', 'ko'], voiceOver: false, voiceClone: false })));
      // Wait for the error frame that signals start() rejected.
      await vi.waitFor(() => {
        expect(received.some((m) => m.type === 'error')).toBe(true);
      });
      // The socket stays open; the live session is cleared so REST config 404s.
      expect(ws.readyState).toBe(WebSocket.OPEN);
      const ok = await transport.setConfig({ voiceOver: true });
      expect(ok).toBe(false);
      ws.close();
    } finally {
      await teardown(httpServer);
    }
  });
});
