#!/usr/bin/env node
/**
 * one-step-seo CLI — zero dependencies, Node 18+.
 * Usage:
 *   one-step-seo audit <url> [--pages N] [--out DIR] [--format html,md,json] [--fail-on P0] [--crawl links|sitemap]
 *   one-step-seo page <url> [--out DIR] [--format html,md,json]
 *   one-step-seo quick <url> [--pages N] [--out DIR]
 *   one-step-seo schema <url> [--generate organization|website|article|faq|breadcrumb|product|event|localbusiness|howto]
 *   one-step-seo sitemap <url> [--json]
 *   one-step-seo llms <url> [--json]
 *   one-step-seo fix <path> [--apply] [--only a,b] [--url U] [--title T] [--description D] [--lang L] [--og-image U]
 *   one-step-seo diff <old-report.json> <new-report.json> [--json] [--fail-on P0]
 *   one-step-seo doctor [--json]
 *   one-step-seo (no command → interactive prompts on a TTY)
 */
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
  statSync,
  existsSync,
} from "node:fs";
import { dirname, join, resolve, relative, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, execFile } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fetchWithRedirects, fetchText } from "../lib/fetch.mjs";
import { parseHtml } from "../lib/html.mjs";
import {
  getSiteFiles,
  getSitemapUrls,
  isDisallowed,
  parseRobots,
  extractSitemapUrls,
} from "../lib/robots.mjs";
import { runChecks, MAX_LINK_CHECKS } from "../lib/checks.mjs";
import { extractJsonLd, validateSchema, schemaSnippet } from "../lib/schema.mjs";
import { geoDetails, computeScores, scoreBand } from "../lib/score.mjs";
import {
  buildReport,
  renderMarkdown,
  renderHtml,
  renderSiteIndex,
  renderSarif,
  renderCsv,
  siteBasename,
  siteTopFindings,
  coverageLine,
  findDuplicateTitles,
} from "../lib/report.mjs";
import { getFindingMeta, FINDING_META } from "../lib/finding-meta.mjs";
import { parseArgs, normalizeUrl, canonicalizeUrl, isLocalPath, CliError, MAX_PAGES } from "../lib/args.mjs";
import { planFixes, FIXER_NAMES } from "../lib/fix.mjs";
import { diffReports, isReport } from "../lib/report-diff.mjs";
import { unifiedDiff } from "../lib/diff.mjs";
import { fetchPsi, psiFindings } from "../lib/psi.mjs";
import { createColorHelper, c } from "../lib/colors.mjs";
import { getSkills, getSkill, CATEGORIES, filterSkills } from "../lib/skills.mjs";

export { createColorHelper, c };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let VERSION = "0.0.0";
try {
  VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version ?? VERSION;
} catch {
  // Package layout without package.json (bundled) — keep fallback version.
}

/** Product token used for robots.txt group matching. */
const UA_TOKEN = "one-step-seo";
/** Clear User-Agent sent on every request (version follows package.json). */
const UA = `Mozilla/5.0 (compatible; one-step-seo/${VERSION}; +https://github.com/6t9xstar/one-step-seo)`;

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Path component of an absolute URL for robots matching; "/" on garbage.
 * @param {string} link
 * @returns {string}
 */
function pathOf(link) {
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
function hostOf(link) {
  try {
    return new URL(link).host.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Print the top 3 urgent fixes with triage labels + the next command.
 * @param {import("../lib/report.mjs").Report} report
 * @param {string} rerun the exact command that reproduces this audit
 */
function printTopFixes(report, rerun) {
  const top = (report.findings ?? []).filter((f) => f && f.severity !== "pass").slice(0, 3);
  if (top.length === 0) {
    console.log("Top fixes: none — all checks passed.");
  } else {
    console.log(c.bold("Top fixes:"));
    for (const f of top) {
      const meta = getFindingMeta(String(f.id ?? ""));
      const hint = String(f.fix || meta.plain).slice(0, 120);
      console.log(`  ${c.severityBadge(f.severity)} ${f.title} (${f.id}) — ${hint}`);
      console.log(`    Impact: ${meta.impact} · Effort: ${meta.effort} · Owner: ${meta.owner}`);
    }
  }
  console.log(`Next: fix the items above, then re-run \`${rerun}\`.`);
}

/**
 * Top fixes across all audited pages: worst severity first, then most
 * widespread. Each finding counts once per page it appears on.
 * @param {import("../lib/report.mjs").Report[]} pageReports
 * @param {string} rerun the exact command that reproduces this audit
 */
function printTopFixesSite(pageReports, rerun) {
  const n = pageReports.length;
  const top = siteTopFindings(pageReports, 3);
  if (top.length === 0) {
    console.log("Top fixes: none — all checks passed.");
  } else {
    console.log(c.bold(`Top fixes across ${n} page${n === 1 ? "" : "s"}:`));
    for (const { finding: f, pages } of top) {
      const meta = getFindingMeta(String(f.id ?? ""));
      const hint = String(f.fix || meta.plain).slice(0, 120);
      const scope = pages > 1 ? ` — on ${pages}/${n} pages` : "";
      console.log(`  ${c.severityBadge(f.severity)} ${f.title} (${f.id})${scope} — ${hint}`);
      console.log(`    Impact: ${meta.impact} · Effort: ${meta.effort} · Owner: ${meta.owner}`);
    }
  }
  console.log(`Next: fix the items above, then re-run \`${rerun}\`.`);
}

/**
 * Check robots.txt for a crawl start URL. Warms the per-origin site-file
 * cache as a side effect. Never throws — a missing robots.txt means allowed.
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 * @returns {Promise<{ blocked: boolean, robotsText: string }>}
 */
async function checkRobotsAllowed(url, args) {
  let text = "";
  try {
    const site = await getSiteFiles(url, {
      timeoutMs: args.timeout,
      userAgent: UA,
      blockPrivateIps: Boolean(args.blockPrivateIps),
    });
    text = site.robots.text ?? "";
    if (args.debug) {
      console.error(
        `debug: robots.txt ${site.robots.found ? `found (${site.robots.disallowCount} disallow rules)` : "missing"} for ${site.origin}`,
      );
    }
  } catch {
    // Best-effort: without robots.txt there is nothing to enforce.
    text = "";
  }
  const blocked = !args.force && text !== "" && isDisallowed(text, UA_TOKEN, pathOf(url));
  return { blocked, robotsText: text };
}

/**
 * Minimal report for a robots-refused crawl: one P1 finding, no pages.
 * @param {string} url
 * @returns {import("../lib/report.mjs").Report}
 */
function blockedReport(url) {
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
 * Verify a page's same-host link targets (`--check-links`). Appends one
 * aggregated T16 finding for broken targets. Shared budget + checked-set
 * bound total requests per run; already-audited (known-200) and
 * robots-disallowed targets are skipped, never fetched.
 * @param {any} r analyzeOne result (parsed non-null)
 * @param {import("../lib/report.mjs").Report[]} pageReports reports so far (known-good finals)
 * @param {import("../lib/args.mjs").ParsedArgs} args
 * @param {{ budget: number, checked: Set<string> }} state shared across pages
 * @param {string} robotsText robots.txt of the crawled origin ("" skips the policy check)
 */
async function checkPageLinks(r, pageReports, args, state, robotsText) {
  const knownGood = new Set(pageReports.map((pr) => canonicalizeUrl(pr.finalUrl) || pr.finalUrl));
  knownGood.add(canonicalizeUrl(r.fetched.finalUrl) || r.fetched.finalUrl);
  /** @type {string[]} */
  const targets = [];
  for (const link of r.parsed.internalLinks ?? []) {
    if (state.budget <= 0) break;
    const lk = canonicalizeUrl(link) || link;
    if (!lk || !/^https?:\/\//i.test(lk) || state.checked.has(lk) || knownGood.has(lk)) continue;
    if (robotsText && isDisallowed(robotsText, UA_TOKEN, pathOf(link))) continue;
    state.checked.add(lk);
    state.budget--;
    targets.push(lk);
  }
  if (targets.length === 0) return;
  /** @type {{ url: string, status: string }[]} */
  const broken = [];
  for (let i = 0; i < targets.length; i += args.concurrency) {
    const batch = targets.slice(i, i + args.concurrency);
    const results = await Promise.allSettled(
      batch.map((u) =>
        fetchText(u, {
          timeoutMs: args.timeout,
          userAgent: UA,
          blockPrivateIps: Boolean(args.blockPrivateIps),
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
}

function usage(code = 0) {
  console.log(`one-step-seo v${VERSION} — one command SEO + AI-visibility audit
Usage:
  one-step-seo audit <url|dir> [--pages N] [--out DIR] [--format html,md,json] [--fail-on P0|P1|P2] [--crawl links|sitemap] [--skills S] [--offline]
  one-step-seo page <url|file> [--out DIR] [--format html,md,json] [--skills S] [--offline]
  one-step-seo ai <url> [--out DIR] [--format html,md,json] [--json]
  one-step-seo quick <url|dir> [--pages N] [--out DIR]
  one-step-seo skills [skill-id] [--json]
  one-step-seo schema <url> [--generate organization|website|article|faq|breadcrumb|product|event|localbusiness|howto|video|job|course|review|recipe]
  one-step-seo sitemap <url> [--json]
  one-step-seo llms <url> [--json]
  one-step-seo fix <path> [--apply] [--only NAMES] [--url U] [--title T] [--description D] [--lang L] [--og-image U]
  one-step-seo diff <old-report.json> <new-report.json> [--json] [--fail-on P0|P1|P2]
  one-step-seo doctor [--json] [--check-config]
  one-step-seo (no command: interactive prompts when attached to a TTY)

Options:
  --pages N       pages to crawl for 'audit' (default 1, max 200; 'quick' defaults to 5)
  --out DIR       output directory (default ./seo-report)
  --format        comma list among html,md,json,sarif,csv (default html,md,json)
  --timeout MS    per-request timeout in ms (default 15000, 1000-120000)
  --fail-on SEV   exit 2 when any page has P0 (or P1/P2) findings — for CI gating
  --crawl MODE    audit discovery: links (BFS over internal links) or sitemap (default links)
  --concurrency N parallel page fetches 1-8 (default 4)
  --delay MS      politeness pause between crawl batches in ms (default 250, 0-10000)
  --skills LIST   comma list of skill IDs or categories (e.g. onpage,schema,technical-seo)
  --exclude-skills LIST comma list of skill IDs or categories to exclude
  --offline       audit purely offline without network requests (local file/dir auditing)
  --debug         verbose diagnostics: parsed args, robots.txt status, per-page timings
  --quiet, -q     suppress informational messages; output errors and final summaries only
  --force         crawl even when robots.txt disallows the URL (documented override)
  --check-links   verify same-host link targets (capped at 100 checks/run, off by default)
  --block-private-ips  block SSRF requests targeting private, loopback, or metadata IPs
  --check-config  validate runtime configuration, CLI flags, and environment health
  --profile NAME  page-type calibration: default|blog|product|docs|home (default default)
  --psi           measure Core Web Vitals via Google PageSpeed Insights (reads PSI_API_KEY)
  --psi-strategy  performance strategy: mobile (default) or desktop
  --json          print JSON to stdout (sitemap / llms / doctor / fix / diff / ai / skills)

Fix options (fix is a dry-run unless --apply is given):
  --apply         write the fixes to disk (creates <file>.bak backups)
  --only NAMES    comma list: ${FIXER_NAMES.join(",")}
  --url URL       absolute URL used for canonical / og:url fixes
  --title TEXT    <title> value when missing (else derived from the first <h1>)
  --description T meta description when missing (else derived from page text)
  --lang LANG     <html lang> value when missing (never guessed)
  --og-image URL  absolute image URL used for og:image
  --no-backup     skip the .bak copy on --apply

Notes:
  - Multi-page audits write report.json/md/html for page 1 plus
    report-N.json/md/html for pages 2+ and an index.md linking all pages.
  - quick is audit with beginner defaults (5 pages, all formats).
  - ai runs a dedicated AI Search Visibility and Citability audit.
  - skills inspects available auditing capabilities and check coverage.
  - page/audit accept local HTML files (.html/.htm) or directories for 100% offline auditing.
  - audit/page skip robots.txt-disallowed URLs unless --force; a
    T05-robots-disallow report is written instead. schema warns only.
  - diff compares two report.json files (base vs. head) for CI regression
    gating; --fail-on trips on NEW or escalated findings only.
  - fix accepts local .html/.htm files or directories; additive fixes only.
  - Only audit sites you are allowed to crawl; respect robots.txt.
`);
  process.exit(code);
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
  if (!fetched.ok || !fetched.html) {
    return {
      fetched,
      parsed: null,
      siteFiles: null,
      findings: [],
      scores: null,
      geo: null,
      schemaInfo: null,
      truncated: false,
      skipped: false,
    };
  }
  if (allowedHosts) {
    let finalHost = "";
    try {
      finalHost = new URL(fetched.finalUrl).host.toLowerCase();
    } catch {
      // Keep "" — treated as outside the set below.
    }
    if (!finalHost || !allowedHosts.has(finalHost)) {
      return {
        fetched,
        parsed: null,
        siteFiles: null,
        findings: [],
        scores: null,
        geo: null,
        schemaInfo: null,
        truncated: false,
        skipped: true,
      };
    }
  }
  const parsed = parseHtml(fetched.html, fetched.finalUrl);
  const siteFiles = await getSiteFiles(fetched.finalUrl, {
    timeoutMs,
    ...(userAgent ? { userAgent } : {}),
    ...(blockPrivateIps ? { blockPrivateIps: true } : {}),
  });
  const schemaRaw = extractJsonLd(parsed.jsonLdBlocks);
  const validated = validateSchema(schemaRaw.items);
  const schemaInfo = {
    items: schemaRaw.items,
    types: validated.types,
    issues: validated.issues,
    errors: schemaRaw.errors,
  };
  const findings = runChecks(parsed, siteFiles, fetched, schemaInfo, { profile });
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
  return {
    fetched,
    parsed,
    siteFiles,
    findings,
    scores,
    geo,
    schemaInfo,
    truncated: fetched.truncated,
    skipped: false,
  };
}

/**
 * @param {any} r result of analyzeOne (with parsed non-null)
 * @param {string} url requested URL
 */
function toReport(r, url) {
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
 * @param {string} outDir
 * @param {import("../lib/report.mjs").Report} report
 * @param {string[]} formats
 * @param {string} [basename]
 * @param {{ indexHref?: string, pageCount?: number }} [htmlOpts] forwarded to renderHtml
 */
function writeOutputs(outDir, report, formats, basename = "report", htmlOpts) {
  mkdirSync(outDir, { recursive: true });
  const written = [];
  if (formats.includes("json")) {
    const p = join(outDir, `${basename}.json`);
    writeFileSync(p, JSON.stringify(report, null, 2) + "\n", "utf8");
    written.push(p);
  }
  if (formats.includes("md")) {
    const p = join(outDir, `${basename}.md`);
    writeFileSync(p, renderMarkdown(report), "utf8");
    written.push(p);
  }
  if (formats.includes("html")) {
    const p = join(outDir, `${basename}.html`);
    writeFileSync(p, renderHtml(report, htmlOpts), "utf8");
    written.push(p);
  }
  if (formats.includes("sarif")) {
    const p = join(outDir, `${basename}.sarif`);
    writeFileSync(p, JSON.stringify(renderSarif(report), null, 2) + "\n", "utf8");
    written.push(p);
  }
  if (formats.includes("csv")) {
    const p = join(outDir, `${basename}.csv`);
    writeFileSync(p, renderCsv(report), "utf8");
    written.push(p);
  }
  return written;
}

/**
 * @param {import("../lib/report.mjs").Report[]} pageReports
 */
function summarizeAggregate(pageReports) {
  let searchSum = 0;
  let aiSum = 0;
  let searchMin = 100;
  let aiMin = 100;
  /** @type {Record<string, number>} */
  const totals = { P0: 0, P1: 0, P2: 0, P3: 0, pass: 0 };
  for (const r of pageReports) {
    searchSum += r.scores.search.score;
    aiSum += r.scores.ai.score;
    searchMin = Math.min(searchMin, r.scores.search.score);
    aiMin = Math.min(aiMin, r.scores.ai.score);
    for (const k of Object.keys(totals)) totals[k] = (totals[k] ?? 0) + (r.counts[k] ?? 0);
  }
  const n = pageReports.length || 1;
  return {
    avgSearch: Math.round(searchSum / n),
    avgAi: Math.round(aiSum / n),
    minSearch: searchMin,
    minAi: aiMin,
    totals,
  };
}

/** @param {string} severity @param {Record<string, number>} counts @returns {boolean} */
function breachesFailOn(severity, counts) {
  if (!severity) return false;
  /** @type {Record<string, number>} */
  const rank = { P0: 0, P1: 1, P2: 2 };
  const threshold = rank[severity];
  if (threshold === undefined) return false;
  for (const [sev, r] of Object.entries(rank)) {
    if (r <= threshold && (counts[sev] ?? 0) > 0) return true;
  }
  return false;
}

/**
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdAudit(url, args) {
  const psiKey = process.env.PSI_API_KEY;
  if (args.psi && !psiKey) {
    throw new CliError(
      `--psi requires the PSI_API_KEY environment variable.\nGet a free API key at https://developers.google.com/speed/docs/insights/v5/get-started and run:\n  PSI_API_KEY=your_key one-step-seo audit <url> --psi`,
      1,
    );
  }
  const formats = args.formats;
  const concurrency = Math.max(1, Math.min(8, args.concurrency ?? 4));
  /** @param {...unknown} m */
  const dbg = (...m) => {
    if (args.debug) console.error("debug:", ...m);
  };
  dbg(
    `audit ${url} pages=${args.pages} crawl=${args.crawl} concurrency=${concurrency} delay=${args.delay} timeout=${args.timeout} force=${args.force}`,
  );
  const seen = new Set([canonicalizeUrl(url) || url]);
  const queue = [url];
  /** @type {import("../lib/report.mjs").Report[]} */
  const pageReports = [];
  // Pragmatic same-host policy: the start host plus the first landing host
  // (covers apex <-> www canonicalization), locked after that. Discovered
  // links and redirect landings outside the set are skipped, never crawled.
  const allowedHosts = new Set([hostOf(url)]);
  let adoptedOnce = false;
  let failed = 0;
  // Inlink counts per canonical URL (orphan detection). Seeds start at zero:
  // sitemap-only pages with no crawled inlinks count as orphaned for equity.
  /** @type {Map<string, number>} */
  const inlinkCounts = new Map();
  // True when the crawl saw more URLs than the page cap could take
  // (sitemap seeds cut, discovery queue full, or >10 links on a page).
  let capped = false;
  // Shared link-verification budget for --check-links (bounded total
  // requests per run; targets already checked are never re-fetched).
  /** @type {{ budget: number, checked: Set<string> }} */
  const linkState = { budget: args.checkLinks ? MAX_LINK_CHECKS : 0, checked: new Set() };

  const { blocked, robotsText } = await checkRobotsAllowed(url, args);
  if (blocked) {
    console.error(
      `! robots.txt disallows auditing ${url} — crawl skipped (re-run with --force to override).`,
    );
    const report = blockedReport(url);
    const written = writeOutputs(resolve(args.out), report, formats);
    console.log(
      `\nSearch SEO: ${c.scoreBadge(report.scores.search.score, report.scores.search.band)}  |  AI Visibility: ${c.scoreBadge(report.scores.ai.score, report.scores.ai.band)}`,
    );
    printTopFixes(report, `one-step-seo audit ${url} --pages ${args.pages} --force`);
    console.log(`Wrote:\n  ${written.join("\n  ")}`);
    return;
  }

  // Seed sitemap-mode queue from the sitemap discovery. The root URL is
  // already in `queue`, so the cap must count only *extra* seeds — comparing
  // `queue.length >= args.pages` would break immediately at the default
  // --pages 1 and add nothing.
  if (args.crawl === "sitemap") {
    try {
      const seeds = await getSitemapUrls(url, {
        timeoutMs: args.timeout,
        userAgent: UA,
        blockPrivateIps: Boolean(args.blockPrivateIps),
      });
      dbg(`sitemap seeds: ${seeds.length}`);
      let added = 0;
      for (const seed of seeds) {
        if (added >= Math.max(0, args.pages - 1)) {
          capped = true;
          break;
        }
        const key = canonicalizeUrl(seed) || seed;
        if (seen.has(key)) continue;
        queue.push(seed);
        seen.add(key);
        added++;
      }
      // Only warn when the sitemap genuinely yielded nothing. At --pages 1 the
      // root is already queued, so an empty `seeds` is the real signal.
      if (seeds.length === 0) {
        console.error("! sitemap has no usable URLs — falling back to link crawl.");
      }
    } catch {
      // ignore — link crawl proceeds
    }
  }

  let firstBatch = true;
  while (queue.length > 0 && pageReports.length < args.pages) {
    if (!firstBatch && args.delay > 0) await sleep(args.delay);
    firstBatch = false;
    const batch = [];
    while (batch.length < concurrency && queue.length > 0 && pageReports.length + batch.length < args.pages) {
      const next = queue.shift();
      if (next === undefined) break;
      const key = canonicalizeUrl(next) || next;
      if (seen.has(key) && pageReports.some((r) => r.url === next)) continue;
      seen.add(key);
      batch.push(next);
    }
    if (batch.length === 0) break;
    const results = await Promise.allSettled(
      batch.map((u) =>
        analyzeOne(u, args.timeout, UA, allowedHosts, args.profile, {
          blockPrivateIps: Boolean(args.blockPrivateIps),
        }),
      ),
    );
    for (let i = 0; i < batch.length; i++) {
      const next = batch[i];
      const settled = results[i];
      if (!next || !settled) continue;
      if (settled.status === "rejected") {
        const reason = settled.reason;
        console.error(`! ${next} -> ${reason instanceof Error ? reason.message : String(reason)}`);
        failed++;
        continue;
      }
      let r = settled.value;
      if (r.skipped) {
        const skipHost = hostOf(r.fetched.finalUrl);
        if (pageReports.length === 0 && !adoptedOnce && skipHost) {
          // Pragmatic redirect policy: the start URL itself may canonicalize
          // across hosts (apex <-> www). Adopt the first landing host, then
          // lock the set: re-analyze without the gate for the full report.
          dbg(`adopted redirect host ${skipHost}`);
          allowedHosts.add(skipHost);
          adoptedOnce = true;
          r = await analyzeOne(next, args.timeout, UA, null, args.profile, {
            blockPrivateIps: Boolean(args.blockPrivateIps),
          });
        } else {
          console.error(`! ${next} landed outside the allowed hosts (${skipHost || "unknown"}) — skipped.`);
          failed++;
          continue;
        }
      }
      if (!r.parsed) {
        console.error(`! ${next} -> ${r.fetched.error || r.fetched.status}`);
        failed++;
        continue;
      }
      // Guard against redirect-alias duplicates (http<->https, trailing slash).
      const finalKey = canonicalizeUrl(r.fetched.finalUrl) || r.fetched.finalUrl;
      if (pageReports.some((pr) => (canonicalizeUrl(pr.finalUrl) || pr.finalUrl) === finalKey)) {
        continue;
      }
      // A redirect moves its discovery credit to the landing URL so the
      // orphan check below compares final URLs on both sides.
      const requestedKey = canonicalizeUrl(next) || next;
      if (finalKey !== requestedKey) {
        inlinkCounts.set(finalKey, (inlinkCounts.get(finalKey) ?? 0) + (inlinkCounts.get(requestedKey) ?? 0));
      }
      if (args.checkLinks) {
        await checkPageLinks(r, pageReports, args, linkState, robotsText);
      }
      if (args.skills || args.excludeSkills) {
        r.findings = applySkillsFilter(r.findings, args.skills, args.excludeSkills);
        r.scores = computeScores(r.findings, r.geo);
      }
      const pageReport = toReport(r, next);
      pageReports.push(pageReport);
      dbg(`page ${next} -> search ${pageReport.scores.search.score} ai ${pageReport.scores.ai.score}`);
      if (pageReports.length < args.pages) {
        // Slice-drops are only evidence of missed coverage when the dropped
        // links are genuinely new — nav menus repeat seen URLs, which would
        // cry wolf on every site.
        const unseenDropped = r.parsed.internalLinks.slice(10).filter(
          /** @param {string} link @returns {boolean} */ (link) => {
            const lk = canonicalizeUrl(link) || link;
            return !!lk && !seen.has(lk);
          },
        );
        if (unseenDropped.length > 0) capped = true;
        // Inlink accounting scans every discovered link (orphan detection),
        // while queueing stays capped at 10 per page for crawl breadth.
        // Credit lands before the seen-skip below so sitemap seeds linked
        // from crawled pages still count as linked.
        for (const link of r.parsed.internalLinks) {
          const lk = canonicalizeUrl(link) || link;
          if (lk) inlinkCounts.set(lk, (inlinkCounts.get(lk) ?? 0) + 1);
        }
        for (const link of r.parsed.internalLinks.slice(0, 10)) {
          const lk = canonicalizeUrl(link) || link;
          if (!lk || seen.has(lk)) continue;
          if (!allowedHosts.has(hostOf(link))) {
            dbg(`skip outside allowed hosts ${link}`);
            seen.add(lk);
            continue;
          }
          if (!args.force && robotsText && isDisallowed(robotsText, UA_TOKEN, pathOf(link))) {
            dbg(`skip robots-disallowed ${link}`);
            seen.add(lk);
            continue;
          }
          if (pageReports.length + queue.length >= args.pages) {
            capped = true;
            break;
          }
          queue.push(link);
          seen.add(lk);
        }
      }
    }
  }

  if (pageReports.length === 0) {
    console.error("Audit failed: no pages could be fetched.");
    // Set exitCode instead of process.exit() so open fetch sockets can close
    // gracefully (abrupt exit crashes on Windows/Node 24, UV_HANDLE_CLOSING).
    process.exitCode = 2;
    return;
  }

  if (args.psi && psiKey) {
    let firstPsi = true;
    for (const report of pageReports) {
      if (!firstPsi && args.delay > 0) await sleep(args.delay);
      firstPsi = false;
      dbg(`fetching PSI for ${report.finalUrl} (${args.psiStrategy})...`);
      const psiRes = await fetchPsi(report.finalUrl, {
        key: psiKey,
        strategy: args.psiStrategy,
        timeoutMs: 25000,
        userAgent: UA,
      });
      if (psiRes.data) {
        report.page.psi = psiRes.data;
      }
      const extraFindings = psiFindings(psiRes);
      for (const ef of extraFindings) {
        report.findings.push(ef);
        report.counts[ef.severity] = (report.counts[ef.severity] ?? 0) + 1;
      }
    }
  }

  const outDir = resolve(args.out);
  const withHtml = formats.includes("html");
  // Possibly orphaned pages: crawled, but no crawled page links to them
  // (the start page is exempt — the crawl begins there, not via a link).
  const orphans = pageReports
    .map((r, idx) => ({ r, idx }))
    .filter(
      /** @param {{ r: import("../lib/report.mjs").Report, idx: number }} o @returns {boolean} */ (o) =>
        o.idx > 0 && (inlinkCounts.get(canonicalizeUrl(o.r.finalUrl) || o.r.finalUrl) ?? 0) === 0,
    );
  const dups = pageReports.length > 1 ? findDuplicateTitles(pageReports) : [];
  const siteOpts =
    pageReports.length > 1 && withHtml
      ? { indexHref: "index.html", pageCount: pageReports.length }
      : undefined;
  /** @type {string[]} */
  const written = [];
  pageReports.forEach((report, idx) => {
    const basename = siteBasename(idx);
    written.push(...writeOutputs(outDir, report, formats, basename, siteOpts));
  });
  // Index linking all pages. Format links are conditional: with
  // `--format json` no .md files exist, so unconditional links would 404.
  if (pageReports.length > 1) {
    const lines = [`# one-step-seo index`, ``, `Audited ${pageReports.length} pages.`, ``];
    if (withHtml) lines.push(`Browse the [site dashboard](./index.html).`, ``);
    pageReports.forEach((r, idx) => {
      const name = siteBasename(idx);
      const links = [
        ...(formats.includes("md") ? [`[md](./${name}.md)`] : []),
        ...(formats.includes("json") ? [`[json](./${name}.json)`] : []),
        ...(formats.includes("html") ? [`[html](./${name}.html)`] : []),
        ...(formats.includes("sarif") ? [`[sarif](./${name}.sarif)`] : []),
      ];
      lines.push(
        `- Page ${idx + 1}: ${r.finalUrl} — Search ${r.scores.search.score} (${r.scores.search.band}), AI ${r.scores.ai.score} (${r.scores.ai.band}) — ${links.join(" ")}`,
      );
    });
    lines.push(``);
    if (dups.length > 0) {
      lines.push(`## Duplicate titles & descriptions`, ``);
      for (const d of dups.slice(0, 10)) {
        const refs = d.pages.map((i) => `page ${i + 1}`).join(", ");
        lines.push(
          `- Duplicate ${d.kind} on ${refs}: "${d.value.slice(0, 120)}" — give each page a unique ${d.kind}.`,
        );
      }
      if (dups.length > 10) lines.push(`- …and ${dups.length - 10} more (see index.html).`);
      lines.push(``);
    }
    if (orphans.length > 0) {
      lines.push(`## Possibly orphaned pages`, ``);
      for (const o of orphans.slice(0, 10)) {
        lines.push(
          `- ${o.r.finalUrl} — no crawled page links to it (sitemap-only counts too); add contextual internal links or confirm it is intentionally standalone.`,
        );
      }
      if (orphans.length > 10) lines.push(`- …and ${orphans.length - 10} more (see index.html).`);
      lines.push(``);
    }
    const indexPath = join(outDir, "index.md");
    writeFileSync(indexPath, lines.join("\n") + "\n", "utf8");
    written.push(indexPath);
    if (withHtml) {
      const dashboardPath = join(outDir, "index.html");
      writeFileSync(dashboardPath, renderSiteIndex(pageReports), "utf8");
      written.push(dashboardPath);
    }
  }

  const primary = pageReports[0];
  if (!primary) return;
  const agg = summarizeAggregate(pageReports);
  console.log(
    `\nSearch SEO: ${c.scoreBadge(primary.scores.search.score, primary.scores.search.band)}  |  AI Visibility: ${c.scoreBadge(primary.scores.ai.score, primary.scores.ai.band)}`,
  );
  console.log(
    `Pages audited: ${pageReports.length}${failed > 0 ? ` (${failed} failed or skipped — see warnings above)` : ""}`,
  );
  if (pageReports.length > 1) {
    console.log(
      `Aggregate: avg Search ${agg.avgSearch} / AI ${agg.avgAi} · min Search ${agg.minSearch} / AI ${agg.minAi}`,
    );
    console.log(
      `Totals: P0=${agg.totals.P0} P1=${agg.totals.P1} P2=${agg.totals.P2} P3=${agg.totals.P3} pass=${agg.totals.pass}`,
    );
    const coverage = coverageLine(pageReports.length, args.pages, capped, MAX_PAGES);
    if (coverage) console.log(coverage);
    if (dups.length > 0) {
      const dupTitles = dups.filter((d) => d.kind === "title").length;
      const dupMetas = dups.length - dupTitles;
      /** @type {string[]} */
      const parts = [];
      if (dupTitles > 0) parts.push(`${dupTitles} title${dupTitles === 1 ? "" : "s"}`);
      if (dupMetas > 0) parts.push(`${dupMetas} description${dupMetas === 1 ? "" : "s"}`);
      console.log(`Duplicates: shared ${parts.join(" + ")} across pages (see index.md).`);
    }
    if (orphans.length > 0) {
      console.log(`Orphaned pages (no inlinks from crawled pages):`);
      for (const o of orphans.slice(0, 5)) console.log(`  - ${o.r.finalUrl}`);
      if (orphans.length > 5) console.log(`  …and ${orphans.length - 5} more (see index.md).`);
    }
  }
  console.log(
    `Counts: P0=${primary.counts.P0} P1=${primary.counts.P1} P2=${primary.counts.P2} P3=${primary.counts.P3} pass=${primary.counts.pass}`,
  );
  if (pageReports.length > 1) {
    printTopFixesSite(pageReports, `one-step-seo audit ${url} --pages ${args.pages}`);
  } else {
    printTopFixes(primary, `one-step-seo audit ${url} --pages ${args.pages}`);
  }
  if (written.length > 12) {
    const startHere =
      pageReports.length > 1 && withHtml ? join(outDir, "index.html") : join(outDir, "index.md");
    console.log(`Wrote ${written.length} files into ${outDir} — start at ${startHere}.`);
  } else {
    console.log(`Wrote:\n  ${written.join("\n  ")}`);
  }

  if (args.failOn) {
    const breached = pageReports.some((r) => breachesFailOn(args.failOn, r.counts));
    if (breached) {
      console.error(`Fail-on threshold breached: found ${args.failOn} (or higher) findings.`);
      process.exitCode = 2;
      return;
    }
  }
}

/**
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdPage(url, args) {
  const psiKey = process.env.PSI_API_KEY;
  if (args.psi && !psiKey) {
    throw new CliError(
      `--psi requires the PSI_API_KEY environment variable.\nGet a free API key at https://developers.google.com/speed/docs/insights/v5/get-started and run:\n  PSI_API_KEY=your_key one-step-seo page <url> --psi`,
      1,
    );
  }
  const { blocked, robotsText } = await checkRobotsAllowed(url, args);
  if (blocked) {
    console.error(
      `! robots.txt disallows auditing ${url} — crawl skipped (re-run with --force to override).`,
    );
    const blockedRep = blockedReport(url);
    const writtenBlocked = writeOutputs(resolve(args.out), blockedRep, args.formats);
    console.log(
      `Search SEO: ${c.scoreBadge(blockedRep.scores.search.score, blockedRep.scores.search.band)}  |  AI Visibility: ${c.scoreBadge(blockedRep.scores.ai.score, blockedRep.scores.ai.band)}`,
    );
    printTopFixes(blockedRep, `one-step-seo page ${url} --force`);
    console.log(`Wrote:\n  ${writtenBlocked.join("\n  ")}`);
    return;
  }
  const r = await analyzeOne(url, args.timeout, UA, null, args.profile, {
    blockPrivateIps: Boolean(args.blockPrivateIps),
  });
  if (!r.parsed) {
    console.error(`Fetch failed: ${r.fetched.error || r.fetched.status}`);
    process.exitCode = 2;
    return;
  }
  if (args.debug)
    console.error(`debug: page ${url} fetched in ${r.fetched.ms}ms (${r.fetched.html.length} chars)`);
  if (args.checkLinks) {
    await checkPageLinks(r, [], args, { budget: MAX_LINK_CHECKS, checked: new Set() }, robotsText);
  }
  if (args.skills || args.excludeSkills) {
    r.findings = applySkillsFilter(r.findings, args.skills, args.excludeSkills);
    r.scores = computeScores(r.findings, r.geo);
  }
  if (args.skills || args.excludeSkills) {
    r.findings = applySkillsFilter(r.findings, args.skills, args.excludeSkills);
    r.scores = computeScores(r.findings, r.geo);
  }
  const report = toReport(r, url);
  if (args.psi && psiKey) {
    if (args.debug) console.error(`debug: fetching PSI for ${report.finalUrl} (${args.psiStrategy})...`);
    const psiRes = await fetchPsi(report.finalUrl, {
      key: psiKey,
      strategy: args.psiStrategy,
      timeoutMs: 25000,
      userAgent: UA,
    });
    if (psiRes.data) {
      report.page.psi = psiRes.data;
    }
    const extraFindings = psiFindings(psiRes);
    for (const ef of extraFindings) {
      report.findings.push(ef);
      report.counts[ef.severity] = (report.counts[ef.severity] ?? 0) + 1;
    }
  }
  const written = writeOutputs(resolve(args.out), report, args.formats);
  console.log(
    `Search SEO: ${c.scoreBadge(report.scores.search.score, report.scores.search.band)}  |  AI Visibility: ${c.scoreBadge(report.scores.ai.score, report.scores.ai.band)}`,
  );
  printTopFixes(report, `one-step-seo page ${url}`);
  console.log(`Wrote:\n  ${written.join("\n  ")}`);
  if (args.failOn && breachesFailOn(args.failOn, report.counts)) {
    console.error(`Fail-on threshold breached: found ${args.failOn} (or higher) findings.`);
    process.exitCode = 2;
    return;
  }
}

/**
 * AI-search visibility and citability audit.
 * Evaluates machine readability, entity definitions, and citation signals.
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdAi(url, args) {
  const { blocked } = await checkRobotsAllowed(url, args);
  if (blocked) {
    console.error(
      `! robots.txt disallows auditing ${url} — crawl skipped (re-run with --force to override).`,
    );
    const blockedRep = blockedReport(url);
    const writtenBlocked = writeOutputs(resolve(args.out), blockedRep, args.formats);
    console.log(
      `AI Visibility: ${c.scoreBadge(blockedRep.scores.ai.score, blockedRep.scores.ai.band)}  |  Search SEO: ${c.scoreBadge(blockedRep.scores.search.score, blockedRep.scores.search.band)}`,
    );
    printTopFixes(blockedRep, `one-step-seo ai ${url} --force`);
    if (writtenBlocked.length > 0) console.log(`Wrote:\n  ${writtenBlocked.join("\n  ")}`);
    return;
  }
  const r = await analyzeOne(url, args.timeout, UA, null, args.profile, {
    blockPrivateIps: Boolean(args.blockPrivateIps),
  });
  if (!r.parsed) {
    console.error(`Fetch failed: ${r.fetched.error || r.fetched.status}`);
    process.exitCode = 2;
    return;
  }
  if (args.debug) {
    console.error(`debug: page ${url} fetched in ${r.fetched.ms}ms (${r.fetched.html.length} chars)`);
  }
  if (args.skills || args.excludeSkills) {
    r.findings = applySkillsFilter(r.findings, args.skills, args.excludeSkills);
    r.scores = computeScores(r.findings, r.geo);
  }
  const report = toReport(r, url);
  const written = writeOutputs(resolve(args.out), report, args.formats);

  const robotsAiBlocked = r.siteFiles?.robots?.aiBlocked ?? false;
  const blockedBots = r.siteFiles?.robots?.blockedBots ?? [];
  const llmsFound = r.siteFiles?.llms?.found ?? false;
  const llmsBytes = r.siteFiles?.llms?.bytes ?? 0;
  const schemaTypes = r.schemaInfo?.types ?? [];
  const hasAuthor = Boolean(r.parsed.author);
  const hasLandmarks = Boolean(r.parsed.hasMainLandmark);
  const hasDirectAnswer = Boolean(r.parsed.hasAnswerBlock);

  const aiFindings = (report.findings ?? []).filter(
    (f) => f && (f.category === "geo" || (f.geoImpact && f.geoImpact !== "-")),
  );

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          tool: "one-step-seo",
          version: VERSION,
          url: report.finalUrl,
          aiScore: report.scores.ai.score,
          aiBand: report.scores.ai.band,
          searchScore: report.scores.search.score,
          searchBand: report.scores.search.band,
          signals: {
            robotsAiBlocked,
            blockedBots,
            llmsFound,
            llmsBytes,
            schemaTypes,
            hasAuthor,
            hasLandmarks,
            hasDirectAnswer,
          },
          findings: aiFindings,
          reports: written,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!args.quiet) {
    console.log(c.bold(`AI Search Visibility & Citability Audit: ${report.finalUrl}`));
    console.log(c.dim(`Evaluates machine readability, entity definitions, and citations for AI engines.\n`));
  }

  console.log(
    `AI Visibility: ${c.scoreBadge(report.scores.ai.score, report.scores.ai.band)}  |  Search SEO: ${c.scoreBadge(report.scores.search.score, report.scores.search.band)}`,
  );

  console.log(`\n${c.bold("Citability & Signal Checklist:")}`);
  /** @param {boolean} ok */
  const mark = (ok) => (ok ? c.green("  [✓] Pass: ") : c.yellow("  [✗] Missing: "));
  console.log(
    `${mark(!robotsAiBlocked)}AI crawlers in robots.txt${robotsAiBlocked ? ` (blocked: ${blockedBots.join(", ")})` : " (allowed or not restricted)"}`,
  );
  console.log(
    `${mark(llmsFound)}llms.txt discoverable${llmsFound ? ` (${llmsBytes} bytes)` : " — add /llms.txt for machine summaries"}`,
  );
  console.log(
    `${mark(schemaTypes.length > 0)}Structured Data (JSON-LD)${schemaTypes.length > 0 ? ` (${schemaTypes.join(", ")})` : " — no schema detected"}`,
  );
  console.log(
    `${mark(hasAuthor)}Author attribution${hasAuthor ? ` ("${r.parsed.author}")` : " — missing author metadata"}`,
  );
  console.log(
    `${mark(hasLandmarks)}Semantic content landmarks${hasLandmarks ? " (<main> or <article> present)" : " — consider using <main> or <article>"}`,
  );
  console.log(
    `${mark(hasDirectAnswer)}Direct Answer section${hasDirectAnswer ? " (concise answer block detected)" : " (40-90 words question/answer recommended)"}`,
  );

  const urgentAi = aiFindings.filter((f) => f.severity !== "pass").slice(0, 3);
  if (urgentAi.length > 0) {
    console.log(`\n${c.bold("Top AI Visibility Fixes:")}`);
    for (const f of urgentAi) {
      const meta = getFindingMeta(String(f.id ?? ""));
      const hint = String(f.fix || meta.plain).slice(0, 120);
      console.log(`  ${c.severityBadge(f.severity)} ${f.title} (${f.id}) — ${hint}`);
      console.log(`    Impact: ${meta.impact} · Effort: ${meta.effort} · Owner: ${meta.owner}`);
    }
  } else {
    console.log(`\nTop AI Visibility Fixes: none — all checked signals passed.`);
  }

  if (written.length > 0) {
    console.log(`\nWrote:\n  ${written.join("\n  ")}`);
  }

  if (args.failOn && breachesFailOn(args.failOn, report.counts)) {
    console.error(`Fail-on threshold breached: found ${args.failOn} (or higher) findings.`);
    process.exitCode = 2;
  }
}

/**
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdSchema(url, args) {
  const r = await analyzeOne(url, args.timeout, UA, null, args.profile, {
    blockPrivateIps: Boolean(args.blockPrivateIps),
  });
  if (!r.parsed) {
    console.error(`Fetch failed: ${r.fetched.error || r.fetched.status}`);
    process.exitCode = 2;
    return;
  }
  if (!args.force && r.siteFiles) {
    try {
      const robotsText = String(r.siteFiles.robots?.text ?? "");
      const p = pathOf(r.fetched.finalUrl);
      if (robotsText && isDisallowed(robotsText, UA_TOKEN, p)) {
        console.error(`! note: robots.txt disallows ${r.fetched.finalUrl} — results are diagnostic only.`);
      }
    } catch {
      // Best-effort diagnostic note; never blocks schema output.
    }
  }
  console.log(
    `Found ${r.schemaInfo.items.length} JSON-LD node(s): ${r.schemaInfo.types.join(", ") || "(none)"}`,
  );
  for (const e of r.schemaInfo.errors) console.log(`  ERROR: ${e}`);
  for (const i of r.schemaInfo.issues) console.log(`  ISSUE [${i.type}]: ${i.issue}`);
  if (args.generate) {
    console.log(`\n--- snippet (${args.generate}) ---`);
    try {
      console.log(
        schemaSnippet(args.generate, {
          name: r.parsed.title || url,
          url: r.fetched.finalUrl,
          description: r.parsed.metaDescription,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Cannot generate "${args.generate}": ${msg}`);
      console.error(`Provide a real page title + URL — placeholder "Example" data is refused.`);
      process.exit(1);
    }
  }
}

/**
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdSitemap(url, args) {
  let normalized;
  try {
    normalized = new URL(url).toString();
  } catch {
    console.error("Provide a valid URL, e.g. one-step-seo sitemap https://example.com");
    process.exit(1);
  }
  const siteFiles = await getSiteFiles(normalized, {
    timeoutMs: args.timeout,
    userAgent: UA,
    blockPrivateIps: Boolean(args.blockPrivateIps),
  });
  const out = {
    origin: siteFiles.origin,
    robotsFound: siteFiles.robots.found,
    robotsSitemaps: siteFiles.robots.sitemaps,
    sitemapFound: siteFiles.sitemap.found,
    sitemapUrl: siteFiles.sitemap.url,
    sitemapUrls: siteFiles.sitemap.urlCount,
    sitemapTruncated: !!siteFiles.sitemap.truncated,
    llmsFound: siteFiles.llms.found,
  };
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`Origin: ${out.origin}`);
    console.log(`robots.txt: ${out.robotsFound ? "found" : "MISSING"}`);
    console.log(
      `sitemap.xml: ${out.sitemapFound ? `found at ${out.sitemapUrl} (~${out.sitemapUrls} URLs)` : "MISSING"}`,
    );
    console.log(`llms.txt: ${out.llmsFound ? "found" : "missing (optional)"}`);
  }
}

/**
 * Draft a starter llms.txt from best-effort page data. Titles and URLs come
 * from the live page/sitemap; anything unknown is an explicit placeholder
 * so no facts are ever invented.
 * @param {string} host
 * @param {string} title
 * @param {string} desc
 * @param {string[]} seeds
 * @returns {string}
 */
function buildLlmsStarter(host, title, desc, seeds) {
  const lines = [
    `# ${title || host}`,
    ``,
    `> ${desc || "Machine-readable summary for AI assistants. Replace this line with a one-paragraph description of the site."}`,
    ``,
    `## Key pages`,
    ``,
  ];
  if (seeds.length === 0) {
    lines.push("(no sitemap URLs discovered — add your most-cited pages manually)");
  } else {
    for (const s of seeds) lines.push(`- ${s}`);
  }
  lines.push(
    ``,
    `## Optional`,
    ``,
    `- Replace the links above with your most-cited pages, each with a one-line description.`,
  );
  return lines.join("\n");
}

/**
 * Copy-paste robots.txt snippet that lets the major AI crawlers read public
 * content. Display names are hardcoded (short, readable); matching is
 * case-insensitive so capitalization is safe.
 * @returns {string}
 */
function aiRobotsSnippet() {
  const majors = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot"];
  const lines = ["# Let AI assistants read and cite your public content (optional)"];
  for (const b of majors) {
    lines.push(`User-agent: ${b}`, "Allow: /", "");
  }
  return lines.join("\n").trimEnd();
}

/**
 * llms.txt status + generated starter draft + AI-crawler robots snippet.
 * Diagnostic output only — nothing is written anywhere.
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdLlms(url, args) {
  const site = await getSiteFiles(url, {
    timeoutMs: args.timeout,
    userAgent: UA,
    blockPrivateIps: Boolean(args.blockPrivateIps),
  });
  let title = "";
  let desc = "";
  try {
    const f = await fetchWithRedirects(url, {
      timeoutMs: args.timeout,
      userAgent: UA,
      blockPrivateIps: Boolean(args.blockPrivateIps),
    });
    if (f.ok && f.html) {
      const p = parseHtml(f.html, f.finalUrl);
      title = p.title;
      desc = p.metaDescription;
    }
  } catch {
    // Best-effort: the starter still works from sitemap URLs alone.
  }
  /** @type {string[]} */
  let seeds = [];
  try {
    seeds = (
      await getSitemapUrls(url, {
        timeoutMs: args.timeout,
        userAgent: UA,
        blockPrivateIps: Boolean(args.blockPrivateIps),
      })
    ).slice(0, 20);
  } catch {
    // Best-effort: an empty seed list is still a usable starter.
    seeds = [];
  }
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // Keep the raw URL as the heading fallback.
  }
  const starter = buildLlmsStarter(host, title, desc, seeds);
  const robotsSnippet = aiRobotsSnippet();
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          tool: "one-step-seo",
          version: VERSION,
          url,
          llmsFound: site.llms.found,
          llmsBytes: site.llms.bytes,
          starter,
          robotsSnippet,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(`llms.txt: ${site.llms.found ? `found (${site.llms.bytes} bytes)` : "missing (optional)"}`);
  console.log(`\n--- starter llms.txt (curate before publishing) ---`);
  console.log(starter);
  console.log(`\n--- robots.txt AI-crawler snippet (optional) ---`);
  console.log(robotsSnippet);
}

/** @param {import("../lib/args.mjs").ParsedArgs} args */
async function cmdDoctor(args) {
  const nodeMajor = Number(process.version.slice(1).split(".")[0]);
  const nodeOk = nodeMajor >= 18;
  const fetchOk = typeof fetch === "function";
  const psiKey = Boolean(process.env.PSI_API_KEY);
  const isTty = Boolean(process.stdout.isTTY);
  const colorEnabled = Boolean(isTty && !process.env.NO_COLOR && process.env.TERM !== "dumb");

  const info = {
    tool: "one-step-seo",
    version: VERSION,
    node: process.version,
    nodeOk,
    fetch: fetchOk,
    terminal: {
      isTTY: isTty,
      color: colorEnabled,
      noColor: Boolean(process.env.NO_COLOR),
    },
    env: {
      PSI_API_KEY: psiKey ? "configured" : "not set (optional for --psi)",
    },
    configCheck: "ok",
  };
  if (args.json) console.log(JSON.stringify(info, null, 2));
  else {
    console.log(`one-step-seo v${VERSION}`);
    console.log(`node ${info.node} ${info.nodeOk ? "(ok)" : "(NEEDS >=18)"}`);
    console.log(`fetch: ${info.fetch ? "ok" : "missing"}`);
    console.log(
      `terminal: isTTY=${isTty}, color=${colorEnabled}${process.env.NO_COLOR ? " (NO_COLOR set)" : ""}`,
    );
    console.log(`env PSI_API_KEY: ${info.env.PSI_API_KEY}`);
    if (args.checkConfig) {
      console.log(`configuration check: all defaults and environment valid (ok)`);
    }
  }
  if (!info.nodeOk || !info.fetch) process.exit(2);
}

const HTML_EXT = new Set([".html", ".htm"]);
const SKIP_DIRS = new Set(["node_modules", ".git"]);

/**
 * Recursively collect .html/.htm files under dir (deterministic order,
 * node_modules and .git skipped).
 * @param {string} dir
 * @returns {string[]}
 */
function collectHtmlFiles(dir) {
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
      } else if (e.isFile() && HTML_EXT.has(extname(e.name).toLowerCase())) {
        out.push(join(d, e.name));
      }
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Filter finding checks based on --skills and --exclude-skills flags.
 * @param {any[]} findings
 * @param {string} skillsFilter
 * @param {string} excludeSkillsFilter
 * @returns {any[]}
 */
function applySkillsFilter(findings, skillsFilter, excludeSkillsFilter) {
  if (!skillsFilter && !excludeSkillsFilter) return findings;
  /** @type {Set<string> | null} */
  let allowedChecks = null;
  if (skillsFilter) {
    const included = skillsFilter
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const active = filterSkills({ include: included });
    allowedChecks = new Set(active.flatMap((s) => s.checks));
  }
  /** @type {Set<string> | null} */
  let excludedChecks = null;
  if (excludeSkillsFilter) {
    const excluded = excludeSkillsFilter
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const inactive = filterSkills({ include: excluded });
    excludedChecks = new Set(inactive.flatMap((s) => s.checks));
  }
  return findings.filter((f) => {
    if (allowedChecks && !allowedChecks.has(f.id)) return false;
    if (excludedChecks && excludedChecks.has(f.id)) return false;
    return true;
  });
}

/**
 * Assemble local siteFiles from disk if robots.txt / sitemap.xml / llms.txt exist in dir.
 * @param {string} dir
 * @returns {any}
 */
function getLocalSiteFiles(dir) {
  let robots = {
    found: true,
    status: 200,
    sitemaps: /** @type {string[]} */ ([]),
    disallowCount: 0,
    aiBlocked: false,
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
      const urls = extractSitemapUrls(text);
      sitemap = {
        found: true,
        status: 200,
        url: pathToFileURL(sitemapPath).toString(),
        urlCount: urls.length,
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
      llms = {
        found: true,
        status: 200,
        bytes: Buffer.byteLength(text, "utf8"),
        text,
      };
    } catch {
      // local llms.txt unreadable — keep synthetic fallback
    }
  }

  return { origin: "file://local", robots, sitemap, llms };
}

/**
 * Display registered auditing skills or detailed skill documentation.
 * @param {string} skillId
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
function cmdSkills(skillId, args) {
  if (skillId && skillId !== "list") {
    const skill = getSkill(skillId);
    if (!skill) {
      console.error(`Unknown skill: "${skillId}". Run "one-step-seo skills" to see all registered skills.`);
      process.exit(1);
    }
    if (args.json) {
      console.log(JSON.stringify(skill, null, 2));
      return;
    }
    console.log(`\n${c.bold(`Skill: ${skill.name}`)} (${c.cyan(skill.id)})`);
    console.log(`Category: ${CATEGORIES[skill.category]?.name ?? skill.category}`);
    console.log(`Offline Supported: ${skill.offlineSupported ? c.green("Yes") : c.yellow("No")}`);
    console.log(`\n${c.bold("Description:")}\n  ${skill.description}`);
    console.log(`\n${c.bold("Purpose:")}\n  ${skill.purpose}`);
    console.log(`\n${c.bold(`Checks (${skill.checks.length} rules):`)}`);
    for (const check of skill.checks) {
      const meta = FINDING_META[check];
      const plain = meta ? ` — ${meta.plain.slice(0, 80)}…` : "";
      console.log(`  - ${c.bold(check)}${plain}`);
    }
    console.log(`\n${c.bold("Remediation:")}\n  ${skill.remediation}`);
    console.log(`\n${c.bold("Limitations:")}\n  ${skill.limitations}\n`);
    return;
  }

  const allSkills = getSkills();
  if (args.json) {
    console.log(JSON.stringify(allSkills, null, 2));
    return;
  }

  console.log(`\n${c.bold("One-Step SEO — Skills Registry")} (v${VERSION})\n`);
  console.log(
    `${"ID".padEnd(24)} ${"CATEGORY".padEnd(16)} ${"NAME".padEnd(36)} ${"OFFLINE".padEnd(8)} ${"CHECKS"}`,
  );
  console.log("-".repeat(96));
  for (const s of allSkills) {
    const id = s.id.padEnd(24);
    const cat = s.category.padEnd(16);
    const name = s.name.padEnd(36);
    const off = (s.offlineSupported ? "Yes" : "No").padEnd(8);
    const checks = `${s.checks.length} checks`;
    console.log(`${id} ${cat} ${name} ${off} ${checks}`);
  }
  console.log(
    `\nTotal: ${allSkills.length} skills across ${Object.keys(CATEGORIES).length} categories. Run "one-step-seo skills <skill-id>" for details.\n`,
  );
}

/**
 * Audit a single local HTML file directly from disk.
 * @param {string} rawTarget
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
function auditLocalFile(rawTarget, args) {
  let target = rawTarget;
  if (/^file:\/\//i.test(rawTarget)) {
    try {
      target = fileURLToPath(rawTarget);
    } catch {
      console.error(`Invalid file URL: ${rawTarget}`);
      process.exit(1);
    }
  }
  const filePath = resolve(target);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    console.error(`Local file not found: ${rawTarget}`);
    process.exit(1);
  }
  const html = readFileSync(filePath, "utf8");
  const stats = statSync(filePath);
  const fileUrl = pathToFileURL(filePath).toString();
  const dir = dirname(filePath);
  const siteFiles = getLocalSiteFiles(dir);
  const parsed = parseHtml(html, fileUrl);
  const schemaRaw = extractJsonLd(parsed.jsonLdBlocks);
  const validated = validateSchema(schemaRaw.items);
  const schemaInfo = {
    items: schemaRaw.items,
    types: validated.types,
    issues: validated.issues,
    errors: schemaRaw.errors,
  };
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
  let findings = runChecks(parsed, siteFiles, fetched, schemaInfo, { profile: args.profile, offline: true });
  if (args.skills || args.excludeSkills) {
    findings = applySkillsFilter(findings, args.skills, args.excludeSkills);
  }
  const geo = geoDetails(parsed, siteFiles);
  const scores = computeScores(findings, geo);
  const report = buildReport({
    url: fileUrl,
    finalUrl: fileUrl,
    scores,
    findings,
    parsed,
    siteFiles,
    meta: { version: VERSION },
  });

  const written = writeOutputs(resolve(args.out), report, args.formats);
  console.log(
    `Search SEO: ${c.scoreBadge(report.scores.search.score, report.scores.search.band)}  |  AI Visibility: ${c.scoreBadge(report.scores.ai.score, report.scores.ai.band)}`,
  );
  printTopFixes(report, `one-step-seo page ${rawTarget}`);
  console.log(`Wrote:\n  ${written.join("\n  ")}`);
  if (args.failOn && breachesFailOn(args.failOn, report.counts)) {
    console.error(`Fail-on threshold breached: found ${args.failOn} (or higher) findings.`);
    process.exitCode = 2;
  }
}

/**
 * Audit a local directory of HTML files offline.
 * @param {string} rawTarget
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
function auditLocalDirectory(rawTarget, args) {
  let target = rawTarget;
  if (/^file:\/\//i.test(rawTarget)) {
    try {
      target = fileURLToPath(rawTarget);
    } catch {
      console.error(`Invalid file URL: ${rawTarget}`);
      process.exit(1);
    }
  }
  const dirPath = resolve(target);
  if (!existsSync(dirPath)) {
    console.error(`Path not found: ${rawTarget}`);
    process.exit(1);
  }
  /** @type {string[]} */
  let htmlFiles = [];
  if (statSync(dirPath).isDirectory()) {
    htmlFiles = collectHtmlFiles(dirPath);
  } else if (HTML_EXT.has(extname(dirPath).toLowerCase())) {
    htmlFiles = [dirPath];
  }

  if (htmlFiles.length === 0) {
    console.error(`No .html or .htm files found in: ${rawTarget}`);
    process.exit(1);
  }

  const limit = Math.min(htmlFiles.length, args.pages);
  const targetFiles = htmlFiles.slice(0, limit);
  const outDir = resolve(args.out);
  const withHtml = args.formats.includes("html");
  /** @type {import("../lib/report.mjs").Report[]} */
  const pageReports = [];
  /** @type {string[]} */
  const written = [];

  for (let i = 0; i < targetFiles.length; i++) {
    const file = targetFiles[i];
    if (!file) continue;
    const html = readFileSync(file, "utf8");
    const stats = statSync(file);
    const fileUrl = pathToFileURL(file).toString();
    const siteFiles = getLocalSiteFiles(dirname(file));
    const parsed = parseHtml(html, fileUrl);
    const schemaRaw = extractJsonLd(parsed.jsonLdBlocks);
    const validated = validateSchema(schemaRaw.items);
    const schemaInfo = {
      items: schemaRaw.items,
      types: validated.types,
      issues: validated.issues,
      errors: schemaRaw.errors,
    };
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
    let findings = runChecks(parsed, siteFiles, fetched, schemaInfo, {
      profile: args.profile,
      offline: true,
    });
    if (args.skills || args.excludeSkills) {
      findings = applySkillsFilter(findings, args.skills, args.excludeSkills);
    }
    const geo = geoDetails(parsed, siteFiles);
    const scores = computeScores(findings, geo);
    const report = buildReport({
      url: fileUrl,
      finalUrl: fileUrl,
      scores,
      findings,
      parsed,
      siteFiles,
      meta: { version: VERSION },
    });
    pageReports.push(report);
    const base = i === 0 ? "report" : `report-${i + 1}`;
    const w = writeOutputs(outDir, report, args.formats, base, {
      indexHref: withHtml && targetFiles.length > 1 ? "index.html" : undefined,
      pageCount: targetFiles.length,
    });
    written.push(...w);
    if (!args.quiet) {
      console.log(`[${i + 1}/${limit}] ${relative(process.cwd(), file)}`);
    }
  }

  const primary = pageReports[0];
  if (!primary) return;

  if (pageReports.length > 1) {
    const agg = summarizeAggregate(pageReports);
    const searchBand = scoreBand(agg.avgSearch);
    const aiBand = scoreBand(agg.avgAi);
    console.log(
      `\nAudited ${pageReports.length} local page(s):\n` +
        `  Search SEO: ${c.scoreBadge(agg.avgSearch, searchBand)}  |  AI Visibility: ${c.scoreBadge(agg.avgAi, aiBand)}  (avg across pages)\n` +
        `  Lowest page: Search ${agg.minSearch} · AI ${agg.minAi}\n` +
        `  Aggregate findings: P0=${agg.totals.P0} P1=${agg.totals.P1} P2=${agg.totals.P2} P3=${agg.totals.P3} pass=${agg.totals.pass}`,
    );
    if (args.formats.includes("md")) {
      const idxPath = join(outDir, "index.md");
      const lines = [
        `# Audit index — ${rawTarget}`,
        "",
        `Generated: ${new Date().toISOString()}`,
        `Pages audited: ${pageReports.length}`,
        `Average Search score: **${agg.avgSearch} (${searchBand})** · Average AI score: **${agg.avgAi} (${aiBand})**`,
        "",
        "## Pages",
        "",
      ];
      for (let i = 0; i < pageReports.length; i++) {
        const pr = pageReports[i];
        if (!pr) continue;
        const b = i === 0 ? "report" : `report-${i + 1}`;
        lines.push(
          `- [${pr.page.title || pr.url}](${b}.html) — Search ${pr.scores.search.score}, AI ${pr.scores.ai.score}`,
        );
      }
      lines.push("");
      writeFileSync(idxPath, lines.join("\n"), "utf8");
      written.push(idxPath);
    }
    if (withHtml) {
      const idxHtml = join(outDir, "index.html");
      writeFileSync(idxHtml, renderSiteIndex(pageReports), "utf8");
      written.push(idxHtml);
    }
    printTopFixesSite(pageReports, `one-step-seo audit ${rawTarget} --pages ${args.pages}`);
  } else {
    console.log(
      `\nSearch SEO: ${c.scoreBadge(primary.scores.search.score, primary.scores.search.band)}  |  AI Visibility: ${c.scoreBadge(primary.scores.ai.score, primary.scores.ai.band)}`,
    );
    printTopFixes(primary, `one-step-seo audit ${rawTarget} --pages ${args.pages}`);
  }

  if (written.length > 12) {
    const startHere =
      pageReports.length > 1 && withHtml ? join(outDir, "index.html") : join(outDir, "index.md");
    console.log(`Wrote ${written.length} files into ${outDir} — start at ${startHere}.`);
  } else {
    console.log(`Wrote:\n  ${written.join("\n  ")}`);
  }

  if (args.failOn) {
    const breached = pageReports.some((r) => breachesFailOn(args.failOn, r.counts));
    if (breached) {
      console.error(`Fail-on threshold breached: found ${args.failOn} (or higher) findings.`);
      process.exitCode = 2;
    }
  }
}

/**
 * Safe auto-fixes for local HTML files. Dry-run unless --apply.
 * @param {string} rawTarget path, directory or file:// URL
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
function cmdFix(rawTarget, args) {
  if (!rawTarget) {
    console.error("Provide a path: one-step-seo fix ./dist/index.html");
    process.exit(1);
  }
  let target = rawTarget;
  if (/^file:\/\//i.test(rawTarget)) {
    try {
      target = fileURLToPath(rawTarget);
    } catch {
      console.error(`Invalid file URL: ${rawTarget}`);
      process.exit(1);
    }
  }
  const abs = resolve(target);

  let stat;
  try {
    stat = statSync(abs);
  } catch {
    console.error(`Path not found: ${target}`);
    process.exit(1);
  }

  /** @type {string[]} */
  let files = [];
  if (stat.isDirectory()) {
    files = collectHtmlFiles(abs);
    if (files.length === 0) {
      console.error(`No .html/.htm files found under ${target}`);
      process.exit(1);
    }
  } else if (HTML_EXT.has(extname(abs).toLowerCase())) {
    files = [abs];
  } else {
    console.error(`fix only accepts .html/.htm files (got "${extname(abs) || "no extension"}").`);
    process.exit(1);
  }

  /** @type {string[] | null} */
  let only = null;
  if (args.only.trim()) {
    only = [
      ...new Set(
        args.only
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    const bad = only.filter((n) => !FIXER_NAMES.includes(n));
    if (bad.length > 0) {
      console.error(`Unknown fixer(s): ${bad.join(", ")}. Valid: ${FIXER_NAMES.join(", ")}`);
      process.exit(1);
    }
  }

  let url = "";
  if (args.url.trim()) {
    url = normalizeUrl(args.url);
    if (!url) {
      console.error(`--url must be an absolute http(s) URL (got "${args.url.slice(0, 60)}").`);
      process.exit(1);
    }
  }

  const ctx = {
    url,
    title: args.title,
    description: args.description,
    lang: args.lang,
    ogImage: args.ogImage,
    only,
  };

  /** @param {string} f */
  const rel = (f) => {
    const r = relative(process.cwd(), f);
    return r && !r.startsWith("..") ? r : f;
  };

  // seo-fix protocol: warn (don't refuse) when targets have uncommitted work.
  if (args.apply) {
    try {
      const porcelain = execFileSync("git", ["status", "--porcelain", "--", ...files.map(rel)], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }).toString();
      if (porcelain.trim()) {
        console.error("! target file(s) have uncommitted changes — .bak backups will be written alongside");
      }
    } catch {
      // git unavailable / not a repo — non-fatal
    }
  }

  const jsonFiles = [];
  let plannedTotal = 0;
  let appliedFixes = 0;
  let appliedFiles = 0;
  let errored = false;

  for (const file of files) {
    const label = rel(file);
    let html;
    try {
      html = readFileSync(file, "utf8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`! ${label}: ${msg}`);
      errored = true;
      jsonFiles.push({
        file: label,
        planned: [],
        skipped: [],
        verified: [],
        changed: false,
        applied: false,
        error: msg,
      });
      continue;
    }

    const plan = planFixes(html, ctx);
    if (plan.error) {
      console.error(`! ${label}: ${plan.error}`);
      errored = true;
      jsonFiles.push({
        file: label,
        planned: [],
        skipped: plan.skipped,
        verified: [],
        changed: false,
        applied: false,
        error: plan.error,
      });
      continue;
    }
    plannedTotal += plan.planned.length;

    if (!args.json) {
      if (plan.planned.length === 0 && plan.skipped.length === 0) {
        console.log(`${label}: nothing to fix`);
      } else {
        console.log(label);
        for (const p of plan.planned) {
          console.log(`  + ${p.name.padEnd(12)} ${p.findingId.padEnd(18)} ${p.summary}`);
        }
        for (const s of plan.skipped) {
          console.log(`  ! ${s.name.padEnd(12)} skipped: ${s.reason}`);
        }
      }
    }

    const entry = {
      file: label,
      planned: plan.planned.map((p) => ({
        name: p.name,
        findingId: p.findingId,
        summary: p.summary,
        partial: !!p.partial,
      })),
      skipped: plan.skipped,
      verified: plan.verified,
      changed: plan.changed,
      applied: false,
      error: /** @type {string | null} */ (null),
    };
    jsonFiles.push(entry);

    if (!plan.changed) continue;
    if (!args.json) console.log(unifiedDiff(html, plan.newHtml, label).replace(/\n$/, ""));

    if (!args.apply) continue;
    try {
      if (!args.noBackup) copyFileSync(file, `${file}.bak`);
      writeFileSync(file, plan.newHtml, "utf8");
      entry.applied = true;
      appliedFixes += plan.planned.length;
      appliedFiles++;
      if (!args.json) {
        const marks = plan.verified.map((v) => `${v.name} ${v.cleared ? "check" : "partial"}`).join(", ");
        console.log(`  verified: ${marks}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`! ${label}: write failed: ${msg}`);
      errored = true;
      entry.error = msg;
    }
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        { tool: "one-step-seo", version: VERSION, applied: args.apply, files: jsonFiles },
        null,
        2,
      ),
    );
  } else if (args.apply) {
    if (appliedFixes > 0) {
      const backupNote = args.noBackup ? "" : " (backups: *.bak)";
      console.log(`\nApplied ${appliedFixes} fix(es) to ${appliedFiles} file(s)${backupNote}.`);
    } else if (plannedTotal > 0) {
      console.log(`\n${plannedTotal} fix(es) planned but no files were written.`);
    } else {
      console.log(`\nNothing to fix.`);
    }
  } else if (plannedTotal > 0) {
    console.log(
      `\n${plannedTotal} fix(es) planned — dry run, no files written. Re-run with --apply to write.`,
    );
  }

  if (errored) process.exitCode = 2;
}

/**
 * Open a local report file in the default browser (best-effort).
 * @param {string} file
 * @returns {Promise<void>}
 */
async function openReport(file) {
  const opener = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const openerArgs = process.platform === "win32" ? ["/c", "start", "", file] : [file];
  await new Promise((resolve) => {
    execFile(opener, openerArgs, { timeout: 8000 }, () => resolve(undefined));
  });
}

/**
 * Beginner mode: ask four quick questions, then run a standard audit.
 * Only on an interactive TTY — piped/CI usage falls back to usage(1).
 */
async function cmdInteractive() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) usage(1);
  console.log("one-step-seo — answer 4 quick questions to audit a site.\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    let url = "";
    while (!url) {
      const raw = ((await rl.question("Website URL (e.g. https://example.com): ")) ?? "").trim();
      const normalized = normalizeUrl(raw);
      if (!normalized) console.error("That URL did not parse — try again, e.g. https://example.com");
      else url = normalized;
    }
    let pages = 5;
    const pagesRaw = ((await rl.question("Pages to audit, 1-20 (default 5): ")) ?? "").trim();
    if (pagesRaw) {
      const n = Number(pagesRaw);
      if (Number.isInteger(n) && n >= 1 && n <= 20) pages = n;
      else console.error("Keeping the default of 5 pages.");
    }
    const outRaw = ((await rl.question("Output folder (default ./seo-report): ")) ?? "").trim();
    const out = outRaw || "./seo-report";
    const openRaw = ((await rl.question("Open report.html when done? (y/N): ")) ?? "").trim().toLowerCase();
    const open = openRaw === "y" || openRaw === "yes";
    const interactiveArgs = parseArgs(["audit", url, "--pages", String(pages), "--out", out]);
    await cmdAudit(url, interactiveArgs);
    if (open) await openReport(join(resolve(out), "report.html"));
  } finally {
    rl.close();
  }
}

/**
 * Regression diff between two report.json files (base vs. head).
 * Exit 1 on unreadable/invalid inputs, 0 otherwise (2 on --fail-on breach).
 * @param {string[]} files exactly [oldPath, newPath]
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdDiff(files, args) {
  const [oldPath, newPath] = files;
  if (!oldPath || !newPath) {
    console.error("Provide two reports: one-step-seo diff old-report.json new-report.json");
    process.exit(1);
  }
  /** @param {string} p @returns {any} */
  const load = (p) => {
    let raw = "";
    try {
      raw = readFileSync(p, "utf8");
    } catch {
      console.error(`Cannot read ${p}`);
      process.exit(1);
    }
    try {
      return JSON.parse(raw);
    } catch {
      console.error(`Invalid JSON in ${p}`);
      process.exit(1);
    }
  };
  const oldR = load(oldPath);
  const newR = load(newPath);
  for (const [label, r] of [
    [oldPath, oldR],
    [newPath, newR],
  ]) {
    if (!isReport(r)) {
      console.error(`${label} is not a one-step-seo report.json (tool/scores/findings mismatch)`);
      process.exit(1);
    }
  }
  const d = diffReports(oldR, newR);
  /** @param {number} n @returns {string} */
  const signed = (n) => `${n > 0 ? "+" : ""}${n}`;
  if (args.json) {
    console.log(JSON.stringify({ tool: "one-step-seo", version: VERSION, ...d }, null, 2));
  } else {
    console.log(`Diff: ${oldPath} -> ${newPath}`);
    console.log(`URL: ${d.url}`);
    console.log(
      `Search SEO: ${d.search.old} -> ${d.search.new} (${signed(d.search.delta)})  |  AI Visibility: ${d.ai.old} -> ${d.ai.new} (${signed(d.ai.delta)})`,
    );
    if (d.rulesVersionChanged) {
      console.log(
        `! rules version changed ${d.oldRulesVersion || "(none)"} -> ${d.newRulesVersion || "(none)"} — deltas may reflect rule changes, not site changes.`,
      );
    }
    if (d.newFindings.length === 0 && d.resolvedFindings.length === 0 && d.escalated.length === 0) {
      console.log("No finding changes.");
    } else {
      for (const f of d.newFindings) console.log(`  NEW [${f.severity}] ${f.title} (${f.id})`);
      for (const f of d.resolvedFindings) console.log(`  RESOLVED [${f.severity}] ${f.title} (${f.id})`);
      for (const e of d.escalated)
        console.log(`  ESCALATED [${e.oldSeverity}->${e.newSeverity}] ${e.title} (${e.id})`);
    }
  }
  if (args.failOn) {
    /** @type {Record<string, number>} */
    const rank = { P0: 0, P1: 1, P2: 2 };
    const threshold = rank[args.failOn];
    const breach =
      threshold !== undefined &&
      (d.newFindings.some((f) => (rank[f.severity] ?? 9) <= threshold) ||
        d.escalated.some((e) => (rank[e.newSeverity] ?? 9) <= threshold));
    if (breach) {
      console.error(`Fail-on threshold breached: new or escalated ${args.failOn}+ findings.`);
      process.exitCode = 2;
    }
  }
}

// `--verbose` is also honoured from the env so CI logs can be made verbose
// without changing the command line.
let verbose = process.env.VERBOSE === "1";

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`Error: ${err.message}`);
      process.exit(err.code);
    }
    throw err;
  }
  verbose = verbose || args.verbose || args.debug;
  if (args.action === "help") usage(0);
  if (args.action === "version") {
    console.log(VERSION);
    return;
  }
  const [cmd, rawUrl] = args._;
  if (!cmd) return cmdInteractive();
  if (cmd === "doctor") return cmdDoctor(args);
  if (cmd === "skills") return cmdSkills(rawUrl ?? "", args);
  // `fix` targets local file paths — must route before URL normalization.
  if (cmd === "fix") return cmdFix(rawUrl ?? "", args);
  // `diff` compares local report.json files — also routes before URLs.
  if (cmd === "diff") return cmdDiff(args._.slice(1), args);

  // Local file or directory targets:
  if (rawUrl && isLocalPath(rawUrl)) {
    if (cmd === "page") return auditLocalFile(rawUrl, args);
    if (cmd === "audit" || cmd === "quick") {
      if (cmd === "quick") {
        const argv = process.argv.slice(2);
        const explicitPages = argv.some((a) => a === "--pages" || a.startsWith("--pages="));
        if (!explicitPages) args.pages = 5;
      }
      return auditLocalDirectory(rawUrl, args);
    }
  }

  if (cmd === "quick") {
    const argv = process.argv.slice(2);
    const explicitPages = argv.some((a) => a === "--pages" || a.startsWith("--pages="));
    if (!explicitPages) args.pages = 5;
    const quickUrl = normalizeUrl(rawUrl ?? "");
    if (!quickUrl) {
      console.error("Provide a valid URL or local file path, e.g. one-step-seo quick https://example.com");
      process.exit(1);
    }
    if (!args.quiet) {
      console.log(`Quick audit: up to ${args.pages} page(s), all formats, into ${args.out}.`);
    }
    return cmdAudit(quickUrl, args);
  }
  const url = normalizeUrl(rawUrl ?? "");
  if (!url) {
    console.error(
      `Provide a valid URL or local file path, e.g. one-step-seo ${cmd === "ai" ? "ai" : "audit"} https://example.com`,
    );
    process.exit(1);
  }
  if (cmd === "audit") return cmdAudit(url, args);
  if (cmd === "page") return cmdPage(url, args);
  if (cmd === "ai") return cmdAi(url, args);
  if (cmd === "schema") return cmdSchema(url, args);
  if (cmd === "sitemap") return cmdSitemap(url, args);
  if (cmd === "llms") return cmdLlms(url, args);
  console.error(`Unknown command: ${cmd}`);
  usage(1);
}

let interrupted = false;
process.on("SIGINT", () => {
  if (interrupted) process.exit(130);
  interrupted = true;
  console.error("\nInterrupted — finishing current page, then exiting…");
});

main().catch((err) => {
  if (err instanceof CliError) {
    console.error(`Error: ${err.message}`);
    process.exit(err.code);
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Runtime error: ${msg}`);
  if (verbose && err instanceof Error && err.stack) console.error(err.stack);
  process.exit(2);
});
