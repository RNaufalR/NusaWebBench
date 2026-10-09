# ADR-0005: Dashboard loopback dan keamanan API lokal

- Status: Accepted
- Tanggal: 2026-10-09
- Terkait: taskbook §9, T-140, T-190

## Konteks

Dashboard menjalankan audit terhadap target dan menyimpan artefak. Aplikasi dirancang sebagai alat lokal untuk satu pengguna, bukan layanan multi-pengguna. Tanpa autentikasi, server yang terbuka ke jaringan akan memberi akses ke audit dan artefak.

## Keputusan

1. Server bind hanya ke loopback (`127.0.0.1`, `localhost`, `::1`). Alamat lain ditolak sebelum `listen` (`assertLoopbackBind`).
2. Header `Host` harus berupa nama loopback (anti DNS rebinding). `ALLOWED_HOSTS` hanya menambah nama Host, bukan alamat bind.
3. Metode yang mengubah state memeriksa `Origin` (harus sama dengan Host) dan menolak `Sec-Fetch-Site: cross-site` tanpa Origin.
4. Body JSON dibatasi 16 KB, Content-Type wajib `application/json`, skema `strict` menolak field tak dikenal (anti over-posting).
5. Artefak hanya diakses lewat ID; respons unduhan memakai `attachment`, `nosniff`, dan CSP `sandbox`.
6. Halaman statis memakai CSP `script-src 'self'`, tanpa skrip inline, dan data dirender hanya sebagai `textContent`.
7. Pembuatan run melewati `RunOrchestrator.createRun` (plan, otorisasi, idempotensi tunggal).

## Konsekuensi

- Preview publik sandbox tidak dapat langsung mengakses dashboard karena bind non-loopback ditolak (R-WEB-1).
- Tidak ada autentikasi. Jangan mengekspos server ke jaringan; gunakan reverse proxy hanya jika memahami risikonya (di luar cakupan MVP).
