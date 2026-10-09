# Checks

Deterministic, no guessing. Every finding carries evidence + fix.
Thresholds live in `lib/checks.mjs` (`THRESHOLDS`).

## Technical (T00–T12)

| ID                  | Severity   | What                                                                                       |
| ------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| T00-truncated       | P2         | HTML over 5 MiB truncated; checks ran on head only                                         |
| T01-https           | P0/pass    | Final URL uses https                                                                       |
| T02-status          | P0/pass    | HTTP 200 (invalid final URL also P0)                                                       |
| T03-redirects       | P1/pass    | Redirect chain ≤1                                                                          |
| T04-content-type    | P2/pass    | Served as text/html                                                                        |
| T05-robots          | P1/pass    | robots.txt found                                                                           |
| T05-robots-disallow | P1         | robots.txt disallows the audited path — crawl skipped (audit/page refuse unless `--force`) |
| T06-sitemap         | P1/pass    | XML sitemap found (incl. `Sitemap:` URLs from robots.txt)                                  |
| T07-noindex         | P0/pass    | No `noindex` on rankable pages                                                             |
| T08-canonical       | P1/P2/pass | Canonical self-references (missing = P2)                                                   |
| T09-lang            | P2/pass    | `<html lang>` present                                                                      |
| T10-charset         | P2/pass    | UTF-8 declared                                                                             |
| T11-viewport        | P1/pass    | Responsive viewport                                                                        |
| T12-url             | P2/pass    | Short-path query-string URLs flagged; app routes pass                                      |

Bodies over 5 MiB are truncated for safety and reported as `T00-truncated`
(P2) — checks then cover the head portion only.

## On-page (O01–O10, W01–W03)

Title 30–60ch, meta 120–155ch, single H1, logical heading order,
H2s on pages >600 words, complete Open Graph, favicon, image alt,
image dimensions (CLS), internal linking (0 = P1, >200 = P2).

Polish (P3, never blocks): `W01-social` (twitter:card), `W02-og-url`
(og:url matches canonical), `W03-hreflang` (alternates complete).

## Content (C01–C04)

Thin-content (<200 words), answer-first block in first 150 words,
extractable tables/lists, FAQ coverage (FAQPage markup or FAQ copy —
any JSON-LD alone does not count).

## Schema (S01–S02)

JSON-LD present + valid JSON, known `@type` spelling, required
fields (Article headline, FAQ mainEntity, Breadcrumb items, Product
offers/review, Event startDate, VideoObject thumbnailUrl, Organization name).
Finding IDs use sanitized suffixes (`S02-faqpage`, never raw `S02-FAQPage`).
Only mark up visible content.

## GEO / AI (G01–G05)

`llms.txt` (optional), AI crawlers not blanket-blocked,
facts in extractable structures, share-title/page-title entity consistency
(`G04-entity`: pass when one contains the other, P3 on genuine drift),
`llms.txt` structure (`G05-llms-quality`: pass with headings or links, P3
without — skipped when `llms.txt` is absent since `G01` covers that).

## Performance hints (P01–P02)

HTML payload >300KB, image count >20. For lab data use PageSpeed;
this tool flags cheap static signals only.

## Auto-fixable (`one-step-seo fix`)

These findings clear automatically against **local HTML files** — preview with
a dry run, then `--apply` (additive only, `.bak` backups, verified in memory):

| Finding                   | Fixer          | Input needed                                  |
| ------------------------- | -------------- | --------------------------------------------- |
| `T10-charset`             | `charset`      | charset absent (other encodings refused)      |
| `T11-viewport`            | `viewport`     | viewport absent (custom ones untouched)       |
| `T09-lang`                | `lang`         | `--lang`                                      |
| `O01-title-missing`       | `title`        | `--title` or an `<h1>` to derive from         |
| `O02-meta-missing`        | `description`  | `--description` or ≥40ch of page text         |
| `T08-canonical` (missing) | `canonical`    | `--url`                                       |
| `O06-og`                  | `og`           | title/meta present; `--og-image` completes it |
| `W02-og-url`              | `og-url`       | wrong `og:url` + `--url`                      |
| `W01-social`              | `twitter-card` | —                                             |
| `O07-favicon`             | `favicon`      | —                                             |

Never auto-fixed (needs a human): `noindex` removal, alt text, title/meta
length rewrites, image dimensions, server/redirect issues, and all
`robots.txt`/`sitemap.xml`/`llms.txt` file edits.

## Crawler behavior

- Same-host only: link discovery follows same-host URLs; sitemap seeds from
  other origins are dropped.
- `robots.txt` is enforced: `audit`/`page` refuse disallowed start URLs
  (writing a `T05-robots-disallow` report instead) and skip disallowed
  discovered links, unless `--force` is given. `schema` warns but proceeds.
- Politeness: `--delay MS` pauses between crawl batches (default 250 ms);
  `--concurrency` caps parallel fetches at 8; every request carries a clear
  `one-step-seo/<version>` User-Agent and a per-request `--timeout`.

## Severity

P0 critical → P1 high → P2 medium → P3 low → pass healthy.
Fix in that order.

Evidence example: `T08-canonical` → `canonical: https://a.com/x vs URL:
https://a.com/y`; fix: `Point canonical at the preferred URL (usually self).`
