/**
 * one-step-seo — crawl + analysis engine (zero dependencies, Node 18+).
 *
 * One reusable implementation of "fetch a page, parse it, run the checks" and
 * of the bounded site crawl. The CLI, the monitor, the verifier and library
 * consumers all drive this module, so crawl policy (same-host lock, robots.txt
 * enforcement, page cap, politeness delay, SSRF options) lives in one place.
 *
 * The engine never prints: progress, warnings and diagnostics go to optional
 * hooks so callers decide what is shown.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchWithRedirects, fetchText } from "./fetch.mjs";
import { parseHtml } from "./html.mjs";
import { getSiteFiles, getSitemapUrls, isDisallowed, parseRobots, extractSitemapUrls } from "./robots.mjs";
import { runChecks, MAX_LINK_CHECKS } from "./checks.mjs";
import { extractJsonLd, validateSchema } from "./schema.mjs";
import { geoDetails, computeScores } from "./score.mjs";
import { buildReport } from "./report.mjs";
import { canonicalizeUrl } from "./args.mjs";
import { filterSkills, matchesSkillChecks } from "./skills.mjs";
import { contentHash, simhash, topTerms, contentTerms, stripBrandSuffix } from "./text.mjs";
import { VERSION, USER_AGENT, UA_TOKEN } from "./version.mjs";

/**
 * URL path extensions that are never HTML documents. Links to these are not
 * queued for auditing — parsing a PDF or an image as HTML produces a page
 * report full of meaningless failures.
 */
export const NON_HTML_EXTENSIONS = new Set(
  (
    "pdf jpg jpeg png gif webp avif svg ico bmp tif tiff mp3 mp4 m4a m4v mov avi wmv webm ogg wav flac " +
    "zip gz tgz bz2 rar 7z tar dmg exe msi apk iso css js mjs map json xml rss atom txt csv tsv " +
    "doc docx xls xlsx ppt pptx odt ods woff woff2 ttf otf eot"
  ).split(" "),
);

/**
 * @typedef {{ url: string, status: number, error: string, kind: "fetch" | "offsite" | "asset", referrers: string[] }} CrawlFailure
 * @typedef {{ lang: string, href: string }} HreflangEntry
 * @typedef {object} PageFacts
 * @property {string} url requested URL
 * @property {string} finalUrl URL after redirects
 * @property {string} key canonicalized finalUrl (graph node id)
 * @property {number} status
 * @property {number} redirects redirect hops before the final response
 * @property {number} ms response time measured from this machine
 * @property {number} bytes HTML size
 * @property {string} title
 * @property {string} metaDescription
 * @property {string} h1
 * @property {number} h1Count
 * @property {string[]} h2s
 * @property {string} lang
 * @property {string} canonical absolute canonical URL ("" when absent)
 * @property {string} canonicalKey canonicalized canonical ("" when absent)
 * @property {boolean} noindex
 * @property {boolean} nofollow
 * @property {HreflangEntry[]} hreflangs
 * @property {string[]} links canonicalized same-host link targets (deduped, self excluded)
 * @property {number} externalLinks
 * @property {number} wordCount
 * @property {number} images
 * @property {number} imagesWithoutAlt
 * @property {string[]} schemaTypes
 * @property {string} contentHash
 * @property {string} simhash
 * @property {{ term: string, count: number }[]} terms most frequent on-page terms (not search volume)
 * @property {string[]} targetTerms content terms of the title (brand suffix stripped) + H1
 * @property {string} dateModified latest dateModified/datePublished declared in JSON-LD ("" when none)
 */

/**
 * @typedef {object} CrawlOptions
 * @property {number} [pages] page cap (default 1)
 * @property {string} [crawl] "links" | "sitemap" | "auto"
 * @property {number} [concurrency] parallel fetches 1-8
 * @property {number} [delay] politeness pause between batches (ms)
 * @property {number} [timeout] per-request timeout (ms)
 * @property {boolean} [force] ignore robots.txt Disallow
 * @property {boolean} [stripQuery]
 * @property {string} [include]
 * @property {string} [exclude]
 * @property {number} [maxDepth]
 * @property {boolean} [checkLinks]
 * @property {string} [skills]
 * @property {string} [excludeSkills]
 * @property {string} [profile]
 * @property {boolean} [blockPrivateIps]
 * @property {boolean} [all] queue every discovered link (no per-page breadth cap)
 * @property {string} [userAgent]
 */

/**
 * @typedef {object} CrawlHooks
 * @property {(message: string) => void} [warn]
 * @property {(message: string) => void} [debug]
 * @property {(state: { done: number, total: number, queued: number, current: string }) => void} [progress]
 * @property {() => boolean} [isInterrupted]
 */

/**
 * @typedef {object} CrawlRedirect
 * @property {string} url requested URL
 * @property {string} finalUrl landing URL
 * @property {number} hops redirect hops
 * @property {string[]} referrers pages linking to the requested URL (up to 5)
 */

/**
 * @typedef {object} CrawlResult
 * @property {boolean} blocked robots.txt refused the start URL (pageReports holds one T05 report)
 * @property {string} robotsText
 * @property {import("./report.mjs").Report[]} pageReports
 * @property {PageFacts[]} pages facts aligned by index with pageReports
 * @property {CrawlFailure[]} failures
 * @property {number} failed
 * @property {boolean} capped the crawl saw more URLs than the page cap could take
 * @property {string[]} sitemapUrls URLs declared by the sitemap(s) (empty unless sitemap/auto mode)
 * @property {number[]} orphanIndexes indexes of pages no crawled page links to (start page exempt)
 * @property {CrawlRedirect[]} redirects requested URLs that redirected to another same-site URL
 * @property {string} startUrl
 */

/**
 * Path + query of an absolute URL — what robots.txt rules are matched
 * against (RFC 9309). "/" on garbage.
 * @param {string} link
 * @returns {string}
 */
export function robotsPathOf(link) {
  try {
    const u = new URL(link);
    return (u.pathname || "/") + u.search;
  } catch {
    return "/";
  }
}

/**
 * Path component of an absolute URL (include/exclude patterns); "/" on garbage.
 * @param {string} link
 * @returns {string}
 */
export function pathOf(link) {
  try {
    return new URL(link).pathname || "/";
  } catch {
    return "/";
  }
}

/**
 * Lowercase host of an absolute URL; "" on garbage. Compared host-only
 * (not origin) so mixed http/https links on one host stay crawlable.
 * @param {string} link
 * @returns {string}
 */
export function hostOf(link) {
  try {
    return new URL(link).host.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * True when the URL path ends in a known non-HTML extension.
 * @param {string} link
 * @returns {boolean}
 */
export function isAssetUrl(link) {
  const ext = extname(pathOf(link)).slice(1).toLowerCase();
  return ext !== "" && NON_HTML_EXTENSIONS.has(ext);
}

/**
 * Compile an --include/--exclude pattern once: a valid regex is used as one
 * (case-insensitive), anything else falls back to a substring test.
 * @param {string} pattern
 * @returns {(path: string) => boolean}
 */
export function compilePathPattern(pattern) {
  if (!pattern) return () => true;
  try {
    const re = new RegExp(pattern, "i");
    return (p) => re.test(p);
  } catch {
    const needle = pattern.toLowerCase();
    return (p) => p.toLowerCase().includes(needle);
  }
}

/**
 * Filter findings by --skills / --exclude-skills.
 * @param {any[]} findings
 * @param {string} [skillsFilter]
 * @param {string} [excludeSkillsFilter]
 * @returns {any[]}
 */
export function applySkillsFilter(findings, skillsFilter, excludeSkillsFilter) {
  if (!skillsFilter && !excludeSkillsFilter) return findings;
  /** @param {string} list @returns {Set<string>} */
  const checksFor = (list) => {
    const ids = list
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return new Set(filterSkills({ include: ids }).flatMap((s) => s.checks));
  };
  const allowed = skillsFilter ? checksFor(skillsFilter) : null;
  const excluded = excludeSkillsFilter ? checksFor(excludeSkillsFilter) : null;
  return findings.filter((f) => {
    if (allowed && !matchesSkillChecks(f.id, allowed)) return false;
    if (excluded && matchesSkillChecks(f.id, excluded)) return false;
    return true;
  });
}

/**
 * Parse + check an already-fetched HTML document.
 * @param {string} html
 * @param {any} fetched fetch result (finalUrl, status, headers, …)
 * @param {any} siteFiles
 * @param {{ profile?: string, offline?: boolean }} [opts]
 */
export function analyzeHtml(html, fetched, siteFiles, opts = {}) {
  const parsed = parseHtml(html, fetched.finalUrl);
  const schemaRaw = extractJsonLd(parsed.jsonLdBlocks);
  const validated = validateSchema(schemaRaw.items);
  const schemaInfo = {
    items: schemaRaw.items,
    types: validated.types,
    issues: validated.issues,
    errors: schemaRaw.errors,
  };
  const findings = runChecks(parsed, siteFiles, fetched, schemaInfo, {
    profile: opts.profile,
    ...(opts.offline ? { offline: true } : {}),
  });
  if (fetched.truncated) {
    findings.push({
      id: "T00-truncated",
      category: "technical",
      severity: "P2",
      title: "HTML truncated at 5MB cap",
      evidence: `Body exceeded the 5MB audit cap; checks ran on the head portion only.`,
      fix: "Reduce page weight (code-split, paginate) so the full page is auditable, then re-run.",
      seoImpact: "low",
      geoImpact: "low",
    });
  }
  const geo = geoDetails(parsed, siteFiles);
  const scores = computeScores(findings, geo);
  return { parsed, schemaInfo, findings, geo, scores };
}

/**
 * Fetch + parse + check a single URL into report-ready parts.
 * When `allowedHosts` is set, redirect landings outside the set return
 * early with `skipped: true` — before any robots/sitemap/llms discovery
 * fetches — so locked-out origins see only the single redirect-following
 * page request, never a report and never link harvesting.
 * @param {string} url
 * @param {number} timeoutMs
 * @param {string} [userAgent]
 * @param {Set<string> | null} [allowedHosts]
 * @param {string} [profile] page-type calibration (see PROFILES in lib/checks.mjs)
 * @param {{ blockPrivateIps?: boolean }} [options]
 */
export async function analyzeOne(
  url,
  timeoutMs,
  userAgent,
  allowedHosts = null,
  profile = "default",
  options = {},
) {
  const blockPrivateIps = Boolean(options?.blockPrivateIps);
  const fetched = await fetchWithRedirects(url, {
    timeoutMs,
    ...(userAgent ? { userAgent } : {}),
    ...(blockPrivateIps ? { blockPrivateIps: true } : {}),
  });
  /** @param {boolean} skipped */
  const empty = (skipped) => ({
    fetched,
    parsed: /** @type {any} */ (null),
    siteFiles: /** @type {any} */ (null),
    findings: /** @type {any[]} */ ([]),
    scores: /** @type {any} */ (null),
    geo: /** @type {any} */ (null),
    schemaInfo: /** @type {any} */ (null),
    truncated: false,
    skipped,
  });
  if (!fetched.ok || !fetched.html) return empty(false);
  if (allowedHosts) {
    const finalHost = hostOf(fetched.finalUrl);
    if (!finalHost || !allowedHosts.has(finalHost)) return empty(true);
  }
  const siteFiles = await getSiteFiles(fetched.finalUrl, {
    timeoutMs,
    ...(userAgent ? { userAgent } : {}),
    ...(blockPrivateIps ? { blockPrivateIps: true } : {}),
  });
  const a = analyzeHtml(fetched.html, fetched, siteFiles, { profile });
  return {
    fetched,
    parsed: a.parsed,
    siteFiles,
    findings: a.findings,
    scores: a.scores,
    geo: a.geo,
    schemaInfo: a.schemaInfo,
    truncated: fetched.truncated,
    skipped: false,
  };
}

/**
 * Build the page report for an analyzeOne()/analyzeLocalFile() result.
 * @param {any} r result with parsed non-null
 * @param {string} url requested URL
 * @returns {import("./report.mjs").Report}
 */
export function toReport(r, url) {
  return buildReport({
    url,
    finalUrl: r.fetched.finalUrl,
    scores: r.scores,
    findings: r.findings,
    parsed: r.parsed,
    siteFiles: r.siteFiles,
    meta: { version: VERSION },
    truncated: r.truncated,
  });
}

/**
 * Minimal report for a robots-refused crawl: one P1 finding, no pages.
 * @param {string} url
 * @returns {import("./report.mjs").Report}
 */
export function blockedReport(url) {
  const findings = [
    {
      id: "T05-robots-disallow",
      category: "technical",
      severity: "P1",
      title: "robots.txt disallows crawling this page",
      evidence: `robots.txt Disallow matches ${url} — the crawl was skipped (re-run with --force to override).`,
      fix: "If the block is intentional, nothing to do. Otherwise allow the path in robots.txt, then re-audit.",
      seoImpact: "medium",
      geoImpact: "-",
    },
  ];
  const scores = computeScores(findings, geoDetails(null, null));
  return buildReport({
    url,
    finalUrl: url,
    scores,
    findings,
    parsed: {},
    siteFiles: {},
    meta: { version: VERSION },
  });
}

/**
 * Latest ISO date declared as dateModified / datePublished in JSON-LD nodes.
 * @param {any} items
 * @returns {string} ISO date string, or "" when no parseable date is declared
 */
function latestSchemaDate(items) {
  let best = 0;
  for (const n of Array.isArray(items) ? items : []) {
    if (!n || typeof n !== "object") continue;
    for (const k of ["dateModified", "datePublished"]) {
      const t = Date.parse(String(n[k] ?? ""));
      if (Number.isFinite(t) && t > best) best = t;
    }
  }
  return best > 0 ? new Date(best).toISOString() : "";
}

/**
 * Site-analysis facts for one analyzed page. Must be called BEFORE any skills
 * filter is applied to `r.findings` (indexability is read from T07).
 * @param {any} r analyzeOne()/analyzeLocalFile() result with parsed non-null
 * @param {string} requestedUrl
 * @param {(u: string) => string} [canon]
 * @returns {PageFacts}
 */
export function pageFacts(r, requestedUrl, canon = (u) => canonicalizeUrl(u)) {
  const p = r.parsed ?? {};
  const f = r.fetched ?? {};
  const finalUrl = String(f.finalUrl || requestedUrl);
  /** @param {string} u */
  const keyOf = (u) => canon(u) || u;
  const key = keyOf(finalUrl);
  const robotsMeta = String(p.robotsMeta ?? "").toLowerCase();
  const headers = f.headers && typeof f.headers === "object" ? f.headers : {};
  const xRobots = String(headers["x-robots-tag"] ?? "").toLowerCase();
  const directives = `${robotsMeta},${xRobots}`.split(/[\s,]+/).filter(Boolean);
  const noindex = (Array.isArray(r.findings) ? r.findings : []).some(
    (/** @type {any} */ x) => x?.id === "T07-noindex" && x.severity !== "pass",
  );
  /** @type {Set<string>} */
  const links = new Set();
  for (const link of Array.isArray(p.internalLinks) ? p.internalLinks : []) {
    const lk = keyOf(String(link));
    if (lk && lk !== key) links.add(lk);
  }
  /** @type {HreflangEntry[]} */
  const hreflangs = [];
  for (const h of Array.isArray(p.hreflangs) ? p.hreflangs : []) {
    let href = "";
    try {
      href = h?.href ? new URL(String(h.href), finalUrl).toString() : "";
    } catch {
      href = "";
    }
    hreflangs.push({ lang: String(h?.lang ?? ""), href });
  }
  const h1s = Array.isArray(p.h1s) ? p.h1s : [];
  const h1 = String(h1s[0]?.text ?? "");
  const title = String(p.title ?? "");
  const visible = String(p.visibleText ?? "");
  const canonical = String(p.canonical ?? "");
  return {
    url: requestedUrl,
    finalUrl,
    key,
    status: Number(f.status ?? 0),
    redirects: Math.max(0, (Array.isArray(f.statusChain) ? f.statusChain.length : 1) - 1),
    ms: Number(f.ms ?? 0),
    bytes: Number(p.htmlBytes ?? 0),
    title,
    metaDescription: String(p.metaDescription ?? ""),
    h1,
    h1Count: h1s.length,
    h2s: (Array.isArray(p.h2s) ? p.h2s : [])
      .slice(0, 20)
      .map((/** @type {any} */ h) => String(h?.text ?? "")),
    lang: String(p.lang ?? ""),
    canonical,
    canonicalKey: canonical ? keyOf(canonical) : "",
    noindex,
    nofollow: directives.includes("nofollow") || directives.includes("none"),
    hreflangs,
    links: [...links],
    externalLinks: Number(p.externalLinkCount ?? 0),
    wordCount: Number(p.wordCount ?? 0),
    images: Array.isArray(p.images) ? p.images.length : 0,
    imagesWithoutAlt: Number(p.imagesWithoutAlt ?? 0),
    schemaTypes: Array.isArray(r.schemaInfo?.types) ? r.schemaInfo.types.map(String) : [],
    contentHash: contentHash(visible),
    simhash: simhash(visible),
    terms: topTerms(visible, 15),
    targetTerms: [...new Set(contentTerms(`${stripBrandSuffix(title)} ${h1}`))],
    dateModified: latestSchemaDate(r.schemaInfo?.items),
  };
}

/**
 * Verify a page's same-host link targets (`--check-links`). Appends one
 * aggregated T16 finding for broken targets. Shared budget + checked-set
 * bound total requests per run; already-audited (known-200) and
 * robots-disallowed targets are skipped, never fetched.
 * @param {any} r analyzeOne result (parsed non-null)
 * @param {Set<string>} knownGood canonical URLs already known to return 200
 * @param {{ timeout?: number, concurrency?: number, blockPrivateIps?: boolean, userAgent?: string }} opts
 * @param {{ budget: number, checked: Set<string> }} state shared across pages
 * @param {string} robotsText robots.txt of the crawled origin ("" skips the policy check)
 * @returns {Promise<{ url: string, status: string }[]>} broken targets found on this page
 */
export async function checkPageLinks(r, knownGood, opts, state, robotsText) {
  const selfKey = canonicalizeUrl(r.fetched.finalUrl) || r.fetched.finalUrl;
  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? 4));
  const ua = opts.userAgent || USER_AGENT;
  /** @type {string[]} */
  const targets = [];
  for (const link of r.parsed.internalLinks ?? []) {
    if (state.budget <= 0) break;
    const lk = canonicalizeUrl(link) || link;
    if (!lk || !/^https?:\/\//i.test(lk) || state.checked.has(lk) || knownGood.has(lk) || lk === selfKey)
      continue;
    if (robotsText && isDisallowed(robotsText, UA_TOKEN, robotsPathOf(link))) continue;
    state.checked.add(lk);
    state.budget--;
    targets.push(lk);
  }
  /** @type {{ url: string, status: string }[]} */
  const broken = [];
  if (targets.length === 0) return broken;
  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((u) =>
        fetchText(u, {
          timeoutMs: opts.timeout,
          userAgent: ua,
          blockPrivateIps: Boolean(opts.blockPrivateIps),
        }),
      ),
    );
    results.forEach((settled, k) => {
      const u = batch[k] ?? "";
      if (settled.status === "rejected") {
        broken.push({ url: u, status: "fetch failed" });
        return;
      }
      const res = settled.value;
      if (!res.ok || res.status < 200 || res.status >= 400) {
        broken.push({ url: u, status: res.error || `http status ${res.status}` });
      }
    });
  }
  if (broken.length > 0) {
    const shown = broken
      .slice(0, 5)
      .map((b) => `GET ${b.url} -> ${b.status}`)
      .join("; ");
    r.findings.push({
      id: "T16-broken-links",
      category: "technical",
      severity: "P1",
      title: `${broken.length} broken internal link${broken.length === 1 ? "" : "s"}`,
      evidence: broken.length > 5 ? `${shown}; +${broken.length - 5} more` : shown,
      fix: "Fix or remove the broken links; update inlinks that point at moved pages.",
      seoImpact: "medium",
      geoImpact: "-",
    });
  }
  return broken;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

/**
 * Bounded, polite, same-host site crawl. Audits up to `options.pages` pages
 * starting at `startUrl`, discovering more through sitemaps and/or links.
 * Never throws for per-page failures — they are returned in `failures`.
 * @param {string} startUrl absolute http(s) URL
 * @param {CrawlOptions} [options]
 * @param {CrawlHooks} [hooks]
 * @returns {Promise<CrawlResult>}
 */
export async function crawlSite(startUrl, options = {}, hooks = {}) {
  const maxPages = Math.max(1, Number(options.pages ?? 1));
  const mode = options.crawl ?? "links";
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4));
  const delay = Math.max(0, Number(options.delay ?? 250));
  const timeout = Number(options.timeout ?? 15000);
  const blockPrivateIps = Boolean(options.blockPrivateIps);
  const ua = options.userAgent || USER_AGENT;
  const profile = options.profile ?? "default";
  const warn = hooks.warn ?? (() => {});
  const dbg = hooks.debug ?? (() => {});
  const interrupted = hooks.isInterrupted ?? (() => false);
  const fetchOpts = { timeoutMs: timeout, userAgent: ua, blockPrivateIps };
  const canon = (/** @type {string} */ u) => canonicalizeUrl(u, Boolean(options.stripQuery));
  const includes = compilePathPattern(options.include ?? "");
  const excludes = options.exclude ? compilePathPattern(options.exclude) : () => false;

  /** @type {CrawlResult} */
  const result = {
    blocked: false,
    robotsText: "",
    pageReports: [],
    pages: [],
    failures: [],
    failed: 0,
    capped: false,
    sitemapUrls: [],
    orphanIndexes: [],
    redirects: [],
    startUrl,
  };

  // robots.txt gate for the start URL (also warms the per-origin site-file cache).
  try {
    const site = await getSiteFiles(startUrl, fetchOpts);
    result.robotsText = site.robots.text ?? "";
    dbg(
      `robots.txt ${site.robots.found ? `found (${site.robots.disallowCount} disallow rules)` : "missing"} for ${site.origin}`,
    );
  } catch {
    // Best-effort: without robots.txt there is nothing to enforce.
    result.robotsText = "";
  }
  const robotsText = result.robotsText;
  if (!options.force && robotsText !== "" && isDisallowed(robotsText, UA_TOKEN, robotsPathOf(startUrl))) {
    result.blocked = true;
    result.pageReports.push(blockedReport(startUrl));
    return result;
  }

  const seen = new Set([canon(startUrl) || startUrl]);
  const crawled = new Set();
  /** @type {{ url: string, depth: number }[]} */
  const queue = [{ url: startUrl, depth: 0 }];
  // Pragmatic same-host policy: the start host plus the first landing host
  // (covers apex <-> www canonicalization), locked after that. Discovered
  // links and redirect landings outside the set are skipped, never crawled.
  const allowedHosts = new Set([hostOf(startUrl)]);
  let adoptedOnce = false;
  // Inlink counts per canonical URL (orphan detection). Seeds start at zero:
  // sitemap-only pages with no crawled inlinks count as orphaned for equity.
  /** @type {Map<string, number>} */
  const inlinkCounts = new Map();
  // Up to 5 source pages per link target, so failures can name who links to them.
  /** @type {Map<string, string[]>} */
  const referrers = new Map();
  /** Final-URL keys already reported (redirect-alias dedupe, O(1)). @type {Set<string>} */
  const reportedKeys = new Set();
  /** @type {{ budget: number, checked: Set<string> }} */
  const linkState = { budget: options.checkLinks ? MAX_LINK_CHECKS : 0, checked: new Set() };

  /** One failure per URL: a 404 found by the link checker and again by the crawl is one problem. @type {Map<string, CrawlFailure>} */
  const failureByKey = new Map();
  /**
   * @param {string} url @param {number} status @param {string} error
   * @param {"fetch" | "offsite" | "asset"} kind @param {string[]} [refs]
   */
  const addFailure = (url, status, error, kind, refs) => {
    const key = canon(url) || url;
    const existing = failureByKey.get(key);
    if (existing) {
      for (const ref of refs ?? []) {
        if (existing.referrers.length < 5 && !existing.referrers.includes(ref)) existing.referrers.push(ref);
      }
      return;
    }
    const failure = { url, status, error, kind, referrers: [...(refs ?? referrers.get(key) ?? [])] };
    failureByKey.set(key, failure);
    result.failures.push(failure);
    if (kind !== "asset") result.failed++;
  };
  /** @param {string} url @param {number} status @param {string} error @param {"fetch" | "offsite" | "asset"} kind */
  const recordFailure = (url, status, error, kind) => addFailure(url, status, error, kind);

  // Seed sitemap-mode queue from the sitemap discovery. The root URL is
  // already in `queue`, so the cap must count only *extra* seeds.
  if (mode === "sitemap" || mode === "auto") {
    try {
      const seeds = await getSitemapUrls(startUrl, fetchOpts);
      result.sitemapUrls = seeds;
      dbg(`sitemap seeds: ${seeds.length}`);
      let added = 0;
      for (const seed of seeds) {
        if (added >= Math.max(0, maxPages - 1)) {
          result.capped = true;
          break;
        }
        const key = canon(seed) || seed;
        if (seen.has(key)) continue;
        const seedPath = pathOf(seed);
        if (options.include && !includes(seedPath)) continue;
        if (options.exclude && excludes(seedPath)) continue;
        if (isAssetUrl(seed)) continue;
        // Sitemap entries get the same gates as discovered links: same host,
        // and robots.txt is honored (a sitemap may list disallowed URLs).
        if (!allowedHosts.has(hostOf(seed))) {
          dbg(`skip sitemap URL outside allowed hosts ${seed}`);
          continue;
        }
        if (!options.force && robotsText && isDisallowed(robotsText, UA_TOKEN, robotsPathOf(seed))) {
          dbg(`skip robots-disallowed sitemap URL ${seed}`);
          seen.add(key);
          continue;
        }
        queue.push({ url: seed, depth: 1 });
        seen.add(key);
        added++;
      }
      // Only warn when the sitemap genuinely yielded nothing and mode was explicitly sitemap.
      if (seeds.length === 0 && mode === "sitemap") {
        warn("! sitemap has no usable URLs — falling back to link crawl.");
      }
    } catch {
      // ignore — link crawl proceeds
    }
  }

  let firstBatch = true;
  while (queue.length > 0 && result.pageReports.length < maxPages && !interrupted()) {
    if (!firstBatch && delay > 0) await sleep(delay);
    firstBatch = false;
    /** @type {{ url: string, depth: number }[]} */
    const batch = [];
    while (
      batch.length < concurrency &&
      queue.length > 0 &&
      result.pageReports.length + batch.length < maxPages &&
      !interrupted()
    ) {
      const item = queue.shift();
      if (item === undefined) break;
      const key = canon(item.url) || item.url;
      if (crawled.has(key)) continue;
      crawled.add(key);
      seen.add(key);
      batch.push(item);
    }
    if (batch.length === 0) break;

    hooks.progress?.({
      done: result.pageReports.length,
      total: maxPages,
      queued: queue.length,
      current: batch[0]?.url ? pathOf(batch[0].url) : "",
    });

    const results = await Promise.allSettled(
      batch.map((item) => analyzeOne(item.url, timeout, ua, allowedHosts, profile, { blockPrivateIps })),
    );
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      const next = item ? item.url : "";
      const currentDepth = item ? item.depth : 0;
      const settled = results[i];
      if (!next || !settled) continue;
      if (settled.status === "rejected") {
        const reason = settled.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        warn(`! ${next} -> ${message}`);
        recordFailure(next, 0, message, "fetch");
        continue;
      }
      let r = settled.value;
      if (r.skipped) {
        const skipHost = hostOf(r.fetched.finalUrl);
        if (result.pageReports.length === 0 && !adoptedOnce && skipHost) {
          // Pragmatic redirect policy: the start URL itself may canonicalize
          // across hosts (apex <-> www). Adopt the first landing host, then
          // lock the set: re-analyze without the gate for the full report.
          dbg(`adopted redirect host ${skipHost}`);
          allowedHosts.add(skipHost);
          adoptedOnce = true;
          r = await analyzeOne(next, timeout, ua, null, profile, { blockPrivateIps });
        } else {
          warn(`! ${next} landed outside the allowed hosts (${skipHost || "unknown"}) — skipped.`);
          recordFailure(next, r.fetched.status, `redirects off-site to ${skipHost || "unknown"}`, "offsite");
          continue;
        }
      }
      if (!r.parsed) {
        warn(`! ${next} -> ${r.fetched.error || r.fetched.status}`);
        recordFailure(next, r.fetched.status, String(r.fetched.error || r.fetched.status), "fetch");
        continue;
      }
      // A non-HTML response (PDF, feed, download) reached through a link is an
      // asset, not a page: auditing it as HTML only produces noise. The start
      // URL is exempt so a mis-served homepage is still reported (T04).
      const ctype = String(r.fetched.contentType || "").toLowerCase();
      if (
        result.pageReports.length > 0 &&
        ctype &&
        !ctype.includes("html") &&
        !/<html[\s>]|<!doctype html/i.test(String(r.fetched.html).slice(0, 2048))
      ) {
        dbg(`skip non-HTML ${next} (${ctype})`);
        recordFailure(next, r.fetched.status, `non-HTML content-type ${ctype}`, "asset");
        continue;
      }
      // Guard against redirect-alias duplicates (http<->https, trailing slash).
      const finalKey = canon(r.fetched.finalUrl) || r.fetched.finalUrl;
      const requestedKey = canon(next) || next;
      // Record every same-site redirect, including aliases of pages already
      // reported, so links-to-redirect / chain checks see them.
      if (finalKey !== requestedKey) {
        result.redirects.push({
          url: next,
          finalUrl: r.fetched.finalUrl,
          hops: Math.max(1, (Array.isArray(r.fetched.statusChain) ? r.fetched.statusChain.length : 2) - 1),
          referrers: [...(referrers.get(requestedKey) ?? [])],
        });
      }
      if (reportedKeys.has(finalKey)) continue;
      reportedKeys.add(finalKey);
      // A redirect moves its discovery credit to the landing URL so the
      // orphan check below compares final URLs on both sides.
      if (finalKey !== requestedKey) {
        inlinkCounts.set(finalKey, (inlinkCounts.get(finalKey) ?? 0) + (inlinkCounts.get(requestedKey) ?? 0));
      }
      if (options.checkLinks) {
        const broken = await checkPageLinks(
          r,
          reportedKeys,
          { timeout, concurrency, blockPrivateIps, userAgent: ua },
          linkState,
          robotsText,
        );
        for (const b of broken) {
          addFailure(b.url, Number(/(\d{3})/.exec(b.status)?.[1] ?? 0), b.status, "fetch", [
            r.fetched.finalUrl,
          ]);
        }
      }
      const facts = pageFacts(r, next, canon);
      if (options.skills || options.excludeSkills) {
        r.findings = applySkillsFilter(r.findings, options.skills, options.excludeSkills);
        r.scores = computeScores(r.findings, r.geo);
      }
      const pageReport = toReport(r, next);
      result.pageReports.push(pageReport);
      result.pages.push(facts);
      dbg(`page ${next} -> search ${pageReport.scores.search.score} ai ${pageReport.scores.ai.score}`);

      // Inlink accounting scans every discovered link of every audited page
      // (orphan detection + broken-link attribution), even once the page cap
      // is reached — otherwise links from the last pages never count and
      // their targets are misreported as orphans.
      for (const lk of facts.links) {
        inlinkCounts.set(lk, (inlinkCounts.get(lk) ?? 0) + 1);
        const refs = referrers.get(lk) ?? [];
        if (refs.length < 5) {
          refs.push(facts.finalUrl);
          referrers.set(lk, refs);
        }
      }

      if (result.pageReports.length < maxPages) {
        // Slice-drops are only evidence of missed coverage when the dropped
        // links are genuinely new — nav menus repeat seen URLs, which would
        // cry wolf on every site.
        const isAuto = mode === "auto" || Boolean(options.all);
        const linkLimit = isAuto ? r.parsed.internalLinks.length : 10;
        const droppedCandidate = isAuto ? [] : r.parsed.internalLinks.slice(10);
        const unseenDropped = droppedCandidate.filter(
          /** @param {string} link @returns {boolean} */ (link) => {
            const lk = canon(link) || link;
            return !!lk && !seen.has(lk);
          },
        );
        if (unseenDropped.length > 0) result.capped = true;
        for (const link of r.parsed.internalLinks.slice(0, linkLimit)) {
          const lk = canon(link) || link;
          if (!lk || seen.has(lk)) continue;
          if (!allowedHosts.has(hostOf(link))) {
            dbg(`skip outside allowed hosts ${link}`);
            seen.add(lk);
            continue;
          }
          const lPath = pathOf(link);
          if (isAssetUrl(link)) {
            dbg(`skip non-HTML asset ${link}`);
            seen.add(lk);
            continue;
          }
          if (options.include && !includes(lPath)) {
            dbg(`skip not matching --include: ${link}`);
            seen.add(lk);
            continue;
          }
          if (options.exclude && excludes(lPath)) {
            dbg(`skip matching --exclude: ${link}`);
            seen.add(lk);
            continue;
          }
          const nextDepth = currentDepth + 1;
          if ((options.maxDepth ?? 0) > 0 && nextDepth > (options.maxDepth ?? 0)) {
            dbg(`skip exceeding --max-depth ${options.maxDepth}: ${link}`);
            continue;
          }
          if (!options.force && robotsText && isDisallowed(robotsText, UA_TOKEN, robotsPathOf(link))) {
            dbg(`skip robots-disallowed ${link}`);
            seen.add(lk);
            continue;
          }
          if (result.pageReports.length + queue.length >= maxPages) {
            result.capped = true;
            break;
          }
          queue.push({ url: link, depth: nextDepth });
          seen.add(lk);
        }
      }
    }
  }

  // Failures recorded before their referrers were known: attach them now.
  for (const f of result.failures) {
    if (f.referrers.length === 0) f.referrers = referrers.get(canon(f.url) || f.url) ?? [];
  }
  for (const rd of result.redirects) {
    if (rd.referrers.length === 0) rd.referrers = referrers.get(canon(rd.url) || rd.url) ?? [];
  }
  // Possibly orphaned pages: crawled, but no crawled page links to them
  // (the start page is exempt — the crawl begins there, not via a link).
  result.orphanIndexes = result.pages
    .map((p, idx) => ({ p, idx }))
    .filter((o) => o.idx > 0 && (inlinkCounts.get(o.p.key) ?? 0) === 0)
    .map((o) => o.idx);
  return result;
}

// ---------------------------------------------------------------------------
// Local (offline) analysis
// ---------------------------------------------------------------------------

const HTML_EXT = new Set([".html", ".htm"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".one-step-seo"]);

/**
 * True for .html / .htm paths.
 * @param {string} file
 * @returns {boolean}
 */
export function isHtmlFile(file) {
  return HTML_EXT.has(extname(file).toLowerCase());
}

/**
 * Recursively collect .html/.htm files under dir (deterministic order;
 * node_modules, .git and the tool's own state directory are skipped).
 * @param {string} dir
 * @returns {string[]}
 */
export function collectHtmlFiles(dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} d */
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(join(d, e.name));
      } else if (e.isFile() && isHtmlFile(e.name)) {
        out.push(join(d, e.name));
      }
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Resolve a CLI target (path or file:// URL) to an absolute filesystem path.
 * Returns "" for an unparseable file URL.
 * @param {string} rawTarget
 * @returns {string}
 */
export function resolveLocalTarget(rawTarget) {
  let target = rawTarget;
  if (/^file:\/\//i.test(rawTarget)) {
    try {
      target = fileURLToPath(rawTarget);
    } catch {
      return "";
    }
  }
  return resolve(target);
}

/**
 * Assemble local siteFiles from disk if robots.txt / sitemap.xml / llms.txt exist in dir.
 * @param {string} dir site root directory
 * @returns {any}
 */
export function getLocalSiteFiles(dir) {
  let robots = {
    found: true,
    status: 200,
    sitemaps: /** @type {string[]} */ ([]),
    disallowCount: 0,
    aiBlocked: false,
    blockedBots: /** @type {string[]} */ ([]),
    textSample: "# Local offline audit",
    text: "User-agent: *\nAllow: /",
  };
  const robotsPath = join(dir, "robots.txt");
  if (existsSync(robotsPath)) {
    try {
      const text = readFileSync(robotsPath, "utf8");
      const parsed = parseRobots(text);
      robots = {
        found: true,
        status: 200,
        sitemaps: parsed.sitemaps,
        disallowCount: parsed.disallows.length,
        aiBlocked: parsed.aiBlocked,
        blockedBots: parsed.blockedBots,
        textSample: text.slice(0, 200),
        text,
      };
    } catch {
      // local robots.txt unreadable — keep synthetic fallback
    }
  }

  let sitemap = {
    found: true,
    status: 200,
    url: "",
    urlCount: 1,
    fromRobots: /** @type {string[]} */ ([]),
    truncated: false,
    text: "",
  };
  const sitemapPath = join(dir, "sitemap.xml");
  if (existsSync(sitemapPath)) {
    try {
      const text = readFileSync(sitemapPath, "utf8");
      sitemap = {
        found: true,
        status: 200,
        url: pathToFileURL(sitemapPath).toString(),
        urlCount: extractSitemapUrls(text).length,
        fromRobots: /** @type {string[]} */ ([]),
        truncated: false,
        text,
      };
    } catch {
      // local sitemap.xml unreadable — keep synthetic fallback
    }
  }

  let llms = { found: false, status: 404, bytes: 0, text: "" };
  const llmsPath = join(dir, "llms.txt");
  if (existsSync(llmsPath)) {
    try {
      const text = readFileSync(llmsPath, "utf8");
      llms = { found: true, status: 200, bytes: Buffer.byteLength(text, "utf8"), text };
    } catch {
      // local llms.txt unreadable — keep synthetic fallback
    }
  }

  return { origin: "file://local", robots, sitemap, llms };
}

/**
 * Analyze a local HTML file and return the same result shape as analyzeOne().
 * @param {string} filePath absolute path to an existing .html/.htm file
 * @param {{ profile?: string, siteRoot?: string }} [opts] siteRoot is the
 *   directory holding robots.txt / sitemap.xml / llms.txt (default: the file's directory)
 */
export function analyzeLocalFile(filePath, opts = {}) {
  const html = readFileSync(filePath, "utf8");
  const stats = statSync(filePath);
  const fileUrl = pathToFileURL(filePath).toString();
  const siteFiles = getLocalSiteFiles(opts.siteRoot || dirname(filePath));
  const fetched = {
    ok: true,
    status: 200,
    url: fileUrl,
    finalUrl: fileUrl,
    statusChain: [{ url: fileUrl, status: 200 }],
    contentType: "text/html",
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-length": String(stats.size),
    },
    html,
    bytes: stats.size,
    truncated: false,
    ms: 1,
    error: "",
  };
  const a = analyzeHtml(html, fetched, siteFiles, { profile: opts.profile, offline: true });
  return {
    fetched,
    parsed: a.parsed,
    siteFiles,
    findings: a.findings,
    scores: a.scores,
    geo: a.geo,
    schemaInfo: a.schemaInfo,
    truncated: false,
    skipped: false,
  };
}
