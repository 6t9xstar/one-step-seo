/**
 * Programmatic Example: Multi-Page Site Audit & Dashboard Generation
 * Run: node examples/programmatic/audit-site.mjs
 */
import {
  runChecks,
  geoDetails,
  computeScores,
  buildReport,
  buildSiteReport,
  renderSiteIndex,
} from "../../lib/index.mjs";

const origin = "https://store.example.com";
const pagePaths = ["/", "/products", "/about", "/contact"];

console.log(`Auditing site: ${origin} (${pagePaths.length} pages)...`);

const reports = pagePaths.map((path, idx) => {
  const url = `${origin}${path}`;
  const pageData = {
    title: path === "/" ? "Home — Store Example" : `${path.slice(1).toUpperCase()} — Store Example`,
    metaDescription: `Comprehensive information and resources for ${path}.`,
    canonical: url,
    h1s: [{ text: path === "/" ? "Welcome to Store" : path.slice(1) }],
    wordCount: 300 + idx * 100,
    hasViewport: true,
    hasCharset: true,
  };

  const findings = runChecks(pageData, {}, { profile: "standard" });
  const geo = geoDetails(pageData, {});
  const scores = computeScores(findings, geo);

  return buildReport({
    url,
    findings,
    scores,
    pageData,
  });
});

// Consolidate full-site metrics
const siteReport = buildSiteReport(reports, { origin });
console.log(`\nSite-Wide Summary:`);
console.log(`- Audited Pages: ${siteReport.pageCount}`);
console.log(`- Avg Search Score: ${siteReport.scores.search.average}/100`);
console.log(`- Avg AI Score:     ${siteReport.scores.ai.average}/100`);

// Generate glassmorphic multi-page dashboard
const dashboardHtml = renderSiteIndex(reports, { origin, title: "Store Multi-Page Audit" });
console.log(`- Dashboard Generated: ${(dashboardHtml.length / 1024).toFixed(1)} KB`);
console.log("Site audit completed successfully.");
