# one-step-seo report

- URL: https://example.com/good/
- Final URL: https://example.com/good/
- Checked: 2026-10-08T00:00:00.000Z
- Search SEO: **86/100 (B)**
- AI Visibility: **80/100 (B)**
- Counts: P0=0 P1=1 P2=2 P3=3 pass=39

## Executive summary

Solid foundation with 1 high-priority fix to work through this week.

- Search SEO **86/100 (B)** — Crawlability, indexability, titles and links — what decides Google rankings.
- AI Visibility **80/100 (B)** — Answer-first structure, extractable facts and AI-crawler access — what decides AI answers.

## Fix this first
1. **[P1] Thin content** (C01-thin) — The page has very little text. Thin pages rarely satisfy a query fully and give AI answers nothing to cite. (Impact: medium · Effort: days · Owner: content)
2. **[P2] llms.txt missing** (G01-llms) — There is no llms.txt file — a small machine-readable summary that ChatGPT, Perplexity, and Claude measurably use (it has no measured effect on Google AI Overviews). It is optional, but cheap to add. (Impact: medium · Effort: minutes · Owner: developer)
3. **[P2] Facts hard to extract** (G03-facts) — Key facts (prices, specs, steps, dates) are buried in prose instead of tables or highlighted fact lines, so AI systems struggle to extract and cite them. (Impact: medium · Effort: hours · Owner: content)

## Priority actions
### Content
Check reference: https://github.com/6t9xstar/one-step-seo/blob/main/docs/CHECKS.md
#### [P1] Thin content (C01-thin)
- What this means: The page has very little text. Thin pages rarely satisfy a query fully and give AI answers nothing to cite.
- Evidence: 130 words
- Fix: Expand to fully answer the query; add examples, steps, data.
- Impact: medium · Effort: days · Owner: content
### Schema
Check reference: https://github.com/6t9xstar/one-step-seo/blob/main/docs/CHECKS.md
#### [P3] Visible FAQ without matching markup (S03-faq-parity)
- What this means: The FAQ markup and the visible questions disagree: either the page marks up questions it never shows (a policy risk), or it shows questions without matching markup (missed rich-result eligibility).
- Evidence: FAQ copy found, no FAQPage block
- Fix: Add a matching FAQPage block (one-step-seo schema \<url\> --generate faq prints a starter) for rich-result eligibility.
- Impact: low · Effort: minutes · Owner: developer
### AI visibility
Check reference: https://github.com/6t9xstar/one-step-seo/blob/main/docs/CHECKS.md
#### [P2] llms.txt missing (G01-llms)
- What this means: There is no llms.txt file — a small machine-readable summary that ChatGPT, Perplexity, and Claude measurably use (it has no measured effect on Google AI Overviews). It is optional, but cheap to add.
- Evidence: GET /llms.txt not found
- Fix: Optional: add /llms.txt summarizing key pages for AI crawlers.
- Impact: medium · Effort: minutes · Owner: developer
- Copy-paste starting point:
```html
# Your Site Name

> One-paragraph summary of what this site offers and who it is for.

## Key pages

- [Pricing](https://example.com/page/pricing)
- [Docs](https://example.com/page/docs)

## Optional

- Replace the links above with your most-cited pages.
```
#### [P2] Facts hard to extract (G03-facts)
- What this means: Key facts (prices, specs, steps, dates) are buried in prose instead of tables or highlighted fact lines, so AI systems struggle to extract and cite them.
- Evidence: tables:1 lists:1 words:130
- Fix: Surface prices/specs/steps/dates in tables or bolded fact lines with sources.
- Impact: medium · Effort: hours · Owner: content
#### [P3] No freshness signals (G06-freshness)
- What this means: No publication or review dates were found. Dated content signals maintenance to both readers and AI systems — show a review date where freshness matters and keep it current.
- Evidence: No publication or review dates found
- Fix: Where content is date-sensitive, show a review date and keep dateModified current.
- Impact: low · Effort: minutes · Owner: content
#### [P3] Few question-shaped headings (G07-question-headings)
- What this means: Few section headings are phrased as questions. Headings that mirror how people actually ask make sections directly quotable by AI answers.
- Evidence: 0/3 H2s are questions
- Fix: Phrase section headings as the questions readers actually ask — it mirrors AI-answer structure.
- Impact: low · Effort: hours · Owner: content

## Make this page more citable
- [x] Answer-first opening (direct answer in the first ~150 words)
- [x] Extractable structures (tables or lists for key facts)
- [x] FAQ coverage (real questions with concise answers)
- [ ] Facts surfaced for extraction (prices, specs, steps, dates)
- [x] Structured data present and valid
- [ ] llms.txt present
- [x] AI crawlers allowed
- [x] Consistent titles (share title matches page title)

## What passed
- HTTPS enabled (T01-https)
- HTTP 200 OK (T02-status)
- Redirect chain clean (T03-redirects)
- HTML content-type (T04-content-type)
- robots.txt found (T05-robots)
- XML sitemap found (T06-sitemap)
- Indexable (no noindex) (T07-noindex)
- Canonical self-references (T08-canonical)
- HTML lang="en" (T09-lang)
- UTF-8 charset declared (T10-charset)
- Responsive viewport set (T11-viewport)
- Clean URL shape (T12-url)
- No mixed content (T13-mixed)
- Third-party scripts contained (T14-third-party)
- Title length healthy (O01-title)
- Meta description healthy (O02-meta)
- Single H1 (O03-h1)
- H1 matches title intent (O03-h1-drift)
- Heading order logical (O04-headings)
- Subheadings present (O05-h2)
- Open Graph complete (O06-og)
- Favicon present (O07-favicon)
- All images have alt (O08-alt)
- Image dimensions OK (O09-img-dims)
- Internal linking present (O10-internal)
- Anchor text descriptive (O11-generic-anchors)
- Answer-first opening detected (C02-answer)
- Extractable structures present (C03-extractable)
- FAQ signals present (C04-faq)
- Tables use header cells (C05-table-headers)
- Structured data present (1 node(s)) (S01-present)
- AI crawlers not blanket-blocked (G02-ai-blocked)
- Snippet-eligible for AI answers (G09-snippet-controls)
- Titles name the same entity (G04-entity)
- HTML size reasonable (P01-html-size)
- Image count reasonable (P02-img-count)
- Twitter card present (W01-social)
- og:url consistent (W02-og-url)
- No hreflang (single-locale ok) (W03-hreflang)

## What to monitor
- [P3] Visible FAQ without matching markup (S03-faq-parity): Add a matching FAQPage block (one-step-seo schema \<url\> --generate faq prints a starter) for rich-result eligibility.
- [P3] No freshness signals (G06-freshness): Where content is date-sensitive, show a review date and keep dateModified current.
- [P3] Few question-shaped headings (G07-question-headings): Phrase section headings as the questions readers actually ask — it mirrors AI-answer structure.

---
Generated by one-step-seo v0.6.0. Two scores, never blended.
