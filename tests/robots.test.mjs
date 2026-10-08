import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { parseRobots, looksLikeSitemap, countSitemapUrls, getSiteFiles } from "../lib/robots.mjs";

test("parseRobots detects AI crawler blocks", () => {
  const r = parseRobots("User-agent: GPTBot\nDisallow: /\n");
  assert.equal(r.aiBlocked, true);
  assert.equal(r.disallows.length, 1);
});

test("parseRobots ignores non-AI and partial blocks", () => {
  const r = parseRobots("User-agent: *\nDisallow: /admin/\n\nUser-agent: GPTBot\nDisallow: /private/\n");
  assert.equal(r.aiBlocked, false);
  assert.equal(r.disallows.length, 2);
});

test("parseRobots collects absolute Sitemap directives, skips junk", () => {
  const r = parseRobots(
    "# comment\nSitemap: https://example.com/sitemap_index.xml\nSitemap: /relative.xml\nSitemap: notaurl\n"
  );
  assert.deepEqual(r.sitemaps, ["https://example.com/sitemap_index.xml"]);
});

test("parseRobots tolerates malformed lines", () => {
  const r = parseRobots("garbage line without colon\n:\nUser-agent: *\n");
  assert.equal(r.aiBlocked, false);
  assert.deepEqual(r.sitemaps, []);
});

test("looksLikeSitemap and countSitemapUrls", () => {
  assert.equal(
    looksLikeSitemap('<?xml version="1.0"?><urlset><url><loc>https://a/</loc></url></urlset>'),
    true
  );
  assert.equal(looksLikeSitemap("<html>nope</html>"), false);
  assert.equal(
    countSitemapUrls("<urlset><url><loc>https://a/</loc></url><url><loc>https://b/</loc></url></urlset>"),
    2
  );
  assert.equal(countSitemapUrls(""), 0);
});

/** @type {import("node:http").Server | null} */
let server = null;
/** @type {string} */
let base = "";

before(
  () =>
    /** @type {Promise<void>} */ (
      new Promise((resolve) => {
        server = http.createServer((req, res) => {
          if (req.url === "/robots.txt") {
            res.writeHead(200, { "content-type": "text/plain" });
            res.end(`User-agent: *\nDisallow: /admin/\nSitemap: ${base}/custom-sitemap.xml\n`);
          } else if (req.url === "/sitemap.xml") {
            res.writeHead(404, { "content-type": "text/html" });
            res.end("missing");
          } else if (req.url === "/custom-sitemap.xml") {
            res.writeHead(200, { "content-type": "application/xml" });
            res.end(
              '<?xml version="1.0"?><urlset><url><loc>${base}/</loc></url><url><loc>${base}/a</loc></url></urlset>'.replaceAll(
                "${base}",
                base
              )
            );
          } else if (req.url === "/llms.txt") {
            res.writeHead(404);
            res.end();
          } else {
            res.writeHead(404);
            res.end();
          }
        });
        server.listen(0, "127.0.0.1", () => {
          const addr = server?.address();
          base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
          resolve();
        });
      })
    )
);

after(
  () =>
    /** @type {Promise<void>} */ (
      new Promise((resolve) => {
        if (server) server.close(() => resolve());
        else resolve();
      })
    )
);

test("getSiteFiles follows robots-declared sitemap when root is missing", async () => {
  const sf = await getSiteFiles(`${base}/some-page`);
  assert.equal(sf.robots.found, true);
  assert.equal(sf.sitemap.found, true);
  assert.equal(sf.sitemap.url, `${base}/custom-sitemap.xml`);
  assert.equal(sf.sitemap.urlCount, 2);
  assert.equal(sf.llms.found, false);
});
