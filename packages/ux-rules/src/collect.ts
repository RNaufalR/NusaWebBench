import { chromium, type Browser, type LaunchOptions } from 'playwright-core';
import { BROWSER_ARGS, createRouteGuard, type RouteStats } from '@nusawebbench/browser-qa';
import { browserPinArgs } from '@nusawebbench/core';
import { checkUrlInScope, type ScopeGrant } from '@nusawebbench/core';
import { SnapshotSchema, type Snapshot } from './rules.js';

/**
 * Skrip yang dijalankan di dalam halaman. Disimpan sebagai string karena tsconfig proyek tidak
 * memuat lib DOM; skrip ini hanya membaca DOM dan tidak mengubah halaman.
 */
export const COLLECT_SCRIPT = `(() => {
  const cap = (s, n) => (s.length > n ? s.slice(0, n) : s);
  const txt = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => {
    if (el.getClientRects().length === 0) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  };
  const selectorOf = (el) => {
    if (el.id && /^[A-Za-z][\\w-]{0,60}$/.test(el.id) && document.querySelectorAll('#' + el.id).length === 1) {
      return '#' + el.id;
    }
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 40) {
      const tag = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (!parent) { parts.unshift(tag); break; }
      const same = Array.prototype.filter.call(parent.children, (c) => c.tagName === cur.tagName);
      parts.unshift(same.length > 1 ? tag + ':nth-of-type(' + (same.indexOf(cur) + 1) + ')' : tag);
      cur = parent;
    }
    return cap(parts.join(' > '), 300);
  };
  const labelledby = (el) => {
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean);
    return txt(ids.map((id) => { const n = document.getElementById(id); return n ? n.textContent : ''; }).join(' '));
  };
  const labelsOf = (el) => txt(Array.prototype.map.call(el.labels || [], (l) => l.textContent).join(' '));
  const buttonName = (el) =>
    txt(el.getAttribute('aria-label')) || labelledby(el) || txt(el.textContent) ||
    txt(el.getAttribute('value')) || txt(el.getAttribute('alt')) || txt(el.getAttribute('title'));
  const inputName = (el) =>
    txt(el.getAttribute('aria-label')) || labelledby(el) || labelsOf(el) || txt(el.getAttribute('title'));
  const linkName = (el) => {
    const alts = Array.prototype.map.call(el.querySelectorAll('img'), (i) => txt(i.getAttribute('alt'))).filter(Boolean);
    return txt(el.getAttribute('aria-label')) || labelledby(el) || txt(el.textContent) ||
      alts.join(' ') || txt(el.getAttribute('title'));
  };
  const all = (sel, max) => Array.prototype.slice.call(document.querySelectorAll(sel), 0, max);

  const headings = all('h1,h2,h3,h4,h5,h6', 500).map((h) => ({
    level: Number(h.tagName.charAt(1)),
    text: cap(txt(h.textContent), 300),
    selector: selectorOf(h),
    visible: visible(h),
  }));
  const images = all('img', 500).map((img) => {
    const alt = img.getAttribute('alt');
    const role = img.getAttribute('role');
    return {
      selector: selectorOf(img),
      src: cap(img.getAttribute('src') || '', 2048),
      alt: alt === null ? null : cap(alt, 500),
      role: role === null ? null : cap(role, 50),
      visible: visible(img),
      complete: img.complete,
      naturalWidth: img.naturalWidth,
    };
  });
  const buttons = all('button, input[type=submit], input[type=button], input[type=reset], input[type=image]', 500).map((b) => ({
    selector: selectorOf(b),
    name: cap(buttonName(b), 300),
    visible: visible(b),
  }));
  const inputs = all('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea', 500).map((i) => {
    const tag = i.tagName.toLowerCase();
    return {
      selector: selectorOf(i),
      kind: tag,
      type: cap(tag === 'input' ? (i.getAttribute('type') || 'text') : tag, 30),
      name: cap(inputName(i), 300),
      visible: visible(i),
    };
  });
  const links = all('a[href]', 500).map((a) => ({
    selector: selectorOf(a),
    href: cap(a.getAttribute('href') || '', 2048),
    name: cap(linkName(a), 300),
    visible: visible(a),
  }));

  const vw = window.innerWidth;
  const overflowing = [];
  for (const el of all('body *', 5000)) {
    if (overflowing.length >= 20) break;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && visible(el)) overflowing.push({ selector: selectorOf(el), right: Math.round(r.right) });
  }

  const repeatedGroups = [];
  for (const p of all('body, body *', 5000)) {
    const kids = Array.prototype.slice.call(p.children, 0, 200);
    if (kids.length < 3) continue;
    const counts = new Map();
    for (const k of kids) {
      const sig = k.tagName.toLowerCase() + '[' + Array.prototype.map.call(k.children, (c) => c.tagName.toLowerCase()).slice(0, 20).join(',') + ']';
      counts.set(sig, (counts.get(sig) || 0) + 1);
    }
    for (const [sig, count] of counts) {
      if (count >= 3 && repeatedGroups.length < 50) {
        repeatedGroups.push({ selector: selectorOf(p), tag: sig.split('[')[0], count, signature: cap(sig, 300) });
      }
    }
  }

  return {
    schema: 1,
    url: cap(location.href, 2048),
    title: cap(document.title, 300),
    lang: document.documentElement.getAttribute('lang') === null ? null : cap(document.documentElement.getAttribute('lang'), 35),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scrollWidth: document.documentElement.scrollWidth,
    headings, images, buttons, inputs, links, overflowing,
    repeatedGroups,
    visibleText: cap(document.body ? document.body.innerText : '', 20000),
  };
})()`;

export type CollectOptions = {
  readonly grant: ScopeGrant;
  readonly url: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly executablePath: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly launch?: (o: LaunchOptions) => Promise<Browser>;
};

export class CollectError extends Error {
  constructor(
    readonly reason: 'LAUNCH' | 'NAVIGATION' | 'SCRIPT' | 'INVALID' | 'CANCELLED',
    readonly timedOut: boolean,
  ) {
    super(reason);
  }
}

/**
 * Mengumpulkan snapshot satu halaman. Semua permintaan browser melewati guard scope. Browser selalu
 * ditutup di finally, termasuk saat pembatalan atau error.
 */
export async function collectSnapshot(opts: CollectOptions): Promise<Snapshot> {
  const launcher: (o: LaunchOptions) => Promise<Browser> =
    opts.launch ?? ((o) => chromium.launch(o));
  let browser: Browser | undefined;
  const onAbort = (): void => {
    void browser?.close().catch(() => undefined);
  };
  opts.signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (opts.signal.aborted) throw new CollectError('CANCELLED', false);
    let pinArgs: string[];
    try {
      pinArgs = await browserPinArgs(opts.grant);
    } catch {
      throw new CollectError('INVALID', false);
    }
    try {
      browser = await launcher({
        executablePath: opts.executablePath,
        headless: true,
        args: [...BROWSER_ARGS, ...pinArgs],
        timeout: opts.timeoutMs,
      });
    } catch {
      throw new CollectError('LAUNCH', false);
    }
    const context = await browser.newContext({
      viewport: { width: opts.viewport.width, height: opts.viewport.height },
      javaScriptEnabled: true,
      acceptDownloads: false,
    });
    const stats: RouteStats = { blocked: 0 };
    await context.route('**/*', createRouteGuard(opts.grant, stats));
    const page = await context.newPage();
    page.setDefaultTimeout(opts.timeoutMs);
    try {
      const first = await checkUrlInScope(opts.url, opts.grant);
      if (!first.allowed) throw new CollectError('NAVIGATION', false);
      await page.goto(opts.url, { waitUntil: 'load', timeout: opts.timeoutMs });
    } catch (err) {
      throw new CollectError('NAVIGATION', isTimeoutError(err));
    }
    let raw: unknown;
    try {
      raw = await page.evaluate(COLLECT_SCRIPT);
    } catch {
      throw new CollectError('SCRIPT', false);
    }
    const parsed = SnapshotSchema.safeParse(raw);
    if (!parsed.success) throw new CollectError('INVALID', false);
    return parsed.data;
  } finally {
    opts.signal.removeEventListener('abort', onAbort);
    await browser?.close().catch(() => undefined);
  }
}

function isTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Timeout|timed out/i.test(msg);
}
