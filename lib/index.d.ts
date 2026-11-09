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
