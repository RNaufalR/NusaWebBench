import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '@nusawebbench/core';
import { RunOrchestrator } from '@nusawebbench/orchestrator';
import { AiService, AiSettingsService } from '@nusawebbench/ai';
import { ArtifactStore, Store } from '@nusawebbench/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, startServer } from '../src/index.js';

/** Regresi audit: error mapping rute, guard Host, dan batas request. Tanpa browser. */
let dir: string;
let store: Store;
let server: Server;
let port = 0;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'nwb-sec-'));
  store = Store.open(path.join(dir, 'db.sqlite'));
  const artifacts = new ArtifactStore({ rootDir: path.join(dir, 'a'), evidence: store.evidence });
  const config = loadConfig({ AI_PROVIDER: 'none' });
  const app = createApp({
    store,
    artifacts,
    orchestrator: new RunOrchestrator({ store, adapters: [] }),
    aiSettings: new AiSettingsService(store, config),
    aiService: new AiService({ store, config, clients: {} }),
    allowedHosts: ['127.0.0.1', 'localhost'],
  });
  server = await startServer(app.handle, { host: '127.0.0.1', port: 0 });
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Memakai http.request mentah agar header Host dikirim persis seperti yang ditulis. */
function rawGet(
  p: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: p, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString('utf8')));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('rute: persen-encoding tidak valid (regresi error mapping)', () => {
  it('mengembalikan 400 VALIDATION_FAILED, bukan 500', async () => {
    const res = await rawGet('/api/runs/%E0%A4%A', { host: `127.0.0.1:${port}` });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'VALIDATION_FAILED' });
  });

  it('ID valid tanpa encoding aneh tetap 404 (bukan 400)', async () => {
    const res = await rawGet('/api/runs/run_00000000000000000000000000000000', {
      host: `127.0.0.1:${port}`,
    });
    expect(res.status).toBe(404);
  });
});

describe('guard Host (regresi DNS rebinding)', () => {
  it('menolak Host yang tidak ada di allowlist walau path valid', async () => {
    const res = await rawGet('/api/runs', { host: 'evil.test' });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'HOST_NOT_ALLOWED' });
  });

  it('menolak Host evil dengan port', async () => {
    const res = await rawGet('/api/runs', { host: `evil.test:${port}` });
    expect(res.status).toBe(403);
  });

  it('menerima Host yang diizinkan', async () => {
    const res = await rawGet('/api/runs', { host: `127.0.0.1:${port}` });
    expect(res.status).toBe(200);
  });
});
