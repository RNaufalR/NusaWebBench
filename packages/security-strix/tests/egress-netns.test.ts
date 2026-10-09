import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * F-10 — uji runtime egress guard di network namespace (Linux + sudo tanpa password).
 *
 * Aktif bila NWB_NETNS_TESTS=1. Dengan REQUIRE_NETNS_TESTS=1, tes ini tidak boleh di-skip diam-diam:
 * bila prasyarat tidak ada, tes gagal. Uji ini membuktikan jalur paket (kontrol, positif, negatif,
 * teardown) pada netfilter kernel yang sama dengan Docker. Ini BUKAN container Docker sungguhan.
 */
const ENABLED = process.env['NWB_NETNS_TESTS'] === '1';
const REQUIRE = process.env['REQUIRE_NETNS_TESTS'] === '1';
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '../../../scripts/test-strix-egress-netns.sh');

function hasSudo(): boolean {
  try {
    execFileSync('sudo', ['-n', 'true'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (REQUIRE && (!ENABLED || process.platform !== 'linux' || !hasSudo())) {
  throw new Error(
    'REQUIRE_NETNS_TESTS=1 tetapi prasyarat netns (Linux, NWB_NETNS_TESTS=1, sudo -n) tidak terpenuhi.',
  );
}

const describeNetns = ENABLED ? describe : describe.skip;

describeNetns('egress guard di netns (F-10 runtime)', () => {
  it('kontrol, pasang guard, verifikasi jalur paket, dan teardown', () => {
    const out = execFileSync('bash', [script], { encoding: 'utf8', timeout: 240_000 });
    expect(out).toContain('OK positif: fixture yang diizinkan terjangkau');
    expect(out).toContain('OK negatif: layanan host terlarang diblokir');
    expect(out).toContain('OK negatif: host eksternal diblokir');
    expect(out).toContain('OK: teardown menghapus aturan');
    expect(out).toContain('SELESAI');
  }, 300_000);
});
