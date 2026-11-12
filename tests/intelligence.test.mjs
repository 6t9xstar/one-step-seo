// SEO Intelligence engine: crawl a real (local) multi-page site with known
// problems and assert the site-level analysis finds exactly those problems.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crawlSite, pageFacts } from "../lib/crawl.mjs";
import { canonicalizeUrl } from "../lib/args.mjs";
import { clearSiteFilesCache, clearSitemapUrlsCache } from "../lib/robots.mjs";
import {
  analyzeSite,
  clickDepths,
  isValidHreflang,
  compareCompetitors,
  suggestInternalLinks,
  categoryScores,
} from "../lib/intelligence.mjs";
import { simhash, simhashDistance, jaccard, contentTerms, stripBrandSuffix, tokenize } from "../lib/text.mjs";
import { startSite, siteRoutes } from "./helpers/site-fixture.mjs";

/** @type {Awaited<ReturnType<typeof startSite>>} */
let site;
/** @type {Awaited<ReturnType<typeof crawlSite>>} */
let crawl;
/** @type {ReturnType<typeof analyzeSite>} */
let analysis;
const canon = (/** @type {string} */ u) => canonicalizeUrl(u, false);

before(async () => {
  clearSiteFilesCache();
  clearSitemapUrlsCache();
  site = await startSite();
  crawl = await crawlSite(`${site.base}/`, {
    pages: 50,
    crawl: "auto",
    all: true,
    delay: 0,
    checkLinks: true,
  });
  analysis = analyzeSite({
    pages: crawl.pages,
    failures: crawl.failures,
    redirects: crawl.redirects,
    sitemapUrls: crawl.sitemapUrls,
    capped: crawl.capped,
    pageReports: crawl.pageReports,
    canon,
  });
});
after(async () => {
  await site?.close();
});

/** @param {string} id */
const issue = (id) => analysis.issues.find((i) => i.id === id);
/** @param {string} id @returns {string[]} */
const urlsOf = (id) => (issue(id)?.urls ?? []).map((u) => new URL(u.url).pathname);

test("crawl audits every HTML page once and skips non-HTML assets", () => {
  const paths = crawl.pages.map((p) => new URL(p.finalUrl).pathname).sort();
  assert.deepEqual(paths, ["/", "/guide", "/guide-copy", "/hidden", "/orphan", "/plans", "/pricing"]);
  assert.equal(crawl.pageReports.length, crawl.pages.length);
  assert.ok(!paths.includes("/file.pdf"), "PDF must not be audited as a page");
});

test("a URL broken in both the link graph and the sitemap is one failure, with its referrer", () => {
  const gone = crawl.failures.filter((f) => new URL(f.url).pathname === "/gone");
  assert.equal(gone.length, 1);
  assert.equal(gone[0]?.status, 404);
  assert.ok(gone[0]?.referrers.some((r) => new URL(r).pathname === "/"));
  assert.equal(analysis.summary.failedUrls, 1);
});

test("redirect aliases of already-audited pages are still recorded", () => {
  const old = crawl.redirects.find((r) => new URL(r.url).pathname === "/old");
  assert.ok(old, "the /old -> /guide redirect is recorded");
  assert.equal(new URL(old.finalUrl).pathname, "/guide");
  assert.ok(old.hops >= 1);
  assert.deepEqual(urlsOf("X03-links-to-redirects"), ["/old"]);
  assert.match(issue("X03-links-to-redirects")?.urls[0]?.detail ?? "", /linked from/);
});

test("site issues match the fixture's deliberate problems", () => {
  assert.deepEqual(urlsOf("X01-broken-internal-links"), ["/gone"]);
  assert.deepEqual(urlsOf("X10-sitemap-broken-urls"), ["/gone"]);
  assert.deepEqual(urlsOf("X06-duplicate-titles").sort(), ["/plans", "/pricing"]);
  assert.deepEqual(urlsOf("X08-duplicate-content").sort(), ["/plans", "/pricing"]);
  assert.deepEqual(urlsOf("X11-sitemap-noindex"), ["/hidden"]);
  assert.deepEqual(urlsOf("X04-orphan-pages"), ["/orphan"]);
  assert.deepEqual(urlsOf("X13-missing-from-sitemap"), ["/guide-copy"]);
  assert.ok(urlsOf("X09-near-duplicate-content").includes("/guide-copy"));
  // Every issue carries the fields the report and fix plan depend on.
  for (const i of analysis.issues) {
    assert.match(i.id, /^X\d\d-/);
    assert.ok(["P0", "P1", "P2", "P3"].includes(i.severity));
    assert.ok(["safe", "approval", "manual"].includes(i.fixType));
    assert.ok(i.title && i.recommendation && i.impact);
    assert.equal(i.count >= i.urls.length, true);
  }
});

test("summary and category scores are computed from the crawl, not invented", () => {
  assert.equal(analysis.summary.pagesAnalyzed, 7);
  assert.equal(analysis.summary.noindexPages, 1);
  assert.equal(analysis.summary.indexablePages, 6);
  assert.equal(analysis.summary.sitemapUrls, 7);
  assert.equal(analysis.summary.maxClickDepth, 1);
  for (const v of Object.values(analysis.categoryScores)) {
    if (v.score === null) continue;
    assert.ok(v.score >= 0 && v.score <= 100);
  }
  assert.ok(analysis.methodology && typeof analysis.methodology === "object");
});

test("clickDepths measures BFS distance from the start page", () => {
  const mk = (/** @type {string} */ key, /** @type {string[]} */ links) =>
    /** @type {any} */ ({ key, url: key, finalUrl: key, links });
  const depths = clickDepths([mk("a", ["b"]), mk("b", ["c"]), mk("c", ["d"]), mk("d", []), mk("e", [])]);
  assert.equal(depths.get("a"), 0);
  assert.equal(depths.get("d"), 3);
  assert.equal(depths.has("e"), false, "unreachable pages have no depth");
});

test("isValidHreflang accepts BCP-47 language(-script)(-region) and x-default only", () => {
  for (const ok of ["en", "en-GB", "zh-Hant-TW", "es-419", "x-default"]) assert.ok(isValidHreflang(ok), ok);
  for (const bad of ["english", "en_GB", "en-UK-x", "", "e"]) assert.ok(!isValidHreflang(bad), bad);
});

test("text helpers: simhash distance, jaccard and brand suffix stripping", () => {
  const a = "the quick brown fox jumps over the lazy dog near the river bank today";
  assert.equal(simhashDistance(simhash(a), simhash(a)), 0);
  assert.ok(
    simhashDistance(simhash(a), simhash("completely unrelated text about pricing tiers and invoices")) > 10,
  );
  assert.equal(jaccard(["a", "b"], ["a", "b"]), 1);
  assert.equal(jaccard(["a"], ["b"]), 0);
  assert.equal(jaccard([], []), 0);
  assert.equal(stripBrandSuffix("Pricing Plans | Acme"), "Pricing Plans");
  assert.ok(!contentTerms("the and of crawling").includes("the"));
  assert.deepEqual(tokenize("Hello, World!"), ["hello", "world"]);
});

test("internal link suggestions never point a page at itself", () => {
  const suggestions = suggestInternalLinks(crawl.pages);
  for (const s of suggestions) assert.notEqual(s.from, s.to);
});

test("categoryScores tolerates empty input", () => {
  const scores = categoryScores([]);
  for (const v of Object.values(scores)) assert.equal(v.score, null);
});

test("competitor comparison reports lexical gaps from real page facts only", async () => {
  const own = crawl.pages.filter((p) => ["/pricing"].includes(new URL(p.finalUrl).pathname));
  const rival = crawl.pages.filter((p) => ["/guide"].includes(new URL(p.finalUrl).pathname));
  const cmp = compareCompetitors(own, [{ url: "https://rival.example/", pages: rival }]);
  assert.ok(Array.isArray(cmp.competitors));
  assert.equal(cmp.competitors.length, 1);
  const gaps = cmp.competitors[0]?.termGaps ?? [];
  assert.ok(gaps.length > 0, "the guide covers terms the pricing page does not");
  // No fabricated metrics: no volume/traffic/backlink fields — and the note says so.
  const keys = JSON.stringify(cmp.competitors, (k, v) => v).match(/"[a-zA-Z]+":/g) ?? [];
  for (const k of keys) assert.doesNotMatch(k, /volume|traffic|backlink|rank/i);
  assert.match(cmp.note, /not measured/);
});

test("pageFacts derives keys and counts from the analyzed page", () => {
  const r = crawl.pageReports[0];
  assert.ok(r);
  const facts = crawl.pages[0];
  assert.ok(facts);
  assert.equal(facts.key, canon(facts.finalUrl));
  assert.equal(typeof pageFacts, "function");
  assert.ok(facts.wordCount > 0);
  assert.match(facts.simhash, /^[0-9a-f]{16}$/);
});

test("robots.txt is honored for sitemap seeds and for query-string rules", async () => {
  const routes = siteRoutes();
  routes["/robots.txt"] = {
    type: "text/plain",
    body: "User-agent: *\nDisallow: /orphan\nDisallow: /*?sort=\nSitemap: {base}/sitemap.xml\n",
  };
  routes["/"] = {
    body: `<html lang="en"><head><title>Home page title for robots test</title></head><body><a href="/guide">g</a><a href="/guide?sort=asc">sorted</a></body></html>`,
  };
  const s = await startSite(routes);
  try {
    clearSiteFilesCache();
    clearSitemapUrlsCache();
    const c = await crawlSite(`${s.base}/`, { pages: 50, crawl: "auto", all: true, delay: 0 });
    const fetched = c.pages.map((p) => new URL(p.finalUrl).pathname + new URL(p.finalUrl).search);
    assert.ok(!fetched.includes("/orphan"), "a sitemap URL disallowed by robots.txt is not fetched");
    assert.ok(!fetched.includes("/guide?sort=asc"), "Disallow: /*?sort= blocks the query URL");
    assert.ok(fetched.includes("/guide"));
  } finally {
    await s.close();
    clearSiteFilesCache();
    clearSitemapUrlsCache();
  }
});
