/**
 * one-step-seo — robots.txt / sitemap.xml / llms.txt discovery.
 * Best-effort: never fails the audit if these are missing.
 */
import { fetchText } from "./fetch.mjs";

function originOf(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

function parseRobots(text) {
  const lines = text.split(/\r?\n/);
  const disallows = [];
  const sitemaps = [];
  let aiBlocked = false;
  const aiBots = ["gptbot", "chatgpt-user", "claudebot", "anthropic-ai", "cohere-ai", "perplexitybot", "oai-searchbot", "google-extended"];
  let currentAgents = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [fieldRaw, ...rest] = line.split(":");
    const field = fieldRaw.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (field === "user-agent") {
      currentAgents = [value.toLowerCase()];
    } else if (field === "disallow") {
      disallows.push({ agents: [...currentAgents], path: value });
      if (value === "/" && currentAgents.some((a) => a === "*" || aiBots.includes(a))) {
        aiBlocked = true;
      }
    } else if (field === "sitemap") {
      sitemaps.push(value);
    }
  }
  return { disallows, sitemaps, aiBlocked };
}

function countSitemapUrls(xml) {
  const locs = xml.match(/<loc>\s*([^<]+?)\s*<\/loc>/gi) || [];
  return locs.length;
}

export async function getSiteFiles(pageUrl) {
  const origin = originOf(pageUrl);
  const [robots, sitemap, llms] = await Promise.all([
    fetchText(`${origin}/robots.txt`),
    fetchText(`${origin}/sitemap.xml`),
    fetchText(`${origin}/llms.txt`),
  ]);

  const parsed = robots.ok ? parseRobots(robots.text) : { disallows: [], sitemaps: [], aiBlocked: false };

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
      found: sitemap.ok && sitemap.status === 200 && /<urlset|<sitemapindex/i.test(sitemap.text),
      status: sitemap.status,
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
