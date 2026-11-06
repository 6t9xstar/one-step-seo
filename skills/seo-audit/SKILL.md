---
name: seo-audit
description: Run one-step-seo against a URL, local HTML file, or build directory, interpret the independent Search SEO and AI Visibility scores, and return an evidence-backed P0-P3 remediation plan.
---

# seo-audit — End-to-End SEO & AI Visibility Audit

## 1. Description & Activation Criteria

Use `seo-audit` when the user asks to:

- Audit a website, single page, local HTML file, or static build folder (`./dist`, `./out`, `./public`) for SEO or AI search visibility.
- Interpret `report.json`, `report.md`, `report.html`, or multi-page `index.html` outputs.
- Produce a prioritized P0–P3 remediation plan with effort, impact, and owner triage.
- Check why a page is underperforming in traditional search or generative answer engines (ChatGPT Search, Claude, Perplexity, Google AI Overviews).

Do **not** activate this skill to directly mutate user HTML files without first running an audit; use `seo-fix` after user approval for local file edits.

## 2. Inputs & Prerequisites

- **Target (required)**: Public `http(s)` URL, local `.html`/`.htm` path, or build directory.
- **Node.js**: `>=18.0.0` (verify via `npx one-step-seo doctor`).
- **Optional parameters**:
  - `--pages <1..200>`: Maximum pages to crawl (default `1` for `audit`, `5` for `quick`).
  - `--crawl <links|sitemap>`: Discovery strategy (`links` BFS or `sitemap` XML seeding).
  - `--profile <default|blog|product|docs|home>`: Page-type threshold calibration.
  - `--skills <list>` / `--exclude-skills <list>`: Domain-scoped check filtering.
  - `--psi`: Live Google PageSpeed Insights lab + CrUX field metrics (requires `PSI_API_KEY`).

## 3. Step-by-Step Workflow

1. **Select the execution mode**:
   - Single live URL or local HTML file: `npx one-step-seo page <target> --out ./seo-report`
   - Multi-page site audit: `npx one-step-seo audit <target> --pages 10 --crawl sitemap --out ./seo-report`
   - Fast 5-page overview: `npx one-step-seo quick <target> --out ./seo-report`
   - Offline build folder audit: `npx one-step-seo audit ./dist --pages 20 --offline --out ./seo-report`
2. **Read the canonical machine artifact (`./seo-report/report.json`)**:
   - Inspect `scores.search` (`0-100`, band `A-F`) and `scores.ai` (`0-100`, band `A-F`). Never average or blend the two scores.
   - Check `truncated` (whether HTML exceeded the 5 MiB cap) and `counts` (`P0`, `P1`, `P2`, `P3`, `pass`).
   - Check whether `T05-robots-disallow` is the sole finding (indicating `robots.txt` blocked the crawl and `--force` is needed only if the user owns the site).
3. **Triage findings by severity and reach**:
   - **P0 (Critical blockers, -25 Search)**: `T01-https`, `T02-status`, `T07-noindex`, `O01-title-missing`. Fix immediately.
   - **P1 (High impact, -10 Search)**: `T03-redirects`, `T05-robots`, `T06-sitemap`, `T08-canonical`, `T11-viewport`, `T13-mixed` (active), `T16-broken-links`, `T17-canonical-http`, `O01-title-short`, `O02-meta-missing`, `O03-h1-missing`, `O03-h1-multi`, `O08-alt`, `O10-internal`, `C01-thin`, `C02-answer`, `S01-json-invalid`, `S01-none`, `G02-ai-blocked`.
   - **P2 (Medium optimization, -3 Search)**: `O01-title-long`, `O02-meta-short`, `O02-meta-long`, heading order (`O04-headings`, `O04-heading-empty`, `O05-h2`), `O06-og`, `O07-favicon`, `O09-img-dims`, `C03-extractable`, `C04-faq` (P1 on `docs` profile), `S02-*` schema properties, `G01-llms`, `G03-facts`, `G09-snippet-controls`, `P01-html-size`, `P02-img-count`, `T14-third-party`.
   - **P3 (Polish & GEO depth, -1 Search or GEO-only)**: `O03-h1-drift`, `O11-generic-anchors`, `C05-table-headers`, `S03-faq-parity`, `G04-entity`, `G05-llms-quality`, `G06-freshness`, `G07-question-headings`, `G08-stat-density`, `G10-author`, `G11-semantic-content`, `T15-security-headers`, `W01-social`, `W02-og-url`, `W03-hreflang`.
4. **Synthesize the action plan**:
   - Group recommendations into Immediate Blockers (P0/P1), Content & Schema Enhancements (P2), and AI Citability / Polish (P3).
   - Provide the exact verification command to re-run after fixes.

## 4. Tools & CLI Commands

```bash
# Single page audit (URL or local file)
npx one-step-seo page https://example.com --out ./seo-report

# Multi-page crawl seeded from sitemap with broken-link verification
npx one-step-seo audit https://example.com --pages 15 --crawl sitemap --check-links --out ./seo-report

# Offline static build directory audit
npx one-step-seo audit ./dist --pages 25 --offline --out ./seo-report
```

## 5. Evidence Requirements

- Every claim in your summary **must** cite the finding `id` (e.g., `T08-canonical`), `severity` (`P1`), and exact `evidence` string from `report.findings` in `report.json`.
- Quote actual measured values from `report.page` (`title` and `title.length`, `metaDescription` and `metaDescription.length`, `canonical`, `wordCount`, `h1`, `images`, `internalLinks`, `externalLinks`, and optional `psi`) and `report.site` (`origin`, `robots`, `sitemap`, `sitemapUrls`, `llms`). For detected schema types or blocked AI crawler tokens, quote the `evidence` of `S01-present` / `G02-ai-blocked` in `report.findings`.
- Never invent unmeasured metrics, search volume, backlink counts, or ranking positions.

## 6. Expected Outputs

Present a structured response containing:

1. **Scorecard**: Search SEO (`scores.search.score/100`, `scores.search.band`) and AI Visibility (`scores.ai.score/100`, `scores.ai.band`) side by side, plus `counts` (`P0 / P1 / P2 / P3 / pass`).
2. **One-Sentence Verdict**: Plain-language health summary (matching `report.md` executive summary).
3. **Top 3 Urgent Fixes**: Finding ID, severity, evidence, recommended fix, and `Impact / Effort / Owner`.
4. **AI Visibility & Citability Checklist**: Passing (`[x]`) vs missing (`[ ]`) signals from `report.md` (`## Make this page more citable`, derived from `report.findings` via `citableChecklist`) or `one-step-seo ai <url> --json` (`signals`).
5. **Artifacts & Verification Command**: Paths to `report.html`, `index.html`, `report.md`, and `report.json`, plus the re-run CLI command.

## 7. Limitations & External Data

- **Readiness signals, not Google scores**: Scores measure adherence to documented technical SEO and AI extractability best practices, not live search rankings.
- **Static HTML parsing**: Evaluates server-rendered or static HTML response bodies (up to 5 MiB); client-only JavaScript DOM mutations after hydration are not executed.
- **External data**: Core Web Vitals (`P03-psi-lab`, `P04-psi-field`) are only populated when `--psi` is run with `PSI_API_KEY`. Missing PSI metrics are reported as `null` / unavailable, never `0`.

## 8. Safety & Approval Rules

- Respect `robots.txt` by default. Only pass `--force` if the user explicitly confirms they own the target property and want to bypass `robots.txt` for diagnostic testing.
- Use `--block-private-ips` when auditing untrusted or user-supplied URLs to enforce SSRF and DNS-rebinding protections.
- Never modify source or build files during `seo-audit`; transition to `seo-fix` and request approval before applying file changes.

## 9. Examples

```bash
# Audit a product page with the product calibration profile
npx one-step-seo page https://example.com/shop/backpack --profile product --out ./seo-report

# Audit a documentation site and fail CI if any P0 or P1 findings exist
npx one-step-seo audit https://docs.example.com --pages 10 --profile docs --fail-on P1 --out ./seo-report
```
