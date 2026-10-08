/**
 * Guards the one piece of test config that cannot be auto-discovered:
 * `node --test tests/` is not supported (it fails with
 * `Cannot find module ...tests`), so the test file list is hardcoded in
 * package.json. This test fails the moment a new tests/*.test.mjs file is
 * added without being registered, instead of silently never running.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** @param {string} script @returns {string[]} */
function listedFiles(script) {
  return String(script)
    .split(/\s+/)
    .filter((t) => t.endsWith(".test.mjs"))
    .map((t) => t.replace(/^tests\//, ""))
    .sort();
}

const onDisk = readdirSync(join(ROOT, "tests"))
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

test("tests/ contains at least the expected files", () => {
  assert.ok(onDisk.length >= 10, `expected a populated tests/ dir, got ${JSON.stringify(onDisk)}`);
});

for (const name of ["test", "test:coverage", "test:coverage:gate"]) {
  test(`npm run ${name} lists every tests/*.test.mjs file`, () => {
    assert.ok(pkg.scripts[name], `missing script "${name}"`);
    assert.deepEqual(listedFiles(pkg.scripts[name]), onDisk);
  });
}

test("test:coverage uses a real Node coverage flag", () => {
  // Regression: it shipped as `--test-coverage`, which is not a Node option and
  // made the script exit 9 with `node: bad option` on every run.
  assert.ok(
    /--experimental-test-coverage\b/.test(pkg.scripts["test:coverage"]),
    "test:coverage must pass --experimental-test-coverage",
  );
  assert.ok(
    !/(^|\s)--test-coverage(\s|$)/.test(pkg.scripts["test:coverage"]),
    "test:coverage must not pass the invalid bare --test-coverage flag",
  );
});

test("no runtime dependencies are declared", () => {
  // The whole selling point is a zero-install CLI; a stray runtime dep would
  // silently break `npx one-step-seo` for users behind a proxy.
  assert.deepEqual(pkg.dependencies ?? {}, {});
});
