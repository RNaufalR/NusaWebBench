# RELEASE_AUDIT — NusaWebBench

- Tanggal audit: 2026-10-09 (Asia/Jakarta)
- Branch: `arena/48bd00ed-nusawebbench`
- Commit yang diaudit: `08a828d` (diverifikasi dari clone bersih `/tmp/nwb-clean` dan dari CI GitHub)
- Node: v24.21.0 (`.nvmrc`); npm: 10.9.8 (dari toolchain sandbox)
- Chromium untuk tes lokal: Chromium 153 (`@sparticuz/chromium`, di luar repo). Tes CI memakai Chromium dari Playwright.
- Bukti CI: run `37884182132` — job `Quality gates` SUCCESS, job `Tes browser` SUCCESS.

## Keputusan rilis

**BELUM siap rilis penuh.** Gerbang wajib lulus (format, lint, typecheck, tes, secret scan, build, clean install, smoke dashboard, CI). Namun beberapa task belum VERIFIED (lihat bagian Blocked/Deferred) dan risiko terbuka (R-NODE-1) memerlukan keputusan pemilik proyek.

## Checklist gerbang

| #   | Gerbang                                                  | Perintah                                                 | Hasil                                             | Bukti                         |
| --- | -------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------- | ----------------------------- |
| 1   | Clean install dari clone baru                            | `git clone` branch → `npm ci`                            | PASS (setelah perbaikan lockfile `f65f68b`)       | `/tmp/clean-ci.log` (sandbox) |
| 2   | Format                                                   | `npm run format:check`                                   | PASS                                              | CI quality job                |
| 3   | Lint (seluruh repo, `--max-warnings=0`)                  | `npm run lint`                                           | PASS                                              | CI quality job                |
| 4   | Typecheck                                                | `npm run typecheck`                                      | PASS                                              | CI quality job                |
| 5   | Unit + integrasi + e2e fixture (tanpa browser)           | `npx vitest run` (tanpa `CHROMIUM_PATH`)                 | PASS: 477 lulus, 35 dilewati (tes browser/live)   | sandbox, CI quality job       |
| 6   | Unit + integrasi + e2e fixture (dengan browser wajib)    | `REQUIRE_BROWSER_TESTS=1 CHROMIUM_PATH=… npx vitest run` | PASS: 510 lulus, 2 dilewati (k6 nyata, live AI)   | sandbox, CI browser job       |
| 7   | Secret scan (file yang di-track)                         | `npm run secret-scan`                                    | PASS: findings=0 (scanned=143)                    | sandbox, CI                   |
| 8   | Build semua paket                                        | `npm run build`                                          | PASS                                              | clean clone, CI smoke         |
| 9   | Smoke dashboard dari `dist` (loopback)                   | `npm run web` → `/api/health`, `/api/diagnostics`        | PASS                                              | clean clone; CI smoke step    |
| 10  | Audit dependensi produksi                                | `npm audit --omit=dev`                                   | PASS: 0 kerentanan (2026-10-09)                   | sandbox                       |
| 11  | Lisensi dependensi produksi                              | inspeksi `package.json` (120 paket)                      | Dicatat: MPL-2.0 1 (`axe-core`, tanpa modifikasi) | SECURITY.md                   |
| 12  | Scope guard dipakai semua adapter jaringan               | `grep checkUrlInScope/createRouteGuard`                  | PASS                                              | T-190                         |
| 13  | Tidak ada innerHTML/SQL interpolasi/shell di kode server | grep + tes                                               | PASS                                              | T-190                         |
| 14  | Core tanpa API key / Docker / jaringan                   | default `.env.example`                                   | PASS (tes e2e fixture berjalan dengan AI off)     | `api.test.ts` e2e             |

## Skenario yang diwajibkan (taskbook §12 T-230 item 5)

| Skenario                    | Status               | Bukti / catatan                                                         |
| --------------------------- | -------------------- | ----------------------------------------------------------------------- |
| Provider-off path           | PASS                 | `AiService` `provider-disabled`, tes service dan API                    |
| Provider error / 429 (mock) | PASS                 | `ai/tests/providers.test.ts`, `service.test.ts` (tanpa retry loop)      |
| Missing optional tools      | PASS                 | UX/QA/LH/k6/Strix → UNAVAILABLE (TOOL_MISSING / docker-unavailable)     |
| Cancellation                | PASS                 | `api.test.ts` (QUEUED → CANCELLED), k6 (proses dibunuh), UX (CANCELLED) |
| Report export               | PASS                 | `api.test.ts` e2e: laporan JSON/HTML/MD dibuat, unduhan `attachment`    |
| Retention behavior          | **FAIL / belum ada** | Retention/cleanup dengan preview belum diimplementasikan (T-200)        |

## E2E fixture audit (tanpa API key)

- Run `UX_RULES` pada fixture `ux-signals` lewat API: COMPLETED, temuan ≥5 termasuk `ux-horizontal-overflow` (`api.test.ts`, e2e).
- Ground truth UX_RULES cocok persis untuk `a11y-defects`, `ux-signals`, `broken-resources` (`packages/ux-rules/tests/adapter.test.ts`).
- Fixture `clean` tidak menghasilkan temuan objektif (`adapter.test.ts`).

## Modul opsional dan yang ditunda (ditampilkan eksplisit)

| Modul / jalur                      | Status   | Alasan                                                                                                                                        |
| ---------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemini (live)                      | DEFERRED | Tes live manual opt-in (`AI_LIVE_TESTS=1`), tidak dijalankan: tidak ada kunci dan user belum opt-in; endpoint belum terkonfirmasi (R-AI-2).   |
| Groq (live)                        | DEFERRED | Sama seperti Gemini.                                                                                                                          |
| k6 (nyata, fixture)                | BLOCKED  | Binary k6 tidak dapat diunduh dari sandbox (host release asset di luar allowlist). Adapter diuji dengan executable palsu (`load-k6`, 20 tes). |
| Strix (nyata)                      | BLOCKED  | Docker tidak tersedia di sandbox; runner belum diverifikasi terhadap CLI aktual (`security-strix`, gerbang saja).                             |
| Dashboard: LOAD_K6, SECURITY_STRIX | DEFERRED | Belum disambungkan ke dashboard (422 `MODULE_NOT_AVAILABLE`).                                                                                 |
| Before/after di UI                 | DEFERRED | Library `packages/compare` tersedia; belum ada UI. Test-after-patch belum diimplementasikan.                                                  |

## Gap yang terbuka (wajib dipertimbangkan sebelum rilis)

1. **Retention/cleanup artefak dengan preview** (T-200) — belum ada.
2. **Node 24 EOL** — menurut nodejs.org (diperiksa 2026-10-09), Node 24 LTS EOL pada 2026-09-07 (R-NODE-1). Perlu keputusan pin baru dan verifikasi ulang toolchain.
3. **Tes k6 dan Strix nyata** — belum ada bukti pada fixture lokal (BLOCKED).
4. **Verifikasi endpoint Gemini/Groq** dari halaman referensi lengkap dan tes live opt-in (R-AI-2).
5. **Kelayakan free tier per model** belum diverifikasi (R-AI-3). Akibatnya AI tidak aktif sampai registry diubah secara sadar.
6. **Dashboard tanpa autentikasi, loopback only** (R-WEB-1). Preview publik sandbox tidak dapat langsung dipakai.
7. **Idempotensi dan penghitung per run di memori** (R-WEB-2, R-AI-1).
8. **Pemeriksaan tautan dokumentasi** belum dijalankan (T-210).

## Risiko terbuka (register)

- R-LH-1 (Medium): Lighthouse tanpa route guard. Sandbox Chrome default aktif; `--no-sandbox` opt-in (`NWB_CHROME_NO_SANDBOX=1`), dipakai CI browser job.
- R-NODE-1 (Perlu keputusan): Node 24 EOL.
- R-AI-1/2/3, R-WEB-1/2: lihat `IMPLEMENTATION_STATUS.md`.
- R-TEST-2 (dipantau): satu kegagalan flaky tes UI keyboard, tidak terulang dalam 6 run.

## Bug yang ditemukan dan diperbaiki selama audit (dicatat)

- Redaksi menyensor bagian ID hex acak (`LONG_DIGITS`), menyebabkan laporan gagal ~0,2% per ID. Diperbaiki di `core/redact.ts` + regresi (`08a828d`). Ini bug produk.
- Lockfile tidak sinkron setelah menambah workspace; `npm ci` gagal dari clone bersih. Diperbaiki (`f65f68b`).
- Tes pembatalan dengan race; diperbaiki dengan adapter gerbang deterministik.
- Konsol browser CI mencatat 404 favicon; diperbaiki (204 dan ikon `data:,`).
- `UX_RULES` tidak diblokir untuk target remote; diperbaiki (sesuai keputusan T-040).
- Path `//` pada k6 (protocol-relative) lolos validasi; diperbaiki.
- False positive secret-scan pada referensi properti; diperbaiki (literal rahasia tetap terdeteksi).

## Langkah berikutnya yang disarankan

1. Keputusan pemilik proyek: pin Node yang didukung (revisi ADR-0002), lalu verifikasi ulang.
2. Implementasi retention/cleanup dengan preview (T-200).
3. Verifikasi endpoint Gemini/Groq dari dokumen lengkap; jalankan tes live opt-in dengan kuota yang disetujui.
4. Sediakan binary k6 yang terverifikasi (sumber resmi) dan jalankan tes fixture; investigasi kontrak CLI Strix pada lingkungan dengan Docker.
5. Tinjau keputusan autentikasi/bind dashboard bila ingin preview publik.
