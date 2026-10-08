#!/usr/bin/env node
/**
 * one-step-seo CLI — zero dependencies, Node 18+.
 * Usage:
 *   one-step-seo audit <url> [--pages 1] [--out ./seo-report] [--format html,md,json]
 *   one-step-seo page <url> [--out ./seo-report]
 *   one-step-seo schema <url> [--generate organization|website|article|faq|breadcrumb]
 *   one-step-seo sitemap <url>
 *   one-step-seo doctor
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRedirects } from "../lib/fetch.mjs";
import { parseHtml } from "../lib/html.mjs";
import { getSiteFiles } from "../lib/robots.mjs";
import { runChecks } from "../lib/checks.mjs";
import { extractJsonLd, validateSchema, schemaSnippet } from "../lib/schema.mjs";
import { geoDetails, computeScores } from "../lib/score.mjs";
import { buildReport, renderMarkdown, renderHtml } from "../lib/report.mjs";
import { parseArgs, normalizeUrl, CliError } from "../lib/args.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

function usage(code = 0) {
  console.log(`one-step-seo v${VERSION} — one command SEO + AI-visibility audit
Usage:
  one-step-seo audit <url> [--pages N] [--out DIR] [--format html,md,json]
  one-step-seo page <url> [--out DIR] [--format html,md,json]
  one-step-seo schema <url> [--generate organization|website|article|faq|breadcrumb]
  one-step-seo sitemap <url>
  one-step-seo doctor [--json]

Options:
  --pages N     pages to crawl for 'audit' (default 1, max 20)
  --out DIR     output directory (default ./seo-report)
  --format      comma list among html,md,json (default html,md,json)
  --timeout MS  per-request timeout in ms (default 15000, 1000-120000)
  --json        print JSON to stdout (doctor / sitemap)

Notes:
  - Multi-page audits write report.json/md/html for page 1 and
    report-N.json/md for pages 2+ (HTML is only rendered for page 1).
  - Only audit sites you are allowed to crawl; respect robots.txt.
`);
  process.exit(code);
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 */
async function analyzeOne(url, timeoutMs) {
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
    };
  }
  const parsed = parseHtml(fetched.html, fetched.finalUrl);
  const siteFiles = await getSiteFiles(fetched.finalUrl);
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
 * @param {string} outDir
 * @param {import("../lib/report.mjs").Report} report
 * @param {string[]} formats
 */
function writeOutputs(outDir, report, formats) {
  mkdirSync(outDir, { recursive: true });
  const written = [];
  if (formats.includes("json")) {
    const p = join(outDir, "report.json");
    writeFileSync(p, JSON.stringify(report, null, 2) + "\n");
    written.push(p);
  }
  if (formats.includes("md")) {
    const p = join(outDir, "report.md");
    writeFileSync(p, renderMarkdown(report));
    written.push(p);
  }
  if (formats.includes("html")) {
    const p = join(outDir, "report.html");
    writeFileSync(p, renderHtml(report));
    written.push(p);
  }
  return written;
}

/**
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdAudit(url, args) {
  const formats = args.formats;
  // Crawl BFS over internal links when --pages > 1
  const seen = new Set();
  const queue = [url];
  const pageReports = [];

  while (queue.length > 0 && pageReports.length < args.pages) {
    const next = queue.shift();
    if (next === undefined || seen.has(next)) continue;
    seen.add(next);
    const r = await analyzeOne(next, args.timeout);
    if (!r.parsed) {
      console.error(`! ${next} -> ${r.fetched.error || r.fetched.status}`);
      continue;
    }
    const report = buildReport({
      url: next,
      finalUrl: r.fetched.finalUrl,
      scores: r.scores,
      findings: r.findings,
      parsed: r.parsed,
      siteFiles: r.siteFiles,
      meta: { version: VERSION },
      truncated: r.truncated,
    });
    pageReports.push(report);
    if (pageReports.length < args.pages) {
      for (const link of r.parsed.internalLinks.slice(0, 10)) {
        if (!seen.has(link) && pageReports.length + queue.length < args.pages) queue.push(link);
      }
    }
  }

  if (pageReports.length === 0) {
    console.error("Audit failed: no pages could be fetched.");
    process.exit(2);
  }

  const outDir = resolve(args.out);
  const primary = pageReports[0];
  // For multi-page runs, store per-page + index from primary.
  const written = writeOutputs(outDir, primary, formats);
  for (let i = 1; i < pageReports.length; i++) {
    const slug = `report-${i + 1}`;
    if (formats.includes("json"))
      writeFileSync(join(outDir, `${slug}.json`), JSON.stringify(pageReports[i], null, 2) + "\n");
    if (formats.includes("md")) writeFileSync(join(outDir, `${slug}.md`), renderMarkdown(pageReports[i]));
  }

  console.log(
    `\nSearch SEO: ${primary.scores.search.score}/100 (${primary.scores.search.band})  |  AI Visibility: ${primary.scores.ai.score}/100 (${primary.scores.ai.band})`
  );
  console.log(`Pages audited: ${pageReports.length}`);
  console.log(
    `Counts: P0=${primary.counts.P0} P1=${primary.counts.P1} P2=${primary.counts.P2} P3=${primary.counts.P3} pass=${primary.counts.pass}`
  );
  console.log(`Wrote:\n  ${written.join("\n  ")}`);
}

/**
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdPage(url, args) {
  const r = await analyzeOne(url, args.timeout);
  if (!r.parsed) {
    console.error(`Fetch failed: ${r.fetched.error || r.fetched.status}`);
    process.exit(2);
  }
  const report = buildReport({
    url,
    finalUrl: r.fetched.finalUrl,
    scores: r.scores,
    findings: r.findings,
    parsed: r.parsed,
    siteFiles: r.siteFiles,
    meta: { version: VERSION },
    truncated: r.truncated,
  });
  const written = writeOutputs(resolve(args.out), report, args.formats);
  console.log(
    `Search SEO: ${report.scores.search.score}/100 (${report.scores.search.band})  |  AI Visibility: ${report.scores.ai.score}/100 (${report.scores.ai.band})`
  );
  console.log(`Wrote:\n  ${written.join("\n  ")}`);
}

/**
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdSchema(url, args) {
  const r = await analyzeOne(url, args.timeout);
  if (!r.parsed) {
    console.error(`Fetch failed: ${r.fetched.error || r.fetched.status}`);
    process.exit(2);
  }
  console.log(
    `Found ${r.schemaInfo.items.length} JSON-LD node(s): ${r.schemaInfo.types.join(", ") || "(none)"}`
  );
  for (const e of r.schemaInfo.errors) console.log(`  ERROR: ${e}`);
  for (const i of r.schemaInfo.issues) console.log(`  ISSUE [${i.type}]: ${i.issue}`);
  if (args.generate) {
    console.log(`\n--- snippet (${args.generate}) ---`);
    console.log(
      schemaSnippet(args.generate, {
        name: r.parsed.title || "Example",
        url: r.fetched.finalUrl,
        description: r.parsed.metaDescription,
      })
    );
  }
}

/**
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdSitemap(url, args) {
  const siteFiles = await getSiteFiles(new URL(url).toString());
  const out = {
    origin: siteFiles.origin,
    robotsFound: siteFiles.robots.found,
    robotsSitemaps: siteFiles.robots.sitemaps,
    sitemapFound: siteFiles.sitemap.found,
    sitemapUrl: siteFiles.sitemap.url,
    sitemapUrls: siteFiles.sitemap.urlCount,
    llmsFound: siteFiles.llms.found,
  };
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`Origin: ${out.origin}`);
    console.log(`robots.txt: ${out.robotsFound ? "found" : "MISSING"}`);
    console.log(
      `sitemap.xml: ${out.sitemapFound ? `found at ${out.sitemapUrl} (~${out.sitemapUrls} URLs)` : "MISSING"}`
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

main().catch((err) => {
  console.error(`Runtime error: ${err?.message ?? err}`);
  process.exit(2);
});
