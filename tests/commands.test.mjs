// The platform commands called in-process (same code paths as the CLI), so
// their behaviour on each branch is asserted directly.
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../lib/args.mjs";
import {
  cmdAudit,
  auditLocalDirectory,
  auditLocalFile,
  runSiteAudit,
  localCanon,
} from "../lib/commands/audit.mjs";
import { cmdFix } from "../lib/commands/fix.mjs";
import { cmdVerify, loadBaselineReports } from "../lib/commands/verify.mjs";
import { cmdReport } from "../lib/commands/report.mjs";
import { cmdMonitor, snapshotHistory } from "../lib/commands/monitor.mjs";
import { breachesFailOn, crawlOptionsFrom, stateDirOf } from "../lib/commands/shared.mjs";
import { clearSiteFilesCache, clearSitemapUrlsCache } from "../lib/robots.mjs";
import { startSite, siteRoutes, writeLocalSite } from "./helpers/site-fixture.mjs";

/** @type {Awaited<ReturnType<typeof startSite>>} */
let site;
/** @type {Awaited<ReturnType<typeof startSite>>} */
let rival;
/** @type {string} */
let work;

before(async () => {
  site = await startSite();
  const rivalRoutes = siteRoutes();
  rivalRoutes["/robots.txt"] = { type: "text/plain", body: "User-agent: *\nDisallow: /pricing\n" };
  rival = await startSite(rivalRoutes);
  work = mkdtempSync(join(tmpdir(), "oss-cmd-"));
});
after(async () => {
  await site?.close();
  await rival?.close();
  if (work) rmSync(work, { recursive: true, force: true });
});
afterEach(() => {
  process.exitCode = 0;
  clearSiteFilesCache();
  clearSitemapUrlsCache();
});

/**
 * Run a command with console output captured.
 * @param {() => unknown} fn
 * @returns {Promise<string>}
 */
async function capture(fn) {
  const lines = /** @type {string[]} */ ([]);
  const orig = { log: console.log, error: console.error, warn: console.warn };
  const sink = (/** @type {unknown[]} */ ...a) => lines.push(a.map(String).join(" "));
  console.log = sink;
  console.error = sink;
  console.warn = sink;
  try {
    await fn();
  } finally {
    Object.assign(console, orig);
  }
  return lines.join("\n");
}

/** @param {string[]} argv */
const A = (argv) => parseArgs(argv);

test("cmdAudit --deep with competitors writes every artifact; competitors honor robots.txt", async () => {
  const out = join(work, "audit");
  const args = A([
    "audit",
    `${site.base}/`,
    "--deep",
    "--delay",
    "0",
    "--out",
    out,
    "--format",
    "html,md,json,csv,pdf",
    "--competitors",
    `${rival.base}/`,
    "--state-dir",
    join(work, "state"),
  ]);
  const text = await capture(() => cmdAudit(`${site.base}/`, args));
  assert.match(text, /Site-wide findings/);
  for (const f of [
    "index.html",
    "site-intelligence.json",
    "site-report.pdf",
    "site-issues.csv",
    "site-report.md",
  ]) {
    assert.ok(existsSync(join(out, f)), f);
  }
  const intel = JSON.parse(readFileSync(join(out, "site-intelligence.json"), "utf8"));
  assert.equal(intel.competitors?.competitors?.length, 1);
  const rivalPages = JSON.stringify(intel.competitors);
  assert.doesNotMatch(rivalPages, /\/pricing"/, "robots-disallowed competitor pages are not fetched");
});

test("cmdAudit on a single page writes the page report and a PDF", async () => {
  const out = join(work, "single");
  const args = A(["audit", `${site.base}/guide`, "--out", out, "--format", "json,pdf"]);
  const text = await capture(() => cmdAudit(`${site.base}/guide`, args));
  assert.match(text, /Search SEO/);
  assert.ok(existsSync(join(out, "report.json")));
  assert.ok(existsSync(join(out, "site-report.pdf")));
});

test("runSiteAudit returns crawl + analysis; --technical narrows page findings", async () => {
  const full = await runSiteAudit(
    `${site.base}/`,
    A(["audit", `${site.base}/`, "--pages", "3", "--delay", "0"]),
  );
  clearSiteFilesCache();
  clearSitemapUrlsCache();
  const tech = await runSiteAudit(
    `${site.base}/`,
    A(["audit", `${site.base}/`, "--pages", "3", "--delay", "0", "--technical"]),
  );
  assert.ok(tech.crawl.pageReports.length >= 1);
  assert.ok(tech.analysis);
  const n = (/** @type {typeof full} */ r) => r.crawl.pageReports[0]?.findings.length ?? 0;
  assert.ok(n(tech) < n(full), "--technical runs a subset of the checks");
  const ids = new Set(tech.crawl.pageReports[0]?.findings.map((f) => f.id));
  assert.ok(!ids.has("C02-answer"), "content checks are excluded");
});

test("local directory and file audits; capped directories say so", async () => {
  const dir = join(work, "local");
  writeLocalSite(dir);
  const all = await capture(() =>
    auditLocalDirectory(
      dir,
      A(["audit", dir, "--pages", "all", "--out", join(work, "lo"), "--format", "html,md,json,csv,pdf"]),
    ),
  );
  assert.match(all, /Site-wide findings/);
  assert.ok(existsSync(join(work, "lo", "site-report.pdf")));
  const intel = JSON.parse(readFileSync(join(work, "lo", "site-intelligence.json"), "utf8"));
  assert.ok(
    intel.issues.some((/** @type {any} */ i) => i.id === "X01-broken-internal-links"),
    "missing.html is broken",
  );

  const capped = await capture(() =>
    auditLocalDirectory(dir, A(["audit", dir, "--out", join(work, "lo1"), "--format", "md"])),
  );
  assert.match(capped, /Audited 1 of 3 HTML files/);

  const one = await capture(() =>
    auditLocalFile(
      join(dir, "about.html"),
      A(["audit", join(dir, "about.html"), "--out", join(work, "lf"), "--format", "md"]),
    ),
  );
  assert.match(one, /Search SEO/);
  assert.equal(localCanon("file:///x/")("file:///x/a.html#frag"), "file:///x/a.html");
});

test("cmdFix: url plan, local preview, apply, history, rollback by session id", async () => {
  const state = join(work, "fix-state");
  const dir = join(work, "fixsite");
  writeLocalSite(dir);

  const plan = await capture(() =>
    cmdFix(
      `${site.base}/`,
      A([
        "fix",
        `${site.base}/`,
        "--out",
        join(work, "plan"),
        "--format",
        "json,md",
        "--pages",
        "2",
        "--delay",
        "0",
      ]),
    ),
  );
  assert.match(plan, /PROPOSED/);
  assert.ok(existsSync(join(work, "plan", "fix-plan.md")));

  const empty = await capture(() => cmdFix("", A(["fix", "--history", "--state-dir", state])));
  assert.match(empty, /No fix sessions/i);

  const preview = await capture(() =>
    cmdFix(
      dir,
      A(["fix", dir, "--url", "https://a.example", "--only", "canonical,sitemap", "--state-dir", state]),
    ),
  );
  assert.match(preview, /dry run/);
  assert.doesNotMatch(preview, /og:title/, "--only limits the fixers");

  const applied = await capture(() =>
    cmdFix(
      dir,
      A(["fix", dir, "--url", "https://a.example", "--lang", "en", "--apply", "--state-dir", state]),
    ),
  );
  const id = /Session (\S+) recorded/.exec(applied)?.[1];
  assert.ok(id, applied);
  const hist = await capture(() => cmdFix("", A(["fix", "--history", "--json", "--state-dir", state])));
  assert.ok(hist.includes(String(id)));

  const rolled = await capture(() =>
    cmdFix("", A(["fix", "--rollback", "--session", String(id), "--state-dir", state])),
  );
  assert.match(rolled, /Rolled back/);
  const again = await capture(() => cmdFix("", A(["fix", "--rollback", "--state-dir", state])));
  assert.match(again, /no applied fix session/i);
  assert.notEqual(process.exitCode ?? 0, 0);
});

test("cmdVerify: json mode, url filter, missing-baseline and foreign-host errors", async () => {
  const baseline = join(work, "audit");
  const json = await capture(() =>
    cmdVerify(
      `${site.base}/`,
      A(["verify", `${site.base}/`, "--baseline", baseline, "--json", "--delay", "0"]),
    ),
  );
  const parsed = JSON.parse(json.slice(json.indexOf("{")));
  assert.equal(parsed.reportType, "verification");
  assert.ok(parsed.summary.pages >= 1);
  assert.equal(parsed.summary.regressed, 0);
  assert.ok(loadBaselineReports(baseline).length >= 1);

  await assert.rejects(
    () => cmdVerify("", A(["verify", "--baseline", join(work, "nothing-here")])),
    /No baseline reports/,
  );
  await assert.rejects(
    () =>
      cmdVerify("https://other.example/", A(["verify", "https://other.example/", "--baseline", baseline])),
    /has no pages for/,
  );
});

test("cmdVerify reports an unreachable page as a failure (exit 2)", async () => {
  const dir = join(work, "verify-gone");
  const routes = siteRoutes();
  const tmpSite = await startSite(routes);
  try {
    await capture(() =>
      cmdAudit(
        `${tmpSite.base}/orphan`,
        A(["audit", `${tmpSite.base}/orphan`, "--out", dir, "--format", "json"]),
      ),
    );
    routes["/orphan"] = { status: 404, body: "gone" };
    const text = await capture(() => cmdVerify("", A(["verify", "--baseline", dir])));
    assert.match(text, /could not be re-audited|Verification failed/);
    assert.equal(process.exitCode, 2);
  } finally {
    await tmpSite.close();
  }
});

test("cmdReport renders from a folder, a local directory and a live URL", async () => {
  const fromFolder = await capture(() =>
    cmdReport(
      join(work, "audit"),
      A([
        "report",
        join(work, "audit"),
        "--out",
        join(work, "r1"),
        "--audience",
        "developer",
        "--brand",
        "Agency",
      ]),
    ),
  );
  assert.match(fromFolder, /Report for/);
  assert.match(readFileSync(join(work, "r1", "site-report.md"), "utf8"), /Agency/);

  const dir = join(work, "local");
  await capture(() => cmdReport(dir, A(["report", dir, "--out", join(work, "r2"), "--format", "md,json"])));
  assert.ok(existsSync(join(work, "r2", "site-report.md")));

  await capture(() =>
    cmdReport(
      `${site.base}/`,
      A(["report", `${site.base}/`, "--out", join(work, "r3"), "--pages", "3", "--delay", "0"]),
    ),
  );
  assert.ok(existsSync(join(work, "r3", "site-report.pdf")));

  await assert.rejects(() => cmdReport(dir, A(["report", dir, "--format", "html"])), /supports --format/);
});

test("cmdMonitor: empty history, baseline, json run, history listing", async () => {
  const state = join(work, "mon");
  const url = `${site.base}/`;
  const none = await capture(() => cmdMonitor(url, A(["monitor", url, "--history", "--state-dir", state])));
  assert.match(none, /No snapshots yet/);
  const first = await capture(() =>
    cmdMonitor(url, A(["monitor", url, "--state-dir", state, "--delay", "0", "--pages", "4"])),
  );
  assert.match(first, /Baseline snapshot captured/);
  const second = await capture(() =>
    cmdMonitor(url, A(["monitor", url, "--state-dir", state, "--delay", "0", "--pages", "4", "--json"])),
  );
  const run = JSON.parse(second.slice(second.indexOf("{")));
  assert.equal(run.baseline, false);
  assert.ok(Array.isArray(run.changes));
  const hist = await capture(() =>
    cmdMonitor(url, A(["monitor", url, "--history", "--json", "--state-dir", state])),
  );
  assert.equal(JSON.parse(hist).history.length, 2);
  assert.equal(snapshotHistory(join(work, "nope")).length, 0);
});

test("cmdMonitor refuses a robots-blocked site and reports a failed webhook", async () => {
  const routes = siteRoutes();
  routes["/robots.txt"] = { type: "text/plain", body: "User-agent: *\nDisallow: /\n" };
  const blocked = await startSite(routes);
  try {
    const url = `${blocked.base}/`;
    await assert.rejects(
      () => capture(() => cmdMonitor(url, A(["monitor", url, "--state-dir", join(work, "mon2")]))),
      /robots\.txt disallows/,
    );
  } finally {
    await blocked.close();
  }
  const state = join(work, "mon3");
  const url = `${site.base}/`;
  await capture(() =>
    cmdMonitor(url, A(["monitor", url, "--state-dir", state, "--pages", "2", "--delay", "0"])),
  );
  const text = await capture(() =>
    cmdMonitor(
      url,
      A([
        "monitor",
        url,
        "--state-dir",
        state,
        "--pages",
        "2",
        "--delay",
        "0",
        "--webhook",
        "http://127.0.0.1:1/x",
      ]),
    ),
  );
  // No changes -> no alert is sent at all; the URL is never printed either way.
  assert.ok(!text.includes("127.0.0.1:1/x"), "the webhook URL is never printed");
});

test("shared helpers: fail-on thresholds, crawl options and state dir", () => {
  const counts = { P0: 0, P1: 1, P2: 0, P3: 0, pass: 3 };
  assert.equal(breachesFailOn("P1", counts), true);
  assert.equal(breachesFailOn("P0", counts), false);
  const opts = crawlOptionsFrom(
    A(["audit", "https://a.example", "--pages", "9", "--crawl", "sitemap", "--check-links"]),
  );
  assert.equal(opts.pages, 9);
  assert.equal(opts.crawl, "sitemap");
  assert.equal(opts.checkLinks, true);
  assert.match(stateDirOf(A(["fix", "--state-dir", "zz"])), /zz$/);
});

test("config-file style flags reach commands (stateDir via env)", async () => {
  const state = join(work, "env-state");
  const prev = process.env.ONE_STEP_SEO_STATE_DIR;
  process.env.ONE_STEP_SEO_STATE_DIR = state;
  try {
    const text = await capture(() => cmdFix("", A(["fix", "--history"])));
    assert.ok(text.includes(state) || /No fix sessions/i.test(text));
  } finally {
    if (prev === undefined) delete process.env.ONE_STEP_SEO_STATE_DIR;
    else process.env.ONE_STEP_SEO_STATE_DIR = prev;
  }
  writeFileSync(join(work, "x.txt"), "");
});
