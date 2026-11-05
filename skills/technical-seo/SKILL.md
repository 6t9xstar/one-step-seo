---
name: technical-seo
description: Audit and remediate technical SEO infrastructure including HTTP status codes, redirect chains, HTTPS transport, canonical URLs, mixed content, indexability directives, and security headers.
---

# technical-seo — Technical SEO & Indexability

## 1. Description & Activation Criteria

Activate `technical-seo` when the user wants to:

- Diagnose why pages are not indexing or are dropping out of search results.
- Audit HTTP status codes (`T02-status`), redirect chains (`T03-redirects`), HTTPS enforcement (`T01-https`), canonical tags (`T08-canonical`, `T17-canonical-http`), `noindex` directives (`T07-noindex`), mixed content (`T13-mixed`), URL hygiene (`T12-url`), or transport security headers (`T15-security-headers`).
- Run a domain-focused technical infrastructure audit via `--skills technical-seo`.

## 2. Inputs & Prerequisites

- **Target**: Live `http(s)` URL (recommended for full HTTP status, redirect chain, and response header inspection) or local HTML file/directory.
- **Optional flags**:
  - `--skills technical-seo,security-hygiene`: Restricts audit findings to technical and transport security checks.
  - `--check-links`: Verifies same-host internal link targets (up to 100 requests per run) to catch `T16-broken-links`.

## 3. Step-by-Step Workflow

1. **Execute a technical-scoped audit**:
   - Run `npx one-step-seo page <url> --skills technical-seo,security-hygiene --out ./seo-report` (or `audit <url> --pages 10 --skills technical-seo,security-hygiene`).
2. **Inspect transport and status chain (`T01`, `T02`, `T03`, `T04`)**:
   - Verify the final URL resolves over `https:` with HTTP `200` and `content-type: text/html`.
   - If `T03-redirects` fires (>1 hop), inspect the redirect chain in `T03-redirects` `evidence` in `report.json` and recommend collapsing intermediate hops to a single `301` redirect to the final canonical destination.
3. **Verify indexation gates (`T07-noindex`, `T05-robots-disallow`)**:
   - Check both `<meta name="robots">` and the `X-Robots-Tag` HTTP header (`T07-noindex` evaluates both and flags `noindex` or `none` as `P0`).
4. **Validate canonical consistency (`T08-canonical`, `T17-canonical-http`)**:
   - Confirm `<link rel="canonical">` is present, absolute, uses `https://` when the page is served over HTTPS (`T17-canonical-http`), and matches `finalUrl` (ignoring benign trailing-slash or `utm_*` differences).
5. **Check subresource and header hygiene (`T13-mixed`, `T15-security-headers`, `T10-charset`, `T12-url`)**:
   - Distinguish active mixed content (`<script>`/`<iframe>` over `http://` -> `P1`, blocked by browsers) from passive mixed content (`<img>` over `http://` -> `P2`).
   - Check `Strict-Transport-Security`, `Content-Security-Policy`, and `X-Content-Type-Options` (`T15-security-headers`).

## 4. Tools & CLI Commands

```bash
# Single-page technical + security audit
npx one-step-seo page https://example.com --skills technical-seo,security-hygiene --out ./seo-report

# Multi-page technical crawl with broken-link verification
npx one-step-seo audit https://example.com --pages 20 --skills technical-seo --check-links --out ./seo-report

# Inspect registered technical-seo rules in the CLI catalog
npx one-step-seo skills technical-seo
```

## 5. Evidence Requirements

- Always report the exact HTTP status chain from `T02-status` / `T03-redirects` evidence (e.g., `301 -> 302 -> 200`).
- Report both `url` (requested) and `finalUrl` (landed) alongside `page.canonical` from `report.json`.
- When `T07-noindex` fires, specify whether the directive came from `<meta name="robots">` or the `X-Robots-Tag` HTTP response header.

## 6. Expected Outputs

1. **Indexability Verdict**: Clear statement of whether search engines can fetch and index the page (`Indexed / Blocked by P0`).
2. **Transport & Canonical Matrix**: Requested URL, Final URL, HTTP Status, Redirect Hops, Canonical URL, Robots Meta/Header.
3. **Prioritized Technical Fixes**: Exact server configuration, redirect rule, or `<head>` tag changes required.

## 7. Limitations & External Data

- **Automated CLI checks**: HTTP status codes, redirect chains (up to 8 hops), `X-Robots-Tag`, `content-type`, security headers, `<link rel="canonical">`, `<meta charset>`, URL length/query parameters, mixed-content subresources, and 5 MiB HTML truncation (`T00-truncated`).
- **Offline mode limitation**: Auditing local disk files (`--offline`) synthesizes a `200 OK` response without live HTTP headers (`T15-security-headers` is automatically skipped when no headers are captured).
- **External data (advisory)**: Server log crawl frequency and Google Search Console "Crawled - currently not indexed" states require external GSC access (see `docs/GSC.md` for mapping).

## 8. Safety & Approval Rules

- Never recommend removing `noindex` on staging, preview, admin, checkout, or account pages without confirming with the user that the URL is meant to be publicly indexed.
- Never follow redirects to private loopback or cloud metadata IPs; `one-step-seo` enforces socket-level DNS pinning (`--block-private-ips`).

## 9. Examples

```bash
# Diagnose canonical and redirect issues across 10 pages
npx one-step-seo audit https://example.com --pages 10 --skills technical-seo --out ./seo-report

# Preview safe local fixes for missing charset, viewport, and canonical
npx one-step-seo fix ./dist/index.html --only charset,viewport,canonical --url https://example.com/
```
