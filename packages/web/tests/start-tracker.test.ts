import { describe, expect, it } from 'vitest';
import { StartTracker } from '../src/start-tracker.js';

/** F-11: lifecycle entri start in-flight. Tidak boleh tumbuh tanpa batas, dan tidak boleh menjalankan ganda. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('StartTracker (F-11)', () => {
  it('start ganda untuk run yang masih tertunda tidak memanggil start kedua', () => {
    const t = new StartTracker();
    const d = deferred();
    let calls = 0;
    const start = () => {
      calls++;
      return d.promise;
    };
    expect(t.startOnce('run-1', start)).toBe(true);
    expect(t.startOnce('run-1', start)).toBe(false);
    expect(t.startOnce('run-1', start)).toBe(false);
    expect(calls).toBe(1);
    expect(t.has('run-1')).toBe(true);
  });

  it('setelah sukses, entri dibersihkan (tidak tumbuh tanpa batas)', async () => {
    const t = new StartTracker();
    const d = deferred();
    t.startOnce('run-ok', () => d.promise);
    expect(t.size).toBe(1);
    d.resolve();
    await d.promise;
    await new Promise((r) => setImmediate(r));
    expect(t.size).toBe(0);
  });

  it('setelah gagal, entri juga dibersihkan dan start berikutnya diizinkan lagi', async () => {
    const t = new StartTracker();
    const d = deferred();
    t.startOnce('run-fail', () => d.promise);
    d.reject(new Error('boom'));
    await new Promise((r) => setImmediate(r));
    expect(t.size).toBe(0);
    let calls = 0;
    expect(
      t.startOnce('run-fail', () => {
        calls++;
        return Promise.resolve();
      }),
    ).toBe(true);
    expect(calls).toBe(1);
  });

  it('start yang melempar sinkron tidak menyisakan entri', () => {
    const t = new StartTracker();
    t.startOnce('run-throw', () => {
      throw new Error('sync boom');
    });
    expect(t.size).toBe(0);
  });

  it('banyak run: Set kembali kosong setelah semuanya selesai (tidak ada kebocoran)', async () => {
    const t = new StartTracker();
    const ds = Array.from({ length: 200 }, () => deferred());
    ds.forEach((d, i) => t.startOnce(`r${i}`, () => d.promise));
    expect(t.size).toBe(200);
    ds.forEach((d) => d.resolve());
    await new Promise((r) => setTimeout(r, 0));
    expect(t.size).toBe(0);
  });

  it('pembersihan tidak mengganggu run lain yang masih tertunda', async () => {
    const t = new StartTracker();
    const a = deferred();
    const b = deferred();
    t.startOnce('a', () => a.promise);
    t.startOnce('b', () => b.promise);
    a.resolve();
    await new Promise((r) => setImmediate(r));
    expect(t.has('a')).toBe(false);
    expect(t.has('b')).toBe(true);
    expect(t.startOnce('b', () => Promise.resolve())).toBe(false);
  });
});
