# v2 Plan 3 — Conversation Backend TypeScript Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the conversation backend (the 4-module cluster + endpoints) from `feat/conversation-mode` (JS) to TypeScript in `server/src/`, and wire `/api/conversation/*` + `/ws/conversation` + the `/conversation` route into the v2 server. This is the backend half of the conversation page (the frontend is Plan 4).

**Architecture:** Faithful JS→TS port of `active-speaker-router`, `conversation-session`, `conversation-manager`, `conversation-transport` (read from `feat/conversation-mode` via `git show`) into `server/src/*.ts`, plus enhancing the ported `qwen-translation-session.ts` with `sourceLanguage`/`modalities`/`_buildSessionConfig` (which the conversation factory needs). The modules already carry the post-reconfigure-fix design (config-at-construction, `setConfig` reconnects via `_replaceSession`, `_reconnectRole` backoff — NO `reconfigure`). `@v2/shared` imported via `import type` only. v1 untouched; runs on :4000.

**Tech Stack:** Node 24, TypeScript 5.6+ (strict), Express 5, ws 8, Vitest, tsx. ESM.

## Global Constraints

- **Do not touch v1** (`src/`, `public/`, v1 `test/`, root scripts). All work in `server/src/`.
- **Port source = `feat/conversation-mode:src/<file>.js`.** Read it with `git show feat/conversation-mode:src/<file>.js` — it is the spec. Translate to TypeScript faithfully; preserve behavior. The modules are already in their final fixed state (config-at-construction, reconnect-on-change, no `reconfigure`).
- **Enhance, don't break, the ported Qwen session** (Task 1): adding `sourceLanguage`/`_modalities`/`_buildSessionConfig` must preserve church-mode defaults (`sourceLanguage='en'`, `modalities=['text','audio']`) so Plan 2's `session-manager.ts` is unaffected.
- **`@v2/shared` via `import type` only** (erased at compile → no runtime dep → compiled `node dist/index.js` works). `grep '@v2/shared' server/dist` must stay empty.
- **TypeScript strict**, no `any` without a `// reason` comment.
- **Each task ends verifiable**: typecheck exit 0, vitest pass, and (Task 6) the v2 server booting with the conversation endpoints.
- **npm registry gotcha**: every `npm install` uses `--registry=https://registry.npmjs.org/` (expired Artifact Registry token in `~/.npmjsrc`). typecheck/test/build unaffected.

## Scope flags
- Backend only. The conversation **frontend** (React page + engine layer per the design spec) is **Plan 4**.
- The modules are a faithful port of `feat/conversation-mode`'s final state — no new behavior beyond what's there.

---

## File Structure

```
server/src/
├── qwen-translation-session.ts        (MODIFY — add sourceLanguage/_modalities/_buildSessionConfig)
├── active-speaker-router.ts           (NEW — port)
├── conversation-session.ts            (NEW — port)
├── conversation-manager.ts            (NEW — port)
├── conversation-transport.ts          (NEW — port)
├── qr-generator.ts                    (MODIFY — add generateQRCodeForUrl)
├── index.ts                           (MODIFY — wire conversation endpoints + WS + route)
└── *.test.ts                          (NEW — vitest ports of the conversation-mode tests)
```

---

## Task 1: enhance qwen-translation-session.ts (sourceLanguage / modalities / _buildSessionConfig)

**Files:**
- Source (spec): `git show feat/conversation-mode:src/qwen-translation-session.js` (has `sourceLanguage`, `_modalities`, `_buildSessionConfig`; NO `reconfigure`).
- Modify: `server/src/qwen-translation-session.ts`
- Test: `server/src/qwen-translation-session.test.ts` (add cases)

**Interfaces:**
- Produces: `QwenTranslationSession` constructor accepts `voiceConfig.sourceLanguage` (default `'en'`) and `voiceConfig.modalities` (default `['text','audio']`); a `_buildSessionConfig(targetLang)` method builds the session config from those + `enableVoiceClone`. Church-mode construction (no sourceLanguage/modalities) behaves identically to before.

- [ ] **Step 1: Add failing tests** to `server/src/qwen-translation-session.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { QwenTranslationSession } from './qwen-translation-session.js';

describe('QwenTranslationSession config', () => {
  it('uses sourceLanguage in the input transcription config', () => {
    const s = new QwenTranslationSession('key', 'ko', {}, { sourceLanguage: 'zh', modalities: ['text'] });
    const cfg = (s as any)._buildSessionConfig('ko');
    expect(cfg.input_audio_transcription.language).toBe('zh');
    expect(cfg.modalities).toEqual(['text']);
  });
  it('defaults sourceLanguage=en and modalities=[text,audio] (church-mode compat)', () => {
    const s = new QwenTranslationSession('key', 'ko', {}, {});
    const cfg = (s as any)._buildSessionConfig('ko');
    expect(cfg.input_audio_transcription.language).toBe('en');
    expect(cfg.modalities).toEqual(['text', 'audio']);
  });
});
```
- [ ] **Step 2: Run → fail** (`npm -w server test` → the new tests fail: `_buildSessionConfig` not a function / no `sourceLanguage`).
- [ ] **Step 3: Enhance** `server/src/qwen-translation-session.ts`:
  - In the constructor, add (after `this.enableVoiceClone`/`this.voiceName`): `this.sourceLanguage = voiceConfig.sourceLanguage ?? 'en';` and `this._modalities = voiceConfig.modalities ?? ['text', 'audio'];` (typed `string` and `string[]`).
  - Add the `_buildSessionConfig(targetLang: string)` method (port from `feat/conversation-mode` — uses `this._modalities`, `mapLang(this.sourceLanguage)`, `this._buildTranslationConfig(targetLang)`, and the existing voice-clone branch).
  - In `connect()`'s open handler, replace the inline sessionConfig build with `const sessionConfig = this._buildSessionConfig(targetLang);`.
  - Keep everything else (the cumulative-text dedup from Plan 2, `sendAudio`, `disconnect`, VOICE_LIST, etc.) unchanged.
- [ ] **Step 4: Run → pass** (`npm -w server run typecheck` exit 0; `npm -w server test` green incl. new tests + existing dedup test + the church-mode session-manager tests still pass).
- [ ] **Step 5: Commit** — `feat(v2): qwen session sourceLanguage/modalities/_buildSessionConfig`.

---

## Task 2: port active-speaker-router

**Files:**
- Source: `git show feat/conversation-mode:src/active-speaker-router.js`
- Create: `server/src/active-speaker-router.ts`, `server/src/active-speaker-router.test.ts`

**Interfaces:**
- Produces: `class ActiveSpeakerRouter { constructor({ holdMs?, energyWindow?, silenceRms?, staleMs?, now? }); feed(role: 'host'|'joiner', pcm: Buffer): 'host'|'joiner'|null; active(): 'host'|'joiner'|null; reset(): void }`.

- [ ] **Step 1: Port** `active-speaker-router.js` → `server/src/active-speaker-router.ts` (faithful, typed; `rms(pcm: Buffer): number`; `now?: () => number`). Test port: copy `git show feat/conversation-mode:test/active-speaker-router.test.js` → `server/src/active-speaker-router.test.ts`, adapting `node:test`→`vitest` imports + `.js`→`.js` specifiers (NodeNext). Keep the mock-clock hold/staleness/silence tests.
- [ ] **Step 2: typecheck + test** → exit 0, all pass.
- [ ] **Step 3: Commit** — `feat(v2): port active-speaker-router to TS`.

---

## Task 3: port conversation-session

**Files:**
- Source: `git show feat/conversation-mode:src/conversation-session.js`
- Create: `server/src/conversation-session.ts`, `server/src/conversation-session.test.ts`

**Interfaces:**
- Consumes: `ActiveSpeakerRouter` (Task 2), `QwenTranslationSession` (enhanced in Task 1).
- Produces: `class ConversationSession extends EventEmitter { constructor({ apiKey, sessionFactory?, routerFactory?, names?, config?, reconnectBaseDelay? }); start(); attachParticipant(role, ws); handleAudio(role, pcm); setConfig({voiceOver?, voiceClone?}); stop() }`. Emits `error`/`sessionClosed`. Default `sessionFactory` builds `QwenTranslationSession` with `sourceLanguage`/`modalities`/`enableVoiceClone` from `_config`.

- [ ] **Step 1: Port** `conversation-session.js` → `server/src/conversation-session.ts` faithfully (config-at-construction, `_wire`, `_send`/`_broadcast`/`_broadcastStatus`, `attachParticipant`, `handleAudio` turn-boundary, `_replaceSession`, `setConfig` reconnect-via-`_replaceSession`, `stop` Promise.allSettled, `_reconnectRole` backoff). Type `role: 'host'|'joiner'`; WS messages as `import type { ConversationWsMessage } from '@v2/shared'` (erased). Test port: copy `git show feat/conversation-mode:test/conversation-session.test.js` → `.test.ts` (vitest; uses a `StubSession` EventEmitter + stub WS + injected `routerFactory` with a mock clock; asserts routing directions, audio-gating, setConfig reconnect, turn-boundary).
- [ ] **Step 2: typecheck + test** → exit 0, pass.
- [ ] **Step 3: Commit** — `feat(v2): port conversation-session to TS`.

---

## Task 4: port conversation-manager

**Files:**
- Source: `git show feat/conversation-mode:src/conversation-manager.js`
- Create: `server/src/conversation-manager.ts`, `server/src/conversation-manager.test.ts`

**Interfaces:**
- Produces: `class ConversationManager extends EventEmitter { createRoom({apiKey, sessionFactory?, routerFactory?, names, config}): {roomId, hostToken, joinToken, session}; resolve(token): {roomId, role}|null; getRoom(roomId); removeRoom(roomId) }`.

- [ ] **Step 1: Port** (faithful, typed; `randomBytes` from `node:crypto`; `extends EventEmitter`; forwards session `error`). Test port: copy `git show feat/conversation-mode:test/conversation-manager.test.js` → `.test.ts` (vitest; token distinctness/resolve/removeRoom).
- [ ] **Step 2: typecheck + test** → exit 0, pass.
- [ ] **Step 3: Commit** — `feat(v2): port conversation-manager to TS`.

---

## Task 5: port conversation-transport

**Files:**
- Source: `git show feat/conversation-mode:src/conversation-transport.js`
- Create: `server/src/conversation-transport.ts`, `server/src/conversation-transport.test.ts`

**Interfaces:**
- Produces: `WS_CONVERSATION_PATH = '/ws/conversation'`; `class ConversationTransport { constructor(manager); handleUpgrade(req, socket, head) }` — token auth via `manager.resolve`, else `ws.close(1008)`.

- [ ] **Step 1: Port** (faithful, typed; `noServer` `WebSocketServer`). Test port: copy `git show feat/conversation-mode:test/conversation-transport.test.js` → `.test.ts` (vitest; real http server + `ws` client; valid token attaches + receives config; invalid token → 1008).
- [ ] **Step 2: typecheck + test** → exit 0, pass.
- [ ] **Step 3: Commit** — `feat(v2): port conversation-transport to TS`.

---

## Task 6: add generateQRCodeForUrl + wire conversation endpoints into server/src/index.ts

**Files:**
- Source: `git show feat/conversation-mode:src/server.js` (the conversation endpoints + wiring + `generateQRCodeForUrl`).
- Modify: `server/src/qr-generator.ts` (add `generateQRCodeForUrl`), `server/src/index.ts` (add the endpoints + WS route + route).

- [ ] **Step 1: Add `generateQRCodeForUrl`** to `server/src/qr-generator.ts` — port from `feat/conversation-mode:src/qr-generator.js`: `export async function generateQRCodeForUrl(url: string): Promise<string>` (returns a QRCode data URL).
- [ ] **Step 2: Wire into `server/src/index.ts`** (port the conversation section of `feat/conversation-mode:src/server.js`):
  - Imports: `ConversationManager`, `ConversationTransport` + `WS_CONVERSATION_PATH`, `generateQRCodeForUrl`.
  - Instantiate `conversationManager` + `conversationTransport` (after `browserAudioSource`).
  - Add `/ws/conversation` branch to the manual upgrade router.
  - `app.get('/conversation', ...)` → serves `public/conversation.html`.
  - `app.post('/api/conversation/create', requireAdmin, ...)` → `createRoom({apiKey: apiKeys.qwen, names, config:{voiceOver,voiceClone}})` → `session.start()` → build `joinUrl` (`${req.protocol}://${ip}:${env.PORT}/conversation?token=${joinToken}`) → `generateQRCodeForUrl(joinUrl)` → respond `{roomId, hostToken, joinToken, joinUrl, qrDataUrl}`. Catch cleans up the room on failure.
  - `app.post('/api/conversation/config', requireAdmin, ...)` → `room.session.setConfig(...)`.
  - `app.post('/api/conversation/end', requireAdmin, ...)` → `room.session.stop()` + `removeRoom`.
  - `conversationManager.on('error', ...)` log handler.
  - Use `import type` for any `@v2/shared` types. Keep all Plan 2 church-mode routes/wiring intact.
- [ ] **Step 3: typecheck + build** → exit 0.
- [ ] **Step 4: Boot + smoke** — `V2_PORT=4000 npm -w server run dev &`, `sleep 3`, then (without a real Qwen key) `curl -k -s -X POST -H "Authorization: Bearer changeme" -H "Content-Type: application/json" -d '{"hostName":"Enze","partnerName":"아버님"}' https://localhost:4000/api/conversation/create` → expect `{"error":"No Qwen API key..."}` (proves the route + auth; live create verified in Plan 4). Then `kill %1`.
- [ ] **Step 5: Commit** — `feat(v2): wire conversation endpoints + /ws/conversation + /conversation route`.

---

## Task 7: full verify + v1-untouched check

- [ ] **Step 1:** `npm -w server run typecheck` → exit 0. `npm -w server test` → all pass (church-mode + qwen-enhancement + the 4 conversation modules).
- [ ] **Step 2:** `npm run build:v2` → succeeds. `grep -rn '@v2/shared' server/dist` → EMPTY (type-only imports erased).
- [ ] **Step 3:** `npm -w server start &` (compiled `node dist/index.js`), `sleep 3`, `curl -k https://localhost:4000/api/languages` + the conversation create 400-check → both respond. `kill %1`.
- [ ] **Step 4:** `npm test` (v1 green) + `git diff --stat main -- src/ public/ test/` → empty (v1 untouched). `npm -w server test` confirms church-mode tests still green (Task 1 enhancement didn't regress them).
- [ ] **Step 5:** commit any test backfill; final `git log --oneline main..HEAD`.

---

## Self-Review

**Spec coverage:** the conversation backend cluster (4 modules) ported (Tasks 2-5); the Qwen enhancement the factory depends on (Task 1); endpoints + WS + route wired (Task 6); full verify + v1-untouched (Task 7). The conversation frontend is explicitly out of scope (Plan 4). `@v2/shared` type-only (grep clean). Faithful to `feat/conversation-mode`'s final fixed state.

**Placeholder scan:** port tasks reference the exact `feat/conversation-mode` source (`git show …`) as the spec — the source is complete. The two enhancement snippets (Task 1's `_buildSessionConfig`, Task 6's endpoints) are described concretely with their source. Test ports name the source test file to adapt.

**Type consistency:** module names/export signatures match the v1 conversation-mode cluster (`ActiveSpeakerRouter`, `ConversationSession`, `ConversationManager`, `ConversationTransport`, `WS_CONVERSATION_PATH`); event names (`error`, `sessionClosed`) match; the Qwen constructor's new `voiceConfig.sourceLanguage`/`modalities` are used by the conversation-session factory in Task 3 and defined in Task 1.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-15-v2-conversation-backend.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, reviewed between tasks.
**2. Inline Execution** — in this session with checkpoints.

**Which approach?**

After Plan 3 lands, the v2 server has the full conversation backend in TS. Then **Plan 4** builds the conversation **frontend** (React+TS page + engine layer) against this backend + the approved design spec (`docs/superpowers/specs/2026-07-15-conversation-page-design.md`).
