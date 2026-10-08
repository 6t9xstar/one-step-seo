#!/usr/bin/env node
/**
 * Regenerate examples/report-sample.{md,html} from tests/fixtures/good.html
 * so the committed examples can never drift from the generator.
 * Run: npm run examples
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHtml } from "../lib/html.mjs";
import { runChecks } from "../lib/checks.mjs";
import { extractJsonLd, validateSchema } from "../lib/schema.mjs";
import { geoDetails, computeScores } from "../lib/score.mjs";
import { buildReport, renderMarkdown, renderHtml } from "../lib/report.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

const html = readFileSync(join(ROOT, "tests/fixtures/good.html"), "utf8");
const url = "https://example.com/good/";
const parsed = parseHtml(html, url);
const siteFiles = {
  origin: "https://example.com",
  robots: { found: true, status: 200, sitemaps: [], disallowCount: 1, aiBlocked: false, textSample: "" },
  sitemap: { found: true, status: 200, url: "https://example.com/sitemap.xml", urlCount: 10, fromRobots: [] },
  llms: { found: false, status: 404, bytes: 0 },
};
const raw = extractJsonLd(parsed.jsonLdBlocks);
const validated = validateSchema(raw.items);
const findings = runChecks(
  parsed,
  siteFiles,
  { finalUrl: url, status: 200, statusChain: [{ url, status: 200 }], contentType: "text/html", ms: 12 },
  { items: raw.items, types: validated.types, issues: validated.issues, errors: raw.errors }
);
const scores = computeScores(findings, geoDetails(parsed, siteFiles));
const report = buildReport({
  url,
  finalUrl: url,
  scores,
  findings,
  parsed,
  siteFiles,
  meta: { version: VERSION },
});

writeFileSync(join(ROOT, "examples/report-sample.md"), renderMarkdown(report));
writeFileSync(join(ROOT, "examples/report-sample.html"), renderHtml(report));
console.log(
  `examples regenerated: search ${scores.search.score}/${scores.search.band}, ai ${scores.ai.score}/${scores.ai.band}`
);
