import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createScopeGrant } from '@nusawebbench/core';
import type { ModuleContext } from '@nusawebbench/orchestrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrixAdapter, parseStrixConfig } from '../src/index.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'nwb-strix-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const LOCAL = createScopeGrant('http://127.0.0.1:4600', 'local-fixture');
const REMOTE = createScopeGrant('https://contoh.example', 'remote');
const ctx = (grant = LOCAL): ModuleContext => ({
  runId: 'run_0123456789abcdef0123456789abcdef',
  moduleResultId: 'module_0123456789abcdef0123456789abcdef',
  targetOrigin: grant.origin,
  grant,
  signal: new AbortController().signal,
  progress: () => undefined,
});

function fakeDocker(ok: boolean): string {
  const bin = path.join(dir, ok ? 'docker-ok' : 'docker-fail');
  writeFileSync(
    bin,
    `#!${process.execPath}\n${ok ? "console.log('27.0.0');process.exit(0);" : 'process.exit(1);'}\n`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

const KEYS = { gemini: 'fake-key-uji-0000000000', groq: 'fake-key-uji-1111111111' };

describe('Strix: gerbang sebelum apa pun dijalankan', () => {
  it('default nonaktif: SKIPPED strix-disabled', async () => {
    expect(
      await new StrixAdapter({ dockerBin: fakeDocker(true), providerKeys: KEYS }).run(ctx()),
    ).toMatchObject({
      status: 'SKIPPED',
      skippedReason: 'strix-disabled',
    });
    expect(parseStrixConfig({}).enabled).toBe(false);
  });

  it('target remote ditolak (hanya lokal)', async () => {
    const out = await new StrixAdapter({
      config: { enabled: true },
      dockerBin: fakeDocker(true),
      providerKeys: KEYS,
    }).run(ctx(REMOTE));
    expect(out).toMatchObject({ status: 'ERROR', errorCode: 'SCOPE_DENIED' });
  });

  it('Docker tidak ada → UNAVAILABLE docker-unavailable (tanpa menjalankan Strix)', async () => {
    const out = await new StrixAdapter({
      config: { enabled: true },
      dockerBin: '/tidak/ada/docker',
      providerKeys: KEYS,
    }).run(ctx());
    expect(out).toMatchObject({ status: 'UNAVAILABLE', skippedReason: 'docker-unavailable' });
  });

  it('Docker gagal (daemon mati) → UNAVAILABLE', async () => {
    const out = await new StrixAdapter({
      config: { enabled: true },
      dockerBin: fakeDocker(false),
      providerKeys: KEYS,
    }).run(ctx());
    expect(out.status).toBe('UNAVAILABLE');
  });

  it('kunci provider hilang → UNAVAILABLE provider-key-missing', async () => {
    const out = await new StrixAdapter({
      config: { enabled: true },
      dockerBin: fakeDocker(true),
      providerKeys: {},
    }).run(ctx());
    expect(out).toMatchObject({ skippedReason: 'provider-key-missing' });
  });

  it('model tak dikenal, berbayar (belum free-tier), atau tanpa kapabilitas teks → ditolak', async () => {
    const base = { enabled: true, dockerBin: fakeDocker(true), providerKeys: KEYS };
    expect(
      (
        await new StrixAdapter({ ...base, config: { enabled: true, model: 'model-liar' } }).run(
          ctx(),
        )
      ).skippedReason,
    ).toBe('model-not-allowlisted');
    expect(
      (await new StrixAdapter({ ...base, config: { enabled: true } }).run(ctx())).skippedReason,
    ).toBe('free-tier-not-verified');
    const textless = [
      {
        provider: 'gemini' as const,
        model: 'gemini-3.8-flash',
        capabilities: { text: false, json: false, image: false },
        freeTierAllowlisted: true,
        verifiedOn: '2026-10-09',
        source: 'uji',
      },
    ];
    expect(
      (
        await new StrixAdapter({ ...base, config: { enabled: true }, registry: textless }).run(
          ctx(),
        )
      ).skippedReason,
    ).toBe('capability-mismatch');
  });

  it('semua gerbang lolos → tetap UNAVAILABLE karena runner belum terverifikasi (tidak ada pemindaian)', async () => {
    const allowed = [
      {
        provider: 'gemini' as const,
        model: 'gemini-3.8-flash',
        capabilities: { text: true, json: false, image: false },
        freeTierAllowlisted: true,
        verifiedOn: '2026-10-09',
        source: 'uji',
      },
    ];
    const out = await new StrixAdapter({
      config: { enabled: true },
      dockerBin: fakeDocker(true),
      providerKeys: KEYS,
      registry: allowed,
    }).run(ctx());
    expect(out.status).toBe('UNAVAILABLE');
    expect(out.skippedReason).toBe('strix-runner-contract-unverified');
    expect(out.findings).toBeUndefined();
  });

  it('konfigurasi di luar batas (runtime > 600 detik, provider tak dikenal) ditolak', () => {
    expect(() => parseStrixConfig({ maxRuntimeSec: 601 })).toThrow();
    expect(() => parseStrixConfig({ provider: 'openrouter' })).toThrow();
  });
});
