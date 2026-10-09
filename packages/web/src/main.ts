/**
 * Composition root dashboard. Membaca konfigurasi dari environment, merakit adapter, dan menjalankan
 * server loopback. Tidak ada API key yang diperlukan; AI tetap nonaktif kecuali dikonfigurasi.
 */
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { loadConfig } from '@nusawebbench/core';
import { FunctionalQaAdapter } from '@nusawebbench/browser-qa';
import { LighthouseAdapter } from '@nusawebbench/lighthouse';
import { RunOrchestrator } from '@nusawebbench/orchestrator';
import { AiService, AiSettingsService, GeminiClient, GroqClient } from '@nusawebbench/ai';
import { UxRulesAdapter } from '@nusawebbench/ux-rules';
import { ArtifactStore, Store } from '@nusawebbench/storage';
import { createApp } from './app.js';

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const errOut = (line: string): void => {
  process.stderr.write(`${line}\n`);
};
import { startServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env as Record<string, string | undefined>);
  const store = Store.open(path.resolve(config.DATABASE_PATH));
  const artifacts = new ArtifactStore({
    rootDir: path.resolve(config.ARTIFACTS_DIR),
    evidence: store.evidence,
  });
  const orchestrator = new RunOrchestrator({
    store,
    adapters: [
      new FunctionalQaAdapter({ artifacts }),
      new UxRulesAdapter({ artifacts }),
      new LighthouseAdapter({ artifacts }),
    ],
    log: (m) => out(`[nwb] ${m}`),
  });
  orchestrator.recoverInterruptedRuns();
  const aiSettings = new AiSettingsService(store, config);
  const aiService = new AiService({
    store,
    config,
    clients: {
      gemini: new GeminiClient(config.GEMINI_API_KEY),
      groq: new GroqClient(config.GROQ_API_KEY),
    },
  });
  const extraHosts = (process.env['ALLOWED_HOSTS'] ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== '');
  const app = createApp({
    store,
    artifacts,
    orchestrator,
    aiSettings,
    aiService,
    allowedHosts: ['127.0.0.1', 'localhost', ...extraHosts],
    diagnose: async () => {
      const artifactsRoot = path.resolve(config.ARTIFACTS_DIR);
      let artifactsWritable = false;
      try {
        mkdirSync(artifactsRoot, { recursive: true });
        const probe = path.join(artifactsRoot, `.probe-${process.pid}`);
        writeFileSync(probe, 'ok');
        unlinkSync(probe);
        accessSync(artifactsRoot, fsConstants.W_OK);
        artifactsWritable = true;
      } catch {
        artifactsWritable = false;
      }
      const chromePath = process.env['CHROMIUM_PATH'] ?? '';
      const k6Path = process.env['K6_BIN'] ?? '';
      return {
        database: { reachable: store.runs.list({ limit: 1 }) !== undefined },
        artifacts: { writable: artifactsWritable },
        tools: {
          chromium:
            chromePath !== '' && existsSync(chromePath)
              ? 'ditemukan'
              : 'tidak diatur atau tidak ada',
          k6: k6Path !== '' && existsSync(k6Path) ? 'ditemukan' : 'tidak diatur (opsional)',
          strix: config.STRIX_ENABLED ? 'diaktifkan (gerbang belum lengkap)' : 'nonaktif (default)',
        },
        ai: { provider: config.AI_PROVIDER, freeTierLock: config.FREE_TIER_LOCK },
        telemetry: 'tidak ada (diagnostik lokal saja)',
      };
    },
  });
  const server = await startServer(app.handle, { host: config.HOST, port: config.PORT });
  const address = server.address();
  out(
    `[nwb] dashboard di http://${config.HOST}:${typeof address === 'object' && address ? address.port : config.PORT}`,
  );
}

main().catch((err: unknown) => {
  errOut(`[nwb] gagal start: ${err instanceof Error ? err.message : 'kesalahan tidak diketahui'}`);
  process.exitCode = 1;
});
