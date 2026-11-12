/**
 * one-step-seo — Package & distribution verification script.
 * Validates entrypoints, exports, line endings, and types.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

console.log(`Verifying ${pkg.name}@${pkg.version}...`);

// 1. Verify bin file exists and has LF line ending in shebang
const binPath = join(ROOT, pkg.bin["one-step-seo"]);
if (!existsSync(binPath)) {
  console.error(`FAIL: bin file not found: ${binPath}`);
  process.exit(1);
}
const binContent = readFileSync(binPath, "utf8");
if (!binContent.startsWith("#!/usr/bin/env node\n") && !binContent.startsWith("#!/usr/bin/env node\r\n")) {
  console.error("FAIL: bin/cli.mjs must start with #!/usr/bin/env node");
  process.exit(1);
}
if (binContent.startsWith("#!/usr/bin/env node\r\n")) {
  console.warn("WARN: bin/cli.mjs has CRLF line ending in shebang; converting to LF recommended");
}

// 2. Verify main and types entrypoints
if (!pkg.main || !existsSync(join(ROOT, pkg.main))) {
  console.error(`FAIL: pkg.main points to missing file: ${pkg.main}`);
  process.exit(1);
}
if (!pkg.types || !existsSync(join(ROOT, pkg.types))) {
  console.error(`FAIL: pkg.types points to missing file: ${pkg.types}`);
  process.exit(1);
}

// 3. Verify programmatic exports
const indexUrl = pathToFileURL(join(ROOT, pkg.main)).href;
const indexModule = await import(indexUrl);
const REQUIRED_EXPORTS = [
  "buildReport",
  "renderHtml",
  "renderMarkdown",
  "renderSiteIndex",
  "buildSiteReport",
  "summarizeAggregate",
  "runChecks",
  "THRESHOLDS",
  "PROFILES",
  "computeScores",
  "extractJsonLd",
  "validateSchema",
  "parseRobots",
  "getSiteFiles",
  "getSitemapUrls",
  "fetchHtml",
  "fetchText",
  "getSkills",
  "parseArgs",
  "normalizeUrl",
  "canonicalizeUrl",
  "getFindingMeta",
  // Platform engines (v0.12)
  "crawlSite",
  "analyzeSite",
  "buildFixPlan",
  "applyFixSession",
  "rollbackFixSession",
  "buildSnapshot",
  "compareSnapshots",
  "sendWebhook",
  "renderSitePdf",
  "renderPdf",
  "loadConfig",
  "VERSION",
];

for (const exp of REQUIRED_EXPORTS) {
  if (indexModule[exp] === undefined) {
    console.error(`FAIL: lib/index.mjs missing required export: ${exp}`);
    process.exit(1);
  }
}

console.log(`OK: All ${REQUIRED_EXPORTS.length} required programmatic exports verified.`);
console.log(`OK: Package distribution verification passed cleanly.`);
