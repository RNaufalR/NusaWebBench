# IMPLEMENTATION_STATUS — NusaWebBench

Sumber kebenaran: `NusaWebBench_Master_Spec_and_Taskbook.md` (commit `f83447b` di `origin/main`, 1564 baris, dibaca seluruhnya).

Branch sesi: `arena/48bd00ed-nusawebbench` (dibuat dari `b3cc1a8`, di-fast-forward ke `f83447b` untuk mendapatkan taskbook).

Legenda status: `PLANNED`, `IN_PROGRESS`, `EXECUTED`, `VERIFIED`, `BLOCKED`, `FAILED`, `DEFERRED` (sesuai taskbook §11.1).

---

## Ringkasan status

| ID    | Judul                                             | Status   | Depends on                                      |
| ----- | ------------------------------------------------- | -------- | ----------------------------------------------- |
| T-000 | Repository discovery dan baseline audit           | VERIFIED | —                                               |
| T-010 | Bootstrap, workspace, dan quality gates           | PLANNED  | T-000                                           |
| T-020 | Domain schemas dan error taxonomy                 | PLANNED  | T-010                                           |
| T-030 | SQLite storage, migration, repository layer       | PLANNED  | T-020                                           |
| T-040 | Target registry dan authorization/scope guard     | PLANNED  | T-020, T-030                                    |
| T-050 | Run orchestrator dan state machine                | PLANNED  | T-020, T-030, T-040                             |
| T-060 | Evidence/artifact store dan reporting core        | PLANNED  | T-020, T-030, T-050                             |
| T-070 | Target fixture suite dan ground truth             | PLANNED  | T-010, T-020                                    |
| T-080 | Functional QA adapter (Playwright)                | PLANNED  | T-040, T-050, T-060, T-070                      |
| T-090 | Lighthouse adapter                                | PLANNED  | T-040, T-050, T-060, T-070                      |
| T-100 | Deterministic UX/accessibility heuristic engine   | PLANNED  | T-020, T-060, T-070, T-080                      |
| T-110 | Gemini adapter                                    | PLANNED  | T-010, T-020, T-030, T-060                      |
| T-120 | Groq adapter                                      | PLANNED  | T-010, T-020, T-030, T-060                      |
| T-130 | AI router, capability registry, free-tier lock    | PLANNED  | T-110, T-120                                    |
| T-140 | Dashboard MVP dan API routes                      | PLANNED  | T-030, T-040, T-050, T-060, T-080               |
| T-150 | k6 adapter dan safety gates                       | PLANNED  | T-040, T-050, T-060, T-070, T-140               |
| T-160 | Strix adapter                                     | PLANNED  | T-040, T-050, T-060, T-070                      |
| T-170 | Before/after comparison dan remediation proposals | PLANNED  | T-060, T-080, T-090, T-100, T-140               |
| T-180 | Provider settings, usage, privacy controls        | PLANNED  | T-110, T-120, T-130, T-140                      |
| T-190 | Security hardening dan threat-model verification  | PLANNED  | T-040 s.d. T-180                                |
| T-200 | Low-resource behavior, reliability, cleanup       | PLANNED  | T-050, T-060, T-080, T-090, T-140, T-150, T-160 |
| T-210 | Documentation and onboarding                      | PLANNED  | T-010 s.d. T-200                                |
| T-220 | CI, release checks, artifact validation           | PLANNED  | seluruh task rilis                              |
| T-230 | Final acceptance audit dan release handoff        | PLANNED  | T-000 s.d. T-220                                |

Jumlah task: 24 (T-000 s.d. T-230). Tidak ada task yang `VERIFIED`.

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
- `packages/storage/src/index.ts`; `packages/storage/tests/storage.test.ts` (38 tes).
- `packages/core/src/constants.ts` — `ALLOWED_RUN_TRANSITIONS` (satu-satunya aturan transisi), `isAllowedRunTransition`.
- `packages/core/src/schemas.ts` — `TargetSchema`, `SafeParser` (tipe struktural untuk lapisan storage).
- `packages/core/src/factories.ts` — `createTarget`; `parseOrThrow` menerima `SafeParser` dan melempar VALIDATION_FAILED.
- `vitest.config.ts` — alias ke `src` paket workspace agar tes tidak memakai `dist` lama (ditemukan saat pengujian: dist stale menyebabkan `createTarget is not a function`).
- `docs/decisions/ADR-0003-sqlite-node-sqlite.md`.

Acceptance criteria:

- [x] CRUD repositories — tes insert/get/list/findByOrigin untuk target; insert/get/transition/list untuk run; insert/list/update untuk modul, temuan, evidence, usage, remediation, settings.
- [x] Migration tests — DB kosong (apply v1, idempoten), checksum berubah ditolak, DB versi lebih baru ditolak, migrasi gagal di tengah rollback dan tidak tercatat, upgrade dari v1 ke v2 tanpa menyentuh data lama.
- [x] Transaction rollback tests — `withTransaction` melempar error → insert di dalam transaksi tidak tersimpan (tes "rollback penuh").
- [x] Restart persistence test — `Store.open` → tulis → close → buka ulang: run, settings, dan usage tetap ada.
- [x] DB corruption/error handling — file bukan SQLite → STORAGE_ERROR tanpa path di pesan aman; folder tidak dapat ditulis → STORAGE_ERROR (dilewati bila berjalan sebagai root, dinyatakan di kode).
- [x] Negative: path invalid (`folder` berupa file), artifact hilang (belum relevan — evidence hanya metadata, diuji di T-060), duplicate run ID (CONFLICT), failed transaction (rollback), disk write error (disimulasikan lewat folder read-only), DB path tidak writable.
- [x] Query parameterization — tes "input berbahaya diperlakukan sebagai data": judul `'); DROP TABLE runs; --` tersimpan literal dan tabel runs tetap ada.
- [x] Data tersimpan dimanipulasi → ditolak saat dibaca (STORAGE_ERROR), tidak diteruskan.
- [x] Patch transisi tidak bisa mengubah identitas run (`targetId`, `id`) — ditambahkan setelah audit.
- [x] Foreign key dan uniqueness: run dengan target tidak ada → VALIDATION_FAILED; origin target ganda → CONFLICT; modul ganda per run → CONFLICT.
- [~] Artifact path verifikasi terhadap root artefak — belum diimplementasikan (tanggung jawab artifact store T-060); skema `RelativePathSchema` sudah menolak traversal.
- [~] Retention/cleanup — belum diimplementasikan; dijadwalkan T-200 (cleanup dengan dry-run). Tidak ada penghapusan data di T-030.

Commands actually run:

- `npx vitest run` — PASS 115/115 (termasuk 38 tes storage). Sebelumnya: 13 gagal karena dist stale (diperbaiki dengan alias), 1 gagal karena ZodError terpetakan STORAGE_ERROR (diperbaiki: parseOrThrow → VALIDATION_FAILED), 1 gagal karena migrasi uji salah (ditulis ulang).
- `npx tsc -p tsconfig.json --noEmit` — PASS.
- `npm run lint` — PASS setelah menghapus non-null assertion dan `require()` di tes.

Line-by-line audit:

- `database.ts`, `migrations.ts`, `repositories.ts` dibaca. Temuan dan perbaikan:
  1. `ZodError` mentah dipetakan menjadi STORAGE_ERROR → diganti `parseOrThrow` (VALIDATION_FAILED). Diuji.
  2. Patch transisi bisa menimpa identitas saat runtime → hanya field yang diizinkan yang disalin. Diuji.
  3. Migrasi v1 dijalankan `db.exec` di dalam `withTransaction` — DDL SQLite transaksional; diuji rollback.
  4. `ModuleResultRepository.insert` sebelumnya memakai `startedAt` sebagai created_at (bisa null/epoch) → diganti waktu penyimpanan.
  5. `countRequests` menjumlahkan `requestCount` dari JSON; status apa pun dihitung (dicatat sebagai aturan: request yang mungkin sudah terkirim tetap dihitung).
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

## Risk register (awal)

Lihat tabel R1–R8 pada bagian T-000. Register ini diperbarui pada setiap task.

---

## Log task lainnya

Lihat bagian per task di atas.
