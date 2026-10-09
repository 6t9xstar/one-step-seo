/**
 * Fixture-based tests: one HTML file per common page type, each asserting
 * the finding its defect is supposed to trip — plus live-server behavior
 * for robots refusal, slow pages, and broken sitemaps.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHtml } from "../lib/html.mjs";
import { runChecks } from "../lib/checks.mjs";
import { extractJsonLd, validateSchema } from "../lib/schema.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin/cli.mjs");
const DIR = dirname(fileURLToPath(import.meta.url));

/**
 * @param {string[]} args
 * @param {{ timeout?: number }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function runCli(args, { timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { timeout }, (error, stdout, stderr) => {
      resolve({
        code: Number(error?.code ?? 0),
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
      });
    });
  });
}

/** @param {object} [over] */
function siteFilesMock(over = {}) {
  return {
    origin: "https://example.com",
    robots: {
      found: true,
      status: 200,
      sitemaps: [],
      disallowCount: 1,
      aiBlocked: false,
      textSample: "",
      text: "",
    },
    sitemap: {
      found: true,
      status: 200,
      url: "https://example.com/sitemap.xml",
      urlCount: 10,
      fromRobots: [],
      truncated: false,
      text: "",
    },
    llms: { found: false, status: 404, bytes: 0, text: "" },
    ...over,
  };
}

/** @param {string} finalUrl */
function fetchMock(finalUrl) {
  return {
    finalUrl,
    status: 200,
    statusChain: [{ url: finalUrl, status: 200 }],
    contentType: "text/html",
    ms: 10,
  };
}

/**
 * Parse a fixture and run the check suite with healthy transport mocks.
 * @param {string} name
 * @param {string} finalUrl
 * @param {object} [siteOver]
 * @returns {Map<string, any>}
 */
function auditFixture(name, finalUrl, siteOver = {}) {
  const html = readFileSync(join(DIR, "fixtures", name), "utf8");
  const parsed = parseHtml(html, finalUrl);
  const raw = extractJsonLd(parsed.jsonLdBlocks);
  const validated = validateSchema(raw.items);
  const findings = runChecks(parsed, siteFilesMock(siteOver), fetchMock(finalUrl), {
    items: raw.items,
    types: validated.types,
    issues: validated.issues,
    errors: raw.errors,
  });
  return new Map(findings.map((f) => [f.id, f]));
}

/**
 * @param {Map<string, any>} byId
 * @param {string} id
 * @param {string} severity
 */
function expectSev(byId, id, severity) {
  const f = byId.get(id);
  assert.ok(f, `missing finding ${id}`);
  assert.equal(f.severity, severity, `${id}: expected ${severity}`);
}

// ---------- one fixture per defect ----------

test("fixture: missing title trips O01-title-missing P0", () => {
  expectSev(
    auditFixture("page-missing-title.html", "https://example.com/page-missing-title/"),
    "O01-title-missing",
    "P0",
  );
});

test("fixture: missing meta trips O02-meta-missing P1", () => {
  expectSev(
    auditFixture("page-missing-meta.html", "https://example.com/page-missing-meta/"),
    "O02-meta-missing",
    "P1",
  );
});

test("fixture: broken canonical trips T08-canonical P1", () => {
  expectSev(
    auditFixture("page-broken-canonical.html", "https://example.com/page-broken-canonical/"),
    "T08-canonical",
    "P1",
  );
});

test("fixture: missing schema trips S01-none P1", () => {
  expectSev(
    auditFixture("page-missing-schema.html", "https://example.com/page-missing-schema/"),
    "S01-none",
    "P1",
  );
});

test("fixture: thin content trips C01-thin P1", () => {
  expectSev(
    auditFixture("page-thin-content.html", "https://example.com/page-thin-content/"),
    "C01-thin",
    "P1",
  );
});

test("fixture: duplicate H1 trips O03-h1-multi P1", () => {
  expectSev(
    auditFixture("page-duplicate-h1.html", "https://example.com/page-duplicate-h1/"),
    "O03-h1-multi",
    "P1",
  );
});

test("fixture: entity drift trips G04-entity P3", () => {
  expectSev(
    auditFixture("page-entity-drift.html", "https://example.com/page-entity-drift/"),
    "G04-entity",
    "P3",
  );
});

test("fixture: unstructured llms.txt trips G05-llms-quality P3", () => {
  const byId = auditFixture("page-llms-quality.html", "https://example.com/page-llms-quality/", {
    llms: {
      found: true,
      status: 200,
      bytes: 120,
      text: "plain words with no headings or links, just running text",
    },
  });
  expectSev(byId, "G05-llms-quality", "P3");
});

test("fixture: structured llms.txt passes G05", () => {
  const byId = auditFixture("page-llms-quality.html", "https://example.com/page-llms-quality/", {
    llms: {
      found: true,
      status: 200,
      bytes: 200,
      text: "# Site\n\n> Summary.\n\n## Pages\n\n- [Home](https://example.com/)",
    },
  });
  expectSev(byId, "G05-llms-quality", "pass");
});

test("fixture: insecure script trips T13-mixed P1", () => {
  expectSev(
    auditFixture("page-mixed-content.html", "https://example.com/page-mixed-content/"),
    "T13-mixed",
    "P1",
  );
});

// ---------- example page types stay meaningful ----------

test("fixture: wordpress-like trips image-dimensions P2 only (plus optional-file P1/P2s)", () => {
  const byId = auditFixture("wordpress-like.html", "https://example.com/brew-guides/pour-over/");
  expectSev(byId, "O09-img-dims", "P2");
  assert.ok(![...byId.values()].some((f) => f.severity === "P0"), "wordpress-like must have no P0");
});

test("fixture: nextjs-like has no P0/P1 and self-referencing canonical", () => {
  const byId = auditFixture("nextjs-like.html", "https://example.com/app/");
  expectSev(byId, "T08-canonical", "pass");
  assert.ok(
    ![...byId.values()].some((f) => f.severity === "P0" || f.severity === "P1"),
    "nextjs-like must have no P0/P1",
  );
});

test("fixture: product page validates its Product schema", () => {
  const byId = auditFixture("product.html", "https://example.com/shop/trailhead-40l/");
  expectSev(byId, "S01-present", "pass");
});

test("fixture: blog post passes FAQ + structured-data checks", () => {
  const byId = auditFixture("blog.html", "https://example.com/blog/slow-mornings/");
  expectSev(byId, "S01-present", "pass");
  expectSev(byId, "C04-faq", "pass");
});

test("fixture: pricing page trips long-title P2", () => {
  const byId = auditFixture("pricing.html", "https://example.com/pricing/");
  expectSev(byId, "O01-title-long", "P2");
});

// ---------- live-server behavior ----------

const HEALTHY_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>A healthy blocked-fixture page title here</title>
<meta name="description" content="A well-crafted meta description that runs to about one hundred and forty characters total for testing purposes here yes.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.ico">
</head><body><h1>Hi</h1><p>${"word ".repeat(250)}</p></body></html>`;

/** @param {import("node:http").Server} server @returns {Promise<void>} */
function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * @param {(pathname: string) => { status: number, type: string, body: string } | null} route
 */
function startRouter(route) {
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const hit = route(pathname);
    if (!hit) {
      res.writeHead(404, { "content-type": "text/plain", connection: "close" });
      res.end("not found");
      return;
    }
    res.writeHead(hit.status, { "content-type": hit.type, connection: "close" });
    res.end(hit.body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("cli: audit respects robots.txt Disallow and writes a T05 report", async () => {
  const server = await startRouter((pathname) => {
    if (pathname === "/robots.txt")
      return { status: 200, type: "text/plain", body: "User-agent: *\nDisallow: /\n" };
    if (pathname === "/") return { status: 200, type: "text/html", body: HEALTHY_PAGE };
    return null;
  });
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-blocked-"));
    const r = await runCli(["audit", `http://127.0.0.1:${port}/`, "--pages", "2", "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /robots\.txt disallows/);
    const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    const ids = report.findings.map(/** @param {{ id: string }} f @returns {string} */ (f) => f.id);
    assert.ok(ids.includes("T05-robots-disallow"), `expected T05-robots-disallow in ${JSON.stringify(ids)}`);
    assert.ok(!existsSync(join(out, "report-2.json")), "refused crawl must not write page 2");
  } finally {
    await closeServer(server);
  }
});

test("cli: --force crawls despite robots.txt Disallow", async () => {
  const server = await startRouter((pathname) => {
    if (pathname === "/robots.txt")
      return { status: 200, type: "text/plain", body: "User-agent: *\nDisallow: /\n" };
    if (pathname === "/") return { status: 200, type: "text/html", body: HEALTHY_PAGE };
    return null;
  });
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-force-"));
    const r = await runCli(["audit", `http://127.0.0.1:${port}/`, "--pages", "1", "--out", out, "--force"]);
    assert.equal(r.code, 0, r.stderr);
    const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    const ids = report.findings.map(/** @param {{ id: string }} f @returns {string} */ (f) => f.id);
    assert.ok(!ids.includes("T05-robots-disallow"), "forced crawl must not carry the refusal finding");
  } finally {
    await closeServer(server);
  }
});

test("cli: slow pages complete and --delay/--debug flags are accepted", async () => {
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain", connection: "close" });
      res.end("User-agent: *\nDisallow:\n");
      return;
    }
    if (pathname === "/slow") {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/html", connection: "close" });
        res.end(HEALTHY_PAGE);
      }, 1200);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain", connection: "close" });
    res.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-slow-"));
    const slow = await runCli(["page", `http://127.0.0.1:${port}/slow`, "--timeout", "15000", "--out", out]);
    assert.equal(slow.code, 0, slow.stderr);
    const delayed = await runCli([
      "audit",
      `http://127.0.0.1:${port}/slow`,
      "--pages",
      "1",
      "--out",
      out,
      "--delay",
      "100",
      "--debug",
    ]);
    assert.equal(delayed.code, 0, delayed.stderr);
    assert.match(delayed.stderr, /debug:/);
  } finally {
    await closeServer(server);
  }
});

test("cli: malformed sitemap surfaces T06-sitemap P1", async () => {
  const server = await startRouter((pathname) => {
    if (pathname === "/robots.txt")
      return { status: 200, type: "text/plain", body: "User-agent: *\nDisallow:\n" };
    if (pathname === "/sitemap.xml")
      return { status: 200, type: "text/plain", body: "this is not a sitemap at all" };
    if (pathname === "/") return { status: 200, type: "text/html", body: HEALTHY_PAGE };
    return null;
  });
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-badsitemap-"));
    const r = await runCli(["page", `http://127.0.0.1:${port}/`, "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    const sitemap = report.findings.find(
      /** @param {{ id: string }} f @returns {boolean} */ (f) => f.id === "T06-sitemap",
    );
    assert.ok(sitemap, "expected a T06-sitemap finding");
    assert.equal(sitemap.severity, "P1");
  } finally {
    await closeServer(server);
  }
});

test("cli: schema warns (but proceeds) on robots-disallowed URLs", async () => {
  const server = await startRouter((pathname) => {
    if (pathname === "/robots.txt")
      return { status: 200, type: "text/plain", body: "User-agent: *\nDisallow: /\n" };
    if (pathname === "/") return { status: 200, type: "text/html", body: HEALTHY_PAGE };
    return null;
  });
  const port = server.address()?.port;
  try {
    const warned = await runCli(["schema", `http://127.0.0.1:${port}/`]);
    assert.equal(warned.code, 0, warned.stderr);
    assert.match(warned.stderr, /diagnostic only/);
    const forced = await runCli(["schema", `http://127.0.0.1:${port}/`, "--force"]);
    assert.equal(forced.code, 0, forced.stderr);
    assert.ok(!/diagnostic only/.test(forced.stderr), "--force must skip the warning");
  } finally {
    await closeServer(server);
  }
});

const LINKS_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>A link hub fixture page title here</title>
<meta name="description" content="A well-crafted meta description that runs to about one hundred and forty characters total for testing purposes here yes.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.ico">
</head><body><h1>Hub</h1>
<p>What is this hub? A direct answer of forty words or more written first for testing purposes and for machines to quote.</p>
<p><a href="/a">a</a> <a href="/b">b</a> <a href="/c">c</a> <a href="/gone">gone</a></p>
<p>${"word ".repeat(250)}</p></body></html>`;

/**
 * Four-page link hub: /a /b /c healthy, /gone 404s. Exercises the page cap,
 * the failure counter, and the condensed file list.
 */
function startHub() {
  return startRouter((pathname) => {
    if (pathname === "/robots.txt")
      return { status: 200, type: "text/plain", body: "User-agent: *\nDisallow:\n" };
    if (pathname === "/") return { status: 200, type: "text/html", body: LINKS_PAGE };
    if (pathname === "/a" || pathname === "/b" || pathname === "/c")
      return { status: 200, type: "text/html", body: HEALTHY_PAGE };
    if (pathname === "/gone") return { status: 404, type: "text/html", body: "nope" };
    return null;
  });
}

test("cli: reaching --pages with URLs left prints the cap note", async () => {
  const server = await startHub();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-cap-"));
    const r = await runCli(["audit", `http://127.0.0.1:${port}/`, "--pages", "2", "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Stopped at the --pages 2 cap — the crawl saw more URLs\./);
    assert.match(r.stdout, /max 200/);
    assert.ok(existsSync(join(out, "report.json")));
    assert.ok(existsSync(join(out, "report-2.json")));
    assert.ok(!existsSync(join(out, "report-3.json")), "capped crawl must stop at 2 reports");
  } finally {
    await closeServer(server);
  }
});

test("cli: unseen links dropped by the per-page slice still flag the cap", async () => {
  // /many links 12 distinct leaves: the crawler takes 10, drops 2 unseen
  // ones, and must say so even though the queue never fills.
  const leafLinks = Array.from({ length: 12 }, (_, i) => `<a href="/m${i}">m${i}</a>`).join(" ");
  const server = await startRouter((pathname) => {
    if (pathname === "/robots.txt")
      return { status: 200, type: "text/plain", body: "User-agent: *\nDisallow:\n" };
    if (pathname === "/many")
      return {
        status: 200,
        type: "text/html",
        body: HEALTHY_PAGE.replace("</body>", `<p>${leafLinks}</p></body>`),
      };
    if (/^\/m\d+$/.test(pathname)) return { status: 200, type: "text/html", body: HEALTHY_PAGE };
    return null;
  });
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-slice-"));
    const r = await runCli(["audit", `http://127.0.0.1:${port}/many`, "--pages", "20", "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /more URLs were seen but not reached/);
    assert.ok(existsSync(join(out, "report.json")));
  } finally {
    await closeServer(server);
  }
});

test("cli: failures are counted and long file lists are condensed", async () => {
  const server = await startHub();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-failcount-"));
    const r = await runCli(["audit", `http://127.0.0.1:${port}/`, "--pages", "5", "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Pages audited: 4 \(1 failed or skipped/);
    assert.match(r.stdout, /Audited all 4 discovered pages\./);
    assert.ok(existsSync(join(out, "report-4.json")), "expected 4 reports (/gone 404s)");
    assert.ok(!existsSync(join(out, "report-5.json")));
    assert.match(r.stdout, /Wrote 14 files into .* — start at .*index\.html\./);
  } finally {
    await closeServer(server);
  }
});

test("cli: robots-disallowed discovered links are skipped unless --force", async () => {
  const server = await startRouter((pathname) => {
    if (pathname === "/robots.txt")
      return { status: 200, type: "text/plain", body: "User-agent: *\nDisallow: /private\n" };
    if (pathname === "/")
      return {
        status: 200,
        type: "text/html",
        body: HEALTHY_PAGE.replace(
          "</body>",
          '<p><a href="/public">public</a> <a href="/private/x">private</a></p></body>',
        ),
      };
    if (pathname === "/public" || pathname === "/private/x")
      return { status: 200, type: "text/html", body: HEALTHY_PAGE };
    return null;
  });
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-disallowskip-"));
    const r = await runCli(["audit", `http://127.0.0.1:${port}/`, "--pages", "3", "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(out, "report-2.json")), "expected the allowed /public report");
    assert.ok(!existsSync(join(out, "report-3.json")), "disallowed /private/x must never be crawled");
    const forced = await runCli([
      "audit",
      `http://127.0.0.1:${port}/`,
      "--pages",
      "3",
      "--out",
      out,
      "--force",
    ]);
    assert.equal(forced.code, 0, forced.stderr);
    assert.ok(existsSync(join(out, "report-3.json")), "--force must crawl the disallowed URL too");
  } finally {
    await closeServer(server);
  }
});

test("cli: llms works when the page fetch fails", async () => {
  const server = await startRouter((pathname) => {
    if (pathname === "/robots.txt")
      return { status: 200, type: "text/plain", body: "User-agent: *\nDisallow:\n" };
    if (pathname === "/") return { status: 500, type: "text/html", body: "broken" };
    return null;
  });
  const port = server.address()?.port;
  try {
    const r = await runCli(["llms", `http://127.0.0.1:${port}/`]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /starter llms\.txt/);
    assert.match(r.stdout, /no sitemap URLs discovered/);
  } finally {
    await closeServer(server);
  }
});

test("cli: duplicate titles across pages land in index.md and the terminal", async () => {
  const dup = /** @param {string} links @returns {string} */ (links) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Same Site Title Here</title></head><body><h1>Same</h1><p>${links}</p></body></html>`;
  const server = await startRouter((pathname) => {
    if (pathname === "/robots.txt")
      return { status: 200, type: "text/plain", body: "User-agent: *\nDisallow:\n" };
    if (pathname === "/") return { status: 200, type: "text/html", body: dup('<a href="/b">b</a>') };
    if (pathname === "/b") return { status: 200, type: "text/html", body: dup("") };
    return null;
  });
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-dups-"));
    const r = await runCli(["audit", `http://127.0.0.1:${port}/`, "--pages", "2", "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Duplicates: shared 1 title across pages/);
    const index = readFileSync(join(out, "index.md"), "utf8");
    assert.match(index, /Duplicate titles/);
    assert.match(index, /Duplicate title on page 1, page 2/);
    const dashboard = readFileSync(join(out, "index.html"), "utf8");
    assert.match(dashboard, /Duplicate titles/);
  } finally {
    await closeServer(server);
  }
});

test("cli: sitemap-only pages are reported as possibly orphaned", async () => {
  const server = await startRouter((pathname) => {
    if (pathname === "/robots.txt")
      return { status: 200, type: "text/plain", body: "User-agent: *\nDisallow:\n" };
    if (pathname === "/sitemap.xml") {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const origin = `http://127.0.0.1:${port}`;
      return {
        status: 200,
        type: "application/xml",
        body: `<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/linked</loc></url><url><loc>${origin}/lonely</loc></url></urlset>`,
      };
    }
    if (pathname === "/")
      return {
        status: 200,
        type: "text/html",
        body: HEALTHY_PAGE.replace("</body>", '<p><a href="/linked">linked</a></p></body>'),
      };
    if (pathname === "/linked" || pathname === "/lonely")
      return { status: 200, type: "text/html", body: HEALTHY_PAGE };
    return null;
  });
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-orphan-"));
    const r = await runCli([
      "audit",
      `http://127.0.0.1:${port}/`,
      "--pages",
      "3",
      "--crawl",
      "sitemap",
      "--out",
      out,
    ]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Orphaned pages/);
    assert.match(r.stdout, /lonely/);
    const index = readFileSync(join(out, "index.md"), "utf8");
    assert.match(index, /Possibly orphaned pages/);
    assert.match(index, /lonely/);
  } finally {
    await closeServer(server);
  }
});

test("cli: cross-origin redirect targets are adopted once, then locked", async () => {
  // C counts contact by path: the redirect-following page fetch is
  // unavoidable, but robots/sitemap/llms discovery must never touch C,
  // and C's own links must never be harvested.
  /** @type {Record<string, number>} */
  const cHits = {};
  const cPage = HEALTHY_PAGE.replace("</body>", '<p><a href="/deep">deep</a></p></body>');
  const serverC = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    cHits[pathname] = (cHits[pathname] ?? 0) + 1;
    if (pathname === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain", connection: "close" });
      res.end("User-agent: *\nDisallow:\n");
      return;
    }
    res.writeHead(200, { "content-type": "text/html", connection: "close" });
    res.end(cPage);
  });
  await new Promise((resolve) => serverC.listen(0, "127.0.0.1", () => resolve(undefined)));
  const portC = serverC.address();
  const originC = `http://127.0.0.1:${typeof portC === "object" && portC ? portC.port : 0}`;
  // B hosts the adopted site; /jump bounces to the third origin C.
  const serverB = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain", connection: "close" });
      res.end("User-agent: *\nDisallow:\n");
      return;
    }
    if (pathname === "/jump") {
      res.writeHead(301, { location: `${originC}/`, connection: "close" });
      res.end();
      return;
    }
    const addrB = serverB.address();
    const originB = `http://127.0.0.1:${typeof addrB === "object" && addrB ? addrB.port : 0}`;
    const page =
      pathname === "/"
        ? HEALTHY_PAGE.replace(
            "</body>",
            `<p><a href="${originB}/ok">ok</a> <a href="${originB}/jump">jump</a></p></body>`,
          )
        : HEALTHY_PAGE;
    res.writeHead(200, { "content-type": "text/html", connection: "close" });
    res.end(page);
  });
  await new Promise((resolve) => serverB.listen(0, "127.0.0.1", () => resolve(undefined)));
  const portB = serverB.address();
  const originB = `http://127.0.0.1:${typeof portB === "object" && portB ? portB.port : 0}`;
  // A redirects everything to B and allows crawling.
  const shim = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain", connection: "close" });
      res.end("User-agent: *\nDisallow:\n");
      return;
    }
    res.writeHead(301, { location: `${originB}/`, connection: "close" });
    res.end();
  });
  await new Promise((resolve) => shim.listen(0, "127.0.0.1", () => resolve(undefined)));
  const portShim = shim.address();
  const originShim = `http://127.0.0.1:${typeof portShim === "object" && portShim ? portShim.port : 0}`;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-origins-"));
    const r = await runCli(["audit", `${originShim}/`, "--pages", "3", "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    const first = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    assert.ok(first.finalUrl.startsWith(originB), `redirect target must be adopted, got ${first.finalUrl}`);
    assert.ok(existsSync(join(out, "report-2.json")), "expected the /ok report");
    assert.ok(!existsSync(join(out, "report-3.json")), "third-origin /jump must be skipped after the lock");
    assert.match(r.stderr, /outside the allowed hosts/);
    assert.equal(
      cHits["/"] ?? 0,
      1,
      `expected exactly the redirect-following page hit on C, got ${JSON.stringify(cHits)}`,
    );
    assert.equal(cHits["/sitemap.xml"] ?? 0, 0, "discovery fetches must never touch the locked-out origin");
    assert.equal(cHits["/llms.txt"] ?? 0, 0, "discovery fetches must never touch the locked-out origin");
    assert.equal(cHits["/deep"] ?? 0, 0, "links from the locked-out origin must never be harvested");
  } finally {
    await closeServer(serverC);
    await closeServer(serverB);
    await closeServer(shim);
  }
});
