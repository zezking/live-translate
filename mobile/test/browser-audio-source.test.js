import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'http';
import { WebSocket } from 'ws';
import { BrowserAudioSource } from '../src/browser-audio-source.js';

const PASSWORD = 'test-password';

function setup() {
  const httpServer = createServer();
  const source = new BrowserAudioSource(httpServer, PASSWORD);
  source.start();
  httpServer.on('upgrade', (req, socket, head) => {
    source.handleUpgrade(req, socket, head);
  });
  return new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const port = httpServer.address().port;
      resolve({ httpServer, source, port });
    });
  });
}

function teardown(httpServer, source) {
  source.stop();
  return new Promise((r) => httpServer.close(r));
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
}

test('emits chunk when a binary frame arrives with correct auth', async () => {
  const { httpServer, source, port } = await setup();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/admin-input?key=${PASSWORD}`);
    ws.binaryType = 'arraybuffer';
    await waitForOpen(ws);

    const payload = Buffer.from([1, 2, 3, 4]);
    const chunkPromise = new Promise((resolve) => source.once('chunk', resolve));
    ws.send(payload);
    const chunk = await chunkPromise;
    assert.deepEqual(Buffer.from(chunk), payload);

    ws.close();
  } finally {
    await teardown(httpServer, source);
  }
});

test('rejects connection with missing key', async () => {
  const { httpServer, source, port } = await setup();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/admin-input`);
    await new Promise((resolve) => {
      ws.on('error', () => resolve());
      ws.on('close', (code) => {
        assert.equal(code, 1008);
        resolve();
      });
    });
  } finally {
    await teardown(httpServer, source);
  }
});

test('rejects connection with wrong key', async () => {
  const { httpServer, source, port } = await setup();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/admin-input?key=wrong`);
    await new Promise((resolve) => {
      ws.on('error', () => resolve());
      ws.on('close', (code) => {
        assert.equal(code, 1008);
        resolve();
      });
    });
  } finally {
    await teardown(httpServer, source);
  }
});

test('drops chunks while paused and emits them after resume', async () => {
  const { httpServer, source, port } = await setup();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/admin-input?key=${PASSWORD}`);
    await waitForOpen(ws);

    source.pause();

    const pausedPayload = Buffer.from([10, 20, 30]);
    let chunkSeen = false;
    source.on('chunk', () => { chunkSeen = true; });
    ws.send(pausedPayload);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(chunkSeen, false, 'no chunk should be emitted while paused');

    source.resume();
    const livePayload = Buffer.from([40, 50, 60]);
    const chunkPromise = new Promise((resolve) => source.once('chunk', resolve));
    ws.send(livePayload);
    const chunk = await chunkPromise;
    assert.deepEqual(Buffer.from(chunk), livePayload);

    ws.close();
  } finally {
    await teardown(httpServer, source);
  }
});

test('rejects second concurrent connection', async () => {
  const { httpServer, source, port } = await setup();
  try {
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws/admin-input?key=${PASSWORD}`);
    await waitForOpen(ws1);

    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws/admin-input?key=${PASSWORD}`);
    await new Promise((resolve) => {
      ws2.on('error', () => resolve());
      ws2.on('close', (code) => {
        assert.equal(code, 1008);
        resolve();
      });
    });

    ws1.close();
  } finally {
    await teardown(httpServer, source);
  }
});
