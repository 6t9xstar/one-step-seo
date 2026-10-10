/**
 * one-step-seo — CLI argument parsing (pure, unit-tested).
 * parseArgs never touches process state: `--help` / `--version` are
 * returned as actions, and every invalid input throws a CliError
 * carrying the intended process exit code.
 */

/** Valid report formats. @type {string[]} */
export const VALID_FORMATS = ["html", "md", "json", "sarif"];
/** Valid --generate schema kinds. @type {string[]} */
export const VALID_GENERATE = [
  "organization",
  "website",
  "article",
  "faq",
  "breadcrumb",
  "product",
  "event",
  "localbusiness",
  "howto",
];
/** Valid --fail-on severities. @type {string[]} */
export const VALID_FAIL_ON = ["P0", "P1", "P2"];
/** Valid --crawl modes. @type {string[]} */
export const VALID_CRAWL = ["links", "sitemap"];
/**
 * Valid --profile names. Must match Object.keys(PROFILES) in lib/checks.mjs
 * (enforced by test — args.mjs cannot import checks.mjs without a cycle).
 * @type {string[]}
 */
export const VALID_PROFILES = ["default", "blog", "product", "docs", "home"];

/**
 * Upper bound for `--pages`. Raised from 20: a real business site commonly has
 * 50–200 indexable pages, and the old cap silently truncated full-site audits
 * to the first fifth of the domain.
 */
export const MAX_PAGES = 200;
/** Flags that are accepted but carry no value (recognized so --help docs stay true). */
const BOOLEAN_FLAGS = new Set(["--verbose"]);

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
 *   failOn: string, crawl: string, concurrency: number, verbose: boolean,
 *   delay: number, debug: boolean, force: boolean, profile: string,
 *   checkLinks: boolean,
 *   apply: boolean, noBackup: boolean, only: string, url: string,
 *   title: string, description: string, lang: string, ogImage: string,
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
 * Supports both `--flag value` and `--flag=value` forms.
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
    failOn: "",
    crawl: "links",
    concurrency: 4,
    verbose: false,
    delay: 250,
    debug: false,
    force: false,
    profile: "default",
    checkLinks: false,
    apply: false,
    noBackup: false,
    only: "",
    url: "",
    title: "",
    description: "",
    lang: "",
    ogImage: "",
    action: null,
  };
  // Expand --flag=value into --flag value so the loop below stays simple.
  /** @type {string[]} */
  const expanded = [];
  for (const token of argv) {
    const eq = token.startsWith("--") ? token.indexOf("=") : -1;
    if (eq > 2) {
      expanded.push(token.slice(0, eq), token.slice(eq + 1));
    } else {
      expanded.push(token);
    }
  }
  argv = expanded;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // Unreachable (i < argv.length); keeps `a` non-undefined under strict TS.
    if (a === undefined) continue;
    if (a === "--pages") {
      args.pages = takeInt(takeValue(argv, ++i, "--pages"), "--pages", 1, MAX_PAGES);
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
          `Flag --format accepts only ${VALID_FORMATS.join(", ")} (got "${formats.join(",") || "(empty)"}").`,
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
    } else if (a === "--fail-on") {
      const level = takeValue(argv, ++i, "--fail-on").toUpperCase();
      if (!VALID_FAIL_ON.includes(level)) {
        throw new CliError(`Flag --fail-on accepts only ${VALID_FAIL_ON.join(", ")} (got "${level}").`);
      }
      args.failOn = level;
    } else if (a === "--crawl") {
      const mode = takeValue(argv, ++i, "--crawl").toLowerCase();
      if (!VALID_CRAWL.includes(mode)) {
        throw new CliError(`Flag --crawl accepts only ${VALID_CRAWL.join(", ")} (got "${mode}").`);
      }
      args.crawl = mode;
    } else if (a === "--concurrency") {
      args.concurrency = takeInt(takeValue(argv, ++i, "--concurrency"), "--concurrency", 1, 8);
    } else if (a === "--delay") {
      args.delay = takeInt(takeValue(argv, ++i, "--delay"), "--delay", 0, 10000);
    } else if (a === "--debug") {
      args.debug = true;
    } else if (a === "--force") {
      args.force = true;
    } else if (a === "--check-links") {
      args.checkLinks = true;
    } else if (a === "--profile") {
      const name = takeValue(argv, ++i, "--profile").toLowerCase();
      if (!VALID_PROFILES.includes(name)) {
        throw new CliError(`Flag --profile accepts only ${VALID_PROFILES.join(", ")} (got "${name}").`);
      }
      args.profile = name;
    } else if (a === "--apply") {
      args.apply = true;
    } else if (a === "--no-backup") {
      args.noBackup = true;
    } else if (a === "--only") {
      args.only = takeValue(argv, ++i, "--only");
    } else if (a === "--url") {
      args.url = takeValue(argv, ++i, "--url");
    } else if (a === "--title") {
      args.title = takeValue(argv, ++i, "--title");
    } else if (a === "--description") {
      args.description = takeValue(argv, ++i, "--description");
    } else if (a === "--lang") {
      args.lang = takeValue(argv, ++i, "--lang");
    } else if (a === "--og-image") {
      args.ogImage = takeValue(argv, ++i, "--og-image");
    } else if (a === "--json") {
      args.json = true;
    } else if (BOOLEAN_FLAGS.has(a)) {
      // `--verbose` is read from process.argv by the runtime handler; parsing it
      // here keeps `--verbose` from being rejected as an unknown flag.
      args.verbose = true;
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
  const trimmed = String(input).trim();
  if (!trimmed) return "";
  const hasProto = /^https?:\/\//i.test(trimmed);
  try {
    const u = new URL(hasProto ? trimmed : `https://${trimmed}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

/**
 * Canonicalize a URL for crawl dedupe: lowercase host, strip tracking
 * params (utm_*, fbclid, gclid), drop hash, collapse trailing slash
 * (except root). Returns "" for non-http(s) URLs.
 * @param {string} input
 * @returns {string}
 */
export function canonicalizeUrl(input) {
  let u;
  try {
    u = new URL(String(input));
  } catch {
    return "";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  u.host = u.host.toLowerCase();
  u.hash = "";
  const params = new URLSearchParams(u.search);
  for (const key of [...params.keys()]) {
    const k = key.toLowerCase();
    if (k.startsWith("utm_") || k === "fbclid" || k === "gclid" || k === "msclkid") {
      params.delete(key);
    }
  }
  u.search = params.toString() ? `?${params.toString()}` : "";
  let path = u.pathname || "/";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  u.pathname = path;
  return u.toString();
}
