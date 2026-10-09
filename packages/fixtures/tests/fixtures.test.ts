import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { MODULE_NAMES, SEVERITIES } from '@nusawebbench/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_FIXTURES_ROOT,
  FIXTURE_NAMES,
  readGroundTruth,
  resolveFixturePath,
  startFixture,
  type FixtureServer,
} from '../src/index.js';

const open: FixtureServer[] = [];

afterEach(async () => {
  while (open.length > 0) {
    await open.pop()?.close();
  }
});

async function start(name: string, port = 0): Promise<FixtureServer> {
  const s = await startFixture(name, { port });
  open.push(s);
  return s;
}

describe('startFixture — bind, port, dan stop', () => {
  it('bind hanya ke 127.0.0.1 dan memakai port acak bila 0', async () => {
    const s = await start('clean');
    expect(s.origin.startsWith('http://127.0.0.1:')).toBe(true);
    expect(s.port).toBeGreaterThan(0);
  });

  it('start dan stop: setelah close, port tidak lagi menerima koneksi', async () => {
    const s = await start('clean');
    const res = await fetch(`${s.origin}/index.html`);
    expect(res.status).toBe(200);
    await res.text();
    await s.close();
    open.splice(open.indexOf(s), 1);
    await expect(fetch(`${s.origin}/index.html`)).rejects.toThrow();
  });

  it('port yang sudah dipakai menghasilkan error (tidak diam-diam pindah)', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()));
    const address = blocker.address();
    const busy = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      await expect(startFixture('clean', { port: busy })).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it('nama fixture tidak dikenal ditolak', async () => {
    await expect(startFixture('../etc', { port: 0 })).rejects.toThrow(/tidak dikenal/);
    await expect(startFixture('nope', { port: 0 })).rejects.toThrow(/tidak dikenal/);
  });

  it('port di luar rentang ditolak', async () => {
    await expect(startFixture('clean', { port: 70000 })).rejects.toThrow(/port/);
  });
});

describe('startFixture — keamanan path', () => {
  it.each([
    '/../../package.json',
    '/..%2f..%2fpackage.json',
    '/%2e%2e/%2e%2e/package.json',
    '/..%5c..%5cpackage.json',
    '/%00index.html',
    '/index.html%00.txt',
  ])('menolak %s tanpa membaca file di luar fixture', async (p) => {
    const s = await start('clean');
    const res = await fetch(`${s.origin}${p}`);
    const body = await res.text();
    expect(res.status).toBe(404);
    expect(body).not.toContain('"name"');
  });

  it('metode selain GET/HEAD ditolak 405', async () => {
    const s = await start('clean');
    const res = await fetch(`${s.origin}/index.html`, { method: 'POST', body: 'x' });
    expect(res.status).toBe(405);
  });

  it('resolveFixturePath menolak symlink ke luar folder', () => {
    const fixtureDir = path.join(DEFAULT_FIXTURES_ROOT, 'clean');
    expect(resolveFixturePath(fixtureDir, '/../ground-truth.json')).toBeNull();
    expect(resolveFixturePath(fixtureDir, '/index.html')).toBe(path.join(fixtureDir, 'index.html'));
  });

  it('header keamanan dasar dikirim (nosniff, no-store)', async () => {
    const s = await start('clean');
    const res = await fetch(`${s.origin}/index.html`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    await res.text();
  });
});

describe('rute khusus fixture', () => {
  it('functional-defects: /api/missing-resource mengembalikan 404', async () => {
    const s = await start('functional-defects');
    const res = await fetch(`${s.origin}/api/missing-resource`);
    expect(res.status).toBe(404);
    await res.text();
  });

  it('clean tidak punya rute rentan: /search dan /api tidak ada', async () => {
    const s = await start('clean');
    expect((await fetch(`${s.origin}/search?q=x`)).status).toBe(404);
    expect((await fetch(`${s.origin}/api/missing-resource`)).status).toBe(404);
  });

  it('security-lab: /search memantulkan input (SENGAJA RENTAN, hanya lokal)', async () => {
    const s = await start('security-lab');
    const payload = '<i>nwb-probe</i>';
    const res = await fetch(`${s.origin}/search?q=${encodeURIComponent(payload)}`);
    const body = await res.text();
    expect(body).toContain(payload);
    expect(s.origin.startsWith('http://127.0.0.1:')).toBe(true);
  });
});

describe('isi fixture dan label synthetic', () => {
  it('setiap halaman HTML fixture diberi label synthetic/demo', () => {
    for (const name of FIXTURE_NAMES) {
      const dir = path.join(DEFAULT_FIXTURES_ROOT, name);
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.html')) continue;
        const html = readFileSync(path.join(dir, file), 'utf8');
        expect(html, `${name}/${file}`).toContain('nwb-fixture');
        expect(html, `${name}/${file}`).toContain('synthetic/demo');
      }
    }
  });

  it('security-lab memuat peringatan tidak untuk deploy', () => {
    const html = readFileSync(
      path.join(DEFAULT_FIXTURES_ROOT, 'security-lab', 'index.html'),
      'utf8',
    );
    expect(html).toContain('SENGAJA RENTAN');
  });

  it('tidak ada fixture yang memuat secret atau kunci API nyata', () => {
    const suspicious =
      /AIza[0-9A-Za-z_-]{35}|gsk_[A-Za-z0-9]{40,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
    for (const name of FIXTURE_NAMES) {
      const dir = path.join(DEFAULT_FIXTURES_ROOT, name);
      for (const file of readdirSync(dir)) {
        const full = path.join(dir, file);
        if (!statSync(full).isFile()) continue;
        expect(readFileSync(full, 'utf8'), full).not.toMatch(suspicious);
      }
    }
  });
});

describe('ground truth', () => {
  type Gt = {
    schemaVersion: number;
    synthetic: boolean;
    fixtures: Array<{
      id: string;
      path: string;
      expectedFindings: Array<{
        id: string;
        module: string;
        expectedSeverity: string;
        ruleId?: string;
        method: string;
        limitation: string;
      }>;
    }>;
  };

  it('file ground truth valid dan berlabel synthetic', () => {
    const gt = readGroundTruth() as Gt;
    expect(gt.schemaVersion).toBe(1);
    expect(gt.synthetic).toBe(true);
  });

  it('setiap fixture terdaftar ada dan memiliki temuan terdokumentasi', () => {
    const gt = readGroundTruth() as Gt;
    const ids = gt.fixtures.map((f) => f.id).sort();
    expect(ids).toEqual([...FIXTURE_NAMES].sort());
    for (const f of gt.fixtures) {
      expect(existsSync(path.join(DEFAULT_FIXTURES_ROOT, '..', f.path))).toBe(true);
    }
  });

  it('ID temuan unik dan setiap temuan memiliki modul, severity, metode, dan batasan yang valid', () => {
    const gt = readGroundTruth() as Gt;
    const seen = new Set<string>();
    for (const f of gt.fixtures) {
      for (const e of f.expectedFindings) {
        expect(seen.has(e.id), `duplicate ${e.id}`).toBe(false);
        seen.add(e.id);
        expect((MODULE_NAMES as readonly string[]).includes(e.module)).toBe(true);
        expect((SEVERITIES as readonly string[]).includes(e.expectedSeverity)).toBe(true);
        expect(e.method.length).toBeGreaterThan(10);
        expect(e.limitation.length).toBeGreaterThan(10);
        if (e.ruleId !== undefined) expect(e.ruleId).toMatch(/^ux-[a-z-]+$/);
      }
    }
    // 4 functional + 5 a11y + 5 ux + 3 broken-resources + 1 security-lab = 18.
    expect(seen.size).toBe(18);
  });

  it('fixture clean tidak punya temuan yang diharapkan', () => {
    const gt = readGroundTruth() as Gt;
    expect(gt.fixtures.find((f) => f.id === 'clean')?.expectedFindings).toEqual([]);
  });
});
