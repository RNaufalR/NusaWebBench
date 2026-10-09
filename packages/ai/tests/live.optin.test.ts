import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '@nusawebbench/core';
import { Store } from '@nusawebbench/storage';
import { describe, expect, it } from 'vitest';
import { AiService, GeminiClient, GroqClient, MODEL_REGISTRY } from '../src/index.js';

/**
 * TES LIVE MANUAL (opt-in). Tidak pernah berjalan di CI dan dilewati secara default.
 *
 * Syarat menjalankan:
 *   AI_LIVE_TESTS=1 AI_PROVIDER=gemini|groq (atau keduanya) + kunci dan model di environment lokal.
 *   FREE_TIER_LOCK=true tetap wajib; model harus ada di registry dan diizinkan free-tier.
 *   Peringatan: panggilan ini mengirim data ke provider dan memakai kuota akun Anda.
 *
 * Perintah: AI_LIVE_TESTS=1 npx vitest run packages/ai/tests/live.optin.test.ts
 */
const LIVE = process.env['AI_LIVE_TESTS'] === '1';

describe.skipIf(!LIVE)('LIVE (manual, opt-in): satu request kecil per provider', () => {
  it('provider yang dikonfigurasi menjawab dengan teks non-kosong, atau gagal dengan kelas error yang jelas', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nwb-live-'));
    const store = Store.open(path.join(dir, 'live.sqlite'));
    try {
      const config = loadConfig({ ...process.env, AI_ALLOW_EXTERNAL_DATA: 'true' });
      store.settings.set('ai.external_data_consent', true, new Date());
      const provider = config.AI_PROVIDER === 'groq' ? 'groq' : 'gemini';
      const svc = new AiService({
        store,
        config,
        clients: {
          gemini: new GeminiClient(config.GEMINI_API_KEY),
          groq: new GroqClient(config.GROQ_API_KEY),
        },
        registry: MODEL_REGISTRY,
      });
      const out = await svc.testConnection();
      expect(provider).toBeTruthy();
      if (out.status === 'OK') expect(out.text.trim().length).toBeGreaterThan(0);
      else expect(out.errorKind ?? out.reason).toBeTruthy();
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
