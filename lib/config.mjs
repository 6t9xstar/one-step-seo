/**
 * one-step-seo — configuration file support (zero dependencies).
 *
 * `one-step-seo.config.json` (or `--config <path>`) supplies default values
 * for CLI flags. Precedence: command-line flags > config file > built-in
 * defaults. The file is plain JSON so it can be committed and reviewed.
 *
 * Secrets never belong in the file: API keys are read from environment
 * variables only (e.g. PSI_API_KEY), and any key that looks like a credential
 * is rejected so it cannot be committed by accident.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { CliError } from "./args.mjs";

/** Default config file name looked up in the working directory. */
export const CONFIG_FILE = "one-step-seo.config.json";

/**
 * Config keys -> { flag, kind }. Keys are the camelCase form of the flag.
 * @type {Record<string, { flag: string, kind: "value" | "boolean" | "list" }>}
 */
export const CONFIG_KEYS = {
  pages: { flag: "--pages", kind: "value" },
  out: { flag: "--out", kind: "value" },
  format: { flag: "--format", kind: "list" },
  timeout: { flag: "--timeout", kind: "value" },
  failOn: { flag: "--fail-on", kind: "value" },
  crawl: { flag: "--crawl", kind: "value" },
  concurrency: { flag: "--concurrency", kind: "value" },
  delay: { flag: "--delay", kind: "value" },
  maxDepth: { flag: "--max-depth", kind: "value" },
  include: { flag: "--include", kind: "value" },
  exclude: { flag: "--exclude", kind: "value" },
  stripQuery: { flag: "--strip-query", kind: "boolean" },
  skills: { flag: "--skills", kind: "list" },
  excludeSkills: { flag: "--exclude-skills", kind: "list" },
  profile: { flag: "--profile", kind: "value" },
  checkLinks: { flag: "--check-links", kind: "boolean" },
  blockPrivateIps: { flag: "--block-private-ips", kind: "boolean" },
  force: { flag: "--force", kind: "boolean" },
  quiet: { flag: "--quiet", kind: "boolean" },
  psi: { flag: "--psi", kind: "boolean" },
  psiStrategy: { flag: "--psi-strategy", kind: "value" },
  stateDir: { flag: "--state-dir", kind: "value" },
  competitors: { flag: "--competitors", kind: "list" },
  brand: { flag: "--brand", kind: "value" },
  client: { flag: "--client", kind: "value" },
  audience: { flag: "--audience", kind: "value" },
  interval: { flag: "--interval", kind: "value" },
  keep: { flag: "--keep", kind: "value" },
};

/** Key names that look like credentials — refused. */
const SECRET_KEY = /key|token|secret|password|passwd|credential|webhook/i;

/**
 * Validate a parsed config object. Returns human-readable problems ([] = valid).
 * @param {unknown} config
 * @returns {string[]}
 */
export function validateConfig(config) {
  /** @type {string[]} */
  const problems = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return ["config must be a JSON object"];
  }
  for (const [key, value] of Object.entries(config)) {
    if (key === "$schema") continue;
    if (SECRET_KEY.test(key)) {
      problems.push(
        `"${key}" looks like a credential — keep secrets in environment variables, not in the config file`,
      );
      continue;
    }
    const spec = CONFIG_KEYS[key];
    if (!spec) {
      problems.push(`unknown key "${key}" (valid: ${Object.keys(CONFIG_KEYS).join(", ")})`);
      continue;
    }
    if (spec.kind === "boolean") {
      if (typeof value !== "boolean") problems.push(`"${key}" must be true or false`);
    } else if (spec.kind === "list") {
      const ok =
        typeof value === "string" || (Array.isArray(value) && value.every((v) => typeof v === "string"));
      if (!ok) problems.push(`"${key}" must be a string or an array of strings`);
    } else if (typeof value !== "string" && typeof value !== "number") {
      problems.push(`"${key}" must be a string or number`);
    }
  }
  return problems;
}

/**
 * Convert a validated config object into argv tokens (prepended before the
 * real argv, so explicit flags win because later values override earlier ones).
 * @param {Record<string, unknown>} config
 * @returns {string[]}
 */
export function configToArgv(config) {
  /** @type {string[]} */
  const argv = [];
  for (const [key, value] of Object.entries(config)) {
    const spec = CONFIG_KEYS[key];
    if (!spec) continue;
    if (spec.kind === "boolean") {
      if (value === true) argv.push(spec.flag);
    } else if (spec.kind === "list") {
      const joined = Array.isArray(value) ? value.join(",") : String(value);
      if (joined) argv.push(spec.flag, joined);
    } else if (String(value) !== "") {
      argv.push(spec.flag, String(value));
    }
  }
  return argv;
}

/**
 * Locate and load the config file.
 * @param {{ cwd?: string, explicitPath?: string }} [opts]
 * @returns {{ path: string, config: Record<string, unknown>, argv: string[] } | null} null when no file is present
 * @throws {CliError} when an explicit path is missing, or the file is invalid
 */
export function loadConfig({ cwd = process.cwd(), explicitPath = "" } = {}) {
  const path = explicitPath ? resolve(cwd, explicitPath) : join(cwd, CONFIG_FILE);
  if (!existsSync(path)) {
    if (explicitPath) throw new CliError(`Config file not found: ${explicitPath}`);
    return null;
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new CliError(
      `Config file ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const problems = validateConfig(parsed);
  if (problems.length > 0) {
    throw new CliError(`Config file ${path} is invalid:\n  - ${problems.join("\n  - ")}`);
  }
  const config = /** @type {Record<string, unknown>} */ (parsed);
  return { path, config, argv: configToArgv(config) };
}

/**
 * Pull `--config <path>` / `--config=<path>` / `--no-config` out of argv.
 * @param {string[]} argv
 * @returns {{ argv: string[], configPath: string, noConfig: boolean }}
 */
export function extractConfigFlag(argv) {
  /** @type {string[]} */
  const rest = [];
  let configPath = "";
  let noConfig = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--no-config") noConfig = true;
    else if (a === "--config") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new CliError("Flag --config needs a value.");
      configPath = v;
    } else if (a.startsWith("--config=")) configPath = a.slice("--config=".length);
    else rest.push(a);
  }
  return { argv: rest, configPath, noConfig };
}
