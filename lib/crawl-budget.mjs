/**
 * one-step-seo — crawl budget: the URL parameters that multiply the URLs a
 * crawler can request (pagination, filters, sorting, tracking tags, session
 * ids, site search).
 *
 * Ported from Open SEO Crawler (_CB_PARAM_RULES, _cb_normalise_key,
 * _cb_classify and _analyze_crawl_budget in app.py), MIT License,
 * Copyright (c) 2026 Puneet Inder Singh — see THIRD_PARTY_NOTICES.md.
 *
 * The original fetched the home page and up to 13 section pages a second
 * time to collect their links. Here the inventory is built from the internal
 * links of every page the crawl audits, whether those links are crawled or
 * skipped, so nothing extra is requested. Nothing here writes robots.txt:
 * the Disallow lines it drafts are suggestions.
 */
import { isDisallowed, MAX_SITEMAP_SEED_URLS } from "./robots.mjs";

/** Distinct URLs an unclassified parameter must appear on to count as a crawl trap. */
export const PARAM_VOLUME_THRESHOLD = 25;
/** Parameters kept in an inventory, most important first (`keyCount` keeps the total). */
export const MAX_PARAM_KEYS = 200;
/** Example URLs kept per parameter. */
const MAX_EXAMPLES = 3;
/** robots.txt is read the way Googlebot reads it: its own group, else `*`. */
const ROBOTS_AGENT = "googlebot";

/**
 * What a query parameter is for. "parameter" means no rule recognises it.
 * @typedef {"pagination" | "faceting" | "sort" | "tracking" | "session" | "search" | "parameter"} ParamType
 */

/**
 * One query parameter found in internal links.
 * @typedef {object} UrlParameterKey
 * @property {string} key lowercased query key; page-builder widget ids folded (e-page-0b1537f → e-page-*)
 * @property {ParamType} type
 * @property {string} why the rule that classified it, in words
 * @property {number} count distinct internal link URLs that carry it
 * @property {number} blocked how many of those robots.txt already disallows for Googlebot
 * @property {number} maxNumber highest all-digit value seen (0 when none)
 * @property {string[]} examples up to 3 of those URLs, in the order found
 * @property {boolean} trap recognised as a crawl-trap parameter, or seen on PARAM_VOLUME_THRESHOLD or more URLs
 */

/**
 * Query parameters on the internal links of the pages a crawl audited,
 * whether those links were crawled or skipped.
 * @typedef {object} UrlParameterInventory
 * @property {number} pagesScanned audited pages whose links were read
 * @property {number} linksScanned distinct internal link URLs on those pages
 * @property {number} parameterLinks distinct internal link URLs that carry a query parameter
 * @property {number} pagesOverLinkCap pages with more internal links than the HTML parser keeps; their extra links were not read
 * @property {number | null} sitemapUrls URLs the sitemap lists, for scale (null when the crawl did not read the sitemap; at most MAX_SITEMAP_SEED_URLS)
 * @property {number} keyCount distinct parameters (`keys` keeps at most MAX_PARAM_KEYS)
 * @property {number} trapKeys crawl-trap parameters with URLs that robots.txt does not disallow
 * @property {number} trapUrls distinct link URLs that carry a crawl-trap parameter and that robots.txt does not disallow
 * @property {UrlParameterKey[]} keys crawl traps first, then by type, highest value and URL count
 */

const PAGINATION_KEYS = new Set(["page", "paged", "pg", "pagenum", "start", "offset"]);
const SORT_KEYS = new Set(["orderby", "order", "sort", "sort_by", "sortby"]);
const FILTER_KEYS = new Set([
  "filter",
  "filters",
  "filter_by",
  "color",
  "colour",
  "size",
  "brand",
  "min_price",
  "max_price",
  "swoof",
  "jsf",
]);
const TRACKING_KEYS = new Set(["gclid", "fbclid", "msclkid", "mc_cid", "mc_eid", "yclid"]);
const SESSION_KEYS = new Set(["replytocom", "phpsessid", "sessionid", "sid", "jsessionid"]);
const SEARCH_KEYS = new Set(["s", "q", "search", "query", "keyword"]);

/**
 * Open SEO Crawler's parameter rules, in its order: the first match wins.
 * @type {{ test: (key: string) => boolean, type: Exclude<ParamType, "parameter">, why: string }[]}
 */
const PARAM_RULES = [
  {
    test: (k) => k.startsWith("e-page-"),
    type: "pagination",
    why: "Elementor Pro Posts/Loop AJAX pagination",
  },
  { test: (k) => k.startsWith("e-filter-"), type: "faceting", why: "Elementor Pro taxonomy filter" },
  { test: (k) => PAGINATION_KEYS.has(k), type: "pagination", why: "Pagination parameter" },
  { test: (k) => SORT_KEYS.has(k), type: "sort", why: "Result sorting: duplicate views of the same set" },
  {
    test: (k) =>
      FILTER_KEYS.has(k) || k.startsWith("filter_") || k.endsWith("_filter") || k.startsWith("pa_"),
    type: "faceting",
    why: "Faceted navigation filter",
  },
  {
    test: (k) => k.startsWith("utm_") || TRACKING_KEYS.has(k),
    type: "tracking",
    why: "Campaign / click tracking tag",
  },
  { test: (k) => SESSION_KEYS.has(k), type: "session", why: "Session / comment-reply parameter" },
  { test: (k) => SEARCH_KEYS.has(k), type: "search", why: "Internal site-search query" },
];

const VOLUME_WHY = `Unrecognised parameter on ${PARAM_VOLUME_THRESHOLD} or more URLs: a high-volume crawl trap`;
const OTHER_WHY = "Unrecognised parameter";

/** Ranking weight of each type (Open SEO Crawler's order). @type {Record<ParamType, number>} */
const TYPE_RANK = { pagination: 5, faceting: 4, sort: 3, tracking: 2, session: 2, search: 1, parameter: 0 };

/**
 * Lowercase a query key and fold a page-builder widget id into its family:
 * e-page-0b1537f and e-page-1478160 both become e-page-*. Elementor names
 * these keys <name>-<hex widget id>, a new key for every listing widget.
 * @param {string} rawKey query key as written
 * @returns {string}
 */
export function normalizeParamKey(rawKey) {
  const key = String(rawKey ?? "").toLowerCase();
  const m = /^([a-z][a-z0-9]*-[a-z0-9]+)-[0-9a-f]{6,}$/.exec(key);
  return m?.[1] ? `${m[1]}-*` : key;
}

/**
 * What a parameter is for, judged by its name. Null when no rule knows it.
 * @param {string} key normalized key (see normalizeParamKey)
 * @returns {{ type: Exclude<ParamType, "parameter">, why: string } | null}
 */
export function classifyParamKey(key) {
  const base = key.endsWith("-*") ? key.slice(0, -1) : key;
  for (const rule of PARAM_RULES) {
    if (rule.test(base) || rule.test(key)) return { type: rule.type, why: rule.why };
  }
  return null;
}

/**
 * Order parameters as Open SEO Crawler does: crawl traps first, then by type
 * (pagination, faceting, sort, tracking and session, search, other), then
 * the highest number seen, then the URL count. Ties keep the order found.
 * @param {UrlParameterKey[]} keys sorted in place
 * @returns {UrlParameterKey[]}
 */
export function rankParamKeys(keys) {
  return keys.sort(
    (a, b) =>
      Number(b.trap) - Number(a.trap) ||
      TYPE_RANK[b.type] - TYPE_RANK[a.type] ||
      b.maxNumber - a.maxNumber ||
      b.count - a.count,
  );
}

/**
 * A crawl-trap parameter that crawlers can still reach: some of its URLs are
 * not disallowed by robots.txt. These are the parameters X27 reports.
 * @param {UrlParameterKey} k
 * @returns {boolean}
 */
export function isCrawlableTrap(k) {
  return k.trap && k.count > k.blocked;
}

/**
 * Builds a UrlParameterInventory from the internal links of audited pages.
 * crawlSite gives it every audited page's links before deciding which of
 * them to crawl, so skipped links count too.
 */
export class UrlParameterCollector {
  /** @param {string} [robotsText] the robots.txt the crawl read ("" when none) */
  constructor(robotsText = "") {
    this.robotsText = String(robotsText ?? "");
    this.pages = 0;
    this.pagesOverLinkCap = 0;
    /** Every distinct link URL read. @type {Set<string>} */
    this.seen = new Set();
    /** @type {Map<string, { count: number, blocked: number, maxNumber: number, examples: string[] }>} */
    this.stats = new Map();
    /** One entry per distinct link URL with parameters. @type {{ keys: string[], blocked: boolean }[]} */
    this.paramLinks = [];
  }

  /**
   * Read one audited page's internal links.
   * @param {readonly string[]} links absolute internal link URLs, fragment removed
   * @param {number} [total] how many internal links the page has (more than links.length when the parser capped them)
   */
  addPage(links, total = links.length) {
    this.pages++;
    if (total > links.length) this.pagesOverLinkCap++;
    for (const link of links) {
      if (this.seen.has(link)) continue;
      this.seen.add(link);
      /** @type {URL} */
      let u;
      try {
        u = new URL(link);
      } catch {
        continue;
      }
      /** @type {Set<string>} */
      const keys = new Set();
      for (const [rawKey, value] of u.searchParams) {
        if (!rawKey) continue;
        const key = normalizeParamKey(rawKey);
        let s = this.stats.get(key);
        if (!s) {
          s = { count: 0, blocked: 0, maxNumber: 0, examples: [] };
          this.stats.set(key, s);
        }
        if (/^\d+$/.test(value)) {
          const n = Number(value);
          if (Number.isSafeInteger(n) && n > s.maxNumber) s.maxNumber = n;
        }
        // A key repeated in one URL (?a=1&a=2) is still one URL for it.
        if (keys.has(key)) continue;
        keys.add(key);
        s.count++;
        if (s.examples.length < MAX_EXAMPLES) s.examples.push(link);
      }
      if (keys.size === 0) continue;
      const blocked =
        this.robotsText !== "" && isDisallowed(this.robotsText, ROBOTS_AGENT, (u.pathname || "/") + u.search);
      if (blocked) {
        for (const key of keys) {
          const s = this.stats.get(key);
          if (s) s.blocked++;
        }
      }
      this.paramLinks.push({ keys: [...keys], blocked });
    }
  }

  /**
   * Classify, rank and count everything read so far.
   * @param {number | null} [sitemapUrls] URLs the sitemap lists (null when the crawl did not read it)
   * @returns {UrlParameterInventory}
   */
  finish(sitemapUrls = null) {
    /** @type {UrlParameterKey[]} */
    const keys = [];
    for (const [key, s] of this.stats) {
      const known = classifyParamKey(key);
      const trap = known !== null || s.count >= PARAM_VOLUME_THRESHOLD;
      keys.push({
        key,
        type: known ? known.type : "parameter",
        why: known ? known.why : trap ? VOLUME_WHY : OTHER_WHY,
        count: s.count,
        blocked: s.blocked,
        maxNumber: s.maxNumber,
        examples: [...s.examples],
        trap,
      });
    }
    rankParamKeys(keys);
    const trapNames = new Set(keys.filter((k) => k.trap).map((k) => k.key));
    return {
      pagesScanned: this.pages,
      linksScanned: this.seen.size,
      parameterLinks: this.paramLinks.length,
      pagesOverLinkCap: this.pagesOverLinkCap,
      sitemapUrls,
      keyCount: keys.length,
      trapKeys: keys.filter(isCrawlableTrap).length,
      // A URL with two trap parameters (?page=2&orderby=price) counts once.
      trapUrls: this.paramLinks.filter((p) => !p.blocked && p.keys.some((k) => trapNames.has(k))).length,
      keys: keys.slice(0, MAX_PARAM_KEYS),
    };
  }
}

/**
 * The inventory of a crawl that read no pages.
 * @returns {UrlParameterInventory}
 */
export function emptyUrlParameters() {
  return new UrlParameterCollector().finish(null);
}

/** A key that can go into a robots.txt pattern as written. */
const RULE_SAFE_KEY = /^[^\s*$#%?&=]+$/;

/**
 * robots.txt lines that would stop crawlers requesting URLs with these
 * parameters: `Disallow: /*?e-page-` for a folded page-builder key,
 * `Disallow: /*?utm_` for utm_ tags and `Disallow: /*?key=` otherwise, each
 * repeated with `&` for a parameter that is not the first in the query.
 * Anchoring on `?` and `&` keeps a rule to that parameter: Open SEO
 * Crawler's `Disallow: /*s=` also matched ?ids= and ?class=, and
 * `Disallow: /*e-page-` matched paths such as /single-page-app/.
 * robots.txt paths are case-sensitive; keys are matched in lowercase.
 * Suggestions only: nothing in one-step-seo writes robots.txt.
 * @param {readonly string[]} keys normalized keys, most important first
 * @returns {string[]}
 */
export function draftDisallowRules(keys) {
  /** @type {string[]} */
  const rules = [];
  for (const key of keys) {
    const stem = key.endsWith("-*") ? key.slice(0, -1) : key.startsWith("utm_") ? "utm_" : `${key}=`;
    const name = stem.endsWith("=") ? stem.slice(0, -1) : stem;
    if (!RULE_SAFE_KEY.test(name)) continue;
    for (const sep of ["?", "&"]) {
      const rule = `Disallow: /*${sep}${stem}`;
      if (!rules.includes(rule)) rules.push(rule);
    }
  }
  return rules;
}

/**
 * One parameter as evidence text, e.g.
 * "?e-page-* (pagination): 48 URLs, highest value 48 — Elementor Pro Posts/Loop AJAX pagination".
 * @param {UrlParameterKey} k
 * @returns {string}
 */
export function describeParamKey(k) {
  const facts = [`${k.count} URL${k.count === 1 ? "" : "s"}`];
  if (k.maxNumber > 0) facts.push(`highest value ${k.maxNumber}`);
  if (k.blocked > 0) facts.push(`${k.blocked} already disallowed by robots.txt`);
  return `?${k.key} (${k.type}): ${facts.join(", ")} — ${k.why}`;
}

/**
 * How many URLs the sitemap lists, as a sentence, for scale.
 * @param {number | null | undefined} n
 * @returns {string}
 */
export function sitemapScale(n) {
  if (typeof n !== "number") return "The sitemap was not read in this crawl, so its size is not compared.";
  if (n === 0) return "No sitemap URLs were found to compare with.";
  const many = n >= MAX_SITEMAP_SEED_URLS ? `at least ${n}` : String(n);
  return `For scale, the sitemap lists ${many} URL${n === 1 ? "" : "s"}.`;
}
