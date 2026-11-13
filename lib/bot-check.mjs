/**
 * one-step-seo — crawler readability check ("what do crawlers get?").
 *
 * Ported from Open SEO Crawler (MIT, Copyright (c) 2026 Puneet Inder Singh;
 * see THIRD_PARTY_NOTICES.md). Each page in a small sample is requested as a
 * browser and with the user agent each search and AI crawler operator
 * publishes, and every answer is compared with the browser's: turned away,
 * challenged, sent elsewhere, a noindex aimed at that crawler, a different
 * status, title, H1, canonical or text, or a thinner page. Googlebot
 * smartphone is also compared with Googlebot desktop (mobile-first indexing).
 *
 * The requests come from this machine with a crawler's user agent. CDNs and
 * firewalls verify real crawlers by IP address or signature, so a block, a
 * challenge or a clean pass here can differ from what the real crawler gets,
 * in either direction. Results are leads to confirm (for Googlebot, with the
 * URL Inspection live test in Search Console), never "what Googlebot sees".
 *
 * Differences from the original: TLS certificates are always verified; a
 * crawler that robots.txt disallows from a page is reported as disallowed and
 * not requested under its name (unless forced); JavaScript is never rendered,
 * so a page served as an empty app shell is pointed out instead.
 */
import { fetchWithRedirects } from "./fetch.mjs";
import { parseAttributes, parseHtml } from "./html.mjs";
import { maskRawText, parseXRobots, robotsDirectives } from "./page-checks.mjs";
import { isDisallowed, parseRobotsGroups } from "./robots.mjs";
import { detectWafBlock, headerValue, isChallengeResponse } from "./throttle.mjs";

/** @typedef {"search" | "ai-search" | "ai-assistant" | "training"} BotKind */

/**
 * @typedef {object} BotAgent
 * @property {string} id
 * @property {string} label
 * @property {BotKind} kind
 * @property {string} token robots.txt product token
 * @property {string} userAgent
 */

/**
 * @typedef {object} RobotsOnlyAgent
 * @property {string} id
 * @property {string} label
 * @property {BotKind} kind
 * @property {string} token
 */

const CHROME = "132.0.0.0";

/** User agent of the browser request every crawler's answer is compared with. */
export const BROWSER_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36`;

/**
 * Crawlers requested live, with the user agent each operator publishes (as
 * checked by Open SEO Crawler against the operators' own pages, 2026-10-15).
 * Googlebot desktop is requested to compare with Googlebot smartphone; Google
 * indexes the smartphone version.
 * @type {readonly BotAgent[]}
 */
export const BOT_AGENTS = Object.freeze([
  {
    id: "googlebot",
    label: "Googlebot smartphone",
    kind: "search",
    token: "Googlebot",
    userAgent: `Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`,
  },
  {
    id: "googlebot-desktop",
    label: "Googlebot desktop",
    kind: "search",
    token: "Googlebot",
    userAgent: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/${CHROME} Safari/537.36`,
  },
  {
    id: "bingbot",
    label: "Bingbot",
    kind: "search",
    token: "Bingbot",
    userAgent: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/${CHROME} Safari/537.36`,
  },
  {
    id: "applebot",
    label: "Applebot",
    kind: "search",
    token: "Applebot",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
  },
  {
    id: "oai-searchbot",
    label: "OAI-SearchBot",
    kind: "ai-search",
    token: "OAI-SearchBot",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot",
  },
  {
    id: "perplexitybot",
    label: "PerplexityBot",
    kind: "ai-search",
    token: "PerplexityBot",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  },
  {
    id: "chatgpt-user",
    label: "ChatGPT-User",
    kind: "ai-assistant",
    token: "ChatGPT-User",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  },
  {
    id: "gptbot",
    label: "GPTBot",
    kind: "training",
    token: "GPTBot",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot",
  },
  {
    id: "ccbot",
    label: "CCBot",
    kind: "training",
    token: "CCBot",
    userAgent: "CCBot/2.0 (https://commoncrawl.org/faq/)",
  },
]);

/**
 * robots.txt tokens with no published user agent, or that are not crawlers
 * at all (Google-Extended and Applebot-Extended only control how data the
 * main crawler collected may be used): only their robots.txt rules are read.
 * @type {readonly RobotsOnlyAgent[]}
 */
export const BOT_ROBOTS_ONLY = Object.freeze([
  { id: "claudebot", label: "ClaudeBot", kind: "training", token: "ClaudeBot" },
  { id: "claude-searchbot", label: "Claude-SearchBot", kind: "ai-search", token: "Claude-SearchBot" },
  { id: "claude-user", label: "Claude-User", kind: "ai-assistant", token: "Claude-User" },
  { id: "google-extended", label: "Google-Extended", kind: "training", token: "Google-Extended" },
  { id: "applebot-extended", label: "Applebot-Extended", kind: "training", token: "Applebot-Extended" },
]);

/** Pages a sample holds by default, and the most one check accepts. */
export const BOT_SAMPLE_PAGES = 10;
export const MAX_BOT_PAGES = 25;

/** Statuses that mean the request was turned away rather than answered. */
const BLOCK_STATUSES = new Set([401, 403, 429, 503]);

/** Worst first: the state an agent's verdict takes when its pages disagree. */
const VERDICT_ORDER = [
  "blocked",
  "challenged",
  "noindex",
  "different",
  "redirected",
  "thinner",
  "error",
  "disallowed",
];

/**
 * @param {unknown} s
 * @returns {string}
 */
const clean = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Comparable form of a URL: no fragment, no trailing slash on a path.
 * @param {string} url
 * @returns {string}
 */
function urlKey(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch {
    return String(url ?? "");
  }
}

/**
 * @param {string} url
 * @returns {string[]}
 */
function pathSegments(url) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Whether robots.txt lets `token` fetch `url`. The group naming the crawler
 * applies, else `*`; the longest matching rule wins and a tie goes to Allow.
 * Applebot follows Googlebot's group when robots.txt does not name Applebot
 * (Apple's documentation).
 * @param {string} robotsText
 * @param {string} token
 * @param {string} url absolute URL
 * @returns {boolean}
 */
export function botRobotsAllowed(robotsText, token, url) {
  if (!robotsText) return true;
  let path = "/";
  try {
    const u = new URL(url);
    path = (u.pathname || "/") + u.search;
  } catch {
    return true;
  }
  let t = String(token || "").toLowerCase();
  if (t === "applebot") {
    const named = new Set(parseRobotsGroups(robotsText).flatMap((g) => g.agents));
    if (!named.has("applebot") && named.has("googlebot")) t = "googlebot";
  }
  return !isDisallowed(robotsText, t, path);
}

/**
 * @typedef {object} SamplePage
 * @property {string} finalUrl
 * @property {number} status
 * @property {string} [key]
 * @property {boolean} [noindex]
 * @property {string} [canonicalKey]
 * @property {string} [contentHash]
 */

/**
 * Pages for the check: the start page, then one page from each top-level
 * section (shallowest first), then the shallowest pages left. Only pages that
 * answered 200, are indexable and are not canonicalised elsewhere count, and
 * the same body under two URLs (/ and /index.html) is taken once.
 * @param {SamplePage[]} pages crawled pages, start page first
 * @param {number} [n]
 * @returns {string[]}
 */
export function sampleBotPages(pages, n = BOT_SAMPLE_PAGES) {
  const eligible = pages.filter(
    (p) =>
      p.status === 200 &&
      !p.noindex &&
      /^https?:\/\//i.test(p.finalUrl) &&
      (!p.canonicalKey || !p.key || p.canonicalKey === p.key),
  );
  const [first, ...rest] = eligible;
  if (!first) return [];
  const depth = (/** @type {SamplePage} */ p) => pathSegments(p.finalUrl).length;
  const ordered = [
    first,
    ...rest.sort((a, b) => depth(a) - depth(b) || a.finalUrl.length - b.finalUrl.length),
  ];
  /** @type {string[]} */
  const chosen = [];
  const seen = new Set();
  const bodies = new Set();
  const sections = new Set();
  /** @param {SamplePage} p @returns {boolean} */
  const take = (p) => {
    const k = urlKey(p.finalUrl);
    if (seen.has(k) || (p.contentHash && bodies.has(p.contentHash))) return false;
    chosen.push(p.finalUrl);
    seen.add(k);
    if (p.contentHash) bodies.add(p.contentHash);
    return true;
  };
  for (const p of ordered) {
    if (chosen.length >= n) break;
    const section = (pathSegments(p.finalUrl)[0] ?? "").toLowerCase();
    if ((chosen.length === 0 || !sections.has(section)) && take(p)) sections.add(section);
  }
  for (const p of ordered) {
    if (chosen.length >= n) break;
    take(p);
  }
  return chosen;
}

/**
 * Contents of every meta tag named `name`, joined with ", ". Comments,
 * scripts and styles are skipped.
 * @param {string} html
 * @param {string} name lowercase
 * @returns {string}
 */
function metaContent(html, name) {
  /** @type {string[]} */
  const parts = [];
  for (const m of maskRawText(html).matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const attrs = parseAttributes(m[0]);
    if ((attrs.name ?? "").trim().toLowerCase() === name) parts.push(attrs.content ?? "");
  }
  return parts.join(", ");
}

/**
 * @typedef {object} BotRead
 * @property {string} title
 * @property {string} h1
 * @property {string} canonical absolute canonical URL ("" when absent)
 * @property {boolean} noindex
 * @property {number} words
 * @property {Set<string>} shingles 3-word shingles of the first 5,000 words
 * @property {boolean} appShell almost no text, the way client-rendered apps are served
 */

/**
 * The fields compared between agents, read from one response. The title is
 * compared on its own and is not part of the text, so one changed title does
 * not also read as changed copy.
 * @param {string} html
 * @param {Record<string, string>} headers
 * @param {string} url the URL that answered (canonical base)
 * @param {string} [token] crawler whose own meta tag and X-Robots-Tag lines also apply
 * @returns {BotRead}
 */
export function readBotResponse(html, headers, url, token = "") {
  const parsed = parseHtml(String(html ?? ""), url);
  const directives = robotsDirectives(parsed.robotsMeta);
  const header = parseXRobots(headerValue(headers, "x-robots-tag"));
  for (const d of header.get("") ?? []) directives.add(d);
  const t = String(token || "").toLowerCase();
  if (t) {
    for (const d of robotsDirectives(metaContent(String(html ?? ""), t))) directives.add(d);
    for (const d of header.get(t) ?? []) directives.add(d);
  }
  const words = String(parsed.visibleText ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const low = words.slice(0, 5000).map((w) => w.toLowerCase());
  /** @type {Set<string>} */
  const shingles = new Set();
  for (let i = 0; i + 2 < low.length; i++) shingles.add(`${low[i]} ${low[i + 1]} ${low[i + 2]}`);
  return {
    title: clean(parsed.title),
    h1: clean(parsed.h1s?.[0]?.text),
    canonical: String(parsed.canonical ?? ""),
    noindex: directives.has("noindex") || directives.has("none"),
    words: words.length,
    shingles,
    appShell: Boolean(parsed.appShell),
  };
}

/**
 * Jaccard similarity of two shingle sets (1 when both are empty).
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number}
 */
export function shingleSimilarity(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const s of a) if (b.has(s)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * @typedef {object} BotSnapshot one response, as the comparison needs it
 * @property {number} status HTTP status of the final answer (0 = none)
 * @property {string} finalUrl
 * @property {string} html body of a 2xx HTML answer ("" otherwise)
 * @property {Record<string, string>} headers lowercased
 * @property {boolean} challenge a CDN bot challenge answered
 * @property {string} cdn "Cloudflare" or "CDN" when challenged
 * @property {string} waf firewall whose block page answered ("" when none)
 * @property {string} error why there was no answer ("" when there was)
 */

/**
 * @typedef {"same" | "blocked" | "challenged" | "different" | "redirected" | "noindex" | "thinner" | "error" | "disallowed"} BotState
 */

/**
 * @typedef {object} BotCell one crawler's result on one page
 * @property {BotState} state
 * @property {number} status HTTP status the request got (0 = no answer, or not requested)
 * @property {string} detail
 * @property {string[]} [fields] what differs: status, title, h1, canonical, text
 * @property {number} [words]
 * @property {number} [similarity] text similarity with the browser's page (0–1)
 */

/**
 * Compare one crawler's answer with the browser's.
 * @param {BotSnapshot} base the browser's answer
 * @param {BotRead} baseRead
 * @param {BotSnapshot} snap the crawler's answer
 * @param {BotRead | null} read null when there was no answer
 * @param {number} selfSimilarity how alike two browser requests were (rotating banners, dates)
 * @returns {BotCell}
 */
export function compareWithBrowser(base, baseRead, snap, read, selfSimilarity) {
  if (snap.error || !read)
    return { state: "error", status: 0, detail: (snap.error || "no response").slice(0, 120) };
  const status = snap.status;
  if (snap.challenge && base.status === 200) {
    return { state: "challenged", status, detail: `${snap.cdn || "CDN"} challenge (HTTP ${status})` };
  }
  if (BLOCK_STATUSES.has(status) && base.status === 200) {
    const who = snap.waf ? `, ${snap.waf[0]?.toUpperCase()}${snap.waf.slice(1)} firewall` : "";
    return { state: "blocked", status, detail: `HTTP ${status}${who}` };
  }
  if (status !== base.status) {
    return {
      state: "different",
      status,
      fields: ["status"],
      detail: `HTTP ${status}, a browser got ${base.status}`,
    };
  }
  if (urlKey(snap.finalUrl) !== urlKey(base.finalUrl)) {
    return { state: "redirected", status, detail: `to ${snap.finalUrl}` };
  }
  if (read.noindex && !baseRead.noindex) {
    return { state: "noindex", status, detail: "the browser's page has none" };
  }
  const fields = /** @type {const} */ (["title", "h1", "canonical"]).filter((f) => read[f] !== baseRead[f]);
  /** @type {string[]} */
  const differs = [...fields];
  const similarity = shingleSimilarity(baseRead.shingles, read.shingles);
  // How much of the crawler's text the browser also got: a cut-down copy of
  // the browser's page scores high here and low on similarity. That is a
  // thinner page, not different content.
  let shared = 0;
  for (const s of read.shingles) if (baseRead.shingles.has(s)) shared++;
  const inside = read.shingles.size > 0 ? shared / read.shingles.size : 1;
  // A page that changes between two browser requests earns a looser threshold.
  const threshold = Math.min(0.8, selfSimilarity - 0.15);
  const shorter = baseRead.words >= 50 && read.words < 0.7 * baseRead.words;
  if (similarity < threshold && baseRead.words >= 20 && !(shorter && inside >= 0.8)) differs.push("text");
  const measured = { words: read.words, similarity: Math.round(similarity * 100) / 100 };
  if (differs.length > 0) {
    return {
      state: "different",
      status,
      fields: differs,
      detail: differs.map((f) => (f === "h1" ? "H1" : f)).join(", "),
      ...measured,
    };
  }
  if (shorter) {
    return { state: "thinner", status, detail: `${read.words} of ${baseRead.words} words`, ...measured };
  }
  return { state: "same", status, detail: "same page as a browser", ...measured };
}

/**
 * @typedef {"blocked" | "challenged" | "different" | "redirected" | "noindex" | "thinner" | "disallowed" | "mobile"} BotFindingType
 */

/**
 * @typedef {object} BotFinding a problem on one page for one crawler
 * @property {BotFindingType} type
 * @property {string} agent agent id
 * @property {string} label
 * @property {BotKind} kind
 * @property {string} detail
 */

/**
 * @typedef {object} BotPageResult
 * @property {string} url
 * @property {{ status: number, finalUrl: string, title: string, words: number, selfSimilarity: number, appShell: boolean, error: string }} baseline the browser's answer
 * @property {Record<string, BotCell>} cells live crawler id → result
 * @property {Record<string, boolean>} robots crawler id → robots.txt allows this page
 * @property {{ mobileWords: number, desktopWords: number, fields: string[] } | null} mobile Googlebot smartphone vs desktop
 * @property {BotFinding[]} findings
 */

/**
 * @typedef {object} BotVerdict
 * @property {BotState} state worst result across the sample
 * @property {Record<string, number>} counts pages per state
 * @property {number} checked
 */

/**
 * @typedef {object} BotCheckReport
 * @property {string} checkedAt ISO time
 * @property {string[]} sample
 * @property {{ id: string, label: string, kind: BotKind, live: boolean }[]} agents
 * @property {BotPageResult[]} pages
 * @property {Record<string, BotVerdict>} verdicts live crawler id → verdict
 * @property {string[]} notes what the results cannot show
 * @property {boolean} interrupted the run stopped early
 */

/**
 * The browser and crawler requests for one page, run with up to
 * `concurrency` in flight and a new one started at most every `delay` ms
 * across the whole check.
 * @template T, R
 * @param {T[]} jobs
 * @param {(job: T) => Promise<R>} worker
 * @param {{ concurrency: number, gate: () => Promise<void>, interrupted: () => boolean }} o
 * @returns {Promise<(R | undefined)[]>}
 */
async function pool(jobs, worker, o) {
  /** @type {(R | undefined)[]} */
  const out = new Array(jobs.length);
  let next = 0;
  const lane = async () => {
    while (next < jobs.length && !o.interrupted()) {
      const i = next++;
      await o.gate();
      out[i] = await worker(/** @type {T} */ (jobs[i]));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency, jobs.length)) }, lane));
  return out;
}

/**
 * @typedef {object} BotCheckOptions
 * @property {string} [robotsText] the site's robots.txt ("" when there is none)
 * @property {string} [robotsNote] how robots.txt was read, when that limits the results
 * @property {boolean} [force] also request crawlers that robots.txt disallows
 * @property {number} [delay] ms between request starts (default 400)
 * @property {number} [concurrency] requests in flight (default 3)
 * @property {number} [timeoutMs] per request (default 15000)
 * @property {boolean} [blockPrivateIps]
 * @property {() => boolean} [interrupted]
 * @property {(done: number, total: number) => void} [onProgress]
 * @property {(ms: number) => Promise<unknown>} [sleep] injectable for tests
 */

/**
 * One request with a given user agent: a fresh connection, no cookies, TLS
 * verified, the same SSRF guard as page fetches. Never throws.
 * @param {string} url
 * @param {string} userAgent
 * @param {BotCheckOptions} o
 * @returns {Promise<BotSnapshot>}
 */
async function snapshot(url, userAgent, o) {
  /** @type {import("./fetch.mjs").PageResult} */
  let res;
  try {
    res = await fetchWithRedirects(url, {
      timeoutMs: o.timeoutMs ?? 15000,
      userAgent,
      blockPrivateIps: Boolean(o.blockPrivateIps),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 0,
      finalUrl: url,
      html: "",
      headers: {},
      challenge: false,
      cdn: "",
      waf: "",
      error: message,
    };
  }
  const status = Number(res.status) || 0;
  const headers = res.headers ?? {};
  if (status === 0) {
    return {
      status,
      finalUrl: res.finalUrl || url,
      html: "",
      headers,
      challenge: false,
      cdn: "",
      waf: "",
      error: res.error || "no response",
    };
  }
  const body = res.html || res.errorBody || "";
  const type = headerValue(headers, "content-type").toLowerCase();
  const isHtml = !type || type.includes("html") || type.includes("xml");
  const challenge = isChallengeResponse(status, headers, body);
  const cloudflare =
    headerValue(headers, "cf-mitigated") !== "" ||
    headerValue(headers, "server").toLowerCase().includes("cloudflare");
  return {
    status,
    finalUrl: res.finalUrl || url,
    html: isHtml ? res.html || "" : "",
    headers,
    challenge,
    cdn: challenge ? (cloudflare ? "Cloudflare" : "CDN") : "",
    waf: detectWafBlock(status, body),
    error: "",
  };
}

/**
 * Request every page in `urls` as a browser and as each crawler in
 * BOT_AGENTS, then compare. Pages are checked one at a time; the browser is
 * asked first, and a page the browser cannot get is not requested as any
 * crawler. Never throws for a failed request.
 * @param {string[]} urls absolute http(s) URLs (deduplicated, at most MAX_BOT_PAGES)
 * @param {BotCheckOptions} [opts]
 * @returns {Promise<BotCheckReport>}
 */
export async function runBotCheck(urls, opts = {}) {
  const sample = [...new Set(urls.filter((u) => /^https?:\/\//i.test(u)))].slice(0, MAX_BOT_PAGES);
  const robotsText = opts.robotsText ?? "";
  const delay = Math.max(0, Number(opts.delay ?? 400));
  const sleep = opts.sleep ?? ((/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms)));
  const interrupted = opts.interrupted ?? (() => false);
  let nextAt = 0;
  const gate = async () => {
    const now = Date.now();
    const start = Math.max(now, nextAt);
    nextAt = start + delay;
    if (start > now) await sleep(start - now);
  };
  const total = sample.length * (BOT_AGENTS.length + 2);
  let done = 0;
  /** @param {number} n */
  const tick = (n = 1) => {
    done += n;
    opts.onProgress?.(Math.min(done, total), total);
  };

  /** @type {BotPageResult[]} */
  const pages = [];
  /** @type {string[]} */
  const notes = [];
  let stopped = false;
  for (const url of sample) {
    if (interrupted()) {
      stopped = true;
      break;
    }
    /** @type {Record<string, boolean>} */
    const robots = {};
    for (const a of [...BOT_AGENTS, ...BOT_ROBOTS_ONLY]) {
      robots[a.id] = botRobotsAllowed(robotsText, a.token, url);
    }
    await gate();
    const base = await snapshot(url, BROWSER_USER_AGENT, opts);
    tick();
    if (base.error) {
      pages.push({
        url,
        baseline: {
          status: 0,
          finalUrl: base.finalUrl,
          title: "",
          words: 0,
          selfSimilarity: 1,
          appShell: false,
          error: base.error.slice(0, 160),
        },
        cells: {},
        robots,
        mobile: null,
        findings: [],
      });
      tick(BOT_AGENTS.length + 1);
      continue;
    }
    const live = BOT_AGENTS.filter((a) => opts.force || robots[a.id]);
    /** @type {{ id: string, userAgent: string }[]} */
    const jobs = [...live.map((a) => ({ id: a.id, userAgent: a.userAgent }))];
    jobs.push({ id: "browser-again", userAgent: BROWSER_USER_AGENT });
    const answers = await pool(
      jobs,
      async (job) => {
        const snap = await snapshot(url, job.userAgent, opts);
        tick();
        return snap;
      },
      { concurrency: Math.max(1, Math.min(8, opts.concurrency ?? 3)), gate, interrupted },
    );
    tick(BOT_AGENTS.length - live.length);
    /** @type {Map<string, BotSnapshot>} */
    const snaps = new Map();
    jobs.forEach((job, i) => {
      const s = answers[i];
      if (s) snaps.set(job.id, s);
    });

    const baseRead = readBotResponse(base.html, base.headers, base.finalUrl);
    const again = snaps.get("browser-again");
    const selfSimilarity =
      again && !again.error && again.html
        ? shingleSimilarity(
            baseRead.shingles,
            readBotResponse(again.html, again.headers, again.finalUrl).shingles,
          )
        : 1;

    /** @type {Record<string, BotCell>} */
    const cells = {};
    /** @type {Map<string, { snap: BotSnapshot, read: BotRead | null }>} */
    const reads = new Map();
    for (const a of BOT_AGENTS) {
      if (!opts.force && !robots[a.id]) {
        cells[a.id] = { state: "disallowed", status: 0, detail: `robots.txt disallows ${a.token}` };
        continue;
      }
      const snap = snaps.get(a.id);
      if (!snap) {
        cells[a.id] = { state: "error", status: 0, detail: "not requested (check stopped)" };
        continue;
      }
      const read = snap.error ? null : readBotResponse(snap.html, snap.headers, snap.finalUrl, a.token);
      reads.set(a.id, { snap, read });
      cells[a.id] = compareWithBrowser(base, baseRead, snap, read, selfSimilarity);
    }

    /** @type {BotFinding[]} */
    const findings = [];
    for (const a of BOT_AGENTS) {
      // Googlebot desktop is only the yardstick for the smartphone crawler.
      if (a.id === "googlebot-desktop") continue;
      const cell = cells[a.id];
      if (!cell || cell.state === "same" || cell.state === "error") continue;
      if (cell.state === "disallowed" && a.kind !== "search") continue;
      findings.push({
        type: /** @type {BotFindingType} */ (cell.state),
        agent: a.id,
        label: a.label,
        kind: a.kind,
        detail: cell.detail,
      });
    }

    // Mobile-first indexing: Googlebot smartphone against Googlebot desktop.
    /** @type {BotPageResult["mobile"]} */
    let mobile = null;
    const m = reads.get("googlebot");
    const d = reads.get("googlebot-desktop");
    if (m?.read && d?.read && m.snap.status === 200 && d.snap.status === 200) {
      const fields = /** @type {const} */ (["title", "h1", "canonical"])
        .filter((f) => m.read?.[f] !== d.read?.[f])
        .map((f) => (f === "h1" ? "H1" : f));
      /** @type {string[]} */
      const diff = [...fields];
      if (urlKey(m.snap.finalUrl) !== urlKey(d.snap.finalUrl)) diff.push("URL");
      mobile = { mobileWords: m.read.words, desktopWords: d.read.words, fields: diff };
      let detail = "";
      if (diff.length > 0) detail = `mobile and desktop pages differ (${diff.join(", ")})`;
      else if (d.read.words >= 50 && m.read.words < 0.7 * d.read.words) {
        detail = `mobile page has ${m.read.words} of the desktop page's ${d.read.words} words`;
      }
      if (detail) {
        // When desktop Googlebot gets the browser's page, the gap is the
        // mobile version, not Googlebot: one finding, not two.
        if (cells["googlebot-desktop"]?.state === "same") {
          for (let i = findings.length - 1; i >= 0; i--) {
            if (findings[i]?.agent === "googlebot") findings.splice(i, 1);
          }
        }
        findings.push({
          type: "mobile",
          agent: "googlebot",
          label: "Googlebot smartphone",
          kind: "search",
          detail,
        });
      }
    }

    pages.push({
      url,
      baseline: {
        status: base.status,
        finalUrl: base.finalUrl,
        title: baseRead.title,
        words: baseRead.words,
        selfSimilarity: Math.round(selfSimilarity * 100) / 100,
        appShell: base.status === 200 && baseRead.appShell,
        error: "",
      },
      cells,
      robots,
      mobile,
      findings,
    });
  }
  if (stopped || interrupted()) notes.push("The check was interrupted: only the pages listed were checked.");

  /** @type {Record<string, BotVerdict>} */
  const verdicts = {};
  for (const a of BOT_AGENTS) {
    /** @type {Record<string, number>} */
    const counts = {};
    for (const p of pages) {
      const st = p.cells[a.id]?.state;
      if (st) counts[st] = (counts[st] ?? 0) + 1;
    }
    const checked = Object.values(counts).reduce((s, n) => s + n, 0);
    const worst = /** @type {BotState | undefined} */ (VERDICT_ORDER.find((s) => (counts[s] ?? 0) > 0));
    // No result at all (every page failed in the browser) is an error, not a pass.
    verdicts[a.id] = { state: worst ?? (checked === 0 ? "error" : "same"), counts, checked };
  }

  if (opts.robotsNote) notes.push(opts.robotsNote);
  const turnedAway = pages.filter((p) => p.baseline.status !== 200 && !p.baseline.error);
  for (const p of turnedAway.slice(0, 3)) {
    notes.push(
      `A browser request for ${p.url} got HTTP ${p.baseline.status}, so the crawler results for that page say little.`,
    );
  }
  for (const p of pages.filter((x) => x.baseline.error).slice(0, 3)) {
    notes.push(
      `${p.url} could not be fetched (${p.baseline.error}), so it was not requested as any crawler.`,
    );
  }
  if (pages.some((p) => p.baseline.appShell)) {
    notes.push(
      "Some pages are served as an app shell with almost no text: crawlers that do not run JavaScript (most AI crawlers) get next to nothing from them.",
    );
  }
  notes.push(
    "JavaScript is not run: Googlebot, Bingbot and Applebot render pages and may see more than the HTML compared here.",
  );

  return {
    checkedAt: new Date().toISOString(),
    sample: pages.map((p) => p.url),
    agents: [
      ...BOT_AGENTS.map((a) => ({ id: a.id, label: a.label, kind: a.kind, live: true })),
      ...BOT_ROBOTS_ONLY.map((a) => ({ id: a.id, label: a.label, kind: a.kind, live: false })),
    ],
    pages,
    verdicts,
    notes,
    interrupted: stopped || interrupted(),
  };
}
