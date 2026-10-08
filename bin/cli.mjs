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
 *   one-step-seo doctor [--json]
 *   one-step-seo (no command → interactive prompts on a TTY)
 */
import { readFileSync, mkdirSync, writeFileSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, execFile } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fetchWithRedirects } from "../lib/fetch.mjs";
import { parseHtml } from "../lib/html.mjs";
import { getSiteFiles, getSitemapUrls, isDisallowed } from "../lib/robots.mjs";
import { runChecks } from "../lib/checks.mjs";
import { extractJsonLd, validateSchema, schemaSnippet } from "../lib/schema.mjs";
import { geoDetails, computeScores } from "../lib/score.mjs";
import { buildReport, renderMarkdown, renderHtml } from "../lib/report.mjs";
import { getFindingMeta } from "../lib/finding-meta.mjs";
import { parseArgs, normalizeUrl, canonicalizeUrl, CliError } from "../lib/args.mjs";
import { planFixes, FIXER_NAMES } from "../lib/fix.mjs";
import { unifiedDiff } from "../lib/diff.mjs";

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
 * Print the top 3 urgent fixes with triage labels + the next command.
 * @param {import("../lib/report.mjs").Report} report
 * @param {string} rerun the exact command that reproduces this audit
 */
function printTopFixes(report, rerun) {
  const top = (report.findings ?? []).filter((f) => f && f.severity !== "pass").slice(0, 3);
  if (top.length === 0) {
    console.log("Top fixes: none — all checks passed.");
  } else {
    console.log("Top fixes:");
    for (const f of top) {
      const meta = getFindingMeta(String(f.id ?? ""));
      const hint = String(f.fix || meta.plain).slice(0, 120);
      console.log(`  [${f.severity}] ${f.title} (${f.id}) — ${hint}`);
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
    const site = await getSiteFiles(url, { timeoutMs: args.timeout, userAgent: UA });
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

function usage(code = 0) {
  console.log(`one-step-seo v${VERSION} — one command SEO + AI-visibility audit
Usage:
  one-step-seo audit <url> [--pages N] [--out DIR] [--format html,md,json] [--fail-on P0|P1|P2] [--crawl links|sitemap]
  one-step-seo page <url> [--out DIR] [--format html,md,json]
  one-step-seo quick <url> [--pages N] [--out DIR]
  one-step-seo schema <url> [--generate organization|website|article|faq|breadcrumb|product|event|localbusiness|howto]
  one-step-seo sitemap <url> [--json]
  one-step-seo llms <url> [--json]
  one-step-seo fix <path> [--apply] [--only NAMES] [--url U] [--title T] [--description D] [--lang L] [--og-image U]
  one-step-seo doctor [--json]
  one-step-seo (no command: interactive prompts when attached to a TTY)

Options:
  --pages N       pages to crawl for 'audit' (default 1, max 200; 'quick' defaults to 5)
  --out DIR       output directory (default ./seo-report)
  --format        comma list among html,md,json (default html,md,json)
  --timeout MS    per-request timeout in ms (default 15000, 1000-120000)
  --fail-on SEV   exit 2 when any page has P0 (or P1/P2) findings — for CI gating
  --crawl MODE    audit discovery: links (BFS over internal links) or sitemap (default links)
  --concurrency N parallel page fetches 1-8 (default 4)
  --delay MS      politeness pause between crawl batches in ms (default 250, 0-10000)
  --debug         verbose diagnostics: parsed args, robots.txt status, per-page timings
  --force         crawl even when robots.txt disallows the URL (documented override)
  --json          print JSON to stdout (sitemap / llms / doctor / fix)

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
  - audit/page skip robots.txt-disallowed URLs unless --force; a
    T05-robots-disallow report is written instead. schema warns only.
  - fix accepts local .html/.htm files or directories; additive fixes only.
  - Only audit sites you are allowed to crawl; respect robots.txt.
`);
  process.exit(code);
}

/**
 * Fetch + parse + check a single URL into report-ready parts.
 * @param {string} url
 * @param {number} timeoutMs
 * @param {string} [userAgent]
 */
export async function analyzeOne(url, timeoutMs, userAgent) {
  const fetched = await fetchWithRedirects(url, { timeoutMs, ...(userAgent ? { userAgent } : {}) });
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
    };
  }
  const parsed = parseHtml(fetched.html, fetched.finalUrl);
  const siteFiles = await getSiteFiles(fetched.finalUrl, { timeoutMs, ...(userAgent ? { userAgent } : {}) });
  const schemaRaw = extractJsonLd(parsed.jsonLdBlocks);
  const validated = validateSchema(schemaRaw.items);
  const schemaInfo = {
    items: schemaRaw.items,
    types: validated.types,
    issues: validated.issues,
    errors: schemaRaw.errors,
  };
  const findings = runChecks(parsed, siteFiles, fetched, schemaInfo);
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
  return { fetched, parsed, siteFiles, findings, scores, geo, schemaInfo, truncated: fetched.truncated };
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
 */
function writeOutputs(outDir, report, formats, basename = "report") {
  mkdirSync(outDir, { recursive: true });
  const written = [];
  if (formats.includes("json")) {
    const p = join(outDir, `${basename}.json`);
    writeFileSync(p, JSON.stringify(report, null, 2) + "\n");
    written.push(p);
  }
  if (formats.includes("md")) {
    const p = join(outDir, `${basename}.md`);
    writeFileSync(p, renderMarkdown(report));
    written.push(p);
  }
  if (formats.includes("html")) {
    const p = join(outDir, `${basename}.html`);
    writeFileSync(p, renderHtml(report));
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

  const { blocked, robotsText } = await checkRobotsAllowed(url, args);
  if (blocked) {
    console.error(
      `! robots.txt disallows auditing ${url} — crawl skipped (re-run with --force to override).`,
    );
    const report = blockedReport(url);
    const written = writeOutputs(resolve(args.out), report, formats);
    console.log(
      `\nSearch SEO: ${report.scores.search.score}/100 (${report.scores.search.band})  |  AI Visibility: ${report.scores.ai.score}/100 (${report.scores.ai.band})`,
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
      const seeds = await getSitemapUrls(url, { timeoutMs: args.timeout, userAgent: UA });
      dbg(`sitemap seeds: ${seeds.length}`);
      let added = 0;
      for (const seed of seeds) {
        if (added >= Math.max(0, args.pages - 1)) break;
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
    const results = await Promise.allSettled(batch.map((u) => analyzeOne(u, args.timeout, UA)));
    for (let i = 0; i < batch.length; i++) {
      const next = batch[i];
      const settled = results[i];
      if (!next || !settled) continue;
      if (settled.status === "rejected") {
        const reason = settled.reason;
        console.error(`! ${next} -> ${reason instanceof Error ? reason.message : String(reason)}`);
        continue;
      }
      const r = settled.value;
      if (!r.parsed) {
        console.error(`! ${next} -> ${r.fetched.error || r.fetched.status}`);
        continue;
      }
      // Guard against redirect-alias duplicates (http<->https, trailing slash).
      const finalKey = canonicalizeUrl(r.fetched.finalUrl) || r.fetched.finalUrl;
      if (pageReports.some((pr) => (canonicalizeUrl(pr.finalUrl) || pr.finalUrl) === finalKey)) {
        continue;
      }
      const pageReport = toReport(r, next);
      pageReports.push(pageReport);
      dbg(`page ${next} -> search ${pageReport.scores.search.score} ai ${pageReport.scores.ai.score}`);
      if (pageReports.length < args.pages) {
        for (const link of r.parsed.internalLinks.slice(0, 10)) {
          const lk = canonicalizeUrl(link) || link;
          if (!lk || seen.has(lk)) continue;
          if (!args.force && robotsText && isDisallowed(robotsText, UA_TOKEN, pathOf(link))) {
            dbg(`skip robots-disallowed ${link}`);
            seen.add(lk);
            continue;
          }
          if (pageReports.length + queue.length >= args.pages) break;
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

  const outDir = resolve(args.out);
  /** @type {string[]} */
  const written = [];
  pageReports.forEach((report, idx) => {
    const basename = idx === 0 ? "report" : `report-${idx + 1}`;
    written.push(...writeOutputs(outDir, report, formats, basename));
  });
  // Index linking all pages.
  if (pageReports.length > 1) {
    const lines = [`# one-step-seo index`, ``, `Audited ${pageReports.length} pages.`, ``];
    pageReports.forEach((r, idx) => {
      const name = idx === 0 ? "report" : `report-${idx + 1}`;
      lines.push(
        `- Page ${idx + 1}: ${r.finalUrl} — Search ${r.scores.search.score} (${r.scores.search.band}), AI ${r.scores.ai.score} (${r.scores.ai.band}) — [md](./${name}.md) [json](./${name}.json)${formats.includes("html") ? ` [html](./${name}.html)` : ""}`,
      );
    });
    lines.push(``);
    const indexPath = join(outDir, "index.md");
    writeFileSync(indexPath, lines.join("\n") + "\n");
    written.push(indexPath);
  }

  const primary = pageReports[0];
  if (!primary) return;
  const agg = summarizeAggregate(pageReports);
  console.log(
    `\nSearch SEO: ${primary.scores.search.score}/100 (${primary.scores.search.band})  |  AI Visibility: ${primary.scores.ai.score}/100 (${primary.scores.ai.band})`,
  );
  console.log(`Pages audited: ${pageReports.length}`);
  if (pageReports.length > 1) {
    console.log(
      `Aggregate: avg Search ${agg.avgSearch} / AI ${agg.avgAi} · min Search ${agg.minSearch} / AI ${agg.minAi}`,
    );
    console.log(
      `Totals: P0=${agg.totals.P0} P1=${agg.totals.P1} P2=${agg.totals.P2} P3=${agg.totals.P3} pass=${agg.totals.pass}`,
    );
  }
  console.log(
    `Counts: P0=${primary.counts.P0} P1=${primary.counts.P1} P2=${primary.counts.P2} P3=${primary.counts.P3} pass=${primary.counts.pass}`,
  );
  printTopFixes(primary, `one-step-seo audit ${url} --pages ${args.pages}`);
  console.log(`Wrote:\n  ${written.join("\n  ")}`);

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
  const { blocked } = await checkRobotsAllowed(url, args);
  if (blocked) {
    console.error(
      `! robots.txt disallows auditing ${url} — crawl skipped (re-run with --force to override).`,
    );
    const blockedRep = blockedReport(url);
    const writtenBlocked = writeOutputs(resolve(args.out), blockedRep, args.formats);
    console.log(
      `Search SEO: ${blockedRep.scores.search.score}/100 (${blockedRep.scores.search.band})  |  AI Visibility: ${blockedRep.scores.ai.score}/100 (${blockedRep.scores.ai.band})`,
    );
    printTopFixes(blockedRep, `one-step-seo page ${url} --force`);
    console.log(`Wrote:\n  ${writtenBlocked.join("\n  ")}`);
    return;
  }
  const r = await analyzeOne(url, args.timeout, UA);
  if (!r.parsed) {
    console.error(`Fetch failed: ${r.fetched.error || r.fetched.status}`);
    process.exitCode = 2;
    return;
  }
  if (args.debug)
    console.error(`debug: page ${url} fetched in ${r.fetched.ms}ms (${r.fetched.html.length} chars)`);
  const report = toReport(r, url);
  const written = writeOutputs(resolve(args.out), report, args.formats);
  console.log(
    `Search SEO: ${report.scores.search.score}/100 (${report.scores.search.band})  |  AI Visibility: ${report.scores.ai.score}/100 (${report.scores.ai.band})`,
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
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdSchema(url, args) {
  const r = await analyzeOne(url, args.timeout, UA);
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
  const siteFiles = await getSiteFiles(normalized, { timeoutMs: args.timeout, userAgent: UA });
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
  const site = await getSiteFiles(url, { timeoutMs: args.timeout, userAgent: UA });
  let title = "";
  let desc = "";
  try {
    const f = await fetchWithRedirects(url, { timeoutMs: args.timeout, userAgent: UA });
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
    seeds = (await getSitemapUrls(url, { timeoutMs: args.timeout, userAgent: UA })).slice(0, 20);
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
  const info = {
    tool: "one-step-seo",
    version: VERSION,
    node: process.version,
    nodeOk: Number(process.version.slice(1).split(".")[0]) >= 18,
    fetch: typeof fetch === "function",
  };
  if (args.json) console.log(JSON.stringify(info, null, 2));
  else {
    console.log(`one-step-seo v${VERSION}`);
    console.log(`node ${info.node} ${info.nodeOk ? "(ok)" : "(NEEDS >=18)"}`);
    console.log(`fetch: ${info.fetch ? "ok" : "missing"}`);
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
      writeFileSync(file, plan.newHtml);
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
  // `fix` targets local file paths — must route before URL normalization.
  if (cmd === "fix") return cmdFix(rawUrl ?? "", args);
  if (cmd === "quick") {
    const argv = process.argv.slice(2);
    const explicitPages = argv.some((a) => a === "--pages" || a.startsWith("--pages="));
    if (!explicitPages) args.pages = 5;
    const quickUrl = normalizeUrl(rawUrl ?? "");
    if (!quickUrl) {
      console.error("Provide a valid URL, e.g. one-step-seo quick https://example.com");
      process.exit(1);
    }
    console.log(`Quick audit: up to ${args.pages} page(s), all formats, into ${args.out}.`);
    return cmdAudit(quickUrl, args);
  }
  const url = normalizeUrl(rawUrl ?? "");
  if (!url) {
    console.error("Provide a valid URL, e.g. one-step-seo audit https://example.com");
    process.exit(1);
  }
  if (cmd === "audit") return cmdAudit(url, args);
  if (cmd === "page") return cmdPage(url, args);
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
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Runtime error: ${msg}`);
  if (verbose && err instanceof Error && err.stack) console.error(err.stack);
  process.exit(2);
});
