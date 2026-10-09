import { z } from 'zod';
import type { Category, Severity } from '@nusawebbench/core';

/**
 * Engine heuristik UX/aksesibilitas (taskbook T-100). Semua pemeriksaan bersifat deterministik
 * dan dihitung dari snapshot DOM. Tidak ada AI dan tidak ada label "AI-generated".
 *
 * - objective: pelanggaran yang dapat diukur dari DOM (mis. gambar tanpa alt).
 * - subjective: saran berbasis daftar/pola (mis. heading generik). Tidak pernah membuat status FAIL.
 */

export const UX_RULES_TOOL = 'ux-rules';
/** Versi registry aturan. Naikkan saat ada perubahan perilaku aturan (lihat IMPLEMENTATION_STATUS). */
export const UX_RULES_REGISTRY_VERSION = '1.0.0';

export const UX_RULE_IDS = [
  'ux-img-alt',
  'ux-control-label',
  'ux-link-label',
  'ux-heading-level-skip',
  'ux-broken-image',
  'ux-horizontal-overflow',
  'ux-placeholder-text',
  'ux-generic-heading',
  'ux-duplicate-cta',
  'ux-repetitive-layout',
] as const;
export type UxRuleId = (typeof UX_RULE_IDS)[number];

export type RuleKind = 'objective' | 'subjective';

export type RuleDefinition = {
  readonly version: string;
  readonly kind: RuleKind;
  readonly category: Category;
  readonly severity: Severity;
  readonly title: string;
  readonly applicability: string;
  readonly detection: string;
  readonly expected: string;
  readonly remediation: string;
  readonly limitation: string;
};

export const RULE_CATALOG: Readonly<Record<UxRuleId, RuleDefinition>> = Object.freeze({
  'ux-img-alt': {
    version: '1.0.0',
    kind: 'objective',
    category: 'ACCESSIBILITY',
    severity: 'HIGH',
    title: 'Gambar tanpa atribut alt',
    applicability: 'img yang terlihat, tanpa role presentation/none',
    detection: 'atribut alt tidak ada (null). alt="" dianggap dekoratif dan tidak dihitung.',
    expected: 'Gambar informatif memiliki atribut alt; gambar dekoratif memakai alt="".',
    remediation: 'Tambahkan alt yang menjelaskan isi gambar, atau alt="" bila dekoratif.',
    limitation: 'Tidak menilai kualitas teks alt.',
  },
  'ux-control-label': {
    version: '1.0.0',
    kind: 'objective',
    category: 'ACCESSIBILITY',
    severity: 'HIGH',
    title: 'Kontrol tanpa nama aksesibel',
    applicability:
      'button dan input/select/textarea yang terlihat (kecuali hidden/submit/reset/image)',
    detection:
      'nama kosong dari aria-label, aria-labelledby, teks/value, label terkait, atau title. Placeholder tidak dihitung sebagai label.',
    expected: 'Setiap kontrol memiliki nama aksesibel.',
    remediation: 'Tambahkan teks tombol, elemen label, atau aria-label.',
    limitation:
      'Nama dari konten tersembunyi dan label yang dibuat JavaScript setelah load tidak diperiksa.',
  },
  'ux-link-label': {
    version: '1.0.0',
    kind: 'objective',
    category: 'ACCESSIBILITY',
    severity: 'HIGH',
    title: 'Tautan tanpa teks',
    applicability: 'a[href] yang terlihat',
    detection:
      'nama kosong dari teks, aria-label, aria-labelledby, title, atau alt gambar non-kosong di dalam tautan.',
    expected: 'Setiap tautan memiliki nama yang menjelaskan tujuannya.',
    remediation: 'Tambahkan teks tautan atau alt yang bermakna pada gambar di dalam tautan.',
    limitation: 'Tidak menilai kejelasan teks (mis. "klik di sini" tetap lolos).',
  },
  'ux-heading-level-skip': {
    version: '1.0.0',
    kind: 'objective',
    category: 'ACCESSIBILITY',
    severity: 'LOW',
    title: 'Lompatan level heading',
    applicability: 'heading h1–h6 yang terlihat, berurutan dalam dokumen',
    detection: 'level heading naik lebih dari satu tingkat dibanding heading sebelumnya.',
    expected: 'Level heading naik secara bertahap.',
    remediation: 'Gunakan level heading yang berurutan atau ubah gaya dengan CSS.',
    limitation: 'Heading pertama tidak dibandingkan dengan apa pun.',
  },
  'ux-broken-image': {
    version: '1.0.0',
    kind: 'objective',
    category: 'FUNCTIONAL',
    severity: 'MEDIUM',
    title: 'Gambar rusak',
    applicability: 'img terlihat dengan src, sudah selesai dimuat',
    detection: 'complete === true dan naturalWidth === 0.',
    expected: 'Setiap gambar yang ada di DOM dapat dimuat.',
    remediation: 'Perbaiki atau hapus src gambar.',
    limitation: 'Gambar lazy-load yang belum dimuat saat audit tidak dihitung.',
  },
  'ux-horizontal-overflow': {
    version: '1.0.0',
    kind: 'objective',
    category: 'UX_VISUAL',
    severity: 'MEDIUM',
    title: 'Scroll horizontal pada viewport',
    applicability: 'halaman pada viewport yang dikonfigurasi',
    detection: 'scrollWidth dokumen lebih besar dari lebar viewport (toleransi 1 px).',
    expected: 'Konten muat dalam lebar viewport.',
    remediation: 'Gunakan lebar fleksibel atau batasi elemen yang melebar.',
    limitation: 'Hanya untuk satu viewport per run; elemen yang disembunyikan CSS tidak dihitung.',
  },
  'ux-placeholder-text': {
    version: '1.0.0',
    kind: 'objective',
    category: 'UX_VISUAL',
    severity: 'MEDIUM',
    title: 'Teks contoh atau TODO terlihat',
    applicability: 'teks yang terlihat pada halaman',
    detection: 'mengandung "lorem ipsum" (tanpa peka huruf) atau "TODO" (peka huruf kapital).',
    expected: 'Tidak ada teks contoh di halaman produksi.',
    remediation: 'Ganti teks contoh dengan konten final.',
    limitation: 'Teks yang disengaja dapat menghasilkan false positive; gunakan suppression.',
  },
  'ux-generic-heading': {
    version: '1.0.0',
    kind: 'subjective',
    category: 'UX_VISUAL',
    severity: 'LOW',
    title: 'Heading generik',
    applicability: 'heading terlihat',
    detection:
      'teks heading (huruf kecil, tanpa tanda baca akhir) cocok dengan daftar kata generik.',
    expected: 'Heading menjelaskan isi bagian.',
    remediation: 'Ganti heading dengan judul yang spesifik.',
    limitation: 'Daftar kata terbatas (Indonesia/Inggris). Ini saran, bukan penilaian desain.',
  },
  'ux-duplicate-cta': {
    version: '1.0.0',
    kind: 'subjective',
    category: 'UX_VISUAL',
    severity: 'LOW',
    title: 'Label tombol duplikat',
    applicability: 'button terlihat dengan nama tidak kosong',
    detection:
      'nama tombol yang sama muncul dua kali atau lebih. Hanya button, tidak mencakup tautan.',
    expected: 'Tombol dengan tujuan berbeda memiliki label berbeda.',
    remediation: 'Beri label yang spesifik pada setiap tombol.',
    limitation:
      'Tombol yang memang berulang (mis. "Tutup" di setiap kartu) dapat menjadi false positive.',
  },
  'ux-repetitive-layout': {
    version: '1.0.0',
    kind: 'subjective',
    category: 'UX_VISUAL',
    severity: 'INFO',
    title: 'Struktur kartu berulang',
    applicability: 'tiga atau lebih sibling dengan struktur anak yang sama',
    detection:
      'sibling dengan tag dan urutan tag anak yang sama, jumlah minimal 3, dan minimal 2 elemen anak per item (daftar tautan polos tidak dihitung).',
    expected: 'Informasi tidak bergantung hanya pada pola berulang.',
    remediation: 'Tinjau apakah pola berulang sesuai kebutuhan konten. Ini hanya informasi.',
    limitation: 'Hanya mengukur struktur DOM, bukan kualitas desain.',
  },
});

/** Versi aturan per ruleId untuk disimpan pada setiap temuan (ruleVersion). */
export function ruleVersionOf(ruleId: UxRuleId): string {
  return RULE_CATALOG[ruleId].version;
}

const Str = (max: number) => z.string().max(max);

/** Snapshot DOM yang dikumpulkan browser. Divalidasi sebelum dipakai (taskbook T-100 negative tests). */
export const SnapshotSchema = z.strictObject({
  schema: z.literal(1),
  url: Str(2048),
  title: Str(300),
  lang: Str(35).nullable(),
  viewport: z.strictObject({
    width: z.number().int().min(1).max(10_000),
    height: z.number().int().min(1).max(10_000),
  }),
  scrollWidth: z.number().int().min(0).max(1_000_000),
  headings: z
    .array(
      z.strictObject({
        level: z.number().int().min(1).max(6),
        text: Str(300),
        selector: Str(300),
        visible: z.boolean(),
      }),
    )
    .max(500),
  images: z
    .array(
      z.strictObject({
        selector: Str(300),
        src: Str(2048),
        alt: Str(500).nullable(),
        role: Str(50).nullable(),
        visible: z.boolean(),
        complete: z.boolean(),
        naturalWidth: z.number().int().min(0).max(100_000),
      }),
    )
    .max(500),
  buttons: z
    .array(z.strictObject({ selector: Str(300), name: Str(300), visible: z.boolean() }))
    .max(500),
  inputs: z
    .array(
      z.strictObject({
        selector: Str(300),
        kind: z.enum(['input', 'select', 'textarea']),
        type: Str(30),
        name: Str(300),
        visible: z.boolean(),
      }),
    )
    .max(500),
  links: z
    .array(
      z.strictObject({ selector: Str(300), href: Str(2048), name: Str(300), visible: z.boolean() }),
    )
    .max(500),
  overflowing: z.array(z.strictObject({ selector: Str(300), right: z.number().finite() })).max(20),
  repeatedGroups: z
    .array(
      z.strictObject({
        selector: Str(300),
        tag: Str(30),
        count: z.number().int().min(1).max(10_000),
        signature: Str(300),
      }),
    )
    .max(50),
  visibleText: Str(20_000),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export type RuleHit = {
  readonly ruleId: UxRuleId;
  readonly selector: string | null;
  readonly message: string;
  readonly actual: string;
};

const GENERIC_HEADINGS = new Set([
  'heading',
  'title',
  'header',
  'subtitle',
  'untitled',
  'your title here',
  'sample heading',
  'placeholder',
  'lorem ipsum',
  'judul',
  'judul di sini',
  'teks di sini',
]);

function normalizeHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.:!?]+$/, '');
}

/**
 * Menghitung semua pelanggaran dari satu snapshot. Fungsi murni: input sama selalu menghasilkan
 * output sama (determinisme, taskbook T-100 acceptance).
 */
export function evaluateSnapshot(snap: Snapshot): RuleHit[] {
  const hits: RuleHit[] = [];

  // ux-img-alt: alt absen (null). Alt kosong dianggap dekoratif.
  for (const img of snap.images) {
    if (!img.visible || img.alt !== null) continue;
    if (img.role === 'presentation' || img.role === 'none') continue;
    hits.push({
      ruleId: 'ux-img-alt',
      selector: img.selector,
      message: `img tanpa atribut alt (src ${basename(img.src)})`,
      actual: 'atribut alt tidak ada',
    });
  }

  // ux-broken-image: gambar selesai dimuat tetapi tidak punya lebar alami.
  for (const img of snap.images) {
    if (!img.visible || !img.complete || img.naturalWidth !== 0 || img.src === '') continue;
    hits.push({
      ruleId: 'ux-broken-image',
      selector: img.selector,
      message: `gambar gagal dimuat (src ${basename(img.src)})`,
      actual: 'naturalWidth 0 setelah load',
    });
  }

  // ux-control-label: tombol dan input tanpa nama aksesibel.
  for (const b of snap.buttons) {
    if (!b.visible || b.name !== '') continue;
    hits.push({
      ruleId: 'ux-control-label',
      selector: b.selector,
      message: 'button tanpa nama (button-without-label)',
      actual: 'nama kosong',
    });
  }
  for (const i of snap.inputs) {
    if (!i.visible || i.name !== '') continue;
    hits.push({
      ruleId: 'ux-control-label',
      selector: i.selector,
      message: `${i.kind} tipe ${i.type} tanpa label (input-without-label)`,
      actual: 'nama kosong',
    });
  }

  // ux-link-label: tautan tanpa nama.
  for (const a of snap.links) {
    if (!a.visible || a.name !== '') continue;
    hits.push({
      ruleId: 'ux-link-label',
      selector: a.selector,
      message: 'tautan tanpa teks (link-without-text)',
      actual: 'nama kosong',
    });
  }

  // ux-heading-level-skip: lompatan naik lebih dari satu level.
  let prev: number | null = null;
  for (const h of snap.headings) {
    if (!h.visible) continue;
    if (prev !== null && h.level > prev + 1) {
      hits.push({
        ruleId: 'ux-heading-level-skip',
        selector: h.selector,
        message: `heading h${h.level} setelah h${prev} (heading-level-skip)`,
        actual: `h${prev} -> h${h.level}`,
      });
    }
    prev = h.level;
  }

  // ux-horizontal-overflow: satu temuan per halaman untuk viewport ini.
  if (snap.scrollWidth > snap.viewport.width + 1) {
    const list = snap.overflowing.map((o) => o.selector).slice(0, 10);
    hits.push({
      ruleId: 'ux-horizontal-overflow',
      selector: null,
      message: `lebar dokumen ${snap.scrollWidth}px melebihi viewport ${snap.viewport.width}px`,
      actual: list.length > 0 ? `elemen: ${list.join(' | ')}` : `scrollWidth ${snap.scrollWidth}`,
    });
  }

  // ux-placeholder-text
  const placeholders: string[] = [];
  if (/lorem ipsum/i.test(snap.visibleText)) placeholders.push('Lorem ipsum');
  if (/\bTODO\b/.test(snap.visibleText)) placeholders.push('TODO');
  if (placeholders.length > 0) {
    hits.push({
      ruleId: 'ux-placeholder-text',
      selector: null,
      message: `teks contoh ditemukan: ${placeholders.join(', ')}`,
      actual: placeholders.join(', '),
    });
  }

  // ux-generic-heading (subjektif)
  const generic = snap.headings
    .filter((h) => h.visible && GENERIC_HEADINGS.has(normalizeHeading(h.text)))
    .map((h) => h.text);
  if (generic.length > 0) {
    hits.push({
      ruleId: 'ux-generic-heading',
      selector: null,
      message: `heading generik: ${generic.join(' | ')}`,
      actual: generic.join(' | '),
    });
  }

  // ux-duplicate-cta (subjektif): hanya button.
  const counts = new Map<string, number>();
  for (const b of snap.buttons) {
    if (!b.visible || b.name === '') continue;
    const key = b.name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const dupes = [...counts.entries()].filter(([, n]) => n >= 2).map(([k, n]) => `${k} (${n}x)`);
  if (dupes.length > 0) {
    hits.push({
      ruleId: 'ux-duplicate-cta',
      selector: null,
      message: `label tombol berulang: ${dupes.join(', ')}`,
      actual: dupes.join(', '),
    });
  }

  // ux-repetitive-layout (subjektif, INFO)
  // Kartu butuh struktur: minimal dua elemen anak. Daftar tautan polos (mis. nav) tidak dihitung.
  const groups = snap.repeatedGroups.filter((g) => g.count >= 3 && childCountOf(g.signature) >= 2);
  if (groups.length > 0) {
    hits.push({
      ruleId: 'ux-repetitive-layout',
      selector: null,
      message: `struktur berulang: ${groups.map((g) => `${g.tag} x${g.count}`).join(', ')}`,
      actual: groups.map((g) => `${g.selector} :: ${g.signature}`).join(' | '),
    });
  }

  return hits;
}

/** Jumlah elemen anak dari signature "tag[c1,c2,...]". */
export function childCountOf(signature: string): number {
  const inner = /\[(.*)\]$/.exec(signature)?.[1] ?? '';
  return inner === '' ? 0 : inner.split(',').length;
}

function basename(src: string): string {
  const clean = src.split(/[?#]/)[0] ?? '';
  return clean.split('/').pop() || '(kosong)';
}

/** Suppression: menandai temuan sebagai SUPPRESSED. Hasil mentah tidak pernah dihapus. */
export type SuppressionRule = {
  readonly ruleId: UxRuleId;
  readonly selector?: string | undefined;
  readonly reason: string;
};

export function matchSuppression(
  hit: RuleHit,
  rules: readonly SuppressionRule[],
): SuppressionRule | null {
  for (const r of rules) {
    if (r.ruleId !== hit.ruleId) continue;
    if (r.selector !== undefined && r.selector !== hit.selector) continue;
    return r;
  }
  return null;
}
