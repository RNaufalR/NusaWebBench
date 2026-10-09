import { describe, expect, it } from 'vitest';
import { scanText, RULES, scanRepository } from '../../scripts/secret-scan.mjs';
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

// Canary sintetis dibangun saat runtime agar string utuh tidak ada di repo.
const canary = (...parts: string[]): string => parts.join('');
const GOOGLE_CANARY = canary('AI', 'za', 'SyD', '0123456789abcdefGHIJKLMNOPQRSTUV');
const GROQ_CANARY = canary('gs', 'k_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2');

type Finding = { ruleId: string; file: string; line: number };

describe('secret-scan / scanText', () => {
  it('mendeteksi canary Google dan Groq bentuk key', () => {
    const f1: Finding[] = scanText('a.ts', `const k = "${GOOGLE_CANARY}";`);
    const f2: Finding[] = scanText('b.ts', `const k = "${GROQ_CANARY}";`);
    expect(f1.map((f) => f.ruleId)).toContain('google-api-key');
    expect(f2.map((f) => f.ruleId)).toContain('groq-api-key');
  });

  it('melaporkan nomor baris yang benar', () => {
    const text = ['baris 1', 'baris 2', `GEMINI_API_KEY="${GOOGLE_CANARY}"`].join('\n');
    const findings: Finding[] = scanText('c.env', text);
    expect(findings).toEqual([
      { ruleId: 'google-api-key', file: 'c.env', line: 3 },
      { ruleId: 'generic-secret-assignment', file: 'c.env', line: 3 },
    ]);
  });

  it('tidak melaporkan nilai placeholder kosong atau contoh', () => {
    const text = [
      'GEMINI_API_KEY=',
      'GROQ_API_KEY=<your-groq-key-here>',
      'token = "changeme-changeme"',
    ].join('\n');
    expect(scanText('.env.example', text)).toEqual([]);
  });

  it('tidak melaporkan identifier biasa yang panjang sebagai secret', () => {
    expect(scanText('x.ts', 'const password = someLongIdentifierName;')).toEqual([]);
  });

  it('mendeteksi nilai .env tanpa quote dengan nama GEMINI_API_KEY (lowercase polos)', () => {
    const findings: Finding[] = scanText(
      '.env.local',
      'GEMINI_API_KEY=' + 'abcdefghijklmnopqrstuvwx\n',
    );
    expect(findings.map((f) => f.ruleId)).toEqual(['generic-secret-assignment']);
  });

  it('mendeteksi literal dengan quote untuk nama secret', () => {
    const findings: Finding[] = scanText(
      'cfg.ts',
      'const token = "' + 'abcdefghijklmnop1234' + '";',
    );
    expect(findings.map((f) => f.ruleId)).toEqual(['generic-secret-assignment']);
  });

  it('tidak melaporkan identifier camelCase tanpa quote', () => {
    expect(scanText('x.ts', 'const password = someLongIdentifierName;')).toEqual([]);
  });

  it('mendeteksi PEM private key header', () => {
    const header = canary('-----BEGIN ', 'RSA PRIVATE ', 'KEY-----');
    expect(scanText('k.pem', header).map((f) => f.ruleId)).toEqual(['private-key-block']);
  });

  it('tidak pernah menyertakan nilai secret dalam hasil', () => {
    const findings: Finding[] = scanText('d.ts', `x = "${GOOGLE_CANARY}"`);
    expect(JSON.stringify(findings)).not.toContain(GOOGLE_CANARY);
  });

  it('memiliki rule id unik dan deskripsi', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RULES) {
      expect(r.description.length).toBeGreaterThan(5);
    }
  });
});

describe('secret-scan / scanRepository', () => {
  it('memindai hanya file yang dilacak git dan melewati file biner/besar', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'nwb-scan-'));
    await execFileAsync('git', ['init', '-q'], dir);
    await writeFile(path.join(dir, 'ok.txt'), 'tidak ada rahasia di sini\n');
    await writeFile(path.join(dir, 'leak.txt'), `KEY=${GROQ_CANARY}\n`);
    await writeFile(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 3]));
    await mkdir(path.join(dir, 'untracked'));
    await writeFile(path.join(dir, 'untracked', 'u.txt'), `KEY=${GOOGLE_CANARY}\n`);
    await execFileAsync('git', ['add', 'ok.txt', 'leak.txt', 'bin.dat'], dir);

    await symlink('/etc/hostname', path.join(dir, 'link.txt'));
    await execFileAsync('git', ['add', 'link.txt'], dir);
    await writeFile(path.join(dir, 'gone.txt'), 'x\n');
    await execFileAsync('git', ['add', 'gone.txt'], dir);
    await rm(path.join(dir, 'gone.txt'));

    const result = await scanRepository(dir);
    const rules = result.findings.map((f: Finding) => `${f.file}:${f.ruleId}`);
    expect(rules).toEqual(['leak.txt:groq-api-key']);
    expect(result.skipped).toEqual([
      { file: 'bin.dat', reason: 'binary' },
      { file: 'gone.txt', reason: 'missing-in-worktree' },
      { file: 'link.txt', reason: 'not-a-regular-file' },
    ]);
    expect(result.scanned).toBe(2);
  });
});

async function execFileAsync(cmd: string, args: string[], cwd: string): Promise<void> {
  await promisify(execFile)(cmd, args, { cwd });
}
