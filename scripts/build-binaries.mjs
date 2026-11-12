#!/usr/bin/env node
/**
 * Build standalone one-step-seo executables with `bun build --compile`.
 * They need no Node.js install. The npm package is unchanged: this only
 * produces extra release assets.
 *
 *   node scripts/build-binaries.mjs                 # this machine's platform only
 *   node scripts/build-binaries.mjs --all           # every supported platform
 *   node scripts/build-binaries.mjs --target bun-linux-x64 [--target ...]
 *   node scripts/build-binaries.mjs --out dist-bin  # output folder (default dist-bin)
 *
 * Requires Bun (https://bun.sh) on PATH. The package version is embedded at
 * compile time (see lib/version.mjs). The binary built for this machine is
 * smoke-tested: `--version` must print the package version, and an offline
 * audit of a fixture page must produce a JSON report. Writes SHA256SUMS.txt
 * beside the binaries.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** Platforms Bun can cross-compile to, and the asset name suffix for each. */
export const TARGETS = /** @type {const} */ ({
  "bun-linux-x64": "linux-x64",
  "bun-linux-arm64": "linux-arm64",
  "bun-darwin-x64": "macos-x64",
  "bun-darwin-arm64": "macos-arm64",
  "bun-windows-x64": "windows-x64.exe",
});

/** @returns {string} the Bun target matching this machine */
function hostTarget() {
  /** @type {Record<string, string>} */
  const osNames = { win32: "windows", darwin: "darwin", linux: "linux" };
  /** @type {Record<string, string>} */
  const archNames = { x64: "x64", arm64: "arm64" };
  const os = osNames[process.platform];
  const arch = archNames[process.arch];
  const t = `bun-${os}-${arch}`;
  if (!os || !arch || !(t in TARGETS))
    throw new Error(`No Bun compile target for ${process.platform}-${process.arch}`);
  return t;
}

/** @param {string[]} argv */
function parse(argv) {
  /** @type {string[]} */
  const targets = [];
  let out = "dist-bin";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") targets.push(...Object.keys(TARGETS));
    else if (a === "--target") targets.push(String(argv[++i] ?? ""));
    else if (a === "--out") out = String(argv[++i] ?? out);
    else throw new Error(`Unknown option ${a}`);
  }
  for (const t of targets) {
    if (!(t in TARGETS))
      throw new Error(`Unknown target ${t}. Supported: ${Object.keys(TARGETS).join(", ")}`);
  }
  return { targets: [...new Set(targets.length > 0 ? targets : [hostTarget()])], out: resolve(root, out) };
}

/**
 * @param {string} cmd @param {string[]} args @param {string} [cwd]
 * @returns {string} stdout
 */
function run(cmd, args, cwd = root) {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: false });
  if (res.error) throw new Error(`${cmd} could not start: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${res.status}\n${res.stdout}\n${res.stderr}`);
  }
  return res.stdout;
}

/** Run the binary built for this machine and check it really works. @param {string} bin */
function smokeTest(bin) {
  const printed = run(bin, ["--version"]).trim();
  if (!printed.includes(pkg.version)) {
    throw new Error(`smoke test: ${basename(bin)} --version printed "${printed}", expected ${pkg.version}`);
  }
  const work = mkdtempSync(join(tmpdir(), "oss-bin-"));
  try {
    const page = join(work, "index.html");
    writeFileSync(
      page,
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Smoke test page</title></head><body><h1>Smoke test</h1><p>Standalone binary check.</p></body></html>',
    );
    const outDir = join(work, "report");
    run(bin, ["audit", page, "--out", outDir, "--format", "json", "--no-config"], work);
    const report = JSON.parse(readFileSync(join(outDir, "report.json"), "utf8"));
    if (report.version !== pkg.version || typeof report.scores?.search?.score !== "number") {
      throw new Error(`smoke test: report.json from ${basename(bin)} is not a valid ${pkg.version} report`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`  smoke test passed: --version ${pkg.version}, offline audit wrote a valid report`);
}

function main() {
  const { targets, out } = parse(process.argv.slice(2));
  const bunVersion = run("bun", ["--version"]).trim();
  mkdirSync(out, { recursive: true });
  console.log(`Building one-step-seo ${pkg.version} with Bun ${bunVersion} → ${out}`);

  const host = hostTarget();
  /** @type {string[]} */
  const sums = [];
  for (const target of targets) {
    const file = join(
      out,
      `one-step-seo-${pkg.version}-${TARGETS[/** @type {keyof typeof TARGETS} */ (target)]}`,
    );
    run("bun", [
      "build",
      join(root, "bin", "cli.mjs"),
      "--compile",
      "--minify",
      `--target=${target}`,
      `--define`,
      `globalThis.__ONE_STEP_SEO_VERSION__=${JSON.stringify(pkg.version)}`,
      "--outfile",
      file,
    ]);
    if (!existsSync(file)) throw new Error(`bun build reported success but ${file} was not written`);
    const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
    sums.push(`${sha}  ${basename(file)}`);
    console.log(`  built ${basename(file)}`);
    if (target === host) smokeTest(file);
  }
  writeFileSync(join(out, "SHA256SUMS.txt"), sums.join("\n") + "\n");
  console.log(`  wrote SHA256SUMS.txt (${sums.length} file${sums.length === 1 ? "" : "s"})`);
}

try {
  main();
} catch (err) {
  console.error(`build-binaries: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
