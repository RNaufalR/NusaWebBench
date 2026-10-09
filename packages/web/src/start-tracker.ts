/**
 * F-11: pelacak start run yang sedang berjalan (in-flight).
 *
 * Tujuan: mencegah pemanggilan `orchestrator.start` ganda untuk run yang start-nya masih tertunda
 * (retry atau double-submit). Entri DIHAPUS setelah promise start selesai, sukses maupun gagal,
 * sehingga Set tidak tumbuh tanpa batas selama proses hidup.
 *
 * Keamanan terhadap eksekusi ganda tidak bergantung pada pelacak ini saja: orchestrator menolak
 * start kedua untuk run aktif (`controllers`) dan menolak run yang sudah tidak QUEUED (`execute`).
 */
export class StartTracker {
  private readonly inFlight = new Set<string>();

  /**
   * Memanggil `start` bila `id` belum sedang in-flight. Mengembalikan true bila pemanggilan dilakukan.
   * Kegagalan `start` ditelan di sini (sama seperti sebelumnya) dan tidak menyisakan entri.
   */
  startOnce(id: string, start: () => Promise<unknown>): boolean {
    if (this.inFlight.has(id)) return false;
    this.inFlight.add(id);
    let pending: Promise<unknown>;
    try {
      pending = start();
    } catch {
      this.inFlight.delete(id);
      return true;
    }
    void pending
      .catch(() => undefined)
      .finally(() => {
        this.inFlight.delete(id);
      });
    return true;
  }

  /** Jumlah entri in-flight. Dipakai tes dan pemantauan. */
  get size(): number {
    return this.inFlight.size;
  }

  has(id: string): boolean {
    return this.inFlight.has(id);
  }
}
