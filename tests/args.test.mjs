import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, normalizeUrl, CliError, VALID_FORMATS } from "../lib/args.mjs";

test("parseArgs defaults", () => {
  const a = parseArgs(["audit", "https://example.com"]);
  assert.deepEqual(a._, ["audit", "https://example.com"]);
  assert.equal(a.pages, 1);
  assert.equal(a.timeout, 15000);
  assert.deepEqual(a.formats, ["html", "md", "json"]);
  assert.equal(a.action, null);
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
    ["audit", "x", "--pages", "21"],
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
