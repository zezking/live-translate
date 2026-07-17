# Center Church Live Translation

AI-powered real-time sermon/conversation translation for Center Church. The repo holds two generations of the app:

- **v1** (production, do not touch during v2 work): root `src/server.js` (Express + Gemini Live), `public/` (vanilla JS frontend), `test/` (node:test). Root `package.json` scripts belong to v1 unless prefixed.
- **v2** (active rewrite, all new code): npm workspaces — `shared/` (`@v2/shared` message types, raw TS consumed via workspace symlink), `server/` (Express + TS, port 4000), `web/` (React 18 + TS strict + Vite + Tailwind v4 SPA).

## Commands

```bash
# v2 (daily work)
npm run dev:server        # v2 backend with tsx watch (:4000)
npm run dev:web           # Vite dev server (:5173)
npm run build:v2          # shared typecheck → server build → web build
npm run test:v2           # server + web unit tests
npm -w web run typecheck  # tsc --noEmit (web)
npm -w web test           # vitest run (web)
npm -w server run typecheck
npm -w server test

# v1 (regression check only)
npm test                  # node --test test/*.test.js
npm run dev               # v1 server with --watch
```

## Hard constraints

- **Do not modify v1** (`src/`, `public/`, `test/`, root `package.json`, `src/server.js`) while on v2 feature branches. New v2 code lives under `web/src/`, `server/src/`, `shared/src/`.
- **TypeScript strict** everywhere in v2; no `any` without a `// reason` comment. Local relative imports in `web/` use `.js` extensions. `@/*` aliases `web/src/*`.
- **Commit style:** `feat(v2): <summary>` for v2 work (see git log for variants like `fix(v2):`, `docs(v2):`).
- v2 host admin password defaults to `centrechurch` (env `ADMIN_PASSWORD`).

## v2 architecture (conversation surface)

- `web/src/engines/` — framework-agnostic `SocketClient` (WS + backoff reconnect), `MicCaptureEngine` (getUserMedia + `/pcm-worklet.js`), `PlaybackEngine` (24 kHz gapless PCM).
- `web/src/conversation/` — pure `reducer.ts` state machine (river/status/config), `i18n.tsx` (en/ko), `use-conversation.ts` (hook composing engines + reducer + REST), `components/` (RiverTranscript, StatusLine, StateOverlay, BottomSheet, ControlsSheet, OnboardingView).
- `web/src/routes/Conversation.tsx` mounted at `/conversation`; role comes from `?token=` (joiner → Korean UI; none → host English setup). Built SPA served by the v2 server at `/conversation` (+ `/assets`).
- WS contract: client→server is **binary 16-bit PCM only**; server→client is JSON (`roomInfo`, `config`, `status`, `delta`, `turnEnd`, `audio`). Close code 1008 is terminal (do not reconnect).
- Design/implementation plans live in `docs/superpowers/plans/`.

## Testing norms

- vitest + React Testing Library + jsdom for `web/`; `web/src/test/setup.ts` provides `afterEach(cleanup)` and a `scrollIntoView` stub.
- TDD for pure logic (reducers, i18n, presentational components); browser-orchestration hooks are typecheck-gated and verified manually.
