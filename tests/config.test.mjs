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
import { execFileSync } from "node:child_process";
import { dirname, join, resolve, sep } from "node:path";
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

test("every relative import resolves to a git-tracked file", () => {
  // Regression: HEAD once shipped bin/cli.mjs + lib/report.mjs importing
  // isDisallowed / finding-meta.mjs while those lived only as uncommitted /
  // untracked files — every command crashed on a fresh checkout, and no gate
  // caught it because tests run against the (complete) working tree.
  let tracked;
  try {
    const out = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", timeout: 15000 });
    tracked = new Set(String(out).split(/\r?\n/).filter(Boolean));
  } catch {
    // No git (npm tarball, export) — nothing to enforce.
    return;
  }
  /** @type {string[]} */
  const sources = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith(".mjs")) sources.push(full);
    }
  };
  for (const d of ["bin", "lib", "scripts"]) walk(join(ROOT, d));
  /** @type {string[]} */
  const dangling = [];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    const re = /(?:import|export)[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const spec = m[1] ?? m[2] ?? "";
      if (!spec.startsWith(".")) continue;
      const abs = resolve(dirname(file), spec);
      const rel = abs.startsWith(ROOT + sep)
        ? abs
            .slice(ROOT.length + 1)
            .split(sep)
            .join("/")
        : spec;
      const from = file
        .slice(ROOT.length + 1)
        .split(sep)
        .join("/");
      if (!tracked.has(rel)) dangling.push(`${rel} (imported by ${from})`);
    }
  }
  assert.deepEqual(dangling, []);
});
