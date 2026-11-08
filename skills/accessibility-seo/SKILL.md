---
name: accessibility-seo
description: Audit machine-verifiable HTML accessibility signals that directly impact search UX and AI parsing, including html lang, mobile viewport, image alt text, heading structure, descriptive anchors, and main landmarks.
---

# accessibility-seo — HTML Accessibility & Search UX Alignment

## 1. Description & Activation Criteria

Activate `accessibility-seo` when the user wants to:

- Audit the foundational overlap between WCAG HTML accessibility, mobile search usability, and AI content extraction.
- Remediate missing `<html lang>` (`T09-lang` P2), missing/broken mobile `<meta name="viewport">` (`T11-viewport` P1), missing image `alt` attributes (`O08-alt` P1), skipped/empty headings (`O04-headings` P2, `O04-heading-empty` P2), vague link text (`O11-generic-anchors` P3), or missing `<main>`/`<article>` landmarks (`G11-semantic-content` P3).
- Run a focused audit via `--skills accessibility-seo` (or `--skills a11y`).

## 2. Inputs & Prerequisites

- **Target**: Live URL, local HTML file, or static build directory (`./dist`, `./out`, `./public`).
- **Key flags**:
  - `--skills accessibility-seo` (aliases: `accessibility-ux`, `a11y`): Filters audit findings to semantic HTML accessibility and mobile UX checks.
  - `fix --only lang,viewport`: Safely previews/applies missing `<html lang>` and responsive `<meta name="viewport">` tags on local HTML files.

## 3. Step-by-Step Workflow

1. **Run an accessibility-scoped audit**:
   - Execute `npx one-step-seo page <url-or-file> --skills accessibility-seo --out ./seo-report`.
2. **Fix document language & mobile viewport (`T09-lang`, `T11-viewport`)**:
   - Screen readers rely on `<html lang="...">` to select the right pronunciation voice (`T09-lang` P2).
   - Mobile browsers and mobile-first indexing require `<meta name="viewport" content="width=device-width, initial-scale=1">` (`T11-viewport` P1) — never set `user-scalable=no` or `maximum-scale=1`, which blocks pinch-to-zoom for low-vision users.
3. **Provide meaningful image alternatives (`O08-alt`)**:
   - Inspect `report.page.images` and `O08-alt` (`P1`). Informative images need concise `alt` text conveying the image's meaning; purely decorative graphics must explicitly declare `alt=""` (empty attribute) so screen readers skip them cleanly.
4. **Repair document outline & landmarks (`O04-headings`, `O04-heading-empty`, `G11-semantic-content`, `C05-table-headers`)**:
   - Remove or populate empty `<h1>`–`<h6>` tags (`O04-heading-empty` P2) and fix skipped heading levels like `<h1>` -> `<h3>` (`O04-headings` P2).
   - Wrap primary page content in `<main>` or `<article>` (`G11-semantic-content` P3 on 600+ word pages) so assistive tech and AI readers can bypass navigation chrome.
5. **Replace generic link anchors (`O11-generic-anchors`)**:
   - Rewrite repetitive `"click here"`, `"read more"`, and `"learn more"` anchors (`O11-generic-anchors` P3 when 2+ links match) into self-describing destination labels (e.g., `"Read the API authentication guide"`).

## 4. Tools & CLI Commands

```bash
# Audit accessibility-aligned SEO signals on a live page
npx one-step-seo page https://example.com --skills accessibility-seo --out ./seo-report

# Audit an entire local build directory offline
npx one-step-seo audit ./dist --pages 20 --skills a11y --offline --out ./seo-report

# Preview safe additive fixes for missing viewport and html lang
npx one-step-seo fix ./dist --only viewport,lang --lang en
```

## 5. Evidence Requirements

- Quote exact counts and offending elements from `O08-alt` (`X/Y images missing alt`), `O04-heading-empty` (`Empty headings found: ...`), `O11-generic-anchors` (`"read more" ×N`), `T09-lang`, and `T11-viewport` in `report.findings`.
- Reference `report.page.h1`, `report.page.images`, and `report.page.wordCount` from `report.json`.

## 6. Expected Outputs

1. **Semantic Accessibility Scorecard**: Status of language, mobile viewport, image `alt` coverage, heading hierarchy, landmarks, and link anchors.
2. **Remediation Diffs**: Mechanical `<head>` fixes via `one-step-seo fix` plus human-reviewed `alt` text and anchor rewrites grounded in page context.

## 7. Limitations & External Data

- **Foundational HTML scope**: `one-step-seo` audits deterministic HTML markup signals (`lang`, `viewport`, `alt`, headings, anchors, `<main>`). It does **not** compute rendered CSS color contrast ratios, keyboard focus traps, ARIA state machine transitions, or captions on video streams — pair with browser DevTools / axe / Lighthouse accessibility testing for full WCAG 2.2 AA compliance.
- **Offline support**: 100% supported offline.

## 8. Safety & Approval Rules

- Never auto-generate generic or filename-stuffed `alt` text (e.g., `alt="IMG_4029.jpg"` or keyword-stuffed strings); `one-step-seo fix` intentionally excludes `alt` text so descriptions stay accurate to the visual asset.
- Never add `maximum-scale=1` or `user-scalable=no` to `<meta name="viewport">`.

## 9. Examples

```bash
# Inspect all checks in the accessibility-ux skill
npx one-step-seo skills accessibility-seo

# Apply viewport and English lang fixes to local HTML files with .bak backups
npx one-step-seo fix ./public --apply --only viewport,lang --lang en
```
