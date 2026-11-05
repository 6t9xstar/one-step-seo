---
name: duplicate-content
description: Detect cross-page duplicate titles and meta descriptions, H1-to-title drift, and conflicting canonical or og:url declarations across multi-page audits.
---

# duplicate-content — Duplicate Metadata & Canonical Clustering

## 1. Description & Activation Criteria

Activate `duplicate-content` when the user wants to:

- Find duplicate `<title>` tags or duplicate `<meta name="description">` tags across multiple pages of a site or static build folder.
- Resolve canonical URL mismatches (`T08-canonical`), insecure `http://` canonicals on `https://` pages (`T17-canonical-http`), `og:url` vs canonical conflicts (`W02-og-url`), multiple `<h1>` tags (`O03-h1-multi`), or H1/title topical drift (`O03-h1-drift`).

## 2. Inputs & Prerequisites

- **Target**: Multi-page site URL (`audit <url> --pages <2..200>`) or local build directory (`audit ./dist --pages <2..200>`).
- **Note**: Cross-page duplicate title and description clustering (`findDuplicateTitles`) requires auditing at least 2 pages (`--pages 2` or higher).

## 3. Step-by-Step Workflow

1. **Run a multi-page audit**:
   - Execute `npx one-step-seo audit <target> --pages 25 --crawl sitemap --out ./seo-report`.
2. **Inspect cross-page duplicate clusters**:
   - Review the **Duplicate titles & meta descriptions** section in `./seo-report/index.md` and `./seo-report/index.html`.
   - Identify every shared `<title>` or `<meta name="description">` and the exact list of pages sharing it.
3. **Evaluate canonical and Open Graph URL alignment (`T08-canonical`, `T17-canonical-http`, `W02-og-url`)**:
   - For each page in a duplicate cluster, check whether the pages are intentional variants (e.g., pagination, regional, or filter URLs that should canonicalize to a primary URL) or distinct pages that accidentally share boilerplate metadata from a CMS template.
   - Verify `og:url` matches the canonical URL (`W02-og-url`) and uses `https://` (`T17-canonical-http`).
4. **Check intra-page heading consistency (`O03-h1-multi`, `O03-h1-drift`)**:
   - Ensure each page has a single `<h1>` whose key terms align with its unique `<title>`.

## 4. Tools & CLI Commands

```bash
# Crawl up to 30 pages to surface duplicate titles and descriptions in index.html / index.md
npx one-step-seo audit https://example.com --pages 30 --crawl sitemap --out ./seo-report

# Audit a local static build folder for duplicate metadata before deployment
npx one-step-seo audit ./dist --pages 50 --offline --out ./seo-report
```

## 5. Evidence Requirements

- List each duplicate string (`title` or `description`), its exact text, and the specific page URLs (`report.finalUrl`) where it appears.
- For canonical findings (`T08-canonical`, `T17-canonical-http`, `W02-og-url`), quote both `page.canonical` and `finalUrl`.

## 6. Expected Outputs

1. **Duplicate Metadata Matrix**: Shared title/description text -> Affected URLs -> Recommended unique title/description per URL.
2. **Canonical Consolidation Plan**: Which URLs should self-canonicalize vs point to a consolidated canonical target.

## 7. Limitations & External Data

- **Automated CLI checks**: Exact-match (case-insensitive, whitespace-normalized) duplicate `<title>` and `<meta name="description">` detection across all crawled pages in the run, plus per-page `T08-canonical`, `T17-canonical-http`, `W02-og-url`, `O03-h1-multi`, and `O03-h1-drift`.
- **Scope boundary**: Only pages fetched within the `--pages` cap are compared. Near-duplicate body prose similarity (shingling/embeddings across external domains) is not performed.

## 8. Safety & Approval Rules

- Before recommending that Page B set `<link rel="canonical" href="Page A">`, confirm with the user that Page B is genuinely a duplicate/variant of Page A — pointing canonicals to a different page de-indexes Page B in search results.

## 9. Examples

```bash
# Run a multi-page duplicate metadata check on a site
npx one-step-seo audit https://example.com --pages 20 --skills duplicate-content --out ./seo-report
```
