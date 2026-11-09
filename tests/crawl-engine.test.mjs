import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { getSitemapUrls, clearSitemapUrlsCache } from "../lib/robots.mjs";
import {
  buildReport,
  buildSiteReport,
  renderSiteIndex,
  summarizeAggregate,
  siteTopFindings,
  findDuplicateTitles,
} from "../lib/report.mjs";
import { canonicalizeUrl, parseArgs } from "../lib/args.mjs";

test("crawl-engine: multi-sitemap index, gzip (.xml.gz), CDATA and entity unescaping", async () => {
  clearSitemapUrlsCache();

  // Child sitemap 1 with CDATA & XML entities
  const child1Xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc><![CDATA[http://SERVER/products?item=1&amp;category=seo]]></loc>
  </url>
  <url>
    <loc>http://SERVER/products?cat=books&amp;sort=asc</loc>
  </url>
</urlset>`;

  // Child sitemap 2 compressed with gzip
  const child2Xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>http://SERVER/archive/2026/01</loc></url>
  <url><loc>http://SERVER/archive/2026/02</loc></url>
</urlset>`;

  // Sitemap index pointing to child 1
  const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>http://SERVER/child-1.xml</loc>
  </sitemap>
</sitemapindex>`;

  const server = createServer((req, res) => {
    const url = req.url || "/";
    if (url === "/robots.txt") {
      const robots = [
        "User-agent: *",
        "Allow: /",
        `Sitemap: http://${req.headers.host}/sitemap-index.xml`,
        `Sitemap: http://${req.headers.host}/archive-sitemap.xml.gz`,
      ].join("\n");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(robots);
    } else if (url === "/sitemap-index.xml") {
      const body = indexXml.replaceAll("http://SERVER", `http://${req.headers.host}`);
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(body);
    } else if (url === "/child-1.xml") {
      const body = child1Xml.replaceAll("http://SERVER", `http://${req.headers.host}`);
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(body);
    } else if (url === "/archive-sitemap.xml.gz") {
      const bodyGz = gzipSync(
        Buffer.from(child2Xml.replaceAll("http://SERVER", `http://${req.headers.host}`), "utf8"),
      );
      res.writeHead(200, {
        "Content-Type": "application/x-gzip",
        "Content-Encoding": "gzip",
      });
      res.end(bodyGz);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
  const baseUrl = `http://127.0.0.1:${port}/`;

  try {
    const urls = await getSitemapUrls(baseUrl, { blockPrivateIps: false });

    // Assert that URLs were extracted from both sitemaps in robots.txt
    assert.ok(urls.length >= 4, `Expected at least 4 URLs, got ${urls.length}`);

    // CDATA & XML entity unescaped check
    const hasUnescapedAmp = urls.some((u) => u.includes("item=1&category=seo"));
    assert.ok(hasUnescapedAmp, "CDATA URL with &amp; must be unescaped to &");

    const hasEntityUrl = urls.some((u) => u.includes("cat=books&sort=asc"));
    assert.ok(hasEntityUrl, "XML entity &amp; in <loc> must be unescaped to &");

    // Gzip decompressed check
    const hasGzipUrl1 = urls.some((u) => u.includes("/archive/2026/01"));
    const hasGzipUrl2 = urls.some((u) => u.includes("/archive/2026/02"));
    assert.ok(hasGzipUrl1 && hasGzipUrl2, "Gzip compressed sitemap URLs must be transparently decompressed");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    clearSitemapUrlsCache();
  }
});

test("crawl-engine: crawl boundary filters (--max-depth, --include, --exclude, --strip-query)", () => {
  // Test canonicalizeUrl with stripAllQuery
  const urlWithParams = "https://example.com/products/item?page=2&color=blue&ref=banner";
  const stripped = canonicalizeUrl(urlWithParams, true);
  assert.equal(stripped, "https://example.com/products/item");

  // Extended tracking params stripping without stripAllQuery
  const urlWithTracking = "https://example.com/article?mc_cid=1234&srsltid=abcd&keep=yes";
  const cleanedTracking = canonicalizeUrl(urlWithTracking, false);
  assert.equal(cleanedTracking, "https://example.com/article?keep=yes");

  // Test argument parsing for crawl boundary flags
  const args = parseArgs([
    "audit",
    "https://example.com",
    "--max-depth",
    "3",
    "--include",
    "^/products/.*",
    "--exclude",
    "^/products/discontinued/.*",
    "--strip-query",
  ]);

  assert.equal(args.maxDepth, 3);
  assert.equal(args.include, "^/products/.*");
  assert.equal(args.exclude, "^/products/discontinued/.*");
  assert.equal(args.stripQuery, true);

  // Boundary regex filter simulation
  const includeRe = new RegExp(args.include);
  const excludeRe = new RegExp(args.exclude);

  const testPaths = [
    { path: "/products/shoes", included: true },
    { path: "/products/discontinued/old-shoe", included: false },
    { path: "/blog/seo-tips", included: false },
  ];

  for (const { path, included } of testPaths) {
    const passes = includeRe.test(path) && !excludeRe.test(path);
    assert.equal(passes, included, `Path ${path} inclusion check failed`);
  }
});

test("crawl-engine: 1,000-page scale simulation & performance benchmark", () => {
  const TOTAL_PAGES = 1000;
  const reports = [];

  const startMem = process.memoryUsage().heapUsed;
  const startTime = performance.now();

  for (let i = 1; i <= TOTAL_PAGES; i++) {
    const isOdd = i % 2 === 1;
    reports.push(
      buildReport({
        url: `https://enterprise.example.com/catalog/item-${i}`,
        finalUrl: `https://enterprise.example.com/catalog/item-${i}`,
        scores: {
          search: { score: isOdd ? 85 : 92, band: isOdd ? "B" : "A" },
          ai: { score: isOdd ? 75 : 88, band: isOdd ? "C" : "B" },
        },
        findings: isOdd
          ? [
              {
                id: "T02-meta-description",
                category: "onpage",
                severity: "P2",
                title: "Missing meta description",
                evidence: "No meta description found",
                fix: "Add <meta name='description'>",
                seoImpact: "med",
                geoImpact: "none",
              },
            ]
          : [],
        pageData: {
          title: i % 10 === 0 ? "Duplicate Product Title" : `Product ${i} — Enterprise Store`,
          description: `Description for product ${i}`,
          canonical: `https://enterprise.example.com/catalog/item-${i}`,
        },
      }),
    );
  }

  assert.equal(reports.length, TOTAL_PAGES);

  // 1. Aggregate calculation benchmark
  const agg = summarizeAggregate(reports);
  assert.equal(agg.searchValid, TOTAL_PAGES);
  assert.equal(agg.aiValid, TOTAL_PAGES);
  assert.ok(agg.avgSearch !== null && agg.avgSearch > 80);

  // 2. Duplicate title grouping benchmark
  const dups = findDuplicateTitles(reports);
  const dupEntry = dups.find((d) => d.value.toLowerCase() === "duplicate product title");
  assert.ok(dupEntry, "Duplicate product titles must be detected");
  assert.equal(dupEntry.pages.length, 100, "Expected exactly 100 occurrences of duplicate title");

  // 3. Top findings aggregation benchmark
  const topIssues = siteTopFindings(reports, 5);
  assert.ok(topIssues.length > 0);
  const firstIssue = topIssues[0];
  assert.ok(firstIssue);
  assert.equal(firstIssue.finding.id, "T02-meta-description");
  assert.equal(firstIssue.pages, 500); // 500 odd pages

  // 4. Consolidated site report build
  const siteRep = buildSiteReport(reports, { origin: "https://enterprise.example.com" });
  assert.equal(siteRep.pageCount, TOTAL_PAGES);
  assert.equal(siteRep.origin, "https://enterprise.example.com");

  // 5. Dashboard HTML generation benchmark
  const html = renderSiteIndex(reports);

  const durationMs = performance.now() - startTime;
  const memDeltaMb = (process.memoryUsage().heapUsed - startMem) / (1024 * 1024);

  assert.ok(typeof html === "string" && html.length > 50000);
  assert.ok(html.includes("1000"), "Dashboard must indicate 1000 pages audited");
  assert.ok(html.includes("item-1000"), "Dashboard table must include final item");
  assert.ok(
    !html.includes("NaN") && !html.includes("undefined"),
    "Dashboard HTML must not contain NaN or undefined",
  );

  // Throughput and memory verification
  assert.ok(
    durationMs < 2000,
    `1,000-page aggregation & HTML render took ${durationMs.toFixed(1)}ms (must be < 2000ms)`,
  );
  assert.ok(memDeltaMb < 100, `Memory delta ${memDeltaMb.toFixed(1)}MB must stay bounded (< 100MB)`);
});
