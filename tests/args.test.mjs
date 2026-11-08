import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseArgs,
  normalizeUrl,
  canonicalizeUrl,
  isLocalPath,
  CliError,
  VALID_FORMATS,
  VALID_PROFILES,
  MAX_PAGES,
} from "../lib/args.mjs";
import { PROFILES } from "../lib/checks.mjs";

test("parseArgs defaults", () => {
  const a = parseArgs(["audit", "https://example.com"]);
  assert.deepEqual(a._, ["audit", "https://example.com"]);
  assert.equal(a.pages, 1);
  assert.equal(a.timeout, 15000);
  assert.deepEqual(a.formats, ["html", "md", "json"]);
  assert.equal(a.action, null);
  assert.equal(a.delay, 250);
  assert.equal(a.debug, false);
  assert.equal(a.force, false);
});

test("parseArgs accepts valid flags", () => {
  const a = parseArgs(["audit", "example.com", "--pages", "5", "--format", "json,md", "--timeout", "3000"]);
  assert.equal(a.pages, 5);
  assert.deepEqual(a.formats, ["json", "md"]);
  assert.equal(a.timeout, 3000);
});

test("parseArgs rejects out-of-range numbers", () => {
  for (const argv of [
    ["audit", "x", "--pages", "0"],
    ["audit", "x", "--pages", String(MAX_PAGES + 1)],
    ["audit", "x", "--pages", "abc"],
    ["audit", "x", "--timeout", "500"],
    ["audit", "x", "--timeout", "999999"],
  ]) {
    assert.throws(() => parseArgs(argv), CliError);
  }
});

test("parseArgs rejects bad formats and dedupes", () => {
  assert.throws(() => parseArgs(["audit", "x", "--format", "exe"]), CliError);
  assert.throws(() => parseArgs(["audit", "x", "--format", ""]), CliError);
  assert.throws(() => parseArgs(["audit", "x", "--format", "json,exe"]), CliError);
  assert.deepEqual(parseArgs(["audit", "x", "--format", "json,json"]).formats, ["json"]);
  assert.ok(VALID_FORMATS.includes("html"));
  assert.deepEqual(parseArgs(["audit", "x", "--format", "json,sarif"]).formats, ["json", "sarif"]);
});

test("parseArgs rejects unknown flags and missing values", () => {
  assert.throws(() => parseArgs(["audit", "x", "--bogus"]), CliError);
  assert.throws(() => parseArgs(["audit", "x", "--pages"]), CliError);
  assert.throws(() => parseArgs(["audit", "x", "--out", "--json"]), CliError);
  assert.throws(() => parseArgs(["audit", "x", "--generate", "sitemap"]), CliError);
});

test("parseArgs handles help and version actions", () => {
  assert.equal(parseArgs(["--help"]).action, "help");
  assert.equal(parseArgs(["-h"]).action, "help");
  assert.equal(parseArgs(["--version"]).action, "version");
});

test("normalizeUrl accepts hosts and rejects junk", () => {
  assert.equal(normalizeUrl("example.com"), "https://example.com/");
  assert.equal(normalizeUrl("https://example.com/a?b=c"), "https://example.com/a?b=c");
  assert.equal(normalizeUrl(""), "");
  assert.equal(normalizeUrl("not a url at all !!!"), "");
  assert.equal(normalizeUrl("javascript:alert(1)"), "");
});

test("parseArgs accepts all fix flags", () => {
  const a = parseArgs([
    "fix",
    "./dist",
    "--apply",
    "--no-backup",
    "--url",
    "https://example.com/",
    "--title",
    "Fixture title",
    "--description",
    "Fixture description",
    "--lang",
    "fr",
    "--og-image",
    "https://example.com/og.png",
    "--only",
    "title,og",
    "--json",
  ]);
  assert.equal(a.apply, true);
  assert.equal(a.noBackup, true);
  assert.equal(a.url, "https://example.com/");
  assert.equal(a.title, "Fixture title");
  assert.equal(a.description, "Fixture description");
  assert.equal(a.lang, "fr");
  assert.equal(a.ogImage, "https://example.com/og.png");
  assert.equal(a.only, "title,og");
  assert.equal(a.json, true);
});

test("canonicalizeUrl returns empty for unparseable input", () => {
  assert.equal(canonicalizeUrl("not a url at all !!!"), "");
  assert.equal(canonicalizeUrl(""), "");
});

test("parseArgs accepts politeness and safety flags", () => {
  const a = parseArgs(["audit", "x", "--delay", "0", "--debug", "--force", "--quiet", "--block-private-ips"]);
  assert.equal(a.delay, 0);
  assert.equal(a.debug, true);
  assert.equal(a.force, true);
  assert.equal(a.quiet, true);
  assert.equal(a.blockPrivateIps, true);
  assert.equal(parseArgs(["audit", "x", "-q"]).quiet, true);
  assert.equal(parseArgs(["audit", "x", "--delay=500"]).delay, 500);
});

test("parseArgs rejects out-of-range --delay", () => {
  assert.throws(() => parseArgs(["audit", "x", "--delay", "-1"]), CliError);
  assert.throws(() => parseArgs(["audit", "x", "--delay", "10001"]), CliError);
  assert.throws(() => parseArgs(["audit", "x", "--delay", "abc"]), CliError);
});

test("parseArgs handles --check-links (default off)", () => {
  assert.equal(parseArgs(["audit", "x"]).checkLinks, false);
  assert.equal(parseArgs(["audit", "x", "--check-links"]).checkLinks, true);
});

test("parseArgs accepts known profiles, rejects unknown ones", () => {
  assert.equal(parseArgs(["audit", "x"]).profile, "default");
  assert.equal(parseArgs(["audit", "x", "--profile", "product"]).profile, "product");
  assert.equal(parseArgs(["audit", "x", "--profile=docs"]).profile, "docs");
  assert.throws(() => parseArgs(["audit", "x", "--profile", "enterprise"]), CliError);
  assert.throws(() => parseArgs(["audit", "x", "--profile"]), CliError);
});

test("VALID_PROFILES matches the PROFILES registry keys", () => {
  assert.deepEqual([...VALID_PROFILES].sort(), Object.keys(PROFILES).sort());
});

test("parseArgs handles --psi and --psi-strategy", () => {
  assert.equal(parseArgs(["audit", "x"]).psi, false);
  assert.equal(parseArgs(["audit", "x"]).psiStrategy, "mobile");
  const a = parseArgs(["audit", "x", "--psi", "--psi-strategy", "desktop"]);
  assert.equal(a.psi, true);
  assert.equal(a.psiStrategy, "desktop");
  assert.equal(parseArgs(["audit", "x", "--psi-strategy=mobile"]).psiStrategy, "mobile");
  assert.throws(() => parseArgs(["audit", "x", "--psi-strategy", "tablet"]), CliError);
  assert.throws(() => parseArgs(["audit", "x", "--psi-strategy"]), CliError);
});

test("parseArgs handles --skills, --exclude-skills, and --offline", () => {
  const a = parseArgs([
    "audit",
    "x",
    "--offline",
    "--skills",
    "technical,onpage",
    "--exclude-skills",
    "performance",
  ]);
  assert.equal(a.offline, true);
  assert.equal(a.skills, "technical,onpage");
  assert.equal(a.excludeSkills, "performance");
});

test("isLocalPath correctly identifies local file paths and file URIs", () => {
  assert.equal(isLocalPath("./index.html"), true);
  assert.equal(isLocalPath("../site/page.htm"), true);
  assert.equal(isLocalPath("/var/www/index.html"), true);
  assert.equal(isLocalPath("C:\\Users\\dev\\index.html"), true);
  assert.equal(isLocalPath("file:///path/to/page.html"), true);
  assert.equal(isLocalPath("index.html"), true);
  assert.equal(isLocalPath("https://example.com"), false);
  assert.equal(isLocalPath("http://127.0.0.1:3000/"), false);
  assert.equal(isLocalPath("example.com"), false);
});

test("parseArgs handles --all, --pages all, and --crawl auto", () => {
  const allFlag = parseArgs(["audit", "x", "--all"]);
  assert.equal(allFlag.all, true);
  assert.equal(allFlag.pages, MAX_PAGES);
  assert.equal(allFlag.crawl, "auto");

  const pagesAll = parseArgs(["audit", "x", "--pages", "all"]);
  assert.equal(pagesAll.all, true);
  assert.equal(pagesAll.pages, MAX_PAGES);
  assert.equal(pagesAll.crawl, "auto");

  const pagesMax = parseArgs(["audit", "x", "--pages=max"]);
  assert.equal(pagesMax.all, true);
  assert.equal(pagesMax.pages, MAX_PAGES);
  assert.equal(pagesMax.crawl, "auto");

  const crawlAuto = parseArgs(["audit", "x", "--crawl", "auto", "--pages", "5"]);
  assert.equal(crawlAuto.crawl, "auto");
  assert.equal(crawlAuto.pages, 5);
  assert.equal(crawlAuto.all, false);
});
