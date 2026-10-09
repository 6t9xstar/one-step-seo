/**
 * Coverage for the `--crawl sitemap` seeding logic added in v0.2.0:
 * extractSitemapUrls / getSitemapUrls / clearSitemapUrlsCache.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  extractSitemapUrls,
  getSitemapUrls,
  clearSitemapUrlsCache,
  clearSiteFilesCache,
  MAX_SITEMAP_CHILDREN,
  MAX_SITEMAP_SEED_URLS,
} from "../lib/robots.mjs";

// ---------- pure functions ----------

test("extractSitemapUrls reads <loc> entries from a urlset", () => {
  const xml = `<?xml version="1.0"?><urlset><url><loc>https://a.com/</loc></url><url><loc>https://a.com/x</loc></url><url><loc>https://a.com/y</loc></url></urlset>`;
  assert.deepEqual(extractSitemapUrls(xml), ["https://a.com/", "https://a.com/x", "https://a.com/y"]);
});

test("extractSitemapUrls returns child sitemaps for a sitemapindex", () => {
  const xml = `<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap><sitemap><loc>https://a.com/s2.xml</loc></sitemap></sitemapindex>`;
  assert.deepEqual(extractSitemapUrls(xml), ["https://a.com/s1.xml", "https://a.com/s2.xml"]);
});

test("extractSitemapUrls reads plaintext one-URL-per-line sitemaps", () => {
  assert.deepEqual(extractSitemapUrls("https://a.com/1\nhttps://a.com/2\n"), [
    "https://a.com/1",
    "https://a.com/2",
  ]);
});

test("extractSitemapUrls tolerates whitespace and drops non-absolute URLs", () => {
  assert.deepEqual(
    extractSitemapUrls(
      "<urlset><url><loc>  https://a.com/x  </loc></url><url><loc>/relative</loc></url></urlset>",
    ),
    ["https://a.com/x"],
  );
});

test("extractSitemapUrls returns [] for empty, HTML and junk bodies", () => {
  for (const bad of [
    "",
    "   ",
    "<html><body>nope</body></html>",
    "not a sitemap at all",
    "<urlset></urlset>",
  ]) {
    assert.deepEqual(extractSitemapUrls(bad), [], `expected [] for ${JSON.stringify(bad)}`);
  }
});

test("sitemap caps are exported and sane", () => {
  assert.equal(typeof MAX_SITEMAP_CHILDREN, "number");
  assert.ok(MAX_SITEMAP_CHILDREN >= 1 && MAX_SITEMAP_CHILDREN <= 20);
  assert.ok(MAX_SITEMAP_SEED_URLS >= MAX_SITEMAP_CHILDREN);
});

// ---------- integration against a live fixture server ----------

/** @type {import("node:http").Server | null} */
let server = null;
/** @type {string} */
let base = "";

before(
  () =>
    /** @type {Promise<void>} */ (
      new Promise((resolve) => {
        server = http.createServer((req, res) => {
          const path = (req.url ?? "/").split("?")[0];
          if (path === "/robots.txt") {
            // Points at a sitemap the root URL does not serve.
            res.writeHead(200, { "content-type": "text/plain" });
            res.end(`User-agent: *\nDisallow:\nSitemap: ${base}/declared.xml\n`);
          } else if (path === "/sitemap.xml") {
            // Root sitemap is an index of two children.
            res.writeHead(200, { "content-type": "application/xml" });
            res.end(
              `<sitemapindex><sitemap><loc>${base}/child-1.xml</loc></sitemap><sitemap><loc>${base}/child-2.xml</loc></sitemap></sitemapindex>`,
            );
          } else if (path === "/child-1.xml") {
            res.writeHead(200, { "content-type": "application/xml" });
            res.end(`<urlset><url><loc>${base}/a</loc></url><url><loc>${base}/b</loc></url></urlset>`);
          } else if (path === "/child-2.xml") {
            res.writeHead(200, { "content-type": "application/xml" });
            res.end(`<urlset><url><loc>${base}/c</loc></url></urlset>`);
          } else if (path === "/declared.xml") {
            res.writeHead(200, { "content-type": "application/xml" });
            res.end(`<urlset><url><loc>${base}/from-robots</loc></url></urlset>`);
          } else if (path === "/llms.txt") {
            res.writeHead(404);
            res.end("not found");
          } else {
            res.writeHead(404, { "content-type": "text/html" });
            res.end("nope");
          }
        });
        server.listen(0, "127.0.0.1", () => {
          const addr = server?.address();
          base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
          resolve();
        });
      })
    ),
);

after(
  () =>
    /** @type {Promise<void>} */ (
      new Promise((resolve) => {
        if (server) server.close(() => resolve());
        else resolve();
      })
    ),
);

// getSiteFiles and getSitemapUrls both cache per origin; without this the
// first test's result would leak into every later one.
beforeEach(() => {
  clearSiteFilesCache();
  clearSitemapUrlsCache();
});

test("getSitemapUrls follows sitemap-index children", async () => {
  const urls = await getSitemapUrls(`${base}/some-page`);
  assert.ok(urls.length >= 3, `expected page URLs from children, got ${JSON.stringify(urls)}`);
  assert.ok(urls.includes(`${base}/a`), `expected /a in ${JSON.stringify(urls)}`);
  assert.ok(urls.includes(`${base}/c`), `expected /c in ${JSON.stringify(urls)}`);
  // Child sitemap URLs must never be returned as if they were pages.
  assert.ok(!urls.includes(`${base}/child-1.xml`));
});

test("getSitemapUrls never throws when there is no sitemap", async () => {
  const urls = await getSitemapUrls("http://127.0.0.1:1/not-listening");
  assert.deepEqual(urls, []);
});

test("getSitemapUrls returns [] for an unparseable page URL", async () => {
  assert.deepEqual(await getSitemapUrls("not a url"), []);
  assert.deepEqual(await getSitemapUrls("ftp://example.com"), []);
});

test("clearSitemapUrlsCache forces a refetch", async () => {
  const first = await getSitemapUrls(`${base}/some-page`);
  assert.ok(first.length > 0);
  clearSitemapUrlsCache();
  const second = await getSitemapUrls(`${base}/some-page`);
  assert.deepEqual(second, first);
});

test("getSitemapUrls drops cross-host seeds", async () => {
  const srv = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nDisallow:\n");
    } else if (path === "/sitemap.xml") {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const origin = `http://127.0.0.1:${port}`;
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(
        `<urlset><url><loc>${origin}/local</loc></url><url><loc>https://evil.example/stolen</loc></url></urlset>`,
      );
    } else if (path === "/llms.txt") {
      res.writeHead(404);
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve(undefined)));
  try {
    const addr = srv.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const urls = await getSitemapUrls(`http://127.0.0.1:${port}/x`);
    assert.ok(urls.includes(`http://127.0.0.1:${port}/local`));
    assert.ok(
      !urls.some((u) => u.includes("evil.example")),
      `cross-host seed leaked: ${JSON.stringify(urls)}`,
    );
  } finally {
    await new Promise((resolve) => srv.close(() => resolve(undefined)));
  }
});
