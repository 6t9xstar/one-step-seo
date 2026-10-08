import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHtml } from "../lib/html.mjs";
import { runChecks, sanitizeSchemaType } from "../lib/checks.mjs";
import { extractJsonLd, validateSchema, schemaSnippet, generateSchema } from "../lib/schema.mjs";
import { esc, escTruncate, escMd, buildReport, renderMarkdown, renderHtml } from "../lib/report.mjs";
import { parseArgs, normalizeUrl, canonicalizeUrl } from "../lib/args.mjs";
import { parseRobots, looksLikeSitemap, countSitemapUrls } from "../lib/robots.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const findingSchema = JSON.parse(readFileSync(join(ROOT, "lib/schema-finding.json"), "utf8"));

/** @param {any} f @returns {boolean} */
function matchesFindingSchema(f) {
  if (findingSchema.required.some((/** @type {string} */ k) => !(k in f))) return false;
  if (!new RegExp(findingSchema.properties.id.pattern).test(f.id)) return false;
  if (!findingSchema.properties.category.enum.includes(f.category)) return false;
  if (!findingSchema.properties.severity.enum.includes(f.severity)) return false;
  return true;
}

function files() {
  return {
    origin: "https://example.com",
    robots: { found: true, status: 200, sitemaps: [], disallowCount: 0, aiBlocked: false, textSample: "" },
    sitemap: {
      found: true,
      status: 200,
      url: "https://example.com/sitemap.xml",
      urlCount: 3,
      fromRobots: [],
      truncated: false,
    },
    llms: { found: true, status: 200, bytes: 200 },
  };
}
function fetched() {
  return {
    finalUrl: "https://example.com/",
    status: 200,
    statusChain: [{ url: "https://example.com/", status: 200 }],
    contentType: "text/html",
    ms: 5,
    error: "",
  };
}

test("every finding validates against schema-finding.json (incl. sanitized S02)", () => {
  const html = `<html><head><title>T</title></head><body><h1>H</h1>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article+BlogPosting"}</script>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage"}</script>
    </body></html>`;
  const p = parseHtml(html, "https://example.com/");
  const raw = extractJsonLd(p.jsonLdBlocks);
  const v = validateSchema(raw.items);
  const findings = runChecks(p, files(), fetched(), {
    items: raw.items,
    types: v.types,
    issues: v.issues,
    errors: raw.errors,
  });
  assert.ok(findings.length > 0);
  for (const f of findings) {
    assert.ok(matchesFindingSchema(f), `finding ${f.id} fails schema: ${JSON.stringify(f).slice(0, 200)}`);
  }
});

test("sanitizeSchemaType keeps IDs in schema pattern", () => {
  for (const t of ["FAQPage", "Article+BlogPosting", "VideoObject", "(missing @type)", "X Y/Z"]) {
    const id = `S02-${sanitizeSchemaType(t)}`;
    assert.ok(new RegExp(findingSchema.properties.id.pattern).test(id), id);
  }
});

test("XSS: schemaSnippet escapes </script> and reports escape hostile content", () => {
  const snippet = schemaSnippet("faq", {
    name: "N",
    url: "https://example.com",
    description: "</script><script>alert(1)",
  });
  assert.ok(!snippet.includes("</script><script>"));
  assert.ok(snippet.includes("<\\/script"));
  assert.ok(!esc(`<img src=x onerror=alert(1)>`).includes("<img"));
  assert.ok(escTruncate("&amp;abcdefghij", 3).length > 0);
});

test("markdown renderer escapes hostile titles", () => {
  const report = buildReport({
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    scores: { search: { score: 100, band: "A" }, ai: { score: 100, band: "A" } },
    findings: [
      {
        id: "T01-https",
        category: "technical",
        severity: "P0",
        title: "# hacked\n- [x](http://evil)",
        evidence: "| table |",
        fix: "[click](http://evil)",
      },
    ],
    parsed: {
      title: "t",
      metaDescription: "d",
      canonical: "",
      wordCount: 1,
      h1s: [],
      images: [],
      internalLinkCount: 0,
      externalLinkCount: 0,
    },
    siteFiles: files(),
    meta: { version: "0.0.0-test" },
    checkedAt: "2026-10-08T00:00:00.000Z",
  });
  const md = renderMarkdown(report);
  assert.ok(!md.split("\n").some((l) => l.startsWith("# hacked")));
  const html = renderHtml(report);
  assert.ok(!html.includes("<script>alert"));
});

test("robots: grouped User-agents, inline comments, empty Disallow", () => {
  const r = parseRobots(
    "User-agent: A\nUser-agent: B\nDisallow: / # temp\nUser-agent: C\nDisallow:\nSitemap: https://example.com/s.xml # comment",
  );
  const group = r.disallows.find((d) => d.path === "/");
  assert.deepEqual(group?.agents, ["a", "b"]);
  assert.equal(r.disallows.length, 1);
  assert.deepEqual(r.sitemaps, ["https://example.com/s.xml"]);
});

test("robots: expanded AI bot list blocks", () => {
  assert.equal(parseRobots("User-agent: Claude-Web\nDisallow: /").aiBlocked, true);
  assert.equal(parseRobots("User-agent: CCBot\nDisallow: /").aiBlocked, true);
  assert.equal(parseRobots("User-agent: GPTBot\nDisallow: /*").aiBlocked, true);
  assert.equal(parseRobots("User-agent: SomeBot\nDisallow: /private").aiBlocked, false);
});

test("faqDetected only on FAQPage markup or FAQ copy", () => {
  const withArticle = parseHtml(
    `<html><head><title>T</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"H"}</script></head><body><h1>H</h1><p>${"word ".repeat(50)}</p></body></html>`,
    "https://example.com/",
  );
  assert.equal(withArticle.faqDetected, false);
  const withFaq = parseHtml(
    `<html><head><title>T</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}</script></head><body><h1>H</h1></body></html>`,
    "https://example.com/",
  );
  assert.equal(withFaq.faqDetected, true);
});

test("title/meta entities decode and htmlBytes are UTF-8 bytes", () => {
  const p = parseHtml(
    `<html><head><title>Fish &amp; Chips — café</title><meta name="description" content="A &amp; B"></head><body><p>hi</p></body></html>`,
    "https://example.com/",
  );
  assert.equal(p.title, "Fish & Chips — café");
  assert.equal(p.metaDescription, "A & B");
  assert.ok(p.htmlBytes >= Buffer.byteLength("café", "utf8"));
});

test("plaintext + index sitemaps", () => {
  assert.equal(looksLikeSitemap("https://a.com/1\nhttps://a.com/2\n"), true);
  assert.equal(countSitemapUrls("https://a.com/1\nhttps://a.com/2\n"), 2);
  const index = `<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap><sitemap><loc>https://a.com/s2.xml</loc></sitemap></sitemapindex>`;
  assert.equal(countSitemapUrls(index), 2);
});

test("args: --flag=value, trim, canonicalize, new flags", () => {
  assert.equal(parseArgs(["audit", "x", "--pages=5"]).pages, 5);
  assert.equal(parseArgs(["audit", "x", "--fail-on=P1"]).failOn, "P1");
  assert.equal(parseArgs(["audit", "x", "--crawl=sitemap"]).crawl, "sitemap");
  assert.equal(parseArgs(["audit", "x", "--concurrency=2"]).concurrency, 2);
  assert.equal(normalizeUrl("  https://example.com  "), "https://example.com/");
  assert.equal(canonicalizeUrl("https://EXAMPLE.com/a/?utm_source=x&b=1#frag"), "https://example.com/a?b=1");
  assert.equal(canonicalizeUrl("javascript:alert(1)"), "");
});

test("generateSchema refuses placeholder identity data", () => {
  assert.throws(() => generateSchema("organization", { name: "", url: "" }), /requires/);
  const node = generateSchema("product", { name: "N", url: "https://example.com" });
  assert.equal(node["@type"], "Product");
});

test("escMd escapes markdown metacharacters", () => {
  assert.ok(!escMd("# hi").startsWith("#"));
  assert.ok(escMd("a|b").includes("\\|"));
});
