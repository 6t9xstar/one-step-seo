import { test } from "node:test";
import assert from "node:assert/strict";
import { planFixes, FIXERS, FIXER_NAMES } from "../lib/fix.mjs";
import { parseHtml } from "../lib/html.mjs";
import { unifiedDiff } from "../lib/diff.mjs";

const LONG_TEXT =
  "What is this? This page provides a sufficiently long stream of visible text so that the description " +
  "fixer can derive a real meta description from the words already present on the page itself.";

const HEALTHY_HEAD = [
  `<meta charset="utf-8">`,
  `<meta name="viewport" content="width=device-width, initial-scale=1">`,
  `<title>A perfectly reasonable test page title</title>`,
  `<meta name="description" content="A well over one hundred and twenty character meta description fixture used to keep the description fixer quiet in healthy documents.">`,
  `<link rel="canonical" href="https://example.com/">`,
  `<link rel="icon" href="/favicon.ico">`,
  `<meta property="og:title" content="A perfectly reasonable test page title">`,
  `<meta property="og:description" content="A well over one hundred and twenty character meta description fixture used to keep the description fixer quiet in healthy documents.">`,
  `<meta property="og:image" content="https://example.com/og.png">`,
  `<meta property="og:url" content="https://example.com/">`,
  `<meta name="twitter:card" content="summary_large_image">`,
].join("\n");

const DEFAULT_BODY = `<h1>Home</h1>\n<p>${LONG_TEXT}</p>`;

/**
 * @param {{ htmlAttrs?: string, head?: string, body?: string }} [opts]
 */
function doc(opts = {}) {
  const htmlAttrs = opts.htmlAttrs !== undefined ? opts.htmlAttrs : 'lang="en"';
  const head = opts.head !== undefined ? opts.head : HEALTHY_HEAD;
  const body = opts.body !== undefined ? opts.body : DEFAULT_BODY;
  return `<!doctype html>\n<html${htmlAttrs ? ` ${htmlAttrs}` : ""}>\n<head>\n${head ? `${head}\n` : ""}</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

// ---------- registry integrity ----------

test("fix: registry names match FIXER_NAMES and follow schema pattern", () => {
  assert.deepEqual(
    FIXERS.map((f) => f.name),
    FIXER_NAMES,
  );
  for (const f of FIXERS) {
    assert.match(f.findingId, /^[A-Z]+[0-9]+-[a-z0-9-]+$/, `bad findingId ${f.findingId}`);
    assert.equal(typeof f.decide, "function");
  }
});

// ---------- healthy documents are never touched ----------

test("fix: healthy document gets no plan and stays byte-identical", () => {
  const html = doc();
  const plan = planFixes(html, { url: "https://example.com/" });
  assert.equal(plan.error, undefined);
  assert.equal(plan.planned.length, 0, JSON.stringify(plan.planned));
  assert.equal(plan.skipped.length, 0, JSON.stringify(plan.skipped));
  assert.equal(plan.changed, false);
  assert.equal(plan.newHtml, html);
});

test("fix: idempotent — applying a plan then re-planning yields zero fixes", () => {
  const html = doc({ htmlAttrs: "", head: `<title>Fixture page title long enough for tests</title>` });
  const first = planFixes(html, {
    url: "https://example.com/",
    lang: "en",
    ogImage: "https://example.com/og.png",
  });
  assert.ok(first.planned.length > 0, "expected fixes for the stripped document");
  const second = planFixes(first.newHtml, {
    url: "https://example.com/",
    lang: "en",
    ogImage: "https://example.com/og.png",
  });
  assert.equal(second.planned.length, 0, JSON.stringify(second.planned));
  assert.equal(second.changed, false);
});

// ---------- individual fixers ----------

test("fix: charset + viewport inserted first/last in <head> and verified", () => {
  const html = doc({ head: `<title>Fixture page title long enough for tests</title>` });
  const plan = planFixes(html);
  const names = plan.planned.map((p) => p.name);
  assert.ok(names.includes("charset"));
  assert.ok(names.includes("viewport"));
  const parsed = parseHtml(plan.newHtml, "https://example.com/");
  assert.match(parsed.charset, /utf-?8/i);
  assert.match(parsed.viewport, /width=device-width/);
  // charset must be the first element inside <head>
  const inner = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(plan.newHtml)?.[1] ?? "";
  assert.match(inner.trimStart(), /^<meta charset="utf-8">/);
  // og is planned partial here (no --og-image) — only assert the clearables.
  for (const name of ["charset", "viewport", "description", "twitter-card", "favicon"]) {
    assert.equal(plan.verified.find((v) => v.name === name)?.cleared, true, `${name} not verified`);
  }
  assert.equal(plan.verified.find((v) => v.name === "og")?.cleared, false, "og partial stays uncleared");
});

test("fix: charset present but non-UTF8 is refused, never rewritten", () => {
  const html = doc({
    head: HEALTHY_HEAD.replace(`<meta charset="utf-8">`, `<meta charset="iso-8859-1">`),
  });
  const plan = planFixes(html);
  assert.equal(plan.planned.length, 0);
  const cs = plan.skipped.find((s) => s.name === "charset");
  assert.ok(cs, "charset should be reported as skipped");
  assert.match(cs.reason, /rewriting document encoding is unsafe/);
  assert.equal(plan.changed, false);
});

test("fix: lang requires --lang, applies on <html>, verified", () => {
  const html = doc({ htmlAttrs: "" });
  const skipped = planFixes(html);
  const entry = skipped.skipped.find((s) => s.name === "lang");
  assert.ok(entry && /--lang/.test(entry.reason), "expected a --lang skip reason");
  assert.equal(skipped.changed, false);

  const fixed = planFixes(html, { lang: "en" });
  assert.ok(fixed.planned.some((p) => p.name === "lang"));
  assert.match(fixed.newHtml, /<html lang="en">/);
  assert.equal(parseHtml(fixed.newHtml, "https://example.com/").lang, "en");
});

test("fix: title derived from <h1>, flag wins, escape is applied", () => {
  const base = { htmlAttrs: 'lang="en"', head: "" };
  const withH1 = doc({ ...base, body: `<h1>Q&A Pricing Overview</h1><p>${LONG_TEXT}</p>` });
  const derived = planFixes(withH1);
  const t = derived.planned.find((p) => p.name === "title");
  assert.ok(t, "expected title plan");
  assert.match(derived.newHtml, /<title>Q&amp;A Pricing Overview<\/title>/);
  assert.match(t.summary, /derived from <h1>/);

  const flagged = planFixes(withH1, { title: "Custom Title | Acme" });
  assert.match(flagged.newHtml, /<title>Custom Title \| Acme<\/title>/);

  const noSource = doc({ ...base, body: `<p>${LONG_TEXT}</p>` });
  const plan = planFixes(noSource);
  const entry = plan.skipped.find((s) => s.name === "title");
  assert.ok(entry && /--title/.test(entry.reason), "expected a --title skip reason");
});

test("fix: description derived from page text lands in threshold range", () => {
  const html = doc({ head: `<title>Fixture page title long enough for tests</title>` });
  const plan = planFixes(html);
  const d = plan.planned.find((p) => p.name === "description");
  assert.ok(d, "expected description plan");
  const parsed = parseHtml(plan.newHtml, "https://example.com/");
  assert.ok(parsed.metaDescriptionLength >= 120, `too short: ${parsed.metaDescriptionLength}`);
  assert.ok(parsed.metaDescriptionLength <= 155, `too long: ${parsed.metaDescriptionLength}`);

  const flagged = planFixes(html, {
    description:
      "Flagged description that is definitely long enough to satisfy the checker threshold for meta descriptions.",
  });
  assert.match(flagged.newHtml, /content="Flagged description/);

  const barren = doc({
    htmlAttrs: 'lang="en"',
    head: `<title>Fixture page title long enough for tests</title>`,
    body: `<p>tiny</p>`,
  });
  const entry = planFixes(barren).skipped.find((s) => s.name === "description");
  assert.ok(entry && /--description/.test(entry.reason), "expected a --description skip reason");
});

test("fix: canonical requires --url, inserted when provided", () => {
  const html = doc({ head: `<title>Fixture page title long enough for tests</title>` });
  const entry = planFixes(html).skipped.find((s) => s.name === "canonical");
  assert.ok(entry && /--url/.test(entry.reason));

  const plan = planFixes(html, { url: "https://example.com/pricing" });
  assert.ok(plan.planned.some((p) => p.name === "canonical"));
  assert.match(plan.newHtml, /<link rel="canonical" href="https:\/\/example\.com\/pricing">/);
  const verified = plan.verified.find((v) => v.name === "canonical");
  assert.equal(verified?.cleared, true);
});

test("fix: og filled from title/meta + --og-image; partial without it", () => {
  const html = doc({
    htmlAttrs: 'lang="en"',
    head: `<title>Fixture page title long enough for tests</title>\n<meta name="description" content="A well over one hundred and twenty character meta description fixture used to keep the description fixer quiet in healthy documents.">`,
  });
  const partial = planFixes(html);
  const og = partial.planned.find((p) => p.name === "og");
  assert.ok(og, "expected og plan");
  assert.equal(og.partial, true, "og without image must be marked partial");
  const afterPartial = parseHtml(partial.newHtml, "https://example.com/");
  assert.ok(afterPartial.og.title && afterPartial.og.description);
  assert.equal(afterPartial.og.image, "");
  assert.equal(partial.verified.find((v) => v.name === "og")?.cleared, false);

  const full = planFixes(html, { ogImage: "https://example.com/hero.png" });
  const after = parseHtml(full.newHtml, "https://example.com/");
  assert.ok(after.og.image.endsWith("/hero.png"));
  assert.equal(full.verified.find((v) => v.name === "og")?.cleared, true);
});

test("fix: og fully present is healthy; nothing fillable is skipped", () => {
  const healthy = planFixes(doc(), { url: "https://example.com/" });
  assert.ok(!healthy.planned.some((p) => p.name === "og"));
  assert.ok(!healthy.skipped.some((s) => s.name === "og"));

  const html = doc({
    head: HEALTHY_HEAD.replace(`<meta property="og:image" content="https://example.com/og.png">`, ``),
  });
  const entry = planFixes(html).skipped.find((s) => s.name === "og");
  assert.ok(entry && /--og-image/.test(entry.reason), "expected an --og-image skip reason");
});

test("fix: og:url mismatch replaced only with --url; absent og:url untouched", () => {
  const html = doc({
    head: HEALTHY_HEAD.replace(`content="https://example.com/"`, `content="https://old.example.com/wrong"`),
  });
  // The replace above also hits canonical — restore canonical to keep the
  // fixture focused on og:url only.
  const focused = html.replace(
    `<link rel="canonical" href="https://old.example.com/wrong">`,
    `<link rel="canonical" href="https://example.com/">`,
  );
  const entry = planFixes(focused).skipped.find((s) => s.name === "og-url");
  assert.ok(entry && /--url/.test(entry.reason), "expected an --url skip reason");

  const plan = planFixes(focused, { url: "https://example.com/new" });
  assert.ok(plan.planned.some((p) => p.name === "og-url"));
  assert.equal(parseHtml(plan.newHtml, "https://example.com/").og.url, "https://example.com/new");
  assert.equal(plan.verified.find((v) => v.name === "og-url")?.cleared, true);

  const absent = doc({
    head: HEALTHY_HEAD.replace(`<meta property="og:url" content="https://example.com/">`, ``),
  });
  assert.ok(!planFixes(absent, { url: "https://example.com/" }).planned.some((p) => p.name === "og-url"));
});

test("fix: twitter:card picks summary vs summary_large_image from og:image", () => {
  const noImage = doc({
    head: HEALTHY_HEAD.replace(`<meta property="og:image" content="https://example.com/og.png">`, ``).replace(
      `<meta name="twitter:card" content="summary_large_image">`,
      ``,
    ),
  });
  const plan = planFixes(noImage);
  assert.match(plan.newHtml, /<meta name="twitter:card" content="summary">/);

  const withImage = doc({
    head: HEALTHY_HEAD.replace(`<meta name="twitter:card" content="summary_large_image">`, ``),
  });
  const plan2 = planFixes(withImage);
  assert.match(plan2.newHtml, /<meta name="twitter:card" content="summary_large_image">/);
});

test("fix: favicon inserted when missing, healthy when present", () => {
  const html = doc({ head: HEALTHY_HEAD.replace(`<link rel="icon" href="/favicon.ico">`, ``) });
  const plan = planFixes(html);
  assert.ok(plan.planned.some((p) => p.name === "favicon"));
  assert.equal(parseHtml(plan.newHtml, "https://example.com/").icon, true);
  assert.ok(!planFixes(doc()).planned.some((p) => p.name === "favicon"));
});

// ---------- selection, safety and formatting ----------

test("fix: --only restricts planning to named fixers", () => {
  const html = doc({ head: `<title>Fixture page title long enough for tests</title>` });
  const plan = planFixes(html, { only: ["charset"] });
  assert.deepEqual(
    plan.planned.map((p) => p.name),
    ["charset"],
  );
});

test("fix: document without <head> is refused with a clear error", () => {
  const html = `<!doctype html>\n<html lang="en">\n<body><h1>Bare</h1></body>\n</html>\n`;
  const plan = planFixes(html);
  assert.match(plan.error ?? "", /no <head> element/);
  assert.equal(plan.changed, false);
  assert.equal(plan.newHtml, html);
});

test("fix: no <head> but a swappable og:url still proceeds (no head op needed)", () => {
  const bare = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>A perfectly reasonable test page title</title>
<meta name="description" content="A well over one hundred and twenty character meta description fixture used to keep the description fixer quiet in healthy documents.">
<link rel="canonical" href="https://example.com/">
<link rel="icon" href="/favicon.ico">
<meta property="og:title" content="t">
<meta property="og:description" content="d">
<meta property="og:image" content="https://example.com/og.png">
<meta property="og:url" content="https://old.example.com/x">
<meta name="twitter:card" content="summary_large_image">
<body><p>${LONG_TEXT}</p></body>
</html>
`;
  const plan = planFixes(bare, { url: "https://example.com/here" });
  assert.equal(plan.error, undefined);
  assert.deepEqual(
    plan.planned.map((p) => p.name),
    ["og-url"],
  );
  assert.match(plan.newHtml, /property="og:url" content="https:\/\/example\.com\/here"/);
});

test("fix: CRLF line endings survive a fix round-trip", () => {
  const html = doc({ head: `<title>Fixture page title long enough for tests</title>` }).replace(
    /\n/g,
    "\r\n",
  );
  const plan = planFixes(html, { url: "https://example.com/" });
  assert.ok(plan.changed);
  assert.ok(!/[^\r]\n/.test(plan.newHtml), "lone \\n introduced into a CRLF document");
});

test("fix: over-long <h1> is trimmed at a word boundary for <title>", () => {
  const longH1 =
    "The Ultimate Comprehensive Guide To Everything You Ever Wanted To Know About Search Engine Optimization";
  const html = doc({ htmlAttrs: 'lang="en"', head: "", body: `<h1>${longH1}</h1>` });
  const plan = planFixes(html);
  const t = plan.planned.find((p) => p.name === "title");
  assert.ok(t, "expected title plan");
  const parsed = parseHtml(plan.newHtml, "https://example.com/");
  assert.ok(parsed.titleLength <= 60, `title too long: ${parsed.titleLength}`);
  assert.ok(parsed.titleLength >= 30, `title too short after trim: ${parsed.titleLength}`);
  assert.equal(parsed.title, parsed.title.trim());
});

test("fix: unclosed <head> reports an error instead of guessing placement", () => {
  const html = `<!doctype html>
<html lang="en">
<head>
<title>Fixture page title long enough for tests</title>
<body>
<h1>Bare</h1>
</html>
`;
  const plan = planFixes(html);
  assert.match(plan.error ?? "", /<\/head>/);
  assert.equal(plan.changed, false);
  assert.equal(plan.newHtml, html);
});

// ---------- diff ----------

test("diff: identical inputs produce no output", () => {
  assert.equal(unifiedDiff("a\nb\n", "a\nb\n", "x"), "");
});

test("diff: insertion produces a header and + line with context", () => {
  const out = unifiedDiff("one\ntwo\nthree\n", "one\nNEW\ntwo\nthree\n", "f.txt");
  assert.match(out, /^--- a\/f\.txt$/m);
  assert.match(out, /^\+\+\+ b\/f\.txt$/m);
  assert.match(out, /^@@ -\d+,\d+ \+\d+,\d+ @@$/m);
  assert.match(out, /^\+NEW$/m);
  assert.match(out, /^ one$/m);
  assert.match(out, /^ three$/m);
  assert.ok(!/^-/.test(out.replace(/^---.*$/gm, "").replace(/^\+\+\+.*$/gm, "")), "no removals expected");
});

test("diff: replacement emits matching - and + lines", () => {
  const out = unifiedDiff("a\nb\nc\n", "a\nX\nc\n", "f.txt");
  assert.match(out, /^-b$/m);
  assert.match(out, /^\+X$/m);
});

test("diff: distant edits form separate hunks", () => {
  const before = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join("\n");
  const afterFirst = ["line1-EDITED", ...before.split("\n").slice(1)].join("\n");
  const after = `${afterFirst.split("\n").slice(0, 29).join("\n")}\nline30-EDITED`;
  const out = unifiedDiff(before, after, "f.txt");
  const hunks = out.match(/^@@ .*@@$/gm) ?? [];
  assert.equal(hunks.length, 2, `expected 2 hunks, got ${hunks.length}:\n${out}`);
});

test("diff: pure deletion emits only minus lines for the removed block", () => {
  const out = unifiedDiff("a\nb\nc\n", "a\nc\n", "f.txt");
  assert.match(out, /^-b$/m);
  assert.ok(!/^\+b$/m.test(out), "deletions must not appear as additions");
});

test("diff: oversized middles fall back to a block replace", () => {
  const before = ["head", ...Array.from({ length: 520 }, (_, i) => `u${i}`), "tail"].join("\n");
  const after = ["head", ...Array.from({ length: 520 }, (_, i) => `v${i}`), "tail"].join("\n");
  const out = unifiedDiff(before, after, "f.txt");
  assert.match(out, /^@@ /m, "expected a hunk header");
  assert.match(out, /^-u0$/m);
  assert.match(out, /^\+v0$/m);
  assert.match(out, /^ head$/m, "common prefix kept as context");
});
