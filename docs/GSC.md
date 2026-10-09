# Google Search Console crosswalk

Each Search Console “Pages” (indexing) state, mapped to the `one-step-seo`
finding that catches it and what to do. GSC describes _Google's view_ of
your site; this tool checks the _controllable causes_ on your pages.

| GSC state                                   | Our finding(s)                         | Action                                                                                                                                                                                  |
| ------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not found (404)                             | `T02-status` (P0)                      | Fix the inlink, or return 410 / redirect where equity or intent matches; otherwise leave the 404 alone.                                                                                 |
| Duplicate without user-selected canonical   | `T08-canonical` (P1)                   | Align canonical signals: HTML canonical + redirect target + sitemap URL + internal hrefs → one URL.                                                                                     |
| Duplicate, Google chose different canonical | `T08-canonical` (P1)                   | Same as above, then differentiate the pages or consolidate them.                                                                                                                        |
| Crawled – currently not indexed             | (no direct finding)                    | Not an error per se: strengthen internal links, sitemap inclusion, unique value, freshness; request indexing sparingly after fixing. Check `O10-internal`, `C01-thin`, `G06-freshness`. |
| Discovered – currently not indexed          | (no direct finding)                    | Same as above — discovery without crawl usually means weak internal-link priority for the URL.                                                                                          |
| Alternative page with proper canonical tag  | —                                      | Informational: confirm the canonical choice is intended.                                                                                                                                |
| Page with redirect                          | `T03-redirects` (P1)                   | Informational if intended; collapse chains to ≤1 hop.                                                                                                                                   |
| Redirect error                              | `T02-status` / `T03-redirects` (P0/P1) | P0: fix the chain, loops, and bad targets immediately.                                                                                                                                  |
| Blocked by robots.txt                       | `T05-robots-disallow` (P1)             | Verify the block is intentional; remove it for Tier-1/2 pages indexed by accident.                                                                                                      |
| Blocked due to access forbidden (403)       | `T02-status` (P0)                      | Allowlist legitimate crawlers; fix permissions.                                                                                                                                         |
| Excluded by ‘noindex’ tag                   | `T07-noindex` (P0)                     | Remove the tag (meta or `X-Robots-Tag` header — the report evidence says which) if the page should rank.                                                                                |
| Soft 404                                    | `T02-status` (P0) + `C01-thin` (P1)    | Return a real 404/410 for dead pages, or give the page substantive unique content.                                                                                                      |

## AI Overviews / AI Mode eligibility (2026)

Google's documented gate for AI-feature citations is narrower than general
indexing: the page must be **indexed _and_ snippet-eligible**. Concretely:

- `nosnippet` / `max-snippet: 0` (meta or `X-Robots-Tag`) silently excludes
  a page from AI Overviews — caught here as `G09-snippet-controls` (P2).
  Keep these controls only for content that must stay out of snippets
  (paywalled, licensed).
- Citations come via **Googlebot from the standard Search index** — not via
  `Google-Extended` (a training opt-out token with no crawler behind it).
  Blocking `Google-Extended` does not remove pages from AI Overviews;
  blocking Googlebot removes them from Google entirely.
- Google states no special markup, chunking, or AI files are required.
  `llms.txt` helps ChatGPT / Perplexity / Claude measurably; it has no
  measured effect on Google AI Overviews, which follow the sitemap instead.
- New since August 2026: the Search Console **generative-AI control**
  (Settings; include-by-default) and the **Generative AI performance
  report** (impressions by page/country/device/date). Confirm “include”
  is selected for properties you want cited.

Notes:

- “Crawled/discovered – currently not indexed” have no single catching
  finding because they are crawl-priority outcomes, not page defects — the
  listed checks are the levers that move them.
- Re-verify in Search Console (URL Inspection → Test live URL → Request
  indexing) only _after_ fixing, and sparingly.
- Our scores are readiness signals, not Google scores — a clean report
  means “nothing controllable is blocking you”, never “you will rank”.
