# one-step-seo report

- URL: https://example.com/bad/
- Final URL: https://example.com/bad/
- Checked: 2026-10-08T00:00:00.000Z
- Search SEO: **0/100 (F)**
- AI Visibility: **5/100 (F)**
- Counts: P0=0 P1=9 P2=11 P3=2 pass=18

## Executive summary

Below par: Search SEO and AI Visibility are both under 60. Work through the P1 fixes first, this week.

- Search SEO **0/100 (F)** — Crawlability, indexability, titles and links — what decides Google rankings.
- AI Visibility **5/100 (F)** — Answer-first structure, extractable facts and AI-crawler access — what decides AI answers.

## Fix this first
1. **[P1] Viewport meta missing/odd** (T11-viewport) — The mobile viewport tag is missing, so phones render a shrunken desktop layout. Most search traffic is mobile. (Impact: medium · Effort: minutes · Owner: developer)
2. **[P1] Title too short** (O01-title-short) — The title is too short to describe the page. Short titles waste the most influential on-page ranking slot. (Impact: medium · Effort: minutes · Owner: content)
3. **[P1] Meta description missing** (O02-meta-missing) — There is no meta description, so Google invents the snippet text under your headline — usually badly. Good descriptions lift click-through. (Impact: medium · Effort: minutes · Owner: content)

## Priority actions
### Technical SEO
Check reference: https://github.com/6t9xstar/one-step-seo/blob/main/docs/CHECKS.md
#### [P1] Viewport meta missing/odd (T11-viewport)
- What this means: The mobile viewport tag is missing, so phones render a shrunken desktop layout. Most search traffic is mobile.
- Evidence: (none)
- Fix: Add \<meta name="viewport" content="width=device-width, initial-scale=1"\>.
- Impact: medium · Effort: minutes · Owner: developer
- Copy-paste starting point:
```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```
#### [P2] Canonical missing (T08-canonical)
- What this means: The canonical tag — the page’s way of saying “this is my official URL” — is missing or points somewhere unexpected. Duplicates can then split ranking signal.
- Evidence: No rel=canonical found
- Fix: Add \<link rel=canonical href="..."\> with the absolute preferred URL.
- Impact: medium · Effort: minutes · Owner: developer
- Copy-paste starting point:
```html
<link rel="canonical" href="https://example.com/page/">
```
#### [P2] Missing html lang (T09-lang)
- What this means: The page never declares its language. Screen readers then mispronounce text and search engines can misclassify the audience.
- Evidence: No \<html lang\>
- Fix: Add lang, e.g. \<html lang="en"\>.
- Impact: low · Effort: minutes · Owner: developer
- Copy-paste starting point:
```html
<html lang="en">
```
#### [P2] Charset not UTF-8 (T10-charset)
- What this means: No UTF-8 charset is declared, so special characters (accents, symbols, emoji) can render as mojibake.
- Evidence: not-found
- Fix: Declare \<meta charset="utf-8"\> first in \<head\>.
- Impact: low · Effort: minutes · Owner: developer
- Copy-paste starting point:
```html
<meta charset="utf-8">
```
### On-page
Check reference: https://github.com/6t9xstar/one-step-seo/blob/main/docs/CHECKS.md
#### [P1] Title too short (O01-title-short)
- What this means: The title is too short to describe the page. Short titles waste the most influential on-page ranking slot.
- Evidence: "Hi" (2ch)
- Fix: Expand to 30-60 chars: Primary Topic \| Brand.
- Impact: medium · Effort: minutes · Owner: content
- Copy-paste starting point:
```html
<title>Primary Topic — Key Benefit | Brand Name</title>
```
#### [P1] Meta description missing (O02-meta-missing)
- What this means: There is no meta description, so Google invents the snippet text under your headline — usually badly. Good descriptions lift click-through.
- Evidence: (empty)
- Fix: Add a 120-155ch description with benefit + CTA. One per page.
- Impact: medium · Effort: minutes · Owner: content
- Copy-paste starting point:
```html
<meta name="description" content="What this page offers, who it is for, and what to do next (120–155 characters).">
```
#### [P1] Multiple H1s (O03-h1-multi)
- What this means: The page has several H1s, so nothing is clearly the main topic. Keep one H1 and demote the rest to H2.
- Evidence: 2 H1s
- Fix: Keep one H1; demote the rest to H2.
- Impact: medium · Effort: minutes · Owner: content
#### [P1] 2/2 images missing alt (O08-alt)
- What this means: Some images have no alt text, so screen-reader users miss them and image search cannot understand them.
- Evidence: Empty/missing alt attributes
- Fix: Write descriptive alt for informative images; alt="" for decorative.
- Impact: medium · Effort: hours · Owner: content
- Copy-paste starting point:
```html
<img src="/photo.jpg" alt="Describe what the image shows" width="800" height="600" loading="lazy">
```
#### [P1] No internal links detected (O10-internal)
- What this means: The page links to nothing else on the site. Internal links spread ranking signal and guide readers deeper.
- Evidence: 0 internal links
- Fix: Add 3-10 contextual internal links to related pages.
- Impact: medium · Effort: hours · Owner: content
#### [P2] Skipped heading level (O04-headings)
- What this means: Heading levels skip (e.g. H1 straight to H3). Screen readers and AI parsers use heading order as the page outline.
- Evidence: e.g. H1 -\> H3
- Fix: Nest headings sequentially (H1\>H2\>H3).
- Impact: low · Effort: minutes · Owner: developer
#### [P2] Open Graph incomplete (O06-og)
- What this means: Open Graph tags are incomplete, so shares on social and chat apps show a bare link instead of a rich preview card.
- Evidence: title:false desc:false img:false
- Fix: Add og:title, og:description, og:image + twitter:card.
- Impact: low · Effort: minutes · Owner: developer
- Copy-paste starting point:
```html
<meta property="og:title" content="Page title as it should appear when shared">
<meta property="og:description" content="One-sentence summary for link previews.">
<meta property="og:image" content="https://example.com/og-image.png">
<meta property="og:url" content="https://example.com/page/">
<meta name="twitter:card" content="summary_large_image">
```
#### [P2] Favicon not detected (O07-favicon)
- What this means: No favicon was detected. Tabs and bookmarks show a generic icon, which looks unfinished and hurts brand recognition.
- Evidence: No rel=icon link
- Fix: Add \<link rel="icon" href="/favicon.ico"\> + SVG variant.
- Impact: low · Effort: minutes · Owner: developer
- Copy-paste starting point:
```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
```
#### [P2] Images missing dimensions (CLS risk) (O09-img-dims)
- What this means: Most images lack width/height, so the page layout jumps while loading (CLS). Declare dimensions or an aspect ratio.
- Evidence: 2/2 without width+height
- Fix: Add width/height or aspect-ratio to avoid layout shift.
- Impact: low · Effort: hours · Owner: developer
- Copy-paste starting point:
```html
<img src="/photo.jpg" alt="Describe what the image shows" width="800" height="600" loading="lazy">
```
#### [P3] Twitter card missing (W01-social)
- What this means: No Twitter/X card tag. Link previews on X fall back to a plain card without it.
- Evidence: No twitter:card meta
- Fix: Add \<meta name="twitter:card" content="summary\_large\_image"\>.
- Impact: low · Effort: minutes · Owner: developer
- Copy-paste starting point:
```html
<meta name="twitter:card" content="summary_large_image">
```
### Content
Check reference: https://github.com/6t9xstar/one-step-seo/blob/main/docs/CHECKS.md
#### [P1] Thin content (C01-thin)
- What this means: The page has very little text. Thin pages rarely satisfy a query fully and give AI answers nothing to cite.
- Evidence: 6 words
- Fix: Expand to fully answer the query; add examples, steps, data.
- Impact: medium · Effort: days · Owner: content
#### [P1] No answer-first block (C02-answer)
- What this means: The page never answers its own question up front. AI overviews and featured snippets quote pages that lead with a direct 40–60 word answer.
- Evidence: No direct answer in first ~150 words
- Fix: Start with a 40-60 word direct answer, then explanation + evidence.
- Impact: medium · Effort: hours · Owner: content
#### [P2] No tables/lists (harder to cite) (C03-extractable)
- What this means: No tables or lists were found. AI systems lift facts most easily from tables, steps, and bullet lists.
- Evidence: 0 tables/lists
- Fix: Add a comparison table or steps list for key facts.
- Impact: medium · Effort: hours · Owner: content
#### [P2] No FAQ coverage (C04-faq)
- What this means: No FAQ content was detected. A short set of genuine user questions with concise answers feeds both “People also ask” and AI answers.
- Evidence: No questions answered on page
- Fix: Add 3-6 genuine user questions with concise answers where natural.
- Impact: medium · Effort: hours · Owner: content
- Copy-paste starting point:
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "YOUR FIRST REAL USER QUESTION?",
      "acceptedAnswer": { "@type": "Answer", "text": "Your concise, factual answer." }
    }
  ]
}
</script>
<!-- Only mark up questions + answers that are visible on the page. -->
```
### Schema
Check reference: https://github.com/6t9xstar/one-step-seo/blob/main/docs/CHECKS.md
#### [P1] No JSON-LD structured data (S01-none)
- What this means: No structured data was found. Schema markup is how you tell Google — in its own language — what this page is.
- Evidence: 0 schema nodes
- Fix: Add Organization/WebSite + page-type markup (Article/FAQ/Breadcrumb). Only mark up visible content.
- Impact: medium · Effort: hours · Owner: developer
- Copy-paste starting point:
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "YOUR SITE NAME",
  "url": "https://example.com"
}
</script>
```
### AI visibility
Check reference: https://github.com/6t9xstar/one-step-seo/blob/main/docs/CHECKS.md
#### [P2] llms.txt missing (G01-llms)
- What this means: There is no llms.txt file — a small machine-readable summary some AI crawlers look for. It is optional, but cheap to add.
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
- Evidence: tables:0 lists:0 words:6
- Fix: Surface prices/specs/steps/dates in tables or bolded fact lines with sources.
- Impact: medium · Effort: hours · Owner: content
#### [P3] No freshness signals (G06-freshness)
- What this means: No publication or review dates were found. Dated content signals maintenance to both readers and AI systems — show a review date where freshness matters and keep it current.
- Evidence: No publication or review dates found
- Fix: Where content is date-sensitive, show a review date and keep dateModified current.
- Impact: low · Effort: minutes · Owner: content

## Make this page more citable
- [ ] Answer-first opening (direct answer in the first ~150 words)
- [ ] Extractable structures (tables or lists for key facts)
- [ ] FAQ coverage (real questions with concise answers)
- [ ] Facts surfaced for extraction (prices, specs, steps, dates)
- [ ] Structured data present and valid
- [ ] llms.txt present
- [x] AI crawlers allowed

## What passed
- HTTPS enabled (T01-https)
- HTTP 200 OK (T02-status)
- Redirect chain clean (T03-redirects)
- HTML content-type (T04-content-type)
- robots.txt found (T05-robots)
- XML sitemap found (T06-sitemap)
- Indexable (no noindex) (T07-noindex)
- Clean URL shape (T12-url)
- No mixed content (T13-mixed)
- Third-party scripts contained (T14-third-party)
- Subheadings present (O05-h2)
- Anchor text descriptive (O11-generic-anchors)
- AI crawlers not blanket-blocked (G02-ai-blocked)
- Snippet-eligible for AI answers (G09-snippet-controls)
- HTML size reasonable (P01-html-size)
- Image count reasonable (P02-img-count)
- og:url consistent (W02-og-url)
- No hreflang (single-locale ok) (W03-hreflang)

## What to monitor
- [P3] No freshness signals (G06-freshness): Where content is date-sensitive, show a review date and keep dateModified current.
- [P3] Twitter card missing (W01-social): Add \<meta name="twitter:card" content="summary\_large\_image"\>.

---
Generated by one-step-seo v0.5.0. Two scores, never blended.
