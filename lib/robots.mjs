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
  "chatgpt-agent",
  "oai-searchbot",
  "claudebot",
  "claude-web",
  "claude-searchbot",
  "claude-user",
  "anthropic-ai",
  "cohere-ai",
  "perplexitybot",
  "perplexity-user",
  "google-extended",
  "googleother",
  "ccbot",
  "bytespider",
  "meta-externalagent",
  "meta-externalfetcher",
  "facebookbot",
  "applebot",
  "applebot-extended",
  "amazonbot",
  "amzn-user",
  "mistralai-user",
  "grok",
];

/**
 * Parse robots.txt into disallow rules, Sitemap directives, whether a known
 * AI crawler is blanket-blocked, and which AI tokens those blocks name.
 * @param {string} text
 * @returns {{ disallows: { agents: string[], path: string }[], sitemaps: string[], aiBlocked: boolean, blockedBots: string[] }}
 */
export function parseRobots(text) {
  /** @type {{ agents: string[], path: string }[]} */
  const disallows = [];
  /** @type {string[]} */
  const sitemaps = [];
  let aiBlocked = false;
  const aiBots = AI_BOTS;
  /** @type {Set<string>} */
  const blockedBots = new Set();
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
        for (const a of currentAgents) {
          if (a === "*" || aiBots.includes(a)) blockedBots.add(a);
        }
      }
    } else if (field === "allow") {
      inAgentGroup = false;
      if (value === "/" || value === "/*") {
        for (const a of currentAgents) {
          if (a === "*" || aiBots.includes(a)) {
            blockedBots.delete(a);
          }
        }
        aiBlocked = blockedBots.size > 0;
      }
    } else if (field === "sitemap" && value) {
      inAgentGroup = false;
      const clean = value.split(/\s+/)[0] ?? "";
      if (/^https?:\/\//i.test(clean)) sitemaps.push(clean);
    } else {
      inAgentGroup = false;
    }
  }
  return { disallows, sitemaps, aiBlocked, blockedBots: [...blockedBots] };
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
 * Matching is case-sensitive and covers the path plus query string (RFC 9309:
 * `Disallow: /*?sort=` must block "/list?sort=asc"). Callers pass
 * pathname + search; a fragment is never part of the match.
 * @param {string} rule
 * @param {string} path
 * @returns {boolean}
 */
export function robotsRuleMatches(rule, path) {
  const clean = String(path || "/").split("#")[0] || "/";
  let pattern = String(rule || "");
  let anchored = false;
  if (pattern.endsWith("$")) {
    anchored = true;
    pattern = pattern.slice(0, -1);
  }
  // Linear-time glob match. robots.txt is attacker-controlled input, and
  // compiling "/*a*a*a*a$" into a RegExp with several `.*` runs backtracks
  // catastrophically on a long path (ReDoS). Greedy segment search is O(n·m).
  const segments = pattern.split("*");
  const first = segments[0] ?? "";
  if (!clean.startsWith(first)) return false;
  if (segments.length === 1) return anchored ? clean === first : true;
  let pos = first.length;
  const last = segments[segments.length - 1] ?? "";
  for (let i = 1; i < segments.length - 1; i++) {
    const seg = segments[i] ?? "";
    if (!seg) continue;
    const at = clean.indexOf(seg, pos);
    if (at < 0) return false;
    pos = at + seg.length;
  }
  if (!anchored) return last === "" || clean.indexOf(last, pos) >= 0;
  return clean.length - last.length >= pos && clean.endsWith(last);
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
 * Unescapes standard XML entities and strips CDATA delimiters.
 * @param {string} xml
 * @returns {string[]}
 */
export function extractSitemapUrls(xml) {
  const locMatches = xml.match(/<loc>([\s\S]*?)<\/loc>/gi) || [];
  const fromLocs = locMatches
    .map((match) => {
      let content = match.replace(/<\/?loc>/gi, "").trim();
      // Handle CDATA: <![CDATA[https://...]]>
      content = content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").trim();
      // Unescape XML entities
      content = content
        .replace(/&amp;/g, "&")
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
      return content.trim();
    })
    .filter((u) => /^https?:\/\//i.test(u));
  if (isSitemapIndex(xml)) return fromLocs;
  if (fromLocs.length > 0) return fromLocs;
  return xml
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\/\S+$/i.test(l));
}

/** Cap on child sitemaps followed when the root sitemap is an index. */
export const MAX_SITEMAP_CHILDREN = 20;
/**
 * True when a response body is an HTML document (e.g. a single-page app's
 * catch-all shell served for /sitemap.xml or /llms.txt with HTTP 200).
 * @param {string} text
 * @returns {boolean}
 */
export function isHtmlDocument(text) {
  return /^\s*(?:<!--[\s\S]*?-->\s*)*<(?:!doctype\s+html|html[\s>]|head[\s>])/i.test(
    String(text || "").slice(0, 2048),
  );
}

/** Cap on seed URLs returned, so a 100k-URL sitemap cannot explode the queue. */
export const MAX_SITEMAP_SEED_URLS = 1000;
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
 * @param {{ timeoutMs?: number, userAgent?: string, blockPrivateIps?: boolean }} [opts]
 * @returns {Promise<{
 *   origin: string,
 *   robots: { found: boolean, status: number, sitemaps: string[], disallowCount: number, aiBlocked: boolean, blockedBots: string[], textSample: string, text: string },
 *   sitemap: { found: boolean, status: number, url: string, urlCount: number, fromRobots: string[], truncated: boolean, text: string, servesHtml?: boolean },
 *   llms: { found: boolean, status: number, bytes: number, text: string, servesHtml?: boolean }
 * }>}
 */
export async function getSiteFiles(pageUrl, { timeoutMs = 10000, userAgent, blockPrivateIps = false } = {}) {
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
        blockedBots: [],
        textSample: "",
        text: "",
      },
      sitemap: { found: false, status: 0, url: "", urlCount: 0, fromRobots: [], truncated: false, text: "" },
      llms: { found: false, status: 0, bytes: 0, text: "" },
    };
  }
  const cacheKey = `${origin}#${blockPrivateIps ? "blocked" : "all"}`;
  const cached = siteFilesCache.get(cacheKey);
  if (cached) return cached;
  const pending = fetchSiteFiles(origin, timeoutMs, userAgent, blockPrivateIps);
  siteFilesCache.set(cacheKey, pending);
  try {
    return await pending;
  } catch (err) {
    siteFilesCache.delete(cacheKey);
    throw err;
  }
}

/**
 * @param {string} origin
 * @param {number} timeoutMs
 * @param {string} [userAgent]
 * @param {boolean} [blockPrivateIps]
 */
async function fetchSiteFiles(origin, timeoutMs, userAgent, blockPrivateIps = false) {
  const extra = {
    ...(userAgent ? { userAgent } : {}),
    ...(blockPrivateIps ? { blockPrivateIps: true } : {}),
  };
  const [robots, rootSitemap, llms] = await Promise.all([
    fetchText(`${origin}/robots.txt`, { timeoutMs, ...extra }),
    fetchText(`${origin}/sitemap.xml`, { timeoutMs, ...extra }),
    fetchText(`${origin}/llms.txt`, { timeoutMs, ...extra }),
  ]);

  const parsed = robots.ok
    ? parseRobots(robots.text)
    : { disallows: [], sitemaps: [], aiBlocked: false, blockedBots: [] };

  // If /sitemap.xml is missing, follow the first absolute Sitemap:
  // directive declared in robots.txt (e.g. /sitemap_index.xml), or probe /sitemap_index.xml.
  let sitemap = rootSitemap;
  let sitemapUrl = `${origin}/sitemap.xml`;
  if (!(sitemap.ok && sitemap.status === 200 && looksLikeSitemap(sitemap.text))) {
    const declared = parsed.sitemaps.find((s) => s !== sitemapUrl);
    if (declared) {
      sitemap = await fetchText(declared, { timeoutMs, ...extra });
      sitemapUrl = declared;
    } else {
      const idxCandidate = `${origin}/sitemap_index.xml`;
      const idxRes = await fetchText(idxCandidate, { timeoutMs, ...extra });
      if (idxRes.ok && idxRes.status === 200 && looksLikeSitemap(idxRes.text)) {
        sitemap = idxRes;
        sitemapUrl = idxCandidate;
      }
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
      blockedBots: parsed.blockedBots,
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
      // 200 + an HTML page (SPA catch-all / soft 404) instead of XML.
      servesHtml: sitemap.ok && sitemap.status === 200 && isHtmlDocument(sitemap.text),
      text: sitemap.ok ? sitemap.text : "",
    },
    llms: {
      // Single-page apps answer every unknown path with their HTML shell
      // (HTTP 200): that is not an llms.txt.
      found:
        llms.ok && llms.status === 200 && (llms.text || "").trim().length > 50 && !isHtmlDocument(llms.text),
      servesHtml: llms.ok && llms.status === 200 && isHtmlDocument(llms.text),
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
 * @param {{ timeoutMs?: number, userAgent?: string, blockPrivateIps?: boolean }} [opts]
 * @returns {Promise<string[]>}
 */
export async function getSitemapUrls(
  pageUrl,
  { timeoutMs = 10000, userAgent, blockPrivateIps = false } = {},
) {
  const origin = originOf(pageUrl);
  if (!origin) return [];
  const cacheKey = `${origin}#${blockPrivateIps ? "blocked" : "all"}`;
  const cached = sitemapUrlsCache.get(cacheKey);
  if (cached) return cached;
  const pending = (async () => {
    const site = await getSiteFiles(pageUrl, { timeoutMs, userAgent, blockPrivateIps });
    if (!site.sitemap.found && site.robots.sitemaps.length === 0) return [];
    // Sitemaps must only list same-origin URLs (spec). A malformed or hostile
    // sitemap could seed cross-host pages into the crawl queue — drop them.
    const sameOrigin = /** @param {string} u @returns {boolean} */ (u) => originOf(u) === origin;
    const extra = {
      ...(userAgent ? { userAgent } : {}),
      ...(blockPrivateIps ? { blockPrivateIps: true } : {}),
    };

    /** @type {Set<string>} */
    const seenUrls = new Set();
    /** @type {string[]} */
    const urls = [];

    /**
     * Parse and ingest URLs from a sitemap body (urlset or sitemapindex).
     * @param {string} text
     * @returns {Promise<void>}
     */
    const ingestSitemapText = async (text) => {
      const locs = extractSitemapUrls(text).filter(sameOrigin);
      if (isSitemapIndex(text)) {
        const children = locs.slice(0, MAX_SITEMAP_CHILDREN);
        if (children.length === 0) return;
        const bodies = await Promise.all(children.map((c) => fetchText(c, { timeoutMs, ...extra })));
        for (const b of bodies) {
          if (!b.ok) continue;
          for (const u of extractSitemapUrls(b.text)) {
            if (!sameOrigin(u) || seenUrls.has(u)) continue;
            seenUrls.add(u);
            urls.push(u);
            if (urls.length >= MAX_SITEMAP_SEED_URLS) return;
          }
        }
      } else {
        for (const u of locs) {
          if (seenUrls.has(u)) continue;
          seenUrls.add(u);
          urls.push(u);
          if (urls.length >= MAX_SITEMAP_SEED_URLS) return;
        }
      }
    };

    // First process primary discovered sitemap
    if (site.sitemap.found && site.sitemap.text) {
      await ingestSitemapText(site.sitemap.text);
    }

    // Then process any other sitemaps declared in robots.txt that differ from site.sitemap.url
    for (const smUrl of site.robots.sitemaps) {
      if (urls.length >= MAX_SITEMAP_SEED_URLS) break;
      if (site.sitemap.found && smUrl === site.sitemap.url) continue;
      if (!sameOrigin(smUrl)) continue;
      const res = await fetchText(smUrl, { timeoutMs, ...extra });
      if (res.ok && looksLikeSitemap(res.text)) {
        await ingestSitemapText(res.text);
      }
    }

    return urls.slice(0, MAX_SITEMAP_SEED_URLS);
  })();
  sitemapUrlsCache.set(cacheKey, pending);
  try {
    return await pending;
  } catch {
    sitemapUrlsCache.delete(cacheKey);
    return [];
  }
}
