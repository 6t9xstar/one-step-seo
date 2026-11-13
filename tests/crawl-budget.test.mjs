// Crawl budget (ported from Open SEO Crawler, MIT): query-parameter key
// folding and classification, the 25-URL volume rule, ranking, robots.txt
// rule drafting, site issue X27 and its split with X18, and the inventory in
// site-intelligence.json, site-report.md and site-issues.csv.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PARAM_VOLUME_THRESHOLD,
  UrlParameterCollector,
  classifyParamKey,
  describeParamKey,
  draftDisallowRules,
  emptyUrlParameters,
  isCrawlableTrap,
  normalizeParamKey,
  sitemapScale,
} from "../lib/crawl-budget.mjs";
import { buildFixPlan } from "../lib/autofix.mjs";
import { crawlSite } from "../lib/crawl.mjs";
import { analyzeSite } from "../lib/intelligence.mjs";
import { renderSiteCsv, renderSiteMarkdown } from "../lib/site-report.mjs";
import { clearSiteFilesCache, clearSitemapUrlsCache, isDisallowed } from "../lib/robots.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin/cli.mjs");

/**
 * @param {import("../lib/crawl-budget.mjs").UrlParameterInventory} inv
 * @param {string} key
 */
const keyOf = (inv, key) => inv.keys.find((k) => k.key === key);

test("normalizeParamKey lowercases keys and folds page-builder widget ids", () => {
  assert.equal(normalizeParamKey("e-page-0b1537f"), "e-page-*");
  assert.equal(normalizeParamKey("e-page-1478160"), "e-page-*");
  assert.equal(normalizeParamKey("E-Page-0B1537F"), "e-page-*");
  assert.equal(normalizeParamKey("e-filter-9ac24be1"), "e-filter-*");
  assert.equal(normalizeParamKey("jet-paging-3fa8e21"), "jet-paging-*", "any <name>-<name>-<hex id>");
  // Not a widget id: a short or non-hex suffix, or another shape.
  assert.equal(normalizeParamKey("e-page-12345"), "e-page-12345");
  assert.equal(normalizeParamKey("e-page-xyz1234"), "e-page-xyz1234");
  assert.equal(normalizeParamKey("a-b-c-1234567"), "a-b-c-1234567");
  assert.equal(normalizeParamKey("data-id"), "data-id");
  assert.equal(normalizeParamKey("UTM_Source"), "utm_source");
});

test("classifyParamKey applies Open SEO Crawler's rules, first match wins", () => {
  /** @param {string} key */
  const type = (key) => classifyParamKey(key)?.type ?? null;
  assert.deepEqual(classifyParamKey("e-page-*"), {
    type: "pagination",
    why: "Elementor Pro Posts/Loop AJAX pagination",
  });
  assert.equal(type("e-filter-*"), "faceting");
  for (const k of ["page", "paged", "pg", "pagenum", "start", "offset"])
    assert.equal(type(k), "pagination", k);
  for (const k of ["orderby", "order", "sort", "sort_by", "sortby"]) assert.equal(type(k), "sort", k);
  for (const k of [
    "filter",
    "filters",
    "filter_by",
    "filter_color",
    "price_filter",
    "pa_size",
    "color",
    "colour",
    "size",
    "brand",
    "min_price",
    "max_price",
    "swoof",
    "jsf",
  ]) {
    assert.equal(type(k), "faceting", k);
  }
  for (const k of ["utm_source", "utm_anything", "gclid", "fbclid", "msclkid", "mc_cid", "mc_eid", "yclid"]) {
    assert.equal(type(k), "tracking", k);
  }
  for (const k of ["replytocom", "phpsessid", "sessionid", "sid", "jsessionid"])
    assert.equal(type(k), "session", k);
  for (const k of ["s", "q", "search", "query", "keyword"]) assert.equal(type(k), "search", k);
  for (const k of ["ref", "id", "lang", "variant", "pages", "sorting", "x-foo-*"])
    assert.equal(type(k), null, k);
});

test("the inventory counts distinct link URLs per parameter and ranks crawl traps first", () => {
  const base = "https://shop.test";
  const c = new UrlParameterCollector();
  c.addPage([
    `${base}/`,
    `${base}/?ref=a&=no-key`,
    `${base}/blog/?e-page-0b1537f=2`,
    `${base}/blog/?e-page-0b1537f=3`,
    `${base}/blog/?e-page-1478160=12`,
    `${base}/shop/?orderby=price&orderby=date`,
    `${base}/shop/?page=2&orderby=price`,
  ]);
  // Links repeat from page to page: each URL counts once. This page had
  // more internal links than the parser keeps.
  c.addPage([`${base}/blog/?e-page-0b1537f=2`, `${base}/about/`], 900);
  const inv = c.finish(120);
  assert.equal(inv.pagesScanned, 2);
  assert.equal(inv.linksScanned, 8);
  assert.equal(inv.parameterLinks, 6);
  assert.equal(inv.pagesOverLinkCap, 1);
  assert.equal(inv.sitemapUrls, 120);
  assert.deepEqual(keyOf(inv, "e-page-*"), {
    key: "e-page-*",
    type: "pagination",
    why: "Elementor Pro Posts/Loop AJAX pagination",
    count: 3,
    blocked: 0,
    maxNumber: 12,
    examples: [
      `${base}/blog/?e-page-0b1537f=2`,
      `${base}/blog/?e-page-0b1537f=3`,
      `${base}/blog/?e-page-1478160=12`,
    ],
    trap: true,
  });
  assert.equal(keyOf(inv, "orderby")?.count, 2, "a key twice in one URL is one URL");
  assert.equal(keyOf(inv, "page")?.maxNumber, 2);
  assert.equal(keyOf(inv, ""), undefined, "an empty key is not a parameter");
  // Traps first; then pagination before sort; e-page-* before page by the highest number.
  assert.deepEqual(
    inv.keys.map((k) => k.key),
    ["e-page-*", "page", "orderby", "ref"],
  );
  assert.equal(inv.keyCount, 4);
  assert.equal(inv.trapKeys, 3);
  assert.equal(inv.trapUrls, 5, "?page=2&orderby=price counts once");
});

test("an unrecognised parameter is a crawl trap from 25 distinct URLs (the volume rule)", () => {
  /** @param {string} key @param {number} n */
  const links = (key, n) => Array.from({ length: n }, (_, i) => `https://a.test/p?${key}=${i + 1}`);
  const c = new UrlParameterCollector();
  c.addPage([...links("variant", PARAM_VOLUME_THRESHOLD - 1), ...links("ref", PARAM_VOLUME_THRESHOLD)]);
  const inv = c.finish();
  const ref = keyOf(inv, "ref");
  const variant = keyOf(inv, "variant");
  assert.equal(PARAM_VOLUME_THRESHOLD, 25);
  assert.equal(ref?.count, 25);
  assert.equal(ref?.trap, true);
  assert.equal(ref?.type, "parameter");
  assert.match(ref?.why ?? "", /25 or more URLs: a high-volume crawl trap/);
  assert.equal(ref?.maxNumber, 25);
  assert.equal(ref?.examples.length, 3);
  assert.equal(variant?.count, 24);
  assert.equal(variant?.trap, false);
  assert.equal(variant?.why, "Unrecognised parameter");
  assert.deepEqual(
    inv.keys.map((k) => k.key),
    ["ref", "variant"],
  );
  assert.equal(inv.trapKeys, 1);
  assert.equal(inv.trapUrls, 25);
  assert.equal(inv.sitemapUrls, null);
});

test("URLs robots.txt already disallows for Googlebot are counted; a fully disallowed trap is not reported", () => {
  // Googlebot obeys its own group, not the * group.
  const robots = [
    "User-agent: *",
    "Disallow: /private/",
    "",
    "User-agent: Googlebot",
    "Disallow: /*?replytocom=",
    "Disallow: /*?sort=price",
  ].join("\n");
  const c = new UrlParameterCollector(robots);
  c.addPage([
    "https://a.test/post/?replytocom=1",
    "https://a.test/post/?replytocom=2",
    "https://a.test/shop/?sort=price",
    "https://a.test/shop/?sort=name",
    "https://a.test/private/?page=2",
  ]);
  const inv = c.finish();
  const replies = keyOf(inv, "replytocom");
  const sort = keyOf(inv, "sort");
  assert.equal(replies?.count, 2);
  assert.equal(replies?.blocked, 2);
  assert.equal(replies?.trap, true);
  assert.equal(replies && isCrawlableTrap(replies), false);
  assert.equal(sort?.blocked, 1);
  assert.equal(sort && isCrawlableTrap(sort), true);
  assert.equal(keyOf(inv, "page")?.blocked, 0, "the * group does not apply to Googlebot");
  assert.equal(inv.trapKeys, 2);
  assert.equal(inv.trapUrls, 2);
  assert.equal(
    sort && describeParamKey(sort),
    "?sort (sort): 2 URLs, 1 already disallowed by robots.txt — Result sorting: duplicate views of the same set",
  );
});

test("drafted robots.txt lines anchor on ? and & so they never match other parameters", () => {
  assert.deepEqual(draftDisallowRules(["e-page-*", "utm_source", "utm_medium", "orderby", "s"]), [
    "Disallow: /*?e-page-",
    "Disallow: /*&e-page-",
    "Disallow: /*?utm_",
    "Disallow: /*&utm_",
    "Disallow: /*?orderby=",
    "Disallow: /*&orderby=",
    "Disallow: /*?s=",
    "Disallow: /*&s=",
  ]);
  assert.deepEqual(draftDisallowRules(["a*b", "x$", "two words", "100%", "a#b"]), [], "not expressible");
  assert.deepEqual(draftDisallowRules([]), []);
  // Checked with the robots.txt matcher the crawler itself uses.
  const robots = `User-agent: *\n${draftDisallowRules(["s", "e-page-*"]).join("\n")}\n`;
  assert.equal(isDisallowed(robots, "googlebot", "/?s=shoes"), true);
  assert.equal(isDisallowed(robots, "googlebot", "/shop/?cat=2&s=shoes"), true);
  assert.equal(isDisallowed(robots, "googlebot", "/?ids=1"), false, "Disallow: /*s= would block this");
  assert.equal(isDisallowed(robots, "googlebot", "/?class=a"), false);
  assert.equal(isDisallowed(robots, "googlebot", "/blog/?e-page-0b1537f=2"), true);
  assert.equal(
    isDisallowed(robots, "googlebot", "/single-page-app/"),
    false,
    "Disallow: /*e-page- would block this",
  );
});

test("sitemapScale gives the sitemap's size, or says it was not read", () => {
  assert.equal(sitemapScale(null), "The sitemap was not read in this crawl, so its size is not compared.");
  assert.equal(
    sitemapScale(undefined),
    "The sitemap was not read in this crawl, so its size is not compared.",
  );
  assert.equal(sitemapScale(0), "No sitemap URLs were found to compare with.");
  assert.equal(sitemapScale(1), "For scale, the sitemap lists 1 URL.");
  assert.equal(sitemapScale(180), "For scale, the sitemap lists 180 URLs.");
  assert.equal(sitemapScale(1000), "For scale, the sitemap lists at least 1000 URLs.", "the seed cap");
});

test("X27: one row per crawlable trap parameter, P3 below 25 URLs, suggestions and caveats", () => {
  const c = new UrlParameterCollector("User-agent: *\nDisallow: /*?replytocom=\n");
  c.addPage([
    "https://a.test/blog/?e-page-0b1537f=2",
    "https://a.test/blog/?e-page-0b1537f=3",
    "https://a.test/?utm_source=nav&utm_medium=menu",
    "https://a.test/post/?replytocom=4",
    "https://a.test/?lang=en",
  ]);
  const analysis = analyzeSite({ pages: [], urlParameters: c.finish(40) });
  const x27 = analysis.issues.find((i) => i.id === "X27-parameter-traps");
  assert.ok(x27, "X27 reported");
  assert.equal(x27.title, "3 URL parameters create 3 crawlable URL variants");
  assert.equal(x27.severity, "P3", "fewer than 25 URLs");
  assert.equal(x27.category, "technical");
  assert.equal(x27.fixType, "approval");
  assert.equal(x27.heuristic, true);
  assert.equal(x27.unit, "parameter");
  assert.equal(x27.count, 3);
  assert.deepEqual(
    x27.urls.map((u) => u.detail.split(" ")[0]),
    ["?e-page-*", "?utm_source", "?utm_medium"],
    "the fully disallowed ?replytocom and the ordinary ?lang are not rows",
  );
  assert.equal(x27.urls[0]?.url, "https://a.test/blog/?e-page-0b1537f=2");
  assert.match(x27.description, /For scale, the sitemap lists 40 URLs\./);
  // The rules are suggestions with the caveats the brief requires.
  const rec = x27.recommendation;
  assert.match(
    rec,
    /`Disallow: \/\*\?e-page-` `Disallow: \/\*&e-page-` `Disallow: \/\*\?utm_` `Disallow: \/\*&utm_`/,
  );
  assert.doesNotMatch(rec, /replytocom|lang=/);
  assert.match(rec, /suggestions only; robots\.txt was not changed/);
  assert.match(rec, /belong in the `User-agent: \*` group, and in the group of any crawler that has its own/);
  assert.match(
    rec,
    /pagination and filter URLs can be the only links to some pages, and blocking them hides those pages/,
  );
  assert.match(rec, /A disallowed URL can still be indexed from links that point to it/);
  assert.match(rec, /Canonical tags or noindex may fit better/);
  assert.deepEqual(analysis.crawlBudget?.robotsRules, [
    "Disallow: /*?e-page-",
    "Disallow: /*&e-page-",
    "Disallow: /*?utm_",
    "Disallow: /*&utm_",
  ]);
  assert.match(analysis.methodology.parameters, /never applied/);
  // The fix plan lists X27 for approval with nothing to apply: robots.txt is never written.
  const planned = buildFixPlan([], analysis).entries.filter((e) => e.issueId === "X27-parameter-traps");
  assert.equal(planned.length, 3);
  assert.ok(planned.every((e) => e.fixType === "approval" && e.proposedChange === ""));
  assert.equal(buildFixPlan([], analysis, { safeOnly: true }).entries.length, 0);

  // 25 or more crawlable URLs: P2.
  const many = new UrlParameterCollector();
  many.addPage(Array.from({ length: 25 }, (_, i) => `https://a.test/?page=${i + 2}`));
  const big = analyzeSite({ pages: [], urlParameters: many.finish(null) }).issues[0];
  assert.equal(big?.id, "X27-parameter-traps");
  assert.equal(big?.severity, "P2");
  assert.equal(big?.title, "1 URL parameter creates 25 crawlable URL variants");
  assert.match(big?.description ?? "", /The sitemap was not read in this crawl/);
});

test("without an inventory there is no crawl-budget section; without traps there is no X27", () => {
  const none = analyzeSite({ pages: [] });
  assert.equal(none.crawlBudget, null);
  assert.equal(
    none.issues.some((i) => i.id === "X27-parameter-traps"),
    false,
  );
  const empty = analyzeSite({ pages: [], urlParameters: emptyUrlParameters() });
  assert.deepEqual(empty.crawlBudget, { ...emptyUrlParameters(), robotsRules: [] });
  const quiet = new UrlParameterCollector();
  quiet.addPage(["https://a.test/?lang=en", "https://a.test/?lang=de"]);
  const tidy = analyzeSite({ pages: [], urlParameters: quiet.finish(2) });
  assert.equal(tidy.crawlBudget?.keyCount, 1);
  assert.equal(
    tidy.issues.some((i) => i.id === "X27-parameter-traps"),
    false,
  );
});

test("site-report.md lists the inventory for developers and summarises it for clients", () => {
  const c = new UrlParameterCollector();
  c.addPage(["https://a.test/?sort=new", "https://a.test/?ref=x"], 600);
  const analysis = analyzeSite({ pages: [], urlParameters: c.finish(10) });
  const model = {
    origin: "https://a.test",
    checkedAt: "2026-11-13T00:00:00.000Z",
    pageReports: [],
    analysis,
  };
  const full = renderSiteMarkdown(model);
  assert.match(
    full,
    /- URL parameters: 2 of 2 internal link URLs carry a query string, across 2 parameter\(s\); 1 looks like a crawl trap and creates 1 crawlable URL variant\(s\) \(X27\)\. 1 page\(s\) had more internal links than are read per page, so these counts are partial\./,
  );
  assert.match(full, /### URL parameters in internal links/);
  assert.match(
    full,
    /- \[crawl trap\] \?sort \(sort\): 1 URL — Result sorting: duplicate views of the same set\. Example: https:\/\/a\.test\/\?sort=new/,
  );
  assert.match(
    full,
    /- \?ref \(parameter\): 1 URL — Unrecognised parameter\. Example: https:\/\/a\.test\/\?ref=x/,
  );
  assert.match(full, /X27-parameter-traps: Links on the 1 audited page lead to 1 distinct URL/);
  const client = renderSiteMarkdown(model, { audience: "client" });
  assert.match(client, /URL parameters: 2 of 2 internal link URLs/);
  assert.doesNotMatch(client, /URL parameters in internal links/);
  const csv = renderSiteCsv(model);
  assert.match(csv, /site,https:\/\/a\.test\/\?sort=new,P3,X27-parameter-traps,technical,/);
  assert.match(csv, /\?sort \(sort\): 1 URL — Result sorting/);

  // No query strings at all, and parameters but no traps.
  /**
   * @param {string[]} links
   * @param {string} [robots]
   */
  const mdFor = (links, robots = "") => {
    const col = new UrlParameterCollector(robots);
    col.addPage(links);
    return renderSiteMarkdown({
      ...model,
      analysis: analyzeSite({ pages: [], urlParameters: col.finish(null) }),
    });
  };
  assert.match(
    mdFor(["https://a.test/about/"]),
    /URL parameters: none of the 1 internal link URL\(s\) on the audited pages carry a query string\./,
  );
  assert.match(mdFor(["https://a.test/?lang=en"]), /across 1 parameter\(s\); none looks like a crawl trap\./);

  // A trap parameter that robots.txt already disallows is named as such, not as "none".
  const robots = "User-agent: *\nDisallow: /*?replytocom=\n";
  assert.match(
    mdFor(["https://a.test/post/?replytocom=4", "https://a.test/?lang=en"], robots),
    /across 2 parameter\(s\); 1 looks like a crawl trap but is already disallowed by robots\.txt\./,
  );
  assert.match(
    mdFor(["https://a.test/post/?replytocom=4", "https://a.test/?sort=new"], robots),
    /1 looks like a crawl trap and creates 1 crawlable URL variant\(s\) \(X27\), and 1 more is already disallowed by robots\.txt\./,
  );

  // The report lists 20 parameters; the JSON keeps 200 and says so when there are more.
  const keysMd = (/** @type {number} */ n) =>
    mdFor(Array.from({ length: n }, (_, i) => `https://a.test/?k${i}=1`));
  assert.match(keysMd(21), /…and 1 more parameter in site-intelligence\.json\./);
  assert.match(keysMd(205), /…and 185 more parameters; site-intelligence\.json lists the first 200\./);
});

/**
 * A small site whose links carry every kind of parameter. Records each
 * requested path + query.
 * @returns {Promise<{ base: string, requested: string[], close: () => Promise<void> }>}
 */
function parameterSite() {
  /** @type {string[]} */
  const requested = [];
  /** @param {string} title @param {string[]} hrefs */
  const html = (title, hrefs) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>Some text about ${title}.</p>${hrefs.map((h, i) => `<a href="${h}">Link ${i}</a>`).join("")}</body></html>`;
  /** @type {Record<string, string[]>} */
  const routes = {
    "/": [
      "/blog/",
      "/shop/",
      "/about/?x=1&y=2&z=3",
      "/shop/?orderby=price&page=2&view=grid",
      "/?utm_source=nav&utm_medium=menu",
    ],
    "/blog/": [
      ...Array.from({ length: 11 }, (_, i) => `/blog/?e-page-0b1537f=${i + 2}`),
      "/blog/?e-page-1478160=2",
      "/blog/hello/?replytocom=7",
      "/blog/hello/",
    ],
    "/shop/": [
      "/shop/?orderby=price",
      "/shop/?orderby=date",
      ...Array.from({ length: 25 }, (_, i) => `/shop/item?ref=${i + 1}`),
      ...Array.from({ length: 24 }, (_, i) => `/shop/?variant=${i + 1}`),
    ],
    "/about/": [],
    "/blog/hello/": [],
    "/shop/item": [],
  };
  const server = createServer((req, res) => {
    requested.push(req.url ?? "/");
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const origin = `http://${req.headers.host}`;
    if (path === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`User-agent: *\nDisallow: /*?replytocom=\nSitemap: ${origin}/sitemap.xml\n`);
      return;
    }
    if (path === "/sitemap.xml") {
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
          "/",
          "/blog/",
          "/shop/",
          "/about/",
        ]
          .map((p) => `<url><loc>${origin}${p}</loc></url>`)
          .join("")}</urlset>`,
      );
      return;
    }
    const links = routes[path];
    if (!links) {
      res.writeHead(404, { "content-type": "text/html" });
      res.end(html("Not found", []));
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html(`Page ${path}`, links));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        base: `http://127.0.0.1:${port}`,
        requested,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done(undefined));
          }),
      });
    });
  });
}

test("crawlSite inventories every audited page's links, crawled or skipped, and analyzeSite reports X27", async () => {
  clearSiteFilesCache();
  clearSitemapUrlsCache();
  const site = await parameterSite();
  try {
    const crawl = await crawlSite(`${site.base}/`, { pages: 12, crawl: "links", delay: 0 });
    const inv = crawl.urlParameters;
    assert.equal(inv.pagesScanned, crawl.pages.length);
    assert.equal(inv.sitemapUrls, null, "a link crawl does not read the sitemap");
    assert.deepEqual(
      inv.keys.map((k) => k.key),
      [
        "e-page-*",
        "page",
        "orderby",
        "replytocom",
        "utm_source",
        "utm_medium",
        "ref",
        "variant",
        "z",
        "y",
        "x",
        "view",
      ],
    );
    assert.equal(keyOf(inv, "e-page-*")?.count, 12);
    assert.equal(keyOf(inv, "e-page-*")?.maxNumber, 12);
    assert.equal(keyOf(inv, "replytocom")?.blocked, 1);
    assert.equal(keyOf(inv, "ref")?.count, 25);
    assert.equal(keyOf(inv, "ref")?.trap, true);
    assert.equal(keyOf(inv, "variant")?.trap, false);
    assert.equal(inv.parameterLinks, 67);
    assert.equal(inv.trapKeys, 6);
    assert.equal(inv.trapUrls, 41);
    // Skipped links are counted without being requested: page-builder
    // pagination is a crawler trap, and most ?ref= links were beyond the
    // page cap.
    assert.equal(
      site.requested.some((u) => u.includes("e-page-")),
      false,
    );
    assert.ok(site.requested.filter((u) => u.includes("ref=")).length < 25);

    const analysis = analyzeSite({
      pages: crawl.pages,
      failures: crawl.failures,
      redirects: crawl.redirects,
      sitemapUrls: crawl.sitemapUrls,
      capped: crawl.capped,
      urlParameters: inv,
    });
    const x27 = analysis.issues.find((i) => i.id === "X27-parameter-traps");
    assert.equal(x27?.title, "6 URL parameters create 41 crawlable URL variants");
    assert.equal(x27?.severity, "P2");
    assert.deepEqual(
      x27?.urls.map((u) => u.detail.split(" ")[0]),
      ["?e-page-*", "?page", "?orderby", "?utm_source", "?utm_medium", "?ref"],
    );
    assert.equal(
      x27?.urls[5]?.detail,
      `?ref (parameter): 25 URLs, highest value 25 — ${keyOf(inv, "ref")?.why}`,
    );
    // X18 keeps "3+ query parameters" for a URL whose parameters are not
    // traps, and leaves the one with ?orderby and ?page to X27.
    const x18 = analysis.issues.find((i) => i.id === "X18-url-structure");
    assert.deepEqual(
      x18?.urls.map((u) => [new URL(u.url).pathname + new URL(u.url).search, u.detail]),
      [["/about/?x=1&y=2&z=3", "3+ query parameters"]],
    );
    assert.match(x18?.description ?? "", /Parameters that multiply URLs are reported in X27 instead\./);
  } finally {
    await site.close();
  }
});

test("cli: audit writes the inventory and X27 to site-intelligence.json, site-report.md and site-issues.csv", async () => {
  const site = await parameterSite();
  const out = mkdtempSync(join(tmpdir(), "oss-crawl-budget-"));
  try {
    const r = await new Promise(
      /** @param {(v: { code: number, stdout: string, stderr: string }) => void} resolve */ (resolve) => {
        execFile(
          process.execPath,
          [
            CLI,
            "--no-config",
            "audit",
            `${site.base}/`,
            "--pages",
            "12",
            "--crawl",
            "auto",
            "--delay",
            "0",
            "--no-probes",
            "--format",
            "json,md,csv",
            "--out",
            out,
          ],
          {
            timeout: 60000,
            env: {
              ...process.env,
              NO_COLOR: "1",
              ONE_STEP_SEO_STATE_DIR: mkdtempSync(join(tmpdir(), "oss-crawl-budget-state-")),
            },
          },
          (error, stdout, stderr) => {
            resolve({ code: Number(error?.code ?? 0), stdout: String(stdout), stderr: String(stderr) });
          },
        );
      },
    );
    assert.equal(r.code, 0, r.stderr);

    const intel = JSON.parse(readFileSync(join(out, "site-intelligence.json"), "utf8"));
    assert.equal(intel.crawlBudget.sitemapUrls, 4);
    assert.equal(
      intel.crawlBudget.keys.find((/** @type {{ key: string }} */ k) => k.key === "e-page-*").count,
      12,
    );
    assert.ok(intel.crawlBudget.robotsRules.includes("Disallow: /*?e-page-"));
    assert.ok(intel.crawlBudget.robotsRules.includes("Disallow: /*&ref="));
    const x27 = intel.issues.find((/** @type {{ id: string }} */ i) => i.id === "X27-parameter-traps");
    assert.equal(x27.unit, "parameter");
    assert.match(x27.description, /For scale, the sitemap lists 4 URLs\./);

    const md = readFileSync(join(out, "site-report.md"), "utf8");
    assert.match(md, /### URL parameters in internal links/);
    assert.match(md, /- \[crawl trap\] \?e-page-\* \(pagination\): 12 URLs, highest value 12/);
    assert.match(
      md,
      /- \?replytocom \(session\): 1 URL, highest value 7, 1 already disallowed by robots\.txt/,
    );
    assert.match(md, /\[P2\] 6 URL parameters create 41 crawlable URL variants \(heuristic\)/);
    assert.match(md, /`Disallow: \/\*\?e-page-`/);

    const csv = readFileSync(join(out, "site-issues.csv"), "utf8");
    const rows = csv.split("\n").filter((l) => l.includes(",X27-parameter-traps,"));
    assert.equal(rows.length, 6, "one row per crawl-trap parameter");
    assert.ok(rows.some((l) => l.includes("?ref (parameter): 25 URLs, highest value 25")));

    assert.match(readFileSync(join(out, "index.md"), "utf8"), /\(X27-parameter-traps\) — 6 parameter\(s\)\./);
  } finally {
    await site.close();
  }
});
