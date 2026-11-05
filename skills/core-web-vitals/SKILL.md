---
name: core-web-vitals
description: Audit Core Web Vitals (LCP, INP, CLS) via Google PageSpeed Insights (--psi) alongside offline performance hygiene (HTML payload weight, image dimensions, lazy loading, and third-party script bloat).
---

# core-web-vitals — Core Web Vitals & Performance Hygiene

## 1. Description & Activation Criteria

Activate `core-web-vitals` when the user wants to:

- Measure or interpret Lighthouse Lab metrics (Performance score, LCP, CLS, FCP, TBT, Speed Index, TTFB) and Chrome UX Report (CrUX) 75th-percentile Field metrics (LCP, INP, CLS) via `--psi`.
- Audit offline performance and layout stability signals (`P01-html-size`, `P02-img-count`, `O09-img-dims`, `T14-third-party`, `T00-truncated`).

## 2. Inputs & Prerequisites

- **Target**: Public `http(s)` URL (for `--psi` live metrics) or local HTML file (for offline HTML/image/script hygiene checks).
- **Environment variable for `--psi`**:
  - `PSI_API_KEY`: Required when passing `--psi`. Read exclusively from `process.env.PSI_API_KEY` (never passed on the command line or logged in reports).
  - `--psi-strategy <mobile|desktop>`: Defaults to `mobile`.

## 3. Step-by-Step Workflow

1. **Run performance checks**:
   - With `PSI_API_KEY` configured: `npx one-step-seo page <url> --psi --psi-strategy mobile --out ./seo-report`
   - Without `PSI_API_KEY` (offline/HTML hygiene): `npx one-step-seo page <target> --skills core-web-vitals --out ./seo-report`
2. **Separate Lab vs CrUX Field results (`P03-psi-lab`, `P04-psi-field`, `P05-psi-error`)**:
   - Inspect `report.page.psi.lab` and `report.page.psi.field` in `report.json`.
   - **Never treat `null` / missing metrics as `0`**: If CrUX field data is unavailable for a low-traffic URL, report Field metrics as `Unavailable (insufficient CrUX field data)`, never `0ms` or `0.00`.
   - Evaluate CrUX 75th-percentile thresholds (`lib/psi.mjs`):
     - **LCP**: Good `<=2.5s`, Needs Improvement `2.5s–4.0s` (`P2`), Poor `>4.0s` (`P1`).
     - **INP**: Good `<=200ms`, Needs Improvement `200ms–500ms` (`P2`), Poor `>500ms` (`P1`).
     - **CLS**: Good `<=0.10`, Needs Improvement `0.10–0.25` (`P2`), Poor `>0.25` (`P1`).
3. **Diagnose root causes in HTML markup (`P01`, `P02`, `O09`, `T14`)**:
   - **CLS drivers**: Check `O09-img-dims` (`P2`) for `<img>` tags missing explicit `width` and `height` attributes.
   - **LCP / payload drivers**: Check `P01-html-size` (>500 KB HTML) and `P02-img-count` (>20 images without `loading="lazy"`). Note: keep the hero/LCP image eager (`fetchpriority="high"`, no `loading="lazy"`) and lazy-load below-the-fold images.
   - **INP / TBT drivers**: Check `T14-third-party` (>5 distinct third-party `<script>` hosts) and recommend `defer` or removing non-essential trackers.

## 4. Tools & CLI Commands

```bash
# Run a mobile PageSpeed Insights + SEO audit (requires PSI_API_KEY in environment)
PSI_API_KEY=your_key npx one-step-seo page https://example.com --psi --psi-strategy mobile --out ./seo-report

# Run offline performance & script hygiene checks without an API key
npx one-step-seo page https://example.com --skills core-web-vitals --out ./seo-report
```

## 5. Evidence Requirements

- Always distinguish **Lighthouse Lab (simulated)** from **CrUX Field (real-user 75th percentile)** metrics and state the active strategy (`mobile` or `desktop`).
- Explicitly report `null` metrics as `Unavailable / Not measured`.
- Cite exact counts from `P01-html-size`, `P02-img-count`, `O09-img-dims`, and `T14-third-party`.

## 6. Expected Outputs

1. **Core Web Vitals Table**: Metric, Lab Value, CrUX Field Value (p75), Threshold Status (`Good / Needs Improvement / Poor / Unavailable`).
2. **Markup Bottleneck Plan**: Specific images missing dimensions, third-party script hosts to defer, and HTML payload reductions.

## 7. Limitations & External Data

- **External API dependency for `--psi`**: Live LCP/INP/CLS measurements require network access to `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` and `PSI_API_KEY`.
- **Rate limits & errors**: If the PSI API returns HTTP 429 or times out, `P05-psi-error` (`P3`) records the diagnostic note without crashing the audit or penalizing the Search SEO score.

## 8. Safety & Approval Rules

- Never hardcode or echo `PSI_API_KEY` into command arguments, commit messages, or generated reports.
- Do not recommend adding `loading="lazy"` to the primary above-the-fold hero/LCP `<img>`, as lazy-loading the LCP element delays largest contentful paint.

## 9. Examples

```bash
# Check environment readiness for PSI
npx one-step-seo doctor

# Audit desktop Core Web Vitals
PSI_API_KEY=your_key npx one-step-seo page https://example.com --psi --psi-strategy desktop --out ./seo-report
```
