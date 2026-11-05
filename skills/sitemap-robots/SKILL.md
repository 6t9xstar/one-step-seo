---
name: sitemap-robots
description: Audit robots.txt directives, AI crawler access rules, XML sitemap discovery, sitemap index structures, and crawl coverage using one-step-seo sitemap and audit commands.
---

# sitemap-robots — Sitemap & Robots Discovery Policy

## 1. Description & Activation Criteria

Activate `sitemap-robots` when the user wants to:

- Inspect or troubleshoot `/robots.txt` and `/sitemap.xml` discovery (`T05-robots`, `T05-robots-disallow`, `T06-sitemap`, `G02-ai-blocked`).
- Verify whether `Sitemap:` directives in `robots.txt` resolve properly or whether a `<sitemapindex>` is properly structured.
- Seed a multi-page audit from the XML sitemap (`--crawl sitemap`) to uncover unlinked or orphaned pages.

## 2. Inputs & Prerequisites

- **Target**: Public `http(s)` URL or local build directory containing `robots.txt` and `sitemap.xml`.
- **Optional flags**:
  - `sitemap <url> --json`: Fast discovery inspection without running a full page crawl.
  - `audit <url> --crawl sitemap --pages <N>`: Crawl pages seeded directly from `/sitemap.xml` (or the first `Sitemap:` URL in `robots.txt`).
  - `--skills sitemap-robots`: Filter audit findings to robots, sitemap, and crawl-policy rules.

## 3. Step-by-Step Workflow

1. **Run discovery diagnostics**:
   - Execute `npx one-step-seo sitemap <url> --json`.
   - Inspect `robotsFound`, `robotsSitemaps`, `sitemapFound`, `sitemapUrl`, `sitemapUrls`, `sitemapTruncated`, and `llmsFound`.
2. **Audit `robots.txt` syntax and crawler permissions (`T05-robots`, `G02-ai-blocked`)**:
   - Verify `/robots.txt` returns `200 OK` with valid `User-agent:` / `Allow:` / `Disallow:` groups.
   - Check whether `G02-ai-blocked` fires, and inspect the exact list of blocked AI bot tokens (out of the 25 recognized AI crawlers such as `gptbot`, `claudebot`, `perplexitybot`, `google-extended`).
3. **Evaluate XML Sitemap health (`T06-sitemap`)**:
   - Confirm the sitemap contains valid `<loc>` entries (or plaintext URLs) and is not an HTML 404 page served with a `200` status.
   - Distinguish a standard `<urlset>` (`~N URLs`) from a `<sitemapindex>` (`~N child sitemaps`).
4. **Compare sitemap inventory against internal link discovery**:
   - Run `npx one-step-seo audit <url> --crawl sitemap --pages 20 --out ./seo-report`.
   - Inspect the terminal output and `index.md` / `index.html` for **Possibly orphaned pages** (URLs present in `sitemap.xml` that received zero inbound internal links from crawled pages).

## 4. Tools & CLI Commands

```bash
# Quick JSON check of robots.txt, sitemap.xml, and llms.txt
npx one-step-seo sitemap https://example.com --json

# Audit 20 pages seeded from the XML sitemap
npx one-step-seo audit https://example.com --crawl sitemap --pages 20 --out ./seo-report

# Focused sitemap & robots rule check on a single URL
npx one-step-seo page https://example.com --skills sitemap-robots --out ./seo-report
```

## 5. Evidence Requirements

- Quote `site.robots`, `site.sitemap`, `site.sitemapUrls`, and `site.aiCrawlersBlocked` from `report.json` or `sitemap --json`.
- When `T06-sitemap` fails, specify whether the file was missing (HTTP 404) or returned 200 with zero valid `<loc>` entries.
- When reporting orphan pages, cite the exact URLs listed under `Possibly orphaned pages` in `index.md`.

## 6. Expected Outputs

1. **Discovery Status Summary**: Status of `/robots.txt`, `Sitemap:` declarations, resolved `/sitemap.xml` URL, entry count, and `/llms.txt`.
2. **Crawler Access Policy**: Search engine vs AI crawler permissions (`Allow` vs `Disallow` by user-agent).
3. **Remediation Snippets**: Ready-to-use `robots.txt` or `sitemap.xml` structure fixes.

## 7. Limitations & External Data

- **Same-origin enforcement**: Sitemap URLs and child `<sitemapindex>` files are filtered to the audited origin for security; cross-host sitemap seeds are ignored.
- **Crawl cap**: `getSitemapUrls` follows up to 5 child sitemaps in a `<sitemapindex>` and caps crawled pages at `--pages` (max 200).
- **External data (advisory)**: Live Google Search Console sitemap submission errors and index coverage ratios require GSC access.

## 8. Safety & Approval Rules

- Never recommend exposing private admin, API, or user-account paths in `robots.txt` or `sitemap.xml`.
- Remind users that `robots.txt` `Disallow` prevents crawling, **not** indexing of linked URLs — sensitive pages must use `noindex` or authentication.

## 9. Examples

```bash
# Inspect sitemap and robots configuration in JSON mode
npx one-step-seo sitemap https://example.com --json

# Audit sitemap-seeded pages and check for orphans
npx one-step-seo audit https://example.com --crawl sitemap --pages 15 --out ./seo-report
```
