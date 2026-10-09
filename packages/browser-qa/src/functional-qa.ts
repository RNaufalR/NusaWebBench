import {
  checkUrlInScope,
  createFinding,
  followRedirectsSafely,
  nowIso,
  redactText,
  redactUrl,
  type Category,
  type Finding,
  type Severity,
  type Verification,
} from '@nusawebbench/core';
import type { ArtifactStore } from '@nusawebbench/storage';
import type { ModuleAdapter, ModuleContext, ModuleOutcome } from '@nusawebbench/orchestrator';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
  type Request as PwRequest,
  type Response as PwResponse,
} from 'playwright-core';
import {
  DUMMY_FORM_VALUE,
  parseFunctionalQaConfig,
  type FlowStep,
  type FunctionalQaConfig,
} from './config.js';
import {
  createRouteGuard,
  isRiskyClickLabel,
  normalizeLinkCandidates,
  type RouteStats,
} from './policy.js';

/** Versi paket Playwright yang dipin. Dicatat di hasil modul agar hasil dapat direproduksi. */
export const FUNCTIONAL_QA_TOOL = 'playwright-core';
export const FUNCTIONAL_QA_TOOL_VERSION = '1.64.0';
const RULE_VERSION = '1.0.0';
const USER_AGENT = 'NusaWebBench-QA/0.1 (audit lokal; tidak ada crawling publik)';
const MAX_FINDINGS = 200;
/** Batas antrean crawl agar satu halaman dengan banyak tautan tidak membengkakkan memori. */
const MAX_QUEUE = 200;

/** Argumen Chromium yang membatasi trafik latar belakang browser. */
export const BROWSER_ARGS: readonly string[] = [
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--no-first-run',
  '--disable-dev-shm-usage',
  '--disable-features=Translate,OptimizationHints,MediaRouter',
  '--no-zygote',
];

type RuleSpec = {
  readonly category: Category;
  readonly severity: Severity;
  readonly title: string;
  readonly expected: string;
  readonly remediation: string;
};

/** Katalog aturan deterministik modul FUNCTIONAL_QA. ruleId harus cocok dengan regex core. */
export const FUNCTIONAL_QA_RULES = {
  'qa-page-error': {
    category: 'FUNCTIONAL',
    severity: 'HIGH',
    title: 'Exception JavaScript tidak tertangani saat halaman dimuat',
    expected: 'Halaman dimuat tanpa exception JavaScript yang tidak tertangani.',
    remediation: 'Tangkap error di skrip atau perbaiki kode yang melempar exception.',
  },
  'qa-console-error': {
    category: 'FUNCTIONAL',
    severity: 'MEDIUM',
    title: 'Error konsol pada halaman',
    expected: 'Halaman tidak mencatat error ke konsol.',
    remediation: 'Periksa pesan error konsol dan perbaiki penyebabnya.',
  },
  'qa-request-failed': {
    category: 'FUNCTIONAL',
    severity: 'MEDIUM',
    title: 'Permintaan jaringan gagal',
    expected: 'Permintaan jaringan selesai tanpa kegagalan transport.',
    remediation: 'Periksa ketersediaan sumber daya dan konfigurasi jaringan.',
  },
  'qa-http-error-response': {
    category: 'FUNCTIONAL',
    severity: 'MEDIUM',
    title: 'Sumber daya mengembalikan status error HTTP',
    expected: 'Sumber daya yang diminta mengembalikan status 2xx atau 3xx.',
    remediation: 'Perbaiki tautan atau sumber daya yang hilang, atau hapus referensinya.',
  },
  'qa-broken-link': {
    category: 'FUNCTIONAL',
    severity: 'MEDIUM',
    title: 'Tautan internal rusak',
    expected: 'Tautan internal mengarah ke halaman yang tersedia.',
    remediation: 'Perbarui href atau pulihkan halaman tujuan.',
  },
  'qa-flow-assertion': {
    category: 'FUNCTIONAL',
    severity: 'MEDIUM',
    title: 'Asersi alur kritis gagal',
    expected: 'Langkah alur menghasilkan kondisi yang diharapkan.',
    remediation: 'Periksa elemen dan perilaku yang diharapkan pada langkah tersebut.',
  },
} as const satisfies Record<string, RuleSpec>;

export type RuleId = keyof typeof FUNCTIONAL_QA_RULES;

export type FunctionalQaOptions = {
  readonly artifacts: ArtifactStore;
  readonly config?: unknown;
  /** Path executable Chromium. Bila tidak diisi, `CHROMIUM_PATH` dipakai (lalu default Playwright). */
  readonly executablePath?: string | undefined;
  readonly now?: () => Date;
  /** Hook uji: peluncur browser pengganti (dipakai untuk memeriksa penutupan browser). */
  readonly launch?: (options: Parameters<typeof chromium.launch>[0]) => Promise<Browser>;
};

type Observation = {
  readonly ruleId: RuleId;
  readonly url: string;
  readonly message: string;
  readonly evidenceId: string | null;
  readonly selector?: string;
  readonly steps: readonly string[];
  readonly actual: string;
};

type PageCollector = {
  readonly pageErrors: string[];
  readonly consoleErrors: string[];
  readonly requestFailures: { url: string; errorText: string }[];
  readonly httpErrors: { url: string; status: number }[];
};

/** Galat yang menyebabkan langkah alur ditolak (bukan kegagalan aplikasi). */
class StepRefused extends Error {}

/** Kegagalan peluncuran browser: dibedakan antara "tool tidak tersedia" dan kegagalan lain. */
function isMissingExecutable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Executable doesn't exist|ENOENT|no such file|Failed to find/i.test(msg);
}

function isTimeout(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Timeout|timed out/i.test(msg);
}

/** Permintaan yang sengaja diblokir atau dibatalkan tidak dihitung sebagai defek aplikasi. */
function isIgnorableFailure(errorText: string): boolean {
  return errorText.includes('ERR_BLOCKED_BY_CLIENT') || errorText.includes('ERR_ABORTED');
}

/** Navigasi yang dihentikan oleh guard scope (route 'blockedbyclient'). */
function isBlockedNavigation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('ERR_BLOCKED_BY_CLIENT');
}

function isFaviconUrl(url: string): boolean {
  try {
    return new URL(url).pathname === '/favicon.ico';
  } catch {
    return false;
  }
}

/** True bila halaman mengumpulkan sinyal (exception, konsol, request gagal, status HTTP error). */
function hasPageSignals(c: PageCollector): boolean {
  return (
    c.pageErrors.length + c.consoleErrors.length + c.requestFailures.length + c.httpErrors.length >
    0
  );
}

function safeMessageOf(text: string): string {
  return redactText(text).slice(0, 300);
}

export class FunctionalQaAdapter implements ModuleAdapter {
  readonly module = 'FUNCTIONAL_QA' as const;
  readonly required = true;
  readonly timeoutMs = 120_000;
  readonly maxRetries = 0;

  private readonly artifacts: ArtifactStore;
  private readonly rawConfig: unknown;
  private readonly executablePath: string | undefined;
  private readonly now: () => Date;
  private readonly launcher: (options: Parameters<typeof chromium.launch>[0]) => Promise<Browser>;

  constructor(options: FunctionalQaOptions) {
    this.artifacts = options.artifacts;
    this.launcher = options.launch ?? ((o) => chromium.launch(o));
    this.rawConfig = options.config ?? {};
    this.executablePath = options.executablePath ?? process.env['CHROMIUM_PATH'] ?? undefined;
    this.now = options.now ?? (() => new Date());
  }

  async run(ctx: ModuleContext): Promise<ModuleOutcome> {
    let config: FunctionalQaConfig;
    try {
      config = parseFunctionalQaConfig(this.rawConfig);
    } catch {
      return {
        status: 'ERROR',
        errorCode: 'CONFIG_INVALID',
        errorMessageSafe: 'Konfigurasi QA fungsional tidak valid.',
      };
    }

    let browser: Browser | undefined;
    const closeBrowser = (): Promise<void> =>
      browser?.close().catch(() => undefined) ?? Promise.resolve();
    const onAbort = (): void => {
      void closeBrowser();
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    const observations: Observation[] = [];
    const stats: RouteStats = { blocked: 0 };
    const metrics: Record<string, number> = {
      pagesVisited: 0,
      linksChecked: 0,
      linksBroken: 0,
      linksUnreachable: 0,
      linksRedirectDenied: 0,
      flowsRun: 0,
      flowsFailed: 0,
      requestsBlocked: 0,
      navigationsBlocked: 0,
    };
    const artifactRefs: string[] = [];

    try {
      try {
        browser = await this.launcher({
          ...(this.executablePath !== undefined ? { executablePath: this.executablePath } : {}),
          headless: true,
          args: [...BROWSER_ARGS],
          timeout: config.navigationTimeoutMs * 3,
        });
      } catch (err) {
        if (isMissingExecutable(err)) {
          return {
            status: 'UNAVAILABLE',
            errorCode: 'TOOL_MISSING',
            errorMessageSafe: 'Browser Chromium untuk QA fungsional tidak ditemukan.',
            skippedReason: 'browser-not-installed',
            toolName: FUNCTIONAL_QA_TOOL,
            toolVersion: FUNCTIONAL_QA_TOOL_VERSION,
          };
        }
        return {
          status: 'ERROR',
          errorCode: isTimeout(err) ? 'TIMEOUT' : 'TOOL_FAILED',
          errorMessageSafe: 'Browser gagal diluncurkan.',
          retryable: isTimeout(err),
          toolName: FUNCTIONAL_QA_TOOL,
          toolVersion: FUNCTIONAL_QA_TOOL_VERSION,
        };
      }
      if (ctx.signal.aborted) {
        return { status: 'ERROR', errorCode: 'CANCELLED', errorMessageSafe: 'Dibatalkan.' };
      }

      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        acceptDownloads: false,
        serviceWorkers: 'block',
        userAgent: USER_AGENT,
      });
      try {
        await context.route('**/*', createRouteGuard(ctx.grant, stats));
        // WebSocket tidak dilewatkan ke route HTTP; tutup semua untuk menjaga scope.
        await context.routeWebSocket(/.*/, (ws) => {
          void ws.close({ code: 1008, reason: 'blocked-by-policy' });
        });

        const startUrl = new URL(config.startPath, ctx.grant.origin).toString();
        const queue: { url: string; depth: number }[] = [
          { url: startUrl, depth: 0 },
          ...config.extraPaths.map((p) => ({
            url: new URL(p, ctx.grant.origin).toString(),
            depth: 0,
          })),
        ];
        const visited = new Set<string>();
        const pages: {
          url: string;
          hrefs: string[];
          evidenceId: string | null;
          collector: PageCollector;
        }[] = [];

        // Batas dihitung dari percobaan navigasi (bukan hanya yang sukses), sehingga kegagalan
        // berulang tidak membuat crawl tanpa batas.
        let attempts = 0;
        while (queue.length > 0 && attempts < config.maxPages) {
          if (ctx.signal.aborted) break;
          const item = queue.shift();
          if (!item) break;
          const key = item.url;
          if (visited.has(key)) continue;
          visited.add(key);
          if (!(await checkUrlInScope(item.url, ctx.grant)).allowed) continue;

          attempts += 1;
          const isStart = item.url === startUrl;
          const result = await this.visit(context, item.url, config, ctx, isStart);
          if (!result.ok) {
            if (ctx.signal.aborted) {
              return { status: 'ERROR', errorCode: 'CANCELLED', errorMessageSafe: 'Dibatalkan.' };
            }
            if (isBlockedNavigation(result.error)) {
              // Navigasi keluar scope diblokir oleh kebijakan; ini perilaku yang diharapkan, bukan defek.
              metrics['navigationsBlocked'] = (metrics['navigationsBlocked'] ?? 0) + 1;
              continue;
            }
            if (pages.length === 0 && result.url === startUrl) {
              return {
                status: 'ERROR',
                errorCode: isTimeout(result.error) ? 'TIMEOUT' : 'TOOL_FAILED',
                errorMessageSafe: 'Halaman awal tidak dapat dimuat.',
                retryable: isTimeout(result.error),
                toolName: FUNCTIONAL_QA_TOOL,
                toolVersion: FUNCTIONAL_QA_TOOL_VERSION,
              };
            }
            observations.push({
              ruleId: 'qa-request-failed',
              url: redactUrl(item.url) ?? 'url-tidak-valid',
              message: safeMessageOf(
                result.error instanceof Error ? result.error.message : 'navigasi gagal',
              ),
              evidenceId: null,
              steps: [`Buka ${redactUrl(item.url) ?? 'url-tidak-valid'}`],
              actual: 'Navigasi ke halaman gagal.',
            });
            continue;
          }
          metrics['pagesVisited'] = (metrics['pagesVisited'] ?? 0) + 1;
          if (result.evidenceId) artifactRefs.push(result.evidenceId);
          pages.push({
            url: result.finalUrl,
            hrefs: result.hrefs,
            evidenceId: result.evidenceId,
            collector: result.collector,
          });
          if (item.depth < config.maxDepth) {
            for (const link of normalizeLinkCandidates(
              result.hrefs,
              result.finalUrl,
              ctx.grant.origin,
            )) {
              if (queue.length >= MAX_QUEUE) break;
              queue.push({ url: link, depth: item.depth + 1 });
            }
          }
          for (const obs of this.observationsFromCollector(
            result.collector,
            result.finalUrl,
            result.evidenceId,
          )) {
            observations.push(obs);
          }
        }

        if (!ctx.signal.aborted) {
          await this.checkLinks(context, pages, config, ctx, observations, metrics);
        }

        for (const flow of config.flows) {
          if (ctx.signal.aborted) break;
          metrics['flowsRun'] = (metrics['flowsRun'] ?? 0) + 1;
          const failure = await this.runFlow(
            context,
            flow,
            config,
            ctx,
            observations,
            artifactRefs,
          );
          if (failure) metrics['flowsFailed'] = (metrics['flowsFailed'] ?? 0) + 1;
        }
      } catch (err) {
        if (ctx.signal.aborted) {
          return { status: 'ERROR', errorCode: 'CANCELLED', errorMessageSafe: 'Dibatalkan.' };
        }
        if (err instanceof StepRefused) {
          return {
            status: 'ERROR',
            errorCode: 'VALIDATION_FAILED',
            errorMessageSafe: err.message,
            toolName: FUNCTIONAL_QA_TOOL,
            toolVersion: FUNCTIONAL_QA_TOOL_VERSION,
          };
        }
        return {
          status: 'ERROR',
          errorCode: isTimeout(err) ? 'TIMEOUT' : 'TOOL_FAILED',
          errorMessageSafe: 'QA fungsional gagal dijalankan.',
          retryable: isTimeout(err),
          toolName: FUNCTIONAL_QA_TOOL,
          toolVersion: FUNCTIONAL_QA_TOOL_VERSION,
        };
      } finally {
        metrics['requestsBlocked'] = stats.blocked;
        await context.close().catch(() => undefined);
      }

      if (ctx.signal.aborted) {
        return { status: 'ERROR', errorCode: 'CANCELLED', errorMessageSafe: 'Dibatalkan.' };
      }

      const { findings, rejected } = this.buildFindings(ctx, observations);
      metrics['findingsRejected'] = rejected;
      return {
        status: findings.length > 0 ? 'FAIL' : 'PASS',
        metrics,
        findings,
        artifactRefs,
        toolName: FUNCTIONAL_QA_TOOL,
        toolVersion: FUNCTIONAL_QA_TOOL_VERSION,
      };
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
      await closeBrowser();
    }
  }

  /** Memuat satu halaman, mengumpulkan sinyal, dan menyimpan screenshot sebagai bukti. */
  private async visit(
    context: BrowserContext,
    url: string,
    config: FunctionalQaConfig,
    ctx: ModuleContext,
    isStart: boolean,
  ): Promise<
    | {
        ok: true;
        finalUrl: string;
        hrefs: string[];
        evidenceId: string | null;
        collector: PageCollector;
      }
    | { ok: false; url: string; error: unknown; collector: PageCollector }
  > {
    const page = await context.newPage();
    const collector = this.attachCollector(page);
    try {
      await page.goto(url, { waitUntil: 'load', timeout: config.navigationTimeoutMs });
      await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => undefined);
      const finalUrl = page.url();
      const hrefs = await page
        .$$eval('a[href]', (els: { getAttribute(name: string): string | null }[]) =>
          els.map((e) => e.getAttribute('href') ?? ''),
        )
        .catch((): string[] => []);
      // Screenshot hanya untuk halaman awal (bukti render) dan halaman yang memiliki sinyal.
      const evidenceId =
        isStart || hasPageSignals(collector)
          ? await this.screenshot(page, ctx, config, `Halaman ${redactUrl(finalUrl) ?? ''}`)
          : null;
      return { ok: true, finalUrl, hrefs, evidenceId, collector };
    } catch (error) {
      return { ok: false, url, error, collector };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private attachCollector(page: Page): PageCollector {
    const collector: PageCollector = {
      pageErrors: [],
      consoleErrors: [],
      requestFailures: [],
      httpErrors: [],
    };
    page.on('pageerror', (err: Error) => {
      collector.pageErrors.push(safeMessageOf(err.message));
    });
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // Kegagalan resource sudah tercatat lewat event response/requestfailed; hindari duplikasi.
      if (text.startsWith('Failed to load resource')) return;
      if (text.includes('ERR_BLOCKED_BY_CLIENT')) return;
      collector.consoleErrors.push(safeMessageOf(text));
    });
    page.on('requestfailed', (req: PwRequest) => {
      const errorText = req.failure()?.errorText ?? 'UNKNOWN';
      if (isIgnorableFailure(errorText) || isFaviconUrl(req.url())) return;
      collector.requestFailures.push({ url: req.url(), errorText: safeMessageOf(errorText) });
    });
    page.on('response', (res: PwResponse) => {
      if (res.status() < 400 || isFaviconUrl(res.url())) return;
      collector.httpErrors.push({ url: res.url(), status: res.status() });
    });
    page.on('dialog', (dialog) => {
      void dialog.dismiss().catch(() => undefined);
    });
    return collector;
  }

  private observationsFromCollector(
    collector: PageCollector,
    pageUrl: string,
    evidenceId: string | null,
  ): Observation[] {
    const url = redactUrl(pageUrl) ?? 'url-tidak-valid';
    const steps = [`Buka ${url}`, 'Tunggu halaman dimuat dan jaringan tenang'];
    const out: Observation[] = [];
    for (const message of collector.pageErrors) {
      out.push({ ruleId: 'qa-page-error', url, message, evidenceId, steps, actual: message });
    }
    for (const message of collector.consoleErrors) {
      out.push({ ruleId: 'qa-console-error', url, message, evidenceId, steps, actual: message });
    }
    for (const failure of collector.requestFailures) {
      const reqUrl = redactUrl(failure.url) ?? 'url-tidak-valid';
      out.push({
        ruleId: 'qa-request-failed',
        url,
        message: `${reqUrl}: ${failure.errorText}`,
        evidenceId,
        steps,
        actual: `Permintaan ke ${reqUrl} gagal (${failure.errorText}).`,
      });
    }
    for (const err of collector.httpErrors) {
      const resUrl = redactUrl(err.url) ?? 'url-tidak-valid';
      out.push({
        ruleId: 'qa-http-error-response',
        url,
        message: `${resUrl} status ${err.status}`,
        evidenceId,
        steps,
        actual: `Sumber daya ${resUrl} mengembalikan status ${err.status}.`,
      });
    }
    return out;
  }

  private async checkLinks(
    context: BrowserContext,
    pages: { url: string; hrefs: string[]; evidenceId: string | null }[],
    config: FunctionalQaConfig,
    ctx: ModuleContext,
    observations: Observation[],
    metrics: Record<string, number>,
  ): Promise<void> {
    if (config.linkCheckLimit === 0) return;
    const sources = new Map<string, { page: string; evidenceId: string | null }>();
    for (const page of pages) {
      for (const link of normalizeLinkCandidates(page.hrefs, page.url, ctx.grant.origin)) {
        if (!sources.has(link)) sources.set(link, { page: page.url, evidenceId: page.evidenceId });
      }
    }
    const targets = [...sources.entries()].slice(0, config.linkCheckLimit);
    for (const [link, source] of targets) {
      if (ctx.signal.aborted) return;
      let lastStatus = 0;
      try {
        const result = await followRedirectsSafely(link, ctx.grant, async (u) => {
          const res = await context.request.get(u, {
            maxRedirects: 0,
            timeout: config.navigationTimeoutMs,
            failOnStatusCode: false,
          });
          lastStatus = res.status();
          return { status: res.status(), location: res.headers()['location'] ?? null };
        });
        metrics['linksChecked'] = (metrics['linksChecked'] ?? 0) + 1;
        if (!result.ok) {
          metrics['linksRedirectDenied'] = (metrics['linksRedirectDenied'] ?? 0) + 1;
          continue;
        }
        if (lastStatus >= 400) {
          metrics['linksBroken'] = (metrics['linksBroken'] ?? 0) + 1;
          const linkUrl = redactUrl(link) ?? 'url-tidak-valid';
          const sourceUrl = redactUrl(source.page) ?? 'url-tidak-valid';
          observations.push({
            ruleId: 'qa-broken-link',
            url: sourceUrl,
            message: `${linkUrl} status ${lastStatus}`,
            evidenceId: source.evidenceId,
            steps: [`Buka ${sourceUrl}`, `Ikuti tautan ke ${linkUrl}`],
            actual: `Tautan mengembalikan status ${lastStatus}.`,
          });
        }
      } catch {
        metrics['linksUnreachable'] = (metrics['linksUnreachable'] ?? 0) + 1;
      }
    }
  }

  /** Menjalankan satu alur. Mengembalikan true bila gagal (asersi atau elemen tidak ditemukan). */
  private async runFlow(
    context: BrowserContext,
    flow: FunctionalQaConfig['flows'][number],
    config: FunctionalQaConfig,
    ctx: ModuleContext,
    observations: Observation[],
    artifactRefs: string[],
  ): Promise<boolean> {
    const page = await context.newPage();
    const collector = this.attachCollector(page);
    const timeout = config.navigationTimeoutMs;
    const executed: string[] = [];
    let failed = false;
    // Setiap alur dimulai dari startPath agar hasilnya tidak bergantung pada halaman sebelumnya.
    const steps: FlowStep[] = [{ action: 'goto', path: config.startPath }, ...flow.steps];
    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step) continue;
        const failure = await this.runStep(page, step, timeout, ctx.grant.origin);
        executed.push(describeStep(step));
        if (failure !== null) {
          failed = true;
          const evidenceId = await this.screenshot(
            page,
            ctx,
            config,
            `Alur ${flow.name} langkah ${i + 1}`,
          );
          if (evidenceId) artifactRefs.push(evidenceId);
          const pageUrl = redactUrl(page.url()) ?? 'url-tidak-valid';
          observations.push({
            ruleId: 'qa-flow-assertion',
            url: pageUrl,
            message: `${flow.name} langkah ${i + 1}: ${failure}`,
            evidenceId,
            ...(step.action !== 'goto' && 'selector' in step ? { selector: step.selector } : {}),
            steps: [...executed],
            actual: `Langkah ${i + 1} (${step.action}) gagal: ${failure}`,
          });
          break;
        }
      }
      return failed;
    } finally {
      // Sinyal halaman (pageerror, konsol, respons) tetap dilaporkan walau alur gagal,
      // dan diberi bukti screenshot bila ada sinyal.
      const evidenceId = hasPageSignals(collector)
        ? await this.screenshot(page, ctx, config, `Alur ${flow.name} (sinyal halaman)`)
        : null;
      if (evidenceId) artifactRefs.push(evidenceId);
      observations.push(...this.observationsFromCollector(collector, page.url(), evidenceId));
      await page.close().catch(() => undefined);
    }
  }

  /**
   * Mengembalikan null bila langkah berhasil, atau alasan kegagalan (aman, pendek).
   * Selector tidak valid atau kesalahan Playwright menjadi kegagalan langkah, bukan crash modul.
   * Penolakan kebijakan (StepRefused) tetap diteruskan.
   */
  private async runStep(
    page: Page,
    step: FlowStep,
    timeout: number,
    origin: string,
  ): Promise<string | null> {
    try {
      return await this.executeStep(page, step, timeout, origin);
    } catch (err) {
      if (err instanceof StepRefused) throw err;
      return 'langkah gagal dijalankan (selector tidak valid atau timeout)';
    }
  }

  private async executeStep(
    page: Page,
    step: FlowStep,
    timeout: number,
    origin: string,
  ): Promise<string | null> {
    switch (step.action) {
      case 'goto': {
        const url = new URL(step.path, origin);
        try {
          await page.goto(url.toString(), { waitUntil: 'load', timeout });
          return null;
        } catch {
          return 'navigasi ke path gagal';
        }
      }
      case 'click': {
        // Selector sendiri juga diperiksa, sehingga klik berisiko ditolak meski elemen tidak ada.
        if (isRiskyClickLabel(step.selector)) {
          throw new StepRefused('Langkah klik ditolak: selector memuat aksi berisiko.');
        }
        const loc = page.locator(step.selector).first();
        const info = await loc
          .evaluate(
            (el: {
              tagName: string;
              type?: unknown;
              textContent?: unknown;
              getAttribute(name: string): string | null;
            }) => ({
              tag: el.tagName.toLowerCase(),
              type: typeof el.type === 'string' ? el.type.toLowerCase() : '',
              text: [
                el.textContent,
                el.getAttribute('aria-label'),
                el.getAttribute('value'),
                el.getAttribute('href'),
              ]
                .filter((x): x is string => typeof x === 'string')
                .join(' '),
            }),
            undefined,
            { timeout },
          )
          .catch(() => null);
        if (!info) return 'elemen tidak ditemukan atau tidak dapat diklik';
        // Tombol submit (default button di dalam form) dapat mengirim data; tidak diizinkan.
        const isSubmit =
          (info.tag === 'input' && (info.type === 'submit' || info.type === 'image')) ||
          (info.tag === 'button' && info.type === 'submit');
        if (isSubmit) {
          throw new StepRefused('Langkah klik ditolak: tombol submit form tidak diizinkan.');
        }
        if (isRiskyClickLabel(`${info.text} ${step.selector}`)) {
          throw new StepRefused('Langkah klik ditolak: label elemen termasuk aksi berisiko.');
        }
        try {
          await loc.click({ timeout });
        } catch {
          return 'elemen tidak ditemukan atau tidak dapat diklik';
        }
        await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => undefined);
        return null;
      }
      case 'fillDummy': {
        const loc = page.locator(step.selector).first();
        const info = await loc
          .evaluate(
            (el: { tagName: string; type?: unknown }) => ({
              tag: el.tagName.toLowerCase(),
              type: typeof el.type === 'string' ? el.type : '',
            }),
            undefined,
            { timeout },
          )
          .catch(() => null);
        if (!info) return 'elemen tidak ditemukan';
        const blockedTypes = [
          'password',
          'file',
          'hidden',
          'submit',
          'checkbox',
          'radio',
          'button',
          'image',
          'reset',
        ];
        const fillable =
          info.tag === 'textarea' || (info.tag === 'input' && !blockedTypes.includes(info.type));
        if (!fillable) throw new StepRefused('Langkah isi ditolak: elemen bukan input teks dummy.');
        await loc.fill(DUMMY_FORM_VALUE, { timeout });
        return null;
      }
      case 'expectVisible': {
        try {
          await page.locator(step.selector).first().waitFor({ state: 'visible', timeout });
          return null;
        } catch {
          return 'elemen tidak terlihat';
        }
      }
      case 'expectText': {
        const text = await page
          .locator(step.selector)
          .first()
          .textContent({ timeout })
          .catch(() => null);
        if (text === null) return 'elemen tidak ditemukan';
        if (!text.includes(step.text)) return 'teks tidak sesuai harapan';
        return null;
      }
      case 'expectCount': {
        const count = await page.locator(step.selector).count();
        return count === step.count ? null : `jumlah elemen ${count}, diharapkan ${step.count}`;
      }
      case 'expectPath': {
        const actual = new URL(page.url()).pathname;
        const expected = new URL(step.path, 'http://placeholder.invalid').pathname;
        return actual === expected ? null : `path ${actual}, diharapkan ${expected}`;
      }
      case 'expectValidity': {
        const loc = page.locator(step.selector).first();
        const valid = await loc.evaluate(
          (el: { validity?: { valid?: unknown } }) => el.validity?.valid === true,
          undefined,
          { timeout },
        );
        return valid === step.valid ? null : `validitas ${valid}, diharapkan ${step.valid}`;
      }
    }
  }

  private async screenshot(
    page: Page,
    ctx: ModuleContext,
    config: FunctionalQaConfig,
    description: string,
  ): Promise<string | null> {
    try {
      const bytes = await page.screenshot({
        type: 'png',
        fullPage: false,
        timeout: config.navigationTimeoutMs,
      });
      const evidence = this.artifacts.write({
        runId: ctx.runId,
        kind: 'screenshot',
        mimeType: 'image/png',
        bytes,
        sourceTool: FUNCTIONAL_QA_TOOL,
        sourceVersion: FUNCTIONAL_QA_TOOL_VERSION,
        description: description.slice(0, 200),
        redactionApplied: false,
        synthetic: ctx.grant.mode === 'local-fixture',
      });
      return evidence.id;
    } catch {
      return null;
    }
  }

  /**
   * Menyusun temuan tervalidasi dari observasi. Observasi yang gagal validasi schema dilewati
   * dan dihitung (`rejected`); satu temuan buruk tidak menggagalkan seluruh modul.
   */
  private buildFindings(
    ctx: ModuleContext,
    observations: readonly Observation[],
  ): { findings: Finding[]; rejected: number } {
    const seen = new Set<string>();
    const findings: Finding[] = [];
    let rejected = 0;
    const createdAt = nowIso(this.now());
    for (const obs of observations) {
      if (findings.length >= MAX_FINDINGS) break;
      const dedupeKey = `${obs.ruleId}|${obs.url}|${obs.message}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const rule = FUNCTIONAL_QA_RULES[obs.ruleId];
      const verification: Verification = obs.evidenceId ? 'CONFIRMED' : 'LIKELY';
      try {
        findings.push(
          createFinding({
            runId: ctx.runId,
            moduleResultId: ctx.moduleResultId,
            category: rule.category,
            title: rule.title,
            description: `${rule.title}: ${obs.message}`,
            severity: rule.severity,
            confidence: obs.evidenceId ? 0.95 : 0.8,
            verification,
            source: 'DETERMINISTIC',
            targetUrl: obs.url.startsWith('http') ? obs.url : null,
            selector: obs.selector ?? null,
            evidenceRefs: obs.evidenceId ? [obs.evidenceId] : [],
            reproductionSteps: obs.steps.slice(0, 20),
            expected: rule.expected,
            actual: obs.actual,
            remediation: rule.remediation,
            createdAt,
            status: 'OPEN',
            ruleId: obs.ruleId,
            ruleVersion: RULE_VERSION,
          }),
        );
      } catch {
        rejected += 1;
      }
    }
    return { findings, rejected };
  }
}

function describeStep(step: FlowStep): string {
  switch (step.action) {
    case 'goto':
      return `goto ${step.path}`;
    case 'click':
      return `click ${step.selector}`;
    case 'fillDummy':
      return `isi data dummy ke ${step.selector}`;
    case 'expectVisible':
      return `pastikan terlihat ${step.selector}`;
    case 'expectText':
      return `pastikan teks ${step.selector} memuat "${step.text}"`;
    case 'expectCount':
      return `pastikan jumlah ${step.selector} = ${step.count}`;
    case 'expectPath':
      return `pastikan path = ${step.path}`;
    case 'expectValidity':
      return `pastikan validitas ${step.selector} = ${step.valid}`;
  }
}
