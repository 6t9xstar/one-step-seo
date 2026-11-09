/**
 * Programmatic Example: Single Page Audit & HTML Generation
 * Run: node examples/programmatic/audit-page.mjs
 */
import {
  runChecks,
  geoDetails,
  computeScores,
  buildReport,
  renderHtml,
} from "../../lib/index.mjs";

const samplePage = {
  title: "Modern SEO & AI Citation Optimization Guide",
  metaDescription:
    "Learn how to optimize your web application for both traditional search engines and AI generative engines like ChatGPT and Perplexity.",
  canonical: "https://example.com/guide/modern-seo",
  h1s: [{ text: "Modern SEO & AI Citation Optimization Guide" }],
  h2s: ["Why Technical SEO Still Matters", "Structuring Content for AI Answers"],
  wordCount: 1250,
  hasViewport: true,
  hasCharset: true,
  hasFavicon: true,
  images: [{ src: "/cover.webp", alt: "Modern SEO Guide Banner" }],
  internalLinkCount: 12,
  externalLinkCount: 4,
  author: "SEO Engineering",
  hasMain: true,
  lang: "en",
};

const sampleSite = {
  robots: { found: true, status: 200, aiBlocked: false, sitemaps: ["https://example.com/sitemap.xml"] },
  sitemap: { found: true, status: 200, urlCount: 45 },
  llms: { found: true, status: 200 },
};

console.log("Auditing page programmatically...");

const findings = runChecks(samplePage, sampleSite, { profile: "standard" });
const geo = geoDetails(samplePage, sampleSite);
const scores = computeScores(findings, geo);

console.log(`\nResults:`);
console.log(`- Search SEO:    ${scores.search.score}/100 (Grade: ${scores.search.band})`);
console.log(`- AI Visibility: ${scores.ai.score}/100 (Grade: ${scores.ai.band})`);
console.log(`- Total Findings: ${findings.length}`);

const report = buildReport({
  url: samplePage.canonical,
  findings,
  scores,
  pageData: samplePage,
});

const html = renderHtml(report);
console.log(`- Generated HTML Report size: ${(html.length / 1024).toFixed(1)} KB`);
console.log("Audit completed successfully.");
