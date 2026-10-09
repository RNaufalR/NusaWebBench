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
    execFileSync('bash', [path.join(root, 'scripts/strix-egress-guard.sh'), 'apply'], {
      env: { PATH: process.env['PATH'] ?? '', DRY_RUN: '1', NWB_DOCKER_IFACE: 'docker0', ...env },
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

  it('DRY_RUN tanpa NWB_DOCKER_IFACE menolak (tidak menebak nama bridge)', () => {
    expect(() =>
      execFileSync('bash', [path.join(root, 'scripts/strix-egress-guard.sh'), 'apply'], {
        env: { PATH: process.env['PATH'] ?? '', DRY_RUN: '1', STRIX_FIXTURE_PORT: '4600' },
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).toThrow();
  });

  it('mode teardown dan verify memakai aturan yang sama dengan apply (IPv4 dan IPv6)', () => {
    const td = execFileSync(
      'bash',
      [path.join(root, 'scripts/strix-egress-guard.sh'), 'teardown'],
      {
        env: {
          PATH: process.env['PATH'] ?? '',
          DRY_RUN: '1',
          NWB_DOCKER_IFACE: 'docker0',
          STRIX_FIXTURE_PORT: '4600',
        },
        encoding: 'utf8',
      },
    );
    expect(td).toContain('sudo iptables -D DOCKER-USER -i docker0 ! -o docker0 -j DROP');
    expect(td).toContain('sudo ip6tables -D DOCKER-USER -i docker0 ! -o docker0 -j DROP');
    const ap = run({ STRIX_FIXTURE_PORT: '4600' });
    expect(ap).toContain('sudo ip6tables -I INPUT 1 -i docker0 -j DROP');
  });

  it('menolak port tidak valid dan nilai iface berbahaya', () => {
    expect(() => run({ STRIX_FIXTURE_PORT: '' })).toThrow();
    expect(() => run({ STRIX_FIXTURE_PORT: '4600; rm -rf /' })).toThrow();
    expect(() => run({ STRIX_FIXTURE_PORT: '4600', NWB_DOCKER_IFACE: 'a;b' })).toThrow();
  });
});

/**
 * F-04 (bagian repo) dan F-08: kebijakan workflow dikunci lewat tes struktur.
 *
 * Batasan: ini memeriksa FILE workflow (struktur per job berdasarkan indentasi), bukan pengaturan
 * GitHub. Environment `strix-live`, deployment branch policy, reviewer, dan ruleset hanya bisa
 * diverifikasi lewat konfigurasi GitHub yang sebenarnya (lihat SECURITY_REMEDIATION_REPORT.md).
 * Tes ini tidak membuktikan bahwa pengaturan tersebut aktif.
 */
type Job = { readonly name: string; readonly body: string };

function jobsOf(text: string): Map<string, Job> {
  const start = text.indexOf('\njobs:\n');
  if (start < 0) throw new Error('workflow tanpa blok jobs');
  const lines = text.slice(start + '\njobs:\n'.length).split('\n');
  const jobs = new Map<string, Job>();
  let current: { name: string; lines: string[] } | null = null;
  for (const line of lines) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      if (current) jobs.set(current.name, { name: current.name, body: current.lines.join('\n') });
      current = { name: m[1] ?? '', lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) jobs.set(current.name, { name: current.name, body: current.lines.join('\n') });
  return jobs;
}

/** Langkah (step) dalam satu job, dipisah pada `- name:` atau `- uses:` di indentasi 6. */
/** Melempar error bila job tidak ditemukan, agar tes gagal jelas (bukan TypeError). */
function need(job: Job | undefined, name: string): Job {
  if (!job) throw new Error(`job '${name}' tidak ditemukan di workflow`);
  return job;
}

function stepsOf(job: Job): string[] {
  return job.body
    .split(/\n {6}- /)
    .slice(1)
    .map((s) => `- ${s}`);
}

describe('kebijakan workflow (F-04, F-08)', () => {
  const strix = read('.github/workflows/strix-integration.yml');
  const ci = read('.github/workflows/ci.yml');
  const jobs = jobsOf(strix);
  const provision = jobs.get('provision');
  const live = jobs.get('strix-live');

  it('struktur: ada tepat dua job, provision (tanpa secret) dan strix-live (dengan secret)', () => {
    expect([...jobs.keys()].sort()).toEqual(['provision', 'strix-live']);
    expect(provision).toBeDefined();
    expect(live).toBeDefined();
  });

  it('semua action pihak ketiga dipin ke SHA penuh (40 hex)', () => {
    for (const text of [strix, ci]) {
      const uses = [...text.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)].map((m) => m[1] ?? '');
      expect(uses.length).toBeGreaterThan(0);
      for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('izin GITHUB_TOKEN minimal di tingkat workflow: contents read, tidak ada write', () => {
    for (const text of [strix, ci]) {
      expect(text).toMatch(/^permissions:\n {2}contents: read$/m);
      expect(text).not.toMatch(/contents: write|write-all/);
    }
  });

  it('pemicu: tidak ada pull_request_target; pull_request hanya untuk job tanpa secret', () => {
    expect(strix).not.toMatch(/^ {2}pull_request_target:/m);
    expect(strix).toMatch(/^ {2}pull_request:/m);
    expect(strix).toMatch(/^ {2}workflow_dispatch:/m);
    expect(provision).toBeDefined();
    expect(need(provision, 'provision').body).not.toMatch(/secrets\./);
  });

  it('job provision tidak memakai environment dan tidak punya akses secret', () => {
    expect(need(provision, 'provision').body).not.toMatch(/^ {4}environment:/m);
    expect(need(provision, 'provision').body).not.toMatch(/secrets\./);
  });

  it('job strix-live: environment strix-live, dan hanya berjalan pada dispatch run_scan dari main', () => {
    expect(need(live, 'strix-live').body).toMatch(/^ {4}environment: strix-live$/m);
    expect(need(live, 'strix-live').body).toMatch(
      /^ {4}if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.run_scan && github\.ref == 'refs\/heads\/main' \}\}$/m,
    );
    expect(need(live, 'strix-live').body).toMatch(/^ {4}needs: provision$/m);
  });

  it('secret Strix hanya dirujuk di job strix-live dan hanya di satu step', () => {
    expect(strix.match(/secrets\.STRIX_GEMINI_API_KEY/g) ?? []).toHaveLength(1);
    expect(need(provision, 'provision').body).not.toContain('STRIX_GEMINI_API_KEY');
    const steps = stepsOf(need(live, 'strix-live'));
    const withSecret = steps.filter((s) => s.includes('secrets.STRIX_GEMINI_API_KEY'));
    expect(withSecret).toHaveLength(1);
  });

  it('setiap checkout di job mana pun tidak menyimpan kredensial (persist-credentials: false)', () => {
    const checkouts = [
      ...strix.matchAll(/uses: actions\/checkout@[^\n]*\n\s+with:\n\s+persist-credentials: false/g),
    ];
    expect(checkouts.length).toBe(2);
    expect(ci).not.toMatch(/persist-credentials: true/);
  });

  it('egress guard: apply dipasang dan diverifikasi sebelum step secret; teardown selalu dijalankan', () => {
    const steps = stepsOf(need(live, 'strix-live'));
    const apply = steps.findIndex((s) => s.includes('scripts/strix-egress-guard.sh apply'));
    const real = steps.findIndex((s) => s.includes('secrets.STRIX_GEMINI_API_KEY'));
    const teardown = steps.findIndex((s) => s.includes('scripts/strix-egress-guard.sh teardown'));
    expect(apply).toBeGreaterThanOrEqual(0);
    expect(real).toBeGreaterThan(apply);
    expect(teardown).toBeGreaterThan(real);
    expect(steps[teardown]).toContain('if: ${{ always() }}');
  });

  it('uji netns egress guard berjalan di provision tanpa secret, dan wajib (REQUIRE)', () => {
    const steps = stepsOf(need(provision, 'provision'));
    const netns = steps.find((s) => s.includes('egress-netns.test.ts'));
    expect(netns).toBeDefined();
    expect(netns).toContain("REQUIRE_NETNS_TESTS: '1'");
  });

  it('ci.yml tidak memakai secret sama sekali', () => {
    expect(ci).not.toMatch(/secrets\./);
  });
});
