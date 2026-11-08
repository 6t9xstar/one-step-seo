---
name: security-hygiene
description: Audit HTTPS transport enforcement, active and passive mixed content, insecure canonical downgrades, HTTP security headers (CSP, HSTS, X-Content-Type-Options), and SSRF-safe crawling.
---

# security-hygiene — Transport Security & SEO Hygiene

## 1. Description & Activation Criteria

Activate `security-hygiene` when the user wants to:

- Verify HTTPS enforcement (`T01-https` P0) and eliminate HTTP-to-HTTPS canonical downgrades (`T17-canonical-http` P1).
- Detect and fix active mixed content (`http://` scripts blocked by browsers, `T13-mixed` P1) or passive mixed content (`http://` images, `T13-mixed` P2).
- Audit baseline HTTP response security headers (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `T15-security-headers` P3).
- Run audits in untrusted or multi-tenant CI environments with socket-level SSRF protection (`--block-private-ips`).

## 2. Inputs & Prerequisites

- **Target**: Live `http(s)` URL (required to inspect live TLS protocol and HTTP response headers) or local HTML files (for offline mixed-content and canonical protocol checks).
- **Key flags**:
  - `--skills security-hygiene`: Restricts output to `T01-https`, `T13-mixed`, `T15-security-headers`, and `T17-canonical-http`.
  - `--block-private-ips`: Blocks DNS resolution and socket connections to loopback, RFC 1918 private networks, IPv6 ULA/link-local, and cloud metadata endpoints (`169.254.169.254`, `100.100.100.200`, `192.0.0.192`).

## 3. Step-by-Step Workflow

1. **Run a security-scoped audit**:
   - Execute `npx one-step-seo page <url> --skills security-hygiene --block-private-ips --out ./seo-report`.
2. **Verify HTTPS transport (`T01-https`) & canonical scheme (`T17-canonical-http`)**:
   - Confirm `report.finalUrl` resolves over `https://` (`T01-https` P0 if served over `http://`).
   - Confirm `report.page.canonical` does not point to an `http://` URL when the page is served over `https://` (`T17-canonical-http` P1), which causes indexation splits and insecure canonical signals.
3. **Remediate mixed-content subresources (`T13-mixed`)**:
   - **Active mixed content (`P1`)**: Any `<script src="http://...">` on an `https://` page is blocked outright by modern browsers, breaking interactive rendering and client hydration. Upgrade to `https://` immediately.
   - **Passive mixed content (`P2`)**: Any `http://` image or media subresource triggers browser "Not Secure" indicator downgrades. Upgrade to `https://`.
4. **Harden response headers (`T15-security-headers`)**:
   - Inspect `T15-security-headers` (`P3`) evidence for missing `strict-transport-security` (HSTS), `content-security-policy` (CSP), and `x-content-type-options` (`nosniff`).
   - Recommend phased rollout at the CDN/edge layer (e.g., `Content-Security-Policy-Report-Only` first before enforcing strict CSP).

## 4. Tools & CLI Commands

```bash
# Single-page transport & mixed-content audit with SSRF protection
npx one-step-seo page https://example.com --skills security-hygiene --block-private-ips --out ./seo-report

# Multi-page crawl checking HTTPS, mixed content, and security headers
npx one-step-seo audit https://example.com --pages 20 --skills security-hygiene --block-private-ips --out ./seo-report

# Inspect the security-hygiene skill definition
npx one-step-seo skills security-hygiene
```

## 5. Evidence Requirements

- Quote `report.url`, `report.finalUrl`, `report.page.canonical`, and exact offending `http://` subresource URLs or missing header names from `T01-https`, `T13-mixed`, `T15-security-headers`, and `T17-canonical-http` in `report.findings`.
- Clearly separate browser-blocking active mixed content (`P1`) from passive mixed content (`P2`) and defense-in-depth headers (`P3`).

## 6. Expected Outputs

1. **Transport & Canonical Security Verdict**: Protocol status (`https:` vs `http:`), redirect hop check, and canonical protocol alignment.
2. **Mixed-Content Inventory**: Exact `http://` script/image URLs to upgrade to `https://`.
3. **Edge/Server Header Snippet**: Safe Nginx, Cloudflare, Vercel, or Netlify configuration for `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, and baseline `Content-Security-Policy`.

## 7. Limitations & External Data

- **Offline header limitation**: When auditing local disk files (`--offline`), no HTTP response headers exist, so `T15-security-headers` is skipped automatically without false positives.
- **Scope**: `security-hygiene` checks transport, mixed-content, and baseline HTTP header signals affecting browser trust and search ranking — it is not a replacement for dynamic application penetration testing (DAST) or TLS cipher suite scanning.

## 8. Safety & Approval Rules

- **Never deploy HSTS `preload` or restrictive `Content-Security-Policy` headers blindly**: A misconfigured CSP can block legitimate analytics, fonts, or checkout scripts, and HSTS `includeSubDomains; preload` can lock out legacy HTTP subdomains. Always recommend testing with short `max-age` (e.g., `max-age=300`) and `Content-Security-Policy-Report-Only` first.
- Always pass `--block-private-ips` when auditing user-supplied URLs in automated pipelines.

## 9. Examples

```bash
# Gate CI deployments on P0/P1 transport or active mixed-content errors
npx one-step-seo audit https://staging.example.com --pages 10 --skills security-hygiene --fail-on P1 --out ./seo-report
```
