// Crawler readability check (ported from Open SEO Crawler, MIT): robots.txt
// precedence per crawler, the page sample, the browser comparison, mobile
// parity, the site issues X24–X26, and the `bots` / `audit --bots` CLI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOT_AGENTS,
  botRobotsAllowed,
  compareWithBrowser,
  readBotResponse,
  runBotCheck,
  sampleBotPages,
  shingleSimilarity,
} from "../lib/bot-check.mjs";
import { analyzeSite } from "../lib/intelligence.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin/cli.mjs");
const TEST_ENV = { ...process.env, ONE_STEP_SEO_STATE_DIR: mkdtempSync(join(tmpdir(), "oss-bots-state-")) };

/**
 * @param {string[]} args
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function runCli(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { timeout: 60000, env: TEST_ENV }, (error, stdout, stderr) => {
      resolve({ code: Number(error?.code ?? 0), stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

/** @param {number} n @param {number} [from] */
const words = (n, from = 0) => Array.from({ length: n }, (_, i) => `word${i + from}`).join(" ");

/** @param {string} title @param {string} h1 @param {string} body @param {string} [head] */
const page = (title, h1, body, head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><h1>${h1}</h1><p>${body}</p></body></html>`;

/** @param {Partial<import("../lib/bot-check.mjs").BotSnapshot>} [over] @returns {import("../lib/bot-check.mjs").BotSnapshot} */
const snap = (over = {}) => ({
  status: 200,
  finalUrl: "https://example.com/",
  html: "",
  headers: {},
  challenge: false,
  cdn: "",
  waf: "",
  error: "",
  ...over,
});

test("botRobotsAllowed: longest rule wins, a tie goes to Allow, Applebot follows Googlebot", () => {
  const robots = [
    "User-agent: *",
    "Disallow: /private/",
    "Allow: /private/press",
    "",
    "User-agent: Googlebot",
    "Disallow: /drafts/",
    "",
    "User-agent: GPTBot",
    "Disallow: /",
    "",
    "User-agent: CCBot",
    "Disallow: /docs",
    "Allow: /docs",
  ].join("\n");
  /** @param {string} p */
  const u = (p) => `https://example.com${p}`;
  assert.equal(botRobotsAllowed(robots, "Bingbot", u("/private/x")), false);
  assert.equal(botRobotsAllowed(robots, "Bingbot", u("/private/press-kit")), true, "the longer Allow wins");
  assert.equal(botRobotsAllowed(robots, "Googlebot", u("/private/x")), true, "its own group replaces *");
  assert.equal(botRobotsAllowed(robots, "Googlebot", u("/drafts/a")), false);
  assert.equal(botRobotsAllowed(robots, "Applebot", u("/drafts/a")), false, "Applebot follows Googlebot");
  assert.equal(botRobotsAllowed(robots, "Applebot", u("/private/x")), true);
  assert.equal(botRobotsAllowed(robots, "GPTBot", u("/")), false);
  assert.equal(botRobotsAllowed(robots, "CCBot", u("/docs/a")), true, "a tie goes to Allow");
  assert.equal(botRobotsAllowed("", "GPTBot", u("/")), true, "no robots.txt allows everyone");
  const named = "User-agent: Googlebot\nDisallow: /\n\nUser-agent: Applebot\nDisallow:\n";
  assert.equal(botRobotsAllowed(named, "Applebot", u("/x")), true, "a group naming Applebot wins");
});

test("sampleBotPages: start page, one page per section, then the shallowest; skips what cannot be compared", () => {
  /** @param {string} path @param {Record<string, unknown>} [extra] */
  const p = (path, extra = {}) => ({
    finalUrl: `https://example.com${path}`,
    key: `https://example.com${path}`,
    status: 200,
    noindex: false,
    canonicalKey: "",
    contentHash: path,
    ...extra,
  });
  const pages = [
    p("/"),
    p("/blog/deep/post-1"),
    p("/blog/"),
    p("/shop/item-1"),
    p("/index.html", { contentHash: "/" }), // the start page's body again
    p("/hidden/", { noindex: true }),
    p("/gone", { status: 404 }),
    p("/dup", { canonicalKey: "https://example.com/" }),
    p("/about"),
    p("/blog/post-2"),
  ];
  /** @param {string[]} urls */
  const paths = (urls) => urls.map((x) => new URL(x).pathname);
  assert.deepEqual(paths(sampleBotPages(pages, 4)), ["/", "/blog/", "/about", "/shop/item-1"]);
  assert.deepEqual(paths(sampleBotPages(pages)), [
    "/",
    "/blog/",
    "/about",
    "/shop/item-1",
    "/blog/post-2",
    "/blog/deep/post-1",
  ]);
  assert.deepEqual(sampleBotPages([]), []);
});

test("readBotResponse: noindex from robots meta, the crawler's own meta and scoped X-Robots-Tag", () => {
  const url = "https://example.com/";
  const plain = page("T", "H", words(30));
  assert.equal(readBotResponse(plain, {}, url).noindex, false);
  assert.equal(
    readBotResponse(page("T", "H", "x", '<meta name="robots" content="none">'), {}, url).noindex,
    true,
  );
  const scoped = { "x-robots-tag": "googlebot: noindex" };
  assert.equal(readBotResponse(plain, scoped, url, "Googlebot").noindex, true);
  assert.equal(readBotResponse(plain, scoped, url, "Bingbot").noindex, false);
  assert.equal(readBotResponse(plain, scoped, url).noindex, false, "a browser ignores crawler-scoped lines");
  assert.equal(readBotResponse(plain, { "X-Robots-Tag": "noindex" }, url, "GPTBot").noindex, true);
  const own = page("T", "H", "x", '<meta name="GPTBot" content="noindex, nofollow">');
  assert.equal(readBotResponse(own, {}, url, "GPTBot").noindex, true);
  assert.equal(readBotResponse(own, {}, url, "CCBot").noindex, false);
  const commented = page("T", "H", "x", '<!-- <meta name="gptbot" content="noindex"> -->');
  assert.equal(readBotResponse(commented, {}, url, "GPTBot").noindex, false, "comments are not markup");

  const read = readBotResponse(
    page("  A   title ", "Main", words(10), '<link rel="canonical" href="/c">'),
    {},
    url,
  );
  assert.equal(read.title, "A title");
  assert.equal(read.h1, "Main");
  assert.equal(read.canonical, "https://example.com/c");
  assert.equal(read.words, 11, "the H1 counts, the title does not");
  assert.equal(read.shingles.size, 9);
  assert.equal(shingleSimilarity(new Set(), new Set()), 1);
  assert.equal(shingleSimilarity(new Set(["a b c"]), new Set()), 0);
});

test("compareWithBrowser: every state, and a page that changes on its own earns a looser threshold", () => {
  const url = "https://example.com/";
  const baseHtml = page("Home", "Welcome", words(100));
  const base = snap({ html: baseHtml });
  const baseRead = readBotResponse(baseHtml, {}, url);
  /** @param {string} html @param {Partial<import("../lib/bot-check.mjs").BotSnapshot>} [over] @param {string} [token] */
  const cmp = (html, over = {}, token = "", self = 1) =>
    compareWithBrowser(
      base,
      baseRead,
      snap({ html, ...over }),
      readBotResponse(html, over.headers ?? {}, url, token),
      self,
    );

  assert.equal(cmp(baseHtml).state, "same");
  const thinner = cmp(page("Home", "Welcome", words(40)));
  assert.equal(thinner.state, "thinner", "a cut-down copy is thinner, not different");
  assert.equal(thinner.detail, "41 of 101 words");
  assert.deepEqual(cmp(page("Home", "Welcome", words(100, 1000))).fields, ["text"]);
  assert.deepEqual(cmp(page("Other", "Welcome", words(100))).fields, ["title"]);
  assert.deepEqual(cmp(page("Home", "Hello", words(100))).fields, ["h1"]);
  const noindex = cmp(baseHtml, { headers: { "x-robots-tag": "bingbot: noindex" } }, "Bingbot");
  assert.equal(noindex.state, "noindex");

  assert.deepEqual(cmp("", { status: 403 }), { state: "blocked", status: 403, detail: "HTTP 403" });
  assert.equal(cmp("", { status: 403, waf: "wordfence" }).detail, "HTTP 403, Wordfence firewall");
  assert.equal(
    cmp("", { status: 403, challenge: true, cdn: "Cloudflare" }).detail,
    "Cloudflare challenge (HTTP 403)",
  );
  assert.equal(cmp("", { status: 404 }).detail, "HTTP 404, a browser got 200");
  assert.equal(cmp(baseHtml, { finalUrl: "https://example.com/elsewhere" }).state, "redirected");
  assert.equal(
    cmp(baseHtml, { finalUrl: "https://example.com/#top" }).state,
    "same",
    "fragments do not count",
  );
  const error = compareWithBrowser(
    base,
    baseRead,
    snap({ status: 0, error: "timeout after 15000ms" }),
    null,
    1,
  );
  assert.deepEqual(error, { state: "error", status: 0, detail: "timeout after 15000ms" });

  // 80 of 100 words shared: similarity ~0.66, below 0.8, but within a page
  // that only matched itself at 0.75 (threshold 0.6).
  const drifted = page("Home", "Welcome", `${words(80)} ${words(20, 5000)}`);
  assert.equal(cmp(drifted).state, "different");
  assert.equal(cmp(drifted, {}, "", 0.75).state, "same");
});

/**
 * A site that treats crawlers differently by user agent.
 * @param {(path: string, ua: string, res: import("node:http").ServerResponse) => boolean} [extra] return true when handled
 */
function botSite(extra) {
  /** @type {string[]} */
  const hits = [];
  const full = page("Pricing plans", "Pricing", words(120));
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const ua = String(req.headers["user-agent"] ?? "");
      const path = new URL(req.url ?? "/", "http://x").pathname;
      hits.push(`${path} ${ua}`);
      if (extra?.(path, ua, res)) return;
      /** @param {number} status @param {string} body @param {Record<string, string>} [headers] */
      const send = (status, body, headers = {}) => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
        res.end(body);
      };
      if (path === "/robots.txt") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("User-agent: ChatGPT-User\nDisallow: /\n\nUser-agent: *\nAllow: /\n");
        return;
      }
      if (path === "/elsewhere") return send(200, full);
      if (path !== "/") return send(404, "<title>Not found</title>");
      if (/Googlebot/.test(ua) && /Mobile/.test(ua))
        return send(200, page("Pricing plans", "Pricing", words(30)));
      if (/Googlebot/.test(ua)) return send(200, full);
      if (/bingbot/.test(ua)) return send(200, full, { "x-robots-tag": "bingbot: noindex" });
      if (/Applebot/.test(ua)) return send(200, page("Pricing plans | Apple special", "Pricing", words(120)));
      if (/OAI-SearchBot/.test(ua)) return send(403, "Forbidden");
      if (/PerplexityBot/.test(ua)) {
        return send(403, "<title>Just a moment...</title>", {
          "cf-mitigated": "challenge",
          server: "cloudflare",
        });
      }
      if (/GPTBot/.test(ua)) {
        res.writeHead(302, { location: "/elsewhere" });
        res.end();
        return;
      }
      if (/CCBot/.test(ua)) return send(200, page("Pricing plans", "Pricing", words(120, 9000)));
      return send(200, full);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ base: `http://127.0.0.1:${port}`, hits, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

test("runBotCheck: blocked, challenged, noindex, different, redirected, robots.txt and mobile parity", async () => {
  const site = /** @type {{ base: string, hits: string[], close: () => Promise<void> }} */ (await botSite());
  try {
    const robotsText = "User-agent: ChatGPT-User\nDisallow: /\n\nUser-agent: *\nAllow: /\n";
    /** @type {number[]} */
    const progress = [];
    const report = await runBotCheck([`${site.base}/`, `${site.base}/`], {
      robotsText,
      delay: 0,
      onProgress: (done) => progress.push(done),
    });
    assert.equal(report.pages.length, 1, "duplicate URLs are checked once");
    const p = report.pages[0];
    assert.ok(p);
    assert.equal(p.baseline.status, 200);
    assert.equal(p.baseline.words, 121);
    /** @type {Record<string, string>} */
    const states = {};
    for (const [id, cell] of Object.entries(p.cells)) states[id] = cell.state;
    assert.deepEqual(states, {
      googlebot: "thinner",
      "googlebot-desktop": "same",
      bingbot: "noindex",
      applebot: "different",
      "oai-searchbot": "blocked",
      perplexitybot: "challenged",
      "chatgpt-user": "disallowed",
      gptbot: "redirected",
      ccbot: "different",
    });
    assert.deepEqual(p.cells.applebot?.fields, ["title"]);
    assert.deepEqual(p.cells.ccbot?.fields, ["text"]);
    assert.equal(p.cells.perplexitybot?.detail, "Cloudflare challenge (HTTP 403)");
    assert.equal(p.robots["chatgpt-user"], false);
    assert.equal(p.robots.claudebot, true);
    assert.ok(!site.hits.some((h) => h.includes("ChatGPT-User")), "a disallowed crawler is not impersonated");
    assert.equal(site.hits.filter((h) => h.startsWith("/ ")).length, 10, "browser twice + 8 crawlers");
    assert.deepEqual(p.mobile, { mobileWords: 31, desktopWords: 121, fields: [] });
    assert.deepEqual(
      p.findings.map((f) => `${f.type}:${f.agent}`),
      [
        "noindex:bingbot",
        "different:applebot",
        "blocked:oai-searchbot",
        "challenged:perplexitybot",
        "redirected:gptbot",
        "different:ccbot",
        "mobile:googlebot",
      ],
      "the smartphone's thinner page is reported once, as mobile parity",
    );
    assert.equal(report.verdicts.gptbot?.state, "redirected");
    assert.equal(report.verdicts["googlebot-desktop"]?.state, "same");
    assert.equal(report.agents.length, BOT_AGENTS.length + 5);
    assert.ok(report.notes.some((n) => /JavaScript is not run/.test(n)));
    assert.equal(progress.at(-1), BOT_AGENTS.length + 2);

    const analysis = analyzeSite({ pages: [], bots: report });
    /** @param {string} id */
    const find = (id) => analysis.issues.find((i) => i.id === id);
    assert.equal(find("X24-crawler-blocked")?.severity, "P2", "only AI crawlers were turned away");
    assert.match(find("X24-crawler-blocked")?.urls[0]?.detail ?? "", /OAI-SearchBot: blocked, HTTP 403/);
    assert.equal(find("X25-crawler-content")?.severity, "P1", "Bingbot and Applebot are search crawlers");
    assert.equal(find("X25-crawler-content")?.heuristic, false);
    assert.match(find("X25-crawler-content")?.title ?? "", /Bingbot, Applebot, GPTBot and 1 more/);
    assert.equal(find("X26-mobile-parity")?.severity, "P2");
    assert.equal(analysis.crawlerCheck, report);
  } finally {
    await site.close();
  }
});

test("runBotCheck: a page the browser cannot get is not requested as any crawler", async () => {
  const report = await runBotCheck(["http://127.0.0.1:9/", "ftp://example.com/x"], {
    delay: 0,
    timeoutMs: 2000,
  });
  assert.equal(report.pages.length, 1, "non-http URLs are dropped");
  assert.ok(report.pages[0]?.baseline.error);
  assert.deepEqual(report.pages[0]?.cells, {});
  assert.ok(report.notes.some((n) => /could not be fetched/.test(n)));
  assert.deepEqual(report.verdicts.googlebot, { state: "error", counts: {}, checked: 0 });
  assert.deepEqual(analyzeSite({ pages: [], bots: report }).issues, []);
});

test("cli: bots <url> --json, a local path is refused, and robots.txt is honoured", async () => {
  const site = /** @type {{ base: string, hits: string[], close: () => Promise<void> }} */ (await botSite());
  try {
    const r = await runCli(["bots", `${site.base}/`, "--json", "--delay", "0"]);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.tool, "one-step-seo");
    assert.deepEqual(out.sample, [`${site.base}/`]);
    assert.equal(out.verdicts["oai-searchbot"].state, "blocked");
    assert.equal(out.pages[0].robots["chatgpt-user"], false, "robots.txt is read from the site");

    const text = await runCli(["bots", `${site.base}/`, "--delay", "0"]);
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /Googlebot smartphone\s+Search\s+allowed/);
    assert.match(text.stdout, /ChatGPT-User\s+AI assistant\s+disallowed\s+not requested \(robots\.txt\)/);
    assert.match(text.stdout, /Problems found:/);
    assert.match(text.stdout, /OAI-SearchBot: blocked, HTTP 403/);
    assert.match(text.stdout, /URL Inspection live test/);
  } finally {
    await site.close();
  }

  const local = await runCli(["bots", "./tests"]);
  assert.equal(local.code, 1);
  assert.match(local.stderr, /bots needs a live http\(s\) URL/);

  const closed = /** @type {{ base: string, hits: string[], close: () => Promise<void> }} */ (
    await botSite((path, _ua, res) => {
      if (path !== "/robots.txt") return false;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: one-step-seo\nDisallow: /\n");
      return true;
    })
  );
  try {
    const r = await runCli(["bots", `${closed.base}/`, "--delay", "0"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /robots\.txt disallows/);
    assert.ok(!closed.hits.some((h) => h.startsWith("/ ")), "nothing but robots.txt was requested");
  } finally {
    await closed.close();
  }
});

test("cli: audit --bots adds X24–X26 to the site artifacts of a one-page audit", async () => {
  const site = /** @type {{ base: string, hits: string[], close: () => Promise<void> }} */ (await botSite());
  const out = mkdtempSync(join(tmpdir(), "oss-bots-audit-"));
  try {
    const r = await runCli([
      "audit",
      `${site.base}/`,
      "--bots",
      "--delay",
      "0",
      "--format",
      "json,md",
      "--out",
      out,
    ]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Site-wide findings/);
    assert.match(r.stdout, /X25-crawler-content/);
    const intel = JSON.parse(readFileSync(join(out, "site-intelligence.json"), "utf8"));
    const ids = intel.issues.map((/** @type {{ id: string }} */ i) => i.id);
    for (const id of ["X24-crawler-blocked", "X25-crawler-content", "X26-mobile-parity"]) {
      assert.ok(ids.includes(id), `${id} in ${ids.join(", ")}`);
    }
    assert.equal(intel.crawlerCheck.pages.length, 1);
    assert.match(
      readFileSync(join(out, "site-report.md"), "utf8"),
      /Crawlers get a different page than browsers/,
    );
  } finally {
    await site.close();
  }
});
