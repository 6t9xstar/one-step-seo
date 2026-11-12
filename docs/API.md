# Programmatic Library API Reference (`one-step-seo`)

`one-step-seo` provides a first-class, zero-dependency Node.js and TypeScript library. Developers can embed the audit engine, dual scoring mathematical models, schema validators, robots/sitemap parsers, and report renderers directly into custom applications, static site generators, CMS publishing workflows, and CI/CD pipelines.

---

## 📦 Installation

```bash
npm install one-step-seo
```

Requirements: **Node.js 18.0.0 or later**. Zero runtime dependencies.

---

## 🚀 Quickstart (ESM & TypeScript)

```javascript
import { runChecks, geoDetails, computeScores, buildReport, renderHtml } from "one-step-seo";

// 1. Define page data (or parse from HTML)
const pageData = {
  title: "Modern AI & Technical SEO — Example",
  description: "Comprehensive guide to technical SEO and generative AI visibility.",
  h1: ["Modern AI & Technical SEO"],
  canonical: "https://example.com/guide",
  wordCount: 850,
  hasViewport: true,
  hasCharset: true,
  hasFavicon: true,
};

// 2. Define or fetch site files (robots.txt, sitemaps, llms.txt)
const siteFiles = {
  robots: { found: true, status: 200, aiBlocked: false },
};

// 3. Execute deterministic rules
const findings = runChecks(pageData, siteFiles, { profile: "standard" });

// 4. Compute dual unblended scores
const geo = geoDetails(pageData, siteFiles);
const scores = computeScores(findings, geo);
console.log(`Search SEO: ${scores.search.score}/100 (${scores.search.band})`);
console.log(`AI Visibility: ${scores.ai.score}/100 (${scores.ai.band})`);

// 5. Generate self-contained offline HTML report
const report = buildReport({
  url: "https://example.com/guide",
  findings,
  scores,
  pageData,
});

const html = renderHtml(report);
// Returns 100% self-contained HTML with zero external CSS/JS/fonts
```

---

## 📚 API Reference

### Core Audit & Scoring

#### `runChecks(pageData, siteFiles?, opts?): Finding[]`

Executes all deterministic technical SEO, on-page, content, schema, GEO, and performance checks against page data.

- **`pageData`** (`ParsedPageData`): Normalized page signals (title, metaDescription, h1s, canonical, links, images, headings, wordCount, etc.).
- **`siteFiles`** (`SiteFilesData`, optional): Host-level metadata (`robots`, `sitemap`, `llms`).
- **`opts`** (`{ profile?: string }`, optional): Audit profile (e.g. `"standard"`, `"strict"`, `"ecommerce"`, `"publishing"`, `"saas"`, `"directory"`).
- **Returns**: Array of `Finding` objects (`id`, `category`, `severity`, `title`, `evidence`, `fix`, `seoImpact`, `geoImpact`).

#### `geoDetails(pageData, siteFiles?): { score: number, signals: Array<{ key: string, ok: boolean, weight: number }> }`

Evaluates 9 Generative Engine Optimization signals (answer-first paragraphs, extractable tabular facts, substantive content, question headings, entity consistency, `/llms.txt` presence, AI bot crawler allowlist).

#### `computeScores(findings, geoDetails?): Scores`

Calculates dual unblended scores:

- **`scores.search`**: `{ score: number (0–100), band: "A"|"B"|"C"|"D"|"F" }` based on P0/P1/P2/P3 deductions.
- **`scores.ai`**: `{ score: number (0–100), band: "A"|"B"|"C"|"D"|"F" }` based on positive GEO weight accumulation.

---

### Report Building & Export

#### `buildReport(options): Report`

Constructs a schema-conforming `Report` object with counts, priority sorting, timestamps, and metadata.

```typescript
interface BuildReportOptions {
  url: string;
  finalUrl?: string;
  scores?: Scores;
  findings?: Finding[];
  parsed?: ParsedPageData;
  pageData?: ParsedPageData;
  siteFiles?: SiteFilesData;
  meta?: { version?: string };
  truncated?: boolean;
  checkedAt?: string;
  psi?: unknown;
}
```

#### `renderHtml(report, opts?): string`

Renders a responsive, offline-first single-page HTML report.

- Features: Theme switcher (System, Dark, Light), Executive Mode toggle, Category filtering, copyable fix snippets, and zero remote network requests.

#### `renderMarkdown(report): string`

Renders a clean GitHub-flavored markdown report suitable for CLI piping, PR comments, or summaries.

#### `renderSarif(report): string`

Generates SARIF v2.1.0 output for native GitHub Code Scanning annotations in CI/CD.

#### `buildSiteReport(reports, meta?): SiteReport`

Aggregates multiple single-page reports into a single consolidated full-site report.

#### `renderSiteIndex(reports, opts?): string`

Generates the glassmorphic multi-page site index dashboard with sortable table columns, aggregate gauges, and issue distribution.

---

### Network & Parser Utilities

#### `getSiteFiles(url, opts?): Promise<SiteFilesData>`

Fetches and analyzes `robots.txt`, `sitemap.xml`, and `llms.txt` for the target host with SSRF protection.

#### `getSitemapUrls(url, opts?): Promise<string[]>`

Extracts, deduplicates, and resolves all page URLs declared across XML sitemaps and sitemap indexes, transparently decompressing `.xml.gz` archives and unescaping CDATA and XML entities.

#### `parseRobots(text): RobotsResult`

RFC 9309 compliant `robots.txt` parser with AI bot user-agent evaluation (`GPTBot`, `PerplexityBot`, `ClaudeBot`, `Google-Extended`, etc.).

#### `extractJsonLd(html): unknown[]`

Extracts and parses all `<script type="application/ld+json">` nodes from an HTML string, tolerating CDATA, trailing commas, and html comments.

#### `validateSchema(jsonLd): Finding[]`

Validates JSON-LD entities against Schema.org structural and property requirements.

---

### Subpath Imports

For modular codebases, subpaths are exported in `package.json`:

```javascript
// Check definitions and profiles
import { CHECKS, THRESHOLDS, PROFILES, runChecks } from "one-step-seo/checks";

// Report rendering and formats
import { renderHtml, renderMarkdown, renderSarif, buildReport } from "one-step-seo/report";

// Schema extraction and validation
import { extractJsonLd, validateSchema, schemaSnippet } from "one-step-seo/schema";

// Agent Skills playbooks
import { AGENT_SKILLS, getSkills, getSkill } from "one-step-seo/skills";

// Robots.txt and sitemap parser
import { parseRobots, getSitemapUrls, isDisallowed } from "one-step-seo/robots";

// Platform engines (v0.12) — each usable on its own
import { crawlSite } from "one-step-seo/crawl";
import { analyzeSite } from "one-step-seo/intelligence";
import { buildFixPlan, applyFixSession, rollbackFixSession } from "one-step-seo/autofix";
import { buildSnapshot, compareSnapshots, sendWebhook } from "one-step-seo/monitor";
import { renderPdf } from "one-step-seo/pdf";
```

---

### Platform engines (v0.12)

The engines behind `audit --deep`, `fix`, `verify`, `report` and `monitor` are
exported from the root entry point and from subpaths. For the CLI workflow, see
[PLATFORM.md](./PLATFORM.md).

#### Crawl + SEO Intelligence

```javascript
import { crawlSite, analyzeSite, canonicalizeUrl } from "one-step-seo";

const crawl = await crawlSite("https://example.com/", {
  pages: 200,
  crawl: "auto",
  all: true,
  checkLinks: true,
});
const analysis = analyzeSite({
  pages: crawl.pages, // PageFacts per audited page
  failures: crawl.failures, // broken / off-site / skipped-asset URLs (one per URL)
  redirects: crawl.redirects, // requested URLs that redirect (with referrers)
  sitemapUrls: crawl.sitemapUrls,
  capped: crawl.capped,
  pageReports: crawl.pageReports, // the per-page Report objects
  canon: (u) => canonicalizeUrl(u),
});
for (const issue of analysis.issues) console.log(issue.id, issue.severity, issue.fixType, issue.count);
```

`crawlSite` honours robots.txt (including query-string rules and sitemap
entries), stays on the start host, and skips non-HTML assets. It never throws
for per-page failures; they are returned in `failures`.

#### Auto-Fix

| Function                                                                      | Purpose                                                                          |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `buildFixPlan(pageReports, analysis?, { safeOnly? })`                         | Issue-by-issue plan; every entry `status: "proposed"`                            |
| `planLocalFixes(target, { isDirectory, url, lang, ... })`                     | Pure planner for local files; writes nothing                                     |
| `applyFixSession({ stateDir, target, siteRoot, changes })`                    | Backup, atomic write, on-disk verification, manifest                             |
| `listFixSessions(stateDir)` / `rollbackFixSession(stateDir, id?, { force? })` | History and undo; refuses to overwrite files edited since the fix unless `force` |
| `classifyFinding(finding, report)`                                            | `safe` / `approval` / `manual`                                                   |

#### Monitoring

```javascript
import { crawlSite, buildSnapshot, compareSnapshots, summarizeChanges, sendWebhook } from "one-step-seo";

const now = buildSnapshot(await crawlSite("https://example.com/", { pages: 25, crawl: "auto" }));
const changes = compareSnapshots(previousSnapshot, now); // sorted critical → warning → info
const summary = summarizeChanges(changes);
if (summary.critical > 0)
  await sendWebhook(process.env.ONE_STEP_SEO_WEBHOOK, {
    site: now.startUrl,
    takenAt: now.takenAt,
    summary,
    changes,
  });
```

#### Reports

`renderSiteMarkdown(model, opts)`, `renderSiteCsv(model)` and
`renderSitePdf(model, opts)` take `{ origin, checkedAt, pageReports, analysis, competitors?, verification?, history?, fixSessions? }`
and `{ audience: "full" | "client" | "developer", brand?, client? }`.
`renderPdf(blocks, meta)` is the dependency-free PDF writer underneath.

---

## 🛠️ TypeScript Support

Full TypeScript definitions are included out of the box in `lib/index.d.ts`. No `@types/one-step-seo` package is required.

```typescript
import {
  buildReport,
  computeScores,
  runChecks,
  type Report,
  type Finding,
  type Scores,
  type ParsedPageData,
  type SiteFilesData,
} from "one-step-seo";
```
