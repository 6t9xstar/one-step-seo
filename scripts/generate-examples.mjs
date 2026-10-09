#!/usr/bin/env node
/**
 * Regenerate examples/report-sample.{md,html,json} from tests/fixtures/good.html
 * (and report-bad-sample.* from bad.html), plus examples/page-types.md from
 * the realistic page-type fixtures — so committed examples never drift.
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
import { buildReport, renderMarkdown, renderHtml, renderSiteIndex } from "../lib/report.mjs";

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

// A three-page synthetic site for the multi-page dashboard example.
const siteReports = [
  buildFor("tests/fixtures/good.html", "https://example.com/good/"),
  buildFor("tests/fixtures/product.html", "https://example.com/shop/trailhead-40l/"),
  buildFor("tests/fixtures/bad.html", "https://example.com/bad/"),
];

/** Realistic page types, each rendered from its own fixture. @type {{ file: string, url: string, label: string, input: string }[]} */
const pageTypes = [
  {
    file: "tests/fixtures/wordpress-like.html",
    url: "https://example.com/brew-guides/pour-over/",
    label: "WordPress-style blog post",
    input: "Single post URL from a WordPress-style site (wp-content assets, @graph schema, comments).",
  },
  {
    file: "tests/fixtures/nextjs-like.html",
    url: "https://example.com/app/",
    label: "Next.js-style app page",
    input: "App-router-style page (__NEXT_DATA__ payload, /_next/ assets, client bundle).",
  },
  {
    file: "tests/fixtures/product.html",
    url: "https://example.com/shop/trailhead-40l/",
    label: "E-commerce product page",
    input: "Product detail page with offers, spec table, pros/cons, and FAQ.",
  },
  {
    file: "tests/fixtures/blog.html",
    url: "https://example.com/blog/slow-mornings/",
    label: "Editorial blog post",
    input: "Long-form essay with table of contents, comparison table, and FAQ.",
  },
  {
    file: "tests/fixtures/pricing.html",
    url: "https://example.com/pricing/",
    label: "SaaS pricing page",
    input: "Pricing tiers table with trial terms and plan-change answers.",
  },
];

/**
 * Compact per-type summary: input, scores, top findings with fixes.
 * @returns {string}
 */
function renderPageTypes() {
  const L = [];
  L.push(`# one-step-seo example page types`);
  L.push(``);
  L.push(
    `Five realistic page types audited with the same mocks as the report samples (robots.txt + sitemap found, llms.txt missing). Scores and findings below are the tool's real output.`,
  );
  for (const t of pageTypes) {
    const report = buildFor(t.file, t.url);
    L.push(``);
    L.push(`## ${t.label}`);
    L.push(``);
    L.push(`- Input: ${t.input}`);
    L.push(`- URL: ${t.url}`);
    L.push(
      `- Search SEO: **${report.scores.search.score}/100 (${report.scores.search.band})** · AI Visibility: **${report.scores.ai.score}/100 (${report.scores.ai.band})**`,
    );
    L.push(
      `- Counts: P0=${report.counts.P0} P1=${report.counts.P1} P2=${report.counts.P2} P3=${report.counts.P3} pass=${report.counts.pass}`,
    );
    const actionable = report.findings.filter((f) => f.severity !== "pass").slice(0, 4);
    if (actionable.length === 0) {
      L.push(`- Recommended fixes: none — clean.`);
    } else {
      L.push(`- Recommended fixes:`);
      for (const f of actionable) L.push(`  - [${f.severity}] ${f.title} (${f.id}): ${f.fix}`);
    }
  }
  L.push(``);
  L.push(`---`);
  L.push(`Generated by one-step-seo v${VERSION}. Two scores, never blended.`);
  return L.join("\n") + "\n";
}

/** @type {[string, string][]} */
const outputs = [
  ["examples/report-sample.md", renderMarkdown(good)],
  ["examples/report-sample.html", renderHtml(good)],
  ["examples/report-sample.json", JSON.stringify(good, null, 2) + "\n"],
  ["examples/report-bad-sample.md", renderMarkdown(bad)],
  ["examples/report-bad-sample.html", renderHtml(bad)],
  ["examples/report-bad-sample.json", JSON.stringify(bad, null, 2) + "\n"],
  ["examples/site-index.html", renderSiteIndex(siteReports)],
  ["examples/page-types.md", renderPageTypes()],
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
