# v2 Plan 5 — Conversation React UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reimagined v2 conversation page — the first visible v2 surface — as a React+TS SPA: a flowing-river transcript, pure chrome + ⋯ controls sheet, 3-screen onboarding, warm states, en/ko i18n, and a `useConversation` hook that composes the Plan 4 engines against the Plan 3 backend.

**Architecture:** A self-contained `web/src/conversation/` feature folder (pure reducer + i18n + the `useConversation` hook + presentational components) wired into a new `routes/Conversation.tsx` page mounted at `/conversation` (replacing the placeholder `<Home/>`). The hook owns the three framework-agnostic engines (`SocketClient` / `MicCaptureEngine` / `PlaybackEngine`) in refs and binds their events to a `useReducer` state machine; high-frequency audio/WS state lives in refs, never React state. Role is detected from `?token=` (joiner → Korean UI; none → host English setup). A tiny `AuthContext` holds the host admin password. No new dependencies.

**Tech Stack:** React 18 + TypeScript 5.6 (strict), Vite, Tailwind v4 (CSS-first warm-&-human tokens already in `web/src/styles.css`), shadcn/ui (base-nova / `@base-ui/react` — `button`, `card`, `input`, `label`, `switch` already installed), Vitest + React Testing Library + jsdom. `@v2/shared` message types via the npm-workspace symlink (consumed as raw TS).

## Global Constraints

- **Do not touch v1** (`src/`, `public/`, v1 `test/`, root `package.json` scripts, root `src/server.js`). All new code lives under `web/src/` (+ one small, fallback-safe server route change in Task 11).
- **No new npm dependencies.** The user's global `~/.npmrc` redirects npm to a Google Artifact Registry mirror with an expired token (403) — every `npm install` fails until refreshed. So: QR comes from the server's `qrDataUrl` (an `<img>`), i18n is a hand-rolled table, the bottom sheet is hand-built (no `shadcn add sheet`), and icons are emoji/CSS (do **not** import `lucide-react` — its `^1.24.0` version is unverified).
- **Warm-&-human tokens already exist** in `web/src/styles.css`: `--primary:#c0623a` (terracotta, host + primary actions), `--background:#faf9f7`, `--foreground:#2a2724`, `--muted-foreground:#6b6358`, `--border:#e7e0d6`, `--secondary/--muted/--accent:#f1ede7`, `--radius:0.75rem`, and `:lang(ko){line-height:1.6}`. The joiner's warm-green label color `#3a7a5a` is **not** a token — use the Tailwind arbitrary value `text-[#3a7a5a]`.
- **TypeScript strict**, no `any` without a `// reason`. `@v2/shared` types are imported with `import type` where they're type-only.
- **`@/*` → `web/src/*`** alias (in `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`). `@v2/shared` resolves via the workspace symlink — no alias, no import path changes.
- **Each task ends verifiable:** `npm -w web run typecheck` exit 0; `npm -w web test` green (where a unit test exists); commit. Engine/browser orchestration (the `useConversation` hook, mic, playback) is manual-verified in Task 12 — the pure reducer and components are unit-tested.
- **Commit message style:** `feat(v2): <summary>` (matches prior v2 commits).

## Contract (source of truth — do not re-derive)

From `shared/src/index.ts` + `server/src/index.ts` + `server/src/conversation-*.ts` (read verbatim during planning):

- **REST (host/admin):** `POST /api/conversation/create` `[Authorization: Bearer <ADMIN_PASSWORD>]` body `{ hostName?, partnerName?, voiceOver?, voiceClone? }` → `{ roomId, hostToken, joinToken, joinUrl, qrDataUrl }`. `POST /api/conversation/config` `[Bearer]` body `{ roomId, voiceOver?, voiceClone? }` → `{ ok:true }`. `POST /api/conversation/end` `[Bearer]` body `{ roomId }` → `{ ok:true }`. `ADMIN_PASSWORD` defaults to `changeme` (env `ADMIN_PASSWORD`).
- **WS:** `wss://<host>/ws/conversation?token=<hostToken|joinToken>`. Client→server = **binary 16-bit PCM frames only** (any text/JSON frame is silently dropped — there are NO client→server JSON control messages). Server→client = JSON `ConversationWsMessage`, one per text frame. On `attachParticipant` the server immediately sends `roomInfo` → `config` → `status`, in order. Close code **1008** = unauthorized / room-gone (terminal — do not reconnect).
- **Down message shapes:** `roomInfo { type:'roomInfo'; names:{host,joiner} }`; `config { type:'config'; voiceOver; voiceClone }`; `status { type:'status'; state:'waiting'|'listening'|'paused'|'ended'; host:boolean; joiner:boolean }` (the server only ever emits `waiting`/`listening`/`ended` — **`paused` is never emitted**, so Pause is purely client-side); `delta { type:'delta'; speaker:Role; field:'original'|'translation'; text }`; `turnEnd { type:'turnEnd'; speaker:Role }`; `audio { type:'audio'; data:string }` (base64 24kHz PCM).
- **`delta` routing (defines the river):** `original` is sent to **both** roles (`speaker` = the role who spoke); `translation` is sent to the **other** role **only** (the speaker never receives their own translation); `audio` is sent to the **other** role **only**, and only when `voiceOver`. Therefore on this device: **own turn** (speaker === my role) has only `original` → render it as the main line, no subtitle; **partner's turn** has both `original` + `translation` → main = `translation`, grey subtitle = `original`. (Matches the design spec + the v1 `renderBubble` rule `translation || original`.)
- **Role** is inferred from the token held: host receives `hostToken` from `/create`; joiner's `?token=` **is** the `joinToken`. Languages are fixed (host zh→ko, joiner ko→zh) — no negotiation.
- **`turnEnd`** is broadcast to both when the active speaker changes (carrying the *previous* speaker), and for **both** roles on a config change (reset). The client finalizes that speaker's in-progress turn (next delta starts a fresh turn).

## File Structure

```
web/src/
├── conversation/                 (NEW feature folder — all conversation UI)
│   ├── types.ts                  (Turn, ConversationState, Action, Locale, Phase, StatusKind)
│   ├── reducer.ts                (pure state machine — TDD, Task 1)
│   ├── reducer.test.ts           (TDD)
│   ├── i18n.ts                   (en/ko string table + I18nProvider + useT — TDD, Task 2)
│   ├── i18n.test.tsx             (TDD)
│   ├── use-conversation.ts       (the hook: engines + reducer + REST — Task 5, manual-verified)
│   └── components/
│       ├── BottomSheet.tsx       (hand-built bottom-sheet primitive — Task 8)
│       ├── ControlsSheet.tsx     (⋯ sheet: voice-over/clone/mic/pause/end — TDD, Task 8)
│       ├── ControlsSheet.test.tsx
│       ├── RiverTranscript.tsx   (flowing river + RiverTurn + emphasis + autoscroll — TDD, Task 6)
│       ├── RiverTranscript.test.tsx
│       ├── StatusLine.tsx        (● Listening… line — Task 7)
│       ├── StateOverlay.tsx      (waiting/partner-away/reconnecting/paused/ended — TDD, Task 7)
│       ├── states.test.tsx
│       ├── OnboardingView.tsx    (host setup + admin step + QR-waiting + joiner welcome — TDD, Task 9)
│       └── OnboardingView.test.tsx
├── auth/
│   └── auth-context.tsx          (AuthContext: adminKey in sessionStorage — Task 4)
├── routes/
│   └── Conversation.tsx          (NEW page: wires hook + components + AuthContext + lang — Task 10)
├── engines/
│   ├── socket-client.ts          (MODIFY: add onOpen/onReconnecting callbacks — TDD, Task 3)
│   └── socket-client.test.ts     (MODIFY: add callback tests)
└── App.tsx                       (MODIFY: /conversation → <Conversation/> — Task 10)
server/src/
└── index.ts                      (MODIFY: serve built v2 SPA at /conversation — Task 11)
```

---

## Task 1: Conversation reducer (pure state machine)

**Files:**
- Create: `web/src/conversation/types.ts`, `web/src/conversation/reducer.ts`, `web/src/conversation/reducer.test.ts`

**Interfaces:**
- Produces: `createInitialState(role: Role): ConversationState`; `conversationReducer(state: ConversationState, action: Action): ConversationState`; types `ConversationState`, `Turn`, `Action`, `Locale`, `Phase`, `StatusKind` (consumed by the hook + every component).

- [ ] **Step 1: Write the failing test** `web/src/conversation/reducer.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { conversationReducer, createInitialState } from './reducer.js';

describe('conversationReducer', () => {
  const s = () => createInitialState('host');

  it('groups consecutive same-speaker deltas into one active turn', () => {
    let st = s();
    st = conversationReducer(st, { type: 'delta', speaker: 'host', field: 'original', text: '你好' });
    st = conversationReducer(st, { type: 'delta', speaker: 'host', field: 'original', text: '世界' });
    expect(st.turns).toHaveLength(1);
    expect(st.turns[0]).toMatchObject({ speaker: 'host', original: '你好世界', active: true });
  });

  it('starts a new turn when the speaker changes', () => {
    let st = s();
    st = conversationReducer(st, { type: 'delta', speaker: 'host', field: 'original', text: 'a' });
    st = conversationReducer(st, { type: 'delta', speaker: 'joiner', field: 'translation', text: 'b' });
    expect(st.turns).toHaveLength(2);
    expect(st.turns[0].active).toBe(false); // host finalized when joiner became active
    expect(st.turns[1]).toMatchObject({ speaker: 'joiner', translation: 'b', active: true });
  });

  it('turnEnd finalizes that speaker’s active turn (next delta = new turn)', () => {
    let st = s();
    st = conversationReducer(st, { type: 'delta', speaker: 'host', field: 'original', text: 'a' });
    st = conversationReducer(st, { type: 'turnEnd', speaker: 'host' });
    expect(st.turns[0].active).toBe(false);
    st = conversationReducer(st, { type: 'delta', speaker: 'host', field: 'original', text: 'b' });
    expect(st.turns).toHaveLength(2);
  });

  it('status: first waiting (partner never joined) → waiting', () => {
    let st = s(); // host
    st = conversationReducer(st, { type: 'status', state: 'waiting', host: true, joiner: false });
    expect(st.status).toBe('waiting');
  });

  it('status: partner joined then left → partnerAway', () => {
    let st = s();
    st = conversationReducer(st, { type: 'status', state: 'listening', host: true, joiner: true });
    st = conversationReducer(st, { type: 'status', state: 'waiting', host: true, joiner: false });
    expect(st.status).toBe('partnerAway');
  });

  it('status: ended → ended', () => {
    let st = s();
    st = conversationReducer(st, { type: 'status', state: 'ended', host: false, joiner: false });
    expect(st.status).toBe('ended');
  });

  it('reconnecting sets status (unless ended); reconnected restores to listening', () => {
    let st = s();
    st = conversationReducer(st, { type: 'status', state: 'listening', host: true, joiner: true });
    st = conversationReducer(st, { type: 'reconnecting' });
    expect(st.status).toBe('reconnecting');
    st = conversationReducer(st, { type: 'reconnected' });
    expect(st.status).toBe('listening');
  });

  it('pause/resume toggle the paused flag without losing server status', () => {
    let st = s();
    st = conversationReducer(st, { type: 'status', state: 'listening', host: true, joiner: true });
    st = conversationReducer(st, { type: 'pause' });
    expect(st.paused).toBe(true);
    expect(st.status).toBe('listening'); // underlying status preserved
    st = conversationReducer(st, { type: 'resume' });
    expect(st.paused).toBe(false);
  });

  it('end sets phase ended + status ended', () => {
    let st = s();
    st = conversationReducer(st, { type: 'end' });
    expect(st.phase).toBe('ended');
    expect(st.status).toBe('ended');
  });

  it('config updates voiceOver/voiceClone', () => {
    let st = s();
    st = conversationReducer(st, { type: 'config', config: { voiceOver: true, voiceClone: false } });
    expect(st.config).toEqual({ voiceOver: true, voiceClone: false });
  });
});
```

- [ ] **Step 2: Run → fail** (`npm -w web test` → `Cannot find module './reducer.js'`).

- [ ] **Step 3: Implement** `web/src/conversation/types.ts`:
```ts
import type { Role } from '@v2/shared';

export type Locale = 'en' | 'ko';
export type Phase = 'onboarding' | 'waiting' | 'live' | 'ended';

/** Server/connection-derived status. `paused` is a separate client flag. */
export type StatusKind = 'waiting' | 'listening' | 'partnerAway' | 'reconnecting' | 'ended';

export interface Turn {
  id: string;
  speaker: Role;
  original: string;
  translation: string;
  /** Currently speaking → emphasized in the river. At most one active turn. */
  active: boolean;
}

export interface ConversationConfig {
  voiceOver: boolean;
  voiceClone: boolean;
}

export interface RoomData {
  roomId: string;
  hostToken: string;
  joinToken: string;
  joinUrl: string;
  qrDataUrl: string;
}

export interface ConversationState {
  phase: Phase;
  role: Role;
  names: { host: string; joiner: string };
  turns: Turn[];
  status: StatusKind;
  paused: boolean;
  /** Has the partner ever connected (distinguishes first-wait from partner-away)? */
  partnerEverJoined: boolean;
  config: ConversationConfig;
  room: RoomData | null;
  error: string | null;
}

export type Action =
  | { type: 'setPhase'; phase: Phase }
  | { type: 'roomInfo'; names: { host: string; joiner: string } }
  | { type: 'setRoom'; room: RoomData }
  | { type: 'config'; config: ConversationConfig }
  | { type: 'status'; state: 'waiting' | 'listening' | 'paused' | 'ended'; host: boolean; joiner: boolean }
  | { type: 'delta'; speaker: Role; field: 'original' | 'translation'; text: string }
  | { type: 'turnEnd'; speaker: Role }
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
import type { Role } from '@v2/shared';
import type { Action, ConversationState, ConversationConfig, Turn } from './types.js';

export function createInitialState(role: Role): ConversationState {
  return {
    phase: 'onboarding',
    role,
    names: { host: '', joiner: '' },
    turns: [],
    status: 'waiting',
    paused: false,
    partnerEverJoined: false,
    config: { voiceOver: false, voiceClone: false },
    room: null,
    error: null,
  };
}

export function conversationReducer(state: ConversationState, action: Action): ConversationState {
  switch (action.type) {
    case 'setPhase':
      return { ...state, phase: action.phase };

    case 'roomInfo':
      return { ...state, names: action.names };

    case 'setRoom':
      return { ...state, room: action.room };

    case 'config':
      return { ...state, config: action.config };

    case 'status': {
      const partnerConnected = state.role === 'host' ? action.joiner : action.host;
      const partnerEverJoined = state.partnerEverJoined || partnerConnected;
      let status: ConversationState['status'];
      if (action.state === 'ended') status = 'ended';
      else if (action.state === 'listening') status = 'listening';
      else status = partnerEverJoined && !partnerConnected ? 'partnerAway' : 'waiting';
      return { ...state, status, partnerEverJoined };
    }

    case 'delta': {
      const { speaker, field, text } = action;
      const turns = state.turns;
      const last = turns[turns.length - 1];
      if (last && last.speaker === speaker && last.active) {
        const updated: Turn = { ...last, active: true };
        if (field === 'original') updated.original = last.original + text;
        else updated.translation = last.translation + text;
        return { ...state, turns: [...turns.slice(0, -1), updated] };
      }
      const fresh: Turn = { id: `${speaker}-${turns.length}`, speaker, original: '', translation: '', active: true };
      if (field === 'original') fresh.original = text;
      else fresh.translation = text;
      return { ...state, turns: [...turns.map((t) => ({ ...t, active: false })), fresh] };
    }

    case 'turnEnd':
      return {
        ...state,
        turns: state.turns.map((t) =>
          t.speaker === action.speaker && t.active ? { ...t, active: false } : t,
        ),
      };

    case 'reconnecting':
      return { ...state, status: state.status === 'ended' ? 'ended' : 'reconnecting' };

    case 'reconnected':
      return { ...state, status: state.status === 'ended' ? 'ended' : 'listening' };

    case 'pause':
      return { ...state, paused: true };

    case 'resume':
      return { ...state, paused: false };

    case 'end':
      return { ...state, phase: 'ended', status: 'ended', paused: false };

    case 'error':
      return { ...state, error: action.message };

    case 'clearError':
      return { ...state, error: null };

    default:
      return state;
  }
}

// Re-export config helper for the hook's optimistic updates.
export function configOf(voiceOver: boolean, voiceClone: boolean): ConversationConfig {
  return { voiceOver, voiceClone };
}
```

- [ ] **Step 4: Run → pass** (`npm -w web run typecheck` exit 0; `npm -w web test` → all reducer tests pass + existing engine/App tests still green).

- [ ] **Step 5: Commit** — `feat(v2): conversation reducer (river/status/config state machine)`.

---

## Task 2: i18n (en/ko)

**Files:**
- Create: `web/src/conversation/i18n.ts`, `web/src/conversation/i18n.test.tsx`

**Interfaces:**
- Produces: `STRINGS` table; `<I18nProvider locale>`; `useT(): (key) => string`. Keys are the v1 set (ported verbatim): `title, subtitle, your_name, partner_name, voice_over, voice_clone, begin, join, scan_qr, show_code, waiting, listening, paused, partner_away, reconnecting, ended, pause, resume, end, you, mic, mic_blocked, tap_resume, warm_close, begin_another, admin_password, admin_continue`. Consumed by every component.

- [ ] **Step 1: Write the failing test** `web/src/conversation/i18n.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { I18nProvider, useT, STRINGS } from './i18n.js';

describe('i18n', () => {
  it('STRINGS has matching en + ko keys', () => {
    const en = Object.keys(STRINGS.en).sort();
    const ko = Object.keys(STRINGS.ko).sort();
    expect(ko).toEqual(en);
  });

  it('useT returns the localized string, falling back to en then key', () => {
    const { result } = renderHook(() => useT(), { wrapper: ({ children }) => <I18nProvider locale="ko">{children}</I18nProvider> });
    const t = result.current;
    expect(t('waiting')).toBe(STRINGS.ko.waiting);
  });

  it('useT falls back to en when a ko key is missing', () => {
    const { result } = renderHook(() => useT(), { wrapper: ({ children }) => <I18nProvider locale="ko">{children}</I18nProvider> });
    // every key exists in both per the first test; sanity-check the resolver with a bogus key
    expect(result.current('__nope__' as never)).toBe('__nope__');
  });
});
```
> `renderHook` is exported by `@testing-library/react@14+`; this repo pins `^16.0.0`, so it is available.

- [ ] **Step 2: Run → fail** (`Cannot find module './i18n.js'`).

- [ ] **Step 3: Implement** `web/src/conversation/i18n.ts` (string values ported from v1 `public/i18n.js`, with a few added for the warm states/onboarding copy in the design spec):
```ts
import { createContext, useContext, type ReactNode } from 'react';
import type { Locale } from './types.js';

/** en/ko string table. Ported from v1 public/i18n.js + warm-state copy from the design spec. */
export const STRINGS = {
  en: {
    title: 'Conversation',
    subtitle: 'A few words, and we’ll translate.',
    your_name: 'Your name',
    partner_name: 'Partner’s name',
    voice_over: 'Voice-over',
    voice_clone: 'Voice cloning',
    begin: 'Begin',
    join: '참여하기', // joiner button label is Korean even in the en table (joiner UI is Korean); overridden by locale below
    scan_qr: 'Scan this on the partner’s phone',
    show_code: 'Show this to', // followed by the partner name
    waiting: 'Waiting for partner…',
    listening: 'Listening…',
    paused: 'Paused.',
    tap_resume: 'Tap to resume.',
    partner_away: 'stepped away… we’ll pick up when they’re back.',
    reconnecting: 'Catching up… translation resumes in a moment.',
    ended: 'Conversation ended.',
    warm_close: 'A quiet, warm close.',
    begin_another: 'Start another conversation',
    pause: 'Pause',
    resume: 'Resume',
    end: 'End conversation',
    you: 'You',
    mic: 'Microphone',
    mic_blocked: 'Microphone blocked. Use HTTPS and grant permission.',
    admin_password: 'Admin password',
    admin_continue: 'Continue',
    invited: '{host} invited you',
  },
  ko: {
    title: '대화',
    subtitle: '몇 마디면, 번역해 드릴게요.',
    your_name: '내 이름',
    partner_name: '상대방 이름',
    voice_over: '음성 재생',
    voice_clone: '음성 복제',
    begin: '시작',
    join: '참여하기',
    scan_qr: '상대방 전화에서 이 QR을 스캔하세요',
    show_code: '이 분에게 보여주세요:',
    waiting: '상대방을 기다리는 중…',
    listening: '듣는 중…',
    paused: '일시정지됨.',
    tap_resume: '눌러서 다시 시작하세요.',
    partner_away: '잠시 자리를 비우셨어요… 돌아오시면 이어서 할게요.',
    reconnecting: '잠시만 기다려 주세요… 곧 번역이 다시 이어집니다.',
    ended: '대화가 종료되었습니다.',
    warm_close: '따뜻하게 마무리해요.',
    begin_another: '새 대화 시작하기',
    pause: '일시정지',
    resume: '계속',
    end: '대화 종료',
    you: '나',
    mic: '마이크',
    mic_blocked: '마이크 차단됨. HTTPS로 접속하고 권한을 허용하세요.',
    admin_password: '관리 비밀번호',
    admin_continue: '계속',
    invited: '{host} 님이 초대했어요',
  },
} as const;

export type StringKey = keyof typeof STRINGS.en;

const I18nContext = createContext<Locale>('en');

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <I18nContext.Provider value={locale}>{children}</I18nContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(I18nContext);
}

export function useT(): (key: StringKey) => string {
  const locale = useContext(I18nContext);
  return (key: StringKey) => STRINGS[locale]?.[key] ?? STRINGS.en[key] ?? key;
}
```
> Note: the `join` value in the `en` table is intentionally `'참여하기'` only as a fallback; the joiner screen always renders under `locale="ko"`, so the Korean label is what shows. (This keeps the table key-complete for the parity test.)

- [ ] **Step 4: Run → pass** (typecheck exit 0; the 3 i18n tests pass).

- [ ] **Step 5: Commit** — `feat(v2): conversation i18n (en/ko)`.

---

## Task 3: SocketClient connection-status callbacks

The "Catching up…" reconnecting state needs a signal from `SocketClient` (it currently only exposes `onCloseTerminal`). Add two optional callbacks. This is a small, justified extension of the Plan 4 engine + its test.

**Files:**
- Modify: `web/src/engines/socket-client.ts`, `web/src/engines/socket-client.test.ts`

**Interfaces:**
- `SocketClientOptions` gains `onOpen?: () => void` (fired when the socket opens, including after a reconnect) and `onReconnecting?: () => void` (fired when a transient close schedules a reconnect).

- [ ] **Step 1: Write the failing tests** — append to `web/src/engines/socket-client.test.ts` (inside the existing `describe('SocketClient', …)`):
```ts
  it('fires onOpen when the socket opens', () => {
    let opened = false;
    let ws: any;
    const c = new SocketClient({ url: 'wss://x', onMessage: () => {}, onOpen: () => { opened = true; }, WebSocketCtor: (() => { return ws = fakeWs(); }) as any });
    c.connect();
    ws.listeners['open'][0]();
    expect(opened).toBe(true);
  });

  it('fires onReconnecting on a transient close (before the backoff reconnect)', () => {
    const factory = vi.fn(() => fakeWs());
    let reconnecting = 0;
    const c = new SocketClient({ url: 'wss://x', onMessage: () => {}, onReconnecting: () => { reconnecting++; }, WebSocketCtor: factory as any, reconnectBaseDelay: 1000 });
    c.connect();
    const first = factory.mock.results[0].value;
    first.listeners['open'][0]();
    first.listeners['close'][0]({ code: 1006 }); // transient
    expect(reconnecting).toBe(1);
    vi.advanceTimersByTime(1002); // reconnect fires; open the new socket
    const second = factory.mock.results[1].value;
    second.listeners['open'][0]();
    expect(reconnecting).toBe(1); // onReconnecting not re-fired until another transient close
  });
```

- [ ] **Step 2: Run → fail** (the new tests fail: callbacks not invoked).

- [ ] **Step 3: Implement** — in `web/src/engines/socket-client.ts`:
  - Add to `SocketClientOptions`:
    ```ts
    /** Called when the socket opens (including after a reconnect). */
    onOpen?: () => void;
    /** Called when a transient close schedules a reconnect (drive a "reconnecting" UI). */
    onReconnecting?: () => void;
    ```
  - In `connect()`, inside the existing `'open'` handler (where `this._attempts = 0;`), call `this.opts.onOpen?.();` (after the staleness guard).
  - In `_scheduleReconnect()`, at the top (before scheduling), call `this.opts.onReconnecting?.();`.

- [ ] **Step 4: Run → pass** (typecheck exit 0; `npm -w web test` → all SocketClient tests pass, including the 2 new ones + the original 4).

- [ ] **Step 5: Commit** — `feat(v2): SocketClient onOpen/onReconnecting callbacks`.

---

## Task 4: AuthContext (host admin password)

**Files:**
- Create: `web/src/auth/auth-context.tsx`

**Interfaces:**
- Produces: `<AuthProvider>` (reads/writes `sessionStorage['adminKey']`), `useAuth(): { adminKey: string; setAdminKey(v: string): void; clear(): void }`. Consumed by `Conversation.tsx` (passes `adminKey` into `useConversation`) and `OnboardingView` (host admin step).

- [ ] **Step 1: Implement** `web/src/auth/auth-context.tsx` (small enough to implement directly; add a render test alongside):
```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

const KEY = 'adminKey';

interface AuthValue {
  adminKey: string;
  setAdminKey: (v: string) => void;
  clear: () => void;
}

const AuthContext = createContext<AuthValue>({ adminKey: '', setAdminKey: () => {}, clear: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [adminKey, setKey] = useState<string>(() => {
    try {
      return sessionStorage.getItem(KEY) ?? '';
    } catch {
      return '';
    }
  });

  const setAdminKey = useCallback((v: string) => {
    setKey(v);
    try {
      sessionStorage.setItem(KEY, v);
    } catch {
      /* sessionStorage may be unavailable */
    }
  }, []);

  const clear = useCallback(() => {
    setKey('');
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return <AuthContext.Provider value={{ adminKey, setAdminKey, clear }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}
```

- [ ] **Step 2: Write a test** `web/src/auth/auth-context.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './auth-context.js';

describe('AuthContext', () => {
  beforeEach(() => sessionStorage.clear());

  it('persists adminKey to sessionStorage', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() => result.current.setAdminKey('hunter2'));
    expect(result.current.adminKey).toBe('hunter2');
    expect(sessionStorage.getItem('adminKey')).toBe('hunter2');
  });

  it('clear removes adminKey', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() => result.current.setAdminKey('hunter2'));
    act(() => result.current.clear());
    expect(result.current.adminKey).toBe('');
    expect(sessionStorage.getItem('adminKey')).toBeNull();
  });
});
```

- [ ] **Step 3: Run → pass** (typecheck exit 0; the 2 auth tests pass).

- [ ] **Step 4: Commit** — `feat(v2): host admin AuthContext`.

---

## Task 5: useConversation hook (orchestration core)

**Files:**
- Create: `web/src/conversation/use-conversation.ts`

**Interfaces:**
- Consumes: the three engines (`@/engines`), the reducer (Task 1), the contract REST endpoints + WS message shapes.
- Produces: `useConversation({ adminKey, getToken }): { state: ConversationState; t; createRoom(hostName, partnerName); joinRoom(); setVoiceOver(v); setVoiceClone(v); setMicDevice(id); pause(); resume(); endConversation(); devices }`. `getToken` reads `?token=` from the URL (injectable so the hook is testable). The hook reads `window.location`/`WebSocket`/`AudioContext`/`navigator.mediaDevices` (browser-only → manual-verified in Task 12; the pure reducer is tested in Task 1).

- [ ] **Step 1: Implement** `web/src/conversation/use-conversation.ts`:
```ts
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ConversationWsMessage, Role } from '@v2/shared';
import { SocketClient, PlaybackEngine, MicCaptureEngine } from '@/engines';
import { conversationReducer, createInitialState } from './reducer.js';
import type { ConversationState } from './types.js';

export interface UseConversationOptions {
  /** Host admin password (host flow only). */
  adminKey: string;
  /** Returns the ?token= query value (joiner) or null (host). Injectable for tests. */
  getToken?: () => string | null;
}

export interface UseConversationApi {
  state: ConversationState;
  devices: MediaDeviceInfo[];
  createRoom: (hostName: string, partnerName: string) => Promise<void>;
  joinRoom: () => Promise<void>;
  setVoiceOver: (v: boolean) => void;
  setVoiceClone: (v: boolean) => void;
  setMicDevice: (deviceId: string) => Promise<void>;
  pause: () => void;
  resume: () => void;
  endConversation: () => Promise<void>;
}

function readToken(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('token');
  } catch {
    return null;
  }
}

function wsUrl(token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/conversation?token=${token}`;
}

export function useConversation({ adminKey, getToken = readToken }: UseConversationOptions): UseConversationApi {
  const token = getToken();
  const role: Role = token ? 'joiner' : 'host';

  const [state, dispatch] = useReducer(conversationReducer, role, createInitialState);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  // Engine refs (high-frequency / browser state stays out of React state).
  const socketRef = useRef<SocketClient | null>(null);
  const micRef = useRef<MicCaptureEngine | null>(null);
  const playbackRef = useRef<PlaybackEngine | null>(null);
  const stateRef = useRef(state); // latest state for audio-gating without stale closures
  stateRef.current = state;
  const adminKeyRef = useRef(adminKey);
  adminKeyRef.current = adminKey;

  const ensurePlayback = useCallback(async () => {
    if (!playbackRef.current) playbackRef.current = new PlaybackEngine();
    await playbackRef.current.ensureContext();
  }, []);

  const connectSocket = useCallback((tok: string) => {
    socketRef.current?.close();
    const socket = new SocketClient({
      url: wsUrl(tok),
      onMessage: (m: ConversationWsMessage) => {
        switch (m.type) {
          case 'roomInfo':
            dispatch({ type: 'roomInfo', names: m.names });
            break;
          case 'config':
            dispatch({ type: 'config', config: { voiceOver: m.voiceOver, voiceClone: m.voiceClone } });
            break;
          case 'status':
            dispatch({ type: 'status', state: m.state, host: m.host, joiner: m.joiner });
            if (m.state === 'listening') dispatch({ type: 'setPhase', phase: 'live' });
            else if (m.state === 'ended') dispatch({ type: 'end' });
            break;
          case 'delta':
            dispatch({ type: 'delta', speaker: m.speaker, field: m.field, text: m.text });
            break;
          case 'turnEnd':
            dispatch({ type: 'turnEnd', speaker: m.speaker });
            break;
          case 'audio':
            if (!stateRef.current.paused && playbackRef.current) {
              playbackRef.current.queueAudio(m.data);
            }
            break;
        }
      },
      onOpen: () => dispatch({ type: 'reconnected' }),
      onReconnecting: () => dispatch({ type: 'reconnecting' }),
      onCloseTerminal: () => {
        // 1008 = room gone / ended / bad token → treat as ended.
        dispatch({ type: 'end' });
      },
    });
    socketRef.current = socket;
    socket.connect();
  }, []);

  const startMic = useCallback(async (deviceId?: string) => {
    if (!micRef.current) {
      micRef.current = new MicCaptureEngine({
        workletUrl: '/pcm-worklet.js',
        onAudio: (pcm: ArrayBuffer) => {
          if (!stateRef.current.paused) socketRef.current?.sendAudio(pcm);
        },
      });
    }
    try {
      await micRef.current.start(deviceId);
      setDevices(await micRef.current.listDevices());
    } catch {
      dispatch({ type: 'error', message: 'mic_blocked' });
    }
  }, []);

  // ---- host: create room ----
  const createRoom = useCallback(
    async (hostName: string, partnerName: string) => {
      try {
        await ensurePlayback(); // unlock audio on the Begin gesture
        const res = await fetch('/api/conversation/create', {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminKeyRef.current}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostName, partnerName }),
        });
        const data = await res.json();
        if (res.status === 401) {
          dispatch({ type: 'error', message: 'unauthorized' });
          return;
        }
        if (!res.ok) throw new Error(data?.error || 'create failed');
        dispatch({
          type: 'setRoom',
          room: { roomId: data.roomId, hostToken: data.hostToken, joinToken: data.joinToken, joinUrl: data.joinUrl, qrDataUrl: data.qrDataUrl },
        });
        dispatch({ type: 'setPhase', phase: 'waiting' });
        connectSocket(data.hostToken);
        await startMic(); // mic prompt fires on the waiting screen (spec)
      } catch (err) {
        dispatch({ type: 'error', message: (err as Error).message });
      }
    },
    [connectSocket, ensurePlayback, startMic],
  );

  // ---- joiner: join ----
  const joinRoom = useCallback(async () => {
    if (!token) return;
    try {
      await ensurePlayback(); // unlock audio on the 참여하기 gesture
      connectSocket(token);
      await startMic();
    } catch (err) {
      dispatch({ type: 'error', message: (err as Error).message });
    }
  }, [token, connectSocket, ensurePlayback, startMic]);

  // ---- host config (voice-over / clone) ----
  const sendConfig = useCallback(
    async (voiceOver: boolean, voiceClone: boolean) => {
      const room = stateRef.current.room;
      if (!room) return;
      dispatch({ type: 'config', config: { voiceOver, voiceClone } }); // optimistic
      try {
        await fetch('/api/conversation/config', {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminKeyRef.current}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: room.roomId, voiceOver, voiceClone }),
        });
      } catch {
        /* server will broadcast the authoritative config back */
      }
    },
    [],
  );
  const setVoiceOver = useCallback((v: boolean) => {
    void sendConfig(v, stateRef.current.config.voiceClone && v);
  }, [sendConfig]);
  const setVoiceClone = useCallback((v: boolean) => {
    void sendConfig(stateRef.current.config.voiceOver, v);
  }, [sendConfig]);

  const setMicDevice = useCallback(async (deviceId: string) => {
    if (micRef.current) await micRef.current.setDevice(deviceId);
  }, []);

  const pause = useCallback(() => {
    dispatch({ type: 'pause' });
    playbackRef.current?.stopAll();
  }, []);
  const resume = useCallback(() => dispatch({ type: 'resume' }), []);

  const endConversation = useCallback(async () => {
    const room = stateRef.current.room;
    try {
      if (room) {
        await fetch('/api/conversation/end', {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminKeyRef.current}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: room.roomId }),
        });
      }
    } catch {
      /* ignore */
    }
    socketRef.current?.close();
    dispatch({ type: 'end' });
  }, []);

  // joiner auto-connects on mount (the joiner lands straight on the welcome screen;
  // tapping 참여하기 calls joinRoom). Nothing auto-runs for the host.
  useEffect(() => {
    return () => {
      // cleanup on unmount
      socketRef.current?.close();
      void micRef.current?.stop();
      playbackRef.current?.close();
    };
  }, []);

  return { state, devices, createRoom, joinRoom, setVoiceOver, setVoiceClone, setMicDevice, pause, resume, endConversation };
}
```

- [ ] **Step 2: typecheck** — `npm -w web run typecheck` → exit 0. (No automated test: the hook drives browser APIs + engines. The pure logic it delegates to — the reducer — is tested in Task 1. Manual verification is in Task 12.)

- [ ] **Step 3: Commit** — `feat(v2): useConversation hook (engines + reducer + REST)`.

---

## Task 6: RiverTranscript + RiverTurn (flowing river)

**Files:**
- Create: `web/src/conversation/components/RiverTranscript.tsx`, `web/src/conversation/components/RiverTranscript.test.tsx`

**Interfaces:**
- Consumes: `ConversationState['turns']`, `ConversationState['role']`, `names`. Produces: `<RiverTranscript turns role names />`. Pure/presentational (TDD).

- [ ] **Step 1: Write the failing test** `web/src/conversation/components/RiverTranscript.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RiverTranscript } from './RiverTranscript.js';
import type { Turn } from '../types.js';

const turns = (active: number | null): Turn[] => [
  { id: 'host-0', speaker: 'host', original: '你好', translation: '', active: active === 0 },
  { id: 'joiner-1', speaker: 'joiner', original: '안녕', translation: '你好呀', active: active === 1 },
];

describe('RiverTranscript', () => {
  it('renders own turn as the original (no subtitle)', () => {
    const { getByText, queryByText } = render(<RiverTranscript turns={turns(null)} role="host" names={{ host: 'Enze', joiner: '아버님' }} />);
    expect(getByText('你好')).toBeTruthy(); // host own original = main
    expect(queryByText('안녕')).toBeTruthy(); // partner original appears as subtitle
  });

  it('renders partner turn with translation as main + original as subtitle', () => {
    const { getByText } = render(<RiverTranscript turns={turns(null)} role="host" names={{ host: 'Enze', joiner: '아버님' }} />);
    expect(getByText('你好呀')).toBeTruthy(); // joiner translation (main, on host device)
  });

  it('marks the active turn with the active data attribute', () => {
    const { container } = render(<RiverTranscript turns={turns(1)} role="host" names={{ host: 'Enze', joiner: '아버님' }} />);
    const active = container.querySelectorAll('[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain('你好呀');
  });

  it('shows the speaker label in their color class', () => {
    const { container } = render(<RiverTranscript turns={turns(null)} role="joiner" names={{ host: 'Enze', joiner: '아버님' }} />);
    // host label = terracotta (text-primary), joiner label = warm green (text-[#3a7a5a])
    expect(container.querySelector('.text-primary, [class*="text-primary"]')).not.toBeNull();
    expect(container.querySelector('[class*="text-[#3a7a5a]"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run → fail** (`Cannot find module './RiverTranscript.js'`).

- [ ] **Step 3: Implement** `web/src/conversation/components/RiverTranscript.tsx`:
```tsx
import { useEffect, useRef } from 'react';
import type { Role } from '@v2/shared';
import type { Turn } from '../types.js';

interface Props {
  turns: Turn[];
  role: Role;
  names: { host: string; joiner: string };
}

function RiverTurn({ turn, role, names }: { turn: Turn; role: Role; names: Props['names'] }) {
  const isMe = turn.speaker === role;
  const labelColor = turn.speaker === 'host' ? 'text-primary' : 'text-[#3a7a5a]';
  const label = isMe ? names[turn.speaker] || turn.speaker : names[turn.speaker] || turn.speaker;
  const main = isMe ? turn.original : turn.translation || turn.original;
  const sub = isMe ? '' : turn.original;
  return (
    <div data-active={turn.active ? 'true' : 'false'} className={turn.active ? 'mt-3' : 'mt-2 opacity-90'}>
      <div className={`text-xs font-bold tracking-wide ${labelColor} ${turn.active ? 'text-sm' : ''}`}>{label}</div>
      <div className={`text-foreground ${turn.active ? 'text-base' : 'text-[15px]'} leading-relaxed`}>{main}</div>
      {sub ? <div className="mt-0.5 ml-1 text-xs text-muted-foreground leading-relaxed">{sub}</div> : null}
    </div>
  );
}

export function RiverTranscript({ turns, role, names }: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);
  return (
    <div className="flex-1 overflow-y-auto px-5 py-4" aria-label="conversation transcript">
      {turns.map((t) => (
        <RiverTurn key={t.id} turn={t} role={role} names={names} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
```

- [ ] **Step 4: Run → pass** (typecheck exit 0; the 4 river tests pass).

- [ ] **Step 5: Commit** — `feat(v2): RiverTranscript (flowing river + active-speaker emphasis)`.

---

## Task 7: StatusLine + StateOverlay (warm states)

**Files:**
- Create: `web/src/conversation/components/StatusLine.tsx`, `web/src/conversation/components/StateOverlay.tsx`, `web/src/conversation/components/states.test.tsx`

**Interfaces:**
- Consumes: `status`, `paused`, `names`, `t`. `<StatusLine status paused />` (the faint `● Listening…` line). `<StateOverlay kind names t onResume onBeginAnother />` (full-screen warm card for waiting/partner-away/reconnecting/paused/ended).

- [ ] **Step 1: Write the failing test** `web/src/conversation/components/states.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { StatusLine } from './StatusLine.js';
import { StateOverlay } from './StateOverlay.js';
import { I18nProvider } from '../i18n.js';
import type { ConversationState } from '../types.js';

const wrap = (ui: React.ReactNode) => <I18nProvider locale="en">{ui}</I18nProvider>;

describe('StatusLine', () => {
  it('shows Listening when status is listening and not paused', () => {
    const { getByText } = render(wrap(<StatusLine status="listening" paused={false} />));
    expect(getByText(/Listening/)).toBeTruthy();
  });
  it('shows Paused when paused (regardless of status)', () => {
    const { getByText } = render(wrap(<StatusLine status="listening" paused={true} />));
    expect(getByText(/Paused/)).toBeTruthy();
  });
});

describe('StateOverlay', () => {
  it('paused overlay offers a resume button', () => {
    const onResume = vi.fn();
    const { getByText } = render(wrap(<StateOverlay kind="paused" names={{ host: 'a', joiner: 'b' }} onResume={onResume} onBeginAnother={() => {}} />));
    fireEvent.click(getByText(/resume|Tap to resume/i));
    expect(onResume).toHaveBeenCalled();
  });
  it('ended overlay offers begin-another', () => {
    const onBeginAnother = vi.fn();
    const { getByText } = render(wrap(<StateOverlay kind="ended" names={{ host: 'a', joiner: 'b' }} onResume={() => {}} onBeginAnother={onBeginAnother} />));
    fireEvent.click(getByText(/another conversation/i));
    expect(onBeginAnother).toHaveBeenCalled();
  });
  it('partner-away overlay shows the partner name + copy', () => {
    const { getByText } = render(wrap(<StateOverlay kind="partnerAway" names={{ host: 'Enze', joiner: '아버님' }} onResume={() => {}} onBeginAnother={() => {}} />));
    // the <p> text is "{partner} stepped away…" (the <span> alone is just the name) — match the whole phrase
    expect(getByText(/아버님 stepped/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run → fail** (modules not found).

- [ ] **Step 3: Implement** `web/src/conversation/components/StatusLine.tsx`:
```tsx
import { useT } from '../i18n.js';
import type { ConversationState } from '../types.js';

export function StatusLine({ status, paused }: { status: ConversationState['status']; paused: boolean }) {
  const t = useT();
  const text = paused ? t('paused') : status === 'listening' ? t('listening') : status === 'reconnecting' ? t('reconnecting') : t('waiting');
  const dot = paused || status === 'reconnecting' ? 'bg-muted-foreground' : 'bg-primary';
  return (
    <div className="flex items-center gap-1.5 px-4 pt-3 text-xs text-muted-foreground">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      <span>{text}</span>
    </div>
  );
}
```

Then `web/src/conversation/components/StateOverlay.tsx`:
```tsx
import { Button } from '@/components/ui/button';
import { useT } from '../i18n.js';
import type { ConversationState } from '../types.js';

interface Props {
  kind: 'waiting' | 'partnerAway' | 'reconnecting' | 'paused' | 'ended';
  names: { host: string; joiner: string };
  onResume: () => void;
  onBeginAnother: () => void;
}

export function StateOverlay({ kind, names, onResume, onBeginAnother }: Props) {
  const t = useT();
  // The partner is whoever "me" is not. The page passes role via names usage; here we show the joiner
  // name for the host and vice-versa by rendering both-friendly copy. For partner-away we use the joiner
  // name when the host is viewing (most common); the page may pass the explicit partner name via names.joiner.
  const partner = names.joiner || names.host;
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 px-8 text-center backdrop-blur-sm">
      <div className="max-w-sm space-y-2">
        {kind === 'waiting' && (
          <>
            <p className="text-lg text-foreground">{t('waiting')}</p>
          </>
        )}
        {kind === 'partnerAway' && (
          <>
            <p className="text-lg text-foreground"><span className="font-semibold">{partner}</span> {t('partner_away')}</p>
          </>
        )}
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

- [ ] **Step 4: Run → pass** (typecheck exit 0; the 5 state tests pass).

- [ ] **Step 5: Commit** — `feat(v2): StatusLine + warm StateOverlay`.

---

## Task 8: BottomSheet + ControlsSheet (⋯)

**Files:**
- Create: `web/src/conversation/components/BottomSheet.tsx`, `web/src/conversation/components/ControlsSheet.tsx`, `web/src/conversation/components/ControlsSheet.test.tsx`

**Interfaces:**
- `<BottomSheet open onClose>` — hand-built (overlay + sliding panel + grab handle + Esc/backdrop close). No new dep.
- `<ControlsSheet open role config devices onClose onVoiceOver onVoiceClone onMic onPause onResume onEnd paused />` — voice-over toggle, voice-cloning sub-toggle (host-only, enabled only when voice-over on), mic device picker, pause/resume, end (host-only). Consumes the `Switch` shadcn component.

- [ ] **Step 1: Write the failing test** `web/src/conversation/components/ControlsSheet.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ControlsSheet } from './ControlsSheet.js';
import { I18nProvider } from '../i18n.js';

const wrap = (ui: React.ReactNode) => <I18nProvider locale="en">{ui}</I18nProvider>;
const base = {
  open: true, role: 'host' as const, config: { voiceOver: false, voiceClone: false },
  devices: [{ deviceId: 'd1', kind: 'audioinput', label: 'AirPods', groupId: 'g' } as MediaDeviceInfo],
  paused: false, onClose: () => {}, onVoiceOver: () => {}, onVoiceClone: () => {},
  onMic: () => {}, onPause: () => {}, onResume: () => {}, onEnd: () => {},
};

describe('ControlsSheet', () => {
  it('host sees voice-over + end', () => {
    const { getByText } = render(wrap(<ControlsSheet {...base} />));
    expect(getByText(/Voice-over/)).toBeTruthy();
    expect(getByText(/End conversation/)).toBeTruthy();
  });
  it('joiner does NOT see voice-over or end', () => {
    const { queryByText } = render(wrap(<ControlsSheet {...base} role="joiner" />));
    expect(queryByText(/Voice-over/)).toBeNull();
    expect(queryByText(/End conversation/)).toBeNull();
  });
  it('tapping End fires onEnd', () => {
    const onEnd = vi.fn();
    const { getByText } = render(wrap(<ControlsSheet {...base} onEnd={onEnd} />));
    fireEvent.click(getByText(/End conversation/));
    expect(onEnd).toHaveBeenCalled();
  });
  it('tapping Pause fires onPause and label becomes Resume', () => {
    const onPause = vi.fn();
    const { getByText, rerender } = render(wrap(<ControlsSheet {...base} onPause={onPause} />));
    fireEvent.click(getByText(/Pause/));
    expect(onPause).toHaveBeenCalled();
    rerender(wrap(<ControlsSheet {...base} paused={true} />));
    expect(getByText(/Resume/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run → fail** (modules not found).

- [ ] **Step 3: Implement** `web/src/conversation/components/BottomSheet.tsx`:
```tsx
import { useEffect, type ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function BottomSheet({ open, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-30">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-card p-4 shadow-[0_-6px_18px_rgba(0,0,0,0.04)]">
        <div className="mx-auto mb-3 h-1 w-8 rounded-full bg-border" />
        {children}
      </div>
    </div>
  );
}
```

Then `web/src/conversation/components/ControlsSheet.tsx` (uses the installed shadcn `Switch` — **first verify its prop names in `web/src/components/ui/switch.tsx`**; base-nova on Base UI uses `checked` + `onCheckedChange(checked, event)`, which is what's used below. If the installed component names them differently, adjust the two `<Switch>` usages to match):
```tsx
import { Switch } from '@/components/ui/switch';
import { BottomSheet } from './BottomSheet.js';
import { useT } from '../i18n.js';
import type { Role } from '@v2/shared';
import type { ConversationConfig, ConversationState } from '../types.js';

interface Props {
  open: boolean;
  role: Role;
  config: ConversationConfig;
  devices: MediaDeviceInfo[];
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
  const isHost = p.role === 'host';
  return (
    <BottomSheet open={p.open} onClose={p.onClose}>
      <div className="space-y-1">
        {isHost && (
          <>
            <Row label={`🔊 ${t('voice_over')}`}>
              <Switch checked={p.config.voiceOver} onCheckedChange={p.onVoiceOver} aria-label={t('voice_over')} />
            </Row>
            {p.config.voiceOver && (
              <Row label={t('voice_clone')} inset>
                <Switch checked={p.config.voiceClone} onCheckedChange={p.onVoiceClone} aria-label={t('voice_clone')} />
              </Row>
            )}
          </>
        )}

        <Row label={`🎤 ${t('mic')}`}>
          <select
            className="bg-transparent text-sm text-muted-foreground"
            value={p.devices[0]?.deviceId ?? ''}
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

        {isHost && (
          <div className="border-t border-border pt-2">
            <button className="w-full py-2 text-left text-sm text-primary" onClick={p.onEnd}>{t('end')}</button>
          </div>
        )}
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

- [ ] **Step 4: Run → pass** (typecheck exit 0; the 4 ControlsSheet tests pass).

- [ ] **Step 5: Commit** — `feat(v2): ControlsSheet (⋯ bottom sheet)`.

---

## Task 9: OnboardingView (3-screen entry)

**Files:**
- Create: `web/src/conversation/components/OnboardingView.tsx`, `web/src/conversation/components/OnboardingView.test.tsx`

**Interfaces:**
- Consumes: `phase` (`onboarding` | `waiting`), `role`, `room` (for `qrDataUrl`), `names`, `adminKey`, plus callbacks `onBegin(hostName, partnerName, adminKey)`, `onJoin()`, `onSetAdminKey(v)`, `onBeginAnother()`. Renders: host setup (with an admin-password step if `!adminKey`) → host waiting (QR + "Waiting…") → joiner welcome (Korean). Pure/presentational (TDD).

- [ ] **Step 1: Write the failing test** `web/src/conversation/components/OnboardingView.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { OnboardingView } from './OnboardingView.js';
import { I18nProvider } from '../i18n.js';

const setup = (props: Partial<React.ComponentProps<typeof OnboardingView>> = {}) =>
  render(
    <I18nProvider locale="en">
      <OnboardingView
        phase="onboarding"
        role="host"
        room={null}
        names={{ host: '', joiner: '' }}
        adminKey=""
        onBegin={() => {}}
        onJoin={() => {}}
        onSetAdminKey={() => {}}
        onBeginAnother={() => {}}
        {...props}
      />
    </I18nProvider>,
  );

describe('OnboardingView', () => {
  it('host setup: Begin calls onBegin with names + adminKey', () => {
    const onBegin = vi.fn();
    const { getByPlaceholderText, getByRole } = setup({ adminKey: 'changeme', onBegin });
    fireEvent.change(getByPlaceholderText(/Enze/), { target: { value: 'Enze' } });
    fireEvent.change(getByPlaceholderText(/아버님/), { target: { value: '아버님' } });
    fireEvent.click(getByRole('button', { name: /Begin/i }));
    expect(onBegin).toHaveBeenCalledWith('Enze', '아버님', 'changeme');
  });
  it('host setup without adminKey: shows admin-password step first', () => {
    const { getByText, queryByRole } = setup({ adminKey: '' });
    expect(getByText(/Admin password/i)).toBeTruthy();
    expect(queryByRole('button', { name: /^Begin$/i })).toBeNull();
  });
  it('waiting phase host shows the QR image', () => {
    const { getByAltText } = setup({ phase: 'waiting', adminKey: 'x', room: { roomId: 'r', hostToken: 'h', joinToken: 'j', joinUrl: 'u', qrDataUrl: 'data:image/png;base64,AAAA' } });
    expect(getByAltText(/QR/i).getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });
  it('joiner welcome (Korean) shows 참여하기 and calls onJoin', () => {
    const onJoin = vi.fn();
    const { getByRole } = render(
      <I18nProvider locale="ko">
        <OnboardingView phase="onboarding" role="joiner" room={null} names={{ host: 'Enze', joiner: '' }} adminKey="" onBegin={() => {}} onJoin={onJoin} onSetAdminKey={() => {}} onBeginAnother={() => {}} />
      </I18nProvider>,
    );
    fireEvent.click(getByRole('button', { name: /참여하기/ }));
    expect(onJoin).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run → fail** (module not found).

- [ ] **Step 3: Implement** `web/src/conversation/components/OnboardingView.tsx`:
```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '../i18n.js';
import type { Role } from '@v2/shared';
import type { Phase, RoomData } from '../types.js';

interface Props {
  phase: Phase;
  role: Role;
  room: RoomData | null;
  names: { host: string; joiner: string };
  adminKey: string;
  onBegin: (hostName: string, partnerName: string, adminKey: string) => void;
  onJoin: () => void;
  onSetAdminKey: (v: string) => void;
  onBeginAnother: () => void;
}

export function OnboardingView(p: Props) {
  const t = useT();
  const [hostName, setHostName] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [admin, setAdmin] = useState('');

  // ---- Joiner welcome (Korean) ----
  if (p.role === 'joiner') {
    return (
      <main className="flex h-full flex-col items-center justify-center px-8 text-center">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('invited').replace('{host}', p.names.host || '')}</p>
        <div className="my-6 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-xl">👤</div>
        <Button className="px-8" onClick={p.onJoin}>{t('join')}</Button>
      </main>
    );
  }

  // ---- Host waiting (QR) ----
  if (p.phase === 'waiting' && p.room) {
    return (
      <main className="flex h-full flex-col items-center justify-center px-8 text-center">
        <p className="text-sm text-foreground">{t('show_code')} <b>{partnerName || p.names.joiner || ''}</b></p>
        <img src={p.room.qrDataUrl} alt="QR code" className="my-6 h-48 w-48 rounded-xl border border-border bg-white p-2" />
        <div className="flex flex-col items-center gap-2">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
          <p className="text-sm text-muted-foreground">{t('waiting')}</p>
        </div>
      </main>
    );
  }

  // ---- Host setup ----
  const needAdmin = !p.adminKey;
  const begin = () => p.onBegin(hostName || 'You', partnerName || 'Partner', p.adminKey || admin);
  return (
    <main className="mx-auto flex h-full max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">{needAdmin ? t('admin_password') : t('title')}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{needAdmin ? '' : t('subtitle')}</p>

      {needAdmin ? (
        <div className="space-y-3">
          <Input type="password" placeholder={t('admin_password')} value={admin} onChange={(e) => setAdmin(e.target.value)} />
          <Button className="w-full" onClick={() => p.onSetAdminKey(admin)} disabled={!admin}>{t('admin_continue')}</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hn">{t('your_name')}</Label>
            <Input id="hn" placeholder="Enze" value={hostName} onChange={(e) => setHostName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pn">{t('partner_name')}</Label>
            <Input id="pn" placeholder="아버님" value={partnerName} onChange={(e) => setPartnerName(e.target.value)} />
          </div>
          <Button className="w-full" onClick={begin}>{t('begin')}</Button>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run → pass** (typecheck exit 0; the 4 onboarding tests pass).

- [ ] **Step 5: Commit** — `feat(v2): OnboardingView (3-screen entry)`.

---

## Task 10: Conversation page + route wiring

**Files:**
- Create: `web/src/routes/Conversation.tsx`; Modify: `web/src/App.tsx`

**Interfaces:**
- Composes `AuthProvider` + `I18nProvider` (locale from role) + `useConversation` + the components. Sets `document.documentElement.lang` per role so `:lang(ko)` applies. Drives a `sheetOpen` toggle for the ⋯ controls. Mounts at `/conversation`.

- [ ] **Step 1: Implement** `web/src/routes/Conversation.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '@/auth/auth-context';
import { I18nProvider } from '@/conversation/i18n';
import { useConversation } from '@/conversation/use-conversation';
import { OnboardingView } from '@/conversation/components/OnboardingView';
import { RiverTranscript } from '@/conversation/components/RiverTranscript';
import { StatusLine } from '@/conversation/components/StatusLine';
import { StateOverlay } from '@/conversation/components/StateOverlay';
import { ControlsSheet } from '@/conversation/components/ControlsSheet';

function ConversationInner() {
  const { adminKey, setAdminKey } = useAuth();
  const conv = useConversation({ adminKey });
  const { state } = conv;
  const [sheetOpen, setSheetOpen] = useState(false);
  const locale = state.role === 'joiner' ? 'ko' : 'en';

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const overlay =
    state.paused ? 'paused'
    : state.status === 'ended' ? 'ended'
    : state.status === 'reconnecting' ? 'reconnecting'
    : state.status === 'partnerAway' ? 'partnerAway'
    : state.phase === 'waiting' && state.role === 'host' ? null // host waiting is the QR onboarding screen
    : null;

  return (
    <I18nProvider locale={locale}>
      <div className="relative flex h-full flex-col bg-background">
        {state.phase === 'onboarding' || (state.phase === 'waiting' && state.role === 'host') ? (
          <OnboardingView
            phase={state.phase}
            role={state.role}
            room={state.room}
            names={state.names}
            adminKey={adminKey}
            onBegin={(hn, pn) => void conv.createRoom(hn, pn)}
            onJoin={() => void conv.joinRoom()}
            onSetAdminKey={setAdminKey}
            onBeginAnother={() => window.location.reload()}
          />
        ) : (
          <>
            <header className="flex items-center justify-between">
              <StatusLine status={state.status} paused={state.paused} />
              <div className="flex items-center gap-3 px-4 pt-3 text-muted-foreground">
                <span aria-label="voice-over">🔊</span>
                <button aria-label="controls" className="text-lg leading-none" onClick={() => setSheetOpen(true)}>⋯</button>
              </div>
            </header>
            <RiverTranscript turns={state.turns} role={state.role} names={state.names} />
          </>
        )}

        {overlay && state.phase !== 'onboarding' && (
          <StateOverlay
            kind={overlay as 'waiting' | 'partnerAway' | 'reconnecting' | 'paused' | 'ended'}
            names={state.names}
            onResume={conv.resume}
            onBeginAnother={() => window.location.reload()}
          />
        )}

        <ControlsSheet
          open={sheetOpen}
          role={state.role}
          config={state.config}
          devices={conv.devices}
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

- [ ] **Step 2: Wire the route** — in `web/src/App.tsx`, replace the `/conversation` line:
```tsx
      <Route path="/conversation" element={<Home />} />
```
with:
```tsx
      <Route path="/conversation" element={<Conversation />} />
```
and add the import:
```tsx
import { Conversation } from './routes/Conversation';
```

- [ ] **Step 3: typecheck** — `npm -w web run typecheck` → exit 0.

- [ ] **Step 4: Sanity-render test** — extend `web/src/App.test.tsx` minimally to assert `/conversation` mounts without crashing (the placeholder test already renders `<App/>` under `MemoryRouter` at `/`; add one routed case):
```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
describe('App', () => {
  it('renders the home route text', () => {
    const { getByText } = render(<MemoryRouter><App /></MemoryRouter>);
    expect(getByText('v2 web — route mounted')).toBeTruthy();
  });
  it('mounts /conversation without crashing', () => {
    const { container } = render(<MemoryRouter initialEntries={['/conversation']}><App /></MemoryRouter>);
    expect(container).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run → pass** (`npm -w web run typecheck` exit 0; `npm -w web test` green).

- [ ] **Step 6: Commit** — `feat(v2): conversation page + /conversation route`.

---

## Task 11: Server — serve the built v2 SPA at /conversation

So the joiner's scanned QR (`https://<lan-ip>:4000/conversation?token=…`) resolves to the v2 React app (today `GET /conversation` 404s on `public/conversation.html`, which doesn't exist on `main`). Fallback-safe: if the web build is absent, return a helpful message instead of 404.

**Files:**
- Modify: `server/src/index.ts` (lines 116 + 144-146).

- [ ] **Step 1: Serve the v2 SPA assets + page.** In `server/src/index.ts`:
  - After the existing `app.use(express.static(path.join(__dirname, '..', '..', 'public')));` (line 116), add the v2 build's hashed assets (Vite emits them under `/assets/*`, referenced absolutely by `index.html`):
    ```ts
    const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
    app.use('/assets', express.static(path.join(webDist, 'assets')));
    ```
  - Replace the `/conversation` route (lines 144-146):
    ```ts
    app.get('/conversation', (_req, res) => {
      res.sendFile(path.join(__dirname, '..', '..', 'public', 'conversation.html'));
    });
    ```
    with:
    ```ts
    app.get('/conversation', (_req, res) => {
      const idx = path.join(webDist, 'index.html');
      if (existsSync(idx)) {
        res.sendFile(idx);
      } else {
        res
          .status(503)
          .type('text/plain')
          .send('v2 conversation UI not built. Run `npm run build:v2`, or open the Vite dev server (npm run dev:web) at /conversation.');
      }
    });
    ```
    (`existsSync` is already imported at the top of the file; `path` is already imported; `webDist` is defined just above.)

- [ ] **Step 2: typecheck + test** — `npm -w server run typecheck` → exit 0; `npm -w server test` → 35/35 green (no regression). (No new server test: verifying the built SPA is served requires a `web/dist` build; that is covered by the manual check in Task 12. The change is a 6-line, fallback-safe route.)

- [ ] **Step 3: Commit** — `feat(v2): serve built conversation SPA at /conversation`.

---

## Task 12: Verify + manual browser check

- [ ] **Step 1: v2 typecheck + tests** — `npm -w web run typecheck` exit 0; `npm -w web test` → all green (reducer, i18n, auth, SocketClient + engines, RiverTranscript, states, ControlsSheet, OnboardingView, App). `npm -w server run typecheck` exit 0; `npm -w server test` → 35/35.

- [ ] **Step 2: v2 build** — `npm run build:v2` succeeds (shared typecheck → server build → web build). Confirm `@v2/shared` is erased at runtime: `grep -R '@v2/shared' web/dist` → empty (or only inside the engines' type-only surface, none at runtime). Confirm `web/dist/index.html` + `web/dist/assets/*` exist (consumed by Task 11).

- [ ] **Step 3: v1 untouched** — `git diff --stat main -- src/ public/ test/` → empty. `npm test` (v1, 5/5) green. The only files outside `web/` touched are `server/src/index.ts` (Task 11).

- [ ] **Step 4: Manual browser check (two-device / two-tab).** Start `npm run dev:server` (:4000) and `npm run dev:web` (:5173). On the host, open `https://localhost:5173/conversation`, enter the admin password (`changeme` unless `ADMIN_PASSWORD` is set) + names, tap **Begin** → see the QR + "Waiting…". On a second tab/device open `https://localhost:5173/conversation?token=<joinToken>` (copy `joinToken` from the create response in the server log, or scan the QR after `build:v2` against :4000), tap **참여하기** → both enter the live river. Verify: flowing river (host terracotta / joiner green labels, partner turn shows translation as main + original as subtitle), active-speaker emphasis on the current turn, `● Listening…` status line, ⋯ sheet (voice-over/clone host-only; mic picker; pause/resume; end), warm state copy on partner away / pause / end, and that toggling voice-over reconnects (config broadcast). Confirm cleanup (close tab → no console errors; mic indicator stops).

- [ ] **Step 5: Commit any backfill; final `git log --oneline main..HEAD`.**

---

## Self-Review

**Spec coverage:** Every section of the design spec maps to a task.
- *Onboarding (3 screens)* → Task 9 (+ host admin step in Task 4). *Flowing river + active-speaker emphasis + pure chrome* → Tasks 6, 7, 10. *Controls sheet (voice-over/clone/mic/pause/end, host-only voice-over/clone, reconnect-on-toggle via server)* → Task 8 (+ `setVoiceOver`/`setVoiceClone` → `/config` in Task 5). *States (waiting/partner-away/reconnecting/paused/ended, warm copy)* → Tasks 1 (status reducer) + 7. *i18n en/ko* → Task 2. *`useConversation` hook composing the engines* → Task 5. *Single `/conversation` route, role from `?token=`* → Task 10. *Resilience (auto-reconnect, stop on 1008, engine cleanup on unmount)* → Tasks 3 + 5. *Serving the SPA so the QR works* → Task 11.
- *Technical design — engine layer (SocketClient/MicCaptureEngine/PlaybackEngine) + useReducer + AuthContext + no global store* → Tasks 1, 3, 4, 5. *shadcn components (Button/Input/Label/Switch/Card)* → used across Tasks 7–10 (Card not strictly required; the spec lists it but the mockups don't use a Card on the conversation page — Switch/Input/Label/Button are the ones used; that's faithful).

**Placeholder scan:** Every code step contains the full implementation or full test. No TBD/TODO/“add error handling”/“similar to Task N”. The two explicitly-manual pieces (the `useConversation` engine orchestration in Task 5, mic capture, and the Task 11 served-SPA assertion) are documented as manual-verified in Task 12 — not placeholders, because the automatable logic (the reducer) is fully tested in Task 1.

**Type consistency:** `ConversationState` / `Turn` / `Action` / `StatusKind` / `Phase` / `RoomData` are defined once in `types.ts` (Task 1) and referenced consistently by the reducer (T1), the hook (T5), and every component (T6–T10). `createInitialState(role)` + `conversationReducer` signatures match across T1 and T5. The hook's returned action names (`createRoom`, `joinRoom`, `setVoiceOver`, `setVoiceClone`, `setMicDevice`, `pause`, `resume`, `endConversation`) match what `Conversation.tsx` (T10) calls. `ControlsSheet` / `OnboardingView` / `StateOverlay` props match how T10 instantiates them. `SocketClientOptions.onOpen`/`onReconnecting` (T3) match how T5 wires them. `@v2/shared` message field names (`names`, `voiceOver`/`voiceClone`, `state`/`host`/`joiner`, `speaker`/`field`/`text`, `data`) match the verbatim contract. The WS message → Action mapping in T5 covers all six message types.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-16-v2-conversation-ui.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, reviewed between tasks.
**2. Inline Execution** — in this session with checkpoints.

**Which approach?**

After Plan 5 lands, **Plan 6+** builds the attendee → interpreter → admin surfaces, reusing this design system + the engines.
