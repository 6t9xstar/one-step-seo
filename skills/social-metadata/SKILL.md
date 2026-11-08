---
name: social-metadata
description: Audit and remediate Open Graph tags (og:title, og:description, og:image, og:url), Twitter/X card metadata, share-title entity parity, and brand favicons for rich link previews.
---

# social-metadata — Open Graph, Social Cards & Brand Preview Hygiene

## 1. Description & Activation Criteria

Activate `social-metadata` when the user wants to:

- Fix broken, blank, or mismatched link previews across Slack, Discord, LinkedIn, X/Twitter, iMessage, WhatsApp, Facebook, and AI chat link unfurlers.
- Remediate incomplete Open Graph tags (`O06-og` P2), missing favicons (`O07-favicon` P2), missing Twitter cards (`W01-social` P3), `og:url` canonical mismatches (`W02-og-url` P3), or `og:title` vs `<title>` entity drift (`G04-entity` P3).
- Run a focused social preview audit via `--skills social-metadata` (aliases: `open-graph`, `social-cards`, `og-tags`).

## 2. Inputs & Prerequisites

- **Target**: Live URL or local HTML file/build directory.
- **Automated fixer support (`one-step-seo fix`)**:
  - `og` (`O06-og`), `og-url` (`W02-og-url`), `twitter-card` (`W01-social`), and `favicon` (`O07-favicon`) all have built-in additive dry-run fixers in `lib/fix.mjs`!

## 3. Step-by-Step Workflow

1. **Run a social-metadata audit**:
   - Execute `npx one-step-seo page <url> --skills social-metadata --out ./seo-report`.
2. **Complete Open Graph essentials (`O06-og`, `W02-og-url`)**:
   - `O06-og` (`P2`) requires all three core properties: `og:title`, `og:description`, and an absolute `https://` `og:image` (recommended `1200×630` PNG/JPG/WebP).
   - Ensure `og:url` matches `report.finalUrl` / `report.page.canonical` (`W02-og-url` P3) so share counters and canonical previews never point to staging or `localhost` URLs.
3. **Align share title with document entity (`G04-entity`)**:
   - Verify `og:title` names the same entity/topic as `report.page.title` (`G04-entity` P3) — omitting a `" | Brand"` suffix is fine, completely different clickbait wording is flagged.
4. **Add Twitter/X card & crisp brand icons (`W01-social`, `O07-favicon`)**:
   - Declare `<meta name="twitter:card" content="summary_large_image">` (`W01-social` P3).
   - Declare `<link rel="icon" href="/favicon.ico" sizes="any">` + an SVG `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` (`O07-favicon` P2), which Google Search also displays directly in mobile and desktop SERP snippets.
5. **Preview safe mechanical fixes on local HTML (`fix`)**:
   - Run `npx one-step-seo fix ./dist --only og,og-url,twitter-card,favicon --url <canonical-url> --og-image <https-image-url>` to generate a unified diff before applying.

## 4. Tools & CLI Commands

```bash
# Single-page Open Graph, Twitter Card, and favicon audit
npx one-step-seo page https://example.com/blog/launch --skills social-metadata --out ./seo-report

# Multi-page crawl to catch staging og:url leaks or missing og:image tags
npx one-step-seo audit https://example.com --pages 25 --skills open-graph --out ./seo-report

# Preview additive social card & favicon fixes on local build HTML
npx one-step-seo fix ./dist/index.html --only og,og-url,twitter-card,favicon --url https://example.com/ --og-image https://example.com/og.png
```

## 5. Evidence Requirements

- Quote exact `O06-og` (`title:true/false desc:true/false img:true/false`), `O07-favicon`, `W01-social`, `W02-og-url`, and `G04-entity` `evidence` strings from `report.findings`.
- Report `report.finalUrl`, `report.page.title`, and `report.page.canonical` for `og:url` and `og:title` comparison.

## 6. Expected Outputs

1. **Social Card Readiness Matrix**: Status of `og:title`, `og:description`, `og:image`, `og:url`, `twitter:card`, entity alignment, and favicon.
2. **Copy-Paste `<head>` Block / `fix` Diff**: Verified `<meta property="og:*">`, `<meta name="twitter:*">`, and `<link rel="icon">` tags.

## 7. Limitations & External Data

- **Image binary fetch**: `O06-og` validates presence of `og:image` in HTML; verifying that the `og:image` URL returns HTTP `200`, is under 5 MB, and isn't blocked by `robots.txt` for `Twitterbot`/`facebookexternalhit` requires checking the asset URL directly.
- **Offline support**: 100% supported offline (`--offline`).

## 8. Safety & Approval Rules

- Never invent placeholder `og:image` URLs when running `fix --apply` — always pass a real, publicly reachable `https://` image URL via `--og-image` (otherwise `fix` safely applies partial `og:title`/`og:description` only and notes the missing image).
- Always inspect the `one-step-seo fix` dry-run diff and confirm with the user before passing `--apply`.

## 9. Examples

```bash
# Inspect the social-metadata skill rules
npx one-step-seo skills social-metadata

# Audit offline static pages for missing social cards
npx one-step-seo audit ./dist --pages 15 --skills social-cards --offline --out ./seo-report
```
