/**
 * Regression tests — one per bug fixed in the v0.2.0 review.
 *
 * Each case is written so it FAILS against the pre-fix implementation:
 *   1. validateSchema ignored required properties for array `@type`
 *   2. T08-canonical compared canonical vs finalUrl as raw strings
 *   3. W02-og-url had the same raw-string comparison bug
 *   4. buildReport dereferenced parsed/siteFiles without guards
 *   5. parseArgs rejected the documented `--verbose` flag
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSchema } from "../lib/schema.mjs";
import { runChecks } from "../lib/checks.mjs";
import { buildReport } from "../lib/report.mjs";
import { parseArgs } from "../lib/args.mjs";

/** Minimal site-file triple that passes the T05/T06/G01 site checks. */
function files() {
  return {
    origin: "https://a.com",
    robots: { found: true, status: 200, sitemaps: [], disallowCount: 0, aiBlocked: false, textSample: "" },
    sitemap: {
      found: true,
      status: 200,
      url: "https://a.com/sitemap.xml",
      urlCount: 3,
      fromRobots: [],
      truncated: false,
      text: "",
    },
    llms: { found: true, status: 200, bytes: 200 },
  };
}

/** Minimal fetch result. `finalUrl` is the page under audit. @param {string} finalUrl */
function fetched(finalUrl) {
  return {
    finalUrl,
    status: 200,
    statusChain: [{ url: finalUrl, status: 200 }],
    contentType: "text/html",
    ms: 5,
    error: "",
  };
}

/** Build the smallest parseHtml-shaped object runChecks will accept. */
function parsed(overrides = {}) {
  return {
    robotsMeta: "",
    viewport: "width=device-width, initial-scale=1",
    charset: "utf-8",
    lang: "en",
    canonical: "",
    title: "A descriptive test page title here",
    metaDescription: "d".repeat(140),
    h1s: [{ text: "Home" }],
    h2s: [{ text: "Section" }],
    headings: [{ level: 1, text: "Home" }],
    og: { title: "T", description: "D", image: "i", url: "" },
    twitter: { card: "summary" },
    images: [],
    hreflangs: [],
    wordCount: 400,
    tables: 1,
    lists: 1,
    htmlBytes: 1000,
    internalLinkCount: 3,
    externalLinkCount: 0,
    headingOrderOk: true,
    faqDetected: true,
    hasAnswerBlock: true,
    icon: true,
    imagesWithoutAlt: 0,
    imagesWithoutDimensions: 0,
    ...overrides,
  };
}

/** @param {any[]} findings @param {string} id @returns {any} */
function byId(findings, id) {
  const f = findings.find((x) => x.id === id);
  assert.ok(f, `missing finding ${id}`);
  return f;
}

test("regression: array @type still gets required-property validation", () => {
  // Pre-fix these were all `t === "FAQPage"` style checks, which can never
  // match an array — every required-property rule was silently skipped.
  const faq = validateSchema([{ "@context": "https://schema.org", "@type": ["FAQPage"] }]);
  assert.ok(
    faq.issues.some((i) => i.issue === "FAQPage without mainEntity questions"),
    `expected FAQPage issue, got ${JSON.stringify(faq.issues)}`,
  );

  const event = validateSchema([{ "@context": "https://schema.org", "@type": ["Event"] }]);
  assert.ok(
    event.issues.some((i) => i.issue === "Event without startDate"),
    `expected Event issue, got ${JSON.stringify(event.issues)}`,
  );

  const org = validateSchema([{ "@context": "https://schema.org", "@type": ["Organization"] }]);
  assert.ok(
    org.issues.some((i) => i.issue === "Organization without name"),
    `expected Organization issue, got ${JSON.stringify(org.issues)}`,
  );

  // A complete array @type must NOT be flagged.
  const ok = validateSchema([
    {
      "@context": "https://schema.org",
      "@type": ["Article", "BlogPosting"],
      headline: "H",
    },
  ]);
  assert.deepEqual(ok.issues, [], `expected no issues, got ${JSON.stringify(ok.issues)}`);
});

test("regression: T08-canonical ignores trailing slash and tracking params", () => {
  /** @param {string} canonical @param {string} finalUrl @returns {string} */
  const check = (canonical, finalUrl) =>
    byId(
      runChecks(parsed({ canonical }), files(), fetched(finalUrl), {
        items: [],
        types: [],
        issues: [],
        errors: [],
      }),
      "T08-canonical",
    ).severity;

  // Trailing-slash-only difference used to raise a P1, which is enough to
  // trip `--fail-on P1` in CI.
  assert.equal(check("https://a.com/x/", "https://a.com/x"), "pass");
  assert.equal(check("https://a.com/x", "https://a.com/x/"), "pass");
  assert.equal(check("https://a.com/x?utm_source=news", "https://a.com/x"), "pass");
  assert.equal(check("https://a.com/x#section", "https://a.com/x"), "pass");

  // Guards against an over-broad fix: a genuinely different URL must stay P1.
  assert.equal(check("https://b.com/x", "https://a.com/x"), "P1");
  assert.equal(check("https://a.com/other", "https://a.com/x"), "P1");
});

test("regression: W02-og-url uses the same normalisation", () => {
  /** @param {string} ogUrl @param {string} finalUrl @returns {string} */
  const check = (ogUrl, finalUrl) =>
    byId(
      runChecks(
        parsed({ og: { title: "T", description: "D", image: "i", url: ogUrl } }),
        files(),
        fetched(finalUrl),
        {
          items: [],
          types: [],
          issues: [],
          errors: [],
        },
      ),
      "W02-og-url",
    ).severity;

  assert.equal(check("https://a.com/x/", "https://a.com/x"), "pass");
  assert.equal(check("https://a.com/x?utm_source=news", "https://a.com/x"), "pass");
  assert.equal(check("https://b.com/x", "https://a.com/x"), "P3");
});

test("regression: buildReport tolerates partial parsed and siteFiles", () => {
  // Pre-fix this threw `TypeError: Cannot read properties of undefined
  // (reading 'map')` after a successful fetch, discarding the whole report.
  const report = /** @type {any} */ (
    buildReport({
      url: "https://a.com/x",
      finalUrl: "https://a.com/x",
      scores: { search: { score: 90, band: "A" }, ai: { score: 80, band: "B" } },
      findings: [],
      parsed: {},
      siteFiles: {},
      meta: { version: "0.0.0-test" },
      checkedAt: "2026-10-09T00:00:00.000Z",
    })
  );

  assert.deepEqual(report.page.h1, []);
  assert.equal(report.page.title, "");
  assert.equal(report.page.wordCount, 0);
  assert.equal(report.page.images, 0);
  assert.equal(report.site.origin, "");
  assert.equal(report.site.robots, false);
  assert.equal(report.site.sitemapUrls, 0);
});

test("regression: --verbose is accepted by parseArgs", () => {
  // Documented in docs/USAGE.md but pre-fix threw `Unknown flag: --verbose`.
  const args = parseArgs(["audit", "https://a.com", "--verbose"]);
  assert.equal(args.verbose, true);
  assert.deepEqual(args._, ["audit", "https://a.com"]);

  // Must not consume the next token as a value.
  assert.equal(parseArgs(["audit", "x", "--verbose", "--json"]).json, true);
  assert.equal(parseArgs(["audit", "x"]).verbose, false);
});
