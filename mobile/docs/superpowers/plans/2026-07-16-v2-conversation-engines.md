# v2 Plan 4 — Conversation Engines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the framework-agnostic TypeScript engines that power the v2 conversation page — `SocketClient` (WS + reconnect), `PlaybackEngine` (24 kHz gapless audio), `MicCaptureEngine` (mic + AudioWorklet) — so Plan 5 (the React UI) can compose them via a `useConversation` hook.

**Architecture:** Three plain-TS classes in `web/src/engines/` (no React imports). Browser APIs (WebSocket, AudioContext, getUserMedia) are passed via **injectable constructors** so SocketClient + the PlaybackEngine scheduler are unit-testable in vitest with fakes; mic capture is browser-only (manual). `@v2/shared` message types via `import type`. v1 untouched; no new dependencies (native browser APIs only).

**Tech Stack:** TypeScript 5.6+ (strict), Vite/Vitest (web workspace), ESM. Native browser WebSocket / AudioContext / AudioWorklet / getUserMedia.

## Global Constraints

- **Do not touch v1** (`src/`, `public/`, v1 `test/`, root scripts). Engines live in `web/src/engines/`.
- **Framework-agnostic:** the three engine files import NO React. Plain TS classes (the `useConversation` hook that uses them is Plan 5).
- **Injectable browser APIs for testing:** `SocketClient` takes a `WebSocketCtor` (default native `WebSocket`); `PlaybackEngine` takes an `AudioContextCtor` (default native `AudioContext`). Tests inject fakes + `vi.useFakeTimers()` for reconnect backoff. `MicCaptureEngine` is manual (real getUserMedia + worklet).
- **`@v2/shared` via `import type` only** (`ConversationWsMessage`) — erased at build.
- **TypeScript strict**, no `any` without a `// reason`.
- **No new dependencies** — native browser APIs only. No `npm install` in this plan.
- **Each task ends verifiable:** typecheck exit 0, vitest pass (SocketClient/PlaybackEngine), or a documented manual check (MicCaptureEngine).

## Scope flags
- Engines only. The React UI (`useConversation` hook + components + page) is **Plan 5**.
- The engines target the conversation page; the church attendee/player will reuse `PlaybackEngine` later (Plan 5+) — design it clean enough for that, but don't build church-specific code now.

---

## File Structure

```
web/src/engines/
├── socket-client.ts          (NEW — WS client + reconnect)
├── socket-client.test.ts     (NEW — TDD)
├── playback-engine.ts        (NEW — 24kHz gapless playback)
├── playback-engine.test.ts   (NEW — TDD, scheduling logic)
├── mic-capture-engine.ts     (NEW — getUserMedia + worklet; manual)
└── index.ts                  (NEW — barrel re-export)
web/public/
└── pcm-worklet.js            (NEW — copy of v1 public/pcm-worklet.js, so Vite serves it)
```

---

## Task 1: SocketClient

**Files:**
- Create: `web/src/engines/socket-client.ts`, `web/src/engines/socket-client.test.ts`

**Interfaces:**
- Produces: `class SocketClient { constructor(opts: { url: string; onMessage: (m: ConversationWsMessage) => void; onCloseTerminal?: () => void; WebSocketCtor?: typeof WebSocket; reconnectBaseDelay?: number }); connect(): void; sendAudio(pcm: ArrayBuffer): void; close(): void }`. Reconnects with exponential backoff on transient close; stops (and fires `onCloseTerminal`) on close code 1008 or `close()`.

- [ ] **Step 1: Write the failing test** `web/src/engines/socket-client.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SocketClient } from './socket-client.js';

// Minimal fake WebSocket
function fakeWs() {
  const ws: any = { readyState: 1, sent: [] as any[], listeners: {} as Record<string, Function[]>,
    send(m: any) { this.sent.push(m); }, close() { this.listeners['close']?.forEach((f) => f({ code: 1000 })); },
    on(ev: string, fn: Function) { (this.listeners[ev] ??= []).push(fn); } };
  return ws;
}

describe('SocketClient', () => {
  beforeEach(() => vi.useFakeTimers());
  it('dispatches JSON messages to onMessage', () => {
    const msgs: any[] = [];
    let ws: any;
    const c = new SocketClient({ url: 'wss://x', onMessage: (m) => msgs.push(m), WebSocketCtor: (() => { return ws = fakeWs(); }) as any });
    c.connect();
    ws.listeners['open'][0]();
    ws.listeners['message'][0]({ data: JSON.stringify({ type: 'status', state: 'listening', host: true, joiner: true }) });
    expect(msgs[0]).toEqual({ type: 'status', state: 'listening', host: true, joiner: true });
  });
  it('reconnects with backoff on a transient close (not 1008)', () => {
    const factory = vi.fn(() => fakeWs());
    const c = new SocketClient({ url: 'wss://x', onMessage: () => {}, WebSocketCtor: factory as any, reconnectBaseDelay: 1000 });
    c.connect();
    const first = factory.mock.results[0].value;
    first.listeners['open'][0]();
    first.listeners['close'][0]({ code: 1006 });      // transient
    expect(factory).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(999); expect(factory).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);   expect(factory).toHaveBeenCalledTimes(2);  // reconnected after 1000ms
  });
  it('stops + fires onCloseTerminal on 1008 (no reconnect)', () => {
    const factory = vi.fn(() => fakeWs());
    let terminal = false;
    const c = new SocketClient({ url: 'wss://x', onMessage: () => {}, onCloseTerminal: () => { terminal = true; }, WebSocketCtor: factory as any });
    c.connect();
    const first = factory.mock.results[0].value;
    first.listeners['close'][0]({ code: 1008 });
    vi.advanceTimersByTime(60000);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(terminal).toBe(true);
  });
  it('sendAudio sends binary when open', () => {
    let ws: any;
    const c = new SocketClient({ url: 'wss://x', onMessage: () => {}, WebSocketCtor: (() => { return ws = fakeWs(); }) as any });
    c.connect(); ws.listeners['open'][0]();
    c.sendAudio(new ArrayBuffer(8));
    expect(ws.sent[0]).toBeInstanceOf(ArrayBuffer);
  });
});
```
- [ ] **Step 2: Run → fail** (`npm -w web test` → `Cannot find module './socket-client.js'`).
- [ ] **Step 3: Implement** `web/src/engines/socket-client.ts`: a class matching the interface. Hold the current ws in a field; `connect()` constructs via `WebSocketCtor`, wires `open`/`message` (JSON.parse → `onMessage`, wrap in try/catch) / `close` (if `code === 1008` or `this._closed` → `onCloseTerminal?.()` + no reconnect; else schedule reconnect via `setTimeout(delay)` with exponential backoff `min(60000, base * 2**(attempts-1))`, reset attempts on open) / `error`. `sendAudio(pcm)` sends the ArrayBuffer when readyState===OPEN. `close()` sets `_closed=true` and closes the ws (no reconnect). `import type { ConversationWsMessage } from '@v2/shared'` for the message type.
- [ ] **Step 4: Run → pass** (`npm -w web run typecheck` exit 0; `npm -w web test` → 4 socket tests pass + existing App test).
- [ ] **Step 5: Commit** — `feat(v2): SocketClient (WS + reconnect backoff)`.

---

## Task 2: PlaybackEngine

**Files:**
- Create: `web/src/engines/playback-engine.ts`, `web/src/engines/playback-engine.test.ts`

**Interfaces:**
- Produces: `class PlaybackEngine { constructor(opts?: { AudioContextCtor?: typeof AudioContext; sampleRate?: number }); async ensureContext(): Promise<AudioContext>; queueAudio(base64: string): void; stopAll(): void; setVolume(v: number): void; close(): void }`. 24 kHz gapless scheduling (port of v1 `attendee.js` `queueAudio`/`stopAllAudio`).

- [ ] **Step 1: Write the failing test** `web/src/engines/playback-engine.test.ts` (inject a fake AudioContext):
```ts
import { describe, it, expect } from 'vitest';
import { PlaybackEngine } from './playback-engine.js';

function fakeCtx() {
  let t = 100;
  const sources: any[] = [];
  const ctx: any = { state: 'running', get currentTime() { return t; },
    createBuffer(_ch: number, len: number, _sr: number) { return { length: len, duration: len / 24000, getChannelData: () => new Float32Array(len) }; },
    createBufferSource() { const s: any = { startedAt: null, connect() {}, start(when: number) { this.startedAt = when; }, stop() { s._stopped = true; } }; sources.push(s); return s; },
    createGain() { return { gain: { value: 1 }, connect() {} }; }, resume() { return Promise.resolve(); }, close() {} };
  return { ctx, sources, advance(sec: number) { t += sec; } };
}

describe('PlaybackEngine', () => {
  it('schedules chunks gaplessly and stops all', async () => {
    const { ctx, sources, advance } = fakeCtx();
    const eng = new PlaybackEngine({ AudioContextCtor: (() => ctx) as any, sampleRate: 24000 });
    await eng.ensureContext();
    // base64 of 4800 bytes (=2400 samples =0.1s @24kHz) of zeros
    const b64 = btoa(String.fromCharCode(...new Uint8Array(4800)));
    eng.queueAudio(b64);        // 0.1s chunk
    eng.queueAudio(b64);        // next, gapless
    expect(sources[0].startedAt).toBe(100);
    expect(sources[1].startedAt).toBeCloseTo(100.1, 5);   // scheduled after first
    eng.stopAll();
    expect(sources.every((s) => s._stopped)).toBe(true);
  });
});
```
- [ ] **Step 2: Run → fail** (module not found).
- [ ] **Step 3: Implement** `web/src/engines/playback-engine.ts` — port v1 `queueAudio`/`stopAllAudio` (decode base64→Int16→Float32 via `atob`, create buffer at `sampleRate` (24000), gapless `nextPlayTime` scheduling, `activeSources` cleanup on `onended`, `stopAll` stops + resets `nextPlayTime`). `ensureContext()` lazily creates the AudioContext via `AudioContextCtor` + resumes (call on a user gesture from Plan 5). `setVolume` sets gain. `close()` closes the context. Guard `queueAudio` if context suspended (resume + skip, like v1).
- [ ] **Step 4: Run → pass** (typecheck exit 0; the gapless-scheduling test passes + existing tests).
- [ ] **Step 5: Commit** — `feat(v2): PlaybackEngine (24kHz gapless)`.

---

## Task 3: MicCaptureEngine + copy pcm-worklet

**Files:**
- Create: `web/src/engines/mic-capture-engine.ts`
- Create: `web/public/pcm-worklet.js` (copy of `public/pcm-worklet.js`)

**Interfaces:**
- Produces: `class MicCaptureEngine { constructor(opts: { workletUrl: string; onAudio: (pcm: ArrayBuffer) => void }); async start(deviceId?: string): Promise<void>; async setDevice(deviceId: string): Promise<void>; async stop(): Promise<void>; async listDevices(): Promise<MediaDeviceInfo[]> }`. 16 kHz capture via `pcm-capture` AudioWorklet; binary chunks → `onAudio`.

- [ ] **Step 1: Copy the worklet** — `cp public/pcm-worklet.js web/public/pcm-worklet.js` (Vite serves `web/public/`, so the engine loads `/pcm-worklet.js`). Verify byte-identical.
- [ ] **Step 2: Implement** `web/src/engines/mic-capture-engine.ts` — port the mic-capture pattern from v1 `public/conversation.js` `startMicCapture` (and `admin.js` `setupBrowserCapture`): `getUserMedia({ audio: { deviceId, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })`, `new AudioContext({ sampleRate: 16000 })`, `audioWorklet.addModule(workletUrl)`, `AudioWorkletNode(ctx, 'pcm-capture', { channelCount: 1, channelCountMode: 'explicit' })`, source→worklet, worklet `port.onmessage` → `onAudio(e.data)`. `setDevice` stops old tracks + restarts with new deviceId. `stop()` stops tracks + closes ctx. `listDevices()` → `navigator.mediaDevices.enumerateDevices()` filtered to audioinput. (No automated test — browser APIs. Add a `// @vitest-environment node`-skipped note or no test file.)
- [ ] **Step 3: typecheck** `npm -w web run typecheck` → exit 0 (the engine references browser globals `AudioContext`, `navigator`, `AudioWorkletNode` — ensure `web/tsconfig.json` lib includes DOM, which it does).
- [ ] **Step 4: Manual note** — document in the report that mic capture is manual-verified in Plan 5 (needs a real browser + permission). No vitest for this engine.
- [ ] **Step 5: Commit** — `feat(v2): MicCaptureEngine + web pcm-worklet`.

---

## Task 4: engines barrel + integration

**Files:**
- Create: `web/src/engines/index.ts`
- Modify: (none beyond the barrel)

- [ ] **Step 1: Barrel** — `web/src/engines/index.ts`:
```ts
export { SocketClient } from './socket-client.js';
export type { SocketClientOptions } from './socket-client.js';
export { PlaybackEngine } from './playback-engine.js';
export type { PlaybackEngineOptions } from './playback-engine.js';
export { MicCaptureEngine } from './mic-capture-engine.js';
export type { MicCaptureEngineOptions } from './mic-capture-engine.js';
```
(Export the option interfaces from each engine file.)
- [ ] **Step 2: typecheck + test** → `npm -w web run typecheck` exit 0; `npm -w web test` → SocketClient (4) + PlaybackEngine (1) + App (1) all pass.
- [ ] **Step 3: Commit** — `feat(v2): engines barrel`.

---

## Task 5: verify + v1-untouched

- [ ] **Step 1:** `npm -w web run typecheck` → exit 0. `npm -w web test` → all green. `npm -w web run build` → succeeds (the engines compile into the bundle; `@v2/shared` import type erased — confirm `grep '@v2/shared' web/dist` is empty or only in the shared types, no runtime).
- [ ] **Step 2:** `npm test` (v1 green); `git diff --stat main -- src/ public/ test/` → empty (v1 untouched). Confirm `web/public/pcm-worklet.js` is the only `public/`-adjacent addition (under `web/`, not v1 `public/`).
- [ ] **Step 3:** commit any backfill; final `git log --oneline main..HEAD`.

---

## Self-Review

**Spec coverage:** the three engines from the design spec's technical section (SocketClient, PlaybackEngine, MicCaptureEngine) across Tasks 1-3; barrel + verify (Tasks 4-5). Injectable deps for testing (SocketClient's WebSocketCtor, PlaybackEngine's AudioContextCtor). MicCaptureEngine is manual (browser APIs) — explicitly noted. `pcm-worklet.js` copied to `web/public/` for Vite. The React `useConversation` hook + components are explicitly Plan 5.

**Placeholder scan:** the SocketClient + PlaybackEngine tests contain full fake-WS / fake-AudioContext code + real assertions (dispatch, backoff, 1008-terminal, gapless scheduling, stopAll). MicCaptureEngine is a manual task with the exact API + the v1 source pattern to port (not a placeholder — the pattern is specified). No TBDs.

**Type consistency:** `SocketClient`/`PlaybackEngine`/`MicCaptureEngine` export names + their `Options` interfaces match the barrel (Task 4). The WS message type is `ConversationWsMessage` from `@v2/shared` (Task 2 of Plan 1). The worklet name is `pcm-capture` (matches v1 `public/pcm-worklet.js`).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-16-v2-conversation-engines.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, reviewed between tasks.
**2. Inline Execution** — in this session with checkpoints.

**Which approach?**

After Plan 4 lands, **Plan 5** builds the React UI (`useConversation` hook + onboarding/river/sheet/states + i18n + the `/conversation` page) on top of these engines — the first visible v2 surface.
