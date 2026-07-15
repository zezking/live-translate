import 'dotenv/config';
export const env = {
  PORT: Number(process.env.V2_PORT ?? 4000),
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? 'centrechurch',
  CERT_DIR: process.env.CERT_DIR ?? new URL('../../cert/', import.meta.url).pathname,
};
