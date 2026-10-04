import { config } from 'dotenv';
import { existsSync } from 'node:fs';

/**
 * Repo-root `.env`, resolved from this module's location — NOT the process cwd.
 * `npm -w server run dev` launches with cwd `server/`, where a cwd-relative
 * dotenv lookup silently finds nothing (env vars then read as undefined).
 * Works from both `server/src/env.ts` (tsx dev) and `server/dist/env.js` (built).
 */
export function resolveEnvPath(): string {
  return new URL('../../.env', import.meta.url).pathname;
}

const envPath = resolveEnvPath();
config(existsSync(envPath) ? { path: envPath } : undefined);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;

export const env = {
  PORT: Number(process.env.V2_PORT ?? 4000),
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? 'changeme',
  CERT_DIR: process.env.CERT_DIR ?? new URL('../../cert/', import.meta.url).pathname,
  GEMINI_API_KEY,
  DASHSCOPE_API_KEY,
  apiKeys: {
    gemini: GEMINI_API_KEY,
    qwen: DASHSCOPE_API_KEY,
  },
};
