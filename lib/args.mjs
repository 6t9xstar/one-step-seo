/**
 * one-step-seo — CLI argument parsing (pure, unit-tested).
 * parseArgs never touches process state: `--help` / `--version` are
 * returned as actions, and every invalid input throws a CliError
 * carrying the intended process exit code.
 */

/** Valid report formats. @type {string[]} */
export const VALID_FORMATS = ["html", "md", "json"];
/** Valid --generate schema kinds. @type {string[]} */
export const VALID_GENERATE = ["organization", "website", "article", "faq", "breadcrumb"];

/**
 * Error with an intended process exit code (1 = usage, 2 = runtime).
 */
export class CliError extends Error {
  /** @param {string} message @param {1 | 2} [code] */
  constructor(message, code = 1) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}

/**
 * @typedef {{
 *   _: string[], pages: number, out: string, formats: string[],
 *   timeout: number, generate: string, json: boolean,
 *   action: null | "help" | "version"
 * }} ParsedArgs
 */

/**
 * Take the next argv value for a flag, rejecting missing values.
 * @param {string[]} argv @param {number} i @param {string} flag
 * @returns {string}
 */
function takeValue(argv, i, flag) {
  const v = argv[i];
  if (v === undefined || v.startsWith("--")) {
    throw new CliError(`Flag ${flag} needs a value.`);
  }
  return v;
}

/**
 * @param {string} raw @param {string} flag @param {number} min @param {number} max
 * @returns {number}
 */
function takeInt(raw, flag, min, max) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new CliError(`Flag ${flag} needs an integer ${min}-${max} (got "${raw}").`);
  }
  return n;
}

/**
 * Parse argv (without node/bin prefix) into validated options.
 * @param {string[]} argv
 * @returns {ParsedArgs}
 * @throws {CliError}
 */
export function parseArgs(argv) {
  /** @type {ParsedArgs} */
  const args = {
    _: [],
    pages: 1,
    out: "./seo-report",
    formats: ["html", "md", "json"],
    timeout: 15000,
    generate: "",
    json: false,
    action: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pages") {
      args.pages = takeInt(takeValue(argv, ++i, "--pages"), "--pages", 1, 20);
    } else if (a === "--out") {
      args.out = takeValue(argv, ++i, "--out");
    } else if (a === "--format") {
      const formats = takeValue(argv, ++i, "--format")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const bad = formats.filter((f) => !VALID_FORMATS.includes(f));
      if (formats.length === 0 || bad.length > 0) {
        throw new CliError(
          `Flag --format accepts only ${VALID_FORMATS.join(", ")} (got "${formats.join(",") || "(empty)"}").`
        );
      }
      args.formats = [...new Set(formats)];
    } else if (a === "--timeout") {
      args.timeout = takeInt(takeValue(argv, ++i, "--timeout"), "--timeout", 1000, 120000);
    } else if (a === "--generate") {
      const kind = takeValue(argv, ++i, "--generate").toLowerCase();
      if (!VALID_GENERATE.includes(kind)) {
        throw new CliError(`Flag --generate accepts only ${VALID_GENERATE.join(", ")} (got "${kind}").`);
      }
      args.generate = kind;
    } else if (a === "--json") {
      args.json = true;
    } else if (a === "--help" || a === "-h") {
      args.action = "help";
      return args;
    } else if (a === "--version" || a === "-v") {
      args.action = "version";
      return args;
    } else if (a.startsWith("--")) {
      throw new CliError(`Unknown flag: ${a}. See --help.`);
    } else {
      args._.push(a);
    }
  }
  return args;
}

/**
 * Normalize user input to an absolute http(s) URL, or "" if invalid.
 * @param {string} input
 * @returns {string}
 */
export function normalizeUrl(input) {
  if (!input) return "";
  const hasProto = /^https?:\/\//i.test(input);
  try {
    const u = new URL(hasProto ? input : `https://${input}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString();
  } catch {
    return "";
  }
}
