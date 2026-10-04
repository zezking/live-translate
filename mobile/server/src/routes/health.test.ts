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
