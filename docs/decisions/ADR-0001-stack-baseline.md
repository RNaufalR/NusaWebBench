# ADR-0001: Stack baseline dan pemilihan package manager

- Status: Accepted (untuk tahap T-000/T-010)
- Tanggal: 2026-10-09
- Terkait: taskbook §3.1, §3.2, §3.3, §13

## Konteks

Repository `RNaufalR/NusaWebBench` pada saat T-000 hanya berisi `README.md` (14 byte) dan dokumen taskbook. Tidak ada kode, `package.json`, lockfile, konfigurasi, atau tes. Tidak ada konflik stack yang harus diselesaikan, sehingga stack mengikuti rekomendasi taskbook §3.1.

Lingkungan verifikasi: Node `v22.22.3`, npm `10.9.8`, Linux x86_64, 2 vCPU, RAM ~3.9 GB. Tidak ada Docker, Chromium, atau k6 terpasang.

## Keputusan

1. **Runtime:** Node.js. Versi yang dipin akan ditetapkan di `.nvmrc` pada T-010 setelah verifikasi status LTS di `https://nodejs.org/en/about/previous-releases`. Belum diverifikasi pada T-000, sehingga versi pin belum ditetapkan.
2. **Package manager:** npm workspaces dengan `package-lock.json` yang di-commit. Alasan: sudah tersedia di lingkungan, tidak menambah tool baru, dan sesuai taskbook §3.1.
3. **Bahasa:** TypeScript dengan mode `strict`.
4. **Frontend:** React + Vite. Backend lokal: Fastify. Validasi: Zod. Database: SQLite lokal dengan migrasi versioned (library akan dipilih dan diverifikasi pada T-030).
5. **Tes:** Vitest untuk unit/integration. Playwright dan Lighthouse sebagai adapter (T-080, T-090). k6 dan Strix hanya sebagai opt-in (T-150, T-160).

## Versi yang diamati di registry (2026-10-09, `npm view`)

Ini adalah informasi registry, **bukan** versi yang sudah diuji di repo. Versi final akan dipin dan diuji pada task masing-masing.

| Paket          | Versi terbaru di registry |
| -------------- | ------------------------- |
| vite           | 8.3.4                     |
| react          | 19.3.0                    |
| typescript     | 7.0.2                     |
| vitest         | 5.0.3                     |
| playwright     | 1.64.0                    |
| lighthouse     | 13.5.0                    |
| zod            | 4.6.5                     |
| better-sqlite3 | 13.0.3                    |
| eslint         | 10.12.0                   |
| prettier       | 3.9.9                     |

Catatan: versi `typescript 7.x` dan `eslint 10.x` adalah rilis mayor yang perlu dicek kompatibilitasnya dengan plugin ESLint/TypeScript yang dipakai. Jika tidak kompatibel, versi lebih lama akan dipakai dan alasannya dicatat di ADR baru.

## Konsekuensi

- Belum ada dependency yang ditambahkan pada T-000.
- Keputusan versi harus diulang dan dicatat ulang di T-010.

## Alternatif yang dipertimbangkan

- Pnpm/Yarn: ditolak untuk tahap ini karena menambah tool yang tidak diperlukan; npm sudah tersedia.
- Next.js: ditolak karena taskbook meminta React+Vite dan Fastify secara terpisah.
