/**
 * one-step-seo — single source of truth for the package version and the
 * crawler identity. Every module that sends requests or stamps reports reads
 * these instead of hardcoding a version string that drifts on release.
 *
 * Standalone executables (`bun build --compile`, see scripts/build-binaries.mjs)
 * have no package.json beside them, so the build replaces
 * `globalThis.__ONE_STEP_SEO_VERSION__` with the version string at compile
 * time. The npm package reads package.json as before.
 */
import { readFileSync } from "node:fs";

/** @type {unknown} */
const embedded = /** @type {any} */ (globalThis).__ONE_STEP_SEO_VERSION__;

let version = "0.0.0";
if (typeof embedded === "string" && embedded) {
  version = embedded;
} else {
  try {
    version =
      JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? version;
  } catch {
    // Bundled layout without package.json and no embedded version — keep the fallback.
  }
}

/** Package version (from package.json, or embedded by the binary build). */
export const VERSION = version;
/** Product token used for robots.txt group matching. */
export const UA_TOKEN = "one-step-seo";
/** User-Agent sent on every request. */
export const USER_AGENT = `Mozilla/5.0 (compatible; one-step-seo/${VERSION}; +https://github.com/6t9xstar/one-step-seo)`;
