// Per-page checks ported from Open SEO Crawler (MIT, Copyright (c) 2026
// Puneet Inder Singh): head placement, duplicate tags, canonical and robots
// signals, soft 404s, URL hygiene, SERP width, jump links, placeholder text
// and HTML delivery — plus the T07/T08 fixes they brought along.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHtml } from "../lib/html.mjs";
import { runChecks } from "../lib/checks.mjs";
import { FINDING_META, getFindingMeta } from "../lib/finding-meta.mjs";
import { SKILLS } from "../lib/skills.mjs";
import { hasUnresolvedTemplate } from "../lib/url-traps.mjs";
import {
  EXTRA_CHECK_IDS,
  TITLE_PX_LIMIT,
  extraPageChecks,
  headEnd,
  linkHeaderCanonical,
  maskInert,
  maskRawText,
  parseXRobots,
  robotsDirectives,
  textPx,
} from "../lib/page-checks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const URL_ = "https://example.com/page/";
/** Headers of a well-configured response: compressed, with a validator. */
const OK_HEADERS = { "content-encoding": "br", etag: '"v1"' };

/**
 * Run the ported checks on an HTML string.
 * @param {string} html
 * @param {{ url?: string, status?: number, headers?: Record<string, string> | undefined, offline?: boolean }} [o]
 */
function check(html, o = {}) {
  const url = o.url ?? URL_;
  const headers = "headers" in o ? o.headers : OK_HEADERS;
  return extraPageChecks(
    html,
    parseHtml(html, url),
    { finalUrl: url, status: o.status ?? 200, headers },
    o.offline ? { offline: true } : {},
  );
}

/** @param {{ id: string }[]} findings @returns {Record<string, any>} */
const byId = (findings) => Object.fromEntries(findings.map((f) => [f.id, f]));

/**
 * A page with nothing for the ported checks to report.
 * @param {{ title?: string, head?: string, body?: string, h1?: string }} [p]
 */
function page(p = {}) {
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    `<title>${p.title ?? "Trail running shoes guide"}</title>`,
    '<meta name="description" content="How to pick trail running shoes.">',
    `<link rel="canonical" href="${URL_}">`,
    p.head ?? "",
    `</head><body><h1>${p.h1 ?? "Trail running shoes"}</h1>`,
    p.body ?? "",
    "</body></html>",
  ].join("\n");
}

test("masking blanks comments, scripts, title text and inline SVG without moving offsets", () => {
  const html =
    '<head><title>A <b> B</title><script>var s = "<div>";</script><!-- <div> --></head><body><svg><title>icon</title></svg><p>x</p></body>';
  const raw = maskRawText(html);
  assert.equal(raw.length, html.length);
  assert.ok(!raw.includes("<b>") && !raw.includes("<div>"));
  assert.ok(raw.includes("<title>") && raw.includes("</title>"), "the tags stay, only their text goes");
  const inert = maskInert(html);
  assert.equal(inert.length, html.length);
  assert.equal([...inert.matchAll(/<title/g)].length, 1, "the SVG <title> is masked");
  assert.ok(inert.includes("<p>x</p>"));
});

test("headEnd finds where a browser closes <head>", () => {
  const pixel =
    '<html><head><title>T</title><noscript><img src="/px.gif"></noscript><link rel="canonical" href="/a/"></head><body></body></html>';
  assert.deepEqual(headEnd(pixel), { at: pixel.indexOf("<img"), tag: "img", early: true });
  const natural = "<head><title>T</title></head><body><p>x</p></body>";
  assert.deepEqual(headEnd(natural), { at: natural.indexOf("</head>"), tag: "/head", early: false });
  // No <head> tag at all: the head ends at the first body element, not at byte 0.
  const bare = "<!doctype html><title>T</title><body><p>x</p></body>";
  assert.deepEqual(headEnd(bare), { at: bare.indexOf("<body>"), tag: "body", early: false });
  // <template> content, <title> text and script strings never close the head.
  const inert =
    '<head><template><div>x</div></template><title>A <b> B</title><script>document.write("<div>")</script><link rel="canonical" href="/a/"></head><body></body>';
  assert.equal(headEnd(inert)?.tag, "/head");
});

test("textPx estimates SERP width from Arial advance widths", () => {
  assert.equal(textPx("W", 20), 19); // 944 × 20 / 1000 = 18.88
  assert.equal(textPx("iii", 20), 13); // 3 × 222 × 20 / 1000 = 13.32
  assert.equal(textPx("日本", 20), 40); // East Asian wide characters count a full em
  assert.equal(textPx("é", 20), 11); // outside the table: 556 → 11.12
  assert.ok(textPx("W".repeat(40), 20) > TITLE_PX_LIMIT);
});

test("robots directives are tokens, and X-Robots-Tag scopes bind one crawler", () => {
  assert.ok(robotsDirectives("NOINDEX, follow").has("noindex"));
  assert.ok(robotsDirectives("noindex nofollow").has("nofollow"), "space-separated slip");
  assert.ok(!robotsDirectives("max-image-preview:none").has("none"), "a valued directive is not 'none'");
  assert.ok(!robotsDirectives("index, max-image-preview: none").has("none"));
  assert.ok(robotsDirectives("max-image-preview: large").has("max-image-preview:large"));
  assert.ok(!robotsDirectives("noimageindex").has("noindex"));

  const scoped = parseXRobots("bingbot: noindex, nofollow");
  assert.deepEqual([...(scoped.get("bingbot") ?? [])], ["noindex", "nofollow"]);
  assert.equal(scoped.get(""), undefined);
  const mixed = parseXRobots("noarchive, googlebot: noindex");
  assert.deepEqual([...(mixed.get("") ?? [])], ["noarchive"]);
  assert.deepEqual([...(mixed.get("googlebot") ?? [])], ["noindex"]);
  assert.ok(parseXRobots("unavailable_after: 2010-06-25").get("")?.has("unavailable_after:2010-06-25"));
  assert.ok(parseXRobots("googlebot: max-snippet: 20").get("googlebot")?.has("max-snippet:20"));
});

test("linkHeaderCanonical reads rel=canonical from an HTTP Link header", () => {
  const base = "https://example.com/doc.pdf";
  assert.equal(
    linkHeaderCanonical('<https://example.com/doc/>; rel="canonical"', base),
    "https://example.com/doc/",
  );
  assert.equal(
    linkHeaderCanonical("</style.css>; rel=preload; as=style, </doc/>; rel=canonical", base),
    "https://example.com/doc/",
  );
  assert.equal(linkHeaderCanonical('<https://example.com/x>; rel="alternate"; hreflang="de"', base), "");
  assert.equal(linkHeaderCanonical("", base), "");
});

test("a clean page trips none of the ported checks", () => {
  const html = page({
    body: '<p>Read the <a href="#sizing">sizing notes</a>.</p><h2 id="sizing">Sizing</h2><form action="/subscribe" method="post"></form>',
  });
  assert.deepEqual(check(html), []);
});

test("realistic fixtures trip no ported check except their lorem-ipsum filler", () => {
  for (const file of readdirSync(join(ROOT, "tests/fixtures")).filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(join(ROOT, "tests/fixtures", file), "utf8");
    const ids = check(html, { url: `https://example.com/${file.replace(/\.html$/, "/")}` }).map((f) => f.id);
    assert.deepEqual(
      ids.filter((id) => id !== "C06-placeholder"),
      [],
      file,
    );
  }
});

test("T19 reports head tags a stray element pushes out of <head>, or placed in <body>", () => {
  const early = byId(
    check(
      [
        "<!doctype html><html><head><title>Shoes</title>",
        '<noscript><iframe src="https://www.googletagmanager.com/ns.html"></iframe></noscript>',
        `<link rel="canonical" href="${URL_}"><meta name="robots" content="index">`,
        "</head><body><h1>Shoes</h1></body></html>",
      ].join("\n"),
    ),
  );
  assert.deepEqual(Object.keys(early), ["T19-head-placement"]);
  assert.equal(early["T19-head-placement"].severity, "P1");
  assert.match(
    early["T19-head-placement"].evidence,
    /canonical, meta robots come after a <iframe> on line 2/,
  );

  const inBody = byId(
    check(
      `<!doctype html><html><head><title>Shoes</title></head><body><h1>Shoes</h1><link rel="canonical" href="${URL_}"></body></html>`,
    ),
  );
  assert.match(inBody["T19-head-placement"].evidence, /canonical appear in the <body>/);
  // A title after the cut alone is a lower-stakes P2.
  const titleOnly = byId(
    check(
      "<!doctype html><html><head><meta charset=utf-8><div></div><title>Late</title></head><body></body></html>",
    ),
  );
  assert.equal(titleOnly["T19-head-placement"].severity, "P2");
});

test("T20 reports tags that must be unique, P1 when canonicals disagree", () => {
  const dup = byId(
    check(
      [
        '<!doctype html><html><head><title>A</title><title>B</title><meta name="description" content="a">',
        '<meta name="description" content="b"><meta name="viewport" content="width=device-width">',
        '<meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.com/page/">',
        '<link rel="canonical" href="https://example.com/b/"></head><body><h1>A</h1></body></html>',
      ].join(""),
    ),
  );
  const t20 = dup["T20-duplicate-tags"];
  assert.equal(t20.severity, "P1");
  assert.match(t20.evidence, /2 <title> tags/);
  assert.match(t20.evidence, /2 canonical tags with different URLs/);
  assert.match(t20.evidence, /2 meta descriptions; 2 viewport tags/);
  const same = byId(check(page({ head: `<link rel="canonical" href="${URL_}">` })));
  assert.equal(same["T20-duplicate-tags"].severity, "P3");
  assert.match(same["T20-duplicate-tags"].evidence, /2 identical canonical tags/);
});

test("T21 reports conflicting and malformed canonical signals", () => {
  const html = page({ head: '<meta name="robots" content="noindex">' }).replace(
    `<link rel="canonical" href="${URL_}">`,
    '<link rel="canonical" href="https://example.com/other/#top">',
  );
  const t21 = byId(check(html, { headers: { ...OK_HEADERS, link: `<${URL_}>; rel="canonical"` } }))[
    "T21-canonical-signals"
  ];
  assert.equal(t21.severity, "P1");
  assert.match(t21.evidence, /the HTTP Link header says https:\/\/example.com\/page\/, the HTML says/);
  assert.match(t21.evidence, /#fragment/);
  assert.match(t21.evidence, /noindex combined with a canonical to another URL/);

  const relative = byId(check(page().replace(`href="${URL_}"`, 'href="/page/"')))["T21-canonical-signals"];
  assert.equal(relative.severity, "P3");
  const junk = byId(check(page().replace(`href="${URL_}"`, 'href="https://example.com/undefined"')));
  assert.match(junk["T21-canonical-signals"].evidence, /unresolved template value/);
  // A local file's canonical names its production URL: never "another URL".
  const local = page({ head: '<meta name="robots" content="noindex">' }).replace(
    URL_,
    "https://example.com/blog/",
  );
  assert.equal(
    byId(check(local, { url: "file:///C:/site/blog/index.html", offline: true }))["T21-canonical-signals"],
    undefined,
  );
});

test("T22 reports engine-scoped noindex and expired unavailable_after", () => {
  const scoped = byId(
    check(page({ head: '<meta name="googlebot" content="noindex">' }), {
      headers: { ...OK_HEADERS, "x-robots-tag": "bingbot: noindex" },
    }),
  )["T22-robots-scoped"];
  assert.equal(scoped.severity, "P0");
  assert.match(scoped.evidence, /<meta name="googlebot"> says noindex: removed from Google only/);
  assert.match(scoped.evidence, /X-Robots-Tag "bingbot: noindex": removed from Bing only/);
  // A page noindexed for everyone is T07's finding, not an engine-specific one.
  const everyone = page({
    head: '<meta name="robots" content="noindex"><meta name="googlebot" content="noindex">',
  });
  assert.equal(byId(check(everyone))["T22-robots-scoped"], undefined);
  const expired = byId(check(page({ head: '<meta name="robots" content="unavailable_after: 2010-06-25">' })));
  assert.equal(expired["T22-robots-scoped"].severity, "P1");
  const future = page({ head: '<meta name="robots" content="unavailable_after: 2999-01-01">' });
  assert.equal(byId(check(future))["T22-robots-scoped"], undefined);
});

test("T23 reports error pages served with 200, not real 404s or brand names", () => {
  assert.equal(byId(check(page({ title: "Page not found – Example" })))["T23-soft-404"].severity, "P1");
  const wordpress = byId(check(page({ title: "Example Store", h1: "Oops! That page can’t be found." })));
  assert.match(wordpress["T23-soft-404"].evidence, /the H1 says "Oops! That page can’t be found\."/);
  assert.equal(byId(check(page({ title: "Studio 404 — Design agency" })))["T23-soft-404"], undefined);
  assert.equal(byId(check(page({ title: "Page not found" }), { status: 404 }))["T23-soft-404"], undefined);
  assert.equal(byId(check(page({ title: "Page not found" }), { offline: true }))["T23-soft-404"], undefined);
  const longRead = page({
    title: "Not found: a history of lost maps",
    body: `<p>${"word ".repeat(400)}</p>`,
  });
  assert.equal(byId(check(longRead))["T23-soft-404"], undefined);
});

test("T24–T26 report template junk, non-URL hrefs and local or staging hosts", () => {
  const html = page({
    body: [
      '<a href="/products/undefined">x</a><a href="/p?id=null">y</a><a href="/docs/check-if-undefined">ok</a>',
      '<a href="info@example.com">mail</a><a href="12 Main Street, Springfield">address</a>',
      '<a href="http://localhost:3000/about">dev</a><img src="https://staging.example.com/a.png" alt="">',
    ].join(""),
  });
  const f = byId(check(html));
  assert.equal(f["T24-unresolved-urls"].severity, "P1");
  assert.match(f["T24-unresolved-urls"].evidence, /^2 URL\(s\)/);
  assert.equal(f["T25-malformed-hrefs"].severity, "P2");
  assert.match(f["T25-malformed-hrefs"].evidence, /"info@example.com" \(e-mail without mailto:\)/);
  assert.match(f["T25-malformed-hrefs"].evidence, /"12 Main Street, Springfield" \(text, not a URL\)/);
  assert.equal(f["T26-dev-links"].severity, "P1");
  assert.match(f["T26-dev-links"].evidence, /localhost/);
  assert.match(f["T26-dev-links"].evidence, /staging\.example\.com/);
  // Auditing a local dev server is not a finding.
  const dev = byId(
    check(page({ body: '<a href="http://127.0.0.1:3000/x">x</a>' }), { url: "http://localhost:3000/" }),
  );
  assert.equal(dev["T26-dev-links"], undefined);
  assert.equal(hasUnresolvedTemplate("https://a.test/docs/check-if-undefined"), false);
});

test("T27 reports HTTPS forms that submit over HTTP", () => {
  const html = page({ body: '<form action="http://example.com/subscribe" method="post"></form>' });
  assert.equal(byId(check(html))["T27-insecure-forms"].severity, "P1");
  assert.equal(byId(check(html, { url: "http://example.com/page/" }))["T27-insecure-forms"], undefined);
});

test("T28 and T29 report indexable search pages and unfollowable pagination", () => {
  assert.equal(
    byId(check(page(), { url: "https://example.com/?s=shoes" }))["T28-internal-search"].severity,
    "P2",
  );
  const noindexed = page({ head: '<meta name="robots" content="noindex, follow">' });
  assert.equal(
    byId(check(noindexed, { url: "https://example.com/?s=shoes" }))["T28-internal-search"],
    undefined,
  );

  const next = page({ head: '<link rel="next" href="/blog/page/2/">' });
  const t29 = byId(check(next, { url: "https://example.com/blog/" }))["T29-rel-pagination"];
  assert.match(t29.evidence, /no <a href> on the page links there/);
  const linked = page({
    head: '<link rel="next" href="/blog/page/2/">',
    body: '<a href="/blog/page/2/">Older posts</a>',
  });
  assert.equal(byId(check(linked, { url: "https://example.com/blog/" }))["T29-rel-pagination"], undefined);
  const deep = byId(check(noindexed, { url: "https://example.com/blog/page/2/" }))["T29-rel-pagination"];
  assert.match(deep.evidence, /paginated listing page \(page 2\+\) is set to noindex/);
});

test("T30 reports a missing doctype and repeated <body>", () => {
  assert.equal(byId(check(page().replace("<!doctype html>", "")))["T30-markup"].severity, "P3");
  assert.equal(byId(check(page({ body: "<body><p>x</p></body>" })))["T30-markup"].severity, "P2");
});

test("O12 reports titles and descriptions too wide for the results page", () => {
  const wide = byId(check(page({ title: "W".repeat(34) })))["O12-serp-width"];
  assert.match(wide.evidence, /title is about 642 px wide/);
  const desc = page().replace("How to pick trail running shoes.", "W".repeat(100));
  assert.match(byId(check(desc))["O12-serp-width"].evidence, /meta description is about 1322 px wide/);
  // Over the character limit, O01 already reports it.
  assert.equal(byId(check(page({ title: "W".repeat(61) })))["O12-serp-width"], undefined);
});

test("O13, C06 and P07 report dead jump links, placeholder text and HTML delivery", () => {
  const anchors = page({
    body: '<a href="#reviews">Reviews</a><a href="#">x</a><a href="#top">top</a><a href="#!/route">r</a><a href="#elementor-action%3Aaction%3Dpopup">p</a>',
  });
  assert.equal(byId(check(anchors))["O13-dead-anchors"].evidence, "1 link(s) with no matching id: #reviews");
  const filler = byId(check(page({ body: "<p>Lorem ipsum dolor sit amet.</p>" })))["C06-placeholder"];
  assert.equal(filler.severity, "P2");

  const big = page({ body: `<p>${"word ".repeat(5000)}</p>` });
  const plain = byId(check(big, { headers: { "content-type": "text/html" } }))["P07-delivery"];
  assert.equal(plain.severity, "P2");
  assert.match(plain.evidence, /KB of HTML sent uncompressed/);
  assert.match(plain.evidence, /no ETag or Last-Modified header/);
  assert.equal(
    byId(check(big, { headers: { "content-type": "text/html" }, offline: true }))["P07-delivery"],
    undefined,
  );
  assert.equal(byId(check(big, { headers: undefined }))["P07-delivery"], undefined, "headers unknown");
});

/** @param {string} html @param {Record<string, string>} [headers] @param {string} [url] */
function core(html, headers = {}, url = URL_) {
  const findings = runChecks(
    parseHtml(html, url),
    {},
    { finalUrl: url, status: 200, headers },
    { items: [], types: [], issues: [], errors: [] },
    { html },
  );
  return byId(findings);
}

test("T07 counts only rules for every crawler, read as directive tokens", () => {
  const scoped = core(page(), { "x-robots-tag": "bingbot: noindex" });
  assert.equal(
    scoped["T07-noindex"].severity,
    "pass",
    "a Bing-only rule does not deindex the page from Google",
  );
  assert.equal(scoped["T22-robots-scoped"].severity, "P1");
  assert.equal(core(page(), { "x-robots-tag": "noindex" })["T07-noindex"].severity, "P0");
  assert.equal(
    core(page({ head: '<meta name="robots" content="max-image-preview:none">' }))["T07-noindex"].severity,
    "pass",
  );
  assert.equal(core(page({ head: '<meta name="robots" content="none">' }))["T07-noindex"].severity, "P0");
  const second = page({
    head: '<meta name="robots" content="index, follow"><meta name="robots" content="noindex">',
  });
  assert.equal(core(second)["T07-noindex"].severity, "P0", "a noindex in a second robots tag counts");
});

test("T08 reads a canonical from the HTTP Link header and decodes &amp; in hrefs", () => {
  const noTag = page().replace(`<link rel="canonical" href="${URL_}">`, "");
  const viaHeader = core(noTag, { link: `<${URL_}>; rel="canonical"` })["T08-canonical"];
  assert.equal(viaHeader.severity, "pass");
  assert.match(viaHeader.evidence, /\(HTTP Link header\)/);
  assert.equal(
    core(noTag, { link: '<https://example.com/other/>; rel="canonical"' })["T08-canonical"].severity,
    "P1",
  );
  assert.equal(core(noTag)["T08-canonical"].severity, "P2");

  const listUrl = "https://example.com/list/?page=2&sort=new";
  const encoded = page({ body: '<a href="/list/?page=3&amp;sort=new">next</a>' }).replace(
    `href="${URL_}"`,
    'href="https://example.com/list/?page=2&amp;sort=new"',
  );
  assert.equal(core(encoded, {}, listUrl)["T08-canonical"].severity, "pass");
  assert.ok(parseHtml(encoded, listUrl).internalLinks.includes("https://example.com/list/?page=3&sort=new"));
});

test("every ported check has finding metadata, a skill and a CHECKS.md row", () => {
  const generic = getFindingMeta("definitely-not-a-real-id");
  const docs = readFileSync(join(ROOT, "docs/CHECKS.md"), "utf8");
  for (const id of EXTRA_CHECK_IDS) {
    assert.ok(FINDING_META[id], `${id}: FINDING_META entry`);
    assert.notEqual(getFindingMeta(id).plain, generic.plain, `${id}: dedicated explanation`);
    assert.ok(
      SKILLS.some((s) => s.checks.includes(id)),
      `${id}: mapped to a skill`,
    );
    assert.ok(docs.includes(`\`${id}\``) || docs.includes(`| ${id}`), `${id}: documented in docs/CHECKS.md`);
  }
});
