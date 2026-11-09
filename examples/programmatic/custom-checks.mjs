/**
 * Programmatic Example: Custom Profiles, Thresholds & Finding Filtering
 * Run: node examples/programmatic/custom-checks.mjs
 */
import {
  runChecks,
  PROFILES,
  THRESHOLDS,
  FINDING_META,
  geoDetails,
  computeScores,
} from "../../lib/index.mjs";

console.log("Exploring available profiles:");
console.log(Object.keys(PROFILES).map((k) => `  - ${k}: ${PROFILES[k].label}`).join("\n"));

console.log("\nStandard Title Thresholds:");
console.log(`  - Minimum title length: ${THRESHOLDS.titleMin} characters`);
console.log(`  - Maximum title length: ${THRESHOLDS.titleMax} characters`);

// Page with a brief title and missing meta description
const testPage = {
  title: "Short", // < 30 chars
  canonical: "https://example.com/short",
  h1s: [{ text: "Short" }],
  wordCount: 150, // thin content (< 200 words)
};

// 1. Audit using standard profile
const standardFindings = runChecks(testPage, {}, { profile: "standard" });
console.log(`\nStandard Profile Findings: ${standardFindings.length}`);

// 2. Audit using strict profile (stricter word counts and rules)
const strictFindings = runChecks(testPage, {}, { profile: "strict" });
console.log(`Strict Profile Findings:   ${strictFindings.length}`);

// 3. Inspect high-priority findings with actionable remediation
const p0AndP1 = standardFindings.filter((f) => f.severity === "P0" || f.severity === "P1");
console.log(`\nCritical (P0/P1) Action Items (${p0AndP1.length}):`);
for (const finding of p0AndP1) {
  const meta = FINDING_META[finding.id];
  console.log(`  [${finding.severity}] ${finding.id}: ${finding.title}`);
  console.log(`    Fix: ${finding.fix}`);
  if (meta) {
    console.log(`    Effort: ${meta.effort} | Owner: ${meta.owner}`);
  }
}
