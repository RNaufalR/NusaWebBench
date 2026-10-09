import type { AiTaskType, Provider } from '@nusawebbench/core';

/**
 * Registry model yang diketahui (taskbook T-130 instruksi 1). Setiap entri membawa tanggal verifikasi
 * dan sumber. Entri dengan `freeTierAllowlisted: false` TIDAK dapat dipakai bila FREE_TIER_LOCK=true.
 *
 * Catatan verifikasi (2026-10-09):
 * - Kuota Gemini bersifat per proyek dan bergantung pada tier; halaman rate-limit tidak mencantumkan
 *   angka per model di sini. Tidak ada angka kuota yang ditanam di kode.
 * - Daftar model Groq memuat angka per model, tetapi angka tersebut berubah. Tidak ditanam di kode.
 * - Kelayakan free tier per model belum diverifikasi di sandbox; karena itu `freeTierAllowlisted` = false.
 */
export const AI_REGISTRY_VERIFIED_ON = '2026-10-09';

export type AiCapabilities = {
  readonly text: boolean;
  readonly json: boolean;
  readonly image: boolean;
};

export type ModelEntry = {
  readonly provider: Provider;
  readonly model: string;
  readonly capabilities: AiCapabilities;
  readonly freeTierAllowlisted: boolean;
  readonly verifiedOn: string;
  readonly source: string;
};

export const MODEL_REGISTRY: readonly ModelEntry[] = Object.freeze([
  {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    capabilities: { text: true, json: false, image: false },
    // Free tier dibuktikan dari tabel harga resmi (dibaca 2026-10-09): "Free Tier — Free of charge"
    // untuk input dan output gemini-3.8-flash. Catatan: pada free tier, "Used to improve our
    // products" = Yes; data yang dikirim ke model ini tidak boleh berisi data pengguna nyata.
    // Batas RPM/TPM/RPD tetap berlaku (lihat rate-limits) dan tidak diverifikasi di sini.
    freeTierAllowlisted: true,
    verifiedOn: AI_REGISTRY_VERIFIED_ON,
    source:
      'https://ai.google.dev/gemini-api/docs/pricing (Gemini 3.8 Flash, Free Tier, dibaca 2026-10-09)',
  },
  {
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    capabilities: { text: true, json: false, image: false },
    freeTierAllowlisted: false,
    verifiedOn: AI_REGISTRY_VERIFIED_ON,
    source: 'https://console.groq.com/docs/rate-limits (daftar model, 2026-10-09)',
  },
]);

/** Kapabilitas minimum per jenis task. Tidak ada fallback dari task gambar ke model teks saja. */
export const TASK_REQUIREMENTS: Readonly<Record<AiTaskType, AiCapabilities>> = Object.freeze({
  TEXT_SUMMARY: { text: true, json: false, image: false },
  FINDING_EXPLANATION: { text: true, json: false, image: false },
  VISUAL_REVIEW: { text: true, json: false, image: true },
  STRUCTURED_REMEDIATION: { text: true, json: true, image: false },
});

export function findModel(
  registry: readonly ModelEntry[],
  provider: Provider,
  model: string,
): ModelEntry | undefined {
  return registry.find((m) => m.provider === provider && m.model === model);
}

export function satisfies(caps: AiCapabilities, need: AiCapabilities): boolean {
  return (!need.text || caps.text) && (!need.json || caps.json) && (!need.image || caps.image);
}

/** Kewaspadaan staleness: verifikasi lebih dari 90 hari yang lalu dianggap usang. */
export const STALE_AFTER_DAYS = 90;

export function isStale(verifiedOn: string, now: Date): boolean {
  const verified = Date.parse(`${verifiedOn}T00:00:00Z`);
  if (Number.isNaN(verified)) return true;
  return now.getTime() - verified > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
