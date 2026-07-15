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
