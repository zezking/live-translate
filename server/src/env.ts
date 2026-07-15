import 'dotenv/config';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;

export const env = {
  PORT: Number(process.env.V2_PORT ?? 4000),
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? 'centrechurch',
  CERT_DIR: process.env.CERT_DIR ?? new URL('../../cert/', import.meta.url).pathname,
  GEMINI_API_KEY,
  DASHSCOPE_API_KEY,
  apiKeys: {
    gemini: GEMINI_API_KEY,
    qwen: DASHSCOPE_API_KEY,
  },
};
