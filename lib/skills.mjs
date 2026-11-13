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
  {
    id: "http-status",
    name: "HTTP Status Codes, Redirect Chains & Link Health",
    domain: "Technical SEO",
    purpose:
      "Diagnose 4xx/5xx responses, flatten multi-hop redirect chains, verify text/html MIME headers, and detect broken internal links.",
    cliSupport: "audit, page --check-links (--skills http-status)",
    externalData: "None (live HTTP required for real status codes and redirect chains)",
    path: "skills/http-status/SKILL.md",
  },
  {
    id: "javascript-seo",
    name: "JavaScript Rendering, SPA/SSR Visibility & Payload Hygiene",
    domain: "Technical SEO",
    purpose:
      "Detect client-only SPA empty shells invisible to non-JS AI crawlers, oversized hydration payloads, and third-party script bloat.",
    cliSupport: "page, audit (--skills javascript-seo)",
    externalData: "None (optional PSI_API_KEY for live --psi TBT/INP metrics)",
    path: "skills/javascript-seo/SKILL.md",
  },
  {
    id: "security-hygiene",
    name: "Transport Security & SEO Hygiene",
    domain: "Security & Hygiene",
    purpose:
      "Enforce HTTPS transport, eliminate active/passive mixed content and HTTP canonical downgrades, audit CSP/HSTS headers, and protect against SSRF.",
    cliSupport: "page, audit --block-private-ips (--skills security-hygiene)",
    externalData: "None (live HTTP required for response security headers)",
    path: "skills/security-hygiene/SKILL.md",
  },
  {
    id: "accessibility-seo",
    name: "HTML Accessibility & Search UX Alignment",
    domain: "Accessibility & UX",
    purpose:
      "Audit machine-verifiable HTML a11y signals shared with search UX: html lang, mobile viewport, image alt text, heading hierarchy, anchors, and <main>.",
    cliSupport: "page, audit, fix (--skills accessibility-seo)",
    externalData: "None",
    path: "skills/accessibility-seo/SKILL.md",
  },
  {
    id: "international-seo",
    name: "Internationalization & Multi-Regional SEO",
    domain: "International & Local",
    purpose:
      "Validate hreflang alternate clusters, x-default fallbacks, BCP-47 <html lang> tags, and self-referencing locale canonicals.",
    cliSupport: "page, audit, fix (--skills international-seo)",
    externalData: "None",
    path: "skills/international-seo/SKILL.md",
  },
  {
    id: "local-seo",
    name: "Local Business SEO & Entity Signals",
    domain: "International & Local",
    purpose:
      "Audit LocalBusiness JSON-LD subtypes, Name-Address-Phone (NAP) consistency, opening hours, geo-coordinates, and location page differentiation.",
    cliSupport: "page, schema --generate localbusiness (--skills local-seo)",
    externalData: "None (Google Business Profile verification is off-page)",
    path: "skills/local-seo/SKILL.md",
  },
  {
    id: "ecommerce-seo",
    name: "E-Commerce & Product Page SEO",
    domain: "Structured Data",
    purpose:
      "Optimize PDPs and collections using --profile product calibration, Product/Offer/Review/BreadcrumbList JSON-LD, facet canonicals, and gallery alt/CLS.",
    cliSupport: "page, audit --profile product, schema --generate product (--skills ecommerce-seo)",
    externalData: "None (Merchant Center feed status is external)",
    path: "skills/ecommerce-seo/SKILL.md",
  },
  {
    id: "answer-engine-optimization",
    name: "Answer Engine & Featured Snippet Optimization (AEO)",
    domain: "GEO / AEO / AI Search",
    purpose:
      "Win featured snippets and AI Overviews via 40-60 word answer capsules, question-shaped H2s, <th> comparison tables, quantified stats, and FAQ parity.",
    cliSupport: "page, ai, audit (--skills answer-engine-optimization)",
    externalData: "None",
    path: "skills/answer-engine-optimization/SKILL.md",
  },
  {
    id: "entity-optimization",
    name: "Entity SEO, Authorship & E-E-A-T Signals",
    domain: "GEO / AEO / AI Search",
    purpose:
      "Align Knowledge Graph entity naming across <title>, <h1>, and og:title, verify E-E-A-T authorship and freshness dates, and link JSON-LD @graph nodes.",
    cliSupport: "page, ai, schema (--skills entity-optimization)",
    externalData: "None",
    path: "skills/entity-optimization/SKILL.md",
  },
  {
    id: "social-metadata",
    name: "Open Graph, Social Cards & Brand Preview Hygiene",
    domain: "On-Page & Content",
    purpose:
      "Fix Slack, LinkedIn, Discord, and X/Twitter link previews across og:title, og:description, og:image, og:url, twitter:card, and favicons.",
    cliSupport: "page, audit, fix (--skills social-metadata)",
    externalData: "None",
    path: "skills/social-metadata/SKILL.md",
  },
  {
    id: "image-seo",
    name: "Image Optimization, Alt Text & Visual Stability",
    domain: "On-Page & Content",
    purpose:
      "Audit descriptive image alt attributes, intrinsic width/height CLS prevention, image count budgets, HTTPS media delivery, and og:image tags.",
    cliSupport: "page, audit (--skills image-seo)",
    externalData: "None (optional PSI_API_KEY for live LCP/CLS lab & field data)",
    path: "skills/image-seo/SKILL.md",
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
      "T18-js-rendered",
      "T19-head-placement",
      "T20-duplicate-tags",
      "T21-canonical-signals",
      "T22-robots-scoped",
      "T23-soft-404",
      "T24-unresolved-urls",
      "T25-malformed-hrefs",
      "T26-dev-links",
      "T27-insecure-forms",
      "T28-internal-search",
      "T29-rel-pagination",
      "T30-markup",
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
      "O12-serp-width",
      "O13-dead-anchors",
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
    aliases: ["schema-validation", "structured-data"],
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
      "P06-",
      "T14-third-party",
      "T15-security-headers",
      "P07-delivery",
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
    checks: ["T01-https", "T13-mixed", "T15-security-headers", "T17-canonical-http", "T27-insecure-forms"],
    severities: ["P0", "P1", "P2", "P3"],
    remediation:
      "Upgrade all HTTP references to HTTPS, ensure Strict-Transport-Security is enabled, and replace insecure canonical tags.",
    limitations:
      "Network header checks require an active HTTP server response; mixed content checks inspect HTML source.",
    offlineSupported: true,
    agentSkill: "skills/security-hygiene/SKILL.md",
    aliases: ["security", "https-security"],
    cliCommands: ["page", "audit"],
    externalData: "None",
  },
  {
    id: "accessibility-ux",
    name: "Accessibility & Mobile Readiness",
    category: "accessibility",
    description:
      "Validates document language (html lang), responsive viewport tags, non-empty headings, descriptive image alt attributes, semantic landmarks, and non-generic anchor text.",
    purpose:
      "Ensures that pages are readable by screen readers, accessible on mobile devices, and easily navigable by keyboard and assistive tech.",
    checks: [
      "T09-lang",
      "T11-viewport",
      "O08-alt",
      "O04-heading-empty",
      "O11-generic-anchors",
      "G11-semantic-content",
    ],
    severities: ["P1", "P2", "P3"],
    remediation:
      "Specify an ISO language on <html>, provide a responsive viewport meta tag, write descriptive image alt text, wrap copy in <main>, and replace 'click here' links with informative anchors.",
    limitations:
      "Does not replace a complete WCAG 2.2 AA audit; focuses on foundational machine-verifiable HTML a11y signals.",
    offlineSupported: true,
    agentSkill: "skills/accessibility-seo/SKILL.md",
    aliases: ["accessibility-seo", "a11y"],
    cliCommands: ["page", "audit", "fix"],
    externalData: "None",
  },
  {
    id: "international-local",
    name: "Internationalization & Regional SEO",
    category: "international",
    description:
      "Audits hreflang alternate language declarations, language-region consistency, self-referencing locale canonicals, and localized schemas.",
    purpose:
      "Ensures international visitors and multilingual crawlers are directed to the correct regional language variant without cross-locale cannibalization.",
    checks: ["W03-hreflang", "T09-lang", "T08-canonical", "S02-", "T19-head-placement"],
    severities: ["P1", "P2", "P3"],
    remediation:
      "Add reciprocal hreflang links with valid ISO codes including x-default, set <html lang>, and ensure every translated URL self-canonicalizes.",
    limitations:
      "Complete cross-domain hreflang reciprocity verification requires crawling all referenced regional domains.",
    offlineSupported: true,
    agentSkill: "skills/international-seo/SKILL.md",
    aliases: ["international-seo", "i18n", "hreflang"],
    cliCommands: ["page", "audit", "fix"],
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
      "C06-placeholder",
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
    checks: [
      "T05-robots",
      "T05-robots-disallow",
      "T06-sitemap",
      "T07-noindex",
      "G02-ai-blocked",
      "T22-robots-scoped",
    ],
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
    checks: [
      "O10-internal",
      "O10-internal-many",
      "O11-generic-anchors",
      "T16-broken-links",
      "T12-url",
      "T24-unresolved-urls",
      "T25-malformed-hrefs",
      "T26-dev-links",
      "T29-rel-pagination",
      "O13-dead-anchors",
    ],
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
      "T20-duplicate-tags",
      "T21-canonical-signals",
      "T28-internal-search",
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
    checks: [
      "T02-status",
      "T07-noindex",
      "T08-canonical",
      "O01-title-missing",
      "S01-json-invalid",
      "T22-robots-scoped",
      "T23-soft-404",
    ],
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
  {
    id: "http-status",
    name: "HTTP Status Codes, Redirect Chains & Link Health",
    category: "technical",
    description:
      "Audits HTTP 200 status responses, multi-hop redirect chains, HTML MIME content-types, HTTPS canonical schemes, and broken internal links.",
    purpose:
      "Eliminates 4xx/5xx dead ends and multi-hop redirect latency across site migrations and internal navigation.",
    checks: [
      "T01-https",
      "T02-status",
      "T03-redirects",
      "T04-content-type",
      "T16-broken-links",
      "T17-canonical-http",
      "T23-soft-404",
    ],
    severities: ["P0", "P1", "P2"],
    remediation:
      "Ensure indexable URLs return 200 OK over HTTPS, collapse redirect chains to at most 1 hop, and repair broken internal links.",
    limitations:
      "Real HTTP status chains and --check-links probes require live HTTP requests rather than offline disk files.",
    offlineSupported: false,
    agentSkill: "skills/http-status/SKILL.md",
    aliases: ["redirects", "status-codes"],
    cliCommands: ["page --check-links", "audit --check-links"],
    externalData: "None",
  },
  {
    id: "javascript-seo",
    name: "JavaScript Rendering, SPA/SSR Visibility & Payload Hygiene",
    category: "technical",
    description:
      "Audits raw server/static HTML for empty CSR shells, missing server-rendered titles/H1s/links, oversized hydration payloads, and third-party script bloat.",
    purpose:
      "Ensures non-JS AI crawlers (GPTBot, ClaudeBot, PerplexityBot) and search crawlers receive complete semantic HTML without client-hydration blindness.",
    checks: [
      "T00-truncated",
      "T14-third-party",
      "P01-html-size",
      "O01-title-missing",
      "O03-h1-missing",
      "C01-thin",
      "O10-internal",
      "G11-semantic-content",
      "T24-unresolved-urls",
    ],
    severities: ["P0", "P1", "P2", "P3"],
    remediation:
      "Pre-render indexable routes via SSR/SSG/ISR, use crawlable <a href> navigation, wrap content in <main>, and trim serialized hydration blobs under 300 KB.",
    limitations:
      "Inspects deterministic raw HTML without executing client JavaScript; pair with --psi for headless Lighthouse TBT/INP metrics.",
    offlineSupported: true,
    agentSkill: "skills/javascript-seo/SKILL.md",
    aliases: ["js-seo", "spa-seo", "ssr-seo"],
    cliCommands: ["page", "audit"],
    externalData: "None (optional PSI_API_KEY for --psi)",
  },
  {
    id: "local-seo",
    name: "Local Business SEO & Entity Signals",
    category: "international",
    description:
      "Audits LocalBusiness Schema.org JSON-LD subtypes, NAP metadata completeness, entity title consistency, and regional language tags.",
    purpose:
      "Helps physical storefronts and service-area businesses surface accurate addresses, hours, and phone numbers in local search and AI map answers.",
    checks: [
      "S01-none",
      "S01-json-invalid",
      "S02-",
      "G04-entity",
      "T09-lang",
      "O01-title-missing",
      "O02-meta-missing",
    ],
    severities: ["P0", "P1", "P2", "P3"],
    remediation:
      "Publish valid LocalBusiness JSON-LD matching visible Name, Address, Phone, and openingHours on each location page.",
    limitations:
      "Off-page Google Business Profile verification and directory citations require external GBP tools.",
    offlineSupported: true,
    agentSkill: "skills/local-seo/SKILL.md",
    aliases: ["local", "localbusiness"],
    cliCommands: ["page", "schema --generate localbusiness"],
    externalData: "None",
  },
  {
    id: "ecommerce-seo",
    name: "E-Commerce & Product Page SEO",
    category: "schema",
    description:
      "Audits Product, Offer, Review, and BreadcrumbList JSON-LD, product image alt/dimensions, Open Graph commerce tags, and parameterized filter canonicals.",
    purpose:
      "Drives rich product snippets, prevents faceted-navigation duplicate content, and eliminates mobile CLS on product detail pages.",
    checks: [
      "S01-none",
      "S01-json-invalid",
      "S02-",
      "O08-alt",
      "O09-img-dims",
      "O06-og",
      "T08-canonical",
      "T12-url",
    ],
    severities: ["P1", "P2"],
    remediation:
      "Pair --profile product with complete Product + Offer + BreadcrumbList JSON-LD, descriptive gallery alt/width/height attributes, and clean canonical URLs.",
    limitations: "Does not query external Google Merchant Center feed status or live inventory databases.",
    offlineSupported: true,
    agentSkill: "skills/ecommerce-seo/SKILL.md",
    aliases: ["ecommerce", "product-seo"],
    cliCommands: ["page --profile product", "schema --generate product"],
    externalData: "None",
  },
  {
    id: "answer-engine-optimization",
    name: "Answer Engine & Featured Snippet Optimization (AEO)",
    category: "geo",
    description:
      "Audits 40-60 word direct answer capsules, question-shaped H2s, labeled <th> comparison tables, quantified metrics, snippet eligibility, and FAQ parity.",
    purpose:
      "Structures informational pages for direct passage lifting in featured snippets, Google AI Overviews, Perplexity, and ChatGPT Search.",
    checks: [
      "C02-answer",
      "C03-extractable",
      "C04-faq",
      "C05-table-headers",
      "G03-facts",
      "G07-question-headings",
      "G08-stat-density",
      "G09-snippet-controls",
      "S03-faq-parity",
    ],
    severities: ["P1", "P2", "P3"],
    remediation:
      "Open with a 40-60 word direct answer, phrase H2s as natural questions, add <th> headers to comparison tables, and keep FAQPage JSON-LD synced with visible copy.",
    limitations:
      "Measures structural passage extractability and snippet eligibility, not live SERP placement.",
    offlineSupported: true,
    agentSkill: "skills/answer-engine-optimization/SKILL.md",
    aliases: ["aeo", "featured-snippets"],
    cliCommands: ["page", "ai", "audit"],
    externalData: "None",
  },
  {
    id: "entity-optimization",
    name: "Entity SEO, Authorship & E-E-A-T Signals",
    category: "geo",
    description:
      "Audits entity naming alignment across <title>, <h1>, and og:title, explicit author attribution, freshness dates, and Organization/Person/Article JSON-LD.",
    purpose:
      "Strengthens Knowledge Graph entity disambiguation and E-E-A-T source credibility for search engines and AI citation systems.",
    checks: [
      "G04-entity",
      "G06-freshness",
      "G10-author",
      "O03-h1-drift",
      "S01-none",
      "S01-json-invalid",
      "S02-",
    ],
    severities: ["P1", "P2", "P3"],
    remediation:
      "Align <title>, <h1>, and og:title on one unambiguous entity, declare author and dateModified metadata, and connect Organization/Person/Article in a JSON-LD @graph.",
    limitations:
      "Verifies on-page HTML and JSON-LD entity signals; off-page backlink and Wikidata authority are external.",
    offlineSupported: true,
    agentSkill: "skills/entity-optimization/SKILL.md",
    aliases: ["eeat", "entity-seo"],
    cliCommands: ["page", "ai", "schema"],
    externalData: "None",
  },
  {
    id: "social-metadata",
    name: "Open Graph, Social Cards & Brand Preview Hygiene",
    category: "architecture",
    description:
      "Audits Open Graph tags (og:title, og:description, og:image, og:url), Twitter/X card tags, share-title entity parity, and brand favicons.",
    purpose:
      "Ensures rich, accurate social link previews in Slack, Discord, LinkedIn, X/Twitter, messaging apps, and SERP brand icons.",
    checks: ["O06-og", "O07-favicon", "W01-social", "W02-og-url", "G04-entity"],
    severities: ["P2", "P3"],
    remediation:
      "Populate og:title, og:description, absolute HTTPS og:image, canonical og:url, twitter:card, and SVG/ICO favicons.",
    limitations:
      "Validates HTML tag presence and canonical URL parity without downloading remote og:image binaries.",
    offlineSupported: true,
    agentSkill: "skills/social-metadata/SKILL.md",
    aliases: ["open-graph", "social-cards", "og-tags"],
    cliCommands: ["page", "audit", "fix"],
    externalData: "None",
  },
  {
    id: "image-seo",
    name: "Image Optimization, Alt Text & Visual Stability",
    category: "performance",
    description:
      "Audits descriptive image alt attributes, explicit width/height CLS dimensions, image count budgets (>20 images), og:image presence, and HTTPS media URLs.",
    purpose:
      "Improves Google Images discoverability, screen-reader accessibility, and Cumulative Layout Shift (CLS) stability.",
    checks: ["O08-alt", "O09-img-dims", "P02-img-count", "O06-og", "T13-mixed"],
    severities: ["P1", "P2"],
    remediation:
      "Add accurate alt descriptions, declare intrinsic width and height on every <img>, lazy-load below-the-fold galleries, and serve media over HTTPS.",
    limitations:
      "Inspects HTML <img> markup attributes offline; pass --psi (PSI_API_KEY) for live binary compression and LCP/CLS timings.",
    offlineSupported: true,
    agentSkill: "skills/image-seo/SKILL.md",
    aliases: ["images", "media-seo"],
    cliCommands: ["page", "audit"],
    externalData: "None (optional PSI_API_KEY for --psi)",
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
