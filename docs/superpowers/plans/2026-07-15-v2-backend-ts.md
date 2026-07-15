# v2 Plan 2 — Backend TypeScript Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port v1's church-mode backend (the 8 Node-ESM JS modules in `src/`) to TypeScript in `server/src/`, producing a working v2 backend that runs alongside untouched v1. This is **Plan 2 of the v2 roadmap** (Plan 1, the foundation, is merged to `main`).

**Architecture:** Faithful JS→TS port of each module into `server/src/`, preserving behavior, adding strict TypeScript types, and applying two validated fixes (Qwen cumulative-text dedup, SessionManager reconnect backoff). The server imports `@v2/shared` contract types via `import type` only (erased at compile → no runtime dep → the foundation's `node dist/index.js` works unchanged). v1 (`src/`) stays untouched and running on :3001; v2 backend runs on :4000.

**Tech Stack:** Node 24, TypeScript 5.6+ (strict), Express 5, ws 8, `@google/genai`, `node-record-lpcm16`, `qrcode`, tsx (dev), tsc (build), Vitest. ESM.

## Global Constraints

- **Do not touch v1.** `src/`, `public/`, v1 `test/`, v1 `cert/`, and v1's root scripts (`start`/`dev`/`test`) stay exactly as-is. v2 backend code goes in `server/src/`.
- **Port source = the v1 file.** Each task names a `src/*.js` source file; the implementer ports it to `server/src/*.ts` preserving behavior. The source IS the spec — read it, translate to TS, don't redesign.
- **Apply two fixes during the port** (validated on `feat/conversation-mode`):
  1. **Qwen cumulative-text dedup** — `response.audio_transcript.text` / `conversation.item.input_audio_transcription.text` are cumulative; use a `startsWith`-guarded delta and do NOT reset `_lastOutputText`/`_lastInputText` on `.done`/`.completed` (v1 resets → duplicated output).
  2. **SessionManager reconnect backoff** — `_reconnectSession` must use exponential backoff (2s→60s cap), a `_reconnecting` guard, and `removeAllListeners()` on the old session (v1 reconnects with no backoff → reconnect storms under rate limits).
- **`@v2/shared` via `import type` only.** Never a runtime import — type imports are erased by `tsc`, so compiled `server/dist` has no runtime dependency on `shared/` (which ships as `.ts` source). This avoids needing a `shared/` build step.
- **TypeScript strict** (`server/tsconfig.json` already strict from Plan 1). No `any` without a `// reason` comment.
- **Each task ends with a verifiable artifact**: typecheck exit 0, vitest pass, and (for the wiring task) the v2 backend booting + serving on :4000.
- **npm registry gotcha:** the user's `~/.npmrc` redirects to a Google Artifact Registry mirror with an expired token (403). Every `npm install` MUST use `--registry=https://registry.npmjs.org/`. Do NOT modify `~/.npmrc` or committed config.

## Scope flags (redirect if wrong)
- **Church-mode backend only.** `conversation-session.js` / `conversation-manager.js` / `conversation-transport.js` / `active-speaker-router.js` are NOT on `main` (they're on the unmerged `feat/conversation-mode`) → NOT ported here. They'll be ported when conversation-mode merges or in Plan 3.
- The two fixes above are the only behavior changes vs. v1; everything else is a faithful port.

---

## File Structure

```
server/src/
├── index.ts                          (MODIFY: expand to full church-mode app — port of src/server.js)
├── env.ts                            (MODIFY: add GEMINI_API_KEY, DASHSCOPE_API_KEY, etc.)
├── qr-generator.ts                   (NEW — port of src/qr-generator.js)
├── qwen-translation-session.ts       (NEW — port of src/qwen-translation-session.js + dedup fix)
├── gemini-translation-session.ts     (NEW — port of src/gemini-translation-session.js)
├── audio-broadcaster.ts              (NEW — port of src/audio-broadcaster.js)
├── browser-audio-source.ts           (NEW — port of src/browser-audio-source.js)
├── usb-audio-source.ts               (NEW — port of src/usb-audio-source.js)
├── session-manager.ts                (NEW — port of src/session-manager.js + backoff fix)
├── types/
│   └── node-record-lpcm16.d.ts       (NEW — ambient module decl if @types absent)
├── routes/health.ts                  (exists)
└── *.test.ts                         (NEW — vitest tests for the ported modules)
```

---

## Task 1: server deps + ambient types + shared type-import convention

**Files:**
- Modify: `server/package.json` (add deps)
- Create: `server/src/types/node-record-lpcm16.d.ts` (only if `@types/node-record-lpcm16` is absent)

**Interfaces:**
- Produces: `server/` has all deps needed by the port (`@google/genai`, `node-record-lpcm16`, `qrcode`, `@types/qrcode`); `npm install` succeeds; a smoke `import type { ChurchWsMessage } from '@v2/shared'` in a throwaway file typechecks (proving the type-only convention compiles + erases).

- [ ] **Step 1: Add deps to server/package.json**

Add to `server/package.json` `dependencies`: `"@google/genai": "^2.8.0"`, `"node-record-lpcm16": "^1.0.1"`, `"qrcode": "^1.5.4"`. Add to `devDependencies`: `"@types/qrcode": "^1.5.0"`. Keep existing entries.

- [ ] **Step 2: Install (registry override)**

```bash
npm install --registry=https://registry.npmjs.org/
```

- [ ] **Step 3: node-record-lpcm16 ambient types (if needed)**

Check `node_modules/@types/node-record-lpcm16`. If absent, create `server/src/types/node-record-lpcm16.d.ts`:
```ts
declare module 'node-record-lpcm16' {
  export interface RecordOptions {
    sampleRate?: number; channels?: number; threshold?: number; thresholdStart?: number;
    thresholdEnd?: number; silence?: string; verbose?: boolean; recordProgram?: string;
    audioType?: string;
  }
  export function record(opts?: RecordOptions): {
    stream(): NodeJS.ReadableStream; stop(): void; pause(): void; resume(): void;
    isPaused(): boolean; isRecording(): boolean;
  };
}
```
(If `@types/node-record-lpcm16` exists, skip this file.)

- [ ] **Step 4: Smoke-test the type-only shared import**

Temporarily add to `server/src/routes/health.ts`: `import type { ChurchWsMessage } from '@v2/shared';` and a `_use(_: ChurchWsMessage) {}` stub. Run `npm -w server run typecheck` → exit 0. Then revert the stub (keep health.ts as-is). This proves the type-only convention works. Confirm `npm -w server run build` (tsc) still succeeds.

- [ ] **Step 5: Commit**

```bash
git add server/package.json server/src/types package-lock.json
git commit -m "feat(v2): server deps for backend port + ambient types"
```

---

## Task 2: port qr-generator

**Files:**
- Source (spec): `src/qr-generator.js`
- Create: `server/src/qr-generator.ts`

**Interfaces:**
- Produces: `getLocalIP(): Promise<string>` and `generateQRCode(port?: number): Promise<{ url: string; dataUrl: string }>` exported from `server/src/qr-generator.ts`, behavior-identical to v1.

- [ ] **Step 1: Port**

Port `src/qr-generator.js` → `server/src/qr-generator.ts`. Add types (`port?: number` → `number`, return types). Behavior identical. Use `import path from 'node:path'`, `import os from 'node:os'`, `import QRCode from 'qrcode'`.

- [ ] **Step 2: Verify**

```bash
npm -w server run typecheck
node -e "import('./server/src/qr-generator.ts').then(()=>console.log('ok')).catch(e=>{console.error(e);process.exit(1)})" --experimental-strip-types \
  || npx -w server tsx -e "import('./src/qr-generator.ts').then(()=>console.log('ok'))"
```
Expected: typecheck exit 0; the import resolves (module loads).

- [ ] **Step 3: Commit**

```bash
git add server/src/qr-generator.ts
git commit -m "feat(v2): port qr-generator to TS"
```

---

## Task 3: port qwen + gemini translation sessions (with dedup fix)

**Files:**
- Source: `src/qwen-translation-session.js`, `src/gemini-translation-session.js`
- Create: `server/src/qwen-translation-session.ts`, `server/src/gemini-translation-session.ts`
- Create: `server/src/qwen-translation-session.test.ts`

**Interfaces:**
- Produces: `QwenTranslationSession` and `GeminiTranslationSession` classes (EventEmitters) with the same constructor signatures, methods (`connect`, `sendAudio`, `disconnect`, `getUsage`), and events (`connected`, `inputTranscription`, `outputTranscription`, `audio`, `error`, `closed`) as v1. The Qwen port applies the **cumulative-text dedup fix**.

- [ ] **Step 1: Write the failing test (Qwen dedup)**

`server/src/qwen-translation-session.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { QwenTranslationSession } from './qwen-translation-session.js';

describe('QwenTranslationSession delta handling', () => {
  it('does not duplicate cumulative output across .done', () => {
    const s = new QwenTranslationSession('key', 'zh-Hans');
    const out: string[] = []; s.on('outputTranscription', (t: string) => out.push(t));
    for (const e of [
      { type: 'response.audio_transcript.text', text: '你好' },
      { type: 'response.audio_transcript.text', text: '你好世界' },
      { type: 'response.audio_transcript.done' },
      { type: 'response.audio_transcript.text', text: '你好世界今天' },
    ]) (s as any)._handleMessage(e);
    expect(out.join('')).toBe('你好世界今天');
  });
});
```

- [ ] **Step 2: Port Qwen WITH the dedup fix**

Port `src/qwen-translation-session.js` → `server/src/qwen-translation-session.ts`. In `_handleMessage`, apply the dedup fix (this is the KEY difference from v1):
```ts
case 'response.audio_transcript.text': {
  const newText = msg.text || '';
  const delta = newText.startsWith(this._lastOutputText)
    ? newText.slice(this._lastOutputText.length)
    : newText;
  this._lastOutputText = newText;
  if (delta) this.emit('outputTranscription', delta);
  break;
}
case 'response.audio_transcript.done':
  // Do NOT reset _lastOutputText — transcript is cumulative.
  break;
```
Apply the identical `startsWith`-guard + no-reset to the `conversation.item.input_audio_transcription.text` / `.completed` handlers. Everything else (constructor, `connect`, session.update, `sendAudio`, `disconnect`, VOICE_LIST, `_buildTranslationConfig`, other message cases) is a faithful typed port. Type `msg` as a discriminated union or `Record<string, unknown>` with narrowing; avoid `any`.

- [ ] **Step 3: Port Gemini**

Port `src/gemini-translation-session.js` → `server/src/gemini-translation-session.ts` faithfully (typed). No behavior change.

- [ ] **Step 4: Run tests + typecheck**

```bash
npm -w server run typecheck
npm -w server test
```
Expected: typecheck exit 0; the Qwen dedup test passes (and the Task 3 health test still passes).

- [ ] **Step 5: Commit**

```bash
git add server/src/qwen-translation-session.ts server/src/qwen-translation-session.test.ts server/src/gemini-translation-session.ts
git commit -m "feat(v2): port qwen (with dedup fix) + gemini translation sessions to TS"
```

---

## Task 4: port audio sources + broadcaster

**Files:**
- Source: `src/audio-broadcaster.js`, `src/browser-audio-source.js`, `src/usb-audio-source.js`
- Create: `server/src/audio-broadcaster.ts`, `server/src/browser-audio-source.ts`, `server/src/usb-audio-source.ts`
- Create: `server/src/audio-broadcaster.test.ts`

**Interfaces:**
- Produces: `AudioBroadcaster`, `BrowserAudioSource` (exports `WS_ADMIN_INPUT_PATH`), `UsbAudioSource` — faithful typed ports. `BrowserAudioSource` keeps the `noServer` + `handleUpgrade` + single-active-connection + auth pattern.

- [ ] **Step 1: Write the failing test (AudioBroadcaster fan-out)**

`server/src/audio-broadcaster.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { AudioBroadcaster } from './audio-broadcaster.js';

describe('AudioBroadcaster', () => {
  it('broadcasts transcription only to matched language+text-mode clients', () => {
    // Minimal: construct AudioBroadcaster with a fake WSS, attach two fake clients
    // (one zh-Hans text-mode, one ko audio-mode), call broadcastTranscription('zh-Hans','input','hi'),
    // assert only the zh-Hans text client received the JSON message.
    // Use the same fake-client pattern as v1's test/browser-audio-source.test.js.
  });
});
```
(Flesh out the fake-client setup mirroring `test/browser-audio-source.test.js`; the assertion is the real behavior.)

- [ ] **Step 2: Port the three modules**

Faithful typed ports. `AudioBroadcaster`: `broadcastAudio(languageCode, pcm: Buffer)`, `broadcastTranscription(languageCode, type, text)`, `broadcastStatus`, client map with `{ languageCode, mode, ws }`. `BrowserAudioSource`: `EventEmitter`, `start()`, `handleUpgrade`, `pause`/`resume`/`stop`, `_authorize`, single `_activeWs`. `UsbAudioSource`: `EventEmitter`, `start`/`stop`/`pause`/`resume` using `node-record-lpcm16`. Preserve v1 behavior exactly.

- [ ] **Step 3: typecheck + test**

```bash
npm -w server run typecheck && npm -w server test
```
Expected: exit 0; the broadcaster test passes.

- [ ] **Step 4: Commit**

```bash
git add server/src/audio-broadcaster.ts server/src/audio-broadcaster.test.ts server/src/browser-audio-source.ts server/src/usb-audio-source.ts
git commit -m "feat(v2): port audio-broadcaster + browser/usb audio sources to TS"
```

---

## Task 5: port session-manager (with backoff)

**Files:**
- Source: `src/session-manager.js`
- Create: `server/src/session-manager.ts`
- Create: `server/src/session-manager.test.ts`

**Interfaces:**
- Produces: `SessionManager` (extends `EventEmitter`) with `start`, `stop`, `pause`, `resume`, `sendAudio`, `setEnabledLanguages`, `getStats`, static `LANGUAGES`/`PROVIDERS` — faithful typed port **plus the reconnect-backoff fix**.

- [ ] **Step 1: Write the failing test (reconnect backoff)**

`server/src/session-manager.test.ts`: construct a `SessionManager`, inject a fake provider session that emits `closed` with reason `'session expired'`, and assert `_reconnectSession` schedules a reconnect with backoff (not immediate) — e.g. spy on `setTimeout` / verify a second `_createSession` only happens after a delay. (Keep it focused: the assertion is "reconnect is deferred/scheduled, not synchronous, and guarded against re-entry.")

- [ ] **Step 2: Port WITH backoff**

Port `src/session-manager.js` → `server/src/session-manager.ts`. Replace v1's `_reconnectSession(code)` with the backoff version:
```ts
private _reconnectBaseDelay = 2000;
private _reconnectAttempts = new Map<string, number>();
_reconnectSession(code: string, reason = 'session expired') {
  const old = this.sessions.get(code);
  if (!old || (old as any)._reconnecting) return;
  (old as any)._reconnecting = true;
  const attempts = (this._reconnectAttempts.get(code) ?? 0) + 1;
  this._reconnectAttempts.set(code, attempts);
  const delay = Math.min(60000, this._reconnectBaseDelay * 2 ** (attempts - 1));
  console.log(`[${code}] ${reason} — reconnecting in ${delay}ms (attempt ${attempts})`);
  old.removeAllListeners();
  old.disconnect?.();
  setTimeout(() => {
    if (!this.isRunning) return;
    try {
      const session = this._createSession(code);
      this.sessions.set(code, session);
      session.connect().then(() => this._reconnectAttempts.delete(code))
        .catch((err: unknown) => { this.emit('error', { languageCode: code, error: (err as Error).message }); this.sessions.delete(code); });
    } catch (err) { this.emit('error', { languageCode: code, error: (err as Error).message }); }
  }, delay);
}
```
And in `_createSession`'s `closed` handler, reset attempts to 0 on a clean reconnect; the `session.on('closed', ...)` should call `_reconnectSession(code, reason)` for matching reasons (`/GoAway|duration|expired|session|repeat|rate|limit/i`). Faithful typed port for everything else.

- [ ] **Step 3: typecheck + test**

```bash
npm -w server run typecheck && npm -w server test
```
Expected: exit 0; the backoff test passes.

- [ ] **Step 4: Commit**

```bash
git add server/src/session-manager.ts server/src/session-manager.test.ts
git commit -m "feat(v2): port session-manager to TS (with reconnect backoff)"
```

---

## Task 6: wire the full church-mode server (port server.js)

**Files:**
- Source: `src/server.js`
- Modify: `server/src/index.ts` (expand from skeleton to full app), `server/src/env.ts` (add keys)

**Interfaces:**
- Produces: `server/src/index.ts` is the full church-mode Express app: HTTPS (reusing root `cert/`), the manual WS-upgrade router (`/ws/admin-input` → BrowserAudioSource, `/ws` → AudioBroadcaster), and all church API routes (`/api/status`, `/api/providers`, `/api/key-status`, `/api/languages`, `/api/voices`, `/api/qrcode`, `/api/start`, `/api/pause`, `/api/resume`, `/api/stop`, `/api/audio-level`, plus `/`, `/admin`, `/interpreter` page routes serving `public/`). Runs on `:4000`.

- [ ] **Step 1: Expand env.ts**

Add to `server/src/env.ts`: `GEMINI_API_KEY`, `DASHSCOPE_API_KEY` (from `process.env`), and an `apiKeys` map (`{ gemini, qwen }`). Keep `PORT`/`ADMIN_PASSWORD`/`CERT_DIR`.

- [ ] **Step 2: Port server.js → server/src/index.ts**

Port `src/server.js` faithfully into `server/src/index.ts`: Express app, `express.json()`, static `public/` serving, page routes (`/`→attendee.html, `/admin`, `/interpreter`), `requireAdmin` middleware, all `/api/*` routes, the `SessionManager`/`AudioBroadcaster`/`BrowserAudioSource` wiring, the manual `server.on('upgrade', ...)` handler routing `/ws/admin-input` vs the broadcaster's `/ws`, HTTPS via `env.CERT_DIR`, `server.listen(env.PORT, '0.0.0.0', ...)`. Use the ported TS modules. Use `import type` for any `@v2/shared` contract types if helpful (optional). Drop the `/api/health` route OR keep it. Remove the placeholder Home route wiring (that's web-side). Keep the startup banner (adapted for v2/:4000).

- [ ] **Step 3: Boot + smoke-test the full backend**

```bash
npm -w server run typecheck
npm -w server run build
V2_PORT=4000 npm -w server run dev &
sleep 3
curl -k https://localhost:4000/api/languages            # JSON language list
curl -k https://localhost:4000/api/providers            # { providers, default }
kill %1
```
Expected: typecheck + build exit 0; the v2 backend boots on :4000 and the church API routes respond.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts server/src/env.ts
git commit -m "feat(v2): wire full church-mode server (express + ws + https + routes)"
```

---

## Task 7: full verification + v1-untouched check

**Files:** none (verification + any test backfill)

- [ ] **Step 1: Full v2 test suite**

```bash
npm -w server run typecheck && npm -w server test
```
Expected: typecheck exit 0; all server vitest tests pass (health, qwen dedup, broadcaster, session-manager backoff).

- [ ] **Step 2: v2 build**

```bash
npm run build:v2    # shared (typecheck) + server (tsc → dist) + web (vite build)
```
Expected: all three build; `server/dist/index.js` exists and does NOT contain a runtime `require`/`import` of `@v2/shared` (confirm with `grep -r '@v2/shared' server/dist` → no matches, proving type-only imports erased).

- [ ] **Step 3: v2 backend end-to-end boot**

```bash
V2_PORT=4000 npm -w server start &      # runs node dist/index.js (compiled)
sleep 3
curl -k https://localhost:4000/api/languages
curl -k https://localhost:4000/api/providers
kill %1
```
Expected: compiled `node dist/index.js` boots (proving no `@v2/shared` runtime dep) and serves the church API.

- [ ] **Step 4: v1 untouched**

```bash
npm test                                # v1 node --test suite (must be green)
git diff --stat main -- src/ public/ test/ | tail -1   # must be empty (v1 untouched)
```
Expected: v1 tests green; zero v1 files changed on this branch.

- [ ] **Step 5: Commit any test backfill + final**

If verification surfaced fixes, commit them. Then:
```bash
git log --oneline main..HEAD
```

---

## Self-Review

**Spec coverage:** 8 modules ported (qr-generator, qwen+dedup, gemini, audio-broadcaster, browser-audio-source, usb-audio-source, session-manager+backoff, server.js wiring) across Tasks 2-6; deps + ambient types (Task 1); tests for qwen/broadcaster/session-manager; full verify + v1-untouched (Task 7). Conversation backend intentionally out of scope (flagged). Two fixes applied (dedup, backoff). `@v2/shared` type-only imports (erased → no runtime dep → compiled prod works).

**Placeholder scan:** port tasks reference the v1 source file as the spec (the source IS the complete spec for a port) plus explicit deltas (the dedup/backoff fix code is written out in full). Test stubs in Task 4/5 outline the assertion + point to the v1 test pattern to mirror — the implementer writes the real fake-client setup.

**Type consistency:** module export names match v1 (`QwenTranslationSession`, `GeminiTranslationSession`, `AudioBroadcaster`, `BrowserAudioSource`/`WS_ADMIN_INPUT_PATH`, `UsbAudioSource`, `SessionManager`, `getLocalIP`/`generateQRCode`); event names match (`connected`, `inputTranscription`, `outputTranscription`, `audio`, `error`, `closed`).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-15-v2-backend-ts.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, reviewed between tasks.
**2. Inline Execution** — in this session with checkpoints.

**Which approach?**

After Plan 2 lands, the v2 backend (church-mode) is fully TypeScript. Next: a conversation-UX design session, then Plan 3 (the reimagined conversation page) — which will also port the conversation backend from `feat/conversation-mode` once that's merged/available.
