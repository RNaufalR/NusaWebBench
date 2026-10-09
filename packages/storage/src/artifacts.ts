import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import {
  ALLOWED_ARTIFACT_MIME_TYPES,
  AppError,
  EVIDENCE_KINDS,
  EvidenceSchema,
  IdSchema,
  MAX_ARTIFACT_BYTES,
  newId,
  RelativePathSchema,
  type Evidence,
  type EvidenceKind,
} from '@nusawebbench/core';
import type { EvidenceRepository } from './repositories.js';

export type ArtifactMime = (typeof ALLOWED_ARTIFACT_MIME_TYPES)[number];

const EXTENSION: Readonly<Record<ArtifactMime, string>> = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/json': 'json',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'text/html': 'html',
  'text/markdown': 'md',
});

const TEXT_MIMES: readonly ArtifactMime[] = [
  'application/json',
  'text/plain',
  'text/html',
  'text/markdown',
];

/** Tanda awal file biner yang dikenal. Dipakai untuk mendeteksi MIME spoofing. */
function binarySignature(bytes: Buffer): 'png' | 'jpeg' | 'webp' | 'zip' | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpeg';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  if (bytes.length >= 4) {
    const sig = bytes.subarray(0, 4).toString('latin1');
    if (sig === 'PK\u0003\u0004' || sig === 'PK\u0005\u0006') return 'zip';
  }
  return null;
}

/**
 * Memverifikasi isi terhadap MIME yang dideklarasikan. Ekstensi dan header dari pengirim
 * tidak dipercaya; yang dicek adalah isi. Mengembalikan alasan penolakan atau null.
 */
export function contentMismatch(declared: ArtifactMime, bytes: Buffer): string | null {
  const sig = binarySignature(bytes);
  if (TEXT_MIMES.includes(declared)) {
    if (sig !== null) return 'binary-signature-in-text';
    if (bytes.includes(0)) return 'nul-byte-in-text';
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return 'invalid-utf8';
    }
    if (declared === 'application/json') {
      try {
        JSON.parse(text);
      } catch {
        return 'invalid-json';
      }
    }
    return null;
  }
  const expected: Record<string, 'png' | 'jpeg' | 'webp' | 'zip'> = {
    'image/png': 'png',
    'image/jpeg': 'jpeg',
    'image/webp': 'webp',
    'application/zip': 'zip',
  };
  const want = expected[declared];
  if (want === undefined) return 'unknown-mime';
  return sig === want ? null : 'signature-mismatch';
}

export type ArtifactWriteInput = {
  readonly runId: string;
  readonly kind: EvidenceKind;
  readonly mimeType: ArtifactMime;
  readonly bytes: Buffer;
  readonly sourceTool: string;
  readonly sourceVersion: string;
  readonly description: string;
  readonly redactionApplied: boolean;
  readonly synthetic: boolean;
};

export type ArtifactStoreOptions = {
  readonly rootDir: string;
  readonly evidence: EvidenceRepository;
  readonly maxBytes?: number;
  /** Hook uji: dipanggil tepat sebelum rename final (untuk simulasi penulisan terputus). */
  readonly beforeCommit?: (tmpPath: string) => void;
  readonly now?: () => Date;
};

/**
 * Penyimpanan artefak dengan batas root. Semua path final berada di bawah root setelah
 * realpath; symlink yang keluar root ditolak. Penulisan atomik: tulis ke file sementara,
 * fsync, lalu rename. Bila insert metadata gagal, file final dihapus agar tidak yatim.
 */
export class ArtifactStore {
  private readonly root: string;
  private readonly evidence: EvidenceRepository;
  private readonly maxBytes: number;
  private readonly beforeCommit: ((tmpPath: string) => void) | undefined;
  private readonly now: () => Date;

  constructor(options: ArtifactStoreOptions) {
    mkdirSync(options.rootDir, { recursive: true });
    this.root = realpathSync(options.rootDir);
    this.evidence = options.evidence;
    this.maxBytes = Math.min(options.maxBytes ?? MAX_ARTIFACT_BYTES, MAX_ARTIFACT_BYTES);
    this.beforeCommit = options.beforeCommit;
    this.now = options.now ?? (() => new Date());
  }

  get rootDir(): string {
    return this.root;
  }

  write(input: ArtifactWriteInput): Evidence {
    if (!IdSchema.safeParse(input.runId).success) {
      throw new AppError('VALIDATION_FAILED', { safeMessage: 'ID run tidak valid.' });
    }
    if (!(EVIDENCE_KINDS as readonly string[]).includes(input.kind)) {
      throw new AppError('ARTIFACT_ERROR', { debugDetail: 'unknown-kind' });
    }
    if (!(ALLOWED_ARTIFACT_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
      throw new AppError('ARTIFACT_ERROR', { safeMessage: 'Tipe berkas tidak diizinkan.' });
    }
    if (input.bytes.length > this.maxBytes) {
      throw new AppError('PAYLOAD_TOO_LARGE', { safeMessage: 'Artefak melebihi batas ukuran.' });
    }
    const mismatch = contentMismatch(input.mimeType, input.bytes);
    if (mismatch !== null) {
      throw new AppError('ARTIFACT_ERROR', {
        safeMessage: 'Isi berkas tidak sesuai tipe yang dideklarasikan.',
        debugDetail: `content-mismatch:${mismatch}`,
      });
    }

    const id = newId('evidence');
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const relative = `${input.runId}/${id}.${EXTENSION[input.mimeType]}`;
    const finalPath = this.resolveWritable(relative);
    const dir = path.dirname(finalPath);
    this.ensureInsideRoot(dir);
    mkdirSync(dir, { recursive: true });
    this.ensureInsideRoot(dir);

    const tmpPath = path.join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
    try {
      const fd = openSync(tmpPath, 'wx', 0o600);
      try {
        writeSync(fd, input.bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this.beforeCommit?.(tmpPath);
      renameSync(tmpPath, finalPath);
    } catch (err) {
      removeIfExists(tmpPath);
      throw new AppError('ARTIFACT_ERROR', { cause: err, debugDetail: 'write-failed' });
    }

    const record = EvidenceSchema.parse({
      id,
      runId: input.runId,
      kind: input.kind,
      pathRelative: relative,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.length,
      sha256,
      createdAt: this.now().toISOString(),
      sourceTool: input.sourceTool,
      sourceVersion: input.sourceVersion,
      description: input.description,
      redactionApplied: input.redactionApplied,
      synthetic: input.synthetic,
    });
    try {
      this.evidence.insert(record);
    } catch (err) {
      // Metadata gagal disimpan: hapus file agar tidak menjadi artefak yatim.
      removeIfExists(finalPath);
      throw err;
    }
    return record;
  }

  /** Memastikan path relatif valid dan (bila sudah ada) realpath-nya tetap di dalam root. */
  resolveExisting(pathRelative: string): string {
    const abs = this.resolveWritable(pathRelative);
    if (!existsSync(abs)) {
      throw new AppError('ARTIFACT_ERROR', { debugDetail: 'missing-file' });
    }
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) {
      throw new AppError('ARTIFACT_ERROR', { debugDetail: 'symlink-rejected' });
    }
    const real = realpathSync(abs);
    if (!real.startsWith(this.root + path.sep)) {
      throw new AppError('ARTIFACT_ERROR', { debugDetail: 'path-escape' });
    }
    return real;
  }

  /**
   * Membaca artefak dan memverifikasi ukuran serta SHA-256 terhadap metadata. Artefak yang
   * berubah, hilang, atau berlebihan ditolak.
   */
  readVerified(evidenceId: string): Buffer {
    const record = this.evidence.get(evidenceId);
    if (!record) throw new AppError('NOT_FOUND');
    const abs = this.resolveExisting(record.pathRelative);
    const st = statSync(abs);
    if (st.size !== record.sizeBytes || st.size > this.maxBytes) {
      throw new AppError('ARTIFACT_ERROR', { debugDetail: 'size-mismatch' });
    }
    const bytes = readFileSync(abs);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== record.sha256) {
      throw new AppError('ARTIFACT_ERROR', { debugDetail: 'hash-mismatch' });
    }
    return bytes;
  }

  /** Path final untuk tulisan baru. Menolak path relatif yang tidak aman. */
  private resolveWritable(pathRelative: string): string {
    const parsed = RelativePathSchema.safeParse(pathRelative);
    if (!parsed.success) {
      throw new AppError('ARTIFACT_ERROR', { debugDetail: 'invalid-relative-path' });
    }
    const abs = path.resolve(this.root, pathRelative);
    if (!abs.startsWith(this.root + path.sep)) {
      throw new AppError('ARTIFACT_ERROR', { debugDetail: 'path-escape' });
    }
    return abs;
  }

  private ensureInsideRoot(dir: string): void {
    // Jika direktori sudah ada, realpath-nya harus tetap di bawah root (menolak symlink keluar).
    if (existsSync(dir)) {
      const real = realpathSync(dir);
      if (real !== this.root && !real.startsWith(this.root + path.sep)) {
        throw new AppError('ARTIFACT_ERROR', { debugDetail: 'dir-escape' });
      }
    }
  }
}

function removeIfExists(p: string): void {
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    // Pembersihan best-effort; kegagalan tidak boleh menutupi error utama.
  }
}

/**
 * Menulis berkas teks/biner secara atomik ke path absolut (untuk berkas di luar artefak,
 * misalnya ekspor). Path harus berada di dalam `rootDir`.
 */
export function writeFileAtomic(rootDir: string, absPath: string, data: Buffer): void {
  const root = realpathSync(rootDir);
  const target = path.resolve(absPath);
  if (!target.startsWith(root + path.sep)) {
    throw new AppError('ARTIFACT_ERROR', { debugDetail: 'atomic-write-escape' });
  }
  const dir = path.dirname(target);
  mkdirSync(dir, { recursive: true });
  const real = realpathSync(dir);
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new AppError('ARTIFACT_ERROR', { debugDetail: 'atomic-dir-escape' });
  }
  const tmp = path.join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
  try {
    const fd = openSync(tmp, 'wx', 0o600);
    try {
      writeSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, target);
  } catch (err) {
    removeIfExists(tmp);
    throw new AppError('ARTIFACT_ERROR', { cause: err, debugDetail: 'atomic-write-failed' });
  }
}
