import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  compareRuns,
  configFingerprint,
  findingKey,
  isSafeRelativePath,
  proposePatch,
  urlRemediationGuidance,
  type ComparableFinding,
  type RunSnapshot,
} from '../src/index.js';

const F = (over: Partial<ComparableFinding> = {}): ComparableFinding => ({
  ruleId: 'ux-img-alt',
  selector: 'html > body > img',
  targetUrl: 'http://127.0.0.1:4700/',
  severity: 'HIGH',
  status: 'OPEN',
  verification: 'CONFIRMED',
  ...over,
});
const snap = (over: Partial<RunSnapshot> = {}): RunSnapshot => ({
  runId: 'run_a',
  origin: 'http://127.0.0.1:4700',
  viewport: { width: 390, height: 844 },
  configFingerprint: configFingerprint({ viewport: { width: 390, height: 844 } }),
  toolVersions: { 'ux-rules': '1.0.0' },
  ruleVersions: { 'ux-img-alt': '1.0.0' },
  comparableModules: ['UX_RULES'],
  findings: [F()],
  ...over,
});

describe('perbandingan sebelum/sesudah', () => {
  it('temuan hilang dengan bukti sah → FIXED_VERIFIED', () => {
    const c = compareRuns(snap(), snap({ runId: 'run_b', findings: [] }));
    expect(c.comparable).toBe(true);
    expect(c.items).toEqual([
      expect.objectContaining({ verification: 'FIXED_VERIFIED', after: 'ABSENT' }),
    ]);
  });

  it('modul sesudah ERROR/UNAVAILABLE (tidak ada bukti) → FIXED_UNVERIFIED, bukan FIXED_VERIFIED', () => {
    const c = compareRuns(snap(), snap({ runId: 'run_b', findings: [], comparableModules: [] }));
    expect(c.items[0]?.verification).toBe('FIXED_UNVERIFIED');
  });

  it('temuan baru pada run sesudah → REGRESSION bila comparable', () => {
    const c = compareRuns(
      snap(),
      snap({ runId: 'run_b', findings: [F({ ruleId: 'ux-control-label' })] }),
    );
    expect(c.items.map((i) => i.verification).sort()).toEqual(
      ['FIXED_VERIFIED', 'REGRESSION'].sort(),
    );
  });

  it('origin atau viewport berbeda → tidak comparable (blocker)', () => {
    expect(compareRuns(snap(), snap({ origin: 'http://127.0.0.1:4701' })).comparable).toBe(false);
    const vp = compareRuns(snap(), snap({ viewport: { width: 1440, height: 900 } }));
    expect(vp.comparable).toBe(false);
    expect(vp.blockers.join(' ')).toContain('viewport');
  });

  it('versi aturan/alat atau konfigurasi berbeda → warning, dan regresi tidak diklaim', () => {
    const c = compareRuns(
      snap(),
      snap({
        runId: 'run_b',
        ruleVersions: { 'ux-img-alt': '1.1.0' },
        configFingerprint: 'beda',
        findings: [F({ ruleId: 'ux-link-label' })],
      }),
    );
    expect(c.warnings.some((w) => w.includes('aturan'))).toBe(true);
    expect(c.warnings.some((w) => w.includes('konfigurasi'))).toBe(true);
    expect(c.items.find((i) => i.after === 'PRESENT')?.verification).toBe('LIKELY');
  });

  it('temuan SUPPRESSED tidak dihitung sebagai OPEN', () => {
    const c = compareRuns(
      snap({ findings: [F({ status: 'SUPPRESSED' })] }),
      snap({ runId: 'run_b', findings: [] }),
    );
    expect(c.items).toEqual([]);
  });

  it('kunci temuan stabil dan sidik jari konfigurasi tidak bergantung urutan kunci', () => {
    expect(findingKey(F())).toBe('ux-img-alt|html > body > img|http://127.0.0.1:4700/');
    expect(configFingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(
      configFingerprint({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });
});

describe('panduan remediasi URL-only', () => {
  it('hanya menyusun teks dan tidak mengirim request', () => {
    const text = urlRemediationGuidance({
      title: 'Gambar tanpa alt',
      remediation: 'Tambahkan alt.',
      targetUrl: 'http://127.0.0.1:4700/',
      selector: 'img',
    });
    expect(text).toContain('Tambahkan alt.');
    expect(text).toContain('bukan pada target live');
  });
});

describe('jalur path proposal patch', () => {
  it('path absolut, traversal, .git, dan backslash ditolak', () => {
    for (const p of ['/etc/passwd', '../x', 'a/../../b', '.git/config', 'a\\b', '', 'a//b']) {
      expect(isSafeRelativePath(p), p).toBe(false);
    }
    expect(isSafeRelativePath('src/components/Header.tsx')).toBe(true);
  });
});

describe('proposal patch lewat git worktree (repo git sementara)', () => {
  let repo: string;
  let head: string;
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'uji',
    GIT_AUTHOR_EMAIL: 'uji@example.invalid',
    GIT_COMMITTER_NAME: 'uji',
    GIT_COMMITTER_EMAIL: 'uji@example.invalid',
  };
  const g = (cwd: string, args: string[]) =>
    execFileSync('git', args, { cwd, env, encoding: 'utf8' });

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'nwb-cmp-'));
    g(repo, ['init', '-q']);
    mkdirSync(path.join(repo, 'src'), { recursive: true });
    writeFileSync(path.join(repo, 'src', 'a.txt'), 'satu\n');
    g(repo, ['add', '.']);
    g(repo, ['commit', '-q', '-m', 'awal']);
    head = g(repo, ['rev-parse', 'HEAD']).trim();
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('menolak repository kotor (perubahan pengguna belum di-commit)', async () => {
    writeFileSync(path.join(repo, 'src', 'a.txt'), 'perubahan pengguna\n');
    await expect(
      proposePatch({
        repoPath: repo,
        baseRevision: head,
        files: [{ path: 'src/a.txt', content: 'x' }],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('path di luar akar repo ditolak sebelum apa pun berjalan', async () => {
    await expect(
      proposePatch({
        repoPath: repo,
        baseRevision: head,
        files: [{ path: '../luar.txt', content: 'x' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('revisi dasar tidak valid atau tidak ada → ditolak / gagal membuat worktree', async () => {
    await expect(
      proposePatch({ repoPath: repo, baseRevision: 'ini tidak valid', files: [] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      proposePatch({
        repoPath: repo,
        baseRevision: 'abcdef1',
        files: [{ path: 'src/a.txt', content: 'x' }],
      }),
    ).rejects.toMatchObject({ code: 'TOOL_FAILED' });
  });

  it('diff yang memuat rahasia ditolak dan worktree dibersihkan', async () => {
    const before = g(repo, ['worktree', 'list']);
    await expect(
      proposePatch({
        repoPath: repo,
        baseRevision: head,
        files: [{ path: 'src/a.txt', content: 'kunci AIza' + 'Z'.repeat(35) + '\n' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(g(repo, ['worktree', 'list'])).toBe(before);
  });

  it('proposal sah: diff tersedia, repo pengguna tidak berubah, rollback menghapus worktree', async () => {
    const proposal = await proposePatch({
      repoPath: repo,
      baseRevision: head,
      files: [{ path: 'src/a.txt', content: 'dua\n' }],
    });
    expect(proposal.changedFiles).toEqual(['src/a.txt']);
    expect(proposal.diff).toContain('+dua');
    expect(existsSync(proposal.worktreePath)).toBe(true);
    // Repo pengguna tetap bersih dan file aslinya tidak berubah.
    expect(g(repo, ['status', '--porcelain']).trim()).toBe('');
    expect(readFileSync(path.join(repo, 'src', 'a.txt'), 'utf8')).toBe('satu\n');
    await proposal.rollback();
    expect(existsSync(proposal.worktreePath)).toBe(false);
    expect(g(repo, ['worktree', 'list'])).not.toContain('nwb-wt-');
  });
});
