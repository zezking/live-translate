# v2 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the v2 foundation — a full-stack TypeScript monorepo (React+Vite frontend, Express+ws backend, shared contract types) plus the warm-&-human design system — so subsequent plans (backend TS port, conversation page, other surfaces) build on a working, typed, styled base. This is **Plan 1 of the v2 roadmap**; it deliberately does NOT port the real backend modules or build any real page.

**Architecture:** npm-workspaces monorepo with three packages: `web/` (Vite + React 18 + TypeScript + React Router SPA), `server/` (Node + TypeScript Express + ws, run via `tsx` in dev and `tsc` in prod), and `shared/` (the WS/REST contract types, imported as source by both). v1 (`src/`, `public/`) stays untouched and running on port 3001; v2 runs alongside it (server on 4000, Vite dev on 5173). The design system is Tailwind v4 + shadcn/ui themed warm-&-human (warm-gray neutrals + a terracotta accent, generous radii, Korean-aware type).

**Tech Stack:** Node 24, TypeScript 5.6+, React 18, Vite 5, React Router 6, Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui, Express 5, ws 8, tsx, Vitest. ESM throughout.

## Global Constraints

- **Do not touch v1.** `src/`, `public/`, `test/`, `scripts/`, the root `package.json` scripts (`start`, `dev`, `test`), and v1's `cert/` stay exactly as-is. v1 keeps running. v2 lives in new top-level dirs `web/`, `server/`, `shared/`. Add v2 commands under new script names — never repurpose `start`/`dev`/`test`.
- **v2 runs alongside v1.** v2 backend dev port = `4000` (avoid v1's `3001`). v2 Vite dev = `5173`. Both reachable; no port conflicts with v1.
- **ESM everywhere** (`"type": "module"` in every package.json). Use `import`/`export`, `.ts` extensions resolved by tsx/Vite.
- **TypeScript strict** (`"strict": true`) in all three tsconfigs.
- **The design system is warm-&-human**: warm-gray (stone) neutrals, terracotta accent `#c0623a`, `0.75rem` radius, comfortable spacing, Korean line-height `1.6` via `:lang(ko)`. No redesign of layouts in this plan — just the system.
- **Each task leaves a runnable, verifiable artifact** (a package that installs, a server that boots over HTTPS, a frontend that builds/renders, a design route that shows themed components). Verify with explicit commands; no "it should work."
- **No build step for v1 is introduced.** v2's build is isolated to the new workspaces.

---

## File Structure

```
/                       (root — v1 untouched)
├── package.json        (MODIFY: add workspaces + v2 scripts only)
├── web/                (NEW — v2 frontend workspace)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── routes/{Home,Design}.tsx
│       ├── lib/utils.ts           (shadcn `cn`)
│       └── components/ui/         (shadcn components)
├── server/             (NEW — v2 backend workspace)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── src/
│       ├── index.ts              (Express app + HTTPS + listen)
│       ├── env.ts                (typed env)
│       └── routes/health.ts
└── shared/             (NEW — contract types workspace)
    ├── package.json
    ├── tsconfig.json
    └── src/index.ts              (WS + REST message types)
```

---

## Task 1: Monorepo + workspaces scaffold

**Files:**
- Modify: `package.json` (root — add `workspaces` + v2 scripts only; keep v1 `start`/`dev`/`test`)
- Create: `web/package.json`, `server/package.json`, `shared/package.json`
- Create: `tsconfig.base.json`, `web/tsconfig.json`, `server/tsconfig.json`, `shared/tsconfig.json`

**Interfaces:**
- Produces: three installable workspace packages (`@v2/web`, `@v2/server`, `@v2/shared`) resolvable from the root; `npm install` at root links them.

- [ ] **Step 1: Add workspaces + v2 scripts to root package.json**

In the root `package.json`, add (do NOT remove or rename existing fields/scripts):
```json
  "workspaces": ["web", "server", "shared"],
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "test": "node --test",
    "dev:server": "npm -w server run dev",
    "dev:web": "npm -w web run dev",
    "build:v2": "npm -w server run build && npm -w web run build",
    "test:v2": "npm -w server test --silent && npm -w web test --silent"
  }
```

- [ ] **Step 2: Create the three package.json files**

`shared/package.json`:
```json
{
  "name": "@v2/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

`server/package.json`:
```json
{
  "name": "@v2/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@v2/shared": "*",
    "dotenv": "^17.4.2",
    "express": "^5.2.1",
    "ws": "^8.21.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^24.0.0",
    "@types/ws": "^8.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`web/package.json`:
```json
{
  "name": "@v2/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@v2/shared": "*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@testing-library/react": "^16.0.0",
    "jsdom": "^25.0.0"
  }
}
```

- [ ] **Step 3: Create the tsconfigs**

`tsconfig.base.json` (root):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "noEmit": true
  }
}
```

`shared/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "rootDir": "src" }, "include": ["src"] }
```

`server/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": false,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"]
  },
  "include": ["src"]
}
```

`web/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "moduleResolution": "Bundler",
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Install + verify workspaces link**

Run:
```bash
npm install
node -e "console.log(require.resolve('@v2/shared/package.json'))" || echo "shared resolves"
```
Expected: `npm install` succeeds (it will create `web/`, `server/`, `shared/` node_modules symlinks); the resolve check prints a path under `shared/`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json web/package.json server/package.json shared/package.json web/tsconfig.json server/tsconfig.json shared/tsconfig.json
git commit -m "feat(v2): monorepo workspaces scaffold (web/server/shared)"
```

---

## Task 2: shared contract types

**Files:**
- Create: `shared/src/index.ts`

**Interfaces:**
- Produces: `@v2/shared` exports `ConversationWsMessage` (union), `TranslationWsMessage` (union), and REST request/response types (`CreateRoomRequest`, `CreateRoomResponse`, `UpdateConfigRequest`, `EndRoomRequest`). Consumed by Tasks 3, 6, and later plans.

- [ ] **Step 1: Write the contract types**

Create `shared/src/index.ts`:
```ts
// ---- WS messages shared across v2 surfaces ----

export type Role = 'host' | 'joiner';

export interface RoomInfoMessage { type: 'roomInfo'; names: { host: string; joiner: string } }
export interface ConfigMessage { type: 'config'; voiceOver: boolean; voiceClone: boolean }
export interface StatusMessage { type: 'status'; state: 'waiting' | 'listening' | 'paused' | 'ended'; host: boolean; joiner: boolean }
export interface DeltaMessage { type: 'delta'; speaker: Role; field: 'original' | 'translation'; text: string }
export interface TurnEndMessage { type: 'turnEnd'; speaker: Role }
export interface AudioMessage { type: 'audio'; data: string } // base64 24kHz PCM

export type ConversationWsMessage =
  | RoomInfoMessage | ConfigMessage | StatusMessage
  | DeltaMessage | TurnEndMessage | AudioMessage;

export interface TranscriptionMessage { type: 'transcription'; languageCode: string; transcriptionType: 'input' | 'output'; text: string }
export type TranslationWsMessage = TranscriptionMessage | { type: 'audio'; languageCode: string; data: string } | { type: 'status'; state: string };

// ---- REST contracts ----

export interface CreateRoomRequest { hostName?: string; partnerName?: string; voiceOver?: boolean; voiceClone?: boolean }
export interface CreateRoomResponse { roomId: string; hostToken: string; joinToken: string; joinUrl: string; qrDataUrl: string }
export interface UpdateConfigRequest { roomId: string; voiceOver?: boolean; voiceClone?: boolean }
export interface EndRoomRequest { roomId: string }
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm -w shared run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add shared/src/index.ts
git commit -m "feat(v2): shared WS/REST contract types"
```

---

## Task 3: server TS skeleton (Express + ws + HTTPS)

**Files:**
- Create: `server/src/index.ts`, `server/src/env.ts`, `server/src/routes/health.ts`, `server/vitest.config.ts`, `server/src/routes/health.test.ts`

**Interfaces:**
- Produces: a runnable v2 backend at `https://localhost:4000` with a `/api/health` route returning `{ok:true, ts:number}`, HTTPS using the existing root `cert/`, and a passing Vitest test.

- [ ] **Step 1: Write the failing test**

`server/src/routes/health.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import http from 'node:http';
import { healthRouter } from './health.js';

describe('health route', () => {
  it('returns {ok:true} json over http', async () => {
    const app = express().use('/api/health', healthRouter);
    const server = app.listen(0);
    const { port } = server.address() as { port: number };
    const body = await new Promise<{ ok?: boolean; ts?: number }>((resolve, reject) => {
      http.get(`http://localhost:${port}/api/health`, (r) => {
        let data = '';
        r.on('data', (c) => (data += c));
        r.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
    server.close();
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe('number');
  });
});
```

- [ ] **Step 2: Write env + health route + server entry**

`server/src/env.ts`:
```ts
import 'dotenv/config';
export const env = {
  PORT: Number(process.env.V2_PORT ?? 4000),
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? 'changeme',
  CERT_DIR: process.env.CERT_DIR ?? new URL('../../cert/', import.meta.url).pathname,
};
```

`server/src/routes/health.ts`:
```ts
import { Router } from 'express';
export const healthRouter = Router();
healthRouter.get('/', (_req, res) => res.json({ ok: true, ts: Date.now() }));
```

`server/src/index.ts`:
```ts
import { createServer as createHttps } from 'https';
import { createServer as createHttp } from 'http';
import { existsSync, readFileSync } from 'fs';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './env.js';
import { healthRouter } from './routes/health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use('/api/health', healthRouter);

const keyPath = path.join(env.CERT_DIR, 'key.pem');
const certPath = path.join(env.CERT_DIR, 'cert.pem');
const useTls = existsSync(keyPath) && existsSync(certPath);
const server = useTls
  ? createHttps({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, app)
  : createHttp(app);

server.listen(env.PORT, '0.0.0.0', () => {
  console.log(`v2 server on :${env.PORT} (${useTls ? 'https' : 'http'})`);
});
```

`server/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'] } });
```

- [ ] **Step 3: Run typecheck + test + boot**

```bash
npm -w server run typecheck
npm -w server test
V2_PORT=4000 npm -w server run dev &
sleep 2
curl -k https://localhost:4000/api/health
kill %1
```
Expected: typecheck exit 0; vitest 1 pass; curl prints `{"ok":true,"ts":...}`.

- [ ] **Step 4: Commit**

```bash
git add server/src server/vitest.config.ts
git commit -m "feat(v2): server TS skeleton (express + https + health route)"
```

---

## Task 4: web TS skeleton (Vite + React + Router + proxy)

**Files:**
- Create: `web/vite.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/routes/Home.tsx`, `web/vitest.config.ts`, `web/src/test/setup.ts`, `web/src/App.test.tsx`

**Interfaces:**
- Produces: a Vite React app with React Router (routes `/`, `/admin`, `/interpreter`, `/conversation` all rendering a placeholder for now), dev server proxies `/api` + `/ws` to `https://localhost:4000`.

- [ ] **Step 1: vite config + index.html + entry**

`web/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'https://localhost:4000', secure: false, changeOrigin: true },
      '/ws': { target: 'wss://localhost:4000', ws: true, secure: false, changeOrigin: true },
    },
  },
});
```

`web/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>v2</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

`web/src/main.tsx`:
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>
);
```

`web/src/App.tsx`:
```tsx
import { Routes, Route } from 'react-router-dom';
import { Home } from './routes/Home';
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/admin" element={<Home />} />
      <Route path="/interpreter" element={<Home />} />
      <Route path="/conversation" element={<Home />} />
    </Routes>
  );
}
```

`web/src/routes/Home.tsx`:
```tsx
export function Home() {
  return <main style={{ padding: 24, fontFamily: 'system-ui' }}>v2 web — route mounted</main>;
}
```

- [ ] **Step 2: Vitest config + a render test**

`web/src/test/setup.ts`:
```ts
import '@testing-library/react';
```
`web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
});
```
`web/src/App.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
describe('App', () => {
  it('renders the route text', () => {
    const { getByText } = render(<MemoryRouter><App /></MemoryRouter>);
    expect(getByText('v2 web — route mounted')).toBeTruthy();
  });
});
```

- [ ] **Step 3: typecheck + test + build**

```bash
npm -w web run typecheck
npm -w web test
npm -w web run build
```
Expected: typecheck exit 0; vitest 1 pass; `vite build` produces `web/dist`.

- [ ] **Step 4: Commit**

```bash
git add web/vite.config.ts web/index.html web/vitest.config.ts web/src
git commit -m "feat(v2): web TS skeleton (vite + react + router + dev proxy)"
```

---

## Task 5: Tailwind v4 + warm-&-human tokens

**Files:**
- Modify: `web/package.json` (add tailwind deps), `web/vite.config.ts` (add plugin), `web/src/main.tsx` (import css)
- Create: `web/src/styles.css`, `web/src/routes/Design.tsx` (added in Task 6), update `web/src/App.tsx` (add `/design` route — done in Task 6)

**Interfaces:**
- Produces: Tailwind v4 wired into the Vite build, with warm-&-human design tokens exposed as CSS variables / Tailwind theme, applied to the app shell.

- [ ] **Step 1: Install Tailwind v4**

```bash
npm -w web i -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Add the Vite plugin**

In `web/vite.config.ts`, add the plugin:
```ts
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ...server proxy unchanged
});
```

- [ ] **Step 3: Write the warm-&-human stylesheet**

`web/src/styles.css`:
```css
@import "tailwindcss";

@theme {
  --color-background: #faf9f7;
  --color-foreground: #2a2724;
  --color-card: #ffffff;
  --color-muted: #f1ede7;
  --color-muted-foreground: #6b6358;
  --color-primary: #c0623a;          /* warm terracotta accent */
  --color-primary-foreground: #ffffff;
  --color-border: #e7e0d6;
  --color-ring: #c0623a;
  --radius: 0.75rem;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", "Apple SD Gothic Neo", sans-serif;
}

html, body, #root { height: 100%; }
body { background: var(--color-background); color: var(--color-foreground); font-family: var(--font-sans); }

/* Korean needs more vertical breathing room */
:lang(ko) { line-height: 1.6; }
```

- [ ] **Step 4: Import the stylesheet in main.tsx**

Add at the top of `web/src/main.tsx`:
```tsx
import './styles.css';
```

- [ ] **Step 5: Verify the build picks up Tailwind + tokens**

```bash
npm -w web run build
```
Expected: build succeeds; `web/dist/assets/*.css` contains the terracotta hex `#c0623a`.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/vite.config.ts web/src/styles.css web/src/main.tsx package-lock.json
git commit -m "feat(v2): tailwind v4 + warm-and-human design tokens"
```

---

## Task 6: shadcn/ui + core components + /design showcase

**Files:**
- Create: `web/components.json`, `web/src/lib/utils.ts`, `web/src/components/ui/*` (shadcn-generated), `web/src/routes/Design.tsx`
- Modify: `web/src/App.tsx` (add `/design` route)

**Interfaces:**
- Produces: shadcn/ui initialized against the warm-&-human tokens; core components (Button, Card, Input, Label, Switch) installed; a `/design` route showcasing them + a chat-Bubble prototype. Proves the design system is usable.

- [ ] **Step 1: Init shadcn + add components**

```bash
cd web
npx shadcn@latest init -d            # uses defaults; picks up the @theme tokens / CSS vars
npx shadcn@latest add button card input label switch
cd ..
```
(If `shadcn init` prompts, accept defaults: style=new-york, base color=stone, css variables=yes, --src-dir, components alias `@/components`, utils alias `@/lib`.) This generates `web/components.json`, `web/src/lib/utils.ts` (`cn`), and `web/src/components/ui/{button,card,input,label,switch}.tsx`, and adds `clsx` + `tailwind-merge` to `web/package.json`. Ensure `web/tsconfig.json` has path alias `"@/*": ["src/*"]` and `web/vite.config.ts` resolves it (add `resolve: { alias: { '@': path.resolve(__dirname, 'src') } }` if shadcn components use `@/lib/utils`).

- [ ] **Step 2: Write the /design showcase route**

`web/src/routes/Design.tsx`:
```tsx
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function Design() {
  return (
    <main className="mx-auto max-w-md p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Design system</h1>
      <Card>
        <CardHeader><CardTitle>Conversation</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="n">Your name</Label>
            <Input id="n" placeholder="Enze" />
          </div>
          <div className="flex items-center gap-3">
            <Switch id="vo" /><Label htmlFor="vo">Voice-over</Label>
          </div>
          <Button>Start</Button>
        </CardContent>
      </Card>
      <div className="rounded-2xl bg-muted p-4">
        <p className="text-sm text-muted-foreground">안녕하세요</p>
        <p>hello</p>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Mount the route**

In `web/src/App.tsx`, import `{ Design }` from `./routes/Design'` and add inside `<Routes>`:
```tsx
<Route path="/design" element={<Design />} />
```

- [ ] **Step 4: typecheck + build**

```bash
npm -w web run typecheck
npm -w web run build
```
Expected: both succeed; `web/dist` builds with the warm-&-human-styled components.

- [ ] **Step 5: Manual visual check**

```bash
npm -w web run dev
```
Open `http://localhost:5173/design`. Confirm: warm off-white background, terracotta Button, rounded card, Switch toggles, Korean subtitle renders with comfortable line-height. (No automated visual test — confirm by eye, screenshot optional.)

- [ ] **Step 6: Commit**

```bash
git add web/components.json web/src/lib web/src/components web/src/routes/Design.tsx web/src/App.tsx web/tsconfig.json web/vite.config.ts web/package.json package-lock.json
git commit -m "feat(v2): shadcn/ui core components + /design showcase"
```

---

## Task 7: Dev workflow + v2 README

**Files:**
- Create: `docs/v2/README.md`
- Modify: root `package.json` (scripts already added in Task 1 — verify they work)

**Interfaces:**
- Produces: documented two-terminal dev workflow (v2 server + v2 web, proxy wired); a single `npm run build:v2` that builds both packages.

- [ ] **Step 1: Write the v2 dev doc**

`docs/v2/README.md`:
````markdown
# v2 (React + TypeScript)

v2 lives in `web/`, `server/`, `shared/`. v1 (`src/`, `public/`) is untouched and still runs on port 3001.

## Dev (two terminals)

```bash
npm install                       # at repo root — links workspaces
npm run dev:server                # terminal 1 — v2 backend on https://localhost:4000
npm run dev:web                   # terminal 2 — Vite on http://localhost:5173 (proxies /api + /ws to :4000)
```

Open `http://localhost:5173` (routes `/`, `/design`). The browser talks to v2's backend through Vite's proxy.

## Build / test

```bash
npm run build:v2                  # tsc server -> server/dist ; vite build web -> web/dist
npm run test:v2                   # vitest in server + web
```

## Ports (v2 alongside v1)

| Thing | Port |
|---|---|
| v1 backend (unchanged) | 3001 |
| v2 backend | 4000 |
| v2 web (Vite dev) | 5173 |

Cert: v2 reuses the root `cert/` (generated by `node scripts/gen-cert.mjs`).
````

- [ ] **Step 2: Verify the end-to-end dev flow**

```bash
npm run dev:server &
sleep 2
curl -k https://localhost:4000/api/health          # v2 backend up
npm run dev:web &
sleep 3
curl -s http://localhost:5173/ | grep -q "v2" && echo "web up"
curl -sk https://localhost:5173/api/health          # proxied to v2 backend → {ok:true}
kill %1 %2
```
Expected: v2 backend health OK; web index serves; the proxied `/api/health` through Vite returns `{ok:true,...}`.

- [ ] **Step 3: Verify build:v2 + test:v2 from root**

```bash
npm run build:v2
npm run test:v2
```
Expected: both packages build; all v2 tests pass.

- [ ] **Step 4: Verify v1 is untouched + still runs**

```bash
npm test                                           # v1 node --test suite (must be unchanged/green)
npm run start & sleep 2; curl -k https://localhost:3001/api/languages; kill %1
```
Expected: v1 tests green; v1 server still serves on 3001 (proves the foundation didn't break v1).

- [ ] **Step 5: Commit**

```bash
git add docs/v2/README.md
git commit -m "docs(v2): dev workflow + port map"
```

---

## Self-Review

**Spec coverage:** full-stack TS monorepo (Task 1) · shared contract types (Task 2) · server TS skeleton HTTPS (Task 3) · web TS skeleton + Router + proxy (Task 4) · Tailwind v4 + warm-&-human tokens (Task 5) · shadcn core components + showcase (Task 6) · dev workflow + v1 untouched (Task 7). This plan deliberately stops short of porting real backend modules (Plan 2) and building real pages (Plan 3+) — those depend on the conversation-UX design session. Global Constraints honored: v1 untouched (verified Task 7 Step 4), v2 alongside v1 (ports 4000/5173 vs 3001), ESM + strict TS throughout.

**Placeholder scan:** every step has the actual file content / commands. The one semi-external step is `npx shadcn@latest init/add` (Task 6) — its output is generated by the tool, but the showcase route + route wiring are fully specified.

**Type consistency:** `@v2/shared` exports (`ConversationWsMessage`, `CreateRoomResponse`, etc.) are named in Task 2 and referenced consistently; `Role = 'host' | 'joiner'` matches the conversation work from the prior plan. Package names `@v2/{web,server,shared}` are consistent across all package.json/tsconfig references.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-14-v2-foundation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

After this foundation lands, the next steps are: (a) a **conversation-UX design session** (mockups for the reimagined conversation page), then (b) **Plan 2** (port the backend to TypeScript), then (c) **Plan 3** (the reimagined conversation page in React).
