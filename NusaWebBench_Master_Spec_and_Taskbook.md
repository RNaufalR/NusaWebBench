# NusaWebBench — Master Specification & Execution Taskbook

> **Dokumen sumber kebenaran untuk AI coding agent.** Gunakan dokumen ini sebagai spesifikasi produk, arsitektur, keamanan, implementasi, audit kode, dan kriteria penerimaan. Bangun produk bertahap, buktikan setiap klaim dengan hasil yang benar-benar diperoleh, dan jangan menandai task selesai tanpa melewati seluruh gerbang audit.
>
> **Target biaya:** Rp0/USD 0 untuk jalur inti dan penggunaan rutin yang masih berada dalam kuota gratis. Ini adalah target desain, bukan jaminan bahwa provider eksternal akan selalu gratis atau selalu tersedia.
>
> **Target kualitas:** aplikasi lokal yang bisa dipasang, diuji, dijalankan, diaudit, dan menghasilkan laporan yang dapat direproduksi. Dokumen ini tidak mengizinkan agent mengklaim bahwa software bebas seluruh bug hanya karena satu rangkaian tes lulus.

---

## 0. Instruksi eksekusi untuk AI agent

### 0.1 Peran yang harus dijalankan

Bertindak sebagai gabungan **staff software engineer, product engineer, QA/test engineer, application-security engineer, reliability engineer, technical writer, dan auditor kode independen**. Tanggung jawab bukan sekadar menghasilkan banyak kode. Tanggung jawab utama adalah menghasilkan perubahan yang benar, aman, teruji, dapat dipelihara, dan sesuai tujuan produk.

### 0.2 Aturan kerja yang tidak boleh dilanggar

1. **Baca repository sebelum mengubahnya.** Periksa `README`, struktur direktori, `package.json`, lockfile, konfigurasi, tests, workflow CI, lisensi, status Git, branch aktif, dan perubahan yang sudah ada. Jangan menghapus atau menimpa pekerjaan pengguna.
2. **Buat rencana task yang dapat dilacak.** Gunakan ID task dari dokumen ini, dependency, status, bukti, command tes, dan blocker. Update `IMPLEMENTATION_STATUS.md` setiap kali ada perubahan status.
3. **Kerjakan task berukuran kecil dan berurutan.** Jangan mengerjakan banyak task yang saling bergantung sekaligus. Jangan membuat banyak branch atau sub-agent tanpa alasan teknis yang jelas. Jangan berpindah task sebelum task aktif lulus gerbang wajibnya, kecuali statusnya `BLOCKED` dan blocker telah didokumentasikan.
4. **Jangan mengarang bukti.** Jangan membuat log tes palsu, angka performa, screenshot, hasil API, status keamanan, benchmark, maupun penggunaan kuota seolah-olah nyata. Fixture sintetis wajib diberi label `synthetic/demo`.
5. **Jangan menyembunyikan kegagalan.** Jika command gagal, laporkan command dan hasil aktual, cari akar masalahnya, perbaiki bila berada dalam cakupan, lalu jalankan ulang. Jika environment menghalangi verifikasi, tandai `BLOCKED`—jangan mengubahnya menjadi `VERIFIED`.
6. **Audit seluruh baris kode yang terdampak pada setiap task.** Setelah implementasi, baca baris demi baris seluruh isi setiap file kode yang dibuat atau diubah, bukan hanya diff atau beberapa cuplikan. Baca pula seluruh file langsung terkait ketika diperlukan untuk memeriksa kontrak, alur kontrol, error handling, dan integrasi. Lakukan audit diff dan working tree untuk menemukan perubahan tak disengaja, file tak terlacak, serta artefak rahasia.
7. **Audit bukan sekadar menjalankan formatter.** Periksa logika, kondisi batas, kontrol akses, kesalahan tipe, exception, resource cleanup, input validation, logging, privasi, performa, aksesibilitas, dan kemungkinan regresi. Formatter/linter tidak menggantikan code review.
8. **Uji perubahan secara proporsional dan integrasi.** Jalankan unit test, integration test, security test, lint, typecheck, dan build yang relevan. Setelah setiap task, jalankan pula regression suite yang berkaitan dengan kontrak yang disentuh. Sebelum rilis, jalankan seluruh suite yang tersedia.
9. **Jangan mengasumsikan provider, model, command, atau versi masih sama.** Verifikasi dokumentasi resmi saat implementasi, catat versi yang benar-benar dipakai, dan jangan menanam nama model yang belum diperiksa ke kode.
10. **Jangan memakai layanan berbayar secara diam-diam.** Mode default adalah `FREE_TIER_LOCK=true`. Jangan mengaktifkan route model berbayar, fitur tambahan berpotensi berbiaya, cloud runner, atau layanan hosted tanpa opt-in eksplisit. Jika status harga/kuota tidak bisa diverifikasi, jangan mengklaimnya gratis.
11. **Utamakan safety dan data pengguna.** Hanya scan target dengan izin eksplisit; jangan melakukan aktivitas destruktif; jangan mengeksfiltrasi data; jangan mengirim secret atau data sensitif ke provider AI.
12. **Jangan mengeksekusi output AI secara langsung.** Output AI adalah data tak tepercaya. Jangan jadikan teks AI sebagai perintah shell, URL tujuan, query SQL, selector tanpa validasi, atau patch yang otomatis di-merge/deploy.
13. **Tidak ada klaim “100% aman”, “tanpa bug”, atau “AI-generated pasti”.** Gunakan hasil yang terukur, confidence, ruang lingkup yang diuji, dan keterbatasan yang jelas.
14. **Selesaikan task dengan laporan ringkas yang dapat diaudit.** Cantumkan file yang berubah, alasan, command yang benar-benar dijalankan, pass/fail, audit baris demi baris, risiko tersisa, serta status task berikutnya.

### 0.3 Apa arti “maksimal” dalam setiap task

“Maksimal” berarti mencapai semua acceptance criteria yang ditentukan, menutup edge case yang relevan, mengintegrasikan perubahan ke sistem, menambah tes regresi, mengaudit seluruh isi file terkait, memperbarui dokumentasi, dan menyerahkan bukti. **Bukan** berarti menambah fitur di luar scope, membuat abstraksi yang tidak diperlukan, atau menghabiskan kuota AI tanpa batas.

### 0.4 Protokol saat repository sudah berisi kode

- Jangan menginisialisasi ulang repository dan jangan mengganti stack sebelum audit awal menyatakan alasan teknisnya.
- Jika struktur sekarang telah memenuhi spesifikasi, pertahankan dan dokumentasikan keputusan tersebut.
- Jika ada konflik, tulis keputusan di `docs/decisions/` (ADR) beserta opsi, alasan, dampak, dan migrasinya.
- Periksa `git status --short --branch` sebelum dan sesudah task. Jangan reset, clean, checkout paksa, atau menghapus perubahan pengguna.
- Jika task terlalu besar, pecah menjadi subtugas kecil dengan ID turunan (`T-040a`, `T-040b`), acceptance criteria individual, dan dependency yang jelas.

---

## 1. Ringkasan produk

### 1.1 Nama

**NusaWebBench** — toolkit evaluasi dan perbaikan kualitas website berbasis bukti, dengan mode lokal sebagai standar.

### 1.2 Masalah yang diselesaikan

Pengembang website membutuhkan satu alur yang konsisten untuk mengetahui apakah website:

- berjalan dan berfungsi sebagaimana mestinya;
- memiliki error browser, resource gagal, link bermasalah, atau form yang tidak berfungsi;
- memiliki masalah performa atau aksesibilitas yang terukur;
- menunjukkan inkonsistensi visual, konten template-like, placeholder, atau pola repetitif yang pantas ditinjau manusia;
- tetap merespons di bawah **beban simulasi terbatas dan berizin**;
- memiliki temuan keamanan yang bisa diverifikasi melalui adapter keamanan terpisah;
- benar-benar membaik setelah patch, tanpa memperkenalkan regresi lain.

NusaWebBench menyatukan hasil dan bukti dari alat deterministik, bukan menggantikan semua alat tersebut dengan LLM.

### 1.3 Sasaran utama

1. Jalur inti bekerja lokal tanpa API key dan tanpa akun cloud.
2. Gemini API dan Groq API adalah provider AI pertama yang diintegrasikan secara opsional.
3. Semua fitur berbiaya/berisiko lebih tinggi dinonaktifkan atau dibatasi secara default.
4. Temuan bisa dilacak ke evidence, run, konfigurasi, versi tool, waktu, dan metode.
5. Sebuah temuan tidak dianggap selesai hanya karena AI menghasilkan rekomendasi atau patch.
6. Laporan membedakan `PASS`, `FAIL`, `WARN`, `SKIPPED`, `UNAVAILABLE`, `NOT RUN`, dan `ERROR`.
7. Produk dapat digunakan pada komputer dengan sumber daya terbatas melalui profil `low-resource`.

### 1.4 Non-goals / yang tidak boleh dijanjikan

- Bukan alat untuk menghitung trafik pengguna nyata hanya dengan URL. Trafik nyata memerlukan telemetry/log/analytics yang dimiliki atau diizinkan pemilik website.
- Bukan jaminan keamanan menyeluruh atau pengganti audit profesional.
- Bukan classifier yang memastikan sebuah website dibuat oleh AI. Fitur terkait hanya menyampaikan heuristic tentang pola repetitif/template-like.
- Bukan alat untuk menguji website orang lain tanpa izin.
- Bukan layanan SaaS berbayar, sistem multi-tenant publik, atau produk hosted yang wajib online pada MVP.
- Tidak membutuhkan pelatihan model, GPU, vector database, local LLM besar, atau sistem multi-agent kompleks.
- Tidak melakukan merge/deploy patch secara otomatis.

### 1.5 Prinsip produk

| Prinsip | Arti operasional |
|---|---|
| Evidence-first | Temuan harus terhubung ke bukti yang bisa ditinjau. |
| Deterministic-first | Nilai dan pass/fail utama berasal dari aturan/alat terukur. |
| Free-tier-first | Tidak ada fallback berbayar tersembunyi; penggunaan AI bisa dimatikan. |
| Local-first | Core run, database, dashboard, dan laporan dasar berjalan lokal. |
| Safe-by-default | Target, scope, redirect, subprocess, dan load test dibatasi. |
| Fail visibly | Modul gagal tidak dilaporkan sebagai sukses atau “aman”. |
| Modular | Provider atau tool yang gagal tidak menjatuhkan modul yang independen. |
| Reproducible | Simpan konfigurasi, versi tool, raw output, dan versi schema. |
| Human-approved changes | Patch, merge, dan deploy membutuhkan keputusan manusia. |

---

## 2. Batas biaya, free tier, dan provider AI

### 2.1 Definisi target free-tier

Sistem harus **berfungsi tanpa biaya eksternal** untuk instalasi lokal, penyimpanan, test fixture, functional QA, Lighthouse lokal, laporan, dan pengujian unit/integrasi. Gemini API dan Groq API digunakan hanya saat pengguna mengaktifkannya dan masih dalam batas plan/kuota mereka.

Tidak ada software yang bisa menjamin pihak ketiga tidak mengubah kuota, syarat akun, model yang tersedia, atau kebijakan data. Oleh karena itu:

- jangan hardcode klaim jumlah token/request gratis yang bisa kedaluwarsa;
- model ID dan capability dikonfigurasi;
- tampilkan waktu terakhir status/model diperiksa;
- sebelum rilis, verifikasi dokumentasi resmi dan akun/provider dashboard;
- jangan menyatakan sebuah request “gratis” jika tarif/model/provider belum dapat diverifikasi;
- untuk menjaga biaya, fail closed jika `FREE_TIER_LOCK=true` dan provider/model tidak termasuk allowlist yang disetujui pengguna;
- jangan mengaktifkan billing, paid model, cloud runners, search grounding, hosted dashboard, atau layanan ekstra secara otomatis.

### 2.2 Provider yang ditargetkan

#### Gemini API

Gunakan Gemini API sebagai opsi utama untuk pekerjaan yang membutuhkan analisis visual atau sintesis konteks, **hanya jika model yang dipilih benar-benar mendukung kemampuan tersebut**. Integrasi harus memakai SDK/API resmi yang sesuai dan versi dependency yang dikunci melalui lockfile.

Persyaratan:

- Simpan key di environment server, misalnya `GEMINI_API_KEY`; jangan pernah mengeksposnya ke frontend.
- Nama model berasal dari konfigurasi dan harus diverifikasi saat setup.
- Batasi request, output tokens, gambar, ukuran input, retry, timeout, dan concurrency.
- Jangan mengirim seluruh repository, HTML penuh, cookie, secret, data personal, atau log mentah jika potongan minimal cukup.
- Berikan peringatan sebelum mengirim screenshot/log/source ke layanan eksternal.
- Dokumentasikan bahwa free-tier dapat memiliki ketentuan data yang berbeda dari paid tier; pengguna harus memeriksa kebijakan terbaru sebelum mengirim data privat.
- Bila model tidak mendukung image input atau structured output yang diperlukan, tandai capability tidak tersedia; jangan berpura-pura berhasil.

#### Groq API

Gunakan Groq API sebagai provider opsional untuk tugas teks, rangkuman log, penjelasan temuan, dan rekomendasi berformat terstruktur apabila model pilihan mendukungnya.

Persyaratan:

- Simpan key di environment server, misalnya `GROQ_API_KEY`.
- Jangan menganggap semua model Groq mendukung vision, tool calling, atau schema output yang sama.
- Validasi capability sesuai model yang digunakan.
- Hormati rate-limit header/`Retry-After` yang tersedia; batasi retry dan hentikan saat kuota habis.
- Jangan mengasumsikan kuota per model sama; status limit harus ditinjau ulang dari dokumentasi resmi.

#### Strix sebagai modul keamanan terpisah

Strix bersifat opsional dan tidak wajib untuk menjalankan MVP. Strix dapat memerlukan Docker, runtime, serta konfigurasi LLM yang kompatibel. Dukungan model/provider dan format LiteLLM harus diuji pada versi Strix yang benar-benar dipasang.

- Jangan menganggap Gemini API atau Groq otomatis kompatibel dengan setiap alur Strix hanya karena provider tercantum sebagai opsi.
- Jangan mengaktifkan Strix secara default pada komputer terbatas.
- Jangan mengizinkan model/fallback berbayar tanpa opt-in yang jelas.
- Strix dinyatakan `SKIPPED` atau `UNAVAILABLE` saat dependency/provider tidak siap—bukan `PASS` atau “secure”.
- Catat versi Strix, konfigurasi yang disanitasi, status run, penggunaan/biaya jika tersedia, dan batas scan.
- Jalankan dahulu pada fixture lokal yang sengaja dibuat rentan dan aman untuk pengujian.

### 2.3 Konfigurasi biaya (contoh nama; implementasikan dan dokumentasikan)

Gunakan konfigurasi server-side yang divalidasi saat startup. Nilai di bawah adalah **default proteksi awal**, bukan klaim tentang kuota provider:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=4178
DATABASE_PATH=./data/nusawebbench.sqlite
ARTIFACTS_DIR=./data/artifacts

FREE_TIER_LOCK=true
AI_PROVIDER=none
AI_FALLBACK_ENABLED=false
AI_ALLOW_EXTERNAL_DATA=false
AI_MAX_REQUESTS_PER_RUN=3
AI_MAX_REQUESTS_PER_DAY=20
AI_MAX_OUTPUT_TOKENS=800
AI_REQUEST_TIMEOUT_MS=20000
AI_MAX_RETRIES=1
AI_MAX_IMAGE_BYTES=1500000
AI_MAX_IMAGES_PER_RUN=3

GEMINI_API_KEY=
GEMINI_MODEL=
GROQ_API_KEY=
GROQ_MODEL=

STRIX_ENABLED=false
K6_ENABLED=false
LOW_RESOURCE_MODE=true
```

Implementation details:

- `AI_PROVIDER=none` harus menjadi default paling aman.
- `AI_PROVIDER=auto` hanya boleh dipilih pengguna secara eksplisit. Router tetap wajib mengikuti allowlist, capability, budget lokal, dan prioritas yang dikonfigurasi.
- Konfigurasi invalid harus menghasilkan pesan error yang jelas tanpa menampilkan secret.
- Jangan menganggap penghitung request lokal mengetahui total penggunaan key jika key dipakai di aplikasi lain. Labeli sebagai `local app usage`, bukan total akun provider.
- Penghitungan token hanya boleh disebut aktual bila berasal dari metadata provider; estimasi wajib diberi label `estimated`.
- Penghitung penggunaan lokal harus disimpan agar restart aplikasi tidak mereset batas harian. Jelaskan bahwa ini tetap bukan pembatas kuota global di provider.
- `AI_MAX_REQUESTS_PER_DAY` tidak boleh di-bypass ketika aplikasi restart atau ketika request dipanggil melalui route lain.
- Jangan retry pada `400`/invalid request atau model tidak kompatibel. Retry pada rate limit hanya terbatas, hormati `Retry-After`, dan setelah batas berakhir tetapkan `AI_UNAVAILABLE`.
- Default tidak mengirim dua provider untuk satu tugas. Evaluasi ganda hanya melalui mode eksperimen dengan persetujuan eksplisit.

### 2.4 Pemisahan core dan AI

Modul berikut harus tetap berguna tanpa AI: target validation, guard, orchestrator, Playwright functional tests, Lighthouse run, aturan UX deterministik, storage, status, scoring metrik, dan laporan dasar.

AI hanya menambah analisis opsional. Jika provider tidak tersedia:

1. tandai subtask AI `UNAVAILABLE` dengan alasan yang disanitasi;
2. lanjutkan modul independen yang aman;
3. tampilkan keterbatasan di dashboard dan laporan;
4. jangan mengganti output AI yang hilang dengan temuan atau angka palsu.

---

## 3. Stack dan batas dependensi

### 3.1 Stack yang direkomendasikan

Jika repository belum memiliki stack yang masuk akal, gunakan:

- **Runtime:** Node.js LTS yang didukung oleh dependency; versi harus dicatat dan dipin melalui `.nvmrc`/file setara.
- **Package manager:** npm workspaces; commit lockfile.
- **Frontend:** React + TypeScript + Vite.
- **Backend lokal:** Fastify + TypeScript.
- **Schema validation:** Zod atau validator tunggal yang sepadan, dipakai konsisten pada request/response dan konfigurasi.
- **Database:** SQLite lokal dengan migrasi versioned.
- **Unit/integration tests:** Vitest dan Supertest/Light-my-Request yang sesuai stack.
- **Browser automation:** Playwright, mulai dengan Chromium untuk profil low-resource.
- **Lighthouse:** CLI/library resmi yang versinya terkunci dan dijalankan berurutan.
- **Load test:** k6 OSS lokal, opt-in dan dibatasi.
- **Security test integration:** Strix melalui adapter optional, proses terisolasi.
- **Static quality:** TypeScript strict mode, ESLint, Prettier, dependency audit yang tersedia tanpa paid service.
- **Reporting:** HTML statis, JSON versioned, dan Markdown opsional.
- **CI:** workflow gratis yang menjalankan tes fixture tanpa API keys; jangan mewajibkan secrets cloud.

Versi dependency harus dipilih dari rilis yang kompatibel dan masih dipelihara saat pengerjaan. Catat alasan jika harus memakai versi non-terbaru karena kompatibilitas. Jangan mengandalkan versi yang belum diverifikasi.

### 3.2 Struktur direktori target

Sesuaikan dengan repository existing bila terdapat alasan teknis yang kuat. Jangan memaksa rename massal tanpa kebutuhan.

```text
/apps
  /web                    # React/Vite dashboard
  /api                    # Fastify server lokal
/packages
  /core                   # domain types, schemas, config, errors
  /storage                # SQLite, migrations, repositories
  /orchestrator           # run state machine and pipeline
  /adapters
    /playwright
    /lighthouse
    /k6
    /strix
    /ai-gemini
    /ai-groq
  /reporting              # HTML/JSON/Markdown export
  /rules                  # deterministic UX/quality checks
/fixtures
  /web-good
  /web-functional-bugs
  /web-a11y-issues
  /web-security-lab       # isolated, intentionally vulnerable test app
/tests
  /unit
  /integration
  /security
  /e2e
/docs
  /architecture
  /decisions
  /threat-model
  /testing
/data                    # local runtime artifacts; never commit generated user data
README.md
CONTRIBUTING.md
SECURITY.md
IMPLEMENTATION_STATUS.md
.env.example
.gitignore
package.json
package-lock.json
```

### 3.3 Aturan dependensi

- Setiap dependency baru harus punya alasan, status maintenance, lisensi, dan fungsi yang jelas.
- Hindari dua library untuk fungsi yang sama.
- Hindari dependency berat hanya untuk satu utilitas sederhana.
- Lockfile wajib sinkron; instalasi bersih harus lulus.
- Dependency security scanner boleh memberi temuan advisory; jangan membutakan CI dengan mengabaikan semua vulnerability. Pengecualian perlu alasan, scope, pemilik, dan tanggal review.
- Tidak ada telemetri tanpa opt-in dan dokumentasi.

---

## 4. Arsitektur aplikasi

### 4.1 Komponen utama

1. **Dashboard** — membuat/melihat run, konfigurasi, findings, bukti, before/after, status provider, dan laporan.
2. **API lokal** — memvalidasi request, menjalankan orchestration, serta melayani artefak dengan kontrol path yang aman.
3. **Target & Authorization Guard** — memeriksa URL, scope, DNS/IP, redirects, permintaan browser, serta batas beban/scan.
4. **Run Orchestrator** — state machine yang menjalankan modul, progress, cancellation, timeout, cleanup, dan resume aman bila diimplementasikan.
5. **Tool Adapters** — mengisolasi detail Playwright, Lighthouse, k6, Strix, Gemini, dan Groq dari domain core.
6. **Evidence Store** — menyimpan bukti lokal dan metadata versi/config.
7. **Rules & Scoring** — menghitung metrik dengan aturan versioned dan deterministik.
8. **Report Generator** — mengubah hasil menjadi HTML aman, JSON tervalidasi, dan Markdown opsional.
9. **Fix Verification** — baseline, diff patch proposal, retest, dan laporan regresi.

### 4.2 Prinsip integrasi

- Domain core tidak boleh bergantung pada SDK Gemini/Groq, Playwright, atau Strix secara langsung.
- Adapter berkomunikasi melalui interface versioned dan mengembalikan result terstruktur.
- Setiap modul memiliki status sendiri; error di satu modul tidak otomatis menggagalkan modul independen.
- Error yang mengancam keselamatan (mis. scope violation, SSRF risk, authorization missing) menghentikan tindakan terkait, bukan sekadar mencatat warning.
- Pipeline harus idempotent untuk transisi status dan tidak menghasilkan duplicate findings setiap kali report dibuka.
- Semua waktu disimpan dalam ISO 8601 UTC; UI menampilkan waktu lokal sesuai browser.
- Semua result mengandung `schemaVersion`, `runId`, `createdAt`, `toolName`, `toolVersion`, `status`, dan `durationMs` bila tersedia.

### 4.3 Kontrak domain minimum

Buat schema yang versioned dan diuji. Nama property boleh disesuaikan, tetapi maknanya tidak boleh hilang.

**Run**

- `id`, `schemaVersion`, `createdAt`, `startedAt`, `completedAt`;
- `targetId`, `targetOrigin`, `targetMode` (`url` / `repository` / `fixture`);
- `authorization` (acknowledged, scope hash/summary, waktu persetujuan; jangan simpan dokumen sensitif tak perlu);
- `configSnapshot` yang disanitasi;
- `status` (`QUEUED`, `RUNNING`, `CANCELLING`, `CANCELLED`, `COMPLETED`, `PARTIAL`, `FAILED`);
- `moduleResults[]`, `findingIds[]`, `artifactRefs[]`, `errorSummary` yang disanitasi.

**ModuleResult**

- `id`, `runId`, `module`, `status`, `startedAt`, `completedAt`, `durationMs`;
- `toolVersion`, `configSnapshot`, `metrics`, `findingIds[]`, `artifactRefs[]`;
- `errorCode`, `errorMessageSafe`, `retryCount`, `skippedReason`.

**Finding**

- `id`, `schemaVersion`, `runId`, `moduleResultId`, `category`, `title`, `description`;
- `severity` (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO`, `UNKNOWN`);
- `confidence` (numeric range yang tervalidasi), `verification` (`CONFIRMED`, `LIKELY`, `INFORMATIONAL`, `FALSE_POSITIVE`, `FIXED_VERIFIED`, `FIXED_UNVERIFIED`, `REGRESSION`);
- `targetUrl`/selector hanya jika aman, `evidenceRefs[]`, `reproductionSteps[]`, `expected`, `actual`;
- `remediation`, `createdAt`, `status`, `ruleId`/`ruleVersion`.

**Evidence**

- `id`, `runId`, `kind`, `pathRelative`, `mimeType`, `sizeBytes`, `sha256`, `createdAt`;
- `sourceTool`, `sourceVersion`, `description`, `redactionApplied`, `synthetic`;
- jangan menyimpan data sensitif secara default. Hindari `data:` URL besar pada database.

**ProviderUsage**

- `provider`, `modelId`, `taskType`, `requestCount`, `status`, `durationMs`;
- `inputTokens`/`outputTokens` hanya bila diberikan provider; `estimatedTokens` terpisah;
- `estimatedCost` hanya bila dihitung dari tabel harga bertanggal, dan selalu labeli estimasi;
- `localQuotaBucket`, `recordedAt`, `errorCode`, `fallbackFrom`;
- jangan simpan raw prompt berisi data website kecuali opt-in dan sudah direduksi/redaksi.

**RemediationProposal**

- `id`, `findingIds[]`, `repositoryRoot` (lokal, tidak di-publish), `baseRevision`, `patchPath`/diff reference;
- `status` (`DRAFT`, `READY_FOR_REVIEW`, `TESTING`, `VERIFIED`, `REJECTED`, `FAILED`);
- `testsBefore`, `testsAfter`, `regressions[]`, `approvedByUser`, `createdAt`;
- status `VERIFIED` hanya bila tes relevan lulus dan bukti before/after sebanding.

### 4.4 Validasi kontrak

- Validasi semua input API dan semua output adapter saat runtime.
- Schema JSON harus memiliki `schemaVersion` dan migrasi/compatibility policy.
- Data dari AI dan tool eksternal tidak boleh dipercaya otomatis.
- Data invalid ditolak dengan error yang jelas, dicatat tanpa membocorkan data, dan tidak diteruskan ke subsistem berikutnya.
- Uji schema dengan kasus valid, invalid, properti ekstra, string sangat panjang, nilai NaN/Infinity, path traversal, serta payload yang salah bentuk.

---

## 5. Model ancaman dan persyaratan keamanan

### 5.1 Target dan scope

NusaWebBench adalah alat audit berizin. Semua mode remote harus memiliki guard ketat.

- Default hanya fixture/localhost yang dipilih secara eksplisit sampai pengguna mengonfigurasi remote target.
- Untuk target remote, minta konfirmasi kepemilikan/izin, tampilkan origin, modul, efek, jumlah request/batas beban, dan durasi sebelum run.
- Scope minimum adalah origin yang disetujui. Host/subdomain lain tidak ikut otomatis.
- Setiap redirect diperiksa ulang; redirect ke origin di luar scope dihentikan.
- Default blokir `file:`, `ftp:`, `data:`, `javascript:`, protokol selain HTTP(S), host yang tidak valid, userinfo dalam URL, dan port yang tidak diizinkan.
- Cegah SSRF: blok alamat loopback/private/link-local/metadata pada target remote; resolve dan validasi IP; verifikasi request redirects dan DNS changes sesuai kemampuan stack. Jangan mengandalkan pemeriksaan string hostname saja.
- Localhost diizinkan hanya ketika mode fixture/local dipilih eksplisit. Jangan memperluas pengecualian localhost ke jaringan privat.
- Browser subrequests, navigation, iframe, download, WebSocket, dan resource requests harus tunduk pada policy scope yang terdokumentasi.
- Jika enforcement scope tidak dapat menjamin batas remote, blokir mode tersebut atau batasi ke fixture lokal.

### 5.2 Data dan secret

- `.env`, database lokal, artifacts pengguna, screenshots sensitif, dan log jangan pernah di-commit.
- Masking berlaku untuk `Authorization`, cookies, API keys, password fields, query parameters yang teridentifikasi sensitif, token, email, nomor identitas, dan data personal lain yang diketahui.
- Redaksi harus diuji dengan secret canary sintetis; jangan hanya mengandalkan regex tanpa test.
- Key tidak boleh masuk frontend bundle, URL, stack trace, log, report, browser storage, atau prompt yang tidak perlu.
- Backend bind ke `127.0.0.1` secara default. Jika user mengaktifkan bind eksternal, tampilkan peringatan keamanan dan minta konfigurasi proteksi yang eksplisit.
- Jangan menyimpan raw prompt/response AI secara default; simpan metadata, schema output yang diperlukan, dan ringkasan yang telah direduksi.
- Informasikan bahwa provider eksternal memproses data yang dikirim, dan free tier dapat memiliki kebijakan penggunaan data yang berbeda. Minta opt-in sebelum pengiriman data website.

### 5.3 Proses eksternal, filesystem, dan report

- Jalankan subprocess dengan array argument terstruktur, bukan string shell yang dirangkai dari input pengguna.
- Validasi `cwd`, path, filename, URL, dan format output. Path artefak harus tetap berada di root artefak yang ditentukan setelah canonicalization/realpath checks.
- Batasi ukuran response, ukuran screenshot, jumlah halaman, kedalaman crawl, durasi proses, CPU concurrency, memory pressure sejauh bisa dikendalikan, serta ukuran artifacts.
- HTML report harus escape output tak tepercaya; jangan menyisipkan string AI/website ke HTML sebagai markup langsung.
- JSON report harus valid UTF-8 dan ditulis atomik agar file tidak setengah tertulis saat dibaca.
- Cegah file overwrite lintas run dengan ID run yang unik dan path isolation.
- Terapkan retention/cleanup dengan dry-run atau kebijakan eksplisit; jangan menghapus file pengguna di luar direktori artefak aplikasi.

### 5.4 Batas pengujian yang diizinkan

Dilarang mengimplementasikan atau memicu destructive payload, denial-of-service, brute force, credential stuffing, persistence, eksfiltrasi data, atau tindakan yang merusak layanan. Load test hanya menggunakan preset terbatas; stress test berat tidak termasuk MVP. Uji keamanan otomatis dilakukan pertama kali pada fixture lokal yang sengaja dibuat rentan.

### 5.5 Keamanan sebagai gerbang

Setiap temuan yang menunjukkan scope escape, SSRF, command injection, path traversal, secret leakage, atau load test yang tidak dibatasi adalah blocker berprioritas tertinggi. Jangan menandai task terkait selesai hanya karena tes fungsional lulus.

---

## 6. Alur run dan status

### 6.1 Alur utama

1. Pengguna memilih target/fixture dan mode audit.
2. UI menampilkan origin/scope, modul terpilih, risiko, batas beban, dan consent.
3. Server memvalidasi config, scope, origin, allowlist, dan kemampuan environment.
4. Orchestrator membuat record run dan snapshot config yang disanitasi.
5. Modul dijalankan berurutan pada profil low-resource. Parallelism hanya dibolehkan bila sudah dibuktikan aman dan tidak membebani perangkat.
6. Adapter menghasilkan result tervalidasi dan artifacts.
7. Rules/scoring mengolah data; modul gagal tetap ditampilkan.
8. Report disimpan dan bisa diekspor.
9. UI menunjukkan ringkasan kategori, findings, raw evidence, limitation, dan aksi retest.
10. Untuk retest, gunakan config/viewport/tool versions yang setara atau dokumentasikan perbedaan.

### 6.2 Status run

- `QUEUED`: tercatat, belum mulai.
- `RUNNING`: sekurangnya satu modul aktif.
- `CANCELLING`: cancellation diminta; proses cleanup belum selesai.
- `CANCELLED`: proses berhenti dan cleanup selesai.
- `COMPLETED`: seluruh modul wajib yang dipilih berhasil dijalankan; modul opsional yang dimatikan tetap dinyatakan `SKIPPED`.
- `PARTIAL`: sebagian modul berhasil, sebagian gagal/berhenti/tidak tersedia.
- `FAILED`: run tidak bisa menghasilkan hasil minimal karena kegagalan fatal.

### 6.3 Status modul

`QUEUED`, `RUNNING`, `PASS`, `FAIL`, `WARN`, `SKIPPED`, `UNAVAILABLE`, `CANCELLED`, `ERROR`, `NOT_RUN`.

Jangan menyamakan `SKIPPED` atau `UNAVAILABLE` dengan `PASS`. Jangan mengubah error tool keamanan menjadi hasil “secure”.

### 6.4 Cancellation dan cleanup

- Cancellation harus menghentikan scheduling task baru.
- Kirim signal penghentian yang sesuai ke child process, tunggu masa grace period terbatas, lalu terminate proses anak jika perlu.
- Jangan meninggalkan browser, proses k6, atau container yang berjalan tanpa kontrol.
- Simpan status final, durasi, dan alasan cancellation.
- Uji cancellation saat queued, browser aktif, tool eksternal aktif, dan saat penulisan report.

---

## 7. Spesifikasi fungsional per modul

### 7.1 Target intake dan authorization guard

Fungsi wajib:

- Menambahkan target URL/fixture; memvalidasi parsing URL kanonis dan skema HTTP(S).
- Menyimpan label target, origin, mode, tanggal persetujuan, dan daftar modul yang disetujui.
- Mengikuti redirect hanya jika target hasil redirect tetap berada di allowlist.
- Memblok alamat IP privat/metadata untuk remote scans.
- Memakai satu policy yang konsisten pada navigasi browser, request resource, Lighthouse, k6, dan Strix.
- Memberikan preview tindakan sebelum run.

Tidak boleh:

- Mengizinkan URL mentah langsung masuk ke shell.
- Mengizinkan redirect keluar scope tanpa konfirmasi baru.
- Mengandalkan checkbox consent sebagai satu-satunya proteksi jaringan.
- Scan target remote jika scope enforcement belum diuji.

### 7.2 Functional QA — Playwright

Cakupan MVP:

- Memastikan halaman awal merespons dan dapat dirender.
- Mendeteksi uncaught page errors, console error, request failure, response HTTP yang dipilih, serta link internal yang rusak.
- Mendukung daftar halaman/alur kritis yang diatur pengguna; crawl otomatis dibatasi depth dan page count.
- Menangkap screenshot pada viewport dan kondisi yang dapat direproduksi.
- Mendukung assertions sederhana: locator visible, text exists, URL/origin matches, form validation behavior, element count, dan custom user-defined selector dari config yang tervalidasi.
- Form hanya memakai data dummy. Jangan menekan tombol pembayaran, mengirim email/pesan publik, membuat akun pada layanan nyata, atau memicu aksi irreversible.
- Menyimpan langkah reproduksi, expected/actual, URL/selector yang sudah disanitasi, console logs yang direduksi, screenshot dan metadata.
- Untuk setiap test case, tampilkan status dan alasan; test yang tidak applicable bukan otomatis fail.

### 7.3 Performance & Accessibility — Lighthouse

- Jalankan hanya pada scope yang disetujui dan secara berurutan.
- Rekam versi Lighthouse, versi Chromium, OS/runtime, viewport, waktu, konfigurasi throttling, origin, dan raw report.
- Pisahkan kategori `Performance`, `Accessibility`, `Best Practices`, dan `SEO` (SEO dapat menjadi opsional); jangan gabungkan sebagai satu nilai kualitas tanpa penjelasan.
- Simpan metrik yang tersedia dari report aktual. Jangan merekonstruksi nilai jika report tidak tersedia.
- Tampilkan status `WARN` bila kondisi environment membuat skor tidak stabil atau run gagal sebagian.
- Jalankan jumlah iterasi kecil pada MVP. Multiple-run median/variance dapat ditambahkan jika runtime dan memori mencukupi.
- Jangan mengklaim bahwa Lighthouse membuktikan seluruh aksesibilitas atau UX telah baik.

### 7.4 UX, visual consistency, dan template-like heuristics

Lakukan analisis deterministik terlebih dahulu. Aturan awal boleh mencakup:

- gambar gagal dimuat atau tanpa alt text;
- heading kosong, duplikat, atau terlalu generik berdasarkan aturan yang dijelaskan;
- overflow horizontal pada viewport yang dipilih;
- link/tombol tanpa label yang dapat diakses;
- placeholder seperti `Lorem ipsum`, `TODO`, `Your Title Here`, atau contoh dummy yang tertinggal;
- teks konten/CTA duplikat pada konteks yang tidak semestinya;
- inkonsistensi style/spacing/button yang dapat dideteksi dari computed style secara terbatas;
- ukuran tap target atau kontras hanya jika perhitungan dan keterbatasannya terdokumentasi;
- repetisi struktur/layout lintas halaman yang diukur dengan heuristic yang dijelaskan.

Ketentuan:

- Setiap finding mencakup `ruleId`, versi rule, bukti, elemen/area, alasan, dampak yang mungkin, dan confidence.
- Hindari klaim bahwa sebuah desain “dibuat AI”. Gunakan istilah **template-like/repetitive-design signal** atau “indikasi pola repetitif”.
- Screenshot diff membutuhkan viewport, font, data, state, dan waktu yang konsisten; bila tidak identik, tandai comparison sebagai tidak sepenuhnya comparable.
- AI boleh memberikan komentar tambahan terhadap screenshot yang sudah diminimalkan/redacted, tetapi tidak mengganti hasil deterministik.
- Jika AI tidak tersedia, modul tetap menghasilkan rule findings dan menandai commentary AI `UNAVAILABLE`.

### 7.5 Load testing — k6 OSS

Load testing dinonaktifkan secara default dan selalu membutuhkan opt-in tersendiri.

- Default test hanya di fixture lokal.
- Remote target membutuhkan konfirmasi tambahan, scope ulang, dan preset limit yang terlihat di UI.
- Sediakan `dry-run`/preview yang menunjukkan URL, jumlah VU, arrival rate atau request rate, durasi, dan batas total request.
- Preset `low-load` awal sebaiknya sangat terbatas (contoh konservatif: satu virtual user, sekitar satu request per detik, maksimal 30 detik, dan request budget eksplisit); nilai akhir harus tervalidasi pada implementasi, bisa diubah turun, dan tidak boleh dinaikkan diam-diam.
- Tidak ada preset stress/spike/flood pada MVP.
- Implementasikan batas total request, max duration, max VU, kill switch, timeout, dan penghentian segera bila target scope berubah atau server menghasilkan sinyal overload yang ditentukan.
- Jangan jalankan k6 bersamaan dengan Lighthouse, Strix, atau browser audit secara default.
- Laporan harus menyebut ini adalah **simulated load**, bukan trafik pengguna nyata.
- Automated tests hanya memakai fixture lokal, dan memverifikasi bahwa preset di luar batas ditolak.

### 7.6 Security adapter — Strix

- Adapter bersifat opsional, nonaktif secara default, dan terpisah dari domain core.
- Sebelum integrasi, verifikasi versi Strix, instalasi, CLI contract, exit codes, schema output, sandbox behavior, provider configuration, timeout, dan batas anggaran yang benar-benar tersedia.
- Jangan menganggap `exit code 0` sendirian membuktikan target aman. Periksa status run dan report sesuai dokumentasi versi tersebut.
- Konfigurasi Gemini/Groq hanya boleh digunakan bila format provider, tool calling, dan capability terbukti berfungsi dalam smoke test lokal. Jika tidak, tandai tidak kompatibel; jangan menebak konfigurasi.
- Jalankan melalui child process dengan argumen terstruktur, cwd/temp path yang dibatasi, timeout, dan cancellation.
- Pengguna harus melihat model/provider terpilih, batas scan, lokasi target, dan risiko pengiriman kode/log ke luar mesin.
- Mulai dengan `fixtures/web-security-lab`; tidak boleh scan publik otomatis saat install/test.
- Parse output dengan schema lokal dan tandai finding sebagai `CONFIRMED`, `LIKELY`, atau `INFORMATIONAL` berdasarkan bukti yang tersedia.
- Jika Strix tidak tersedia, status `SKIPPED`/`UNAVAILABLE`; jangan menyatakan `PASS`.

### 7.7 AI insight adapters — Gemini dan Groq

Interface adapter minimum:

```ts
interface AIProviderAdapter {
  readonly providerId: 'gemini' | 'groq';
  getCapabilities(): ProviderCapabilities;
  healthCheck(): Promise<ProviderHealth>;
  generateText(input: TextTaskInput): Promise<AIResult<TextTaskOutput>>;
  analyzeImage?(input: ImageTaskInput): Promise<AIResult<ImageTaskOutput>>;
}
```

Interface boleh disesuaikan tetapi wajib mempertahankan pemisahan capability, input/output tervalidasi, status unavailable, dan error codes.

Syarat implementasi:

- Setiap request mempunyai timeout dan request ID internal.
- Validasi panjang prompt, jumlah gambar, MIME type, ukuran bytes, dan schema output.
- Redaksi secret sebelum request dikirim.
- Output JSON harus divalidasi; bila JSON invalid, jangan memasukkannya sebagai finding yang valid.
- Simpan usage metadata yang tersedia dan local request counter.
- Jangan log raw prompt/response secara default.
- Jangan menempatkan API key dalam query string atau frontend.
- Unit tests harus berjalan dengan fake provider tanpa jaringan.
- Test nyata terhadap API bersifat opt-in dan tidak wajib pada CI umum.

### 7.8 Report generator

Format minimum:

- `report.json`: schema versioned, data mentah yang sudah disanitasi, findings, metrics, module states, tool versions, limitations.
- `report.html`: ringkasan mudah dibaca, status setiap kategori, findings dan evidence, timestamps, scope, konfigurasi yang relevan, limitation, before/after jika tersedia.
- Markdown opsional untuk issue tracker/review.

Aturan report:

- Escape HTML dan kontrol URL yang dapat diklik.
- Jangan menyertakan key, cookie, password, authorization header, raw private source, atau data sensitif yang terdeteksi.
- Status `UNAVAILABLE`, `SKIPPED`, `NOT RUN`, dan `ERROR` harus ditampilkan terpisah dari hasil pass.
- Nilai yang hilang ditampilkan `N/A`, bukan nol.
- Tampilkan report generation version dan schema version.
- Report demo wajib berlabel synthetic.
- Report harus tetap bisa dibuka jika provider AI atau tool eksternal tidak tersedia.

### 7.9 Fix proposal dan regression verification

Pisahkan dua mode berikut.

**URL-only audit**

- Hanya memberikan temuan dan guidance.
- Tidak mengklaim bisa mengubah website live.
- Tidak menulis patch ke server target.

**Repository mode**

- Pengguna menunjuk repository lokal yang dimiliki/diizinkan.
- Simpan base revision dan status Git sebelum mengubah file.
- Jalankan baseline test yang tersedia dan catat hasil nyata.
- Buat branch/worktree atau copy yang terisolasi untuk patch proposal.
- Patch dibatasi pada finding yang dipilih dan harus mempunyai rationale.
- Tampilkan diff dan semua file yang terdampak.
- Jalankan unit, integration, functional, lint, typecheck, build, dan tes khusus finding sesuai ketersediaan.
- Jalankan security test yang relevan serta pastikan tidak ada secret dalam diff.
- Tampilkan regression baru, test failed, dan test not run secara eksplisit.
- Tidak boleh auto-commit, push, merge, atau deploy.
- Minta persetujuan pengguna sebelum menerapkan patch ke branch asli.
- Status `FIXED_VERIFIED` hanya bila regression/target assertion lulus pada kondisi sebanding dan ada evidence before/after. Jika tidak, gunakan `FIXED_UNVERIFIED`.

---

## 8. Scoring dan kualitas bukti

### 8.1 Kategori yang dilaporkan

- Functional
- Performance
- Accessibility
- Best Practices / SEO (berdasarkan tool yang digunakan)
- UX & Visual Heuristics
- Load / Simulated Load
- Security
- Remediation / Regression

Kategori tidak dijalankan harus `N/A` beserta alasan. Jangan menjadikan `N/A` sebagai 0 atau menghitungnya sebagai nilai buruk secara otomatis.

### 8.2 Severity

Severity adalah aturan operasional produk, bukan pengganti penilaian profesional:

- `CRITICAL`: dampak kritis yang didukung evidence kuat dan perlu ditinjau segera.
- `HIGH`: dampak tinggi dengan bukti yang cukup.
- `MEDIUM`: dampak sedang atau kondisi terbatas.
- `LOW`: dampak kecil/terbatas.
- `INFO`: catatan non-vulnerability atau improvement.
- `UNKNOWN`: evidence tidak cukup untuk menetapkan severity.

Jangan menaikkan severity hanya karena AI menuliskannya. Gunakan mapping deterministik per tool/rule yang dapat ditinjau.

### 8.3 Confidence dan verifikasi

- Confidence harus punya definisi yang terdokumentasi dan konsisten.
- AI confidence tidak sama dengan bukti kebenaran.
- Temuan yang berasal hanya dari penilaian subjektif AI tidak boleh disebut `CONFIRMED`.
- False positive harus dapat ditandai pengguna beserta alasan; jangan menghapus riwayatnya secara diam-diam.
- Critical/high yang terverifikasi harus tetap menonjol walau kategori lain memperoleh hasil baik.
- Jika ada overall score di masa depan, bobot dan aturan harus terdokumentasi, versioned, dan tidak boleh menutupi finding kritis.

### 8.4 Reproducibility

Simpan kondisi yang cukup untuk menjalankan ulang tes, tanpa menyimpan data sensitif berlebihan: versi tools, target origin, waktu, viewport, rule versions, preset, konfigurasi yang disanitasi, run seed jika relevan, commit hash bila tersedia, dan raw output yang aman.

---

## 9. Dashboard dan UX

### 9.1 Halaman minimum

1. **Overview:** run terbaru, status keseluruhan, kategori hasil, finding prioritas, modul gagal/skip, penggunaan API yang diketahui.
2. **New Audit:** target, mode, bukti izin, modul, preset low-resource, preview load/security, batas dan konsekuensi.
3. **Run Detail:** timeline, status modul, progress, cancel, log yang direduksi, artifacts.
4. **Findings:** filter category/severity/status/confidence, details, evidence, reproduction, remediation guidance.
5. **Before/After:** perbandingan baseline/retest, perbedaan konfigurasi, fix status dan regression.
6. **AI Provider Settings:** provider, model ID, capability, connection status, local usage limits, external data consent, error terakhir tanpa secret.
7. **Reports:** daftar report, export JSON/HTML/Markdown, dan retention.
8. **System/Diagnostics:** versi app/runtime/tool, disk space yang diketahui, dan kondisi dependency tanpa membocorkan environment sensitif.

### 9.2 Aksesibilitas dashboard

- Navigasi keyboard dan focus indicator yang terlihat.
- Label dan error untuk semua field.
- Status tidak hanya dibedakan lewat warna.
- Tabel/list findings dapat dipakai dengan pembaca layar.
- Jangan menampilkan API key lengkap saat input atau sesudah validasi.
- Confirm modal untuk load/security scans dan operasi patch.

### 9.3 Low-resource UI

- Default satu run aktif.
- Hindari chart berat dan rendering semua raw log sekaligus.
- Pagination atau limit untuk findings/logs.
- Tombol untuk membersihkan artifacts milik aplikasi dengan preview.
- Browser engine minimum pada default profile: Chromium tunggal.
- Keterangan jelas saat modul dilewati karena keterbatasan resource.

---

## 10. Testing strategy

### 10.1 Piramida tes

1. Unit: schemas, config, guards, scoring, state transitions, redaction, provider routing.
2. Integration: SQLite repositories, API routes, artifacts, orchestration, adapters berbasis stub.
3. Security: SSRF/scope/redirect checks, path traversal, injection, report escaping, secret leakage, limit enforcement.
4. Fixture end-to-end: dashboard → run → module results → report → retest.
5. Manual opt-in smoke tests: Gemini, Groq, k6, Strix, remote authorized target.

### 10.2 Tanpa key eksternal

CI default harus beroperasi tanpa API keys, provider accounts, Docker, akses Internet, atau k6 Cloud. Gunakan fake/stub untuk adapter. Tool lokal yang benar-benar diperlukan untuk test suite harus didokumentasikan dan dipisahkan dari tes unit dasar.

### 10.3 Aturan tes

- Tes harus memverifikasi perilaku, bukan hanya status `200`.
- Gunakan fixture deterministik dengan ground truth.
- Uji cabang error: timeout, cancellation, invalid payload, rate limit, tool missing, malformed output, database failure, artifact write failure, scope rejection.
- Hindari flakiness dengan menunggu kondisi, bukan tidur tetap tanpa alasan.
- Jangan mengurangi assertion atau menandai tes flaky sebagai skip hanya agar CI hijau.
- Jika test perlu skip karena environment, berikan alasan jelas dan pastikan CI menampilkan status tersebut.
- Catat command dan output aktual di status implementasi.

### 10.4 Audit baris kode per task — gerbang wajib

Sebelum setiap task diberi status `VERIFIED`, lakukan seluruh langkah ini:

1. **Inventarisasi:** catat seluruh file baru/ubah/hapus, file generated, migrasi, konfigurasi, dependency, fixtures, dan dokumentasi.
2. **Baca seluruh file kode yang berubah:** periksa semua baris dari awal sampai akhir; jangan hanya memakai diff, snippet, atau ringkasan agent. Untuk file panjang, gunakan pembacaan berurutan per bagian dan pastikan seluruh rentang sudah diperiksa.
3. **Review diff:** periksa setiap baris added/changed/deleted, whitespace, accidental file replacement, generated junk, debug code, TODO tak sengaja, dan kode yang tidak terkait task.
4. **Context review:** baca interface/caller/callee dan file konfigurasi langsung terkait. Pastikan kontrak API/schema, imports, error handling, cancellation, dan status konsisten.
5. **Security review:** audit trust boundary, validation, authorization, URL/path handling, subprocess args, secret logging, HTML output, rate/size/time limits, dan dependency changes yang relevan.
6. **Correctness review:** audit kondisi batas, null/undefined, empty collection, malformed JSON, timeout, retry, partial failure, concurrent request, duplicate run, crash/restart, cleanup, dan data migration.
7. **Maintainability review:** nama, tipe, single responsibility, duplicated logic, abstraction berlebihan, comments, logging dan error messages.
8. **Test review:** baca tes baru/berubah seluruhnya dan pastikan ada negative tests, bukan sekadar happy path.
9. **Static checks:** jalankan lint, typecheck, formatter check, dependency check bila tersedia, dan build terkait.
10. **Runtime checks:** jalankan test yang relevan dan regression tests. Jangan mengaku pass jika command tidak dijalankan.
11. **Git review:** tinjau `git diff --check`, `git diff`, `git status`, file untracked, dan perubahan di luar scope. Jangan kehilangan perubahan pengguna.
12. **Status update:** isi `IMPLEMENTATION_STATUS.md` dengan command, pass/fail, bukti artifacts, risiko tersisa, dan reviewer checklist.

Jika salah satu langkah tidak bisa dilakukan, task tidak boleh berstatus `VERIFIED`. Gunakan `BLOCKED` atau `EXECUTED` dan jelaskan secara tepat.

### 10.5 Final full-project audit

Sebelum rilis, audit seluruh source/config/migrations/workflows/tests/documentation yang berada dalam scope produk; jalankan semua quality gates; verifikasi instalasi bersih; periksa secret exposure dan scope safety; uji pemulihan/cancellation; buat laporan hasil final. “Audit seluruh baris kode” berarti setiap file source milik proyek dalam scope dibaca/review, bukan hanya sampling. Dependency vendor/generated build artifacts dapat dikecualikan dari code review manual, tetapi dependency, versi, license, generated source, dan artefak tersebut tetap harus diperiksa sesuai risiko.

---

## 11. Task tracking dan Definition of Done

### 11.1 Status yang diizinkan

- `PLANNED`: belum dimulai.
- `IN_PROGRESS`: sedang dikerjakan.
- `EXECUTED`: implementasi dilakukan, belum semua gerbang audit lulus.
- `VERIFIED`: acceptance criteria, audit kode, dan tes yang diwajibkan lulus dengan bukti.
- `BLOCKED`: ada blocker yang mencegah verifikasi; blocker dan langkah unblock dicatat.
- `FAILED`: implementasi/tes gagal dan belum diperbaiki.
- `DEFERRED`: sengaja dipindahkan ke milestone berikutnya dengan alasan dan dampak.

Dilarang menggunakan `VERIFIED` hanya karena kode ditulis, build dijalankan tanpa error, atau AI lain menyatakan selesai.

### 11.2 Format status task

Setiap task di `IMPLEMENTATION_STATUS.md` harus memuat:

```text
ID:
Title:
Status:
Depends on:
Files changed:
Acceptance criteria:
Commands actually run:
Test results:
Line-by-line audit: PASS / FAIL / BLOCKED + notes
Security review:
Evidence/artifacts:
Known limitations:
Next action:
```

### 11.3 Definition of Done per task

Task baru dianggap `VERIFIED` jika:

- semua acceptance criteria spesifik task terpenuhi;
- tidak ada placeholder/`TODO` yang seolah fitur sudah selesai;
- schema/type/contracts sudah sinkron;
- unit/integration/security/regression tests yang relevan lulus;
- audit seluruh baris pada file yang berubah selesai;
- tidak ada secret atau data sensitif tercommit;
- docs/config/status diperbarui;
- tidak ada file di luar scope yang berubah tanpa alasan;
- keterbatasan yang belum diselesaikan dinyatakan eksplisit.

---

## 12. Task implementation plan

> **Urutan wajib:** ikuti dependency graph. Jika task diblokir, jangan melompati prasyarat keselamatan atau kontrak data. Semua task di bawah memiliki gerbang audit per-task dari Bagian 10.4.

### T-000 — Repository discovery dan baseline audit

**Tujuan:** memahami kondisi repository sebelum menentukan perubahan.

**Instruksi:**

1. Periksa path kerja, branch, remote, `git status`, commit HEAD, struktur direktori, lisensi, README, package manager, lockfile, runtime version, test commands, CI, dan semua perubahan pengguna yang belum commit.
2. Jalankan tes existing yang realistis tanpa mengubah file jika memungkinkan. Catat command persis dan output aktual.
3. Inventarisasi fitur yang sudah tersedia dibandingkan Bagian 1–10; jangan membangun ulang fitur yang sudah benar.
4. Identifikasi dependency deprecated/vulnerable, pola security risk, file secrets, dan code paths yang tidak diuji.
5. Buat `IMPLEMENTATION_STATUS.md` dan checklist tasks; tulis initial baseline termasuk failing tests.
6. Buat ADR untuk konflik stack/architecture yang material.

**Deliverables:** baseline report, task status, dependency/architecture notes, initial risk register.

**Acceptance criteria:**
- perubahan pengguna terjaga;
- current branch dan status repo tercatat;
- tes existing dicatat sebagai pass/fail/not-run;
- semua task memiliki status dan dependency;
- tidak ada fitur diklaim sudah siap hanya dari nama file atau README.

**Audit khusus:** pastikan tidak ada reset/clean paksa, secrets dibaca/diungkap tanpa kebutuhan, atau kode diubah sebelum baseline selesai.

### T-010 — Bootstrap, workspace, dan quality gates

**Depends on:** T-000.

**Tujuan:** fondasi dev/test yang reproducible.

**Instruksi:**

1. Konfirmasi/pilih package manager dan runtime; pin runtime baseline dan commit lockfile.
2. Konfigurasi workspace yang sederhana; jangan membuat paket kosong yang belum diperlukan.
3. Aktifkan TypeScript strict mode, ESLint, Prettier, unit test runner, dan script build/typecheck/test.
4. Tambahkan `.gitignore`, `.env.example`, konfigurasi secret scan bila tersedia, dan sample config aman.
5. Pastikan `data/`, artifacts runtime, env local, trace, screenshot, DB, report lokal, dan credential tidak di-commit.
6. Siapkan command yang bisa dijalankan di README, contohnya `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, dan `npm run build` sesuai struktur final.
7. Jangan menambahkan dependency untuk lint/test yang tidak benar-benar digunakan.

**Acceptance criteria:** instalasi bersih berhasil; quality scripts menjalankan tool nyata; pipeline CI bisa menjalankan test dasar tanpa keys; lockfile tidak stale.

**Negative tests:** config env hilang/invalid; scripts dipanggil dari root repo; command gagal dengan error yang dapat dipahami.

**Audit khusus:** seluruh konfigurasi package/workspace, scripts yang menjalankan shell, ignore rules, dan workflow pipeline.

### T-020 — Domain schemas dan error taxonomy

**Depends on:** T-010.

**Tujuan:** kontrak stabil untuk semua hasil scan.

**Instruksi:**

1. Implementasikan schema/type untuk `Run`, `ModuleResult`, `Finding`, `Evidence`, `ProviderUsage`, `RemediationProposal`, config, request, dan response.
2. Definisikan enum status, severity, category, provider, mode, dan error codes satu kali di domain core.
3. Gunakan schema runtime untuk menerima data eksternal; static TypeScript types saja tidak cukup.
4. Sediakan factories/helpers untuk membuat result yang valid, bukan duplikasi object literals tidak tervalidasi.
5. Definisikan schema version dan strategi migrasi report lama.
6. Definisikan pesan error user-safe terpisah dari detail debug internal.

**Acceptance criteria:** schema valid/invalid tests lengkap; tidak ada `any` yang tidak memiliki alasan terdokumentasi pada trust boundary; semua adapter dapat mengembalikan status yang jelas; `UNAVAILABLE` tidak berubah menjadi `PASS`.

**Negative tests:** property hilang, extra fields, enum tidak valid, confidence di luar range, timestamp salah, payload terlalu panjang, invalid artifact reference.

**Audit khusus:** semua type/schema dan semua tempat enum/status digunakan.

### T-030 — SQLite storage, migration, dan repository layer

**Depends on:** T-020.

**Tujuan:** penyimpanan lokal konsisten dan aman.

**Instruksi:**

1. Buat schema/migrations untuk targets, runs, module results, findings, evidence metadata, provider usage, remediation proposals, dan app settings yang perlu disimpan.
2. Gunakan parameterized queries; jangan concatenation input user ke SQL.
3. Definisikan foreign keys, index, uniqueness yang diperlukan, dan transaksi pada penulisan satu run.
4. Migrasi memiliki versi, idempotency policy, dan test dari DB kosong serta versi sebelumnya.
5. Gunakan write atomic untuk artifacts; metadata DB dan file harus menangani kegagalan parsial tanpa menghasilkan status palsu.
6. Jangan menyimpan raw screenshots/blobs besar di SQLite bila file terisolasi lebih masuk akal; simpan metadata/hash/path.
7. Pastikan semua artifact paths diverifikasi tetap dalam artifact root.
8. Buat batas retention/cleanup tanpa menyentuh file di luar direktori aplikasi.

**Acceptance criteria:** CRUD repositories, migration tests, transaction rollback tests, restart persistence test, DB corruption/error handling yang masuk akal.

**Negative tests:** path invalid, artifact hilang, duplicate run ID, failed transaction, disk write error (simulasi), DB path tidak writable.

**Audit khusus:** migration SQL, data deletion, query parameterization, path checks, race/concurrency behavior.

### T-040 — Target registry dan authorization/scope guard

**Depends on:** T-020, T-030.

**Tujuan:** semua modul memperoleh target dari satu guard yang aman.

**Instruksi:**

1. Validasi canonical URL HTTP(S), normalisasi hostname dan port, dan tolak credentials dalam URL.
2. Bangun allowlist origin/host yang eksplisit dan disimpan per target/run.
3. Implementasikan perlindungan terhadap redirect out-of-scope, resolved IP private/loopback/link-local/metadata untuk remote targets, DNS rebinding risk, serta request origin yang tidak diizinkan.
4. Definisikan pengecualian fixture/localhost secara eksplisit dan terpisah dari remote mode.
5. Terapkan policy yang sama pada Playwright, Lighthouse, k6, dan Strix adapter; jika suatu tool tak bisa enforce scope dengan cukup kuat, batasi penggunaan ke fixture/local atau blokir remote mode.
6. Sediakan preview plan dan consent yang tersimpan sebagai metadata audit.
7. Tampilkan alasan penolakan yang tidak membocorkan internal network details.

**Acceptance criteria:** daftar host/IP berbahaya ditolak; normalisasi URL tidak melemahkan scope; redirect tidak dapat keluar; remote scanning disabled ketika validation tidak dapat dijamin.

**Negative tests wajib:** `localhost` dan variasi IP di remote mode, IPv6 loopback, private IP literal, link-local/metadata IP, username/password URL, encoded hostname tricks, redirect chain ke origin berbeda, DNS resolution change/mock, non-HTTP schemes, subdomain mirip dengan suffix spoofing, port yang tidak diizinkan.

**Audit khusus:** threat model SSRF, request interception, DNS/redirect flow, race antara validation dan request, seluruh pemanggil API target.

### T-050 — Run orchestrator dan state machine

**Depends on:** T-020, T-030, T-040.

**Tujuan:** menjalankan modul dengan state benar, cancellation, dan isolation.

**Instruksi:**

1. Implementasikan state transitions yang eksplisit dan tervalidasi.
2. Gunakan antrean untuk membatasi satu run aktif di low-resource mode.
3. Simpan setiap status transition dan timestamps dengan cara yang konsisten.
4. Jalankan modul wajib/opsional berdasarkan config dan preflight readiness.
5. Implementasikan timeout per modul, cancellation, cleanup, progress, retry policy, dan isolasi error per adapter.
6. Jangan menjalankan scan/load/security module secara paralel pada default profile.
7. Jika modul gagal, modul independen boleh lanjut; final status harus `PARTIAL` bila hasilnya tidak lengkap.
8. Implementasikan safe shutdown saat server menerima SIGINT/SIGTERM.
9. Cegah duplicate submission/idempotency dari double click atau retry API.

**Acceptance criteria:** semua transisi valid/invalid dites; cancellation mengakhiri proses; modul gagal tidak dianggap berhasil; partial run tetap bisa dilaporkan; restart tidak mengubah status menjadi success secara keliru.

**Negative tests:** double start, cancel sebelum start, cancel saat tool berjalan, adapter hang, DB unavailable, one adapter throws, server shutdown, partial artifacts, progress out-of-order.

**Audit khusus:** state transitions, concurrent mutation, promise cleanup, child processes, status aggregation.

### T-060 — Evidence/artifact store dan reporting core

**Depends on:** T-020, T-030, T-050.

**Tujuan:** menyimpan bukti dengan integritas dan ekspor laporan yang aman.

**Instruksi:**

1. Implementasikan artifact registry dengan ID/path relatif, MIME, ukuran, SHA-256, source tool, version, timestamp, synthetic label, dan redaction status.
2. Batasi file size/content types dan jangan mempercayai extension saja.
3. Implementasikan report JSON berdasarkan schema versioned dan report HTML yang meng-escape output.
4. Pastikan laporan mencantumkan scope, tanggal, module status, findings, evidence, limitations, tool versions, dan config summary.
5. `N/A`, `SKIPPED`, `UNAVAILABLE`, `ERROR`, dan `NOT RUN` ditampilkan dengan jelas.
6. Sediakan Markdown export opsional tanpa secret.
7. Sample report/fixture wajib diberi label synthetic.

**Acceptance criteria:** report valid; JSON round-trip schema tests; HTML escaping tests; artifact hash verification; report masih terbentuk meski satu modul gagal.

**Negative tests:** HTML/script injection dalam title/URL/finding; path traversal; file terlalu besar; MIME spoof; secret canary; missing artifact; report write interrupted.

**Audit khusus:** seluruh templating/escaping, user-controlled content, artifact references, export naming, redaction output.

### T-070 — Target fixture suite dan ground truth

**Depends on:** T-010, T-020.

**Tujuan:** menyediakan website uji lokal yang bisa dipakai untuk membuktikan hasil.

**Instruksi:**

1. Buat fixture website yang clean sebagai baseline.
2. Buat fixture terpisah untuk functional defects, accessibility defects, UX/template-like signals, broken resources, dan security lab yang sengaja rentan.
3. Security lab harus terisolasi, tidak deploy publik, dan mengandung petunjuk jelas bahwa aplikasi hanya untuk tes lokal.
4. Buat file ground truth yang menjelaskan temuan yang diharapkan, metode deteksi, severity expected, dan known limitations.
5. Jangan gunakan data real atau secrets sungguhan.
6. Semua fixtures dan report demo diberi `synthetic/demo`.
7. Buat smoke test untuk memastikan fixture start/stop dan ports dikontrol.

**Acceptance criteria:** fixture repeatable; tes tidak membutuhkan jaringan publik; expected findings terdokumentasi; tidak ada fixture rentan yang otomatis dibuka ke jaringan luar.

**Audit khusus:** bind address, ports, seed data, dependency vulnerabilities pada fixture, script start/stop, reset data.

### T-080 — Functional QA adapter (Playwright)

**Depends on:** T-040, T-050, T-060, T-070.

**Tujuan:** mendeteksi masalah fungsi yang bisa direproduksi.

**Instruksi:**

1. Buat adapter dengan interface domain yang independen dari orchestrator.
2. Implementasikan page load, page errors, console errors, failed requests, selected HTTP statuses, link checking terbatas, dan user-defined critical flows.
3. Terapkan route interception untuk setiap request dan blokir origin di luar scope.
4. Gunakan page count/depth/time limit; jangan crawl tanpa batas.
5. Form interactions memakai dummy data saja; larang aksi irreversible/eksternal.
6. Capture screenshot/trace hanya saat perlu; redaksi data sensitif dan batasi ukuran.
7. Record step-by-step evidence: URL, action, expected, actual, selector safe, timestamp, tool version.
8. Pastikan browser/context ditutup pada success, failure, cancellation, timeout, dan exception.

**Acceptance criteria:** fixture clean menghasilkan hasil yang sesuai ground truth; bug fixture menghasilkan temuan sesuai ekspektasi; external origins diblokir; semua browser processes berhenti setelah run.

**Negative tests:** request gagal, browser crash, timeout, redirect out-of-scope, console error, invalid selector, duplicate links, form submit dummy, secret in page text, artifact capture failure.

**Audit khusus:** browser lifecycle, routing guard, event listeners, crawling logic, waiting strategy, resource cleanup, log redaction.

### T-090 — Lighthouse adapter

**Depends on:** T-040, T-050, T-060, T-070.

**Tujuan:** menghasilkan performa/a11y report yang dapat ditelusuri ke konfigurasi aktual.

**Instruksi:**

1. Panggil Lighthouse melalui API/CLI terverifikasi dan argumen terstruktur.
2. Kunci versi dependency dan catat browser/version/runtime.
3. Batasi ke satu target/runner dalam satu waktu di low-resource mode.
4. Validasi output report sebelum parsing.
5. Simpan raw sanitized report dan metrik yang benar-benar tersedia.
6. Bedakan error tool dari skor website; jangan menampilkan skor 0 untuk kegagalan run.
7. Buat indikator kondisi non-comparable bila throttling/viewport/environment berbeda.

**Acceptance criteria:** dapat berjalan pada fixture; output valid dan metadata lengkap; tool missing/timeout menjadi `UNAVAILABLE`/`ERROR`; pipeline tetap menghasilkan report.

**Negative tests:** malformed output, timeout, missing executable, target redirect, unsupported flag, browser launch failure, invalid numeric metric.

**Audit khusus:** subprocess args, output parsing, numeric validation, timing metadata, artifact size, browser cleanup.

### T-100 — Deterministic UX/accessibility heuristic engine

**Depends on:** T-020, T-060, T-070, T-080.

**Tujuan:** menghasilkan pemeriksaan UI yang dapat dijelaskan tanpa AI.

**Instruksi:**

1. Definisikan rule registry dengan `ruleId`, version, description, severity mapping, applicability, detection method, evidence format, and remediation.
2. Mulai dari rules yang hasilnya bisa diukur; jangan mengklaim analisis UX universal.
3. Lakukan pemeriksaan yang sesuai untuk alt text, empty/generic headings, placeholder, duplicated CTA, broken images, horizontal overflow, link/button labels, target sizes/contrast hanya bila dihitung secara sah, dan layout repetition.
4. Simpan viewport/device condition dan selector/evidence per finding.
5. Pisahkan objective issues dari subjective suggestions.
6. Buat suppression/false-positive workflow yang tidak menghapus raw result asli.
7. Versioning rule untuk memungkinkan regression benchmark.

**Acceptance criteria:** hasil fixture sama di run repeatable; setiap finding mempunyai evidence dan rule ID; false positives dapat dijelaskan; tidak ada label pasti “AI-generated”.

**Negative tests:** DOM kosong, dynamically loaded DOM, duplicate labels, off-screen elements, shadow DOM/iframe limitation, CSS missing, responsive viewport changes, selector ambiguity.

**Audit khusus:** heuristic accuracy/false positives, severity mapping, evidence completeness, rule version migration.

### T-110 — Gemini adapter

**Depends on:** T-010, T-020, T-030, T-060.

**Tujuan:** membuat integrasi Gemini yang opsional, terukur, dan aman.

**Instruksi:**

1. Verifikasi dokumentasi resmi Gemini API dan SDK yang dipilih pada saat implementasi. Catat tanggal/versi doc, package version, dan model capability.
2. Implementasikan adapter di server-side package; key hanya di environment.
3. Dukungan minimum: text task; image task hanya bila model/config benar-benar mendukungnya.
4. Validasi request/response, timeout, context size, output tokens, image MIME/size/count, dan retry behavior.
5. Implementasikan request cap lokal, local daily usage, usage metadata yang tersedia, dan error classification (`RATE_LIMITED`, `AUTH_ERROR`, `MODEL_UNAVAILABLE`, `TIMEOUT`, `INVALID_RESPONSE`, `NETWORK_ERROR`, `UNKNOWN`).
6. Redaksi data sebelum kirim; external data consent wajib.
7. Jangan enable feature yang tidak termasuk free-tier allowlist. Jangan mengaktifkan billing/provider feature tambahan.
8. Tulis test dengan mock/fake SDK/HTTP layer sehingga unit test tidak memanggil API nyata.
9. Buat manual smoke test command yang explicit, tidak dijalankan oleh CI, dan memberi warning tentang kuota serta kebijakan data.

**Acceptance criteria:** adapter lolos fake-based tests; capability mismatch tertolak; invalid API key/429/timeout ditangani; secret tidak muncul logs/frontend; AI provider tidak dibutuhkan untuk core tests.

**Negative tests:** missing key, blank model, model tak dikenal (simulasi), 429, 5xx, malformed response, prompt terlalu panjang, image terlalu besar, unsupported MIME, daily limit reached, consent absent.

**Audit khusus:** semua HTTP/SDK call sites, payload redaction, logging, budget guard, parsing, retry bounds.

### T-120 — Groq adapter

**Depends on:** T-010, T-020, T-030, T-060.

**Tujuan:** provider teks alternatif dengan perlindungan free plan/rate limit.

**Instruksi:**

1. Verifikasi dokumentasi resmi Groq API dan rate limits terkini saat implementasi. Jangan menanam angka kuota per model yang tidak dicek.
2. Implementasikan server-side adapter dan simpan key hanya di environment.
3. Deklarasikan capability per configured model. Jangan mengasumsikan image input/function calling/structured outputs.
4. Baca dan simpan limit headers/`Retry-After` bila tersedia, tanpa menjadikan header sebagai kebenaran bila malformed.
5. Terapkan bounded retry, timeout, output token limit, request/day limit, serta local usage tracking.
6. JSON/schema output divalidasi; output tidak valid harus gagal dengan status aman.
7. Sediakan fake tests dan smoke test manual opt-in tanpa dijalankan CI.

**Acceptance criteria:** unit tests tidak memakai key; `429` tidak menyebabkan loop; unsupported capabilities tidak dipanggil; limit local ditegakkan saat restart dan antar-route; key tidak bocor.

**Negative tests:** 429 dengan dan tanpa Retry-After, header invalid, model unavailable, auth error, malformed JSON, timeout, local limit reached, empty/long response.

**Audit khusus:** rate-limit parser, retry schedule, provider usage data, error mapping, key redaction.

### T-130 — AI router, capability registry, dan free-tier lock

**Depends on:** T-110, T-120.

**Tujuan:** mengarahkan task ke provider yang sesuai dengan capability dan budget.

**Instruksi:**

1. Buat registry konfigurasi provider/model/capabilities yang diketahui, disetujui, dan tanggal verifikasinya.
2. Buat router dengan task type seperti `TEXT_SUMMARY`, `FINDING_EXPLANATION`, `VISUAL_REVIEW`, `STRUCTURED_REMEDIATION`; jangan memilih model berdasarkan nama saja.
3. Default `AI_PROVIDER=none`; fallback default off.
4. Fallback hanya terjadi jika pengguna mengaktifkannya, provider lain ada di allowlist, capability cocok, consent/data policy mencukupi, dan request cap belum habis.
5. Jangan fallback dari image task ke text-only model. Jangan fallback ke paid model yang tidak di-allowlist.
6. Terapkan budget guard secara terpusat agar API routes lain tidak bisa bypass.
7. Catat provider/model yang benar-benar dipakai, fallback reason, request status, latency, estimated/actual usage label, dan sanitized error.
8. Jika provider gagal/habis kuota, kembalikan `AI_UNAVAILABLE`; pipeline deterministik tetap lanjut.

**Acceptance criteria:** routing matrix diuji; provider off bekerja; budget enforcement berlaku lintas semua pemanggil; fallback hanya sesuai config; output tidak memalsukan hasil.

**Negative tests:** invalid model config, model capability mismatch, quota exhausted, two simultaneous calls at local quota boundary, provider disabled, consent missing, invalid usage metadata.

**Audit khusus:** semua call sites ke AI, bypass paths, concurrency/quota races, fallback policy, telemetry accuracy.

### T-140 — Dashboard MVP dan API routes

**Depends on:** T-030, T-040, T-050, T-060, T-080.

**Tujuan:** membuat produk bisa dipakai tanpa CLI knowledge.

**Instruksi:**

1. Buat halaman minimum dari Bagian 9 dengan UI yang konsisten dan responsive.
2. Buat API routes tervalidasi untuk targets, runs, run status, findings, artifacts, reports, provider status, settings, dan cancellation.
3. Cegah origin/path injection, over-posting, mass assignment, dan akses artifact arbitrary.
4. Bind server ke loopback; tambahkan proteksi untuk aksi sensitif dan CSRF/origin checks yang sesuai model local app.
5. Semua status memiliki teks, bukan warna saja. Pastikan keyboard flow dan label accessibility.
6. Tampilkan preview/consent sebelum load/security scans dan external AI data transfer.
7. Jangan mengirim API keys ke browser; server hanya mengembalikan status ada/tidaknya key dan model config yang aman.
8. Jangan render HTML raw dari website/AI ke halaman detail.

**Acceptance criteria:** end-to-end local audit works; error states jelas; external AI off masih lengkap untuk core functions; routes menolak malformed/oversized inputs; keyboard basic test lulus.

**Negative tests:** invalid body, oversize response, arbitrary artifact paths, double-submit, canceled run, secret display, XSS strings in findings, API call from unexpected origin.

**Audit khusus:** route authorization/local binding, frontend state transitions, XSS, API error leakage, accessibility, loading/empty/error states.

### T-150 — k6 adapter dan safety gates

**Depends on:** T-040, T-050, T-060, T-070, T-140.

**Tujuan:** load test terbatas yang sulit salah digunakan.

**Instruksi:**

1. Default `K6_ENABLED=false`; fixture lokal only.
2. Tambahkan preset fixed/limited dengan max VUs, rate, duration, total requests, timeout, dan stop conditions.
3. Tampilkan preview dan minta confirm sebelum execute. Remote target memerlukan izin/scope acknowledgement tersendiri.
4. Validasi target lagi tepat sebelum process spawn.
5. Buat script test berdasarkan konfigurasi yang sudah divalidasi; jangan menyisipkan raw input ke JavaScript source tanpa safe serialization.
6. Jalankan proses lewat argumen terstruktur dan isolated output path.
7. Implementasikan cancellation/kill switch, timeout, dan result parser tervalidasi.
8. Jangan mengizinkan preset stress/flood/spike pada MVP.
9. Laporan menyebut simulasi, preset, batas, dan kondisi test.

**Acceptance criteria:** local fixture load test lulus; request budget/duration/VUs tidak dapat melewati hard max; remote run memerlukan confirm; cancellation menghentikan k6; parser tidak mengarang metric yang hilang.

**Negative tests:** out-of-scope target, invalid VU/rate/duration, integer overflow, shell injection, JS injection, tool missing, cancellation, malformed JSON/summary, server error/overload condition.

**Audit khusus:** generated test script, process args, numeric bounds, kill switch, remote scope path, total request cap.

### T-160 — Strix adapter

**Depends on:** T-040, T-050, T-060, T-070.

**Tujuan:** mengintegrasikan Strix tanpa membuat core tergantung pada Strix.

**Instruksi:**

1. Mulai dengan versi Strix yang terverifikasi dan catat install method/version/license/prerequisites.
2. Implementasikan adapter process wrapper dan contract test berdasarkan CLI/output version yang nyata.
3. `STRIX_ENABLED=false` sebagai default. Preflight Docker/runtime/provider key/model/capability/scope.
4. Verifikasi konfigurasi Gemini/Groq secara nyata pada local security fixture sebelum menyatakan provider kompatibel. Gunakan model/provider allowlist dan budget controls yang terbukti; jika biaya tidak bisa dijamin, warning dan require explicit opt-in atau blokir dalam strict free-tier mode.
5. Jangan aktifkan web search atau optional paid services otomatis.
6. Terapkan max runtime, cancellation, output path isolasi, log redaction, scope checks, dan tidak ada scan publik otomatis.
7. Parse output berdasarkan schema/format dari versi aktual; simpan tool exit state dan report status.
8. Klasifikasikan raw findings dengan hati-hati; jangan ubah exit code menjadi klaim keamanan tanpa membaca status run.

**Acceptance criteria:** disabled/missing Docker/key/model -> `SKIPPED`/`UNAVAILABLE`; security fixture dijalankan hanya pada smoke test opt-in; parsing invalid output ditangani; provider/model compatibility memiliki bukti.

**Negative tests:** missing executable, Docker off, invalid model, unsupported provider, timeout, non-zero exit, empty output, malformed output, secret in logs, out-of-scope target.

**Audit khusus:** process boundary, environment passed to child, secret exposure, allowlist, exit code parsing, resource budgets, artifact isolation.

### T-170 — Before/after comparison dan remediation proposals

**Depends on:** T-060, T-080, T-090, T-100, T-140.

**Tujuan:** membuktikan apakah perubahan memperbaiki temuan dan tidak menyebabkan regresi.

**Instruksi:**

1. Tambahkan before/after relation dengan baseline run ID dan config fingerprint.
2. Validasi bahwa target origin, viewport, relevant tool versions, test settings, dan rule versions comparable; tampilkan diff bila berbeda.
3. Buat URL-only remediation guidance tanpa mutasi live target.
4. Repository mode harus memakai repository lokal milik/diizinkan dan branch/worktree sementara.
5. Catat commit/base revision, initial working tree state, files changed, patch diff, tests before/after, and approvals.
6. Pastikan patch dibatasi dan bisa dibatalkan; jangan menulis ke repository pengguna sebelum approval.
7. Jalankan test relevan dan security checks setelah patch; report semua failed/not-run tests.
8. `FIXED_VERIFIED` hanya berdasarkan assertion/evidence sebelum dan sesudah yang comparable.

**Acceptance criteria:** perbandingan jelas; tidak comparable diberi warning; patch bisa ditinjau/revert; tak ada auto merge/deploy; finding belum lulus tetap `FIXED_UNVERIFIED`.

**Negative tests:** uncommitted user changes, Git unavailable, worktree creation failure, partial patch, test failures after patch, changed environment, patch attempts outside repo root, secret added in diff.

**Audit khusus:** path boundary, git commands, dirty working tree, diff completeness, rollback, status transitions, proof logic.

### T-180 — Provider settings, usage, privacy controls

**Depends on:** T-110, T-120, T-130, T-140.

**Tujuan:** memungkinkan penggunaan AI yang sadar kuota dan data.

**Instruksi:**

1. Buat provider enable/disable, model config, capability info, test connection manual, local request limit, usage history, consent, dan redaction settings.
2. Jangan tampilkan key lengkap setelah disimpan; jangan simpan key di SQLite jika environment configuration sudah cukup.
3. Sediakan “Forget/reset local usage counters” dengan penjelasan bahwa reset lokal tidak mereset quota provider.
4. Tampilkan model status last-verified date dan beri warning jika sudah stale.
5. Tampilkan external data notice untuk screenshot/log/code sharing dan minimisasi data sebelum opt-in.
6. Pastikan UI settings tidak bisa menonaktifkan global `FREE_TIER_LOCK` melalui request tak tervalidasi atau hanya frontend.

**Acceptance criteria:** key tidak dikembalikan ke UI; local usage persisten; opt-in dipatuhi di semua routes; free-tier lock terpusat; request quota exhausted terhenti.

**Negative tests:** restart app, concurrent usage requests, consent revoked, malformed settings, UI/API config mismatch, missing key, stale model verification.

**Audit khusus:** secrets, persistent counters, settings authorization, user consent flow, reset semantics.

### T-190 — Security hardening dan threat-model verification

**Depends on:** T-040 through T-180, sesuai bagian yang sudah tersedia.

**Tujuan:** melakukan hardening lintas modul berdasarkan threat model.

**Instruksi:**

1. Tinjau ulang threat model dan update data flow/trust boundaries berdasarkan implementasi aktual.
2. Scan repo untuk secrets, command construction, unsafe HTML, raw SQL, path traversal, URL validation gaps, unbounded retries, unbounded queues, and unhandled child processes.
3. Uji SSRF/scope escape, redirect bypass, private IP access, rate/budget bypass, HTML injection, secret leakage, artifact path escape, malformed model output, cancellation leak, and resource exhaustion within safe local fixtures.
4. Periksa dependency advisories/license dan dokumentasikan mitigasi.
5. Audit setiap API route serta import cycle/boundary yang dapat melemahkan guards.
6. Perbaiki semua Critical/High blocker dalam scope sebelum lanjut. Jangan downgrade severity tanpa alasan/evidence.
7. Tulis `SECURITY.md` berisi scope, reporting process, known limitations, and safe test procedures.

**Acceptance criteria:** seluruh critical safety tests lulus; tidak ada known critical/high issue tanpa status/rationale; scope guard digunakan semua adapter; secrets tidak ditemukan dalam tracked files; limitation tercatat.

**Audit khusus:** review semua trust boundaries; seluruh code paths yang menjalankan request/network/subprocess/HTML/SQL/AI.

### T-200 — Low-resource behavior, reliability, and cleanup

**Depends on:** T-050, T-060, T-080, T-090, T-140, T-150, T-160.

**Tujuan:** menjaga sistem bisa dipakai pada komputer dengan RAM terbatas.

**Instruksi:**

1. Default satu run aktif, satu browser context, tool berjalan berurutan, dan Chromium saja.
2. Tambahkan batas screenshot, artifacts, crawl depth, page count, report size, process runtime, and in-memory log count.
3. Gunakan streaming/limit saat membaca raw output besar; jangan load seluruh large logs bila tidak perlu.
4. Cleanup browser, temporary worktrees, temporary files, and child processes pada success/failure/cancel.
5. Retention harus berada di artifact root; cleanup dapat dipreview dan tidak menyentuh file pengguna.
6. Buat health diagnostics dasar (disk/artifact path writable, tools present) tanpa remote telemetry.
7. Benchmark resource lokal hanya jika dilakukan benar-benar; catat hardware dan kondisi; jangan mengarang target angka.

**Acceptance criteria:** semua module run bisa cancellation/cleanup; low-resource defaults benar; no orphan processes dalam tes yang didukung; besar artifacts terkontrol; keterbatasan environment terlapor.

**Negative tests:** large artifacts, full disk simulation jika memungkinkan, child process hung, browser crash, canceled report, retention wrong path, simultaneous run attempts.

**Audit khusus:** lifecycle, memory accumulation, cleanup safety, filesystem boundary, duplicate jobs.

### T-210 — Documentation and onboarding

**Depends on:** T-010 through T-200 as appropriate.

**Tujuan:** pengguna dapat install, run, understand output, and troubleshoot tanpa mengira asumsi.

**Dokumentasi wajib:**

- README product overview, limitations, quick start, supported environment, and architecture link;
- `.env.example` dengan nama config aman dan tidak ada value yang terlihat seperti secret asli;
- setup/run/test/build/lint/typecheck commands yang benar-benar diuji;
- cara menjalankan core tanpa AI/API keys;
- cara setup Gemini dan Groq, quota/rate-limit troubleshooting, capability caveats, and data-policy warning;
- local fixtures and ground truth;
- remote target authorization and scope safety;
- low-load k6 preset and risk notice;
- Strix requirements and free-tier compatibility limitations;
- export/report schema and evidence interpretation;
- before/after verification and human approval;
- known limitations and false positive policy;
- `IMPLEMENTATION_STATUS.md` dengan evidence yang aktual.

**Acceptance criteria:** README steps diuji dari clean install pada environment yang didukung; link resmi tidak rusak sejauh bisa dicek; tidak ada claim yang tidak dibuktikan; terminology/status konsisten.

**Audit khusus:** semua command copy-paste, environment names, sample output (must be synthetic if illustrative), outdated model names, security warnings.

### T-220 — CI, release checks, and artifact validation

**Depends on:** all implementation tasks intended for release.

**Tujuan:** menjadikan quality gates repeatable tanpa paid services.

**Instruksi:**

1. CI menjalankan clean install, lint, format check, typecheck, unit tests, integration tests, build, secret scan, dan artifact/schema tests yang tersedia.
2. Tidak membutuhkan API keys; provider smoke tests manual/opt-in.
3. Simpan test outputs/artifacts yang tidak mengandung secrets.
4. Hindari permission workflow yang berlebihan; jangan memberi write token jika tidak diperlukan.
5. Lock dependencies; periksa reproducible installation.
6. Pastikan CI tidak menjalankan remote scans/load tests secara tidak sengaja.
7. Test packaging/export atau tarball jika produk menyediakan distribution package.

**Acceptance criteria:** green pipeline dari clean checkout; missing secrets tidak menyebabkan core tests fail; test skip jelas; no unexpected permission; no secrets in artifacts.

**Audit khusus:** workflow YAML, permissions, triggers, expressions, artifact upload, dependency install source, accidental network scan steps.

### T-230 — Final acceptance audit dan release handoff

**Depends on:** T-000 through T-220, kecuali modul opsional yang secara eksplisit ditunda.

**Tujuan:** memverifikasi bahwa hasil nyata sesuai dengan spesifikasi dan siap dipakai dalam batas yang dideklarasikan.

**Instruksi:**

1. Lakukan clean install dari clone baru atau worktree terpisah tanpa menghilangkan perubahan pengguna.
2. Jalankan command resmi README persis seperti tertulis.
3. Jalankan seluruh lint, format check, typecheck, unit, integration, e2e fixture, security-gate, schema/report, and build suites yang tersedia.
4. Jalankan satu e2e fixture audit tanpa API key.
5. Uji provider-off path, mocked provider error/429, missing optional tools, cancellation, report export, and retention behavior.
6. Uji Gemini/Groq nyata hanya jika user opt-in, keys tersedia, cost/privacy notices acknowledged, dan request limit cukup; dokumentasikan status secara akurat.
7. Uji k6/Strix nyata hanya di fixture/local lab yang diizinkan dan dalam batas safe.
8. Lakukan final full-project line-by-line review untuk source/config/migrations/workflows/tests dalam scope; tinjau diff dan git status.
9. Periksa secrets, untracked/ignored artifacts, changelog, docs, license, and known limitations.
10. Buat `RELEASE_AUDIT.md` dengan checklist pass/fail/blocked, command, date, versions, evidence file paths, limitations, and next steps.

**Acceptance criteria:** seluruh required gates lulus; semua optional/deferred modules ditampilkan secara eksplisit sebagai `SKIPPED`/`DEFERRED`; tidak ada klaim tak terbukti; clean setup berhasil; status implementasi merefleksikan kondisi aktual.

**Audit khusus:** final checklist tidak boleh sekadar mengulang laporan agent. Cocokkan hasil test, artifacts, Git diff, dan file yang benar-benar ada.

---

## 13. Dependency graph dan milestone

Gunakan urutan berikut sebagai default:

```text
T-000 Repository discovery
  └─ T-010 Bootstrap / quality gates
      └─ T-020 Domain schemas
          ├─ T-030 Storage
          │   ├─ T-050 Orchestrator
          │   │   ├─ T-080 Playwright
          │   │   ├─ T-090 Lighthouse
          │   │   ├─ T-150 k6
          │   │   └─ T-160 Strix
          │   └─ T-060 Evidence/report core
          └─ T-040 Scope guard
              ├─ T-080 Playwright
              ├─ T-090 Lighthouse
              ├─ T-150 k6
              └─ T-160 Strix
T-070 Fixtures → T-080/T-090/T-100/T-150/T-160
T-110 Gemini ─┐
T-120 Groq ───┴─ T-130 AI router → T-180 provider settings
T-100 UX rules + T-080/T-090/T-060 → T-140 dashboard
T-140 + T-060 + selected modules → T-170 remediation/before-after
All relevant tasks → T-190 hardening → T-200 reliability → T-210 docs → T-220 CI → T-230 release audit
```

### Milestone M1 — Local core works

Minimum: T-000 through T-080 core path, storage, fixture, orchestrator, basic report. Must run without AI keys.

### Milestone M2 — Measured quality audit

Add T-090 and T-100 with traceable findings and no AI requirement.

### Milestone M3 — Free-tier AI support

Add T-110, T-120, T-130, T-180 with lock, consent, usage caps, fallback policy, and fake tests.

### Milestone M4 — Dashboard and retest

Add T-140 and T-170; local workflow can run, review evidence, export, compare, and propose fixes.

### Milestone M5 — Opt-in advanced modules

Add T-150 and T-160 only after safety guard and environment checks pass.

### Milestone M6 — Release readiness

T-190 through T-230; security, low-resource behavior, docs, CI, clean-install and final audit.

---

## 14. Acceptance test matrix

| ID | Scenario | Expected result |
|---|---|---|
| AT-001 | Clean install, no AI keys | App/core tests work; AI status `UNAVAILABLE`/disabled, not fatal. |
| AT-002 | Fixture clean site | Run/report generated; expected baseline findings only. |
| AT-003 | Fixture with known functional defect | Finding appears with matching evidence/ground truth. |
| AT-004 | Scope violation/redirect outside allowlist | Request blocked; run logs safe reason; no remote follow-through. |
| AT-005 | Invalid/malicious URL scheme | Rejected before subprocess/browser navigation. |
| AT-006 | AI key absent | Adapter reports disabled/unavailable; no secret error details; deterministic tests continue. |
| AT-007 | AI returns 429 | Bounded retry respecting provider signals; then unavailable; no endless loop. |
| AT-008 | AI output malformed | Schema rejects it; no finding/patch treated as valid. |
| AT-009 | Provider daily local cap reached | No external request sent; user receives limit status. |
| AT-010 | AI consent missing | Website content/image/code is not sent to provider. |
| AT-011 | API key canary in logs/report | Canary absent after redaction; test fails if leaked. |
| AT-012 | k6 not enabled | Load test cannot start. |
| AT-013 | k6 values exceed hard limits | Request rejected before process spawn. |
| AT-014 | Strix missing/unconfigured | Module `SKIPPED`/`UNAVAILABLE`, not “secure”. |
| AT-015 | One module fails | Independent modules continue where safe; run becomes `PARTIAL` if required. |
| AT-016 | User cancels active run | Scheduling stops, child process/browser cleaned up, final status recorded. |
| AT-017 | HTML injection in finding title | Report renders inert text, no script execution. |
| AT-018 | Artifact path traversal | Access denied; no file outside artifact root read/written. |
| AT-019 | DB/artifact write failure | Clear error, no false success status, cleanup/recovery documented. |
| AT-020 | Before/after configurations differ | Comparison warns/not comparable and explains differences. |
| AT-021 | Patch tests fail after remediation | Finding remains unverified; regression reported; no merge/deploy. |
| AT-022 | Restart application | Historical runs and local request counters persist according to design. |
| AT-023 | Clean checkout CI | Required checks pass without paid service credentials. |
| AT-024 | Report fixture | All illustrative/synthetic data visibly labeled. |
| AT-025 | Low-resource profile | Single run/concurrency constraints enforced, output size limited. |
| AT-026 | UI has `N/A`/error result | Not misrepresented as zero or pass. |
| AT-027 | API route gets malformed oversized body | Rejected with safe error before heavy processing. |
| AT-028 | External tool command input contains metacharacters | No shell injection; arguments remain structured/validated. |

Tambahkan acceptance tests saat muncul fitur baru. Jangan menghapus test matrix entries hanya karena implementasinya belum ada; tandai status aktualnya.

---

## 15. Final manual checklist

### Product & architecture

- [ ] Core audit works without AI keys, Docker, or remote services.
- [ ] Each adapter is isolated and has typed/schema-validated result.
- [ ] Module failures are visible and do not become false passes.
- [ ] Data/report schema is versioned.
- [ ] Tool/config versions are recorded.

### Free-tier and privacy

- [ ] Default AI provider is off.
- [ ] Gemini/Groq models and capabilities are config-driven and verified.
- [ ] Free-tier lock is enforced server-side and centrally.
- [ ] No hidden paid fallback or optional paid feature.
- [ ] Local request limits persist across restarts.
- [ ] Usage figures distinguish actual from estimated.
- [ ] External data transfer requires consent and redaction.
- [ ] No keys/secrets in source, frontend, logs, artifacts, or reports.

### Security and safety

- [ ] Scope is explicit and enforcement applies to every adapter.
- [ ] SSRF/private-network/redirect protections are tested.
- [ ] Subprocess arguments are structured; no user-controlled shell string.
- [ ] k6 disabled by default and hard bounded.
- [ ] Strix disabled by default and never equates failed scan to security pass.
- [ ] Report HTML escapes untrusted content.
- [ ] Artifact filesystem boundaries and cleanup are tested.
- [ ] No destructive test runs or unauthorized target scans.

### Quality and audit

- [ ] Every task has acceptance criteria and evidence.
- [ ] Every task's changed source files have been read line-by-line.
- [ ] Diff, tests, configs, migrations, and direct call sites are reviewed.
- [ ] Unit/integration/security/regression tests were run as recorded.
- [ ] Lint/typecheck/build pass or blockers are honestly documented.
- [ ] Clean install and README commands verified.
- [ ] Known limitations, false positives, unavailable modules, and skipped checks are visible.

### Handoff

- [ ] `IMPLEMENTATION_STATUS.md` updated.
- [ ] `RELEASE_AUDIT.md` includes actual commands and evidence.
- [ ] No unsupported claims such as “100% secure” or “bug-free”.
- [ ] User retains control over patch apply, commit, merge, deployment, external AI sharing, and remote scans.

---

## 16. Dokumentasi resmi yang harus diverifikasi ulang

Dokumentasi berikut adalah titik awal, bukan jaminan bahwa harga, kuota, model ID, konfigurasi, API, dan capability tidak berubah. Saat mengimplementasikan task terkait, periksa dokumentasi terbaru dan catat waktu verifikasi.

- Gemini API pricing and free tier: <https://ai.google.dev/gemini-api/docs/pricing>
- Gemini API docs: <https://ai.google.dev/gemini-api/docs>
- Groq API rate limits: <https://console.groq.com/docs/rate-limits>
- Groq API documentation: <https://console.groq.com/docs>
- Strix source repository: <https://github.com/usestrix/strix>
- Strix quick start: <https://github.com/usestrix/strix/blob/main/docs/quickstart.mdx>
- Strix LLM provider overview: <https://github.com/usestrix/strix/blob/main/docs/llm-providers/overview.mdx>
- Playwright docs: <https://playwright.dev/docs/intro>
- Lighthouse repository/docs: <https://github.com/GoogleChrome/lighthouse>
- k6 local execution: <https://grafana.com/docs/k6/latest/get-started/running-k6/>
- Node.js releases: <https://nodejs.org/en/about/previous-releases>

### Kebijakan terhadap dokumentasi yang berubah

Jika model gratis dihentikan, provider tidak tersedia, dependency berubah, atau fitur membutuhkan plan berbayar:

1. jangan diam-diam mengganti ke layanan berbayar;
2. catat perubahan dan tanggal verifikasi;
3. pilih model/provider gratis lain hanya setelah kompatibilitas dan policy diverifikasi;
4. bila tidak ada opsi yang cocok, tandai module `UNAVAILABLE` sambil mempertahankan core workflow;
5. revisi taskbook/ADR bila arsitektur atau acceptance criteria berubah material.

---

## 17. Format laporan akhir AI agent

Setiap kali menyerahkan task/fase, gunakan format berikut dan isi hanya dengan informasi aktual:

```markdown
## Task report — [ID]: [judul]

**Status:** PLANNED | IN_PROGRESS | EXECUTED | VERIFIED | BLOCKED | FAILED | DEFERRED

### Perubahan
- ...

### File yang dibuat/diubah/dihapus
- `path`: alasan perubahan dan fungsi.

### Acceptance criteria
- [x] ... (bukti: ...)
- [ ] ... (alasan belum lulus: ...)

### Command yang benar-benar dijalankan
- `command` — PASS/FAIL/BLOCKED; ringkasan output aktual.

### Audit seluruh baris kode
- File dibaca dari awal sampai akhir: ...
- Diff dan working tree ditinjau: ...
- Security/correctness/context review: ...
- Temuan audit dan perbaikannya: ...

### Risiko / limitasi / test belum dijalankan
- ...

### Keputusan / blocker / task berikutnya
- ...
```

Dilarang menulis `PASS` jika command tidak dijalankan. Dilarang menulis `VERIFIED` jika audit baris demi baris belum selesai. Dilarang menyebut codebase “siap pakai” jika clean install, tes wajib, atau security gates masih gagal/belum diuji.

---

## 18. Arahan terakhir

Bangun NusaWebBench sebagai **alat audit website modular yang transparan, terukur, lokal, hemat sumber daya, dan mengutamakan layanan gratis**. Prioritaskan core deterministik dan safety guard terlebih dahulu. Tambahkan Gemini/Groq sebagai fitur opsional dengan quota/budget/privacy gates. Tambahkan k6 dan Strix hanya setelah scope enforcement terbukti kuat. Semua rekomendasi dan patch harus dapat ditinjau manusia dan diverifikasi dengan tes yang sebanding.

Pada setiap task: baca seluruh file terkait, implementasikan sesuai acceptance criteria, tulis tests negatif dan regresi, jalankan checks aktual, audit setiap baris file kode yang berubah, inspeksi seluruh diff, update status, dan laporkan bukti. Bila bukti tidak ada, gunakan `BLOCKED`/`EXECUTED`, bukan `VERIFIED`. Bila terjadi konflik antara cakupan fitur, biaya, keamanan, dan keandalan, prioritaskan **keamanan, kebenaran hasil, dan kemampuan diverifikasi** daripada jumlah fitur.
