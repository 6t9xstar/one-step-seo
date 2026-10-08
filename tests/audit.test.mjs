import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHtml } from "../lib/html.mjs";
import { runChecks } from "../lib/checks.mjs";
import { extractJsonLd, validateSchema, generateSchema } from "../lib/schema.mjs";
import { geoDetails, computeScores } from "../lib/score.mjs";
import { buildReport, renderMarkdown, renderHtml } from "../lib/report.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const good = readFileSync(join(DIR, "fixtures/good.html"), "utf8");
const bad = readFileSync(join(DIR, "fixtures/bad.html"), "utf8");

function siteFilesMock(over = {}) {
  return {
    origin: "https://example.com",
    robots: { found: true, status: 200, sitemaps: [], disallowCount: 1, aiBlocked: false, textSample: "" },
    sitemap: { found: true, status: 200, urlCount: 10, fromRobots: [] },
    llms: { found: false, status: 404, bytes: 0 },
    ...over,
  };
}
function fetchMock(finalUrl = "https://example.com/good/") {
  return {
    finalUrl,
    status: 200,
    statusChain: [{ url: finalUrl, status: 200 }],
    contentType: "text/html",
    ms: 10,
  };
}

test("good page parses core signals", () => {
  const p = parseHtml(good, "https://example.com/good/");
  assert.ok(p.title.length >= 30);
  assert.equal(p.h1s.length, 1);
  assert.ok(p.headingOrderOk);
  assert.ok(p.imagesWithoutAlt === 0);
  assert.ok(p.internalLinkCount >= 1);
});

test("bad page triggers P0/P1 findings", () => {
  const p = parseHtml(bad, "https://example.com/bad/");
  const schemaInfo = { items: [], types: [], issues: [], errors: [] };
  const findings = runChecks(p, siteFilesMock(), fetchMock("https://example.com/bad/"), schemaInfo);
  const byId = Object.fromEntries(findings.map((f) => [f.id, f]));
  assert.equal(byId["O03-h1-multi"].severity, "P1");
  assert.equal(byId["O01-title-short"].severity, "P1");
  assert.equal(byId["O02-meta-missing"].severity, "P1");
  assert.equal(byId["O08-alt"].severity, "P1");
});

test("schema extract + validate + generate", () => {
  const p = parseHtml(good, "https://example.com/good/");
  const raw = extractJsonLd(p.jsonLdBlocks);
  assert.equal(raw.errors.length, 0);
  assert.ok(raw.items.length >= 1);
  const v = validateSchema(raw.items);
  assert.ok(v.types.includes("Article"));
  const faq = generateSchema("faq", { name: "Demo", url: "https://example.com", description: "d" });
  assert.equal(faq["@type"], "FAQPage");
});

test("scores: good beats bad, bands valid", () => {
  const gp = parseHtml(good, "https://example.com/good/");
  const bp = parseHtml(bad, "https://example.com/bad/");
  const sf = siteFilesMock();
  const gFind = runChecks(gp, sf, fetchMock("https://example.com/good/"), {
    items: [{}],
    types: ["Article"],
    issues: [],
    errors: [],
  });
  const bFind = runChecks(bp, sf, fetchMock("https://example.com/bad/"), {
    items: [],
    types: [],
    issues: [],
    errors: [],
  });
  const gs = computeScores(gFind, geoDetails(gp, sf));
  const bs = computeScores(bFind, geoDetails(bp, sf));
  assert.ok(gs.search.score > bs.search.score);
  assert.ok(["A", "B", "C", "D", "F"].includes(gs.search.band));
});

test("report builders produce json/md/html", () => {
  const p = parseHtml(good, "https://example.com/good/");
  const sf = siteFilesMock();
  const findings = runChecks(p, sf, fetchMock(), { items: [], types: [], issues: [], errors: [] });
  const scores = computeScores(findings, geoDetails(p, sf));
  const report = buildReport({
    url: "https://example.com/good/",
    finalUrl: "https://example.com/good/",
    scores,
    findings,
    parsed: p,
    siteFiles: sf,
    meta: { version: "0.0.0-test" },
  });
  assert.ok(report.findings.length > 10);
  assert.match(renderMarkdown(report), /Search SEO/);
  assert.match(renderHtml(report), /one-step-seo report/);
});

test("finding ids match schema pattern", async () => {
  const schema = JSON.parse(readFileSync(join(DIR, "../lib/schema-finding.json"), "utf8"));
  assert.ok(schema.properties.id.pattern);
  const p = parseHtml(good, "https://example.com/good/");
  const findings = runChecks(p, siteFilesMock(), fetchMock(), {
    items: [],
    types: [],
    issues: [],
    errors: [],
  });
  const re = new RegExp(schema.properties.id.pattern);
  for (const f of findings) assert.match(f.id, re, `bad id ${f.id}`);
});
