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
 * Known AI crawler tokens (lowercase) used for the G02-ai-blocked check and
 * the `llms` command's robots.txt snippet. Shared so the list lives in one
 * place instead of being re-derived by every consumer.
 * @type {string[]}
 */
export const AI_BOTS = [
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
  const aiBots = AI_BOTS;
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
 * A robots.txt group: the User-agent lines plus their Allow/Disallow rules
 * in file order. Parsed separately from parseRobots() because enforcement
 * needs Allow rules and group structure, not just a flat disallow list.
 * @typedef {{ agents: string[], rules: { type: "allow" | "disallow", path: string }[] }} RobotsGroup
 */

/**
 * Parse robots.txt into User-agent groups with their Allow/Disallow rules.
 * Consecutive User-agent lines form one group (spec); a rule line closes the
 * current agent run so a following User-agent starts a new group. Empty
 * Disallow (allow-all) is kept as a rule — callers decide how to treat it.
 * @param {string} text
 * @returns {RobotsGroup[]}
 */
export function parseRobotsGroups(text) {
  /** @type {RobotsGroup[]} */
  const groups = [];
  /** @type {string[]} */
  let agents = [];
  /** @type {{ type: "allow" | "disallow", path: string }[]} */
  let rules = [];
  let hasRules = false;
  const flush = () => {
    if (agents.length > 0) groups.push({ agents, rules });
    agents = [];
    rules = [];
    hasRules = false;
  };
  for (const raw of String(text || "").split(/\r?\n/)) {
    const noComment = raw.split("#")[0] ?? "";
    const line = noComment.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (hasRules) flush();
      if (value) agents.push(value.toLowerCase());
    } else if (field === "disallow" || field === "allow") {
      if (agents.length === 0) continue;
      hasRules = true;
      rules.push({ type: field, path: value.split(/\s+/)[0] ?? "" });
    }
  }
  flush();
  return groups;
}

/**
 * Test one robots path rule against a URL path (Google-spec subset):
 * `*` matches any run of characters, a trailing `$` anchors the end.
 * Matching is case-sensitive on the path; the query string is ignored.
 * @param {string} rule
 * @param {string} path
 * @returns {boolean}
 */
export function robotsRuleMatches(rule, path) {
  const clean = String(path || "/").split("?")[0] || "/";
  let pattern = String(rule || "");
  let anchored = false;
  if (pattern.endsWith("$")) {
    anchored = true;
    pattern = pattern.slice(0, -1);
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const re = new RegExp(`^${escaped}${anchored ? "$" : ""}`);
  return re.test(clean);
}

/**
 * True when robots.txt disallows `uaToken` from fetching `path`.
 * Group selection: an exact (case-insensitive) token match wins, else the
 * `*` group applies. Within the group the longest matching rule wins;
 * an Allow ties a Disallow (Allow wins ties, per Google).
 * @param {string} text raw robots.txt
 * @param {string} uaToken crawler product token, e.g. "one-step-seo"
 * @param {string} path URL path to test, e.g. "/pricing"
 * @returns {boolean}
 */
export function isDisallowed(text, uaToken, path) {
  const groups = parseRobotsGroups(text);
  if (groups.length === 0) return false;
  const token = String(uaToken || "").toLowerCase();
  const specific = groups.filter((g) => g.agents.includes(token));
  const applicable = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));
  if (applicable.length === 0) return false;
  let bestLen = -1;
  let bestAllow = false;
  for (const g of applicable) {
    for (const r of g.rules) {
      if (!r.path) continue;
      if (!robotsRuleMatches(r.path, path)) continue;
      const len = r.path.length;
      if (len > bestLen || (len === bestLen && r.type === "allow")) {
        bestLen = len;
        bestAllow = r.type === "allow";
      }
    }
  }
  return bestLen >= 0 && !bestAllow;
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
  if (isSitemapIndex(xml)) {
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
 * True when the body is a `<sitemapindex>` (pointing at child sitemaps) rather
 * than a `<urlset>` (pointing at pages). Shared so the index test lives in one
 * place instead of being re-derived by every consumer.
 * @param {string} xml
 * @returns {boolean}
 */
export function isSitemapIndex(xml) {
  return /<sitemapindex/i.test(xml) && !/<urlset/i.test(xml);
}

/**
 * Extract page URLs from a sitemap body: `<loc>` entries for a `<urlset>`,
 * child sitemap URLs for a `<sitemapindex>`, or one URL per line for plaintext.
 * @param {string} xml
 * @returns {string[]}
 */
export function extractSitemapUrls(xml) {
  const locs = xml.match(/<loc>\s*([^<]+?)\s*<\/loc>/gi) || [];
  const fromLocs = locs.map((l) => l.replace(/<\/?loc>/gi, "").trim()).filter((u) => /^https?:\/\//i.test(u));
  if (isSitemapIndex(xml)) return fromLocs;
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
 * @param {{ timeoutMs?: number, userAgent?: string }} [opts]
 * @returns {Promise<{
 *   origin: string,
 *   robots: { found: boolean, status: number, sitemaps: string[], disallowCount: number, aiBlocked: boolean, textSample: string, text: string },
 *   sitemap: { found: boolean, status: number, url: string, urlCount: number, fromRobots: string[], truncated: boolean, text: string },
 *   llms: { found: boolean, status: number, bytes: number, text: string }
 * }>}
 */
export async function getSiteFiles(pageUrl, { timeoutMs = 10000, userAgent } = {}) {
  const origin = originOf(pageUrl);
  if (!origin) {
    return {
      origin: "",
      robots: {
        found: false,
        status: 0,
        sitemaps: [],
        disallowCount: 0,
        aiBlocked: false,
        textSample: "",
        text: "",
      },
      sitemap: { found: false, status: 0, url: "", urlCount: 0, fromRobots: [], truncated: false, text: "" },
      llms: { found: false, status: 0, bytes: 0, text: "" },
    };
  }
  const cached = siteFilesCache.get(origin);
  if (cached) return cached;
  const pending = fetchSiteFiles(origin, timeoutMs, userAgent);
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
 * @param {string} [userAgent]
 */
async function fetchSiteFiles(origin, timeoutMs, userAgent) {
  const extra = userAgent ? { userAgent } : {};
  const [robots, rootSitemap, llms] = await Promise.all([
    fetchText(`${origin}/robots.txt`, { timeoutMs, ...extra }),
    fetchText(`${origin}/sitemap.xml`, { timeoutMs, ...extra }),
    fetchText(`${origin}/llms.txt`, { timeoutMs, ...extra }),
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
      // Full text powers crawl-time Disallow enforcement in bin/cli.mjs.
      // buildReport() only picks the scalar fields, so this never lands in
      // report.json.
      text: robots.text || "",
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
      // Full text powers the G05-llms-quality structure signal.
      text: llms.text || "",
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
 * @param {{ timeoutMs?: number, userAgent?: string }} [opts]
 * @returns {Promise<string[]>}
 */
export async function getSitemapUrls(pageUrl, { timeoutMs = 10000, userAgent } = {}) {
  const origin = originOf(pageUrl);
  if (!origin) return [];
  const cached = sitemapUrlsCache.get(origin);
  if (cached) return cached;
  const pending = (async () => {
    const site = await getSiteFiles(pageUrl, { timeoutMs, userAgent });
    if (!site.sitemap.found) return [];
    // Sitemaps must only list same-origin URLs (spec). A malformed or hostile
    // sitemap could seed cross-host pages into the crawl queue — drop them.
    const sameOrigin = /** @param {string} u @returns {boolean} */ (u) => originOf(u) === origin;
    const locs = extractSitemapUrls(site.sitemap.text).filter(sameOrigin);
    // Must branch on the sitemap *shape*, not on `locs.length`: an index also
    // has non-empty `<loc>` entries (they point at child sitemaps), so an
    // early `locs.length > 0` return silently handed child-sitemap URLs to the
    // crawler as if they were pages.
    if (isSitemapIndex(site.sitemap.text)) {
      const children = locs.slice(0, MAX_SITEMAP_CHILDREN);
      if (children.length === 0) return [];
      const bodies = await Promise.all(children.map((c) => fetchText(c, { timeoutMs, userAgent })));
      /** @type {string[]} */
      const urls = [];
      for (const b of bodies) {
        if (!b.ok) continue;
        for (const u of extractSitemapUrls(b.text)) {
          if (!sameOrigin(u)) continue;
          if (urls.length >= MAX_SITEMAP_SEED_URLS) break;
          urls.push(u);
        }
      }
      return urls;
    }
    return locs.slice(0, MAX_SITEMAP_SEED_URLS);
  })();
  sitemapUrlsCache.set(origin, pending);
  try {
    return await pending;
  } catch {
    sitemapUrlsCache.delete(origin);
    return [];
  }
}
