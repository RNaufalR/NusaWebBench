# Kebijakan keamanan NusaWebBench

## Cakupan

NusaWebBench adalah alat audit **lokal** untuk target yang dimiliki atau diizinkan secara tertulis.
Cakupan kode: paket di `packages/*`, skrip di `scripts/`, dan konfigurasi di root.
Di luar cakupan: target pihak ketiga, infrastruktur provider AI, dan Strix/k6 yang dijalankan di luar
fixture lokal.

## Pelaporan kerentanan

Laporkan melalui GitHub Security Advisory pada repository ini (fitur "Report a vulnerability").
Jangan membuka issue publik untuk kerentanan. Sertakan langkah reproduksi dengan fixture lokal.
Jangan sertakan API key, cookie, atau data pribadi nyata pada laporan.

## Prosedur uji aman

- Gunakan fixture lokal (`fixtures/`, `127.0.0.1`). Fixture `security-lab` SENGAJA rentan, hanya untuk
  uji lokal, dan tidak boleh di-deploy atau diekspos ke jaringan.
- Jangan jalankan pemindaian, load test, atau Strix terhadap target yang tidak diotorisasi secara
  eksplisit. Remote + modul browser/k6/Strix diblokir oleh `buildRunPlan`.
- Dashboard hanya bind ke loopback. Jangan mengubah bind ke alamat lain.
- Simpan API key hanya di file `.env` lokal (tidak di-commit). `.env.example` hanya berisi placeholder.
- `secret-scan` (`npm run secret-scan`) memindai file yang di-track untuk pola rahasia umum.

## Batasan yang diketahui

- Dashboard tidak memiliki autentikasi dan tidak memakai TLS. Model ancamannya adalah satu pengguna
  di mesin lokal.
- `--no-sandbox` Chrome hanya aktif bila `NWB_CHROME_NO_SANDBOX=1` (default: sandbox aktif).
- Lighthouse tidak memiliki route guard seperti browser-qa; pembatasan jaringan hanya lewat
  `--host-resolver-rules` Chrome (R-LH-1). Mode remote + Lighthouse diblokir.
- Budget AI: reservasi yang sedang berjalan disimpan di memori; crash saat panggilan berlangsung dapat
  membuat hitungan lokal tidak tercatat (R-AI-1).
- Kelayakan free tier per model belum diverifikasi; registry bawaan memblokir semua model (R-AI-3).
- Endpoint dan header Gemini/Groq belum dikonfirmasi penuh dari dokumen dalam sesi ini (R-AI-2).
- Strix: runner belum diverifikasi terhadap CLI aktual dan membutuhkan Docker. Adapter hanya
  menjalankan gerbang dan tidak memindai.
- k6: binary tidak tersedia di sandbox pengembangan; tes nyata bersifat opt-in (`K6_BIN`).
- Idempotency-Key dan penghitung per run disimpan di memori proses.
- Tidak ada klaim "bebas bug" atau "aman sepenuhnya". Hasil audit hanya berlaku untuk cakupan dan
  kondisi yang tercatat.

## Ringkasan verifikasi ancaman

| Ancaman                        | Kendali                                                      | Bukti                                                |
| ------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------- |
| SSRF / scope escape / redirect | `checkUrlInScope`, route guard, validasi ulang sebelum spawn | `packages/core/tests/scope.test.ts`                  |
| DNS rebinding ke dashboard     | Host allowlist loopback                                      | `api.test.ts` (Host asing → 403)                     |
| CSRF / lintas-situs            | Origin check untuk metode mengubah state                     | `api.test.ts` (Origin asing → 403)                   |
| Over-posting / mass assignment | Skema `strict` pada semua body                               | `api.test.ts` (scopeConfirmedAt, freeTierLock → 400) |
| Path traversal artefak         | Akses artefak hanya lewat ID `evd_<hex>`                     | `api.test.ts` (path encoded → 400)                   |
| XSS dari data website/AI       | Tanpa innerHTML, CSP `script-src 'self'`                     | `ui.test.ts`, `api.test.ts`                          |
| Kebocoran rahasia              | Redaksi artefak, status tanpa nilai kunci, env minimal       | `ai/tests/*`, `load-k6` tes env, `secret-scan`       |
| Injeksi shell/JS pada k6       | Argumen array, `shell: false`, JSON.stringify untuk script   | `load-k6/tests/k6.test.ts`                           |
| Budget AI bypass / race        | Satu `BudgetGuard`, reservasi sinkron, tes konkurensi        | `ai/tests/service.test.ts`                           |
| Body/response oversize         | Batas 16 KB body, 1 MB respons provider, 50 MB artefak       | `api.test.ts`, `ai/tests/providers.test.ts`          |
| Kebocoran proses anak          | Timeout + SIGTERM/SIGKILL, tes pid tidak hidup               | `load-k6/tests/k6.test.ts`                           |

Pemeriksaan dependensi: `npm audit --omit=dev` (lihat RELEASE_AUDIT.md untuk hasil dan tanggal).
