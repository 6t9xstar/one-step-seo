/**
 * one-step-seo — Programmatic API entrypoint (zero dependencies, Node 18+).
 * Exports core audit, scoring, checks, schema, reporting, robots, and skill utilities.
 */

// Report generation & formatting
export {
  buildReport,
  renderMarkdown,
  renderHtml,
  renderSiteIndex,
  renderSarif,
  renderCsv,
  buildSiteReport,
  summarizeAggregate,
  isValidScore,
  verdictFor,
  topFixes,
  citableChecklist,
  groupByCategory,
  monitorItems,
  siteBasename,
  siteTopFindings,
  coverageLine,
  findDuplicateTitles,
  esc,
  escMd,
  escTruncate,
  SEV_RANK,
} from "./report.mjs";

// Checks, thresholds & profiles
export { runChecks, sanitizeSchemaType, THRESHOLDS, PROFILES, MAX_LINK_CHECKS } from "./checks.mjs";

export { getFindingMeta, FINDING_META } from "./finding-meta.mjs";

// Schema extraction & validation
export { extractJsonLd, validateSchema, schemaSnippet, generateSchema } from "./schema.mjs";

// Scoring & GEO signals
export {
  computeScores,
  scoreBand,
  geoDetails,
  GEO_ONLY_IDS,
  GEO_WEIGHTS,
  SEARCH_WEIGHTS,
  RULES_VERSION,
} from "./score.mjs";

// Robots.txt, Sitemaps & LLMs.txt
export {
  parseRobots,
  parseRobotsGroups,
  robotsRuleMatches,
  isDisallowed,
  looksLikeSitemap,
  countSitemapUrls,
  isSitemapIndex,
  extractSitemapUrls,
  getSiteFiles,
  getSitemapUrls,
  clearSiteFilesCache,
  clearSitemapUrlsCache,
  originOf,
  AI_BOTS,
  MAX_SITEMAP_CHILDREN,
  MAX_SITEMAP_SEED_URLS,
} from "./robots.mjs";

// Fetch layer & SSRF protection
export {
  fetchWithRedirects,
  fetchWithRedirects as fetchHtml,
  fetchText,
  safePinnedFetch,
  validateTargetUrl,
  isPrivateOrLoopbackHost,
  isBlockedMetadataEndpoint,
  ipv4ToUint32,
  readCappedText,
  MAX_REDIRECTS,
  MAX_HTML_BYTES,
  MAX_TEXT_BYTES,
} from "./fetch.mjs";

// Automated remediation & diffing
export { planFixes, FIXER_NAMES, FIXERS } from "./fix.mjs";

export { unifiedDiff } from "./diff.mjs";

export { diffReports, isReport } from "./report-diff.mjs";

// Agent Skills
export {
  getSkills,
  getAgentSkills,
  getSkill,
  getCategories,
  filterSkills,
  getSkillForCheck,
  matchesSkillChecks,
  checkMatchesSkillRule,
  SKILLS,
  AGENT_SKILLS,
  CATEGORIES as SKILL_CATEGORIES,
} from "./skills.mjs";

// CLI argument parsing & URL utilities
export {
  parseArgs,
  normalizeUrl,
  canonicalizeUrl,
  isLocalPath,
  CliError,
  MAX_PAGES,
  VALID_FORMATS,
  VALID_GENERATE,
  VALID_FAIL_ON,
  VALID_CRAWL,
  VALID_PROFILES,
} from "./args.mjs";

// Colors
export { createColorHelper, c } from "./colors.mjs";

// ---------------------------------------------------------------------------
// Platform engines (v0.12): crawl, SEO Intelligence, Auto-Fix, Monitoring,
// reporting. Each engine is usable on its own.
// ---------------------------------------------------------------------------

// Crawl engine
export {
  crawlSite,
  analyzeOne,
  pageFacts,
  analyzeLocalFile,
  collectHtmlFiles,
  isAssetUrl,
  robotsPathOf,
  NON_HTML_EXTENSIONS,
} from "./crawl.mjs";

// SEO Intelligence engine (site-level analysis)
export {
  analyzeSite,
  clickDepths,
  categoryScores,
  isValidHreflang,
  suggestInternalLinks,
  contentBriefs,
  compareCompetitors,
} from "./intelligence.mjs";

// SEO Auto-Fix engine (plans, safe fixes, sessions, rollback)
export {
  classifyFinding,
  buildFixPlan,
  renderFixPlanMarkdown,
  buildSitemapXml,
  buildRobotsTxt,
  suggestAltText,
  planSiteFixes,
  planLocalFixes,
  applyFixSession,
  listFixSessions,
  rollbackFixSession,
  APPROVAL_FINDINGS,
  SITE_FIXER_NAMES,
} from "./autofix.mjs";

// SEO Monitoring engine (snapshots, change detection, alerts)
export {
  buildSnapshot,
  compareSnapshots,
  summarizeChanges,
  monitorDir,
  saveSnapshot,
  loadLatestSnapshot,
  listSnapshots,
  sendWebhook,
} from "./monitor.mjs";

// Reporting (site report: Markdown / CSV / PDF) and the PDF writer
export { renderSiteMarkdown, renderSiteCsv, renderSitePdf, siteReportOutline } from "./site-report.mjs";
export { renderPdf } from "./pdf.mjs";

// Project config file + local state store
export { loadConfig, validateConfig, CONFIG_FILE } from "./config.mjs";
export { resolveStateDir } from "./state.mjs";
export { VERSION, USER_AGENT } from "./version.mjs";
