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
  --timeout MS  per-request timeout (default 15000)
  --json        print JSON to stdout (doctor / sitemap)
`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { _: [], pages: 1, out: "./seo-report", format: "html,md,json", timeout: 15000, generate: "", json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pages") args.pages = Math.max(1, Math.min(20, Number(argv[++i]) || 1));
    else if (a === "--out") args.out = argv[++i] ?? args.out;
    else if (a === "--format") args.format = argv[++i] ?? args.format;
    else if (a === "--timeout") args.timeout = Number(argv[++i]) || 15000;
    else if (a === "--generate") args.generate = argv[++i] ?? "";
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") usage(0);
    else if (a === "--version" || a === "-v") {
      console.log(VERSION);
      process.exit(0);
    } else if (a.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      usage(1);
    } else args._.push(a);
  }
  return args;
}

function normalizeUrl(input) {
  if (!input) return "";
  const hasProto = /^https?:\/\//i.test(input);
  try {
    return new URL(hasProto ? input : `https://${input}`).toString();
  } catch {
    return "";
  }
}

async function analyzeOne(url, timeoutMs) {
  const fetched = await fetchWithRedirects(url, { timeoutMs });
  if (!fetched.ok || !fetched.html) {
    return { fetched, parsed: null, siteFiles: null, findings: [], scores: null, geo: null, schemaInfo: null };
  }
  const parsed = parseHtml(fetched.html, fetched.finalUrl);
  const siteFiles = await getSiteFiles(fetched.finalUrl);
  const schemaRaw = extractJsonLd(parsed.jsonLdBlocks);
  const validated = validateSchema(schemaRaw.items);
  const schemaInfo = { items: schemaRaw.items, types: validated.types, issues: validated.issues, errors: schemaRaw.errors };
  const findings = runChecks(parsed, siteFiles, fetched, schemaInfo);
  const geo = geoDetails(parsed, siteFiles);
  const scores = computeScores(findings, geo);
  return { fetched, parsed, siteFiles, findings, scores, geo, schemaInfo };
}

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

async function cmdAudit(url, args) {
  const formats = args.format.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  // Crawl BFS over internal links when --pages > 1
  const seen = new Set();
  const queue = [url];
  const pageReports = [];

  while (queue.length > 0 && pageReports.length < args.pages) {
    const next = queue.shift();
    if (seen.has(next)) continue;
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
    if (formats.includes("json")) writeFileSync(join(outDir, `${slug}.json`), JSON.stringify(pageReports[i], null, 2) + "\n");
    if (formats.includes("md")) writeFileSync(join(outDir, `${slug}.md`), renderMarkdown(pageReports[i]));
  }

  console.log(`\nSearch SEO: ${primary.scores.search.score}/100 (${primary.scores.search.band})  |  AI Visibility: ${primary.scores.ai.score}/100 (${primary.scores.ai.band})`);
  console.log(`Pages audited: ${pageReports.length}`);
  console.log(`Counts: P0=${primary.counts.P0} P1=${primary.counts.P1} P2=${primary.counts.P2} P3=${primary.counts.P3} pass=${primary.counts.pass}`);
  console.log(`Wrote:\n  ${written.join("\n  ")}`);
}

async function cmdPage(url, args) {
  const formats = args.format.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const r = await analyzeOne(url, args.timeout);
  if (!r.parsed) {
    console.error(`Fetch failed: ${r.fetched.error || r.fetched.status}`);
    process.exit(2);
  }
  const report = buildReport({
    url, finalUrl: r.fetched.finalUrl, scores: r.scores, findings: r.findings,
    parsed: r.parsed, siteFiles: r.siteFiles, meta: { version: VERSION },
  });
  const written = writeOutputs(resolve(args.out), report, formats);
  console.log(`Search SEO: ${report.scores.search.score}/100 (${report.scores.search.band})  |  AI Visibility: ${report.scores.ai.score}/100 (${report.scores.ai.band})`);
  console.log(`Wrote:\n  ${written.join("\n  ")}`);
}

async function cmdSchema(url, args) {
  const r = await analyzeOne(url, args.timeout);
  if (!r.parsed) {
    console.error(`Fetch failed: ${r.fetched.error || r.fetched.status}`);
    process.exit(2);
  }
  console.log(`Found ${r.schemaInfo.items.length} JSON-LD node(s): ${(r.schemaInfo.types.join(", ") || "(none)")}`);
  for (const e of r.schemaInfo.errors) console.log(`  ERROR: ${e}`);
  for (const i of r.schemaInfo.issues) console.log(`  ISSUE [${i.type}]: ${i.issue}`);
  if (args.generate) {
    console.log(`\n--- snippet (${args.generate}) ---`);
    console.log(schemaSnippet(args.generate, { name: r.parsed.title || "Example", url: r.fetched.finalUrl, description: r.parsed.metaDescription }));
  }
}

async function cmdSitemap(url, args) {
  const siteFiles = await getSiteFiles(new URL(url).toString());
  const out = {
    origin: siteFiles.origin,
    robotsFound: siteFiles.robots.found,
    robotsSitemaps: siteFiles.robots.sitemaps,
    sitemapFound: siteFiles.sitemap.found,
    sitemapUrls: siteFiles.sitemap.urlCount,
    llmsFound: siteFiles.llms.found,
  };
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`Origin: ${out.origin}`);
    console.log(`robots.txt: ${out.robotsFound ? "found" : "MISSING"}`);
    console.log(`sitemap.xml: ${out.sitemapFound ? `found (~${out.sitemapUrls} URLs)` : "MISSING"}`);
    console.log(`llms.txt: ${out.llmsFound ? "found" : "missing (optional)"}`);
  }
}

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
  const args = parseArgs(process.argv.slice(2));
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
