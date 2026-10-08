#!/usr/bin/env node
/**
 * Regenerate examples/report-sample.{md,html,json} from tests/fixtures/good.html
 * (and report-bad-sample.* from bad.html) so committed examples never drift.
 * Run: npm run examples
 * Check without writing: npm run examples:check (uses --check, deterministic timestamp)
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
const CHECK = process.argv.includes("--check");
// Fixed timestamp keeps `git diff --exit-code -- examples/` stable in CI.
// Override with SOURCE_DATE_EPOCH=... for releases.
const FIXED_AT = "2026-10-08T00:00:00.000Z";

/**
 * @param {string} fixture
 * @param {string} url
 */
function buildFor(fixture, url) {
  const html = readFileSync(join(ROOT, fixture), "utf8");
  const parsed = parseHtml(html, url);
  const siteFiles = {
    origin: "https://example.com",
    robots: { found: true, status: 200, sitemaps: [], disallowCount: 1, aiBlocked: false, textSample: "" },
    sitemap: {
      found: true,
      status: 200,
      url: "https://example.com/sitemap.xml",
      urlCount: 10,
      fromRobots: [],
      truncated: false,
    },
    llms: { found: false, status: 404, bytes: 0 },
  };
  const raw = extractJsonLd(parsed.jsonLdBlocks);
  const validated = validateSchema(raw.items);
  const findings = runChecks(
    parsed,
    siteFiles,
    { finalUrl: url, status: 200, statusChain: [{ url, status: 200 }], contentType: "text/html", ms: 12 },
    { items: raw.items, types: validated.types, issues: validated.issues, errors: raw.errors },
  );
  const scores = computeScores(findings, geoDetails(parsed, siteFiles));
  return buildReport({
    url,
    finalUrl: url,
    scores,
    findings,
    parsed,
    siteFiles,
    meta: { version: VERSION },
    checkedAt: FIXED_AT,
  });
}

const good = buildFor("tests/fixtures/good.html", "https://example.com/good/");
const bad = buildFor("tests/fixtures/bad.html", "https://example.com/bad/");

/** @type {[string, string][]} */
const outputs = [
  ["examples/report-sample.md", renderMarkdown(good)],
  ["examples/report-sample.html", renderHtml(good)],
  ["examples/report-sample.json", JSON.stringify(good, null, 2) + "\n"],
  ["examples/report-bad-sample.md", renderMarkdown(bad)],
  ["examples/report-bad-sample.html", renderHtml(bad)],
  ["examples/report-bad-sample.json", JSON.stringify(bad, null, 2) + "\n"],
];

if (CHECK) {
  let dirty = false;
  for (const [rel, content] of outputs) {
    let current = "";
    try {
      current = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      console.error(`missing: ${rel}`);
      dirty = true;
      continue;
    }
    if (current !== content) {
      console.error(`drift: ${rel} — run npm run examples`);
      dirty = true;
    }
  }
  if (dirty) process.exit(1);
  console.log("examples: no drift");
} else {
  for (const [rel, content] of outputs) writeFileSync(join(ROOT, rel), content);
  console.log(
    `examples regenerated: good search ${good.scores.search.score}/${good.scores.search.band}, ai ${good.scores.ai.score}/${good.scores.ai.band}; bad search ${bad.scores.search.score}/${bad.scores.search.band}, ai ${bad.scores.ai.score}/${bad.scores.ai.band}`,
  );
}
