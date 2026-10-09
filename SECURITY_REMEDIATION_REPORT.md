# Laporan Remediasi Keamanan — NusaWebBench

Tanggal: 2026-10-09 (Asia/Jakarta). Branch: `arena/48bd00ed-nusawebbench`.
Putaran 1: `8570a79` → `e6ed370` (redaksi, error 400, vitest, pin SHA, docs).
Putaran 2 (dokumen ini): perbaikan F-04 (kontrol repo), F-05, F-06, F-10, dan koreksi F-13.
Temuan lengkap dan status ada di `SECURITY_PENTEST_REPORT.md`.

---

## 1. Perubahan Putaran 2

| Berkas                                                         | Perubahan                                                                                                                                                                                                                                                                 | Temuan           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `packages/core/src/pinned-http.ts`                             | **Baru.** `pinnedLookup`, `pinnedGet`, `followRedirectsPinned`, `browserPinArgs`                                                                                                                                                                                          | F-05             |
| `packages/core/src/index.ts`                                   | Ekspor `pinned-http`                                                                                                                                                                                                                                                      | F-05             |
| `packages/browser-qa/src/functional-qa.ts`                     | `checkLinks` memakai `followRedirectsPinned` (tanpa `APIRequestContext`). Argumen pin sebelum launch. Scope ditolak sebelum browser dibuka                                                                                                                                | F-05             |
| `packages/ux-rules/src/collect.ts`                             | Argumen pin sebelum launch                                                                                                                                                                                                                                                | F-05             |
| `packages/lighthouse/src/lighthouse.ts`                        | `--proxy-server=http://127.0.0.1:1` dan `--proxy-bypass-list=localhost;127.0.0.1;[::1]`                                                                                                                                                                                   | F-06             |
| `scripts/strix-egress-guard.sh`                                | **Baru.** Aturan iptables: DROP forwarding docker0 ke luar; ACCEPT hanya port fixture di INPUT; DROP sisa trafik docker0 ke host. Mode `DRY_RUN=1`                                                                                                                        | F-10             |
| `.github/workflows/strix-integration.yml`                      | Step `Batasi egress container Strix` sebelum integrasi nyata (hanya bila `run_scan`)                                                                                                                                                                                      | F-10             |
| `packages/core/tests/pinned-http.test.ts`                      | **Baru.** 10 tes (server loopback sungguhan, tanpa koneksi ke alamat pihak ketiga)                                                                                                                                                                                        | F-05             |
| `packages/lighthouse/tests/egress-flags.test.ts`               | **Baru.** 3 tes flag                                                                                                                                                                                                                                                      | F-06             |
| `packages/security-strix/tests/egress-and-workflow.test.ts`    | **Baru.** 9 tes: dry-run egress (urutan aturan, validasi input) dan kebijakan workflow (SHA 40 hex, `contents: read`, tanpa write, strix hanya `workflow_dispatch`, `persist-credentials: false`, secret hanya di satu step bergerbang `run_scan`, `ci.yml` tanpa secret) | F-04, F-08, F-10 |
| `packages/browser-qa/tests/functional-qa.test.ts`              | Grant tes dari `127.0.0.1:1` ke `127.0.0.1:4599`. Port 1 ditolak scope (`port-not-allowed`). Tes lama sebenarnya menguji grant tidak valid                                                                                                                                | —                |
| `README.md`, `RELEASE_AUDIT.md`, `IMPLEMENTATION_STATUS.md`    | Koreksi klaim Node EOL. Status F-04 sampai F-13. Bagian remediasi keamanan                                                                                                                                                                                                | F-13             |
| `SECURITY_PENTEST_REPORT.md`, `SECURITY_REMEDIATION_REPORT.md` | Disinkronkan dengan kondisi kode terkini                                                                                                                                                                                                                                  | —                |

---

## 2. Detail per Temuan

### F-04 — PARTIAL (kontrol repo dikunci tes; kontrol remote OPEN)

- **Yang dilakukan di repo:** tidak ada perubahan kode baru untuk ini. Kontrol yang sudah ada sekarang dikunci oleh tes (`egress-and-workflow.test.ts`) agar tidak bisa regres diam-diam:
  - `permissions: contents: read`.
  - `persist-credentials: false` pada checkout Strix.
  - `secrets.STRIX_GEMINI_API_KEY` hanya di satu step bergerbang `run_scan`.
  - `ci.yml` tanpa secret.
- **Yang sengaja tidak dilakukan:** guard `github.ref` di dalam file workflow tidak dipasang. Alasannya dicatat di SECURITY_PENTEST_REPORT.md bagian F-04.
- **Yang butuh otorisasi:** GitHub Environment `strix-live` dengan required reviewers dan deployment branch `main`, ruleset atau branch protection, dan pembatasan dispatch. Tidak dieksekusi.

### F-05 — FIXED (library), severity Low latent

- **Penyebab:** `checkUrlInScope` me-resolve DNS saat cek. Klien berikutnya me-resolve lagi.
- **Perbaikan:**
  - `followRedirectsPinned`: setiap hop dicek scope (satu resolusi), lalu GET ke alamat hasil cek dengan `pinnedLookup`. Tidak ada resolusi ulang.
  - `browserPinArgs` (mode remote): `--host-resolver-rules=MAP <host> <ip>,MAP * ~NOTFOUND`. IPv6 dalam kurung siku. Mode local-fixture tidak berubah.
  - Scope ditolak sebelum browser dibuka (`SCOPE_DENIED` di browser-qa, `INVALID` di ux-rules).
- **Bukti:** `pinned-http.test.ts` lulus (10 tes). Bukti kunci: koneksi ke `pinned-check.invalid` berhasil dengan alamat terpin, sehingga DNS tidak dipakai. `pinnedLookup` tidak memanggil DNS.
- **Koreksi:** laporan putaran 1 menilai Medium. Jalur API remote untuk modul browser diblokir `buildRunPlan` (`REMOTE_NOT_ENFORCEABLE_MODULES`), sehingga severity diturunkan menjadi Low latent.
- **Belum terbukti:** perilaku Chrome dengan `MAP host ip` dan IPv6 belum diuji di runtime (BLOCKED).
- **Perubahan perilaku:** link checker tidak lagi memakai cookie atau sesi browser. Untuk pengecekan status tautan itu tidak diperlukan. Ini perlu dicatat jika link checker nanti butuh halaman yang login.

### F-06 — FIXED (konfigurasi), runtime BLOCKED

- **Perbaikan:** `--proxy-server=http://127.0.0.1:1` dan `--proxy-bypass-list=localhost;127.0.0.1;[::1]`. Koneksi non-loopback (termasuk IP literal) dialihkan ke proxy yang tidak mendengarkan dan gagal sebelum keluar. Loopback langsung.
- **Batasan:** port 1 diasumsikan tidak dipakai. Jika ada layanan di sana, koneksi bisa ke layanan itu. Ini perlu dicek di runner.
- **Bukti:** `egress-flags.test.ts` (3 tes). Verifikasi runtime (`Fetch` ke IP literal yang gagal) BLOCKED.

### F-10 — FIXED (skrip dan workflow), runtime BLOCKED

- **Perbaikan:** `scripts/strix-egress-guard.sh`:
  - `DOCKER-USER`: `-i docker0 ! -o docker0 -j DROP` (forwarding keluar dari container diblokir).
  - `INPUT`: `-i docker0 -p tcp --dport $PORT -j ACCEPT` di atas `-i docker0 -j DROP`.
  - Aturan lama dihapus dulu (idempotent). Input port dan nama interface divalidasi. Tanpa `DRY_RUN`, skrip memakai `sudo`.
- **Urutan di workflow:** dipanggil setelah forwarder socat aktif dan sebelum integrasi nyata. Hanya bila `run_scan=true`.
- **Batasan yang diketahui:**
  - DNS dari container diblokir. Sandbox tidak memerlukannya karena `host.docker.internal` ada di `extra_hosts`. Belum diuji dengan Strix nyata.
  - Agen LLM diasumsikan berjalan di proses host. Ini berdasarkan `session_manager.py` dan `models.py` pada Strix v1.7.0, belum diuji.
  - Strix dan Docker tidak tersedia di sandbox. Skrip tidak pernah dijalankan dengan iptables sungguhan.
- **Bukti:** tes dry-run (urutan aturan, port tidak valid ditolak, nama interface berbahaya ditolak). Verifikasi runtime BLOCKED.

### F-13 — WITHDRAWN (koreksi)

- Klaim "Node 24 EOL 2026-09-07" dicabut. Halaman nodejs.org (diambil 2026-10-09) menampilkan Node 24 sebagai LTS, Node 22 sebagai LTS, dan Node 26 sebagai Current. Tanggal 2026-09-07 berasal dari kolom "Last updated". Pin tetap Node 24. Dokumen yang memuat klaim keliru sudah dikoreksi: `README.md`, `RELEASE_AUDIT.md`, `IMPLEMENTATION_STATUS.md`, dan laporan ini.

---

## 3. Verifikasi Akhir (kode final putaran 2)

| Perintah                                                               | Hasil                                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `npm run lint`                                                         | exit 0 (`--max-warnings=0`)                                          |
| `npm run typecheck`                                                    | exit 0                                                               |
| `npm run test`                                                         | **547 lulus, 39 dilewati (586 total)**. Sebelum putaran 2: 524 lulus |
| `npm run secret-scan`                                                  | `scanned=155 findings=0`                                             |
| `npm run build`                                                        | exit 0                                                               |
| `npm audit`                                                            | **0 kerentanan**                                                     |
| `npm audit --omit=dev`                                                 | **0 kerentanan**                                                     |
| `DRY_RUN=1 STRIX_FIXTURE_PORT=4600 bash scripts/strix-egress-guard.sh` | exit 0. Aturan sesuai desain                                         |

Catatan proses: satu tes lama gagal setelah perubahan karena grant `127.0.0.1:1` ditolak scope. Perbaikannya ada di fixture tes (bagian 1), bukan pelonggaran scope.

Format: `npm run format:check` dijalankan ulang setelah laporan ini ditulis. Lihat catatan di bagian 5.

---

## 4. Yang Tidak Dijalankan (BLOCKED atau OPEN)

| ID   | Item                                                                                | Alasan                                                                          | Langkah berikutnya                                                                                             |
| ---- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| F-04 | Kontrol remote Strix (Environment, ruleset, branch protection, pembatasan dispatch) | Perubahan GitHub butuh otorisasi terpisah. Guard di file workflow tidak efektif | Pemilik repo memberi persetujuan                                                                               |
| F-05 | Pin Chrome `MAP host ip` dan IPv6 di runtime                                        | Chromium di sandbox hang                                                        | Jalankan tes browser di lingkungan dengan Chromium yang berjalan                                               |
| F-06 | Runtime egress Lighthouse (`Fetch` ke IP literal gagal cepat)                       | Sama dengan di atas                                                             | Sama                                                                                                           |
| F-10 | Skrip iptables dan dampaknya pada Strix nyata                                       | Docker dan iptables tidak tersedia. Strix nyata tidak dijalankan                | Jalankan di runner Linux dengan Docker dan persetujuan run. Pastikan DNS container dan sandbox tetap berfungsi |
| F-11 | Pembersihan Set `started`                                                           | Dampak kecil                                                                    | Hapus entri setelah run selesai                                                                                |
| —    | Strix nyata, tes live Gemini/Groq, run GitHub Actions                               | Tidak ada persetujuan run dan kunci                                             | Persetujuan eksplisit per run                                                                                  |

Browser nyata: `/tmp/chr` (Chromium dari `@sparticuz/chromium`, di luar repo) memuat binary tetapi hang. Percobaan yang sudah dilakukan: default (zygote crash), `--no-zygote --single-process --headless=shell` (trap GL/ANGLE), dan GL dinonaktifkan (timeout 60 detik tanpa output). Tidak ada percobaan lain yang direncanakan dalam putaran ini.

---

## 5. Catatan Proses

- **Resolusi lock vitest (putaran 1):** npm 10.9.8 crash (`edgesOut`) saat resolve vitest 4.1.11. Subtree di-resolve dengan npm 11 di `/tmp/vt` lalu digabung. `npm ci` membuktikan lock sinkron.
- **Reset Git (putaran 1, dilaporkan sesuai aturan):** branch lokal semula di `b3cc1a8` dengan file untracked. Working tree dibackup ke `/tmp/nwb-worktree-backup-1791543071.tar`, lalu `git reset --mixed origin/arena/48bd00ed-nusawebbench` dijalankan. Tidak ada `--hard`, `clean`, atau force-checkout.
- **Tidak ada** push ke `main`, merge, force-push, atau perubahan remote GitHub dalam putaran ini.
- Berkas sementara di `/tmp` (`/tmp/chr`, `/tmp/vt`, `/tmp/probes`) berada di luar repo.

---

## 6. Rekomendasi Remote (perlu otorisasi terpisah, tidak dieksekusi)

1. **GitHub Environment `strix-live`:** required reviewers, deployment branch policy hanya `main`. Pindahkan `STRIX_GEMINI_API_KEY` ke environment itu.
2. **Ruleset untuk `main`:** wajibkan pull request dan status check `quality`, batasi push dan dispatch.
3. **Kebijakan Actions:** batasi ke action GitHub-owned dan SHA yang dipin.
4. **Akses dispatch:** batasi write access pada repo public ke maintainer tepercaya.

---

## 7. Commit

Perubahan putaran 2 dikomit ke `arena/48bd00ed-nusawebbench` dan didorong ke `origin` pada branch yang sama. Hash commit dilaporkan di ringkasan chat.
