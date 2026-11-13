/**
 * TypeScript definitions for one-step-seo.
 */

export type FindingSeverity = "P0" | "P1" | "P2" | "P3" | "pass";
export type FindingCategory =
  | "technical"
  | "onpage"
  | "schema"
  | "geo"
  | "performance"
  | "security"
  | "accessibility"
  | "international"
  | "architecture";

export interface Finding {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  evidence: string;
  fix: string;
  diff?: string;
  confidence?: number;
}

export type ScoreBand = "A" | "B" | "C" | "D" | "F";

export interface ScoreDetail {
  score: number | null;
  band: ScoreBand | null;
}

export interface Scores {
  search: ScoreDetail;
  ai: ScoreDetail;
}

export interface ReportMeta {
  version: string;
}

export interface ReportCounts {
  P0: number;
  P1: number;
  P2: number;
  P3: number;
  pass: number;
}

export interface ParsedPageData {
  title?: string;
  metaDescription?: string;
  canonical?: string;
  charset?: string;
  viewport?: string;
  h1s?: string[];
  h2s?: string[];
  wordCount?: number;
  internalLinks?: string[];
  externalLinks?: string[];
  schemaTypes?: string[];
  [key: string]: unknown;
}

export interface SiteFilesData {
  origin?: string;
  robots?: {
    found: boolean;
    status: number;
    sitemaps: string[];
    disallowCount: number;
    aiBlocked: boolean;
    blockedBots: string[];
    textSample?: string;
    text?: string;
  };
  sitemap?: {
    found: boolean;
    status: number;
    url: string;
    urlCount: number;
    fromRobots: string[];
    truncated: boolean;
    text?: string;
  };
  llms?: {
    found: boolean;
    status: number;
    bytes: number;
    text?: string;
  };
}

export interface Report {
  tool: string;
  version: string;
  rulesVersion: string;
  url: string;
  finalUrl: string;
  checkedAt: string;
  truncated: boolean;
  scores: Scores;
  counts: ReportCounts;
  findings: Finding[];
  page: ParsedPageData;
  site: SiteFilesData;
}

export interface SitePageSummary {
  url: string;
  finalUrl: string;
  title: string;
  metaDescription: string;
  scores: Scores;
  counts: ReportCounts;
  topIssue: string;
  reportFiles: {
    html?: string;
    md?: string;
    json?: string;
  };
}

export interface SiteReport {
  tool: string;
  version: string;
  reportType: "site";
  checkedAt: string;
  origin: string;
  pageCount: number;
  scores: {
    search: {
      average: number | null;
      min: number | null;
      validPages: number;
    };
    ai: {
      average: number | null;
      min: number | null;
      validPages: number;
    };
  };
  severities: ReportCounts;
  categories: Record<string, number>;
  topIssues: {
    id: string;
    title: string;
    severity: FindingSeverity;
    occurrences: number;
  }[];
  duplicateTitles: {
    title: string;
    urls: string[];
  }[];
  pages: SitePageSummary[];
}

export interface AggregateSummary {
  avgSearch: number | null;
  avgAi: number | null;
  minSearch: number | null;
  minAi: number | null;
  searchValid: number;
  aiValid: number;
  totals: ReportCounts;
}

export interface CheckDefinition {
  id: string;
  category: FindingCategory;
  defaultSeverity: FindingSeverity;
  title: string;
  run: (ctx: unknown) => Finding | null;
}

export interface SkillInfo {
  id: string;
  name: string;
  category: string;
  description: string;
  offline: boolean;
  checks: string[];
}

export interface ParsedArgs {
  _: string[];
  pages: number;
  out: string;
  formats: string[];
  timeout: number;
  generate: string;
  json: boolean;
  failOn: string;
  crawl: string;
  concurrency: number;
  verbose: boolean;
  quiet: boolean;
  blockPrivateIps: boolean;
  checkConfig: boolean;
  offline: boolean;
  all: boolean;
  maxDepth?: number;
  include?: string;
  exclude?: string;
  stripQuery?: boolean;
  skills: string;
  excludeSkills: string;
  delay: number;
  debug: boolean;
  force: boolean;
  profile: string;
  checkLinks: boolean;
  apply: boolean;
  noBackup: boolean;
  only: string;
  url: string;
  title: string;
  description: string;
  lang: string;
  ogImage: string;
  psi: boolean;
  psiStrategy: string;
  action: null | "help" | "version";
}

export class CliError extends Error {
  code: 1 | 2;
  constructor(message: string, code?: 1 | 2);
}

export interface BuildReportOptions {
  url: string;
  finalUrl?: string;
  scores?: Scores;
  findings?: Finding[];
  parsed?: unknown;
  pageData?: unknown;
  siteFiles?: unknown;
  meta?: { version?: string };
  truncated?: boolean;
  checkedAt?: string;
  psi?: unknown;
}

// Function signatures
export function buildReport(input: BuildReportOptions): Report;
export function renderMarkdown(report: Report): string;
export function renderHtml(report: Report, opts?: unknown): string;
export function renderSiteIndex(reports: Report[], opts?: unknown): string;
export function renderSarif(report: Report): string;
export function renderCsv(reports: Report[]): string;
export function buildSiteReport(reports: Report[], opts?: { version?: string; origin?: string }): SiteReport;
export function summarizeAggregate(reports: Report[]): AggregateSummary;
export function isValidScore(value: unknown): value is number;
export function verdictFor(report: Report): string;

export function runChecks(pageData: unknown, siteFiles?: unknown, opts?: { profile?: string }): Finding[];
export function geoDetails(
  pageData: unknown,
  siteFiles?: unknown,
): { score: number; signals: { key: string; ok: boolean; weight: number }[] };
export const FINDING_META: Record<
  string,
  { plain: string; impact: string; effort: string; owner: string; snippet?: string }
>;
export const CHECKS: CheckDefinition[];
export const CATEGORIES: string[];
export const SEVERITIES: string[];

export function extractJsonLd(html: string): unknown[];
export function validateSchema(jsonLd: unknown): Finding[];
export function schemaSnippet(type: string, data?: unknown): string;

export function computeScores(findings: Finding[], geoDetails?: unknown): Scores;
export function scoreBand(score: number | null): ScoreBand | null;

export function parseRobots(text: string): {
  disallows: { agents: string[]; path: string }[];
  sitemaps: string[];
  aiBlocked: boolean;
  blockedBots: string[];
};

export function isDisallowed(robotsText: string, uaToken: string, path: string): boolean;
export function looksLikeSitemap(content: string): boolean;
export function countSitemapUrls(content: string): number;
export function isSitemapIndex(content: string): boolean;
export function extractSitemapUrls(content: string): string[];

export function getSiteFiles(
  pageUrl: string,
  opts?: { timeoutMs?: number; userAgent?: string; blockPrivateIps?: boolean },
): Promise<SiteFilesData>;

export function getSitemapUrls(
  pageUrl: string,
  opts?: { timeoutMs?: number; userAgent?: string; blockPrivateIps?: boolean },
): Promise<string[]>;

export function fetchHtml(
  url: string,
  opts?: unknown,
): Promise<{ ok: boolean; status: number; url: string; finalUrl: string; html: string; headers: Headers }>;

export function fetchText(
  url: string,
  opts?: unknown,
): Promise<{
  ok: boolean;
  status: number;
  url: string;
  finalUrl: string;
  text: string;
  truncated: boolean;
  error?: string;
}>;

export function getSkills(): SkillInfo[];
export function getSkill(id: string): SkillInfo | undefined;

export function parseArgs(argv: string[]): ParsedArgs;
export function normalizeUrl(input: string): string;
export function canonicalizeUrl(input: string, stripAllQuery?: boolean): string;
export function isLocalPath(input: string): boolean;

export const MAX_PAGES: number;
export const MAX_SITEMAP_CHILDREN: number;
export const MAX_SITEMAP_SEED_URLS: number;

// ---------------------------------------------------------------------------
// Platform engines (v0.12)
// ---------------------------------------------------------------------------

export const VERSION: string;
export const USER_AGENT: string;
export function robotsPathOf(url: string): string;
export function isAssetUrl(url: string): boolean;
export const NON_HTML_EXTENSIONS: Set<string>;
export function collectHtmlFiles(dir: string): string[];

/** Facts about one crawled page, used by the site-level engines. */
export interface PageFacts {
  url: string;
  finalUrl: string;
  key: string;
  status: number;
  redirects: number;
  ms: number;
  bytes: number;
  title: string;
  metaDescription: string;
  h1: string;
  h1Count: number;
  h2s: string[];
  lang: string;
  canonical: string;
  canonicalKey: string;
  noindex: boolean;
  nofollow: boolean;
  hreflangs: { lang: string; href: string }[];
  links: string[];
  externalLinks: number;
  wordCount: number;
  images: number;
  imagesWithoutAlt: number;
  schemaTypes: string[];
  contentHash: string;
  simhash: string;
  terms: { term: string; count: number }[];
  targetTerms: string[];
  dateModified: string;
}

export interface CrawlFailure {
  url: string;
  status: number;
  error: string;
  kind: "fetch" | "offsite" | "asset";
  referrers: string[];
}

export interface CrawlRedirect {
  url: string;
  finalUrl: string;
  hops: number;
  referrers: string[];
}

export interface CrawlOptions {
  pages?: number;
  crawl?: "links" | "sitemap" | "auto";
  concurrency?: number;
  delay?: number;
  timeout?: number;
  force?: boolean;
  stripQuery?: boolean;
  include?: string;
  exclude?: string;
  maxDepth?: number;
  checkLinks?: boolean;
  skills?: string;
  excludeSkills?: string;
  profile?: string;
  blockPrivateIps?: boolean;
  all?: boolean;
  userAgent?: string;
  /** Re-requests of a 429/502/503/504 page, honouring Retry-After (default 2; 0 disables). */
  retries?: number;
  /** Slow down for a host whose responses get slow (default true). */
  autoThrottle?: boolean;
  /** After the crawl, request two made-up URLs to detect soft 404s (default false). */
  probes?: boolean;
  /** Fixed suffix for the probe URLs (tests); random by default. */
  probeToken?: string;
}

/** What the site answered for a URL that cannot exist. */
export interface ProbeResult {
  kind: "root" | "nested";
  url: string;
  /** Status the made-up URL itself answered (first hop; 0 = request failed). */
  status: number;
  /** Page title when it answered 200. */
  title: string;
}

export interface CrawlResult {
  blocked: boolean;
  robotsText: string;
  pageReports: any[];
  pages: PageFacts[];
  failures: CrawlFailure[];
  redirects: CrawlRedirect[];
  failed: number;
  capped: boolean;
  sitemapUrls: string[];
  orphanIndexes: number[];
  /** Discovered URLs not crawled because they are crawler traps. */
  trapsSkipped: number;
  /** Why the crawl stopped early ("" when it did not). */
  stoppedReason: string;
  probes: ProbeResult[];
  startUrl: string;
}

export function crawlSite(
  startUrl: string,
  options?: CrawlOptions,
  hooks?: {
    warn?: (msg: string) => void;
    debug?: (msg: string) => void;
    progress?: (state: { done: number; total: number; queued: number; current: string }) => void;
    isInterrupted?: () => boolean;
  },
): Promise<CrawlResult>;
export function analyzeOne(
  url: string,
  timeoutMs: number,
  userAgent: string,
  allowedHosts: Set<string> | null,
  profile?: string,
  opts?: { blockPrivateIps?: boolean },
): Promise<any>;
export function analyzeLocalFile(filePath: string, opts?: { profile?: string; siteRoot?: string }): any;
export function pageFacts(analyzed: any, requestedUrl: string, canon?: (u: string) => string): PageFacts;

// ---- SEO Intelligence ----

export type FixType = "safe" | "approval" | "manual";

export interface SiteIssue {
  id: string;
  category: string;
  severity: "P0" | "P1" | "P2" | "P3";
  title: string;
  description: string;
  impact: string;
  recommendation: string;
  fixType: FixType;
  heuristic: boolean;
  count: number;
  urls: { url: string; detail: string }[];
}

export interface SiteAnalysis {
  summary: Record<string, unknown> & { pagesAnalyzed: number; issueCounts: Record<string, number> };
  categoryScores: Record<string, { score: number | null; band: string; pages: number }>;
  issues: SiteIssue[];
  pageStats: unknown[];
  content: { topics: unknown[]; linkSuggestions: unknown[]; underlinkedPages: unknown[]; briefs: unknown[] };
  methodology: Record<string, string>;
}

export function analyzeSite(input: {
  pages: PageFacts[];
  failures?: CrawlFailure[];
  redirects?: CrawlRedirect[];
  sitemapUrls?: string[];
  capped?: boolean;
  pageReports?: any[];
  canon?: (u: string) => string;
  now?: number;
  probes?: ProbeResult[];
}): SiteAnalysis;
export function clickDepths(pages: PageFacts[]): Map<string, number>;
export function categoryScores(
  pageReports: any[],
): Record<string, { score: number | null; band: string; pages: number }>;
export function isValidHreflang(code: string): boolean;
export function suggestInternalLinks(
  pages: PageFacts[],
  limit?: number,
): { from: string; to: string; anchor: string; sharedTerms: string[]; similarity: number }[];
export function contentBriefs(
  pages: PageFacts[],
  inlinks: Map<string, number>,
  linkSuggestions: unknown[],
  limit?: number,
): unknown[];
export function compareCompetitors(
  own: PageFacts[],
  competitors: { url: string; pages: PageFacts[] }[],
): {
  own: Record<string, unknown>;
  competitors: {
    url: string;
    profile: Record<string, unknown>;
    sharedTerms: number;
    termGaps: { term: string; competitorPages: number }[];
  }[];
  note: string;
};

// ---- SEO Auto-Fix ----

export interface FixPlanEntry {
  issueId: string;
  scope: "page" | "site";
  url: string;
  severity: string;
  description: string;
  impact: string;
  recommendation: string;
  proposedChange: string;
  fixType: FixType;
  status: "proposed";
  verification: "not-applied";
}

export interface FixPlan {
  tool: string;
  version: string;
  generatedAt: string;
  mode: "plan";
  summary: Record<string, number>;
  entries: FixPlanEntry[];
  note: string;
}

export interface FixSessionFile {
  path: string;
  backup: string;
  created: boolean;
  beforeSha: string;
  afterSha: string;
  fixes: string[];
  verified: { name: string; cleared: boolean }[];
  searchScore: { before: number; after: number } | null;
  resolvedFindings: string[];
}

export interface FixSession {
  tool: string;
  version: string;
  id: string;
  createdAt: string;
  target: string;
  status: "applied" | "rolled-back";
  rolledBackAt?: string;
  files: FixSessionFile[];
}

export const APPROVAL_FINDINGS: string[];
export const SITE_FIXER_NAMES: string[];
export function classifyFinding(
  finding: { id: string; title?: string },
  report: unknown,
): { fixType: FixType; proposedChange: string };
export function buildFixPlan(
  pageReports: any[],
  analysis?: { issues?: SiteIssue[] } | null,
  opts?: { safeOnly?: boolean; indexableUrls?: string[] },
): FixPlan;
export function renderFixPlanMarkdown(plan: FixPlan): string;
export function buildSitemapXml(urls: string[]): string;
export function buildRobotsTxt(sitemapUrl: string): string;
export function suggestAltText(
  images: { src?: string; hasAlt?: boolean }[],
): { src: string; suggestedAlt: string }[];
export function planSiteFixes(
  rootDir: string,
  htmlFiles: string[],
  ctx?: { baseUrl?: string; only?: string[] | null },
): {
  planned: {
    name: string;
    findingId: string;
    file: string;
    summary: string;
    content: string;
    created: boolean;
  }[];
  skipped: { name: string; reason: string }[];
};
export function planLocalFixes(
  target: string,
  ctx?: Record<string, unknown> & { isDirectory?: boolean; url?: string },
): any;
export function applyFixSession(input: {
  stateDir: string;
  target: string;
  siteRoot: string;
  changes: {
    file: string;
    content: string;
    created?: boolean;
    fixes: string[];
    verify?: (onDisk: string) => { name: string; cleared: boolean }[];
  }[];
  backup?: boolean;
}): { session: FixSession | null; files: FixSessionFile[]; errors: { file: string; error: string }[] };
export function listFixSessions(stateDir: string): FixSession[];
export function rollbackFixSession(
  stateDir: string,
  sessionId?: string,
  opts?: { force?: boolean },
): {
  ok: boolean;
  error?: string;
  session?: FixSession;
  restored: string[];
  removed: string[];
  conflicts: string[];
};

// ---- SEO Monitoring ----

export type ChangeLevel = "critical" | "warning" | "info";
export interface MonitorChange {
  type: string;
  level: ChangeLevel;
  url: string;
  message: string;
  before?: string;
  after?: string;
}
export interface MonitorSnapshot {
  tool: string;
  version: string;
  takenAt: string;
  startUrl: string;
  available: boolean;
  site: Record<string, unknown>;
  pages: Record<string, Record<string, unknown>>;
  failures: { url: string; status: number; error: string }[];
  sitemapUrls: string[];
  averages: { search: number | null; ai: number | null };
}
export function buildSnapshot(crawl: CrawlResult, site?: Record<string, unknown>): MonitorSnapshot;
export function compareSnapshots(prev: MonitorSnapshot, cur: MonitorSnapshot): MonitorChange[];
export function summarizeChanges(changes: MonitorChange[]): Record<ChangeLevel, number>;
export function monitorDir(stateDir: string, startUrl: string): string;
export function saveSnapshot(dir: string, snapshot: MonitorSnapshot, keep?: number): string;
export function loadLatestSnapshot(dir: string): MonitorSnapshot | null;
export function listSnapshots(dir: string): string[];
export function sendWebhook(
  webhookUrl: string,
  alert: { site: string; takenAt: string; summary: Record<ChangeLevel, number>; changes: MonitorChange[] },
  opts?: { timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<{ ok: boolean; status: number; error: string }>;

// ---- Reporting, config, state ----

export interface SiteReportModel {
  origin: string;
  checkedAt: string;
  pageReports: any[];
  analysis?: SiteAnalysis | null;
  competitors?: unknown;
  verification?: unknown;
  history?: unknown[];
  fixSessions?: unknown[];
}
export interface SiteReportOptions {
  audience?: "full" | "client" | "developer";
  brand?: string;
  client?: string;
}
export function renderSiteMarkdown(model: SiteReportModel, opts?: SiteReportOptions): string;
export function renderSiteCsv(model: SiteReportModel): string;
export function renderSitePdf(model: SiteReportModel, opts?: SiteReportOptions): Uint8Array;
export function siteReportOutline(model: SiteReportModel, opts?: SiteReportOptions): unknown[];
export function renderPdf(
  blocks: { text: string; style?: "title" | "h1" | "h2" | "body" | "bullet" | "small" | "space" }[],
  meta?: { title?: string; footer?: string },
): Uint8Array;

export const CONFIG_FILE: string;
export function validateConfig(config: unknown): string[];
export function loadConfig(opts?: {
  cwd?: string;
  explicitPath?: string;
}): { path: string; config: Record<string, unknown>; argv: string[] } | null;
export function resolveStateDir(explicit?: string, env?: Record<string, string | undefined>): string;
