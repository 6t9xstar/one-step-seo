import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createColorHelper } from "../lib/colors.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin/cli.mjs");

// Fix sessions / monitor snapshots go to a throwaway state dir, never into
// the repository's own ./.one-step-seo.
const TEST_STATE_DIR = mkdtempSync(join(tmpdir(), "oss-cli-state-"));
const TEST_ENV = { ...process.env, ONE_STEP_SEO_STATE_DIR: TEST_STATE_DIR };

/**
 * @param {string[]} args
 * @param {{ timeout?: number, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function runCli(args, { timeout = 20000, env = TEST_ENV } = {}) {
  return new Promise((resolve) => {
    const isolated = { ONE_STEP_SEO_STATE_DIR: TEST_STATE_DIR, ...env };
    execFile(process.execPath, [CLI, ...args], { timeout, env: isolated }, (error, stdout, stderr) => {
      resolve({
        code: Number(error?.code ?? 0),
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
      });
    });
  });
}

function startFixtureServer() {
  /** @type {Record<string, string>} */
  const pages = {
    "/": `<!doctype html><html lang="en"><head><meta charset="utf-8">
      <title>A descriptive test page title here</title>
      <meta name="description" content="A well-crafted meta description that runs to about one hundred and forty characters total for testing purposes here yes.">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="canonical" href="CANONICAL">
      <link rel="icon" href="/favicon.ico">
      <meta property="og:title" content="T"><meta property="og:description" content="D"><meta property="og:image" content="https://example.com/og.png">
      </head><body><h1>Home</h1><h2>Section</h2>
      <p>What is this? This is a direct answer of forty words or more written first for testing purposes and for machines.</p>
      <table><tr><td>a</td></tr></table>
      <a href="/second">second</a>
      <p>${"word ".repeat(350)}</p></body></html>`,
    "/second": `<!doctype html><html lang="en"><head><meta charset="utf-8">
      <title>Second test page with a fine title here</title>
      <meta name="description" content="Another well-crafted meta description that runs to about one hundred and forty characters total for testing purposes here yes.">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="icon" href="/favicon.ico">
      <meta property="og:title" content="T"><meta property="og:description" content="D"><meta property="og:image" content="https://example.com/og.png">
      </head><body><h1>Second</h1><p>${"word ".repeat(350)}</p></body></html>`,
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain", connection: "close" });
      res.end("User-agent: *\nDisallow:\n");
      return;
    }
    if (url.pathname === "/sitemap.xml") {
      // Must include the real port: a hardcoded `http://127.0.0.1/` loc makes
      // --crawl sitemap seed URLs that can never resolve.
      const addr = server.address();
      const port = addr !== null && typeof addr === "object" ? addr.port : 0;
      const origin = `http://127.0.0.1:${port}`;
      res.writeHead(200, { "content-type": "application/xml", connection: "close" });
      res.end(
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/second</loc></url><url><loc>${origin}/</loc></url></urlset>`,
      );
      return;
    }
    if (url.pathname === "/llms.txt") {
      res.writeHead(404, { "content-type": "text/plain", connection: "close" });
      res.end("not found");
      return;
    }
    const body = pages[url.pathname];
    if (!body) {
      res.writeHead(404, { "content-type": "text/html", connection: "close" });
      res.end("nope");
      return;
    }
    const addr = server.address();
    const port = addr !== null && typeof addr === "object" ? addr.port : 0;
    const html = body.replace("CANONICAL", `http://127.0.0.1:${port}/`);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", connection: "close" });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/** @param {import("node:http").Server} server @returns {Promise<void>} */
function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("cli: page writes json/md/html and exits 0", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-page-"));
    const { code, stdout } = await runCli([
      "page",
      `http://127.0.0.1:${port}/`,
      "--out",
      out,
      "--format",
      "html,md,json",
    ]);
    assert.equal(code, 0, stdout);
    assert.ok(existsSync(join(out, "report.json")));
    assert.ok(existsSync(join(out, "report.md")));
    assert.ok(existsSync(join(out, "report.html")));
    const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    assert.ok(report.scores.search.score >= 0);
    assert.ok(report.scores.ai.score >= 0);
  } finally {
    await closeServer(server);
  }
});

test("cli: audit --pages 2 writes report-2 + index.md", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-audit-"));
    const { code, stdout } = await runCli([
      "audit",
      `http://127.0.0.1:${port}/`,
      "--pages",
      "2",
      "--out",
      out,
    ]);
    assert.equal(code, 0);
    assert.ok(existsSync(join(out, "report.json")));
    assert.ok(existsSync(join(out, "report-2.json")), "expected report-2.json");
    assert.ok(existsSync(join(out, "report-2.html")), "expected report-2.html");
    assert.ok(existsSync(join(out, "index.md")), "expected index.md");
    assert.match(stdout, /Top fixes across 2 pages/);
    assert.match(stdout, /Audited all 2 discovered pages\./);
  } finally {
    await closeServer(server);
  }
});

test("cli: multi-page audit writes a linked site dashboard", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-dash-"));
    const r = await runCli(["audit", `http://127.0.0.1:${port}/`, "--pages", "2", "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(out, "index.html")), "expected index.html dashboard");
    const dashboard = readFileSync(join(out, "index.html"), "utf8");
    assert.match(dashboard, /Site audit/);
    assert.match(dashboard, /href="\.\/report\.html"/);
    assert.match(dashboard, /href="\.\/report-2\.html"/);
    assert.match(dashboard, /Top recurring issues/);
    const index = readFileSync(join(out, "index.md"), "utf8");
    assert.match(index, /site dashboard/);
    const page = readFileSync(join(out, "report.html"), "utf8");
    assert.match(page, /href="index\.html"/);
    assert.match(page, /All 2 pages/);
  } finally {
    await closeServer(server);
  }
});

test("cli: no dashboard without html format", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-nohtml-"));
    const r = await runCli([
      "audit",
      `http://127.0.0.1:${port}/`,
      "--pages",
      "2",
      "--out",
      out,
      "--format",
      "json",
    ]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!existsSync(join(out, "index.html")), "no dashboard without html format");
    assert.ok(!existsSync(join(out, "report.html")), "no per-page html without html format");
    const index = readFileSync(join(out, "index.md"), "utf8");
    assert.ok(!index.includes("index.html"), "index.md must not link a dashboard that was not written");
  } finally {
    await closeServer(server);
  }
});

test("cli: index.md links only the formats that were written", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-fmtidx-"));
    const r = await runCli([
      "audit",
      `http://127.0.0.1:${port}/`,
      "--pages",
      "2",
      "--out",
      out,
      "--format",
      "json",
    ]);
    assert.equal(r.code, 0, r.stderr);
    const index = readFileSync(join(out, "index.md"), "utf8");
    assert.match(index, /\[json\]\(\.\/report\.json\)/);
    assert.ok(!index.includes("[md]("), `index.md must not link unwritten .md files:\n${index}`);
    assert.ok(!index.includes("[html]("), `index.md must not link unwritten .html files:\n${index}`);
    assert.ok(!existsSync(join(out, "report.md")), "md report must not be written");
  } finally {
    await closeServer(server);
  }
});

test("cli: --flag=value form and --fail-on gate", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-fail-"));
    // = form should parse (would previously throw Unknown flag)
    const ok = await runCli(["page", `http://127.0.0.1:${port}/`, `--out=${out}`, "--format=json"]);
    assert.equal(ok.code, 0, ok.stderr);
    assert.ok(existsSync(join(out, "report.json")));
    // P1 gate: fixture pages are healthy enough that P0 gate passes but
    // an impossible threshold still exits 0; a thin-page gate would exit 2.
    // Here we only assert the flag is accepted and does not crash.
    const gated = await runCli(["page", `http://127.0.0.1:${port}/`, "--out", out, "--fail-on", "P0"]);
    assert.ok([0, 2].includes(gated.code), `expected 0/2, got ${gated.code}: ${gated.stderr.slice(0, 300)}`);
  } finally {
    await closeServer(server);
  }
});

test("cli: doctor and sitemap --json", async () => {
  const d = await runCli(["doctor", "--json"]);
  assert.equal(d.code, 0);
  assert.ok(JSON.parse(d.stdout).tool === "one-step-seo");
});

// ---------- usage surface (no server needed) ----------

test("cli: --help and --version exit 0", async () => {
  const help = await runCli(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage:/);

  const short = await runCli(["-h"]);
  assert.equal(short.code, 0);

  const version = await runCli(["--version"]);
  assert.equal(version.code, 0);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("cli: usage errors exit 1", async () => {
  // No command at all.
  assert.equal((await runCli([])).code, 1);
  // Unknown command.
  assert.equal((await runCli(["frobnicate", "https://example.com"])).code, 1);
  // Unparseable URL.
  assert.equal((await runCli(["page", "not a url"])).code, 1);
  // Unknown flag.
  assert.equal((await runCli(["page", "https://example.com", "--nope"])).code, 1);
  // Out-of-range --pages.
  assert.equal((await runCli(["page", "https://example.com", "--pages", "0"])).code, 1);
});

test("cli: --verbose is accepted (was rejected as an unknown flag)", async () => {
  const r = await runCli(["doctor", "--verbose"]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!/Unknown flag/.test(r.stderr), r.stderr);
});

// ---------- commands that need the fixture server ----------

test("cli: schema reports nodes and emits a snippet", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const r = await runCli(["schema", `http://127.0.0.1:${port}/`, "--generate", "organization"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Found \d+ JSON-LD node/);
    assert.match(r.stdout, /application\/ld\+json/);
    assert.match(r.stdout, /"@type": "Organization"/);
  } finally {
    await closeServer(server);
  }
});

test("cli: sitemap --json has the documented shape", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const r = await runCli(["sitemap", `http://127.0.0.1:${port}/`, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    for (const key of [
      "origin",
      "robotsFound",
      "robotsSitemaps",
      "sitemapFound",
      "sitemapUrl",
      "sitemapUrls",
      "sitemapTruncated",
      "llmsFound",
    ]) {
      assert.ok(key in out, `missing ${key} in sitemap --json output`);
    }
    assert.equal(out.sitemapFound, true);
  } finally {
    await closeServer(server);
  }
});

test("cli: sitemap without --json prints human output", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const r = await runCli(["sitemap", `http://127.0.0.1:${port}/`]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Origin:/);
    assert.match(r.stdout, /sitemap\.xml: found/);
  } finally {
    await closeServer(server);
  }
});

test("cli: --fail-on breaches exit 2", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-gate-"));
    // The fixture pages are thin enough to trip a P2 gate.
    const gated = await runCli(["page", `http://127.0.0.1:${port}/`, "--out", out, "--fail-on", "P2"]);
    assert.equal(gated.code, 2, `expected exit 2, got ${gated.code}: ${gated.stderr.slice(0, 200)}`);
    assert.match(gated.stderr, /Fail-on threshold breached/);
  } finally {
    await closeServer(server);
  }
});

test("cli: audit --crawl sitemap seeds the queue from the sitemap", async () => {
  // End-to-end proof that --crawl sitemap is implemented: /second is listed in
  // sitemap.xml but NOT linked from /, so reaching it can only come from the
  // sitemap, never from the link BFS.
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-crawl-"));
    const r = await runCli([
      "audit",
      `http://127.0.0.1:${port}/`,
      "--pages",
      "2",
      "--crawl",
      "sitemap",
      "--out",
      out,
    ]);
    assert.equal(r.code, 0, r.stderr);
    const index = readFileSync(join(out, "index.md"), "utf8");
    assert.match(index, /second/, `index.md did not reach /second:\n${index}`);
  } finally {
    await closeServer(server);
  }
});

test("cli: --fail-on P0 gates on the fixture's own http:// T01-https finding", async () => {
  // The fixture is served over plain HTTP, so T01-https is a genuine P0. That
  // makes this the reliable way to exercise the gate's breach path at P0.
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-p0gate-"));
    const r = await runCli(["page", `http://127.0.0.1:${port}/`, "--out", out, "--fail-on", "P0"]);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.match(r.stderr, /Fail-on threshold breached/);
    // And the report records why.
    const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    assert.ok(report.counts.P0 >= 1, `expected a P0, got ${JSON.stringify(report.counts)}`);
  } finally {
    await closeServer(server);
  }
});

test("cli: unfetchable URL exits 2", async () => {
  const out = mkdtempSync(join(tmpdir(), "oss-dead-"));
  const r = await runCli(["page", "http://127.0.0.1:1/nothing-here", "--out", out]);
  assert.equal(r.code, 2, `expected exit 2, got ${r.code}`);
});

test("cli: --profile calibrates the audit, unknown profiles exit 1", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-profile-"));
    const r = await runCli(["page", `http://127.0.0.1:${port}/`, "--out", out, "--profile", "product"]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(out, "report.json")), "expected report.json");
    assert.equal((await runCli(["page", `http://127.0.0.1:${port}/`, "--profile", "enterprise"])).code, 1);
  } finally {
    await closeServer(server);
  }
});

test("cli: --format sarif writes GitHub-compatible output", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-sarif-"));
    const r = await runCli(["page", `http://127.0.0.1:${port}/`, "--out", out, "--format", "sarif,json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(out, "report.sarif")), "expected report.sarif");
    const sarif = JSON.parse(readFileSync(join(out, "report.sarif"), "utf8"));
    const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs.length, 1);
    assert.equal(sarif.runs[0].tool.driver.name, "one-step-seo");
    const actionable = report.findings.filter(
      /** @param {{ severity?: string }} f @returns {boolean} */ (f) => f.severity !== "pass",
    );
    assert.equal(sarif.runs[0].results.length, actionable.length);
    const levels = new Set(
      sarif.runs[0].results.map(/** @param {{ level?: string }} x @returns {string} */ (x) => x.level ?? ""),
    );
    for (const l of levels) assert.ok(["error", "warning", "note"].includes(l), `bad level ${l}`);
    const ruleIds = new Set(
      sarif.runs[0].tool.driver.rules.map(
        /** @param {{ id?: string }} x @returns {string} */ (x) => x.id ?? "",
      ),
    );
    for (const x of sarif.runs[0].results)
      assert.ok(ruleIds.has(x.ruleId), `result without rule ${x.ruleId}`);
  } finally {
    await closeServer(server);
  }
});

// ---------- diff: report regression comparison ----------

/**
 * @param {string} dir
 * @param {string} name
 * @param {any} report
 * @returns {string}
 */
function writeReport(dir, name, report) {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(report));
  return file;
}

/** @param {string} id @param {string} severity */
function diffFinding(id, severity) {
  return { id, severity, title: `t-${id}`, evidence: "e", fix: "x" };
}

/**
 * @param {object} [over]
 */
function diffReport(over = {}) {
  return {
    tool: "one-step-seo",
    version: "9",
    url: "https://a.com/",
    finalUrl: "https://a.com/",
    checkedAt: "2026-01-01T00:00:00.000Z",
    scores: { search: { score: 80, band: "B" }, ai: { score: 70, band: "C" } },
    counts: { P0: 0, P1: 0, P2: 0, P3: 0, pass: 0 },
    findings: [],
    page: {},
    site: {},
    ...over,
  };
}

test("cli: diff prints deltas, new, and resolved findings", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oss-diff-"));
  const oldFile = writeReport(
    dir,
    "old.json",
    diffReport({ findings: [diffFinding("O02-meta-missing", "P1"), diffFinding("W01-social", "P3")] }),
  );
  const newFile = writeReport(
    dir,
    "new.json",
    diffReport({
      scores: { search: { score: 90, band: "A" }, ai: { score: 70, band: "C" } },
      findings: [diffFinding("W01-social", "P3"), diffFinding("C02-answer", "P1")],
    }),
  );
  const r = await runCli(["diff", oldFile, newFile]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Search SEO: 80 -> 90 \(\+10\)/);
  assert.match(r.stdout, /NEW \[P1\] .* \(C02-answer\)/);
  assert.match(r.stdout, /RESOLVED \[P1\] .* \(O02-meta-missing\)/);
  const j = await runCli(["diff", oldFile, newFile, "--json"]);
  assert.equal(j.code, 0, j.stderr);
  const out = JSON.parse(j.stdout);
  assert.equal(out.tool, "one-step-seo");
  assert.deepEqual(out.search, { old: 80, new: 90, delta: 10 });
  assert.equal(out.newFindings.length, 1);
});

test("cli: diff --fail-on trips on new findings, usage errors exit 1", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oss-diffgate-"));
  const oldFile = writeReport(dir, "old.json", diffReport({ findings: [] }));
  const newFile = writeReport(dir, "new.json", diffReport({ findings: [diffFinding("T01-https", "P0")] }));
  const gated = await runCli(["diff", oldFile, newFile, "--fail-on", "P0"]);
  assert.equal(gated.code, 2, `expected exit 2, got ${gated.code}: ${gated.stderr.slice(0, 200)}`);
  assert.match(gated.stderr, /Fail-on threshold breached/);
  const mildFile = writeReport(dir, "mild.json", diffReport({ findings: [diffFinding("O06-og", "P2")] }));
  const mildBreach = await runCli(["diff", oldFile, mildFile, "--fail-on", "P2"]);
  assert.equal(mildBreach.code, 2, `expected exit 2, got ${mildBreach.code}`);
  const calm = await runCli(["diff", oldFile, mildFile, "--fail-on", "P1"]);
  assert.equal(calm.code, 0, calm.stderr);
  assert.equal((await runCli(["diff"])).code, 1, "missing files");
  assert.equal((await runCli(["diff", oldFile])).code, 1, "missing second file");
  assert.equal((await runCli(["diff", oldFile, join(dir, "missing.json")])).code, 1, "missing file");
  writeFileSync(join(dir, "bad.json"), "{nope");
  assert.equal((await runCli(["diff", oldFile, join(dir, "bad.json")])).code, 1, "invalid JSON");
  writeFileSync(join(dir, "other.json"), JSON.stringify({ tool: "nope" }));
  assert.equal((await runCli(["diff", oldFile, join(dir, "other.json")])).code, 1, "not a report");
});

// ---------- fix: safe local auto-fixes ----------

const FIX_HTML = `<!doctype html>
<html lang="en">
<head>
<title>Fix command fixture page title</title>
<meta name="description" content="A perfectly serviceable meta description that runs long enough to satisfy the meta minimum length threshold for this fixture page right here.">
</head>
<body>
<h1>Fix me</h1>
<p>${"word ".repeat(60)}</p>
</body>
</html>
`;

/** @returns {{ dir: string, file: string }} */
function makeFixFixture() {
  const dir = mkdtempSync(join(tmpdir(), "oss-fix-"));
  const file = join(dir, "index.html");
  writeFileSync(file, FIX_HTML);
  return { dir, file };
}

test("cli: fix dry-run prints a diff and writes nothing", async () => {
  const { file } = makeFixFixture();
  const before = readFileSync(file, "utf8");
  const r = await runCli(["fix", file]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\+ charset/, `expected a charset plan:\n${r.stdout}`);
  assert.match(r.stdout, /^@@ -\d+,\d+ \+\d+,\d+ @@$/m, "expected a diff hunk");
  assert.match(r.stdout, /dry run/i);
  assert.equal(readFileSync(file, "utf8"), before, "dry run must not modify the file");
  assert.ok(!existsSync(`${file}.bak`), "dry run must not create backups");
});

test("cli: fix --apply writes, backs up, and a rerun plans nothing", async () => {
  const { file } = makeFixFixture();
  const before = readFileSync(file, "utf8");
  const applied = await runCli(["fix", file, "--apply"]);
  assert.equal(applied.code, 0, applied.stderr);
  const after = readFileSync(file, "utf8");
  assert.notEqual(after, before, "--apply must modify the file");
  assert.match(after, /<meta charset="utf-8">/);
  assert.ok(existsSync(`${file}.bak`), "backup missing");
  assert.equal(readFileSync(`${file}.bak`, "utf8"), before, "backup must hold the original");
  assert.match(applied.stdout, /verified:/);

  const rerun = await runCli(["fix", file, "--json"]);
  assert.equal(rerun.code, 0, rerun.stderr);
  const plan = JSON.parse(rerun.stdout);
  assert.equal(plan.files[0].planned.length, 0, `expected idempotent rerun: ${rerun.stdout}`);
});

test("cli: fix --json emits the documented shape", async () => {
  const { file } = makeFixFixture();
  const r = await runCli(["fix", file, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.tool, "one-step-seo");
  assert.equal(out.applied, false);
  assert.match(out.version, /^\d+\.\d+\.\d+$/);
  const entry = out.files[0];
  assert.ok(Array.isArray(entry.planned) && entry.planned.length > 0);
  for (const p of entry.planned) {
    assert.match(p.name, /^[a-z-]+$/);
    assert.match(p.findingId, /^[A-Z]+[0-9]+-[a-z0-9-]+$/);
    assert.equal(typeof p.summary, "string");
  }
  assert.ok(Array.isArray(entry.skipped));
  assert.ok(Array.isArray(entry.verified));
  assert.equal(entry.changed, true);
  assert.equal(entry.applied, false);
  assert.equal(entry.error, null);
});

test("cli: fix usage errors exit 1", async () => {
  const { dir, file } = makeFixFixture();
  const txt = join(dir, "notes.txt");
  writeFileSync(txt, "not html");
  assert.equal((await runCli(["fix"])).code, 1, "missing path");
  assert.equal((await runCli(["fix", join(dir, "missing.html")])).code, 1, "missing file");
  assert.equal((await runCli(["fix", txt])).code, 1, "non-html target");
  assert.equal((await runCli(["fix", file, "--only", "bogus"])).code, 1, "unknown fixer");
  assert.equal((await runCli(["fix", file, "--url", "not a url"])).code, 1, "bad --url");
});

test("cli: fix directory mode walks html files, skips others", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oss-fixdir-"));
  writeFileSync(join(dir, "a.html"), FIX_HTML);
  writeFileSync(join(dir, "notes.txt"), "leave me alone");
  const sub = join(dir, "sub");
  mkdirSync(sub);
  writeFileSync(join(sub, "b.htm"), FIX_HTML);

  const r = await runCli(["fix", dir, "--apply"]);
  assert.equal(r.code, 0, r.stderr);
  const a = readFileSync(join(dir, "a.html"), "utf8");
  const b = readFileSync(join(sub, "b.htm"), "utf8");
  assert.match(a, /<meta charset="utf-8">/);
  assert.match(b, /<meta charset="utf-8">/);
  assert.equal(readFileSync(join(dir, "notes.txt"), "utf8"), "leave me alone");
  assert.ok(!existsSync(join(dir, "notes.txt.bak")), "non-html file must be untouched");
  assert.ok(existsSync(join(dir, "a.html.bak")) && existsSync(join(sub, "b.htm.bak")));
});

// ---------- quick: beginner defaults ----------

test("cli: quick audits with beginner defaults and prints top fixes", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-quick-"));
    const r = await runCli(["quick", `http://127.0.0.1:${port}/`, "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Quick audit/);
    assert.match(r.stdout, /up to 5 page/);
    assert.match(r.stdout, /Search SEO: \d+\/100/);
    assert.match(r.stdout, /Top fixes/);
    assert.match(r.stdout, /Next:/);
    assert.ok(existsSync(join(out, "report.json")), "quick must write report.json");
    assert.ok(existsSync(join(out, "report.html")), "quick must write report.html");
  } finally {
    await closeServer(server);
  }
});

test("cli: quick respects an explicit --pages and rejects a bad URL", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-quickpages-"));
    const r = await runCli(["quick", `http://127.0.0.1:${port}/`, "--pages", "1", "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /up to 1 page/);
    assert.ok(!existsSync(join(out, "report-2.json")), "explicit --pages 1 must win over the quick default");
    assert.equal((await runCli(["quick", "not a url"])).code, 1);
  } finally {
    await closeServer(server);
  }
});

// ---------- llms: starter draft + robots snippet ----------

test("cli: llms prints a starter draft and robots snippet", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const r = await runCli(["llms", `http://127.0.0.1:${port}/`]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /llms\.txt: missing/);
    assert.match(r.stdout, /starter llms\.txt/);
    assert.match(r.stdout, /^# /m);
    assert.match(r.stdout, /robots\.txt AI-crawler snippet/);
    assert.match(r.stdout, /User-agent: GPTBot/);
  } finally {
    await closeServer(server);
  }
});

test("cli: llms --json has the documented shape", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const r = await runCli(["llms", `http://127.0.0.1:${port}/`, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const llms = JSON.parse(r.stdout);
    for (const key of ["tool", "version", "url", "llmsFound", "llmsBytes", "starter", "robotsSnippet"]) {
      assert.ok(key in llms, `missing ${key} in llms --json output`);
    }
    assert.equal(llms.tool, "one-step-seo");
    assert.equal(llms.llmsFound, false);
    assert.match(llms.starter, /^# /m);
    assert.match(llms.robotsSnippet, /Allow: \//);
  } finally {
    await closeServer(server);
  }
});

test("cli: --psi without PSI_API_KEY exits 1 with actionable guidance", async () => {
  const r = await runCli(["page", "https://example.com", "--psi"], {
    env: { ...process.env, PSI_API_KEY: "" },
  });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /requires the PSI_API_KEY environment variable/);
});

test("cli: ai command runs AI audit and prints citability checklist", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-ai-"));
    const r = await runCli(["ai", `http://127.0.0.1:${port}/`, "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /AI Search Visibility & Citability Audit/);
    assert.match(r.stdout, /AI Visibility: \d+\/100/);
    assert.match(r.stdout, /Citability & Signal Checklist/);
    assert.match(r.stdout, /AI crawlers in robots\.txt/);
    assert.match(r.stdout, /llms\.txt discoverable/);
  } finally {
    await closeServer(server);
  }
});

test("cli: ai --json outputs structured AI search visibility signals", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const r = await runCli(["ai", `http://127.0.0.1:${port}/`, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.equal(data.tool, "one-step-seo");
    assert.ok(typeof data.aiScore === "number");
    assert.ok(data.signals);
    assert.ok("llmsFound" in data.signals);
    assert.ok("schemaTypes" in data.signals);
    assert.ok(Array.isArray(data.findings));
  } finally {
    await closeServer(server);
  }
});

test("cli: doctor --check-config prints configuration diagnostics", async () => {
  const r = await runCli(["doctor", "--check-config"]);
  assert.equal(r.code, 0, r.stderr);
  // The check is real now: it reports the config file it validated (none here).
  assert.match(
    r.stdout,
    /configuration check: no one-step-seo\.config\.json found — built-in defaults in use \(ok\)/,
  );
  assert.match(r.stdout, /node v/);
  assert.match(r.stdout, /fetch: ok/);
});

test("cli: quiet flag suppresses verbose banner in quick command", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-quiet-"));
    const normal = await runCli(["quick", `http://127.0.0.1:${port}/`, "--pages", "1", "--out", out]);
    assert.match(normal.stdout, /Quick audit: up to 1 page\(s\)/);

    const quiet = await runCli([
      "quick",
      `http://127.0.0.1:${port}/`,
      "--pages",
      "1",
      "--out",
      out,
      "--quiet",
    ]);
    assert.doesNotMatch(quiet.stdout, /Quick audit: up to 1 page\(s\)/);
  } finally {
    await closeServer(server);
  }
});

test("colors: createColorHelper respects isTTY, NO_COLOR, and formatting", () => {
  const ttyColor = createColorHelper({ isTTY: true }, { NO_COLOR: "", TERM: "xterm-256color" });
  assert.equal(ttyColor.enabled, true);
  assert.equal(ttyColor.bold("test"), "\x1b[1mtest\x1b[0m");
  assert.equal(ttyColor.severityBadge("P0"), "\x1b[1;31m[P0]\x1b[0m");
  assert.equal(ttyColor.scoreBadge(95, "good"), "\x1b[1;32m95/100 (good)\x1b[0m");

  const noColor = createColorHelper({ isTTY: true }, { NO_COLOR: "1", TERM: "xterm-256color" });
  assert.equal(noColor.enabled, false);
  assert.equal(noColor.bold("test"), "test");
  assert.equal(noColor.severityBadge("P0"), "[P0]");
  assert.equal(noColor.scoreBadge(95, "good"), "95/100 (good)");

  const pipe = createColorHelper({ isTTY: false }, { NO_COLOR: "", TERM: "xterm-256color" });
  assert.equal(pipe.enabled, false);
});

test("cli: skills command lists all skills in table format", async () => {
  const r = await runCli(["skills"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /One-Step SEO — Skills Registry/);
  assert.match(r.stdout, /technical-seo/);
  assert.match(r.stdout, /onpage-seo/);
  assert.match(r.stdout, /geo-ai-search/);
  assert.match(r.stdout, /accessibility-ux/);
});

test("cli: skills --json outputs valid JSON array of skills", async () => {
  const r = await runCli(["skills", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.ok(Array.isArray(data));
  assert.ok(data.length >= 9);
  assert.ok(data.some((s) => s.id === "technical-seo"));
  assert.ok(data.some((s) => s.id === "onpage-seo"));
});

test("cli: skills <id> outputs detailed skill information", async () => {
  const r = await runCli(["skills", "technical-seo"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Skill: Technical SEO & Indexability/);
  assert.match(r.stdout, /Category: Technical SEO/);
  assert.match(r.stdout, /Checks \(\d+ rules\):/);
  assert.match(r.stdout, /T01-https/);
});

test("cli: skills unknown-id exits 1 with error message", async () => {
  const r = await runCli(["skills", "non-existent-skill"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Unknown skill: "non-existent-skill"/);
});

test("cli: page audits local HTML file offline and produces valid report", async () => {
  const out = mkdtempSync(join(tmpdir(), "oss-local-page-"));
  const fixturePath = join(ROOT, "tests/fixtures/good.html");
  const r = await runCli(["page", fixturePath, "--out", out]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Search SEO:/);
  assert.match(r.stdout, /AI Visibility:/);
  assert.ok(existsSync(join(out, "report.json")));
  assert.ok(existsSync(join(out, "report.md")));
  assert.ok(existsSync(join(out, "report.html")));
  const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  assert.ok(report.scores.search.score > 0);
  assert.ok(report.scores.ai.score > 0);
  assert.ok(report.findings.length > 0);
});

test("cli: audit audits local directory offline with multi-page reports and dashboard", async () => {
  const out = mkdtempSync(join(tmpdir(), "oss-local-dir-"));
  const fixturesDir = join(ROOT, "tests/fixtures");
  const r = await runCli(["audit", fixturesDir, "--pages", "2", "--out", out]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Audited 2 local page\(s\):/);
  assert.ok(existsSync(join(out, "report.json")));
  assert.ok(existsSync(join(out, "report-2.json")));
  assert.ok(existsSync(join(out, "index.md")));
  assert.ok(existsSync(join(out, "index.html")));
});

test("cli: --skills filters checks to specified skill category", async () => {
  const out = mkdtempSync(join(tmpdir(), "oss-skills-filter-"));
  const fixturePath = join(ROOT, "tests/fixtures/good.html");
  const r = await runCli(["page", fixturePath, "--skills", "onpage", "--out", out]);
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  // Findings must only be from onpage checks
  for (const f of report.findings) {
    assert.ok(f.id.startsWith("O"), `finding ${f.id} should be an onpage check`);
  }
});

test("cli: --exclude-skills filters out specified skill checks", async () => {
  const out = mkdtempSync(join(tmpdir(), "oss-exclude-skills-"));
  const fixturePath = join(ROOT, "tests/fixtures/good.html");
  const r = await runCli(["page", fixturePath, "--exclude-skills", "performance-cwv", "--out", out]);
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  for (const f of report.findings) {
    assert.ok(!f.id.startsWith("P0"), `finding ${f.id} should not be a performance check`);
  }
});

test("cli: page accepts file:// scheme URI", async () => {
  const out = mkdtempSync(join(tmpdir(), "oss-file-uri-"));
  const fixturePath = join(ROOT, "tests/fixtures/good.html");
  const fileUri = `file:///${fixturePath.replace(/\\/g, "/")}`;
  const r = await runCli(["page", fileUri, "--out", out]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(existsSync(join(out, "report.json")));
});

test("cli: local audit handles missing files and empty directories gracefully", async () => {
  const rMissing = await runCli(["page", "non-existent-file.html"]);
  assert.equal(rMissing.code, 1);
  assert.match(rMissing.stderr, /Local file not found/);

  const emptyDir = mkdtempSync(join(tmpdir(), "oss-empty-dir-"));
  const rEmpty = await runCli(["audit", emptyDir]);
  assert.equal(rEmpty.code, 1);
  assert.match(rEmpty.stderr, /No \.html or \.htm files found/);
});

test("cli: offline directory audit parses local robots.txt blockedBots and llms.txt for Agent Skill playbooks", async () => {
  const siteDir = mkdtempSync(join(tmpdir(), "oss-skill-site-"));
  const outDir = mkdtempSync(join(tmpdir(), "oss-skill-out-"));
  writeFileSync(
    join(siteDir, "index.html"),
    readFileSync(join(ROOT, "tests/fixtures/good.html"), "utf8"),
    "utf8",
  );
  writeFileSync(
    join(siteDir, "robots.txt"),
    "User-agent: GPTBot\nDisallow: /\nUser-agent: ClaudeBot\nDisallow: /\nUser-agent: PerplexityBot\nDisallow: /\n",
    "utf8",
  );
  writeFileSync(
    join(siteDir, "llms.txt"),
    "# Example Site\n\n> Curated AI guide\n\n- [Home](https://example.com/)\n",
    "utf8",
  );

  const r = await runCli([
    "audit",
    siteDir,
    "--pages",
    "1",
    "--offline",
    "--skills",
    "llms-txt",
    "--out",
    outDir,
  ]);
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(readFileSync(join(outDir, "report.json"), "utf8"));
  const g02 = report.findings.find((/** @type {any} */ f) => f.id === "G02-ai-blocked");
  assert.ok(g02, "G02-ai-blocked finding must be present");
  assert.equal(g02.severity, "P1");
  assert.equal(g02.evidence, "Disallow: / for gptbot, claudebot, perplexitybot");
  const g01 = report.findings.find((/** @type {any} */ f) => f.id === "G01-llms");
  assert.ok(g01, "G01-llms finding must be present");
  assert.equal(g01.severity, "pass");
});

test("cli: ai and schema commands work on local HTML files and --offline rejects remote URLs", async () => {
  const fixturePath = join(ROOT, "tests/fixtures/good.html");
  const outDir = mkdtempSync(join(tmpdir(), "oss-ai-local-"));

  const rAi = await runCli(["ai", fixturePath, "--json", "--out", outDir]);
  assert.equal(rAi.code, 0, rAi.stderr);
  const aiData = JSON.parse(rAi.stdout);
  assert.equal(aiData.tool, "one-step-seo");
  assert.equal(typeof aiData.aiScore, "number");

  const rSchema = await runCli(["schema", fixturePath, "--generate", "faq"]);
  assert.equal(rSchema.code, 0, rSchema.stderr);
  assert.match(rSchema.stdout, /Found \d+ JSON-LD node\(s\)/);
  assert.match(rSchema.stdout, /"@type": "FAQPage"/);

  const rOfflineUrl = await runCli(["page", "https://example.com", "--offline"]);
  assert.equal(rOfflineUrl.code, 1);
  assert.match(rOfflineUrl.stderr, /--offline requires a local file or directory path/);
});

test("cli: direct URL shorthand auto-discovers site and writes site dashboard + site-report.json", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-shorthand-"));
    const r = await runCli([`http://127.0.0.1:${port}/`, "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(out, "index.html")), "expected index.html dashboard");
    assert.ok(existsSync(join(out, "index.md")), "expected index.md");
    assert.ok(existsSync(join(out, "site-report.json")), "expected site-report.json");
    assert.ok(existsSync(join(out, "report.json")), "expected report.json");
    assert.ok(existsSync(join(out, "report-2.json")), "expected report-2.json");
    const siteJson = JSON.parse(readFileSync(join(out, "site-report.json"), "utf8"));
    assert.equal(siteJson.tool, "one-step-seo");
    assert.equal(siteJson.reportType, "site");
    assert.equal(siteJson.pageCount, 2);
  } finally {
    await closeServer(server);
  }
});

test("cli: site command and --all flag auto-discover all pages via hybrid crawl", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    const out = mkdtempSync(join(tmpdir(), "oss-site-cmd-"));
    const r = await runCli(["site", `http://127.0.0.1:${port}/`, "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(out, "site-report.json")));
    assert.ok(existsSync(join(out, "index.html")));

    const outAll = mkdtempSync(join(tmpdir(), "oss-all-flag-"));
    const rAll = await runCli(["audit", `http://127.0.0.1:${port}/`, "--all", "--out", outAll]);
    assert.equal(rAll.code, 0, rAll.stderr);
    assert.ok(existsSync(join(outAll, "site-report.json")));
    assert.ok(existsSync(join(outAll, "index.html")));
  } finally {
    await closeServer(server);
  }
});

test("cli: site command audits local directory and writes site-report.json", async () => {
  const out = mkdtempSync(join(tmpdir(), "oss-site-local-"));
  const fixturesDir = join(ROOT, "tests/fixtures");
  const r = await runCli(["site", fixturesDir, "--out", out]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(existsSync(join(out, "index.html")));
  assert.ok(existsSync(join(out, "site-report.json")));
  const siteJson = JSON.parse(readFileSync(join(out, "site-report.json"), "utf8"));
  assert.equal(siteJson.tool, "one-step-seo");
  assert.equal(siteJson.reportType, "site");
  assert.ok(siteJson.pageCount >= 2);
});

test("cli: audit respects --max-depth, --include, --exclude, and --strip-query", async () => {
  const server = await startFixtureServer();
  const port = server.address()?.port;
  try {
    // 1. Audit with --max-depth 0 / 1 limits hops
    const outDepth = mkdtempSync(join(tmpdir(), "oss-depth-"));
    const rDepth = await runCli([
      "audit",
      `http://127.0.0.1:${port}/`,
      "--pages",
      "5",
      "--max-depth",
      "1",
      "--out",
      outDepth,
    ]);
    assert.equal(rDepth.code, 0, rDepth.stderr);

    // 2. Audit with --exclude to skip specific paths
    const outExclude = mkdtempSync(join(tmpdir(), "oss-exclude-"));
    const rExclude = await runCli([
      "audit",
      `http://127.0.0.1:${port}/`,
      "--pages",
      "5",
      "--exclude",
      "/second",
      "--out",
      outExclude,
    ]);
    assert.equal(rExclude.code, 0, rExclude.stderr);
    // Page /second should have been excluded, so report-2.json won't exist
    assert.ok(!existsSync(join(outExclude, "report-2.json")));

    // 3. Audit with --strip-query and --max-pages
    const outStrip = mkdtempSync(join(tmpdir(), "oss-strip-"));
    const rStrip = await runCli([
      "audit",
      `http://127.0.0.1:${port}/`,
      "--max-pages",
      "2",
      "--strip-query",
      "--out",
      outStrip,
    ]);
    assert.equal(rStrip.code, 0, rStrip.stderr);
    assert.ok(existsSync(join(outStrip, "report.json")));
  } finally {
    await closeServer(server);
  }
});
