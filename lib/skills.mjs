/**
 * one-step-seo — Modular Skills Architecture & Registry.
 *
 * Provides a programmatic catalog of auditing skills, grouping specific
 * check rules into coherent capabilities: Technical SEO, On-Page SEO,
 * Structured Data, Generative Engine Optimization (GEO), Performance,
 * Security, Accessibility, Internationalization, and Site Architecture.
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
 *   offlineSupported: boolean
 * }} SkillDefinition
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
      "T16-broken-links",
      "T17-canonical-http",
    ],
    severities: ["P0", "P1", "P2"],
    remediation:
      "Set unambiguous self-referential or canonical tags, serve clean 200 responses, ensure valid XML sitemaps, and keep robots.txt permissive for public assets.",
    limitations:
      "JavaScript-only links rendered dynamically via client hydration without server-side rendering require pre-rendering.",
    offlineSupported: true,
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
      "Write concise, keyword-accurate titles (40-60 chars), descriptive meta descriptions (120-155 chars), use single H1, and populate explicit image alt text.",
    limitations:
      "Does not analyze visual rendering layout shifts directly without PageSpeed Insights or headless rendering.",
    offlineSupported: true,
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
    severities: ["P1", "P2"],
    remediation:
      "Implement valid JSON-LD schemas (@type WebSite, Organization, Article, Product, FAQPage) with all required properties matching visible body content.",
    limitations:
      "Validates syntactic correctness and essential Schema.org properties; does not verify third-party Google Search Console live merchant feed approvals.",
    offlineSupported: true,
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
    severities: ["P2", "P3"],
    remediation:
      "Compress assets, defer non-essential third-party JavaScript, set immutable cache headers, and optimize Largest Contentful Paint elements.",
    limitations:
      "Live Core Web Vitals lab and field metrics require an active network connection and a valid Google PageSpeed Insights API key.",
    offlineSupported: false,
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
    severities: ["P0", "P1", "P2"],
    remediation:
      "Upgrade all HTTP references to HTTPS, ensure Strict-Transport-Security is enabled, and replace insecure canonical tags.",
    limitations:
      "Network header checks require an active HTTP server response; mixed content checks inspect HTML source.",
    offlineSupported: true,
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
  },
  {
    id: "international-local",
    name: "Internationalization & Local SEO",
    category: "international",
    description:
      "Audits hreflang alternate language declarations, language-region consistency, and LocalBusiness schema markup.",
    purpose:
      "Ensures international visitors and local searchers are directed to the correct regional language variant and business coordinates.",
    checks: ["W03-hreflang", "T09-lang"],
    severities: ["P2", "P3"],
    remediation:
      "Add reciprocal hreflang links with valid ISO codes including x-default, and mark up LocalBusiness details (address, telephone, openingHours).",
    limitations:
      "Complete cross-domain hreflang reciprocity verification requires crawling all referenced regional domains.",
    offlineSupported: true,
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
  },
];

/**
 * Fast lookup map by skill ID.
 * @type {Map<string, SkillDefinition>}
 */
const SKILLS_MAP = new Map(SKILLS.map((s) => [s.id, s]));

/**
 * Return all registered skills.
 * @returns {SkillDefinition[]}
 */
export function getSkills() {
  return [...SKILLS];
}

/**
 * Retrieve a single skill by ID.
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
    list = list.filter((s) => inc.has(s.id.toLowerCase()) || inc.has(s.category.toLowerCase()));
  }
  if (filters.exclude && filters.exclude.length > 0) {
    const exc = new Set(filters.exclude.map((e) => e.toLowerCase().trim()));
    list = list.filter((s) => !exc.has(s.id.toLowerCase()) && !exc.has(s.category.toLowerCase()));
  }
  return list;
}

/**
 * Find the primary skill that owns a specific finding check ID.
 * @param {string} checkId
 * @returns {SkillDefinition | undefined}
 */
export function getSkillForCheck(checkId) {
  if (!checkId) return undefined;
  const id = String(checkId).trim();
  for (const skill of SKILLS) {
    if (skill.checks.includes(id)) return skill;
  }
  return undefined;
}
