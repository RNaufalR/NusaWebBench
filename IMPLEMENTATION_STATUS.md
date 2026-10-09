# IMPLEMENTATION_STATUS — NusaWebBench

Sumber kebenaran: `NusaWebBench_Master_Spec_and_Taskbook.md` (commit `f83447b` di `origin/main`, 1564 baris, dibaca seluruhnya).

Branch sesi: `arena/48bd00ed-nusawebbench` (dibuat dari `b3cc1a8`, di-fast-forward ke `f83447b` untuk mendapatkan taskbook).

Legenda status: `PLANNED`, `IN_PROGRESS`, `EXECUTED`, `VERIFIED`, `BLOCKED`, `FAILED`, `DEFERRED` (sesuai taskbook §11.1).

---

## Ringkasan status

| ID | Judul | Status | Depends on |
|---|---|---|---|
| T-000 | Repository discovery dan baseline audit | VERIFIED | — |
| T-010 | Bootstrap, workspace, dan quality gates | PLANNED | T-000 |
| T-020 | Domain schemas dan error taxonomy | PLANNED | T-010 |
| T-030 | SQLite storage, migration, repository layer | PLANNED | T-020 |
| T-040 | Target registry dan authorization/scope guard | PLANNED | T-020, T-030 |
| T-050 | Run orchestrator dan state machine | PLANNED | T-020, T-030, T-040 |
| T-060 | Evidence/artifact store dan reporting core | PLANNED | T-020, T-030, T-050 |
| T-070 | Target fixture suite dan ground truth | PLANNED | T-010, T-020 |
| T-080 | Functional QA adapter (Playwright) | PLANNED | T-040, T-050, T-060, T-070 |
| T-090 | Lighthouse adapter | PLANNED | T-040, T-050, T-060, T-070 |
| T-100 | Deterministic UX/accessibility heuristic engine | PLANNED | T-020, T-060, T-070, T-080 |
| T-110 | Gemini adapter | PLANNED | T-010, T-020, T-030, T-060 |
| T-120 | Groq adapter | PLANNED | T-010, T-020, T-030, T-060 |
| T-130 | AI router, capability registry, free-tier lock | PLANNED | T-110, T-120 |
| T-140 | Dashboard MVP dan API routes | PLANNED | T-030, T-040, T-050, T-060, T-080 |
| T-150 | k6 adapter dan safety gates | PLANNED | T-040, T-050, T-060, T-070, T-140 |
| T-160 | Strix adapter | PLANNED | T-040, T-050, T-060, T-070 |
| T-170 | Before/after comparison dan remediation proposals | PLANNED | T-060, T-080, T-090, T-100, T-140 |
| T-180 | Provider settings, usage, privacy controls | PLANNED | T-110, T-120, T-130, T-140 |
| T-190 | Security hardening dan threat-model verification | PLANNED | T-040 s.d. T-180 |
| T-200 | Low-resource behavior, reliability, cleanup | PLANNED | T-050, T-060, T-080, T-090, T-140, T-150, T-160 |
| T-210 | Documentation and onboarding | PLANNED | T-010 s.d. T-200 |
| T-220 | CI, release checks, artifact validation | PLANNED | seluruh task rilis |
| T-230 | Final acceptance audit dan release handoff | PLANNED | T-000 s.d. T-220 |

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

| # | Risiko | Dampak | Mitigasi / task |
|---|---|---|---|
| R1 | Tidak ada `LICENSE` di repo. | Pengguna tidak tahu hak pakai. | Pemilik repo harus memilih lisensi. Ditandai untuk T-210/T-230. Tidak dibuat sendiri. |
| R2 | Belum ada lockfile/package manager. | Build tidak reproducible. | T-010: npm workspaces + `package-lock.json`. |
| R3 | Node 22 dipakai di lingkungan ini; belum ada verifikasi LTS aktif terbaru. | Runtime bisa tidak didukung dependency. | T-010: verifikasi `nodejs.org/en/about/previous-releases` dan pin di `.nvmrc`. |
| R4 | Chromium/Playwright browser belum terpasang; k6 dan Docker tidak tersedia. | Adapter tidak bisa diuji langsung. | Tes fake/mock di CI; tes nyata sebagai opt-in dengan status `BLOCKED`/`UNAVAILABLE` bila tidak tersedia. |
| R5 | Versi terbaru `typescript 7.x`, `eslint 10.x`, `vite 8.x` berbeda besar dari versi yang umum dipakai ekosistem. | Risiko kompatibilitas plugin. | T-010: uji kompatibilitas dan catat di ADR jika memakai versi lebih lama. |
| R6 | Free-tier provider (Gemini/Groq) belum diverifikasi. | Klaim biaya/kuota salah. | T-110/T-120: verifikasi dokumentasi resmi dan catat tanggal. Tidak ada angka kuota ditanam. |
| R7 | Ancaman SSRF/scope escape bersifat kritis. | Scan target tidak sah. | T-040 sebagai gerbang; remote mode diblokir sampai guard teruji. |
| R8 | Repo belum memiliki `.gitignore`. | Risiko commit `data/`, `.env`, screenshot. | T-010 wajib menambahkan ignore rules sebelum ada artefak. |

### Keputusan

- Stack mengikuti rekomendasi taskbook §3.1 (TypeScript, npm workspaces, React+Vite, Fastify, SQLite, Vitest, Playwright, Lighthouse, k6, Strix opsional). Lihat `docs/decisions/ADR-0001-stack-baseline.md`.

### Known limitations

- Hanya dokumentasi baseline; tidak ada fitur yang diklaim siap.
- Pemeriksaan keamanan adalah pemindaian pola sederhana, bukan audit keamanan menyeluruh.

### Next action

- T-010: pin Node LTS, inisialisasi npm workspaces, quality gates, `.gitignore`, `.env.example`, dan CI tanpa API key.

---

## Risk register (awal)

Lihat tabel R1–R8 pada bagian T-000. Register ini diperbarui pada setiap task.

---

## Log task lainnya

Belum ada task selain T-000.
