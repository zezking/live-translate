# v2 Plan 6 — Single-Device Conversation Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-device (room/QR) conversation mode with a single-device push-to-talk mode: one phone between two speakers, user-picked language pair (default English ↔ Korean), giant press-to-talk areas, one river showing original + translation for every turn.

**Architecture:** New `DuoSession` on the server holds two warm `QwenTranslationSession`s (one per direction) and routes PCM to the active push-to-talk direction. The WS protocol becomes: client sends JSON control frames (`start`, `direction`) + binary PCM; server sends `delta { field, lang }` / `turnEnd { lang }` / `status` / `config` / `audio` / `error`. Rooms, tokens, QR, and the `ActiveSpeakerRouter` are deleted. The client keeps the engines + reducer pattern with a rewritten reducer (turns keyed by language, not speaker role).

**Tech Stack:** Existing v2 stack only — React 18 + TS strict, Vite, Tailwind v4 tokens, vitest + RTL, Express + TS server, `@v2/shared` via workspace symlink. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-07-20-single-device-conversation-design.md` (approved). Work on branch `feat/v2-single-device-conversation`.

## Global Constraints

- **Do not touch v1** (`src/`, `public/`, v1 `test/`, root `package.json` scripts, root `src/server.js`). All changes under `web/src/`, `server/src/`, `shared/src/` (+ `scripts/` for the E2E probe).
- **No new npm dependencies.**
- **TypeScript strict**, no `any` without a `// reason` comment. `@v2/shared` imported with `import type` where type-only. Local relative imports use `.js` extensions.
- **Warm-&-human tokens** in `web/src/styles.css`: `--primary:#c0623a` (language A color), warm green `#3a7a5a` as Tailwind arbitrary value `text-[#3a7a5a]` / inline style (language B color).
- **Each task ends verifiable:** `npm -w server run typecheck` / `npm -w web run typecheck` exit 0 and the relevant vitest suite green; commit.
- **Commit message style:** `feat(v2): <summary>` (or `refactor(v2):`, `test(v2):` where more accurate).
- **Carried over unchanged:** `web/src/conversation/components/BottomSheet.tsx`, `web/src/conversation/components/ErrorLine.tsx`, `web/src/auth/auth-context.tsx`, all three engines (`SocketClient` gets one additive `sendJson` method in Task 8).

## Protocol (source of truth — implemented in Task 1, consumed everywhere)

**Client → server** (WS `/ws/conversation`, JSON text frames; audio is raw binary 16 kHz 16-bit PCM):
- `{type:'start', languages:[A,B], voiceOver, voiceClone}` — must be the first frame (5s timeout → close 1008). `A !== B`, both non-empty strings.
- `{type:'direction', from:<lang>|null}` — PTT press/release. `from` must be one of the pair.

**Server → client:**
- `config { type:'config', voiceOver, voiceClone }` (sent on attach + on change)
- `status { type:'status', state:'ready'|'ended' }` (`ready` after both Qwen sessions connect)
- `delta { type:'delta', field:'original'|'translation', lang, text }` — `lang` = language of the text (original → source lang; translation → target lang)
- `turnEnd { type:'turnEnd', lang }` — `lang` = SOURCE language of the finalized turn; on direction release/switch and config reset
- `audio { type:'audio', data }` (base64 24 kHz PCM, only when voiceOver)
- `error { type:'error', message }`
- Close **1008** = terminal (bad/missing start, session replaced) — no client reconnect on 1008

**REST:**
- `POST /api/conversation/session` `[Bearer admin]` → `{ ok:true }` (admin gate; 400 if no `DASHSCOPE_API_KEY`)
- `POST /api/conversation/config` `[Bearer admin]` `{ voiceOver?, voiceClone? }` → `{ ok:true }`; 404 `{ error:'no live session' }` when idle
- Deleted: `POST /api/conversation/create`, `POST /api/conversation/end`

## File Structure

```
shared/src/index.ts                          (MODIFY: conversation types replaced — Task 1)
server/src/
├── duo-session.ts                           (NEW — Task 2)
├── duo-session.test.ts                      (NEW — Task 2)
├── conversation-transport.ts                (REWRITE: first-frame-start transport — Task 3)
├── conversation-transport.test.ts           (REWRITE — Task 3)
├── index.ts                                 (MODIFY: drop room machinery, wire new transport + REST — Tasks 1, 3)
├── conversation-session.ts / conversation-manager.ts /
│   active-speaker-router.ts (+ 4 test files) (DELETED — Task 1)
web/src/
├── conversation/
│   ├── types.ts                             (REWRITE — Task 4)
│   ├── reducer.ts                           (REWRITE — Task 4)
│   ├── reducer.test.ts                      (REWRITE — Task 4)
│   ├── languages.ts                         (NEW: pair metadata + PTT phrases — Task 5)
│   ├── languages.test.ts                    (NEW — Task 5)
│   ├── i18n.ts                              (MODIFY: key set updated — Task 5)
│   ├── i18n.test.tsx                        (MODIFY — Task 5)
│   ├── use-conversation.ts                  (REWRITE — Task 8)
│   └── components/
│       ├── BottomSheet.tsx                  (kept unchanged)
│       ├── ErrorLine.tsx                    (kept unchanged)
│       ├── SetupView.tsx                    (NEW: admin step + pair picker — Task 6)
│       ├── SetupView.test.tsx               (NEW — Task 6)
│       ├── PressArea.tsx                    (NEW: giant PTT area — Task 7)
│       ├── PressArea.test.tsx               (NEW — Task 7)
│       ├── RiverTranscript.tsx              (REWRITE: lang turns, original+translation — Task 7)
│       ├── RiverTranscript.test.tsx         (REWRITE — Task 7)
│       ├── StatusLine.tsx                   (REWRITE — Task 7)
│       ├── StateOverlay.tsx                 (REWRITE: reconnecting/paused/ended only — Task 7)
│       ├── states.test.tsx                  (REWRITE — Task 7)
│       ├── ControlsSheet.tsx                (REWRITE: role removed — Task 7)
│       ├── ControlsSheet.test.tsx           (REWRITE — Task 7)
│       ├── OnboardingView.tsx(+.test)       (DELETED — Task 1)
├── engines/socket-client.ts(+test)          (MODIFY: add sendJson — Task 8)
├── routes/Conversation.tsx                  (REWRITE — Task 9)
└── App.tsx / App.test.tsx                   (MODIFY — Task 9)
scripts/duo-e2e-probe.mjs                    (NEW: live-API E2E probe — Task 10)
```

---

## Task 1: Demolition + shared protocol types

**Files:**
- Modify: `shared/src/index.ts`
- Delete: `server/src/conversation-session.ts`, `server/src/conversation-manager.ts`, `server/src/active-speaker-router.ts`, `server/src/conversation-session.test.ts`, `server/src/conversation-manager.test.ts`, `server/src/active-speaker-router.test.ts`
- Modify: `server/src/index.ts` (remove room machinery; transport replacement lands in Task 3)
- Delete: `web/src/conversation/types.ts`, `web/src/conversation/reducer.ts`, `web/src/conversation/reducer.test.ts`, `web/src/conversation/i18n.test.tsx`, `web/src/conversation/use-conversation.ts`, `web/src/conversation/components/OnboardingView.tsx`, `web/src/conversation/components/OnboardingView.test.tsx`, `web/src/conversation/components/RiverTranscript.tsx`, `web/src/conversation/components/RiverTranscript.test.tsx`, `web/src/conversation/components/StatusLine.tsx`, `web/src/conversation/components/StateOverlay.tsx`, `web/src/conversation/components/states.test.tsx`, `web/src/conversation/components/ControlsSheet.tsx`, `web/src/conversation/components/ControlsSheet.test.tsx`, `web/src/routes/Conversation.tsx`
- Keep: `web/src/conversation/i18n.ts` (updated Task 5), `web/src/conversation/components/BottomSheet.tsx`, `web/src/conversation/components/ErrorLine.tsx` (+ its test), `web/src/auth/`
- Modify: `web/src/App.tsx`, `web/src/App.test.tsx`

- [ ] **Step 1: Replace the conversation types** in `shared/src/index.ts`. Delete `Role`, `RoomInfoMessage`, `StatusMessage`, `DeltaMessage`, `TurnEndMessage` (old shapes), `CreateRoomRequest`, `CreateRoomResponse`, `UpdateConfigRequest`, `EndRoomRequest`; keep `ConfigMessage`, `AudioMessage`, `TranslationWsMessage`, `TranscriptionMessage`. Add:

```ts
// ---- Conversation (single-device push-to-talk) WS protocol ----
// Client -> server control frames (JSON text frames; audio is raw binary PCM):

export interface ConversationStartMessage {
  type: 'start';
  languages: [string, string];
  voiceOver: boolean;
  voiceClone: boolean;
}

export interface ConversationDirectionMessage {
  type: 'direction';
  /** Source language being spoken (one of the pair), or null on release. */
  from: string | null;
}

export type ConversationClientMessage = ConversationStartMessage | ConversationDirectionMessage;

// Server -> client (one JSON object per text frame):

export interface StatusMessage { type: 'status'; state: 'ready' | 'ended' }

export interface DeltaMessage {
  type: 'delta';
  field: 'original' | 'translation';
  /** Language of `text` (original -> source lang, translation -> target lang). */
  lang: string;
  text: string;
}

/** `lang` = SOURCE language of the finalized turn. */
export interface TurnEndMessage { type: 'turnEnd'; lang: string }

export interface ErrorMessage { type: 'error'; message: string }

export type ConversationWsMessage =
  | ConfigMessage | StatusMessage | DeltaMessage | TurnEndMessage | AudioMessage | ErrorMessage;

// ---- REST contracts ----

export interface UpdateConfigRequest { voiceOver?: boolean; voiceClone?: boolean }
```

- [ ] **Step 2: Delete the old server conversation implementation** — the 6 server files listed above (`git rm`).

- [ ] **Step 3: Strip `server/src/index.ts`** so the server compiles without the room machinery:
  - Remove the imports of `ConversationManager`, `ConversationTransport`/`WS_CONVERSATION_PATH`, `ConversationSession`, `getLocalIP`/`generateQRCodeForUrl` **if** they are only used by conversation code (check: `getLocalIP` may be shared — keep if used elsewhere), and the `conversationManager`/`conversationTransport` consts.
  - In the WS upgrade router, remove the `else if (path === WS_CONVERSATION_PATH)` branch (leave the `browserAudioSource` branch and a final no-op/destroy for unknown paths exactly as the surrounding code already handles it).
  - Delete the three conversation REST routes (`create`, `config`, `end` — the whole `// --- conversation routes ---` block) and the `conversationManager.on('error', ...)` listener.
  - Keep `/conversation` SPA route, `/assets` mount, and everything else.
  - The file must compile: `npm -w server run typecheck` exit 0.

- [ ] **Step 4: Delete the old client conversation code** — the web files listed above (`git rm`), keeping the three carried-over files.

- [ ] **Step 5: Stub the route** — in `web/src/App.tsx`, remove the `Conversation` import and change the route back to the placeholder:
```tsx
      <Route path="/conversation" element={<Home />} />
```
In `web/src/App.test.tsx`, delete the `mounts /conversation without crashing` test (added back in Task 9).

- [ ] **Step 6: Run → green.** `npm -w server run typecheck` exit 0; `npm -w server test` → 4 files green (session-manager, audio-broadcaster, qwen-translation-session, env). `npm -w web run typecheck` exit 0; `npm -w web test` → engines + auth-context + App + ErrorLine green.

- [ ] **Step 7: Commit** — `refactor(v2): remove two-device conversation, define single-device protocol`.

---

## Task 2: DuoSession (server core, TDD)

**Files:**
- Create: `server/src/duo-session.ts`, `server/src/duo-session.test.ts`

**Interfaces:**
- Consumes: `QwenTranslationSession` (real, default factory), the Task 1 protocol types.
- Produces: `DuoSession` (`attach`, `start`, `setDirection`, `handleAudio`, `setConfig`, `stop`), types `TranslationSession`, `SessionFactory`, `DuoClient`, `DuoConfig`, `DuoSessionOptions` — consumed by Task 3's transport.

- [ ] **Step 1: Write the failing test** `server/src/duo-session.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { DuoSession, type SessionFactory } from './duo-session.js';
import type { ConversationWsMessage } from '@v2/shared';

class StubSession extends EventEmitter {
  src: string;
  tgt: string;
  sentAudio: Buffer[] = [];
  connectCalled = false;
  disconnectCalled = false;
  constructor(src: string, tgt: string) {
    super();
    this.src = src;
    this.tgt = tgt;
  }
  async connect(): Promise<void> { this.connectCalled = true; }
  sendAudio(pcm: Buffer): void { this.sentAudio.push(pcm); }
  async disconnect(): Promise<void> { this.disconnectCalled = true; }
}

function make(opts: { voiceOver?: boolean } = {}) {
  vi.useFakeTimers();
  const made: StubSession[] = [];
  const factory: SessionFactory = (src, tgt) => {
    const s = new StubSession(src, tgt);
    made.push(s);
    return s as never;
  };
  const session = new DuoSession({
    apiKey: 'key',
    languages: ['en', 'ko'],
    config: { voiceOver: opts.voiceOver ?? false, voiceClone: false },
    sessionFactory: factory,
    reconnectBaseDelay: 1000,
  });
  const sent: ConversationWsMessage[] = [];
  session.attach({ send: (m) => sent.push(m) });
  return { session, made, sent };
}

describe('DuoSession', () => {
  it('start creates both directions (A→B, B→A) and connects both', async () => {
    const { session, made } = make();
    await session.start();
    expect(made.map((s) => `${s.src}>${s.tgt}`)).toEqual(['en>ko', 'ko>en']);
    expect(made.every((s) => s.connectCalled)).toBe(true);
  });

  it('attach immediately echoes config', () => {
    const { sent } = make();
    expect(sent[0]).toEqual({ type: 'config', voiceOver: false, voiceClone: false });
  });

  it('routes PCM only to the active direction; drops it when none', async () => {
    const { session, made } = make();
    await session.start();
    session.handleAudio(Buffer.from([1]));
    expect(made[0].sentAudio).toHaveLength(0);
    session.setDirection('en');
    session.handleAudio(Buffer.from([2]));
    session.setDirection('ko');
    session.handleAudio(Buffer.from([3]));
    expect(made[0].sentAudio).toEqual([Buffer.from([2])]);
    expect(made[1].sentAudio).toEqual([Buffer.from([3])]);
  });

  it('emits turnEnd with the previous source language on switch and release', async () => {
    const { session, sent } = make();
    await session.start();
    session.setDirection('en');
    session.setDirection('ko');
    session.setDirection(null);
    const ends = sent.filter((m) => m.type === 'turnEnd');
    expect(ends).toEqual([{ type: 'turnEnd', lang: 'en' }, { type: 'turnEnd', lang: 'ko' }]);
  });

  it('ignores a direction outside the pair', async () => {
    const { session, sent } = make();
    await session.start();
    session.setDirection('fr');
    session.handleAudio(Buffer.from([1]));
    expect(sent.filter((m) => m.type === 'turnEnd')).toHaveLength(0);
  });

  it('maps inputTranscription → original delta (src lang), outputTranscription → translation delta (tgt lang)', async () => {
    const { session, made, sent } = make();
    await session.start();
    made[0].emit('inputTranscription', 'hello');
    made[0].emit('outputTranscription', '안녕');
    expect(sent).toContainEqual({ type: 'delta', field: 'original', lang: 'en', text: 'hello' });
    expect(sent).toContainEqual({ type: 'delta', field: 'translation', lang: 'ko', text: '안녕' });
  });

  it('relays audio only when voiceOver is on', async () => {
    const off = make();
    await off.session.start();
    off.made[0].emit('audio', Buffer.from([9]));
    expect(off.sent.filter((m) => m.type === 'audio')).toHaveLength(0);

    const on = make({ voiceOver: true });
    await on.session.start();
    on.made[0].emit('audio', Buffer.from([9]));
    expect(on.sent).toContainEqual({ type: 'audio', data: Buffer.from([9]).toString('base64') });
  });

  it('setConfig change broadcasts config, turnEnds both, and replaces both sessions', async () => {
    const { session, made, sent } = make();
    await session.start();
    await session.setConfig({ voiceOver: true });
    expect(sent).toContainEqual({ type: 'config', voiceOver: true, voiceClone: false });
    expect(sent.filter((m) => m.type === 'turnEnd')).toHaveLength(2);
    expect(made[0].disconnectCalled && made[1].disconnectCalled).toBe(true);
    expect(made).toHaveLength(4); // 2 original + 2 replacements
  });

  it('reconnects a closed session with backoff, but not on 1008/unauthorized', async () => {
    const { session, made } = make();
    await session.start();
    made[0].emit('closed', { reason: '1008' });
    vi.advanceTimersByTime(5000);
    expect(made).toHaveLength(2); // no reconnect
    made[1].emit('closed', { reason: 'network blip' });
    expect(made).toHaveLength(2);
    vi.advanceTimersByTime(1001);
    await vi.advanceTimersByTimeAsync(0);
    expect(made).toHaveLength(3); // direction 1 replaced
  });

  it('stop sends status ended and disconnects both', async () => {
    const { session, made, sent } = make();
    await session.start();
    await session.stop();
    expect(sent).toContainEqual({ type: 'status', state: 'ended' });
    expect(made.every((s) => s.disconnectCalled)).toBe(true);
  });
});
```

- [ ] **Step 2: Run → fail** (`Cannot find module './duo-session.js'`).

- [ ] **Step 3: Implement** `server/src/duo-session.ts`:

```ts
import { EventEmitter } from 'events';
import { QwenTranslationSession } from './qwen-translation-session.js';
import type { ConversationWsMessage } from '@v2/shared';

/** Minimal contract for a directional translation session (real Qwen or stub). */
export type TranslationSession = EventEmitter & {
  connect(): Promise<void>;
  sendAudio(pcm: Buffer): void;
  disconnect(): Promise<void>;
};

export type SessionFactory = (sourceLanguage: string, targetLanguage: string) => TranslationSession;

export interface DuoConfig {
  voiceOver: boolean;
  voiceClone: boolean;
}

/** Outbound sink for the single attached client socket. */
export interface DuoClient {
  send(msg: ConversationWsMessage): void;
}

export interface DuoSessionOptions {
  apiKey: string;
  languages: [string, string];
  config?: Partial<DuoConfig>;
  sessionFactory?: SessionFactory;
  reconnectBaseDelay?: number;
}

/** Payload emitted with the `closed` event from a translation session. */
export interface SessionClosedInfo {
  reason?: string;
}

/**
 * Single-device conversation: two warm one-directional Qwen sessions (A→B and
 * B→A). The client picks the active direction explicitly (push-to-talk);
 * incoming PCM is routed to that direction's session. Config changes are
 * applied by reconnecting both sessions (Qwen rejects mid-stream updates).
 */
export class DuoSession extends EventEmitter {
  private _apiKey: string;
  private _languages: [string, string];
  private _config: DuoConfig;
  private _reconnectBaseDelay: number;
  private _sessionFactory: SessionFactory;
  private _sessions: [TranslationSession | null, TranslationSession | null] = [null, null];
  private _client: DuoClient | null = null;
  private _direction: 0 | 1 | null = null;
  private _started = false;
  private _reconnectAttempts: [number, number] = [0, 0];
  private _reconnecting: [boolean, boolean] = [false, false];

  constructor({
    apiKey,
    languages,
    config = {},
    sessionFactory,
    reconnectBaseDelay = 2000,
  }: DuoSessionOptions) {
    super();
    this._apiKey = apiKey;
    this._languages = languages;
    this._config = { voiceOver: !!config.voiceOver, voiceClone: !!config.voiceClone };
    this._reconnectBaseDelay = reconnectBaseDelay;
    this._sessionFactory =
      sessionFactory ||
      ((src, tgt) => {
        const modalities = this._config.voiceOver ? ['text', 'audio'] : ['text'];
        return new QwenTranslationSession(apiKey, tgt, {}, {
          sourceLanguage: src,
          modalities,
          enableVoiceClone: this._config.voiceOver && this._config.voiceClone,
        });
      });
  }

  attach(client: DuoClient): void {
    this._client = client;
    client.send({ type: 'config', ...this._config });
  }

  async start(): Promise<void> {
    for (const i of [0, 1] as const) this._sessions[i] = this._makeSession(i);
    await Promise.all(this._sessions.map((s) => s!.connect()));
    this._started = true;
  }

  setDirection(from: string | null): void {
    let next: 0 | 1 | null = null;
    if (from !== null) {
      if (from === this._languages[0]) next = 0;
      else if (from === this._languages[1]) next = 1;
      else return; // language outside the pair — ignore
    }
    const prev = this._direction;
    if (prev === next) return;
    if (prev !== null) this._send({ type: 'turnEnd', lang: this._languages[prev] });
    this._direction = next;
  }

  handleAudio(pcm: Buffer): void {
    if (!this._started || this._direction === null) return;
    this._sessions[this._direction]?.sendAudio(pcm);
  }

  async setConfig({ voiceOver, voiceClone }: Partial<DuoConfig> = {}): Promise<void> {
    const next: DuoConfig = {
      voiceOver: voiceOver !== undefined ? !!voiceOver : this._config.voiceOver,
      voiceClone: voiceClone !== undefined ? !!voiceClone : this._config.voiceClone,
    };
    const changed =
      next.voiceOver !== this._config.voiceOver || next.voiceClone !== this._config.voiceClone;
    this._config = next;
    this._send({ type: 'config', ...this._config });
    if (changed && this._started) {
      for (const i of [0, 1] as const) this._send({ type: 'turnEnd', lang: this._languages[i] });
      await Promise.allSettled(([0, 1] as const).map((i) => this._replaceSession(i)));
    }
  }

  async stop(): Promise<void> {
    this._started = false;
    this._send({ type: 'status', state: 'ended' });
    await Promise.allSettled(
      ([0, 1] as const).map(async (i) => {
        try {
          await this._sessions[i]?.disconnect();
        } catch {
          /* ignore */
        }
      }),
    );
  }

  // ---- internals ----

  private _send(msg: ConversationWsMessage): void {
    this._client?.send(msg);
  }

  private _makeSession(i: 0 | 1): TranslationSession {
    const s = this._sessionFactory(this._languages[i], this._languages[1 - i]);
    this._wire(i, s);
    return s;
  }

  private _wire(i: 0 | 1, s: TranslationSession): void {
    const src = this._languages[i];
    const tgt = this._languages[1 - i];
    s.on('inputTranscription', (text: string) =>
      this._send({ type: 'delta', field: 'original', lang: src, text }),
    );
    s.on('outputTranscription', (text: string) =>
      this._send({ type: 'delta', field: 'translation', lang: tgt, text }),
    );
    s.on('audio', (buf: Buffer) => {
      if (this._config.voiceOver) this._send({ type: 'audio', data: buf.toString('base64') });
    });
    s.on('error', (error: unknown) => this.emit('error', { direction: src, error }));
    s.on('closed', (info: SessionClosedInfo) => {
      if (this._started) this._reconnectDirection(i, info);
    });
  }

  private async _replaceSession(i: 0 | 1): Promise<void> {
    const old = this._sessions[i];
    if (old) {
      try {
        old.removeAllListeners();
      } catch {
        /* ignore */
      }
      try {
        await old.disconnect();
      } catch {
        /* ignore */
      }
    }
    const s = this._makeSession(i);
    this._sessions[i] = s;
    try {
      await s.connect();
    } catch (err) {
      this.emit('error', {
        direction: this._languages[i],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private _reconnectDirection(i: 0 | 1, info: SessionClosedInfo = {}): void {
    if (this._reconnecting[i] || !this._started) return;
    const reason = info.reason || '';
    if (/unauthorized|1008/i.test(reason)) return; // don't reconnect auth errors
    this._reconnecting[i] = true;
    const attempts = this._reconnectAttempts[i] + 1;
    this._reconnectAttempts[i] = attempts;
    const delay = Math.min(60000, this._reconnectBaseDelay * 2 ** (attempts - 1));
    console.log(
      `[duo:${this._languages[i]}] session closed (${reason}) — reconnecting in ${delay}ms (attempt ${attempts})`,
    );
    setTimeout(() => {
      this._reconnecting[i] = false;
      if (!this._started) return;
      this._replaceSession(i)
        .then(() => {
          this._reconnectAttempts[i] = 0;
        })
        .catch((err: unknown) =>
          this.emit('error', {
            direction: this._languages[i],
            error: err instanceof Error ? err.message : String(err),
          }),
        );
    }, delay);
  }
}
```

- [ ] **Step 4: Run → pass** (`npm -w server run typecheck` exit 0; `cd server && npx vitest run src/duo-session.test.ts` → 10 tests pass; full server suite green).

- [ ] **Step 5: Commit** — `feat(v2): DuoSession (two warm directions + PTT routing)`.

---

## Task 3: ConversationTransport rewrite + REST endpoints

**Files:**
- Rewrite: `server/src/conversation-transport.ts`, `server/src/conversation-transport.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: `DuoSession` + `SessionFactory` (Task 2), `env.apiKeys.qwen`.
- Produces: `ConversationTransport` (`handleUpgrade(req, socket, head)`, `setConfig(cfg): Promise<boolean>`), `WS_CONVERSATION_PATH`; REST `POST /api/conversation/session` + `POST /api/conversation/config`. Consumed by `index.ts` (this task) and the client hook (Task 8).

- [ ] **Step 1: Write the failing test** `server/src/conversation-transport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { ConversationTransport, WS_CONVERSATION_PATH } from './conversation-transport.js';
import type { SessionFactory } from './duo-session.js';

class StubSession extends EventEmitter {
  src: string;
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
```

- [ ] **Step 2: Run → fail** (old transport fails these: no `startTimeoutMs`, token-based).

- [ ] **Step 3: Implement** `server/src/conversation-transport.ts`:

```ts
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { DuoSession, type SessionFactory, type DuoConfig } from './duo-session.js';

export const WS_CONVERSATION_PATH = '/ws/conversation';

export interface ConversationTransportOptions {
  apiKey: string;
  sessionFactory?: SessionFactory;
  /** Max wait for the first `start` frame before closing 1008. Default 5000. */
  startTimeoutMs?: number;
}

interface Live {
  session: DuoSession;
  ws: WebSocket;
}

function isValidStart(msg: unknown): msg is { type: 'start'; languages: [string, string]; voiceOver: boolean; voiceClone: boolean } {
  const m = msg as { type?: unknown; languages?: unknown };
  return (
    m?.type === 'start' &&
    Array.isArray(m.languages) &&
    m.languages.length === 2 &&
    typeof m.languages[0] === 'string' && m.languages[0].length > 0 &&
    typeof m.languages[1] === 'string' && m.languages[1].length > 0 &&
    m.languages[0] !== m.languages[1]
  );
}

/**
 * noServer WebSocketServer for `/ws/conversation` — single-device mode.
 * The first text frame must be `start` (within startTimeoutMs); a DuoSession is
 * created for that pair. One live session at a time: a new `start` replaces it.
 */
export class ConversationTransport {
  private _apiKey: string;
  private _sessionFactory?: SessionFactory;
  private _startTimeoutMs: number;
  private _wss: WebSocketServer;
  private _live: Live | null = null;

  constructor({ apiKey, sessionFactory, startTimeoutMs = 5000 }: ConversationTransportOptions) {
    this._apiKey = apiKey;
    this._sessionFactory = sessionFactory;
    this._startTimeoutMs = startTimeoutMs;
    this._wss = new WebSocketServer({ noServer: true });
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this._wss.handleUpgrade(req, socket, head, (ws: WebSocket) => this._onConnection(ws));
  }

  /** Applies a config change to the live session. Returns false when no session is live. */
  async setConfig(cfg: Partial<DuoConfig>): Promise<boolean> {
    if (!this._live) return false;
    await this._live.session.setConfig(cfg);
    return true;
  }

  private _onConnection(ws: WebSocket): void {
    let started = false;
    const timeout = setTimeout(() => {
      if (!started) ws.close(1008, 'start required');
    }, this._startTimeoutMs);

    ws.on('message', (data: unknown, isBinary: boolean) => {
      if (started) {
        if (isBinary) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          this._live?.session.handleAudio(buf);
          return;
        }
        let msg: { type?: unknown; from?: unknown };
        try {
          msg = JSON.parse(String(data));
        } catch {
          return; // ignore non-JSON text frames
        }
        if (msg.type === 'direction') {
          this._live?.session.setDirection(typeof msg.from === 'string' ? msg.from : null);
        }
        return;
      }

      // First frame must be a valid `start`.
      if (isBinary) return;
      let msg: unknown;
      try {
        msg = JSON.parse(String(data));
      } catch {
        ws.close(1008, 'bad start');
        return;
      }
      if (!isValidStart(msg)) {
        ws.close(1008, 'bad start');
        return;
      }
      started = true;
      clearTimeout(timeout);

      // One live session: replace any previous one.
      if (this._live) {
        const old = this._live;
        this._live = null;
        void old.session.stop();
        old.ws.close(1008, 'session replaced');
      }

      const session = new DuoSession({
        apiKey: this._apiKey,
        languages: [msg.languages[0], msg.languages[1]],
        config: { voiceOver: !!msg.voiceOver, voiceClone: !!msg.voiceClone },
        sessionFactory: this._sessionFactory,
      });
      session.on('error', ({ direction, error }: { direction: string; error: unknown }) => {
        console.error(`[duo:${direction}] error:`, error instanceof Error ? error.message : error);
      });
      session.attach({
        send: (m) => {
          if (ws.readyState === 1) ws.send(JSON.stringify(m));
        },
      });
      this._live = { session, ws };
      session
        .start()
        .then(() => {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'status', state: 'ready' }));
        })
        .catch((err: unknown) => {
          if (ws.readyState === 1)
            ws.send(JSON.stringify({ type: 'error', message: (err as Error)?.message ?? String(err) }));
        });
      ws.on('close', () => {
        if (this._live?.ws === ws) {
          this._live = null;
          void session.stop();
        }
      });
    });
  }
}
```

- [ ] **Step 4: Wire `server/src/index.ts`:**
  - Imports: replace the deleted ones with `import { ConversationTransport, WS_CONVERSATION_PATH } from './conversation-transport.js';` (keep `env.apiKeys`).
  - Replace the removed consts with:
    ```ts
    const conversationTransport = new ConversationTransport({ apiKey: apiKeys.qwen ?? '' });
    ```
  - In the WS upgrade router, restore the branch:
    ```ts
    } else if (path === WS_CONVERSATION_PATH) {
      conversationTransport.handleUpgrade(req, socket, head);
    }
    ```
  - Add the two REST routes (where the old conversation routes were):
    ```ts
    // --- conversation routes (single-device) --------------------------------
    app.post('/api/conversation/session', requireAdmin, (_req, res) => {
      if (!apiKeys.qwen) {
        res.status(400).json({ error: 'No Qwen API key configured (DASHSCOPE_API_KEY)' });
        return;
      }
      res.json({ ok: true });
    });

    app.post('/api/conversation/config', requireAdmin, async (req, res) => {
      const { voiceOver, voiceClone } = (req.body ?? {}) as { voiceOver?: boolean; voiceClone?: boolean };
      const applied = await conversationTransport.setConfig({ voiceOver, voiceClone });
      if (!applied) {
        res.status(404).json({ error: 'no live session' });
        return;
      }
      res.json({ ok: true });
    });
    ```

- [ ] **Step 5: Run → pass** (`npm -w server run typecheck` exit 0; `cd server && npx vitest run src/conversation-transport.test.ts` → 4 tests pass; full server suite green).

- [ ] **Step 6: Commit** — `feat(v2): single-device conversation transport + REST`.

---

## Task 4: Client reducer rewrite (turns keyed by language)

**Files:**
- Rewrite: `web/src/conversation/types.ts`, `web/src/conversation/reducer.ts`, `web/src/conversation/reducer.test.ts`

**Interfaces:**
- Produces: `createInitialState(): ConversationState`; `conversationReducer(state, action)`; types `ConversationState`, `Turn`, `Action`, `Phase`, `StatusKind`, `DuoConfigState`. Consumed by the hook (Task 8) and all components (Tasks 6–7, 9).

- [ ] **Step 1: Write the failing test** `web/src/conversation/reducer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { conversationReducer, createInitialState } from './reducer.js';

describe('conversationReducer (single-device)', () => {
  const s = () => createInitialState();

  it('groups consecutive same-language original deltas into one active turn', () => {
    let st = s();
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'How ' });
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'are you' });
    expect(st.turns).toHaveLength(1);
    expect(st.turns[0]).toMatchObject({ lang: 'en', original: 'How are you', active: true });
  });

  it('translation deltas join the most recent turn of the OTHER language', () => {
    let st = s();
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'hello' });
    st = conversationReducer(st, { type: 'delta', field: 'translation', lang: 'ko', text: '안녕' });
    expect(st.turns).toHaveLength(1);
    expect(st.turns[0].translation).toBe('안녕');
  });

  it('a new language starts a new turn and finalizes the previous', () => {
    let st = s();
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'a' });
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'ko', text: '가' });
    expect(st.turns).toHaveLength(2);
    expect(st.turns[0].active).toBe(false);
    expect(st.turns[1]).toMatchObject({ lang: 'ko', active: true });
  });

  it('turnEnd finalizes that language’s turn; translation may still append after release', () => {
    let st = s();
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'a' });
    st = conversationReducer(st, { type: 'turnEnd', lang: 'en' });
    expect(st.turns[0].active).toBe(false);
    st = conversationReducer(st, { type: 'delta', field: 'translation', lang: 'ko', text: '가' });
    expect(st.turns[0].translation).toBe('가'); // late translation still lands on the turn
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'b' });
    expect(st.turns).toHaveLength(2);
  });

  it('direction: a second press while one is held is ignored; release clears', () => {
    let st = s();
    st = conversationReducer(st, { type: 'direction', from: 'en' });
    st = conversationReducer(st, { type: 'direction', from: 'ko' });
    expect(st.activeDirection).toBe('en');
    st = conversationReducer(st, { type: 'direction', from: null });
    expect(st.activeDirection).toBeNull();
  });

  it('status ready → live; status ended → ended + direction cleared', () => {
    let st = s();
    st = conversationReducer(st, { type: 'direction', from: 'en' });
    st = conversationReducer(st, { type: 'status', state: 'ready' });
    expect(st.phase).toBe('live');
    expect(st.status).toBe('ready');
    st = conversationReducer(st, { type: 'status', state: 'ended' });
    expect(st.phase).toBe('ended');
    expect(st.activeDirection).toBeNull();
  });

  it('reconnecting/reconnected preserve ended', () => {
    let st = s();
    st = conversationReducer(st, { type: 'status', state: 'ready' });
    st = conversationReducer(st, { type: 'reconnecting' });
    expect(st.status).toBe('reconnecting');
    st = conversationReducer(st, { type: 'reconnected' });
    expect(st.status).toBe('ready');
    st = conversationReducer(st, { type: 'end' });
    st = conversationReducer(st, { type: 'reconnecting' });
    expect(st.status).toBe('ended');
  });

  it('pause/resume, config, error/clearError', () => {
    let st = s();
    st = conversationReducer(st, { type: 'pause' });
    expect(st.paused).toBe(true);
    st = conversationReducer(st, { type: 'resume' });
    expect(st.paused).toBe(false);
    st = conversationReducer(st, { type: 'config', config: { voiceOver: true, voiceClone: true } });
    expect(st.config).toEqual({ voiceOver: true, voiceClone: true });
    st = conversationReducer(st, { type: 'error', message: 'mic_blocked' });
    expect(st.error).toBe('mic_blocked');
    st = conversationReducer(st, { type: 'clearError' });
    expect(st.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fail** (modules deleted in Task 1).

- [ ] **Step 3: Implement** `web/src/conversation/types.ts`:

```ts
export type Phase = 'setup' | 'connecting' | 'live' | 'ended';

/** Connection/session status. `paused` is a separate client flag. */
export type StatusKind = 'connecting' | 'ready' | 'reconnecting' | 'ended';

export interface Turn {
  id: string;
  /** Source language of this turn (the language that was spoken). */
  lang: string;
  original: string;
  translation: string;
  /** Currently spoken turn — emphasized in the river. */
  active: boolean;
}

export interface DuoConfigState {
  voiceOver: boolean;
  voiceClone: boolean;
}

export interface ConversationState {
  phase: Phase;
  /** Chosen pair [A, B]; null until setup completes. */
  languages: [string, string] | null;
  /** Source language currently held (push-to-talk), or null. */
  activeDirection: string | null;
  turns: Turn[];
  status: StatusKind;
  paused: boolean;
  config: DuoConfigState;
  error: string | null;
}

export type Action =
  | { type: 'setLanguages'; languages: [string, string] }
  | { type: 'setPhase'; phase: Phase }
  | { type: 'config'; config: DuoConfigState }
  | { type: 'status'; state: 'ready' | 'ended' }
  | { type: 'direction'; from: string | null }
  | { type: 'delta'; field: 'original' | 'translation'; lang: string; text: string }
  | { type: 'turnEnd'; lang: string }
  | { type: 'reconnecting' }
  | { type: 'reconnected' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'end' }
  | { type: 'error'; message: string }
  | { type: 'clearError' };
```

Then `web/src/conversation/reducer.ts`:

```ts
import type { Action, ConversationState, Turn } from './types.js';

export function createInitialState(): ConversationState {
  return {
    phase: 'setup',
    languages: null,
    activeDirection: null,
    turns: [],
    status: 'connecting',
    paused: false,
    config: { voiceOver: false, voiceClone: false },
    error: null,
  };
}

export function conversationReducer(state: ConversationState, action: Action): ConversationState {
  switch (action.type) {
    case 'setLanguages':
      return { ...state, languages: action.languages };

    case 'setPhase':
      return { ...state, phase: action.phase };

    case 'config':
      return { ...state, config: action.config };

    case 'status':
      if (action.state === 'ended')
        return { ...state, status: 'ended', phase: 'ended', activeDirection: null };
      return { ...state, status: 'ready', phase: 'live' };

    case 'direction': {
      // A second press while one is held is ignored (single active direction).
      if (action.from !== null && state.activeDirection !== null && action.from !== state.activeDirection)
        return state;
      return { ...state, activeDirection: action.from };
    }

    case 'delta': {
      const { field, lang, text } = action;
      const turns = state.turns;
      if (field === 'translation') {
        // Joins the most recent turn of the OTHER language — including an
        // already-finalized turn (translations may lag the release).
        for (let i = turns.length - 1; i >= 0; i--) {
          if (turns[i].lang !== lang) {
            const updated: Turn = { ...turns[i], translation: turns[i].translation + text };
            return { ...state, turns: [...turns.slice(0, i), updated, ...turns.slice(i + 1)] };
          }
        }
        return state; // no source turn yet — drop
      }
      const last = turns[turns.length - 1];
      if (last && last.lang === lang && last.active) {
        const updated: Turn = { ...last, original: last.original + text };
        return { ...state, turns: [...turns.slice(0, -1), updated] };
      }
      const fresh: Turn = { id: `${lang}-${turns.length}`, lang, original: text, translation: '', active: true };
      return { ...state, turns: [...turns.map((t) => ({ ...t, active: false })), fresh] };
    }

    case 'turnEnd':
      return {
        ...state,
        turns: state.turns.map((t) =>
          t.lang === action.lang && t.active ? { ...t, active: false } : t,
        ),
      };

    case 'reconnecting':
      return { ...state, status: state.status === 'ended' ? 'ended' : 'reconnecting' };

    case 'reconnected':
      return { ...state, status: state.status === 'ended' ? 'ended' : 'ready' };

    case 'pause':
      return { ...state, paused: true };

    case 'resume':
      return { ...state, paused: false };

    case 'end':
      return { ...state, phase: 'ended', status: 'ended', paused: false, activeDirection: null };

    case 'error':
      return { ...state, error: action.message };

    case 'clearError':
      return { ...state, error: null };

    default:
      return state;
  }
}
```

- [ ] **Step 4: Run → pass** (`npm -w web run typecheck` exit 0; `cd web && npx vitest run src/conversation/reducer.test.ts` → 8 tests pass).

- [ ] **Step 5: Commit** — `feat(v2): language-keyed conversation reducer`.

---

## Task 5: languages.ts + i18n key set

**Files:**
- Create: `web/src/conversation/languages.ts`, `web/src/conversation/languages.test.ts`
- Modify: `web/src/conversation/i18n.ts`, rewrite `web/src/conversation/i18n.test.tsx`

**Interfaces:**
- Produces: `LANGUAGES: LanguageMeta[]` (`{ code, name, native, ptt }`), `nativeName(code): string`, `colorFor(index: 0|1): string` (hex); updated `STRINGS` key set. Consumed by Tasks 6–9.

- [ ] **Step 1: Write the failing tests.** `web/src/conversation/languages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LANGUAGES, nativeName, colorFor } from './languages.js';

describe('languages', () => {
  it('offers the 5 supported languages with unique codes and native PTT phrases', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en', 'ko', 'zh', 'ja', 'es']);
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(5);
    for (const l of LANGUAGES) {
      expect(l.native.length).toBeGreaterThan(0);
      expect(l.ptt.length).toBeGreaterThan(0);
    }
  });

  it('nativeName falls back to the code for unknown languages', () => {
    expect(nativeName('ko')).toBe('한국어');
    expect(nativeName('xx')).toBe('xx');
  });

  it('colorFor returns the pair colors by position', () => {
    expect(colorFor(0)).toBe('#c0623a');
    expect(colorFor(1)).toBe('#3a7a5a');
  });
});
```

And rewrite `web/src/conversation/i18n.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { STRINGS } from './i18n.js';

describe('i18n (single-device)', () => {
  it('STRINGS has matching en + ko keys', () => {
    expect(Object.keys(STRINGS.ko).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });

  it('keeps the keys the single-device UI uses', () => {
    const required = [
      'title', 'setup_subtitle', 'begin', 'connecting', 'hold_to_talk', 'listening',
      'paused', 'tap_resume', 'reconnecting', 'ended', 'warm_close', 'begin_another',
      'pause', 'resume', 'end', 'mic', 'mic_blocked', 'unauthorized',
      'admin_password', 'admin_continue', 'voice_over', 'voice_clone',
    ] as const;
    for (const key of required) {
      expect(STRINGS.en[key], `en.${key}`).toBeTruthy();
      expect(STRINGS.ko[key], `ko.${key}`).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run → fail** (`Cannot find module './languages.js'`; i18n test fails on missing keys).

- [ ] **Step 3: Implement** `web/src/conversation/languages.ts`:

```ts
/** Language metadata for the pair picker + PTT areas. */
export interface LanguageMeta {
  code: string;
  /** English name (menus, aria). */
  name: string;
  /** Native name (turn labels). */
  native: string;
  /** Full press-area label in the language itself. */
  ptt: string;
}

export const LANGUAGES: LanguageMeta[] = [
  { code: 'en', name: 'English', native: 'English', ptt: 'Hold to speak English' },
  { code: 'ko', name: 'Korean', native: '한국어', ptt: '한국어로 말하려면 누르세요' },
  { code: 'zh', name: 'Chinese', native: '中文', ptt: '按住说中文' },
  { code: 'ja', name: 'Japanese', native: '日本語', ptt: '押して日本語を話してください' },
  { code: 'es', name: 'Spanish', native: 'Español', ptt: 'Mantén para hablar español' },
];

export function nativeName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.native ?? code;
}

export function pttLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.ptt ?? code;
}

/** Pair-position colors: A = terracotta, B = warm green. */
export function colorFor(index: 0 | 1): string {
  return index === 0 ? '#c0623a' : '#3a7a5a';
}
```

Update `web/src/conversation/i18n.ts` — keep the `I18nProvider`/`useLocale`/`useT` machinery exactly as-is, but replace the `STRINGS` tables with:

```ts
export const STRINGS = {
  en: {
    title: 'Conversation',
    setup_subtitle: 'Pick the two languages.',
    begin: 'Begin',
    connecting: 'Connecting…',
    hold_to_talk: 'Hold a button to talk',
    listening: 'Listening…',
    paused: 'Paused.',
    tap_resume: 'Tap to resume.',
    reconnecting: 'Catching up… translation resumes in a moment.',
    ended: 'Conversation ended.',
    warm_close: 'A quiet, warm close.',
    begin_another: 'Start another conversation',
    pause: 'Pause',
    resume: 'Resume',
    end: 'End conversation',
    mic: 'Microphone',
    mic_blocked: 'Microphone blocked. Use HTTPS and grant permission.',
    unauthorized: 'Wrong admin password.',
    admin_password: 'Admin password',
    admin_continue: 'Continue',
    voice_over: 'Voice-over',
    voice_clone: 'Voice cloning',
  },
  ko: {
    title: '대화',
    setup_subtitle: '두 언어를 선택하세요.',
    begin: '시작',
    connecting: '연결 중…',
    hold_to_talk: '버튼을 눌러 말하세요',
    listening: '듣는 중…',
    paused: '일시정지됨.',
    tap_resume: '눌러서 다시 시작하세요.',
    reconnecting: '잠시만 기다려 주세요… 곧 번역이 다시 이어집니다.',
    ended: '대화가 종료되었습니다.',
    warm_close: '따뜻하게 마무리해요.',
    begin_another: '새 대화 시작하기',
    pause: '일시정지',
    resume: '계속',
    end: '대화 종료',
    mic: '마이크',
    mic_blocked: '마이크 차단됨. HTTPS로 접속하고 권한을 허용하세요.',
    unauthorized: '관리 비밀번호가 틀렸어요.',
    admin_password: '관리 비밀번호',
    admin_continue: '계속',
    voice_over: '음성 재생',
    voice_clone: '음성 복제',
  },
} as const;
```

- [ ] **Step 4: Run → pass** (`npm -w web run typecheck` exit 0; `cd web && npx vitest run src/conversation/` → languages + i18n + reducer green).

- [ ] **Step 5: Commit** — `feat(v2): language metadata + single-device i18n keys`.

---

## Task 6: SetupView (admin step + pair picker)

**Files:**
- Create: `web/src/conversation/components/SetupView.tsx`, `web/src/conversation/components/SetupView.test.tsx`

**Interfaces:**
- Consumes: `LANGUAGES` (Task 5), `useT` (Task 5), shadcn `Button`/`Input`.
- Produces: `<SetupView adminKey onSetAdminKey onBegin />` — `onBegin(languages: [string, string])`. Consumed by Task 9's page.

- [ ] **Step 1: Write the failing test** `web/src/conversation/components/SetupView.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SetupView } from './SetupView.js';
import { I18nProvider } from '../i18n.js';

const wrap = (ui: React.ReactNode) => <I18nProvider locale="en">{ui}</I18nProvider>;

const setup = (props: Partial<React.ComponentProps<typeof SetupView>> = {}) =>
  render(wrap(<SetupView adminKey="" onSetAdminKey={() => {}} onBegin={() => {}} {...props} />));

describe('SetupView', () => {
  it('without adminKey shows the admin step (no language pickers)', () => {
    const { getByText, queryByRole } = setup({ adminKey: '' });
    expect(getByText(/Admin password/i)).toBeTruthy();
    expect(queryByRole('combobox')).toBeNull();
  });

  it('admin Continue stores the key', () => {
    const onSetAdminKey = vi.fn();
    const { getByPlaceholderText, getByRole } = setup({ adminKey: '', onSetAdminKey });
    fireEvent.change(getByPlaceholderText(/Admin password/i), { target: { value: 'changeme' } });
    fireEvent.click(getByRole('button', { name: /Continue/i }));
    expect(onSetAdminKey).toHaveBeenCalledWith('changeme');
  });

  it('pair picker defaults to English ↔ Korean and Begin fires onBegin with the pair', () => {
    const onBegin = vi.fn();
    const { getByRole, getByDisplayValue } = setup({ adminKey: 'k', onBegin });
    expect(getByDisplayValue('English')).toBeTruthy();
    expect(getByDisplayValue('한국어')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: /Begin/i }));
    expect(onBegin).toHaveBeenCalledWith(['en', 'ko']);
  });

  it('Begin is disabled when both picks are the same language', () => {
    const { getAllByRole, getByRole } = setup({ adminKey: 'k' });
    const [first] = getAllByRole('combobox');
    fireEvent.change(first, { target: { value: 'ko' } });
    expect((getByRole('button', { name: /Begin/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run → fail** (`Cannot find module './SetupView.js'`).

- [ ] **Step 3: Implement** `web/src/conversation/components/SetupView.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '../i18n.js';
import { LANGUAGES } from '../languages.js';

interface Props {
  adminKey: string;
  onSetAdminKey: (v: string) => void;
  onBegin: (languages: [string, string]) => void;
}

export function SetupView({ adminKey, onSetAdminKey, onBegin }: Props) {
  const t = useT();
  const [admin, setAdmin] = useState('');
  const [langA, setLangA] = useState('en');
  const [langB, setLangB] = useState('ko');

  if (!adminKey) {
    return (
      <main className="mx-auto flex h-full max-w-sm flex-col justify-center px-6">
        <h1 className="text-2xl font-semibold">{t('admin_password')}</h1>
        <div className="mt-6 space-y-3">
          <Input
            type="password"
            placeholder={t('admin_password')}
            value={admin}
            onChange={(e) => setAdmin(e.target.value)}
          />
          <Button className="w-full" onClick={() => onSetAdminKey(admin)} disabled={!admin}>
            {t('admin_continue')}
          </Button>
        </div>
      </main>
    );
  }

  const same = langA === langB;
  return (
    <main className="mx-auto flex h-full max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{t('setup_subtitle')}</p>
      <div className="space-y-4">
        <select
          aria-label="language A"
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground"
          value={langA}
          onChange={(e) => setLangA(e.target.value)}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.native}</option>
          ))}
        </select>
        <select
          aria-label="language B"
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground"
          value={langB}
          onChange={(e) => setLangB(e.target.value)}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.native}</option>
          ))}
        </select>
        <Button className="w-full" disabled={same} onClick={() => onBegin([langA, langB])}>
          {t('begin')}
        </Button>
      </div>
    </main>
  );
}
```

> Note: the test uses `getByDisplayValue('English')` / `getByDisplayValue('한국어')` — these match the selected `<option>` text of each `<select>`; if the testing-library version doesn't match on selects, assert `(getAllByRole('combobox')[0] as HTMLSelectElement).value === 'en'` instead. Pick whichever passes; keep the assertion meaningful.

- [ ] **Step 4: Run → pass** (`npm -w web run typecheck` exit 0; `cd web && npx vitest run src/conversation/components/SetupView.test.tsx` → 4 tests pass).

- [ ] **Step 5: Commit** — `feat(v2): SetupView (admin gate + language pair picker)`.

---

## Task 7: Live-screen components (PressArea, River, StatusLine, StateOverlay, ControlsSheet)

**Files:**
- Create: `web/src/conversation/components/PressArea.tsx`, `web/src/conversation/components/PressArea.test.tsx`, `web/src/conversation/components/RiverTranscript.tsx`, `web/src/conversation/components/RiverTranscript.test.tsx`, `web/src/conversation/components/StatusLine.tsx`, `web/src/conversation/components/StateOverlay.tsx`, `web/src/conversation/components/states.test.tsx`, `web/src/conversation/components/ControlsSheet.tsx`, `web/src/conversation/components/ControlsSheet.test.tsx`

**Interfaces:**
- Consumes: `Turn`/`ConversationState` (Task 4), `nativeName`/`pttLabel`/`colorFor` (Task 5), `useT`, kept `BottomSheet`, shadcn `Switch`.
- Produces: `<PressArea label color held disabled onDown onUp />`, `<RiverTranscript turns languages />`, `<StatusLine status paused activeDirection />`, `<StateOverlay kind onResume onBeginAnother />` (`kind: 'reconnecting'|'paused'|'ended'`), `<ControlsSheet open config devices selectedDeviceId paused onClose onVoiceOver onVoiceClone onMic onPause onResume onEnd />` (no `role`). Consumed by Task 9.

- [ ] **Step 1: Write the failing tests.**

`PressArea.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { PressArea } from './PressArea.js';

describe('PressArea', () => {
  it('pointerdown fires onDown; pointerup and pointercancel fire onUp', () => {
    const onDown = vi.fn();
    const onUp = vi.fn();
    const { getByRole } = render(<PressArea label="Hold to speak English" color="#c0623a" held={false} disabled={false} onDown={onDown} onUp={onUp} />);
    const btn = getByRole('button');
    fireEvent.pointerDown(btn);
    expect(onDown).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(btn);
    fireEvent.pointerCancel(btn);
    expect(onUp).toHaveBeenCalledTimes(2);
  });

  it('disabled blocks onDown', () => {
    const onDown = vi.fn();
    const { getByRole } = render(<PressArea label="x" color="#000" held={false} disabled={true} onDown={onDown} onUp={() => {}} />);
    fireEvent.pointerDown(getByRole('button'));
    expect(onDown).not.toHaveBeenCalled();
  });

  it('held state is exposed via data-held', () => {
    const { getByRole } = render(<PressArea label="x" color="#000" held={true} disabled={false} onDown={() => {}} onUp={() => {}} />);
    expect(getByRole('button').getAttribute('data-held')).toBe('true');
  });
});
```

`RiverTranscript.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RiverTranscript } from './RiverTranscript.js';
import type { Turn } from '../types.js';

const turns = (active: number | null): Turn[] => [
  { id: 'en-0', lang: 'en', original: 'How long have you been here?', translation: '얼마나 오래 다니셨어요?', active: active === 0 },
  { id: 'ko-1', lang: 'ko', original: '작년부터요.', translation: 'Since last year.', active: active === 1 },
];

describe('RiverTranscript (single-device)', () => {
  it('every turn shows original as main AND translation as subtitle', () => {
    const { getByText } = render(<RiverTranscript turns={turns(null)} languages={['en', 'ko']} />);
    expect(getByText('How long have you been here?')).toBeTruthy();
    expect(getByText('얼마나 오래 다니셨어요?')).toBeTruthy();
    expect(getByText('작년부터요.')).toBeTruthy();
    expect(getByText('Since last year.')).toBeTruthy();
  });

  it('labels turns with the native language name in the pair-position color', () => {
    const { container } = render(<RiverTranscript turns={turns(null)} languages={['en', 'ko']} />);
    expect(container.querySelector('[class*="text-primary"]')?.textContent).toBe('English');
    expect(container.querySelector('[class*="text-[#3a7a5a]"]')?.textContent).toBe('한국어');
  });

  it('marks the active turn', () => {
    const { container } = render(<RiverTranscript turns={turns(1)} languages={['en', 'ko']} />);
    const active = container.querySelectorAll('[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain('작년부터요.');
  });
});
```

`states.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { StatusLine } from './StatusLine.js';
import { StateOverlay } from './StateOverlay.js';
import { I18nProvider } from '../i18n.js';

const wrap = (ui: React.ReactNode) => <I18nProvider locale="en">{ui}</I18nProvider>;

describe('StatusLine (single-device)', () => {
  it('idle → hold-to-talk hint', () => {
    const { getByText } = render(wrap(<StatusLine status="ready" paused={false} activeDirection={null} />));
    expect(getByText(/Hold a button to talk/)).toBeTruthy();
  });
  it('held direction → Listening… (native)', () => {
    const { getByText } = render(wrap(<StatusLine status="ready" paused={false} activeDirection="ko" />));
    expect(getByText(/Listening… \(한국어\)/)).toBeTruthy();
  });
  it('paused wins over held', () => {
    const { getByText } = render(wrap(<StatusLine status="ready" paused={true} activeDirection="en" />));
    expect(getByText(/Paused/)).toBeTruthy();
  });
});

describe('StateOverlay (single-device)', () => {
  it('paused offers resume; ended offers begin-another', () => {
    const onResume = vi.fn();
    const onBeginAnother = vi.fn();
    const p = render(wrap(<StateOverlay kind="paused" onResume={onResume} onBeginAnother={() => {}} />));
    fireEvent.click(p.getByText(/Tap to resume/i));
    expect(onResume).toHaveBeenCalled();
    const e = render(wrap(<StateOverlay kind="ended" onResume={() => {}} onBeginAnother={onBeginAnother} />));
    fireEvent.click(e.getByText(/another conversation/i));
    expect(onBeginAnother).toHaveBeenCalled();
  });
});
```

`ControlsSheet.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ControlsSheet } from './ControlsSheet.js';
import { I18nProvider } from '../i18n.js';

const wrap = (ui: React.ReactNode) => <I18nProvider locale="en">{ui}</I18nProvider>;
const base = {
  open: true,
  config: { voiceOver: false, voiceClone: false },
  devices: [{ deviceId: 'd1', kind: 'audioinput', label: 'AirPods', groupId: 'g' } as MediaDeviceInfo],
  selectedDeviceId: 'd1',
  paused: false,
  onClose: () => {}, onVoiceOver: () => {}, onVoiceClone: () => {},
  onMic: () => {}, onPause: () => {}, onResume: () => {}, onEnd: () => {},
};

describe('ControlsSheet (single-device)', () => {
  it('always shows voice-over + end (no role gating)', () => {
    const { getByText } = render(wrap(<ControlsSheet {...base} />));
    expect(getByText(/Voice-over/)).toBeTruthy();
    expect(getByText(/End conversation/)).toBeTruthy();
  });
  it('voice-clone appears only when voice-over is on', () => {
    const off = render(wrap(<ControlsSheet {...base} />));
    expect(off.queryByText(/Voice cloning/)).toBeNull();
    const on = render(wrap(<ControlsSheet {...base} config={{ voiceOver: true, voiceClone: false }} />));
    expect(on.getByText(/Voice cloning/)).toBeTruthy();
  });
  it('end fires onEnd; pause label flips to Resume when paused', () => {
    const onEnd = vi.fn();
    const { getByText, rerender } = render(wrap(<ControlsSheet {...base} onEnd={onEnd} />));
    fireEvent.click(getByText(/End conversation/));
    expect(onEnd).toHaveBeenCalled();
    rerender(wrap(<ControlsSheet {...base} paused={true} />));
    expect(getByText(/Resume/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run → fail** (modules don't exist).

- [ ] **Step 3: Implement** the five components.

`PressArea.tsx`:

```tsx
interface Props {
  label: string;
  /** Pair-position color (hex). */
  color: string;
  held: boolean;
  disabled: boolean;
  onDown: () => void;
  onUp: () => void;
}

export function PressArea({ label, color, held, disabled, onDown, onUp }: Props) {
  return (
    <button
      type="button"
      data-held={held}
      disabled={disabled}
      aria-label={label}
      className="flex flex-1 items-center justify-center rounded-2xl border-2 bg-card px-4 text-base font-semibold transition-colors select-none touch-none"
      style={
        held
          ? { background: color, borderColor: color, color: '#fff' }
          : { borderColor: color, color, opacity: disabled ? 0.35 : 1 }
      }
      onPointerDown={(e) => {
        e.preventDefault();
        if (disabled) return;
        try {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // jsdom / older browsers
        }
        onDown();
      }}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={onUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      🎤 {label}
    </button>
  );
}
```

`RiverTranscript.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import type { Turn } from '../types.js';
import { nativeName } from '../languages.js';

interface Props {
  turns: Turn[];
  languages: [string, string];
}

function RiverTurn({ turn, languages }: { turn: Turn; languages: [string, string] }) {
  const posClass = turn.lang === languages[0] ? 'text-primary' : 'text-[#3a7a5a]';
  return (
    <div data-active={turn.active ? 'true' : 'false'} className={turn.active ? 'mt-3' : 'mt-2 opacity-90'}>
      <div className={`text-xs font-bold tracking-wide ${posClass} ${turn.active ? 'text-sm' : ''}`}>
        {nativeName(turn.lang)}
      </div>
      <div className={`text-foreground ${turn.active ? 'text-base' : 'text-[15px]'} leading-relaxed`}>
        {turn.original}
      </div>
      {turn.translation ? (
        <div className="mt-0.5 ml-1 text-xs text-muted-foreground leading-relaxed">{turn.translation}</div>
      ) : null}
    </div>
  );
}

export function RiverTranscript({ turns, languages }: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);
  return (
    <div className="flex-1 overflow-y-auto px-5 py-4" aria-label="conversation transcript">
      {turns.map((t) => (
        <RiverTurn key={t.id} turn={t} languages={languages} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
```

`StatusLine.tsx`:

```tsx
import { useT } from '../i18n.js';
import { nativeName } from '../languages.js';
import type { ConversationState } from '../types.js';

interface Props {
  status: ConversationState['status'];
  paused: boolean;
  activeDirection: string | null;
}

export function StatusLine({ status, paused, activeDirection }: Props) {
  const t = useT();
  const text = paused
    ? t('paused')
    : activeDirection
      ? `${t('listening')} (${nativeName(activeDirection)})`
      : status === 'reconnecting'
        ? t('reconnecting')
        : status === 'connecting'
          ? t('connecting')
          : t('hold_to_talk');
  const dot = paused || status === 'reconnecting' ? 'bg-muted-foreground' : 'bg-primary';
  return (
    <div className="flex items-center gap-1.5 px-4 pt-3 text-xs text-muted-foreground">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      <span>{text}</span>
    </div>
  );
}
```

`StateOverlay.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { useT } from '../i18n.js';

interface Props {
  kind: 'reconnecting' | 'paused' | 'ended';
  onResume: () => void;
  onBeginAnother: () => void;
}

export function StateOverlay({ kind, onResume, onBeginAnother }: Props) {
  const t = useT();
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 px-8 text-center backdrop-blur-sm">
      <div className="max-w-sm space-y-2">
        {kind === 'reconnecting' && <p className="text-lg text-foreground">{t('reconnecting')}</p>}
        {kind === 'paused' && (
          <>
            <p className="text-lg text-foreground">{t('paused')}</p>
            <Button variant="link" className="text-primary" onClick={onResume}>{t('tap_resume')}</Button>
          </>
        )}
        {kind === 'ended' && (
          <>
            <p className="text-lg text-foreground">{t('ended')}</p>
            <p className="text-sm text-muted-foreground">{t('warm_close')}</p>
            <Button variant="outline" className="mt-2" onClick={onBeginAnother}>{t('begin_another')}</Button>
          </>
        )}
      </div>
    </div>
  );
}
```

`ControlsSheet.tsx`:

```tsx
import { Switch } from '@/components/ui/switch';
import { BottomSheet } from './BottomSheet.js';
import { useT } from '../i18n.js';
import type { DuoConfigState } from '../types.js';

interface Props {
  open: boolean;
  config: DuoConfigState;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  paused: boolean;
  onClose: () => void;
  onVoiceOver: (v: boolean) => void;
  onVoiceClone: (v: boolean) => void;
  onMic: (deviceId: string) => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
}

export function ControlsSheet(p: Props) {
  const t = useT();
  return (
    <BottomSheet open={p.open} onClose={p.onClose}>
      <div className="space-y-1">
        <Row label={`🔊 ${t('voice_over')}`}>
          <Switch checked={p.config.voiceOver} onCheckedChange={p.onVoiceOver} aria-label={t('voice_over')} />
        </Row>
        {p.config.voiceOver && (
          <Row label={t('voice_clone')} inset>
            <Switch checked={p.config.voiceClone} onCheckedChange={p.onVoiceClone} aria-label={t('voice_clone')} />
          </Row>
        )}

        <Row label={`🎤 ${t('mic')}`}>
          <select
            className="bg-transparent text-sm text-muted-foreground"
            value={p.selectedDeviceId}
            onChange={(e) => p.onMic(e.target.value)}
          >
            {p.devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `${t('mic')} ${i + 1}`}</option>
            ))}
          </select>
        </Row>

        <button
          className="flex w-full items-center justify-between py-2 text-sm text-foreground"
          onClick={p.paused ? p.onResume : p.onPause}
          aria-label={p.paused ? t('resume') : t('pause')}
        >
          <span>{p.paused ? t('resume') : t('pause')}</span>
        </button>

        <div className="border-t border-border pt-2">
          <button className="w-full py-2 text-left text-sm text-primary" onClick={p.onEnd}>{t('end')}</button>
        </div>
      </div>
    </BottomSheet>
  );
}

function Row({ label, inset, children }: { label: string; inset?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center justify-between py-2 ${inset ? 'pl-4' : ''}`}>
      <span className="text-sm text-foreground">{label}</span>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run → pass** (`npm -w web run typecheck` exit 0; `cd web && npx vitest run src/conversation/components/` → all component tests green; full web suite green).

- [ ] **Step 5: Commit** — `feat(v2): PTT live-screen components`.

---

## Task 8: SocketClient.sendJson + useConversation rewrite

**Files:**
- Modify: `web/src/engines/socket-client.ts`, `web/src/engines/socket-client.test.ts`
- Rewrite: `web/src/conversation/use-conversation.ts`

**Interfaces:**
- `SocketClient` gains `sendJson(value: unknown): void` (JSON string frame, only when OPEN).
- Produces: `useConversation({ adminKey }): { state, devices, selectedDeviceId, begin(languages), press(lang), release(), setVoiceOver(v), setVoiceClone(v), setMicDevice(id), pause(), resume(), endConversation(), clearError() }`. Consumed by Task 9.

- [ ] **Step 1: Write the failing test** — append inside the existing `describe('SocketClient', …)` in `web/src/engines/socket-client.test.ts`:

```ts
  it('sendJson sends a JSON string frame when open', () => {
    let ws: any;
    const c = new SocketClient({ url: 'wss://x', onMessage: () => {}, WebSocketCtor: (() => { return ws = fakeWs(); }) as any });
    c.connect();
    ws.readyState = 1;
    c.sendJson({ type: 'direction', from: 'en' });
    expect(ws.sent[0]).toBe(JSON.stringify({ type: 'direction', from: 'en' }));
  });
```

> If the existing fake tracks `readyState` differently (e.g. a fixed value), set it however the fakes in that file already expose it — check the `sendAudio` test above it and mirror its setup. Keep the assertion on the exact serialized string.

- [ ] **Step 2: Run → fail** (`sendJson is not a function`).

- [ ] **Step 3: Implement** — in `web/src/engines/socket-client.ts`, next to `sendAudio`:

```ts
  /** Send a JSON text frame (control messages). Only sends when the socket is OPEN. */
  sendJson(value: unknown): void {
    if (this._ws && this._ws.readyState === 1 /* OPEN */) {
      this._ws.send(JSON.stringify(value));
    }
  }
```

- [ ] **Step 4: Rewrite** `web/src/conversation/use-conversation.ts`:

```ts
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ConversationWsMessage } from '@v2/shared';
import { SocketClient, PlaybackEngine, MicCaptureEngine } from '@/engines';
import { conversationReducer, createInitialState } from './reducer.js';
import type { ConversationState } from './types.js';

export interface UseConversationOptions {
  adminKey: string;
}

export interface UseConversationApi {
  state: ConversationState;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  begin: (languages: [string, string]) => Promise<void>;
  press: (lang: string) => void;
  release: () => void;
  setVoiceOver: (v: boolean) => void;
  setVoiceClone: (v: boolean) => void;
  setMicDevice: (deviceId: string) => Promise<void>;
  pause: () => void;
  resume: () => void;
  endConversation: () => Promise<void>;
  clearError: () => void;
}

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/conversation`;
}

export function useConversation({ adminKey }: UseConversationOptions): UseConversationApi {
  const [state, dispatch] = useReducer(conversationReducer, undefined, createInitialState);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  const socketRef = useRef<SocketClient | null>(null);
  const micRef = useRef<MicCaptureEngine | null>(null);
  const playbackRef = useRef<PlaybackEngine | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const adminKeyRef = useRef(adminKey);
  adminKeyRef.current = adminKey;

  const ensurePlayback = useCallback(async () => {
    if (!playbackRef.current) playbackRef.current = new PlaybackEngine();
    await playbackRef.current.ensureContext();
  }, []);

  const startMic = useCallback(async (deviceId?: string) => {
    if (!micRef.current) {
      micRef.current = new MicCaptureEngine({
        workletUrl: '/pcm-worklet.js',
        onAudio: (pcm: ArrayBuffer) => {
          // Only stream while a direction is held and not paused.
          if (stateRef.current.activeDirection && !stateRef.current.paused) {
            socketRef.current?.sendAudio(pcm);
          }
        },
      });
    }
    try {
      await micRef.current.start(deviceId);
      const list = await micRef.current.listDevices();
      setDevices(list);
      setSelectedDeviceId((cur) => cur || micRef.current?.deviceId || list[0]?.deviceId || '');
    } catch {
      dispatch({ type: 'error', message: 'mic_blocked' });
    }
  }, []);

  // ---- begin: validate admin, then connect + start ----
  const begin = useCallback(
    async (languages: [string, string]) => {
      dispatch({ type: 'clearError' });
      try {
        const res = await fetch('/api/conversation/session', {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminKeyRef.current}` },
        });
        if (!res.ok) {
          dispatch({ type: 'error', message: 'unauthorized' });
          return;
        }
      } catch {
        dispatch({ type: 'error', message: 'unauthorized' });
        return;
      }
      dispatch({ type: 'setLanguages', languages });
      dispatch({ type: 'setPhase', phase: 'connecting' });
      await ensurePlayback(); // unlock audio on the Begin gesture

      socketRef.current?.close();
      const socket = new SocketClient({
        url: wsUrl(),
        onMessage: (m: ConversationWsMessage) => {
          switch (m.type) {
            case 'config':
              dispatch({ type: 'config', config: { voiceOver: m.voiceOver, voiceClone: m.voiceClone } });
              break;
            case 'status':
              dispatch({ type: 'status', state: m.state });
              break;
            case 'delta':
              dispatch({ type: 'delta', field: m.field, lang: m.lang, text: m.text });
              break;
            case 'turnEnd':
              dispatch({ type: 'turnEnd', lang: m.lang });
              break;
            case 'audio':
              if (!stateRef.current.paused && playbackRef.current) playbackRef.current.queueAudio(m.data);
              break;
            case 'error':
              dispatch({ type: 'error', message: m.message });
              break;
          }
        },
        onOpen: () => {
          // (Re)start the session on every open, including reconnects.
          socket.sendJson({
            type: 'start',
            languages,
            voiceOver: stateRef.current.config.voiceOver,
            voiceClone: stateRef.current.config.voiceClone,
          });
          dispatch({ type: 'reconnected' });
        },
        onReconnecting: () => dispatch({ type: 'reconnecting' }),
        onCloseTerminal: () => dispatch({ type: 'end' }),
      });
      socketRef.current = socket;
      socket.connect();
      await startMic(); // mic prompt fires during connect
    },
    [ensurePlayback, startMic],
  );

  // ---- push-to-talk ----
  const press = useCallback((lang: string) => {
    if (stateRef.current.activeDirection) return; // single active direction
    dispatch({ type: 'direction', from: lang });
    socketRef.current?.sendJson({ type: 'direction', from: lang });
  }, []);

  const release = useCallback(() => {
    if (!stateRef.current.activeDirection) return;
    dispatch({ type: 'direction', from: null });
    socketRef.current?.sendJson({ type: 'direction', from: null });
  }, []);

  // ---- config (voice-over / clone) ----
  const sendConfig = useCallback(async (voiceOver: boolean, voiceClone: boolean) => {
    dispatch({ type: 'config', config: { voiceOver, voiceClone } }); // optimistic
    try {
      await fetch('/api/conversation/config', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminKeyRef.current}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceOver, voiceClone }),
      });
    } catch {
      /* server broadcasts the authoritative config back */
    }
  }, []);
  const setVoiceOver = useCallback((v: boolean) => {
    void sendConfig(v, stateRef.current.config.voiceClone && v);
  }, [sendConfig]);
  const setVoiceClone = useCallback((v: boolean) => {
    void sendConfig(stateRef.current.config.voiceOver, v);
  }, [sendConfig]);

  const setMicDevice = useCallback(async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (micRef.current) await micRef.current.setDevice(deviceId);
  }, []);

  const pause = useCallback(() => {
    dispatch({ type: 'pause' });
    playbackRef.current?.stopAll();
  }, []);
  const resume = useCallback(() => dispatch({ type: 'resume' }), []);

  const endConversation = useCallback(async () => {
    dispatch({ type: 'end' });
    socketRef.current?.close(); // server stops the session on socket close
  }, []);

  const clearError = useCallback(() => dispatch({ type: 'clearError' }), []);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
      void micRef.current?.stop();
      playbackRef.current?.close();
    };
  }, []);

  return {
    state, devices, selectedDeviceId,
    begin, press, release,
    setVoiceOver, setVoiceClone, setMicDevice,
    pause, resume, endConversation, clearError,
  };
}
```

- [ ] **Step 5: Run → pass** (`npm -w web run typecheck` exit 0; `cd web && npx vitest run` fully green).

- [ ] **Step 6: Commit** — `feat(v2): useConversation rewrite (PTT + start/direction protocol)`.

---

## Task 9: Conversation page rewrite + route

**Files:**
- Rewrite: `web/src/routes/Conversation.tsx`
- Modify: `web/src/App.tsx`, `web/src/App.test.tsx`

**Interfaces:**
- Consumes everything from Tasks 4–8. `/conversation` renders the real page again.

- [ ] **Step 1: Implement** `web/src/routes/Conversation.tsx`:

```tsx
import { useState } from 'react';
import { AuthProvider, useAuth } from '@/auth/auth-context';
import { I18nProvider } from '@/conversation/i18n';
import { useConversation } from '@/conversation/use-conversation';
import { SetupView } from '@/conversation/components/SetupView';
import { RiverTranscript } from '@/conversation/components/RiverTranscript';
import { StatusLine } from '@/conversation/components/StatusLine';
import { StateOverlay } from '@/conversation/components/StateOverlay';
import { ControlsSheet } from '@/conversation/components/ControlsSheet';
import { PressArea } from '@/conversation/components/PressArea';
import { ErrorLine } from '@/conversation/components/ErrorLine';
import { pttLabel, colorFor } from '@/conversation/languages';

function ConversationInner() {
  const { adminKey, setAdminKey } = useAuth();
  const conv = useConversation({ adminKey });
  const { state } = conv;
  const [sheetOpen, setSheetOpen] = useState(false);

  const overlay =
    state.paused ? 'paused'
    : state.status === 'ended' ? 'ended'
    : state.status === 'reconnecting' ? 'reconnecting'
    : null;

  return (
    <I18nProvider locale="en">
      <div className="relative flex h-full flex-col bg-background">
        {state.phase === 'setup' || state.phase === 'connecting' ? (
          state.phase === 'setup' ? (
            <SetupView adminKey={adminKey} onSetAdminKey={setAdminKey} onBegin={(langs) => void conv.begin(langs)} />
          ) : (
            <main className="flex h-full items-center justify-center text-sm text-muted-foreground">Connecting…</main>
          )
        ) : (
          <>
            <header className="flex items-center justify-between">
              <StatusLine status={state.status} paused={state.paused} activeDirection={state.activeDirection} />
              <div className="flex items-center gap-3 px-4 pt-3 text-muted-foreground">
                <button aria-label="controls" className="text-lg leading-none" onClick={() => setSheetOpen(true)}>⋯</button>
              </div>
            </header>
            <RiverTranscript turns={state.turns} languages={state.languages ?? ['en', 'ko']} />
            <div className="flex h-[34vh] min-h-44 flex-col gap-2 px-4 pb-4">
              {([0, 1] as const).map((i) => {
                const lang = (state.languages ?? ['en', 'ko'])[i];
                return (
                  <PressArea
                    key={lang}
                    label={pttLabel(lang)}
                    color={colorFor(i)}
                    held={state.activeDirection === lang}
                    disabled={state.activeDirection !== null && state.activeDirection !== lang}
                    onDown={() => conv.press(lang)}
                    onUp={conv.release}
                  />
                );
              })}
            </div>
          </>
        )}

        {state.error && <ErrorLine message={state.error} onDismiss={conv.clearError} />}

        {overlay && state.phase !== 'ended' && (
          <StateOverlay kind={overlay} onResume={conv.resume} onBeginAnother={() => window.location.reload()} />
        )}
        {state.phase === 'ended' && (
          <StateOverlay kind="ended" onResume={conv.resume} onBeginAnother={() => window.location.reload()} />
        )}

        <ControlsSheet
          open={sheetOpen}
          config={state.config}
          devices={conv.devices}
          selectedDeviceId={conv.selectedDeviceId}
          paused={state.paused}
          onClose={() => setSheetOpen(false)}
          onVoiceOver={conv.setVoiceOver}
          onVoiceClone={conv.setVoiceClone}
          onMic={(id) => void conv.setMicDevice(id)}
          onPause={conv.pause}
          onResume={conv.resume}
          onEnd={() => void conv.endConversation()}
        />
      </div>
    </I18nProvider>
  );
}

export function Conversation() {
  return (
    <AuthProvider>
      <ConversationInner />
    </AuthProvider>
  );
}
```

- [ ] **Step 2: Wire the route** — in `web/src/App.tsx` restore:
```tsx
      <Route path="/conversation" element={<Conversation />} />
```
with `import { Conversation } from './routes/Conversation';`.

- [ ] **Step 3: Page test** — in `web/src/App.test.tsx`, re-add a routed case asserting the admin step renders at `/conversation` (sessionStorage is empty in jsdom):

```tsx
  it('/conversation renders the admin password step', () => {
    const { getByText } = render(<MemoryRouter initialEntries={['/conversation']}><App /></MemoryRouter>);
    expect(getByText(/Admin password/i)).toBeTruthy();
  });
```

- [ ] **Step 4: Run → pass** (`npm -w web run typecheck` exit 0; `npm -w web test` fully green).

- [ ] **Step 5: Commit** — `feat(v2): single-device conversation page`.

---

## Task 10: Verify + E2E probe

- [ ] **Step 1: Suites** — `npm -w web run typecheck` + `npm -w web test` green; `npm -w server run typecheck` + `npm -w server test` green; v1 `npm test` green; `git diff --stat main -- src/ public/ test/` empty.

- [ ] **Step 2: Build** — `npm run build:v2` succeeds; `grep -R '@v2/shared' web/dist` empty.

- [ ] **Step 3: E2E probe** — create `scripts/duo-e2e-probe.mjs`:

```js
// Live end-to-end probe for the single-device conversation pipeline.
// Usage (dev server running on :4000):
//   NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/duo-e2e-probe.mjs <wavA> <langA> <wavB> <langB>
// Example:
//   NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/duo-e2e-probe.mjs /tmp/en.wav en /tmp/ko.wav ko
// WAVs must be 16 kHz 16-bit mono (e.g. `say -v Samantha -o /tmp/en.aiff "…"` then
// `afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/en.aiff /tmp/en.wav`).
import { readFileSync } from 'node:fs';

const [, , wavAPath, langA, wavBPath, langB] = process.argv;
if (!wavAPath || !langA || !wavBPath || !langB) {
  console.error('usage: node duo-e2e-probe.mjs <wavA> <langA> <wavB> <langB>');
  process.exit(2);
}

const deltas = [];
const ws = new WebSocket('wss://localhost:4000/ws/conversation');
const log = (...a) => console.log(`[${(performance.now() / 1000).toFixed(1)}s]`, ...a);

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type === 'delta') { deltas.push(m); log(`delta ${m.field} ${m.lang} ${JSON.stringify(m.text)}`); }
  else log(JSON.stringify(m));
};
ws.onclose = (ev) => log(`closed ${ev.code} ${ev.reason}`);

const pcmOf = (p) => readFileSync(p).subarray(44);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function speak(wavPath, lang) {
  const pcm = pcmOf(wavPath);
  ws.send(JSON.stringify({ type: 'direction', from: lang }));
  for (let off = 0; off < pcm.length; off += 3200) {
    ws.send(pcm.subarray(off, off + 3200));
    await sleep(100);
  }
  ws.send(JSON.stringify({ type: 'direction', from: null }));
  await sleep(8000); // let ASR + translation catch up
}

await new Promise((res) => { ws.onopen = res; });
ws.send(JSON.stringify({ type: 'start', languages: [langA, langB], voiceOver: false, voiceClone: false }));
await sleep(4000); // sessions connect → status ready

await speak(wavAPath, langA);
await speak(wavBPath, langB);

const has = (field, lang) => deltas.some((d) => d.field === field && d.lang === lang);
const checks = [
  [`${langA} original`, has('original', langA)],
  [`${langA}→${langB} translation`, has('translation', langB)],
  [`${langB} original`, has('original', langB)],
  [`${langB}→${langA} translation`, has('translation', langA)],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(pass ? 'PASS' : 'FAIL', name);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
```

Generate sample WAVs (macOS `say`): English (`Samantha`) and Korean (`Yuna` — verify with `say -v '?' | grep ko_KR`). Run against `npm run dev:server`; expect 4× PASS.

- [ ] **Step 4: Manual browser check** — `npm run dev:server` + `npm run dev:web`; open `https://localhost:5173/conversation`: admin gate → pair picker (defaults English/한국어) → Begin → hold the English area, speak English → river shows English turn + Korean subtitle; hold the Korean area, speak Korean → Korean turn + English subtitle. Verify held/disabled states, ⋯ sheet (voice-over/clone, mic picker, pause/resume, end), reconnecting/paused/ended overlays, mic-blocked ErrorLine.

- [ ] **Step 5: Commit** — `test(v2): duo E2E probe script` (plus any backfill).

---

## Self-Review

**Spec coverage:**
- *DuoSession (two warm sessions, direction routing, config reconnect, per-direction reconnect, stop)* → Task 2. *Transport (first-frame start, 1008s, replace-on-new-start, binary routing, close-stops)* → Task 3. *REST session + config, deleted create/end* → Tasks 1, 3. *Protocol types* → Task 1. *Reducer (lang turns, translation joins other-language turn incl. after release, second-press ignored, statuses)* → Task 4. *Languages en/ko/zh/ja/es + native names + PTT phrases + pair colors* → Task 5. *i18n chrome English* → Tasks 5, 9 (locale fixed `en`). *SetupView admin → pair picker, differing-language validation* → Task 6. *Giant press areas (pointer lifecycle incl. cancel/lost-capture, held flood, disabled other), river showing original+translation every turn, StatusLine hold-to-talk/Listening…(native), overlays reconnecting/paused/ended, ControlsSheet role-free with selectedDeviceId* → Task 7. *sendJson + hook (begin/press/release/config/mic-gating/end-on-close/cleanup)* → Task 8. *Page + route* → Task 9. *E2E runbook + manual check* → Task 10. *ErrorLine (mic_blocked/unauthorized)* → Tasks 8 (dispatch) + 9 (render; component carried over). *Non-goals respected*: no rooms/QR, no names, no partner-away, no mid-session pair change.

**Placeholder scan:** Every step carries full code or an exact edit. The two judgement notes (SetupView display-value assertion fallback; sendJson fake-readyState mirror) give concrete alternatives, not open TODOs. The hook (Task 8) is typecheck-gated by design; its logic is manual/E2E-verified in Task 10.

**Type consistency:** `ConversationWsMessage`/`ConversationClientMessage` (Task 1) match the transport's frame parsing (T3), DuoSession's sends (T2), and the hook's dispatch mapping (T8). `DuoSession` API (`attach/start/setDirection/handleAudio/setConfig/stop`) matches transport usage. Reducer `Action` union matches hook dispatches (`setLanguages`, `setPhase`, `config`, `status`, `direction`, `delta`, `turnEnd`, `reconnecting`, `reconnected`, `pause`, `resume`, `end`, `error`, `clearError`). `UseConversationApi` names match page calls (T9). `SetupView.onBegin([A,B])` matches `begin(languages)`. `PressArea`/`RiverTranscript`/`StatusLine`/`StateOverlay`/`ControlsSheet` props match T9 instantiation. `nativeName`/`pttLabel`/`colorFor` imported from `languages.ts` in components and page.

---

## Execution Handoff

**Plan complete. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, reviewed between tasks.
**2. Inline Execution** — in this session with checkpoints.

**Which approach?**
