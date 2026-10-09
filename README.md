# NusaWebBench

Alat audit web **lokal** dengan pemeriksaan deterministik (QA fungsional, UX/aksesibilitas, Lighthouse)
dan provider AI opsional. Core berjalan tanpa API key, tanpa Docker, dan tanpa jaringan.

> Hanya untuk target yang Anda miliki atau yang memiliki izin tertulis untuk diuji. Lihat [SECURITY.md](SECURITY.md).

## Prasyarat

- Node.js 24 (versi yang di-pin di `.nvmrc`, lihat ADR-0002). Diuji dari clean clone dengan Node v24.21.0 (2026-10-09). **Perhatian:** menurut https://nodejs.org/en/about/previous-releases (diperiksa 2026-10-09), Node 24 LTS sudah mencapai akhir masa dukungan pada 2026-09-07. Pin ini belum diperbarui; lihat R-NODE-1 di IMPLEMENTATION_STATUS.md.
- Chromium untuk modul browser. Dapat dipasang lewat Playwright:
  `npx playwright-core install --with-deps chromium`, lalu atur `CHROMIUM_PATH` ke path executable.
- Opsional: `k6` (`K6_BIN`), Docker + Strix (tidak dapat diverifikasi di sandbox; lihat batasan).

## Instalasi dan quality gates

```bash
npm ci
npm run check        # format:check, lint, typecheck, test, secret-scan
npm run build        # build semua paket ke dist/
```

Tes browser dijalankan jika `CHROMIUM_PATH` diatur. Untuk mewajibkannya (seperti di CI):

```bash
CHROMIUM_PATH=/path/ke/chromium REQUIRE_BROWSER_TESTS=1 npx vitest run
```

Tanpa `CHROMIUM_PATH`, tes browser dilewati secara eksplisit (dilaporkan sebagai _skipped_).

## Menjalankan dashboard

```bash
npm run web          # build lalu start server di 127.0.0.1:4178
```

Konfigurasi dari environment (lihat `.env.example`): `HOST` (harus loopback), `PORT`, `DATABASE_PATH`,
`ARTIFACTS_DIR`. Buka `http://127.0.0.1:4178`. Alur: tambah target → pilih modul → centang konfirmasi
izin → pratinjau rencana → jalankan → buat laporan → unduh artefak.

Endpoint diagnostik: `GET /api/diagnostics` (disk, DB, tool; tanpa telemetri).

## Core tanpa AI

Default `.env.example` (`AI_PROVIDER=none`, `FREE_TIER_LOCK=true`) tidak memerlukan API key. Semua
pemeriksaan deterministik tetap berjalan.

## Provider AI (opsional, nonaktif secara default)

1. Isi `GEMINI_API_KEY` dan/atau `GROQ_API_KEY` di `.env` lokal (jangan di-commit).
2. Isi `GEMINI_MODEL` atau `GROQ_MODEL` dengan model yang ada di registry (`packages/ai/src/registry.ts`).
3. Set `AI_PROVIDER=gemini` atau `groq`, dan `AI_ALLOW_EXTERNAL_DATA=true`.
4. Di dashboard, berikan persetujuan data eksternal. Data yang dikirim meninggalkan mesin ini.

Catatan:

- `FREE_TIER_LOCK=true` memblokir model yang belum diverifikasi free tier. Entri bawaan belum diverifikasi,
  jadi AI tidak akan aktif sampai registry diubah secara sadar (ADR-0004).
- Kuota provider berubah menurut tier dan model. Penghitung lokal hanya mengukur penggunaan aplikasi.
  Reset penghitung lokal tidak mereset kuota provider.
- Tes live manual: `AI_LIVE_TESTS=1 npx vitest run packages/ai/tests/live.optin.test.ts`. Tes ini tidak
  berjalan di CI dan memakai kuota akun Anda.
- Endpoint dan header yang dipakai kode, diperiksa terhadap dokumen resmi pada 2026-10-09:
  - Gemini: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, header
    `x-goog-api-key` (https://ai.google.dev/api/generate-content dan
    https://ai.google.dev/gemini-api/docs/api-key, halaman terakhir diperbarui 2026-10-06 UTC).
  - Groq: `POST https://api.groq.com/openai/v1/chat/completions`, `max_completion_tokens`, `n` hanya 1
    (https://console.groq.com/docs/api-reference). Header Bearer belum terbaca dari halaman yang diambil (R-AI-2).
- Kunci Gemini: dokumen resmi menyatakan kunci standar tanpa pembatasan ditolak, dan kunci baru dibuat sebagai
  auth key. Gunakan kunci yang dibatasi ke Gemini API (lihat halaman API key di atas).
- Tes live belum pernah dijalankan karena belum ada kunci dan opt-in. Kelayakan free tier per model belum
  diverifikasi (R-AI-3).

## Retensi artefak (library)

`packages/storage/src/retention.ts`: `previewRetention` lalu `applyRetention` (wajib memakai `planId` dari
preview). Hanya byte berkas di artifact root yang dihapus, dan run yang belum terminal dilewati. Metadata
evidence tetap ada sebagai jejak audit. Belum ada tombol di dashboard atau perintah CLI.

## Fixture lokal dan ground truth

`fixtures/` berisi halaman sintetis (`clean`, `functional-defects`, `a11y-defects`, `ux-signals`,
`broken-resources`, `security-lab`). `fixtures/ground-truth.json` mendaftar temuan yang diharapkan.
`clean` tidak boleh menghasilkan temuan objektif. `security-lab` sengaja rentan dan hanya untuk uji lokal.

## Target remote dan cakupan

- Target `url` (remote) hanya untuk modul yang dapat dijamin cakupannya. Modul browser (FUNCTIONAL_QA,
  UX_RULES, LIGHTHOUSE) dan LOAD_K6 serta SECURITY_STRIX diblokir untuk remote, karena DNS pinning
  belum dapat dijamin.
- Setiap run memerlukan konfirmasi eksplisit dan tercatat di ringkasan otorisasi.

## Load test (k6) — risiko

- `K6_ENABLED=false` secara default. Hanya preset `fixed-smoke` (maksimum 2 VU, 5 request/detik,
  30 detik, 100 request total). Stress, flood, dan spike tidak tersedia.
- Butuh binary k6 di `K6_BIN`. Adapter menolak remote; buildRunPlan juga memblokir remote.
- Tes k6 nyata bersifat opt-in (`K6_BIN` diatur). Binary yang diuji adalah k6 v2.3.0 yang dibangun dari
  commit tag resmi: `scripts/build-k6-verified.sh [direktori]` (butuh Go ≥1.26 di PATH). Lalu jalankan
  `K6_BIN=<direktori>/k6 npx vitest run packages/load-k6`. Versi k6 lain belum diuji.

## Strix — batasan

- `STRIX_ENABLED=false` secara default. Strix membutuhkan Docker dan provider/model yang kompatibel.
- Adapter saat ini hanya menjalankan gerbang (lokal saja, Docker, kunci, allowlist model). Runner
  pemindaian belum diverifikasi terhadap CLI aktual, sehingga pemindaian tidak dijalankan.
- Konfigurasi default Strix menunjuk model OpenRouter; itu bukan Gemini/Groq dan belum dibuktikan kompatibel.

## Perbandingan sebelum/sesudah dan remediasi

Modul `packages/compare` menyediakan perbandingan run (FIXED_VERIFIED hanya dengan bukti sah, REGRESSION
hanya bila perbandingan sebanding), panduan remediasi berbasis URL, dan proposal patch lewat `git worktree`
sementara. `runPostPatchChecks` menjalankan tes yang Anda tentukan di worktree itu. Verdict `PASSED` hanya bila
semua cek lulus. `runChecksAtBase` memberi baseline "sebelum", dan `buildProposalRecord` mencatat approval
`PENDING`. Proposal tidak pernah menulis ke repository pengguna dan tidak melakukan merge, apply, atau deploy.
Fitur ini tersedia sebagai library dan belum tersedia di UI dashboard.

## Batasan umum

- Pemeriksaan deterministik hanya mengukur apa yang dapat diukur dari DOM, Lighthouse, dan k6. Tidak ada
  jaminan bahwa target bebas bug atau aman.
- Dashboard tidak memiliki autentikasi. Jangan membukanya ke jaringan.
- Lihat `IMPLEMENTATION_STATUS.md` untuk status per task, bukti, dan risk register.

## Dokumentasi

- Taskbook: `NusaWebBench_Master_Spec_and_Taskbook.md`
- Status implementasi: `IMPLEMENTATION_STATUS.md`
- Keamanan: `SECURITY.md`
- Keputusan arsitektur: `docs/decisions/`
- Audit rilis: `RELEASE_AUDIT.md`

## Lisensi

UNLICENSED (proyek internal). Strix dilisensikan Apache-2.0 oleh penyedianya; tidak dibundel di repository ini.
