---
name: onpage-optimization
description: Audit and optimize page titles, meta descriptions, H1-H6 heading hierarchies, image alt text and dimensions, favicon, and Open Graph / Twitter social cards.
---

# onpage-optimization — On-Page Metadata & Heading Optimization

## 1. Description & Activation Criteria

Activate `onpage-optimization` when the user wants to:

- Audit or improve `<title>`, `<meta name="description">`, `<h1>`–`<h6>` structure, image `alt` and `width`/`height` attributes, favicons, and Open Graph / Twitter social sharing tags.
- Fix snippet truncation, missing metadata, skipped heading levels (`O04-headings`), empty headings (`O04-heading-empty`), or H1-to-title topical drift (`O03-h1-drift`).
- Run a focused on-page audit via `--skills onpage-seo` (or alias `--skills onpage-optimization`).

## 2. Inputs & Prerequisites

- **Target**: URL, local `.html` file, or build directory.
- **Calibrated thresholds (`lib/checks.mjs` -> `THRESHOLDS`)**:
  - `<title>`: `30–60` characters (`O01-title-missing` P0, `O01-title-short` P1, `O01-title-long` P2).
  - `<meta name="description">`: `120–155` characters (`O02-meta-missing` P1, `O02-meta-short` P2, `O02-meta-long` P2).
  - `<h1>`: Exactly 1 per page (`O03-h1-missing` P1, `O03-h1-multi` P1) sharing key terms with `<title>` (`O03-h1-drift` P3).

## 3. Step-by-Step Workflow

1. **Run an on-page and accessibility audit**:
   - Execute `npx one-step-seo page <target> --skills onpage-seo,accessibility-ux --out ./seo-report`.
2. **Inspect document identity (`O01`, `O02`, `O03`)**:
   - Check `report.page.title` (`report.page.title.length`), `report.page.metaDescription` (`report.page.metaDescription.length`), and `report.page.h1`.
   - Ensure `<title>` and `<h1>` share at least one substantive keyword token so `O03-h1-drift` passes and users see a consistent headline after clicking from search results.
3. **Audit heading hierarchy (`O04-headings`, `O04-heading-empty`, `O05-h2`)**:
   - Verify headings never skip levels (e.g., `<h1>` directly to `<h3>`), contain visible text (`O04-heading-empty`), and divide pages of 600+ words with `<h2>` subheadings (`O05-h2`).
4. **Verify image and social metadata (`O08-alt`, `O09-img-dims`, `O06-og`, `O07-favicon`, `W01-social`, `W02-og-url`)**:
   - Confirm every informative `<img>` has descriptive `alt` text (`alt=""` is valid only for decorative images) and explicit `width` + `height` attributes (`O09-img-dims`) to prevent Cumulative Layout Shift (CLS).
   - Check `og:title`, `og:description`, `og:image`, `og:url`, and `twitter:card`.
5. **Draft or preview fixes**:
   - For local files with missing tags, preview additive fixes with `npx one-step-seo fix <file> --only title,description,og,og-url,twitter-card,favicon`.

## 4. Tools & CLI Commands

```bash
# Audit on-page SEO and accessibility rules
npx one-step-seo page https://example.com --skills onpage-optimization,accessibility-ux --out ./seo-report

# Preview local metadata fixes without modifying files
npx one-step-seo fix ./dist/index.html --url https://example.com/ --lang en
```

## 5. Evidence Requirements

- Quote the exact current `<title>` and its character count (`report.page.title` and `report.page.title.length`, or `O01-*` evidence), current `<meta name="description">` and its character count (`report.page.metaDescription` and `report.page.metaDescription.length`, or `O02-*` evidence), and all `<h1>` texts (`report.page.h1`).
- Quote the exact count of images missing `alt` or `width`/`height` from `O08-alt` and `O09-img-dims` evidence.

## 6. Expected Outputs

1. **Current vs Recommended Metadata Table**: Current value, character count, issue ID, and proposed replacement within calibrated character ranges (`30–60` chars for title, `120–155` chars for meta description).
2. **Heading Outline Audit**: Current H1–H6 progression and fixes for skipped or empty headings.
3. **Image & Social Tag Checklist**: Missing `alt`, `width`/`height`, Open Graph, and Twitter card snippets.

## 7. Limitations & External Data

- **Automated CLI checks**: Title/meta presence and length, H1 count and title overlap, heading level sequence, empty headings, H2 presence on 600+ word pages, image `alt` and `width`/`height` attributes, favicon link, Open Graph, and Twitter card tags.
- **Advisory / manual judgment**: Writing compelling copy or describing specific image contents (`O08-alt`) requires human or agent inspection of the page subject and image asset.
- **External data**: Live SERP pixel-width truncation and click-through rate (CTR) experiments require Google Search Console Performance data.

## 8. Safety & Approval Rules

- Never auto-populate `alt` text with filenames or keyword-stuffed strings; describe the actual image content or use `alt=""` if purely decorative.
- Never overwrite existing `<title>` or `<meta name="description">` tags without showing the user the proposed copy first.

## 9. Examples

```bash
# Run on-page optimization checks on a local HTML file
npx one-step-seo page ./dist/pricing.html --skills onpage-optimization --offline --out ./seo-report
```
