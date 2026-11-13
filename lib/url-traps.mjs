/**
 * one-step-seo — crawler-trap rules and URL hygiene.
 *
 * Ported from Open SEO Crawler (the crawl-loop URL filters in app.py and the
 * URL checks in page_checks.py), MIT License, Copyright (c) 2026 Puneet Inder
 * Singh — see THIRD_PARTY_NOTICES.md.
 *
 * Every rule here is about URLs that are not pages, or that multiply without
 * end. Following them wastes the page budget and floods reports with phantom
 * 404s and duplicates.
 */

/**
 * Path fragments that are never content pages: feeds, the WordPress API and
 * admin, cart/checkout AJAX endpoints, sitemap files and Cloudflare's
 * injected /cdn-cgi/ infrastructure (e.g. /cdn-cgi/l/email-protection,
 * which 404s when fetched directly).
 */
export const NON_PAGE_PATH_FRAGMENTS = [
  "/feed/",
  "/feed.atom",
  "/feed.rss",
  "/comments/feed/",
  "/wp-json/",
  "/wp-admin/",
  "/wp-login.php",
  "/xmlrpc.php",
  "/cdn-cgi/",
];

/** Query keys that turn one listing into unbounded copies of itself. */
const BUILDER_PARAM = /^(?:e-page-|e-filter-)|^infinity$/;
/** WooCommerce action endpoints: links that act, not pages. */
const ACTION_PARAMS = new Set(["add-to-cart", "remove_item", "wc-ajax", "wc-api"]);

/** A bare e-mail address written without `mailto:`. */
const BARE_EMAIL = /^[^/\s:?#]+@[^/\s:?#]+\.[a-z]{2,}$/i;
/** An href that carries a scheme (https:, mailto:, tel: …). */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Why a discovered link should not be crawled, or "" when it is a normal page.
 * @param {string} link absolute URL
 * @returns {string}
 */
export function crawlTrapReason(link) {
  /** @type {URL} */
  let u;
  try {
    u = new URL(link);
  } catch {
    return "";
  }
  const path = u.pathname.toLowerCase();
  const fragment = NON_PAGE_PATH_FRAGMENTS.find((f) => path.includes(f) || `${path}/`.endsWith(f));
  if (fragment) return `not a page (${fragment})`;
  if (/\/sitemap(?:_index)?\.xml$/.test(path)) return "not a page (sitemap file)";
  for (const key of u.searchParams.keys()) {
    const k = key.toLowerCase();
    if (BUILDER_PARAM.test(k)) return `page-builder parameter (${k.replace(/-[0-9a-f]{4,}$/, "-*")})`;
    if (ACTION_PARAMS.has(k)) return `action link (?${k})`;
  }
  // The same slug twice is the signature of a path-relative href ("team/"
  // instead of "/team/") resolved against a sub-page: /team/team/team/…
  // Numeric and short segments are exempt so /2026/01/01/ archives resolve.
  const words = path.split("/").filter((s) => s.length >= 4 && !/^\d+$/.test(s));
  const repeated = words.find((s, i) => words.indexOf(s) !== i);
  if (repeated) return `repeated path segment (${repeated})`;
  return "";
}

/**
 * Classify a raw href that is not a usable link. Returns "" for a normal href.
 * - `email`: an address with no `mailto:` (resolves to /page/name@example.com)
 * - `text`: plain text pasted into the href (an address, a Maps Plus Code):
 *   a raw space cannot appear in a URL, and with no scheme it resolves
 *   relative to every page that carries it — one footer link becomes a
 *   phantom 404 under each page of the site.
 * @param {string} raw href as written
 * @returns {"" | "email" | "text"}
 */
export function malformedHrefKind(raw) {
  const href = String(raw ?? "").trim();
  if (!href || href.startsWith("#") || HAS_SCHEME.test(href)) return "";
  if (href.includes("@") && BARE_EMAIL.test(href)) return "email";
  // A path ("/our services/", "./a b", "../x y") is a sloppy but working link:
  // the browser encodes the space. Only space-separated text is not a URL.
  // (Tabs and newlines inside an href are stripped by the URL parser, so only
  // a literal space matters.)
  if (href.includes(" ") && !/^(?:\/|\.\.?\/)/.test(href)) return "text";
  return "";
}

const JUNK_URL = [
  // "undefined" at the very end even glued to the host ("example.comundefined");
  // "null"/"NaN" only as a whole segment or value, so /how-to-handle-null is fine.
  /undefined\/?\s*$/,
  /[/?&=](?:undefined|null|NaN)(?:[/?&#]|$)/,
  /\[object|%5Bobject|%7Bundefined/i,
];

/**
 * True when a URL carries an unresolved template variable — "undefined",
 * "null" or "[object Object]" printed where a value should be. Matched only as
 * a whole segment or at the end, so /blog/undefined-behaviour is a real page.
 * @param {string} url
 * @returns {boolean}
 */
export function hasUnresolvedTemplate(url) {
  const v = String(url ?? "");
  return JUNK_URL.some((re) => re.test(v));
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);
const LOCAL_SUFFIXES = [".localhost", ".local", ".test", ".internal", ".localdomain"];
const PRIVATE_IPV4 =
  /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;
/** Staging labels, only matched on the site's own domain (dev.to is a real site). */
const STAGING_LABELS = new Set(["staging", "stage", "dev", "test", "uat", "preprod", "preview"]);

/**
 * True for a host only a developer can reach (localhost, a private IP, .local,
 * .test …) or a staging copy of the site's own domain (staging.example.com).
 * @param {string} host hostname, lowercased, without port
 * @param {string} siteDomain the audited site's hostname without "www."
 * @returns {boolean}
 */
export function isDevOrStagingHost(host, siteDomain) {
  const h = String(host ?? "").toLowerCase();
  if (!h) return false;
  if (LOCAL_HOSTS.has(h) || LOCAL_SUFFIXES.some((s) => h.endsWith(s)) || PRIVATE_IPV4.test(h)) return true;
  if (!siteDomain) return false;
  const dot = h.indexOf(".");
  if (dot < 0) return false;
  const label = h.slice(0, dot);
  const rest = h.slice(dot + 1).replace(/^www\./, "");
  return STAGING_LABELS.has(label) && rest === siteDomain.replace(/^www\./, "");
}

const SEARCH_PATH = /\/(?:search|search-results|suche|recherche)(?:\/|$)/i;
const SEARCH_KEYS = new Set([
  "s",
  "q",
  "query",
  "search",
  "keyword",
  "keywords",
  "search_query",
  "searchterm",
  "search_term",
]);

/**
 * True when the URL is an internal search results page: thin, infinite (every
 * query mints a new URL) and never meant for an index.
 * @param {string} url
 * @returns {boolean}
 */
export function isInternalSearchUrl(url) {
  try {
    const u = new URL(url);
    if (SEARCH_PATH.test(u.pathname)) return true;
    for (const key of u.searchParams.keys()) if (SEARCH_KEYS.has(key.toLowerCase())) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * True for a paginated listing URL (/page/3/, ?page=2, ?paged=2, ?_page=2).
 * @param {string} url
 * @returns {boolean}
 */
export function isPaginationUrl(url) {
  try {
    const u = new URL(url);
    if (/\/page\/\d+\/?$/.test(u.pathname)) return true;
    return /(?:^|[?&;])\s*_?(?:page|paged|pg)\s*=\s*[2-9]\d*/i.test(u.search);
  } catch {
    return false;
  }
}
