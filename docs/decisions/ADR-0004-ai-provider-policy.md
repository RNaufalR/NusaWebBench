# ADR-0004: Kebijakan provider AI opsional (Gemini dan Groq)

- Status: Accepted
- Tanggal: 2026-10-09
- Terkait: taskbook §8, T-110, T-120, T-130, T-180

## Konteks

Fitur AI bersifat opsional. Core harus lengkap tanpa API key. Kuota dan kelayakan free tier berubah, dan dokumentasi provider menyatakan bahwa angka kuota berbeda per model dan per tier. Data yang dikirim ke provider (teks, screenshot, log) meninggalkan mesin lokal.

## Keputusan

1. `AI_PROVIDER=none` adalah default. Tidak ada panggilan jaringan ke provider tanpa opt-in operator DAN consent pengguna (`ai.external_data_consent`).
2. `FREE_TIER_LOCK=true` adalah default. `loadConfig` menolak AI aktif dengan lock mati.
3. Model hanya dari registry yang diketahui (`MODEL_REGISTRY`) dengan tanggal verifikasi dan sumber. Model di luar registry ditolak (`model-not-allowlisted`).
4. Entri registry bawaan memakai `freeTierAllowlisted: false` karena kelayakan free tier belum diverifikasi. Akibatnya tidak ada model yang bisa dipakai sampai pemilik memverifikasi dan mengubah registry secara sadar.
5. Angka kuota per model tidak ditanam di kode. Budget lokal dihitung dari `provider_usage` dan dibatasi `AI_MAX_REQUESTS_PER_DAY` dan `AI_MAX_REQUESTS_PER_RUN`.
6. Semua pemanggilan provider melewati `AiService.run`. Tidak ada jalur lain.
7. Fallback hanya saat routing (primary tidak tersedia), dan hanya bila `AI_FALLBACK_ENABLED=true`. Tidak ada fallback dari task gambar ke model teks saja.
8. 429 tidak pernah diulang. Error 5xx dan timeout diulang terbatas (maksimum 3 percobaan).
9. Kunci API hanya dari environment, tidak pernah disimpan di SQLite, dan tidak pernah dikembalikan ke UI/API.
10. Temuan dari AI tidak boleh berstatus `CONFIRMED`.

## Konsekuensi

- Dengan default, fitur AI tidak dapat dipakai. Ini disengaja sampai ada verifikasi free tier.
- Tes live (`AI_LIVE_TESTS=1`) bersifat manual dan tidak berjalan di CI.
- Endpoint Gemini dan header Authorization Groq belum dikonfirmasi penuh dari dokumen dalam sesi ini (lihat risk register R-AI-2).
