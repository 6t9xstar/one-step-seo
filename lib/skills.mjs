/**
 * one-step-seo — Modular Skills Architecture & Registry.
 *
 * Provides a programmatic catalog of auditing skills, grouping specific
 * check rules into coherent capabilities: Technical SEO, On-Page SEO,
 * Structured Data, Generative Engine Optimization (GEO), Performance,
 * Security, Accessibility, Internationalization, and Site Architecture,
 * plus the structured Agent Skill workflow catalog (`AGENT_SKILLS`).
 *
 * Zero runtime dependencies, fully offline-inspectable.
 */

/**
 * @typedef {"technical" | "onpage" | "schema" | "geo" | "performance" | "security" | "accessibility" | "international" | "architecture"} SkillCategory
 * @typedef {"P0" | "P1" | "P2" | "P3"} Severity
 * @typedef {{
 *   id: string,
 *   name: string,
 *   category: SkillCategory,
 *   description: string,
 *   purpose: string,
 *   checks: string[],
 *   severities: Severity[],
 *   remediation: string,
 *   limitations: string,
 *   offlineSupported: boolean,
 *   agentSkill?: string,
 *   aliases?: string[],
 *   cliCommands?: string[],
 *   externalData?: string
 * }} SkillDefinition
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   domain: string,
 *   purpose: string,
 *   cliSupport: string,
 *   externalData: string,
 *   path: string
 * }} AgentSkillEntry
 */

/**
 * Canonical categories metadata.
 * @type {Record<SkillCategory, { name: string, description: string }>}
 */
export const CATEGORIES = {
  technical: {
    name: "Technical SEO",
    description: "Crawlability, indexability, canonicalization, robots.txt, and sitemap infrastructure.",
  },
  onpage: {
    name: "On-Page SEO",
    description: "Titles, meta descriptions, heading structures, image metadata, and internal links.",
  },
  schema: {
    name: "Structured Data",
    description: "Schema.org markup validation, JSON-LD extraction, and FAQ/Entity parity.",
  },
  geo: {
    name: "AI Search & GEO",
    description: "Generative Engine Optimization, citeability, LLM crawler access, and structured facts.",
  },
  performance: {
    name: "Performance & CWV",
    description: "Page weight, third-party script bloat, caching headers, and Core Web Vitals.",
  },
  security: {
    name: "Security & Hygiene",
    description: "HTTPS enforcement, mixed-content prevention, SSRF protection, and transport security.",
  },
  accessibility: {
    name: "Accessibility & UX",
    description: "Document language, viewport scaling, descriptive image alt text, and semantic landmarks.",
  },
  international: {
    name: "International & Local",
    description: "Hreflang localization, language tags, and local business signals.",
  },
  architecture: {
    name: "Content & Architecture",
    description: "Content substance, comparison tables, link distribution, and duplicate titles.",
  },
};

/**
 * Structured Agent Skill library (`skills/<id>/SKILL.md`).
 * Connects agent interpretation and decision workflows to deterministic CLI checks.
 * @type {AgentSkillEntry[]}
 */
export const AGENT_SKILLS = [
  {
    id: "seo-audit",
    name: "End-to-End SEO & AI Visibility Audit",
    domain: "Core Workflow",
    purpose:
      "Run full-site or single-page audits, interpret dual Search/AI scores, and produce prioritized action plans.",
    cliSupport: "audit, page, quick, ai",
    externalData: "None (optional PSI_API_KEY for --psi)",
    path: "skills/seo-audit/SKILL.md",
  },
  {
    id: "seo-fix",
    name: "Conservative Preview-First Remediation",
    domain: "Core Workflow",
    purpose:
      "Plan, preview, and apply additive HTML metadata fixes with explicit user approval and backup safety.",
    cliSupport: "fix (--apply, --only, --json)",
    externalData: "None (operates on local HTML files/directories)",
    path: "skills/seo-fix/SKILL.md",
  },
  {
    id: "technical-seo",
    name: "Technical SEO & Indexability",
    domain: "Technical SEO",
    purpose:
      "Diagnose HTTP status chains, canonical alignment, indexation blockers, mixed content, and security headers.",
    cliSupport: "audit, page (--skills technical-seo)",
    externalData: "None (live HTTP headers when auditing URLs)",
    path: "skills/technical-seo/SKILL.md",
  },
  {
    id: "sitemap-robots",
    name: "Sitemap & Robots Policy",
    domain: "Technical SEO",
    purpose:
      "Validate robots.txt directives, XML sitemap discovery, sitemap index structure, and crawl budget boundaries.",
    cliSupport: "sitemap, audit --crawl sitemap (--skills sitemap-robots)",
    externalData: "None (Google Search Console coverage optional for advisory comparison)",
    path: "skills/sitemap-robots/SKILL.md",
  },
  {
    id: "onpage-optimization",
    name: "On-Page Metadata & Heading Optimization",
    domain: "On-Page & Content",
    purpose:
      "Optimize title tags, meta descriptions, H1-H6 hierarchy, image alt/dimension attributes, and social cards.",
    cliSupport: "page, audit, fix (--skills onpage-seo)",
    externalData: "None (search query CTR data optional for advisory copy tuning)",
    path: "skills/onpage-optimization/SKILL.md",
  },
  {
    id: "content-quality",
    name: "Content Depth & Extractability",
    domain: "On-Page & Content",
    purpose:
      "Evaluate word count substance, answer-first openings, semantic landmarks (<main>/<article>), and data tables.",
    cliSupport: "page, audit (--skills content-architecture --profile blog|docs|product|home)",
    externalData: "None",
    path: "skills/content-quality/SKILL.md",
  },
  {
    id: "duplicate-content",
    name: "Duplicate Metadata & Canonical Clustering",
    domain: "On-Page & Content",
    purpose:
      "Detect cross-page duplicate titles and meta descriptions, H1/title drift, and conflicting canonical/og:url tags.",
    cliSupport: "audit --pages N (--skills duplicate-content)",
    externalData: "None",
    path: "skills/duplicate-content/SKILL.md",
  },
  {
    id: "internal-linking",
    name: "Internal Linking & Orphan Detection",
    domain: "On-Page & Content",
    purpose:
      "Audit internal link density, generic anchor text, broken internal links (--check-links), and sitemap-only orphan pages.",
    cliSupport: "audit --crawl sitemap --check-links (--skills internal-linking)",
    externalData: "None",
    path: "skills/internal-linking/SKILL.md",
  },
  {
    id: "geo-optimization",
    name: "Generative Engine Optimization (GEO / AEO)",
    domain: "GEO / AEO / AI Search",
    purpose:
      "Maximize AI citation readiness with direct answers, entity consistency, factual density, author attribution, and snippet eligibility.",
    cliSupport: "ai, page, audit (--skills geo-ai-search)",
    externalData: "None",
    path: "skills/geo-optimization/SKILL.md",
  },
  {
    id: "llms-txt",
    name: "llms.txt & AI Crawler Access Policy",
    domain: "GEO / AEO / AI Search",
    purpose:
      "Audit /llms.txt structure, verify robots.txt rules across 25 AI crawler tokens, and generate curated starter drafts.",
    cliSupport: "llms, ai (--skills llms-txt)",
    externalData: "None",
    path: "skills/llms-txt/SKILL.md",
  },
  {
    id: "schema-validation",
    name: "Structured Data & Rich Result Validation",
    domain: "Structured Data",
    purpose:
      "Validate JSON-LD syntax, @graph inheritance, required properties across 17 Schema.org types, and FAQ visible parity.",
    cliSupport: "schema --generate <kind>, page (--skills schema-structured-data)",
    externalData: "None",
    path: "skills/schema-validation/SKILL.md",
  },
  {
    id: "core-web-vitals",
    name: "Core Web Vitals & Performance Hygiene",
    domain: "Performance & Quality",
    purpose:
      "Interpret Lighthouse lab metrics and CrUX 75th-percentile field LCP, INP, and CLS alongside HTML/script bloat.",
    cliSupport: "page --psi, audit --psi (--skills performance-cwv)",
    externalData: "PSI_API_KEY required for live Google PageSpeed Insights lab/field metrics",
    path: "skills/core-web-vitals/SKILL.md",
  },
  {
    id: "seo-regression",
    name: "CI/CD SEO Regression & Release Gating",
    domain: "Monitoring & Reporting",
    purpose:
      "Compare baseline vs candidate report.json artifacts, gate CI pipelines on new/escalated P0-P2 findings, and emit SARIF 2.1.0.",
    cliSupport: "diff <old.json> <new.json> --fail-on P1, audit --format sarif,csv",
    externalData: "Baseline report.json artifact from prior run or main branch",
    path: "skills/seo-regression/SKILL.md",
  },
];

/**
 * Master catalog of skills in one-step-seo.
 * @type {SkillDefinition[]}
 */
export const SKILLS = [
  {
    id: "technical-seo",
    name: "Technical SEO & Indexability",
    category: "technical",
    description:
      "Audits HTTP status, canonical URLs, robots.txt directives, XML sitemaps, charset, and page payload integrity.",
    purpose:
      "Ensures search engines and AI web crawlers can discover, fetch, and properly index pages without crawl budget waste or indexation blockers.",
    checks: [
      "T00-truncated",
      "T01-https",
      "T02-status",
      "T03-redirects",
      "T04-content-type",
      "T05-robots",
      "T05-robots-disallow",
      "T06-sitemap",
      "T07-noindex",
      "T08-canonical",
      "T10-charset",
      "T12-url",
      "T13-mixed",
      "T14-third-party",
      "T15-security-headers",
      "T16-broken-links",
      "T17-canonical-http",
    ],
    severities: ["P0", "P1", "P2", "P3"],
    remediation:
      "Set unambiguous self-referential or canonical tags, serve clean 200 responses, ensure valid XML sitemaps, and keep robots.txt permissive for public assets.",
    limitations:
      "JavaScript-only links rendered dynamically via client hydration without server-side rendering require pre-rendering.",
    offlineSupported: true,
    agentSkill: "skills/technical-seo/SKILL.md",
    cliCommands: ["audit", "page"],
    externalData: "None",
  },
  {
    id: "onpage-seo",
    name: "On-Page SEO & Content Metadata",
    category: "onpage",
    description:
      "Evaluates page titles, meta descriptions, H1-H6 heading hierarchy, image dimensions, alt text, and Open Graph tags.",
    purpose:
      "Optimizes snippet click-through rates, semantic document outlines, and social sharing appearances across search engines and social networks.",
    checks: [
      "O01-title-missing",
      "O01-title-short",
      "O01-title-long",
      "O02-meta-missing",
      "O02-meta-short",
      "O02-meta-long",
      "O03-h1-missing",
      "O03-h1-multi",
      "O03-h1-drift",
      "O04-headings",
      "O04-heading-empty",
      "O05-h2",
      "O06-og",
      "O07-favicon",
      "O08-alt",
      "O09-img-dims",
      "O10-internal",
      "O10-internal-many",
      "O11-generic-anchors",
    ],
    severities: ["P0", "P1", "P2", "P3"],
    remediation:
      "Write concise, keyword-accurate titles (30-60 chars), descriptive meta descriptions (120-155 chars), use single H1, and populate explicit image alt text.",
    limitations:
      "Does not analyze visual rendering layout shifts directly without PageSpeed Insights or headless rendering.",
    offlineSupported: true,
    agentSkill: "skills/onpage-optimization/SKILL.md",
    aliases: ["onpage-optimization"],
    cliCommands: ["page", "audit", "fix"],
    externalData: "None",
  },
  {
    id: "schema-structured-data",
    name: "Structured Data & Schema.org",
    category: "schema",
    description:
      "Extracts and validates JSON-LD microdata, enforces required Schema.org fields, and checks FAQ/content parity.",
    purpose:
      "Enables rich snippets, knowledge graph cards, and structured entity recognition in modern search results.",
    checks: ["S01-json-invalid", "S01-none", "S02-", "S03-faq-parity"],
    severities: ["P1", "P2", "P3"],
    remediation:
      "Implement valid JSON-LD schemas (@type WebSite, Organization, Article, Product, FAQPage, LocalBusiness) with all required properties matching visible body content.",
    limitations:
      "Validates syntactic correctness and essential Schema.org properties; does not verify third-party Google Search Console live merchant feed approvals.",
    offlineSupported: true,
    agentSkill: "skills/schema-validation/SKILL.md",
    aliases: ["schema-validation", "structured-data", "ecommerce-seo"],
    cliCommands: ["schema", "page", "audit"],
    externalData: "None",
  },
  {
    id: "geo-ai-search",
    name: "Generative Engine Optimization (GEO)",
    category: "geo",
    description:
      "Audits AI search visibility, llms.txt discovery, AI bot access (GPTBot, ClaudeBot, PerplexityBot), answer capsules, and quote-worthy data points.",
    purpose:
      "Maximizes visibility and citation rates across LLM answer engines like ChatGPT Search, Claude, Perplexity, and Google AI Overviews.",
    checks: [
      "G01-llms",
      "G02-ai-blocked",
      "G03-facts",
      "G04-entity",
      "G05-llms-quality",
      "G06-freshness",
      "G07-question-headings",
      "G08-stat-density",
      "G09-snippet-controls",
      "G10-author",
      "G11-semantic-content",
    ],
    severities: ["P1", "P2", "P3"],
    remediation:
      "Allow major AI bots in robots.txt, provide an /llms.txt file, structure clear answer capsules (40-60 words), include explicit author metadata, and use <main> landmark.",
    limitations:
      "LLM indexing policies vary by provider; high citability signals improve readiness but do not guarantee generative inclusion.",
    offlineSupported: true,
    agentSkill: "skills/geo-optimization/SKILL.md",
    aliases: ["geo-optimization"],
    cliCommands: ["ai", "llms", "page", "audit"],
    externalData: "None",
  },
  {
    id: "performance-cwv",
    name: "Performance & Core Web Vitals",
    category: "performance",
    description:
      "Analyzes HTML payload size, image asset counts, third-party script hosts, cache-control headers, and PageSpeed Insights LCP/CLS/INP metrics.",
    purpose: "Improves user experience, mobile page load speed, and Core Web Vitals ranking signals.",
    checks: [
      "P01-html-size",
      "P02-img-count",
      "P03-psi-lab",
      "P04-psi-field",
      "P05-psi-error",
      "T14-third-party",
      "T15-security-headers",
    ],
    severities: ["P1", "P2", "P3"],
    remediation:
      "Compress assets, defer non-essential third-party JavaScript, set immutable cache headers, and optimize Largest Contentful Paint elements.",
    limitations:
      "Live Core Web Vitals lab and field metrics require an active network connection and a valid Google PageSpeed Insights API key.",
    offlineSupported: false,
    agentSkill: "skills/core-web-vitals/SKILL.md",
    aliases: ["core-web-vitals", "cwv"],
    cliCommands: ["page --psi", "audit --psi"],
    externalData: "PSI_API_KEY (optional for live lab/field CWV)",
  },
  {
    id: "security-hygiene",
    name: "Security & Network Reliability",
    category: "security",
    description:
      "Checks HTTPS enforcement, active and passive mixed content, secure canonical schemes, SSRF IP boundaries, and security headers.",
    purpose:
      "Protects site visitors from insecure transport, avoids browser security warnings, and safeguards audit runner safety against network tampering.",
    checks: ["T01-https", "T13-mixed", "T15-security-headers", "T17-canonical-http"],
    severities: ["P0", "P1", "P2", "P3"],
    remediation:
      "Upgrade all HTTP references to HTTPS, ensure Strict-Transport-Security is enabled, and replace insecure canonical tags.",
    limitations:
      "Network header checks require an active HTTP server response; mixed content checks inspect HTML source.",
    offlineSupported: true,
    agentSkill: "skills/technical-seo/SKILL.md",
    cliCommands: ["page", "audit"],
    externalData: "None",
  },
  {
    id: "accessibility-ux",
    name: "Accessibility & Mobile Readiness",
    category: "accessibility",
    description:
      "Validates document language (html lang), responsive viewport tags, non-empty headings, descriptive image alt attributes, and non-generic anchor text.",
    purpose:
      "Ensures that pages are readable by screen readers, accessible on mobile devices, and easily navigable by keyboard and assistive tech.",
    checks: ["T09-lang", "T11-viewport", "O08-alt", "O04-heading-empty", "O11-generic-anchors"],
    severities: ["P1", "P2", "P3"],
    remediation:
      "Specify an ISO language on <html>, provide a responsive viewport meta tag, write descriptive image alt text, and replace 'click here' links with informative anchors.",
    limitations:
      "Does not replace a complete WCAG 2.2 AA audit; focuses on foundational machine-verifiable HTML a11y signals.",
    offlineSupported: true,
    agentSkill: "skills/onpage-optimization/SKILL.md",
    aliases: ["a11y"],
    cliCommands: ["page", "audit", "fix"],
    externalData: "None",
  },
  {
    id: "international-local",
    name: "Internationalization & Local SEO",
    category: "international",
    description:
      "Audits hreflang alternate language declarations, language-region consistency, and LocalBusiness schema markup.",
    purpose:
      "Ensures international visitors and local searchers are directed to the correct regional language variant and business coordinates.",
    checks: ["W03-hreflang", "T09-lang", "S02-"],
    severities: ["P2", "P3"],
    remediation:
      "Add reciprocal hreflang links with valid ISO codes including x-default, and mark up LocalBusiness details (name, address, telephone, openingHours).",
    limitations:
      "Complete cross-domain hreflang reciprocity verification requires crawling all referenced regional domains.",
    offlineSupported: true,
    agentSkill: "skills/schema-validation/SKILL.md",
    aliases: ["international-seo", "i18n", "local-seo"],
    cliCommands: ["page", "schema --generate localbusiness"],
    externalData: "None",
  },
  {
    id: "content-architecture",
    name: "Content Substance & Architecture",
    category: "architecture",
    description:
      "Detects thin content, short pages, tabular data structures, social graph cards, duplicate titles across crawls, and orphan page risks.",
    purpose:
      "Evaluates substantive depth, structured informational presentation, and cohesive internal link distribution across the website.",
    checks: [
      "C01-thin",
      "C02-answer",
      "C03-extractable",
      "C04-faq",
      "C05-table-headers",
      "W01-social",
      "W02-og-url",
    ],
    severities: ["P1", "P2", "P3"],
    remediation:
      "Expand thin pages with comprehensive subject coverage (300+ words), format comparison data in semantic <table> elements with <th> headers, and ensure all pages have inbound internal links.",
    limitations:
      "Orphan page detection is bounded by the crawl depth and sitemap inventory supplied during the audit.",
    offlineSupported: true,
    agentSkill: "skills/content-quality/SKILL.md",
    aliases: ["content-quality", "content"],
    cliCommands: ["page", "audit"],
    externalData: "None",
  },
  {
    id: "sitemap-robots",
    name: "Sitemap & Robots Discovery Policy",
    category: "technical",
    description:
      "Inspects robots.txt availability, Disallow rules, AI crawler blocks, XML sitemap presence, and sitemap URL counts.",
    purpose:
      "Prevents accidental crawl blocks and ensures search engines and AI assistants can discover canonical site URLs via XML sitemaps.",
    checks: ["T05-robots", "T05-robots-disallow", "T06-sitemap", "T07-noindex", "G02-ai-blocked"],
    severities: ["P0", "P1"],
    remediation:
      "Publish a valid /robots.txt referencing your XML sitemap, remove unintended Disallow rules, and ensure /sitemap.xml serves 200 OK with canonical URLs.",
    limitations:
      "Child sitemaps inside a <sitemapindex> are sampled up to the crawl cap; live Search Console indexation states require external GSC access.",
    offlineSupported: true,
    agentSkill: "skills/sitemap-robots/SKILL.md",
    cliCommands: ["sitemap", "audit --crawl sitemap"],
    externalData: "None",
  },
  {
    id: "internal-linking",
    name: "Internal Linking & Orphan Risk Analysis",
    category: "architecture",
    description:
      "Audits internal outlink counts, excessive link dilution, generic anchor text, broken same-host links, and sitemap-only orphan pages.",
    purpose:
      "Strengthens crawl discovery paths, distributes internal link equity, and replaces vague anchors ('click here') with topical context.",
    checks: ["O10-internal", "O10-internal-many", "O11-generic-anchors", "T16-broken-links", "T12-url"],
    severities: ["P1", "P2", "P3"],
    remediation:
      "Add 2-10 contextual internal links per page using descriptive anchor text, fix 404 internal targets, and link to orphaned sitemap pages.",
    limitations:
      "Broken link verification requires opt-in --check-links (capped at 100 requests per run); orphan detection reflects the crawled page set.",
    offlineSupported: true,
    agentSkill: "skills/internal-linking/SKILL.md",
    cliCommands: ["audit --crawl sitemap --check-links"],
    externalData: "None",
  },
  {
    id: "duplicate-content",
    name: "Duplicate Metadata & Canonical Clustering",
    category: "architecture",
    description:
      "Checks self-referencing canonicals, protocol-consistent canonicals, H1-to-title topical alignment, og:url parity, and cross-page duplicate titles/descriptions.",
    purpose:
      "Prevents keyword cannibalization, duplicate snippet collisions, and split ranking signals across parameterized or regional URLs.",
    checks: [
      "T08-canonical",
      "T17-canonical-http",
      "O01-title-missing",
      "O02-meta-missing",
      "O03-h1-multi",
      "O03-h1-drift",
      "W02-og-url",
    ],
    severities: ["P0", "P1", "P2", "P3"],
    remediation:
      "Give every indexable URL a unique <title> and meta description, align H1 with the document title, and point rel=canonical and og:url to the preferred HTTPS URL.",
    limitations:
      "Cross-page duplicate title and description clustering requires a multi-page audit (--pages 2+).",
    offlineSupported: true,
    agentSkill: "skills/duplicate-content/SKILL.md",
    cliCommands: ["audit --pages 10"],
    externalData: "None",
  },
  {
    id: "llms-txt",
    name: "llms.txt & AI Crawler Readiness",
    category: "geo",
    description:
      "Audits /llms.txt presence and Markdown structure (# heading, > summary, curated links), AI bot access in robots.txt, and snippet controls.",
    purpose:
      "Provides LLM agents and AI answer engines with a clean, curated Markdown directory of authoritative pages and permissive crawl policies.",
    checks: ["G01-llms", "G02-ai-blocked", "G05-llms-quality", "G09-snippet-controls"],
    severities: ["P1", "P2", "P3"],
    remediation:
      "Publish /llms.txt with an H1, blockquote summary, and annotated Markdown links; allow GPTBot, ClaudeBot, and PerplexityBot in robots.txt.",
    limitations:
      "/llms.txt is an emerging convention; pair it with strong on-page answer blocks and Schema.org markup.",
    offlineSupported: true,
    agentSkill: "skills/llms-txt/SKILL.md",
    cliCommands: ["llms", "ai"],
    externalData: "None",
  },
  {
    id: "seo-regression",
    name: "CI/CD SEO Regression & Release Gating",
    category: "technical",
    description:
      "Tracks critical indexation, status, canonical, title, and schema regressions between baseline and candidate builds.",
    purpose:
      "Catches accidental noindex tags, broken canonicals, missing titles, and invalid JSON-LD in pull requests before deployment.",
    checks: ["T02-status", "T07-noindex", "T08-canonical", "O01-title-missing", "S01-json-invalid"],
    severities: ["P0", "P1"],
    remediation:
      "Run `one-step-seo diff baseline.json candidate.json --fail-on P1` in CI to block regressions without failing on pre-existing debt.",
    limitations:
      "Requires a baseline report.json from the target branch or previous deployment for delta comparison.",
    offlineSupported: true,
    agentSkill: "skills/seo-regression/SKILL.md",
    cliCommands: ["diff", "audit --fail-on P1 --format sarif"],
    externalData: "Baseline report.json artifact",
  },
];

/**
 * Fast lookup map by skill ID and alias.
 * @type {Map<string, SkillDefinition>}
 */
const SKILLS_MAP = new Map();
for (const s of SKILLS) {
  SKILLS_MAP.set(s.id, s);
  for (const alias of s.aliases ?? []) {
    if (!SKILLS_MAP.has(alias)) SKILLS_MAP.set(alias, s);
  }
}

/**
 * Pass-variant finding IDs that map to the same rule family as their failure counterparts.
 * @type {Record<string, string[]>}
 */
const PASS_VARIANT_TO_RULES = {
  "O01-title": ["O01-title-missing", "O01-title-short", "O01-title-long"],
  "O02-meta": ["O02-meta-missing", "O02-meta-short", "O02-meta-long"],
  "O03-h1": ["O03-h1-missing", "O03-h1-multi", "O03-h1-drift"],
  "O08-images-none": ["O08-alt"],
  "C01-length": ["C01-thin"],
  "C01-long": ["C01-thin"],
  "S01-present": ["S01-none", "S01-json-invalid"],
};

/**
 * Check whether a concrete finding ID (`findingId`) matches a skill check rule (`ruleId`).
 * Handles exact matches, prefix rules (`S02-` matching `S02-faqpage`), and pass variants (`O01-title`).
 * @param {string} findingId
 * @param {string} ruleId
 * @returns {boolean}
 */
export function checkMatchesSkillRule(findingId, ruleId) {
  if (!findingId || !ruleId) return false;
  if (findingId === ruleId) return true;
  if (ruleId.endsWith("-") && findingId.startsWith(ruleId)) return true;
  const mapped = PASS_VARIANT_TO_RULES[findingId];
  if (mapped && mapped.includes(ruleId)) return true;
  return false;
}

/**
 * Check whether a finding ID matches any rule in a Set or Array of skill check rules.
 * @param {string} findingId
 * @param {Iterable<string>} ruleSet
 * @returns {boolean}
 */
export function matchesSkillChecks(findingId, ruleSet) {
  if (!findingId || !ruleSet) return false;
  for (const rule of ruleSet) {
    if (checkMatchesSkillRule(findingId, rule)) return true;
  }
  return false;
}

/**
 * Return all registered skills.
 * @returns {SkillDefinition[]}
 */
export function getSkills() {
  return [...SKILLS];
}

/**
 * Return all structured Agent Skill definitions.
 * @returns {AgentSkillEntry[]}
 */
export function getAgentSkills() {
  return [...AGENT_SKILLS];
}

/**
 * Retrieve a single skill by ID or alias.
 * @param {string} id
 * @returns {SkillDefinition | undefined}
 */
export function getSkill(id) {
  if (!id) return undefined;
  const normalized = String(id).toLowerCase().trim();
  return SKILLS_MAP.get(normalized);
}

/**
 * List all available categories with metadata and skill counts.
 * @returns {Array<{ category: SkillCategory, name: string, description: string, count: number }>}
 */
export function getCategories() {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const skill of SKILLS) {
    counts[skill.category] = (counts[skill.category] ?? 0) + 1;
  }
  return /** @type {SkillCategory[]} */ (Object.keys(CATEGORIES)).map((cat) => ({
    category: cat,
    name: CATEGORIES[cat].name,
    description: CATEGORIES[cat].description,
    count: counts[cat] ?? 0,
  }));
}

/**
 * Filter skills by categories, inclusions, exclusions, and offline capability.
 * Matches skill ID, category, or registered aliases.
 * @param {{
 *   categories?: string[],
 *   include?: string[],
 *   exclude?: string[],
 *   offlineOnly?: boolean
 * }} [filters]
 * @returns {SkillDefinition[]}
 */
export function filterSkills(filters = {}) {
  let list = [...SKILLS];
  if (filters.offlineOnly) {
    list = list.filter((s) => s.offlineSupported);
  }
  if (filters.categories && filters.categories.length > 0) {
    const cats = new Set(filters.categories.map((c) => c.toLowerCase().trim()));
    list = list.filter((s) => cats.has(s.category.toLowerCase()));
  }
  if (filters.include && filters.include.length > 0) {
    const inc = new Set(filters.include.map((i) => i.toLowerCase().trim()));
    list = list.filter(
      (s) =>
        inc.has(s.id.toLowerCase()) ||
        inc.has(s.category.toLowerCase()) ||
        (s.aliases ?? []).some((a) => inc.has(a.toLowerCase())),
    );
  }
  if (filters.exclude && filters.exclude.length > 0) {
    const exc = new Set(filters.exclude.map((e) => e.toLowerCase().trim()));
    list = list.filter(
      (s) =>
        !exc.has(s.id.toLowerCase()) &&
        !exc.has(s.category.toLowerCase()) &&
        !(s.aliases ?? []).some((a) => exc.has(a.toLowerCase())),
    );
  }
  return list;
}

/**
 * Find the primary skill that owns a specific finding check ID.
 * Supports exact IDs, prefix rules (`S02-*`), and pass-variant IDs (`O01-title`).
 * @param {string} checkId
 * @returns {SkillDefinition | undefined}
 */
export function getSkillForCheck(checkId) {
  if (!checkId) return undefined;
  const id = String(checkId).trim();
  for (const skill of SKILLS) {
    if (skill.checks.some((rule) => checkMatchesSkillRule(id, rule))) return skill;
  }
  return undefined;
}
