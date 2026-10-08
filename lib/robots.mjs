/**
 * one-step-seo — robots.txt / sitemap.xml / llms.txt discovery.
 * Best-effort: never fails the audit if these are missing.
 * Exported parse helpers are pure and unit-tested.
 */
import { fetchText } from "./fetch.mjs";

/**
 * @param {string} url
 * @returns {string}
 */
export function originOf(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

/**
 * Parse robots.txt into disallow rules, Sitemap directives, and
 * whether a known AI crawler is blanket-blocked.
 * @param {string} text
 * @returns {{ disallows: { agents: string[], path: string }[], sitemaps: string[], aiBlocked: boolean }}
 */
export function parseRobots(text) {
  /** @type {{ agents: string[], path: string }[]} */
  const disallows = [];
  /** @type {string[]} */
  const sitemaps = [];
  let aiBlocked = false;
  const aiBots = [
    "gptbot",
    "chatgpt-user",
    "claudebot",
    "claude-web",
    "anthropic-ai",
    "cohere-ai",
    "perplexitybot",
    "oai-searchbot",
    "google-extended",
    "ccbot",
    "bytespider",
    "meta-externalagent",
    "applebot-extended",
    "grok",
    "amazonbot",
  ];
  /** @type {string[]} */
  let currentAgents = [];
  // True while we are still accumulating a consecutive User-agent group.
  let inAgentGroup = false;

  for (const raw of text.split(/\r?\n/)) {
    // Strip inline comments: "Disallow: / # temp" -> "Disallow: /"
    const noComment = raw.split("#")[0];
    if (!noComment) continue;
    const line = noComment.trim();
    if (!line || line.startsWith("#")) continue;
    const [fieldRaw, ...rest] = line.split(":");
    if (!fieldRaw) continue;
    const field = fieldRaw.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (field === "user-agent") {
      if (inAgentGroup) {
        // Consecutive User-agent lines belong to the same group (spec).
        currentAgents.push(value.toLowerCase());
      } else {
        currentAgents = [value.toLowerCase()];
        inAgentGroup = true;
      }
    } else if (field === "disallow") {
      inAgentGroup = false;
      // Empty Disallow means "allow all" — do not count as a disallow.
      if (value === "") continue;
      disallows.push({ agents: [...currentAgents], path: value });
      const blockedPath = value === "/" || value === "/*" || value.startsWith("/?");
      if (blockedPath && currentAgents.some((a) => a === "*" || aiBots.includes(a))) {
        aiBlocked = true;
      }
    } else if (field === "allow") {
      inAgentGroup = false;
    } else if (field === "sitemap" && value) {
      inAgentGroup = false;
      const clean = value.split(/\s+/)[0] ?? "";
      if (/^https?:\/\//i.test(clean)) sitemaps.push(clean);
    } else {
      inAgentGroup = false;
    }
  }
  return { disallows, sitemaps, aiBlocked };
}

/**
 * @param {string} xml
 * @returns {boolean}
 */
export function looksLikeSitemap(xml) {
  if (/<urlset|<sitemapindex/i.test(xml)) return true;
  // Plaintext sitemap: one URL per line.
  const lines = xml
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 0 && lines.every((l) => /^https?:\/\/\S+$/i.test(l))) return true;
  return false;
}

/**
 * Count URLs in a sitemap. Sitemap-index <loc> entries point at child
 * sitemaps, not pages — count only <url><loc> page entries when present.
 * @param {string} xml
 * @returns {number}
 */
export function countSitemapUrls(xml) {
  const isIndex = /<sitemapindex/i.test(xml) && !/<urlset/i.test(xml);
  if (isIndex) {
    const blocks = xml.match(/<sitemap[\s\S]*?<\/sitemap\s*>/gi) || [];
    return blocks.length;
  }
  const locs = xml.match(/<loc>\s*([^<]+?)\s*<\/loc>/gi) || [];
  if (locs.length > 0) return locs.length;
  const lines = xml
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\/\S+$/i.test(l));
  return lines.length;
}

/**
 * Extract page URLs from a sitemap body: `<loc>` entries for a `<urlset>`,
 * child sitemap URLs for a `<sitemapindex>`, or one URL per line for plaintext.
 * @param {string} xml
 * @returns {string[]}
 */
export function extractSitemapUrls(xml) {
  const isIndex = /<sitemapindex/i.test(xml) && !/<urlset/i.test(xml);
  const locs = xml.match(/<loc>\s*([^<]+?)\s*<\/loc>/gi) || [];
  const fromLocs = locs.map((l) => l.replace(/<\/?loc>/gi, "").trim()).filter((u) => /^https?:\/\//i.test(u));
  if (isIndex) return fromLocs;
  if (fromLocs.length > 0) return fromLocs;
  return xml
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\/\S+$/i.test(l));
}

/** Cap on child sitemaps followed when the root sitemap is an index. */
export const MAX_SITEMAP_CHILDREN = 5;
/** Cap on seed URLs returned, so a 100k-URL sitemap cannot explode the queue. */
export const MAX_SITEMAP_SEED_URLS = 500;
// Cache site-file discovery per origin so multi-page crawls don't
// refetch the same robots.txt / sitemap.xml / llms.txt N times.
/** @type {Map<string, Promise<any>>} */
const siteFilesCache = new Map();

/** Clear the getSiteFiles cache (used by tests). */
export function clearSiteFilesCache() {
  siteFilesCache.clear();
}

/**
 * @param {string} pageUrl
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{
 *   origin: string,
 *   robots: { found: boolean, status: number, sitemaps: string[], disallowCount: number, aiBlocked: boolean, textSample: string },
 *   sitemap: { found: boolean, status: number, url: string, urlCount: number, fromRobots: string[], truncated: boolean, text: string },
 *   llms: { found: boolean, status: number, bytes: number }
 * }>}
 */
export async function getSiteFiles(pageUrl, { timeoutMs = 10000 } = {}) {
  const origin = originOf(pageUrl);
  if (!origin) {
    return {
      origin: "",
      robots: { found: false, status: 0, sitemaps: [], disallowCount: 0, aiBlocked: false, textSample: "" },
      sitemap: { found: false, status: 0, url: "", urlCount: 0, fromRobots: [], truncated: false, text: "" },
      llms: { found: false, status: 0, bytes: 0 },
    };
  }
  const cached = siteFilesCache.get(origin);
  if (cached) return cached;
  const pending = fetchSiteFiles(origin, timeoutMs);
  siteFilesCache.set(origin, pending);
  try {
    return await pending;
  } catch (err) {
    siteFilesCache.delete(origin);
    throw err;
  }
}

/**
 * @param {string} origin
 * @param {number} timeoutMs
 */
async function fetchSiteFiles(origin, timeoutMs) {
  const [robots, rootSitemap, llms] = await Promise.all([
    fetchText(`${origin}/robots.txt`, { timeoutMs }),
    fetchText(`${origin}/sitemap.xml`, { timeoutMs }),
    fetchText(`${origin}/llms.txt`, { timeoutMs }),
  ]);

  const parsed = robots.ok ? parseRobots(robots.text) : { disallows: [], sitemaps: [], aiBlocked: false };

  // If /sitemap.xml is missing, follow the first absolute Sitemap:
  // directive declared in robots.txt (e.g. /sitemap_index.xml).
  let sitemap = rootSitemap;
  let sitemapUrl = `${origin}/sitemap.xml`;
  if (!(sitemap.ok && sitemap.status === 200 && looksLikeSitemap(sitemap.text))) {
    const declared = parsed.sitemaps.find((s) => s !== sitemapUrl);
    if (declared) {
      sitemap = await fetchText(declared, { timeoutMs });
      sitemapUrl = declared;
    }
  }

  const robotsTextLower = (robots.text || "").toLowerCase();
  const robotsFound =
    robots.ok &&
    robots.status === 200 &&
    (robotsTextLower.includes("user-agent") || robotsTextLower.includes("sitemap:"));

  return {
    origin,
    robots: {
      found: robotsFound,
      status: robots.status,
      sitemaps: parsed.sitemaps,
      disallowCount: parsed.disallows.length,
      aiBlocked: parsed.aiBlocked,
      textSample: (robots.text || "").slice(0, 2000),
    },
    sitemap: {
      found: sitemap.ok && sitemap.status === 200 && looksLikeSitemap(sitemap.text),
      status: sitemap.status,
      url: sitemapUrl,
      urlCount: sitemap.ok ? countSitemapUrls(sitemap.text) : 0,
      fromRobots: parsed.sitemaps,
      truncated: !!sitemap.truncated,
      text: sitemap.ok ? sitemap.text : "",
    },
    llms: {
      found: llms.ok && llms.status === 200 && (llms.text || "").trim().length > 50,
      status: llms.status,
      bytes: (llms.text || "").length,
    },
  };
}

/** @type {Map<string, Promise<string[]>>} */
const sitemapUrlsCache = new Map();

/** Clear the getSitemapUrls cache (used by tests). */
export function clearSitemapUrlsCache() {
  sitemapUrlsCache.clear();
}

/**
 * Page URLs to seed a `--crawl sitemap` run. Uses the cached site-file
 * discovery, and when the root sitemap is a `<sitemapindex>` follows up to
 * MAX_SITEMAP_CHILDREN child sitemaps. Never throws — returns [] on any
 * failure so the caller can fall back to a link crawl.
 * @param {string} pageUrl
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<string[]>}
 */
export async function getSitemapUrls(pageUrl, { timeoutMs = 10000 } = {}) {
  const origin = originOf(pageUrl);
  if (!origin) return [];
  const cached = sitemapUrlsCache.get(origin);
  if (cached) return cached;
  const pending = (async () => {
    const site = await getSiteFiles(pageUrl, { timeoutMs });
    if (!site.sitemap.found) return [];
    const own = extractSitemapUrls(site.sitemap.text);
    if (own.length > 0) return own.slice(0, MAX_SITEMAP_SEED_URLS);
    // The root is a sitemap index: `own` holds child sitemap URLs.
    const children = own.slice(0, MAX_SITEMAP_CHILDREN);
    if (children.length === 0) return [];
    const bodies = await Promise.all(children.map((c) => fetchText(c, { timeoutMs })));
    /** @type {string[]} */
    const urls = [];
    for (const b of bodies) {
      if (!b.ok) continue;
      for (const u of extractSitemapUrls(b.text)) {
        if (urls.length >= MAX_SITEMAP_SEED_URLS) break;
        urls.push(u);
      }
    }
    return urls;
  })();
  sitemapUrlsCache.set(origin, pending);
  try {
    return await pending;
  } catch {
    sitemapUrlsCache.delete(origin);
    return [];
  }
}
