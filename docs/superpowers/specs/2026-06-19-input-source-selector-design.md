# Input Source Selector — Design

**Date:** 2026-06-19
**Status:** Approved (pending user review)
**Scope:** Admin-only feature; no attendee or interpreter changes

## Purpose

Let the admin pick where translation audio comes from. Three sources:

1. **USB interface** (default, today's behavior) — captures from the UCA222 via `sox -t coreaudio`
2. **Browser** — audio playing in a specific browser tab (e.g. a YouTube tab being shared)
3. **System** — full macOS audio loopback (any app's output)

Primary use cases are quick testing with pre-recorded YouTube sermons and demoing the app without the booth hardware. Production service stays on USB.

## Architecture

### Common contract

Both source implementations conform to the same shape so downstream code is agnostic to the source:

```
AudioSource extends EventEmitter
  start()
  stop()
  pause()
  resume()
  emits 'chunk'  → Buffer<100ms PCM, 16kHz, mono, Int16 LE>
  emits 'started' | 'stopped' | 'paused' | 'resumed' | 'error'
```

`SessionManager.sendAudio(chunk)` and the `/api/audio-level` SSE tap subscribe to `chunk` events uniformly. No source-specific branching downstream.

### Implementations

| Class | File | Audio source |
|-------|------|-------------|
| `UsbAudioSource` | `src/usb-audio-source.js` (renamed from `src/audio-capture.js`) | `sox -t coreaudio` subprocess |
| `BrowserAudioSource` | `src/browser-audio-source.js` (new) | WebSocket receiver on `/ws/admin-input` |

`UsbAudioSource` is today's `AudioCapture` body verbatim under a new name. `BrowserAudioSource` is a small EventEmitter that owns a `WebSocketServer`, verifies the admin key on the handshake, and re-emits each binary frame as a `chunk` event.

### Server wiring

`src/server.js` changes:

- Replace `const audioCapture = new AudioCapture()` with a per-session `let activeSource = null`
- In `/api/start`, instantiate based on `req.body.inputSource`:
  - `'usb'` (default) → `new UsbAudioSource()`
  - `'browser'` or `'system'` → `new BrowserAudioSource(server, ADMIN_PASSWORD)`
  - Other values → 400
- Wire `activeSource.on('chunk', chunk => sessionManager.sendAudio(chunk))` and the audio-level SSE handler
- In `/api/pause|resume|stop`, delegate to `activeSource`
- "Browser" and "System" both produce a `BrowserAudioSource` — the distinction lives entirely in the admin UI's picker hint. The OS-level picker decides whether tab audio or system audio flows in.

### Data flow

**USB mode** (unchanged from today):

```
sox coreaudio → UsbAudioSource --chunk--> SessionManager → Gemini/Qwen → broadcaster → attendees
                                          ↓
                                   /api/audio-level SSE → admin meter
```

**Browser/System mode:**

```
admin browser:
  getDisplayMedia({video:true, audio:true})
    → AudioContext({sampleRate: 16000})
    → MediaStreamAudioSourceNode → AudioWorkletNode (Float32 → Int16 LE, 100ms chunks)
    → WebSocket /ws/admin-input (binary frames)

admin browser (level meter):
  MediaStreamAudioSourceNode → AnalyserNode → local dB computation → DOM

server:
  BrowserAudioSource --chunk--> SessionManager → Gemini/Qwen → broadcaster → attendees
                  (same downstream path as USB; /api/audio-level SSE unused)
```

In browser/system mode the admin UI computes dB locally from an `AnalyserNode` and never subscribes to `/api/audio-level`. Round-tripping through the server would add latency for no benefit since the browser already holds the raw stream.

## Server-side changes

### Files

| File | Change |
|------|--------|
| `src/audio-capture.js` → `src/usb-audio-source.js` | Rename class `AudioCapture` → `UsbAudioSource`; body identical |
| `src/browser-audio-source.js` (new) | WS receiver + auth + re-emit chunks |
| `src/server.js` | Per-session source; add WS route; extend `/api/start` body and `/api/status` response |
| `package.json` | No new dependencies (`ws` already present) |

### `BrowserAudioSource` API

```js
export class BrowserAudioSource extends EventEmitter {
  constructor(server, adminPassword) { ... }
  start()      // attach WebSocketServer({ server, path: '/ws/admin-input' })
  stop()       // close active WS + wss; emit 'stopped'
  pause()      // set suppress flag; emit 'paused'
  resume()     // clear suppress flag; emit 'resumed'
  // ws 'connection': verify ?key=ADMIN_PASSWORD; reject with code 1008 on failure
  // ws 'message' (binary): if !suppressed → emit('chunk', Buffer.from(msg))
  // rejects second concurrent connection with code 1008
}
```

### API contract changes

**`POST /api/start`** body gains an optional field:

```json
{
  "languages": ["zh-Hans", "ko"],
  "provider": "gemini",
  "voiceConfig": {...},
  "inputSource": "usb" | "browser" | "system"
}
```

Default: `"usb"`. Unknown values → HTTP 400.

**`GET /api/status`** response gains `inputSource: string | null` (null when no session is running).

**`WS /ws/admin-input?key=<password>`** accepts only binary frames. Each frame payload is forwarded as a `chunk`. Server does not enforce frame size; the admin enforces 100ms = 3200 bytes on its side.

### Lifecycle (browser mode)

| Action | Behavior |
|--------|---------|
| `POST /api/start` with `inputSource=browser\|system` | Create `BrowserAudioSource`, call `start()`, return 200. Server does not wait for the browser WS to connect. |
| Admin browser opens WS | `BrowserAudioSource` accepts and begins re-emitting chunks |
| `POST /api/pause` | `BrowserAudioSource.pause()` sets suppress flag; chunks dropped server-side (matches USB's "no data flows while paused" semantics). `SessionManager` also double-guards via its own `isPaused`. |
| `POST /api/resume` | Clear suppress flag |
| `POST /api/stop` | Close WS, stop source, tear down |

### Auth

WS handshake validates `?key=` against `ADMIN_PASSWORD`. Failure → close with code 1008 before accepting. Same model as the existing admin SSE endpoints.

### Concurrency

Only one admin-input WS accepted per session. Second connection rejected with code 1008 + error message. Prevents stray tabs doubling the audio.

### Cross-platform note

USB mode stays macOS-only (`sox` + CoreAudio). Browser/System mode works on any OS because the browser handles capture. README's "macOS required" note becomes "macOS required for USB source; any OS for Browser/System source."

## Browser-side capture

### Files

| File | Purpose |
|------|---------|
| `public/pcm-worklet.js` (new) | AudioWorklet processor — Float32 → Int16 LE, accumulates 100ms (3200-byte) chunks, posts each via `port` |
| `public/admin.html` | Extend "Audio Input" section with source radios + hint text |
| `public/admin.js` | Source selection, browser capture flow, meter driver switch, RECONNECT AUDIO button |
| `public/admin.css` | Reuse `.model-radios` / `.model-radio`; one new class for hint text; one for RECONNECT button |

### `getDisplayMedia` call

```js
const stream = await navigator.mediaDevices.getDisplayMedia({
  video: true,                              // required — Chrome shares system audio only with video
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,                 // raw playback, not mic-processed audio
  },
  systemAudio: 'include',                   // Chrome-only; allows "Share system audio" pick
});
```

After the call: **require** at least one audio track. If `stream.getAudioTracks().length === 0`, abort with a clear message instructing the user which checkbox to tick in the picker. This is the most common user error.

### Resampling to 16kHz mono Int16

Force the AudioContext to 16kHz — Chrome/Firefox resample internally:

```js
const audioContext = new AudioContext({ sampleRate: 16000 });
await audioContext.audioWorklet.addModule('/pcm-worklet.js');

const sourceNode = audioContext.createMediaStreamSource(stream);
const workletNode = new AudioWorkletNode(audioContext, 'pcm-capture', {
  channelCount: 1,
  channelCountMode: 'explicit',             // browser downmixes stereo → mono
});
sourceNode.connect(workletNode);
// NOT connected to audioContext.destination — no playback
```

Inside `pcm-worklet.js` the processor receives Float32 samples at 16kHz, converts to Int16 LE, accumulates into 3200-byte (100ms) buffers, and `port.postMessage(buffer, [buffer])` transfers each chunk out without copy.

### WebSocket upload

```js
const ws = new WebSocket('/ws/admin-input?key=' + encodeURIComponent(adminKey));
ws.binaryType = 'arraybuffer';
workletNode.port.onmessage = (e) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
};
```

16kHz Int16 mono = 32 KB/s — well within LAN WiFi capacity. Not handling flow control in v1.

### Level meter — local AnalyserNode

```js
const analyser = audioContext.createAnalyser();
analyser.fftSize = 1024;
sourceNode.connect(analyser);               // parallel branch off the source

setInterval(() => {
  const buf = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(buf);
  // RMS → dB → update #level-meter width + #level-db text
}, 100);
```

Same visual presentation as today; different driver. `/api/audio-level` SSE unused in this mode.

### Lifecycle in `admin.js` start button

```
if inputSource === 'usb':
  existing flow (POST /api/start, subscribe to /api/audio-level SSE)
else:
  stream = await getDisplayMedia(...)
  if no audio tracks: abort with actionable error, restore Start button
  setup audioContext, sourceNode, workletNode, analyser
  open WS to /ws/admin-input
  POST /api/start { inputSource, ... }
  on success: hide Start, show Pause/Stop, start local meter
  on failure: tear down browser-side (stop tracks, close WS, close audioContext), restore Start

pauseBtn:  POST /api/pause  (server drops chunks; browser keeps streaming)
resumeBtn: POST /api/resume
stopBtn:   POST /api/stop, then stop tracks, close WS, close audioContext
```

### Edge cases

| Case | Behavior |
|------|---------|
| User cancels picker | `getDisplayMedia` rejects with `NotAllowedError` → catch, restore Start button, no error toast |
| Picker succeeds, no audio track | Abort with clear message naming the checkbox to tick |
| User clicks browser's "Stop sharing" mid-session | Track `ended` event → run STOP flow, clean up |
| WS disconnects mid-session | Show error in status; session still running server-side; admin can RECONNECT AUDIO or STOP |
| Admin tab closed/refreshed mid-session | Server keeps running; on reload, RECONNECT AUDIO button appears (see Admin UI section) |
| Second admin tab tries to connect WS | Server rejects with code 1008; first tab unaffected |

Guiding principle: **never leave browser-side resources dangling**. Every error path stops `stream`, closes `ws`, and closes `audioContext` in that order.

## Admin UI

### Layout

Extend the existing "Audio Input" section (`admin.html:52-58`) rather than adding a new one — source and its meter belong together:

```
Audio Input:
  [● USB]   [○ Browser]   [○ System]

  Hint text (hidden for USB; varies for Browser/System)

  [█████████░░░░░░░░░░░] -23 dB
   (level meter, unchanged visually; fed from different drivers)
```

### State rules

| State | Behavior |
|-------|---------|
| Page load, no session | USB selected by default; meter shows `-- dB` (no SSE subscription yet) |
| Session running, USB | All 3 radios disabled; meter fed by `/api/audio-level` SSE (today's behavior) |
| Session running, Browser/System | All 3 radios disabled; meter fed by local AnalyserNode; RECONNECT AUDIO button shown if WS not connected |
| Session stopped | Radios re-enabled; meter reset to `-- dB` |

### Hint copy

- **USB** (default): no hint, or muted line "Captures from the USB device via sox."
- **Browser**: *"Click START, then in the picker choose a Chrome Tab and tick Share tab audio."*
- **System**: *"Click START, then in the picker choose Entire Screen and tick Share system audio."*

### RECONNECT AUDIO button

Shown only when the session is running in Browser/System mode **and** the WS is not currently connected. Clicking it triggers `getDisplayMedia` again and opens a fresh WS — no `/api/start` call (the session is already running server-side). Solves the page-reload case and any mid-session WS drop.

### CSS

Reuse `.model-radios` / `.model-radio` classes for the source radios (visually matches the Translation Model row). Add two new classes: hint text (small, gray, italic) and RECONNECT button (small, warning-colored).

## Error handling — consolidated

| Source | Failure mode | Detection | Recovery |
|--------|-------------|-----------|----------|
| USB | sox exits non-zero | `_soxProc.on('close')` code≠0 | Existing `error` event; session start fails |
| USB | wrong device name | sox exits immediately | Same as above |
| Browser/System | user cancels picker | `getDisplayMedia` rejects (`NotAllowedError`) | Catch, restore Start button, no toast |
| Browser/System | picker succeeds, no audio track | `stream.getAudioTracks().length === 0` | Abort with actionable message |
| Browser/System | user clicks "Stop sharing" | track `ended` event | Auto-trigger STOP flow; clean up tracks/WS/AudioContext |
| Browser/System | WS fails to connect | `ws.onerror` / `ws.onclose` before open | Show error; surface RECONNECT button |
| Browser/System | admin tab refreshed mid-session | n/a — server keeps running | RECONNECT AUDIO button on reload |
| Browser/System | second WS connects | Server-side reject (code 1008) | Second tab sees error; first unaffected |
| Any | `/api/start` fails after browser-side setup | fetch rejects | Tear down browser-side, restore Start button |

## Testing

No automated test framework in the project today. Manual matrix:

| # | Scenario | Pass criteria |
|---|----------|---------------|
| 1 | USB mode start → speak → stop | Translation appears in attendee view; meter moves |
| 2 | Browser mode → share YouTube tab with tab audio → play | Translation appears; meter moves; no audio echoes back to admin speakers |
| 3 | System mode → share entire screen with system audio → play file | Translation appears; meter moves |
| 4 | Browser mode: cancel picker | Start button restored; no error toast; no resources held |
| 5 | Browser mode: picker without audio checkbox | Clear error message; resources cleaned up |
| 6 | Browser mode: "Stop sharing" in Chrome UI mid-session | Session stops cleanly; admin UI back to Ready |
| 7 | Browser mode: pause then resume | Translation pauses, resumes; no audio drift |
| 8 | Reload admin tab mid-session in browser mode | Session shows running; RECONNECT AUDIO appears; clicking it restores audio |
| 9 | Switch source without stopping | Not supported — radios disabled during session |
| 10 | Free-tier Gemini key + browser source | Works — input source orthogonal to provider |
| 11 | Attendee connects during browser session | Attendee receives audio — downstream pipeline unchanged |

## Browser support

- **Chrome / Edge:** fully supported (tab audio + system audio via `getDisplayMedia`)
- **Firefox:** tab audio works; system audio not supported by Firefox's `getDisplayMedia` — user sees no "Share system audio" option. Documented limitation.
- **Safari:** `getDisplayMedia` support limited; not a v1 target

README updated to recommend Chrome/Edge for Browser/System modes.

## Out of scope

- Mid-session source switching (locked at `/api/start`, consistent with language/provider locking)
- Audio worklet flow control / backpressure handling (not needed at 32 KB/s on LAN)
- Client-side translation (Gemini/Qwen sessions stay server-side)
- Replay-from-file source (could be added later as a fourth `AudioSource` impl)
- RECONNECT on USB drop (USB uses sox; sox failure surfaces as session error today, unchanged)
