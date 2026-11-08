---
name: international-seo
description: Audit and configure multi-language and multi-regional websites including hreflang reciprocity, x-default fallbacks, HTML lang declarations, and locale canonicalization.
---

# international-seo — Internationalization & Multi-Regional SEO

## 1. Description & Activation Criteria

Activate `international-seo` when the user wants to:

- Audit multi-language or multi-country sites (`en`, `en-US`, `en-GB`, `fr-CA`, `es`, `de`, `ja`, etc.) for `hreflang` completeness and `<html lang>` alignment.
- Diagnose why the wrong regional or translated URL ranks in Google or gets cited by AI search engines.
- Remediate `W03-hreflang` (P3), `T09-lang` (P2), or cross-locale canonical mistakes (`T08-canonical` P1/P2).
- Run a focused localization audit via `--skills international-seo`.

## 2. Inputs & Prerequisites

- **Target**: Live regional URL(s) or local multi-locale build directory (e.g., `./dist/en/`, `./dist/fr/`).
- **Optional flags**:
  - `--skills international-seo`: Focuses findings on `W03-hreflang`, `T09-lang`, `T08-canonical`, and `S02-` schema checks.
  - `--pages N`: Audits multiple locale variants in a single run to verify each locale self-canonicalizes rather than pointing all translations to the default language.

## 3. Step-by-Step Workflow

1. **Run an internationalization-scoped audit**:
   - Execute `npx one-step-seo page <url> --skills international-seo --out ./seo-report` (or `npx one-step-seo audit <url> --pages 15 --skills international-seo --out ./seo-report`).
2. **Verify document language declaration (`T09-lang`)**:
   - Ensure every HTML document declares a valid BCP-47 `<html lang="...">` attribute (`T09-lang` P2 when missing) matching the visible language of the page.
3. **Validate `hreflang` alternate links (`W03-hreflang`)**:
   - Check `<link rel="alternate" hreflang="..." href="...">` tags (`W03-hreflang` P3 when any entry lacks a valid `hreflang` or `href`).
   - Confirm four localization invariants:
     1. **Self-referencing `hreflang`**: Every localized page includes an `hreflang` link pointing to itself.
     2. **Reciprocity (return links)**: If `/en/pricing` links to `/de/pricing`, `/de/pricing` must link back to `/en/pricing`.
     3. **`x-default` fallback**: Include `hreflang="x-default"` pointing to the language selector or global default URL.
     4. **Absolute canonical URLs**: Every `href` in `hreflang` must be an absolute `https://` URL returning HTTP `200`.
4. **Prevent cross-locale canonical cannibalization (`T08-canonical`)**:
   - Inspect `report.page.canonical` vs `report.finalUrl`. Translated pages (`/fr/...`, `/es/...`) must self-canonicalize to their own locale URL — never canonicalize a French translation to the English URL, or Google will de-index the translated page.

## 4. Tools & CLI Commands

```bash
# Single-page international SEO audit
npx one-step-seo page https://example.com/fr/pricing --skills international-seo --out ./seo-report

# Multi-page crawl across localized subdirectories
npx one-step-seo audit https://example.com --pages 20 --skills international-seo --out ./seo-report

# Safe dry-run fix for missing <html lang> on a localized build directory
npx one-step-seo fix ./dist/fr --only lang --lang fr

# Inspect the international-local skill definition
npx one-step-seo skills international-seo
```

## 5. Evidence Requirements

- Quote `T09-lang` and `W03-hreflang` `evidence` strings from `report.findings`.
- Report `report.finalUrl` alongside `report.page.canonical` for every audited locale variant to prove each locale self-canonicalizes.
- List the exact ISO 639-1 language codes (e.g., `en`, `es`, `fr`) and optional ISO 3166-1 Alpha-2 region codes (e.g., `en-GB`, `pt-BR` — never `en-UK`, which is invalid ISO 3166-1).

## 6. Expected Outputs

1. **Locale & Hreflang Matrix**: Table of audited URLs, `<html lang>`, `report.page.canonical`, declared `hreflang` cluster, and `x-default` target.
2. **Canonical & Reciprocity Diagnosis**: Any broken return links, invalid region codes (`en-UK` vs `en-GB`), or cross-language canonical errors.
3. **Ready-to-Paste `<head>` Cluster**: Complete `<link rel="alternate" hreflang="...">` + `<link rel="canonical">` block for each locale.

## 7. Limitations & External Data

- **Single-page vs cross-domain reciprocity**: `W03-hreflang` verifies syntax and completeness of `<link rel="alternate" hreflang>` tags on each audited page; verifying bidirectional reciprocity across separate country-code TLDs (`.co.uk`, `.de`, `.jp`) requires auditing each target URL separately with `one-step-seo page`.
- **Offline support**: 100% supported on local static exports (`--offline`).

## 8. Safety & Approval Rules

- Never guess `<html lang>` when running `one-step-seo fix` — always pass an explicit `--lang <bcp47>` verified from the page's actual language.
- Never redirect crawlers (`Googlebot`, `GPTBot`, `ClaudeBot`) automatically by GeoIP (`Accept-Language` or IP geolocation `302` redirects), because US-based crawlers will never see non-US regional pages; use `hreflang` + a user-selectable locale switcher instead.

## 9. Examples

```bash
# Audit an offline multi-locale static build
npx one-step-seo audit ./dist --pages 20 --skills international-seo --offline --out ./seo-report

# Apply explicit French lang attribute with backup safety
npx one-step-seo fix ./dist/fr/index.html --apply --only lang --lang fr-FR
```
