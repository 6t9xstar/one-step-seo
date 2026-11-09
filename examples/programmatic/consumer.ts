/**
 * Programmatic Example: TypeScript Consumer
 * Compile: npx tsc examples/programmatic/consumer.ts --noEmit
 */
import {
  runChecks,
  geoDetails,
  computeScores,
  buildReport,
  renderHtml,
  type Report,
  type Finding,
  type Scores,
  type ParsedPageData,
  type SiteFilesData,
} from "../../lib/index.mjs";

const samplePage: ParsedPageData = {
  title: "TypeScript Integration — one-step-seo",
  description: "End-to-end typed example of using one-step-seo as a library.",
  canonical: "https://example.com/ts-integration",
  h1s: ["TypeScript Integration"],
  wordCount: 500,
  hasViewport: true,
  hasCharset: true,
  hasFavicon: true,
};

const sampleSite: SiteFilesData = {
  robots: {
    found: true,
    status: 200,
    sitemaps: ["https://example.com/sitemap.xml"],
    disallowCount: 0,
    aiBlocked: false,
    blockedBots: [],
  },
};

const findings: Finding[] = runChecks(samplePage, sampleSite, { profile: "standard" });
const geo = geoDetails(samplePage, sampleSite);
const scores: Scores = computeScores(findings, geo);

const report: Report = buildReport({
  url: samplePage.canonical ?? "https://example.com",
  findings,
  scores,
  pageData: samplePage,
});

const html: string = renderHtml(report);
console.log(`TypeScript consumer generated report of ${html.length} bytes.`);
