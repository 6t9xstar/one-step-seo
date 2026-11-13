# Usage

## Install

```bash
npm i -g one-step-seo
# or run without installing
npx one-step-seo audit https://example.com
```

For programmatic Node.js and TypeScript usage (`import { runChecks, buildReport } from "one-step-seo"`), see [**docs/API.md**](./API.md).

Requires Node 18+. Both `--flag value` and `--flag=value` forms are accepted.

## Quickstart

```bash
# Easiest: direct URL shorthand auto-discovers all website pages and provides full site report
npx one-step-seo https://your-site.com

# Dedicated site command (hybrid sitemap + link auto-discovery across all pages)
npx one-step-seo site https://your-site.com

# Interactive: answer 4 questions (defaults to auto-discovering all pages)
npx one-step-seo

# Quick shortcut: audit up to 5 pages with beginner defaults
npx one-step-seo quick https://your-site.com

# Full control: audit all pages with hybrid crawl into a custom folder
npx one-step-seo audit https://example.com --all --out ./seo-report
```

You get: Search SEO score + AI Visibility score (two separate 0–100 scores),
`report.json` + `report.md` + `report.html` (for page 1), `report-N.*` (for each page),
`index.html` (interactive site dashboard), `index.md`, and consolidated `site-report.json`,
with prioritized fixes printed directly in the terminal.

## Commands

```bash
# Full site audit: auto-discover all pages via hybrid sitemap + link BFS crawl
one-step-seo site https://example.com
one-step-seo https://example.com

# Full audit with explicit page limit and formats
one-step-seo audit https://example.com --all --out ./seo-report --format html,md,json
one-step-seo audit https://example.com --pages 10 --crawl auto --out ./seo-report

# Calibrated for a page type (default|blog|product|docs|home)
one-step-seo audit https://example.com/shop/widget --profile product

# Beginner shortcut: audit with 5 pages and all formats
one-step-seo quick https://example.com
one-step-seo quick https://example.com --pages 3 --out ./quick-report

# Single page
one-step-seo page https://example.com/pricing --out ./seo-report

# AI Search Visibility & Citability audit
one-step-seo ai https://example.com
one-step-seo ai https://example.com --json

# Schema: detect + validate, optionally print a starter snippet
one-step-seo schema https://example.com --generate faq

# Sitemap / robots / llms.txt overview
one-step-seo sitemap https://example.com
one-step-seo sitemap https://example.com --json

# llms.txt status + starter draft + AI-crawler robots.txt snippet (prints only)
one-step-seo llms https://example.com
one-step-seo llms https://example.com --json

# Safe auto-fixes for local HTML (dry-run diff by default)
one-step-seo fix ./dist/index.html
one-step-seo fix ./dist/index.html --apply --url https://example.com/ --lang en

# Fix plan for a live site (proposed changes only — nothing is modified)
one-step-seo fix https://example.com --all --safe-only

# Fix a whole build directory: --url is the SITE BASE URL (each page gets its own URL)
one-step-seo fix ./dist --url https://example.com --lang en --apply
one-step-seo fix --history
one-step-seo fix --rollback                 # or --session <id>

# Deep / focused audits (site-wide analysis, PDF + CSV)
one-step-seo audit https://example.com --deep --format html,md,json,csv,pdf
one-step-seo audit https://example.com --technical
one-step-seo audit https://example.com --on-page --competitors https://rival.example

# Confirm fixes after deploying, against an earlier audit folder
one-step-seo verify https://example.com --baseline ./seo-report

# Client / developer report (pdf, md, csv) from an audit folder, a directory or a URL
one-step-seo report ./seo-report --client "Acme Ltd" --audience client

# Change monitoring with alerts (once per run, or keep running)
one-step-seo monitor https://example.com --webhook "$SLACK_WEBHOOK_URL"
one-step-seo monitor https://example.com --interval 1440
one-step-seo monitor https://example.com --history

# Regression diff between two reports (base vs. head)
one-step-seo diff base-report.json seo-report/report.json --fail-on P1

# Environment check
one-step-seo doctor
one-step-seo doctor --json

# Skills inspection (22 executable CLI skills + 24 Agent Skill playbooks)
one-step-seo skills
one-step-seo skills onpage-optimization
one-step-seo skills --json

# Offline local file and directory audits
one-step-seo page ./dist/index.html --out ./offline-report
one-step-seo audit ./dist --pages 10 --out ./offline-report

# Selective skill execution (supports primary IDs, categories, and aliases)
one-step-seo audit https://example.com --skills onpage-optimization,schema-validation
one-step-seo audit https://example.com --skills sitemap-robots,internal-linking
one-step-seo audit https://example.com --exclude-skills core-web-vitals
```

`page` audits exactly one URL. `audit --pages 1` is equivalent but also writes
`index.md` only when more than one page is audited. `quick` is `audit` with
beginner defaults: 5 pages unless `--pages` is given explicitly.

Running with no command at all starts interactive mode on a TTY (URL, pages,
output folder, open-report prompt); piped/CI usage without a command prints
usage and exits 1.

## Schema guidance

`schema --generate <kind>` prints starter JSON-LD built from the live page
(title, URL, description — never invented facts). When hand-writing markup,
prefer **one `<script type="application/ld+json">` block with a unified
`@graph`** whose nodes link via `@id` (Organization → author Person →
Article → FAQPage), over scattered fragments. Mark up only visible content,
keep FAQ answers identical to the on-page copy, and bump `dateModified`
(plus a visible revision note) when facts change — the `G06-freshness`
check reads exactly those signals.

## The `ai` command

`ai` runs a dedicated AI Search Visibility and Citability audit on a target URL.
It evaluates technical signals required for modern generative engines (Perplexity,
ChatGPT Search, Google AI Overviews, Claude) without making speculative ranking claims:

- Checks whether AI crawlers (`GPTBot`, `ClaudeBot`, `PerplexityBot`, etc.) are allowed in `robots.txt`.
- Validates `llms.txt` discovery and machine-readable structure.
- Verifies structured entity schemas (`Organization`, `WebSite`, `Article`, `FAQPage`, etc.).
- Audits author and publisher attribution (`<meta name="author">` / `rel="author"`).
- Confirms semantic document landmarks (`<main>` and `<article>`).
- Checks for direct answer blocks and structured tables.

```bash
one-step-seo ai https://example.com
one-step-seo ai https://example.com --json
```

## The `llms` command

`llms` helps with AI-visibility paperwork. It prints (never writes):

1. Current `llms.txt` status (found/missing, byte size).
2. A starter `llms.txt` draft built from the live page title/description and
   up to 20 sitemap URLs — curate it before publishing; unknown slots are
   explicit placeholders, never invented facts.
3. A `robots.txt` snippet allowing the major AI crawlers (`GPTBot`,
   `ClaudeBot`, `PerplexityBot`, `Google-Extended`, `CCBot`).

```bash
one-step-seo llms https://example.com
one-step-seo llms https://example.com --json   # { tool, version, url, llmsFound, llmsBytes, starter, robotsSnippet }
```

## Platform commands (audit → fix → verify → report → monitor)

`--deep`, `--technical`, `--on-page`, `--competitors`, `fix <url>`, fix
history/rollback, `verify`, `report` and `monitor` are documented in
[PLATFORM.md](./PLATFORM.md). That page also covers the
`one-step-seo.config.json` project file, the `.one-step-seo/` state directory
and the integration status. Scheduling and backups are in
[OPERATIONS.md](./OPERATIONS.md).

## The `fix` command

`fix` applies **additive-only** SEO fixes to local `.html`/`.htm` files (a file,
or a directory walked recursively — `node_modules` and `.git` are skipped).
It never removes content, never rewrites copy, and never invents facts:

- **Dry-run by default** — prints each planned fix with its finding ID plus a
  unified diff, writes nothing. `--apply` writes, creating `<file>.bak` backups
  (disable with `--no-backup`).
- **Verified in memory and on disk** — after planning, the document is re-parsed
  and each fix confirmed to clear its finding. After `--apply`, every file is
  read back from disk and verified again. The change is recorded as a fix
  session, which you can list with `fix --history` and undo with `fix --rollback`.
- **Never guesses** — language, URLs, titles and images need explicit flags
  when they cannot be derived from content already on the page.

```bash
# Preview (nothing is written)
one-step-seo fix ./public/index.html --url https://example.com/

# Write the fixes + backups
one-step-seo fix ./public/index.html --apply --url https://example.com/ --lang en

# Only some fixers, machine-readable plan
one-step-seo fix ./public --only charset,viewport,twitter-card --json
```

Fixers and what they need:

| Fixer          | Clears              | Needs                                                              |
| -------------- | ------------------- | ------------------------------------------------------------------ |
| `charset`      | `T10-charset`       | charset absent (won't rewrite other encodings)                     |
| `viewport`     | `T11-viewport`      | viewport absent (custom ones untouched)                            |
| `lang`         | `T09-lang`          | `--lang`                                                           |
| `title`        | `O01-title-missing` | `--title`, else derived from the first `<h1>`                      |
| `description`  | `O02-meta-missing`  | `--description`, else derived from page text                       |
| `canonical`    | `T08-canonical`     | `--url`                                                            |
| `og`           | `O06-og`            | title/meta present; `--og-image` for the image (partial otherwise) |
| `og-url`       | `W02-og-url`        | existing wrong `og:url` + `--url`                                  |
| `twitter-card` | `W01-social`        | —                                                                  |
| `favicon`      | `O07-favicon`       | —                                                                  |

Hard exclusions (by design): alt text, `noindex` removal, title/description
length rewrites, image dimensions, `robots.txt`/`llms.txt`/sitemap edits, and
non-HTML templates (`.astro`, `.jsx`).

What `fix` will never do, and why: it never rewrites prose to a target
length (length is a judgment call about intent, not a mechanical edit); it
never generates answer blocks, FAQs, or any new copy (the tool must not
invent facts, statistics, or claims); it never touches non-HTML sources
(framework components need their own codemods, not regex patches); it never
removes content, changes URLs, or adds redirects (all destructive or
high-risk). For those, use the report's fix text + snippets with human
review — `fix` closes the mechanical loop, judgment stays with you.

## Flags

| Flag                  | Default        | Meaning                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--all`               | —              | Auto-discover and audit all pages across the website (hybrid sitemap + link BFS crawl up to 1000 pages)                                                                                                                                                                                                                                    |
| `--pages N`           | `1`            | Pages to crawl for `audit` (integer 1–1000, or `all`/`max`; alias `--max-pages`; `quick` defaults to 5; `site` and direct URL shorthand default to all). The terminal reports whether all discovered pages were audited or the cap cut the crawl short                                                                                     |
| `--max-depth N`       | —              | Limit crawl depth / link hop distance from seed URL (integer 1–50; default unlimited). Perfect for auditing large sites without deep nested archive crawls                                                                                                                                                                                 |
| `--include PAT`       | —              | Only crawl URL paths matching substring or regex pattern (e.g. `--include "/docs"`)                                                                                                                                                                                                                                                        |
| `--exclude PAT`       | —              | Skip URL paths matching substring or regex pattern (e.g. `--exclude "/cart                                                                                                                                                                                                                                                                 | /checkout | /admin"`) |
| `--strip-query`       | —              | Strip search query parameters during crawl deduplication to prevent crawling redundant parameter variants                                                                                                                                                                                                                                  |
| `--out DIR`           | `./seo-report` | Output directory (created with `mkdir -p`, existing files overwritten)                                                                                                                                                                                                                                                                     |
| `--format`            | `html,md,json` | Which reports to write (`html`, `md`, `json`, `sarif`, `csv` only — anything else exits 1)                                                                                                                                                                                                                                                 |
| `--timeout MS`        | `15000`        | Per-request timeout in ms (integer 1000–120000; applies to pages + robots/sitemap/llms)                                                                                                                                                                                                                                                    |
| `--generate KIND`     | —              | `organization\|website\|article\|faq\|breadcrumb\|product\|event\|localbusiness\|howto\|video\|job\|course\|review\|recipe`                                                                                                                                                                                                                |
| `--fail-on SEV`       | —              | `P0\|P1\|P2` — exit 2 when any audited page has that severity or higher (CI gating). For `diff`: exit 2 only on _new or escalated_ findings at the threshold                                                                                                                                                                               |
| `--profile NAME`      | `default`      | Page-type calibration: `default` (reference), `blog` (same calibration, explicit), `product` (thin threshold 120, skips answer-first), `docs` (FAQ + llms.txt bumped to P1), `home` (thin threshold 100, skips answer-first). The AI checklist is identical across profiles                                                                |
| `--psi`               | —              | Measure Core Web Vitals via Google PageSpeed Insights (lab + CrUX field metrics). Reads `PSI_API_KEY` from the environment.                                                                                                                                                                                                                |
| `--psi-strategy`      | `mobile`       | Strategy for `--psi`: `mobile` or `desktop`                                                                                                                                                                                                                                                                                                |
| `--crawl MODE`        | `links`        | `auto` (hybrid sitemap + internal link BFS discovery), `links` (BFS over internal links) or `sitemap` (seeds from `sitemap.xml`, fallback `sitemap_index.xml`, or all `Sitemap:` URLs declared in `robots.txt`; follows up to 20 child sitemaps of a `<sitemapindex>`, supports `.xml.gz`, caps seeds at 1000, and drops cross-host seeds) |
| `--concurrency N`     | `4`            | Parallel page fetches for `audit` (integer 1–8)                                                                                                                                                                                                                                                                                            |
| `--delay MS`          | `250`          | Politeness pause between crawl batches in ms (integer 0–10000)                                                                                                                                                                                                                                                                             |
| `--debug`             | —              | Verbose diagnostics: parsed audit parameters, `robots.txt` status, per-page timings (implies `--verbose` stacks)                                                                                                                                                                                                                           |
| `--force`             | —              | Crawl even when `robots.txt` disallows the URL — use only on sites you own or are allowed to test; the refusal is otherwise reported as `T05-robots-disallow`                                                                                                                                                                              |
| `--check-links`       | —              | Verify same-host link targets (P1 `T16-broken-links` for 4xx/5xx/failures; capped at 100 checks per run, off by default; skips already-audited and robots-disallowed targets)                                                                                                                                                              |
| `--no-probes`         | —              | Skip the two soft-404 probes a multi-page `audit` sends after the crawl (a made-up URL at the root and one inside the first section; reported as `X22`/`X23` when they answer HTTP 200). Single-page audits never send them                                                                                                                |
| `--quiet, -q`         | —              | Suppress informational banners and progress chatter in CI and automated scripts                                                                                                                                                                                                                                                            |
| `--block-private-ips` | —              | Block SSRF requests targeting private, loopback, or cloud metadata IP addresses (IPv4 RFC 1918, IPv6 ULA, IMDSv2, Oracle Cloud)                                                                                                                                                                                                            |
| `--check-config`      | —              | `doctor`: validate CLI options, defaults, and environment health                                                                                                                                                                                                                                                                           |
| `--skills LIST`       | —              | Comma list of executable CLI skill IDs, category names, or aliases to include (e.g., `onpage,schema,technical-seo`)                                                                                                                                                                                                                        |
| `--exclude-skills L`  | —              | Comma list of executable CLI skill IDs, category names, or aliases to exclude                                                                                                                                                                                                                                                              |
| `--offline`           | —              | Audit local HTML files or build directories offline with zero network requests                                                                                                                                                                                                                                                             |
| `--json`              | —              | JSON to stdout (`sitemap`, `llms`, `doctor`, `fix`, `diff`, `ai`, `skills`)                                                                                                                                                                                                                                                                |
| `--verbose`           | —              | Print error stacks on runtime failures (`VERBOSE=1` also works)                                                                                                                                                                                                                                                                            |
| `--apply`             | —              | `fix`: write fixes to disk (default is a dry-run diff; creates `<file>.bak` unless `--no-backup`)                                                                                                                                                                                                                                          |
| `--only NAMES`        | —              | `fix`: comma list restricting which fixers run (`charset,viewport,lang,title,description,canonical,og,og-url,twitter-card,favicon`)                                                                                                                                                                                                        |
| `--url URL`           | —              | `fix`: absolute http(s) URL used for `canonical` / `og-url` fixes                                                                                                                                                                                                                                                                          |
| `--title TEXT`        | —              | `fix`: `<title>` content when missing (else derived from the first `<h1>`)                                                                                                                                                                                                                                                                 |
| `--description T`     | —              | `fix`: meta description when missing (else derived from page text, ≥40ch)                                                                                                                                                                                                                                                                  |
| `--lang LANG`         | —              | `fix`: `<html lang>` value when missing (never guessed)                                                                                                                                                                                                                                                                                    |
| `--og-image URL`      | —              | `fix`: absolute image URL for `og:image`                                                                                                                                                                                                                                                                                                   |
| `--no-backup`         | —              | `fix`: skip the `.bak` copy on `--apply`                                                                                                                                                                                                                                                                                                   |

## Core Web Vitals (PageSpeed Insights)

Measure real-world Core Web Vitals and Google Lighthouse lab metrics by passing `--psi`:

```bash
PSI_API_KEY=your_key one-step-seo audit https://example.com --psi
PSI_API_KEY=your_key one-step-seo page https://example.com --psi --psi-strategy desktop
```

- **Environment variable only**: The Google API key is read strictly from `process.env.PSI_API_KEY` (never a CLI flag value, ensuring it never leaks into shell history or CI logs). Get a key for free at [Google PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/get-started).
- **Core Web Vitals evaluated**:
  - Lab: Largest Contentful Paint (LCP), Cumulative Layout Shift (CLS), Total Blocking Time (TBT), First Contentful Paint (FCP), Speed Index, Time to First Byte (TTFB).
  - Field: Real-user 75th-percentile metrics from Chrome UX Report (CrUX).
- **Lighthouse categories**: Performance, Accessibility, Best Practices and SEO are requested; every non-performance category Lighthouse returns (including newer ones such as Agentic Browsing, when Google includes it) is reported as `P06-lighthouse-<category>` (< 50 = P2, 50-89 = P3, >= 90 = pass). These are lab scores for one page load, not ranking scores.
- **Graceful degradation**: If rate-limited (HTTP 429) or offline, audits log `P05-psi-error` (P3 hint) and proceed without failing the audit.

## Outputs

- `report.json` — machine-readable (scores, counts, findings). Shape: `{ tool, version, rulesVersion, url, finalUrl, checkedAt, truncated, scores: { search: { score, band }, ai: { score, band } }, counts: { P0, P1, P2, P3, pass }, findings: [{ id, category, severity, title, evidence, fix, seoImpact, geoImpact }], page: { title, metaDescription, canonical, wordCount, h1, images, internalLinks, externalLinks, psi? }, site: { origin, robots, sitemap, sitemapUrls, llms } }`. Formal JSON Schema: `lib/schema-report.json`. `rulesVersion` stamps the scoring/check ruleset — `diff` warns when two reports were built under different versions.
- `report.sarif` — same actionable findings in SARIF v2.1.0 for GitHub code scanning (`--format sarif`; P0/P1 → error, P2 → warning, P3 → note).
- `report.csv` — RFC 4180 CSV export (`--format csv`) hardened against spreadsheet formula injection (CWE-1236) with columns: `Severity,Check ID,Category,Title,Evidence,Fix,SEO Impact,GEO Impact`.
- `report.md` — human-readable: executive summary + verdict, “Page SEO & AI signal snapshot”, “Fix this first”
  (top 3 with impact/effort/owner), priority actions grouped by category with
  plain-language explanations and copy-paste snippets, “Make this page more
  citable” checklist, what passed, what to monitor, optional Core Web Vitals (`--psi`), and “Verification & next steps”.
- `report.html` — shareable single-file report (all pages: `report.html`, `report-2.html`, …):
  same sections as Markdown plus score gauges, status pill, Executive Mode toggle, Dark/Light/Auto theme toggle, category + severity + text filtering, “SEO Details & Page Signals”, “Performance & Core Web Vitals” (distinguishing unmeasured/unavailable from zero), “Remediation & Verification”, a “Copy summary”
  button, print stylesheet, skip link, and labelled sections for screen
  readers. Runtime generator: `renderHtml()` in `lib/report.mjs` (`templates/report.html` is a design-system reference only).
- Multi-page runs add `report-2.json/.md/.html`, etc. plus `index.md` linking all pages
- `site-report.json` — consolidated full-site report written during multi-page audits, `--all`, and `site` commands when JSON format is enabled. Shape: `{ tool, reportType: "site", version, rulesVersion, origin, checkedAt, pageCount, scores: { search: { average, band, min }, ai: { average, band, min } }, counts, topIssues, duplicates, pages: [{ index, url, finalUrl, title, metaDescription, scores, counts, topFindings }] }`.
- Multi-page runs with the `html` format also write `index.html` — a site-wide
  dashboard (`renderSiteIndex()` in `lib/report.mjs`: valid-page score aggregation with contributing page counts, `N/A` for unavailable scores, Lowest/Highest-Performing Page cards, filterable & sortable pages table, top recurring issues, category distribution, duplicate titles/descriptions, and internal linking / dead-end risk).
  Per-page reports link back to it with an “All N pages” breadcrumb.
- `sitemap --json` shape: `{ origin, robotsFound, robotsSitemaps, sitemapFound, sitemapUrl, sitemapUrls, sitemapTruncated, llmsFound }`
- `llms --json` shape: `{ tool, version, url, llmsFound, llmsBytes, starter, robotsSnippet }`
- `ai --json` shape: `{ tool, version, url, aiScore, aiBand, searchScore, searchBand, signals: { robotsAiBlocked, blockedBots, llmsFound, llmsBytes, schemaTypes, hasAuthor, hasLandmarks, hasDirectAnswer }, findings, reports }`
- `skills --json` shape: array of 22 `SkillDefinition` objects (or a single `SkillDefinition` when `<skill-id>` is provided).
- `doctor --json` shape: `{ tool, version, node, nodeOk, fetch, terminal: { isTTY, color, noColor }, env: { PSI_API_KEY }, configCheck }`
- `fix --json` shape: `{ tool, version, applied, files: [{ file, planned: [{ name, findingId, summary, partial }], skipped: [{ name, reason }], verified: [{ name, cleared }], changed, applied, error }] }`

## Programmatic API (Node.js & TypeScript)

`one-step-seo` exports a zero-dependency programmatic library for CI scripts, web frameworks, and AI agents:

```javascript
import {
  buildReport,
  renderHtml,
  renderMarkdown,
  buildSiteReport,
  runChecks,
  computeScores,
  getSiteFiles,
  getSitemapUrls,
} from "one-step-seo";

// 1. Fetch robots.txt, sitemaps, and llms.txt
const siteFiles = await getSiteFiles("https://example.com");

// 2. Discover sitemap URLs (supports index sitemaps & .xml.gz)
const urls = await getSitemapUrls("https://example.com");

// 3. Programmatic schema, scoring, and report generation
// Types are fully exported in lib/index.d.ts
```

Subpath exports are also available:

- `one-step-seo/checks` — check definitions and thresholds
- `one-step-seo/report` — HTML, Markdown, and JSON report renderers
- `one-step-seo/schema` — JSON-LD extraction and schema validators
- `one-step-seo/skills` — Agent Skill metadata and check filters
- `one-step-seo/robots` — robots.txt and sitemap parser utilities

`--out` traversal note: the directory is resolved with `path.resolve()` and
created recursively. Do not point `--out` at a source directory — existing
`report.*` files there are overwritten without prompting.

## Exit codes

- `0` ok (including `--fail-on` when the threshold is not breached, and `fix` dry-runs)
- `1` usage error (bad flags, bad URL/path, unknown command or fixer)
- `2` runtime/fetch failure, `--fail-on` breach, or a `fix` file error (read/write/refusal)
- `2` `verify`: a regression at or above `--fail-on` (default P1), or a page that can no longer be fetched
- `2` `monitor`: a critical change (`--fail-on P1`: also warnings; `P2`: any change)
- `1` `doctor --check-config` with an invalid `one-step-seo.config.json`
