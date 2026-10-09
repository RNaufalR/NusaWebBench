# Laporan Remediasi Keamanan — NusaWebBench

Tanggal: 2026-10-09 (Asia/Jakarta). Branch: `arena/48bd00ed-nusawebbench`.
HEAD awal misi putaran ini: `9be88dd`. HEAD akhir: lihat bagian 7.
Temuan lengkap dan riwayat status ada di `SECURITY_PENTEST_REPORT.md`.

Laporan ini menggunakan status: **VERIFIED**, **PARTIALLY_VERIFIED**, **BLOCKED**, **OPEN**, **FALSE_POSITIVE**,
dan **WITHDRAWN**. Bukti dipisah per kategori: statis, unit, integrasi, runtime lokal, dan pengaturan GitHub.
Kategori tidak boleh saling diklaim. Tidak ada status FIXED final tanpa bukti runtime yang sesuai.

---

## 1. Ringkasan Status

| ID          | Judul singkat                                                     | Status                 | Bukti yang ada                                                                                                                                                         | Yang belum terbukti                                                                                                  |
| ----------- | ----------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| F-04        | Secret Strix dapat terekspos dari ref dispatch tanpa perlindungan | PARTIALLY_VERIFIED     | Workflow dipisah jadi `provision` (tanpa secret) dan `strix-live` (`environment: strix-live`). Tes kebijakan per job. Kontrol negatif. zizmor dan actionlint: 0 temuan | Environment, reviewer, deployment branch, dan pemindahan secret di GitHub **OPEN** (belum ada, lihat bagian 2)       |
| F-05        | Pin DNS: celah antara cek scope dan koneksi                       | PARTIALLY_VERIFIED     | `pinned-http.ts` + tes 27 (10 lama + 17 baru) lulus. Chromium nyata: 3/3 tes pin (`MAP` dan `NOTFOUND`)                                                                | Jalur TLS/SNI dengan sertifikat tidak tepercaya **belum diuji** (BLOCKED untuk bagian ini). Runtime end-to-end belum |
| F-06        | Lighthouse: bypass loopback membuka server lain                   | PARTIALLY_VERIFIED     | Proxy allowlist per run (`egress-proxy.ts`) + `--proxy-bypass-list=<-loopback>`. Integrasi Chromium nyata (lihat 2.3)                                                  | Pengujian pada runner CI dan konfigurasi sertifikat non-loopback belum                                               |
| F-10        | Egress container Strix ke host dan jaringan luar                  | PARTIALLY_VERIFIED     | `scripts/strix-egress-guard.sh` (apply/verify/teardown) diuji pada netns lokal dengan iptables `DOCKER-USER` nyata                                                     | Container Docker Strix nyata dan runner CI belum diuji. Strix nyata tidak dijalankan                                 |
| F-11        | Set `started` tumbuh tanpa batas                                  | VERIFIED (unit)        | `StartTracker` dipakai `app.ts`. 6 tes lifecycle lulus. Full suite lulus                                                                                               | Pengujian beban jangka panjang tidak dilakukan (di luar cakupan)                                                     |
| R-RED-1/2/3 | Redaksi: nama sensitif, nilai berspasi, `]]` yatim                | VERIFIED (unit+canary) | `redact.ts` diperbaiki, `redact.test.ts` + `security-redact.test.ts` + `redact-canary.test.ts` (61 tes) lulus                                                          | Secret canary sintetis saja. Pola provider baru tetap perlu ditinjau berkala                                         |
| F-13        | Klaim "Node 24 EOL 2026-09-07"                                    | WITHDRAWN              | Halaman nodejs.org (diambil 2026-10-09): Node 24 LTS, Node 22 LTS, Node 26 Current                                                                                     | Tanggal EOL resmi belum diverifikasi dari `nodejs/release`                                                           |

---

## 2. Detail per Temuan

### 2.1 F-04 — PARTIALLY_VERIFIED (kontrol repo terverifikasi; kontrol remote OPEN)

**Perubahan di repo** (`.github/workflows/strix-integration.yml`, ditulis ulang):

- Job `provision`: tanpa secret. Pemicu `workflow_dispatch` dan `pull_request`. Hanya membangun dan memeriksa.
- Job `strix-live`: `environment: strix-live`. Hanya berjalan bila dispatch dengan `run_scan=true` **dan** ref `main`. Guard dipasang sebelum secret dipakai. Teardown memakai `always()`.
- `permissions: contents: read` di level workflow. `persist-credentials: false` pada checkout. Semua action dipin ke SHA.
- Tes kebijakan (`packages/security-strix/tests/egress-and-workflow.test.ts`) memeriksa per job dengan pemecahan berbasis indentasi. Tidak menambah dependensi baru.

**Bukti:**

- Tes kebijakan workflow lulus (16/16).
- **Kontrol negatif:** secret disisipkan ke job `provision`. 3 tes gagal, sesuai harapan. File dipulihkan dari salinan yang benar, lalu 16/16 lulus lagi.
- **Analisis statis (2026-10-09):**
  - `zizmor 1.30.1 --offline` pada `.github/workflows/`: 0 temuan. Catatan: mode `--offline` melewatkan audit yang membutuhkan API GitHub.
  - `actionlint 2.0.6` (port WASM resmi, dari npm): 0 temuan. Sebagai kontrol, file uji sintetis dengan injeksi `github.event.issue.title` menghasilkan 1 temuan, jadi linter aktif.
- **Pemeriksaan read-only pengaturan GitHub (2026-10-09):** `environments` = 0, `rulesets` = 0. Artinya environment `strix-live` **belum ada**.

**Yang belum terbukti dan OPEN:**

- Environment `strix-live` belum dibuat. **Peringatan untuk pemilik:** GitHub membuat environment secara otomatis saat pertama kali dirujuk, dan environment baru itu **tanpa aturan perlindungan**. Konfigurasi reviewer dan deployment branch harus selesai **sebelum** secret dipindahkan ke environment.
- Secret `STRIX_GEMINI_API_KEY` masih berada di level repo. Harus dipindahkan ke environment setelah perlindungan aktif, lalu repo secret dihapus.
- Belum ada dispatch. Workflow `strix-live` belum pernah berjalan di GitHub.
- Catatan: `if: github.ref` di dalam file tidak melindungi sendirian. Penegakan nyata ada di environment (reviewer, deployment branch policy).

### 2.2 F-05 — PARTIALLY_VERIFIED (library dan browser runtime; jalur TLS/SNI BLOCKED)

**Penyebab:** `checkUrlInScope` me-resolve DNS saat pengecekan, lalu klien berikutnya me-resolve lagi. Ada celah rebinding.

**Perbaikan (`packages/core/src/pinned-http.ts`):**

- Setiap hop redirect dicek scope, lalu GET dilakukan ke alamat hasil cek dengan `pinnedLookup`. Tidak ada resolusi ulang.
- Menambah `signal` (pembatalan), total timeout, dan `agent: false`.
- `browserPinArgs` (mode remote): `--host-resolver-rules=MAP <host> <ip>,MAP * ~NOTFOUND`. IPv6 memakai kurung siku. Mode local-fixture tidak berubah.
- Scope ditolak sebelum browser dibuka.

**Bukti:**

- Unit dan integrasi loopback: `pinned-http.test.ts` (10 tes lama, tidak diubah) dan `pinned-http-hardening.test.ts` (17 tes baru: rebinding per hop, total timeout, pembatalan, batas redirect, variasi URL, server trickle). Total 27 lulus.
- **Timeout total dibuktikan dengan server trickle** (mengirim byte pelan-pelan). Server diam tidak valid sebagai bukti, karena idle timeout ikut aktif dan menutupi timeout total.
- **Kontrol negatif:** versi tanpa total deadline. Tes trickle gagal setelah 10005 ms. File dipulihkan dan dibandingkan dengan `cmp`.
- **Runtime Chromium nyata:** `packages/browser-qa/tests/pin-runtime.test.ts` (3 tes, `REQUIRE_BROWSER_TESTS=1`) lulus. Tes ini sempat gagal di CI karena Chromium Playwright juga meminta `/favicon.ico` ke host yang dipin. Tes sekarang memeriksa dokumen `/` tepat satu kali dan Host asli untuk setiap request. Host lain dan IP literal tetap nol request. `MAP * ~NOTFOUND` juga memblokir IP literal `127.0.0.1` yang tidak dipin (`ERR_NAME_NOT_RESOLVED`). Ini fail-closed, dan tes disesuaikan terhadap perilaku ini.

**Yang belum terbukti (BLOCKED):**

- Jalur TLS/SNI dengan sertifikat tidak tepercaya belum diuji. Pin DNS harus dicek bersama validasi sertifikat untuk host asli, dan itu belum ada bukti.
- Runtime end-to-end (run penuh dari API sampai browser) belum diuji.

**Koreksi klaim lama:** laporan lama menyebut "FIXED (library), severity Low latent" dan "Chromium di sandbox hang". Keduanya tidak akurat untuk kondisi sekarang. Status diturunkan menjadi PARTIALLY_VERIFIED. Chromium nyata sekarang berjalan (binary berada di `/tmp/chr`, di luar repo). Severity Low latent dari putaran 2 tetap berlaku karena jalur API remote untuk modul browser diblokir `buildRunPlan` (`REMOTE_NOT_ENFORCEABLE_MODULES`).

**Perubahan perilaku yang dicatat:** link checker tidak lagi memakai cookie atau sesi browser. Ini perlu dicatat bila link checker nanti butuh halaman yang login.

### 2.3 F-06 — PARTIALLY_VERIFIED (integrasi Chromium nyata lulus)

**Temuan asli (H2):** daftar bypass lama `localhost;127.0.0.1;[::1]` membuat Chrome mengirim request loopback langsung tanpa proxy. Dibuktikan dengan `<img>` (secondaryHits = 1 tanpa proxy).

**Perbaikan (`packages/lighthouse/src/egress-proxy.ts`, `lighthouse.ts`):**

- Proxy forward lokal per run. Hanya origin target yang diteruskan (pasangan host:port yang sama persis). Default tolak. Tidak ada wildcard.
- Flag: `--proxy-server=<proxy per run>` dan `--proxy-bypass-list=<-loopback>`. Semua request, termasuk loopback, lewat proxy.
- Catatan: putaran 2 memakai `--proxy-server=http://127.0.0.1:1`. Konfigurasi itu sudah diganti dan tidak dipakai lagi.

**Bukti:**

- Tes proxy dan flag: `egress-proxy.test.ts` (9 tes), `egress-flags.test.ts` (4), `flags.test.ts`.
- **Integrasi Chromium nyata** (`egress-integration.test.ts`): target sah diakses, server sekunder mendapat 0 hit, dan penolakan tercatat untuk IPv4, `localhost`, dan `[::1]`.
- **Kontrol negatif:** 4/4 tes integrasi gagal bila proxy dinonaktifkan.
- Suite lighthouse dengan Chromium nyata: lulus (lihat bagian 3).

**Yang belum terbukti:** perilaku di runner CI, dan dampak bila host sertifikat non-loopback berbeda. Tidak ada runtime di GitHub.

### 2.4 F-10 — PARTIALLY_VERIFIED (netns lokal dengan iptables nyata)

**Perbaikan (`scripts/strix-egress-guard.sh`, ditulis ulang):**

- Mode `apply`, `verify`, dan `teardown`. Deteksi bridge, dukungan `ip6tables`, dan `ensure_chain` untuk `DOCKER-USER`.
- Aturan: container Strix tidak boleh forwarding keluar ke jaringan luar atau ke layanan host selain fixture yang diizinkan.
- Dipanggil di workflow hanya bila `run_scan=true`, setelah forwarder aktif dan sebelum integrasi nyata.

**Bukti runtime lokal (`scripts/test-strix-egress-netns.sh`, dengan sudo):**

- Namespace `nwb-ctr` dan `nwb-ext`, bridge `nwbtest0`, dan veth `nwbx-*`.
- Fase: kontrol, positif, negatif layanan host, negatif host eksternal, dan teardown. Semuanya lulus.
- Bukti sisi server: hitungan request di log layanan tidak bertambah pada layanan terlarang dan host eksternal setelah guard aktif.
- Setelah run: namespace dan proses http.server bersih. Tidak ada sisa aturan `DOCKER-USER`.
- Bug harness yang sudah diperbaiki: `ACCEPT` bridge yang disisipkan di atas lompatan `DOCKER-USER` melewati guard. Aturan itu sekarang dihapus, dan jangan disisipkan lagi di atas lompatan tersebut.
- **Ketergantungan pada policy FORWARD (diperbaiki setelah CI gagal):** harness lama mengandalkan `-P FORWARD ACCEPT` sandbox. Runner GitHub dengan Docker biasanya `DROP`. Harness lama gagal pada fase kontrol dengan "host eksternal tidak terjangkau (topologi tidak valid)". Ini sudah direproduksi secara lokal dengan `iptables -P FORWARD DROP`. Harness sekarang mencatat policy FORWARD dan menambahkan ACCEPT khusus topologi uji (`nwbtest0` <-> `nwbx-h`) di akhir chain. Aturan ini dihapus oleh cleanup. Dengan policy DROP, harness baru lulus dan tidak meninggalkan sisa.
- Pembungkus Vitest: `packages/security-strix/tests/egress-netns.test.ts` (aktif bila `NWB_NETNS_TESTS=1`, wajib bila `REQUIRE_NETNS_TESTS=1`).

**Yang belum terbukti (BLOCKED):**

- **Container Docker Strix nyata belum diuji.** Docker dan Strix tidak dijalankan di sandbox.
- Runner CI belum diuji.
- DNS dari container diblokir oleh aturan. Sandbox tidak memerlukannya karena `host.docker.internal` ada di `extra_hosts`, tetapi ini belum dibuktikan dengan Strix nyata.
- Asumsi bahwa agen LLM berjalan di proses host (berdasarkan `session_manager.py` dan `models.py` Strix v1.7.0) belum diuji.

### 2.5 F-11 — VERIFIED (unit lifecycle)

**Penyebab:** `started` (Set run yang sudah dijadwalkan) tidak pernah dihapus. Tumbuh satu entri per run selama proses hidup.

**Perbaikan:** logika dipindah ke `packages/web/src/start-tracker.ts` (`StartTracker.startOnce`). Entri dihapus setelah promise start selesai, baik sukses maupun gagal. Dedupe selama start masih tertunda tetap dipertahankan.

**Keamanan tidak bergantung pada pelacak ini saja.** Orchestrator menolak start kedua untuk run aktif (`controllers`) dan menolak run yang tidak berstatus `QUEUED` (`execute` melempar `CONFLICT`). Jadi pemanggilan ulang untuk run yang sudah selesai tidak menjalankan ulang.

**Bukti:** `packages/web/tests/start-tracker.test.ts` (6 tes): dedupe selama tertunda, pembersihan setelah sukses dan setelah gagal, start yang melempar sinkron, 200 run tanpa kebocoran, dan pembersihan tidak mengganggu run lain.

### 2.6 Redaksi — VERIFIED (unit dan canary sintetis)

Perbaikan di `packages/core/src/redact.ts`:

- **Nama sensitif dicocokkan per kata** (camelCase, snake_case, kebab-case), bukan substring mentah. `session`, `cookie`, `auth`, `credential`, `signature`, `sig`, `sid`, `pwd`, dan lainnya sekarang tersensor di teks bebas. Sebelumnya hanya nama tertentu yang dikenali.
- **Nilai bertanda kutip** memahami escape (`\"`) dan spasi. Sebelumnya sisa nilai bisa bocor.
- **Pasangan di dalam nilai** tetap diperiksa (`note=password: x` sekarang menyensor `x`).
- **JSON valid:** kunci sensitif disensor di setiap level, termasuk nilai objek atau angka. Format asli dipertahankan bila hasil regex sudah setara.
- **DoS pada redaksi (ditemukan dan diperbaiki dalam putaran ini):** regex key-value dan EMAIL memulai pencocokan di setiap posisi, sehingga teks panjang tanpa pemisah berjalan O(n²). Pengukuran sebelum perbaikan: 80 KB `a` → 28 detik, 20 KB → 1,7 detik. Redaksi dipanggil pada output yang bisa dikendalikan pihak lain (stdout/stderr, pesan error, hasil scan), sehingga ini risiko ketersediaan nyata. Perbaikan: lookbehind di batas token, dan nilai dibaca oleh pemindai linear. Setelah perbaikan: 80 KB → 2 ms, 400 KB → 9 ms. Regresi dijaga oleh 4 tes performa (batas 3 detik).
- **Cacat kosmetik R-RED-3 diperbaiki:** `cookie: [REDACTED]]` menjadi `cookie: [REDACTED]`.
- URL: query sensitif dan userinfo dihapus. Nilai query tersensor ditulis sebagai `%5BREDACTED%5D` (perilaku ini sudah ada sebelumnya).

**Trade-off yang disengaja:** nama yang diawali kata sensitif ikut tersensor. Contoh: `secretary` dan `sessionCount`. Lebih baik over-redaction daripada kebocoran.

**Bukti:** `redact-canary.test.ts` (38 kasus canary sintetis: `CANARY-*`, bukan secret nyata), dan tes nama mirip yang tidak boleh tersensor (`author`, `tokenizer`, `keyboard`, `monkey`, `passageCount`). Total 61 tes redaksi lulus (termasuk 4 tes performa).

**Batasan:** regex dan canary tidak membuktikan redaksi lengkap. Pola provider baru tetap perlu ditinjau berkala.

### 2.7 F-13 — WITHDRAWN (koreksi)

Klaim "Node 24 EOL 2026-09-07" dicabut. Halaman nodejs.org (diambil 2026-10-09) menampilkan Node 24 sebagai LTS, Node 22 sebagai LTS, dan Node 26 sebagai Current. Tanggal 2026-09-07 berasal dari kolom "Last updated". Pin tetap Node 24. Tanggal EOL resmi belum diverifikasi dari `nodejs/release`.

---

## 3. Verifikasi (kode final putaran ini)

Semua angka di bawah berasal dari run pada kode final, dengan log di `/tmp/probes/`.

| Perintah / tes                                                                                                                   | Hasil                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm run lint` (`--max-warnings=0`)                                                                                              | exit 0. Sebelumnya 21 error (`no-non-null-assertion`, `prefer-const`, import tidak terpakai): diperbaiki |
| `npm run typecheck`                                                                                                              | exit 0. Sebelumnya 1 error (`executablePath` bertipe `string \| undefined`): diperbaiki                  |
| `npx prettier --check packages scripts .github`                                                                                  | All matched files use Prettier code style                                                                |
| `CI=true npm run check` (format, lint, typecheck, tes, secret-scan)                                                              | **exit 0**. Tes 629 lulus, 47 dilewati, 676 total. `secret-scan` 0 temuan (170 berkas)                   |
| Suite browser seperti job CI (`REQUIRE_BROWSER_TESTS=1 NWB_CHROME_NO_SANDBOX=1`, seluruh suite)                                  | **669 lulus, 7 dilewati**, exit 0 (Chromium lokal, bukan Playwright CI)                                  |
| `CHROMIUM_PATH=… REQUIRE_BROWSER_TESTS=1 npx vitest run packages/browser-qa packages/lighthouse packages/core/tests/pinned-http` | **103 lulus**, 0 gagal, exit 0 (Chromium nyata)                                                          |
| `NWB_NETNS_TESTS=1 REQUIRE_NETNS_TESTS=1 npx vitest run packages/security-strix`                                                 | **37 lulus, 1 dilewati** (`strix.real.optin`, opt-in dan tidak dijalankan), exit 0 (netns nyata, sudo)   |
| `zizmor --offline .github/workflows/`                                                                                            | 0 temuan (statis)                                                                                        |
| `actionlint` (WASM 2.0.6) pada `.github/workflows/*.yml`                                                                         | 0 temuan (statis)                                                                                        |

**Tes yang dilewati dan alasannya:** tes yang bergantung env (Chromium, netns, Strix nyata, live provider) dilewati pada run default. Jalankan dengan env opt-in untuk memverifikasinya. Strix nyata dan live provider **tidak dijalankan** dan tidak akan dijalankan tanpa persetujuan eksplisit per run.

**Catatan jujur tentang F-05 dan F-06:** angka 27 dan 9 tes adalah jumlah tes yang ada. Lulusnya tes berarti kontrol bekerja pada cakupan tes itu, bukan bahwa seluruh jalur sudah aman.

---

### 3.1 Bukti CI pada commit `5347f6c` dan perbaikannya

Commit `5347f6c` di-push ke `arena/48bd00ed-nusawebbench`. Run CI (push dan pull_request) **gagal**. Basis `9be88dd` lulus di CI. Log per job tidak bisa diunduh dari sandbox (`EOF` pada blob storage). Penyebab diambil dari anotasi check-run lewat API, dan dari reproduksi lokal.

| Job (run 5347f6c)                          | Penyebab yang terbukti                                                                                                                    | Perbaikan                                                                                                                | Verifikasi ulang lokal                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Quality gates                              | `secret-scan` 3 temuan pada `redact-canary.test.ts` (baris canary `password` dan `secret` tertulis utuh)                                  | Canary dibangun saat runtime dari potongan, sesuai konvensi `tests/unit/secret-scan.test.ts`. Scanner tidak dilonggarkan | `CI=true npm run check` exit 0. secret-scan 0            |
| Tes browser (Chromium Playwright)          | `pin-runtime.test.ts:60` `expected 2 to be 1`: Chromium juga meminta `/favicon.ico` ke host yang dipin                                    | Tes memeriksa dokumen `/` tepat satu kali dan Host asli untuk setiap request. Host lain tetap nol request                | Suite browser seperti CI lulus. pin-runtime 3/3 (3 kali) |
| Strix integration, job `provision` (netns) | Lihat F-10: harness bergantung pada policy FORWARD ACCEPT. Runner Docker biasanya DROP. Reproduksi lokal menghasilkan kegagalan yang sama | Aturan ACCEPT khusus topologi uji di akhir chain, dihapus oleh cleanup                                                   | Netns lulus pada policy ACCEPT dan DROP. Tidak ada sisa  |

Catatan: penyebab netns di runner adalah dugaan kuat yang direproduksi, bukan log CI. Konfirmasi final dilakukan dengan run CI berikutnya. Job `strix-live` tetap tidak berjalan (tidak ada dispatch).

---

## 4. Yang Tidak Dijalankan atau OPEN

| ID   | Item                                                                                                           | Status  | Alasan                                                                                  | Langkah berikutnya                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| F-04 | Environment `strix-live`, reviewer, deployment branch `main`, pemindahan secret, hapus repo secret             | OPEN    | Perubahan GitHub butuh otorisasi terpisah. Environment belum ada (verifikasi read-only) | Pemilik repo membuat environment dengan perlindungan **sebelum** secret dipindahkan                            |
| F-04 | Ruleset atau branch protection untuk `main`, pembatasan dispatch                                               | OPEN    | Tidak diverifikasi (rulesets = 0 pada pemeriksaan read-only). Tidak diubah              | Pemilik repo menentukan dan menerapkan                                                                         |
| F-05 | TLS/SNI dengan sertifikat tidak tepercaya, runtime end-to-end                                                  | BLOCKED | Belum ada skenario uji                                                                  | Tambahkan tes integrasi dengan sertifikat lokal yang tidak tepercaya                                           |
| F-06 | Runtime di runner CI dan sertifikat non-loopback                                                               | BLOCKED | Belum ada runner dengan Chromium                                                        | Jalankan di CI dengan persetujuan                                                                              |
| F-10 | Container Docker Strix nyata dan runner CI                                                                     | BLOCKED | Docker dan Strix tidak dijalankan. Run Strix butuh persetujuan                          | Jalankan di runner Linux dengan Docker dan persetujuan run. Pastikan DNS container dan sandbox tetap berfungsi |
| —    | Strix nyata, tes live Gemini/Groq, dispatch GitHub Actions                                                     | OPEN    | Tidak ada persetujuan run dan kunci                                                     | Persetujuan eksplisit per run, dengan biaya dibatasi                                                           |
| —    | Idempotensi memori (R-WEB-2, R-AI-1), ENOSPC, retensi (R-RET-1), persetujuan patch (R-PATCH-1), `.tmp-*` yatim | OPEN    | Belum dikerjakan dalam putaran ini                                                      | Dijadwalkan di putaran berikutnya                                                                              |

Browser nyata: binary Chromium berada di `/tmp/chr` (di luar repo) dan sekarang berjalan untuk tes browser. Percobaan yang gagal sebelumnya (zygote crash, `--single-process`, `--dump-dom`) tidak dipakai ulang.

---

## 5. Temuan Tambahan (Fase 2)

- **Environment otomatis tanpa perlindungan** (lihat 2.1). Risiko operasional: secret bisa dipindahkan ke environment yang belum dilindungi.
- **`ALLOW_EXTERNAL_BIND` fail-closed** dan peringatan `ALLOWED_HOSTS` sudah didokumentasikan di ADR-0005 (C3, C4 dari putaran sebelumnya).
- **`/api/runs/%E0%A4%A` (persen-encoding rusak)** sekarang menghasilkan 400 `VALIDATION_FAILED` (C2 dari putaran sebelumnya).
- **H3 (Info):** POST JSON tanpa header `Origin` lolos. Dibatasi oleh pemeriksaan content-type. Tidak diubah.
- **H4 (Low):** `started` tumbuh per run. Sudah diperbaiki (F-11).
- **H5, H7, dan R-AI-Q** belum diverifikasi runtime.

---

## 6. Rekomendasi Remote (perlu otorisasi terpisah, tidak dieksekusi)

Checklist untuk pemilik repo. Tidak ada yang diubah oleh agen.

1. **Buat environment `strix-live`** dengan:
   - required reviewers (minimal satu maintainer tepercaya);
   - deployment branch policy: hanya `main`;
   - **sebelum** secret dipindahkan.
2. **Pindahkan `STRIX_GEMINI_API_KEY`** dari repo secret ke environment `strix-live`, lalu hapus repo secret tersebut.
3. **Ruleset untuk `main`:** wajibkan pull request dan status check `quality`, batasi push dan dispatch.
4. **Kebijakan Actions:** batasi ke action GitHub-owned dan SHA yang dipin.
5. **Akses dispatch:** batasi write access pada repo publik ke maintainer tepercaya.
6. **Verifikasi setelah perubahan:** jalankan ulang pemeriksaan read-only `environments` dan `rulesets`, lalu catat hasilnya di laporan ini.

---

## 7. Proses dan Commit

- **Reset Git (putaran 1, dilaporkan sesuai aturan):** branch lokal semula di `b3cc1a8` dengan file untracked. Working tree dibackup ke `/tmp/nwb-worktree-backup-1791543071.tar`, lalu `git reset --mixed origin/arena/48bd00ed-nusawebbench` dijalankan. Tidak ada `--hard`, `clean`, atau force-checkout.
- **Resolusi lock vitest (putaran 1):** npm 10.9.8 crash saat resolve vitest 4.1.11. Subtree di-resolve dengan npm 11 di `/tmp/vt`, lalu digabung. `npm ci` membuktikan lock sinkron.
- **Tidak ada** push ke `main`, merge, force-push, atau perubahan remote GitHub dalam putaran ini.
- **Tidak ada** dispatch workflow, pembuatan environment, atau perubahan secret.
- Berkas sementara di `/tmp` (`/tmp/chr`, `/tmp/vt`, `/tmp/probes`, `/tmp/al`) berada di luar repo.
- Commit dan push: lihat ringkasan di chat. Hash commit akhir dicatat di sana, bukan di laporan ini, karena laporan ini ikut di-commit.
