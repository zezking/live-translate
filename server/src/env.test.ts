import { describe, it, expect } from 'vitest';
import { resolveEnvPath } from './env.js';

describe('resolveEnvPath', () => {
  it('resolves the repo-root .env relative to the module, not the process cwd', () => {
    const p = resolveEnvPath();
    // The v2 server is launched via `npm -w server run dev` (cwd = server/), so a
    // cwd-relative dotenv lookup misses the repo-root .env. The path must anchor to
    // the module location: server/src/env.ts (and server/dist/env.js) → ../../.env.
    expect(p).toBe(new URL('../../.env', import.meta.url).pathname);
    expect(p.endsWith('/server/.env')).toBe(false);
  });
});
