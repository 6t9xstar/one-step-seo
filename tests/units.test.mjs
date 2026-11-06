/**
 * Unit coverage for the defensive / normalisation paths in score.mjs and
 * report.mjs. These are the `??`/`||` fallbacks and clamps that only fire on
 * malformed input, so they are invisible to the happy-path suites but are
 * exactly where a crash would cost the user a whole report.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtml } from "../lib/html.mjs";
import { extractJsonLd, validateSchema } from "../lib/schema.mjs";
import {
  geoDetails,
  computeScores,
  GEO_WEIGHTS,
  GEO_ONLY_IDS,
  SEARCH_WEIGHTS,
  RULES_VERSION,
} from "../lib/score.mjs";
import {
  esc,
  escTruncate,
  escMd,
  isValidScore,
  buildReport,
  renderMarkdown,
  renderHtml,
  renderSiteIndex,
  siteBasename,
  siteTopFindings,
  coverageLine,
  findDuplicateTitles,
  verdictFor,
  topFixes,
  citableChecklist,
  groupByCategory,
  monitorItems,
} from "../lib/report.mjs";
import { diffReports, isReport } from "../lib/report-diff.mjs";

// ---------- score.mjs: geoDetails ----------

test("geoDetails tolerates null / non-object inputs", () => {
  for (const args of [
    [null, null],
    [undefined, undefined],
    [{}, {}],
    ["string", 42],
  ]) {
    const r = geoDetails(args[0], args[1]);
    assert.equal(typeof r.score, "number");
    // Only the fail-open "ai crawlers allowed" signal scores here: with no
    // robots.txt in hand we must not claim the site blocks AI bots.
    assert.equal(r.score, GEO_WEIGHTS.aiAllowed, `expected only aiAllowed for ${JSON.stringify(args)}`);
    assert.equal(r.signals.length, Object.keys(GEO_WEIGHTS).length);
  }
});

test("geoDetails defaults missing robots/llms to not-found", () => {
  const r = geoDetails({ hasAnswerBlock: true }, {});
  const llms = r.signals.find((s) => s.key === "llms.txt");
  const ai = r.signals.find((s) => s.key === "ai crawlers allowed");
  assert.equal(llms?.ok, false);
  // aiAllowed defaults to ok:true when robots is absent (fail-open, not fail-closed).
  assert.equal(ai?.ok, true);
});

test("geoDetails treats string numbers and missing arrays as falsy", () => {
  const r = geoDetails({ tables: "0", lists: "0", wordCount: "10", h1s: null, h2s: null }, {});
  const extractable = r.signals.find((s) => s.key.startsWith("extractable"));
  const single = r.signals.find((s) => s.key.startsWith("single clear H1"));
  assert.equal(extractable?.ok, false);
  assert.equal(single?.ok, false);
});

test("geoDetails: a fully-signalled page scores 100", () => {
  const r = geoDetails(
    {
      hasAnswerBlock: true,
      tables: 2,
      lists: 1,
      wordCount: 500,
      faqDetected: true,
      h1s: [{ text: "H" }],
      h2s: [{ text: "S" }],
      title: "T",
      metaDescription: "D",
    },
    { llms: { found: true }, robots: { aiBlocked: false } },
  );
  assert.equal(r.score, 100);
});

test("geoDetails: multiple H1s fail the single-H1 signal", () => {
  const r = geoDetails({ h1s: [{ text: "A" }, { text: "B" }] }, {});
  assert.equal(r.signals.find((s) => s.key.startsWith("single clear H1"))?.ok, false);
});

// ---------- score.mjs: computeScores ----------

test("computeScores tolerates null / non-array findings and geo", () => {
  /** @type {Array<[any, any]>} */
  const cases = [
    [null, null],
    [undefined, undefined],
    ["nope", 42],
  ];
  for (const [findings, geo] of cases) {
    const s = computeScores(findings, geo);
    assert.equal(s.search.score, 100);
    assert.equal(s.search.band, "A");
    assert.equal(s.ai.score, 0);
    assert.equal(s.ai.band, "F");
  }
});

test("computeScores ignores 'pass' findings and unknown severities", () => {
  /** @type {any[]} */
  const findings = [
    { id: "a", category: "t", severity: "pass" },
    { id: "b", category: "t", severity: "P9" },
    { id: "c", category: "t", severity: "" },
    { id: "d", category: "t" },
  ];
  const s = computeScores(findings, { score: 50 });
  assert.equal(s.search.score, 100, "only 'pass'/unknown severities must not deduct");
});

test("computeScores clamps the AI score to 0-100", () => {
  assert.equal(computeScores([], { score: 250 }).ai.score, 100);
  assert.equal(computeScores([], { score: -40 }).ai.score, 0);
});

test("computeScores clamps the Search score to 0-100", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, category: "t", severity: "P0" }));
  assert.equal(computeScores(many, { score: 100 }).search.score, 0);
});

test("computeScores: GEO-only findings do not move the Search score", () => {
  const only = [...GEO_ONLY_IDS].map((id) => ({ id, category: "geo", severity: "P2" }));
  const withThem = computeScores(only, { score: 100 });
  const without = computeScores([], { score: 100 });
  assert.equal(withThem.search.score, without.search.score);
});

test("computeScores: a geo-category finding NOT in GEO_ONLY_IDS still deducts", () => {
  const s = computeScores([{ id: "G03-facts", category: "geo", severity: "P2" }], { score: 100 });
  assert.equal(s.search.score, 100 - SEARCH_WEIGHTS.P2);
});

test("computeScores: every band boundary", () => {
  /** @param {number} score @returns {string} */
  const at = (score) => computeScores([], { score }).ai.band;
  assert.equal(at(100), "A");
  assert.equal(at(90), "A");
  assert.equal(at(89), "B");
  assert.equal(at(80), "B");
  assert.equal(at(79), "C");
  assert.equal(at(70), "C");
  assert.equal(at(69), "D");
  assert.equal(at(60), "D");
  assert.equal(at(59), "F");
  assert.equal(at(0), "F");
});

// ---------- report.mjs: esc / escTruncate / escMd ----------

test("esc handles null, undefined and non-strings", () => {
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
  assert.equal(esc(0), "0");
  assert.equal(esc(false), "false");
  assert.equal(esc("<img src=x onerror=alert(1)>"), "&lt;img src=x onerror=alert(1)&gt;");
});

test("esc escapes quotes so attributes cannot break out", () => {
  assert.equal(esc('a"b'), "a&quot;b");
  assert.equal(esc("&<>\"'"), "&amp;&lt;&gt;&quot;&#39;");
});

test("escTruncate slices before escaping, never mid-entity", () => {
  // Slicing the raw string first means 3 ampersands escape to a complete
  // `&amp;&amp;&amp;`. The opposite order would slice the already-escaped text
  // to a broken `&am` fragment.
  assert.equal(escTruncate("&".repeat(50), 3), "&amp;&amp;&amp;");

  // A multi-byte char at the boundary is kept whole, not split into bytes, and
  // the resulting entity is complete (`&lt;`), never a dangling prefix.
  assert.equal(escTruncate("a<b", 2), "a&lt;");
  assert.equal(escTruncate("<b>", 1), "&lt;");
  assert.ok(escTruncate("<b>", 1).endsWith(";"), "entity must be terminated");
});

test("escTruncate counts characters, not bytes, and honours an explicit max", () => {
  assert.equal([...escTruncate("héllo wörld", 5)].length, 5);
  assert.equal(escTruncate("abcdef", 3), "abc");
  assert.equal(escTruncate("ab", 100), "ab");
});

test("escMd neutralises markdown metacharacters and newlines", () => {
  assert.ok(!escMd("# hi").startsWith("#"));
  assert.ok(escMd("a|b").includes("\\|"));
  assert.ok(escMd("a`b").includes("\\`"));
  assert.ok(!escMd("line1\nline2").includes("\n"));
  assert.equal(escMd(null), "");
  assert.equal(escMd("x".repeat(900)).length, 500);
});

// ---------- report.mjs: buildReport ----------

test("buildReport honours SOURCE_DATE_EPOCH when checkedAt is absent", () => {
  const prev = process.env.SOURCE_DATE_EPOCH;
  try {
    process.env.SOURCE_DATE_EPOCH = "1700000000";
    const r = buildReport({
      url: "u",
      finalUrl: "u",
      scores: { search: { score: 1, band: "F" }, ai: { score: 1, band: "F" } },
      findings: [],
      parsed: {},
      siteFiles: {},
      meta: { version: "9" },
    });
    assert.equal(r.checkedAt, "2023-11-14T22:13:20.000Z");
  } finally {
    if (prev === undefined) delete process.env.SOURCE_DATE_EPOCH;
    else process.env.SOURCE_DATE_EPOCH = prev;
  }
});

test("buildReport counts every severity and ignores unknown ones safely", () => {
  const r = buildReport({
    url: "u",
    finalUrl: "u",
    scores: { search: { score: 1, band: "F" }, ai: { score: 1, band: "F" } },
    findings: [
      { id: "a", category: "c", severity: "P0", title: "t", evidence: "e", fix: "f" },
      { id: "b", category: "c", severity: "P3", title: "t", evidence: "e", fix: "f" },
      { id: "c", category: "c", severity: "pass", title: "t", evidence: "e", fix: "f" },
    ],
    parsed: {},
    siteFiles: {},
    meta: { version: "9" },
    checkedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(r.counts.P0, 1);
  assert.equal(r.counts.P3, 1);
  assert.equal(r.counts.pass, 1);
  // P1/P2 stay defined at 0 rather than becoming undefined.
  assert.equal(r.counts.P1, 0);
  assert.equal(r.counts.P2, 0);
});

test("buildReport sorts P0 first and pass last", () => {
  const r = buildReport({
    url: "u",
    finalUrl: "u",
    scores: { search: { score: 1, band: "F" }, ai: { score: 1, band: "F" } },
    findings: [
      { id: "p", category: "c", severity: "pass", title: "t", evidence: "e", fix: "f" },
      { id: "z", category: "c", severity: "P2", title: "t", evidence: "e", fix: "f" },
      { id: "a", category: "c", severity: "P0", title: "t", evidence: "e", fix: "f" },
    ],
    parsed: {},
    siteFiles: {},
    meta: { version: "9" },
    checkedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(
    r.findings.map((f) => f.severity),
    ["P0", "P2", "pass"],
  );
});

// ---------- report.mjs: renderers ----------

test("renderMarkdown handles an all-pass report", () => {
  const r = buildReport({
    url: "https://a.com/",
    finalUrl: "https://a.com/",
    scores: { search: { score: 100, band: "A" }, ai: { score: 100, band: "A" } },
    findings: [
      {
        id: "T01-https",
        category: "technical",
        severity: "pass",
        title: "HTTPS enabled",
        evidence: "e",
        fix: "",
      },
    ],
    parsed: {},
    siteFiles: {},
    meta: { version: "9" },
    checkedAt: "2026-01-01T00:00:00.000Z",
  });
  const md = renderMarkdown(r);
  assert.match(md, /No issues found\. Nice\./);
  assert.match(md, /Search SEO: \*\*100\/100 \(A\)\*\*/);
});

test("renderMarkdown notes truncation", () => {
  const r = buildReport({
    url: "u",
    finalUrl: "u",
    scores: { search: { score: 1, band: "F" }, ai: { score: 1, band: "F" } },
    findings: [],
    parsed: {},
    siteFiles: {},
    meta: { version: "9" },
    truncated: true,
    checkedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.match(renderMarkdown(r), /HTML truncated at the 5MB audit cap/);
});

test("renderHtml notes truncation and omits the banner otherwise", () => {
  const base = {
    url: "u",
    finalUrl: "u",
    scores: { search: { score: 1, band: "F" }, ai: { score: 1, band: "F" } },
    findings: [],
    parsed: {},
    siteFiles: {},
    meta: { version: "9" },
    checkedAt: "2026-01-01T00:00:00.000Z",
  };
  const truncated = renderHtml(buildReport({ ...base, truncated: true }));
  assert.match(truncated, /exceeded the 5MB audit cap/);

  const clean = renderHtml(buildReport({ ...base, truncated: false }));
  assert.ok(!clean.includes("exceeded the 5MB audit cap"));
  assert.ok(!clean.includes("undefined"), `renderHtml leaked "undefined": ${clean.slice(0, 200)}`);
});

test("renderHtml renders an em-dash placeholder when a fix is empty", () => {
  const r = buildReport({
    url: "u",
    finalUrl: "u",
    scores: { search: { score: 1, band: "F" }, ai: { score: 1, band: "F" } },
    findings: [
      {
        id: "W01-social",
        category: "onpage",
        severity: "P3",
        title: "Twitter card missing",
        evidence: "e",
        fix: "",
      },
    ],
    parsed: {},
    siteFiles: {},
    meta: { version: "9" },
    checkedAt: "2026-01-01T00:00:00.000Z",
  });
  // Cards replaced the old table layout; the empty-fix placeholder moved with it.
  assert.match(renderHtml(r), /<span>—<\/span>/);
});

// ---------- report.mjs: verdict, triage helpers, new sections ----------

/**
 * @param {{ id: string, severity: string }} f
 * @param {string} [category]
 * @returns {import("../lib/report.mjs").Finding}
 */
function mkFinding(f, category = "technical") {
  return { id: f.id, category, severity: f.severity, title: `t-${f.id}`, evidence: "e", fix: "do x" };
}

/**
 * @param {import("../lib/report.mjs").Finding[]} findings
 * @param {{ search?: number, ai?: number }} [scores]
 */
function mkReport(findings, scores = {}) {
  const search = scores.search ?? 100;
  const ai = scores.ai ?? 100;
  /** @type {Record<string, number>} */
  const counts = { P0: 0, P1: 0, P2: 0, P3: 0, pass: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return {
    tool: "one-step-seo",
    version: "9",
    rulesVersion: RULES_VERSION,
    url: "https://a.com/",
    finalUrl: "https://a.com/",
    checkedAt: "2026-01-01T00:00:00.000Z",
    truncated: false,
    scores: {
      search: { score: search, band: "A" },
      ai: { score: ai, band: "A" },
    },
    counts,
    findings,
    page: {},
    site: {},
  };
}

test("verdictFor hits every branch", () => {
  assert.match(verdictFor(mkReport([mkFinding({ id: "T01-https", severity: "P0" })])), /urgent attention/);
  assert.match(verdictFor(mkReport([mkFinding({ id: "x", severity: "P1" })], { search: 40 })), /Below par/);
  assert.match(verdictFor(mkReport([mkFinding({ id: "x", severity: "P1" })], { ai: 55 })), /Below par/);
  assert.match(
    verdictFor(mkReport([mkFinding({ id: "x", severity: "P1" })], { search: 40, ai: 40 })),
    /both under 60/,
  );
  assert.match(
    verdictFor(mkReport([mkFinding({ id: "a", severity: "P0" }), mkFinding({ id: "b", severity: "P0" })])),
    /2 critical \(P0\) issues block/,
  );
  assert.match(verdictFor(mkReport([mkFinding({ id: "x", severity: "P1" })])), /Solid foundation/);
  assert.match(verdictFor(mkReport([mkFinding({ id: "x", severity: "P2" })])), /good shape/);
  assert.match(verdictFor(mkReport([mkFinding({ id: "x", severity: "pass" })])), /Excellent/);
});

test("verdictFor reports a skipped crawl instead of a foundation", () => {
  const refused = mkReport([mkFinding({ id: "T05-robots-disallow", severity: "P1" })]);
  assert.match(verdictFor(refused), /Crawl skipped: robots\.txt disallows/);
  const html = renderHtml(
    buildReport({
      url: "https://a.com/",
      finalUrl: "https://a.com/",
      scores: { search: { score: 90, band: "A" }, ai: { score: 5, band: "F" } },
      findings: [
        {
          id: "T05-robots-disallow",
          category: "technical",
          severity: "P1",
          title: "robots.txt disallows crawling this page",
          evidence: "e",
          fix: "f",
        },
      ],
      parsed: {},
      siteFiles: {},
      meta: { version: "9" },
      checkedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  assert.match(html, /Crawl skipped: robots\.txt disallows/);
  assert.match(html, /No pages were audited — robots\.txt disallows this path\./);
});

test("topFixes returns the first three actionable findings", () => {
  const r = mkReport([
    mkFinding({ id: "a", severity: "P1" }),
    mkFinding({ id: "b", severity: "pass" }),
    mkFinding({ id: "c", severity: "P2" }),
    mkFinding({ id: "d", severity: "P2" }),
    mkFinding({ id: "e", severity: "P3" }),
  ]);
  assert.deepEqual(
    topFixes(r).map((f) => f.id),
    ["a", "c", "d"],
  );
  assert.deepEqual(topFixes(mkReport([])), []);
});

test("citableChecklist reflects pass/fail and skips unevaluated signals", () => {
  const r = mkReport([
    mkFinding({ id: "C02-answer", severity: "pass" }, "content"),
    mkFinding({ id: "G01-llms", severity: "P2" }, "geo"),
  ]);
  const list = citableChecklist(r);
  const byLabel = new Map(list.map((c) => [c.label, c.checked]));
  assert.equal([...byLabel.values()].filter(Boolean).length >= 1, true);
  assert.ok([...byLabel.keys()].some((l) => l.includes("Answer-first")));
  // G04 was never evaluated -> no checklist row for it.
  assert.ok(![...byLabel.keys()].some((l) => l.includes("Consistent titles")));
  // S01 absent entirely -> skipped, not failed.
  assert.ok(![...byLabel.keys()].some((l) => l.includes("Structured data")));
});

test("groupByCategory orders known categories and trails unknown ones", () => {
  const r = mkReport([
    mkFinding({ id: "w", severity: "P3" }, "mystery"),
    mkFinding({ id: "g", severity: "P2" }, "geo"),
    mkFinding({ id: "t", severity: "P1" }, "technical"),
  ]);
  assert.deepEqual(
    groupByCategory(r).map((g) => g.key),
    ["technical", "geo", "mystery"],
  );
});

test("monitorItems picks P3 and performance findings only", () => {
  const r = mkReport([
    mkFinding({ id: "a", severity: "P1" }),
    mkFinding({ id: "b", severity: "P2" }, "performance"),
    mkFinding({ id: "c", severity: "P3" }),
    mkFinding({ id: "d", severity: "pass" }),
  ]);
  assert.deepEqual(
    monitorItems(r).map((f) => f.id),
    ["b", "c"],
  );
});

test("renderMarkdown includes the new report sections", () => {
  const r = buildReport({
    url: "https://a.com/",
    finalUrl: "https://a.com/",
    scores: { search: { score: 70, band: "C" }, ai: { score: 65, band: "D" } },
    findings: [
      {
        id: "T01-https",
        category: "technical",
        severity: "P0",
        title: "Not on HTTPS",
        evidence: "e",
        fix: "do x",
      },
      {
        id: "W01-social",
        category: "onpage",
        severity: "P3",
        title: "Twitter card missing",
        evidence: "e",
        fix: "",
      },
    ],
    parsed: {},
    siteFiles: {},
    meta: { version: "9" },
    checkedAt: "2026-01-01T00:00:00.000Z",
  });
  const md = renderMarkdown(r);
  for (const section of [
    "## Executive summary",
    "## Fix this first",
    "## Priority actions",
    "### Technical SEO",
    "## Make this page more citable",
    "## What passed",
    "## What to monitor",
  ]) {
    assert.ok(md.includes(section), `missing section ${section}`);
  }
  assert.match(md, /Impact: high · Effort: hours · Owner: developer/);
  assert.match(md, /```html/);
  assert.match(md, /CHECKS\.md/);
});

test("renderHtml includes copy button, skip link and labelled sections", () => {
  const r = buildReport({
    url: "https://a.com/",
    finalUrl: "https://a.com/",
    scores: { search: { score: 100, band: "A" }, ai: { score: 100, band: "A" } },
    findings: [
      {
        id: "T01-https",
        category: "technical",
        severity: "pass",
        title: "HTTPS enabled",
        evidence: "e",
        fix: "",
      },
    ],
    parsed: {},
    siteFiles: {},
    meta: { version: "9" },
    checkedAt: "2026-01-01T00:00:00.000Z",
  });
  const html = renderHtml(r);
  assert.match(html, /id="copy-summary"/);
  assert.match(html, /Skip to report/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /Executive summary/);
  assert.match(html, /Make this page more citable/);
  assert.match(html, /@media print/);
  assert.ok(!html.includes("undefined"));
});

// ---------- report.mjs: site dashboard ----------

test("siteBasename follows the report/report-N convention", () => {
  assert.equal(siteBasename(0), "report");
  assert.equal(siteBasename(1), "report-2");
  assert.equal(siteBasename(19), "report-20");
});

test("siteTopFindings orders by severity, then reach, then id", () => {
  const p1 = mkReport([
    mkFinding({ id: "b-P2", severity: "P2" }),
    mkFinding({ id: "a-P0", severity: "P0" }),
    mkFinding({ id: "c-P1", severity: "P1" }),
  ]);
  const p2 = mkReport([mkFinding({ id: "b-P2", severity: "P2" }), mkFinding({ id: "d-P2", severity: "P2" })]);
  const top = siteTopFindings([p1, p2], 10);
  assert.deepEqual(
    top.map((t) => [t.finding.id, t.pages, t.total]),
    [
      ["a-P0", 1, 2],
      ["c-P1", 1, 2],
      ["b-P2", 2, 2],
      ["d-P2", 1, 2],
    ],
  );
});

test("siteTopFindings dedupes per page and caps at n", () => {
  const r = mkReport([
    mkFinding({ id: "x", severity: "P1" }),
    { ...mkFinding({ id: "x", severity: "P1" }), title: "t-x-again" },
  ]);
  assert.deepEqual(
    siteTopFindings([r], 10).map((t) => [t.finding.id, t.pages]),
    [["x", 1]],
  );
  assert.equal(siteTopFindings([r], 0).length, 0);
  assert.deepEqual(siteTopFindings([], 5), []);
  assert.deepEqual(siteTopFindings([mkReport([mkFinding({ id: "x", severity: "pass" })])], 5), []);
});

test("renderSiteIndex lists pages worst-first with dashboard links", () => {
  const mid = mkReport([mkFinding({ id: "m", severity: "P2" })], { search: 70, ai: 70 });
  mid.url = "https://a.com/mid/";
  mid.finalUrl = "https://a.com/mid/";
  const worst = mkReport([mkFinding({ id: "w", severity: "P0" })], { search: 30, ai: 40 });
  worst.url = "https://a.com/worst/";
  worst.finalUrl = "https://a.com/worst/";
  const best = mkReport([mkFinding({ id: "ok", severity: "pass" })], { search: 100, ai: 100 });
  best.url = "https://a.com/best/";
  best.finalUrl = "https://a.com/best/";
  // Deliberately unordered input: the dashboard must sort worst-first.
  // (Row hrefs — not raw URLs — because the hero legitimately shows the
  // first report's origin before the table.)
  const html = renderSiteIndex([best, mid, worst]);
  const iWorst = html.indexOf('href="./report-3.html"');
  const iMid = html.indexOf('href="./report-2.html"');
  const iBest = html.indexOf('href="./report.html"');
  assert.ok(iWorst >= 0 && iMid >= 0 && iBest >= 0, "all three pages must be linked");
  assert.ok(iWorst < iMid && iMid < iBest, "pages must be worst-first");
  assert.ok(html.includes(">https://a.com/worst/</a>"));
  assert.ok(html.includes(">https://a.com/best/</a>"));
  assert.match(html, /Site audit/);
  assert.match(html, /Top recurring issues/);
  assert.match(html, /on 1\/3 pages/);
  assert.match(html, /<table class="pages">/);
  assert.ok(!html.includes("undefined"));
});

test("renderSiteIndex handles an empty report list", () => {
  const html = renderSiteIndex([]);
  assert.match(html, /0 pages/);
  assert.match(html, /No recurring issues/);
  assert.ok(!html.includes("undefined") && !html.includes("NaN"));
});

test("renderHtml renders the dashboard crumb and share tags on request", () => {
  const r = buildReport({
    url: "https://a.com/",
    finalUrl: "https://a.com/",
    scores: { search: { score: 80, band: "B" }, ai: { score: 70, band: "C" } },
    findings: [
      {
        id: "T01-https",
        category: "technical",
        severity: "pass",
        title: "HTTPS enabled",
        evidence: "e",
        fix: "",
      },
    ],
    parsed: {},
    siteFiles: {},
    meta: { version: "9" },
    checkedAt: "2026-01-01T00:00:00.000Z",
  });
  const plain = renderHtml(r);
  assert.ok(!plain.includes("index.html"), "no crumb without opts");
  const withNav = renderHtml(r, { indexHref: "index.html", pageCount: 4 });
  assert.match(withNav, /href="index\.html"/);
  assert.match(withNav, /All 4 pages/);
  assert.match(withNav, /<meta name="description" content="Search SEO 80\/100 \(B\)/);
  assert.match(withNav, /<meta property="og:title" content="one-step-seo report/);
  assert.match(withNav, /<meta property="og:type" content="website">/);
  assert.ok(!withNav.includes("undefined"));
});

test("coverageLine reports cap, shortfall, clean, and single-page runs", () => {
  assert.equal(coverageLine(1, 20, false, 200), null);
  assert.equal(coverageLine(1, 1, true, 200), null);
  assert.equal(
    coverageLine(20, 20, true, 200),
    "Stopped at the --pages 20 cap — the crawl saw more URLs. Re-run with a higher --pages (max 200) to cover the rest.",
  );
  assert.equal(
    coverageLine(200, 200, true, 200),
    "Stopped at the --pages 200 cap — the crawl saw more URLs.",
  );
  assert.equal(
    coverageLine(78, 200, true, 200),
    "Audited 78 discovered pages; more URLs were seen but not reached.",
  );
  assert.equal(coverageLine(2, 2, false, 200), "Audited all 2 discovered pages.");
});

test("findDuplicateTitles groups case-insensitively and ignores empties", () => {
  /** @param {string} title @param {string} meta */
  const rep = (title, meta) => ({ ...mkReport([]), page: { title, metaDescription: meta } });
  const dups = findDuplicateTitles([
    rep("Acme Home", "Welcome to Acme"),
    rep("ACME home", "Other desc"),
    rep("Unique", "Welcome to Acme"),
    rep("", ""),
  ]);
  assert.deepEqual(
    dups.map((d) => [d.kind, d.pages]),
    [
      ["title", [0, 1]],
      ["meta description", [0, 2]],
    ],
  );
  assert.deepEqual(findDuplicateTitles([]), []);
  assert.deepEqual(findDuplicateTitles([rep("Only", "Once")]), []);
});

test("renderSiteIndex lists duplicate titles with page links", () => {
  /** @param {string} title */
  const rep = (title) => ({ ...mkReport([]), page: { title, metaDescription: "" } });
  const html = renderSiteIndex([rep("Dup Title"), rep("Other"), rep("dup title")]);
  assert.match(html, /Duplicate titles/);
  assert.match(html, /dup title/);
  assert.match(html, /page 1.*page 3|page 3.*page 1/);
  const clean = renderSiteIndex([rep("One"), rep("Two")]);
  assert.match(clean, /No duplicate titles or meta descriptions/);
  assert.ok(!clean.includes("undefined"));
});

// ---------- report-diff.mjs ----------

test("isReport accepts report-shaped objects only", () => {
  const good = {
    tool: "one-step-seo",
    scores: { search: { score: 80 }, ai: { score: 70 } },
    findings: [],
  };
  assert.equal(isReport(good), true);
  assert.equal(isReport(null), false);
  assert.equal(isReport({}), false);
  assert.equal(isReport({ tool: "one-step-seo" }), false);
  assert.equal(isReport({ tool: "other", scores: good.scores, findings: [] }), false);
  assert.equal(isReport({ tool: "one-step-seo", scores: { search: {} }, findings: [] }), false);
});

test("diffReports finds new, resolved, and escalated findings plus deltas", () => {
  /** @param {string} id @param {string} severity */
  const f = (id, severity) => ({ id, severity, title: `t-${id}`, evidence: "e", fix: "x" });
  const oldR = {
    tool: "one-step-seo",
    url: "https://a.com/",
    finalUrl: "https://a.com/",
    rulesVersion: "2026.10",
    scores: { search: { score: 80, band: "B" }, ai: { score: 70, band: "C" } },
    findings: [f("T01-https", "P0"), f("O02-meta-missing", "P1"), f("W01-social", "P3")],
  };
  const newR = {
    tool: "one-step-seo",
    url: "https://a.com/",
    finalUrl: "https://a.com/",
    rulesVersion: "2026.10",
    scores: { search: { score: 86, band: "B" }, ai: { score: 70, band: "C" } },
    findings: [f("T01-https", "pass"), f("C02-answer", "P1"), f("W01-social", "P3")],
  };
  const d = diffReports(oldR, newR);
  assert.deepEqual(d.search, { old: 80, new: 86, delta: 6 });
  assert.deepEqual(d.ai, { old: 70, new: 70, delta: 0 });
  assert.equal(d.rulesVersionChanged, false);
  // O02 fixed (absent from new) → resolved; C02 appeared → new.
  assert.deepEqual(
    d.resolvedFindings.map((x) => x.id),
    ["O02-meta-missing"],
  );
  assert.deepEqual(
    d.newFindings.map((x) => x.id),
    ["C02-answer"],
  );
  // T01 went P0 → pass: improved, neither new nor escalated.
  assert.deepEqual(d.escalated, []);
  assert.equal(d.url, "https://a.com/");
});

test("diffReports flags escalations and rules-version changes", () => {
  /** @param {string} id @param {string} severity */
  const f = (id, severity) => ({ id, severity, title: `t-${id}`, evidence: "e", fix: "x" });
  const oldR = {
    tool: "one-step-seo",
    scores: { search: { score: 90, band: "A" }, ai: { score: 90, band: "A" } },
    findings: [f("O06-og", "P2")],
  };
  const newR = {
    tool: "one-step-seo",
    rulesVersion: "2026.11",
    scores: { search: { score: 65, band: "D" }, ai: { score: 90, band: "A" } },
    findings: [f("O06-og", "P0")],
  };
  const d = diffReports(oldR, newR);
  assert.equal(d.rulesVersionChanged, true);
  assert.equal(d.oldRulesVersion, "");
  assert.equal(d.newRulesVersion, "2026.11");
  assert.deepEqual(
    d.escalated.map((e) => [e.id, e.oldSeverity, e.newSeverity]),
    [["O06-og", "P2", "P0"]],
  );
  assert.deepEqual(d.newFindings, []);
  assert.deepEqual(d.resolvedFindings, []);
});

test("renderHtml renders SEO details, Remediation, Executive Mode toggle, Theme toggle, Category filter, and unmeasured PSI state", () => {
  const r = buildReport({
    url: "https://example.com/pricing",
    finalUrl: "https://example.com/pricing/",
    scores: { search: { score: 88, band: "B" }, ai: { score: 75, band: "C" } },
    findings: [
      {
        id: "O01-title-long",
        category: "onpage",
        severity: "P2",
        title: "Title too long",
        evidence: "72 chars",
        fix: "Trim title to 60 chars",
      },
    ],
    parsed: {
      title: "Enterprise Cloud Pricing Plans",
      metaDescription: "Compare Starter, Team, and Enterprise pricing.",
      canonical: "https://example.com/pricing/",
      wordCount: 420,
      h1s: [{ text: "Pricing Plans" }],
      images: [{ src: "/a.png" }],
      internalLinkCount: 5,
      externalLinkCount: 2,
    },
    siteFiles: {
      origin: "https://example.com",
      robots: { found: true },
      sitemap: { found: true, urlCount: 18 },
      llms: { found: true },
    },
    meta: { version: "0.9.0" },
    checkedAt: "2026-10-08T00:00:00.000Z",
  });
  const html = renderHtml(r);
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.match(html, /id="cat-filter"/);
  assert.match(html, /id="exec-mode-btn"/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /id="seo-details"/);
  assert.match(html, /id="remediation"/);
  assert.match(html, /id="psi"/);
  assert.match(html, /Not measured \(opt-in\)/);
  assert.match(html, /Unmeasured metrics are reported as unavailable, never zero/);
  assert.match(html, /Enterprise Cloud Pricing Plans/);
  assert.match(html, /Rules 2026\.10/);
});

test("renderHtml renders partial PSI lab and field metrics as Unavailable, never zero", () => {
  const r = buildReport({
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    scores: { search: { score: 90, band: "A" }, ai: { score: 85, band: "B" } },
    findings: [],
    parsed: {},
    siteFiles: {},
    meta: { version: "0.9.0" },
    checkedAt: "2026-10-08T00:00:00.000Z",
    psi: {
      strategy: "mobile",
      lab: { score: 92, lcpMs: 1800, cls: null, tbtMs: null, fcpMs: 900 },
      field: { overallCategory: "FAST", lcpMs: 2100, cls: null, inpMs: null },
    },
  });
  const html = renderHtml(r);
  assert.match(html, /Lab Performance Score: 92\/100/);
  assert.match(html, /1\.80s/);
  assert.match(html, /2\.10s/);
  assert.match(html, /<dt>Cumulative Layout Shift<\/dt><dd>Unavailable<\/dd>/);
  assert.match(html, /<dt>Total Blocking Time<\/dt><dd>Unavailable<\/dd>/);
  assert.match(html, /<dt>Field CLS<\/dt><dd>Unavailable<\/dd>/);
  assert.match(html, /<dt>Field INP<\/dt><dd>Unavailable<\/dd>/);
  assert.ok(!html.includes("<dd>0.000</dd>"), "null CLS must not render as 0.000");
});

test("renderSiteIndex excludes unavailable scores from aggregation and shows contributing page counts", () => {
  const validPage = mkReport([mkFinding({ id: "O01-title-long", severity: "P2" }, "onpage")], {
    search: 80,
    ai: 90,
  });
  validPage.url = "https://example.com/a";
  validPage.finalUrl = "https://example.com/a";
  validPage.page = { title: "Page A", metaDescription: "Desc A", internalLinks: 1 };

  const missingScorePage = /** @type {any} */ ({
    ...mkReport([mkFinding({ id: "T01-https", severity: "P0" }, "technical")]),
    url: "https://example.com/b",
    finalUrl: "https://example.com/b",
    truncated: true,
    scores: { search: { score: null, band: "F" }, ai: { score: undefined, band: "F" } },
    page: { title: "Page B", metaDescription: "Desc B", internalLinks: 3 },
  });

  const html = renderSiteIndex([validPage, missingScorePage]);
  assert.match(html, /Average 80\/100 · lowest 80 · highest 80 \(1\/2 valid pages\)/);
  assert.match(html, /Average 90\/100 · lowest 90 · highest 90 \(1\/2 valid pages\)/);
  assert.match(html, /Search: 1\/2 &middot; AI: 1\/2/);
  assert.match(html, /1 page\(s\) hit 5MB cap/);
  assert.match(html, /id="cat-dist"/);
  assert.match(html, /id="linking"/);
  assert.match(html, /1 internal outlink/);
  assert.match(html, /role="region" aria-labelledby="pages-h"/);
  // Missing-score page must render N/A badge with empty data-s/data-a and must NOT be ranked as Lowest-Performing Page
  assert.match(html, /data-s="" data-a=""/);
  assert.match(html, />N\/A<\/span>/);
  assert.ok(!html.includes("0 F"), "missing scores must not render as 0 F");
  assert.match(
    html,
    /Lowest-Performing Page<\/h3><dl class="kv-list">\s*<div class="kv-row"><dt>URL<\/dt><dd><a href="\.\/report\.html#main">https:\/\/example\.com\/a<\/a>/,
  );
  assert.match(
    html,
    /Highest-Performing Page<\/h3><dl class="kv-list">\s*<div class="kv-row"><dt>URL<\/dt><dd><a href="\.\/report\.html#main">https:\/\/example\.com\/a<\/a>/,
  );
});

test("renderSiteIndex handles all-null and non-finite scores using N/A without false zero or F grades", () => {
  const nullPage = /** @type {any} */ ({
    ...mkReport([mkFinding({ id: "T05-robots-disallow", severity: "P1" }, "technical")]),
    url: "https://example.com/null-page",
    finalUrl: "https://example.com/null-page",
    scores: { search: { score: null, band: "F" }, ai: { score: null, band: "F" } },
  });
  const nanPage = /** @type {any} */ ({
    ...mkReport([]),
    url: "https://example.com/nan-page",
    finalUrl: "https://example.com/nan-page",
    scores: { search: { score: Number.NaN, band: "F" }, ai: { score: Number.POSITIVE_INFINITY, band: "A" } },
  });

  const html = renderSiteIndex([nullPage, nanPage]);
  assert.match(html, /Average N\/A · lowest N\/A · highest N\/A \(0\/2 valid pages\)/);
  assert.match(html, /Search: 0\/2 &middot; AI: 0\/2/);
  assert.match(html, /N\/A — no valid page scores available\./);
  assert.ok(!html.includes("0/100"), "all-null site must not render 0/100");
  assert.ok(!html.includes("0 F"), "all-null site must not render 0 F");
  assert.ok(!html.includes("NaN"), "non-finite scores must not leak NaN");
  assert.ok(!html.includes("Infinity"), "non-finite scores must not leak Infinity");
});

test("renderSiteIndex preserves legitimate zero scores (0 F) and separates Search SEO and AI Visibility valid counts", () => {
  const realZeroPage = mkReport(
    [
      mkFinding({ id: "T01-https", severity: "P0" }, "technical"),
      mkFinding({ id: "T02-status", severity: "P0" }, "technical"),
      mkFinding({ id: "T07-noindex", severity: "P0" }, "technical"),
      mkFinding({ id: "O01-title-missing", severity: "P0" }, "onpage"),
    ],
    { search: 0, ai: 0 },
  );
  realZeroPage.scores = { search: { score: 0, band: "F" }, ai: { score: 0, band: "F" } };
  realZeroPage.url = "https://example.com/zero";
  realZeroPage.finalUrl = "https://example.com/zero";

  const partialPage = /** @type {any} */ ({
    ...mkReport([]),
    url: "https://example.com/partial",
    finalUrl: "https://example.com/partial",
    scores: { search: { score: 80, band: "B" }, ai: { score: null, band: "F" } },
  });

  const html = renderSiteIndex([realZeroPage, partialPage]);
  // Search has 2 valid pages (0 and 80 -> avg 40), AI has 1 valid page (0 -> avg 0)
  assert.match(html, /Average 40\/100 · lowest 0 · highest 80 \(2\/2 valid pages\)/);
  assert.match(html, /Average 0\/100 · lowest 0 · highest 0 \(1\/2 valid pages\)/);
  assert.match(html, /Search: 2\/2 &middot; AI: 1\/2/);
  // Real zero page preserves 0 F badge and data-s="0" data-a="0"
  assert.match(html, /data-s="0" data-a="0"/);
  assert.match(html, />0 F<\/span><\/td><td class="num"><span class="badge" style="--hue:0">0 F<\/span>/);
  // Partial page has valid Search (80 B) and N/A AI
  assert.match(html, /data-s="80" data-a=""/);
  assert.match(html, />80 B<\/span><\/td><td class="num"><span class="badge" style="--hue:215">N\/A<\/span>/);
  // Lowest-performing is realZeroPage, Highest-performing is partialPage
  assert.match(
    html,
    /Lowest-Performing Page<\/h3><dl class="kv-list">\s*<div class="kv-row"><dt>URL<\/dt><dd><a href="\.\/report\.html#main">https:\/\/example\.com\/zero<\/a>/,
  );
  assert.match(
    html,
    /Highest-Performing Page<\/h3><dl class="kv-list">\s*<div class="kv-row"><dt>URL<\/dt><dd><a href="\.\/report-2\.html#main">https:\/\/example\.com\/partial<\/a>/,
  );
});

test("renderHtml and renderMarkdown handle missing scores, zero scores, no findings, and many findings", () => {
  // Missing scores report
  const missingReport = /** @type {any} */ ({
    ...mkReport([]),
    scores: { search: { score: null, band: "N/A" }, ai: { score: undefined, band: "N/A" } },
  });
  const missingHtml = renderHtml(missingReport);
  const missingMd = renderMarkdown(missingReport);
  assert.match(missingHtml, /Search SEO N\/A \| AI Visibility N\/A/);
  assert.match(missingMd, /- Search SEO: \*\*N\/A\*\*\n- AI Visibility: \*\*N\/A\*\*/);
  assert.ok(!missingHtml.includes("null/100") && !missingMd.includes("null/100"));

  // Real zero score report
  const zeroReport = mkReport([mkFinding({ id: "T01-https", severity: "P0" })], { search: 0, ai: 0 });
  zeroReport.scores = { search: { score: 0, band: "F" }, ai: { score: 0, band: "F" } };
  const zeroHtml = renderHtml(zeroReport);
  assert.match(zeroHtml, /Search SEO 0\/100 \(F\) \| AI Visibility 0\/100 \(F\)/);

  // Many findings report (30 findings across categories and severities)
  const manyFindings = Array.from({ length: 30 }, (_, i) =>
    mkFinding(
      {
        id: `T${String(i % 15).padStart(2, "0")}-item-${i}`,
        severity: ["P0", "P1", "P2", "P3", "pass"][i % 5] ?? "P2",
      },
      ["technical", "onpage", "content", "schema", "geo", "performance"][i % 6],
    ),
  );
  const manyReport = mkReport(manyFindings, { search: 55, ai: 60 });
  const manyHtml = renderHtml(manyReport);
  assert.match(manyHtml, /<span>All findings<\/span><span class="n">24<\/span>/);
  assert.match(manyHtml, /@media print/);
  assert.match(manyHtml, /prefers-color-scheme:dark/);
});

test("isValidScore and isReport strictly reject NaN, Infinity, and out-of-range (<0 or >100) scores", () => {
  assert.equal(isValidScore(0), true);
  assert.equal(isValidScore(100), true);
  assert.equal(isValidScore(55.5), true);
  assert.equal(isValidScore(-0.1), false);
  assert.equal(isValidScore(100.1), false);
  assert.equal(isValidScore(NaN), false);
  assert.equal(isValidScore(Infinity), false);
  assert.equal(isValidScore(-Infinity), false);
  assert.equal(isValidScore(null), false);
  assert.equal(isValidScore(undefined), false);
  assert.equal(isValidScore("80"), false);

  for (const badScore of [NaN, Infinity, -Infinity, -1, 101, null, undefined, "90"]) {
    assert.equal(
      isReport({
        tool: "one-step-seo",
        scores: { search: { score: badScore }, ai: { score: 80 } },
        findings: [],
      }),
      false,
      `isReport must reject search.score=${String(badScore)}`,
    );
    assert.equal(
      isReport({
        tool: "one-step-seo",
        scores: { search: { score: 80 }, ai: { score: badScore } },
        findings: [],
      }),
      false,
      `isReport must reject ai.score=${String(badScore)}`,
    );
  }
});

test("renderSiteIndex selects correct Highest/Lowest-Performing Page across mixed Search/AI unavailable scores and ties", () => {
  // Page 1: Search unavailable (null), AI valid (40) -> sits at end of `ordered` table, MUST NOT be selected as Highest-Performing Page!
  const pSearchNullAiValid = /** @type {any} */ ({
    ...mkReport([]),
    url: "https://example.com/search-null-ai-40",
    finalUrl: "https://example.com/search-null-ai-40",
    scores: { search: { score: null, band: "N/A" }, ai: { score: 40, band: "D" } },
  });
  // Page 2: Highest Search (95) and valid AI (90) -> MUST be selected as Highest-Performing Page
  const pBestBoth = mkReport([], { search: 95, ai: 90 });
  pBestBoth.url = "https://example.com/best-both";
  pBestBoth.finalUrl = "https://example.com/best-both";
  // Page 3: Tied on Highest Search (95), but AI is unavailable (null) -> MUST lose tie-break to pBestBoth for Highest-Performing Page
  const pBestSearchNullAi = /** @type {any} */ ({
    ...mkReport([]),
    url: "https://example.com/best-search-null-ai",
    finalUrl: "https://example.com/best-search-null-ai",
    scores: { search: { score: 95, band: "A" }, ai: { score: null, band: "N/A" } },
  });
  // Page 4: Lowest Search (25) and valid AI (30) -> MUST be selected as Lowest-Performing Page
  const pWorst = mkReport([mkFinding({ id: "T01-https", severity: "P0" })], { search: 25, ai: 30 });
  pWorst.scores = { search: { score: 25, band: "F" }, ai: { score: 30, band: "F" } };
  pWorst.url = "https://example.com/worst";
  pWorst.finalUrl = "https://example.com/worst";

  const html = renderSiteIndex([pSearchNullAiValid, pBestBoth, pBestSearchNullAi, pWorst]);

  // Verify Lowest-Performing Page is pWorst (https://example.com/worst)
  assert.match(
    html,
    /Lowest-Performing Page<\/h3><dl class="kv-list">\s*<div class="kv-row"><dt>URL<\/dt><dd><a href="\.\/report-4\.html#main">https:\/\/example\.com\/worst<\/a><\/dd><\/div>\s*<div class="kv-row"><dt>Search SEO<\/dt><dd>25\/100 \(F\)<\/dd><\/div>\s*<div class="kv-row"><dt>AI Visibility<\/dt><dd>30\/100 \(F\)<\/dd><\/div>/,
  );

  // Verify Highest-Performing Page is pBestBoth (https://example.com/best-both), NOT pSearchNullAiValid or pBestSearchNullAi
  assert.match(
    html,
    /Highest-Performing Page<\/h3><dl class="kv-list">\s*<div class="kv-row"><dt>URL<\/dt><dd><a href="\.\/report-2\.html#main">https:\/\/example\.com\/best-both<\/a><\/dd><\/div>\s*<div class="kv-row"><dt>Search SEO<\/dt><dd>95\/100 \(A\)<\/dd><\/div>\s*<div class="kv-row"><dt>AI Visibility<\/dt><dd>90\/100 \(A\)<\/dd><\/div>/,
  );

  // Verify initial table ordering: worst (report-4) -> best-both (report-2) -> best-search-null-ai (report-3) -> search-null-ai-40 (report)
  const tbody = html.split("<tbody>")[1]?.split("</tbody>")[0] ?? "";
  const idxWorst = tbody.indexOf('href="./report-4.html"');
  const idxBestBoth = tbody.indexOf('href="./report-2.html"');
  const idxBestNullAi = tbody.indexOf('href="./report-3.html"');
  const idxSearchNull = tbody.indexOf('href="./report.html"');
  assert.ok(idxWorst >= 0 && idxBestBoth > idxWorst, "worst comes before best-both");
  assert.ok(idxBestNullAi > idxBestBoth, "valid AI tie-break comes before null AI");
  assert.ok(idxSearchNull > idxBestNullAi, "unavailable Search score row sits at the bottom");
});

test("renderSiteIndex handles one valid page among many unavailable pages and AI-only fallback ranking", () => {
  const mkUnavailable = (/** @type {number} */ n, /** @type {any} */ badVal) =>
    /** @type {any} */ ({
      ...mkReport([]),
      url: `https://example.com/unavail-${n}`,
      finalUrl: `https://example.com/unavail-${n}`,
      scores: { search: { score: badVal, band: "F" }, ai: { score: badVal, band: "F" } },
    });
  const soleValid = mkReport([], { search: 72, ai: 64 });
  soleValid.url = "https://example.com/only-valid";
  soleValid.finalUrl = "https://example.com/only-valid";

  const pages = [
    mkUnavailable(1, null),
    mkUnavailable(2, undefined),
    mkUnavailable(3, NaN),
    soleValid,
    mkUnavailable(5, Infinity),
    mkUnavailable(6, -10),
    mkUnavailable(7, 150),
  ];
  const html = renderSiteIndex(pages);
  assert.match(html, /Average 72\/100 · lowest 72 · highest 72 \(1\/7 valid pages\)/);
  assert.match(html, /Average 64\/100 · lowest 64 · highest 64 \(1\/7 valid pages\)/);
  assert.match(html, /Search: 1\/7 &middot; AI: 1\/7/);
  assert.match(
    html,
    /Lowest-Performing Page<\/h3><dl class="kv-list">\s*<div class="kv-row"><dt>URL<\/dt><dd><a href="\.\/report-4\.html#main">https:\/\/example\.com\/only-valid<\/a>/,
  );
  assert.match(
    html,
    /Highest-Performing Page<\/h3><dl class="kv-list">\s*<div class="kv-row"><dt>URL<\/dt><dd><a href="\.\/report-4\.html#main">https:\/\/example\.com\/only-valid<\/a>/,
  );

  // Fallback ranking when all Search scores are unavailable but AI scores are valid on 2 pages
  const aiLow = /** @type {any} */ ({
    ...mkReport([]),
    url: "https://example.com/ai-low",
    finalUrl: "https://example.com/ai-low",
    scores: { search: { score: null, band: "N/A" }, ai: { score: 35, band: "F" } },
  });
  const aiHigh = /** @type {any} */ ({
    ...mkReport([]),
    url: "https://example.com/ai-high",
    finalUrl: "https://example.com/ai-high",
    scores: { search: { score: null, band: "N/A" }, ai: { score: 88, band: "B" } },
  });
  const aiHtml = renderSiteIndex([mkUnavailable(1, null), aiHigh, aiLow]);
  assert.match(aiHtml, /Average N\/A · lowest N\/A · highest N\/A \(0\/3 valid pages\)/);
  assert.match(aiHtml, /Average 62\/100 · lowest 35 · highest 88 \(2\/3 valid pages\)/);
  assert.match(
    aiHtml,
    /Lowest-Performing Page<\/h3><dl class="kv-list">\s*<div class="kv-row"><dt>URL<\/dt><dd><a href="\.\/report-3\.html#main">https:\/\/example\.com\/ai-low<\/a>/,
  );
  assert.match(
    aiHtml,
    /Highest-Performing Page<\/h3><dl class="kv-list">\s*<div class="kv-row"><dt>URL<\/dt><dd><a href="\.\/report-2\.html#main">https:\/\/example\.com\/ai-high<\/a>/,
  );
});

test("renderSiteIndex client-side table sorting handles valid, zero, and unavailable scores in both directions", () => {
  const pZero = mkReport([], { search: 0, ai: 50 });
  pZero.scores = { search: { score: 0, band: "F" }, ai: { score: 50, band: "D" } };
  pZero.url = "https://example.com/b-zero";
  pZero.finalUrl = "https://example.com/b-zero";

  const pHigh = mkReport([], { search: 90, ai: 20 });
  pHigh.url = "https://example.com/a-high";
  pHigh.finalUrl = "https://example.com/a-high";

  const pMissing = /** @type {any} */ ({
    ...mkReport([]),
    url: "https://example.com/c-missing",
    finalUrl: "https://example.com/c-missing",
    scores: { search: { score: null, band: "N/A" }, ai: { score: null, band: "N/A" } },
  });

  const html = renderSiteIndex([pHigh, pMissing, pZero]);
  const scriptMatch = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(scriptMatch, "renderSiteIndex must include inline script");

  // Build minimal DOM harness to execute the exact inline script from renderSiteIndex
  /** @param {string} tag @param {Record<string, string>} attrs */
  const makeEl = (tag, attrs = {}) => {
    /** @type {Record<string, Function[]>} */
    const listeners = {};
    /** @type {any} */
    const el = {
      tagName: tag.toUpperCase(),
      attributes: { ...attrs },
      children: /** @type {any[]} */ ([]),
      hidden: false,
      textContent: "",
      value: "",
      style: {},
      getAttribute(/** @type {string} */ k) {
        return k in this.attributes ? this.attributes[k] : null;
      },
      setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
        this.attributes[k] = String(v);
      },
      addEventListener(/** @type {string} */ ev, /** @type {Function} */ fn) {
        (listeners[ev] ??= []).push(fn);
      },
      dispatch(/** @type {string} */ ev, /** @type {any} */ eventObj = {}) {
        for (const fn of listeners[ev] ?? []) fn(eventObj);
      },
      appendChild(/** @type {any} */ child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) this.children.splice(idx, 1);
        this.children.push(child);
      },
      closest() {
        return tableEl;
      },
      querySelector(/** @type {string} */ sel) {
        if (sel === "tbody") return tbodyEl;
        return null;
      },
      focus() {},
      select() {},
      blur() {},
    };
    return el;
  };

  const tbodyEl = makeEl("tbody");
  const tableEl = makeEl("table");
  const thUrl = makeEl("th", { "data-sort": "url", "aria-sort": "none" });
  const thS = makeEl("th", { "data-sort": "s", "aria-sort": "ascending" });
  const thA = makeEl("th", { "data-sort": "a", "aria-sort": "none" });
  const thP0 = makeEl("th", { "data-sort": "p0", "aria-sort": "none" });
  const thP1 = makeEl("th", { "data-sort": "p1", "aria-sort": "none" });
  const thP2 = makeEl("th", { "data-sort": "p2", "aria-sort": "none" });
  const thP3 = makeEl("th", { "data-sort": "p3", "aria-sort": "none" });
  const ths = [thUrl, thS, thA, thP0, thP1, thP2, thP3];

  // Initial rows in worst-first order: pZero (s=0, a=50), pHigh (s=90, a=20), pMissing (s="", a="")
  const rowZero = makeEl("tr", {
    "data-search": "https://example.com/b-zero",
    "data-s": "0",
    "data-a": "50",
    "data-p0": "3",
    "data-p1": "1",
    "data-p2": "2",
    "data-p3": "0",
  });
  const rowHigh = makeEl("tr", {
    "data-search": "https://example.com/a-high",
    "data-s": "90",
    "data-a": "20",
    "data-p0": "0",
    "data-p1": "4",
    "data-p2": "0",
    "data-p3": "5",
  });
  const rowMissing = makeEl("tr", {
    "data-search": "https://example.com/c-missing",
    "data-s": "",
    "data-a": "",
    "data-p0": "1",
    "data-p1": "2",
    "data-p2": "1",
    "data-p3": "3",
  });
  tbodyEl.children = [rowZero, rowHigh, rowMissing];

  const sqEl = makeEl("input");
  const pCountEl = makeEl("span");
  const ttEl = makeEl("button");
  const metaCsEl = { content: "light dark" };
  const docStub = {
    activeElement: null,
    getElementById(/** @type {string} */ id) {
      if (id === "site-q") return sqEl;
      if (id === "pages-count") return pCountEl;
      if (id === "theme-toggle") return ttEl;
      return null;
    },
    querySelector(/** @type {string} */ sel) {
      if (sel === 'meta[name="color-scheme"]') return metaCsEl;
      return null;
    },
    querySelectorAll(/** @type {string} */ sel) {
      if (sel === ".site-chip") return [];
      if (sel === "table.pages tbody tr") return tbodyEl.children;
      if (sel === "table.pages thead th[data-sort]") return ths;
      return [];
    },
    addEventListener() {},
  };

  const fn = new Function("document", "localStorage", scriptMatch[1] ?? "");
  fn(docStub, { getItem: () => null, setItem: () => {}, removeItem: () => {} });

  // 1. Clicking Search (already aria-sort="ascending") sorts descending: 90, 0, then missing ("") at bottom
  thS.dispatch("click");
  assert.equal(thS.getAttribute("aria-sort"), "descending");
  assert.deepEqual(
    tbodyEl.children.map((/** @type {any} */ r) => r.getAttribute("data-s")),
    ["90", "0", ""],
    "descending Search sort keeps N/A row at the bottom and 0 before N/A",
  );

  // 2. Clicking AI (aria-sort="none") sorts ascending on first click: 20, 50, then missing ("") at bottom
  thA.dispatch("click");
  assert.equal(thA.getAttribute("aria-sort"), "ascending");
  assert.equal(thS.getAttribute("aria-sort"), "none");
  assert.deepEqual(
    tbodyEl.children.map((/** @type {any} */ r) => r.getAttribute("data-a")),
    ["20", "50", ""],
    "first click on AI column sorts ascending with N/A at the bottom",
  );

  // 3. Keyboard Enter on AI flips to descending: 50, 20, then missing ("") at bottom
  let prevented = false;
  thA.dispatch("keydown", {
    key: "Enter",
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(thA.getAttribute("aria-sort"), "descending");
  assert.deepEqual(
    tbodyEl.children.map((/** @type {any} */ r) => r.getAttribute("data-a")),
    ["50", "20", ""],
    "Enter key sorts AI descending with N/A at the bottom",
  );

  // 4. Keyboard Space on URL column prevents scroll on keydown and sorts ascending on keyup
  let spacePrevented = false;
  thUrl.dispatch("keydown", {
    key: " ",
    preventDefault() {
      spacePrevented = true;
    },
  });
  assert.equal(spacePrevented, true);
  thUrl.dispatch("keyup", { key: " " });
  assert.equal(thUrl.getAttribute("aria-sort"), "ascending");
  assert.deepEqual(
    tbodyEl.children.map((/** @type {any} */ r) => r.getAttribute("data-search")),
    ["https://example.com/a-high", "https://example.com/b-zero", "https://example.com/c-missing"],
  );
  // Second click on URL sorts descending
  thUrl.dispatch("click");
  assert.equal(thUrl.getAttribute("aria-sort"), "descending");
  assert.deepEqual(
    tbodyEl.children.map((/** @type {any} */ r) => r.getAttribute("data-search")),
    ["https://example.com/c-missing", "https://example.com/b-zero", "https://example.com/a-high"],
  );

  //Click Search again to verify ascending sort (0, 90, "")
  thS.dispatch("click");
  assert.equal(thS.getAttribute("aria-sort"), "ascending");
  assert.deepEqual(
    tbodyEl.children.map((/** @type {any} */ r) => r.getAttribute("data-s")),
    ["0", "90", ""],
  );

  // 5. Sort by P0, P1, P2, P3 columns in both ascending and descending directions
  for (const [thCol, colKey, ascExpected, descExpected] of /** @type {const} */ ([
    [thP0, "p0", ["0", "1", "3"], ["3", "1", "0"]],
    [thP1, "p1", ["1", "2", "4"], ["4", "2", "1"]],
    [thP2, "p2", ["0", "1", "2"], ["2", "1", "0"]],
    [thP3, "p3", ["0", "3", "5"], ["5", "3", "0"]],
  ])) {
    thCol.dispatch("click");
    assert.equal(thCol.getAttribute("aria-sort"), "ascending");
    assert.deepEqual(
      tbodyEl.children.map((/** @type {any} */ r) => r.getAttribute(`data-${colKey}`)),
      ascExpected,
      `${colKey} ascending sort`,
    );
    thCol.dispatch("click");
    assert.equal(thCol.getAttribute("aria-sort"), "descending");
    assert.deepEqual(
      tbodyEl.children.map((/** @type {any} */ r) => r.getAttribute(`data-${colKey}`)),
      descExpected,
      `${colKey} descending sort`,
    );
  }
});

test("renderSiteIndex handles Search-only valid scores and equal Search scores with different AI scores", () => {
  // 1. Only Search scores valid (all AI scores missing)
  const sOnlyLow = /** @type {any} */ ({
    ...mkReport([]),
    url: "https://example.com/s-low",
    finalUrl: "https://example.com/s-low",
    scores: { search: { score: 40, band: "D" }, ai: { score: null, band: "N/A" } },
  });
  const sOnlyHigh = /** @type {any} */ ({
    ...mkReport([]),
    url: "https://example.com/s-high",
    finalUrl: "https://example.com/s-high",
    scores: { search: { score: 90, band: "A" }, ai: { score: undefined, band: "N/A" } },
  });
  const sOnlyHtml = renderSiteIndex([sOnlyHigh, sOnlyLow]);
  assert.match(sOnlyHtml, /Average 65\/100 · lowest 40 · highest 90 \(2\/2 valid pages\)/);
  assert.match(sOnlyHtml, /Average N\/A · lowest N\/A · highest N\/A \(0\/2 valid pages\)/);
  assert.match(
    sOnlyHtml,
    /Lowest-Performing Page<\/h3><dl class="kv-list">\s*<div class="kv-row"><dt>URL<\/dt><dd><a href="\.\/report-2\.html#main">https:\/\/example\.com\/s-low<\/a>/,
  );
  assert.match(
    sOnlyHtml,
    /Highest-Performing Page<\/h3><dl class="kv-list">\s*<div class="kv-row"><dt>URL<\/dt><dd><a href="\.\/report\.html#main">https:\/\/example\.com\/s-high<\/a>/,
  );

  // 2. Equal Search scores (80) with different AI scores (50, 90, null)
  const eqSearchAi50 = mkReport([], { search: 80, ai: 50 });
  eqSearchAi50.scores = { search: { score: 80, band: "B" }, ai: { score: 50, band: "D" } };
  eqSearchAi50.url = "https://example.com/eq-ai-50";
  eqSearchAi50.finalUrl = "https://example.com/eq-ai-50";

  const eqSearchAi90 = mkReport([], { search: 80, ai: 90 });
  eqSearchAi90.scores = { search: { score: 80, band: "B" }, ai: { score: 90, band: "A" } };
  eqSearchAi90.url = "https://example.com/eq-ai-90";
  eqSearchAi90.finalUrl = "https://example.com/eq-ai-90";

  const eqSearchAiNull = /** @type {any} */ ({
    ...mkReport([]),
    url: "https://example.com/eq-ai-null",
    finalUrl: "https://example.com/eq-ai-null",
    scores: { search: { score: 80, band: "B" }, ai: { score: null, band: "N/A" } },
  });

  const eqHtml = renderSiteIndex([eqSearchAiNull, eqSearchAi90, eqSearchAi50]);
  // Lowest-Performing Page breaks Search tie with lowest valid AI score (50 -> report-3)
  assert.match(
    eqHtml,
    /Lowest-Performing Page<\/h3><dl class="kv-list">\s*<div class="kv-row"><dt>URL<\/dt><dd><a href="\.\/report-3\.html#main">https:\/\/example\.com\/eq-ai-50<\/a>/,
  );
  // Highest-Performing Page breaks Search tie with highest valid AI score (90 -> report-2), never null!
  assert.match(
    eqHtml,
    /Highest-Performing Page<\/h3><dl class="kv-list">\s*<div class="kv-row"><dt>URL<\/dt><dd><a href="\.\/report-2\.html#main">https:\/\/example\.com\/eq-ai-90<\/a>/,
  );
});

test("verdictFor and renderMarkdown/renderHtml handle partial and unavailable scores accurately", () => {
  // Both scores unavailable + 0 findings -> must NOT claim "Excellent"
  const bothUnavail = /** @type {any} */ ({
    ...mkReport([]),
    scores: { search: { score: null, band: "N/A" }, ai: { score: NaN, band: "N/A" } },
  });
  assert.equal(
    verdictFor(bothUnavail),
    "Scores unavailable (N/A) — no actionable issues recorded. Re-audit to compute scores.",
  );

  // Search unavailable, AI valid (85) + 0 findings
  const searchUnavail = /** @type {any} */ ({
    ...mkReport([]),
    scores: { search: { score: undefined, band: "N/A" }, ai: { score: 85, band: "B" } },
  });
  assert.equal(
    verdictFor(searchUnavail),
    "Partial scores available (Search SEO is N/A) — no actionable issues found.",
  );
  assert.match(
    renderMarkdown(searchUnavail),
    /- Search SEO: \*\*N\/A\*\*\n- AI Visibility: \*\*85\/100 \(B\)\*\*/,
  );
  assert.match(renderHtml(searchUnavail), /Search SEO N\/A \| AI Visibility 85\/100 \(B\)/);

  // Search valid (90), AI unavailable (Infinity) + 0 findings
  const aiUnavail = /** @type {any} */ ({
    ...mkReport([]),
    scores: { search: { score: 90, band: "A" }, ai: { score: Infinity, band: "N/A" } },
  });
  assert.equal(
    verdictFor(aiUnavail),
    "Partial scores available (AI Visibility is N/A) — no actionable issues found.",
  );
  assert.match(
    renderMarkdown(aiUnavail),
    /- Search SEO: \*\*90\/100 \(A\)\*\*\n- AI Visibility: \*\*N\/A\*\*/,
  );
  assert.match(renderHtml(aiUnavail), /Search SEO 90\/100 \(A\) \| AI Visibility N\/A/);

  // Search unavailable, AI < 60 (45) -> triggers low score verdict for AI Visibility
  const aiLowSearchUnavail = /** @type {any} */ ({
    ...mkReport([]),
    scores: { search: { score: null, band: "N/A" }, ai: { score: 45, band: "D" } },
  });
  assert.match(verdictFor(aiLowSearchUnavail), /Below par: AI Visibility is under 60/);

  // P0, P1, and P2 findings with missing scores still prioritize actionable findings
  const p0Missing = /** @type {any} */ ({
    ...mkReport([mkFinding({ id: "T01-https", severity: "P0" })]),
    scores: { search: { score: null, band: "N/A" }, ai: { score: null, band: "N/A" } },
  });
  assert.match(verdictFor(p0Missing), /Needs urgent attention: 1 critical \(P0\) issue/);

  const p1Missing = /** @type {any} */ ({
    ...mkReport([mkFinding({ id: "O02-meta-missing", severity: "P1" })]),
    scores: { search: { score: null, band: "N/A" }, ai: { score: null, band: "N/A" } },
  });
  assert.match(verdictFor(p1Missing), /Solid foundation with 1 high-priority fix/);

  const p2Missing = /** @type {any} */ ({
    ...mkReport([mkFinding({ id: "O06-og", severity: "P2" })]),
    scores: { search: { score: null, band: "N/A" }, ai: { score: null, band: "N/A" } },
  });
  assert.match(verdictFor(p2Missing), /In good shape — 1 medium-priority improvement/);

  // Both scores valid (95, 90) and 0 findings -> Excellent
  const bothValid = mkReport([], { search: 95, ai: 90 });
  assert.equal(verdictFor(bothValid), "Excellent — no actionable issues found. Re-audit after site changes.");
});

test("parseHtml ignores HTML comments, script/style bodies, and supports boolean attributes and > in quotes", () => {
  const html = `<!doctype html>
  <html lang="en">
  <head>
    <!-- <meta name="robots" content="noindex"> -->
    <!-- <link rel="canonical" href="https://evil.example.com/"> -->
    <title>Valid Page Title With Optimal Length Here</title>
    <meta name="description" content="A > B comparison description with more than one hundred and twenty characters so it passes the meta description length check cleanly.">
    <link rel="canonical" href="https://example.com/page">
    <script>const tpl = "<h1>Fake Heading In Script</h1><img src='fake.jpg'>";</script>
  </head>
  <body>
    <!-- <h1>Commented Out Heading</h1> <img src="commented.jpg"> <a href="https://commented.example.com">link</a> -->
    <main>
      <h1>Valid Page Title With Optimal Length Here</h1>
      <img src="/decorative.svg" alt width="40" height="40">
      <img src="/diagram.png" alt="A > B Diagram" width="200" height="100">
      <a href="javascript:void(0)">JS Link</a>
      <a href="data:text/plain,hello">Data Link</a>
      <a href="/internal-page">Internal Link</a>
    </main>
    <script type="application/ld+json">
      {"@context":["https://schema.org",{"@language":"en"}],"@graph":[{"@type":["WebPage","FAQPage"],"mainEntity":[{"@type":"Question","name":"What is A > B?","acceptedAnswer":{"@type":"Answer","text":"A is greater than B."}}]}]}
    </script>
  </body>
  </html>`;
  const parsed = parseHtml(html, "file:///D:/site/index.html");
  assert.equal(parsed.robotsMeta, "");
  assert.equal(parsed.h1s.length, 1);
  assert.equal(parsed.h1s[0]?.text, "Valid Page Title With Optimal Length Here");
  assert.equal(parsed.images.length, 2);
  assert.equal(parsed.imagesWithoutAlt, 0);
  assert.equal(parsed.imagesWithoutDimensions, 0);
  assert.equal(parsed.images[1]?.alt, "A > B Diagram");
  assert.equal(parsed.internalLinks.length, 1);
  assert.ok(
    !parsed.internalLinks.some(
      (/** @type {string} */ u) => u.startsWith("javascript:") || u.startsWith("data:"),
    ),
  );
  assert.equal(parsed.hasFaqMarkup, true);

  const extracted = extractJsonLd(parsed.jsonLdBlocks);
  assert.equal(extracted.errors.length, 0);
  assert.equal(extracted.items.length, 1);
  const validated = validateSchema(extracted.items);
  assert.equal(validated.issues.length, 0);
});
