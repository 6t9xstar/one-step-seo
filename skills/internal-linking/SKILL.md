---
name: internal-linking
description: Audit internal link counts, anchor text quality, broken same-host links (--check-links), and sitemap-only orphan pages across a site.
---

# internal-linking — Internal Linking & Orphan Risk Analysis

## 1. Description & Activation Criteria

Activate `internal-linking` when the user wants to:

- Audit internal link distribution (`O10-internal`, `O10-internal-many`), replace vague anchor text (`O11-generic-anchors`), find broken internal links (`T16-broken-links`), or identify orphaned pages discovered only via `sitemap.xml`.
- Improve crawl depth, topical clustering, and internal PageRank flow.

## 2. Inputs & Prerequisites

- **Target**: Live `http(s)` URL or local build directory.
- **Recommended flags**:
  - `--crawl sitemap`: Seeds the crawl from `sitemap.xml` so sitemap-listed pages with zero inbound links from other crawled pages are flagged as `Possibly orphaned pages`.
  - `--check-links`: Verifies same-host internal link targets (bounded at 100 HTTP checks per run, honoring `robots.txt` and skipping already-audited 200 URLs) to surface `T16-broken-links` (`P1`).

## 3. Step-by-Step Workflow

1. **Run a sitemap-seeded crawl with link verification**:
   - Execute `npx one-step-seo audit <url> --pages 25 --crawl sitemap --check-links --out ./seo-report`.
2. **Fix broken internal links first (`T16-broken-links`, P1)**:
   - Inspect `T16-broken-links` evidence in each `report[-N].json` (e.g., `GET https://example.com/gone -> http status 404`) and update or remove dead hrefs.
3. **Eliminate dead-end and orphaned pages (`O10-internal`, `Possibly orphaned pages`)**:
   - Identify pages where `report.page.internalLinks < 2` (`O10-internal` P1) and add contextual outbound internal links to related hub or detail pages.
   - Inspect `index.md` / `index.html` for sitemap-only orphan pages and link to them from relevant category or pillar pages.
4. **Balance excessive link density (`O10-internal-many`, P3)**:
   - On pages with `>150` internal links (`O10-internal-many`), trim mega-menu or footer link bloat so primary contextual links carry clearer weight.
5. **Upgrade generic anchor text (`O11-generic-anchors`, P3)**:
   - Replace repeated exact-match generic anchors (`click here`, `read more`, `learn more`, `here`, `link`, `more`) with descriptive 2–5 word phrases naming the destination topic.

## 4. Tools & CLI Commands

```bash
# Multi-page internal link, orphan, and broken-link audit
npx one-step-seo audit https://example.com --pages 25 --crawl sitemap --check-links --out ./seo-report

# Single-page broken-link and anchor-text check
npx one-step-seo page https://example.com/blog/post --check-links --skills internal-linking --out ./seo-report
```

## 5. Evidence Requirements

- Quote `report.page.internalLinks` and `report.page.externalLinks` for each audited page.
- Quote the exact broken target URLs and HTTP statuses from `T16-broken-links` evidence.
- Quote the exact generic anchor strings flagged by `O11-generic-anchors` and the orphan URLs listed in `index.md`.

## 6. Expected Outputs

1. **Broken Link Remediation List**: Source page -> Broken target URL -> Status code -> Replacement URL.
2. **Orphan & Dead-End Page Map**: Orphaned URLs needing inbound links and dead-end pages needing outbound links.
3. **Anchor Text Upgrades**: Before/after anchor text rewrites.

## 7. Limitations & External Data

- **Bounded link budget**: `--check-links` caps verification at `MAX_LINK_CHECKS` (100 same-host requests per run) to remain fast and polite.
- **Orphan scope**: Orphan detection is relative to the crawled page set (`--pages` up to 200); a page unlinked from the first N pages may still have links from uncrawled archive pages.

## 8. Safety & Approval Rules

- `--check-links` automatically respects `robots.txt` and SSRF IP protections; never manually fetch disallowed or private network targets.

## 9. Examples

```bash
# Audit internal links and check up to 100 same-host targets on a documentation site
npx one-step-seo audit https://docs.example.com --pages 20 --crawl sitemap --check-links --out ./seo-report
```
