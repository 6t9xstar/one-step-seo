// Platform pieces: PDF writer, project config file, state store, and the
// security hardening (decompression cap, linear-time robots matching).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync, brotliCompressSync, deflateSync } from "node:zlib";
import { renderPdf, toWinAnsi, wrapText } from "../lib/pdf.mjs";
import { validateConfig, configToArgv, loadConfig, extractConfigFlag, CONFIG_FILE } from "../lib/config.mjs";
import { parseArgs } from "../lib/args.mjs";
import { resolveStateDir, writeJsonAtomic, readJson, newId, slug, prune, listDir } from "../lib/state.mjs";
import { inflateCapped } from "../lib/fetch.mjs";
import { robotsRuleMatches, isDisallowed } from "../lib/robots.mjs";
import { VERSION, USER_AGENT } from "../lib/version.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "oss-platform-"));

// ---------------------------------------------------------------- PDF

test("renderPdf emits a structurally valid multi-page PDF with a correct xref table", () => {
  const blocks = [
    { text: "Report title", style: /** @type {const} */ ("title") },
    ...Array.from({ length: 150 }, (_, i) => ({
      text: `Bullet line ${i} (with parens) and a backslash \\ — “quotes” €`,
      style: /** @type {const} */ ("bullet"),
    })),
  ];
  const pdf = renderPdf(blocks, { title: "T", footer: "footer text" });
  const s = pdf.toString("latin1");
  assert.ok(s.startsWith("%PDF-1.4"));
  assert.ok(s.trimEnd().endsWith("%%EOF"));
  const pageCount = (s.match(/\/Type \/Page\b/g) ?? []).length;
  assert.ok(pageCount >= 3, `150 bullets span several pages (got ${pageCount})`);
  assert.match(s, new RegExp(`Page 1 of ${pageCount}`));
  // Every xref offset points at the start of "N 0 obj".
  const startxref = Number(/startxref\s+(\d+)/.exec(s)?.[1]);
  assert.ok(s.slice(startxref).startsWith("xref"));
  const entries = [...s.slice(startxref).matchAll(/^(\d{10}) 00000 n/gm)].map((m) => Number(m[1]));
  entries.forEach((off, i) => assert.ok(s.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1} offset`));
  // Literal-string specials are escaped.
  assert.match(s, /\\\(with parens\\\)/);
});

test("toWinAnsi maps typographic characters and replaces the unmappable", () => {
  assert.deepEqual(toWinAnsi("A"), [65]);
  assert.deepEqual(toWinAnsi("€"), [0x80]);
  assert.deepEqual(toWinAnsi("—"), [0x97]);
  assert.deepEqual(toWinAnsi(" "), [0x20]);
  assert.deepEqual(toWinAnsi("​"), []);
  assert.deepEqual(toWinAnsi("漢"), [0x3f]);
});

test("wrapText never exceeds the width and keeps every word", () => {
  const text = "lorem ipsum dolor sit amet ".repeat(20).trim();
  const lines = wrapText(text, 10, false, 200);
  assert.ok(lines.length > 1);
  const back = lines.map((l) => Buffer.from(l).toString("latin1")).join(" ");
  assert.equal(back.split(/\s+/).length, text.split(/\s+/).length);
});

// ---------------------------------------------------------------- config

test("validateConfig refuses credentials and unknown keys, accepts known settings", () => {
  assert.deepEqual(validateConfig({ pages: 50, format: ["html", "pdf"], checkLinks: true }), []);
  assert.match(validateConfig({ psiApiKey: "x" })[0] ?? "", /credential/);
  assert.match(validateConfig({ webhook: "https://hooks" })[0] ?? "", /credential/);
  assert.match(validateConfig({ nope: 1 })[0] ?? "", /unknown key/);
  assert.match(validateConfig({ checkLinks: "yes" })[0] ?? "", /true or false/);
  assert.deepEqual(validateConfig([]), ["config must be a JSON object"]);
});

test("config values become argv that explicit CLI flags override", () => {
  const argv = configToArgv({ pages: 40, format: ["md", "pdf"], checkLinks: true, force: false });
  assert.deepEqual(argv, ["--pages", "40", "--format", "md,pdf", "--check-links"]);
  const args = parseArgs([...argv, "audit", "https://a.example", "--pages", "5"]);
  assert.equal(args.pages, 5, "the command line wins");
  assert.ok(args.formats.includes("pdf"));
  assert.equal(args.checkLinks, true);
});

test("loadConfig finds the project file, rejects invalid JSON, and honors --config/--no-config", () => {
  const dir = tmp();
  try {
    assert.equal(loadConfig({ cwd: dir }), null);
    writeFileSync(join(dir, CONFIG_FILE), JSON.stringify({ pages: 12, stateDir: "state" }));
    const found = loadConfig({ cwd: dir });
    assert.deepEqual(found?.argv, ["--pages", "12", "--state-dir", "state"]);
    writeFileSync(join(dir, "bad.json"), "{ nope");
    assert.throws(() => loadConfig({ cwd: dir, explicitPath: "bad.json" }), /not valid JSON/);
    assert.throws(() => loadConfig({ cwd: dir, explicitPath: "missing.json" }), /not found/);
    writeFileSync(join(dir, "secret.json"), JSON.stringify({ apiToken: "abc" }));
    assert.throws(() => loadConfig({ cwd: dir, explicitPath: "secret.json" }), /credential/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(extractConfigFlag(["audit", "--config=x.json", "u"]), {
    argv: ["audit", "u"],
    configPath: "x.json",
    noConfig: false,
  });
  assert.equal(extractConfigFlag(["--no-config"]).noConfig, true);
  assert.throws(() => extractConfigFlag(["--config"]), /needs a value/);
});

test("new audit flags: --deep, --technical and --on-page", () => {
  const deep = parseArgs(["audit", "https://a.example", "--deep"]);
  assert.equal(deep.deep, true);
  assert.equal(deep.checkLinks, true);
  assert.ok(deep.pages > 100);
  assert.equal(parseArgs(["audit", "https://a.example", "--deep", "--pages", "7"]).pages, 7);
  assert.equal(parseArgs(["audit", "u", "--technical"]).skills, "technical,security,performance");
  assert.equal(parseArgs(["audit", "u", "--on-page"]).skills, "onpage,schema,architecture,accessibility");
  assert.equal(parseArgs(["audit", "u", "--technical", "--skills", "geo"]).skills, "geo");
  assert.throws(() => parseArgs(["report", "u", "--audience", "everyone"]));
  assert.throws(() => parseArgs(["monitor", "u", "--interval", "0"]));
});

// ---------------------------------------------------------------- state

test("state store: dir resolution, atomic JSON, ids, slugs and pruning", () => {
  assert.equal(resolveStateDir("x", {}), resolve("x"));
  assert.equal(resolveStateDir("", { ONE_STEP_SEO_STATE_DIR: "y" }), resolve("y"));
  assert.equal(resolveStateDir("", {}), resolve(".one-step-seo"));
  const dir = tmp();
  try {
    const f = join(dir, "a", "b.json");
    writeJsonAtomic(f, { ok: 1 });
    assert.deepEqual(readJson(f), { ok: 1 });
    assert.deepEqual(listDir(join(dir, "a")), ["b.json"], "no temp files left behind");
    writeFileSync(join(dir, "broken.json"), "{");
    assert.equal(readJson(join(dir, "broken.json")), null);
    for (const n of ["1", "2", "3", "4"]) writeFileSync(join(dir, `s-${n}`), n);
    assert.deepEqual(
      prune(dir, 2, (n) => n.startsWith("s-")),
      ["s-1", "s-2"],
    );
    assert.equal(existsSync(join(dir, "s-4")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.match(newId(new Date("2026-01-02T03:04:05Z")), /^20260102T030405Z-[0-9a-f]{6}$/);
  assert.equal(slug("../../etc/passwd"), "etc_passwd");
  assert.equal(slug(""), "site");
});

// ---------------------------------------------------------------- hardening

test("inflateCapped stops at the output cap (decompression-bomb defence)", async () => {
  const bomb = gzipSync(Buffer.alloc(20 * 1024 * 1024, 0x61));
  assert.ok(bomb.length < 100 * 1024, "20 MiB of 'a' compresses to a tiny payload");
  const out = await inflateCapped(bomb, "gzip", 1024 * 1024);
  assert.equal(out?.buf.length, 1024 * 1024);
  assert.equal(out?.truncated, true);

  const small = await inflateCapped(gzipSync(Buffer.from("hello")), "gzip");
  assert.equal(small?.buf.toString(), "hello");
  assert.equal(small?.truncated, false);
  assert.equal((await inflateCapped(brotliCompressSync(Buffer.from("br!")), "br"))?.buf.toString(), "br!");
  assert.equal((await inflateCapped(deflateSync(Buffer.from("zz")), "deflate"))?.buf.toString(), "zz");
  // Input cut mid-stream (wire cap) still yields what decoded.
  const big = gzipSync(Buffer.from("x".repeat(200000) + "END"));
  const cut = await inflateCapped(big.subarray(0, Math.floor(big.length / 2)), "gzip");
  assert.ok(cut && cut.buf.length > 0);
  assert.equal(await inflateCapped(Buffer.from("not compressed"), "gzip"), null);
});

test("robots wildcard matching is correct and linear-time on hostile patterns", () => {
  assert.equal(robotsRuleMatches("/private", "/private/x"), true);
  assert.equal(robotsRuleMatches("/*.pdf$", "/docs/a.pdf"), true);
  assert.equal(robotsRuleMatches("/*.pdf$", "/docs/a.pdf?x=1"), false);
  assert.equal(robotsRuleMatches("/a*b*c", "/a-x-b-y-c"), true);
  assert.equal(robotsRuleMatches("/a*b*c", "/a-x-c-y-b"), false);
  assert.equal(robotsRuleMatches("/exact$", "/exact"), true);
  assert.equal(robotsRuleMatches("/exact$", "/exactly"), false);
  // Classic catastrophic-backtracking shape: many wildcards, near-miss path.
  const rule = `/${"*a".repeat(40)}$`;
  const path = `/${"a".repeat(5000)}b`;
  const t0 = performance.now();
  assert.equal(robotsRuleMatches(rule, path), false);
  assert.ok(performance.now() - t0 < 500, "no exponential blow-up");
  assert.equal(isDisallowed("User-agent: *\nDisallow: /*?sort=", "one-step-seo", "/list?sort=asc"), true);
});

test("the User-Agent version tracks package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, pkg.version);
  assert.ok(USER_AGENT.includes(`one-step-seo/${pkg.version}`));
});
