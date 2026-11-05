import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHtml } from "../lib/html.mjs";
import { runChecks, sanitizeSchemaType } from "../lib/checks.mjs";
import { extractJsonLd, validateSchema, schemaSnippet, generateSchema } from "../lib/schema.mjs";
import {
  esc,
  escTruncate,
  escMd,
  buildReport,
  renderMarkdown,
  renderHtml,
  renderSarif,
} from "../lib/report.mjs";
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

test("example reports conform to the report.json shape (lib/schema-report.json)", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "lib/schema-report.json"), "utf8"));
  for (const name of ["report-sample.json", "report-bad-sample.json"]) {
    const report = JSON.parse(readFileSync(join(ROOT, "examples", name), "utf8"));
    for (const key of schema.required) {
      assert.ok(key in report, `${name}: missing required field ${key}`);
    }
    assert.equal(report.tool, "one-step-seo");
    for (const axis of ["search", "ai"]) {
      const s = report.scores[axis];
      assert.ok(s.score >= 0 && s.score <= 100, `${name}: ${axis} score out of range`);
      assert.ok(["A", "B", "C", "D", "F"].includes(s.band), `${name}: bad ${axis} band`);
    }
    for (const f of report.findings)
      assert.ok(matchesFindingSchema(f), `${name}: finding fails schema: ${f.id}`);
    assert.ok(Array.isArray(report.page.h1), `${name}: page.h1 must be an array`);
  }
});

test("every emitted failure finding has finding-meta triage data", async () => {
  const { readdirSync } = await import("node:fs");
  const { getFindingMeta, FINDING_META } = await import("../lib/finding-meta.mjs");
  /** @type {Set<string>} */
  const ids = new Set(["T05-robots-disallow"]);
  for (const file of readdirSync(join(ROOT, "tests/fixtures")).filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(join(ROOT, "tests/fixtures", file), "utf8");
    const url = `https://example.com/${file.replace(/\.html$/, "/")}`;
    const parsed = parseHtml(html, url);
    const raw = extractJsonLd(parsed.jsonLdBlocks);
    const validated = validateSchema(raw.items);
    const findings = runChecks(
      parsed,
      files(),
      { finalUrl: url },
      {
        items: raw.items,
        types: validated.types,
        issues: validated.issues,
        errors: raw.errors,
      },
    );
    for (const f of findings) if (f.severity !== "pass") ids.add(f.id);
  }
  // Findings no fixture trips on its own: AI-blocked robots, invalid
  // JSON-LD, and a dynamic S02 schema-issue ID.
  const badHtml = readFileSync(join(ROOT, "tests/fixtures/bad.html"), "utf8");
  const badParsed = parseHtml(badHtml, "https://example.com/bad/");
  const badFetch = { finalUrl: "https://example.com/bad/" };
  const blockedFiles = { ...files(), robots: { ...files().robots, aiBlocked: true } };
  for (const f of runChecks(badParsed, blockedFiles, badFetch, {
    items: [],
    types: [],
    issues: [],
    errors: [],
  })) {
    if (f.severity !== "pass") ids.add(f.id);
  }
  const schemaInfo = {
    items: [{ "@type": "Article" }],
    types: ["Article"],
    issues: [{ type: "Article", issue: "Article without headline" }],
    errors: ["invalid JSON-LD block: oops"],
  };
  for (const f of runChecks(badParsed, files(), badFetch, schemaInfo)) {
    if (f.severity !== "pass") ids.add(f.id);
  }
  assert.ok(ids.size >= 30, `expected broad finding coverage, got ${ids.size}`);
  const generic = getFindingMeta("definitely-not-a-real-id");
  for (const id of ids) {
    const meta = getFindingMeta(id);
    assert.ok(meta.plain.length >= 20, `${id}: plain explanation too short`);
    assert.ok(["low", "medium", "high"].includes(meta.impact), `${id}: bad impact`);
    assert.ok(["minutes", "hours", "days"].includes(meta.effort), `${id}: bad effort`);
    assert.ok(["developer", "content", "SEO", "agency"].includes(meta.owner), `${id}: bad owner`);
    assert.equal(typeof meta.snippet, "string", `${id}: snippet must be a string`);
    if (!id.startsWith("S02-")) {
      assert.notEqual(meta.plain, generic.plain, `${id}: missing dedicated meta entry`);
    }
  }
  // Dynamic schema-issue IDs share the S02 fallback; unknown IDs degrade gracefully.
  assert.equal(getFindingMeta("S02-something-new").plain, FINDING_META["S02-"]?.plain);
  assert.equal(generic.impact, "low");
});

test("SARIF 2.1.0 output complies with official SARIF schema requirements", () => {
  const report = buildReport({
    url: "https://example.com/blog/article",
    finalUrl: "https://example.com/blog/article",
    scores: {
      search: { score: 85, band: "B" },
      ai: { score: 78, band: "C" },
    },
    findings: [
      {
        id: "T01-https",
        category: "technical",
        severity: "P0",
        title: "Insecure HTTP URL",
        evidence: "Page is served over plain HTTP",
        fix: "Migrate to HTTPS with a TLS certificate.",
      },
      {
        id: "T08-canonical",
        category: "technical",
        severity: "P1",
        title: "Canonical URL missing",
        evidence: "No rel=canonical link tag found",
        fix: "Add <link rel=canonical href=...>",
      },
      {
        id: "O01-title",
        category: "onpage",
        severity: "P2",
        title: "Title tag too short",
        evidence: "Title is 12 characters",
        fix: "Expand title to 30-60 characters.",
      },
      {
        id: "C01-thin",
        category: "content",
        severity: "P3",
        title: "Substantive word count light",
        evidence: "Body has 240 words",
        fix: "Expand body copy.",
      },
      {
        id: "T10-charset",
        category: "technical",
        severity: "pass",
        title: "UTF-8 declared",
        evidence: "meta charset=utf-8 present",
        fix: "",
      },
    ],
    parsed: { title: "Short", metaDescription: "Desc" },
    siteFiles: files(),
    meta: { version: "0.8.0" },
  });

  const sarif = /** @type {any} */ (renderSarif(report));

  // Schema conformance checks
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.$schema, "https://json.schemastore.org/sarif-2.1.0.json");
  assert.ok(Array.isArray(sarif.runs));
  assert.equal(sarif.runs.length, 1);

  const run = sarif.runs[0];
  assert.equal(run?.tool?.driver?.name, "one-step-seo");
  assert.equal(run?.tool?.driver?.version, "0.8.0");
  assert.ok(Array.isArray(run?.tool?.driver?.rules));

  // Check rules definition
  const ruleIds = new Set();
  for (const r of run?.tool?.driver?.rules || []) {
    assert.ok(typeof r.id === "string" && r.id.length > 0);
    assert.ok(typeof r.shortDescription?.text === "string" && r.shortDescription.text.length > 0);
    assert.ok(r.helpUri.startsWith("https://"));
    ruleIds.add(r.id);
  }

  // Actionable findings count (pass findings must be excluded)
  assert.equal(run?.results?.length, 4);

  // Validate each result
  for (const res of run?.results || []) {
    assert.ok(ruleIds.has(res.ruleId), `result ruleId ${res.ruleId} not declared in rules`);
    assert.ok(["error", "warning", "note", "none"].includes(res.level), `invalid SARIF level: ${res.level}`);
    assert.ok(typeof res.message?.text === "string" && res.message.text.length > 0);
    assert.ok(Array.isArray(res.locations));
    assert.equal(res.locations.length, 1);

    const artifactUri = res.locations[0]?.physicalLocation?.artifactLocation?.uri;
    assert.ok(typeof artifactUri === "string" && artifactUri.length > 0);
    // Artifact URI must parse as a valid URI reference
    const parsed = new URL(artifactUri);
    assert.ok(["http:", "https:", "file:"].includes(parsed.protocol));
  }
});

test("rendered HTML report satisfies accessibility standards and semantics", () => {
  const report = buildReport({
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    scores: {
      search: { score: 90, band: "A" },
      ai: { score: 85, band: "B" },
    },
    findings: [
      {
        id: "T01-https",
        category: "technical",
        severity: "P1",
        title: "Insecure link found",
        evidence: "Found http://link",
        fix: "Use https://",
      },
    ],
    parsed: { title: "Accessibility Test", metaDescription: "Testing a11y" },
    siteFiles: files(),
    meta: { version: "0.8.0" },
  });

  const html = renderHtml(report);

  // 1. Language and viewport
  assert.ok(html.includes('<html lang="en">'), "HTML must declare document language");
  assert.ok(html.includes('<meta name="viewport"'), "HTML must declare responsive viewport");

  // 2. Skip to main content link and target landmark
  assert.ok(html.includes('<a class="skip" href="#main">Skip to report</a>'), "Skip link must be present");
  assert.ok(html.includes('<main id="main">'), "Main landmark matching skip link must exist");

  // 3. Heading hierarchy: single h1
  const h1Matches = html.match(/<h1[^>]*>/g);
  assert.equal(h1Matches?.length, 1, "Must contain exactly one h1 heading");

  // 4. Accessible search input and controls
  assert.ok(html.includes('aria-label="Filter findings by text"'), "Search input must have aria-label");
  assert.ok(
    html.includes('role="group" aria-label="Filter by severity"'),
    "Severity filter group must have accessible role and label",
  );
  assert.ok(html.includes('aria-pressed="true"'), "Active filter chip must have aria-pressed state");

  // 5. Section headings and aria-labelledby references
  assert.ok(
    html.includes('<section id="summary" aria-labelledby="summary-h"><h2 id="summary-h">'),
    "Sections must be labelled by their headings",
  );
  assert.ok(
    html.includes('<section id="first" aria-labelledby="first-h"><h2 id="first-h">'),
    "First section must be labelled by heading",
  );

  // 6. SVG decorative/accessible markup
  assert.ok(
    html.includes('svg viewBox="0 0 80 80" width="84" height="84" aria-hidden="true"'),
    "SVG gauges must be aria-hidden with text alternatives",
  );
  assert.ok(html.includes('class="sr-only"'), "Gauges must have screen-reader accessible description text");

  // 7. Live region for dynamic filter count and copy alert
  assert.ok(
    html.includes('role="status" aria-live="polite"'),
    "Dynamic results must provide polite live regions for assistive tech",
  );

  // 8. Color contrast and dark mode
  assert.ok(html.includes("color-scheme:light dark"), "Stylesheet must declare light dark color-scheme");
});

test("expanded HTML escaping covers attribute breakout, tags, entities, and Unicode", () => {
  // Quotation marks and attribute breakout
  assert.equal(esc('"hello"'), "&quot;hello&quot;");
  assert.equal(
    esc('<img src="x" onerror="alert(1)">'),
    "&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;",
  );

  // Ampersand deduplication / protection
  assert.equal(esc("&amp;"), "&amp;amp;");
  assert.equal(esc("AT&T"), "AT&amp;T");

  // Edge cases
  assert.equal(esc(""), "");
  assert.equal(esc(0), "0");
  assert.equal(esc(false), "false");

  // Unicode preserved cleanly
  const unicode = "SEO 优化 and AI 検索 🚀";
  assert.equal(esc(unicode), unicode);

  // Truncation does not slice surrogate pairs or mid-entity
  const textWithEmoji = "A".repeat(10) + "🚀" + "B".repeat(10);
  const truncated = escTruncate(textWithEmoji, 12);
  assert.ok(truncated.includes("🚀"));
});
