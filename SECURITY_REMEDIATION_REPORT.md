# Laporan Remediasi Keamanan — NusaWebBench

Tanggal: 2026-10-09 (Asia/Jakarta). Branch: `arena/48bd00ed-nusawebbench`.
Dasar: `8570a79`. Temuan lengkap dan status ada di `SECURITY_PENTEST_REPORT.md`.

---

## 1. Perubahan

| Berkas | Perubahan | Temuan |
|---|---|---|
| `packages/core/src/redact.ts` | Nilai bertanda kutip dibaca sampai kutip penutup; pola baru untuk format kunci provider (`sk-or-v1-`, `sk-ant-…`, `sk_live_`/`rk_live_`, `xoxb-`) | F-01, F-02 |
| `packages/web/src/app.ts` | Decoding parameter rute dibungkus `try` → 400 `VALIDATION_FAILED`; panggilan `matchRoute` ikut dipetakan lewat `sendError` | F-03 |
| `packages/core/tests/security-redact.test.ts` | **Baru.** 8 tes regresi redaksi (kutip, spasi, koma, kutip tunggal, kontrol negatif, format provider) | F-01, F-02 |
| `packages/web/tests/security-regression.test.ts` | **Baru.** 5 tes: 400 untuk persen-encoding rusak, 404 untuk ID valid, dan 403 untuk Host asing (dengan dan tanpa port) serta Host yang diizinkan | F-03, guard Host |
| `package.json` | `vitest`: `4.0.18` → `4.1.11` | F-07 |
| `package-lock.json` | Subtree vitest diperbarui; `es-module-lexer@2.3.2` bersarang di bawah `vitest`; `std-env@4.3.0` di root | F-07 |
| `.github/workflows/ci.yml` | Pin SHA untuk `actions/checkout` dan `actions/setup-node` (versi di komentar) | F-08 |
| `.github/workflows/strix-integration.yml` | Pin SHA untuk `actions/checkout`, `actions/setup-node`, `actions/setup-python`, dan `actions/upload-artifact` | F-08 |
| `IMPLEMENTATION_STATUS.md` | Koreksi: `ALLOW_EXTERNAL_BIND` tidak mengubah bind (fail-closed) | F-09 |
| `docs/decisions/ADR-0005-…md` | Peringatan: jangan isi `ALLOWED_HOSTS` dengan nama yang resolve ke alamat publik/non-loopback | F-09 |
| `SECURITY_PENTEST_REPORT.md` | **Baru.** Laporan temuan dan status | — |
| `SECURITY_REMEDIATION_REPORT.md` | **Baru.** Dokumen ini | — |

Tidak ada perubahan pada bind address. Dashboard tetap loopback.

---

## 2. Bukti Regresi

Tes regresi dijalankan **terhadap kode lama** (dengan `git stash push` hanya untuk `redact.ts` dan `app.ts`, lalu `git stash pop`):

- `security-redact.test.ts` + `security-regression.test.ts`: **8 gagal, 5 lulus** di kode lama.
  - Gagal: 400 untuk persen-encoding rusak (F-03); JSON password dengan spasi, JSON secret dengan koma, kutip tunggal dengan spasi (F-01); OpenRouter, Anthropic, Stripe-style, dan Slack tanpa nama field (F-02).
  - Lulus di kode lama (kontrol): 404 untuk ID valid; guard Host (3 tes); nilai tanpa kutip tetap disensor.
- Setelah perbaikan: **13 dari 13 lulus**.

Kontrol negatif memastikan teks biasa (`Halaman reset password tersedia.`) tidak berubah.

---

## 3. Hasil Verifikasi Akhir

Semua dijalankan dengan Node 24.21.0 (`/tmp/nodepin`), npm 10.9.8.

| Perintah | Hasil |
|---|---|
| `npm ci` (setelah perubahan lock) | exit 0, 283 paket. Lock sinkron dengan `package.json`. |
| `npm audit` (penuh, termasuk dev) | exit 0. **found 0 vulnerabilities** (baseline: 2). |
| `npm ls vitest` | `vitest@4.1.11` |
| `npm run check` | exit 0. Format, lint, typecheck, tes, dan secret-scan lulus. |
| — `Test Files` | 29 lulus, 4 dilewati (33) |
| — `Tests` | **524 lulus, 39 dilewati (563)**. Baseline: 511 lulus, 39 dilewati (550). Penambahan 13 tes baru. |
| — `secret-scan` | `scanned=151 findings=0` |
| `npm run build` | exit 0 |
| Parse YAML workflow (`js-yaml`) | ci.yml dan strix-integration.yml valid |

Catatan: `npm run check` gagal sekali selama pengerjaan karena format Prettier dan `no-unused-vars` pada tes baru. Keduanya sudah diperbaiki sebelum hasil akhir di atas.

---

## 4. Catatan Proses

- **Resolusi lock:** npm 10.9.8 crash (`Cannot read properties of null (reading 'edgesOut')`) saat resolve vitest 4.1.11 di repo ini maupun di direktori kosong. Itu bug npm 10 pada peer opsional `@vitest/browser-playwright`. Lock diperbarui dengan cara berikut: subtree vitest di-resolve dengan npm 11 (`npx npm@11`) di `/tmp/vt`, entri vitest-family dan entri transitif yang hilang disalin ke `package-lock.json`, lalu `npm ci` dijalankan untuk membuktikan sinkronisasi. Percobaan `--legacy-peer-deps` dibatalkan karena menghapus banyak entri esbuild.
- **Reset Git (dilaporkan sesuai aturan):** sebelum audit, branch lokal `arena/48bd00ed-nusawebbench` menunjuk ke `b3cc1a8` dengan hampir semua file untracked. Working tree dibackup ke `/tmp/nwb-worktree-backup-1791543071.tar` dan dibandingkan dengan `git archive origin/arena/48bd00ed-nusawebbench` (identik). Lalu dijalankan `git reset --mixed origin/arena/48bd00ed-nusawebbench` untuk menyamakan branch dengan remote. **Tidak ada `--hard`, `clean`, atau force-checkout.** Tidak ada file pengguna yang hilang.
- Tidak ada commit ke `main`. Tidak ada merge. Tidak ada force-push.

---

## 5. Yang Belum Dikerjakan (OPEN)

Tidak dikerjakan di repo karena alasan yang tercantum:

| ID | Item | Alasan | Langkah berikutnya |
|---|---|---|---|
| F-04 | Pembatasan secret Strix (GitHub Environment, required reviewers, deployment branch `main`, ruleset/branch protection, `permissions: contents: read`) | **Perubahan remote dan GitHub configuration butuh otorisasi terpisah.** Guard di dalam file workflow tidak efektif karena workflow dijalankan dari ref yang dipilih. | Pemilik repo memberi persetujuan untuk membuat environment dan rule. |
| F-05 | Pin koneksi pada link checker browser-qa (anti-rebinding) | Perlu desain ulang: Playwright `request` tidak bisa memakai alamat terperiksa. Butuh `node:http(s)` dengan `lookup` terpin, dan tes dengan server lokal. | Implementasi di sesi berikutnya. |
| F-06 | Guard request untuk Lighthouse (blokir IP literal non-publik) | Butuh Chromium untuk verifikasi runtime. Tidak tersedia di sandbox. | Verifikasi di lingkungan dengan Chromium, lalu implementasi `Fetch` interception. |
| F-10 | Batasi egress sandbox Strix | Butuh Docker dan runner terisolasi. Belum bisa diverifikasi. | Atur `STRIX_DOCKER_SANDBOX_NETWORK` ke network internal di runner terisolasi, dengan persetujuan run. |
| F-11 | Pembersihan Set `started` | Dampak kecil. | Hapus entri setelah run selesai. |
| F-13 | Upgrade Node | EOL Node 24 menurut nodejs.org (2026-09-07). | Naikkan ke LTS yang didukung, lalu verifikasi `npm ci` dan `npm run check`. |

Eksekusi Strix nyata, provider Gemini/Groq live, dan run GitHub Actions **tidak dijalankan** dan tetap menunggu persetujuan eksplisit dari pengguna.

---

## 6. Rekomendasi Remote (Perlu Otorisasi Terpisah, Tidak Dieksekusi)

1. **GitHub Environment `strix-live`:** required reviewers, deployment branch policy hanya `main`, pindahkan `STRIX_GEMINI_API_KEY` ke environment itu.
2. **Ruleset untuk `main`:** wajibkan pull request, status check `quality`, dan batasi push/dispatch.
3. **Kebijakan Actions repo:** batasi action ke yang diizinkan (GitHub-owned dan SHA yang dipin).
4. **Akses dispatch:** batasi write access pada repo public ke maintainer tepercaya.

Tidak ada rekomendasi di atas yang sudah dieksekusi.

---

## 7. Commit

Perubahan dikomit ke `arena/48bd00ed-nusawebbench` dan didorong ke `origin` pada branch yang sama. Tidak ada push ke branch lain. Hash commit dilaporkan di ringkasan chat.
