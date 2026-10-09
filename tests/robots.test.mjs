import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { parseRobots, looksLikeSitemap, countSitemapUrls, getSiteFiles } from "../lib/robots.mjs";
import { parseRobotsGroups, robotsRuleMatches, isDisallowed, AI_BOTS } from "../lib/robots.mjs";

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
    "# comment\nSitemap: https://example.com/sitemap_index.xml\nSitemap: /relative.xml\nSitemap: notaurl\n",
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
    true,
  );
  assert.equal(looksLikeSitemap("<html>nope</html>"), false);
  assert.equal(
    countSitemapUrls("<urlset><url><loc>https://a/</loc></url><url><loc>https://b/</loc></url></urlset>"),
    2,
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
                base,
              ),
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

test("getSiteFiles follows robots-declared sitemap when root is missing", async () => {
  const sf = await getSiteFiles(`${base}/some-page`);
  assert.equal(sf.robots.found, true);
  assert.equal(sf.sitemap.found, true);
  assert.equal(sf.sitemap.url, `${base}/custom-sitemap.xml`);
  assert.equal(sf.sitemap.urlCount, 2);
  assert.equal(sf.llms.found, false);
});

test("getSiteFiles returns an empty shape for garbage URLs", async () => {
  const sf = await getSiteFiles("not a url");
  assert.equal(sf.origin, "");
  assert.equal(sf.robots.found, false);
  assert.equal(sf.robots.text, "");
  assert.equal(sf.llms.text, "");
});

test("AI_BOTS is a non-empty lowercase token list", () => {
  assert.ok(Array.isArray(AI_BOTS) && AI_BOTS.length >= 10);
  for (const b of AI_BOTS) assert.equal(b, b.toLowerCase());
  assert.ok(AI_BOTS.includes("gptbot") && AI_BOTS.includes("claudebot"));
});

test("parseRobotsGroups splits User-agent groups on rule lines", () => {
  const groups = parseRobotsGroups("User-agent: a\nUser-agent: b\nDisallow: /x\nUser-agent: c\nAllow: /\n");
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0]?.agents, ["a", "b"]);
  assert.deepEqual(groups[0]?.rules, [{ type: "disallow", path: "/x" }]);
  assert.deepEqual(groups[1]?.agents, ["c"]);
});

test("robotsRuleMatches handles prefix, wildcard and end-anchor", () => {
  assert.equal(robotsRuleMatches("/admin", "/admin/dashboard"), true);
  assert.equal(robotsRuleMatches("/admin", "/public"), false);
  assert.equal(robotsRuleMatches("/*.pdf", "/files/guide.pdf"), true);
  assert.equal(robotsRuleMatches("/*.pdf", "/files/guide.pdf?v=2"), true);
  assert.equal(robotsRuleMatches("/exact$", "/exact"), true);
  assert.equal(robotsRuleMatches("/exact$", "/exact/more"), false);
  assert.equal(robotsRuleMatches("/", "/anything"), true);
});

test("isDisallowed honors star groups, specific tokens and Allow ties", () => {
  assert.equal(isDisallowed("User-agent: *\nDisallow: /\n", "one-step-seo", "/"), true);
  assert.equal(isDisallowed("User-agent: *\nDisallow:\n", "one-step-seo", "/"), false);
  assert.equal(isDisallowed("", "one-step-seo", "/"), false);
  // Specific token group wins over star.
  const mixed = "User-agent: *\nDisallow: /\n\nUser-agent: one-step-seo\nDisallow: /private\n";
  assert.equal(isDisallowed(mixed, "one-step-seo", "/public"), false);
  assert.equal(isDisallowed(mixed, "one-step-seo", "/private/x"), true);
  assert.equal(isDisallowed(mixed, "other-bot", "/public"), true);
  // Longest match wins; Allow wins ties.
  const tie = "User-agent: *\nDisallow: /x\nAllow: /x\n";
  assert.equal(isDisallowed(tie, "one-step-seo", "/x"), false);
  const longer = "User-agent: *\nDisallow: /\nAllow: /public\n";
  assert.equal(isDisallowed(longer, "one-step-seo", "/public/page"), false);
  assert.equal(isDisallowed(longer, "one-step-seo", "/other"), true);
  // Query strings are ignored for matching.
  assert.equal(isDisallowed("User-agent: *\nDisallow: /search\n", "one-step-seo", "/search?q=x"), true);
});
