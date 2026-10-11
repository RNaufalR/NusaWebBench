import type { Provider } from '@nusawebbench/core';
import type { Store } from '@nusawebbench/storage';

/** Bucket kuota lokal: tanggal UTC (YYYY-MM-DD). Ini penghitung aplikasi, bukan kuota akun provider. */
export function bucketOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export type Reservation = { readonly release: () => void };

/**
 * Budget guard terpusat (taskbook T-130 instruksi 6). Semua pemanggilan provider wajib melalui
 * `reserve`. Pemeriksaan dan pencadangan terjadi dalam satu langkah sinkron tanpa `await` di antaranya,
 * sehingga dua pemanggilan bersamaan di batas kuota tidak bisa keduanya lolos.
 *
 * Hitungan berasal dari tabel `provider_usage` (bertahan setelah restart) ditambah reservasi yang
 * sedang berjalan di memori. Reservasi yang belum selesai saat proses mati tidak tercatat; hal ini
 * dicatat sebagai batasan di risk register.
 */
export class BudgetGuard {
  private readonly inFlight = new Map<string, number>();

  constructor(
    private readonly store: Store,
    private readonly now: () => Date = () => new Date(),
    private readonly baseline: () => string | null = () => null,
  ) {}

  used(provider: Provider, bucket: string): number {
    const persisted = this.store.usage.countRequestsSince(provider, bucket, this.baseline());
    return persisted + (this.inFlight.get(`${provider}|${bucket}`) ?? 0);
  }

  /** Mengembalikan null bila kuota lokal sudah habis; jika tidak, reservasi harus dilepas setelah panggilan. */
  reserve(provider: Provider, cap: number): Reservation | null {
    const bucket = bucketOf(this.now());
    const key = `${provider}|${bucket}`;
    if (this.used(provider, bucket) >= cap) return null;
    this.inFlight.set(key, (this.inFlight.get(key) ?? 0) + 1);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const next = (this.inFlight.get(key) ?? 1) - 1;
        if (next <= 0) this.inFlight.delete(key);
        else this.inFlight.set(key, next);
      },
    };
  }
}
