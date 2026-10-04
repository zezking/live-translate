import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'http';
import { WebSocket } from 'ws';
import { AudioBroadcaster } from './audio-broadcaster.js';

interface Setup {
  server: Server;
  broadcaster: AudioBroadcaster;
  port: number;
}

function setup(): Promise<Setup> {
  const server = createServer();
  const broadcaster = new AudioBroadcaster(server);
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, broadcaster, port });
    });
  });
}

function teardown(server: Server, broadcaster: AudioBroadcaster): Promise<void> {
  broadcaster.close();
  return new Promise((resolve) => server.close(() => resolve()));
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
}

/** Collect every JSON message a client receives into `sink`. */
function collect(ws: WebSocket, sink: unknown[]): void {
  ws.on('message', (data) => {
    try {
      sink.push(JSON.parse(data.toString()));
    } catch {
      sink.push(data.toString());
    }
  });
}

const sockets: WebSocket[] = [];

afterEach(() => {
  for (const ws of sockets.splice(0)) {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
});

describe('AudioBroadcaster fan-out', () => {
  it('delivers transcription only to matched language+text-mode clients', async () => {
    const { server, broadcaster, port } = await setup();
    try {
      // Client A: zh-Hans, text mode -> should receive transcription.
      const wsA = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      sockets.push(wsA);
      await waitForOpen(wsA);
      wsA.send(JSON.stringify({ type: 'selectLanguage', languageCode: 'zh-Hans' }));
      wsA.send(JSON.stringify({ type: 'setMode', mode: 'text' }));

      // Client B: zh-Hans, audio mode (default) -> should NOT receive transcription.
      const wsB = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      sockets.push(wsB);
      await waitForOpen(wsB);
      wsB.send(JSON.stringify({ type: 'selectLanguage', languageCode: 'zh-Hans' }));

      // Client C: ko, text mode -> should NOT receive zh-Hans transcription.
      const wsC = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      sockets.push(wsC);
      await waitForOpen(wsC);
      wsC.send(JSON.stringify({ type: 'selectLanguage', languageCode: 'ko' }));
      wsC.send(JSON.stringify({ type: 'setMode', mode: 'text' }));

      const sinkA: unknown[] = [];
      const sinkB: unknown[] = [];
      const sinkC: unknown[] = [];
      collect(wsA, sinkA);
      collect(wsB, sinkB);
      collect(wsC, sinkC);

      // Allow the server to process the selectLanguage/setMode frames.
      await new Promise((r) => setTimeout(r, 60));

      broadcaster.broadcastTranscription('zh-Hans', 'input', 'hello');

      // Allow the broadcast to propagate.
      await new Promise((r) => setTimeout(r, 60));

      expect(sinkA).toHaveLength(1);
      expect((sinkA[0] as { type: string; languageCode: string; text: string }).type).toBe(
        'transcription',
      );
      expect((sinkA[0] as { text: string }).text).toBe('hello');

      expect(sinkB).toHaveLength(0);
      expect(sinkC).toHaveLength(0);
    } finally {
      await teardown(server, broadcaster);
    }
  });

  it('delivers audio only to matched language+audio-mode clients', async () => {
    const { server, broadcaster, port } = await setup();
    try {
      // Client A: zh-Hans, text mode -> should NOT receive audio.
      const wsA = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      sockets.push(wsA);
      await waitForOpen(wsA);
      wsA.send(JSON.stringify({ type: 'selectLanguage', languageCode: 'zh-Hans' }));
      wsA.send(JSON.stringify({ type: 'setMode', mode: 'text' }));

      // Client B: zh-Hans, audio mode (default) -> should receive audio.
      const wsB = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      sockets.push(wsB);
      await waitForOpen(wsB);
      wsB.send(JSON.stringify({ type: 'selectLanguage', languageCode: 'zh-Hans' }));

      // Client C: ko, audio mode -> should NOT receive zh-Hans audio.
      const wsC = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      sockets.push(wsC);
      await waitForOpen(wsC);
      wsC.send(JSON.stringify({ type: 'selectLanguage', languageCode: 'ko' }));

      const sinkA: unknown[] = [];
      const sinkB: unknown[] = [];
      const sinkC: unknown[] = [];
      collect(wsA, sinkA);
      collect(wsB, sinkB);
      collect(wsC, sinkC);

      await new Promise((r) => setTimeout(r, 60));

      const pcm = Buffer.from([1, 2, 3, 4]);
      broadcaster.broadcastAudio('zh-Hans', pcm);

      await new Promise((r) => setTimeout(r, 60));

      expect(sinkB).toHaveLength(1);
      expect((sinkB[0] as { type: string; languageCode: string }).type).toBe('audio');
      expect((sinkB[0] as { languageCode: string }).languageCode).toBe('zh-Hans');
      expect((sinkB[0] as { data: string }).data).toBe(pcm.toString('base64'));

      expect(sinkA).toHaveLength(0);
      expect(sinkC).toHaveLength(0);
    } finally {
      await teardown(server, broadcaster);
    }
  });

  it('broadcastStatus reaches every connected client regardless of language/mode', async () => {
    const { server, broadcaster, port } = await setup();
    try {
      const wsA = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      sockets.push(wsA);
      await waitForOpen(wsA);
      wsA.send(JSON.stringify({ type: 'selectLanguage', languageCode: 'zh-Hans' }));
      wsA.send(JSON.stringify({ type: 'setMode', mode: 'text' }));

      const wsB = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      sockets.push(wsB);
      await waitForOpen(wsB);
      wsB.send(JSON.stringify({ type: 'selectLanguage', languageCode: 'ko' }));

      const sinkA: unknown[] = [];
      const sinkB: unknown[] = [];
      collect(wsA, sinkA);
      collect(wsB, sinkB);

      await new Promise((r) => setTimeout(r, 60));

      broadcaster.broadcastStatus({ sessionId: 's1', status: 'started' });

      await new Promise((r) => setTimeout(r, 60));

      expect(sinkA).toHaveLength(1);
      expect(sinkB).toHaveLength(1);
      expect((sinkA[0] as { type: string; status: string }).status).toBe('started');
      expect((sinkB[0] as { type: string; status: string }).status).toBe('started');
    } finally {
      await teardown(server, broadcaster);
    }
  });
});
