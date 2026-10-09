# IMPLEMENTATION_STATUS — NusaWebBench

Sumber kebenaran: `NusaWebBench_Master_Spec_and_Taskbook.md` (commit `f83447b` di `origin/main`, 1564 baris, dibaca seluruhnya).

Branch sesi: `arena/48bd00ed-nusawebbench` (dibuat dari `b3cc1a8`, di-fast-forward ke `f83447b` untuk mendapatkan taskbook).

Legenda status: `PLANNED`, `IN_PROGRESS`, `EXECUTED`, `VERIFIED`, `BLOCKED`, `FAILED`, `DEFERRED` (sesuai taskbook §11.1).

---

## Ringkasan status

| ID    | Judul                                             | Status   | Depends on                                      |
| ----- | ------------------------------------------------- | -------- | ----------------------------------------------- |
| T-000 | Repository discovery dan baseline audit           | VERIFIED | —                                               |
| T-010 | Bootstrap, workspace, dan quality gates           | VERIFIED | T-000                                           |
| T-020 | Domain schemas dan error taxonomy                 | VERIFIED | T-010                                           |
| T-030 | SQLite storage, migration, repository layer       | VERIFIED | T-020                                           |
| T-040 | Target registry dan authorization/scope guard     | VERIFIED | T-020, T-030                                    |
| T-050 | Run orchestrator dan state machine                | VERIFIED | T-020, T-030, T-040                             |
| T-060 | Evidence/artifact store dan reporting core        | VERIFIED | T-020, T-030, T-050                             |
| T-070 | Target fixture suite dan ground truth             | VERIFIED | T-010, T-020                                    |
| T-080 | Functional QA adapter (Playwright)                | VERIFIED | T-040, T-050, T-060, T-070                      |
| T-090 | Lighthouse adapter                                | VERIFIED | T-040, T-050, T-060, T-070                      |
| T-100 | Deterministic UX/accessibility heuristic engine   | VERIFIED | T-020, T-060, T-070, T-080                      |
| T-110 | Gemini adapter                                    | VERIFIED | T-010, T-020, T-030, T-060                      |
| T-120 | Groq adapter                                      | VERIFIED | T-010, T-020, T-030, T-060                      |
| T-130 | AI router, capability registry, free-tier lock    | VERIFIED | T-110, T-120                                    |
| T-140 | Dashboard MVP dan API routes                      | VERIFIED | T-030, T-040, T-050, T-060, T-080               |
| T-150 | k6 adapter dan safety gates                       | VERIFIED | T-040, T-050, T-060, T-070, T-140               |
| T-160 | Strix adapter                                     | EXECUTED | T-040, T-050, T-060, T-070                      |
| T-170 | Before/after comparison dan remediation proposals | VERIFIED | T-060, T-080, T-090, T-100, T-140               |
| T-180 | Provider settings, usage, privacy controls        | VERIFIED | T-110, T-120, T-130, T-140                      |
| T-190 | Security hardening dan threat-model verification  | VERIFIED | T-040 s.d. T-180                                |
| T-200 | Low-resource behavior, reliability, cleanup       | VERIFIED | T-050, T-060, T-080, T-090, T-140, T-150, T-160 |
| T-210 | Documentation and onboarding                      | VERIFIED | T-010 s.d. T-200                                |
| T-220 | CI, release checks, artifact validation           | VERIFIED | seluruh task rilis                              |
| T-230 | Final acceptance audit dan release handoff        | EXECUTED | T-000 s.d. T-220                                |

Jumlah task: 24 (T-000 s.d. T-230). `VERIFIED` (22): T-000 s.d. T-100, T-110, T-120, T-130, T-140, T-150, T-170, T-180, T-190, T-200, T-210, T-220. `EXECUTED` (2): T-160 (runner Strix dan provider belum dapat diverifikasi di sandbox), T-230 (menunggu T-160 atau keputusan pengecualian pemilik). `PLANNED`: 0.

---

## T-000 — Repository discovery dan baseline audit

ID: T-000
Title: Repository discovery dan baseline audit
Status: VERIFIED (baseline dan audit repository selesai; tidak ada kode aplikasi yang perlu diuji pada tahap ini — lihat bukti di bawah)
Depends on: —

### Konteks yang ditemukan (bukti: perintah di bawah)

- Path kerja: `/home/user/NusaWebBench`.
- Branch aktif: `arena/48bd00ed-nusawebbench`. Setelah `git fetch`, `origin/main` berpindah dari `b3cc1a8` ke `f83447b` (commit "Add files via upload" yang menambahkan taskbook). Branch sesi di-fast-forward ke `f83447b` dengan `git merge --ff-only origin/main`. Tidak ada perubahan lokal yang hilang.
- Remote: `origin` = `https://github.com/RNaufalR/NusaWebBench.git`. Hanya ada `main` dan branch sesi.
- Pada awal sesi, `git status` bersih. Taskbook sempat tidak ditemukan; pengguna mengunggahnya ke `main`, lalu saya menanyakannya dan menyinkronkannya.
- Isi repo setelah sinkronisasi: `README.md` (14 byte, berisi `# NusaWebBench`), `NusaWebBench_Master_Spec_and_Taskbook.md`.
- Tidak ada: `package.json`, lockfile, source code, konfigurasi TypeScript/ESLint/Prettier, tes, workflow CI, `.gitignore`, `.env.example`, dan `LICENSE`.
- Runtime lingkungan: Node `v22.22.3`, npm `10.9.8`, Python `3.11.2`, git `2.39.5`, gh `2.23.0`. Tidak tersedia: `docker`, `chromium`/`google-chrome`, `k6`.
- Sumber daya: 2 vCPU, RAM ~3.9 GB, disk 20 GB bebas.
- Keterjangkauan registry: `registry.npmjs.org` dapat diakses (`npm view` berhasil).

### Tes existing

- Tidak ada tes existing. Tidak ada command test yang dapat dijalankan. Status: **not-run** (tidak ada yang dijalankan karena tidak ada kode).

### Pemeriksaan yang dijalankan

- `git status --short --branch` — bersih pada awal sesi.
- `git diff --check` — PASS (tanpa output, exit 0).
- Pemindaian sederhana secret pola `api_key|secret|token|password = <nilai panjang>` pada seluruh file yang dilacak (`grep -rniE ... --exclude-dir=.git .`) — tidak ada temuan.
- `git ls-files` setelah sinkronisasi — 2 file (`README.md`, `NusaWebBench_Master_Spec_and_Taskbook.md`) sebelum perubahan T-000.
- `npm view <pkg> version` (dijalankan di `/tmp`, tidak mengubah repo) — versi terbaru yang tersedia saat ini: `vite 8.3.4`, `react 19.3.0`, `typescript 7.0.2`, `vitest 5.0.3`, `playwright 1.64.0`, `lighthouse 13.5.0`, `zod 4.6.5`, `better-sqlite3 13.0.3`, `eslint 10.12.0`, `prettier 3.9.9`. Catatan: versi ini hanya informasi registry pada tanggal 2026-10-09; versi yang dipakai di T-010 harus dipin dan dicatat ulang.
- Strix: repositori `usestrix/strix` berlisensi **Apache-2.0**, push terakhir 2026-10-08; paket PyPI `strix-agent` tersedia. Verifikasi CLI/versi belum dilakukan (T-160).

### Audit kode

- Tidak ada file kode yang dibuat atau diubah pada T-000 selain dokumen ini dan ADR di `docs/decisions/`.
- Taskbook dibaca dari awal sampai akhir dalam 1564 baris (potongan berurutan).

### Dependency, arsitektur, dan risiko awal

| #   | Risiko                                                                                                          | Dampak                                     | Mitigasi / task                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| R1  | Tidak ada `LICENSE` di repo.                                                                                    | Pengguna tidak tahu hak pakai.             | Pemilik repo harus memilih lisensi. Ditandai untuk T-210/T-230. Tidak dibuat sendiri.                    |
| R2  | Belum ada lockfile/package manager.                                                                             | Build tidak reproducible.                  | T-010: npm workspaces + `package-lock.json`.                                                             |
| R3  | Node 22 dipakai di lingkungan ini; belum ada verifikasi LTS aktif terbaru.                                      | Runtime bisa tidak didukung dependency.    | T-010: verifikasi `nodejs.org/en/about/previous-releases` dan pin di `.nvmrc`.                           |
| R4  | Chromium/Playwright browser belum terpasang; k6 dan Docker tidak tersedia.                                      | Adapter tidak bisa diuji langsung.         | Tes fake/mock di CI; tes nyata sebagai opt-in dengan status `BLOCKED`/`UNAVAILABLE` bila tidak tersedia. |
| R5  | Versi terbaru `typescript 7.x`, `eslint 10.x`, `vite 8.x` berbeda besar dari versi yang umum dipakai ekosistem. | Risiko kompatibilitas plugin.              | T-010: uji kompatibilitas dan catat di ADR jika memakai versi lebih lama.                                |
| R6  | Free-tier provider (Gemini/Groq) belum diverifikasi.                                                            | Klaim biaya/kuota salah.                   | T-110/T-120: verifikasi dokumentasi resmi dan catat tanggal. Tidak ada angka kuota ditanam.              |
| R7  | Ancaman SSRF/scope escape bersifat kritis.                                                                      | Scan target tidak sah.                     | T-040 sebagai gerbang; remote mode diblokir sampai guard teruji.                                         |
| R8  | Repo belum memiliki `.gitignore`.                                                                               | Risiko commit `data/`, `.env`, screenshot. | T-010 wajib menambahkan ignore rules sebelum ada artefak.                                                |

### Keputusan

- Stack mengikuti rekomendasi taskbook §3.1 (TypeScript, npm workspaces, React+Vite, Fastify, SQLite, Vitest, Playwright, Lighthouse, k6, Strix opsional). Lihat `docs/decisions/ADR-0001-stack-baseline.md`.

### Known limitations

- Hanya dokumentasi baseline; tidak ada fitur yang diklaim siap.
- Pemeriksaan keamanan adalah pemindaian pola sederhana, bukan audit keamanan menyeluruh.

### Next action

- T-010: pin Node LTS, inisialisasi npm workspaces, quality gates, `.gitignore`, `.env.example`, dan CI tanpa API key.

---

## T-010 — Bootstrap, workspace, dan quality gates

ID: T-010
Title: Bootstrap, workspace, dan quality gates
Status: VERIFIED
Depends on: T-000

Files changed:

- `package.json`, `package-lock.json` — paket root privat, script `format`, `format:check`, `lint`, `typecheck`, `test`, `secret-scan`, `check`; devDependencies dipin tepat (lihat ADR-0002).
- `.nvmrc` (`24.21.0`), `tsconfig.json` (strict + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `checkJs`), `eslint.config.js` (flat config), `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `vitest.config.ts`.
- `.gitignore` — mengabaikan `node_modules`, `dist`, `data/`, `*.sqlite*`, `artifacts/`, `reports/`, traces/HAR/screenshot, `.env`, `*.pem`, `*.key`, log.
- `.env.example` — nama config dari taskbook §2.3 dengan nilai default aman dan tanpa secret.
- `.github/workflows/ci.yml` — `npm ci` lalu `npm run check`; `permissions: contents: read`; tanpa secret, tanpa job remote scan.
- `scripts/secret-scan.mjs` — pemindai pola secret pada file yang dilacak git (tidak pernah mencetak nilai).
- `tests/unit/secret-scan.test.ts` — 11 tes (positif, negatif, boundary, symlink, file hilang, file biner).
- `README.md` — diperbarui: prasyarat, setup, daftar gate, konfigurasi. Catatan: Prettier menambahkan newline di akhir file ini (perubahan format saja).
- `docs/decisions/ADR-0002-toolchain-pins.md`.
- `IMPLEMENTATION_STATUS.md` — status.

Acceptance criteria:

- [x] Instalasi bersih berhasil — `rm -rf node_modules && npm ci` → "added 161 packages" (bukti: output perintah).
- [x] Quality scripts menjalankan tool nyata — `npm run check` lulus: prettier, eslint `--max-warnings=0`, tsc strict, vitest 11/11, secret-scan.
- [x] CI bisa menjalankan tes dasar tanpa key — workflow `ci.yml` hanya memakai `npm ci` + `npm run check`. CI belum dijalankan di GitHub (belum di-push saat dokumen ini ditulis).
- [x] Lockfile tidak stale — `npm ci` sukses dengan lockfile.
- [x] Negative test: command gagal dengan error jelas — secret-scan dengan canary di file yang dilacak: exit 1, pesan `SECRET-LIKE google-api-key at leak-probe.txt:1 (value not shown)`.
- [x] Negative test: scripts dipanggil dari luar root — `cd /tmp && node /home/user/NusaWebBench/scripts/secret-scan.mjs` → berjalan (scanned=5 findings=1), path root diturunkan dari `import.meta.url`.
- [~] Negative test: config env hilang/invalid — belum relevan pada T-010 (tidak ada konfigurasi runtime). Akan diuji di T-020 (config schema).
- Tidak ada script build palsu. Build ditambahkan bersama workspace pertama.

Commands actually run (Node 24.21.0 dari `/home/user/.toolchain`):

- `npm install --save-dev --save-exact typescript@5.9.3 eslint@9.39.5 @eslint/js@9.39.5 typescript-eslint@8.71.1 globals@16 prettier@3.9.9 eslint-config-prettier@10 @types/node@24` — PASS (setelah pemasangan bertahap; gabungan dalam satu perintah gagal dengan `Cannot read properties of null (reading 'edgesOut')`).
- `npm install --save-dev --save-exact vitest@4.1.11` — FAIL (bug resolusi peer npm 10.9.8); `vitest@4.0.18` — PASS.
- `npx vitest run` — PASS: 8 tes (putaran pertama 2 gagal, diperbaiki), kemudian 11/11 PASS.
- `npm run format` lalu `npm run check` — PASS: format, lint, typecheck, test 11/11, secret-scan `scanned=4 findings=0`.
- `git diff --check` — PASS.
- Negative: canary di file yang dilacak → `secret-scan` exit 1 (file probe dihapus dari index dan disk setelah uji).
- `rm -rf node_modules && npm ci && npm run check` — PASS.

Line-by-line audit:

- `scripts/secret-scan.mjs` dibaca penuh (baris 1–140 dan bagian akhir). Temuan dan perbaikan:
  1. `` pada pola nama secret tidak cocok di `GEMINI_API_KEY=` (underscore = karakter kata) → diganti lookbehind/lookahead `(?<![A-Za-z])`/`(?![A-Za-z])`. Diuji oleh tes "GEMINI_API_KEY (lowercase polos)".
  2. Pengecualian identifier terlalu longgar (nilai huruf kecil polos bisa lolos) → dipersempit: hanya identifier camelCase/snake_case yang mengandung huruf besar atau `_` dan tanpa digit yang diabaikan. Diuji.
  3. `stat` mengikuti symlink → diganti `lstat`; symlink dilewati. Diuji.
  4. File yang dihapus dari worktree menggagalkan scan → dilewati dengan alasan `missing-in-worktree`. Diuji.
     Catatan: `PLACEHOLDER_VALUE` mengabaikan nilai yang mengandung kata `example`/`dummy`; secret nyata yang kebetulan mengandung kata itu bisa terlewat. Diterima sebagai keterbatasan; pola provider (AIza/gsk_/AKIA/ghp_/PEM) tidak memakai pengecualian ini.
- `tests/unit/secret-scan.test.ts` dibaca penuh. Canary dibangun saat runtime agar tidak tertulis utuh di repo.
- Konfigurasi (`package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`, `.env.example`, `ci.yml`) ditinjau: tidak ada secret; `.env.example` hanya berisi placeholder kosong atau default.
- Git: `git status` ditinjau; file user `README.md` diubah hanya dengan penambahan konten yang disengaja (ditulis ulang). Tidak ada file di luar scope.

Security review:

- Tidak ada secret yang di-commit (pemindaian + secret-scan = 0 temuan).
- CI: `permissions: contents: read`, `persist-credentials: false`, tidak ada secret yang dibutuhkan.
- Tidak ada subprocess dengan string shell; satu-satunya subprocess adalah `git ls-files -z` dengan argumen array.

Evidence/artifacts: output perintah di atas (tidak disimpan sebagai file terpisah).

Known limitations:

- CI belum dijalankan di GitHub.
- Secret scanner adalah pemindai pola, bukan pengganti audit; tidak menjamin tidak ada secret.
- Versi TypeScript 7 / ESLint 10 / Vitest 4.1.11 belum dipakai (ADR-0002).

Next action: T-020 (domain schemas, error taxonomy, config schema).

## T-020 — Domain schemas dan error taxonomy

ID: T-020
Title: Domain schemas dan error taxonomy
Status: VERIFIED
Depends on: T-010

Files changed:

- `packages/core/package.json`, `packages/core/tsconfig.build.json` — paket workspace `@nusawebbench/core` (kondisi export `source` untuk tes, `dist` untuk runtime). Dependensi: `zod@4.6.5` (dipin).
- `packages/core/src/constants.ts` — satu-satunya sumber enum: status run/modul, severity, verification, source, kategori, provider, mode target, task AI, status usage, status remediation, jenis evidence, MIME allowlist, taksonomi error (`ERROR_CODES`, `AI_ERROR_CODES`).
- `packages/core/src/schemas.ts` — schema runtime `strictObject` untuk Run, ModuleResult, Finding, Evidence, ProviderUsage, RemediationProposal, serta primitif (origin kanonis, URL aman, path relatif anti-traversal, SHA-256, timestamp ISO UTC milidetik).
- `packages/core/src/errors.ts` — `AppError` (pesan aman terpisah dari `debugDetail`), `ERROR_CATALOG` (HTTP status + pesan aman), `toSafeError` (error tak dikenal → INTERNAL).
- `packages/core/src/redact.ts` — `redactText`, `redactUrl`, `containsKnownSecret` (redaksi header, pasangan nama-nilai sensitif, key provider, email, NIK 16 digit, PEM).
- `packages/core/src/config.ts` — `loadConfig` (validasi env saat startup, default §2.3, variabel kosong = default), `configSnapshot` (secret tidak pernah masuk, hanya flag `*_CONFIGURED`). Bind non-loopback butuh `ALLOW_EXTERNAL_BIND=true` (tambahan keselamatan di luar §2.3).
- `packages/core/src/factories.ts` — `createRun`, `createModuleResult`, `createFinding`, `createEvidence`, `createProviderUsage`, `createRemediationProposal`; `parseOrThrow` hanya melaporkan path dan kode issue, tidak nilai input.
- `packages/core/src/ids.ts` — ID `<prefix>_<32 hex>` dan `nowIso`.
- `packages/core/src/index.ts`, `packages/core/tests/*.test.ts` (6 file, 91 tes), `packages/core/tests/fixtures.ts` (data sintetis).
- `tsconfig.json`, `vitest.config.ts`, `package.json` (workspace `packages/*`, script `build`) — diperbarui.
- `package-lock.json` — diperbarui.

Acceptance criteria:

- [x] Schema valid/invalid lengkap — 91 tes PASS (`npx vitest run`): valid untuk setiap entitas; invalid untuk property hilang, field tambahan, enum salah, confidence di luar 0..1 + NaN/Infinity, timestamp salah format, urutan waktu, run terminal tanpa completedAt, string terlalu panjang, karakter kontrol, metrik pada status non-hasil, PASS dengan errorCode, SKIPPED tanpa alasan, CONFIRMED tanpa evidence, CONFIRMED dari AI, rule tanpa versi, artifact reference buruk, provider di luar daftar, VERIFIED remediation dengan tes gagal/regresi.
- [x] Tidak ada `any` di `packages/core/src` (grep). Trust boundary (env, input) memakai `unknown` + schema.
- [x] Semua adapter dapat mengembalikan status jelas — enum status modul mencakup SKIPPED/UNAVAILABLE/ERROR/NOT_RUN/CANCELLED.
- [x] UNAVAILABLE tidak berubah menjadi PASS — dijaga schema: status non-hasil wajib alasan, PASS tidak boleh membawa errorCode; tes "menolak PASS yang membawa errorCode" dan "menerima status non-hasil dengan alasan".
- [x] Negative tests: property hilang, extra fields, enum tidak valid, confidence di luar range, timestamp salah, payload terlalu panjang, invalid artifact reference (`evidenceRefs: ['../../etc/passwd']`).
- [x] Pesan error user-safe terpisah dari debug internal (`AppError.safeMessage` vs `debugDetail`; tes "pesan aman tidak mengandung detail debug").
- [x] Strategi schema version: `SCHEMA_VERSION = 1`, `z.literal(1)` pada Run/Finding. Kebijakan migrasi report lama didefinisikan di T-060 (belum ada report sebelumnya).

Commands actually run:

- `npx vitest run` — PASS: 91/91 (6 file). Putaran awal: 1 gagal (origin trailing slash) → kontrak diperketat dan tes diperbaiki; sekali lagi PASS.
- `npx tsc -p tsconfig.json --noEmit` — PASS (exit 0) setelah memperbaiki TS2307 (zod belum terpasang di workspace), TS7006, TS4111.
- `npm run lint` — PASS setelah memperbaiki `no-control-regex` (diganti pemeriksaan kode karakter).
- `npm run build` — PASS: `packages/core/dist/*.js` dibuat; `node -e` memanggil `loadConfig`, `newId`, `redactText` dari dist → berfungsi.
- `npm run check` pada commit T-020 pertama (`5aa8d6e`) — FAIL (exit 1): secret-scan menemukan 2 baris di tes secret-scan sendiri (contoh input sintetis) dan 5 baris di tes config/redaksi (canary sintetis berbentuk literal). Diperbaiki dengan membangun nilai uji saat runtime (`['abc','def'].join('')`); commit perbaikan menyusul. Hasil akhir: `npm run check` exit 0, `secret-scan: scanned=35 findings=0`.
- `npm install --save-exact zod@4.6.5 --workspace @nusawebbench/core` — PASS (sempat gagal karena pemasangan awal `-w` tidak menyimpan dependensi; diulang dengan nama workspace).

Line-by-line audit:

- `schemas.ts` dibaca penuh. Temuan: (1) perbandingan string timestamp salah bila presisi berbeda → dipaksa `precision: 3`, diuji; (2) origin menerima trailing slash → diperketat ke bentuk `URL.origin` persis, diuji; (3) nama helper `ModuleResultRefs` dipakai untuk findingIds → diganti `IdListSchema`; (4) variabel `times` tak terpakai → dihapus.
- `config.ts` dibaca penuh. Temuan: (1) `z.coerce` mengubah `''` menjadi 0 (PORT kosong lolos sebagai ditolak secara membingungkan; boolean kosong gagal) → `emptyToUndefined`, diuji; (2) akses bracket untuk key bertanda `_CONFIGURED` (TS4111) → diperbaiki.
- `redact.ts`, `errors.ts`, `factories.ts`, `constants.ts`, `ids.ts` dibaca; tes negatif untuk redaksi (header, PEM, URL userinfo, query sensitif) dan error (stack/path tidak bocor) ditambahkan.
- Tes (`tests/*.ts`): dibaca dan diperbaiki (ekspektasi origin yang ambigu ditulis ulang sebagai daftar eksplisit).
- Grep `any|TODO|FIXME|console|eval` pada `packages/core/src` dan `scripts/` → tidak ada temuan selain output CLI scanner yang disengaja.

Security review:

- Input dari luar (env, body) divalidasi schema; path relatif menolak traversal, absolut, backslash, NUL; URL menolak non-HTTP(S) dan userinfo.
- Konfigurasi: secret tidak pernah dimasukkan ke pesan error atau snapshot (diuji dengan canary sintetis).
- Redaksi diuji dengan canary sintetis. Keterbatasan: pola regex hanya menangkap bentuk yang dikenal.

Evidence/artifacts: output `vitest` dan `tsc` di atas; tes di `packages/core/tests/`.

Known limitations:

- `redactText` bukan pengganti audit privasi; nama field non-standar dapat terlewat.
- Schema belum mengenal target (`Target`) — ditambahkan di T-040.
- `FREE_TIER_LOCK=false` diizinkan di env (dengan `AI_PROVIDER=none`); pemblokiran perubahan lock via UI/API dijadwalkan di T-180.

Next action: T-030 (SQLite storage, migration, repository).

## T-030 — SQLite storage, migration, dan repository layer

ID: T-030
Title: SQLite storage, migration, dan repository layer
Status: VERIFIED
Depends on: T-020

Keputusan: `node:sqlite` bawaan Node 24 (ADR-0003). Tidak ada dependency native.

Files changed:

- `packages/storage/package.json`, `packages/storage/tsconfig.build.json` — paket `@nusawebbench/storage` (depends on core).
- `packages/storage/src/database.ts` — `openDatabase` (buat folder, PRAGMA aman, cek schema), `withTransaction` (BEGIN IMMEDIATE, rollback), `mapSqliteError` (UNIQUE→CONFLICT, FK/CHECK→VALIDATION_FAILED, lain→STORAGE_ERROR; pesan asli hanya di debugDetail yang diredaksi).
- `packages/storage/src/migrations.ts` — migrasi v1 (targets, runs, run_transitions, module_results, findings, evidence, provider_usage, remediation_proposals, app_settings) dengan CHECK constraint dan foreign key; `migrate` idempotent, checksum SHA-256, menolak versi lebih baru dan checksum berubah, tiap migrasi dalam transaksi.
- `packages/storage/src/repositories.ts` — TargetRepository, RunRepository (transisi compare-and-set + tabel transisi), ModuleResultRepository (UNIQUE per run, identitas tidak bisa diubah), FindingRepository (`insertIfNew` idempoten via sidik jari), EvidenceRepository, ProviderUsageRepository (`countRequests` per provider/hari), RemediationRepository, SettingsRepository.
- `packages/storage/src/store.ts` — `Store.open(path)` menggabungkan koneksi, migrasi, dan repository.
- `packages/storage/src/index.ts`; `packages/storage/tests/storage.test.ts` (24 tes).
- `packages/core/src/constants.ts` — `ALLOWED_RUN_TRANSITIONS` (satu-satunya aturan transisi), `isAllowedRunTransition`.
- `packages/core/src/schemas.ts` — `TargetSchema`, `SafeParser` (tipe struktural untuk lapisan storage).
- `packages/core/src/factories.ts` — `createTarget`; `parseOrThrow` menerima `SafeParser` dan melempar VALIDATION_FAILED.
- `vitest.config.ts` — alias ke `src` paket workspace agar tes tidak memakai `dist` lama (ditemukan saat pengujian: dist stale menyebabkan `createTarget is not a function`).
- `docs/decisions/ADR-0003-sqlite-node-sqlite.md`.

Acceptance criteria:

- [x] CRUD repositories — tes insert/get/list/findByOrigin untuk target; insert/get/transition/list untuk run; insert/list/update untuk modul, temuan, evidence, usage, remediation, settings.
- [x] Migration tests — DB kosong (apply v1, idempoten), checksum berubah ditolak, DB versi lebih baru ditolak, migrasi gagal di tengah rollback dan tidak tercatat, upgrade dari v1 ke v2 tanpa menyentuh data lama.
- [x] Transaction rollback tests — `withTransaction` melempar error → insert di dalam transaksi tidak tersimpan (tes "rollback penuh").
- [x] Restart persistence test — `Store.open` → tulis → close → buka ulang: run tetap ada (tes persisten); usage tetap ada setelah restart (tes usage terpisah).
- [x] DB corruption/error handling — file bukan SQLite → STORAGE_ERROR tanpa path di pesan aman; folder tidak dapat ditulis → STORAGE_ERROR (dilewati bila berjalan sebagai root, dinyatakan di kode).
- [x] Negative: duplicate run ID (CONFLICT), run dengan target tidak ada (FK), error transaksi (rollback), file DB rusak (STORAGE_ERROR), folder DB tidak dapat ditulis (STORAGE_ERROR, dilewati jika root). Path invalid dan artifact hilang belum diuji di T-030 (artifact di T-060).
- [x] Query parameterization — tes "input berbahaya diperlakukan sebagai data": judul `'); DROP TABLE runs; --` tersimpan literal dan tabel runs tetap ada.
- [x] Data tersimpan dimanipulasi → ditolak saat dibaca (STORAGE_ERROR), tidak diteruskan.
- [x] Patch transisi tidak bisa mengubah identitas run (`targetId`, `id`) — ditambahkan setelah audit.
- [x] Foreign key dan uniqueness: run dengan target tidak ada → VALIDATION_FAILED; origin target ganda → CONFLICT; modul ganda per run → CONFLICT.
- [~] Artifact path verifikasi terhadap root artefak — belum diimplementasikan (tanggung jawab artifact store T-060); skema `RelativePathSchema` sudah menolak traversal.
- [~] Retention/cleanup — belum diimplementasikan; dijadwalkan T-200 (cleanup dengan dry-run). Tidak ada penghapusan data di T-030.

Commands actually run:

- `npx vitest run` — PASS 115/115 (termasuk 24 tes storage; `npx vitest run packages/storage` 24/24). Sebelumnya: 13 gagal karena dist stale (diperbaiki dengan alias), 1 gagal karena ZodError terpetakan STORAGE_ERROR (diperbaiki: parseOrThrow → VALIDATION_FAILED), 1 gagal karena migrasi uji salah (ditulis ulang).
- `npx tsc -p tsconfig.json --noEmit` — PASS.
- `npm run lint` — PASS setelah menghapus non-null assertion dan `require()` di tes.

Line-by-line audit:

- `database.ts`, `migrations.ts`, `repositories.ts` dibaca. Temuan dan perbaikan:
  1. `ZodError` mentah dipetakan menjadi STORAGE_ERROR → diganti `parseOrThrow` (VALIDATION_FAILED).
  2. Patch transisi bisa menimpa identitas → hanya `startedAt`, `completedAt`, `errorSummary` yang disalin. Diuji (tes 262).
  3. Migrasi v1 dijalankan `db.exec` di dalam `withTransaction` — DDL SQLite transaksional; diuji rollback.
  4. `countRequests` menjumlahkan `requestCount` dari JSON per provider dan bucket lokal (tes usage).
- `store.ts`, `database.ts` (fungsi `describe`), `index.ts`: dibaca.
- Catatan keamanan: `debugDetail` untuk error pembukaan file dapat memuat path lokal (diredaksi hanya untuk pola secret). Ini hanya untuk log internal, tidak pernah dikembalikan ke klien (`toSafeError`).

Security review:

- Semua query memakai parameter; nama tabel/kolom berasal dari kode.
- Baris dari DB divalidasi ulang dengan schema domain.
- Tidak ada penghapusan file di luar direktori aplikasi (storage tidak menyentuh filesystem selain file DB dan folder induknya).
- Keterbatasan: pengecekan izin file DB bergantung pada OS; tidak ada enkripsi at-rest (di luar scope; data bersifat lokal).

Evidence/artifacts: output `vitest`, `tsc`, dan `eslint` di atas.

Known limitations:

- Belum ada verifikasi path artefak terhadap root artefak (T-060).
- Belum ada cleanup/retention (T-200).
- Test "folder tidak dapat ditulis" dilewati bila berjalan sebagai root; di CI non-root ini dijalankan.

Next action: T-040 (target registry dan scope guard).

## T-040 — Target registry dan authorization/scope guard

ID: T-040
Title: Target registry dan authorization/scope guard
Status: VERIFIED
Depends on: T-020, T-030

Files changed (baru): `packages/core/src/scope.ts` (434 baris), `packages/core/tests/scope.test.ts` (334 baris, 25 tes), `packages/orchestrator/src/plan.ts` (92 baris).
Files changed (diubah): `packages/core/src/index.ts` (ekspor scope), `packages/core/src/schemas.ts` (`AuthorizationSchema`, `OriginSchema`).

Acceptance criteria dan bukti:

- Origin harus kanonis (tanpa path, query, userinfo, atau fragment): `createScopeGrant` melempar `SCOPE_DENIED` bila origin tidak persis sama dengan bentuk kanonisnya; userinfo ditolak (`credentials-not-allowed`). Tes: "menerima HTTP(S)...", "origin spoofing dengan suffix...".
- Mode remote menolak alamat loopback, private, link-local, metadata, dan reserved, termasuk bentuk IPv4-mapped, NAT64, dan 6to4 (dibaca di `classifyIPv6`). Tes: klasifikasi IP dan "menolak IP literal privat...".
- DNS rebinding (hostname publik yang resolve ke privat) ditolak; DNS gagal/kosong ditolak tanpa membocorkan detail. Tes: "DNS rebinding...", "DNS gagal atau kosong...".
- Port selain 80/443 ditolak pada remote. Tes: "port yang tidak diizinkan ditolak pada remote".
- Mode local-fixture hanya loopback; `localhost` yang resolve ke non-loopback ditolak. Tes: grup "mode local-fixture".
- Setiap hop redirect diperiksa ulang; redirect keluar origin, redirect ke metadata, loop, Location kosong, dan skema `file:` ditolak. Tes: grup "redirect" (7 tes).
- Remote + modul browser/eksternal (`FUNCTIONAL_QA`, `LIGHTHOUSE`, `LOAD_K6`, `SECURITY_STRIX`) ditolak oleh `buildRunPlan` karena DNS pinning belum dapat dijamin. Tes: `orchestrator.test.ts` "remote dengan modul browser ditolak sebelum run".

Commands actually run: `npx vitest run` (seluruh suite) — hasil di T-080 dan bagian "Verifikasi terakhir" di bawah.

Test results: seluruh tes scope lulus (bagian dari 331 tes dengan browser; 313 lulus + 18 dilewati tanpa browser).

Line-by-line audit (sesi ini):

- `scope.ts` dibaca seluruhnya (434 baris). Tidak ada cacat keamanan yang ditemukan. Setiap jalur yang diperiksa menutup dengan penolakan (fail closed): IP tidak valid dianggap `reserved`, `addressesAllowed` mensyaratkan SEMUA alamat publik, dan `followRedirectsSafely` memeriksa ulang setiap hop.
- `plan.ts` dibaca seluruhnya (92 baris). Konsisten dengan keputusan T-040 dan `authorizationFor` menolak consent kosong (`CONSENT_REQUIRED`).

Security review:

- DNS pinning: tidak diimplementasikan. Mitigasi: remote + modul browser diblokir. Risiko DNS rebinding antara pemeriksaan dan koneksi untuk mode remote tanpa browser tetap ada (lihat R-SCOPE-1).
- Pesan penolakan tidak memuat alamat internal atau hasil DNS (`scopeDenyMessage`).

Known limitations:

- DNS pinning belum ada (R-SCOPE-1).
- Daftar blok hostname (`.local`, `.internal`, dll.) bersifat tetap; tidak ada daftar dinamis.

Next action: tidak ada untuk T-040 kecuali DNS pinning dijadwalkan pada T-190 (security hardening).

---

## T-050 — Run orchestrator dan state machine

ID: T-050
Title: Run orchestrator dan state machine
Status: VERIFIED
Depends on: T-020, T-030, T-040

Files changed: `packages/orchestrator/src/orchestrator.ts` (594 baris), `packages/orchestrator/src/aggregate.ts` (39 baris), `packages/orchestrator/src/plan.ts`, `packages/orchestrator/src/index.ts`, `packages/orchestrator/tests/orchestrator.test.ts` (33 tes), `packages/orchestrator/package.json`.

Acceptance criteria dan bukti:

- Transisi status sesuai aturan: transisi dilakukan dengan compare-and-set pada versi (`transitionWithRetry`, satu percobaan ulang).
- Satu run aktif: tes "satu run aktif: run kedua menunggu di antrean (QUEUED)".
- Timeout dan retry hanya untuk `retryable`: tes "adapter hang → TIMEOUT", "retry transient dibatasi maxRetries", "retry tidak berulang tanpa batas".
- Cancel: QUEUED → CANCELLED langsung; RUNNING → CANCELLING lalu CANCELLED; tes "cancel sebelum start", "cancel saat modul berjalan".
- Restart: RUNNING/CANCELLING → FAILED dengan `interrupted-by-restart` (`errorSummary` kini juga diisi); QUEUED → CANCELLED. Tes "run RUNNING yang tertinggal...".
- Shutdown grace habis → FAILED dengan `shutdown-grace-exceeded` (`errorSummary` kini juga diisi). Tes BARU: "shutdown melewati grace period → ... (shutdown-grace-exceeded)". Tes ini menyuntikkan antrean macet melalui jalur internal karena jalur publik tidak dapat membuat grace habis (abort menyelesaikan race adapter). Tes gagal bila fallback dihapus (verifikasi mutasi, lihat di bawah).
- Keluaran modul tidak valid tidak menghasilkan hasil sukses (NaN, PASS dengan errorCode): tes "keluaran adapter tidak valid (NaN)", "status PASS dengan errorCode ditolak".
- Temuan dari keluaran tidak valid tidak disimpan: tes BARU "keluaran tidak valid tidak menyimpan temuannya".

Perbaikan yang ditemukan saat audit sesi ini:

1. Temuan disimpan sebelum keluaran modul divalidasi → keluaran tidak valid dapat meninggalkan temuan yatim. Diperbaiki dengan `checkOutcome` (validasi sebelum `persistFindings`). Verifikasi mutasi: tanpa perbaikan, tes regresi gagal (1 temuan yatim tersimpan); dengan perbaikan, lulus.
2. `errorSummary` tidak terisi untuk run FAILED karena restart atau shutdown; alasan hanya tersimpan di log transisi. Kini `errorSummary` diisi. Tes restart diperbarui dari `null` menjadi `interrupted-by-restart`.
3. Komentar dokumentasi `ModuleOutcome` berada di atas `ModuleContext`. Dipindahkan.

Commands actually run:

- `npx vitest run packages/orchestrator` — 33/33 lulus.
- `npx tsc -p tsconfig.json --noEmit` — PASS.
- Uji mutasi: menonaktifkan `checkOutcome` → 1 tes gagal; menghapus fallback grace → 1 tes gagal. Keduanya dikembalikan dan tes lulus lagi.

Line-by-line audit:

- `orchestrator.ts` dibaca seluruhnya (594 baris).
- `aggregate.ts` dibaca seluruhnya. Aturan agregasi cocok dengan taskbook §6.2. Modul opsional SKIPPED tidak menurunkan status; modul wajib SKIPPED menghasilkan PARTIAL.
- `plan.ts` dan `index.ts` dibaca seluruhnya.

Security review:

- Adapter menerima `signal` dari run; `invokeAdapter` mendengarkan sinyal run agar timeout tidak salah dilaporkan sebagai CANCELLED.
- Pesan error adapter asli tidak masuk hasil (`INTERNAL` dengan pesan aman).

Known limitations:

- Idempotency key hanya di memori; restart menghapusnya (R-ORCH-1).
- Adapter yang mengabaikan `signal` dapat meninggalkan promise berjalan setelah timeout/cancel, meski orkestrator tetap melaporkan hasil (R-ORCH-2).
- Temuan disimpan sebelum status modul diperbarui; crash di antara keduanya dapat menyisakan temuan (R-ORCH-3, sebagian dimitigasi).

Next action: tidak ada untuk T-050.

---

## T-060 — Evidence/artifact store dan reporting core

ID: T-060
Title: Evidence/artifact store dan reporting core
Status: VERIFIED
Depends on: T-020, T-030, T-050

Files changed: `packages/storage/src/artifacts.ts` (±340 baris), `packages/storage/tests/artifacts.test.ts` (19 tes; paket storage total 43 tes termasuk `storage.test.ts`), `packages/report/src/report.ts` (376 baris), `packages/report/src/index.ts`, `packages/report/tests/report.test.ts` (19 tes), `packages/report/package.json`, `packages/report/tsconfig.build.json`.

Acceptance criteria dan bukti:

- Tipe MIME dari isi, bukan ekstensi: `contentMismatch`; tes "MIME spoof...", "JPEG yang dideklarasikan image/png ditolak", "teks dengan NUL atau UTF-8 rusak ditolak".
- Nama berkas dari ID: tes "nama berkas dari pengguna tidak dipakai".
- Penulisan atomik (tmp → fsync → rename): tes "penulisan terputus (sebelum rename)".
- Tanpa file yatim: tes "kegagalan metadata DB tidak meninggalkan file yatim" dan tes BARU "metadata tidak valid ditolak dan file final dihapus".
- Path traversal dan symlink keluar root ditolak: tes "run id yang berisi path traversal", "symlink yang keluar root ditolak", "direktori run yang berupa symlink".
- Laporan JSON tervalidasi schema dan round-trip: tes "laporan tervalidasi dan round-trip JSON".
- HTML tanpa script dan ter-escape: tes "HTML injection ... di-escape", "tidak ada script atau handler inline".
- Secret dipindai sebelum simpan (fail closed): tes "laporan tidak disimpan bila masih memuat secret".

Perbaikan yang ditemukan saat audit sesi ini:

1. `EvidenceSchema.parse` dijalankan sebelum `try` insert. Jika metadata tidak valid, berkas final sudah ter-rename dan tidak dihapus → artefak yatim. Kini memakai `createEvidence` (galat `VALIDATION_FAILED`) di dalam `try` yang sama dengan insert; file final dihapus bila gagal. Verifikasi mutasi: menghapus pembersihan → 2 tes gagal.
2. `writeSync` dipanggil sekali dan hasil jumlah byte diabaikan. `writeSync` dapat menulis sebagian. Kini `writeAll` mengulang sampai seluruh buffer tertulis (dipakai di `write` dan `writeFileAtomic`).
3. `tsc`: tipe helper `meta()` di tes tidak menerima `description`. Diperbaiki.
4. `report.test.ts`: tes "judul laporan dan scope ... ter-escape" namanya melebihi isi asersi. Diganti namanya menjadi "judul laporan dan scope tampil di HTML (nilai asli)".

Commands actually run:

- `npx vitest run packages/storage` — 43/43 lulus (artifacts 19 + storage 24).
- `npx vitest run packages/report` — 19/19 lulus.
- `npx tsc -p tsconfig.json --noEmit` — PASS.

Line-by-line audit:

- `artifacts.ts` dibaca seluruhnya (326 baris + helper). Temuan dan perbaikan: (1) dan (2) di atas.
- `report.ts` dibaca seluruhnya (376 baris). Tidak ada cacat keamanan. Catatan: `redactDeep` diterapkan sebelum validasi; URL temuan dibatasi HTTP(S) oleh `SafeUrlSchema`; HTML memakai CSP `script-src 'none'`.
- `report.test.ts` dibaca seluruhnya. Satu tes "config snapshot tidak membawa nilai API key" lemah (hanya memeriksa satu pola regex); dicatat sebagai keterbatasan tes, bukan dihapus.

Security review:

- Artefak hanya ditulis di bawah root (realpath dicek, symlink ditolak).
- MIME tidak dipercaya dari pengirim; isi diperiksa signature-nya.
- Laporan HTML tidak memuat script; semua teks lewat `escapeHtml`.

Known limitations:

- Batas ukuran (`MAX_REPORT_BYTES`) hanya untuk JSON; HTML dan Markdown tidak punya batas tersendiri (diturunkan dari data yang sama, sudah dibatasi skema).
- `saveReport` menulis tiga artefak berurutan, tidak sebagai satu kelompok atomik. Jika penulisan kedua gagal, artefak pertama tetap ada.
- Redaksi berbasis pola; bukan jaminan lengkap (lihat `redact.ts`).
- Retensi dan cleanup artefak belum ada (T-200).

Next action: tidak ada untuk T-060 kecuali kelompok atomik untuk `saveReport` dijadwalkan pada T-200.

---

## T-070 — Target fixture suite dan ground truth

ID: T-070
Title: Target fixture suite dan ground truth
Status: VERIFIED
Depends on: T-010, T-020

Files changed: `fixtures/` (6 folder fixture: clean, functional-defects, a11y-defects, ux-signals, broken-resources, security-lab; `ground-truth.json`), `packages/fixtures/src/server.ts` (156 baris), `packages/fixtures/src/index.ts`, `packages/fixtures/tests/fixtures.test.ts` (24 tes), `packages/fixtures/package.json`, `packages/fixtures/tsconfig.build.json`, `eslint.config.js` (fixture dikecualikan dari lint karena sengaja memuat error).

Koreksi ground truth (dilakukan di T-080): FD-04 dan BR-01 semula berkind `request-failed`, padahal keduanya respons HTTP 404. Diubah menjadi `http-error-response`.

Acceptance criteria dan bukti:

- Fixture sintetis berlabel `synthetic/demo`: setiap halaman memuat `meta name="nwb-fixture"`; tes "setiap halaman HTML fixture diberi label synthetic/demo".
- Server hanya 127.0.0.1: tes "bind hanya ke 127.0.0.1...".
- Traversal ditolak: `resolveFixturePath` memeriksa prefiks dan realpath; tes keamanan path.
- Method selain GET/HEAD ditolak 405; tes "metode selain GET/HEAD ditolak 405".
- Clean menghasilkan nol temuan yang diharapkan: tes "fixture clean tidak punya temuan yang diharapkan".
- 18 temuan di 5 fixture (+ `clean` kosong): tes "setiap fixture terdaftar ada dan memiliki temuan terdokumentasi".
- Tidak ada secret nyata: tes "tidak ada fixture yang memuat secret atau kunci API nyata".

Perbaikan yang ditemukan saat audit sesi ini:

1. `createReadStream(file).pipe(res)` tanpa handler `error`. Jika berkas hilang di antara pengecekan dan pembacaan, error stream menjadi uncaught dan dapat menjatuhkan proses. Kini `stream.on('error', () => res.destroy())`. Catatan: perbaikan ini tidak punya tes langsung; race penghapusan berkas sulit direproduksi secara deterministik.

Commands actually run:

- `npx vitest run packages/fixtures` — 24/24 lulus.

Line-by-line audit:

- Seluruh fixture HTML/JS/SVG/JSON dibaca (±460 baris) dan dicocokkan dengan ground truth satu per satu: FD-01 sampai FD-04, AX-01 sampai AX-05, UX-01 sampai UX-05, BR-01 sampai BR-03, SL-01. Total 18 temuan; semua cocok dengan elemen di HTML/JS.
- Catatan (bukan cacat): `a11y-defects` memuat `<div onclick>` yang tidak tercantum di ground truth. Ini tidak membatalkan temuan yang tercantum, tetapi jika pemindai menandainya, hasilnya tidak diklasifikasikan sebagai false positive.
- `server.ts` dibaca seluruhnya (lihat perbaikan di atas).

Security review:

- `security-lab` sengaja memantulkan `q` tanpa escape untuk uji lokal; diberi banner peringatan dan `ground-truth.json` mencatat "Jangan deploy".
- Server tidak menyajikan berkas di luar folder fixture (prefiks + realpath).

Known limitations:

- `security-lab` hanya untuk uji lokal dan tidak boleh di-deploy.
- Ground truth hanya mencakup elemen yang dirancang; bukan cakupan lengkap sebuah situs.

Next action: tidak ada untuk T-070.

---

## T-080 — Functional QA adapter (Playwright)

ID: T-080
Title: Functional QA adapter (Playwright)
Status: VERIFIED (dengan keterbatasan yang dicatat di bawah; lihat catatan "Known limitations")
Depends on: T-040, T-050, T-060, T-070

Files changed:

- Baru: `packages/browser-qa/` — `package.json` (`playwright-core` 1.64.0, dipin), `tsconfig.build.json`, `src/index.ts`, `src/config.ts`, `src/policy.ts`, `src/functional-qa.ts`, `tests/policy.test.ts` (9 tes), `tests/functional-qa.test.ts` (8 tes), `tests/negative.test.ts` (14 tes).
- Diubah: `packages/orchestrator/src/orchestrator.ts` (kontrak `moduleResultId` dan `findings`, lihat T-050), `fixtures/ground-truth.json` (koreksi kind), `vitest.config.ts` (alias), `eslint.config.js` (fixture dikecualikan), `package-lock.json`.

Sumber resmi (diambil 2026-10-09): Playwright intro — dukungan Node 22/24/26 dan `npx playwright install --with-deps` untuk browser (https://playwright.dev/docs/intro). Versi `playwright-core` yang dipakai: 1.64.0 (sesuai `npm view`).

Acceptance criteria dan bukti:

- Fixture clean: status PASS, nol temuan — `functional-qa.test.ts` (integrasi browser nyata).
- Fixture functional-defects: FD-01 (qa-page-error), FD-02 (qa-console-error), FD-03 (qa-broken-link), FD-04 (qa-http-error-response dari klik `#load-btn` → `/api/missing-resource`) terdeteksi — `functional-qa.test.ts`.
- Origin eksternal diblokir: server eksternal lokal kedua menerima 0 hit; `requestsBlocked >= 2` — `negative.test.ts`.
- Semua browser berhenti: `isConnected() === false` setelah sukses, timeout, pembatalan, dan crash — `negative.test.ts`.

Negative tests (sesuai taskbook §12 T-080):

- request gagal (socket putus → `qa-request-failed`) ✓
- browser crash (browser ditutup saat navigasi menunggu → ERROR, bukan hang/PASS) ✓
- timeout navigasi halaman awal → ERROR TIMEOUT retryable ✓
- redirect keluar scope tidak diikuti (`linksRedirectDenied`) dan tidak ada hit eksternal ✓
- console error ✓; secret di pesan konsol diredaksi (Bearer token) ✓
- selector tidak valid → kegagalan langkah, bukan crash ✓
- duplikat tautan (dengan dan tanpa fragmen) hanya dicek sekali ✓
- form: isi dummy ✓; password ditolak ✓; tombol submit tidak dikirim (0 POST) ✓
- artefak gagal disimpan → modul tetap berjalan, temuan `LIKELY` tanpa evidence ✓
- batas crawl dihitung dari percobaan navigasi (bukan hanya sukses) ✓
- "secret in page text": tidak berlaku secara desain — adapter tidak mengambil teks halaman; hanya pesan konsol/jaringan yang diredaksi.

Commands actually run:

- `CHROMIUM_PATH=/tmp/chromium LD_LIBRARY_PATH=... npx vitest run packages/browser-qa` — 30/30 lulus (pada tahap sebelum tes crash ditambahkan, 28/28; tes crash lulus 2/2 saat difilter).
- `CHROMIUM_PATH=... REQUIRE_BROWSER_TESTS=1 npx vitest run` — 331/331 lulus (seluruh suite; 15 berkas tes).
- `npx vitest run` tanpa `CHROMIUM_PATH` — 313 lulus, 18 dilewati (tes browser SKIPPED dan tidak dihitung sebagai bukti).
- `npx tsc -p tsconfig.json --noEmit` — PASS.
- `npx eslint . --max-warnings=0` — PASS.
- `npx prettier --check .` — PASS.
- `node scripts/secret-scan.mjs` — `scanned=44 findings=0`.

Test results: lihat command di atas. Tes browser nyata memakai Chromium 153 (HeadlessChrome) dari paket npm `@sparticuz/chromium` yang diekstrak ke `/tmp/chromium` (di luar repo; hanya untuk verifikasi lokal).

Line-by-line audit:

- `functional-qa.ts` (±870 baris): dibaca seluruhnya; ditemukan dan diperbaiki: (1) batas crawl hanya menghitung halaman sukses → kini menghitung percobaan dan antrean dibatasi `MAX_QUEUE`; (2) navigasi yang diblokir scope dilaporkan sebagai defek → kini `navigationsBlocked`; (3) klik tombol submit dan `href` berisiko belum diperiksa → kini diperiksa; (4) alur tidak mulai dari `startPath` → kini navigasi awal ditambahkan (tes FD-04 sebelumnya lulus karena temuan halaman lain; kini diverifikasi spesifik); (5) sinyal dari alur tanpa bukti → kini diberi screenshot; (6) selector berisiko diperiksa sebelum elemen dicari; (7) selector `a[href=…]` pada tautan rusak dihapus karena dapat menyesatkan; (8) `runStep` menangkap kesalahan Playwright; `StepRefused` tetap diteruskan.
- `orchestrator.ts`: dibaca seluruhnya; perbaikan temuan yatim (lihat T-050).
- `config.ts`, `policy.ts`: dibaca seluruhnya. Catatan: pola label berisiko bersifat substring (`pay`, `order`) sehingga dapat menolak teks seperti "display" — trade-off konservatif yang disengaja.
- Tes: ketiga berkas tes dibaca; dua galat tes diperbaiki (prefiks ID `mod_`, route `/socket-drop` dengan query string, dan asersi hit server → URL unik).

Security review:

- Trust boundary: setiap permintaan browser diperiksa `checkUrlInScope` lewat `context.route`; WebSocket ditutup seluruhnya; `context.request` (APIRequest) tidak melewati route sehingga setiap hop redirect diperiksa oleh `followRedirectsSafely`.
- Form: hanya `DUMMY_FORM_VALUE`; tipe password/file/hidden/submit ditolak; tombol submit ditolak; label berisiko ditolak.
- Konfigurasi: path harus root-relative; traversal, `//`, backslash, dan karakter kontrol ditolak; pesan galat tidak memuat nilai masukan.
- Log/temuan: pesan diredaksi dengan `redactText` dan dipotong 300 karakter; URL diredaksi dengan `redactUrl`.
- Dialog di-dismiss; download dinonaktifkan; service worker diblokir.
- Argumen Chromium membatasi trafik latar belakang (`--disable-background-networking`, dll.).

Evidence/artifacts: screenshot PNG disimpan lewat `ArtifactStore` (`kind: screenshot`, `synthetic` untuk fixture lokal). Screenshot diambil hanya untuk halaman awal dan halaman dengan sinyal, serta untuk alur yang gagal atau memiliki sinyal.

Known limitations:

- Chromium untuk verifikasi lokal berasal dari paket npm pihak ketiga (`@sparticuz/chromium`, build untuk Lambda), bukan dari CDN resmi Playwright (tidak dapat diakses dari sandbox). Build resmi harus dipasang di CI (`npx playwright install --with-deps chromium`) dan path-nya diberikan lewat `CHROMIUM_PATH` (T-220).
- Tes browser dilewati bila `CHROMIUM_PATH` tidak diset; dilewati tidak sama dengan lulus.
- Screenshot tidak diredaksi pada level piksel. Teks yang tampil di layar dapat memuat data sensitif; hanya teks log yang diredaksi. Untuk fixture sintetis ini dapat diterima; untuk target lain perlu kebijakan terpisah.
- Trace Playwright belum diimplementasikan (taskbook: "hanya saat perlu"). Ditunda.
- Asersi "form validation behavior" hanya sampai `expectValidity` (validitas HTML5) dan belum mencakup pesan validasi kustom.
- Tidak ada pemeriksaan kebijakan DNS untuk mode remote (lihat T-040). Modul browser remote tetap diblokir.
- Halaman yang mengirim data sendiri secara otomatis tanpa interaksi tidak dicegah selain melalui guard scope (permintaan ke origin yang sama tidak diblokir).
- Crash browser disimulasikan dengan menutup proses browser dari luar; crash di level renderer/GPU tidak diuji secara khusus.
- Tidak ada batas waktu total per modul di dalam adapter; batas diberikan orchestrator (`timeoutMs` = 120 detik).

Next action: T-090 (Lighthouse adapter). Ambil dokumen Lighthouse resmi terlebih dahulu dan catat tanggalnya.

## T-090 — Lighthouse adapter

ID: T-090
Title: Lighthouse adapter
Status: VERIFIED
Depends on: T-040, T-050, T-060, T-070

Files changed:

- Baru: `packages/lighthouse/` — `package.json` (dependensi dipin: `lighthouse` 13.5.0, `chrome-launcher` 1.2.2, `zod` 4.6.5; workspace `@nusawebbench/core`, `orchestrator`, `storage` 0.1.0), `tsconfig.build.json`, `src/lighthouse.ts`, `src/index.ts`, `tests/lighthouse.test.ts` (24 tes).
- Diubah: `vitest.config.ts` (alias `@nusawebbench/lighthouse`), `package-lock.json`.

Sumber resmi (diambil 2026-10-09): Lighthouse `docs/configuration.md` (https://github.com/GoogleChrome/lighthouse/blob/main/docs/configuration.md). Pemakaian: API Node `lighthouse(url, flags)` dengan `port` dari `chrome-launcher`, `output: 'json'`, `onlyCategories`, `screenEmulation`, `throttlingMethod: 'simulate'`. Versi dipin: 13.5.0 (`npm view lighthouse version`).

Acceptance criteria dan bukti:

- Berjalan pada fixture `clean` dengan Chromium nyata (Chrome 153 dari `/tmp/chromium`): status PASS, skor performa 0–100, `toolVersion` memuat `13.5.0` — tes `fixture clean dijalankan dengan Lighthouse dan Chrome nyata`.
- Output valid dan metadata lengkap: `toolVersion` = versi Lighthouse + versi Chrome dari `environment.hostUserAgent`; `lighthouse_duration_ms` dari `timing.total`; `comparable`; artefak JSON mentah diredaksi dengan `redactionApplied: true` dan hash terverifikasi (`readVerified`).
- Tool missing → UNAVAILABLE `TOOL_MISSING`, runner tidak dipanggil — tes executable tidak ada dan tidak diset.
- Timeout → ERROR `TIMEOUT`, sinyal runner dibatalkan.
- Skor null tidak dicatat sebagai 0; metrik NaN/Infinity tidak dicatat (diperiksa lewat `Number.isFinite`).
- Kondisi tidak comparable (form factor, throttling, origin akhir) diberi `comparable: 0` dan alasan, tidak disembunyikan.

Negative tests (sesuai taskbook §12 T-090):

- malformed output (string, kategori hilang, `categories` bukan objek) → ERROR `TOOL_FAILED` ✓
- timeout → ERROR `TIMEOUT` ✓; runner yang terlambat setelah timeout tidak mengubah hasil ✓
- missing executable → UNAVAILABLE `TOOL_MISSING` ✓
- target redirect (`finalUrl` di origin lain) → ERROR `SCOPE_DENIED`, tanpa artefak ✓
- unsupported flag (kunci config tak dikenal, mis. `extraFlag`; `startPath` protocol-relative; `formFactor: tablet`) → ERROR `CONFIG_INVALID` ✓
- browser launch failure (runner melempar sebelum Lighthouse berjalan) → ERROR `TOOL_FAILED`, pesan asli (`ENOENT`) tidak dibocorkan ✓
- invalid numeric metric (NaN) → metrik tidak dicatat ✓
- runtimeError dari Lighthouse → ERROR `TOOL_FAILED` ✓
- laporan melebihi `maxReportBytes` → ditolak (ERROR), tidak dipotong diam-diam ✓
- pembatalan saat berjalan → ERROR `CANCELLED`; dibatalkan sebelum mulai → runner tidak dipanggil ✓
- artefak gagal disimpan → hasil tetap PASS dengan `artifact_saved: 0` ✓
- secret di detail audit diredaksi sebelum disimpan (`[REDACTED:GROQ_API_KEY]`) ✓

Audit khusus (baris per baris, `src/lighthouse.ts`):

- Subprocess args: tidak ada string shell. Flag Chrome berupa array konstanta `CHROME_FLAGS`. `url` dibentuk dari `startPath` di-resolve terhadap origin grant, lalu dicek `checkUrlInScope`.
- Output parsing: keluaran divalidasi ukuran (`maxReportBytes`) dan skema zod sebelum dibaca; skema bersifat passthrough hanya untuk bidang yang tidak dipakai.
- Numeric validation: skor dibatasi 0–1 dan nullable; metrik harus `finite`.
- Timing metadata: `timing.total` dicatat sebagai `lighthouse_duration_ms`; versi Lighthouse dan Chrome dicatat di `toolVersion`.
- Artifact size: dibatasi `maxReportBytes` (default 3 MB, maks 5 MB) sebelum penyimpanan.
- Browser cleanup: `defaultLighthouseRunner` selalu memanggil `chrome.kill()` di `finally`, dan juga saat abort. Dibuktikan oleh tes real Chromium (proses selesai dalam ~7,5 detik); tes penghentian paksa per proses tidak dilakukan.
- Kesalahan internal tidak dibocorkan: pesan asli dari runner tidak masuk `errorMessageSafe`.

Commands actually run:

- `npx vitest run packages/lighthouse` dengan `CHROMIUM_PATH=/tmp/chromium LD_LIBRARY_PATH=/tmp/al2023x/lib` — 24/24 lulus.
- `npx vitest run packages/lighthouse` tanpa `CHROMIUM_PATH` — 23 lulus, 1 dilewati (tes Chromium nyata).
- `npx tsc -p tsconfig.json --noEmit` — PASS. `npx eslint packages/lighthouse --max-warnings=0` — PASS.
- `node scripts/secret-scan.mjs` — `findings=0`.
- Seluruh suite dijalankan sebelum penambahan dua tes terakhir: 352/353, satu kegagalan (uji konfigurasi yang diperbaiki), lalu diperbaiki.

Known limitations:

- Lighthouse tidak punya route guard. Pembatasan jaringan hanya lewat `--host-resolver-rules` Chrome (R-LH-1).
- `--no-sandbox` dipakai agar Chrome berjalan di container/sandbox. Ini memperlemah isolasi proses Chrome (R-LH-1).
- Status PASS berarti eksekusi dan validasi berhasil, bukan ambang skor.

---

## T-100 — Deterministic UX/accessibility heuristic engine

ID: T-100
Title: Deterministic UX/accessibility heuristic engine
Status: VERIFIED
Depends on: T-020, T-060, T-070, T-080

Files changed:

- Baru: `packages/ux-rules/` — `package.json`, `tsconfig.build.json`, `src/rules.ts` (registry `RULE_CATALOG` dengan 10 `ruleId`, versi, kind objective/subjective, severity, applicability, detection, evidence, remediation, limitation; `SnapshotSchema`; `evaluateSnapshot` murni; suppression), `src/collect.ts` (skrip DOM dalam string + `collectSnapshot` lewat Playwright dengan guard scope), `src/adapter.ts` (`UxRulesAdapter`, `parseUxRulesConfig`), `tests/rules.test.ts` (20 tes murni), `tests/adapter.test.ts` (16 tes; 11 butuh Chromium).
- Baru: `fixtures/a11y-defects/assets/logo.svg` — koreksi fixture (lihat "Koreksi" di bawah).
- Diubah: `vitest.config.ts` (alias), `package-lock.json`.

Koreksi yang dicatat:

- `fixtures/a11y-defects/index.html` memanggil `/assets/logo.svg` tetapi berkas itu tidak ada. Akibatnya halaman menghasilkan temuan gambar rusak yang tidak ada di ground truth. Aset sintetis ditambahkan (salinan `fixtures/clean/assets/logo.svg`). Ground truth tidak diubah.
- Temuan salah positif ditemukan saat tes `fixture clean`: tiga tautan di `nav` dianggap "kartu berulang". Diperbaiki: kelompok hanya dihitung bila setiap item punya minimal dua elemen anak. Tes regresi ditambahkan.
- Kebocoran: snapshot awalnya disimpan tanpa redaksi. Diperbaiki dengan redaksi per nilai string; tes secret di teks halaman ditambahkan.

Acceptance criteria dan bukti:

- Hasil fixture sama di run berulang: `determinisme: dua run pada fixture yang sama` (Chromium) dan `evaluateSnapshot` murni deterministik (tes murni).
- Setiap temuan memiliki `ruleId`, `ruleVersion`, selector, dan evidence (artefak snapshot): tes adapter (`pelanggaran objektif`) dan verifikasi hasil.
- Ground truth UX_RULES cocok persis (multiset `ruleId`) untuk `a11y-defects` (5), `ux-signals` (5), dan `broken-resources` (1): `ground truth UX_RULES`.
- Fixture `clean` tidak menghasilkan temuan: PASS, nol temuan.
- Tidak ada label "AI-generated": engine tidak memakai AI.

Negative tests (sesuai taskbook §12 T-100):

- DOM kosong → nol temuan ✓ (tes murni dan adapter)
- dynamically loaded DOM: DOM yang disisipkan sebelum DOMContentLoaded ikut terperiksa ✓; DOM yang disisipkan setelah load TIDAK terperiksa (batasan, diuji) ✓
- duplicate labels → temuan subjektif `ux-duplicate-cta` ✓
- off-screen elements: elemen dengan `visible=false` tidak diperiksa label-nya ✓ (tes murni)
- shadow DOM / iframe: tidak ditelusuri (batasan, diuji: tidak menghasilkan temuan dari dalam shadow root/iframe) ✓
- CSS missing: halaman tetap diperiksa, PASS ✓
- responsive viewport changes: overflow hanya pada 390px, tidak pada 1440px ✓
- selector ambiguity: dua tombol identik mendapat selector berbeda (`:nth-of-type`) ✓
- tambahan: timeout (ERROR TIMEOUT retryable), redirect keluar scope (ERROR, tanpa temuan), pembatalan (CANCELLED), browser gagal (UNAVAILABLE), snapshot rusak (ERROR TOOL_FAILED), executable hilang (UNAVAILABLE TOOL_MISSING).

Audit khusus:

- Heuristic accuracy/false positives: satu FP ditemukan dan diperbaiki (nav). Dicatat sebagai batasan: heuristik "kartu berulang" hanya melihat struktur DOM. Daftar generik terbatas. `ux-duplicate-cta` hanya untuk button, sehingga tautan "Pelajari" yang berulang di ux-signals tidak dilaporkan (keputusan sengaja).
- Severity mapping: sesuai `RULE_CATALOG`; objective → FAIL, subjektif saja → WARN, tidak ada → PASS. Subjektif tidak pernah membuat FAIL.
- Evidence completeness: setiap temuan mereferensikan artefak snapshot; bila artefak gagal disimpan, temuan objektif turun ke LIKELY (diuji lewat `saveSnapshot` yang mengembalikan null, dan kode jalurnya).
- Rule version migration: `ruleVersion` disimpan per temuan; `UX_RULES_REGISTRY_VERSION` 1.0.0. Migrasi versi belum diimplementasikan (tidak ada versi kedua).
- Suppression: status `SUPPRESSED` + alasan; snapshot mentah tetap tersimpan (diuji).

Commands actually run:

- `npx vitest run packages/ux-rules` dengan `CHROMIUM_PATH=/tmp/chromium` — 36/36 lulus.
- `REQUIRE_BROWSER_TESTS=1 npx vitest run packages/ux-rules` — 36/36 lulus.
- `npx vitest run packages/ux-rules` tanpa `CHROMIUM_PATH` — 25 lulus, 11 dilewati.
- `npx tsc -p tsconfig.json --noEmit` — PASS. `npx eslint packages/ux-rules --max-warnings=0` — PASS.

Known limitations:

- Hanya satu halaman (`startPath`) per run; tidak ada crawling (low-resource).
- Tidak ada screenshot; evidence berupa snapshot DOM JSON.
- Lazy-load image yang belum dimuat tidak diperiksa oleh `ux-broken-image`.
- Teks alt tidak dinilai kualitasnya; daftar heading generik terbatas.

---

## T-110 — Gemini adapter

ID: T-110
Title: Gemini adapter
Status: VERIFIED
Depends on: T-010, T-020, T-030, T-060

Files: `packages/ai/src/providers.ts` (`GeminiClient`), `packages/ai/src/errors.ts`, `packages/ai/src/service.ts`, `packages/ai/tests/providers.test.ts`, `packages/ai/tests/service.test.ts`, `packages/ai/tests/live.optin.test.ts` (opt-in, dilewati).

Verifikasi dokumentasi resmi (diambil 2026-10-09):

- https://ai.google.dev/gemini-api/docs/rate-limits — RPM/TPM/RPD per proyek; kuota reset tengah malam Pacific; 429 `RESOURCE_EXHAUSTED`; spend-based limit untuk tier berbayar. Angka kuota per model TIDAK ditanam di kode.
- https://ai.google.dev/api/generate-content — hanya daftar isi yang terbaca (chunk 0–2). Path `models/{model}:generateContent` dan header `x-goog-api-key` BELUM dikonfirmasi dari halaman referensi. Ini risiko terbuka (R-AI-2) dan wajib diverifikasi ulang sebelum live test.
- Nama model pada banner dokumen: `gemini-3.8-flash` (dicatat di registry dengan sumber).

Acceptance criteria dan bukti:

- Adapter lolos fake-based tests: `GeminiClient` dengan fetch palsu, 11 tes di `providers.test.ts` (Gemini bagian).
- Capability mismatch ditolak: `route` mengembalikan `capability-mismatch` (tes matriks routing) dan permintaan gambar ditolak sebelum HTTP.
- Invalid key (401/403), 429, timeout: ditangani (AUTH_ERROR tanpa retry; RATE_LIMITED tanpa retry; TIMEOUT retryable).
- Secret tidak muncul di log/frontend: kunci hanya di header; tes memastikan kunci tidak ada di URL dan tidak ada di tabel usage; status pengaturan tidak memuat nilai kunci (T-180).
- Core tests tidak membutuhkan AI provider: `AI_PROVIDER=none` default, dan paket core/browser tidak mengimpor `@nusawebbench/ai`.

Negative tests (taskbook §12 T-110):

- missing key → `provider-key-missing` (tes service)
- blank model → `model-not-configured` (tes service)
- model tak dikenal (simulasi) → `model-not-allowlisted` dan 404 → `MODEL_UNAVAILABLE` (tes provider)
- 429 → `RATE_LIMITED` tanpa retry loop (tes service)
- 5xx → retryable terbatas (tes service: 3 percobaan untuk AI_MAX_RETRIES=2)
- malformed response → `INVALID_RESPONSE`
- prompt terlalu panjang → `input-too-long` (sebelum panggilan)
- image terlalu besar / MIME tidak didukung / terlalu banyak → `image-invalid` (sebelum panggilan)
- daily limit reached → `local-quota-exhausted`
- consent absent → `consent-missing`

Audit khusus:

- Semua HTTP call sites: hanya `send()` di `providers.ts`; `fetch` default hanya dipakai bila tidak diganti.
- Payload redaction: prompt diredaksi dengan `redactText` sebelum dikirim (tes: canary tidak muncul di body). Gambar TIDAK diredaksi (batasan; dicatat).
- Logging: tidak ada `console.log`/logger di paket AI; pesan error hanya kelas error.
- Parsing: respons dibatasi 1 MB; teks kosong dan output > 16.000 karakter ditolak; metadata usage rusak → null.
- Retry bounds: maksimum 3 percobaan (1 + min(AI_MAX_RETRIES, 2)); 429 tidak pernah diulang.

Live test: `packages/ai/tests/live.optin.test.ts` dilewati kecuali `AI_LIVE_TESTS=1`. Tidak dijalankan di sandbox (tidak ada akses jaringan ke Google dan tidak ada kunci) — status: BELUM DIJALANKAN.

---

## T-120 — Groq adapter

ID: T-120
Title: Groq adapter
Status: VERIFIED
Depends on: T-010, T-020, T-030, T-060

Files: `packages/ai/src/providers.ts` (`GroqClient`), `packages/ai/tests/providers.test.ts` (Groq bagian).

Verifikasi dokumentasi resmi (diambil 2026-10-09):

- https://console.groq.com/docs/api-reference — `POST https://api.groq.com/openai/v1/chat/completions`; `max_completion_tokens` (`max_tokens` deprecated); `n` hanya 1; `stream` default false; `response_format` json_object/json_schema tersedia.
- https://console.groq.com/docs/rate-limits — limit per organisasi; 429 `Too Many Requests`; `retry-after` hanya pada 429; header `x-ratelimit-*` ada pada setiap respons. Tabel angka per model TIDAK ditanam di kode (angka berubah).
- Header `Authorization: Bearer` mengikuti konvensi OpenAI-compatible; tidak tercantum pada bagian yang diambil. Dicatat sebagai risiko R-AI-2 bersama Gemini.

Acceptance criteria dan bukti:

- Unit tests tidak memakai key nyata: fetch palsu, kunci uji `gsk_TEST`/placeholder.
- 429 tidak menyebabkan loop: tes service (1 panggilan) dan provider (tanpa retry).
- Unsupported capabilities tidak dipanggil: `json` dan `image` = false pada registry Groq; tes routing `STRUCTURED_REMEDIATION` untuk groq-only → `capability-mismatch`.
- Limit lokal ditegakkan saat restart dan antar-route: tes restart (store dibuka ulang) dan tes budget guard terpusat (satu instance `BudgetGuard` per `AiService`).
- Key tidak bocor: kunci hanya di header, tidak di URL, tidak di tabel usage.

Negative tests:

- 429 dengan dan tanpa Retry-After (tes provider), header invalid (`x-ratelimit-remaining-tokens: banyak` → null)
- model unavailable (404), auth error (401), malformed JSON, timeout, local limit reached, empty/long response (semua di tes)

Audit khusus: parser rate-limit (header angka valid saja dicatat), jadwal retry (tidak ada retry untuk 429), error mapping (`classifyHttpStatus`), key redaction (kunci tidak pernah dikembalikan).

Live test: sama dengan T-110 (`AI_LIVE_TESTS=1`), BELUM DIJALANKAN.

---

## T-130 — AI router, capability registry, dan free-tier lock

ID: T-130
Title: AI router, capability registry, dan free-tier lock
Status: VERIFIED
Depends on: T-110, T-120

Files: `packages/ai/src/registry.ts`, `packages/ai/src/guard.ts`, `packages/ai/src/service.ts`, `packages/storage/src/repositories.ts` (`countRequestsSince`), `packages/ai/tests/service.test.ts`.

Keputusan:

- Default `AI_PROVIDER=none`; fallback default off (`AI_FALLBACK_ENABLED=false`).
- Registry model: `freeTierAllowlisted: false` untuk semua entri bawaan karena kelayakan free tier per model belum diverifikasi di sandbox. Akibatnya dengan `FREE_TIER_LOCK=true` (default) tidak ada model yang bisa dipakai sampai pemilik memverifikasi dan mengubah registry. Ini disengaja.
- Tidak ada fallback ke model tanpa kapabilitas gambar; `VISUAL_REVIEW` selalu `capability-mismatch` dengan registry bawaan (tidak ada model yang terverifikasi gambar).
- Fallback hanya saat routing (primary tidak tersedia), bukan saat provider gagal di tengah jalan (menghindari panggilan ganda yang tidak terkendali).
- `FREE_TIER_LOCK=false` dengan AI aktif ditolak oleh `loadConfig` (T-020); tes memakai lock aktif.
- Budget guard terpusat: `BudgetGuard.reserve` memeriksa dan mencadangkan dalam satu langkah sinkron. Hitungan persisten dari `provider_usage` (bertahan restart) ditambah reservasi memori. Reservasi yang hilang saat crash tidak tercatat (R-AI-3).
- Bucket kuota lokal = tanggal UTC. Ini penghitung aplikasi, bukan kuota provider.
- Temuan AI tidak pernah CONFIRMED: `aiFindingVerification` (tes).

Acceptance criteria dan bukti:

- Routing matrix diuji: `route()` untuk empat task × provider (tes "matriks routing" dan "matriks: setiap task").
- Provider off bekerja: `AI_PROVIDER=none` → `provider-disabled`, tanpa panggilan.
- Budget enforcement lintas pemanggil: satu `BudgetGuard` per service; semua jalur melalui `AiService.run` (tidak ada pemanggil lain ke provider di repo; diverifikasi lewat grep, lihat audit).
- Fallback hanya sesuai config: tes fallback dicatat (`fallbackFrom`) hanya saat `AI_FALLBACK_ENABLED=true`.
- Output tidak memalsukan hasil: `aiFindingVerification`.

Negative tests:

- invalid model config (blank, tak dikenal) — ada
- model capability mismatch — ada
- quota exhausted — ada
- two simultaneous calls at local quota boundary — ada (tepat satu yang mengirim request)
- provider disabled — ada
- consent missing — ada
- invalid usage metadata — ada (token null, jawaban dipakai)

Audit khusus:

- Call sites: satu-satunya pemanggilan `ProviderClient.generate` ada di `AiService.run`. Pemanggilan lain ke `fetch` untuk provider: tidak ada.
- Bypass path: `testConnection` juga melewati `run`.
- Race kuota: dibuktikan dengan dua `Promise.all` pada batas kuota.
- Telemetry accuracy: `estimatedCost` selalu null (tidak ada tabel harga yang diverifikasi); `estimatedTokens` dilabeli estimasi lokal; token provider hanya bila diberikan.

Known limitation: reservasi memori tidak bertahan saat crash; per-run cap juga in-memory (`perRun`).

---

---

## T-140 — Dashboard MVP dan API routes

ID: T-140
Title: Dashboard MVP dan API routes
Status: VERIFIED
Depends on: T-030, T-040, T-050, T-060, T-080

Files: `packages/web/src/app.ts` (rute, validasi, mapping error), `packages/web/src/http.ts` (batas body, Host/Origin, header keamanan), `packages/web/src/server.ts` (bind loopback saja), `packages/web/src/pages.ts` (HTML/CSS/JS statis tanpa innerHTML), `packages/web/src/main.ts` (composition root; `npm run web`), `packages/web/tests/api.test.ts` (55 tes API + e2e), `packages/web/tests/ui.test.ts` (2 tes UI Chromium).

Keputusan:

- Server hanya bind ke loopback; alamat lain ditolak sebelum `listen` (`assertLoopbackBind`). Ini berarti preview publik sandbox tidak dapat mengakses dashboard secara langsung (R-WEB-1).
- Host harus `127.0.0.1` atau `localhost` (anti DNS rebinding). Origin untuk metode yang mengubah state harus sama dengan Host; Sec-Fetch-Site lintas-situs ditolak.
- Dashboard MVP menyediakan tiga modul: `FUNCTIONAL_QA`, `UX_RULES`, `LIGHTHOUSE`. `LOAD_K6`, `SECURITY_STRIX`, dan modul AI belum disambungkan dan mengembalikan 422 `MODULE_NOT_AVAILABLE`.
- Pembuatan run melalui `RunOrchestrator.createRun` (satu sumber aturan plan, otorisasi, dan idempotensi). Dashboard tidak menduplikasi logika itu.
- Target mode `url` (remote) dengan modul berbasis browser diblokir oleh `buildRunPlan`. Perbaikan selama T-140: `UX_RULES` ditambahkan ke `REMOTE_NOT_ENFORCEABLE_MODULES` karena memakai Chromium yang sama dan DNS pinning belum dapat dijamin (sesuai keputusan T-040 tentang modul browser).
- Tidak ada jalur konfirmasi scope terpisah: `scopeConfirmedAt` tidak pernah diisi di kode, sehingga persetujuan per run (`acknowledged: true`) dan preview plan menjadi gerbang yang berlaku.
- Idempotency-Key disimpan di memori (sesuai T-050). Restart proses menghapusnya (R-WEB-2).
- Artefak diunduh hanya lewat ID (`evd_<32 hex>`), tidak pernah lewat path. Respons `attachment`, `nosniff`, dan CSP `sandbox`.
- Respons run dan temuan tidak memuat path penyimpanan atau nilai rahasia; status AI hanya `keyConfigured`.

Acceptance criteria dan bukti:

- End-to-end local audit berjalan: `e2e ... run UX_RULES + FUNCTIONAL_QA pada fixture: selesai, temuan, laporan, dan unduhan artefak aman` (Chromium nyata, fixture `ux-signals`; run COMPLETED, temuan ≥5 termasuk `ux-horizontal-overflow`).
- Error state jelas: kode dan pesan aman (`{ error, message }`), tanpa stack trace.
- External AI off masih lengkap: tes e2e dijalankan dengan `AI_PROVIDER=none` (default).
- Rute menolak input malformed/oversize: 400/413/415 (tes).
- Keyboard basic test: `navigasi keyboard: Tab pertama mencapai tautan lewati ...` (Chromium nyata).
- Halaman memuat tanpa error konsol: `memuat tanpa error konsol; status berubah menjadi siap`.
- Build dan start dari `dist`: `npm run build --workspaces` lulus; `node packages/web/dist/main.js` menjawab `/api/health` dan halaman (diuji dengan curl di loopback).

Negative tests (taskbook §12 T-140):

- invalid body (400), oversize response/body (413), arbitrary artifact path (400 untuk encoded slash; 404 untuk `..` karena klien menormalkannya), double-submit (Idempotency-Key sama → run sama), canceled run (QUEUED → CANCELLED), secret display (tidak ada nilai kunci di respons), XSS strings in findings (disimpan dan dikembalikan sebagai JSON; UI merender sebagai teks, diuji di Chromium), API call from unexpected origin (403).
- Tambahan: over-posting (`scopeConfirmedAt`, `freeTierLock` ditolak), Host asing (403), Content-Type salah (415), metode salah (405), bind non-loopback ditolak (CONFIG_INVALID).

Audit khusus:

- Route authorization/local binding: semua rute melewati `checkHostAndOrigin`; tidak ada rute tanpa pemeriksaan Host.
- Frontend state transitions: polling 2 detik hanya saat run belum terminal; pembatalan dan pembuatan laporan dibatasi oleh status.
- XSS: `innerHTML` tidak dipakai (diuji sebagai string pada `APP_JS`); semua data masuk lewat `textContent`.
- API error leakage: kesalahan tak terduga → 500 `INTERNAL` generik.
- Accessibility: setiap input berlabel, `aria-live` untuk status, tautan lewati, fokus terlihat (`:focus-visible`), status berupa teks.

Known limitations:

- Dashboard tidak menyajikan TLS dan tidak punya autentikasi (model aplikasi lokal). Jangan diekspos ke jaringan.
- Tidak ada pagination pada daftar target (batas 100).
- Laporan dibuat sinkron; ukuran dibatasi `saveReport`.

---

## T-180 — Provider settings, usage, privacy controls

ID: T-180
Title: Provider settings, usage, privacy controls
Status: VERIFIED
Depends on: T-110, T-120, T-130, T-140

Files: `packages/ai/src/settings.ts` (`AiSettingsService`, `SettingsUpdateSchema`), rute `/api/settings`, `/api/settings/reset-counters`, `/api/providers/status`, `/api/providers/test` di `packages/web/src/app.ts`, dan `packages/ai/tests/settings.test.ts`.

Keputusan:

- API key tidak pernah disimpan di SQLite dan tidak pernah dikembalikan. Status hanya `keyConfigured`.
- Pengaturan yang dapat diubah lewat UI/API: consent data eksternal dan tingkat redaksi. `freeTierLock`, provider, dan izin operator hanya dari environment; schema `strict` menolak kunci lain.
- Reset penghitung lokal menyimpan baseline waktu; riwayat `provider_usage` tetap utuh. Notice menyatakan bahwa ini tidak mereset kuota provider.
- Model dengan verifikasi lebih dari 90 hari menampilkan peringatan usang.
- Uji koneksi hanya berjalan atas aksi pengguna (`confirm: true`) dan melewati semua gerbang yang sama.

Acceptance criteria dan bukti:

- Key tidak dikembalikan ke UI: `status tidak pernah memuat nilai kunci` (tes settings) dan `status provider tidak pernah memuat nilai kunci` (tes API).
- Local usage persisten: `kuota bertahan setelah restart` (tes service).
- Opt-in dipatuhi di semua rute: semua panggilan AI melalui `AiService.run`, yang memeriksa consent (dan `testConnection` memakai `run`).
- Free-tier lock terpusat: `FREE_TIER_LOCK=true` diperiksa di routing; UI tidak punya kontrol untuk itu (tes over-posting).
- Request quota exhausted terhenti: `local-quota-exhausted` (tes).

Negative tests (taskbook §12 T-180):

- restart app: tes restart (kuota tetap habis)
- concurrent usage requests: tes dua panggilan bersamaan pada batas
- consent revoked: `consent-missing` setelah dicabut
- malformed settings: 400 (tes)
- UI/API config mismatch: over-posting `freeTierLock` ditolak 400
- missing key: `provider-key-missing`
- stale model verification: peringatan usang (tes settings dengan tanggal 2027)

Audit khusus:

- Secrets: tidak ada nilai kunci di respons, tabel usage, atau body yang dikirim selain header provider (tes canary).
- Persistent counters: `provider_usage` dengan `countRequestsSince` (storage, ditambahkan di T-130).
- Settings authorization: `PUT /api/settings` hanya menerima dua kunci.
- Reset semantics: diuji bahwa riwayat tetap.

Known limitation: UI untuk "model config" dan "capability info" hanya menampilkan status dari environment dan registry; pengubahan model dilakukan lewat environment (`GEMINI_MODEL`, `GROQ_MODEL`).

---

---

## T-150 — k6 adapter dan safety gates

ID: T-150
Title: k6 adapter dan safety gates
Status: VERIFIED
Depends on: T-040, T-050, T-060, T-070, T-140

Files: `packages/load-k6/` (`src/k6.ts`, `tests/k6.test.ts`: 20 tes dengan executable palsu + 4 tes nyata opt-in `K6_BIN`), `scripts/build-k6-verified.sh` (membangun binary dari sumber tag resmi, di luar Git).

Binary yang diuji dan provenansinya:

- Versi: k6 v2.3.0 (rilis GitHub 2026-09-21). Digest resmi aset `k6-v2.3.0-linux-amd64.tar.gz` dari API GitHub: sha256 `39c3117b…`. Aset tidak diunduh karena `objects.githubusercontent.com` di luar allowlist.
- Tag `v2.3.0` menunjuk ke commit `e0887846143ab176d4b5483c9d52cf3b3e009f1a` (API `git/tags` dan `git clone --branch v2.3.0` dari github.com; keduanya cocok).
- Dibangun dari sumber dengan `go build -trimpath` dan `GOFLAGS=-mod=vendor` (dependensi ada di `vendor/` dalam commit tersebut, tanpa proxy modul). Output: `k6 v2.3.0 (commit/e088784614, go1.27.2, linux/amd64)`.
- Toolchain Go 1.27.2 diambil dari wheel PyPI `go-bin` 1.27.2 (manylinux x86_64, sha256 `202ee8e0…` cocok dengan digest yang dicatat PyPI). Ini pihak ketiga dan belum diverifikasi terhadap go.dev (risiko R-K6-1).
- Build diulang dari awal dengan `scripts/build-k6-verified.sh` dan menghasilkan versi yang sama.
- Wheel PyPI `k6` 1.1.0 TIDAK digunakan. Pengarang dan homepage tidak tercantum, dan versinya tidak sama dengan v2.3.0.

Hasil tes nyata (`K6_BIN=/tmp/k6verify/k6 npx vitest run packages/load-k6` → 24 lulus, 0 dilewati; dijalankan dua kali berturut-turut, dan juga di dalam `npm run check` dengan `K6_BIN` terpasang):

- Fixture lokal `clean`, preset `fixed-smoke`: PASS dengan `observedRequests` > 0 dari ringkasan k6 nyata.
- Server error (500 untuk setiap request): FAIL karena threshold `http_req_failed`, `failedRate` > 0,9. Bukan PASS.
- Overload (server membalas setelah 7 detik, melewati timeout request k6 5 detik): FAIL, `failedRate` > 0,9.
- Pembatalan setelah 1,5 detik: ERROR `CANCELLED`, dan tidak ada proses k6 `run` yang tertinggal (dicek dengan `ps` pada path K6_BIN).

Kriteria penerimaan:

- Tes fixture lokal lulus dengan k6 nyata: terpenuhi.
- Batas VU, rate, durasi, dan total request tidak bisa dilewati: terpenuhi. Skema membatasi nilai (integer, maks VU 2, maks rate 5/detik, maks durasi 30 detik, `rate × durasi` ≤ 100). Tes batas dan overflow lulus.
- Remote memerlukan konfirmasi: terpenuhi. Tanpa acknowledgement → SKIPPED. Dengan acknowledgement → SCOPE_DENIED, karena MVP tidak mengizinkan remote untuk LOAD_K6.
- Cancellation menghentikan k6: terpenuhi (tes nyata dan palsu).
- Parser tidak mengarang metrik: terpenuhi. Metrik yang tidak ada di ringkasan tidak diisi.

Negative tests yang diwajibkan taskbook:

- Out-of-scope / remote: SKIPPED atau SCOPE_DENIED (tes `target remote ...`), scope dicek ulang sebelum spawn.
- Invalid VU, rate, durasi; integer overflow: ditolak (tes `VU, rate, dan durasi di luar batas`).
- Shell injection dan traversal pada path: ditolak (tes path).
- JS injection: nilai hanya masuk script lewat `JSON.stringify` dari nilai tervalidasi (tes script).
- Tool missing: UNAVAILABLE `TOOL_MISSING`.
- Cancellation: tes nyata dan palsu.
- Malformed JSON atau summary rusak: ERROR `TOOL_FAILED`, tanpa metrik yang dikarang.
- Server error dan overload: tes nyata (lihat di atas).

Audit khusus:

- Generated test script: hanya nilai tervalidasi, serialisasi `JSON.stringify`.
- Process args: array, `shell: false`, lingkungan minimal tanpa rahasia (tes canary).
- Numeric bounds: skema zod dengan batas keras dan tes overflow.
- Kill switch: SIGTERM, lalu SIGKILL setelah 2 detik bila proses belum keluar. Hasil cancelled/timeout dikembalikan hanya setelah proses keluar (perubahan sesi ini).
- Remote scope path: dua gerbang (`buildRunPlan` dan adapter) plus pengecekan scope sebelum dan sesudah spawn.
- Total request cap: `rate × durasi` ≤ 100, dicek di skema.

Perubahan pada sesi verifikasi ini:

- Threshold sekarang `abortOnFail` dengan `delayAbortEval` 1 detik. Ini stop condition yang benar-benar menghentikan run, bukan hanya penilaian di akhir. Server error berhenti lebih cepat (tes server error selesai ±2 detik, sebelumnya ±3 detik).
- Snapshot kondisi test (simulasi, preset, batas, stop condition, `plannedRequests`) disimpan di hasil modul dan ditampilkan di laporan (taskbook T-150 instruksi 9). Sebelumnya laporan tidak menyebut kondisi ini (tes `kondisi test pada laporan`).
- Dugaan awal "proses yatim" pada tes pembatalan nyata ternyata kesalahan pendeteksi. Perintah shell sandbox yang memuat teks `summary-export` ikut terhitung. Pendeteksi kini mencocokkan executable K6_BIN. Pengukuran langsung: k6 keluar sekitar 0,02 detik setelah SIGTERM. Tidak ditemukan proses yatim. Perubahan menunggu proses keluar adalah pengerasan, dan sekarang dijaga oleh tes.

Batasan:

- Hanya k6 v2.3.0 yang diuji. Versi lain belum diuji (format ringkasan dan output `k6 version` bisa berbeda).
- "Overload" diuji sebagai server yang melewati timeout request. Beban besar tidak diuji, dan memang dicegah oleh batas budget.
- Stop condition berbasis threshold dan durasi scenario. Belum ada stop berbasis jumlah error absolut.
- Remote tidak diizinkan pada MVP, sesuai taskbook dan README.
- Dashboard belum menyambungkan LOAD_K6 (422 `MODULE_NOT_AVAILABLE`).
- Binary tidak disimpan di repository.

---

## T-160 — Strix adapter

ID: T-160
Title: Strix adapter
Status: EXECUTED
Depends on: T-040, T-050, T-060, T-070

Files: `packages/security-strix/` (`src/strix.ts`, `tests/strix.test.ts`, 8 tes).

Sumber (diambil 2026-10-09): https://github.com/usestrix/strix — berjalan di container (Docker), lisensi Apache-2.0, rilis terakhir push 2026-10-08. Contoh konfigurasi default memakai OpenRouter, bukan Gemini/Groq.

Yang sudah dibuktikan (8 tes lulus):

- `STRIX_ENABLED=false` default (SKIPPED `strix-disabled`).
- Lokal saja: target remote → SCOPE_DENIED.
- Preflight Docker: Docker tidak ada atau daemon mati → UNAVAILABLE `docker-unavailable` (tes dengan executable palsu).
- Kunci provider hilang → UNAVAILABLE; model tak dikenal, belum free-tier, atau tanpa kapabilitas teks → ditolak.
- Konfigurasi di luar batas (runtime > 600 detik, provider `openrouter`) ditolak.
- Semua gerbang lolos tetap UNAVAILABLE `strix-runner-contract-unverified`: adapter tidak pernah memindai.

Yang BELUM dibuktikan (BLOCKED):

- Runner Strix dan parser output belum diimplementasikan. Kontrak CLI/format output harus diverifikasi terhadap versi aktual, dan itu membutuhkan Docker (tidak tersedia di sandbox).
- Tes SL-01 pada `security-lab` tidak dijalankan. Kompatibilitas Gemini/Groq dengan Strix belum dibuktikan.

Verifikasi ulang (2026-10-09, sesi lanjutan):

- Docker tetap tidak tersedia di sandbox (`docker: command not found`). Runner Strix tidak dapat dibangun atau diverifikasi terhadap CLI aktual.
- Tidak ada perubahan kode pada adapter Strix di sesi ini. Gerbang dan 8 tes tetap seperti sebelumnya.
- Status tetap EXECUTED (BLOCKED untuk bagian runner dan tes SL-01). Bukti yang dibutuhkan: Docker di mesin lokal, versi Strix yang dipin, dan kompatibilitas provider yang dibuktikan dengan tes opt-in.

Verifikasi ulang (2026-10-09, sesi verifikasi ketiga):

- Docker: tidak tersedia. `download.docker.com` (sumber binary Docker) tidak dapat dijangkau (HTTP 000), dan repositori apt (`archive.ubuntu.com`) juga tidak dapat dijangkau. Sandbox memiliki sudo tanpa password, tetapi tanpa sumber paket Docker yang diizinkan, sudo tidak berguna.
- Strix: paket PyPI `strix-agent` 1.7.0 ditemukan dan mensyaratkan Python ≥3.12. Sandbox hanya memiliki Python 3.11.2 (`/usr/bin/python3.11`). Tidak ada uv atau pyenv, dan sumber CPython 3.12 yang diizinkan tidak tersedia.
- Provider: tidak ada kunci OpenRouter, Gemini, atau Groq untuk smoke test. Kompatibilitas provider tidak bisa dibuktikan tanpa panggilan nyata (taskbook T-160 instruksi 4).
- Runner dan parser tidak diimplementasikan. Mengimplementasikannya tanpa CLI nyata berarti mengarang kontrak output, dan itu dilarang oleh taskbook.
- Jaringan ke provider diperiksa (2026-10-09): `openrouter.ai`, `generativelanguage.googleapis.com`, dan `api.groq.com` tidak dapat dijangkau dari sandbox (HTTP 000). Smoke test Strix dan bukti kompatibilitas provider tidak bisa dihasilkan di sandbox ini, terlepas dari ada atau tidaknya kunci.
- Versi Strix terbaru: v1.7.0 (GitHub release, 2026-10-05). PyPI `strix-agent` 1.7.0 mensyaratkan `requires_python >=3.12`. Dependensi utama termasuk `docker>=7.1.0` dan `litellm>=1.101.0`.
- Status tetap EXECUTED (BLOCKED). Untuk VERIFIED dibutuhkan di mesin pemilik: Docker daemon, Python ≥3.12, Strix versi dipin, kunci provider dengan budget dan akses jaringan ke provider, runner dan parser berdasarkan output CLI aktual, dan tes SL-01 opt-in pada `security-lab`.

### Pembaruan 2026-10-09 — runner Strix dan workflow manual (commit 583d716)

Yang sudah diimplementasikan (kode, bukan bukti pemindaian):

- `packages/security-strix/src/runner.ts`: argumen non-interaktif (`--non-interactive`, `--target`, `--scan-mode`, `--max-budget-usd`, `--max-turns`), environment minimal (tanpa variabel induk selain PATH dan DOCKER_HOST; `STRIX_TELEMETRY=false`, `STRIX_NO_UPDATE_CHECK=1`, `STRIX_LLM`, `LLM_API_KEY`), eksekusi dengan timeout dan pembatalan yang membunuh process group, serta parser `run.json` dan `vulnerabilities.json` dengan validasi zod.
- `packages/security-strix/src/strix.ts`: gerbang tambahan. `strixBin` wajib dikonfigurasi eksplisit (tidak ada pencarian di PATH), `strix -v` harus `strix 1.7.0`, status run harus `completed`, dan exit 2 hanya boleh muncul bila ada temuan. Temuan Strix dipetakan sebagai `verification: LIKELY`, `source: AI`, dan status modul WARN. PASS hanya berarti "run selesai tanpa temuan", bukan jaminan keamanan.
- `.github/workflows/strix-integration.yml`: `workflow_dispatch` saja, `permissions: contents: read`, `ubuntu-latest`, timeout 60 menit, Python 3.12, Strix dipasang `==1.7.0` dalam venv, image sandbox `ghcr.io/usestrix/strix-sandbox:1.3.0` ditarik. Input `run_scan` default `false`. Secret `STRIX_GEMINI_API_KEY` hanya masuk ke step integrasi nyata, dan step itu gagal tertutup bila secret kosong.
- Registry: `gemini-3.8-flash` ditandai `freeTierAllowlisted: true`. Dasar: tabel harga resmi Gemini (dibaca 2026-10-09) mencantumkan Free Tier "Free of charge" untuk input dan output. Catatan dari halaman yang sama: pada free tier, "Used to improve our products" = Yes, sehingga input tidak boleh berisi data pengguna nyata. `openai/gpt-oss-20b` (Groq) tetap `false`.

Klasifikasi bukti (wajib dibaca bersama status):

- Tes simulasi: `runner.test.ts` (11 tes) dan `strix.test.ts` (9 tes) memakai biner palsu yang meniru kontrak CLI. Lulus di `npm run check` (commit 583d716). Ini menguji wiring, parser, timeout, pembatalan, dan redaksi. Ini TIDAK membuktikan bahwa Strix memindai apa pun.
- Integrasi nyata: `strix.real.optin.test.ts` dilewati kecuali `STRIX_REAL_TEST=1`, `STRIX_BIN`, dan `STRIX_GEMINI_API_KEY` terpasang. Belum pernah dijalankan dengan Strix sungguhan.
- Blocker lingkungan (kondisi per 2026-10-09):
  1. `workflow_dispatch` mengembalikan HTTP 404 pada branch sesi. GitHub hanya mengenali file workflow dispatch dari branch default (`main`). Menjalankan workflow manual memerlukan file ini di `main`, dan itu butuh otorisasi pemilik.
  2. Python 3.12 tidak dapat dipasang di sandbox. `uv python install 3.12` gagal karena `github.com` menolak koneksi, dan sandbox hanya memiliki Python 3.11.2.
  3. Docker tidak tersedia di sandbox.
  4. Secret `STRIX_GEMINI_API_KEY` tidak dapat dipastikan keberadaannya dari sandbox (`gh secret list` HTTP 403).
  5. Provider LLM tidak terjangkau dari sandbox (HTTP 000).
- Batasan yang tersisa: tidak ada bukti Strix nyata. Kompatibilitas `gemini/gemini-3.8-flash` dengan Strix (LiteLLM) belum diuji. Kuota free tier (RPM/TPM/RPD) dapat menyebabkan 429 di tengah run, dan hasilnya akan menjadi ERROR, bukan PASS. Pinning Python dependensi belum memakai hash. Mekanisme forwarder `socat` ke gateway bridge Docker belum diuji.

Status: T-160 tetap EXECUTED (BLOCKED untuk integrasi nyata). Tidak ada klaim VERIFIED.

---

## T-170 — Before/after comparison dan remediation proposals

ID: T-170
Title: Before/after comparison dan remediation proposals
Status: VERIFIED
Depends on: T-060, T-080, T-090, T-100, T-140

Files: `packages/compare/` (`src/compare.ts`, `src/patch.ts`, `tests/compare.test.ts`, 23 tes).

Bukti (`npx vitest run packages/compare` → 23 lulus; clean clone `91df536` pada Node v24.21.0 → `npm run check` lulus):

- Perbandingan: kunci temuan `ruleId|selector|targetUrl`. Temuan hilang dengan bukti sah → FIXED_VERIFIED. Tanpa bukti (modul ERROR/UNAVAILABLE) → FIXED_UNVERIFIED. Temuan baru → REGRESSION bila sebanding.
- Tidak comparable (origin atau viewport berbeda) → blocker (`comparable: false`). Versi alat/aturan atau konfigurasi berbeda → warning, dan klaim diturunkan ke LIKELY/FIXED_UNVERIFIED. Tabel perbedaan ditampilkan lewat `blockers` dan `warnings`.
- Baseline dan tes sebelum/sesudah (`91df536`): `runChecksAtBase` menjalankan cek di revisi dasar pada worktree sementara, lalu worktree dibuang. `runPostPatchChecks` menjalankan cek di worktree patch.
- Verdict tes setelah patch: `PASSED` hanya bila ada minimal satu cek dan semuanya `PASSED`. Selain itu `NOT_VERIFIED`. Status per cek: `PASSED`, `FAILED` (exit code), `TIMEOUT` (SIGKILL), `ERROR` (executable tidak ada atau gagal dijalankan).
- Keamanan cek: argv terstruktur tanpa shell, lingkungan minimal tanpa rahasia, timeout maksimum 600 detik, maksimum 10 cek, keluaran diredaksi dan dipotong 2000 karakter. Definisi cek tidak valid ditolak sebelum berjalan.
- Record proposal (`buildProposalRecord`): base revision, `initialWorkingTreeClean: true`, changedFiles, SHA-256 diff, testsBefore, testsAfter, `approval: 'PENDING'`, `applied: false`. Tidak ada merge, commit, atau apply.
- Patch: repo kotor ditolak (CONFLICT). Path absolut, `..`, `.git`, dan backslash ditolak. Revisi dasar tidak valid ditolak. Diff yang memuat pola rahasia ditolak dan worktree dibuang. Repo pengguna tidak berubah. Rollback menghapus worktree.
- Guidance berbasis URL hanya menyusun teks dan tidak mengirim request.

Negative tests yang diuji:

- Uncommitted user changes → CONFLICT (repo tidak berubah).
- Git tidak tersedia (PATH kosong) → TOOL_FAILED; repo tidak berubah.
- Worktree gagal dibuat (revisi tidak ada) → TOOL_FAILED.
- Partial patch (penulisan file kedua gagal setelah file pertama tertulis) → TOOL_FAILED; worktree dibuang; repo utuh. Temuan saat audit: kegagalan tulis sebelumnya tidak terpetakan ke error terstruktur. Sekarang dipetakan ke TOOL_FAILED.
- Tes gagal setelah patch → `NOT_VERIFIED`, status FAILED dengan exit code.
- Timeout cek → TIMEOUT; proses dibunuh.
- Executable tes hilang → ERROR; bukan PASSED.
- Path di luar repo root → VALIDATION_FAILED sebelum apa pun berjalan.
- Secret ditambahkan lewat diff → VALIDATION_FAILED; worktree dibuang.
- Perubahan lingkungan → diwakili oleh perbandingan versi/konfigurasi (warning). Tidak ada pengukuran ulang lingkungan saat patch.

Yang tidak termasuk dan dicatat sebagai batasan:

- Tidak ada UI dashboard untuk perbandingan atau proposal. Fitur ini tersedia sebagai library.
- Tidak ada alur persetujuan manusia yang tersimpan di sistem. Approval hanya tercatat `PENDING` pada record. Penerapan patch ke repo pengguna belum ada dan tidak akan dilakukan tanpa persetujuan terpisah.
- "Security checks" setelah patch adalah perintah yang ditentukan pemanggil. Tidak ada pemindai bawaan.
- Cek pasca-patch menjalankan kode dari repository di dalam worktree (misalnya `npm test`). Ini hanya aman untuk repository yang dipercaya pemiliknya. Proses tidak diisolasi di level OS.
- `FIXED_VERIFIED` bergantung pada bukti baseline yang sebanding. Tidak ada otomatisasi yang menghasilkan bukti sebelum patch di UI.

---

## T-200 — Low-resource behavior, reliability, dan cleanup

ID: T-200
Title: Low-resource behavior, reliability, dan cleanup
Status: VERIFIED
Depends on: T-050, T-060, T-080, T-090, T-140, T-150, T-160

Bukti:

- Retention artefak (`packages/storage/src/retention.ts`, tes `packages/storage/tests/retention.test.ts`, 9 tes):
  - `previewRetention` hanya merencanakan dan tidak menghapus apa pun. Batas umur 1 sampai 3650 hari. Maksimum 500 kandidat per preview, dengan flag `truncated`.
  - Run RUNNING dan QUEUED dilewati (`run-active`). Run yang tidak ada dilewati (`run-missing`).
  - `applyRetention` menolak konfirmasi yang tidak cocok dengan `planId` dan rencana yang diubah (`VALIDATION_FAILED`). Ini diuji dengan kandidat yang disisipkan.
  - Apply memverifikasi ulang tiap kandidat (metadata, sha256, path) dan melewati yang berubah (`changed-since-preview`).
  - Apply menghapus byte berkas dan mempertahankan metadata evidence. Pembacaan berikutnya gagal dengan aman (`missing-file`).
  - Symlink di dalam root yang menunjuk keluar root ditolak (`path-rejected`). Berkas di luar root tetap utuh.
- Batas sumber daya yang sudah ada dan diuji: artefak 50 MiB (`PAYLOAD_TOO_LARGE`), batas laporan, batas body API 16 KB, batas respons provider AI 1 MB, batas output AI 16.000 karakter, dan `MAX_PROGRESS_ENTRIES` 2000.
- Satu run aktif (run kedua berstatus QUEUED sampai run pertama selesai). Modul berjalan berurutan dengan satu browser context per modul browser.
- Cancel dan timeout: k6 membunuh proses (SIGTERM lalu SIGKILL) dengan tes PID tidak hidup lagi. Browser: timeout, crash, dan cancel menghasilkan ERROR yang sesuai (`packages/browser-qa/tests/negative.test.ts`, dijalankan dengan Chromium 153 pada sandbox dan di CI browser job). Worktree sementara dibuang saat rollback dan saat `runChecksAtBase` selesai.
- Laporan untuk run yang dibatalkan (`packages/report/tests/report.test.ts`): run CANCELLED dengan modul CANCELLED menghasilkan laporan valid dan tidak ada PASS palsu.
- Diagnostik lokal `GET /api/diagnostics` (disk, DB, tool) tanpa telemetri. Tidak memuat rahasia.
- Kebersihan tes: `packages/storage/tests/storage.test.ts` sebelumnya meninggalkan direktori `nwb-db-*` di tmp. Sekarang dihapus pada `afterEach`.
- Gerbang sesi ini (`91df536` plus perubahan dokumentasi): `npm run check` lulus. Suite penuh dengan `CHROMIUM_PATH=/tmp/chromium REQUIRE_BROWSER_TESTS=1 NWB_CHROME_NO_SANDBOX=1` (Chromium 153): 529 lulus, 2 dilewati (tes k6 nyata dan live AI, opt-in).

Batasan (dicatat):

- Retention hanya tersedia sebagai library. Belum ada tombol di dashboard atau perintah CLI. Preview tersedia lewat `previewRetention`.
- Skenario disk penuh (ENOSPC) tidak disimulasikan. Taskbook menyebutnya "jika memungkinkan". Penulisan terputus disimulasikan lewat hook `beforeCommit` (`packages/storage/tests/artifacts.test.ts`) dan tidak meninggalkan berkas yatim.
- Berkas `.tmp-*` yatim akibat crash keras proses (bukan kegagalan tulis yang tertangkap) tidak dibersihkan oleh retention. Belum ada mekanisme untuk itu.
- Retention tidak menghapus metadata evidence. Laporan yang merujuk artefak yang sudah dihapus akan menampilkan berkas hilang.
- Benchmark resource lokal tidak dilakukan. Tidak ada angka performa yang diklaim.

---

## T-190 — Security hardening dan threat-model verification

ID: T-190
Title: Security hardening dan threat-model verification
Status: VERIFIED
Depends on: T-040 sampai T-180 (bagian yang tersedia)

Files: `SECURITY.md` (cakupan, pelaporan, batasan, prosedur uji aman, tabel ancaman → kendali → bukti), `docs/decisions/ADR-0005-dashboard-loopback-and-api-security.md`, perubahan `packages/lighthouse/src/lighthouse.ts` (`--no-sandbox` opt-in) dan `packages/lighthouse/tests/flags.test.ts`, `scripts/secret-scan.mjs` (perbaikan false positive).

Audit yang dijalankan (2026-10-09):

- Secrets: `node scripts/secret-scan.mjs` → findings=0 (setelah perbaikan false positive referensi properti; literal rahasia sungguhan tetap terdeteksi, diuji dengan berkas sementara).
- innerHTML / dangerouslySetInnerHTML di kode server: tidak ada. Hanya string JS di `pages.ts` yang diuji tidak memuat `innerHTML`.
- SQL: satu `db.exec` dengan template di `migrations.ts`, interpolasi hanya konstanta dari `constants.ts` (bukan input pengguna).
- Proses anak (`child_process`): hanya `compare/patch.ts` (git), `load-k6/k6.ts` (k6), `security-strix/strix.ts` (docker). Semua `execFile`/`spawn` dengan argumen array dan tanpa shell.
- `fetch` sisi server: hanya di klien provider AI, melalui `fetchImpl` yang dapat diganti.
- Scope guard: semua adapter yang menjangkau jaringan memanggil `checkUrlInScope` atau memasang route guard (browser-qa, ux-rules, lighthouse, load-k6, security-strix).
- Dependensi: `npm audit --omit=dev` → 0 kerentanan (2026-10-09).
- Lisensi dependensi produksi (120 paket): MIT 66, Apache-2.0 22, BSD-3-Clause 5, ISC 5, BSD-2-Clause 1, 0BSD 1, (MIT OR CC0-1.0) 1, MPL-2.0 1 (`axe-core`, dipakai tanpa modifikasi), UNLICENSED 10 (paket workspace internal).
- Lighthouse `--no-sandbox` sekarang opt-in (`NWB_CHROME_NO_SANDBOX=1`). Tes lulus dengan dan tanpa opt-in di sandbox ini.
- Batas log progres orchestrator (T-200) menutup antrean tak terbatas.

Acceptance:

- Critical safety tests lulus: suite penuh (507 lulus) termasuk tes scope, dashboard, AI, k6, Strix gate, dan compare.
- Tidak ada known critical/high tanpa status: R-LH-1 diturunkan ke Medium setelah sandbox default aktif (sisa risiko: container tanpa user namespace harus menyalakan opt-in dan menerima pelemahan isolasi). R-NODE-1 (Node 24 EOL) berstatus terbuka dengan keputusan pemilik proyek diperlukan.
- Scope guard digunakan semua adapter (lihat audit).
- Secrets tidak ditemukan dalam tracked files (findings=0).
- Limitation tercatat di `SECURITY.md`.

Catatan jujur: pengujian SSRF/redirect/IP privat secara ekstensif berada pada `packages/core/tests/scope.test.ts` (25 tes, dibuat di T-040). Tidak ada serangan baru yang dijalankan di luar fixture lokal.

---

---

## T-210 — Documentation and onboarding

ID: T-210
Title: Documentation and onboarding
Status: VERIFIED
Depends on: T-010 sampai T-200

Yang dibuat dan diuji:

- `README.md`: ikhtisar, batasan, prasyarat, instalasi, quality gates, dashboard, core tanpa AI, provider AI (opsional), fixture, target remote, risiko k6, batasan Strix, perbandingan dan retensi (library), dan tautan dokumentasi.
- `.env.example`: nama variabel aman, default aman, dan opsional tanpa nilai rahasia.
- `SECURITY.md`: cakupan, pelaporan, prosedur uji aman, batasan, dan tabel ancaman → kendali → bukti.
- `docs/decisions/`: ADR-0001 sampai 0005.

Bukti (sesi 2026-10-09):

- Clean clone `91df536` pada Node v24.21.0 (paket npm `node-linux-x64@24.21.0`, tarball resmi Node yang dipaketkan di registry npm):
  - `npm ci` (exit 0).
  - `npm run check` dengan `CHROMIUM_PATH` (Chromium 153), `REQUIRE_BROWSER_TESTS=1`, dan `NWB_CHROME_NO_SANDBOX=1` (exit 0).
  - `npm run build` (exit 0).
  - Smoke dashboard (`node packages/web/dist/main.js`, 127.0.0.1:4178): `GET /api/health` → `{"ok":true}`. `GET /api/diagnostics` memuat database reachable, artifacts writable, dan `telemetry: tidak ada`. Request dengan Host asing → 403.
- Perintah README yang diuji: `npm ci`, `npm run check`, `npm run build`, `npm run web` (health dan diagnostics), dan `CHROMIUM_PATH=... REQUIRE_BROWSER_TESTS=1 npx vitest run`.
- Tautan resmi (diperiksa 2026-10-09):
  - https://ai.google.dev/gemini-api/docs/rate-limits dan https://ai.google.dev/api/generate-content: endpoint Gemini terkonfirmasi di bagian "Endpoint" pada `models.generateContent` (chunk 3).
  - https://ai.google.dev/gemini-api/docs/api-key: header `x-goog-api-key` terkonfirmasi pada contoh REST. Halaman diperbarui 2026-10-06 UTC. Kunci standar tanpa pembatasan ditolak dan auth key adalah default baru.
  - https://console.groq.com/docs/api-reference: endpoint `POST https://api.groq.com/openai/v1/chat/completions`, `max_completion_tokens`, `n` hanya 1, `stream` default false.
  - https://console.groq.com/docs/rate-limits dan https://console.groq.com/docs/quickstart: rate limit per organisasi, 429, dan `GROQ_API_KEY`. Header Bearer tidak terbaca (contoh curl ada di tab yang tidak terambil).
  - https://playwright.dev/docs/intro: terbuka. Menyebut Node.js 22.x, 24.x, dan 26.x sebagai system requirement.
  - https://nodejs.org/en/about/previous-releases: Node 24 EOL 2026-09-07 (diperiksa sebelumnya pada sesi ini).
  - https://github.com/usestrix/strix: Apache-2.0, container Docker, default model OpenRouter.
  - https://github.com/GoogleChrome/lighthouse/blob/main/docs/configuration.md: 504 pada percobaan ini. Belum terverifikasi dan perlu dicek ulang.
- Nama model Gemini di registry (`gemini-3.8-flash`) sesuai banner di halaman rate-limit (2026-10-09). Nama model Groq (`openai/gpt-oss-20b`) sesuai daftar di halaman rate-limit (2026-10-09).

Catatan dan batasan:

- Node 24 sudah EOL menurut nodejs.org (R-NODE-1). Pin belum diganti karena itu keputusan pemilik proyek. README menyatakan ini secara eksplisit.
- Free tier per model (R-AI-3): `gemini-3.8-flash` ditandai `freeTierAllowlisted: true` (tabel harga resmi, dibaca 2026-10-09; lihat T-160). `openai/gpt-oss-20b` tetap `false`. Verifikasi per model dan kuota RPM/TPM/RPD tetap wajib sebelum setiap rilis.
- Tes live Gemini dan Groq belum dijalankan (memerlukan kunci dan opt-in pengguna).
- Pemeriksaan tautan belum lengkap. Lighthouse configuration docs belum terbaca.

---

## T-220 — CI, release checks, dan artifact validation

ID: T-220
Title: CI, release checks, dan artifact validation
Status: VERIFIED
Depends on: seluruh task rilis

Bukti:

- Workflow `.github/workflows/ci.yml` dengan dua job: `quality` (format, lint, typecheck, tes tanpa browser, secret scan, build, smoke dashboard dari `dist`) dan `browser-tests` (Chromium dari Playwright, `REQUIRE_BROWSER_TESTS=1`).
- Run CI pada commit `08a828d`: `37884182132`, kedua job SUCCESS (`gh run view 37884182132`).
- Clean install dari clone bersih: `npm ci` lulus setelah lockfile disinkronkan (`f65f68b`). Ini menangkap ketidaksinkronan lockfile yang nyata.
- Tanpa API key: core tests lulus tanpa AI (job quality tanpa `CHROMIUM_PATH`). Skip ditampilkan sebagai "skipped" (35 tes) dan bukan dianggap lulus.
- Tidak ada scan remote atau load test otomatis di CI: tidak ada target remote dan tidak ada k6/Strix di workflow.
- Izin workflow: `permissions: contents: read` (tanpa write token). Tidak ada secret yang dirujuk. Tidak ada artifact upload.
- Dependensi terkunci: `package-lock.json` dipakai oleh `npm ci`.

Catatan jujur:

- Job browser memakai `NWB_CHROME_NO_SANDBOX=1`. Runner Ubuntu terbaru membatasi user namespace sehingga sandbox Chrome dapat gagal. Ini opt-in khusus runner CI sementara (R-LH-1).
- Reporter `github-actions` ditambahkan ke job browser untuk diagnosis. Anotasi kegagalan dapat dibaca lewat API GitHub.
- Hasil artifact validation: schema laporan dan artefak dites di `packages/report/tests` dan `packages/storage/tests`.

---

## T-230 — Final acceptance audit dan release handoff

ID: T-230
Title: Final acceptance audit dan release handoff
Status: EXECUTED
Depends on: T-000 sampai T-220 (kecuali modul opsional yang secara eksplisit ditunda)

Hasil: `RELEASE_AUDIT.md` diperbarui. Gerbang wajib lulus pada clean clone, termasuk tes k6 nyata (v2.3.0). Retensi PASS sebagai library. Scenario, modul DEFERRED/BLOCKED, dan gap ditampilkan eksplisit.

Alasan status EXECUTED (bukan VERIFIED):

- Dependensi T-230 mencakup T-160, yang masih EXECUTED/BLOCKED: runner Strix dan bukti provider tidak bisa dijalankan di sandbox (lihat T-160).
- Taskbook membolehkan pengecualian hanya untuk modul opsional yang "secara eksplisit ditunda". Keputusan itu ada di tangan pemilik proyek, bukan agen. Dua pilihan:
  1. Pemilik menetapkan Strix sebagai modul opsional yang ditunda untuk rilis ini. Dengan itu T-230 dapat dinyatakan VERIFIED, dan T-160 tetap tercatat BLOCKED dengan alasan di atas.
  2. Tunggu bukti nyata Strix (Docker, Python ≥3.12, kunci provider). T-230 tetap EXECUTED.
- Keputusan pin Node (R-NODE-1) juga masih terbuka dan tidak mengubah status T-230 secara langsung.

---

## Verifikasi otomatis pada branch (CI)

Workflow: `.github/workflows/ci.yml`.

- Pemicu: push ke `main` dan `arena/**`, pull request, dan `workflow_dispatch`. Run lama pada ref yang sama dibatalkan (`concurrency`).
- Job `quality` (tanpa API key, tanpa target remote): `npm ci`, lalu `npm run check` (format, lint, typecheck, tes tanpa browser, secret scan).
- Job `browser-tests`: `REQUIRE_BROWSER_TESTS=1`, memasang Chromium dengan `npx playwright-core install --with-deps chromium`, menentukan `CHROMIUM_PATH` dari `chromium.executablePath()`, lalu menjalankan `npx vitest run` penuh. Bila Chromium tidak ada, tes browser GAGAL (tidak dilewati diam-diam).
- Verifikasi lokal: langkah-langkah npm dan guard `REQUIRE_BROWSER_TESTS` diuji di sandbox. Job GitHub Actions dibuktikan dengan run nyata; hasilnya dicatat di bagian "Hasil run CI" di bawah.
- Proteksi branch: TIDAK diubah. Sandbox tidak memiliki izin membaca maupun mengubah pengaturan repository (HTTP 403 pada `actions/permissions` dan `branches/main/protection`). Mengaktifkan proteksi memerlukan persetujuan dan izin pengguna.

Hasil run CI (commit `7f38e06`, run `37879282415`, branch `arena/48bd00ed-nusawebbench`):

- Job `quality`: success (23 detik).
- Job `browser-tests`: success (56 detik). Langkah `Install Chromium`, `Resolve Chromium path` (dengan `test -x`), dan `Run full test suite` semuanya hijau.
- Log job tidak dapat diunduh dari sandbox (`gh run view --log` gagal dengan EOF pada URL hasil). Jumlah tes dari run CI belum tercatat langsung.
- Bukti tidak dilewati: dengan `REQUIRE_BROWSER_TESTS=1`, bila `CHROMIUM_PATH` tidak valid, berkas tes browser melempar error dan job gagal. Job hijau berarti jalur browser aktif, bukan dilewati.
- Peringatan dari GitHub: Node.js 20 untuk `actions/checkout@v4` dan `actions/setup-node@v4` (dipaksa ke Node 24); runner `ubuntu-latest` akan migrasi ke Ubuntu 26 pada 19 Oktober 2026. Perlu ditinjau sebelum T-220.

---

## Risk register (awal)

Lihat tabel R1–R8 pada bagian T-000. Register ini diperbarui pada setiap task.

Risiko tambahan (T-040 s.d. T-080):

- R-SCOPE-1 — DNS rebinding untuk mode remote: DNS pinning belum diimplementasikan. Mitigasi: `buildRunPlan` memblokir remote + modul browser/eksternal. Status: terbuka untuk remote tanpa browser.
- R-ORCH-1 — Idempotency key hanya di memori; restart menghapus kunci, sehingga submit ulang setelah restart dapat membuat run baru. Status: terbuka (dicatat sebagai known limitation).
- R-ORCH-2 — Adapter yang mengabaikan `signal` dapat meninggalkan promise berjalan setelah timeout/cancel (orchestrator tetap melaporkan hasil). Status: terbuka.
- R-ORCH-3 — Temuan disimpan sebelum status modul diperbarui; crash di antara keduanya dapat menyisakan temuan tanpa perubahan status modul. Mitigasi: validasi keluaran sebelum penyimpanan (diuji). Status: sebagian.
- R-BQA-1 — Chromium untuk verifikasi lokal berasal dari paket npm pihak ketiga; bukan build resmi Playwright. Mitigasi: job `browser-tests` di CI memasang Chromium resmi lewat `playwright-core` dan gagal bila tidak tersedia. Status: sebagian; terbukti hanya setelah run CI berhasil.
- R-BQA-2 — Screenshot tidak diredaksi pada level piksel (`redactionApplied: false`). Status: terbuka untuk target non-sintetis.
- R-BQA-3 — Pemindaian `RISKY_CLICK_PATTERN` berbasis substring; dapat menolak label aman (mis. "display"). Trade-off konservatif yang disengaja.
- R-LH-1 — Lighthouse tanpa route guard; pembatasan jaringan hanya lewat `--host-resolver-rules` Chrome. `--no-sandbox` diperlukan di container dan memperlemah isolasi Chrome. Mitigasi: flag resolver, mode remote + Lighthouse diblokir `buildRunPlan` (T-040). Status: terbuka.
- R-FIX-1 — `security-lab` sengaja tidak meng-escape `q`; hanya untuk uji lokal dengan banner peringatan, tidak boleh di-deploy. Mitigasi: server bind 127.0.0.1.

---

- R-AI-1 — Dua panggilan bersamaan pada batas kuota diatasi dengan reservasi sinkron di memori; reservasi yang belum selesai saat proses mati tidak tercatat di database. Mitigasi: batas harian bersifat konservatif per proses lokal. Status: terbuka (dibatasi aplikasi lokal tunggal).
- R-AI-2 — Gemini: path `models/{model}:generateContent` dan header `x-goog-api-key` TERKONFIRMASI dari dokumen resmi (2026-10-09). Groq: endpoint dan `max_completion_tokens` terkonfirmasi (2026-10-09). Header Bearer Groq belum terbaca dari halaman yang diambil. Mitigasi: tes live manual opt-in (`AI_LIVE_TESTS=1`) wajib dijalankan sebelum dipakai. Status: terbuka, tes live BELUM DIJALANKAN.
- R-AI-3 — Kelayakan free tier per model: `gemini-3.8-flash` sudah diverifikasi dari harga resmi (2026-10-09); `openai/gpt-oss-20b` belum. Entri yang belum diverifikasi tetap `false`, sehingga memblokir model tersebut. Status: sebagian terbuka.
- R-WEB-1 — Dashboard hanya bind ke loopback dan tidak punya autentikasi. Preview publik sandbox tidak dapat mengakses server tanpa membuka bind non-loopback (ditolak). Mitigasi: `ALLOWED_HOSTS` hanya menambah nama Host; bind tetap loopback. Status: terbuka.
- R-WEB-2 — Idempotency-Key disimpan di memori proses; restart menghapusnya. Status: terbuka (sesuai keputusan T-050).

- R-NODE-1 — `.nvmrc` dan `engines` memakai Node 24. Diverifikasi ulang pada 2026-10-09: clean clone dengan Node v24.21.0 lulus `npm ci`, `npm run check`, `npm run build`, dan smoke dashboard. Menurut nodejs.org (diperiksa 2026-10-09), Node 24 LTS mencapai akhir dukungan pada 2026-09-07 dan Node 26 adalah rilis Current. Memperbarui pin mengubah seluruh toolchain (Playwright, tes, native `node:sqlite`) sehingga perlu verifikasi ulang penuh. Status: terbuka, perlu keputusan pemilik proyek (ADR-0002 perlu direvisi).

- R-TEST-1 — (DITUTUP) Kegagalan intermiten `buildReport` ("Data yang dikirim tidak valid"). Akar masalah: pola redaksi `LONG_DIGITS` (16 digit berurutan) menyensor bagian ID hex acak; ~0,19% ID terpengaruh (diukur 500.000 sampel), sehingga laporan gagal secara acak. Ini bug produk, bukan hanya tes. Diperbaiki di `packages/core/src/redact.ts` (batas huruf/digit) dengan tes regresi 40.000 ID acak di `packages/core/tests/redact.test.ts`. Status: ditutup, bukti: CI job quality/browser.

- R-RET-1 — Retensi hanya library (belum ada UI/CLI). Berkas `.tmp-*` yatim akibat crash keras belum dibersihkan. Status: terbuka.
- R-PATCH-1 — Tes setelah patch dan approval hanya di level library. Belum ada UI dan belum ada alur persetujuan yang tersimpan. Status: terbuka.

- R-K6-1 — Toolchain Go (1.27.2) untuk membangun k6 v2.3.0 diambil dari wheel PyPI `go-bin`, pihak ketiga, dan belum diverifikasi terhadap go.dev. Sumber k6 diverifikasi lewat tag dan commit resmi, dan dependensi berasal dari `vendor/` dalam commit tersebut. Mitigasi: skrip `scripts/build-k6-verified.sh` memakai Go yang dipasang pengguna sendiri. Status: terbuka (risiko kepercayaan toolchain, bukan risiko kode).
- R-STRIX-1 — Strix nyata tidak dapat dijalankan di sandbox: Docker tidak tersedia, Python ≥3.12 tidak dapat dipasang, dan kunci provider tidak dapat dipastikan. Workflow manual `strix-integration.yml` belum bisa di-dispatch karena belum ada di `main` (HTTP 404 pada branch sesi). Status: terbuka, BLOCKED. Menunggu: (1) otorisasi merge workflow ke `main`, atau keputusan lain dari pemilik; (2) secret `STRIX_GEMINI_API_KEY`; (3) persetujuan run provider (budget, model, target fixture).
- R-TEST-3 (DITUTUP) — Urutan hasil modul tidak deterministik: `module_results` diurutkan `created_at, id` dengan `id` acak (UUID), sehingga dua hasil dengan `created_at` yang sama (milidetik) bisa tertukar. Gagal sekali pada CI browser job run `37893146541` (commit `7ae0513`): `expected ['FAIL','PASS'] to equal ['PASS','FAIL']` di `orchestrator.test.ts:242`. Perbaikan: urutan `created_at, rowid` (urutan penyisipan) untuk `module_results`, `findings`, dan `evidence`. Regresi: `storage.test.ts` "urutan hasil modul ... tidak acak" (gagal 3/3 dengan kode lama, lulus dengan perbaikan). Bukti: `packages/orchestrator` dan `packages/storage` lulus 5 kali berulang. Status: ditutup.

- R-TEST-2 — Tes UI keyboard (`navigasi keyboard: Tab pertama ...`) gagal intermiten di CI browser job. Kegagalan pertama tidak terulang dalam 6 run. Kegagalan kedua (run `37893511343`, commit `2bf538a`): `page.waitForFunction` dengan predikat string dievaluasi di halaman, dan CSP dashboard (`script-src 'self'`, tanpa `unsafe-eval`) memblokirnya saat polling. Perbaikan: `waitForStatus` memakai `locator.waitFor` (tanpa evaluasi string di halaman). CSP produksi tidak diubah. Hubungan dengan kegagalan pertama belum dapat dipastikan. Status: diperbaiki, dipantau.

## Log task lainnya

Lihat bagian per task di atas.
