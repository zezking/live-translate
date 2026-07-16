import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { ConversationManager } from './conversation-manager.js';
import { ConversationTransport, WS_CONVERSATION_PATH } from './conversation-transport.js';

/** Stub session that records attaches and replies with a config frame. */
class StubSession {
  attached: Array<{ role: string; ws: WebSocket }> = [];
  attachParticipant(role: string, ws: WebSocket): void {
    this.attached.push({ role, ws });
    ws.send(JSON.stringify({ type: 'config', voiceOver: false, voiceClone: false }));
  }
}

interface Setup {
  httpServer: Server;
  mgr: ConversationManager;
  transport: ConversationTransport;
  port: number;
}

function setup(): Promise<Setup> {
  const httpServer = createServer();
  const mgr = new ConversationManager();
  const transport = new ConversationTransport(mgr);
  httpServer.on('upgrade', (req, socket, head) => transport.handleUpgrade(req, socket, head));
  return new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () =>
      resolve({ httpServer, mgr, transport, port: (httpServer.address() as { port: number }).port }),
    );
  });
}

function teardown(httpServer: Server): Promise<void> {
  return new Promise<void>((r) => httpServer.close(() => r()));
}

describe('ConversationTransport', () => {
  it('valid host token attaches and the client receives config', async () => {
    const { httpServer, mgr, port } = await setup();
    try {
      const stub = new StubSession();
      const room = mgr.createRoom({ apiKey: 'key', names: { host: 'A', joiner: 'B' } });
      // Swap in a stub session so attachParticipant is observable without a real Qwen session.
      (mgr.getRoom(room.roomId) as unknown as { session: StubSession }).session = stub;

      const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_CONVERSATION_PATH}?token=${room.hostToken}`);
      const first = await new Promise<Record<string, unknown>>((res) =>
        ws.on('message', (d) => res(JSON.parse(d.toString()) as Record<string, unknown>)),
      );

      expect(first.type).toBe('config');
      expect(stub.attached[0]?.role).toBe('host');

      ws.close();
    } finally {
      await teardown(httpServer);
    }
  });

  it('invalid token is rejected with close code 1008', async () => {
    const { httpServer, port } = await setup();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_CONVERSATION_PATH}?token=bogus`);
      const code = await new Promise<number>((res) => {
        ws.on('close', res);
        ws.on('error', () => {});
      });
      expect(code).toBe(1008);
    } finally {
      await teardown(httpServer);
    }
  });
});
