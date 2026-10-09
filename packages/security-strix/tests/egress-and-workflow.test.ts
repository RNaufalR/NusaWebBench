import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');

/** F-10: skrip egress harus menghasilkan urutan aturan yang benar (dry-run, tanpa sudo/iptables). */
describe('skrip egress Strix (F-10)', () => {
  const run = (env: Record<string, string>) =>
    execFileSync('bash', [path.join(root, 'scripts/strix-egress-guard.sh')], {
      env: { PATH: process.env['PATH'] ?? '', DRY_RUN: '1', ...env },
      encoding: 'utf8',
    });

  it('memblokir forwarding keluar dari docker0 ke interface lain', () => {
    const out = run({ STRIX_FIXTURE_PORT: '4600' });
    expect(out).toContain('sudo iptables -I DOCKER-USER 1 -i docker0 ! -o docker0 -j DROP');
  });

  it('ACCEPT untuk port fixture berada di atas DROP INPUT', () => {
    const lines = run({ STRIX_FIXTURE_PORT: '4600' }).split('\n');
    const accept = lines.findIndex((l) => l.includes('-I INPUT 1') && l.includes('--dport 4600'));
    const drop = lines.findIndex((l) => l.includes('-I INPUT 1') && l.endsWith('-j DROP'));
    expect(accept).toBeGreaterThanOrEqual(0);
    // Penyisipan di posisi 1 terakhir berada paling atas: DROP disisipkan dulu, ACCEPT setelahnya.
    expect(accept).toBeGreaterThan(drop);
  });

  it('menolak port tidak valid dan nilai iface berbahaya', () => {
    expect(() => run({ STRIX_FIXTURE_PORT: '' })).toThrow();
    expect(() => run({ STRIX_FIXTURE_PORT: '4600; rm -rf /' })).toThrow();
    expect(() => run({ STRIX_FIXTURE_PORT: '4600', NWB_DOCKER_IFACE: 'a;b' })).toThrow();
  });
});

/** F-04 (bagian repo) dan F-08: kebijakan workflow dikunci lewat tes, bukan hanya dokumentasi. */
describe('kebijakan workflow (F-04, F-08)', () => {
  const strix = read('.github/workflows/strix-integration.yml');
  const ci = read('.github/workflows/ci.yml');

  it('semua action pihak ketiga dipin ke SHA penuh (40 hex)', () => {
    for (const text of [strix, ci]) {
      const uses = [...text.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)].map((m) => m[1] ?? '');
      expect(uses.length).toBeGreaterThan(0);
      for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('izin GITHUB_TOKEN minimal: contents read, tidak ada write', () => {
    for (const text of [strix, ci]) {
      expect(text).toMatch(/^permissions:\n {2}contents: read$/m);
      expect(text).not.toMatch(/contents: write/);
    }
  });

  it('strix hanya dipicu manual (tidak ada push/pull_request)', () => {
    expect(strix).toMatch(/^on:\n {2}workflow_dispatch:/m);
    expect(strix).not.toMatch(/^ {2}(push|pull_request|pull_request_target):/m);
  });

  it('checkout tidak menyimpan kredensial di .git/config', () => {
    const checkouts = [
      ...strix.matchAll(/uses: actions\/checkout@[^\n]*\n\s+with:\n\s+persist-credentials: false/g),
    ];
    expect(checkouts.length).toBe(1);
    expect(ci).not.toMatch(/persist-credentials: true/);
  });

  it('secret Strix hanya muncul di satu step yang bergerbang run_scan', () => {
    const occurrences = strix.match(/secrets\.STRIX_GEMINI_API_KEY/g) ?? [];
    expect(occurrences.length).toBe(1);
    const steps = strix.split(/\n {6}- name: /);
    const step = steps.find((s) => s.includes('secrets.STRIX_GEMINI_API_KEY'));
    expect(step).toBeDefined();
    expect(step).toContain('if: ${{ inputs.run_scan }}');
  });

  it('skrip egress (F-10) dipanggil di workflow, bergerbang run_scan, sebelum Strix nyata', () => {
    const steps = strix.split(/\n {6}- name: /);
    const idx = steps.findIndex((s) => s.includes('scripts/strix-egress-guard.sh'));
    const real = steps.findIndex((s) => s.includes('secrets.STRIX_GEMINI_API_KEY'));
    expect(idx).toBeGreaterThan(0);
    expect(real).toBeGreaterThan(idx);
    expect(steps[idx]).toContain('if: ${{ inputs.run_scan }}');
  });

  it('ci.yml tidak memakai secret sama sekali', () => {
    expect(ci).not.toMatch(/secrets\./);
  });
});
