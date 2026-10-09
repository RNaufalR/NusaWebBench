# RELEASE_AUDIT — NusaWebBench

- Tanggal audit: 2026-10-09 (Asia/Jakarta). Diperbarui setelah verifikasi T-150 (k6 nyata).
- Branch: `arena/48bd00ed-nusawebbench`
- Commit yang diaudit: `a6838ee` (clean clone dan uji gerbang, termasuk tes k6 nyata). CI run `37897309673` hijau pada commit ini. Riwayat perubahan sesi ini ada di bagian Lampiran.
- Node untuk clean clone: v24.21.0 (`.nvmrc`). Sumber: paket npm `node-linux-x64@24.21.0`, tarball resmi Node. Sandbox sesi ini awalnya memakai Node v22.22.3 untuk pemasangan awal; hasil di sini diambil dari Node 24.
- Chromium untuk tes lokal: Chromium 153 (`@sparticuz/chromium` di luar repo, `/tmp/chromium`). Tes CI memakai Chromium dari Playwright.
- Bukti CI sebelumnya: run `37894195534` pada `8bb2115` (job quality dan browser keduanya success). Run sebelumnya gagal di browser job: `37893146541` (`7ae0513`, flake urutan R-TEST-3) dan `37893511343`/`2bf538a` (UI CSP, R-TEST-2). Keduanya sudah diperbaiki.

## Keputusan rilis

**BELUM siap rilis penuh.** Gerbang wajib lulus pada clean clone. Namun tiga hal memerlukan keputusan pemilik proyek sebelum rilis:

1. **Cakupan Strix**: k6 sudah diverifikasi dengan binary nyata (v2.3.0, dibangun dari sumber tag resmi). Strix tetap BLOCKED: Docker tidak tersedia, Strix membutuhkan Python ≥3.12 (sandbox hanya 3.11), dan tidak ada kunci provider untuk smoke test. Pilihan pemilik: (a) menetapkan Strix sebagai modul opsional yang ditunda secara eksplisit untuk rilis ini, sehingga T-160 tetap BLOCKED dan T-230 dapat VERIFIED; atau (b) menunggu bukti Strix nyata, sehingga T-230 tetap EXECUTED.
2. **Pin Node (R-NODE-1)**: Node 24 berstatus LTS menurut nodejs.org (diperiksa 2026-10-09), bukan EOL. Klaim EOL pada rilis sebelumnya keliru. Pin tetap Node 24 dan tidak perlu diganti sekarang. Node 26 berstatus Current. Keputusan upgrade mengikuti jadwal LTS resmi dan memerlukan revisi ADR-0002.
3. **AI live**: tes live Gemini dan Groq belum dijalankan (kunci dan opt-in pengguna belum tersedia). Endpoint dan header Gemini sudah terkonfirmasi dari dokumen. Header Bearer Groq belum.

## Remediasi keamanan 2026-10-09 (status terkini)

Sumber rinci: `SECURITY_PENTEST_REPORT.md` dan `SECURITY_REMEDIATION_REPORT.md`. Catatan koreksi:

- **Node 24 bukan EOL.** Klaim sebelumnya (EOL 2026-09-07) keliru. Halaman nodejs.org (diperiksa 2026-10-09) menampilkan Node 24 sebagai LTS. Klaim itu dihapus dari bagian keputusan rilis, gap, dan risiko.
- **F-05 (link checker) dikurangi:** jalur browser untuk target remote sudah diblokir `buildRunPlan`, sehingga celah rebinding hanya terbuka lewat pemakaian library langsung. Perbaikan tetap dilakukan.
- **Chromium di sandbox tidak lagi tersedia** di path `/tmp/chromium` yang disebut di bagian sebelumnya. Binary dari `@sparticuz/chromium` di `/tmp/chr` hang saat dijalankan. Tes browser nyata tidak bisa dijalankan ulang di sandbox ini.

| Gerbang     | Perintah              | Hasil (2026-10-09)                                                                 |
| ----------- | --------------------- | ---------------------------------------------------------------------------------- |
| Lint        | `npm run lint`        | PASS (exit 0)                                                                      |
| Typecheck   | `npm run typecheck`   | PASS (exit 0)                                                                      |
| Tes         | `npm run test`        | PASS: 547 lulus, 39 dilewati (586). Browser nyata dilewati (tanpa `CHROMIUM_PATH`) |
| Secret scan | `npm run secret-scan` | PASS: `scanned=155 findings=0`                                                     |
| Build       | `npm run build`       | PASS (exit 0)                                                                      |
| Audit penuh | `npm audit`           | PASS: 0 kerentanan (lihat SECURITY_REMEDIATION_REPORT.md)                          |

Status keamanan:

- F-04 PARTIAL: kontrol repo (least privilege, tanpa credential persisten, secret hanya di satu step bergerbang `run_scan`) sudah dikunci oleh tes. Kontrol remote (GitHub Environment, ruleset, branch protection) OPEN dan butuh otorisasi.
- F-05 DIPERBAIKI (library): koneksi link checker dan pin browser remote. Runtime BLOCKED.
- F-06 DIPERBAIKI (konfigurasi): proxy mati untuk non-loopback. Runtime BLOCKED.
- F-10 DIPERBAIKI (skrip dan workflow): egress container Strix dibatasi di runner. Runtime BLOCKED (Docker/iptables tidak tersedia).
- F-13 DIKOREKSI: Node 24 LTS, bukan EOL.

Strix nyata, tes live Gemini/Groq, dan run workflow tetap tidak dijalankan dan membutuhkan persetujuan eksplisit.

## Checklist gerbang

| #   | Gerbang                                           | Perintah                                                             | Hasil                                                             | Bukti                               |
| --- | ------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| 1   | Clean install dari clone baru (Node 24.21.0)      | `git clone` → `npm ci`                                               | PASS (exit 0)                                                     | sandbox, 2026-10-09                 |
| 2   | Format                                            | `npm run format:check`                                               | PASS                                                              | `npm run check` pada clean clone    |
| 3   | Lint (`--max-warnings=0`)                         | `npm run lint`                                                       | PASS                                                              | `npm run check` pada clean clone    |
| 4   | Typecheck                                         | `npm run typecheck`                                                  | PASS                                                              | `npm run check` pada clean clone    |
| 5   | Unit, integrasi, dan e2e fixture (tanpa browser)  | `npx vitest run` tanpa `CHROMIUM_PATH`                               | PASS: 497 lulus, 35 dilewati                                      | clean clone `8bb2115`, Node 24.21.0 |
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

| Modul / jalur                      | Status   | Alasan                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemini (live)                      | DEFERRED | Tes live manual opt-in (`AI_LIVE_TESTS=1`), tidak dijalankan: tidak ada kunci dan belum ada opt-in pengguna. Endpoint dan header terkonfirmasi dari dokumen (2026-10-09).                                                                                                                                         |
| Groq (live)                        | DEFERRED | Sama seperti Gemini. Endpoint terkonfirmasi. Header Bearer belum terbaca dari halaman yang diambil.                                                                                                                                                                                                               |
| k6 (nyata, fixture)                | PASS     | k6 v2.3.0 dibangun dari commit tag resmi `e0887846` (`scripts/build-k6-verified.sh`). 24 tes lulus dengan `K6_BIN`: fixture PASS, server error dan overload menjadi FAIL, pembatalan nyata tanpa proses tertinggal. Lihat IMPLEMENTATION_STATUS T-150.                                                            |
| Strix (nyata)                      | BLOCKED  | Runner dan workflow manual dibuat (583d716). Workflow belum bisa di-dispatch dari branch sesi (HTTP 404; file harus ada di `main`). Sandbox: Docker dan apt tidak terjangkau; Python 3.12 tidak dapat dipasang; kunci provider tidak dapat dipastikan. Tes simulasi lulus; integrasi nyata belum pernah berjalan. | Docker tidak tersedia (download.docker.com dan apt tidak dapat dijangkau). Strix (`strix-agent` 1.7.0) butuh Python ≥3.12, sedangkan sandbox hanya 3.11. Tidak ada kunci provider. Runner belum diimplementasikan (`security-strix`, gerbang saja). |
| Dashboard: LOAD_K6, SECURITY_STRIX | DEFERRED | Belum disambungkan ke dashboard (422 `MODULE_NOT_AVAILABLE`).                                                                                                                                                                                                                                                     |
| Before/after di UI                 | DEFERRED | Library `packages/compare` tersedia dan sudah diuji (tes setelah patch, baseline, record). Belum ada UI.                                                                                                                                                                                                          |
| Retensi di UI/CLI                  | DEFERRED | Library `packages/storage/src/retention.ts` tersedia. Belum ada tombol atau perintah.                                                                                                                                                                                                                             |

## Gap yang terbuka (wajib dipertimbangkan sebelum rilis)

1. **Strix nyata** (T-160): BLOCKED. Perlu keputusan cakupan (lihat Keputusan rilis). k6 nyata sudah terbukti pada v2.3.0. Versi k6 lain belum diuji.
2. **Node 24 LTS** (R-NODE-1): bukan EOL (koreksi 2026-10-09). Pantau jadwal LTS resmi; upgrade memerlukan verifikasi ulang toolchain.
3. **Tes live Gemini dan Groq** belum dijalankan (R-AI-2). Endpoint Gemini dan Groq sudah terkonfirmasi. Header Bearer Groq belum.
4. **Kelayakan free tier per model** belum diverifikasi (R-AI-3). AI tetap tidak aktif sampai registry diubah secara sadar.
5. **Dashboard tanpa autentikasi, loopback only** (R-WEB-1).
6. **Idempotensi dan penghitung per run di memori** (R-WEB-2, R-AI-1).
7. **Pemeriksaan tautan dokumentasi belum lengkap**: Lighthouse configuration docs mengembalikan 504 pada percobaan ini.
8. **Retensi dan approval patch belum ada di UI.** Berkas `.tmp-*` yatim akibat crash keras belum dibersihkan (R-RET-1, R-PATCH-1).

## Risiko terbuka (register)

- R-LH-1 (Medium, dikurangi sebagian): Lighthouse tanpa route guard. Sekarang semua koneksi non-loopback dialihkan ke proxy mati (F-06, `--proxy-server=http://127.0.0.1:1`). Runtime belum diverifikasi (Chromium hang di sandbox). Sandbox Chrome default aktif. `--no-sandbox` opt-in (`NWB_CHROME_NO_SANDBOX=1`), dipakai CI browser job.
- R-NODE-1 (Dipantau): Node 24 LTS (bukan EOL, dikoreksi 2026-10-09). Clean clone pada Node 24.21.0 lulus gerbang.
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

## Lampiran tambahan: verifikasi T-150 (k6 nyata)

- Binary: k6 v2.3.0, dibangun dari tag `v2.3.0` → commit `e0887846143ab176d4b5483c9d52cf3b3e009f1a` dengan `-mod=vendor`. Toolchain Go 1.27.2 dari PyPI `go-bin` (pihak ketiga, R-K6-1). Digest resmi aset GitHub dicatat sebagai referensi (`39c3117b…`).
- Hasil: `K6_BIN=… npx vitest run packages/load-k6` → 24 lulus. Gerbang penuh `npm run check` dengan `K6_BIN` → 536 lulus, 1 dilewati (opt-in AI live), secret scan `findings=0` (clean clone `a6838ee`). CI tidak memiliki `K6_BIN`, sehingga tes k6 nyata dilewati di CI dan dijalankan lokal.
- Perbaikan sesi ini: threshold `abortOnFail` (stop condition nyata), snapshot kondisi test ke hasil modul dan laporan (instruksi 9), hasil pembatalan/timeout menunggu proses keluar.
- Koreksi: dugaan "proses k6 yatim" pada tes pembatalan nyata berasal dari pendeteksi yang terlalu luas (teks sandbox ikut terhitung). Pendeteksi sekarang mencocokkan executable K6_BIN. Pengukuran langsung: k6 keluar sekitar 0,02 detik setelah SIGTERM.
- Strix: tidak berubah (BLOCKED). Lihat T-160 di IMPLEMENTATION_STATUS.
