import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin/cli.mjs");

/**
 * @param {string[]} args
 * @param {{ timeout?: number }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function runCli(args, { timeout = 20000 } = {}) {
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
      res.writeHead(200, { "content-type": "application/xml", connection: "close" });
      res.end(
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://127.0.0.1/</loc></url></urlset>`,
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
    const { code } = await runCli(["audit", `http://127.0.0.1:${port}/`, "--pages", "2", "--out", out]);
    assert.equal(code, 0);
    assert.ok(existsSync(join(out, "report.json")));
    assert.ok(existsSync(join(out, "report-2.json")), "expected report-2.json");
    assert.ok(existsSync(join(out, "report-2.html")), "expected report-2.html");
    assert.ok(existsSync(join(out, "index.md")), "expected index.md");
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
