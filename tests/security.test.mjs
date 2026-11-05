import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtml } from "../lib/html.mjs";
import { runChecks } from "../lib/checks.mjs";
import { extractJsonLd } from "../lib/schema.mjs";
import { geoDetails, computeScores } from "../lib/score.mjs";
import { buildReport, renderHtml, renderMarkdown, renderCsv, esc } from "../lib/report.mjs";
import { fetchWithRedirects, fetchText, isBlockedMetadataEndpoint } from "../lib/fetch.mjs";

function siteFilesMock() {
  return {
    origin: "https://example.com",
    robots: { found: true, status: 200, sitemaps: [], disallowCount: 1, aiBlocked: false, textSample: "" },
    sitemap: {
      found: true,
      status: 200,
      url: "https://example.com/sitemap.xml",
      urlCount: 1,
      fromRobots: [],
    },
    llms: { found: false, status: 404, bytes: 0 },
  };
}

function fetchMock() {
  return {
    finalUrl: "https://example.com/",
    status: 200,
    statusChain: [{ url: "https://example.com/", status: 200 }],
    contentType: "text/html",
    ms: 5,
  };
}

const EVIL_INNER = `A reasonably long title <script>alert("xss")</script> padded to exceed sixty characters total`;
const EVIL_BODY = `<h1>Heading</h1><p><img src=x onerror=alert(1)>Hello &copy; 2026 &#x41;BC</p><script>alert("body")</script>`;

test("hostile page content is escaped in HTML reports", () => {
  const parsed = parseHtml(
    `<html><head><title>${EVIL_INNER}</title><meta name="description" content="Plain description here."></head><body>${EVIL_BODY}</body></html>`,
    "https://example.com/",
  );
  const findings = runChecks(parsed, siteFilesMock(), fetchMock(), {
    items: [],
    types: [],
    issues: [],
    errors: [],
  });
  const scores = computeScores(findings, geoDetails(parsed, siteFilesMock()));
  const report = buildReport({
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    scores,
    findings,
    parsed,
    siteFiles: siteFilesMock(),
    meta: { version: "0.0.0-test" },
  });
  const html = renderHtml(report);
  const md = renderMarkdown(report);
  assert.ok(!html.includes("<script>alert"), "raw script must not appear in HTML report");
  assert.ok(!html.includes("<svg onload"), "raw event handler must not appear");
  assert.ok(html.includes("&lt;script&gt;"), "escaped script must appear");
  assert.ok(md.includes("one-step-seo report"));
});

test("esc handles all dangerous characters", () => {
  assert.equal(esc(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;'");
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
});

test("entities decode for word counting", () => {
  const p = parseHtml(
    "<html><body><p>Hello &copy; 2026 &#x41;BC &unknown;</p></body></html>",
    "https://example.com/",
  );
  assert.ok(p.visibleText.includes("(c)"));
  assert.ok(p.visibleText.includes("ABC"));
});

test("invalid JSON-LD is reported, not thrown", () => {
  const { items, errors } = extractJsonLd(["{not json", "", '{"@type":"Article"}']);
  assert.equal(items.length, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /invalid JSON-LD/);
});

test("score bands hit every grade boundary", () => {
  /** @param {number[]} deductions @returns {number} */
  const scoreFor = (deductions) => {
    /** @type {Record<number, string>} */
    const sev = { 25: "P0", 10: "P1", 3: "P2", 1: "P3" };
    const findings = deductions.map((d, i) => ({
      id: `T${i}-x`,
      category: "technical",
      severity: sev[d] ?? "P2",
    }));
    return computeScores(findings, { score: 100 }).search.score;
  };
  assert.equal(computeScores([], { score: 100 }).search.band, "A");
  assert.equal(scoreFor([10]), 90);
  assert.equal(scoreFor([10, 3]), 87);
  const b = computeScores(
    [
      { id: "a", category: "t", severity: "P1" },
      { id: "b", category: "t", severity: "P2" },
    ],
    { score: 0 },
  );
  assert.equal(b.search.score, 87);
  assert.equal(b.search.band, "B");
  assert.equal(scoreFor([25]), 75);
  const d = computeScores(
    [
      { id: "a", category: "t", severity: "P1" },
      { id: "b", category: "t", severity: "P1" },
      { id: "c", category: "t", severity: "P1" },
      { id: "d", category: "t", severity: "P2" },
    ],
    { score: 0 },
  );
  assert.equal(d.search.score, 67);
  assert.equal(d.search.band, "D");
  assert.equal(scoreFor([25, 25]), 50);
});

test("GEO-only findings do not move the Search score", () => {
  const onlyGeo = [
    { id: "G01-llms", category: "geo", severity: "P2" },
    { id: "G02-ai-blocked", category: "geo", severity: "P1" },
  ];
  assert.equal(computeScores(onlyGeo, { score: 0 }).search.score, 100);
});

test("perfect GEO signals score 100", () => {
  const parsed = parseHtml(
    `<html lang="en"><head><title>What is X? A reasonably long and descriptive title here</title><meta name="description" content="A full-length meta description that comfortably exceeds one hundred and twenty characters for testing."></head><body><h1>What is X?</h1><p>What is X? X is a direct answer in forty to sixty words that explains the topic clearly and concisely for both humans and machines alike right now.</p><h2>Details</h2><table><tr><td>a</td></tr></table><ul><li>b</li></ul><h2>FAQ</h2><p>How does it work? It works.</p><p>${"word ".repeat(320)}</p></body></html>`,
    "https://example.com/",
  );
  const geo = geoDetails(parsed, {
    llms: { found: true },
    robots: { aiBlocked: false },
  });
  assert.equal(geo.score, 100);
});

test("isBlockedMetadataEndpoint blocks cloud metadata endpoints (SSRF)", () => {
  assert.equal(isBlockedMetadataEndpoint("http://169.254.169.254/latest/meta-data"), true);
  assert.equal(isBlockedMetadataEndpoint("http://metadata.google.internal/computeMetadata/v1/"), true);
  assert.equal(isBlockedMetadataEndpoint("http://100.100.100.200/latest/meta-data/"), true);
  assert.equal(isBlockedMetadataEndpoint("https://example.com/"), false);
  assert.equal(isBlockedMetadataEndpoint("http://127.0.0.1:3000/"), false);
});

test("fetchWithRedirects rejects cloud metadata endpoints", async () => {
  const r = await fetchWithRedirects("http://169.254.169.254/latest/meta-data");
  assert.equal(r.ok, false);
  assert.match(r.error, /cloud metadata endpoint \(SSRF protection\)/);
});

test("fetchText rejects cloud metadata endpoints", async () => {
  const r = await fetchText("http://169.254.169.254/latest/meta-data");
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /cloud metadata endpoint \(SSRF protection\)/);
});

test("renderCsv produces valid RFC 4180 CSV with escaped fields", () => {
  const r = {
    findings: [
      {
        severity: "P1",
        id: "T01-https",
        category: "technical",
        title: "Not on HTTPS, insecure",
        evidence: 'Found "http://" link',
        fix: "Switch to https://.",
        seoImpact: "high",
        geoImpact: "medium",
      },
    ],
  };
  const csv = renderCsv(r);
  assert.ok(csv.includes("Severity,Check ID,Category,Title,Evidence,Fix,SEO Impact,GEO Impact"));
  assert.ok(csv.includes('"Not on HTTPS, insecure"'));
  assert.ok(csv.includes('"Found ""http://"" link"'));
});
