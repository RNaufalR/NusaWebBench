# RELEASE_AUDIT — NusaWebBench

- Tanggal audit: 2026-10-09 (Asia/Jakarta)
- Branch: `arena/48bd00ed-nusawebbench`
- Commit yang diaudit: `62e3a44` (clean clone dan uji gerbang). Riwayat perubahan sesi ini ada di bagian Lampiran.
- Node untuk clean clone: v24.21.0 (`.nvmrc`). Sumber: paket npm `node-linux-x64@24.21.0`, tarball resmi Node. Sandbox sesi ini awalnya memakai Node v22.22.3 untuk pemasangan awal; hasil di sini diambil dari Node 24.
- Chromium untuk tes lokal: Chromium 153 (`@sparticuz/chromium` di luar repo, `/tmp/chromium`). Tes CI memakai Chromium dari Playwright.
- Bukti CI: run `37893511343` pada `62e3a44` (job quality dan browser keduanya success). Run sebelumnya `37893146541` pada `7ae0513` gagal di browser job karena flake urutan (R-TEST-3, sudah diperbaiki).

## Keputusan rilis

**BELUM siap rilis penuh.** Gerbang wajib lulus pada clean clone. Namun tiga hal memerlukan keputusan pemilik proyek sebelum rilis:

1. **Cakupan k6 dan Strix**: keduanya BLOCKED untuk eksekusi nyata di sandbox (binary k6 resmi dan Docker tidak tersedia). Jika pemilik menetapkannya sebagai modul opsional yang ditunda, T-150, T-160, dan T-230 dapat dinilai ulang.
2. **Pin Node (R-NODE-1)**: Node 24 sudah EOL menurut nodejs.org (2026-09-07). Pin belum diganti karena memerlukan revisi ADR-0002 dan verifikasi ulang toolchain.
3. **AI live**: tes live Gemini dan Groq belum dijalankan (kunci dan opt-in pengguna belum tersedia). Endpoint dan header Gemini sudah terkonfirmasi dari dokumen. Header Bearer Groq belum.

## Checklist gerbang

| #   | Gerbang                                           | Perintah                                                             | Hasil                                                             | Bukti                               |
| --- | ------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| 1   | Clean install dari clone baru (Node 24.21.0)      | `git clone` → `npm ci`                                               | PASS (exit 0)                                                     | sandbox, 2026-10-09                 |
| 2   | Format                                            | `npm run format:check`                                               | PASS                                                              | `npm run check` pada clean clone    |
| 3   | Lint (`--max-warnings=0`)                         | `npm run lint`                                                       | PASS                                                              | `npm run check` pada clean clone    |
| 4   | Typecheck                                         | `npm run typecheck`                                                  | PASS                                                              | `npm run check` pada clean clone    |
| 5   | Unit, integrasi, dan e2e fixture (tanpa browser)  | `npx vitest run` tanpa `CHROMIUM_PATH`                               | PASS: 497 lulus, 35 dilewati                                      | clean clone `62e3a44`, Node 24.21.0 |
| 6   | Unit, integrasi, dan e2e fixture (dengan browser) | `CHROMIUM_PATH=… REQUIRE_BROWSER_TESTS=1 NWB_CHROME_NO_SANDBOX=1`    | PASS: 530 lulus, 2 dilewati (k6 nyata dan live AI, opt-in)        | clean clone Node 24.21.0            |
| 7   | Secret scan (file yang di-track)                  | `npm run secret-scan`                                                | PASS: findings=0 (scanned=146)                                    | clean clone                         |
| 8   | Build semua paket                                 | `npm run build`                                                      | PASS (exit 0)                                                     | clean clone                         |
| 9   | Smoke dashboard (loopback)                        | `node packages/web/dist/main.js` → `/api/health`, `/api/diagnostics` | PASS: `{"ok":true}`; diagnostik tanpa telemetri; Host asing → 403 | clean clone                         |
| 10  | Audit dependensi produksi                         | `npm audit --omit=dev`                                               | PASS: 0 kerentanan                                                | sandbox                             |
| 11  | Lisensi dependensi produksi                       | inspeksi `package.json` (120 paket)                                  | Dicatat: MPL-2.0 1 (`axe-core`, tanpa modifikasi)                 | SECURITY.md                         |
| 12  | Scope guard dipakai semua adapter jaringan        | `grep checkUrlInScope/createRouteGuard`                              | PASS                                                              | T-190                               |
| 13  | Tidak ada innerHTML/SQL interpolasi/shell di kode | grep + tes                                                           | PASS                                                              | T-190                               |
| 14  | Core tanpa API key / Docker / jaringan            | default `.env.example`                                               | PASS (tes e2e fixture berjalan dengan AI off)                     | `api.test.ts` e2e                   |

## Skenario yang diwajibkan (taskbook §12 T-230 item 5)

| Skenario                    | Status         | Bukti / catatan                                                                                                                                                                                    |
| --------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider-off path           | PASS           | `AiService` `provider-disabled`, tes service dan API                                                                                                                                               |
| Provider error / 429 (mock) | PASS           | `ai/tests/providers.test.ts`, `service.test.ts` (tanpa retry loop)                                                                                                                                 |
| Missing optional tools      | PASS           | UX/QA/LH/k6/Strix → UNAVAILABLE (TOOL_MISSING / docker-unavailable)                                                                                                                                |
| Cancellation                | PASS           | `api.test.ts` (QUEUED → CANCELLED), k6 (proses dibunuh), UX (CANCELLED), post-patch (TIMEOUT dibunuh)                                                                                              |
| Report export               | PASS           | `api.test.ts` e2e: laporan JSON/HTML/MD dibuat dan diunduh sebagai `attachment`. Run CANCELLED juga menghasilkan laporan valid (`report.test.ts`)                                                  |
| Retention behavior          | PASS (library) | `packages/storage/tests/retention.test.ts` (9 tes): preview tanpa penghapusan, run aktif dilindungi, plan diverifikasi, symlink keluar root ditolak, metadata dipertahankan. Belum ada UI atau CLI |

## E2E fixture audit (tanpa API key)

- Run `UX_RULES` pada fixture `ux-signals` lewat API: COMPLETED, temuan ≥5 termasuk `ux-horizontal-overflow` (`api.test.ts`, e2e).
- Ground truth UX_RULES cocok persis untuk `a11y-defects`, `ux-signals`, `broken-resources` (`packages/ux-rules/tests/adapter.test.ts`).
- Fixture `clean` tidak menghasilkan temuan objektif (`adapter.test.ts`).

## Modul opsional dan yang ditunda (ditampilkan eksplisit)

| Modul / jalur                      | Status   | Alasan                                                                                                                                                                                          |
| ---------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemini (live)                      | DEFERRED | Tes live manual opt-in (`AI_LIVE_TESTS=1`), tidak dijalankan: tidak ada kunci dan belum ada opt-in pengguna. Endpoint dan header terkonfirmasi dari dokumen (2026-10-09).                       |
| Groq (live)                        | DEFERRED | Sama seperti Gemini. Endpoint terkonfirmasi. Header Bearer belum terbaca dari halaman yang diambil.                                                                                             |
| k6 (nyata, fixture)                | BLOCKED  | Binary k6 resmi tidak dapat diunduh dari sandbox (`objects.githubusercontent.com` di luar allowlist). Paket npm `k6` adalah dummy autocomplete. Adapter diuji dengan executable palsu (20 tes). |
| Strix (nyata)                      | BLOCKED  | Docker tidak tersedia di sandbox. Runner belum diverifikasi terhadap CLI aktual (`security-strix`, gerbang saja).                                                                               |
| Dashboard: LOAD_K6, SECURITY_STRIX | DEFERRED | Belum disambungkan ke dashboard (422 `MODULE_NOT_AVAILABLE`).                                                                                                                                   |
| Before/after di UI                 | DEFERRED | Library `packages/compare` tersedia dan sudah diuji (tes setelah patch, baseline, record). Belum ada UI.                                                                                        |
| Retensi di UI/CLI                  | DEFERRED | Library `packages/storage/src/retention.ts` tersedia. Belum ada tombol atau perintah.                                                                                                           |

## Gap yang terbuka (wajib dipertimbangkan sebelum rilis)

1. **k6 dan Strix nyata** (T-150, T-160): belum ada bukti pada fixture lokal (BLOCKED). Perlu keputusan cakupan (lihat Keputusan rilis).
2. **Node 24 EOL** (R-NODE-1): perlu keputusan pin, lalu verifikasi ulang toolchain.
3. **Tes live Gemini dan Groq** belum dijalankan (R-AI-2). Endpoint Gemini dan Groq sudah terkonfirmasi. Header Bearer Groq belum.
4. **Kelayakan free tier per model** belum diverifikasi (R-AI-3). AI tetap tidak aktif sampai registry diubah secara sadar.
5. **Dashboard tanpa autentikasi, loopback only** (R-WEB-1).
6. **Idempotensi dan penghitung per run di memori** (R-WEB-2, R-AI-1).
7. **Pemeriksaan tautan dokumentasi belum lengkap**: Lighthouse configuration docs mengembalikan 504 pada percobaan ini.
8. **Retensi dan approval patch belum ada di UI.** Berkas `.tmp-*` yatim akibat crash keras belum dibersihkan (R-RET-1, R-PATCH-1).

## Risiko terbuka (register)

- R-LH-1 (Medium): Lighthouse tanpa route guard. Sandbox Chrome default aktif. `--no-sandbox` opt-in (`NWB_CHROME_NO_SANDBOX=1`), dipakai CI browser job.
- R-NODE-1 (Perlu keputusan): Node 24 EOL. Clean clone pada Node 24.21.0 lulus gerbang.
- R-AI-1, R-AI-2 (sebagian terkonfirmasi), R-AI-3, R-WEB-1, R-WEB-2: lihat `IMPLEMENTATION_STATUS.md`.
- R-RET-1 (baru): retensi hanya library; `.tmp-*` yatim belum dibersihkan.
- R-PATCH-1 (baru): tes setelah patch dan approval hanya library; belum ada UI atau alur persetujuan tersimpan.
- R-TEST-2 (dipantau): satu kegagalan flaky tes UI keyboard, tidak terulang dalam 6 run.

## Bug yang ditemukan dan diperbaiki selama audit (dicatat)

- Redaksi menyensor bagian ID hex acak (`LONG_DIGITS`), menyebabkan laporan gagal ~0,2% per ID. Diperbaiki di `core/redact.ts` dengan regresi (`08a828d`). Bug produk.
- Lockfile tidak sinkron setelah menambah workspace; `npm ci` gagal dari clone bersih. Diperbaiki (`f65f68b`).
- Tes pembatalan dengan race. Diganti adapter gerbang deterministik (`5224f3d`).
- Konsol browser CI mencatat 404 favicon. Diperbaiki (204 dan ikon `data:,`).
- `UX_RULES` tidak diblokir untuk target remote. Diperbaiki (sesuai keputusan T-040).
- Path `//` pada k6 (protocol-relative) lolos validasi. Diperbaiki.
- False positive secret-scan pada referensi properti. Diperbaiki (literal rahasia tetap terdeteksi).
- Penulisan patch sebagian gagal tidak dipetakan ke error terstruktur. Sekarang TOOL_FAILED dengan rollback (`91df536`).
- Kebocoran direktori sementara pada `storage.test.ts`. Sekarang dibersihkan (`afterEach`).
- Urutan hasil modul tidak deterministik (`ORDER BY created_at, id` dengan id acak). Gagal sekali di CI browser job (run `37893146541`). Diperbaiki dengan urutan `rowid` dan tes regresi (R-TEST-3).
- Tes UI keyboard gagal di CI browser job (run `2bf538a`): `waitForFunction` dengan predikat string diblokir CSP `script-src 'self'`. Diganti `locator.waitFor`; CSP produksi tidak diubah (R-TEST-2).

## Lampiran: perubahan sesi lanjutan (2026-10-09)

- `91df536`: tes setelah patch (`runPostPatchChecks`), baseline (`runChecksAtBase`), record proposal (`buildProposalRecord`), retensi (`previewRetention`/`applyRetention`), `listCreatedBefore`, dan tes negatif baru.
- `7ae0513`: refactor `runChecksIn`, pembersihan temp di `storage.test.ts`, dan pembaruan dokumentasi (README, IMPLEMENTATION_STATUS, RELEASE_AUDIT).
- Perbaikan tes UI (R-TEST-2) setelah `62e3a44`: lihat IMPLEMENTATION_STATUS.
- `62e3a44`: urutan deterministik (`created_at, rowid`) untuk module_results, findings, dan evidence, dengan tes regresi. Perbaikan flake CI.

## Langkah berikutnya yang disarankan

1. Keputusan pemilik: cakupan k6 dan Strix (ditunda eksplisit atau menunggu bukti nyata), dan pin Node (revisi ADR-0002).
2. Jika k6 dan Strix tetap dalam cakupan: jalankan `K6_BIN=<binary k6 resmi> npx vitest run packages/load-k6` dan siapkan Docker untuk Strix di mesin yang memiliki keduanya.
3. Jalankan tes live Gemini dan Groq dengan kunci dan kuota yang disetujui. Konfirmasi header Bearer Groq dari dokumen yang terbaca penuh.
4. Putuskan apakah retensi perlu UI/CLI sebelum rilis, dan apakah approval patch perlu alur tersimpan.
5. Cek ulang tautan Lighthouse configuration docs.
6. Verifikasi CI pada commit terbaru (`gh run list --branch arena/48bd00ed-nusawebbench`).
