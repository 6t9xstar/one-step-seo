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
function originOf(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
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
    "anthropic-ai",
    "cohere-ai",
    "perplexitybot",
    "oai-searchbot",
    "google-extended",
  ];
  /** @type {string[]} */
  let currentAgents = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [fieldRaw, ...rest] = line.split(":");
    if (!fieldRaw) continue;
    const field = fieldRaw.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (field === "user-agent") {
      currentAgents = [value.toLowerCase()];
    } else if (field === "disallow") {
      disallows.push({ agents: [...currentAgents], path: value });
      if (value === "/" && currentAgents.some((a) => a === "*" || aiBots.includes(a))) {
        aiBlocked = true;
      }
    } else if (field === "sitemap" && value) {
      if (/^https?:\/\//i.test(value)) sitemaps.push(value);
    }
  }
  return { disallows, sitemaps, aiBlocked };
}

/**
 * @param {string} xml
 * @returns {boolean}
 */
export function looksLikeSitemap(xml) {
  return /<urlset|<sitemapindex/i.test(xml);
}

/**
 * @param {string} xml
 * @returns {number}
 */
export function countSitemapUrls(xml) {
  const locs = xml.match(/<loc>\s*([^<]+?)\s*<\/loc>/gi) || [];
  return locs.length;
}

/**
 * @param {string} pageUrl
 * @returns {Promise<{
 *   origin: string,
 *   robots: { found: boolean, status: number, sitemaps: string[], disallowCount: number, aiBlocked: boolean, textSample: string },
 *   sitemap: { found: boolean, status: number, url: string, urlCount: number, fromRobots: string[] },
 *   llms: { found: boolean, status: number, bytes: number }
 * }>}
 */
export async function getSiteFiles(pageUrl) {
  const origin = originOf(pageUrl);
  const [robots, rootSitemap, llms] = await Promise.all([
    fetchText(`${origin}/robots.txt`),
    fetchText(`${origin}/sitemap.xml`),
    fetchText(`${origin}/llms.txt`),
  ]);

  const parsed = robots.ok ? parseRobots(robots.text) : { disallows: [], sitemaps: [], aiBlocked: false };

  // If /sitemap.xml is missing, follow the first absolute Sitemap:
  // directive declared in robots.txt (e.g. /sitemap_index.xml).
  let sitemap = rootSitemap;
  let sitemapUrl = `${origin}/sitemap.xml`;
  if (!(sitemap.ok && sitemap.status === 200 && looksLikeSitemap(sitemap.text))) {
    const declared = parsed.sitemaps.find((s) => s !== sitemapUrl);
    if (declared) {
      sitemap = await fetchText(declared);
      sitemapUrl = declared;
    }
  }

  return {
    origin,
    robots: {
      found: robots.ok && robots.status === 200 && robots.text.toLowerCase().includes("user-agent"),
      status: robots.status,
      sitemaps: parsed.sitemaps,
      disallowCount: parsed.disallows.length,
      aiBlocked: parsed.aiBlocked,
      textSample: robots.text.slice(0, 2000),
    },
    sitemap: {
      found: sitemap.ok && sitemap.status === 200 && looksLikeSitemap(sitemap.text),
      status: sitemap.status,
      url: sitemapUrl,
      urlCount: sitemap.ok ? countSitemapUrls(sitemap.text) : 0,
      fromRobots: parsed.sitemaps,
    },
    llms: {
      found: llms.ok && llms.status === 200 && llms.text.trim().length > 50,
      status: llms.status,
      bytes: llms.text.length,
    },
  };
}
