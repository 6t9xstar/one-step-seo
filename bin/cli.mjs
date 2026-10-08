#!/usr/bin/env node
/**
 * one-step-seo CLI — zero dependencies, Node 18+.
 * Usage:
 *   one-step-seo audit <url> [--pages N] [--out DIR] [--format html,md,json] [--fail-on P0] [--crawl links|sitemap]
 *   one-step-seo page <url> [--out DIR] [--format html,md,json]
 *   one-step-seo schema <url> [--generate organization|website|article|faq|breadcrumb|product|event|localbusiness|howto]
 *   one-step-seo sitemap <url> [--json]
 *   one-step-seo doctor [--json]
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRedirects } from "../lib/fetch.mjs";
import { parseHtml } from "../lib/html.mjs";
import { getSiteFiles, getSitemapUrls } from "../lib/robots.mjs";
import { runChecks } from "../lib/checks.mjs";
import { extractJsonLd, validateSchema, schemaSnippet } from "../lib/schema.mjs";
import { geoDetails, computeScores } from "../lib/score.mjs";
import { buildReport, renderMarkdown, renderHtml } from "../lib/report.mjs";
import { parseArgs, normalizeUrl, canonicalizeUrl, CliError } from "../lib/args.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let VERSION = "0.0.0";
try {
  VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version ?? VERSION;
} catch {
  // Package layout without package.json (bundled) — keep fallback version.
}

function usage(code = 0) {
  console.log(`one-step-seo v${VERSION} — one command SEO + AI-visibility audit
Usage:
  one-step-seo audit <url> [--pages N] [--out DIR] [--format html,md,json] [--fail-on P0|P1|P2] [--crawl links|sitemap]
  one-step-seo page <url> [--out DIR] [--format html,md,json]
  one-step-seo schema <url> [--generate organization|website|article|faq|breadcrumb|product|event|localbusiness|howto]
  one-step-seo sitemap <url> [--json]
  one-step-seo doctor [--json]

Options:
  --pages N       pages to crawl for 'audit' (default 1, max 20)
  --out DIR       output directory (default ./seo-report)
  --format        comma list among html,md,json (default html,md,json)
  --timeout MS    per-request timeout in ms (default 15000, 1000-120000)
  --fail-on SEV   exit 2 when any page has P0 (or P1/P2) findings — for CI gating
  --crawl MODE    audit discovery: links (BFS over internal links) or sitemap (default links)
  --concurrency N parallel page fetches 1-8 (default 4)
  --json          print JSON to stdout (doctor / sitemap)

Notes:
  - Multi-page audits write report.json/md/html for page 1 plus
    report-N.json/md/html for pages 2+ and an index.md linking all pages.
  - Only audit sites you are allowed to crawl; respect robots.txt.
`);
  process.exit(code);
}

/**
 * Fetch + parse + check a single URL into report-ready parts.
 * @param {string} url
 * @param {number} timeoutMs
 */
export async function analyzeOne(url, timeoutMs) {
  const fetched = await fetchWithRedirects(url, { timeoutMs });
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
  const siteFiles = await getSiteFiles(fetched.finalUrl, { timeoutMs });
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
  const seen = new Set([canonicalizeUrl(url) || url]);
  const queue = [url];
  /** @type {import("../lib/report.mjs").Report[]} */
  const pageReports = [];

  // Seed sitemap-mode queue from the sitemap discovery. The root URL is
  // already in `queue`, so the cap must count only *extra* seeds — comparing
  // `queue.length >= args.pages` would break immediately at the default
  // --pages 1 and add nothing.
  if (args.crawl === "sitemap") {
    try {
      const seeds = await getSitemapUrls(url, { timeoutMs: args.timeout });
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

  while (queue.length > 0 && pageReports.length < args.pages) {
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
    const results = await Promise.allSettled(batch.map((u) => analyzeOne(u, args.timeout)));
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
      pageReports.push(toReport(r, next));
      if (pageReports.length < args.pages) {
        for (const link of r.parsed.internalLinks.slice(0, 10)) {
          const lk = canonicalizeUrl(link) || link;
          if (!lk || seen.has(lk)) continue;
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
  const r = await analyzeOne(url, args.timeout);
  if (!r.parsed) {
    console.error(`Fetch failed: ${r.fetched.error || r.fetched.status}`);
    process.exitCode = 2;
    return;
  }
  const report = toReport(r, url);
  const written = writeOutputs(resolve(args.out), report, args.formats);
  console.log(
    `Search SEO: ${report.scores.search.score}/100 (${report.scores.search.band})  |  AI Visibility: ${report.scores.ai.score}/100 (${report.scores.ai.band})`,
  );
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
  const r = await analyzeOne(url, args.timeout);
  if (!r.parsed) {
    console.error(`Fetch failed: ${r.fetched.error || r.fetched.status}`);
    process.exitCode = 2;
    return;
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
  const siteFiles = await getSiteFiles(normalized, { timeoutMs: args.timeout });
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
  verbose = verbose || args.verbose;
  if (args.action === "help") usage(0);
  if (args.action === "version") {
    console.log(VERSION);
    return;
  }
  const [cmd, rawUrl] = args._;
  if (!cmd) usage(1);
  if (cmd === "doctor") return cmdDoctor(args);
  const url = normalizeUrl(rawUrl ?? "");
  if (!url) {
    console.error("Provide a valid URL, e.g. one-step-seo audit https://example.com");
    process.exit(1);
  }
  if (cmd === "audit") return cmdAudit(url, args);
  if (cmd === "page") return cmdPage(url, args);
  if (cmd === "schema") return cmdSchema(url, args);
  if (cmd === "sitemap") return cmdSitemap(url, args);
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
