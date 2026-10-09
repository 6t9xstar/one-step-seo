/**
 * one-step-seo — plain-language finding metadata.
 * Maps every finding ID to a beginner-friendly explanation plus triage
 * labels (impact / effort / owner) and, where safe, a copy-paste snippet.
 * Snippets are static templates with YOUR-/example placeholders — they never
 * contain page-specific data, so they are safe to print raw in reports.
 * Keep in sync with lib/checks.mjs (IDs) and docs/CHECKS.md.
 */

/**
 * @typedef {{ plain: string, impact: "low" | "medium" | "high", effort: "minutes" | "hours" | "days", owner: "developer" | "content" | "SEO" | "agency", snippet: string }} FindingMeta
 */

/** Generic, clearly-marked placeholders used inside snippets. */
const EX = "https://example.com/page/";

const SNIPPETS = {
  title: `<title>Primary Topic — Key Benefit | Brand Name</title>`,
  meta: `<meta name="description" content="What this page offers, who it is for, and what to do next (120–155 characters).">`,
  canonical: `<link rel="canonical" href="${EX}">`,
  lang: `<html lang="en">`,
  charset: `<meta charset="utf-8">`,
  viewport: `<meta name="viewport" content="width=device-width, initial-scale=1">`,
  favicon: `<link rel="icon" href="/favicon.ico" sizes="any">\n<link rel="icon" href="/favicon.svg" type="image/svg+xml">`,
  og: `<meta property="og:title" content="Page title as it should appear when shared">\n<meta property="og:description" content="One-sentence summary for link previews.">\n<meta property="og:image" content="https://example.com/og-image.png">\n<meta property="og:url" content="${EX}">\n<meta name="twitter:card" content="summary_large_image">`,
  ogUrl: `<meta property="og:url" content="${EX}">`,
  twitter: `<meta name="twitter:card" content="summary_large_image">`,
  img: `<img src="/photo.jpg" alt="Describe what the image shows" width="800" height="600" loading="lazy">`,
  robots: `User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml`,
  robotsAi: `# Let AI assistants read and cite your public content (optional)\nUser-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /`,
  llms: `# Your Site Name\n\n> One-paragraph summary of what this site offers and who it is for.\n\n## Key pages\n\n- [Pricing](${EX}pricing)\n- [Docs](${EX}docs)\n\n## Optional\n\n- Replace the links above with your most-cited pages.`,
  websiteSchema: `<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "WebSite",\n  "name": "YOUR SITE NAME",\n  "url": "https://example.com"\n}\n</script>`,
  faqSchema: `<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "FAQPage",\n  "mainEntity": [\n    {\n      "@type": "Question",\n      "name": "YOUR FIRST REAL USER QUESTION?",\n      "acceptedAnswer": { "@type": "Answer", "text": "Your concise, factual answer." }\n    }\n  ]\n}\n</script>\n<!-- Only mark up questions + answers that are visible on the page. -->`,
};

/**
 * Failure-variant findings only — passed checks need no explanation.
 * @type {Record<string, FindingMeta>}
 */
export const FINDING_META = {
  "T00-truncated": {
    plain:
      "This page is over 5 MB, so only its first part was checked. Anything below the cut — content, links, schema — went unaudited.",
    impact: "low",
    effort: "hours",
    owner: "developer",
    snippet: "",
  },
  "T01-https": {
    plain:
      "The page loads over plain HTTP. Browsers flag it “not secure”, visitors bounce, and Google prefers HTTPS pages.",
    impact: "high",
    effort: "hours",
    owner: "developer",
    snippet: "",
  },
  "T02-status": {
    plain:
      "The URL did not return a normal “200 OK” response. Search engines and AI crawlers can only use pages that load successfully.",
    impact: "high",
    effort: "hours",
    owner: "developer",
    snippet: "",
  },
  "T03-redirects": {
    plain:
      "Visitors and crawlers bounce through several redirects before landing. Each hop costs speed and leaks ranking signal.",
    impact: "medium",
    effort: "minutes",
    owner: "developer",
    snippet: "",
  },
  "T04-content-type": {
    plain:
      "The server does not label this page as HTML. Browsers may misrender it and crawlers may refuse to index it.",
    impact: "low",
    effort: "minutes",
    owner: "developer",
    snippet: "",
  },
  "T05-robots": {
    plain:
      "There is no robots.txt file. Crawlers then guess which URLs matter and never learn where your sitemap lives.",
    impact: "medium",
    effort: "minutes",
    owner: "developer",
    snippet: SNIPPETS.robots,
  },
  "T05-robots-disallow": {
    plain:
      "robots.txt tells crawlers not to visit this page, so the audit stopped here. If the block is intentional, nothing to do; if not, open the path before expecting traffic.",
    impact: "medium",
    effort: "minutes",
    owner: "SEO",
    snippet: "",
  },
  "T06-sitemap": {
    plain:
      "No XML sitemap was found. Search engines then discover new and updated pages slowly, especially on larger sites.",
    impact: "medium",
    effort: "hours",
    owner: "SEO",
    snippet: "",
  },
  "T07-noindex": {
    plain:
      "This page carries a “noindex” instruction, which tells Google to drop it from search results entirely.",
    impact: "high",
    effort: "minutes",
    owner: "SEO",
    snippet: "",
  },
  "T08-canonical": {
    plain:
      "The canonical tag — the page’s way of saying “this is my official URL” — is missing or points somewhere unexpected. Duplicates can then split ranking signal.",
    impact: "medium",
    effort: "minutes",
    owner: "developer",
    snippet: SNIPPETS.canonical,
  },
  "T09-lang": {
    plain:
      "The page never declares its language. Screen readers then mispronounce text and search engines can misclassify the audience.",
    impact: "low",
    effort: "minutes",
    owner: "developer",
    snippet: SNIPPETS.lang,
  },
  "T10-charset": {
    plain:
      "No UTF-8 charset is declared, so special characters (accents, symbols, emoji) can render as mojibake.",
    impact: "low",
    effort: "minutes",
    owner: "developer",
    snippet: SNIPPETS.charset,
  },
  "T11-viewport": {
    plain:
      "The mobile viewport tag is missing, so phones render a shrunken desktop layout. Most search traffic is mobile.",
    impact: "medium",
    effort: "minutes",
    owner: "developer",
    snippet: SNIPPETS.viewport,
  },
  "T12-url": {
    plain:
      "This URL carries query parameters on a short path, which looks like tracking or session state. Clean URLs are easier to link, share, and index.",
    impact: "low",
    effort: "hours",
    owner: "developer",
    snippet: "",
  },
  "O01-title-missing": {
    plain:
      "There is no title tag. The title is the clickable headline in Google results — without it the page barely exists in search.",
    impact: "high",
    effort: "minutes",
    owner: "content",
    snippet: SNIPPETS.title,
  },
  "O01-title-short": {
    plain:
      "The title is too short to describe the page. Short titles waste the most influential on-page ranking slot.",
    impact: "medium",
    effort: "minutes",
    owner: "content",
    snippet: SNIPPETS.title,
  },
  "O01-title-long": {
    plain:
      "The title is long enough that Google will cut it off with “…”. Key terms at the end may never be seen.",
    impact: "low",
    effort: "minutes",
    owner: "content",
    snippet: "",
  },
  "O02-meta-missing": {
    plain:
      "There is no meta description, so Google invents the snippet text under your headline — usually badly. Good descriptions lift click-through.",
    impact: "medium",
    effort: "minutes",
    owner: "content",
    snippet: SNIPPETS.meta,
  },
  "O02-meta-short": {
    plain: "The meta description is too short to sell the click. Aim for a full one-to-two-sentence pitch.",
    impact: "low",
    effort: "minutes",
    owner: "content",
    snippet: SNIPPETS.meta,
  },
  "O02-meta-long": {
    plain: "The meta description will be truncated in results. Trim it so the call to action survives.",
    impact: "low",
    effort: "minutes",
    owner: "content",
    snippet: "",
  },
  "O03-h1-missing": {
    plain:
      "There is no H1 heading. The H1 tells readers and search engines what this page is about at a glance.",
    impact: "medium",
    effort: "minutes",
    owner: "content",
    snippet: "",
  },
  "O03-h1-multi": {
    plain:
      "The page has several H1s, so nothing is clearly the main topic. Keep one H1 and demote the rest to H2.",
    impact: "medium",
    effort: "minutes",
    owner: "content",
    snippet: "",
  },
  "O04-headings": {
    plain:
      "Heading levels skip (e.g. H1 straight to H3). Screen readers and AI parsers use heading order as the page outline.",
    impact: "low",
    effort: "minutes",
    owner: "developer",
    snippet: "",
  },
  "O05-h2": {
    plain:
      "A long page with no subheadings is a wall of text. H2s let readers scan and let search engines find sections.",
    impact: "low",
    effort: "hours",
    owner: "content",
    snippet: "",
  },
  "O06-og": {
    plain:
      "Open Graph tags are incomplete, so shares on social and chat apps show a bare link instead of a rich preview card.",
    impact: "low",
    effort: "minutes",
    owner: "developer",
    snippet: SNIPPETS.og,
  },
  "O07-favicon": {
    plain:
      "No favicon was detected. Tabs and bookmarks show a generic icon, which looks unfinished and hurts brand recognition.",
    impact: "low",
    effort: "minutes",
    owner: "developer",
    snippet: SNIPPETS.favicon,
  },
  "O08-alt": {
    plain:
      "Some images have no alt text, so screen-reader users miss them and image search cannot understand them.",
    impact: "medium",
    effort: "hours",
    owner: "content",
    snippet: SNIPPETS.img,
  },
  "O09-img-dims": {
    plain:
      "Most images lack width/height, so the page layout jumps while loading (CLS). Declare dimensions or an aspect ratio.",
    impact: "low",
    effort: "hours",
    owner: "developer",
    snippet: SNIPPETS.img,
  },
  "O10-internal": {
    plain:
      "The page links to nothing else on the site. Internal links spread ranking signal and guide readers deeper.",
    impact: "medium",
    effort: "hours",
    owner: "content",
    snippet: "",
  },
  "O10-internal-many": {
    plain:
      "The page carries an unusually high number of internal links — usually boilerplate. Trim to contextual links that help readers.",
    impact: "low",
    effort: "hours",
    owner: "content",
    snippet: "",
  },
  "C01-thin": {
    plain:
      "The page has very little text. Thin pages rarely satisfy a query fully and give AI answers nothing to cite.",
    impact: "medium",
    effort: "days",
    owner: "content",
    snippet: "",
  },
  "C02-answer": {
    plain:
      "The page never answers its own question up front. AI overviews and featured snippets quote pages that lead with a direct 40–60 word answer.",
    impact: "medium",
    effort: "hours",
    owner: "content",
    snippet: "",
  },
  "C03-extractable": {
    plain:
      "No tables or lists were found. AI systems lift facts most easily from tables, steps, and bullet lists.",
    impact: "medium",
    effort: "hours",
    owner: "content",
    snippet: "",
  },
  "C04-faq": {
    plain:
      "No FAQ content was detected. A short set of genuine user questions with concise answers feeds both “People also ask” and AI answers.",
    impact: "medium",
    effort: "hours",
    owner: "content",
    snippet: SNIPPETS.faqSchema,
  },
  "S01-json-invalid": {
    plain:
      "A JSON-LD block has a syntax error, so search engines ignore all of it. Fix the JSON and every node inside works again.",
    impact: "medium",
    effort: "minutes",
    owner: "developer",
    snippet: "",
  },
  "S01-none": {
    plain:
      "No structured data was found. Schema markup is how you tell Google — in its own language — what this page is.",
    impact: "medium",
    effort: "hours",
    owner: "developer",
    snippet: SNIPPETS.websiteSchema,
  },
  "S02-": {
    plain:
      "A schema node has a structural problem (unknown type or missing required field). Correct it per Schema.org docs and re-validate.",
    impact: "low",
    effort: "minutes",
    owner: "developer",
    snippet: "",
  },
  "G01-llms": {
    plain:
      "There is no llms.txt file — a small machine-readable summary some AI crawlers look for. It is optional, but cheap to add.",
    impact: "medium",
    effort: "minutes",
    owner: "developer",
    snippet: SNIPPETS.llms,
  },
  "G02-ai-blocked": {
    plain:
      "robots.txt blocks known AI crawlers from this site. If being quoted by AI answers matters, allow them selectively instead.",
    impact: "medium",
    effort: "minutes",
    owner: "SEO",
    snippet: SNIPPETS.robotsAi,
  },
  "G03-facts": {
    plain:
      "Key facts (prices, specs, steps, dates) are buried in prose instead of tables or highlighted fact lines, so AI systems struggle to extract and cite them.",
    impact: "medium",
    effort: "hours",
    owner: "content",
    snippet: "",
  },
  "G04-entity": {
    plain:
      "The share title (og:title) and the page title say different things. Consistent naming helps AI systems attribute facts to the right brand and page.",
    impact: "low",
    effort: "minutes",
    owner: "content",
    snippet: SNIPPETS.ogUrl,
  },
  "G05-llms-quality": {
    plain:
      "llms.txt exists but has no headings or links, so AI parsers cannot navigate it. A little markdown structure goes a long way.",
    impact: "low",
    effort: "minutes",
    owner: "content",
    snippet: SNIPPETS.llms,
  },
  "P01-html-size": {
    plain:
      "The HTML payload is large, which slows first paint — especially on mobile. Slim inline code, paginate, or code-split.",
    impact: "low",
    effort: "hours",
    owner: "developer",
    snippet: "",
  },
  "P02-img-count": {
    plain:
      "The page loads many images. Lazy-load below-fold images and prefer modern formats (AVIF/WebP) with responsive sizes.",
    impact: "low",
    effort: "hours",
    owner: "developer",
    snippet: "",
  },
  "W01-social": {
    plain: "No Twitter/X card tag. Link previews on X fall back to a plain card without it.",
    impact: "low",
    effort: "minutes",
    owner: "developer",
    snippet: SNIPPETS.twitter,
  },
  "W02-og-url": {
    plain:
      "og:url disagrees with the page URL, so shares can attribute engagement to the wrong address. Point it at the canonical URL.",
    impact: "low",
    effort: "minutes",
    owner: "developer",
    snippet: SNIPPETS.ogUrl,
  },
  "W03-hreflang": {
    plain:
      "Some hreflang alternates are missing a language or URL, so they cannot do their job of routing international visitors.",
    impact: "low",
    effort: "hours",
    owner: "SEO",
    snippet: "",
  },
};

/** Fallback for IDs the map does not know (e.g. future checks). @type {FindingMeta} */
const GENERIC_FALLBACK = {
  plain: "See the evidence and suggested fix above, and the linked check reference for background.",
  impact: "low",
  effort: "hours",
  owner: "SEO",
  snippet: "",
};

/**
 * Metadata for a finding ID. `S02-*` schema issues share one entry (their
 * suffix varies per schema type); anything unknown gets a generic fallback
 * so reports never render an empty explanation.
 * @param {string} id
 * @returns {FindingMeta}
 */
export function getFindingMeta(id) {
  const key = String(id || "");
  const exact = FINDING_META[key];
  if (exact) return exact;
  if (key.startsWith("S02-")) return FINDING_META["S02-"] ?? GENERIC_FALLBACK;
  return GENERIC_FALLBACK;
}
