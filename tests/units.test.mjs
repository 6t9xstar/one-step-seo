/**
 * Unit coverage for the defensive / normalisation paths in score.mjs and
 * report.mjs. These are the `??`/`||` fallbacks and clamps that only fire on
 * malformed input, so they are invisible to the happy-path suites but are
 * exactly where a crash would cost the user a whole report.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { geoDetails, computeScores, GEO_WEIGHTS, GEO_ONLY_IDS, SEARCH_WEIGHTS } from "../lib/score.mjs";
import {
  esc,
  escTruncate,
  escMd,
  buildReport,
  renderMarkdown,
  renderHtml,
  verdictFor,
  topFixes,
  citableChecklist,
  groupByCategory,
  monitorItems,
} from "../lib/report.mjs";

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
  assert.equal(esc("&<>\"'"), "&amp;&lt;&gt;&quot;'");
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
  assert.match(verdictFor(mkReport([mkFinding({ id: "x", severity: "P1" })])), /Solid foundation/);
  assert.match(verdictFor(mkReport([mkFinding({ id: "x", severity: "P2" })])), /good shape/);
  assert.match(verdictFor(mkReport([mkFinding({ id: "x", severity: "pass" })])), /Excellent/);
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
