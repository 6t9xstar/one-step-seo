/**
 * one-step-seo — SEO Intelligence engine (pure, zero dependencies).
 *
 * Site-level analysis over the facts gathered by the crawl engine: link graph,
 * crawl depth, orphans, broken and redirected links, duplicate and
 * near-duplicate content, sitemap/indexation conflicts, canonical and hreflang
 * consistency, keyword cannibalization, content opportunities, internal-link
 * suggestions and content briefs.
 *
 * Honesty contract:
 *   - Every issue is derived from pages that were actually fetched. Nothing is
 *     simulated, and coverage limits (page cap) are reported with the result.
 *   - Term data is ON-PAGE frequency. This module never reports search volume,
 *     keyword difficulty, rankings, traffic or backlinks — those require a
 *     third-party data provider and are out of scope for a local crawl.
 *   - Heuristic findings (cannibalization, near-duplicates, link suggestions)
 *     are labelled as heuristics in their description.
 */
import { THRESHOLDS } from "./checks.mjs";
import { SEARCH_WEIGHTS, GEO_ONLY_IDS, scoreBand } from "./score.mjs";
import { jaccard, simhashDistance, stripBrandSuffix } from "./text.mjs";

/** @typedef {import("./crawl.mjs").PageFacts} PageFacts */
/** @typedef {import("./crawl.mjs").CrawlFailure} CrawlFailure */

/**
 * How a site issue may be remediated:
 *   safe     — additive / mechanical, can be applied automatically to local source
 *   approval — changes indexing, URLs or content; needs explicit human approval
 *   manual   — needs information the tool does not have (server config, copy)
 * @typedef {"safe" | "approval" | "manual"} FixType
 */

/**
 * @typedef {object} SiteIssue
 * @property {string} id stable issue id (X##-slug)
 * @property {string} category technical | onpage | content | international
 * @property {string} severity P0 | P1 | P2 | P3
 * @property {string} title
 * @property {string} description what was observed
 * @property {string} impact why it matters for search
 * @property {string} recommendation what to do
 * @property {FixType} fixType
 * @property {boolean} heuristic true when the finding is an inference, not a hard fact
 * @property {number} count affected URLs (may exceed urls.length — urls is capped)
 * @property {{ url: string, detail: string }[]} urls affected URLs with evidence (capped at MAX_ISSUE_URLS)
 */

/** Cap on URLs listed per issue (count keeps the true total). */
export const MAX_ISSUE_URLS = 50;
/** Click depth beyond which a page is reported as buried. */
export const DEEP_PAGE_DEPTH = 3;
/** Response time (ms, measured from the auditing machine) reported as slow. */
export const SLOW_RESPONSE_MS = 2000;
/** SimHash Hamming distance at or below which two pages are near-duplicates. */
export const NEAR_DUPLICATE_DISTANCE = 3;
/** Target-term Jaccard similarity at or above which two pages may cannibalize. */
export const CANNIBALIZATION_SIMILARITY = 0.75;
/** Age (days) after which a declared dateModified is reported as stale. */
export const STALE_CONTENT_DAYS = 548;

/** @type {Record<string, number>} */
const SEV_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

/**
 * @param {string} id @param {string} category @param {string} severity @param {string} title
 * @param {string} description @param {string} impact @param {string} recommendation
 * @param {FixType} fixType @param {{ url: string, detail: string }[]} urls @param {boolean} [heuristic]
 * @returns {SiteIssue}
 */
function issue(
  id,
  category,
  severity,
  title,
  description,
  impact,
  recommendation,
  fixType,
  urls,
  heuristic = false,
) {
  return {
    id,
    category,
    severity,
    title,
    description,
    impact,
    recommendation,
    fixType,
    heuristic,
    count: urls.length,
    urls: urls.slice(0, MAX_ISSUE_URLS),
  };
}

/**
 * Group items by a key, keeping only groups with 2+ members.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} keyOf "" skips the item
 * @returns {T[][]}
 */
function groupsOf(items, keyOf) {
  /** @type {Map<string, T[]>} */
  const map = new Map();
  for (const it of items) {
    const k = keyOf(it);
    if (!k) continue;
    const arr = map.get(k) ?? [];
    arr.push(it);
    map.set(k, arr);
  }
  return [...map.values()].filter((g) => g.length > 1);
}

/**
 * Breadth-first click depth from the start page over the crawled link graph.
 * @param {PageFacts[]} pages
 * @returns {Map<string, number>} key -> depth (unreachable pages are absent)
 */
export function clickDepths(pages) {
  /** @type {Map<string, PageFacts>} */
  const byKey = new Map(pages.map((p) => [p.key, p]));
  /** @type {Map<string, number>} */
  const depth = new Map();
  const start = pages[0];
  if (!start) return depth;
  depth.set(start.key, 0);
  let frontier = [start.key];
  while (frontier.length > 0) {
    /** @type {string[]} */
    const next = [];
    for (const k of frontier) {
      const d = depth.get(k) ?? 0;
      for (const target of byKey.get(k)?.links ?? []) {
        if (!byKey.has(target) || depth.has(target)) continue;
        depth.set(target, d + 1);
        next.push(target);
      }
    }
    frontier = next;
  }
  return depth;
}

/**
 * Per-category sub-scores, using the SAME published deduction weights as the
 * Search score (P0 −25, P1 −10, P2 −3, P3 −1), restricted to one category and
 * averaged across pages. GEO-only findings are scored under `geo`, never
 * under the search categories. These are tool-defined health indicators —
 * not Google metrics.
 * @param {import("./report.mjs").Report[]} pageReports
 * @returns {Record<string, { score: number | null, band: string, pages: number }>}
 */
export function categoryScores(pageReports) {
  const cats = ["technical", "onpage", "content", "schema", "performance", "geo"];
  /** @type {Record<string, { score: number | null, band: string, pages: number }>} */
  const out = {};
  const list = (Array.isArray(pageReports) ? pageReports : []).filter(
    (r) => r && Array.isArray(r.findings) && r.findings.length > 0,
  );
  for (const cat of cats) {
    if (list.length === 0) {
      out[cat] = { score: null, band: "N/A", pages: 0 };
      continue;
    }
    let sum = 0;
    for (const r of list) {
      let s = 100;
      for (const f of r.findings) {
        if (!f || f.severity === "pass" || f.category !== cat) continue;
        if (cat !== "geo" && GEO_ONLY_IDS.has(f.id)) continue;
        s -= /** @type {Record<string, number>} */ (SEARCH_WEIGHTS)[f.severity] ?? 0;
      }
      sum += Math.max(0, s);
    }
    const score = Math.round(sum / list.length);
    out[cat] = { score, band: scoreBand(score), pages: list.length };
  }
  return out;
}

/**
 * BCP-47-ish validation for hreflang values (language[-script][-region] or x-default).
 * @param {string} code
 * @returns {boolean}
 */
export function isValidHreflang(code) {
  const c = String(code || "").trim();
  if (c.toLowerCase() === "x-default") return true;
  return /^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?$/i.test(c);
}

/**
 * @typedef {object} SiteAnalysisInput
 * @property {PageFacts[]} pages
 * @property {CrawlFailure[]} [failures]
 * @property {import("./crawl.mjs").CrawlRedirect[]} [redirects] same-site redirects seen during the crawl
 * @property {string[]} [sitemapUrls]
 * @property {boolean} [capped]
 * @property {import("./report.mjs").Report[]} [pageReports]
 * @property {(u: string) => string} [canon] URL canonicalizer matching the crawl's
 * @property {number} [now] epoch ms (injectable for deterministic tests)
 * @property {import("./crawl.mjs").ProbeResult[]} [probes] soft-404 probe answers (X22/X23)
 */

/**
 * Run the full site-level analysis.
 * @param {SiteAnalysisInput} input
 */
export function analyzeSite(input) {
  const pages = Array.isArray(input.pages) ? input.pages : [];
  const failures = Array.isArray(input.failures) ? input.failures : [];
  const canon = input.canon ?? ((u) => u);
  const now = input.now ?? Date.now();
  /** @param {string} u */
  const keyOf = (u) => canon(u) || u;
  const sitemapKeys = new Set((input.sitemapUrls ?? []).map(keyOf));
  const hasSitemap = sitemapKeys.size > 0;
  /** @type {Map<string, PageFacts>} */
  const byKey = new Map(pages.map((p) => [p.key, p]));
  const indexable = pages.filter((p) => !p.noindex);
  const start = pages[0];

  // ---- link graph ----
  /** @type {Map<string, number>} */
  const inlinks = new Map();
  for (const p of pages) for (const l of p.links) inlinks.set(l, (inlinks.get(l) ?? 0) + 1);
  const depths = clickDepths(pages);

  /** @type {SiteIssue[]} */
  const issues = [];

  // X01 — broken internal links (fetch failures that something links to, or 4xx/5xx/0)
  const broken = failures.filter((f) => f.kind === "fetch");
  const brokenLinked = broken.filter((f) => !sitemapKeys.has(keyOf(f.url)) || f.referrers.length > 0);
  if (brokenLinked.length > 0) {
    issues.push(
      issue(
        "X01-broken-internal-links",
        "technical",
        "P1",
        `${brokenLinked.length} internal URL${brokenLinked.length === 1 ? "" : "s"} failed to load`,
        "These same-site URLs were requested during the crawl and did not return a usable page.",
        "Broken links waste crawl budget, leak link equity and strand users on error pages.",
        "Restore the page, redirect it (301) to the closest equivalent, or update/remove the links that point to it.",
        "manual",
        brokenLinked.map((f) => ({
          url: f.url,
          detail:
            `${f.status ? `HTTP ${f.status}` : f.error || "fetch failed"}` +
            (f.referrers.length > 0 ? ` — linked from ${f.referrers.slice(0, 3).join(", ")}` : ""),
        })),
      ),
    );
  }

  // Every requested URL that redirected: from page facts (the audited copy)
  // plus aliases the crawl dropped because the landing page was already audited.
  /** @type {Map<string, { url: string, finalUrl: string, hops: number, referrers: string[] }>} */
  const redirectMap = new Map();
  for (const p of pages) {
    if (p.redirects >= 1 && keyOf(p.url) !== p.key) {
      redirectMap.set(keyOf(p.url), { url: p.url, finalUrl: p.finalUrl, hops: p.redirects, referrers: [] });
    }
  }
  for (const rd of input.redirects ?? []) {
    const k = keyOf(rd.url);
    const prev = redirectMap.get(k);
    if (prev) prev.referrers = rd.referrers ?? [];
    else
      redirectMap.set(k, {
        url: rd.url,
        finalUrl: rd.finalUrl,
        hops: rd.hops,
        referrers: rd.referrers ?? [],
      });
  }
  const redirectList = [...redirectMap.values()];
  /** @param {string[]} refs */
  const fromText = (refs) => (refs.length > 0 ? ` (linked from ${refs.slice(0, 3).join(", ")})` : "");

  // X02 — redirect chains (2+ hops)
  const chains = redirectList.filter((p) => p.hops >= 2);
  if (chains.length > 0) {
    issues.push(
      issue(
        "X02-redirect-chains",
        "technical",
        "P1",
        `${chains.length} URL${chains.length === 1 ? " resolves" : "s resolve"} through a redirect chain`,
        "The requested URL needed two or more redirects before reaching the final page.",
        "Each hop adds latency and can dilute signals; long chains may stop being followed.",
        "Redirect the first URL directly to the final destination in one 301 hop.",
        "approval",
        chains.map((p) => ({
          url: p.url,
          detail: `${p.hops} redirects -> ${p.finalUrl}${fromText(p.referrers)}`,
        })),
      ),
    );
  }

  // X03 — internal links / sitemap entries pointing at redirecting URLs
  const redirected = redirectList;
  if (redirected.length > 0) {
    issues.push(
      issue(
        "X03-links-to-redirects",
        "technical",
        "P2",
        `${redirected.length} linked URL${redirected.length === 1 ? " redirects" : "s redirect"} to another address`,
        "Internal links or sitemap entries reference a URL that redirects instead of the final URL.",
        "Every internal redirect is an avoidable extra request for users and crawlers.",
        "Update internal links and sitemap entries to the final URL shown for each row.",
        "safe",
        redirected.map((p) => ({ url: p.url, detail: `redirects to ${p.finalUrl}${fromText(p.referrers)}` })),
      ),
    );
  }

  // X04 — orphan pages (indexable, no crawled inlinks, not the start page)
  const orphans = indexable.filter((p) => p !== start && (inlinks.get(p.key) ?? 0) === 0);
  if (orphans.length > 0) {
    issues.push(
      issue(
        "X04-orphan-pages",
        "technical",
        "P2",
        `${orphans.length} page${orphans.length === 1 ? " has" : "s have"} no internal links pointing to ${orphans.length === 1 ? "it" : "them"}`,
        `No crawled page links to these URLs (they were found through the sitemap only).${input.capped ? " The crawl hit its page cap, so links from un-crawled pages are not counted." : ""}`,
        "Pages without internal links are hard to discover and receive no internal link equity.",
        "Link to each page from a relevant hub, category or related article — or remove it from the sitemap if it is intentionally standalone.",
        "manual",
        orphans.map((p) => ({ url: p.finalUrl, detail: "0 internal inlinks from crawled pages" })),
        Boolean(input.capped),
      ),
    );
  }

  // X05 — deep pages
  const deep = indexable.filter((p) => (depths.get(p.key) ?? 0) > DEEP_PAGE_DEPTH);
  if (deep.length > 0) {
    issues.push(
      issue(
        "X05-deep-pages",
        "technical",
        "P3",
        `${deep.length} page${deep.length === 1 ? " is" : "s are"} more than ${DEEP_PAGE_DEPTH} clicks from the start page`,
        "Click depth is the shortest link path from the crawl's start URL.",
        "Deeply buried pages are crawled less often and tend to accumulate less authority.",
        "Surface important pages through navigation, hub pages or contextual links to bring them within 3 clicks.",
        "manual",
        deep.map((p) => ({ url: p.finalUrl, detail: `click depth ${depths.get(p.key)}` })),
      ),
    );
  }

  // X06 / X07 — duplicate titles and meta descriptions (indexable pages only)
  const dupTitles = groupsOf(indexable, (p) => p.title.trim().toLowerCase());
  if (dupTitles.length > 0) {
    const urls = dupTitles.flatMap((g) =>
      g.map((p) => ({
        url: p.finalUrl,
        detail: `title shared by ${g.length} pages: "${p.title.slice(0, 80)}"`,
      })),
    );
    issues.push(
      issue(
        "X06-duplicate-titles",
        "onpage",
        "P1",
        `${dupTitles.length} title${dupTitles.length === 1 ? " is" : "s are"} reused across ${urls.length} pages`,
        "Several indexable pages share exactly the same <title>.",
        "Identical titles make pages compete for the same query and give searchers no reason to pick one.",
        "Write a unique title per page that states what is specific to that page.",
        "approval",
        urls,
      ),
    );
  }
  const dupMetas = groupsOf(indexable, (p) => p.metaDescription.trim().toLowerCase());
  if (dupMetas.length > 0) {
    const urls = dupMetas.flatMap((g) =>
      g.map((p) => ({ url: p.finalUrl, detail: `description shared by ${g.length} pages` })),
    );
    issues.push(
      issue(
        "X07-duplicate-descriptions",
        "onpage",
        "P2",
        `${dupMetas.length} meta description${dupMetas.length === 1 ? " is" : "s are"} reused across ${urls.length} pages`,
        "Several indexable pages share exactly the same meta description.",
        "Duplicate descriptions are usually rewritten by search engines and lower click-through.",
        "Write a distinct description per page summarising that page's specific value.",
        "approval",
        urls,
      ),
    );
  }

  // X08 — exact duplicate body content not consolidated by canonical
  const substantive = indexable.filter((p) => p.wordCount >= 50 && p.contentHash);
  const dupContent = groupsOf(substantive, (p) => p.contentHash).filter((g) => {
    const targets = new Set(g.map((p) => p.canonicalKey || p.key));
    return targets.size > 1; // already consolidated when all canonicalize to one URL
  });
  /** @type {Set<string>} */
  const exactDupKeys = new Set(dupContent.flat().map((p) => p.key));
  if (dupContent.length > 0) {
    const urls = dupContent.flatMap((g) =>
      g.map((p) => ({
        url: p.finalUrl,
        detail: `identical body text to ${g.length - 1} other page${g.length === 2 ? "" : "s"} (${p.wordCount} words)`,
      })),
    );
    issues.push(
      issue(
        "X08-duplicate-content",
        "content",
        "P1",
        `${dupContent.length} group${dupContent.length === 1 ? "" : "s"} of pages with identical content`,
        "These indexable pages have byte-identical visible text and do not canonicalize to a single URL.",
        "Search engines pick one version themselves and may split signals between duplicates.",
        "Choose the preferred URL and point rel=canonical from the others to it, or 301-redirect the duplicates.",
        "approval",
        urls,
      ),
    );
  }

  // X09 — near-duplicate content (simhash), excluding exact duplicates
  const nearCandidates = indexable.filter((p) => p.wordCount >= 100 && p.simhash && !exactDupKeys.has(p.key));
  /** @type {{ url: string, detail: string }[]} */
  const nearUrls = [];
  /** @type {Set<string>} */
  const nearSeen = new Set();
  for (let i = 0; i < nearCandidates.length; i++) {
    const a = nearCandidates[i];
    if (!a) continue;
    for (let j = i + 1; j < nearCandidates.length; j++) {
      const b = nearCandidates[j];
      if (!b || a.contentHash === b.contentHash) continue;
      const d = simhashDistance(a.simhash, b.simhash);
      if (d > NEAR_DUPLICATE_DISTANCE) continue;
      if ((a.canonicalKey || a.key) === (b.canonicalKey || b.key)) continue;
      for (const [x, y] of [
        [a, b],
        [b, a],
      ]) {
        if (!x || !y || nearSeen.has(x.key)) continue;
        nearSeen.add(x.key);
        nearUrls.push({
          url: x.finalUrl,
          detail: `near-identical to ${y.finalUrl} (fingerprint distance ${d}/64)`,
        });
      }
    }
  }
  if (nearUrls.length > 0) {
    issues.push(
      issue(
        "X09-near-duplicate-content",
        "content",
        "P2",
        `${nearUrls.length} pages are near-duplicates of another page`,
        "Heuristic: the visible text of these pages differs only marginally (64-bit SimHash over 3-word shingles). Shared templates with little unique copy trigger this.",
        "Near-duplicate pages dilute relevance and are often filtered from results.",
        "Add substantive unique content, consolidate the pages, or canonicalize to the primary version.",
        "approval",
        nearUrls,
        true,
      ),
    );
  }

  // X10–X13 — sitemap vs. reality
  if (hasSitemap) {
    const sitemapFailed = broken.filter((f) => sitemapKeys.has(keyOf(f.url)));
    if (sitemapFailed.length > 0) {
      issues.push(
        issue(
          "X10-sitemap-broken-urls",
          "technical",
          "P1",
          `${sitemapFailed.length} sitemap URL${sitemapFailed.length === 1 ? "" : "s"} failed to load`,
          "The XML sitemap lists URLs that did not return a usable page.",
          "A sitemap is a list of URLs you want indexed; errors in it erode crawler trust in the whole file.",
          "Remove dead URLs from the sitemap or restore/redirect the pages.",
          "safe",
          sitemapFailed.map((f) => ({
            url: f.url,
            detail: f.status ? `HTTP ${f.status}` : f.error || "fetch failed",
          })),
        ),
      );
    }
    const sitemapNoindex = pages.filter(
      (p) => p.noindex && (sitemapKeys.has(p.key) || sitemapKeys.has(keyOf(p.url))),
    );
    if (sitemapNoindex.length > 0) {
      issues.push(
        issue(
          "X11-sitemap-noindex",
          "technical",
          "P1",
          `${sitemapNoindex.length} noindex page${sitemapNoindex.length === 1 ? " is" : "s are"} listed in the sitemap`,
          "The sitemap asks for these URLs to be indexed while the page itself says noindex.",
          "Contradictory indexing signals; crawl budget is spent on pages that can never rank.",
          "Decide per page: remove noindex if it should rank, otherwise drop it from the sitemap.",
          "approval",
          sitemapNoindex.map((p) => ({ url: p.finalUrl, detail: "noindex + present in sitemap" })),
        ),
      );
    }
    const sitemapNonCanonical = pages.filter(
      (p) =>
        !p.noindex &&
        (sitemapKeys.has(p.key) || sitemapKeys.has(keyOf(p.url))) &&
        ((p.canonicalKey && p.canonicalKey !== p.key) || keyOf(p.url) !== p.key),
    );
    if (sitemapNonCanonical.length > 0) {
      issues.push(
        issue(
          "X12-sitemap-non-canonical",
          "technical",
          "P2",
          `${sitemapNonCanonical.length} sitemap URL${sitemapNonCanonical.length === 1 ? " is" : "s are"} not the canonical version`,
          "The sitemap lists a URL that redirects or whose rel=canonical points somewhere else.",
          "Sitemaps should list only final, canonical URLs; anything else sends mixed signals.",
          "List the canonical destination in the sitemap instead.",
          "safe",
          sitemapNonCanonical.map((p) => ({
            url: p.url,
            detail:
              keyOf(p.url) !== p.key ? `redirects to ${p.finalUrl}` : `canonical points to ${p.canonical}`,
          })),
        ),
      );
    }
    const sitemapComplete = (input.sitemapUrls?.length ?? 0) < 1000; // seed cap: beyond it we cannot tell
    const missing = sitemapComplete
      ? indexable.filter(
          (p) =>
            !sitemapKeys.has(p.key) &&
            !sitemapKeys.has(keyOf(p.url)) &&
            (!p.canonicalKey || p.canonicalKey === p.key),
        )
      : [];
    if (missing.length > 0) {
      issues.push(
        issue(
          "X13-missing-from-sitemap",
          "technical",
          "P3",
          `${missing.length} indexable page${missing.length === 1 ? " is" : "s are"} missing from the sitemap`,
          "These crawlable, indexable, self-canonical pages are not listed in the XML sitemap.",
          "Sitemap coverage speeds up discovery of new and updated pages.",
          "Add the URLs to the sitemap (or regenerate it from the site's page inventory).",
          "safe",
          missing.map((p) => ({ url: p.finalUrl, detail: "indexable, not in sitemap" })),
        ),
      );
    }
  }

  // X14 — canonical target problems
  /** @type {{ url: string, detail: string }[]} */
  const canonProblems = [];
  const failedKeys = new Set(broken.map((f) => keyOf(f.url)));
  for (const p of pages) {
    if (!p.canonicalKey || p.canonicalKey === p.key) continue;
    const target = byKey.get(p.canonicalKey);
    if (failedKeys.has(p.canonicalKey)) {
      canonProblems.push({ url: p.finalUrl, detail: `canonical target failed to load: ${p.canonical}` });
    } else if (target?.noindex) {
      canonProblems.push({ url: p.finalUrl, detail: `canonical target is noindex: ${p.canonical}` });
    } else if (target && target.canonicalKey && target.canonicalKey !== target.key) {
      canonProblems.push({
        url: p.finalUrl,
        detail: `canonical chain: ${p.canonical} -> ${target.canonical}`,
      });
    } else if (p.noindex) {
      canonProblems.push({ url: p.finalUrl, detail: `noindex page also declares canonical ${p.canonical}` });
    }
  }
  if (canonProblems.length > 0) {
    issues.push(
      issue(
        "X14-canonical-conflicts",
        "technical",
        "P1",
        `${canonProblems.length} page${canonProblems.length === 1 ? " has" : "s have"} a conflicting canonical`,
        "The rel=canonical target is broken, non-indexable, itself canonicalized elsewhere, or combined with noindex.",
        "A canonical that cannot be honoured is ignored, leaving indexing to chance.",
        "Point each canonical at a live, indexable, self-canonical URL; do not combine canonical with noindex.",
        "approval",
        canonProblems,
      ),
    );
  }

  // X15 — hreflang consistency
  /** @type {{ url: string, detail: string }[]} */
  const hreflangProblems = [];
  for (const p of pages) {
    if (p.hreflangs.length === 0) continue;
    const bad = p.hreflangs.filter((h) => !isValidHreflang(h.lang));
    if (bad.length > 0) {
      hreflangProblems.push({
        url: p.finalUrl,
        detail: `invalid hreflang value: ${bad
          .slice(0, 3)
          .map((h) => `"${h.lang}"`)
          .join(", ")}`,
      });
    }
    const selfRef = p.hreflangs.some((h) => h.href && keyOf(h.href) === p.key);
    if (!selfRef) hreflangProblems.push({ url: p.finalUrl, detail: "no self-referencing hreflang entry" });
    for (const h of p.hreflangs) {
      if (!h.href) continue;
      const alt = byKey.get(keyOf(h.href));
      if (!alt || alt === p) continue; // only pages we actually crawled can be verified
      if (!alt.hreflangs.some((x) => x.href && keyOf(x.href) === p.key)) {
        hreflangProblems.push({
          url: p.finalUrl,
          detail: `no return link from ${alt.finalUrl} (hreflang="${h.lang}")`,
        });
      }
    }
  }
  if (hreflangProblems.length > 0) {
    issues.push(
      issue(
        "X15-hreflang-errors",
        "international",
        "P2",
        `${hreflangProblems.length} hreflang problem${hreflangProblems.length === 1 ? "" : "s"} found`,
        "hreflang annotations must use valid language codes, include a self-reference, and be reciprocal. Return links are only verified between pages that were crawled.",
        "Broken hreflang clusters are ignored, so users may be served the wrong language or region.",
        "Fix the listed annotations so every alternate links back, and add a self-referencing entry to each page.",
        "approval",
        hreflangProblems,
      ),
    );
  }

  // X16 — keyword cannibalization (heuristic over title + H1 targeting)
  const targeted = indexable.filter((p) => p.targetTerms.length >= 2);
  /** @type {number[]} */
  const parent = targeted.map((_, i) => i);
  /** @param {number} i @returns {number} */
  const find = (i) => {
    let r = i;
    while ((parent[r] ?? r) !== r) r = parent[r] ?? r;
    parent[i] = r;
    return r;
  };
  for (let i = 0; i < targeted.length; i++) {
    for (let j = i + 1; j < targeted.length; j++) {
      const a = targeted[i];
      const b = targeted[j];
      if (!a || !b) continue;
      if (a.title.trim().toLowerCase() === b.title.trim().toLowerCase()) continue; // X06 owns exact dupes
      if (jaccard(a.targetTerms, b.targetTerms) >= CANNIBALIZATION_SIMILARITY) parent[find(i)] = find(j);
    }
  }
  /** @type {Map<number, PageFacts[]>} */
  const clusters = new Map();
  targeted.forEach((p, i) => {
    const root = find(i);
    const arr = clusters.get(root) ?? [];
    arr.push(p);
    clusters.set(root, arr);
  });
  const cannibal = [...clusters.values()].filter((g) => g.length > 1);
  if (cannibal.length > 0) {
    const urls = cannibal.flatMap((g) =>
      g.map((p) => ({
        url: p.finalUrl,
        detail: `targets the same terms as ${g.length - 1} other page${g.length === 2 ? "" : "s"}: ${p.targetTerms.slice(0, 6).join(", ")}`,
      })),
    );
    issues.push(
      issue(
        "X16-keyword-cannibalization",
        "content",
        "P2",
        `${cannibal.length} group${cannibal.length === 1 ? "" : "s"} of pages targeting the same topic`,
        "Heuristic: these pages' titles and H1s share most of their content terms. This is inferred from on-page targeting only — confirm with query data (e.g. Search Console) before acting.",
        "Pages competing for one query split clicks and links; the wrong page may be the one that ranks.",
        "Differentiate the intent each page serves, or merge them and redirect the weaker URL.",
        "approval",
        urls,
        true,
      ),
    );
  }

  // X17 — thin indexable pages
  const thin = indexable.filter((p) => p.wordCount < THRESHOLDS.thinWords);
  if (thin.length >= 3 || (thin.length > 0 && thin.length / Math.max(1, indexable.length) >= 0.2)) {
    issues.push(
      issue(
        "X17-thin-content",
        "content",
        "P2",
        `${thin.length} of ${indexable.length} indexable pages have under ${THRESHOLDS.thinWords} words`,
        "A notable share of the site's indexable pages carry very little visible text.",
        "Sites with many thin pages are judged lower quality as a whole, not just per page.",
        "Expand pages that should rank, and noindex or consolidate the ones that should not.",
        "approval",
        thin.map((p) => ({ url: p.finalUrl, detail: `${p.wordCount} words` })),
      ),
    );
  }

  // X18 — URL structure
  /** @type {{ url: string, detail: string }[]} */
  const urlProblems = [];
  for (const p of pages) {
    let u;
    try {
      u = new URL(p.finalUrl);
    } catch {
      continue;
    }
    if (u.protocol === "file:") continue;
    /** @type {string[]} */
    const why = [];
    if (/[A-Z]/.test(u.pathname)) why.push("uppercase characters");
    if (u.pathname.includes("_")) why.push("underscores (prefer hyphens)");
    if (/\/\/+/.test(u.pathname)) why.push("double slashes");
    if (p.finalUrl.length > 115) why.push(`${p.finalUrl.length} characters long`);
    if ([...u.searchParams.keys()].length > 2) why.push("3+ query parameters");
    if (/%20|\s/.test(u.pathname)) why.push("spaces");
    if (why.length > 0) urlProblems.push({ url: p.finalUrl, detail: why.join("; ") });
  }
  if (urlProblems.length > 0) {
    issues.push(
      issue(
        "X18-url-structure",
        "technical",
        "P3",
        `${urlProblems.length} URL${urlProblems.length === 1 ? "" : "s"} could be cleaner`,
        "URLs with mixed case, underscores, spaces, many parameters or extreme length are harder to share and easier to duplicate.",
        "Low direct ranking impact, but messy URLs create duplicate variants and lower click-through.",
        "Use short, lowercase, hyphenated paths for new pages. Changing existing indexed URLs requires 301 redirects.",
        "approval",
        urlProblems,
      ),
    );
  }

  // X19 — slow responses (measured from the auditing machine)
  const slow = pages.filter((p) => p.ms > SLOW_RESPONSE_MS);
  if (slow.length > 0) {
    issues.push(
      issue(
        "X19-slow-responses",
        "performance",
        "P2",
        `${slow.length} page${slow.length === 1 ? "" : "s"} took over ${SLOW_RESPONSE_MS / 1000}s to respond`,
        "Time to download the HTML (including redirects), measured from the machine running the audit. This is not a Core Web Vitals field metric — use --psi for those.",
        "Slow server responses delay every other loading milestone and reduce crawl rate.",
        "Check server/CDN caching and backend time for these URLs.",
        "manual",
        slow.map((p) => ({ url: p.finalUrl, detail: `${p.ms} ms` })),
      ),
    );
  }

  // X20 — https pages linking to http:// same-site URLs
  /** @type {{ url: string, detail: string }[]} */
  const insecureLinks = [];
  for (const p of pages) {
    if (!p.finalUrl.startsWith("https://")) continue;
    const http = p.links.filter((l) => l.startsWith("http://"));
    if (http.length > 0) {
      insecureLinks.push({
        url: p.finalUrl,
        detail: `${http.length} internal http:// link${http.length === 1 ? "" : "s"}, e.g. ${http[0]}`,
      });
    }
  }
  if (insecureLinks.length > 0) {
    issues.push(
      issue(
        "X20-insecure-internal-links",
        "technical",
        "P2",
        `${insecureLinks.length} page${insecureLinks.length === 1 ? " links" : "s link"} to http:// versions of internal URLs`,
        "Secure pages link to the insecure scheme of the same site.",
        "Each such link costs a redirect at best and a mixed-scheme duplicate at worst.",
        "Rewrite the internal links to https://.",
        "safe",
        insecureLinks,
      ),
    );
  }

  // X21 — stale content (declared dates only)
  const stale = indexable.filter((p) => {
    const t = Date.parse(p.dateModified);
    return Number.isFinite(t) && now - t > STALE_CONTENT_DAYS * 86_400_000;
  });
  if (stale.length > 0) {
    issues.push(
      issue(
        "X21-stale-content",
        "content",
        "P3",
        `${stale.length} page${stale.length === 1 ? " was" : "s were"} last updated over ${Math.round(STALE_CONTENT_DAYS / 30)} months ago`,
        "Based on the dateModified/datePublished each page declares in its structured data. Pages without declared dates are not assessed.",
        "Outdated content loses rankings on time-sensitive topics and is cited less by AI answers.",
        "Review each page: refresh facts and update dateModified, or leave evergreen content as is.",
        "approval",
        stale.map((p) => ({ url: p.finalUrl, detail: `last modified ${p.dateModified.slice(0, 10)}` })),
      ),
    );
  }

  // X22/X23 — soft-404 probes: URLs that cannot exist, answered with 200.
  const probes = Array.isArray(input.probes) ? input.probes : [];
  const rootProbe = probes.find((p) => p.kind === "root");
  const nestedProbe = probes.find((p) => p.kind === "nested");
  /** @param {{ title: string }} p @returns {string} */
  const titled = (p) => (p.title ? ` with the page title "${p.title}"` : "");
  if (rootProbe?.status === 200) {
    issues.push(
      issue(
        "X22-soft-404-site",
        "technical",
        "P1",
        "Missing pages return HTTP 200 (soft 404)",
        `A request for a URL that cannot exist was answered with HTTP 200${titled(rootProbe)}, so every mistyped or deleted URL looks like a real page.`,
        "Search engines treat these as soft 404s: removed pages linger, broken links never show up as errors, and a relative-link mistake becomes an endless set of duplicate URLs.",
        "Make the server or the app's catch-all route answer unknown URLs with a 404 (or 410) status, while still showing a helpful not-found page.",
        "manual",
        [{ url: rootProbe.url, detail: `HTTP 200${rootProbe.title ? `, title "${rootProbe.title}"` : ""}` }],
      ),
    );
  } else if (nestedProbe?.status === 200) {
    const section = nestedProbe.url.replace(/^https?:\/\/[^/]+\//, "").split("/")[0] ?? "";
    const rootFine = rootProbe && rootProbe.status >= 300;
    issues.push(
      issue(
        "X23-soft-404-section",
        "technical",
        "P2",
        `Missing pages under /${section}/ return HTTP 200`,
        `${rootFine ? `The site answers a made-up URL at the root with HTTP ${rootProbe.status}, but a` : "A"} made-up URL under /${section}/ was answered with HTTP 200${titled(nestedProbe)}.`,
        "Any path below that section serves a page, so typos and relative-link mistakes there create unlimited duplicate URLs that crawlers can get stuck in.",
        "Return 404 for unknown paths below the section: check the route or rewrite rule that serves it.",
        "manual",
        [
          {
            url: nestedProbe.url,
            detail: `HTTP 200${nestedProbe.title ? `, title "${nestedProbe.title}"` : ""}`,
          },
        ],
      ),
    );
  }

  issues.sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) || b.count - a.count);

  // ---- content intelligence ----
  /** @type {Map<string, number>} */
  const termPages = new Map();
  for (const p of indexable) {
    for (const t of new Set(p.terms.slice(0, 10).map((x) => x.term))) {
      termPages.set(t, (termPages.get(t) ?? 0) + 1);
    }
  }
  const topics = [...termPages.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 30)
    .map(([term, pageCount]) => ({ term, pages: pageCount }));

  const linkSuggestions = suggestInternalLinks(indexable);
  const underlinked = indexable
    .filter((p) => p !== start && p.wordCount >= 600 && (inlinks.get(p.key) ?? 0) <= 1)
    .slice(0, 25)
    .map((p) => ({ url: p.finalUrl, wordCount: p.wordCount, inlinks: inlinks.get(p.key) ?? 0 }));

  const pageStats = pages.map((p) => ({
    url: p.finalUrl,
    depth: depths.has(p.key) ? (depths.get(p.key) ?? 0) : null,
    inlinks: inlinks.get(p.key) ?? 0,
    outlinks: p.links.length,
    indexable: !p.noindex,
    wordCount: p.wordCount,
    responseMs: p.ms,
    inSitemap: hasSitemap ? sitemapKeys.has(p.key) || sitemapKeys.has(keyOf(p.url)) : null,
  }));

  const depthValues = [...depths.values()];
  /** @type {Record<string, number>} */
  const severityCounts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const i of issues) severityCounts[i.severity] = (severityCounts[i.severity] ?? 0) + 1;

  return {
    summary: {
      pagesAnalyzed: pages.length,
      indexablePages: indexable.length,
      noindexPages: pages.length - indexable.length,
      failedUrls: broken.length,
      skippedAssets: failures.filter((f) => f.kind === "asset").length,
      sitemapUrls: sitemapKeys.size,
      maxClickDepth: depthValues.length > 0 ? Math.max(...depthValues) : 0,
      averageWordCount:
        pages.length > 0 ? Math.round(pages.reduce((s, p) => s + p.wordCount, 0) / pages.length) : 0,
      averageResponseMs:
        pages.length > 0 ? Math.round(pages.reduce((s, p) => s + p.ms, 0) / pages.length) : 0,
      crawlCapped: Boolean(input.capped),
      issueCounts: severityCounts,
    },
    categoryScores: categoryScores(input.pageReports ?? []),
    issues,
    pageStats,
    content: {
      topics,
      linkSuggestions,
      underlinkedPages: underlinked,
      briefs: contentBriefs(indexable, inlinks, linkSuggestions),
    },
    methodology: {
      scores:
        "Category scores start at 100 per page and subtract P0 25, P1 10, P2 3, P3 1 for each failing check in that category, then average across pages. They are tool-defined health indicators, not Google ranking scores.",
      terms:
        "Terms are the most frequent content words found on each page. They indicate what the page is about, not how often people search for it.",
      heuristics:
        "Issues flagged heuristic (near-duplicates, cannibalization, orphans under a capped crawl) are inferences and should be confirmed before acting.",
      coverage: input.capped
        ? "The crawl reached its page cap; site-level findings cover the audited pages only."
        : "All discovered pages within the crawl rules were audited.",
    },
  };
}

/**
 * Suggest contextual internal links: page A should link to page B when they
 * share topical terms and A does not already link to B. Lexical heuristic.
 * @param {PageFacts[]} pages indexable pages
 * @param {number} [limit]
 * @returns {{ from: string, to: string, anchor: string, sharedTerms: string[], similarity: number }[]}
 */
export function suggestInternalLinks(pages, limit = 50) {
  const termSets = pages.map((p) => [
    ...new Set([...p.targetTerms, ...p.terms.slice(0, 10).map((t) => t.term)]),
  ]);
  /** @type {{ from: string, to: string, anchor: string, sharedTerms: string[], similarity: number }[]} */
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    const a = pages[i];
    const ta = termSets[i];
    if (!a || !ta || ta.length < 3) continue;
    const linked = new Set(a.links);
    for (let j = 0; j < pages.length; j++) {
      if (i === j) continue;
      const b = pages[j];
      const tb = termSets[j];
      if (!b || !tb || tb.length < 3 || linked.has(b.key)) continue;
      const sim = jaccard(ta, tb);
      if (sim < 0.3) continue;
      const setB = new Set(tb);
      const shared = ta.filter((t) => setB.has(t)).slice(0, 6);
      if (shared.length < 3) continue;
      out.push({
        from: a.finalUrl,
        to: b.finalUrl,
        anchor: stripBrandSuffix(b.title) || b.h1,
        sharedTerms: shared,
        similarity: Math.round(sim * 100) / 100,
      });
    }
  }
  return out.sort((x, y) => y.similarity - x.similarity).slice(0, limit);
}

/**
 * Content briefs for the weakest indexable pages, built only from what the
 * site itself contains: the page's current targeting, the sections related
 * pages on this site cover that it does not, and internal links to add.
 * @param {PageFacts[]} pages indexable pages
 * @param {Map<string, number>} inlinks
 * @param {{ from: string, to: string, anchor: string }[]} linkSuggestions
 * @param {number} [limit]
 */
export function contentBriefs(pages, inlinks, linkSuggestions, limit = 10) {
  const weak = pages
    .filter((p) => p.wordCount < 300 || p.h2s.length === 0)
    .sort((a, b) => a.wordCount - b.wordCount)
    .slice(0, limit);
  return weak.map((p) => {
    const related = pages
      .filter((q) => q !== p && q.wordCount >= 300)
      .map((q) => ({ q, sim: jaccard(p.targetTerms, q.targetTerms) }))
      .filter((x) => x.sim > 0.15)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 3)
      .map((x) => x.q);
    const have = new Set(p.h2s.map((h) => h.toLowerCase()));
    /** @type {string[]} */
    const sections = [];
    for (const q of related) {
      for (const h of q.h2s) {
        if (h && !have.has(h.toLowerCase()) && !sections.includes(h)) sections.push(h);
        if (sections.length >= 8) break;
      }
    }
    /** @type {string[]} */
    const gaps = [];
    if (p.wordCount < THRESHOLDS.thinWords)
      gaps.push(`only ${p.wordCount} words — expand to cover the topic`);
    if (p.h2s.length === 0) gaps.push("no H2 subheadings");
    if (!p.metaDescription) gaps.push("no meta description");
    if (p.h1Count !== 1) gaps.push(p.h1Count === 0 ? "no H1" : `${p.h1Count} H1s`);
    if (p.schemaTypes.length === 0) gaps.push("no structured data");
    if ((inlinks.get(p.key) ?? 0) <= 1) gaps.push("almost no internal links point here");
    return {
      url: p.finalUrl,
      currentTitle: p.title,
      currentH1: p.h1,
      wordCount: p.wordCount,
      targetTerms: p.targetTerms.slice(0, 8),
      gaps,
      sectionsCoveredByRelatedPages: sections,
      relatedPages: related.map((q) => q.finalUrl),
      linksToAdd: linkSuggestions
        .filter((s) => s.to === p.finalUrl)
        .slice(0, 5)
        .map((s) => ({ from: s.from, anchor: s.anchor })),
      note: "Built from this site's own pages. Validate topic demand with a keyword data source before investing in new copy.",
    };
  });
}

/**
 * Compare the audited site with crawled competitor pages. Purely lexical and
 * structural: it reports which topics competitors' pages emphasise that the
 * audited site's pages do not, plus like-for-like on-page averages. It does
 * NOT know search volume, rankings, traffic or backlinks.
 * @param {PageFacts[]} own
 * @param {{ url: string, pages: PageFacts[] }[]} competitors
 */
export function compareCompetitors(own, competitors) {
  /** @param {PageFacts[]} pages */
  const profile = (pages) => {
    const n = pages.length || 1;
    /** @type {Map<string, number>} */
    const schema = new Map();
    for (const p of pages) for (const t of new Set(p.schemaTypes)) schema.set(t, (schema.get(t) ?? 0) + 1);
    return {
      pages: pages.length,
      averageWordCount: Math.round(pages.reduce((s, p) => s + p.wordCount, 0) / n),
      averageTitleLength: Math.round(pages.reduce((s, p) => s + [...p.title].length, 0) / n),
      pagesWithMetaDescription: pages.filter((p) => p.metaDescription).length,
      pagesWithStructuredData: pages.filter((p) => p.schemaTypes.length > 0).length,
      averageResponseMs: Math.round(pages.reduce((s, p) => s + p.ms, 0) / n),
      schemaTypes: [...schema.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ type, count })),
    };
  };
  /** @param {PageFacts[]} pages @returns {Map<string, number>} */
  const termCoverage = (pages) => {
    /** @type {Map<string, number>} */
    const m = new Map();
    for (const p of pages) {
      for (const t of new Set([...p.targetTerms, ...p.terms.slice(0, 10).map((x) => x.term)])) {
        m.set(t, (m.get(t) ?? 0) + 1);
      }
    }
    return m;
  };
  const ownTerms = termCoverage(own);
  const results = competitors.map((c) => {
    const theirs = termCoverage(c.pages);
    const gaps = [...theirs.entries()]
      .filter(([t, n]) => !ownTerms.has(t) && (n >= 2 || c.pages.length === 1))
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 40)
      .map(([term, pageCount]) => ({ term, competitorPages: pageCount }));
    const shared = [...theirs.keys()].filter((t) => ownTerms.has(t)).length;
    return {
      url: c.url,
      profile: profile(c.pages),
      sharedTerms: shared,
      termGaps: gaps,
    };
  });
  return {
    own: profile(own),
    competitors: results,
    note: "Lexical comparison of crawled pages only. Term gaps are topics competitor pages emphasise that yours do not — not keyword demand. Search volume, rankings, traffic and backlinks are not measured.",
  };
}
