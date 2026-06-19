# Input Source Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-page input source selector with three options (USB / Browser / System), so the operator can capture audio from a YouTube tab or macOS loopback instead of the USB interface for testing and demos.

**Architecture:** Introduce a common `AudioSource` contract (EventEmitter emitting 100ms 16kHz mono Int16 LE `chunk` buffers). Split today's `AudioCapture` into `UsbAudioSource` (sox + CoreAudio, identical behavior) and a new `BrowserAudioSource` (WebSocket receiver on `/ws/admin-input`). The server picks one per session based on `inputSource` in `/api/start`. On the admin page, `getDisplayMedia` + AudioWorklet produce PCM chunks that flow back over WebSocket to `BrowserAudioSource`, which re-emits them into the existing downstream pipeline (SessionManager → translator → broadcaster). A local AnalyserNode drives the level meter in browser mode.

**Tech Stack:** Node.js 22+ (ESM), Express 5, `ws` for WebSocket (already a dependency), `node:test` (built-in) for the new server-side unit tests, vanilla browser JS + `getDisplayMedia` + AudioWorklet on the client.

## Global Constraints

- ESM only (`"type": "module"` in package.json); all new server files use `import`/`export`.
- No new npm dependencies. `ws` is already present; `node:test` and `node:assert/strict` are built into Node 22+.
- Sample format everywhere is fixed: 16 kHz, mono, signed 16-bit little-endian PCM, 100 ms chunks (3200 bytes).
- Admin password auth uses `?key=<ADMIN_PASSWORD>` query string for the new WS endpoint — same pattern as existing admin SSE.
- Source is locked at `POST /api/start`; switching mid-session is not supported. Admin radios must be disabled while a session runs (matches how language checkboxes and provider radios are already disabled).
- Browser/System modes share the same `BrowserAudioSource` class — the only difference is which option the user picks in the OS dialog. The admin UI's hint text guides the choice; nothing in code distinguishes them.
- README updates are part of this work (cross-platform note + browser support).

---

## File Structure

**Server (src/):**

| File | Status | Responsibility |
|------|--------|----------------|
| `src/audio-capture.js` → `src/usb-audio-source.js` | Renamed | `UsbAudioSource` class — today's `AudioCapture` body verbatim, class renamed |
| `src/browser-audio-source.js` | New | `BrowserAudioSource` class — owns `/ws/admin-input` WSS, verifies admin key, re-emits binary frames as `chunk` events |
| `src/server.js` | Modified | Per-session `activeSource`; switch on `inputSource`; `inputSource` in `/api/status` |
| `package.json` | Modified | Add `"test": "node --test"` script |
| `test/browser-audio-source.test.js` | New | Unit tests for `BrowserAudioSource` using `node:test` + `ws` client |

**Public (public/):**

| File | Status | Responsibility |
|------|--------|----------------|
| `public/pcm-worklet.js` | New | AudioWorklet processor — Float32 → Int16 LE, accumulates 100ms chunks, posts via `port` |
| `public/admin.html` | Modified | Extend "Audio Input" section with source radios, hint div, RECONNECT button |
| `public/admin.css` | Modified | Reuse `.model-radios`/`.model-radio`; add `.source-hint` and `.btn-reconnect` |
| `public/admin.js` | Modified | Source selection, browser capture flow (getDisplayMedia + AudioContext + WS), AnalyserNode meter, RECONNECT button |

**Docs:**

| File | Status | Responsibility |
|------|--------|----------------|
| `README.md` | Modified | Cross-platform note + browser support section |

---

## Task 1: Rename `AudioCapture` → `UsbAudioSource`

Pure rename refactor. No behavior change. Establishes the source-class pattern that `BrowserAudioSource` will mirror in Task 2.

**Files:**
- Delete: `src/audio-capture.js`
- Create: `src/usb-audio-source.js` (same content, class renamed)
- Modify: `src/server.js:7` (import) and `src/server.js:24` (instantiation)

**Interfaces:**
- Produces: `export class UsbAudioSource extends EventEmitter` with `start()`, `stop()`, `pause()`, `resume()`; emits `chunk` (Buffer), `started`, `stopped`, `paused`, `resumed`, `error`. Constructor reads `process.env.AUDIO_DEVICE` exactly as today.

- [ ] **Step 1: Create `src/usb-audio-source.js` with renamed class**

Create the file with the exact contents of today's `src/audio-capture.js`, but rename the class from `AudioCapture` to `UsbAudioSource` and update the `export`:

```js
import Recorder from 'node-record-lpcm16';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);

const CHUNK_INTERVAL_MS = 100;
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const CHANNELS = 1;
const CHUNK_SIZE = (SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_INTERVAL_MS) / 1000;

function soxCoreAudioDevice(deviceName) {
  return spawn('sox', [
    '-q',
    '-t', 'coreaudio', deviceName,
    '--rate', String(SAMPLE_RATE),
    '--channels', String(CHANNELS),
    '--encoding', 'signed-integer',
    '--bits', '16',
    '--type', 'raw',
    '--no-show-progress',
    '-',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
}

export class UsbAudioSource extends EventEmitter {
  constructor() {
    super();
    this.recorder = null;
    this.buffer = Buffer.alloc(0);
    this.isCapturing = false;
    this.device = process.env.AUDIO_DEVICE || null;
    this._soxProc = null;
    this._soxProcPaused = false;
  }

  start() {
    if (this.isCapturing) return;

    this.isCapturing = true;
    this.buffer = Buffer.alloc(0);

    if (this.device && process.platform === 'darwin') {
      this._startCoreAudio();
    } else {
      this._startDefault();
    }

    this.emit('started');
  }

  _startCoreAudio() {
    const cp = soxCoreAudioDevice(this.device);

    cp.stdout.on('data', (data) => this._onData(data));
    cp.stderr.on('data', (d) => process.stderr.write(d));
    cp.on('error', (err) => this.emit('error', err));
    cp.on('close', (code) => {
      if (code !== 0 && code !== null && this.isCapturing) {
        this.emit('error', new Error(`sox exited with code ${code}`));
      }
    });

    this._soxProc = cp;
    this._soxProcPaused = false;
  }

  _startDefault() {
    const opts = {
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      audioType: 'raw',
    };

    if (this.device) {
      opts.device = this.device;
    }

    this.recorder = Recorder.record(opts);

    this.recorder.stream().on('data', (data) => this._onData(data));
    this.recorder.stream().on('error', (err) => this.emit('error', err));
  }

  _onData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.buffer.length >= CHUNK_SIZE) {
      const chunk = this.buffer.subarray(0, CHUNK_SIZE);
      this.buffer = this.buffer.subarray(CHUNK_SIZE);
      this.emit('chunk', chunk);
    }
  }

  stop() {
    if (!this.isCapturing) return;
    this.isCapturing = false;

    if (this._soxProc) {
      this._soxProc.kill('SIGTERM');
      this._soxProc = null;
    }
    if (this.recorder) {
      this.recorder.stop();
      this.recorder = null;
    }
    this.emit('stopped');
  }

  pause() {
    if (!this.isCapturing) return;
    if (this._soxProc && !this._soxProcPaused) {
      this._soxProc.kill('SIGSTOP');
      this._soxProcPaused = true;
    } else if (this.recorder) {
      this.recorder.pause();
    }
    this.emit('paused');
  }

  resume() {
    if (!this.isCapturing) return;
    if (this._soxProc && this._soxProcPaused) {
      this._soxProc.kill('SIGCONT');
      this._soxProcPaused = false;
    } else if (this.recorder) {
      this.recorder.resume();
    }
    this.emit('resumed');
  }
}
```

- [ ] **Step 2: Delete `src/audio-capture.js`**

```bash
rm src/audio-capture.js
```

- [ ] **Step 3: Update `src/server.js` to import and use the renamed class**

In `src/server.js`, change line 7 from:

```js
import { AudioCapture } from './audio-capture.js';
```

to:

```js
import { UsbAudioSource } from './usb-audio-source.js';
```

And change line 24 from:

```js
const audioCapture = new AudioCapture();
```

to:

```js
const audioCapture = new UsbAudioSource();
```

Leave all other references to `audioCapture` in `src/server.js` untouched — the variable name stays so the rest of the file's behavior is identical.

- [ ] **Step 4: Verify the server still boots and USB capture still works**

Run: `npm start`
Expected: server starts without errors; admin page loads at `/admin`; clicking START with USB source (the default after this task) captures audio exactly as before.

Manual check: open admin page, log in, click START, speak into the USB mic, confirm the level meter moves and the attendee page receives translation. Click STOP.

- [ ] **Step 5: Commit**

```bash
git add src/usb-audio-source.js src/audio-capture.js src/server.js
git commit -m "$(cat <<'EOF'
refactor: rename AudioCapture to UsbAudioSource

Pure rename to establish the AudioSource pattern. No behavior change;
the variable name `audioCapture` in server.js is preserved so all
downstream wiring is identical.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `BrowserAudioSource` with unit tests

TDD: write failing tests first, implement the class, watch them pass. Uses `node:test` (built into Node 22+, no new dep) and a real `ws` client to exercise the WebSocket end-to-end inside the test process.

**Files:**
- Create: `src/browser-audio-source.js`
- Create: `test/browser-audio-source.test.js`
- Modify: `package.json` (add `"test"` script)

**Interfaces:**
- Consumes: `ws` (`WebSocketServer` from `'ws'`)
- Produces: `export class BrowserAudioSource extends EventEmitter`
  - `constructor(server, adminPassword)` — `server` is an `http.Server` (or `https.Server`); `adminPassword` is the string to check against `?key=`
  - `start()` — attaches `WebSocketServer({ server, path: '/ws/admin-input' })`; idempotent
  - `stop()` — closes any active WS, closes the WSS, emits `'stopped'`; idempotent
  - `pause()` — sets internal `_suppress = true`; emits `'paused'`
  - `resume()` — sets `_suppress = false`; emits `'resumed'`
  - Emits `'chunk'` with a `Buffer` for each accepted binary frame when not suppressed
  - Emits `'error'` with an `Error` if the WSS fails to attach

- [ ] **Step 1: Add `test` script to `package.json`**

In `package.json`, add to the `"scripts"` object so it reads:

```json
"scripts": {
  "start": "node src/server.js",
  "dev": "node --watch src/server.js",
  "test": "node --test"
}
```

- [ ] **Step 2: Write the failing test file `test/browser-audio-source.test.js`**

`node --test` discovers files matching `*.test.js` by default. This test creates a bare `http.Server`, attaches a `BrowserAudioSource`, and connects with a real `ws` client.

```js
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
```

- [ ] **Step 3: Run the tests to verify they fail (class doesn't exist yet)**

Run: `npm test`
Expected: All 5 tests fail with an import error — `Cannot find module '../src/browser-audio-source.js'`.

- [ ] **Step 4: Implement `src/browser-audio-source.js`**

```js
import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';

const WS_PATH = '/ws/admin-input';

export class BrowserAudioSource extends EventEmitter {
  constructor(server, adminPassword) {
    super();
    this._server = server;
    this._adminPassword = adminPassword;
    this._wss = null;
    this._activeWs = null;
    this._suppress = false;
  }

  start() {
    if (this._wss) return;
    this._wss = new WebSocketServer({ server: this._server, path: WS_PATH });

    this._wss.on('connection', (ws, req) => {
      if (!this._authorize(req)) {
        ws.close(1008, 'unauthorized');
        return;
      }
      if (this._activeWs && this._activeWs.readyState === 1) {
        ws.close(1008, 'another connection is active');
        return;
      }
      this._activeWs = ws;

      ws.on('message', (data, isBinary) => {
        if (!isBinary) return;
        if (this._suppress) return;
        this.emit('chunk', Buffer.isBuffer(data) ? data : Buffer.from(data));
      });

      ws.on('close', () => {
        if (this._activeWs === ws) this._activeWs = null;
      });

      ws.on('error', () => {
        if (this._activeWs === ws) this._activeWs = null;
      });
    });
  }

  _authorize(req) {
    const url = new URL(req.url, 'http://localhost');
    return url.searchParams.get('key') === this._adminPassword;
  }

  pause() {
    this._suppress = true;
    this.emit('paused');
  }

  resume() {
    this._suppress = false;
    this.emit('resumed');
  }

  stop() {
    if (this._activeWs) {
      try { this._activeWs.close(1000, 'stopped'); } catch {}
      this._activeWs = null;
    }
    if (this._wss) {
      this._wss.close();
      this._wss = null;
    }
    this._suppress = false;
    this.emit('stopped');
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: All 5 tests pass.

If any test fails, fix the implementation (not the test) and re-run until green. The tests are the spec for this class.

- [ ] **Step 6: Commit**

```bash
git add package.json test/browser-audio-source.test.js src/browser-audio-source.js
git commit -m "$(cat <<'EOF'
feat: add BrowserAudioSource for WebSocket-based audio capture

New source class accepts PCM chunks from the admin browser via
/ws/admin-input. Authenticates with the admin password on the WS
handshake (same ?key= pattern as admin SSE). Rejects concurrent
connections and suppresses chunk emission while paused.

Includes unit tests using node:test + ws client.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire source selection in `src/server.js`

The server now picks between `UsbAudioSource` and `BrowserAudioSource` per session based on `inputSource` in `/api/start`. `/api/status` reports the active source so the admin UI can restore state on reload.

**Files:**
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `UsbAudioSource` from Task 1, `BrowserAudioSource` from Task 2
- Produces:
  - `POST /api/start` body now accepts optional `inputSource: 'usb' | 'browser' | 'system'` (default `'usb'`); unknown values return HTTP 400
  - `GET /api/status` response now includes `inputSource: string | null` (`null` when session not running)

- [ ] **Step 1: Replace the fixed `audioCapture` instance with a per-session `activeSource`**

In `src/server.js`, **delete** line 24 (`const audioCapture = new UsbAudioSource();`) and **replace** with:

```js
let activeSource = null;
let activeInputSource = null;

function createSource(inputSource) {
  if (inputSource === 'usb' || !inputSource) return new UsbAudioSource();
  if (inputSource === 'browser' || inputSource === 'system') {
    return new BrowserAudioSource(server, ADMIN_PASSWORD);
  }
  return null;
}

activeSource = createSource('usb'); // boot-time default so /api/audio-level works pre-start
activeSource.on('chunk', (chunk) => sessionManager.sendAudio(chunk));
```

The boot-time default exists so `/api/audio-level` SSE (which subscribes to `activeSource.on('chunk', ...)`) has something to listen to before any session starts, matching today's behavior. The real per-session source is created in `/api/start`.

- [ ] **Step 2: Add `inputSource` validation and per-session source creation in `/api/start`**

Replace the existing `POST /api/start` handler (lines 150-168) with:

```js
app.post('/api/start', requireAdmin, async (req, res) => {
  try {
    const { languages, provider, voiceConfig, inputSource } = req.body || {};
    if (inputSource && !['usb', 'browser', 'system'].includes(inputSource)) {
      return res.status(400).json({ error: `Invalid inputSource: ${inputSource}` });
    }
    const effectiveSource = inputSource || 'usb';

    const newSource = createSource(effectiveSource);
    if (!newSource) {
      return res.status(400).json({ error: `Invalid inputSource: ${effectiveSource}` });
    }

    // tear down any pre-existing default source before starting the new one
    if (activeSource) {
      activeSource.removeAllListeners('chunk');
      activeSource.stop();
    }

    activeSource = newSource;
    activeInputSource = effectiveSource;
    activeSource.on('chunk', (chunk) => sessionManager.sendAudio(chunk));

    if (languages) {
      sessionManager.setEnabledLanguages(languages);
    }
    const selectedProvider = provider || (apiKeys.gemini ? 'gemini' : 'qwen');
    activeSource.start();
    try {
      await sessionManager.start(apiKeys, selectedProvider, voiceConfig || {});
    } catch (err) {
      activeSource.stop();
      throw err;
    }
    res.json({ status: 'started', provider: selectedProvider, inputSource: effectiveSource });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Update `/api/pause`, `/api/resume`, `/api/stop` to delegate to `activeSource`**

The existing handlers reference `audioCapture`. Replace those references with `activeSource`.

In `POST /api/pause` (lines 170-175):
- `audioCapture.pause()` → `activeSource.pause()`

In `POST /api/resume` (lines 177-182):
- `audioCapture.resume()` → `activeSource.resume()`

In `POST /api/stop` (lines 184-193):
- `audioCapture.stop()` → `activeSource.stop()`
- After the stop, also clear the active source tracking so status reports `null`:

```js
app.post('/api/stop', requireAdmin, async (req, res) => {
  try {
    activeSource.stop();
    // reset to the boot-time USB default so /api/audio-level still works if the admin re-opens it
    activeSource = createSource('usb');
    activeSource.on('chunk', (chunk) => sessionManager.sendAudio(chunk));
    activeInputSource = null;
    await sessionManager.stop();
    broadcaster.broadcastStatus({ state: 'stopped' });
    res.json({ status: 'stopped' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Add `inputSource` to `/api/status` response**

In the `GET /api/status` handler (lines 99-112), add `inputSource` to the response:

```js
app.get('/api/status', async (req, res) => {
  const stats = sessionManager.getStats();
  let tier = null;
  if (stats.provider === 'gemini' || (!stats.provider && apiKeys.gemini)) {
    tier = await detectGeminiTier();
  }
  res.json({
    ...stats,
    tier,
    estimatedCost: tier === 'free' ? 0 : stats.estimatedCost,
    attendees: broadcaster.getClientCount(),
    attendeesByLanguage: broadcaster.getClientsByLanguage(),
    inputSource: stats.isRunning ? activeInputSource : null,
  });
});
```

- [ ] **Step 5: Verify USB source still works end-to-end**

Run: `npm start`
Open `http://localhost:3000/admin`, log in, leave source as USB (Task 5 adds the radios; today there's no UI for it but the default is `usb`).

Manual checks:
- Click START, speak into mic, confirm translation flows to attendee page
- `curl -s http://localhost:3000/api/status | grep inputSource` should show `"inputSource":"usb"` while running, `"inputSource":null` when stopped
- `curl -s -X POST -H "Authorization: Bearer centrechurch" -H "Content-Type: application/json" -d '{"inputSource":"invalid"}' http://localhost:3000/api/start` should return HTTP 400 with `{"error":"Invalid inputSource: invalid"}`

- [ ] **Step 6: Commit**

```bash
git add src/server.js
git commit -m "$(cat <<'EOF'
feat: per-session audio source selection in server

/api/start now accepts inputSource: 'usb' | 'browser' | 'system'
(usb default). Server instantiates UsbAudioSource or BrowserAudioSource
accordingly and tears down any prior source before starting. /api/status
returns inputSource so the admin UI can restore state on reload.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add `pcm-worklet.js` AudioWorklet processor

AudioWorklet processors run in a separate audio thread and must be served as a separate JS file (the browser fetches it via `audioContext.audioWorklet.addModule`). This task creates that file. No automated test — the processor only runs inside a real AudioContext, which Node doesn't have.

**Files:**
- Create: `public/pcm-worklet.js`

**Interfaces:**
- Produces: an AudioWorklet processor registered under the name `'pcm-capture'`. Receives Float32 samples at the AudioContext's native rate (forced to 16 kHz in Task 6), converts to signed-16-bit little-endian PCM, accumulates into 3200-byte buffers (100 ms at 16 kHz mono Int16), and posts each complete buffer via `port.postMessage(buffer, [buffer])` (transferred, not copied).

- [ ] **Step 1: Create `public/pcm-worklet.js`**

```js
// AudioWorklet processor: receives Float32 samples at 16 kHz (forced by the
// AudioContext sampleRate), converts to signed-16-bit little-endian PCM,
// accumulates into 100 ms (3200-byte) chunks, and transfers each chunk out.
//
// Loaded via audioContext.audioWorklet.addModule('/pcm-worklet.js').
// Registered under the name 'pcm-capture'.

const SAMPLES_PER_CHUNK = 1600;  // 100 ms at 16 kHz
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_CHUNK = SAMPLES_PER_CHUNK * BYTES_PER_SAMPLE;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._carry = new Uint8Array(0);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    // input[0] is the first (and only, since we set channelCount: 1) channel
    const channel = input[0];

    // Float32 [-1, 1] → Int16 [-32768, 32767]
    const int16 = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    // append to carry buffer
    const bytes = new Uint8Array(int16.buffer);
    const combined = new Uint8Array(this._carry.length + bytes.length);
    combined.set(this._carry, 0);
    combined.set(bytes, this._carry.length);

    // emit 100 ms chunks, keep any leftover as carry
    let offset = 0;
    while (offset + BYTES_PER_CHUNK <= combined.length) {
      const chunk = combined.slice(offset, offset + BYTES_PER_CHUNK);
      // transfer the underlying buffer to avoid a copy
      this.port.postMessage(chunk.buffer, [chunk.buffer]);
      offset += BYTES_PER_CHUNK;
    }
    this._carry = combined.subarray(offset);

    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
```

- [ ] **Step 2: Verify the file is served and syntactically valid**

Run: `npm start`
In another terminal: `curl -s http://localhost:3000/pcm-worklet.js | head -5`
Expected: the first lines of the file appear (the AudioWorkletProcessor class definition begins). No 404.

- [ ] **Step 3: Commit**

```bash
git add public/pcm-worklet.js
git commit -m "$(cat <<'EOF'
feat: add AudioWorklet PCM processor

Receives Float32 samples at 16 kHz, converts to Int16 LE, accumulates
into 100 ms (3200-byte) chunks, transfers each out via port. Loaded
by the admin browser to feed the /ws/admin-input WebSocket.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add source radios and hint text to the admin UI

The admin page gains a 3-option radio group (USB / Browser / System) in the existing "Audio Input" section, plus hint text that updates per selection. This task is UI-only — no capture logic yet (that's Task 6). After this task, the radios render and the hint changes, but selecting "Browser" doesn't do anything different at START.

**Files:**
- Modify: `public/admin.html:52-58` (the "Audio Input" section)
- Modify: `public/admin.css` (add `.source-hint` and `.source-radios`)
- Modify: `public/admin.js` (render radios, manage selection state, expose `getInputSource()`)

**Interfaces:**
- Produces (in `admin.js`):
  - DOM: `#source-radios` (radio group container), `#source-hint` (hint text element)
  - Function: `getInputSource()` returns `'usb' | 'browser' | 'system'` (the currently selected value)
  - Function: `disableInputSourceRadios(disabled)` mirrors the existing `disableLanguageCheckboxes` pattern
  - Default selection: `'usb'`

- [ ] **Step 1: Extend the "Audio Input" section in `public/admin.html`**

Replace the existing Audio Input section (lines 52-58):

```html
    <div class="section">
      <p class="section-label">Audio Input:</p>
      <div class="level-meter-container">
        <div id="level-meter" class="level-meter"></div>
        <span id="level-db" class="level-db">-- dB</span>
      </div>
    </div>
```

with:

```html
    <div class="section">
      <p class="section-label">Audio Input:</p>
      <div id="source-radios" class="source-radios"></div>
      <p id="source-hint" class="source-hint"></p>
      <div class="level-meter-container">
        <div id="level-meter" class="level-meter"></div>
        <span id="level-db" class="level-db">-- dB</span>
      </div>
      <button id="reconnect-btn" class="btn btn-reconnect hidden">RECONNECT AUDIO</button>
    </div>
```

The `reconnect-btn` is created here but stays hidden until Task 7 wires it up.

- [ ] **Step 2: Add styles for source radios and hint to `public/admin.css`**

Append to `public/admin.css`:

```css
.source-radios {
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
}

.source-radios .model-radio {
  /* reuses .model-radio from the existing model-radios row */
}

.source-hint {
  font-size: 12px;
  color: #888;
  font-style: italic;
  margin: 4px 0 12px;
  min-height: 16px;
}

.btn-reconnect {
  padding: 8px 16px;
  font-size: 12px;
  letter-spacing: 1px;
  margin-top: 12px;
  background: #5d2a2a;
  color: #ffcccc;
  border: 1px solid #ff6b6b;
}

.btn-reconnect:hover {
  background: #ff6b6b;
  color: #000;
}
```

- [ ] **Step 3: Add source radio rendering, state, and helpers to `public/admin.js`**

Near the top of the IIFE in `public/admin.js`, after the existing `voiceSelect` const declaration (line 24), add:

```js
  const sourceRadios = document.getElementById('source-radios');
  const sourceHint = document.getElementById('source-hint');
  const reconnectBtn = document.getElementById('reconnect-btn');
```

Add the source definitions and rendering logic just after the `loadProviders` function (around line 155):

```js
  const INPUT_SOURCES = [
    { id: 'usb', label: 'USB' },
    { id: 'browser', label: 'Browser' },
    { id: 'system', label: 'System' },
  ];

  const SOURCE_HINTS = {
    usb: 'Captures from the USB device via sox.',
    browser: 'Click START, then in the picker choose a Chrome Tab and tick Share tab audio.',
    system: 'Click START, then in the picker choose Entire Screen and tick Share system audio.',
  };

  function renderSourceRadios() {
    sourceRadios.innerHTML = '';
    INPUT_SOURCES.forEach((src) => {
      const label = document.createElement('label');
      label.className = 'model-radio';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'inputSource';
      radio.value = src.id;
      radio.checked = src.id === 'usb';
      radio.addEventListener('change', updateSourceHint);
      label.appendChild(radio);
      label.appendChild(document.createTextNode(src.label));
      sourceRadios.appendChild(label);
    });
    updateSourceHint();
  }

  function updateSourceHint() {
    sourceHint.textContent = SOURCE_HINTS[getInputSource()] || '';
  }

  function getInputSource() {
    const checked = sourceRadios.querySelector('input[type="radio"]:checked');
    return checked ? checked.value : 'usb';
  }

  function disableInputSourceRadios(disabled) {
    const radios = sourceRadios.querySelectorAll('input[type="radio"]');
    radios.forEach((r) => { r.disabled = disabled; });
  }
```

Call `renderSourceRadios()` from inside `init()` (line 88), right before `loadProviders()`:

```js
  async function init() {
    renderSourceRadios();
    await loadProviders();
    await loadLanguages();
    loadVoices();
    loadQRCode();
    loadKeyStatus();
    restoreSessionState();
  }
```

- [ ] **Step 4: Wire source disable into start/stop and restore**

In the `startBtn` click handler (around line 343), add `disableInputSourceRadios(true)` next to the existing `disableLanguageCheckboxes(true)` line:

```js
      disableLanguageCheckboxes(true);
      disableModelRadios(true);
      disableVoiceControls(true);
      disableInputSourceRadios(true);
```

In the `stopBtn` click handler (around line 371), add `disableInputSourceRadios(false)`:

```js
      disableLanguageCheckboxes(false);
      disableModelRadios(false);
      disableVoiceControls(false);
      disableInputSourceRadios(false);
```

In `restoreSessionState()` (around line 127, after `disableVoiceControls(true)`), add:

```js
      disableInputSourceRadios(true);
```

- [ ] **Step 5: Include `inputSource` in the `/api/start` body**

In the `startBtn` click handler's fetch call (around line 330), change the JSON body from:

```js
        body: JSON.stringify({ languages, provider, voiceConfig: getVoiceConfig() }),
```

to:

```js
        body: JSON.stringify({ languages, provider, voiceConfig: getVoiceConfig(), inputSource: getInputSource() }),
```

- [ ] **Step 6: Manual verification**

Run: `npm start`
Open `/admin`, log in.

Manual checks:
- Three radio buttons render under "Audio Input:" (USB selected by default)
- Hint text under the radios matches each option as you click through USB → Browser → System
- Click START (USB still works as before), confirm translation flows; verify all three radios are disabled while running
- Click STOP, verify radios re-enable
- Open browser devtools → Network → click START → confirm the `/api/start` request body contains `"inputSource":"usb"`

- [ ] **Step 7: Commit**

```bash
git add public/admin.html public/admin.css public/admin.js
git commit -m "$(cat <<'EOF'
feat: admin UI for input source selection

Adds USB/Browser/System radio group to the Audio Input section with
per-selection hint text. Radios are disabled during a running session
and the selected source is sent in the /api/start body. Capture logic
for browser/system sources lands in a follow-up task.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Implement browser-side capture flow

When source is Browser or System, the start button calls `getDisplayMedia`, sets up an AudioContext + AudioWorklet + WebSocket upload, and drives the level meter from a local AnalyserNode. Handles picker-cancel, missing-audio-track, "Stop sharing" click, and WS errors — each path tears down all browser-side resources in a defined order.

**Files:**
- Modify: `public/admin.js`

**Interfaces:**
- Consumes: `pcm-worklet.js` from Task 4, `/ws/admin-input` WS endpoint from Task 2
- Produces: browser-side capture state machine; no new global functions consumed by other tasks

- [ ] **Step 1: Add a module-level capture-state holder near the top of the IIFE**

In `public/admin.js`, after the `let pollInterval = null;` line (line 26), add:

```js
  let browserCapture = null;  // { stream, audioContext, sourceNode, workletNode, analyser, ws, analyserInterval }
```

- [ ] **Step 2: Add a teardown helper that releases every browser-side resource**

Place this near `startAudioLevel` / `stopAudioLevel` (around line 290).

**Important:** clear `browserCapture` *first*, before closing anything. The `ws.addEventListener('close', ...)` handler registered in Step 4 checks `if (!browserCapture) return;` to distinguish teardown-triggered closes from organic WS drops. Clearing first guarantees that check passes during teardown.

```js
  function teardownBrowserCapture() {
    if (!browserCapture) return;
    const cap = browserCapture;
    browserCapture = null;  // clear first so async event handlers bail out
    if (cap.analyserInterval) clearInterval(cap.analyserInterval);
    if (cap.ws) {
      try {
        cap.ws.onmessage = null;
        cap.ws.onclose = null;
        cap.ws.onerror = null;
        cap.ws.close();
      } catch {}
    }
    if (cap.stream) cap.stream.getTracks().forEach((t) => t.stop());
    if (cap.audioContext) {
      try { cap.audioContext.close(); } catch {}
    }
  }
```

- [ ] **Step 3: Add the browser-mode level meter driver**

Place after `stopAudioLevel`:

```js
  function startBrowserAudioLevel(analyser) {
    const buf = new Uint8Array(analyser.fftSize);
    browserCapture.analyserInterval = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const db = 20 * Math.log10(Math.max(rms, 1e-10));
      const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
      meterFill.style.width = pct + '%';
      levelDb.textContent = db.toFixed(0) + ' dB';
    }, 100);
  }

  function stopBrowserAudioLevel() {
    if (browserCapture && browserCapture.analyserInterval) {
      clearInterval(browserCapture.analyserInterval);
      browserCapture.analyserInterval = null;
    }
    meterFill.style.width = '0%';
    levelDb.textContent = '-- dB';
  }
```

- [ ] **Step 4: Add the setup function that performs getDisplayMedia + AudioContext + WS**

Place above `teardownBrowserCapture`:

```js
  async function setupBrowserCapture(inputSource) {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      systemAudio: 'include',
    });

    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      const msg = inputSource === 'system'
        ? 'No audio shared. In the picker, choose "Entire Screen" and tick "Share system audio".'
        : 'No audio shared. In the picker, choose a "Chrome Tab" and tick "Share tab audio".';
      throw new Error(msg);
    }

    const audioContext = new AudioContext({ sampleRate: 16000 });
    await audioContext.audioWorklet.addModule('/pcm-worklet.js');

    const sourceNode = audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioContext, 'pcm-capture', {
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    sourceNode.connect(workletNode);

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    sourceNode.connect(analyser);

    const ws = new WebSocket('/ws/admin-input?key=' + encodeURIComponent(adminKey));
    ws.binaryType = 'arraybuffer';

    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('Audio upload socket failed to open')), { once: true });
    });

    workletNode.port.onmessage = (e) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
    };

    // surface WS drops as a reconnectable state, not a hard error
    ws.addEventListener('close', () => {
      if (!browserCapture) return; // already torn down via stop
      statusEl.innerHTML = '<span class="status-dot" style="background:#ff6b6b"></span>Audio disconnected';
      reconnectBtn.classList.remove('hidden');
      stopBrowserAudioLevel();
    });

    // handle user clicking "Stop sharing" in the browser UI
    stream.getAudioTracks()[0].addEventListener('ended', async () => {
      if (!browserCapture) return;
      await authFetch('/api/stop', { method: 'POST' });
      handleSessionStopped();
    });

    browserCapture = { stream, audioContext, sourceNode, workletNode, analyser, ws, analyserInterval: null };
    startBrowserAudioLevel(analyser);
  }
```

- [ ] **Step 5: Extract the "session stopped" UI reset so both STOP button and track-ended can call it**

In the `stopBtn` click handler (lines 359-374), extract the existing UI-reset body into a named function so it can be called from both the stop button and the track-ended handler:

Replace the existing handler body with:

```js
  function handleSessionStopped() {
    setStatus('Ready', false);
    activeControls.classList.add('hidden');
    startBtn.classList.remove('hidden');
    startBtn.disabled = false;
    startBtn.textContent = 'START';
    teardownBrowserCapture();
    stopAudioLevel();
    stopBrowserAudioLevel();
    reconnectBtn.classList.add('hidden');
    stopPolling();
    statAttendees.textContent = '0';
    statTimer.textContent = '00:00:00';
    statCost.textContent = isFreeTier ? 'Free' : '$0.00';
    disableLanguageCheckboxes(false);
    disableModelRadios(false);
    disableVoiceControls(false);
    disableInputSourceRadios(false);
  }

  stopBtn.addEventListener('click', async () => {
    await authFetch('/api/stop', { method: 'POST' });
    handleSessionStopped();
  });
```

The existing `stopBtn.addEventListener('click', ...)` block (lines 359-374) should be **replaced** by the two pieces above (function definition + new listener). Make sure only one `stopBtn.addEventListener('click', ...)` remains.

- [ ] **Step 6: Branch the start-button click handler based on selected source**

Replace the existing `startBtn.addEventListener('click', ...)` handler (lines 315-349) with:

```js
  startBtn.addEventListener('click', async () => {
    const languages = getEnabledLanguages();
    if (languages.length === 0) {
      alert('Please select at least one language.');
      return;
    }
    const provider = getSelectedProvider();
    if (!provider) {
      alert('No translation model available. Check API keys.');
      return;
    }
    const inputSource = getInputSource();
    startBtn.disabled = true;
    startBtn.textContent = 'STARTING...';

    try {
      if (inputSource === 'browser' || inputSource === 'system') {
        try {
          await setupBrowserCapture(inputSource);
        } catch (err) {
          // picker cancelled, no audio track, or WS failed — restore start button, no toast spam
          teardownBrowserCapture();
          startBtn.disabled = false;
          startBtn.textContent = 'START';
          if (err && err.name !== 'NotAllowedError') alert(err.message || 'Audio capture failed');
          return;
        }
      }

      await authFetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ languages, provider, voiceConfig: getVoiceConfig(), inputSource }),
      });

      setStatus('Translating', true);
      startBtn.classList.add('hidden');
      activeControls.classList.remove('hidden');
      if (inputSource === 'usb') startAudioLevel();  // browser mode already started its own meter
      startPolling();
      disableLanguageCheckboxes(true);
      disableModelRadios(true);
      disableVoiceControls(true);
      disableInputSourceRadios(true);
    } catch (err) {
      teardownBrowserCapture();
      alert('Failed to start: ' + err.message);
      startBtn.disabled = false;
      startBtn.textContent = 'START';
    }
  });
```

- [ ] **Step 7: Manual end-to-end verification**

Run: `npm start`
Open `/admin`, log in.

**Browser mode happy path:**
- Select "Browser" radio
- Click START; in the OS picker choose a Chrome Tab playing a YouTube video, tick "Share tab audio", click Share
- Confirm: level meter moves in sync with video audio; translation flows on the attendee page; the admin does NOT hear the YouTube audio playing back through their own speakers (the AudioWorklet is not connected to `destination`)
- Click PAUSE → translation pauses; click RESUME (button reads PAUSE again) → translation resumes
- Click STOP → admin UI returns to Ready; the OS-level "Stop sharing" indicator goes away

**Error paths:**
- Browser mode → click START → cancel the OS picker → Start button restored, no alert
- Browser mode → click START → pick a tab WITHOUT ticking "Share tab audio" → alert with the actionable message; Start button restored; no resources held (verify in devtools that no AudioContext/MediaStream remains)
- Browser mode → START, then click Chrome's "Stop sharing" pill → admin UI returns to Ready on its own (no manual STOP needed)

**System mode happy path (Chrome on macOS):**
- Select "System" radio → click START → in picker choose "Entire Screen", tick "Share system audio", Share
- Play any audio file on the Mac; confirm level meter moves and translation flows

**USB mode regression check:**
- Select "USB" → START → speak into mic → confirm meter and translation work (no behavior change from before this task)

- [ ] **Step 8: Commit**

```bash
git add public/admin.js
git commit -m "$(cat <<'EOF'
feat: browser capture flow for Browser/System input sources

getDisplayMedia + AudioContext (forced 16 kHz) + AudioWorklet pipeline
that uploads 100 ms Int16 LE PCM chunks to /ws/admin-input. Level meter
driven by a local AnalyserNode in browser mode. Handles picker-cancel,
missing-audio-track, "Stop sharing" click, and WS close — each path
tears down MediaStream, AudioContext, and WS in a defined order.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: RECONNECT AUDIO button

When a browser-mode session is running but the WS is down (initially surfaced via `ws.onclose`, or after a page reload where the server remembers `inputSource: 'browser'` but the browser-side capture is gone), the admin needs a one-click way to re-share and reconnect without restarting the whole translation session. This task wires the RECONNECT button.

**Files:**
- Modify: `public/admin.js`

**Interfaces:**
- Consumes: `setupBrowserCapture` from Task 6 (reused — but must NOT call `/api/start`), `/api/status` from Task 3
- Produces: RECONNECT AUDIO button click handler; restore-on-reload shows the button when inputSource is browser/system and no `browserCapture` is active

- [ ] **Step 1: Add the reconnect click handler**

In `public/admin.js`, after the `stopBtn.addEventListener` block (the new one created in Task 6), add:

```js
  reconnectBtn.addEventListener('click', async () => {
    if (browserCapture) return; // already connected — button shouldn't be visible
    reconnectBtn.disabled = true;
    reconnectBtn.textContent = 'CONNECTING...';
    try {
      const inputSource = getInputSource();
      await setupBrowserCapture(inputSource);
      setStatus('Translating', true);
      reconnectBtn.classList.add('hidden');
      reconnectBtn.disabled = false;
      reconnectBtn.textContent = 'RECONNECT AUDIO';
    } catch (err) {
      teardownBrowserCapture();
      reconnectBtn.disabled = false;
      reconnectBtn.textContent = 'RECONNECT AUDIO';
      if (err && err.name !== 'NotAllowedError') alert(err.message || 'Reconnect failed');
    }
  });
```

Note: `setupBrowserCapture` does not call `/api/start` — it only opens the MediaStream, AudioContext, and WS. The translation session is already running server-side.

- [ ] **Step 2: Surface the reconnect button on page reload when inputSource is browser/system**

In `restoreSessionState()` (around line 96-131), extend the running-session branch to handle browser/system sources. After the existing `disableInputSourceRadios(true);` line added in Task 5, add:

```js
      // restore the source radio to match the running session
      if (data.inputSource) {
        const radios = sourceRadios.querySelectorAll('input[type="radio"]');
        radios.forEach((r) => { r.checked = r.value === data.inputSource; });
        updateSourceHint();
      }

      // browser/system sources lost their WS on reload — show RECONNECT so the admin can restore audio
      if (data.inputSource === 'browser' || data.inputSource === 'system') {
        reconnectBtn.classList.remove('hidden');
        // meter stays at -- dB until reconnect succeeds
      } else {
        startAudioLevel();  // USB mode — meter driven by SSE as today
      }
```

Important: the existing `startAudioLevel();` line in `restoreSessionState` should be **replaced** by the conditional block above (so USB uses SSE, browser/system doesn't subscribe to SSE).

- [ ] **Step 3: Hide the reconnect button when the session stops**

The `handleSessionStopped` function from Task 6 already calls `reconnectBtn.classList.add('hidden');`. No additional change needed — verify this line is present.

- [ ] **Step 4: Manual verification**

Run: `npm start`

**Reload test (primary scenario):**
- Open `/admin`, log in, select "Browser", START, pick a YouTube tab with tab audio
- Confirm translation flows
- **Refresh the admin page**
- Expected: session shows running (status "Translating"), Browser radio is selected, level meter shows `-- dB`, **RECONNECT AUDIO button is visible**
- Click RECONNECT AUDIO → picker appears → pick the YouTube tab with tab audio again
- Expected: level meter moves, translation resumes flowing

**Mid-session WS drop test:**
- Start a browser-mode session
- Open devtools → Network → find the `/ws/admin-input` connection → block it (or use the Network throttling → "Offline" briefly)
- Expected: status shows "Audio disconnected" in red; RECONNECT AUDIO button appears
- Unblocking doesn't auto-recover — click RECONNECT AUDIO → audio flows again

**USB regression check:**
- Start a USB session, refresh the page
- Expected: session shows running, USB radio selected, meter shows live dB from SSE, **RECONNECT AUDIO button is NOT visible**

- [ ] **Step 5: Commit**

```bash
git add public/admin.js
git commit -m "$(cat <<'EOF'
feat: RECONNECT AUDIO button for browser/system sessions

Surfaces a reconnect affordance when a browser-mode session is running
but the upload WS is down (page reload, WS drop). Reuses setupBrowserCapture
without re-calling /api/start — the session is already running server-side.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Update README

Documentation: cross-platform note (USB stays macOS-only; Browser/System works anywhere) and browser support (Chrome/Edge recommended, Firefox tab-only, Safari not v1).

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Hardware Setup section to mention browser/system alternatives**

In `README.md`, after the existing "Hardware Setup" section (lines 6-18) and before "Supported Languages", add a new subsection:

```markdown
## Audio Input Sources

The admin panel can capture audio from three sources (selectable on the admin page):

| Source | What it captures | Platform |
|--------|------------------|----------|
| **USB** (default) | The UCA222 / USB interface via `sox` + CoreAudio — the production booth setup | macOS only |
| **Browser** | Audio playing in a browser tab (e.g. a YouTube sermon). The admin clicks START, then picks a Chrome Tab in the picker and ticks "Share tab audio" | Any OS, Chrome/Edge |
| **System** | Full macOS audio loopback — any app's output. The admin clicks START, then picks Entire Screen and ticks "Share system audio" | Chrome/Edge on macOS |

USB is the production source. Browser and System are intended for quick testing with pre-recorded content and for demos without the booth hardware.

**Browser support for Browser/System modes:**
- Chrome / Edge: fully supported
- Firefox: tab audio works; system audio not supported
- Safari: not supported in v1
```

- [ ] **Step 2: Soften the macOS requirement in the Setup section**

In the "### Prerequisites" section (around line 47), change the macOS line from:

```
- macOS (for CoreAudio capture)
```

to:

```
- macOS (required for USB source; Browser/System sources work on any OS)
```

- [ ] **Step 3: Add a row about input source to the Usage section**

In the "## Usage (Sunday Service)" section, between step 4 ("Select provider...") and step 5 ("Click START..."), insert:

```
4b. Pick the audio input source (USB / Browser / System) — defaults to USB for live services
```

- [ ] **Step 4: Manual verification**

Run: `cat README.md | grep -A 2 "Audio Input Sources"`
Expected: the new section header and table render as expected.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: document input source selector and browser support

Adds Audio Input Sources section covering USB/Browser/System modes,
their platform requirements, and browser compatibility. Softens the
macOS requirement note to scope it to the USB source.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist Results

**Spec coverage:**
- Section "Architecture / Common contract" → Task 1 establishes the renamed `UsbAudioSource` pattern; Task 2 mirrors it for `BrowserAudioSource`
- Section "Server-side changes" → Task 3 wires source selection, `/api/start` validation, `/api/status` field
- Section "Browser-side capture / getDisplayMedia" → Task 6
- Section "Browser-side capture / Resampling" → Task 4 (worklet) + Task 6 (AudioContext at 16 kHz)
- Section "Browser-side capture / WebSocket upload" → Task 6
- Section "Browser-side capture / Level meter — local AnalyserNode" → Task 6
- Section "Browser-side capture / Edge cases" → Task 6 step 4 (track-ended) + step 6 (picker-cancel, missing-audio-track) + WS-close in step 4
- Section "Admin UI / Layout, State rules, Hint copy, RECONNECT AUDIO" → Task 5 + Task 7
- Section "Error handling — consolidated" → covered across Tasks 2, 3, 6
- Section "Testing" manual matrix → called out as manual verification steps in Tasks 1, 3, 5, 6, 7
- Section "Browser support" → Task 8

**Type/name consistency check:**
- `UsbAudioSource` — used in Tasks 1, 3
- `BrowserAudioSource` — used in Tasks 2, 3 (constructor `(server, ADMIN_PASSWORD)`)
- `getInputSource()` / `disableInputSourceRadios()` / `renderSourceRadios()` / `updateSourceHint()` / `setupBrowserCapture()` / `teardownBrowserCapture()` / `handleSessionStopped()` / `startBrowserAudioLevel()` / `stopBrowserAudioLevel()` — all defined in the task where they're introduced and called by name only where defined
- `browserCapture` holder shape: `{ stream, audioContext, sourceNode, workletNode, analyser, ws, analyserInterval }` — defined in Task 6 Step 1, accessed consistently in Steps 3, 4, 6 and Task 7
- DOM IDs: `source-radios`, `source-hint`, `reconnect-btn` — introduced in Task 5 Step 1, used in Tasks 5/6/7
- WS path `/ws/admin-input` — used consistently in Tasks 2, 6, 7
- `activeSource` / `activeInputSource` / `createSource()` — introduced in Task 3 Step 1, used consistently in Steps 2-4

**No placeholders detected.** Every step has either a code block, a command, or a concrete manual check.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-19-input-source-selector.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
