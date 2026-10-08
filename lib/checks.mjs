/**
 * one-step-seo — deterministic check suite (v0.2).
 * Each check returns a finding. severity "pass" means healthy.
 * Finding: { id, category, severity, title, evidence, fix, seoImpact, geoImpact }
 */

import { canonicalizeUrl } from "./args.mjs";
import { isSitemapIndex } from "./robots.mjs";

/** Shared thresholds — keep in sync with docs/CHECKS.md and lib/score.mjs. */
export const THRESHOLDS = {
  titleMin: 30,
  titleMax: 60,
  metaMin: 120,
  metaMax: 155,
  thinWords: 200,
  longWords: 3000,
  h2LongWords: 600,
  geoSubstantiveWords: 300,
  htmlBytesMax: 300_000,
  imgCountMax: 20,
  internalLinksMax: 200,
};

/**
 * Sanitize a schema type string into a stable finding-id suffix.
 * "FAQPage" -> "faqpage", "Article+BlogPosting" -> "article-blogposting".
 * @param {string} rawType
 * @returns {string}
 */
export function sanitizeSchemaType(rawType) {
  return String(rawType || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * @param {string} id
 * @param {string} category
 * @param {string} severity
 * @param {string} title
 * @param {string} evidence
 * @param {string} fix
 * @param {string} [seoImpact]
 * @param {string} [geoImpact]
 */
function F(id, category, severity, title, evidence, fix, seoImpact = "-", geoImpact = "-") {
  return { id, category, severity, title, evidence, fix, seoImpact, geoImpact };
}

/**
 * Compare two URLs the way a crawler would: ignore case in the host, tracking
 * params, fragments and a trailing slash. A raw `===` on the two strings flags
 * `https://a.com/x` vs `https://a.com/x/` (or `?utm_source=…`) as a P1
 * "canonical points elsewhere" false positive, so normalize both sides first.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameUrl(a, b) {
  if (!a || !b) return false;
  return (canonicalizeUrl(a) || a) === (canonicalizeUrl(b) || b);
}

/**
 * @param {any} parsed
 * @param {any} siteFiles
 * @param {any} fetchInfo
 * @param {{ items: any[], types: string[], issues: { type: string, issue: string }[], errors: string[] }} schemaInfo
 */
export function runChecks(parsed, siteFiles, fetchInfo, schemaInfo) {
  const out = [];
  const safeParsed = parsed && typeof parsed === "object" ? parsed : {};
  const safeFetch = fetchInfo && typeof fetchInfo === "object" ? fetchInfo : {};
  const safeSite = siteFiles && typeof siteFiles === "object" ? siteFiles : {};
  /** @type {URL | null} */
  let url = null;
  try {
    url = new URL(String(safeFetch.finalUrl || ""));
  } catch {
    url = null;
  }
  if (!url) {
    out.push(
      F(
        "T02-status",
        "technical",
        "P0",
        `HTTP status ${safeFetch.status ?? 0}`,
        `invalid final URL: ${String(safeFetch.finalUrl || "(empty)").slice(0, 200)}`,
        "Fix server response so the URL returns 200.",
        "high",
        "-",
      ),
    );
    return out;
  }
  const p = {
    robotsMeta: String(safeParsed.robotsMeta ?? ""),
    viewport: String(safeParsed.viewport ?? ""),
    charset: String(safeParsed.charset ?? ""),
    lang: String(safeParsed.lang ?? ""),
    canonical: String(safeParsed.canonical ?? ""),
    title: String(safeParsed.title ?? ""),
    metaDescription: String(safeParsed.metaDescription ?? ""),
    h1s: Array.isArray(safeParsed.h1s) ? safeParsed.h1s : [],
    h2s: Array.isArray(safeParsed.h2s) ? safeParsed.h2s : [],
    headings: Array.isArray(safeParsed.headings) ? safeParsed.headings : [],
    og: safeParsed.og && typeof safeParsed.og === "object" ? safeParsed.og : {},
    twitter: safeParsed.twitter && typeof safeParsed.twitter === "object" ? safeParsed.twitter : {},
    images: Array.isArray(safeParsed.images) ? safeParsed.images : [],
    hreflangs: Array.isArray(safeParsed.hreflangs) ? safeParsed.hreflangs : [],
    wordCount: Number(safeParsed.wordCount ?? 0),
    tables: Number(safeParsed.tables ?? 0),
    lists: Number(safeParsed.lists ?? 0),
    htmlBytes: Number(safeParsed.htmlBytes ?? 0),
    internalLinkCount: Number(safeParsed.internalLinkCount ?? 0),
    externalLinkCount: Number(safeParsed.externalLinkCount ?? 0),
    headingOrderOk: safeParsed.headingOrderOk !== false,
    faqDetected: !!safeParsed.faqDetected,
    hasAnswerBlock: !!safeParsed.hasAnswerBlock,
    icon: !!safeParsed.icon,
    imagesWithoutAlt: Number(safeParsed.imagesWithoutAlt ?? 0),
    imagesWithoutDimensions: Number(safeParsed.imagesWithoutDimensions ?? 0),
  };
  const robots = safeSite.robots && typeof safeSite.robots === "object" ? safeSite.robots : {};
  const sitemap = safeSite.sitemap && typeof safeSite.sitemap === "object" ? safeSite.sitemap : {};
  const llms = safeSite.llms && typeof safeSite.llms === "object" ? safeSite.llms : {};
  // Normalize locals so the rest of the suite can use the historical names safely.
  parsed = {
    ...safeParsed,
    ...p,
    titleLength: [...p.title].length,
    metaDescriptionLength: [...p.metaDescription].length,
  };
  siteFiles = { origin: safeSite.origin ?? "", robots, sitemap, llms };
  fetchInfo = {
    ...safeFetch,
    finalUrl: url.toString(),
    status: Number(safeFetch.status ?? 0),
    statusChain: Array.isArray(safeFetch.statusChain) ? safeFetch.statusChain : [],
    contentType: String(safeFetch.contentType ?? ""),
    ms: Number(safeFetch.ms ?? 0),
    error: String(safeFetch.error ?? ""),
  };
  schemaInfo =
    schemaInfo && typeof schemaInfo === "object"
      ? {
          items: Array.isArray(schemaInfo.items) ? schemaInfo.items : [],
          types: Array.isArray(schemaInfo.types) ? schemaInfo.types : [],
          issues: Array.isArray(schemaInfo.issues) ? schemaInfo.issues : [],
          errors: Array.isArray(schemaInfo.errors) ? schemaInfo.errors : [],
        }
      : { items: [], types: [], issues: [], errors: [] };

  // ---------- TECHNICAL ----------
  out.push(
    url.protocol === "https:"
      ? F("T01-https", "technical", "pass", "HTTPS enabled", `Final URL uses https`, "")
      : F(
          "T01-https",
          "technical",
          "P0",
          "Not on HTTPS",
          `Final URL: ${fetchInfo.finalUrl}`,
          "Serve the site over HTTPS with a valid certificate.",
          "high",
          "-",
        ),
  );

  out.push(
    fetchInfo.status === 200
      ? F(
          "T02-status",
          "technical",
          "pass",
          "HTTP 200 OK",
          `Status ${fetchInfo.status} in ${fetchInfo.ms}ms`,
          "",
        )
      : F(
          "T02-status",
          "technical",
          "P0",
          `HTTP status ${fetchInfo.status}`,
          (fetchInfo.error || "non-200") +
            ` chain: ${fetchInfo.statusChain.map(/** @param {{ status: number }} c @returns {number} */ (c) => c.status).join("->")}`,
          "Fix server response so the URL returns 200.",
          "high",
          "-",
        ),
  );

  const redirects = fetchInfo.statusChain.length - 1;
  out.push(
    redirects <= 1
      ? F("T03-redirects", "technical", "pass", "Redirect chain clean", `${redirects} redirect(s)`, "")
      : F(
          "T03-redirects",
          "technical",
          "P1",
          "Long redirect chain",
          `${redirects} redirects: ${fetchInfo.statusChain
            .map(/** @param {{ url: string }} c @returns {string} */ (c) => c.url)
            .join(" -> ")
            .slice(0, 300)}`,
          "Reduce to at most 1 redirect; link directly to the final URL.",
          "medium",
          "-",
        ),
  );

  const ctype = (fetchInfo.contentType || "").toLowerCase();
  out.push(
    ctype.includes("text/html")
      ? F("T04-content-type", "technical", "pass", "HTML content-type", ctype, "")
      : F(
          "T04-content-type",
          "technical",
          "P2",
          "Unexpected content-type",
          ctype || "(empty)",
          "Serve pages as text/html with charset utf-8.",
          "low",
          "-",
        ),
  );

  out.push(
    siteFiles.robots.found
      ? F(
          "T05-robots",
          "technical",
          "pass",
          "robots.txt found",
          `Disallows: ${siteFiles.robots.disallowCount}`,
          "",
        )
      : F(
          "T05-robots",
          "technical",
          "P1",
          "robots.txt missing or empty",
          `GET /robots.txt -> ${siteFiles.robots.status}`,
          "Add a robots.txt allowing crawlers and pointing to your sitemap.",
          "medium",
          "medium",
        ),
  );

  // For a <sitemapindex> the count is CHILD SITEMAPS, not page URLs — calling it
  // "~2 URLs" understated large sites by orders of magnitude, since each child
  // can hold tens of thousands of entries. Counting real URLs would require
  // fetching every child, which this sync check cannot do.
  const sitemapCountLabel = isSitemapIndex(siteFiles.sitemap.text)
    ? `~${siteFiles.sitemap.urlCount} child sitemaps`
    : `~${siteFiles.sitemap.urlCount} URLs`;

  out.push(
    siteFiles.sitemap.found
      ? F("T06-sitemap", "technical", "pass", "XML sitemap found", sitemapCountLabel, "")
      : F(
          "T06-sitemap",
          "technical",
          "P1",
          "XML sitemap missing",
          `GET /sitemap.xml -> ${siteFiles.sitemap.status}`,
          "Publish /sitemap.xml and reference it in robots.txt + Search Console.",
          "medium",
          "-",
        ),
  );

  const robotsMeta = (parsed.robotsMeta || "").toLowerCase();
  out.push(
    /noindex/.test(robotsMeta)
      ? F(
          "T07-noindex",
          "technical",
          "P0",
          "Page set to noindex",
          `meta robots: "${parsed.robotsMeta}"`,
          "Remove noindex if this page should rank, or keep it if intentional.",
          "high",
          "-",
        )
      : F(
          "T07-noindex",
          "technical",
          "pass",
          "Indexable (no noindex)",
          `meta robots: "${parsed.robotsMeta || "(none)"}"`,
          "",
        ),
  );

  out.push(
    parsed.canonical
      ? sameUrl(parsed.canonical, fetchInfo.finalUrl)
        ? F("T08-canonical", "technical", "pass", "Canonical self-references", parsed.canonical, "")
        : F(
            "T08-canonical",
            "technical",
            "P1",
            "Canonical points elsewhere",
            `canonical: ${parsed.canonical} vs URL: ${fetchInfo.finalUrl}`,
            "Point canonical at the preferred URL (usually self).",
            "medium",
            "-",
          )
      : F(
          "T08-canonical",
          "technical",
          "P2",
          "Canonical missing",
          "No rel=canonical found",
          'Add <link rel=canonical href="..."> with the absolute preferred URL.',
          "low",
          "-",
        ),
  );

  out.push(
    parsed.lang
      ? F("T09-lang", "technical", "pass", `HTML lang="${parsed.lang}"`, `lang: ${parsed.lang}`, "")
      : F(
          "T09-lang",
          "technical",
          "P2",
          "Missing html lang",
          "No <html lang>",
          'Add lang, e.g. <html lang="en">.',
          "low",
          "low",
        ),
  );

  out.push(
    /utf-8/i.test(parsed.charset)
      ? F("T10-charset", "technical", "pass", "UTF-8 charset declared", parsed.charset, "")
      : F(
          "T10-charset",
          "technical",
          "P2",
          "Charset not UTF-8",
          parsed.charset,
          'Declare <meta charset="utf-8"> first in <head>.',
          "low",
          "-",
        ),
  );

  out.push(
    parsed.viewport.includes("width=device-width")
      ? F("T11-viewport", "technical", "pass", "Responsive viewport set", parsed.viewport.slice(0, 120), "")
      : F(
          "T11-viewport",
          "technical",
          "P1",
          "Viewport meta missing/odd",
          parsed.viewport || "(none)",
          'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
          "medium",
          "-",
        ),
  );

  // T12: flags short-path query-string URLs (e.g. /page?utm=x). Long paths with
  // queries are typically app routes — keep them passing to avoid noise.
  out.push(
    /\?.+=.+/.test(url.search) && url.pathname.length < 60
      ? F(
          "T12-url",
          "technical",
          "P2",
          "Query-string URL",
          url.pathname + url.search,
          "Prefer clean static URLs for indexable pages; keep params for filters only + canonical.",
          "low",
          "-",
        )
      : F("T12-url", "technical", "pass", "Clean URL shape", url.pathname || "/", ""),
  );

  // ---------- ON-PAGE ----------
  out.push(
    !parsed.title
      ? F(
          "O01-title-missing",
          "onpage",
          "P0",
          "Title tag missing",
          "(empty <title>)",
          `Add a unique <title> ${THRESHOLDS.titleMin}-${THRESHOLDS.titleMax} chars with the primary topic.`,
          "high",
          "-",
        )
      : parsed.titleLength < THRESHOLDS.titleMin
        ? F(
            "O01-title-short",
            "onpage",
            "P1",
            "Title too short",
            `"${parsed.title}" (${parsed.titleLength}ch)`,
            `Expand to ${THRESHOLDS.titleMin}-${THRESHOLDS.titleMax} chars: Primary Topic | Brand.`,
            "medium",
            "-",
          )
        : parsed.titleLength > THRESHOLDS.titleMax
          ? F(
              "O01-title-long",
              "onpage",
              "P2",
              "Title too long (may truncate)",
              `"${parsed.title.slice(0, 80)}..." (${parsed.titleLength}ch)`,
              "Trim to ~55 chars, keep key terms first.",
              "low",
              "-",
            )
          : F(
              "O01-title",
              "onpage",
              "pass",
              "Title length healthy",
              `"${parsed.title}" (${parsed.titleLength}ch)`,
              "",
            ),
  );

  out.push(
    !parsed.metaDescription
      ? F(
          "O02-meta-missing",
          "onpage",
          "P1",
          "Meta description missing",
          "(empty)",
          `Add a ${THRESHOLDS.metaMin}-${THRESHOLDS.metaMax}ch description with benefit + CTA. One per page.`,
          "medium",
          "low",
        )
      : parsed.metaDescriptionLength < THRESHOLDS.metaMin
        ? F(
            "O02-meta-short",
            "onpage",
            "P2",
            "Meta description short",
            `${parsed.metaDescriptionLength}ch`,
            `Expand to ${THRESHOLDS.metaMin}-${THRESHOLDS.metaMax}ch.`,
            "low",
            "-",
          )
        : parsed.metaDescriptionLength > THRESHOLDS.metaMax
          ? F(
              "O02-meta-long",
              "onpage",
              "P2",
              "Meta description long",
              `${parsed.metaDescriptionLength}ch`,
              "Trim to ~150ch so it is not cut in SERPs.",
              "low",
              "-",
            )
          : F(
              "O02-meta",
              "onpage",
              "pass",
              "Meta description healthy",
              `${parsed.metaDescriptionLength}ch`,
              "",
            ),
  );

  out.push(
    parsed.h1s.length === 1
      ? F("O03-h1", "onpage", "pass", "Single H1", `"${parsed.h1s[0].text.slice(0, 100)}"`, "")
      : parsed.h1s.length === 0
        ? F(
            "O03-h1-missing",
            "onpage",
            "P1",
            "H1 missing",
            "No <h1> found",
            "Add one descriptive H1 matching search intent.",
            "medium",
            "medium",
          )
        : F(
            "O03-h1-multi",
            "onpage",
            "P1",
            "Multiple H1s",
            `${parsed.h1s.length} H1s`,
            "Keep one H1; demote the rest to H2.",
            "medium",
            "-",
          ),
  );

  out.push(
    parsed.headingOrderOk
      ? F("O04-headings", "onpage", "pass", "Heading order logical", `${parsed.headings.length} headings`, "")
      : F(
          "O04-headings",
          "onpage",
          "P2",
          "Skipped heading level",
          "e.g. H1 -> H3",
          "Nest headings sequentially (H1>H2>H3).",
          "low",
          "low",
        ),
  );

  out.push(
    parsed.h2s.length === 0 && parsed.wordCount > THRESHOLDS.h2LongWords
      ? F(
          "O05-h2",
          "onpage",
          "P2",
          "Long page with no H2s",
          `${parsed.wordCount} words, 0 H2`,
          "Split long content with descriptive H2s.",
          "low",
          "medium",
        )
      : F("O05-h2", "onpage", "pass", "Subheadings present", `${parsed.h2s.length} H2(s)`, ""),
  );

  const ogOk = parsed.og.title && parsed.og.description && parsed.og.image;
  out.push(
    ogOk
      ? F("O06-og", "onpage", "pass", "Open Graph complete", "og:title/description/image present", "")
      : F(
          "O06-og",
          "onpage",
          "P2",
          "Open Graph incomplete",
          `title:${!!parsed.og.title} desc:${!!parsed.og.description} img:${!!parsed.og.image}`,
          "Add og:title, og:description, og:image + twitter:card.",
          "low",
          "-",
        ),
  );

  out.push(
    !parsed.icon
      ? F(
          "O07-favicon",
          "onpage",
          "P2",
          "Favicon not detected",
          "No rel=icon link",
          'Add <link rel="icon" href="/favicon.ico"> + SVG variant.',
          "low",
          "-",
        )
      : F("O07-favicon", "onpage", "pass", "Favicon present", "rel=icon found", ""),
  );

  out.push(
    parsed.images.length === 0
      ? F("O08-images-none", "onpage", "pass", "No images (nothing to optimize)", "0 <img>", "")
      : parsed.imagesWithoutAlt === 0
        ? F("O08-alt", "onpage", "pass", "All images have alt", `${parsed.images.length} img`, "")
        : F(
            "O08-alt",
            "onpage",
            "P1",
            `${parsed.imagesWithoutAlt}/${parsed.images.length} images missing alt`,
            "Empty/missing alt attributes",
            'Write descriptive alt for informative images; alt="" for decorative.',
            "medium",
            "medium",
          ),
  );

  out.push(
    parsed.images.length > 0 && parsed.imagesWithoutDimensions > parsed.images.length / 2
      ? F(
          "O09-img-dims",
          "onpage",
          "P2",
          "Images missing dimensions (CLS risk)",
          `${parsed.imagesWithoutDimensions}/${parsed.images.length} without width+height`,
          "Add width/height or aspect-ratio to avoid layout shift.",
          "low",
          "-",
        )
      : F("O09-img-dims", "onpage", "pass", "Image dimensions OK", `${parsed.images.length} img checked`, ""),
  );

  out.push(
    parsed.internalLinkCount === 0
      ? F(
          "O10-internal",
          "onpage",
          "P1",
          "No internal links detected",
          "0 internal links",
          "Add 3-10 contextual internal links to related pages.",
          "medium",
          "-",
        )
      : parsed.internalLinkCount > THRESHOLDS.internalLinksMax
        ? F(
            "O10-internal-many",
            "onpage",
            "P2",
            "Excessive internal links",
            `${parsed.internalLinkCount} links`,
            "Trim boilerplate links; keep contextual ones.",
            "low",
            "-",
          )
        : F(
            "O10-internal",
            "onpage",
            "pass",
            "Internal linking present",
            `${parsed.internalLinkCount} internal links`,
            "",
          ),
  );

  // ---------- CONTENT ----------
  out.push(
    parsed.wordCount < THRESHOLDS.thinWords
      ? F(
          "C01-thin",
          "content",
          "P1",
          "Thin content",
          `${parsed.wordCount} words`,
          "Expand to fully answer the query; add examples, steps, data.",
          "medium",
          "medium",
        )
      : parsed.wordCount > THRESHOLDS.longWords
        ? F(
            "C01-long",
            "content",
            "pass",
            "In-depth content",
            `${parsed.wordCount} words — ensure headings/summary aid scanning`,
            "",
          )
        : F("C01-length", "content", "pass", "Content length healthy", `${parsed.wordCount} words`, ""),
  );

  out.push(
    parsed.hasAnswerBlock
      ? F(
          "C02-answer",
          "content",
          "pass",
          "Answer-first opening detected",
          "Question/direct-answer near top",
          "",
        )
      : F(
          "C02-answer",
          "content",
          "P1",
          "No answer-first block",
          "No direct answer in first ~150 words",
          "Start with a 40-60 word direct answer, then explanation + evidence.",
          "medium",
          "high",
        ),
  );

  out.push(
    parsed.tables > 0 || parsed.lists > 0
      ? F(
          "C03-extractable",
          "content",
          "pass",
          "Extractable structures present",
          `${parsed.tables} tables, ${parsed.lists} lists`,
          "",
        )
      : F(
          "C03-extractable",
          "content",
          "P2",
          "No tables/lists (harder to cite)",
          "0 tables/lists",
          "Add a comparison table or steps list for key facts.",
          "low",
          "medium",
        ),
  );

  out.push(
    parsed.faqDetected
      ? F("C04-faq", "content", "pass", "FAQ signals present", "FAQ text or markup detected", "")
      : F(
          "C04-faq",
          "content",
          "P2",
          "No FAQ coverage",
          "No questions answered on page",
          "Add 3-6 genuine user questions with concise answers where natural.",
          "low",
          "medium",
        ),
  );

  // ---------- SCHEMA ----------
  if (schemaInfo.errors.length > 0) {
    out.push(
      F(
        "S01-json-invalid",
        "schema",
        "P1",
        "Invalid JSON-LD block",
        schemaInfo.errors[0] ?? "",
        "Fix JSON syntax; validate at validator.schema.org.",
        "medium",
        "-",
      ),
    );
  } else if (schemaInfo.items.length === 0) {
    out.push(
      F(
        "S01-none",
        "schema",
        "P1",
        "No JSON-LD structured data",
        "0 schema nodes",
        "Add Organization/WebSite + page-type markup (Article/FAQ/Breadcrumb). Only mark up visible content.",
        "medium",
        "medium",
      ),
    );
  } else {
    out.push(
      F(
        "S01-present",
        "schema",
        "pass",
        `Structured data present (${schemaInfo.items.length} node(s))`,
        `Types: ${schemaInfo.types.join(", ").slice(0, 200)}`,
        "",
      ),
    );
  }
  for (const iss of schemaInfo.issues.slice(0, 5)) {
    const suffix = sanitizeSchemaType(iss.type) || "unknown";
    out.push(
      F(
        `S02-${suffix}`,
        "schema",
        "P2",
        `Schema issue: ${iss.type}`,
        iss.issue,
        "Correct the node per Schema.org docs; re-validate.",
        "low",
        "-",
      ),
    );
  }

  // ---------- GEO / AI ----------
  out.push(
    siteFiles.llms.found
      ? F("G01-llms", "geo", "pass", "llms.txt present", `${siteFiles.llms.bytes} bytes`, "")
      : F(
          "G01-llms",
          "geo",
          "P2",
          "llms.txt missing",
          "GET /llms.txt not found",
          "Optional: add /llms.txt summarizing key pages for AI crawlers.",
          "low",
          "medium",
        ),
  );

  out.push(
    siteFiles.robots.aiBlocked
      ? F(
          "G02-ai-blocked",
          "geo",
          "P1",
          "AI crawlers blocked in robots.txt",
          "Disallow: / for a known AI bot",
          "If AI citation matters, allow GPTBot/ClaudeBot/PerplexityBot selectively.",
          "-",
          "high",
        )
      : F(
          "G02-ai-blocked",
          "geo",
          "pass",
          "AI crawlers not blanket-blocked",
          "No full Disallow for AI bots",
          "",
        ),
  );

  const factsOk = parsed.tables > 0 && parsed.wordCount >= THRESHOLDS.thinWords;
  out.push(
    factsOk
      ? F("G03-facts", "geo", "pass", "Citable facts structure", "Tables/lists + substantive copy", "")
      : F(
          "G03-facts",
          "geo",
          "P2",
          "Facts hard to extract",
          `tables:${parsed.tables} lists:${parsed.lists} words:${parsed.wordCount}`,
          "Surface prices/specs/steps/dates in tables or bolded fact lines with sources.",
          "low",
          "medium",
        ),
  );

  // ---------- PERFORMANCE HINTS (no browser; header/size heuristics) ----------
  out.push(
    parsed.htmlBytes > THRESHOLDS.htmlBytesMax
      ? F(
          "P01-html-size",
          "performance",
          "P2",
          "Large HTML payload",
          `${Math.round(parsed.htmlBytes / 1024)}KB HTML`,
          "Reduce inline CSS/JS, paginate, or code-split. Measure with PageSpeed.",
          "low",
          "-",
        )
      : F(
          "P01-html-size",
          "performance",
          "pass",
          "HTML size reasonable",
          `${Math.round(parsed.htmlBytes / 1024)}KB`,
          "",
        ),
  );

  out.push(
    parsed.images.length > THRESHOLDS.imgCountMax
      ? F(
          "P02-img-count",
          "performance",
          "P2",
          "Many images",
          `${parsed.images.length} <img>`,
          "Lazy-load below-fold (loading=lazy), AVIF/WebP, responsive srcset.",
          "low",
          "-",
        )
      : F(
          "P02-img-count",
          "performance",
          "pass",
          "Image count reasonable",
          `${parsed.images.length} <img>`,
          "",
        ),
  );

  // ---------- POLISH (P3 — never blocks, nice to have) ----------
  const twitterCard = String(parsed.twitter?.card ?? "");
  out.push(
    twitterCard
      ? F("W01-social", "onpage", "pass", "Twitter card present", twitterCard.slice(0, 120), "")
      : F(
          "W01-social",
          "onpage",
          "P3",
          "Twitter card missing",
          "No twitter:card meta",
          'Add <meta name="twitter:card" content="summary_large_image">.',
          "-",
          "-",
        ),
  );

  const ogUrl = String(parsed.og?.url ?? "");
  if (ogUrl && !sameUrl(ogUrl, fetchInfo.finalUrl)) {
    out.push(
      F(
        "W02-og-url",
        "onpage",
        "P3",
        "og:url does not match canonical URL",
        `og:url: ${ogUrl.slice(0, 200)} vs URL: ${fetchInfo.finalUrl.slice(0, 200)}`,
        "Set og:url to the canonical absolute URL of this page.",
        "-",
        "-",
      ),
    );
  } else {
    out.push(F("W02-og-url", "onpage", "pass", "og:url consistent", ogUrl || "(no og:url, ok)", ""));
  }

  if (parsed.hreflangs.length > 0) {
    const badHreflang = parsed.hreflangs.filter(
      /** @param {{ lang?: string, href?: string }} h @returns {boolean} */ (h) => !h.lang || !h.href,
    );
    out.push(
      badHreflang.length === 0
        ? F(
            "W03-hreflang",
            "onpage",
            "pass",
            "hreflang annotations present",
            `${parsed.hreflangs.length} alternate(s)`,
            "",
          )
        : F(
            "W03-hreflang",
            "onpage",
            "P3",
            "hreflang entries incomplete",
            `${badHreflang.length} entries missing lang/href`,
            "Ensure every hreflang alternate has a valid lang and absolute href.",
            "-",
            "-",
          ),
    );
  } else {
    out.push(F("W03-hreflang", "onpage", "pass", "No hreflang (single-locale ok)", "0 alternates", ""));
  }

  return out;
}
