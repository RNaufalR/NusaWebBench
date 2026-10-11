/**
 * SIMULASI (contract test): biner Strix palsu yang meniru kontrak CLI v1.7.0. Tes ini memverifikasi
 * wiring runner, parser, timeout, pembatalan, dan redaksi. Tes ini TIDAK membuktikan bahwa Strix
 * memindai apa pun. Bukti integrasi nyata ada di strix.real.optin.test.ts (opt-in, hanya di workflow).
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createScopeGrant, newId } from '@nusawebbench/core';
import { runStrixProcess } from '../src/index.js';
import type { ModuleContext } from '@nusawebbench/orchestrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrixAdapter, buildStrixArgs, buildStrixEnv } from '../src/index.js';

const KEY = 'fake-key-uji-0000000000';
const LOCAL = createScopeGrant('http://127.0.0.1:4600', 'local-fixture');
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'nwb-strix-sim-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Scenario = {
  version?: string;
  exit: number;
  runJson?: string | null;
  vulns?: string | null;
  sleepMs?: number;
};

function fakeStrix(name: string, s: Scenario): string {
  const bin = path.join(dir, name);
  const script = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '-v') { console.log(${JSON.stringify(`strix ${s.version ?? '1.7.0'}`)}); process.exit(0); }
if (!args.includes('--non-interactive') || !args.includes('--max-budget-usd')) process.exit(9);
console.log('kunci bocor: ' + process.env.LLM_API_KEY);
const run = path.join(process.cwd(), 'strix_runs', 'run_sim');
fs.mkdirSync(run, { recursive: true });
const runJson = ${JSON.stringify(s.runJson === undefined ? '{"status":"completed"}' : s.runJson)};
const vulns = ${JSON.stringify(s.vulns === undefined ? '[]' : s.vulns)};
if (runJson !== null) fs.writeFileSync(path.join(run, 'run.json'), runJson);
if (vulns !== null) fs.writeFileSync(path.join(run, 'vulnerabilities.json'), vulns);
const sleepMs = ${s.sleepMs ?? 0};
setTimeout(() => process.exit(${s.exit}), sleepMs);
`;
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return bin;
}

function fakeDocker(): string {
  const bin = path.join(dir, 'docker-ok');
  writeFileSync(bin, `#!${process.execPath}\nconsole.log('27.0.0');process.exit(0);\n`);
  chmodSync(bin, 0o755);
  return bin;
}

const ctx = (signal = new AbortController().signal): ModuleContext => ({
  runId: newId('run'),
  moduleResultId: newId('module'),
  targetOrigin: LOCAL.origin,
  grant: LOCAL,
  signal,
  progress: () => undefined,
});

const VULN = JSON.stringify([
  {
    id: 'vuln_1',
    title: 'Reflected XSS di /search',
    severity: 'high',
    timestamp: '2026-10-09 10:00:00 UTC',
    description: 'Parameter q dipantulkan tanpa escape.',
    impact: 'Eksekusi skrip di browser korban.',
    remediation_steps: 'Escape output HTML.',
  },
]);

async function runWith(s: Scenario, opts: { signal?: AbortSignal; timeoutSec?: number } = {}) {
  const bin = fakeStrix(`strix-${Math.random().toString(36).slice(2)}`, s);
  return new StrixAdapter({
    config: { enabled: true, maxRuntimeSec: opts.timeoutSec ?? 60 },
    dockerBin: fakeDocker(),
    providerKeys: { gemini: KEY },
    strixBin: bin,
  }).run(ctx(opts.signal ? (opts.signal as AbortSignal) : undefined));
}

describe('Strix runner (SIMULASI, biner palsu)', () => {
  it('argumen non-interaktif dan batas biaya/giliran selalu ada; tanpa flag persetujuan interaktif', () => {
    const args = buildStrixArgs({
      target: 'http://127.0.0.1:4600',
      scanMode: 'quick',
      maxBudgetUsd: 0.5,
      maxTurns: 30,
    });
    expect(args).toEqual([
      '--non-interactive',
      '--target',
      'http://127.0.0.1:4600',
      '--scan-mode',
      'quick',
      '--max-budget-usd',
      '0.5',
      '--max-turns',
      '30',
    ]);
  });

  it('environment hanya berisi variabel yang dibutuhkan; variabel lain dari induk tidak diteruskan', () => {
    const env = buildStrixEnv({
      homeDir: '/tmp/x',
      llmRoute: 'gemini/gemini-3.8-flash',
      apiKey: KEY,
      parentEnv: { PATH: '/bin', SECRET_LAIN: 'rahasia', DOCKER_HOST: 'unix:///d.sock' },
    });
    expect(env).not.toHaveProperty('SECRET_LAIN');
    expect(env).toMatchObject({
      STRIX_TELEMETRY: 'false',
      STRIX_NO_UPDATE_CHECK: '1',
      STRIX_LLM: 'gemini/gemini-3.8-flash',
      LLM_API_KEY: KEY,
      DOCKER_HOST: 'unix:///d.sock',
    });
  });

  it('run dengan temuan → WARN, temuan AI (LIKELY, bukan CONFIRMED), kunci diredaksi dari output', async () => {
    const out = await runWith({ exit: 2, vulns: VULN });
    expect(out.status).toBe('WARN');
    expect(out.toolVersion).toBe('1.7.0');
    expect(out.findings).toHaveLength(1);
    const f = out.findings?.[0];
    expect(f).toBeDefined();
    if (!f) return;
    expect(f).toMatchObject({
      category: 'SECURITY',
      severity: 'HIGH',
      verification: 'LIKELY',
      source: 'AI',
      status: 'OPEN',
      title: 'Reflected XSS di /search',
    });
    expect(f.description).toContain('Referensi Strix: vuln_1');
    expect(JSON.stringify(out)).not.toContain(KEY);
  });

  it('run bersih (exit 0, completed, tanpa temuan) → PASS; konfigurasi dicatat', async () => {
    const out = await runWith({ exit: 0 });
    expect(out.status).toBe('PASS');
    expect(out.findings).toBeUndefined();
    expect(out.configSnapshot).toMatchObject({
      strixVersion: '1.7.0',
      scanMode: 'quick',
      exitCode: 0,
      runStatus: 'completed',
    });
    expect(out.metrics?.['findingCount']).toBe(0);
  });

  it('exit 0 tetapi artefak berisi temuan → ERROR (tidak konsisten)', async () => {
    const out = await runWith({ exit: 0, vulns: VULN });
    expect(out).toMatchObject({ status: 'ERROR', errorCode: 'TOOL_FAILED' });
  });

  it('run tidak selesai (status stopped) → ERROR; exit 0 saja tidak cukup untuk PASS', async () => {
    const out = await runWith({ exit: 0, runJson: '{"status":"stopped"}' });
    expect(out).toMatchObject({ status: 'ERROR', errorCode: 'TOOL_FAILED' });
    expect(out.errorMessageSafe).toContain('stopped');
  });

  it('exit 1 → ERROR TOOL_FAILED', async () => {
    const out = await runWith({ exit: 1 });
    expect(out).toMatchObject({ status: 'ERROR', errorCode: 'TOOL_FAILED' });
  });

  it('run.json hilang atau vulnerabilities.json rusak → ERROR (tidak diam-diam PASS)', async () => {
    expect(await runWith({ exit: 0, runJson: null })).toMatchObject({ status: 'ERROR' });
    expect(await runWith({ exit: 2, vulns: '{bukan json' })).toMatchObject({ status: 'ERROR' });
    expect(await runWith({ exit: 2, vulns: '[{"id":"x"}]' })).toMatchObject({ status: 'ERROR' });
  });

  it('timeout → proses (dan anak prosesnya) dihentikan; hasil TIMEOUT lewat adapter', async () => {
    const bin = fakeStrix('strix-hang', { exit: 0, sleepMs: 60_000 });
    const started = Date.now();
    const raw = await runStrixProcess({
      bin,
      target: LOCAL.origin,
      scanMode: 'quick',
      maxBudgetUsd: 0.5,
      maxTurns: 30,
      llmRoute: 'gemini/gemini-3.8-flash',
      apiKey: KEY,
      timeoutMs: 1000,
      signal: new AbortController().signal,
    });
    expect(raw.timedOut).toBe(true);
    expect(raw.cancelled).toBe(false);
    expect(Date.now() - started).toBeLessThan(20_000);
    const out = new StrixAdapter({ config: { enabled: true } }).toOutcome(
      raw,
      ctx(),
      { strixVersion: '1.7.0' },
      '1.7.0',
    );
    expect(out).toMatchObject({ status: 'ERROR', errorCode: 'TIMEOUT', retryable: false });
  }, 30_000);

  it('pembatalan (AbortSignal) → CANCELLED', async () => {
    const controller = new AbortController();
    const bin = fakeStrix('strix-cancel', { exit: 0, sleepMs: 60_000 });
    const pending = new StrixAdapter({
      config: { enabled: true, maxRuntimeSec: 60 },
      dockerBin: fakeDocker(),
      providerKeys: { gemini: KEY },
      strixBin: bin,
    }).run(ctx(controller.signal));
    setTimeout(() => controller.abort(), 1500);
    const out = await pending;
    expect(out).toMatchObject({ status: 'CANCELLED', errorCode: 'CANCELLED' });
  }, 30_000);

  it('versi runtime tidak cocok dengan versi terpin → ERROR tanpa menjalankan run', async () => {
    const out = await runWith({ exit: 0, version: '9.9.9' });
    expect(out).toMatchObject({ status: 'ERROR', toolVersion: '9.9.9' });
    expect(out.errorMessageSafe).toContain('1.7.0');
  });
});

describe('readRunArtifacts keamanan (Fase 2)', () => {
  it('symlink direktori run di luar workDir ditolak', async () => {
    const { mkdirSync, symlinkSync, writeFileSync: wfs } = await import('node:fs');
    const { readRunArtifacts } = await import('../src/runner.js');
    const work = mkdtempSync(path.join(tmpdir(), 'nwb-artifact-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'nwb-outside-'));
    try {
      mkdirSync(path.join(work, 'strix_runs'), { recursive: true });
      mkdirSync(path.join(outside, 'evil'), { recursive: true });
      wfs(path.join(outside, 'evil', 'run.json'), '{"status":"completed"}');
      symlinkSync(path.join(outside, 'evil'), path.join(work, 'strix_runs', 'run_evil'));
      const res = readRunArtifacts(work);
      expect(res.runDir).toBeNull();
      expect(res.parseError).toBe('run-dir-missing');
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('symlink file run.json ditolak sebagai invalid', async () => {
    const { mkdirSync, symlinkSync, writeFileSync: wfs } = await import('node:fs');
    const { readRunArtifacts } = await import('../src/runner.js');
    const work = mkdtempSync(path.join(tmpdir(), 'nwb-artifact-'));
    try {
      const runDir = path.join(work, 'strix_runs', 'run_a');
      mkdirSync(runDir, { recursive: true });
      wfs(path.join(work, 'real-run.json'), '{"status":"completed"}');
      symlinkSync(path.join(work, 'real-run.json'), path.join(runDir, 'run.json'));
      const res = readRunArtifacts(work);
      expect(res.parseError).toBe('run-json-invalid');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it('run.json terlalu besar ditolak sebelum dibaca penuh', async () => {
    const { mkdirSync, writeFileSync: wfs } = await import('node:fs');
    const { readRunArtifacts, STRIX_MAX_RUN_JSON_BYTES } = await import('../src/runner.js');
    const work = mkdtempSync(path.join(tmpdir(), 'nwb-artifact-'));
    try {
      const runDir = path.join(work, 'strix_runs', 'run_big');
      mkdirSync(runDir, { recursive: true });
      const big = 'x'.repeat(STRIX_MAX_RUN_JSON_BYTES + 100);
      wfs(path.join(runDir, 'run.json'), big);
      const res = readRunArtifacts(work);
      expect(res.parseError).toBe('run-json-invalid');
      expect(res.runStatus).toBeNull();
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it('terlalu banyak kandidat run ditolak', async () => {
    const { mkdirSync } = await import('node:fs');
    const { readRunArtifacts, STRIX_MAX_RUN_CANDIDATES } = await import('../src/runner.js');
    const work = mkdtempSync(path.join(tmpdir(), 'nwb-artifact-'));
    try {
      const root = path.join(work, 'strix_runs');
      mkdirSync(root, { recursive: true });
      for (let i = 0; i < STRIX_MAX_RUN_CANDIDATES + 1; i++) {
        mkdirSync(path.join(root, `run_${i}`));
      }
      const res = readRunArtifacts(work);
      expect(res.parseError).toBe('too-many-candidates');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it('run.json invalid dan vulnerabilities.json hilang menghasilkan error terlihat', async () => {
    const { mkdirSync, writeFileSync: wfs } = await import('node:fs');
    const { readRunArtifacts } = await import('../src/runner.js');
    const work = mkdtempSync(path.join(tmpdir(), 'nwb-artifact-'));
    try {
      const runDir = path.join(work, 'strix_runs', 'run_bad');
      mkdirSync(runDir, { recursive: true });
      wfs(path.join(runDir, 'run.json'), '{bukan json');
      const res = readRunArtifacts(work);
      expect(res.parseError).toBe('run-json-invalid');
      expect(res.findings).toHaveLength(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
