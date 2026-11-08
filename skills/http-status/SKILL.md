---
name: http-status
description: Audit HTTP response status codes, multi-hop redirect chains, MIME content-types, broken same-host internal links (--check-links), and HTTPS canonical redirects.
---

# http-status — HTTP Status Codes, Redirect Chains & Link Health

## 1. Description & Activation Criteria

Activate `http-status` when the user wants to:

- Diagnose `404 Not Found`, `410 Gone`, `5xx` server errors, soft-redirect failures (`T02-status` P0), or wrong MIME headers (`T04-content-type` P2).
- Collapse multi-hop redirect chains (`301 -> 302 -> 200`, `T03-redirects` P1) after site migrations, domain changes, or trailing-slash/HTTPS rewrites.
- Probe same-host internal links across a site to catch broken `4xx`/`5xx` destinations (`--check-links`, `T16-broken-links` P1).

## 2. Inputs & Prerequisites

- **Target**: Live `http(s)` URL (required for real HTTP status codes, redirect hop chains, and `--check-links` network probes).
- **Key flags**:
  - `--skills http-status` (aliases: `redirects`, `status-codes`).
  - `--check-links`: Probes up to `100` unique same-host internal links per run (`MAX_LINK_CHECKS = 100`) and emits `T16-broken-links` (`P1`) on `4xx`/`5xx` or connection failures.

## 3. Step-by-Step Workflow

1. **Run a live status & link-health audit**:
   - Execute `npx one-step-seo audit <url> --pages 20 --skills http-status --check-links --out ./seo-report` (or `page <url> --skills http-status --check-links`).
2. **Resolve non-200 landing pages (`T02-status`)**:
   - Inspect `report.url` vs `report.finalUrl` and `T02-status` (`P0`). Any indexable URL returning `4xx`, `5xx`, or exceeding the 8-hop redirect cap blocks search indexing and AI retrieval completely.
3. **Flatten redirect chains (`T03-redirects`, `T01-https`, `T17-canonical-http`)**:
   - `T03-redirects` (`P1`) fires whenever a URL requires more than `1` redirect hop (e.g., `http://example.com/page` -> `https://example.com/page` -> `https://www.example.com/page/`).
   - Rewrite server/CDN redirect rules so every legacy URL jumps in **1 direct `301` hop** to the final `https://` canonical URL, and update internal `<a href>` links to point directly to `report.finalUrl` (`0` hops).
4. **Verify MIME `content-type` (`T04-content-type`)**:
   - Confirm HTML pages send `Content-Type: text/html; charset=utf-8` (`T04-content-type` P2).
5. **Eliminate broken internal links (`T16-broken-links`)**:
   - Review `T16-broken-links` (`P1`) evidence from `--check-links` and either restore the missing target, add a `301` redirect to its replacement, or update the source `<a href>` link.

## 4. Tools & CLI Commands

```bash
# Single-page redirect chain and broken-link check
npx one-step-seo page https://example.com --skills http-status --check-links --out ./seo-report

# Post-migration multi-page status & link audit seeded from XML sitemap
npx one-step-seo audit https://example.com --crawl sitemap --pages 50 --skills http-status --check-links --out ./seo-report

# Inspect the http-status skill rules
npx one-step-seo skills http-status
```

## 5. Evidence Requirements

- Always report `report.url` (requested URL), `report.finalUrl` (landed URL), and the full hop chain from `T02-status` / `T03-redirects` `evidence` in `report.findings`.
- List every broken internal target URL and status code surfaced by `T16-broken-links`.

## 6. Expected Outputs

1. **Status & Redirect Hop Table**: Requested URL -> Intermediate Hops -> Final URL, HTTP Status, and `Content-Type`.
2. **Broken Internal Link Inventory**: Source page, broken target URL, HTTP status, and exact `<a href>` replacement.
3. **Edge/Server Redirect Rules**: Consolidated single-hop `301` redirect rules (Vercel `vercel.json`, Netlify `_redirects`, Nginx, or Cloudflare Bulk Redirects).

## 7. Limitations & External Data

- **Live HTTP required**: Offline file audits (`--offline`) synthesize a local `200 OK` (`text/html`) response and cannot test server redirect rules or live `404` status codes.
- **Polite link-check cap**: `--check-links` is bounded to `100` unique same-host link probes per run (`MAX_LINK_CHECKS`) and skips paths disallowed by `robots.txt`.

## 8. Safety & Approval Rules

- Prefer permanent `301` (or `308`) redirects only when a URL move is permanent; use `302` / `307` for temporary maintenance or seasonal routing so search engines retain the original URL.
- Never create redirect loops or bulk-redirect unrelated `404` URLs to the homepage (which Google treats as a Soft 404); redirect to the closest topical equivalent or return a genuine `404`/`410`.

## 9. Examples

```bash
# Fail CI if a staging deployment introduces P0 status errors or P1 redirect chains / broken links
npx one-step-seo audit https://staging.example.com --pages 25 --skills http-status --check-links --fail-on P1 --out ./seo-report
```
