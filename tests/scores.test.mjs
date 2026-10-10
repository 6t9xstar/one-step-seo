/**
 * Score benchmark corpus: frozen fixtures with PINNED exact scores.
 * If any check, threshold, or weight changes, these fail loudly on purpose —
 * update the pins deliberately (plus docs + examples + CHANGELOG), never to
 * make red green. Mirrors scripts/generate-examples.mjs buildFor() inputs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHtml } from "../lib/html.mjs";
import { runChecks } from "../lib/checks.mjs";
import { extractJsonLd, validateSchema } from "../lib/schema.mjs";
import { geoDetails, computeScores, RULES_VERSION } from "../lib/score.mjs";
import { buildReport } from "../lib/report.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));

function siteFilesMock() {
  return {
    origin: "https://example.com",
    robots: {
      found: true,
      status: 200,
      sitemaps: [],
      disallowCount: 1,
      aiBlocked: false,
      textSample: "",
      text: "",
    },
    sitemap: {
      found: true,
      status: 200,
      url: "https://example.com/sitemap.xml",
      urlCount: 10,
      fromRobots: [],
      truncated: false,
      text: "",
    },
    llms: { found: false, status: 404, bytes: 0, text: "" },
  };
}

/**
 * @param {string} fixture
 * @param {string} url
 */
function auditFixture(fixture, url) {
  const html = readFileSync(join(DIR, "fixtures", fixture), "utf8");
  const parsed = parseHtml(html, url);
  const raw = extractJsonLd(parsed.jsonLdBlocks);
  const validated = validateSchema(raw.items);
  const findings = runChecks(
    parsed,
    siteFilesMock(),
    { finalUrl: url, status: 200, statusChain: [{ url, status: 200 }], contentType: "text/html", ms: 12 },
    { items: raw.items, types: validated.types, issues: validated.issues, errors: raw.errors },
  );
  const scores = computeScores(findings, geoDetails(parsed, siteFilesMock()));
  return buildReport({
    url,
    finalUrl: url,
    scores,
    findings,
    parsed,
    siteFiles: siteFilesMock(),
    meta: { version: "0.0.0-test" },
    checkedAt: "2026-10-08T00:00:00.000Z",
  });
}

test("benchmark: rules version is stamped on every report", () => {
  assert.match(RULES_VERSION, /^\d{4}\.\d{2}$/);
  const r = auditFixture("good.html", "https://example.com/good/");
  assert.equal(r.rulesVersion, RULES_VERSION);
});

test("benchmark: good page scores are pinned", () => {
  const r = auditFixture("good.html", "https://example.com/good/");
  assert.deepEqual(r.scores.search, { score: 86, band: "B" });
  assert.deepEqual(r.scores.ai, { score: 80, band: "B" });
  assert.deepEqual(r.counts, { P0: 0, P1: 1, P2: 2, P3: 3, pass: 39 });
});

test("benchmark: bad page scores are pinned", () => {
  const r = auditFixture("bad.html", "https://example.com/bad/");
  assert.deepEqual(r.scores.search, { score: 0, band: "F" });
  assert.deepEqual(r.scores.ai, { score: 5, band: "F" });
  assert.deepEqual(r.counts, { P0: 0, P1: 9, P2: 11, P3: 2, pass: 18 });
});

test("benchmark: product page scores are pinned", () => {
  const r = auditFixture("product.html", "https://example.com/shop/trailhead-40l/");
  assert.deepEqual(r.scores.search, { score: 99, band: "A" });
  assert.deepEqual(r.scores.ai, { score: 80, band: "B" });
  assert.deepEqual(r.counts, { P0: 0, P1: 0, P2: 1, P3: 3, pass: 41 });
});

test("benchmark: pricing page scores are pinned", () => {
  const r = auditFixture("pricing.html", "https://example.com/pricing/");
  assert.deepEqual(r.scores.search, { score: 95, band: "A" });
  assert.deepEqual(r.scores.ai, { score: 80, band: "B" });
  assert.deepEqual(r.counts, { P0: 0, P1: 0, P2: 2, P3: 3, pass: 39 });
});
