/**
 * one-step-seo — single source of truth for the package version and the
 * crawler identity. Every module that sends requests or stamps reports reads
 * these instead of hardcoding a version string that drifts on release.
 */
import { readFileSync } from "node:fs";

let version = "0.0.0";
try {
  version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? version;
} catch {
  // Bundled or embedded layout without package.json — keep the fallback.
}

/** Package version (from package.json). */
export const VERSION = version;
/** Product token used for robots.txt group matching. */
export const UA_TOKEN = "one-step-seo";
/** User-Agent sent on every request. */
export const USER_AGENT = `Mozilla/5.0 (compatible; one-step-seo/${VERSION}; +https://github.com/6t9xstar/one-step-seo)`;
