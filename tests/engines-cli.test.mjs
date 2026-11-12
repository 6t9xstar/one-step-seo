// End-to-end: the platform commands (audit --deep, fix, verify, report,
// monitor) run as a real CLI process against a real local site.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSite, siteRoutes, writeLocalSite, page } from "./helpers/site-fixture.mjs";

const CLI = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));

/**
 * Async on purpose: the fixture server lives in this process, so a
 * synchronous spawn would deadlock it.
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function cli(args, opts = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, "--no-config", ...args],
      {
        timeout: 120000,
        env: { ...process.env, NO_COLOR: "1", ...opts.env },
        cwd: opts.cwd,
        maxBuffer: 32 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/** @type {Awaited<ReturnType<typeof startSite>>} */
let site;
/** @type {ReturnType<typeof siteRoutes>} */
let routes;
/** @type {string} */
let work;

before(async () => {
  routes = siteRoutes();
  site = await startSite(routes);
  work = mkdtempSync(join(tmpdir(), "oss-e2e-"));
});
after(async () => {
  await site?.close();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("audit --deep writes site intelligence, CSV and a valid PDF", async () => {
  const out = join(work, "deep");
  const r = await cli([
    "audit",
    `${site.base}/`,
    "--deep",
    "--delay",
    "0",
    "--out",
    out,
    "--format",
    "md,json,csv,pdf",
    "--state-dir",
    join(work, "state"),
  ]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Site-wide findings: \d+/);
  for (const f of [
    "site-intelligence.json",
    "site-report.md",
    "site-issues.csv",
    "site-report.pdf",
    "report.json",
  ]) {
    assert.ok(existsSync(join(out, f)), `${f} written`);
  }
  const intel = JSON.parse(readFileSync(join(out, "site-intelligence.json"), "utf8"));
  assert.equal(intel.reportType, "site-intelligence");
  const ids = intel.issues.map((/** @type {any} */ i) => i.id);
  for (const id of [
    "X01-broken-internal-links",
    "X03-links-to-redirects",
    "X04-orphan-pages",
    "X06-duplicate-titles",
    "X11-sitemap-noindex",
  ]) {
    assert.ok(ids.includes(id), id);
  }
  const pdf = readFileSync(join(out, "site-report.pdf"));
  assert.equal(pdf.subarray(0, 8).toString("latin1"), "%PDF-1.4");
  const csv = readFileSync(join(out, "site-issues.csv"), "utf8");
  assert.match(csv.split("\n")[0] ?? "", /^Scope,URL,Severity,Issue ID/);
  const md = readFileSync(join(out, "site-report.md"), "utf8");
  assert.match(md, /not Google's ranking scores/i, "score methodology is disclosed");
});

test("fix <url> writes a proposed-only plan and refuses --apply on a live site", async () => {
  const out = join(work, "plan");
  const r = await cli(["fix", `${site.base}/`, "--out", out, "--delay", "0", "--safe-only"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /PROPOSED — nothing was modified/);
  const plan = JSON.parse(readFileSync(join(out, "fix-plan.json"), "utf8"));
  assert.ok(plan.entries.length > 0);
  assert.ok(plan.entries.every((/** @type {any} */ e) => e.fixType === "safe" && e.status === "proposed"));

  const refused = await cli(["fix", `${site.base}/`, "--apply"]);
  assert.notEqual(refused.code, 0);
  assert.match(refused.stderr + refused.stdout, /only works on local files/);
});

test("local fix --apply → history → verify (fixed) → rollback restores originals", async () => {
  const dir = join(work, "local-site");
  const state = join(work, "fix-state");
  writeLocalSite(dir);
  const original = readFileSync(join(dir, "index.html"), "utf8");

  const baseline = join(work, "local-baseline");
  const audit = await cli(["audit", dir, "--pages", "all", "--out", baseline, "--format", "json"]);
  assert.equal(audit.code, 0, audit.stderr);

  const preview = await cli(["fix", dir, "--url", "https://a.example", "--lang", "en", "--state-dir", state]);
  assert.equal(preview.code, 0, preview.stderr);
  assert.match(preview.stdout, /dry run, no files written/);
  assert.equal(readFileSync(join(dir, "index.html"), "utf8"), original, "preview does not write");

  const applied = await cli([
    "fix",
    dir,
    "--url",
    "https://a.example",
    "--lang",
    "en",
    "--apply",
    "--state-dir",
    state,
  ]);
  assert.equal(applied.code, 0, applied.stderr);
  assert.match(applied.stdout, /Session \S+ recorded/);
  const fixed = readFileSync(join(dir, "index.html"), "utf8");
  assert.match(fixed, /<link rel="canonical" href="https:\/\/a\.example\/">/);
  assert.match(fixed, /<html lang="en">/);
  assert.ok(existsSync(join(dir, "sitemap.xml")));

  const history = await cli(["fix", "--history", "--state-dir", state]);
  assert.match(history.stdout, /applied/);

  const verify = await cli(["verify", dir, "--baseline", baseline, "--out", join(work, "local-verify")]);
  assert.equal(verify.code, 0, verify.stdout + verify.stderr);
  assert.match(verify.stdout, /VERIFIED FIXED \[P2\] Canonical missing/);
  assert.doesNotMatch(verify.stdout, /NEW \/ WORSE/, "safe fixes introduce no regressions");
  const ver = JSON.parse(readFileSync(join(work, "local-verify", "verification.json"), "utf8"));
  assert.ok(ver.summary.resolved > 0);
  assert.equal(ver.summary.regressed, 0);

  const rollback = await cli(["fix", "--rollback", "--state-dir", state]);
  assert.equal(rollback.code, 0, rollback.stderr);
  assert.equal(readFileSync(join(dir, "index.html"), "utf8"), original);
  assert.equal(existsSync(join(dir, "sitemap.xml")), false);
});

test("report renders client PDF/MD/CSV from an existing audit folder", async () => {
  const out = join(work, "client-report");
  const r = await cli([
    "report",
    join(work, "deep"),
    "--out",
    out,
    "--audience",
    "client",
    "--client",
    "Acme Ltd",
  ]);
  assert.equal(r.code, 0, r.stderr);
  for (const f of ["site-report.pdf", "site-report.md", "site-issues.csv"])
    assert.ok(existsSync(join(out, f)), f);
  const md = readFileSync(join(out, "site-report.md"), "utf8");
  assert.match(md, /Prepared for Acme Ltd/);
});

test("monitor: baseline, then detects a noindex regression, exits 2, and posts the webhook", async () => {
  const state = join(work, "monitor-state");
  /** @type {any[]} */
  const hooks = [];
  const { createServer } = await import("node:http");
  const receiver = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      hooks.push(JSON.parse(b));
      res.end("ok");
    });
  });
  await new Promise((r) => receiver.listen(0, "127.0.0.1", () => r(null)));
  const hookUrl = `http://127.0.0.1:${/** @type {any} */ (receiver.address()).port}/hook`;
  try {
    const first = await cli(["monitor", `${site.base}/`, "--state-dir", state, "--delay", "0"]);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /Baseline snapshot captured/);

    routes["/guide"] = {
      body: page({
        title: "Crawling and Indexing Guide for Site Owners",
        description: "z".repeat(130),
        head: `<meta name="robots" content="noindex">`,
      }),
    };
    const second = await cli(["monitor", `${site.base}/`, "--state-dir", state, "--delay", "0"], {
      env: { ONE_STEP_SEO_WEBHOOK: hookUrl },
    });
    assert.equal(second.code, 2, "critical change -> exit 2");
    assert.match(second.stdout, /noindex/i);
    assert.equal(hooks.length, 1);
    assert.ok(hooks[0].summary.critical >= 1);
    assert.doesNotMatch(second.stdout + second.stderr, /\/hook\b/, "the webhook URL is never printed");

    const dir = readdirSync(join(state, "monitor"));
    assert.equal(dir.length, 1);
    const files = readdirSync(join(state, "monitor", dir[0] ?? ""));
    assert.equal(files.filter((f) => f.startsWith("snapshot-")).length, 2);
    assert.ok(files.includes("changes.json"));

    const history = await cli(["monitor", `${site.base}/`, "--history", "--state-dir", state]);
    assert.match(history.stdout, /2 snapshot\(s\)/);
  } finally {
    await new Promise((r) => receiver.close(() => r(null)));
  }
});

test("doctor --check-config validates the project config file", async () => {
  const dir = join(work, "cfg");
  writeLocalSite(dir);
  writeFileSync(join(dir, "one-step-seo.config.json"), JSON.stringify({ pages: 5, apiKey: "nope" }));
  const bad = await new Promise((resolve) => {
    execFile(process.execPath, [CLI, "doctor", "--check-config"], { cwd: dir }, (error, stdout, stderr) =>
      resolve({ code: error ? Number(error.code) : 0, out: String(stdout) + String(stderr) }),
    );
  });
  const res = /** @type {{ code: number, out: string }} */ (bad);
  assert.equal(res.code, 1);
  assert.match(res.out, /credential/);
});
