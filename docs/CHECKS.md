# Checks

Deterministic, no guessing. Every finding carries evidence + fix.
Thresholds live in `lib/checks.mjs` (`THRESHOLDS`).

## Technical (T00–T30)

| ID                    | Severity   | What                                                                                                                                                                                   |
| --------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T00-truncated         | P2         | HTML over 5 MiB truncated; checks ran on head only                                                                                                                                     |
| T01-https             | P0/pass    | Final URL uses https                                                                                                                                                                   |
| T02-status            | P0/pass    | HTTP 200 (invalid final URL also P0)                                                                                                                                                   |
| T03-redirects         | P1/pass    | Redirect chain ≤1                                                                                                                                                                      |
| T04-content-type      | P2/pass    | Served as text/html                                                                                                                                                                    |
| T05-robots            | P1/pass    | robots.txt found                                                                                                                                                                       |
| T05-robots-disallow   | P1         | robots.txt disallows the audited path — crawl skipped (audit/page refuse unless `--force`)                                                                                             |
| T06-sitemap           | P1/pass    | XML sitemap found (incl. `Sitemap:` URLs from robots.txt)                                                                                                                              |
| T07-noindex           | P0/pass    | No `noindex`/`none` in any meta robots tag nor in an unscoped `X-Robots-Tag` header (crawler-scoped rules: T22)                                                                        |
| T08-canonical         | P1/P2/pass | Canonical self-references, from `<link rel=canonical>` or the HTTP `Link` header (missing = P2)                                                                                        |
| T09-lang              | P2/pass    | `<html lang>` present                                                                                                                                                                  |
| T10-charset           | P2/pass    | UTF-8 declared                                                                                                                                                                         |
| T11-viewport          | P1/pass    | Responsive viewport                                                                                                                                                                    |
| T12-url               | P2/pass    | Short-path query-string URLs flagged; app routes pass                                                                                                                                  |
| T13-mixed             | P1/P2/pass | No http:// subresources on https pages (scripts = P1, images = P2)                                                                                                                     |
| T14-third-party       | P2/pass    | At most 5 third-party script hosts                                                                                                                                                     |
| T15-security-headers  | P3/pass    | CSP + HSTS + X-Content-Type-Options present (skipped when headers unknown)                                                                                                             |
| T16-broken-links      | P1         | `--check-links` only: same-host link target returns 4xx/5xx or fails (capped at 100 checks/run)                                                                                        |
| T17-canonical-http    | P1/pass    | Canonical link specifies insecure http:// on an otherwise secure https:// page                                                                                                         |
| T18-js-rendered       | P1         | Served HTML is an empty client-rendered app shell (< 50 words + empty mount point, or scripts and no headings)                                                                         |
| T19-head-placement    | P1/P2      | Canonical, meta robots or hreflang (P1), title or description (P2) outside `<head>`: after an element that ends the head early (often `<noscript><img>` or `<iframe>`), or in `<body>` |
| T20-duplicate-tags    | P1/P2/P3   | More than one `<title>` (P2), canonical (different URLs P1, identical P3), meta description (P2) or viewport (P3)                                                                      |
| T21-canonical-signals | P1/P2/P3   | HTML and `Link`-header canonicals disagree or carry template junk (P1); `#fragment`, or noindex plus a canonical to another URL (P2); relative URL (P3)                                |
| T22-robots-scoped     | P0/P1      | noindex for Googlebot only (P0) or Bingbot only (P1), by `<meta name>` or a crawler-scoped `X-Robots-Tag`; `unavailable_after` date passed (P1)                                        |
| T23-soft-404          | P1         | 2xx page whose title or first H1 reads as an error ("page not found", "can't be found", a leading "404") with ≤350 words                                                               |
| T24-unresolved-urls   | P1         | Links or the page URL carry `undefined`/`null`/`NaN` as a segment or value, or `[object …]`                                                                                            |
| T25-malformed-hrefs   | P2         | `href` is an e-mail address without `mailto:` or plain text with spaces (never followed by the crawler)                                                                                |
| T26-dev-links         | P1         | Links or subresources on localhost, a private IP, `.local`/`.test`, or a staging label of the site's own domain                                                                        |
| T27-insecure-forms    | P1         | A form on an https:// page submits to an http:// URL                                                                                                                                   |
| T28-internal-search   | P2         | The page is a site-search results URL (`/search`, `?s=`, `?q=` …) without noindex                                                                                                      |
| T29-rel-pagination    | P3         | `rel=next/prev` with no matching `<a href>`, or a page-2+ listing set to noindex                                                                                                       |
| T30-markup            | P2/P3      | No `<!doctype html>` (P3); more than one `<head>` or `<body>` (P2)                                                                                                                     |

Bodies over 5 MiB are truncated for safety and reported as `T00-truncated`
(P2) — checks then cover the head portion only.

T19–T30, `O12`, `O13`, `C06` and `P07` were ported from Open SEO Crawler (MIT,
see `THIRD_PARTY_NOTICES.md`). They report only when something is wrong (no
pass rows) and read only the HTML and headers already fetched. Rules that need
a status code or HTTP headers (T23, P07, the header parts of T21 and T22) are
skipped for local files.

## On-page (O01–O13, W01–W03)

Title 30–60ch, meta 120–155ch, single H1, logical heading order,
H2s on pages >600 words, complete Open Graph, favicon, image alt,
image dimensions (CLS), internal linking (0 = P1, >200 = P2).

Structural: `O04-heading-empty` (P2: heading tags containing no visible text clutter accessibility trees and dilute search relevance).

Polish (P3, never blocks): `W01-social` (twitter:card), `W02-og-url`
(og:url matches canonical), `W03-hreflang` (alternates complete),
`O03-h1-drift` (H1 shares wording with `<title>`, stopwords excluded),
`O11-generic-anchors` (2+ “click here”/“read more” links; exact match only,
descriptive variants pass), `O12-serp-width` (a title within 60 characters
but estimated wider than ~620 px in Arial 20 px, where Google shows ~580 px;
or a description within 155 characters wider than ~990 px at 14 px, ~920 px
shown — an estimate from font metrics), `O13-dead-anchors` (`href="#id"`
jump links with no matching `id` or `name`; router and action hashes such as
`#/route` or `#!x` are ignored).

## Content (C01–C06)

Thin-content (<200 words), answer-first block in first 150 words,
extractable tables/lists, FAQ coverage (FAQPage markup or FAQ copy —
any JSON-LD alone does not count), header cells in comparison tables
(`C05-table-headers`: P3 when tables exist but none use `<th>`),
placeholder copy (`C06-placeholder`: P2 when "lorem ipsum" is in the
visible text).

## Schema (S01–S03)

JSON-LD present + valid JSON, known `@type` spelling, required
fields (Article/NewsArticle/BlogPosting headline, FAQPage mainEntity, BreadcrumbList itemListElement, Product offers/review/aggregateRating, Event startDate, VideoObject thumbnailUrl, Organization name, LocalBusiness name, WebSite name, HowTo name, JobPosting title, Course name, Recipe name, Review itemReviewed, SoftwareApplication name).
Finding IDs use sanitized suffixes (`S02-faqpage`, never raw `S02-FAQPage`).
Only mark up visible content. `S03-faq-parity` (P3) fires when FAQPage markup
and visible FAQ copy disagree in either direction.

## GEO / AI (G01–G11)

`llms.txt` (optional), AI crawlers not blanket-blocked,
facts in extractable structures, share-title/page-title entity consistency
(`G04-entity`: pass when one contains the other, P3 on genuine drift),
`llms.txt` structure (`G05-llms-quality`: pass with headings or links, P3
without — skipped when `llms.txt` is absent since `G01` covers that),
freshness signals (`G06-freshness`: schema dates, `<time>`, or dated update
note), question-shaped H2s (`G07-question-headings`: ≥50% of 3+ H2s, P3),
quantified metrics on substantive pages (`G08-stat-density`: ≥2 metrics
with units at 300+ words, P3), snippet eligibility (`G09-snippet-controls`:
P2 when `nosnippet`/`max-snippet: 0` blocks AI quoting — paywalled content
excepted), author/publisher attribution (`G10-author`: P3 on substantive
300+ word pages lacking `<meta name="author">` or `rel="author"` metadata),
semantic content landmarks (`G11-semantic-content`: P3 on long 600+ word
articles without `<main>` or `<article>` landmarks). All G04+ findings are
GEO-only except `G09`, which deducts like `G03` (see `docs/SCORING.md`).

## Site-level (multi-page runs)

Computed across all audited pages, shown in the terminal, `index.md`,
and the `index.html` dashboard — never in per-page `report.json`:

- Duplicate titles / meta descriptions shared by 2+ pages (P1 attention).
- Possibly orphaned pages: crawled but linked from no crawled page
  (sitemap-only counts; the start page is exempt).

## Performance hints & Core Web Vitals (P01–P05, P07)

- `P01-html-size` (P2): HTML payload >300KB.
- `P02-img-count` (P2): Image count >20.
- `P07-delivery` (P2/P3): HTML over 20 KB sent without gzip or brotli (P2);
  no `ETag` or `Last-Modified` header, so crawlers cannot revalidate cheaply
  (P3). Needs the real response headers: skipped for local files.
- `P03-psi-lab` (P1/P2/pass): Google PageSpeed Insights lab metrics (LCP > 2.5s / CLS > 0.10). Opt-in with `--psi`.
- `P04-psi-field` (P1/P2/pass): Chrome UX Report (CrUX) 75th-percentile real-world field metrics. Opt-in with `--psi`.
- `P05-psi-error` (P3): PageSpeed Insights query rate-limited, timed out, or quota exceeded. Opt-in with `--psi`.

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
  other origins are dropped. If the start URL redirects across hosts (apex
  `<->` www), the first landing host is adopted, then the set locks — further
  redirect landings outside it are skipped, never reported or harvested.
- `robots.txt` is enforced: `audit`/`page` refuse disallowed start URLs
  (writing a `T05-robots-disallow` report instead) and skip disallowed
  discovered links, unless `--force` is given. `schema` warns but proceeds.
- Politeness: `--delay MS` pauses between crawl batches (default 250 ms);
  `--concurrency` caps parallel fetches at 8; every request carries a clear
  `one-step-seo/<version>` User-Agent and a per-request `--timeout`.
- Retries: HTTP 429, 502, 503 and 504 and dropped connections are retried up
  to twice with back-off (1 s, then 2 s), honouring `Retry-After` up to 30 s.
  Firewall block pages (Wordfence, Cloudflare, Sucuri, SiteGround) and CDN
  bot challenges are reported, never retried or bypassed; after 3 blocked
  pages in a row the crawl stops and says why.
- Slow hosts: when a host's smoothed response time stays at 1.5 s or more for
  3 pages, requests are spaced so about 2 are in flight (gap capped at 10 s)
  until it answers in under 1 s again. It never speeds up past `--delay`.
- Crawler traps are skipped, not fetched: feeds, `/wp-json/`, `/wp-admin/`,
  `/cdn-cgi/`, sitemap files, page-builder pagination (`?e-page-…`), cart
  actions (`?add-to-cart`) and repeated path segments (`/team/team/`).
- Links are entity-decoded like a browser does: `?page=2&amp;sort=new` is
  crawled as `?page=2&sort=new`.
- Soft-404 probes: after a multi-page crawl, `audit` requests two URLs that
  cannot exist (`/url-trap-probe-<random>` at the root and inside the first
  section). An HTTP 200 answer is reported as site issue `X22` (whole site) or
  `X23` (one section). The probes follow `robots.txt` and `--delay`;
  `--no-probes` skips them.

## Severity

P0 critical → P1 high → P2 medium → P3 low → pass healthy.
Fix in that order.

Evidence example: `T08-canonical` → `canonical: https://a.com/x vs URL:
https://a.com/y`; fix: `Point canonical at the preferred URL (usually self).`
