---
name: javascript-seo
description: Diagnose client-side rendering (CSR) vs SSR/SSG visibility gaps, empty SPA shells, AI crawler raw-HTML blindness, third-party script bloat, and oversized HTML hydration payloads.
---

# javascript-seo — JavaScript Rendering, SPA/SSR Visibility & Payload Hygiene

## 1. Description & Activation Criteria

Activate `javascript-seo` when the user wants to:

- Audit React, Next.js, Astro, Nuxt, Vue, SvelteKit, Angular, or Vite applications for SSR/SSG vs client-side rendering (CSR) SEO & AI visibility gaps.
- Diagnose why AI crawlers (`GPTBot`, `ClaudeBot`, `PerplexityBot` — which **do not execute JavaScript**) see a blank `<div id="root"></div>` shell even when the site looks fine in Chrome.
- Remediate CSR shell symptoms (`O01-title-missing` P0, `O03-h1-missing` P1, `C01-thin` P1, `O10-internal` P1, `G11-semantic-content` P3) and hydration bloat (`T14-third-party` P2, `P01-html-size` P2, `T00-truncated` P2).

## 2. Inputs & Prerequisites

- **Target**: Live SPA/SSR URL or local build output directory (`./dist`, `./out`, `.next/server/app`).
- **Why `one-step-seo` is ideal for JavaScript SEO**:
  - `one-step-seo` intentionally inspects **raw HTTP HTML responses without a headless browser** — matching the exact raw HTML payload seen by `GPTBot`, `ClaudeBot`, `PerplexityBot`, social card scrapers, and first-wave search crawlers before deferred JS execution.

## 3. Step-by-Step Workflow

1. **Audit the raw server/static HTML response**:
   - Execute `npx one-step-seo page <url> --skills javascript-seo --out ./seo-report` (or audit the static build folder via `npx one-step-seo audit ./dist --pages 15 --skills javascript-seo --offline`).
2. **Detect empty CSR shell syndrome (`O01-title-missing`, `O03-h1-missing`, `C01-thin`, `O10-internal`)**:
   - Inspect `report.page.wordCount`, `report.page.h1`, `report.page.internalLinks`, and `report.page.title` in `report.json`.
   - If `report.page.wordCount < 50`, `O03-h1-missing` (`P1`), and `O10-internal` (`P1`, `0` `<a href>` links) fire together, the route is client-rendered only: AI crawlers and link preview bots receive an empty shell, and `onClick` router buttons (`router.push`) are invisible to crawlers.
3. **Verify crawlable `<a href>` routing & `<main>` landmarks (`O10-internal`, `G11-semantic-content`)**:
   - Ensure navigation uses real `<a href="/path">` elements rendered in server HTML rather than `<button onClick>` or `span` handlers, and wrap route content in `<main>` (`G11-semantic-content` P3).
4. **Control SSR hydration & third-party script bloat (`P01-html-size`, `T00-truncated`, `T14-third-party`)**:
   - Large serialized state blobs (`__NEXT_DATA__`, RSC payloads, inline Redux stores) pushing HTML past `300 KB` trigger `P01-html-size` (`P2`), and payloads exceeding `5 MiB` trigger `T00-truncated` (`P2`), risking crawler cutoff before body links or JSON-LD are parsed.
   - More than `5` external `<script src>` origins triggers `T14-third-party` (`P2`), hurting INP and TBT — pair with `--psi` (`PSI_API_KEY`) to measure real main-thread blocking.

## 4. Tools & CLI Commands

```bash
# Audit raw HTML returned by a Next.js / Nuxt / SPA route
npx one-step-seo page https://example.com/pricing --skills javascript-seo --out ./seo-report

# Audit a static export build folder before deployment
npx one-step-seo audit ./dist --pages 20 --skills javascript-seo --offline --out ./seo-report

# Pair raw-HTML inspection with live Lighthouse TBT & CrUX INP metrics
PSI_API_KEY=your_key npx one-step-seo page https://example.com --psi --skills javascript-seo,core-web-vitals
```

## 5. Evidence Requirements

- Cite `report.page.wordCount`, `report.page.title`, `report.page.h1`, and `report.page.internalLinks` from `report.json` as concrete proof of what raw HTML exposes without JavaScript execution.
- Quote `O01-title-missing`, `O03-h1-missing`, `C01-thin`, `O10-internal`, `P01-html-size`, `T14-third-party`, and `T00-truncated` `evidence` strings from `report.findings`.

## 6. Expected Outputs

1. **Raw-HTML vs Client-Hydration Diagnosis**: Exact visibility verdict for non-JS AI crawlers (`GPTBot`, `ClaudeBot`, `PerplexityBot`) and first-pass search indexing.
2. **Framework Remediation Plan**: Specific SSR/SSG/ISR route migration steps (e.g., Next.js Server Components / `generateMetadata`, Astro static/SSR islands, Vite SSG pre-rendering, replacing `onClick` nav with `<a href>`).
3. **Payload & Script Slimming Actions**: Trimming oversized hydration props and deferring/consolidating third-party script hosts.

## 7. Limitations & External Data

- **No headless DOM diffing built-in**: `one-step-seo` inspects raw HTML deterministically; to compare raw HTML against post-hydration DOM on a CSR app, inspect the live rendered DOM in browser DevTools alongside `report.json`, or run `--psi` with `PSI_API_KEY` for headless Lighthouse metrics.

## 8. Safety & Approval Rules

- Never recommend cloaking (serving different text to `Googlebot`/`GPTBot` User-Agents than to human visitors), which violates Google Search spam essentials; use standard SSR, SSG, or Incremental Static Regeneration (ISR) so users and bots receive the same semantic HTML.

## 9. Examples

```bash
# Inspect the javascript-seo skill rules and aliases
npx one-step-seo skills javascript-seo

# Gate CI builds if an SPA route ships with missing title/H1 or 0 crawlable links
npx one-step-seo audit ./out --pages 25 --skills js-seo --offline --fail-on P1 --out ./seo-report
```
