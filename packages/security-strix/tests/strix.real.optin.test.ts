/**
 * INTEGRASI NYATA (opt-in). Berjalan HANYA bila:
 *   STRIX_REAL_TEST=1, STRIX_BIN (biner Strix v1.7.0 terpasang), STRIX_GEMINI_API_KEY (dari secret).
 * Target: fixture lokal `security-lab` (rentan secara sengaja, 127.0.0.1). Di workflow, forwarder
 * socat hanya di-bind ke gateway bridge Docker agar container Strix dapat mencapai fixture.
 * Tes tidak pernah berjalan tanpa flag di atas dan tidak pernah memakai mock sebagai bukti.
 *
 * Opsional: STRIX_REAL_REPORT=<path> menulis ringkasan yang sudah diredaksi (tanpa kunci).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createScopeGrant, newId } from '@nusawebbench/core';
import { startFixture } from '@nusawebbench/fixtures';
import type { ModuleContext } from '@nusawebbench/orchestrator';
import { describe, expect, it } from 'vitest';
import { StrixAdapter, STRIX_PINNED_VERSION } from '../src/index.js';

const enabled =
  process.env['STRIX_REAL_TEST'] === '1' &&
  !!process.env['STRIX_BIN'] &&
  !!process.env['STRIX_GEMINI_API_KEY'];

describe.skipIf(!enabled)('Strix: integrasi nyata (opt-in, bukan CI default)', () => {
  it('menjalankan Strix terhadap fixture lokal, menangkap artefak nyata, dan memetakan hasilnya', async () => {
    const port = Number(process.env['STRIX_FIXTURE_PORT'] ?? '4600');
    const fixture = await startFixture('security-lab', { port });
    try {
      const grant = createScopeGrant(fixture.origin, 'local-fixture');
      const key = process.env['STRIX_GEMINI_API_KEY'] as string;
      const ctx: ModuleContext = {
        runId: newId('run'),
        moduleResultId: newId('module'),
        targetOrigin: fixture.origin,
        grant,
        signal: new AbortController().signal,
        progress: () => undefined,
      };
      const outcome = await new StrixAdapter({
        config: { enabled: true, maxRuntimeSec: 600, scanMode: 'quick', maxBudgetUsd: 0.5 },
        providerKeys: { gemini: key },
        strixBin: process.env['STRIX_BIN'] as string,
      }).run(ctx);

      // Ringkasan yang aman dibagikan (tanpa kunci, tanpa keluaran mentah).
      const summary = {
        generatedAt: new Date().toISOString(),
        strixVersion: STRIX_PINNED_VERSION,
        target: fixture.origin,
        status: outcome.status,
        errorCode: outcome.errorCode ?? null,
        errorMessageSafe: outcome.errorMessageSafe ?? null,
        skippedReason: outcome.skippedReason ?? null,
        toolVersion: outcome.toolVersion ?? null,
        exitCode: outcome.configSnapshot?.['exitCode'] ?? null,
        runStatus: outcome.configSnapshot?.['runStatus'] ?? null,
        durationMs: outcome.metrics?.['durationMs'] ?? null,
        findingCount: outcome.findings?.length ?? 0,
        findings: (outcome.findings ?? []).map((f) => ({
          title: f.title,
          severity: f.severity,
          verification: f.verification,
          source: f.source,
        })),
      };
      const serialized = JSON.stringify(summary, null, 2);
      expect(serialized).not.toContain(process.env['STRIX_GEMINI_API_KEY'] as string);
      if (process.env['STRIX_REAL_REPORT']) {
        const out = process.env['STRIX_REAL_REPORT'] as string;
        mkdirSync(path.dirname(out), { recursive: true });
        writeFileSync(out, serialized + '\n', 'utf8');
      }

      // Sebuah run yang benar-benar dijalankan tidak boleh berakhir sebagai UNAVAILABLE.
      expect(outcome.status).not.toBe('UNAVAILABLE');
      expect(outcome.toolVersion).toBe(STRIX_PINNED_VERSION);
      if (outcome.status === 'WARN') {
        const list = outcome.findings ?? [];
        expect(list.length).toBeGreaterThan(0);
        for (const f of list) {
          expect(f.verification).toBe('LIKELY');
          expect(f.source).toBe('AI');
        }
      } else if (outcome.status === 'PASS') {
        expect(outcome.findings).toBeUndefined();
        expect(outcome.configSnapshot?.['runStatus']).toBe('completed');
      } else {
        expect(['ERROR', 'CANCELLED']).toContain(outcome.status);
        expect(outcome.errorCode).toBeTruthy();
      }
    } finally {
      await fixture.close();
    }
  }, 720_000);
});
