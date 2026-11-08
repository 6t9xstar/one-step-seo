---
name: image-seo
description: Audit image SEO, descriptive alt attributes, width/height Cumulative Layout Shift (CLS) prevention, image count budgets, passive mixed-content images, and Open Graph preview images.
---

# image-seo — Image Optimization, Alt Text & Visual Stability

## 1. Description & Activation Criteria

Activate `image-seo` when the user wants to:

- Audit image search discoverability, screen-reader accessibility, and visual layout stability across landing pages, blogs, or product catalogs.
- Remediate missing `alt` attributes (`O08-alt` P1), missing `width`/`height` dimensions causing Cumulative Layout Shift (`O09-img-dims` P2), excessive unoptimized `<img>` counts (`P02-img-count` P2, `> 20` images), missing `og:image` (`O06-og` P2), or `http://` passive mixed-content images (`T13-mixed` P2).
- Run a focused media audit via `--skills image-seo` (aliases: `images`, `media-seo`).

## 2. Inputs & Prerequisites

- **Target**: Live URL or local HTML file/directory.
- **Calibrated thresholds (`lib/checks.mjs`)**:
  - `O08-alt` (`P1`): Fires when `1+` `<img>` tags lack an `alt` attribute (`alt=""` is valid for decorative images; omitting `alt` entirely fails).
  - `O09-img-dims` (`P2`): Fires when more than `50%` of `<img>` tags lack explicit `width` and `height` attributes.
  - `P02-img-count` (`P2`): Fires when a page embeds `> 20` `<img>` elements (`THRESHOLDS.imgCountMax = 20`).

## 3. Step-by-Step Workflow

1. **Run an image-focused audit**:
   - Execute `npx one-step-seo page <url> --skills image-seo --out ./seo-report` (add `--psi` when `PSI_API_KEY` is set to measure live LCP and CLS impact).
2. **Fix missing `alt` attributes (`O08-alt`)**:
   - Inspect `report.page.images` and `O08-alt` (`P1`) in `report.findings`.
   - Write concise, accurate `alt` descriptions for informative photos, charts, diagrams, and product shots; set explicit empty `alt=""` on purely decorative icons or dividers.
3. **Eliminate image-driven CLS (`O09-img-dims`)**:
   - Add intrinsic `width` and `height` attributes (or CSS `aspect-ratio`) to every `<img>` tag so browsers reserve layout space before images download.
4. **Optimize image count, format & loading priority (`P02-img-count`, `T13-mixed`)**:
   - When `P02-img-count` (`P2`) fires (`> 20` images), add `loading="lazy"` and `decoding="async"` to below-the-fold images, serve modern `AVIF`/`WebP` with responsive `srcset`/`sizes`, and **never** put `loading="lazy"` on the above-the-fold LCP hero image (use `fetchpriority="high"` on the hero image instead).
   - Upgrade any `http://` image URLs flagged by `T13-mixed` (`P2`) to `https://`.

## 4. Tools & CLI Commands

```bash
# Single-page image SEO & CLS risk audit
npx one-step-seo page https://example.com --skills image-seo --out ./seo-report

# Multi-page crawl across media-heavy galleries or product pages
npx one-step-seo audit https://example.com --pages 20 --skills images --out ./seo-report

# Combine image HTML checks with live PageSpeed Insights LCP & CLS metrics
PSI_API_KEY=your_key npx one-step-seo page https://example.com --psi --skills image-seo,core-web-vitals
```

## 5. Evidence Requirements

- Report `report.page.images` alongside exact ratios from `O08-alt` (`X/Y images missing alt`), `O09-img-dims` (`X/Y without width+height`), `P02-img-count` (`N <img>`), `O06-og`, and `T13-mixed` in `report.findings`.
- If `report.page.psi` is present, cite `report.page.psi` lab/field LCP and CLS alongside `O09-img-dims` and `P02-img-count`.

## 6. Expected Outputs

1. **Image Health & Stability Summary**: Total `<img>` count, `alt` coverage, intrinsic dimension coverage, HTTPS hygiene, and `og:image` presence.
2. **Concrete `<img>` / `<picture>` Snippets**: Corrected tags with descriptive `alt`, intrinsic `width`/`height`, `fetchpriority="high"` for hero LCP images, and `loading="lazy"` for below-the-fold assets.

## 7. Limitations & External Data

- **HTML markup vs binary byte inspection**: Without `--psi`, `one-step-seo` inspects HTML `<img>` attributes (`alt`, `width`, `height`, `src` scheme, count) without downloading image binaries to check compression ratios or pixel dimensions. Pass `--psi` (`PSI_API_KEY`) for live Lighthouse image byte-savings and LCP/CLS diagnostics.
- **Offline support**: 100% supported offline (`--offline`).

## 8. Safety & Approval Rules

- Never fabricate `width`/`height` pixel values without reading the actual image asset dimensions on disk or in the repo — wrong aspect ratios distort rendered images!
- Never stuff keywords into `alt` attributes; describe what a human viewer actually sees in the image.

## 9. Examples

```bash
# Inspect the image-seo skill definition
npx one-step-seo skills image-seo

# Audit an offline static build for missing alt text and missing image dimensions
npx one-step-seo audit ./dist --pages 20 --skills image-seo --offline --out ./seo-report
```
