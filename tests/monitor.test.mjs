// SEO Monitoring engine: real crawls of a local site, mutated between runs,
// compared snapshot-to-snapshot; persistence, pruning and webhook delivery.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crawlSite } from "../lib/crawl.mjs";
import { clearSiteFilesCache, clearSitemapUrlsCache } from "../lib/robots.mjs";
import {
  buildSnapshot,
  isSnapshot,
  compareSnapshots,
  summarizeChanges,
  monitorDir,
  saveSnapshot,
  listSnapshots,
  loadLatestSnapshot,
  appendChangeLog,
  sendWebhook,
} from "../lib/monitor.mjs";
import { readJson } from "../lib/state.mjs";
import { startSite, siteRoutes, page } from "./helpers/site-fixture.mjs";

/** @param {string} base */
async function snap(base) {
  // Site files are cached per origin inside one process; a monitor run is a
  // fresh process in real use, so drop the caches between snapshots.
  clearSiteFilesCache();
  clearSitemapUrlsCache();
  const crawl = await crawlSite(`${base}/`, { pages: 50, crawl: "auto", all: true, delay: 0 });
  return buildSnapshot(crawl);
}

test("unchanged site produces no changes; mutations produce leveled, critical-first changes", async () => {
  const routes = siteRoutes();
  const site = await startSite(routes);
  try {
    const first = await snap(site.base);
    assert.ok(isSnapshot(first));
    assert.equal(first.available, true);
    assert.equal(Object.keys(first.pages).length, 7);

    const same = await snap(site.base);
    assert.deepEqual(
      compareSnapshots(first, same).filter((c) => c.type !== "response-slower"),
      [],
      "no false alarms between identical crawls",
    );

    // Deliberate regressions.
    routes["/guide"] = {
      body: page({
        title: "Crawling and Indexing Guide for Site Owners",
        description: "x".repeat(130),
        head: `<meta name="robots" content="noindex">`,
      }),
    };
    routes["/pricing"] = { status: 500, body: "<html><body>error</body></html>" };
    routes["/plans"] = {
      body: page({ title: "Completely New Plans Title For Teams", description: "y".repeat(130) }),
    };
    routes["/robots.txt"] = {
      type: "text/plain",
      body: "User-agent: *\nDisallow: /tmp\nSitemap: {base}/sitemap.xml\n",
    };

    const second = await snap(site.base);
    const changes = compareSnapshots(first, second);
    const types = new Set(changes.map((c) => c.type));
    assert.ok(types.has("noindex-added"), "noindex added is detected");
    assert.ok(types.has("page-broken"), "a page now returning 500 is detected");
    assert.ok(types.has("title-changed"));
    assert.ok(types.has("robots-changed"));
    const noindex = changes.find((c) => c.type === "noindex-added");
    assert.equal(noindex?.level, "critical");
    assert.equal(new URL(noindex?.url ?? "").pathname, "/guide");
    // Sorted critical first.
    const rank = { critical: 0, warning: 1, info: 2 };
    for (let i = 1; i < changes.length; i++) {
      assert.ok(rank[changes[i - 1]?.level ?? "info"] <= rank[changes[i]?.level ?? "info"]);
    }
    const summary = summarizeChanges(changes);
    assert.ok(summary.critical >= 2);
    assert.equal(summary.critical + summary.warning + summary.info, changes.length);
  } finally {
    await site.close();
  }
});

test("a site that goes down is reported critical, and recovery is reported", () => {
  const up = /** @type {any} */ ({
    tool: "one-step-seo",
    version: "x",
    takenAt: "2026-01-01T00:00:00.000Z",
    startUrl: "https://a.example/",
    available: true,
    site: {
      robotsFound: true,
      robotsHash: "a",
      sitemapFound: true,
      sitemapUrlCount: 1,
      sitemapHash: "b",
      llmsFound: false,
    },
    pages: {},
    failures: [],
    sitemapUrls: [],
    averages: { search: 90, ai: 80 },
  });
  const down = {
    ...up,
    available: false,
    failures: [{ url: "https://a.example/", status: 0, error: "ECONNREFUSED" }],
  };
  const out = compareSnapshots(up, down);
  assert.equal(out[0]?.type, "site-unavailable");
  assert.equal(out[0]?.level, "critical");
  assert.ok(compareSnapshots(down, up).some((c) => c.type === "site-recovered"));
});

test("snapshots persist per host, prune to --keep, and the change log is capped", () => {
  const state = mkdtempSync(join(tmpdir(), "oss-monitor-"));
  try {
    const dir = monitorDir(state, "https://www.example.com:8443/path");
    assert.match(dir, /monitor/);
    const base = /** @type {any} */ ({
      tool: "one-step-seo",
      version: "x",
      startUrl: "https://www.example.com/",
      available: true,
      site: {
        robotsFound: true,
        robotsHash: "",
        sitemapFound: false,
        sitemapUrlCount: 0,
        sitemapHash: "",
        llmsFound: false,
      },
      pages: {},
      failures: [],
      sitemapUrls: [],
      averages: { search: null, ai: null },
    });
    for (let i = 0; i < 5; i++) {
      saveSnapshot(dir, { ...base, takenAt: `2026-01-0${i + 1}T00:00:00.000Z` }, 3);
    }
    assert.equal(listSnapshots(dir).length, 3);
    assert.equal(loadLatestSnapshot(dir)?.takenAt, "2026-01-05T00:00:00.000Z");
    for (let i = 0; i < 4; i++) {
      appendChangeLog(
        dir,
        { takenAt: String(i), summary: { critical: 0, warning: 0, info: 0 }, changes: [] },
        2,
      );
    }
    const log = readJson(join(dir, "changes.json"));
    assert.ok(Array.isArray(log));
    assert.deepEqual(
      log.map((/** @type {any} */ e) => e.takenAt),
      ["2", "3"],
    );
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test("sendWebhook posts a Slack-compatible JSON alert and never leaks the URL in errors", async () => {
  /** @type {any} */
  let received = null;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received = { method: req.method, type: req.headers["content-type"], body: JSON.parse(body) };
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
  const port = /** @type {any} */ (server.address()).port;
  try {
    const alert = {
      site: "https://a.example/",
      takenAt: "2026-01-01T00:00:00.000Z",
      summary: { critical: 1, warning: 0, info: 0 },
      changes: [
        {
          type: "noindex-added",
          level: /** @type {const} */ ("critical"),
          url: "https://a.example/x",
          message: "Page is now noindex",
        },
      ],
    };
    const ok = await sendWebhook(`http://127.0.0.1:${port}/hooks/SECRET-TOKEN`, alert);
    assert.deepEqual(ok, { ok: true, status: 200, error: "" });
    assert.equal(received.method, "POST");
    assert.match(received.type, /application\/json/);
    assert.match(received.body.text, /1 critical/);
    assert.equal(received.body.changes.length, 1);

    const bad = await sendWebhook("ftp://example.com/x", alert);
    assert.equal(bad.ok, false);
    const failed = await sendWebhook("http://127.0.0.1:1/hooks/SECRET-TOKEN", alert, { timeoutMs: 2000 });
    assert.equal(failed.ok, false);
    assert.doesNotMatch(failed.error, /SECRET-TOKEN/);
  } finally {
    await new Promise((r) => server.close(() => r(null)));
  }
});
