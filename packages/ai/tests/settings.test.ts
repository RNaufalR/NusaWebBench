import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, newId } from '@nusawebbench/core';
import { Store } from '@nusawebbench/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiSettingsService, parseSettingsUpdate } from '../src/index.js';

const CANARY_KEY = `AIza${'S'.repeat(35)}`;
const NOW = new Date('2026-10-09T03:00:00Z');
let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'nwb-ai-set-'));
  store = Store.open(path.join(dir, 'db.sqlite'));
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const config = (over: Record<string, string> = {}) =>
  loadConfig({
    AI_PROVIDER: 'gemini',
    GEMINI_API_KEY: CANARY_KEY,
    GEMINI_MODEL: 'gemini-3.8-flash',
    ...over,
  });

describe('AiSettingsService', () => {
  it('status tidak pernah memuat nilai kunci; hanya keyConfigured', () => {
    const s = new AiSettingsService(store, config(), () => NOW);
    const json = JSON.stringify(s.status());
    expect(json).not.toContain(CANARY_KEY);
    const gemini = s.status().providers.find((p) => p.provider === 'gemini');
    expect(gemini?.keyConfigured).toBe(true);
  });

  it('pembaruan ditolak untuk kunci di luar daftar (freeTierLock, provider, kunci API)', () => {
    expect(() => parseSettingsUpdate({ freeTierLock: false })).toThrow();
    expect(() => parseSettingsUpdate({ provider: 'groq' })).toThrow();
    expect(() => parseSettingsUpdate({ GEMINI_API_KEY: 'x' })).toThrow();
    expect(() => parseSettingsUpdate({ redactionLevel: 'ngawur' })).toThrow();
    expect(parseSettingsUpdate({ externalDataConsent: true })).toEqual({
      externalDataConsent: true,
    });
  });

  it('FREE_TIER_LOCK dan izin operator tidak berubah lewat pembaruan pengaturan', () => {
    const s = new AiSettingsService(store, config(), () => NOW);
    s.update(parseSettingsUpdate({ externalDataConsent: true, redactionLevel: 'strict' }));
    const st = s.status();
    expect(st.operator.freeTierLock).toBe(true);
    expect(st.consent.externalDataConsent).toBe(true);
    expect(st.consent.redactionLevel).toBe('strict');
  });

  it('consent dicabut berlaku segera (tercatat sebagai false, waktu dihapus)', () => {
    const s = new AiSettingsService(store, config(), () => NOW);
    s.update({ externalDataConsent: true });
    expect(s.status().consent.consentAt).toBe(NOW.toISOString());
    s.update({ externalDataConsent: false });
    expect(s.status().consent).toMatchObject({ externalDataConsent: false, consentAt: null });
  });

  it('model dengan verifikasi lebih dari 90 hari lalu diberi peringatan usang', () => {
    const later = new Date('2027-06-01T00:00:00Z');
    const s = new AiSettingsService(store, config(), () => later);
    const st = s.status();
    expect(st.providers.find((p) => p.provider === 'gemini')?.stale).toBe(true);
    expect(st.notices.some((n) => n.includes('usang'))).toBe(true);
  });

  it('reset penghitung lokal: hitungan hari ini kembali nol, riwayat tetap', () => {
    const s = new AiSettingsService(store, config(), () => NOW);
    store.usage.insert({
      id: newId('usage'),
      runId: null,
      provider: 'gemini',
      modelId: 'gemini-3.8-flash',
      taskType: 'TEXT_SUMMARY',
      requestCount: 1,
      status: 'OK',
      durationMs: 10,
      inputTokens: null,
      outputTokens: null,
      estimatedTokens: 5,
      estimatedCost: null,
      localQuotaBucket: '2026-10-09',
      recordedAt: new Date(NOW.getTime() - 1000).toISOString(),
      errorCode: null,
      fallbackFrom: null,
    });
    expect(s.status().providers[0]?.localRequestsToday).toBe(1);
    s.resetLocalCounters();
    expect(s.status().providers[0]?.localRequestsToday).toBe(0);
    expect(store.usage.list(10)).toHaveLength(1);
    expect(s.status().notices[0]).toContain('tidak mereset kuota provider');
  });
});
