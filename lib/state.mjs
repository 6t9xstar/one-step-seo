/**
 * one-step-seo — local state store (zero dependencies).
 *
 * Fix history and monitoring snapshots live as plain JSON files under a state
 * directory (default `./.one-step-seo`, override with --state-dir or
 * ONE_STEP_SEO_STATE_DIR). No database, no service: the files are the record,
 * so backup is a directory copy and recovery is a directory restore.
 *
 * Writes are atomic (temp file + rename) so an interrupted run never leaves a
 * half-written manifest behind.
 */
import { mkdirSync, writeFileSync, renameSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash, randomBytes } from "node:crypto";

/** Default state directory name, relative to the working directory. */
export const DEFAULT_STATE_DIR = ".one-step-seo";

/**
 * Resolve the state directory: explicit flag > env > ./.one-step-seo.
 * @param {string} [explicit]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} absolute path
 */
export function resolveStateDir(explicit, env = process.env) {
  return resolve(explicit || env.ONE_STEP_SEO_STATE_DIR || DEFAULT_STATE_DIR);
}

/**
 * Atomically write a file (temp + rename in the same directory).
 * @param {string} file
 * @param {string | Buffer} data
 */
export function writeFileAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, data);
  try {
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * @param {string} file
 * @param {unknown} value
 */
export function writeJsonAtomic(file, value) {
  writeFileAtomic(file, JSON.stringify(value, null, 2) + "\n");
}

/**
 * Read and parse a JSON file; null when missing or unparseable.
 * @param {string} file
 * @returns {any}
 */
export function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {string | Buffer} data
 * @returns {string} hex sha256
 */
export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Sortable, filesystem-safe id: UTC timestamp + 6 random hex chars.
 * @param {Date} [now]
 * @returns {string}
 */
export function newId(now = new Date()) {
  const ts = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${ts}-${randomBytes(3).toString("hex")}`;
}

/**
 * Filesystem-safe slug for a host or path ("example.com:8080" -> "example.com_8080").
 * @param {string} s
 * @returns {string}
 */
export function slug(s) {
  return (
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, "_")
      .replace(/^[_.]+|[_.]+$/g, "")
      .slice(0, 100) || "site"
  );
}

/**
 * Names of entries in a directory, sorted ascending ([] when missing).
 * @param {string} dir
 * @returns {string[]}
 */
export function listDir(dir) {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/**
 * Keep only the newest `keep` entries (by sorted name) in a directory.
 * @param {string} dir
 * @param {number} keep
 * @param {(name: string) => boolean} [filter]
 * @returns {string[]} removed entry names
 */
export function prune(dir, keep, filter = () => true) {
  const names = listDir(dir).filter(filter);
  const drop = names.slice(0, Math.max(0, names.length - Math.max(1, keep)));
  for (const n of drop) rmSync(join(dir, n), { recursive: true, force: true });
  return drop;
}
