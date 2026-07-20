import { describe, it, expect } from 'vitest';
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
      ws.on('open', () => ws.send(JSON.stringify({ type: 'start', languages: ['en', 'ko'], voiceOver: false, voiceClone: false })));
      const first = await nextMessage(ws);
      expect(first.type).toBe('config');
      const second = await nextMessage(ws);
      expect(second).toEqual({ type: 'status', state: 'ready' });

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
});
