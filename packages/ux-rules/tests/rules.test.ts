import { describe, expect, it } from 'vitest';
import { AppError } from '@nusawebbench/core';
import {
  RULE_CATALOG,
  SnapshotSchema,
  UX_RULE_IDS,
  evaluateSnapshot,
  matchSuppression,
  parseUxRulesConfig,
  type Snapshot,
} from '../src/index.js';

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    schema: 1,
    url: 'http://127.0.0.1:4178/',
    title: 'Uji',
    lang: 'id',
    viewport: { width: 390, height: 844 },
    scrollWidth: 390,
    headings: [],
    images: [],
    buttons: [],
    inputs: [],
    links: [],
    overflowing: [],
    repeatedGroups: [],
    visibleText: '',
    ...over,
  };
}

const sel = (n: number) => `html > body > main > el:nth-of-type(${n})`;

describe('katalog aturan', () => {
  it('setiap ruleId memiliki versi semver, kind, dan severity yang valid', () => {
    for (const id of UX_RULE_IDS) {
      const def = RULE_CATALOG[id];
      expect(def.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(['objective', 'subjective']).toContain(def.kind);
      expect(def.limitation.length).toBeGreaterThan(5);
    }
  });

  it('pemeriksaan subjektif tidak pernah berkategori objective', () => {
    const subjective = UX_RULE_IDS.filter((id) => RULE_CATALOG[id].kind === 'subjective');
    expect(subjective.sort()).toEqual(
      ['ux-duplicate-cta', 'ux-generic-heading', 'ux-repetitive-layout'].sort(),
    );
  });
});

describe('evaluateSnapshot — kasus positif dan batas', () => {
  it('DOM kosong menghasilkan nol temuan', () => {
    expect(evaluateSnapshot(snap())).toEqual([]);
  });

  it('gambar tanpa alt terdeteksi; alt="" dan role presentation tidak', () => {
    const hits = evaluateSnapshot(
      snap({
        images: [
          {
            selector: sel(1),
            src: '/a.png',
            alt: null,
            role: null,
            visible: true,
            complete: true,
            naturalWidth: 10,
          },
          {
            selector: sel(2),
            src: '/b.png',
            alt: '',
            role: null,
            visible: true,
            complete: true,
            naturalWidth: 10,
          },
          {
            selector: sel(3),
            src: '/c.png',
            alt: null,
            role: 'presentation',
            visible: true,
            complete: true,
            naturalWidth: 10,
          },
          {
            selector: sel(4),
            src: '/d.png',
            alt: null,
            role: null,
            visible: false,
            complete: true,
            naturalWidth: 10,
          },
        ],
      }),
    );
    expect(hits.filter((h) => h.ruleId === 'ux-img-alt')).toHaveLength(1);
    expect(hits.find((h) => h.ruleId === 'ux-img-alt')?.selector).toBe(sel(1));
  });

  it('elemen tersembunyi (off-screen/display none) tidak diperiksa label-nya', () => {
    const hits = evaluateSnapshot(
      snap({
        buttons: [{ selector: sel(1), name: '', visible: false }],
        links: [{ selector: sel(2), href: '/x', name: '', visible: false }],
      }),
    );
    expect(hits).toEqual([]);
  });

  it('kontrol dan tautan tanpa nama dilaporkan per elemen dengan selector unik', () => {
    const hits = evaluateSnapshot(
      snap({
        buttons: [
          { selector: sel(1), name: '', visible: true },
          { selector: sel(2), name: '', visible: true },
        ],
        inputs: [{ selector: sel(3), kind: 'input', type: 'text', name: '', visible: true }],
        links: [{ selector: sel(4), href: '/a', name: '', visible: true }],
      }),
    );
    expect(hits.map((h) => h.ruleId)).toEqual([
      'ux-control-label',
      'ux-control-label',
      'ux-control-label',
      'ux-link-label',
    ]);
    expect(new Set(hits.map((h) => h.selector)).size).toBe(4);
  });

  it('lompatan heading dan heading pertama tidak dibandingkan', () => {
    const hits = evaluateSnapshot(
      snap({
        headings: [
          { level: 4, text: 'a', selector: sel(1), visible: true },
          { level: 5, text: 'b', selector: sel(2), visible: true },
          { level: 2, text: 'c', selector: sel(3), visible: true },
          { level: 4, text: 'd', selector: sel(4), visible: true },
        ],
      }),
    );
    expect(hits.filter((h) => h.ruleId === 'ux-heading-level-skip').map((h) => h.selector)).toEqual(
      [sel(4)],
    );
  });

  it('placeholder peka huruf: "TODO" dicocokkan, "todo" tidak', () => {
    expect(evaluateSnapshot(snap({ visibleText: 'catatan todo kecil' }))).toEqual([]);
    const hits = evaluateSnapshot(snap({ visibleText: 'Lorem Ipsum dan TODO' }));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.actual).toBe('Lorem ipsum, TODO');
  });

  it('heading generik dinormalisasi (huruf kecil, tanda baca akhir)', () => {
    const hits = evaluateSnapshot(
      snap({
        headings: [
          { level: 1, text: 'Heading.', selector: sel(1), visible: true },
          { level: 2, text: 'Layanan Kami', selector: sel(2), visible: true },
        ],
      }),
    );
    expect(hits.filter((h) => h.ruleId === 'ux-generic-heading')).toHaveLength(1);
  });

  it('duplikat CTA hanya untuk button yang sama namanya (tidak case-sensitive)', () => {
    const hits = evaluateSnapshot(
      snap({
        buttons: [
          { selector: sel(1), name: 'Daftar', visible: true },
          { selector: sel(2), name: 'daftar', visible: true },
          { selector: sel(3), name: 'Masuk', visible: true },
        ],
      }),
    );
    const dup = hits.filter((h) => h.ruleId === 'ux-duplicate-cta');
    expect(dup).toHaveLength(1);
    expect(dup[0]?.actual).toBe('daftar (2x)');
  });

  it('struktur berulang butuh minimal tiga sibling', () => {
    const two = evaluateSnapshot(
      snap({
        repeatedGroups: [
          { selector: 'html > body', tag: 'section', count: 2, signature: 'section[h3,p]' },
        ],
      }),
    );
    expect(two.some((h) => h.ruleId === 'ux-repetitive-layout')).toBe(false);
    const three = evaluateSnapshot(
      snap({
        repeatedGroups: [
          { selector: 'html > body', tag: 'section', count: 3, signature: 'section[h3,p]' },
        ],
      }),
    );
    expect(three.some((h) => h.ruleId === 'ux-repetitive-layout')).toBe(true);
  });

  it('daftar tautan polos (nav tanpa struktur anak) tidak dihitung sebagai kartu berulang', () => {
    const nav = evaluateSnapshot(
      snap({
        repeatedGroups: [
          { selector: 'html > body > header > nav', tag: 'a', count: 3, signature: 'a[]' },
        ],
      }),
    );
    expect(nav.some((h) => h.ruleId === 'ux-repetitive-layout')).toBe(false);
  });

  it('overflow horizontal hanya bila scrollWidth melewati viewport (toleransi 1 px)', () => {
    expect(
      evaluateSnapshot(snap({ scrollWidth: 391 })).some(
        (h) => h.ruleId === 'ux-horizontal-overflow',
      ),
    ).toBe(false);
    expect(
      evaluateSnapshot(snap({ scrollWidth: 392 })).some(
        (h) => h.ruleId === 'ux-horizontal-overflow',
      ),
    ).toBe(true);
  });

  it('determinisme: input sama menghasilkan output identik', () => {
    const s = snap({
      images: [
        {
          selector: sel(1),
          src: '/a.png',
          alt: null,
          role: null,
          visible: true,
          complete: true,
          naturalWidth: 5,
        },
      ],
      visibleText: 'TODO',
    });
    expect(evaluateSnapshot(s)).toEqual(evaluateSnapshot(s));
  });
});

describe('validasi snapshot dan konfigurasi', () => {
  it('snapshot dengan field tak dikenal atau nilai di luar batas ditolak', () => {
    expect(SnapshotSchema.safeParse({ ...snap(), extra: 1 }).success).toBe(false);
    expect(
      SnapshotSchema.safeParse({ ...snap(), viewport: { width: 0, height: 10 } }).success,
    ).toBe(false);
    expect(SnapshotSchema.safeParse({ ...snap(), scrollWidth: Number.NaN }).success).toBe(false);
    expect(SnapshotSchema.safeParse(snap()).success).toBe(true);
  });

  it('konfigurasi: viewport di luar 320–2560, rule ID tak dikenal, dan path tidak valid ditolak', () => {
    expect(() => parseUxRulesConfig({ viewport: { width: 100, height: 800 } })).toThrow(AppError);
    expect(() =>
      parseUxRulesConfig({ suppressions: [{ ruleId: 'ux-fake', reason: 'abc' }] }),
    ).toThrow(AppError);
    expect(() => parseUxRulesConfig({ startPath: '//evil.example' })).toThrow(AppError);
    expect(parseUxRulesConfig({}).viewport).toEqual({ width: 390, height: 844 });
  });
});

describe('suppression', () => {
  it('suppression per selector hanya menekan elemen yang cocok', () => {
    const hit = { ruleId: 'ux-img-alt' as const, selector: sel(1), message: '', actual: '' };
    expect(
      matchSuppression(hit, [{ ruleId: 'ux-img-alt', selector: sel(1), reason: 'logo' }]),
    ).not.toBeNull();
    expect(
      matchSuppression(hit, [{ ruleId: 'ux-img-alt', selector: sel(2), reason: 'logo' }]),
    ).toBeNull();
    expect(matchSuppression(hit, [{ ruleId: 'ux-control-label', reason: 'x' }])).toBeNull();
  });
});
