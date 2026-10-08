import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtml } from "../lib/html.mjs";
import { runChecks } from "../lib/checks.mjs";
import { generateSchema, schemaSnippet, validateSchema } from "../lib/schema.mjs";
import { fetchWithRedirects } from "../lib/fetch.mjs";

function files(over = {}) {
  return {
    origin: "https://example.com",
    robots: { found: true, status: 200, sitemaps: [], disallowCount: 0, aiBlocked: false, textSample: "" },
    sitemap: {
      found: true,
      status: 200,
      url: "https://example.com/sitemap.xml",
      urlCount: 3,
      fromRobots: [],
    },
    llms: { found: true, status: 200, bytes: 200 },
    ...over,
  };
}

function fetched(over = {}) {
  return {
    finalUrl: "https://example.com/perfect/",
    status: 200,
    statusChain: [{ url: "https://example.com/perfect/", status: 200 }],
    contentType: "text/html; charset=utf-8",
    ms: 8,
    error: "",
    ...over,
  };
}

const PERFECT = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>A descriptive page title of forty characters</title>
<meta name="description" content="A well-crafted meta description that runs to about one hundred and forty characters total for testing purposes here.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="https://example.com/perfect/">
<link rel="icon" href="/favicon.ico">
<meta property="og:title" content="Perfect"><meta property="og:description" content="d"><meta property="og:image" content="https://example.com/og.png">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Perfect"}</script>
</head><body><h1>Perfect page</h1>
<p>What is this page? This page is a direct answer of about fifty words written first so both readers and machines get it immediately without scrolling anywhere else at all.</p>
<h2>Details</h2><table><tr><td>a</td></tr></table><ul><li>b</li></ul>
<h2>FAQ</h2><p>How does it work? It works well.</p>
<img src="/a.png" alt="A" width="100" height="100" loading="lazy">
<a href="https://example.com/1">1</a><a href="https://example.com/2">2</a>
<p>${"word ".repeat(400)}</p></body></html>`;

const BAD = `<!doctype html><html><head><title>${"T".repeat(80)}</title>
<meta name="description" content="${"D".repeat(200)}">
<meta name="robots" content="noindex">
<link rel="canonical" href="https://example.com/other/">
</head><body><h2>Sub first</h2><h4>Skipped</h4><p>Short thin page with no direct answer block anywhere near the top at all.</p>
${'<img src="/i.png">'.repeat(25)}
</body></html>`;

test("perfect page passes almost everything", () => {
  const p = parseHtml(PERFECT, "https://example.com/perfect/");
  const findings = runChecks(p, files(), fetched(), {
    items: [{ "@context": "https://schema.org", "@type": "Article", headline: "Perfect" }],
    types: ["Article"],
    issues: [],
    errors: [],
  });
  const bad = findings.filter((f) => f.severity === "P0" || f.severity === "P1");
  assert.deepEqual(
    bad.map((f) => f.id),
    [],
    `expected no P0/P1, got ${bad.map((f) => f.id).join(",")}`,
  );
});

test("bad page trips the remaining technical arms", () => {
  const p = parseHtml(BAD, "http://example.com/bad/?x=1");
  const findings = runChecks(
    p,
    files({
      robots: { found: false, status: 404, sitemaps: [], disallowCount: 0, aiBlocked: true, textSample: "" },
      sitemap: {
        found: false,
        status: 404,
        url: "https://example.com/sitemap.xml",
        urlCount: 0,
        fromRobots: [],
      },
      llms: { found: false, status: 404, bytes: 0 },
    }),
    fetched({
      finalUrl: "http://example.com/bad/?x=1",
      status: 500,
      statusChain: [
        { url: "http://example.com/a", status: 301 },
        { url: "http://example.com/b", status: 302 },
        { url: "http://example.com/bad/?x=1", status: 500 },
      ],
      contentType: "text/plain",
      error: "http status 500",
    }),
    { items: [], types: [], issues: [], errors: [] },
  );
  const byId = Object.fromEntries(findings.map((f) => [f.id, f.severity]));
  assert.equal(byId["T01-https"], "P0");
  assert.equal(byId["T02-status"], "P0");
  assert.equal(byId["T03-redirects"], "P1");
  assert.equal(byId["T04-content-type"], "P2");
  assert.equal(byId["T05-robots"], "P1");
  assert.equal(byId["T06-sitemap"], "P1");
  assert.equal(byId["T07-noindex"], "P0");
  assert.equal(byId["T08-canonical"], "P1");
  assert.equal(byId["T12-url"], "P2");
  assert.equal(byId["O01-title-long"], "P2");
  assert.equal(byId["O02-meta-long"], "P2");
  assert.equal(byId["O03-h1-missing"], "P1");
  assert.equal(byId["O04-headings"], "P2");
  assert.equal(byId["O06-og"], "P2");
  assert.equal(byId["O07-favicon"], "P2");
  assert.equal(byId["O08-alt"], "P1");
  assert.equal(byId["O10-internal"], "P1");
  assert.equal(byId["C01-thin"], "P1");
  assert.equal(byId["G02-ai-blocked"], "P1");
  assert.equal(byId["P02-img-count"], "P2");
});

test("every schema generator produces valid output", () => {
  for (const kind of ["organization", "website", "breadcrumb", "article", "faq", "other"]) {
    const node = generateSchema(kind, { name: "N", url: "https://example.com", description: "D" });
    assert.equal(node["@context"], "https://schema.org");
    assert.ok(typeof node["@type"] === "string");
    assert.ok(schemaSnippet(kind, { name: "N", url: "https://example.com" }).includes("application/ld+json"));
  }
});

test("schema validator flags each structural problem", () => {
  const v = validateSchema([
    { headline: "no context or type" },
    { "@context": "https://schema.org", "@type": "MadeUp" },
    { "@context": "https://schema.org", "@type": "Article" },
    { "@context": "https://schema.org", "@type": "FAQPage" },
    { "@context": "https://schema.org", "@type": "BreadcrumbList" },
    { "@context": "https://schema.org", "@type": ["Article", "BlogPosting"], headline: "ok" },
  ]);
  const issues = v.issues.map((i) => i.issue).join("|");
  assert.ok(issues.includes("missing @context"));
  assert.ok(issues.includes("missing @type"));
  assert.ok(issues.includes("unrecognized @type"));
  assert.ok(issues.includes("without headline"));
  assert.ok(issues.includes("without mainEntity"));
  assert.ok(issues.includes("without itemListElement"));
});

test("entity decoder drops invalid codepoints, keeps unknown entities", () => {
  const p = parseHtml("<html><body><p>A&#0;B&#x110000;C&unknown;D</p></body></html>", "https://example.com/");
  assert.ok(!p.visibleText.includes("&#0;"));
  assert.ok(p.visibleText.includes("&unknown;"));
});

test("garbage base URL degrades gracefully", () => {
  const p = parseHtml(
    '<html><head><link rel="canonical" href="/x"></head><body><a href="/y">y</a></body></html>',
    "::::",
  );
  assert.equal(p.canonical, "");
  assert.equal(p.internalLinkCount, 0);
});

test("connection refused surfaces a runtime error", async () => {
  const r = await fetchWithRedirects("http://127.0.0.1:1/unreachable", { timeoutMs: 3000 });
  assert.equal(r.ok, false);
  assert.ok(r.error.length > 0);
  assert.equal(r.html, "");
});
