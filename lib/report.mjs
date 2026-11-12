/**
 * one-step-seo — report builders (JSON / Markdown / single-file HTML / Site Dashboard / SARIF / CSV).
 * HTML is 100% dependency-free with inline CSS, zero external network requests,
 * dark/light/system themes, executive mode, and client-side filtering/sorting.
 */
import { pathToFileURL } from "node:url";
import { getFindingMeta } from "./finding-meta.mjs";
import { scoreBand, RULES_VERSION } from "./score.mjs";
import { VERSION as PKG_VERSION } from "./version.mjs";

/** Stable link target for per-check background reading. */
export const CHECKS_DOC_URL = "https://github.com/6t9xstar/one-step-seo/blob/main/docs/CHECKS.md";

/** Category ids in display order with beginner-friendly labels. @type {Record<string, string>} */
export const CATEGORY_LABELS = {
  technical: "Technical SEO",
  onpage: "On-page",
  content: "Content",
  schema: "Schema",
  geo: "AI visibility",
  performance: "Performance",
};
/** @type {string[]} */
const CATEGORY_ORDER = ["technical", "onpage", "content", "schema", "geo", "performance"];

const SEARCH_EXPLAINER = "Technical foundation, crawlability, indexability, metadata, and link architecture.";
const AI_EXPLAINER = "Direct answers, structured facts, and bot accessibility for AI search engines.";

/**
 * Escape a value for HTML text/attribute context. All report fields
 * pass through here, so hostile page content can never break out.
 * @param {unknown} s
 * @returns {string}
 */
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escape then safely truncate to `max` visible chars without cutting
 * mid-entity (e.g. "&am|p;"). Escaping first, then cutting on the escaped
 * string while rewinding to the last ";" boundary is not enough — instead
 * slice the raw string first, then escape.
 * @param {unknown} s
 * @param {number} [max]
 * @returns {string}
 */
export function escTruncate(s, max = 300) {
  const raw = String(s ?? "");
  const sliced = [...raw].slice(0, max).join("");
  return esc(sliced);
}

/**
 * Escape a markdown field so hostile page titles cannot inject headings,
 * lists, links, or tables into report.md.
 * @param {unknown} s
 * @returns {string}
 */
export function escMd(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/([#*_|`[\]<>])/g, "\\$1")
    .replace(/\r?\n+/g, " ")
    .slice(0, 500);
}

/**
 * @param {any} a
 * @param {any} b
 * @returns {number}
 */
function priorityOrder(a, b) {
  /** @type {Record<string, number>} */
  const rank = { P0: 0, P1: 1, P2: 2, P3: 3, pass: 4 };
  return (rank[a.severity] ?? 5) - (rank[b.severity] ?? 5);
}

/**
 * @typedef {{ id: string, category: string, severity: string, title: string, evidence: string, fix: string, seoImpact?: string, geoImpact?: string }} Finding
 * @typedef {{ score: number, band: string }} Score
 * @typedef {object} Report
 * @property {string} tool
 * @property {string} version
 * @property {string} rulesVersion scoring/check ruleset version (see RULES_VERSION)
 * @property {string} url
 * @property {string} finalUrl
 * @property {string} checkedAt
 * @property {{ search: Score, ai: Score }} scores
 * @property {Record<string, number>} counts
 * @property {Finding[]} findings
 * @property {boolean} [truncated]
 * @property {Record<string, any>} page
 * @property {Record<string, any>} site
 */

/**
 * @param {{ url: string, finalUrl?: string, scores?: Report["scores"], findings?: Finding[], parsed?: any, pageData?: any, siteFiles?: any, meta?: { version?: string }, truncated?: boolean, checkedAt?: string, psi?: any }} input
 * @returns {Report}
 */
export function buildReport({
  url,
  finalUrl = url,
  scores,
  findings = [],
  parsed,
  pageData,
  siteFiles,
  meta,
  truncated = false,
  checkedAt,
  psi = null,
}) {
  const sorted = [...(findings || [])].sort(priorityOrder);
  /** @type {Record<string, number>} */
  const counts = { P0: 0, P1: 0, P2: 0, P3: 0, pass: 0 };
  for (const f of sorted) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  // Defensive normalization: buildReport is exported and called with partial
  // objects (tests, future commands). A missing `h1s` used to throw a TypeError
  // *after* a successful fetch, discarding the whole report.
  /** @type {any} */
  const p = (parsed || pageData) && typeof (parsed || pageData) === "object" ? parsed || pageData : {};
  const h1s = Array.isArray(p.h1s) ? p.h1s : [];
  const images = Array.isArray(p.images) ? p.images : [];
  /** @type {any} */
  const site = siteFiles && typeof siteFiles === "object" ? siteFiles : {};
  const robots = site.robots && typeof site.robots === "object" ? site.robots : {};
  const sitemap = site.sitemap && typeof site.sitemap === "object" ? site.sitemap : {};
  const llms = site.llms && typeof site.llms === "object" ? site.llms : {};
  let stampedAt = checkedAt;
  if (!stampedAt && process.env.SOURCE_DATE_EPOCH) {
    const epoch = Number(process.env.SOURCE_DATE_EPOCH);
    if (Number.isFinite(epoch)) stampedAt = new Date(epoch * 1000).toISOString();
  }
  if (!stampedAt) stampedAt = new Date().toISOString();
  return {
    tool: "one-step-seo",
    version: meta?.version || PKG_VERSION,
    rulesVersion: RULES_VERSION,
    url: url || "",
    finalUrl: finalUrl || url || "",
    checkedAt: stampedAt,
    truncated: !!truncated,
    scores: scores ?? { search: { score: 100, band: "A" }, ai: { score: 100, band: "A" } },
    counts,
    findings: sorted,
    page: {
      title: p.title ?? "",
      metaDescription: p.metaDescription ?? "",
      canonical: p.canonical ?? "",
      wordCount: Number(p.wordCount ?? 0),
      h1: h1s.map(/** @param {{ text?: string }} h @returns {string} */ (h) => h.text ?? ""),
      images: images.length,
      internalLinks: Number(p.internalLinkCount ?? 0),
      externalLinks: Number(p.externalLinkCount ?? 0),
      ...(psi || p.psi ? { psi: psi || p.psi } : {}),
    },
    site: {
      origin: site.origin ?? "",
      robots: !!robots.found,
      sitemap: !!sitemap.found,
      sitemapUrls: Number(sitemap.urlCount ?? 0),
      llms: !!llms.found,
    },
  };
}

/**
 * One-sentence overall verdict, deterministic from counts + scores.
 * @param {Report} report
 * @returns {string}
 */
export function verdictFor(report) {
  const c = report.counts ?? { P0: 0, P1: 0, P2: 0, P3: 0, pass: 0 };
  const p0 = Number(c.P0 ?? 0);
  const p1 = Number(c.P1 ?? 0);
  const p2 = Number(c.P2 ?? 0);
  const rawS = report.scores?.search?.score;
  const rawA = report.scores?.ai?.score;
  const searchLow = isValidScore(rawS) && rawS < 60;
  const aiLow = isValidScore(rawA) && rawA < 60;
  const actionable = (report.findings ?? []).filter((f) => f && f.severity !== "pass");
  if (actionable.length > 0 && actionable.every((f) => f.id === "T05-robots-disallow")) {
    return "Crawl skipped: robots.txt disallows this page, so nothing was audited. If the block is intentional, nothing to do — otherwise allow the path (or re-run with --force) and re-audit.";
  }
  if (p0 > 0) {
    return `Needs urgent attention: ${p0} critical (P0) issue${p0 === 1 ? "" : "s"} block${p0 === 1 ? "s" : ""} this page from search indexing or crawl access. Fix P0 first, today.`;
  }
  if (searchLow || aiLow) {
    const weak =
      searchLow && aiLow
        ? "Search SEO and AI Visibility are both"
        : searchLow
          ? "Search SEO is"
          : "AI Visibility is";
    return `Below par: ${weak} under 60. Work through the P1 fixes first, this week.`;
  }
  if (p1 > 0) {
    return `Solid foundation with ${p1} high-priority fix${p1 === 1 ? "" : "es"} to work through this week.`;
  }
  if (p2 > 0) {
    return `In good shape — ${p2} medium-priority improvement${p2 === 1 ? "" : "s"} left for this month.`;
  }
  const hasSearch = isValidScore(rawS);
  const hasAi = isValidScore(rawA);
  if (!hasSearch && !hasAi) {
    return "Scores unavailable (N/A) — no actionable issues recorded. Re-audit to compute scores.";
  }
  if (!hasSearch || !hasAi) {
    return `Partial scores available (${!hasSearch ? "Search SEO" : "AI Visibility"} is N/A) — no actionable issues found.`;
  }
  return "Excellent — no actionable issues found. Re-audit after site changes.";
}

/**
 * The top N actionable findings (already priority-sorted by buildReport).
 * @param {Report} report
 * @param {number} [n]
 * @returns {Finding[]}
 */
export function topFixes(report, n = 3) {
  return (report.findings ?? []).filter((f) => f && f.severity !== "pass").slice(0, n);
}

/**
 * "Make this page more citable" checklist, derived from finding outcomes.
 * Items whose check did not run (id absent) are skipped so hand-built
 * reports never show a misleading state.
 * @param {Report} report
 * @returns {{ label: string, checked: boolean }[]}
 */
export function citableChecklist(report) {
  /** @type {{ match: (id: string) => boolean, label: string }[]} */
  const items = [
    {
      match: (id) => id === "C02-answer",
      label: "Answer-first opening (direct answer in the first ~150 words)",
    },
    {
      match: (id) => id === "C03-extractable",
      label: "Extractable structures (tables or lists for key facts)",
    },
    { match: (id) => id === "C04-faq", label: "FAQ coverage (real questions with concise answers)" },
    {
      match: (id) => id === "G03-facts",
      label: "Facts surfaced for extraction (prices, specs, steps, dates)",
    },
    { match: (id) => id.startsWith("S01-"), label: "Structured data present and valid" },
    { match: (id) => id === "G01-llms", label: "llms.txt present" },
    { match: (id) => id === "G02-ai-blocked", label: "AI crawlers allowed" },
    { match: (id) => id === "G04-entity", label: "Consistent titles (share title matches page title)" },
  ];
  /** @type {{ label: string, checked: boolean }[]} */
  const out = [];
  for (const item of items) {
    const found = (report.findings ?? []).filter((f) => f && item.match(String(f.id ?? "")));
    if (found.length === 0) continue;
    out.push({ label: item.label, checked: found.every((f) => f.severity === "pass") });
  }
  return out;
}

/**
 * Group actionable findings by category in display order; unknown
 * categories trail in encounter order.
 * @param {Report} report
 * @returns {{ key: string, label: string, items: Finding[] }[]}
 */
export function groupByCategory(report) {
  /** @type {Map<string, Finding[]>} */
  const groups = new Map();
  for (const f of report.findings ?? []) {
    if (!f || f.severity === "pass") continue;
    const key = String(f.category ?? "other");
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }
  /** @type {{ key: string, label: string, items: Finding[] }[]} */
  const ordered = [];
  for (const key of CATEGORY_ORDER) {
    const items = groups.get(key);
    if (items) {
      ordered.push({ key, label: CATEGORY_LABELS[key] ?? key, items });
      groups.delete(key);
    }
  }
  for (const [key, items] of groups) ordered.push({ key, label: CATEGORY_LABELS[key] ?? key, items });
  return ordered;
}

/**
 * Findings worth watching rather than fixing now: P3 polish plus
 * performance hints at any severity.
 * @param {Report} report
 * @returns {Finding[]}
 */
export function monitorItems(report) {
  return (report.findings ?? []).filter(
    (f) => f && f.severity !== "pass" && (f.severity === "P3" || f.category === "performance"),
  );
}

/**
 * @param {Report} report
 * @returns {string}
 */
export function renderMarkdown(report) {
  const rulesVer = String(report.rulesVersion || RULES_VERSION);
  /** @type {Record<string, any>} */
  const pg = report.page && typeof report.page === "object" ? report.page : {};
  /** @type {Record<string, any>} */
  const st = report.site && typeof report.site === "object" ? report.site : {};
  const titleText = String(pg.title ?? "");
  const metaText = String(pg.metaDescription ?? "");
  const h1List = Array.isArray(pg.h1) ? pg.h1 : [];
  const sValid = isValidScore(report.scores?.search?.score);
  const aValid = isValidScore(report.scores?.ai?.score);
  const sMd = sValid
    ? `${report.scores.search.score}/100 (${escMd(report.scores.search.band || scoreBand(report.scores.search.score))})`
    : "N/A";
  const aMd = aValid
    ? `${report.scores.ai.score}/100 (${escMd(report.scores.ai.band || scoreBand(report.scores.ai.score))})`
    : "N/A";
  const countsObj = report.counts ?? { P0: 0, P1: 0, P2: 0, P3: 0, pass: 0 };
  const L = [];
  L.push(`# one-step-seo report`);
  L.push(``);
  L.push(`- URL: ${escMd(report.url)}`);
  L.push(`- Final URL: ${escMd(report.finalUrl)}`);
  L.push(`- Checked: ${escMd(report.checkedAt)}`);
  L.push(`- Tool version: v${escMd(report.version)} (rules ${escMd(rulesVer)})`);
  L.push(`- Search SEO: **${sMd}**`);
  L.push(`- AI Visibility: **${aMd}**`);
  L.push(
    `- Counts: P0=${Number(countsObj.P0 ?? 0)} P1=${Number(countsObj.P1 ?? 0)} P2=${Number(countsObj.P2 ?? 0)} P3=${Number(countsObj.P3 ?? 0)} pass=${Number(countsObj.pass ?? 0)}`,
  );
  if (report.truncated) {
    L.push(`- Note: HTML truncated at the 5MB audit cap; checks ran on the head portion only.`);
  }
  L.push(``);
  L.push(`## Executive summary`);
  L.push(``);
  L.push(verdictFor(report));
  L.push(``);
  L.push(`- Search SEO **${sMd}** — ${SEARCH_EXPLAINER}`);
  L.push(`- AI Visibility **${aMd}** — ${AI_EXPLAINER}`);
  L.push(``);
  L.push(`## Page SEO & AI signal snapshot`);
  L.push(``);
  L.push(`- Title (${titleText.length} chars): ${titleText ? escMd(titleText) : "(missing)"}`);
  L.push(`- Meta description (${metaText.length} chars): ${metaText ? escMd(metaText) : "(missing)"}`);
  L.push(`- Canonical URL: ${pg.canonical ? escMd(pg.canonical) : "(not set)"}`);
  L.push(
    `- H1 headings (${h1List.length}): ${h1List.length > 0 ? h1List.map((h) => escMd(h)).join(" | ") : "(none)"}`,
  );
  L.push(
    `- Content & links: ${Number(pg.wordCount ?? 0)} words · ${Number(pg.images ?? 0)} images · ${Number(pg.internalLinks ?? 0)} internal links · ${Number(pg.externalLinks ?? 0)} external links`,
  );
  L.push(
    `- Site discovery: robots.txt=${st.robots ? "found" : "missing"} · sitemap.xml=${st.sitemap ? `found (~${Number(st.sitemapUrls ?? 0)} URLs)` : "missing"} · llms.txt=${st.llms ? "found" : "missing"}`,
  );
  L.push(``);
  L.push(`## Fix this first`);
  const first = topFixes(report, 3);
  if (first.length === 0) {
    L.push(`No issues found. Nice.`);
  } else {
    first.forEach((f, i) => {
      const meta = getFindingMeta(f.id);
      L.push(
        `${i + 1}. **[${f.severity}] ${escMd(f.title)}** (${escMd(f.id)}) — ${escMd(meta.plain)} (Impact: ${meta.impact} · Effort: ${meta.effort} · Owner: ${meta.owner})`,
      );
    });
  }
  L.push(``);
  L.push(`## Priority actions`);
  const groups = groupByCategory(report);
  if (groups.length === 0) L.push(`No issues found. Nice.`);
  for (const g of groups) {
    L.push(`### ${escMd(g.label)}`);
    L.push(`Check reference: ${CHECKS_DOC_URL}`);
    for (const f of g.items) {
      const meta = getFindingMeta(f.id);
      L.push(`#### [${f.severity}] ${escMd(f.title)} (${escMd(f.id)})`);
      L.push(`- What this means: ${escMd(meta.plain)}`);
      L.push(`- Evidence: ${escMd(f.evidence)}`);
      if (f.fix) L.push(`- Fix: ${escMd(f.fix)}`);
      L.push(`- Impact: ${meta.impact} · Effort: ${meta.effort} · Owner: ${meta.owner}`);
      if (meta.snippet) {
        L.push(`- Copy-paste starting point:`);
        L.push("```html");
        L.push(meta.snippet);
        L.push("```");
      }
    }
  }
  L.push(``);
  L.push(`## Make this page more citable`);
  const checklist = citableChecklist(report);
  if (checklist.length === 0) {
    L.push(`No citability signals were evaluated for this report.`);
  } else {
    for (const item of checklist) L.push(`- [${item.checked ? "x" : " "}] ${escMd(item.label)}`);
  }
  L.push(``);
  L.push(`## What passed`);
  const passed = (report.findings ?? []).filter((f) => f && f.severity === "pass");
  if (passed.length === 0) L.push(`Nothing passed yet — start with “Fix this first”.`);
  for (const f of passed) {
    L.push(`- ${escMd(f.title)} (${escMd(f.id)})`);
  }
  L.push(``);
  L.push(`## What to monitor`);
  const monitor = monitorItems(report);
  if (monitor.length === 0) {
    L.push(`Nothing specific — re-audit after site changes.`);
  } else {
    for (const f of monitor)
      L.push(`- [${f.severity}] ${escMd(f.title)} (${escMd(f.id)}): ${escMd(f.fix || f.evidence)}`);
  }
  if (report.page && report.page.psi) {
    const psi = report.page.psi;
    L.push(``);
    L.push(`## Core Web Vitals (PageSpeed Insights)`);
    L.push(``);
    L.push(`- Strategy: **${escMd(psi.strategy || "mobile")}**`);
    if (psi.lab) {
      L.push(`- Lab Performance Score: **${psi.lab.score != null ? psi.lab.score + "/100" : "N/A"}**`);
      L.push(
        `- Largest Contentful Paint (LCP): **${psi.lab.lcpMs != null ? (psi.lab.lcpMs / 1000).toFixed(2) + "s" : "N/A"}** (lab)`,
      );
      L.push(
        `- Cumulative Layout Shift (CLS): **${psi.lab.cls != null ? psi.lab.cls.toFixed(3) : "N/A"}** (lab)`,
      );
      L.push(
        `- Total Blocking Time (TBT): **${psi.lab.tbtMs != null ? Math.round(psi.lab.tbtMs) + "ms" : "N/A"}** (lab)`,
      );
      L.push(
        `- First Contentful Paint (FCP): **${psi.lab.fcpMs != null ? (psi.lab.fcpMs / 1000).toFixed(2) + "s" : "N/A"}** (lab)`,
      );
    }
    if (psi.field && (psi.field.lcpMs != null || psi.field.cls != null || psi.field.inpMs != null)) {
      L.push(`- CrUX Field Rating: **${escMd(psi.field.overallCategory)}**`);
      L.push(
        `- Real-user LCP (p75): **${psi.field.lcpMs != null ? (psi.field.lcpMs / 1000).toFixed(2) + "s" : "N/A"}**`,
      );
      L.push(`- Real-user CLS (p75): **${psi.field.cls != null ? psi.field.cls.toFixed(3) : "N/A"}**`);
      L.push(
        `- Real-user INP (p75): **${psi.field.inpMs != null ? Math.round(psi.field.inpMs) + "ms" : "N/A"}**`,
      );
    } else {
      L.push(`- CrUX Field Rating: *No real-user field data available for this URL.*`);
    }
    const lhCats = Object.entries(psi.categories ?? {}).filter(([, v]) => v && v.score != null);
    if (lhCats.length > 0) {
      L.push(
        `- Lighthouse categories (lab): ${lhCats.map(([, v]) => `${escMd(v.title)} **${v.score}**`).join(" · ")}`,
      );
    }
  }
  L.push(``);
  L.push(`## Verification & next steps`);
  L.push(``);
  L.push(`- Re-run audit after changes: \`npx one-step-seo page ${escMd(report.url)}\``);
  L.push(
    `- Preview safe local HTML fixes: \`npx one-step-seo fix ./index.html --url ${escMd(report.finalUrl || report.url)}\``,
  );
  L.push(
    `- Compare before/after reports: \`npx one-step-seo diff old-report.json new-report.json --fail-on P1\``,
  );
  L.push(``);
  L.push(`---`);
  L.push(
    `Generated by one-step-seo v${escMd(report.version)} (rules ${escMd(rulesVer)}). Two scores, never blended.`,
  );
  return L.join("\n") + "\n";
}

/** Severity -> hue for theming (CSS custom property --hue). @type {Record<string, number>} */
const SEV_HUE = { P0: 0, P1: 25, P2: 45, P3: 215, pass: 152 };

/** Band -> hue for the score gauges. @type {Record<string, number>} */
const BAND_HUE = { A: 150, B: 100, C: 42, D: 24, E: 14, F: 0, "N/A": 215 };

/**
 * Crisp inline vector icon system (24x24 Feather/Lucide geometry, 100% offline, zero network requests).
 * Paired with text labels so color is never the sole indicator of meaning or severity.
 */
const ICONS = {
  brand: `<svg class="brand-logo" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><defs><linearGradient id="oss-brand-g" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="var(--accent)"/><stop offset="100%" stop-color="var(--accent-alt)"/></linearGradient></defs><rect x="2.5" y="2.5" width="19" height="19" rx="5.5" stroke="url(#oss-brand-g)" opacity=".38"/><path d="M7.5 15.5 10.8 11l2.7 2.6L16.8 8" stroke="url(#oss-brand-g)"/><circle cx="16.8" cy="8" r="1.7" fill="var(--accent-alt)" stroke="none"/></svg>`,
  search: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>`,
  compass: `<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polygon points="15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5 15.5 8.5"/></svg>`,
  sparkles: `<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z"/></svg>`,
  layers: `<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
  shieldOk: `<svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`,
  alertCrit: `<svg class="ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  alertWarn: `<svg class="ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  info: `<svg class="ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  check: `<svg class="ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8.5 12.5 2.3 2.3 4.7-4.8"/></svg>`,
  pending: `<svg class="ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke-dasharray="3.5 3.5"/></svg>`,
  zap: `<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  sliders: `<svg class="ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="2" y1="14" x2="6" y2="14"/><line x1="10" y1="8" x2="14" y2="8"/><line x1="18" y1="16" x2="22" y2="16"/></svg>`,
  printer: `<svg class="ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
  copy: `<svg class="ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  terminal: `<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  globe: `<svg class="ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  fileText: `<svg class="ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  braces: `<svg class="ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/></svg>`,
  gauge: `<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>`,
  trendDown: `<svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>`,
  trendUp: `<svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`,
  link: `<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  arrowLeft: `<svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
  ext: `<svg class="ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
};

/**
 * Category key -> inline SVG icon.
 * @param {string} cat
 * @returns {string}
 */
function categoryIcon(cat) {
  switch (cat) {
    case "technical":
      return ICONS.globe;
    case "onpage":
    case "content":
      return ICONS.fileText;
    case "schema":
      return ICONS.braces;
    case "geo":
      return ICONS.sparkles;
    case "performance":
      return ICONS.gauge;
    default:
      return ICONS.layers;
  }
}

/**
 * Severity key -> inline SVG icon so badges never communicate urgency via color alone.
 * @param {string} sev
 * @returns {string}
 */
function severityIcon(sev) {
  if (sev === "P0") return ICONS.alertCrit;
  if (sev === "P1") return ICONS.alertWarn;
  if (sev === "pass") return ICONS.check;
  return ICONS.info;
}

/**
 * Synchronous head initializer that restores a saved theme override before first paint
 * to prevent light/dark flash of unstyled content (FOUC).
 * @returns {string}
 */
function themeInitScript() {
  return `<script data-theme-init>(function(){try{var s=localStorage.getItem('oss-theme');if(s==='dark'||s==='light'){document.documentElement.setAttribute('data-theme',s);var m=document.querySelector('meta[name="color-scheme"]');if(m)m.setAttribute('content',s);}}catch(e){}})();</script>`;
}

/**
 * Check whether a raw score value is a finite 0-100 number.
 * @param {unknown} v
 * @returns {v is number}
 */
export function isValidScore(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
}

/**
 * SVG ring gauge for one score axis. Inline SVG so the report stays a single
 * offline file with no image requests. When `score` is `null` (no valid pages),
 * renders an N/A gauge with a zero-length arc and neutral band badge.
 * @param {number | null} score
 * @param {string} band
 * @param {string} label
 * @returns {string}
 */
function gauge(score, band, label) {
  const isAi = /ai/i.test(label);
  const valid = isValidScore(score);
  const safeBand = valid ? band : "N/A";
  const hue = BAND_HUE[safeBand] ?? 215;
  const gradId = isAi ? "oss-g-ai" : "oss-g-search";
  const stopA = isAi ? "var(--accent-alt)" : "var(--accent)";
  const stopB = isAi ? "#ec4899" : "#06b6d4";
  const circumference = 2 * Math.PI * 32;
  const pct = valid ? Math.max(0, Math.min(100, score)) : 0;
  const dash = (pct / 100) * circumference;
  const scoreDisplay = valid ? String(score) : "N/A";
  const srText = valid
    ? `${label}: ${scoreDisplay} out of 100, band ${safeBand}.`
    : `${label}: Not available (N/A).`;
  return `<div class="gauge ${isAi ? "gauge-ai" : "gauge-search"}"><svg viewBox="0 0 80 80" width="84" height="84" aria-hidden="true" focusable="false">
<defs><linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${stopA}"/><stop offset="100%" stop-color="${stopB}"/></linearGradient></defs>
<circle cx="40" cy="40" r="32" fill="none" stroke="currentColor" stroke-width="6.5" opacity=".11"/>
<circle class="gauge-fill" cx="40" cy="40" r="32" fill="none" stroke="url(#${gradId})" stroke-width="6.5"
  stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${circumference.toFixed(1)}"
  transform="rotate(-90 40 40)"/></svg>
<div class="gauge-text"><span class="gauge-score">${esc(scoreDisplay)}</span><span class="gauge-band" style="--hue:${hue}">${esc(safeBand)}</span></div></div>
<p class="sr-only">${esc(srText)}</p>`;
}

/**
 * Severity distribution bars.
 * @param {Record<string, number>} counts
 * @returns {string}
 */
function severityBars(counts) {
  const keys = ["P0", "P1", "P2", "P3", "pass"];
  const total = keys.reduce((sum, k) => sum + Number(counts?.[k] ?? 0), 0) || 1;
  const max = Math.max(1, ...keys.map((k) => Number(counts?.[k] ?? 0)));
  const stack = keys
    .map((k) => {
      const n = Number(counts?.[k] ?? 0);
      if (n === 0) return "";
      const hue = SEV_HUE[k] ?? 0;
      const pct = ((n / total) * 100).toFixed(1);
      return `<span class="dist-seg" style="--hue:${hue};width:${pct}%" title="${esc(k)}: ${n} (${pct}%)"></span>`;
    })
    .join("");
  const stackBar = stack
    ? `<div class="dist-stacked" role="img" aria-label="Severity distribution bar">${stack}</div>`
    : "";
  const rows = keys
    .map((k) => {
      const n = Number(counts?.[k] ?? 0);
      const hue = SEV_HUE[k] ?? 0;
      return `<div class="dist-row"><span class="dist-label">${esc(k)}</span>
<span class="dist-track"><span class="dist-fill" style="--hue:${hue};width:${((n / max) * 100).toFixed(1)}%"></span></span>
<span class="dist-count">${esc(String(n))}</span></div>`;
    })
    .join("");
  return stackBar + rows;
}

/**
 * One finding as a filterable card. `data-search` holds the lowercase haystack
 * used by the client-side filter so the search input needs no fetch.
 * @param {Finding} f
 * @returns {string}
 */
function findingCard(f) {
  const id = String(f.id ?? "");
  const meta = getFindingMeta(id);
  const sev = String(f.severity ?? "P2");
  const cat = String(f.category || "check");
  const hue = SEV_HUE[sev] ?? 45;
  const hay = [f.title, id, f.evidence, f.fix, meta.plain, cat].join(" ").toLowerCase();
  return `<article class="finding" style="--sev-hue:${hue}" data-sev="${esc(sev)}" data-cat="${esc(cat)}" data-search="${esc(hay)}">
<header class="finding-head"><span class="badge" style="--hue:${hue}">${severityIcon(sev)}${esc(sev)}</span>
<span class="finding-cat">${categoryIcon(cat)}${esc(cat)}</span>
<h4>${esc(f.title)}</h4></header>
<p class="finding-plain">${esc(meta.plain)}</p>
<dl class="finding-meta">
<div><dt>Check</dt><dd><code>${esc(id)}</code></dd></div>
<div><dt>Impact</dt><dd>${esc(meta.impact)}</dd></div>
<div><dt>Effort</dt><dd>${esc(meta.effort)}</dd></div>
<div><dt>Owner</dt><dd>${esc(meta.owner)}</dd></div></dl>
<p class="finding-row tech-detail"><strong>Evidence</strong><span>${escTruncate(f.evidence, 300)}</span></p>
<p class="finding-row"><strong>Fix</strong><span>${f.fix ? escTruncate(f.fix, 300) : "—"}</span></p>
${
  meta.snippet
    ? `<details class="snippet tech-detail"><summary>Copy-paste starting point</summary><pre><code>${esc(meta.snippet)}</code></pre></details>`
    : ""
}
<footer class="finding-foot"><button type="button" class="copy-fix no-print" data-copy="${esc(String(f.fix ?? ""))}">${ICONS.copy}Copy fix</button><span class="copied" role="status" aria-live="polite"></span></footer>
</article>`;
}

/** Severity rank for ordering (lower is more urgent). @type {Record<string, number>} */
export const SEV_RANK = { P0: 0, P1: 1, P2: 2, P3: 3, pass: 4 };

/**
 * Shared design-system stylesheet for report.html and index.html.
 * Organized with CSS @layer cascade architecture, light-dark() adaptive tokens,
 * OS Dynamic Type support, @container queries, forced-colors high-contrast fallbacks,
 * Executive Mode toggle, and print/PDF styling — 100% offline with zero external assets.
 * @returns {string}
 */
function siteCss() {
  return `
@layer base, theme, layout, components, utilities;

@layer theme {
:root{
  --font-sans:"Inter","Geist","Plus Jakarta Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --font-display:"Plus Jakarta Sans","Inter","Geist",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  --font-mono:"JetBrains Mono","Geist Mono","Fira Code","Cascadia Code","SF Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --bg:#f8fafc;
  --fg:#0f172a;
  --muted:#475569;
  --card:#ffffff;
  --surface-elevated:rgba(255,255,255,.86);
  --line:#e2e8f0;
  --line-subtle:#f1f5f9;
  --code:#f1f5f9;
  --code-fg:#0f172a;
  --accent:#2563eb;
  --accent-hover:#1d4ed8;
  --accent-fg:#ffffff;
  --accent-subtle:rgba(37,99,235,.08);
  --accent-border:rgba(37,99,235,.24);
  --accent-glow:rgba(37,99,235,.22);
  --accent-alt:#7c3aed;
  --accent-alt-hover:#6d28d9;
  --accent-alt-fg:#ffffff;
  --accent-alt-subtle:rgba(124,58,237,.08);
  --accent-alt-border:rgba(124,58,237,.24);
  --accent-alt-glow:rgba(124,58,237,.22);
  --mesh-a:rgba(37,99,235,.07);
  --mesh-b:rgba(124,58,237,.06);
  --success:#059669;
  --success-border:rgba(5,150,105,.28);
  --shadow-sm:0 1px 2px rgba(15,23,42,.04),0 2px 6px -1px rgba(15,23,42,.04);
  --shadow-md:0 8px 20px -4px rgba(15,23,42,.08),0 2px 6px -2px rgba(15,23,42,.04);
  --shadow-lg:0 16px 34px -6px rgba(15,23,42,.12);
  --radius-sm:6px;
  --radius-md:10px;
  --radius-lg:16px;
  --radius-full:9999px;
  --scrollbar-thumb:#94a3b8;
  --scrollbar-track:#f1f5f9;
  color-scheme:light dark;
  accent-color:var(--accent);
  scrollbar-width:thin;
  scrollbar-color:var(--scrollbar-thumb) var(--scrollbar-track);
  interpolate-size:allow-keywords;
}
:root:has(> head > meta[name="color-scheme"][content="light"]){color-scheme:light}
:root:has(> head > meta[name="color-scheme"][content="dark"]){color-scheme:dark}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:#090d16;
    --fg:#f8fafc;
    --muted:#94a3b8;
    --card:#111726;
    --surface-elevated:rgba(9,13,22,.86);
    --line:#1e293b;
    --line-subtle:#151d2e;
    --code:#172033;
    --code-fg:#e2e8f0;
    --accent:#3b82f6;
    --accent-hover:#60a5fa;
    --accent-fg:#ffffff;
    --accent-subtle:rgba(59,130,246,.15);
    --accent-border:rgba(59,130,246,.35);
    --accent-glow:rgba(59,130,246,.3);
    --accent-alt:#8b5cf6;
    --accent-alt-hover:#a78bfa;
    --accent-alt-fg:#ffffff;
    --accent-alt-subtle:rgba(139,92,246,.15);
    --accent-alt-border:rgba(139,92,246,.35);
    --accent-alt-glow:rgba(139,92,246,.3);
    --mesh-a:rgba(59,130,246,.12);
    --mesh-b:rgba(139,92,246,.1);
    --success:#10b981;
    --success-border:rgba(16,185,129,.35);
    --shadow-sm:0 1px 3px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.04);
    --shadow-md:0 8px 22px -2px rgba(0,0,0,.52),inset 0 1px 0 rgba(255,255,255,.05);
    --shadow-lg:0 18px 36px -4px rgba(0,0,0,.62),inset 0 1px 0 rgba(255,255,255,.06);
    --scrollbar-thumb:#475569;
    --scrollbar-track:#0f172a;
  }
}
:root[data-theme="dark"]{
  --bg:#090d16;
  --fg:#f8fafc;
  --muted:#94a3b8;
  --card:#111726;
  --surface-elevated:rgba(9,13,22,.86);
  --line:#1e293b;
  --line-subtle:#151d2e;
  --code:#172033;
  --code-fg:#e2e8f0;
  --accent:#3b82f6;
  --accent-hover:#60a5fa;
  --accent-fg:#ffffff;
  --accent-subtle:rgba(59,130,246,.15);
  --accent-border:rgba(59,130,246,.35);
  --accent-glow:rgba(59,130,246,.3);
  --accent-alt:#8b5cf6;
  --accent-alt-hover:#a78bfa;
  --accent-alt-fg:#ffffff;
  --accent-alt-subtle:rgba(139,92,246,.15);
  --accent-alt-border:rgba(139,92,246,.35);
  --accent-alt-glow:rgba(139,92,246,.3);
  --mesh-a:rgba(59,130,246,.12);
  --mesh-b:rgba(139,92,246,.1);
  --success:#10b981;
  --success-border:rgba(16,185,129,.35);
  --shadow-sm:0 1px 3px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.04);
  --shadow-md:0 8px 22px -2px rgba(0,0,0,.52),inset 0 1px 0 rgba(255,255,255,.05);
  --shadow-lg:0 18px 36px -4px rgba(0,0,0,.62),inset 0 1px 0 rgba(255,255,255,.06);
  --scrollbar-thumb:#475569;
  --scrollbar-track:#0f172a;
}
@supports (color:light-dark(white,black)){
  :root{
    --bg:light-dark(#f8fafc,#090d16);
    --fg:light-dark(#0f172a,#f8fafc);
    --muted:light-dark(#475569,#94a3b8);
    --card:light-dark(#ffffff,#111726);
    --surface-elevated:light-dark(rgba(248,250,252,.88),rgba(9,13,22,.88));
    --line:light-dark(#e2e8f0,#1e293b);
    --line-subtle:light-dark(#f1f5f9,#151d2e);
    --code:light-dark(#f1f5f9,#172033);
    --code-fg:light-dark(#0f172a,#e2e8f0);
    --scrollbar-thumb:light-dark(#94a3b8,#475569);
    --scrollbar-track:light-dark(#f1f5f9,#0f172a);
  }
}
@supports not (scrollbar-color:auto){
  ::-webkit-scrollbar{width:10px;height:10px}
  ::-webkit-scrollbar-track{background:var(--scrollbar-track)}
  ::-webkit-scrollbar-thumb{background:var(--scrollbar-thumb);border-radius:5px}
}
}

@layer base {
:where(html,body,div,header,main,section,article,footer,nav,ul,ol,li,dl,dt,dd,table,thead,tbody,tr,th,td,label,input,select,button,details,summary,pre,code,h1,h2,h3,h4,p){box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-block-start:4.75rem}
body{margin:0;background-color:var(--bg);background-image:radial-gradient(54rem 26rem at 12% -5%,var(--mesh-a),transparent 70%),radial-gradient(46rem 24rem at 88% -4%,var(--mesh-b),transparent 70%);background-repeat:no-repeat;color:var(--fg);line-height:1.55;font-family:var(--font-sans);font-feature-settings:"cv02","cv03","cv04","cv11";-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
::selection{background:var(--accent-subtle);color:var(--fg)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
code{font-family:var(--font-mono);font-size:.875em;background:var(--code);color:var(--code-fg);padding:.125rem .375rem;border-radius:var(--radius-sm)}
pre{font-family:var(--font-mono);background:var(--code);color:var(--code-fg);padding:.875rem 1rem;border-radius:var(--radius-md);overflow-x:auto;white-space:pre-wrap;word-break:break-word;margin:.625rem 0 0;font-size:.78rem;line-height:1.55;border:1px solid var(--line)}
pre code{background:none;padding:0;font-size:inherit}
h1,h2,h3,h4{font-family:var(--font-display);text-wrap:balance}
p,li,dd{text-wrap:pretty}
.ico{flex:none;vertical-align:-.15em}
}

@layer layout {
.wrap{max-width:75rem;margin-inline:auto;padding:0 1.25rem 4rem}
.masthead{position:sticky;inset-block-start:0;z-index:50;background:var(--surface-elevated);backdrop-filter:blur(20px) saturate(160%);-webkit-backdrop-filter:blur(20px) saturate(160%);border-block-end:1px solid var(--line);box-shadow:0 1px 0 rgba(255,255,255,.04)}
.masthead-in{max-width:75rem;margin-inline:auto;padding:.625rem 1.25rem;display:flex;gap:.875rem;align-items:center;flex-wrap:wrap}
.hero{padding:1.85rem 0 .5rem}
.hero-top{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-block-end:.5rem}
.scores{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16.5rem),1fr));gap:1rem;margin:1.375rem 0}
.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16.5rem),1fr));gap:.875rem}
.cards{display:grid;gap:.875rem;grid-template-columns:repeat(auto-fill,minmax(min(100%,21rem),1fr))}
section{margin:2.125rem 0;scroll-margin-block-start:5rem}
footer.foot{margin-block-start:3rem;padding-block-start:1.25rem;border-block-start:1px solid var(--line);font-size:.75rem;color:var(--muted);display:flex;justify-content:space-between;gap:.75rem;flex-wrap:wrap}
footer.foot a{color:var(--accent);text-decoration:none;font-weight:600;display:inline-flex;align-items:center;gap:.25rem}
footer.foot a:hover{text-decoration:underline}
}

@layer components {
.skip{position:absolute;inset-inline-start:-9999px;inset-block-start:0;z-index:100;background:var(--accent);color:var(--accent-fg);padding:.625rem 1.125rem;font-weight:700;border-radius:0 0 8px 0;text-decoration:none}
.skip:focus{inset-inline-start:0;inset-block-start:0}
.empty{color:var(--muted);font-style:italic}

.brand{font-family:var(--font-display);font-weight:800;font-size:.95rem;letter-spacing:-.02em;white-space:nowrap;display:flex;align-items:center;gap:.55rem}
.brand-logo{flex:none}
.brand span{font-family:var(--font-sans);font-size:.68rem;font-weight:750;text-transform:uppercase;letter-spacing:.055em;color:var(--accent);background:var(--accent-subtle);border:1px solid var(--accent-border);padding:.16rem .5rem;border-radius:var(--radius-full)}
.toolbar{display:flex;gap:.5rem;align-items:center;flex:1;flex-wrap:wrap;min-width:0}
.search{flex:1;min-width:12rem;position:relative;display:flex;align-items:center}
.search input{width:100%;font:inherit;font-size:.84rem;padding:.45rem 2.25rem .45rem 2rem;border-radius:var(--radius-md);border:1px solid var(--line);background:var(--bg);color:var(--fg);transition:border-color .15s ease,box-shadow .15s ease,background-color .15s ease}
.search input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-subtle);background:var(--card)}
.search svg{position:absolute;inset-inline-start:.625rem;inset-block-start:50%;transform:translateY(-50%);opacity:.55;pointer-events:none;transition:opacity .15s,color .15s}
.search:focus-within svg{opacity:1;color:var(--accent)}
.kbd-hint{position:absolute;inset-inline-end:.625rem;inset-block-start:50%;transform:translateY(-50%);font-family:var(--font-mono);font-size:.66rem;font-weight:700;padding:.1rem .38rem;border-radius:4px;background:var(--card);border:1px solid var(--line);color:var(--muted);pointer-events:none}
.cat-select{font:inherit;font-size:.75rem;font-weight:700;padding:.4rem .65rem;border-radius:var(--radius-md);border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer;transition:border-color .15s ease}
.cat-select:hover:not(:disabled){border-color:var(--accent)}
.chips{display:flex;gap:.375rem;flex-wrap:wrap;align-items:center}
.chip{font:inherit;font-size:.75rem;font-weight:700;padding:.38rem .7rem;border-radius:var(--radius-full);border:1px solid var(--line);background:var(--card);color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;gap:.375rem;transition:border-color .15s ease,background-color .15s ease,color .15s ease,box-shadow .15s ease}
.chip:hover:not(:disabled){border-color:var(--accent);color:var(--fg);background:var(--bg)}
.chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--accent-fg);box-shadow:0 2px 8px var(--accent-glow)}
.chip .n{font-size:.68rem;font-weight:700;font-variant-numeric:tabular-nums;opacity:.9;padding:.06rem .38rem;border-radius:var(--radius-full);background:rgba(0,0,0,.16)}
.chip[aria-pressed="false"] .n{background:var(--code);color:var(--fg)}
.print-btn,.mode-btn{font-size:.72rem;padding:.34rem .68rem;color:var(--muted)}
.print-btn:hover:not(:disabled),.mode-btn:hover:not(:disabled){color:var(--fg);border-color:var(--accent)}
.result-count{font-size:.75rem;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:650}

h1{font-size:clamp(1.5rem,1.25rem + 1vw,1.95rem);font-weight:850;margin:0;letter-spacing:-.028em;line-height:1.2}
.status-pill{display:inline-flex;align-items:center;gap:.375rem;font-size:.72rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:.28rem .78rem;border-radius:var(--radius-full);border:1px solid hsl(var(--hue) 65% 78%);background:hsl(var(--hue) 70% 93%);color:hsl(var(--hue) 70% 25%)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .status-pill{color:hsl(var(--hue) 78% 84%);background:hsl(var(--hue) 45% 18%);border-color:hsl(var(--hue) 50% 32%)}}
:root[data-theme="dark"] .status-pill{color:hsl(var(--hue) 78% 84%);background:hsl(var(--hue) 45% 18%);border-color:hsl(var(--hue) 50% 32%)}
.url{font-family:var(--font-mono);font-size:.76rem;color:var(--muted);word-break:break-all;margin:0;line-height:1.6}

.panel{position:relative;background:var(--card);border:1px solid var(--line);border-radius:var(--radius-lg);padding:1.25rem 1.375rem;box-shadow:var(--shadow-sm);transition:box-shadow .2s cubic-bezier(.16,1,.3,1),border-color .2s ease,transform .2s cubic-bezier(.16,1,.3,1)}
.panel:hover{box-shadow:var(--shadow-md);border-color:var(--accent-border)}
.gauge-panel{display:flex;gap:1.125rem;align-items:center;overflow:hidden}
.gauge-panel.search-engine{border-block-start:3px solid var(--accent)}
.gauge-panel.ai-engine{border-block-start:3px solid var(--accent-alt)}
.gauge-panel.ai-engine:hover{border-color:var(--accent-alt-border);border-block-start-color:var(--accent-alt)}
.gauge{position:relative;flex:none;color:var(--muted)}
.gauge svg{display:block}
@keyframes oss-gauge-in{from{opacity:.25;transform:rotate(-98deg)}to{opacity:1;transform:rotate(-90deg)}}
@media (prefers-reduced-motion:no-preference){
  .gauge-fill{transform-origin:40px 40px;animation:oss-gauge-in .55s cubic-bezier(.16,1,.3,1)}
}
.gauge-text{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;gap:.2rem}
.gauge-score{font-family:var(--font-display);font-size:1.55rem;font-weight:850;letter-spacing:-.035em;font-variant-numeric:tabular-nums;color:var(--fg)}
.gauge-band{font-size:.68rem;font-weight:800;letter-spacing:.05em;padding:.12rem .45rem;border-radius:var(--radius-full);color:hsl(var(--hue) 65% 30%);background:hsl(var(--hue) 70% 92%)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .gauge-band{color:hsl(var(--hue) 75% 82%);background:hsl(var(--hue) 45% 20%)}}
:root[data-theme="dark"] .gauge-band{color:hsl(var(--hue) 75% 82%);background:hsl(var(--hue) 45% 20%)}
.axis{display:flex;align-items:center;gap:.4rem;font-family:var(--font-display);font-weight:750;font-size:.95rem;letter-spacing:-.012em}
.axis .ico{color:var(--accent)}
.ai-engine .axis .ico{color:var(--accent-alt)}
.axis-sub{font-size:.76rem;color:var(--muted);margin-block-start:.25rem;line-height:1.48}
.dist-title{display:flex;align-items:center;gap:.45rem;font-family:var(--font-display);font-weight:750;font-size:.92rem;margin-block-end:.75rem;letter-spacing:-.01em}
.dist-title .ico{color:var(--accent)}
.dist-stacked{display:flex;height:.5rem;border-radius:var(--radius-full);overflow:hidden;background:var(--code);margin-block-end:.75rem;gap:2px}
.dist-seg{display:block;height:100%;background:hsl(var(--hue) 70% 48%);border-radius:var(--radius-full);transition:width .3s ease}
.dist-row{display:grid;grid-template-columns:2.25rem 1fr 2rem;gap:.625rem;align-items:center;margin:.375rem 0;font-size:.75rem}
.dist-label{font-weight:750;color:var(--muted)}
.dist-track{height:.5rem;border-radius:var(--radius-full);background:var(--code);overflow:hidden}
.dist-fill{display:block;height:100%;border-radius:var(--radius-full);background:hsl(var(--hue) 70% 48%)}
.dist-count{text-align:end;font-weight:700;font-variant-numeric:tabular-nums;color:var(--fg)}

.toc{display:flex;gap:.5rem;flex-wrap:wrap;margin:1.25rem 0 .5rem;padding:0;list-style:none}
.toc a{font-size:.78rem;font-weight:700;text-decoration:none;color:var(--muted);padding:.38rem .82rem;border:1px solid var(--line);border-radius:var(--radius-full);background:var(--card);transition:color .15s ease,border-color .15s ease,background-color .15s ease,transform .15s ease}
.toc a:hover{color:var(--fg);border-color:var(--accent);background:var(--accent-subtle);transform:translateY(-1px)}

h2{font-size:1.18rem;font-weight:800;margin:0 0 .875rem;letter-spacing:-.018em;padding-block-end:.625rem;border-block-end:1px solid var(--line);display:flex;gap:.625rem;align-items:baseline;justify-content:space-between}
h2 .n{font-family:var(--font-mono);font-size:.76rem;color:var(--muted);font-weight:650;font-variant-numeric:tabular-nums;background:var(--code);padding:.12rem .55rem;border-radius:var(--radius-full);border:1px solid var(--line-subtle)}
.lede{color:var(--muted);margin:0 0 1rem;font-size:.88rem;line-height:1.55}

.detail-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-lg);padding:1rem 1.125rem;box-shadow:var(--shadow-sm)}
.detail-card h3{display:flex;align-items:center;gap:.45rem;margin:0 0 .65rem;font-size:.82rem;font-weight:800;text-transform:uppercase;letter-spacing:.045em;color:var(--muted)}
.detail-card h3 .ico{color:var(--accent)}
.kv-list{margin:0;padding:0;display:grid;gap:.5rem;font-size:.82rem}
.kv-row{display:flex;justify-content:space-between;gap:.75rem;padding-block-end:.38rem}
.kv-row:not(:last-child){border-block-end:1px dashed var(--line-subtle)}
.kv-row:last-child{padding-block-end:0}
.kv-row dt{color:var(--muted);font-weight:600}
.kv-row dd{margin:0;font-weight:700;text-align:end;word-break:break-word;font-variant-numeric:tabular-nums}
.kv-row dd a{color:var(--accent);text-decoration:none}
.kv-row dd a:hover{text-decoration:underline}

.topfix{list-style:none;margin:0;padding:0;display:grid;gap:.75rem;counter-reset:tf}
.topfix li{counter-increment:tf;position:relative;background:var(--card);border:1px solid var(--line);border-inline-start:4px solid hsl(var(--hue) 68% 46%);border-radius:var(--radius-md);padding:1rem 1.125rem 1rem 3.5rem;box-shadow:var(--shadow-sm);transition:border-color .15s ease,transform .15s ease,box-shadow .15s ease}
.topfix li:hover{border-color:var(--accent);transform:translateX(3px);box-shadow:var(--shadow-md)}
.topfix li::before{content:counter(tf);position:absolute;inset-inline-start:1.125rem;inset-block-start:1rem;width:1.625rem;height:1.625rem;border-radius:var(--radius-full);background:var(--accent);color:var(--accent-fg);font-size:.78rem;font-weight:800;display:grid;place-items:center;box-shadow:0 2px 6px var(--accent-glow)}
.topfix-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;margin-block-end:.38rem}
.topfix-main{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem}
.topfix-stat{display:inline-flex;align-items:center;gap:.625rem;font-size:.75rem;color:var(--muted);font-weight:600}
.topfix-count{white-space:nowrap;font-variant-numeric:tabular-nums}
.topfix li .finding-plain{margin:0;font-size:.82rem;color:var(--muted);line-height:1.5}

.badge{display:inline-flex;align-items:center;gap:.28rem;font-size:.66rem;font-weight:800;letter-spacing:.055em;text-transform:uppercase;padding:.14rem .5rem;border-radius:var(--radius-sm);color:hsl(var(--hue) 68% 26%);background:hsl(var(--hue) 70% 92%);vertical-align:1px;white-space:nowrap;border:1px solid hsl(var(--hue) 65% 82%)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .badge{color:hsl(var(--hue) 78% 82%);background:hsl(var(--hue) 45% 20%);border-color:hsl(var(--hue) 50% 30%)}}
:root[data-theme="dark"] .badge{color:hsl(var(--hue) 78% 82%);background:hsl(var(--hue) 45% 20%);border-color:hsl(var(--hue) 50% 30%)}

.group h3{display:flex;align-items:center;gap:.55rem;font-size:.95rem;margin:1.625rem 0 .875rem;color:var(--fg);font-weight:750;letter-spacing:-.01em}
.group h3 .ico{color:var(--accent)}
.group-count{font-family:var(--font-mono);font-size:.69rem;font-weight:700;padding:.12rem .5rem;border-radius:var(--radius-full);background:var(--code);color:var(--muted);font-variant-numeric:tabular-nums}

.finding{container-type:inline-size;background:var(--card);border:1px solid var(--line);border-inline-start:3px solid hsl(var(--sev-hue,215) 68% 48%);border-radius:var(--radius-lg);padding:1.125rem 1.25rem;display:flex;flex-direction:column;gap:.75rem;box-shadow:var(--shadow-sm);transition:border-color .18s ease,transform .18s cubic-bezier(.16,1,.3,1),box-shadow .18s cubic-bezier(.16,1,.3,1)}
.finding:hover{border-color:var(--accent);border-inline-start-color:hsl(var(--sev-hue,215) 72% 50%);transform:translateY(-2px);box-shadow:var(--shadow-md)}
.finding[hidden]{display:none}
.finding-head{display:flex;gap:.55rem;align-items:center;flex-wrap:wrap}
.finding-head h4{font-size:.92rem;font-weight:750;margin:0;flex:1;min-width:12rem;line-height:1.4;letter-spacing:-.015em}
.finding-cat{display:inline-flex;align-items:center;gap:.28rem;font-size:.64rem;font-weight:750;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:.14rem .45rem;background:var(--code);border-radius:var(--radius-sm);border:1px solid var(--line-subtle)}
.finding-plain{margin:0;font-size:.82rem;color:var(--muted);line-height:1.5}
.finding-meta{display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem;margin:0;padding:.625rem .75rem;background:var(--code);border:1px solid var(--line-subtle);border-radius:var(--radius-md);font-size:.72rem}
@container (width < 22rem){
  .finding-meta{grid-template-columns:repeat(2,1fr)}
}
.finding-meta dt{font-size:.6rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:750}
.finding-meta dd{margin:.12rem 0 0;font-weight:750;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.finding-meta code{font-size:.69rem;padding:0;background:none}
.finding-row{margin:0;font-size:.82rem;line-height:1.5}
.finding-row strong{display:block;font-size:.6rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-block-end:.18rem}
.finding-row span{word-break:break-word}
.finding-foot{display:flex;align-items:center;gap:.625rem;margin-block-start:auto;padding-block-start:.625rem;border-block-start:1px solid var(--line)}
button.copy-fix{font:inherit;font-size:.75rem;font-weight:700;padding:.38rem .85rem;border-radius:var(--radius-md);border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer;display:inline-flex;align-items:center;gap:.38rem;transition:border-color .15s ease,color .15s ease,background-color .15s ease,box-shadow .15s ease}
button.copy-fix:hover:not(:disabled){border-color:var(--accent);color:var(--accent);background:var(--accent-subtle);box-shadow:0 0 0 2px var(--accent-subtle)}
.copied{font-size:.75rem;color:var(--success);font-weight:750;display:inline-flex;align-items:center;gap:.25rem}
details.snippet summary{cursor:pointer;font-size:.75rem;font-weight:700;color:var(--accent);user-select:none}
details::details-content{transition:block-size .24s ease,content-visibility .24s allow-discrete;overflow:hidden}
details:not([open])::details-content{block-size:0}
details[open]::details-content{block-size:auto}
summary::marker{color:var(--muted)}
.none-msg{grid-column:1/-1;color:var(--muted);font-style:italic;padding:1.5rem;text-align:center;background:var(--card);border:1px dashed var(--line);border-radius:var(--radius-lg)}

#summary{background:var(--card);border:1px solid var(--line);border-inline-start:4px solid var(--accent);border-radius:var(--radius-lg);padding:1.375rem 1.5rem;box-shadow:var(--shadow-sm)}
#summary h2{border-block-end:none;padding-block-end:0;margin-block-end:.625rem}
#summary .lede{margin-block-end:1rem;font-size:.92rem}
#copy-summary{font:inherit;font-size:.78rem;font-weight:700;padding:.44rem 1rem;border-radius:var(--radius-full);border:1px solid var(--accent-border);background:var(--accent-subtle);color:var(--accent);cursor:pointer;transition:background-color .15s ease,color .15s ease,border-color .15s ease,box-shadow .15s ease;display:inline-flex;align-items:center;gap:.4rem}
#copy-summary:hover:not(:disabled){background:var(--accent);color:var(--accent-fg);border-color:var(--accent);box-shadow:0 2px 10px var(--accent-glow)}

.checklist{list-style:none;margin:0 0 1.125rem;padding:0;display:grid;gap:.55rem}
.checklist li{display:flex;gap:.75rem;align-items:center;font-size:.84rem;padding:.65rem .95rem;background:var(--card);border:1px solid var(--line);border-radius:var(--radius-md);box-shadow:var(--shadow-sm);transition:border-color .15s ease}
.checklist .box{font-weight:800;flex:none;display:inline-flex;align-items:center;justify-content:center}
.checklist li[data-checked="yes"]{border-color:var(--success-border)}
.checklist li[data-checked="yes"] .box{color:var(--success)}
.checklist li[data-checked="no"]{border-style:dashed}
.checklist li[data-checked="no"] .box{color:var(--muted)}
.progress{height:.56rem;border-radius:var(--radius-full);background:var(--code);overflow:hidden;margin:0 0 1.125rem;max-width:28rem}
.progress i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent-alt));border-radius:var(--radius-full);transition:width .4s ease}

.cwv-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-lg);padding:1.125rem 1.25rem;box-shadow:var(--shadow-sm);margin-block-end:.875rem}
.cwv-card h4{display:flex;align-items:center;gap:.45rem;margin:0 0 .75rem;font-size:.95rem;font-weight:750;letter-spacing:-.015em}
.cwv-card h4 .ico{color:var(--accent)}
.cmd-box{display:flex;align-items:center;justify-content:space-between;gap:.75rem;background:var(--code);border:1px solid var(--line);border-radius:var(--radius-md);padding:.625rem .875rem;margin:.5rem 0;font-family:var(--font-mono);font-size:.78rem;overflow-x:auto}

details.passed summary{cursor:pointer;font-weight:700;font-size:.84rem;padding:.75rem 1rem;background:var(--card);border:1px solid var(--line);border-radius:var(--radius-md);box-shadow:var(--shadow-sm);user-select:none}
details.passed ul{margin:.75rem 0 0;padding-inline-start:1.5rem;font-size:.78rem;columns:2;column-gap:1.875rem}
details.passed li{break-inside:avoid;margin:.25rem 0}

.warn{border:1px solid #d97706;background:rgba(217,119,6,.1);border-radius:var(--radius-md);padding:.75rem 1rem;font-size:.82rem}
.crumbs{font-size:.82rem;margin:0 0 1rem}
.crumbs a{color:var(--accent);text-decoration:none;font-weight:700;display:inline-flex;align-items:center;gap:.35rem}
.crumbs a:hover{text-decoration:underline}
}

@layer utilities {
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
body.exec-mode .tech-detail{display:none!important}
@media (max-width:48em){
  .cards,.detail-grid{grid-template-columns:1fr}
  details.passed ul{columns:1}
  .wrap,.masthead-in{padding-inline:0.875rem}
  .gauge-panel{flex-direction:column;text-align:center;gap:.875rem}
  .axis{justify-content:center}
  .finding-meta{grid-template-columns:repeat(2,1fr)}
  .toolbar{gap:.5rem}
  .search{min-width:100%}
}
@media (forced-colors:active){
  .panel,.finding,.detail-card,.cwv-card,.checklist li,.topfix li,#summary,details.passed summary{border:1px solid CanvasText}
  .badge,.status-pill,.gauge-band{border:1px solid CanvasText}
  .chip[aria-pressed="true"]{outline:2px solid Highlight;background:Highlight;color:HighlightText}
}
@media (prefers-reduced-motion:reduce){
  :root{interpolate-size:numeric-only}
  html{scroll-behavior:auto}
  .finding,.panel,.topfix li,.toc a,.chip,details::details-content{transition:none!important}
}
}
@media print{
  .no-print,.toc,.masthead{display:none!important}
  html{scroll-behavior:auto}
  body{background:#fff;color:#000}
  body.exec-mode .tech-detail{display:block!important}
  .wrap{max-width:none;padding:0}
  .finding,.panel,.detail-card,details.passed summary,.checklist li,.topfix li,#summary{break-inside:avoid;border-color:#bbb;box-shadow:none}
  .cards{grid-template-columns:1fr 1fr}
  a{color:#000;text-decoration:none}
}
`;
}

/** Extra rules only the site dashboard needs (responsive pages table, reach bars, sort controls). */
const DASHBOARD_CSS = `@layer components {
.table-scroll{container-type:inline-size;overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--card);box-shadow:var(--shadow-sm)}
table.pages{border-collapse:collapse;width:100%;font-size:.84rem;min-width:44rem}
table.pages caption{caption-side:bottom;padding:.65rem 1rem;font-size:.75rem;color:var(--muted);text-align:start}
table.pages th,table.pages td{padding:.75rem 1rem;text-align:start;border-block-end:1px solid var(--line);vertical-align:middle}
table.pages thead th{position:sticky;inset-block-start:0;z-index:2;font-size:.69rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);background:var(--code);white-space:nowrap;cursor:pointer;user-select:none;transition:color .15s ease,background-color .15s ease}
table.pages thead th:hover{color:var(--fg)}
table.pages thead th[aria-sort="ascending"],table.pages thead th[aria-sort="descending"]{color:var(--accent);background:var(--accent-subtle)}
table.pages thead th[aria-sort="ascending"]::after{content:" ↑";content:" ↑" / "";font-weight:800}
table.pages thead th[aria-sort="descending"]::after{content:" ↓";content:" ↓" / "";font-weight:800}
table.pages tbody tr:last-child td{border-block-end:none}
table.pages tbody tr:hover{background:var(--accent-subtle)}
table.pages tbody tr[hidden]{display:none}
td.num{font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:700}
td.p-url{word-break:break-all;font-weight:650}
td.p-url a{color:var(--accent);text-decoration:none}
td.p-url a:hover{text-decoration:underline}
.reach{display:inline-block;vertical-align:middle;width:6.25rem;height:.38rem;border-radius:var(--radius-full);background:var(--code);overflow:hidden;flex-shrink:0}
.reach i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent-alt));border-radius:var(--radius-full);transition:width .3s ease}
@container (width < 42rem){
  table.pages{min-width:0;--col-2:"Search";--col-3:"AI";--col-4:"P0";--col-5:"P1";--col-6:"P2";--col-7:"P3"}
  table.pages,table.pages tbody,table.pages tr,table.pages td{display:block}
  table.pages thead{display:none}
  table.pages tbody tr{padding:.65rem .85rem;border-block-end:1px solid var(--line)}
  table.pages tbody tr[hidden]{display:none}
  table.pages td{padding:.3rem 0;border-block-end:none;display:flex;justify-content:space-between;align-items:center;gap:.75rem}
  table.pages td.p-url{display:block;padding-block-end:.45rem;margin-block-end:.35rem;border-block-end:1px dashed var(--line-subtle)}
  table.pages td:not(.p-url)::before{font-size:.69rem;font-weight:750;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  table.pages td:nth-child(2)::before{content:var(--col-2) ": "}
  table.pages td:nth-child(3)::before{content:var(--col-3) ": "}
  table.pages td:nth-child(4)::before{content:var(--col-4) ": "}
  table.pages td:nth-child(5)::before{content:var(--col-5) ": "}
  table.pages td:nth-child(6)::before{content:var(--col-6) ": "}
  table.pages td:nth-child(7)::before{content:var(--col-7) ": "}
}
}
@media print{table.pages tr{break-inside:avoid}}`;

/**
 * Basename convention for multi-page runs, shared with bin/cli.mjs:
 * page 1 is `report`, page N is `report-N`. Dashboard links assume the
 * HTML format was written.
 * @param {number} idx zero-based page index
 * @returns {string}
 */
export function siteBasename(idx) {
  return idx === 0 ? "report" : `report-${idx + 1}`;
}

/**
 * Top findings across page reports: worst severity first, then most
 * widespread. Each finding counts once per page it appears on. Shared by
 * the CLI terminal summary and the site dashboard.
 * @param {Report[]} pageReports
 * @param {number} [n]
 * @returns {{ finding: Finding, pages: number, total: number }[]}
 */
export function siteTopFindings(pageReports, n = 5) {
  const list = Array.isArray(pageReports) ? pageReports : [];
  /** @type {Map<string, { finding: Finding, pages: number }>} */
  const byId = new Map();
  for (const r of list) {
    const seenIds = new Set();
    for (const f of r?.findings ?? []) {
      if (!f || f.severity === "pass" || !f.id || seenIds.has(f.id)) continue;
      seenIds.add(f.id);
      const entry = byId.get(f.id);
      if (entry) entry.pages++;
      else byId.set(f.id, { finding: f, pages: 1 });
    }
  }
  const total = list.length;
  return [...byId.values()]
    .map((e) => ({ finding: e.finding, pages: e.pages, total }))
    .sort((a, b) => {
      const sev = (SEV_RANK[a.finding.severity] ?? 9) - (SEV_RANK[b.finding.severity] ?? 9);
      if (sev !== 0) return sev;
      if (b.pages !== a.pages) return b.pages - a.pages;
      return a.finding.id < b.finding.id ? -1 : 1;
    })
    .slice(0, Math.max(0, n));
}

/**
 * Summarize multi-page audit scores and counts.
 * Excludes null/non-finite scores from averages and minimums.
 * @param {Report[]} pageReports
 * @returns {{ avgSearch: number, avgAi: number, minSearch: number, minAi: number, searchValid: number, aiValid: number, totals: Record<string, number> }}
 */
export function summarizeAggregate(pageReports) {
  const pages = Array.isArray(pageReports) ? pageReports : [];
  let searchSum = 0;
  let aiSum = 0;
  let searchValid = 0;
  let aiValid = 0;
  let searchMin = 100;
  let aiMin = 100;
  /** @type {Record<string, number>} */
  const totals = { P0: 0, P1: 0, P2: 0, P3: 0, pass: 0 };
  for (const r of pages) {
    const rawS = r?.scores?.search?.score;
    if (isValidScore(rawS)) {
      searchSum += rawS;
      searchValid++;
      searchMin = Math.min(searchMin, rawS);
    }
    const rawA = r?.scores?.ai?.score;
    if (isValidScore(rawA)) {
      aiSum += rawA;
      aiValid++;
      aiMin = Math.min(aiMin, rawA);
    }
    for (const k of Object.keys(totals)) totals[k] = (totals[k] ?? 0) + Number(r?.counts?.[k] ?? 0);
  }
  return {
    avgSearch: searchValid > 0 ? Math.round(searchSum / searchValid) : 0,
    avgAi: aiValid > 0 ? Math.round(aiSum / aiValid) : 0,
    minSearch: searchValid > 0 ? searchMin : 0,
    minAi: aiValid > 0 ? aiMin : 0,
    searchValid,
    aiValid,
    totals,
  };
}

/**
 * Site-wide dashboard for multi-page audits. Expects the same Report
 * objects the CLI writes as report[-N].json; links follow siteBasename().
 * Excludes null/non-finite scores when aggregating averages and minimums
 * so missing data is never treated as zero.
 * @param {Report[]} pageReports
 * @returns {string}
 */
export function renderSiteIndex(pageReports) {
  const pages = Array.isArray(pageReports) ? [...pageReports] : [];
  const n = pages.length;
  /** @type {Record<string, number>} */
  const totals = { P0: 0, P1: 0, P2: 0, P3: 0, pass: 0 };
  /** @type {Record<string, number>} */
  const catTotals = { technical: 0, onpage: 0, content: 0, schema: 0, geo: 0, performance: 0 };
  let searchSum = 0;
  let searchValid = 0;
  let aiSum = 0;
  let aiValid = 0;
  let searchMin = 100;
  let aiMin = 100;
  let searchMax = 0;
  let aiMax = 0;
  let truncatedCount = 0;

  for (const r of pages) {
    if (r?.truncated) truncatedCount++;
    const rawS = r?.scores?.search?.score;
    if (isValidScore(rawS)) {
      searchSum += rawS;
      searchValid++;
      searchMin = Math.min(searchMin, rawS);
      searchMax = Math.max(searchMax, rawS);
    }
    const rawA = r?.scores?.ai?.score;
    if (isValidScore(rawA)) {
      aiSum += rawA;
      aiValid++;
      aiMin = Math.min(aiMin, rawA);
      aiMax = Math.max(aiMax, rawA);
    }
    for (const k of Object.keys(totals)) totals[k] = (totals[k] ?? 0) + Number(r?.counts?.[k] ?? 0);
    for (const f of r?.findings ?? []) {
      if (f && f.severity !== "pass") {
        const ck = String(f.category || "technical");
        catTotals[ck] = (catTotals[ck] ?? 0) + 1;
      }
    }
  }
  const avgSearch = searchValid > 0 ? Math.round(searchSum / searchValid) : null;
  const avgAi = aiValid > 0 ? Math.round(aiSum / aiValid) : null;
  const avgSearchBand = avgSearch !== null ? scoreBand(avgSearch) : "N/A";
  const avgAiBand = avgAi !== null ? scoreBand(avgAi) : "N/A";
  /** @type {any} */
  const firstSite = n > 0 && pages[0]?.site && typeof pages[0]?.site === "object" ? pages[0]?.site : {};
  const first = n > 0 ? pages[0] : null;
  const origin = String(firstSite.origin || first?.finalUrl || "this site");
  const checkedAt = String(first?.checkedAt ?? "");
  const version = String(first?.version ?? "");
  const rulesVer = String(first?.rulesVersion || RULES_VERSION);

  /**
   * Normalize one score axis on a page report. Distinguishes missing/non-finite
   * values (`valid: false`, displayed as `N/A`) from legitimate `0` scores (`valid: true`).
   * @param {any} axis
   * @returns {{ valid: boolean, score: number | null, band: string }}
   */
  const normAxis = (axis) => {
    const raw = axis?.score;
    if (isValidScore(raw)) {
      const b = typeof axis?.band === "string" && axis.band ? axis.band : scoreBand(raw);
      return { valid: true, score: raw, band: b };
    }
    return { valid: false, score: null, band: "N/A" };
  };

  const ordered = pages
    .map((r, i) => ({ r, i, s: normAxis(r?.scores?.search), a: normAxis(r?.scores?.ai) }))
    .sort((x, y) => {
      if (x.s.valid !== y.s.valid) return x.s.valid ? -1 : 1;
      if (x.s.valid && y.s.valid && x.s.score !== y.s.score) {
        return /** @type {number} */ (x.s.score) - /** @type {number} */ (y.s.score);
      }
      if (x.a.valid !== y.a.valid) return x.a.valid ? -1 : 1;
      if (x.a.valid && y.a.valid && x.a.score !== y.a.score) {
        return /** @type {number} */ (x.a.score) - /** @type {number} */ (y.a.score);
      }
      return x.i - y.i;
    });
  const rows = ordered
    .map(({ r, i, s, a }) => {
      const name = siteBasename(i);
      const counts = r?.counts ?? {};
      const p0 = Number(counts.P0 ?? 0);
      const p1 = Number(counts.P1 ?? 0);
      const p2 = Number(counts.P2 ?? 0);
      const p3 = Number(counts.P3 ?? 0);
      const hay = `${r?.finalUrl ?? ""} ${r?.page?.title ?? ""} ${s.band} ${a.band}`.toLowerCase();
      const sData = s.valid ? String(s.score) : "";
      const aData = a.valid ? String(a.score) : "";
      const sLabel = s.valid ? `${s.score} ${esc(s.band)}` : "N/A";
      const aLabel = a.valid ? `${a.score} ${esc(a.band)}` : "N/A";
      return `<tr data-search="${esc(hay)}" data-band="${esc(s.band)}" data-p0p1="${p0 + p1 > 0 ? "yes" : "no"}" data-s="${sData}" data-a="${aData}" data-p0="${p0}" data-p1="${p1}" data-p2="${p2}" data-p3="${p3}"><td class="p-url"><a href="./${esc(name)}.html">${esc(r?.finalUrl)}</a></td><td class="num"><span class="badge" style="--hue:${BAND_HUE[s.band] ?? 215}">${sLabel}</span></td><td class="num"><span class="badge" style="--hue:${BAND_HUE[a.band] ?? 215}">${aLabel}</span></td><td class="num">${p0}</td><td class="num">${p1}</td><td class="num">${p2}</td><td class="num">${p3}</td></tr>`;
    })
    .join("\n");

  const hasAnyValidSearch = ordered.some((e) => e.s.valid);
  const rankPool = hasAnyValidSearch ? ordered.filter((e) => e.s.valid) : ordered.filter((e) => e.a.valid);
  const worstEntry = rankPool[0];
  const bestPool = [...rankPool].sort((x, y) => {
    if (hasAnyValidSearch) {
      if (x.s.score !== y.s.score) {
        return /** @type {number} */ (y.s.score) - /** @type {number} */ (x.s.score);
      }
      if (x.a.valid !== y.a.valid) return x.a.valid ? -1 : 1;
      if (x.a.valid && y.a.valid && x.a.score !== y.a.score) {
        return /** @type {number} */ (y.a.score) - /** @type {number} */ (x.a.score);
      }
      return x.i - y.i;
    }
    if (x.a.score !== y.a.score) {
      return /** @type {number} */ (y.a.score) - /** @type {number} */ (x.a.score);
    }
    return x.i - y.i;
  });
  const bestEntry = bestPool[0];
  /** @param {{ valid: boolean, score: number | null, band: string }} ax */
  const fmtCardScore = (ax) => (ax.valid ? `${ax.score}/100 (${esc(ax.band)})` : "N/A");
  const rankCardsHtml =
    worstEntry && bestEntry
      ? `<div class="detail-card"><h3>${ICONS.trendDown}Lowest-Performing Page</h3><dl class="kv-list">
<div class="kv-row"><dt>URL</dt><dd><a href="./${esc(siteBasename(worstEntry.i))}.html#main">${esc(worstEntry.r.finalUrl)}</a></dd></div>
<div class="kv-row"><dt>Search SEO</dt><dd>${fmtCardScore(worstEntry.s)}</dd></div>
<div class="kv-row"><dt>AI Visibility</dt><dd>${fmtCardScore(worstEntry.a)}</dd></div>
</dl></div>
<div class="detail-card"><h3>${ICONS.trendUp}Highest-Performing Page</h3><dl class="kv-list">
<div class="kv-row"><dt>URL</dt><dd><a href="./${esc(siteBasename(bestEntry.i))}.html#main">${esc(bestEntry.r.finalUrl)}</a></dd></div>
<div class="kv-row"><dt>Search SEO</dt><dd>${fmtCardScore(bestEntry.s)}</dd></div>
<div class="kv-row"><dt>AI Visibility</dt><dd>${fmtCardScore(bestEntry.a)}</dd></div>
</dl></div>`
      : `<div class="detail-card"><h3>${ICONS.trendDown}Lowest-Performing Page</h3><p class="empty">N/A — no valid page scores available.</p></div>
<div class="detail-card"><h3>${ICONS.trendUp}Highest-Performing Page</h3><p class="empty">N/A — no valid page scores available.</p></div>`;
  const highlightsHtml =
    n > 0
      ? `<div class="detail-grid" style="margin:1.125rem 0">
${rankCardsHtml}
<div class="detail-card"><h3>${ICONS.globe}Crawl &amp; Aggregation Summary</h3><dl class="kv-list">
<div class="kv-row"><dt>Aggregation Method</dt><dd>Arithmetic mean (unblended)</dd></div>
<div class="kv-row"><dt>Contributing Pages</dt><dd>Search: ${searchValid}/${n} &middot; AI: ${aiValid}/${n}</dd></div>
<div class="kv-row"><dt>Crawl Truncation</dt><dd>${truncatedCount > 0 ? `${truncatedCount} page(s) hit 5MB cap` : "Complete (0 truncated)"}</dd></div>
</dl></div>
</div>`
      : "";

  const top = siteTopFindings(pages, 5);
  const topHtml =
    top.length === 0
      ? `<p class="empty">No recurring issues — every page passed.</p>`
      : `<ol class="topfix">\n${top
          .map(({ finding: f, pages: hit, total }) => {
            const hue = SEV_HUE[String(f.severity)] ?? 45;
            const meta = getFindingMeta(String(f.id ?? ""));
            const pct = total > 0 ? Math.round((hit / total) * 100) : 0;
            return `<li style="--hue:${hue}"><div class="topfix-row"><div class="topfix-main"><span class="badge">${severityIcon(String(f.severity))}${esc(f.severity)}</span> <strong>${esc(f.title)}</strong> <code>${esc(f.id)}</code></div><div class="topfix-stat"><span class="topfix-count">on ${hit}/${total} pages</span><span class="reach" role="img" aria-label="${hit} of ${total} pages affected"><i style="width:${pct}%"></i></span></div></div><p class="finding-plain">${esc(String(f.fix || meta.plain).slice(0, 160))}</p></li>`;
          })
          .join("\n")}\n</ol>`;

  const catMax = Math.max(1, ...Object.values(catTotals));
  const catDistHtml = `<div class="panel">${CATEGORY_ORDER.map((ck) => {
    const cnt = Number(catTotals[ck] ?? 0);
    const label = CATEGORY_LABELS[ck] ?? ck;
    return `<div class="dist-row" style="grid-template-columns:8.5rem 1fr 2.5rem"><span class="dist-label" style="display:inline-flex;align-items:center;gap:.35rem">${categoryIcon(ck)}${esc(label)}</span><span class="dist-track"><span class="dist-fill" style="--hue:215;width:${((cnt / catMax) * 100).toFixed(1)}%"></span></span><span class="dist-count">${cnt}</span></div>`;
  }).join("")}</div>`;

  const dups = findDuplicateTitles(pages);
  const dupsHtml =
    dups.length === 0
      ? `<p class="empty">No duplicate titles or meta descriptions across these pages.</p>`
      : `<ul>\n${dups
          .map((d) => {
            const refs = d.pages
              .map((i) => `<a href="./${esc(siteBasename(i))}.html">page ${i + 1}</a>`)
              .join(", ");
            return `<li>Duplicate ${esc(d.kind)} on ${refs}: “${esc(d.value.slice(0, 120))}” — give each page a unique ${esc(d.kind)}.`;
          })
          .join("\n")}\n</ul>`;

  const lowLinkPages = pages
    .map((r, i) => ({ r, i, outlinks: Number(r?.page?.internalLinks ?? 0) }))
    .filter((x) => x.outlinks < 2 && Object.keys(x.r?.page ?? {}).length > 0);
  const linkingHtml =
    lowLinkPages.length === 0
      ? `<p class="empty">All audited pages with link metrics have 2+ internal outlinks.</p>`
      : `<ul>\n${lowLinkPages
          .map(
            (x) =>
              `<li><a href="./${esc(siteBasename(x.i))}.html">${esc(x.r.finalUrl)}</a> — ${x.outlinks} internal outlink${x.outlinks === 1 ? "" : "s"} (add contextual internal links to prevent dead-end crawl paths).</li>`,
          )
          .join("\n")}\n</ul>`;

  const avgSearchText = avgSearch !== null ? `${avgSearch}/100` : "N/A";
  const avgAiText = avgAi !== null ? `${avgAi}/100` : "N/A";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="text-scale" content="scale">
${themeInitScript()}
<title>one-step-seo site report — ${esc(origin)}</title>
<meta name="description" content="${esc(`Site audit of ${n} pages: avg Search ${avgSearchText}, avg AI ${avgAiText}.`)}">
<style>${siteCss()}
${DASHBOARD_CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to site report</a>
<div class="masthead no-print"><div class="masthead-in">
<div class="brand">${ICONS.brand}one-step-seo <span>site report</span></div>
<div class="toolbar">
<label class="search">${ICONS.search}<input type="search" id="site-q" placeholder="Filter pages by URL or band…" autocomplete="off" aria-label="Filter pages by URL or band"><kbd class="kbd-hint">/</kbd></label>
<div class="chips" role="group" aria-label="Filter pages">
<button type="button" class="chip site-chip" data-filter="all" aria-pressed="true">All (${n})</button>
<button type="button" class="chip site-chip" data-filter="p0p1" aria-pressed="false">Has P0/P1</button>
<button type="button" class="chip mode-btn" id="theme-toggle" title="Switch color theme">Theme: Auto</button>
<button type="button" class="chip print-btn" onclick="window.print()" title="Print or save as PDF">${ICONS.printer}Print</button>
</div>
</div>
</div></div>
<div class="wrap"><main id="main">
<header class="hero">
<h1>Site audit</h1>
<p class="url">${esc(origin)} · ${n} page${n === 1 ? "" : "s"}${checkedAt ? ` · Checked ${esc(checkedAt)}` : ""}${version ? ` · v${esc(version)}` : ""} · Rules ${esc(rulesVer)}</p>
<div class="scores">
<div class="panel gauge-panel search-engine">${gauge(avgSearch, avgSearchBand, "Average Search SEO")}
<div><div class="axis">${ICONS.compass}Avg Search SEO</div><div class="axis-sub">Average ${avgSearchText} · lowest ${searchValid > 0 ? searchMin : "N/A"} · highest ${searchValid > 0 ? searchMax : "N/A"} (${searchValid}/${n} valid pages)</div></div></div>
<div class="panel gauge-panel ai-engine">${gauge(avgAi, avgAiBand, "Average AI Visibility")}
<div><div class="axis">${ICONS.sparkles}Avg AI Visibility</div><div class="axis-sub">Average ${avgAiText} · lowest ${aiValid > 0 ? aiMin : "N/A"} · highest ${aiValid > 0 ? aiMax : "N/A"} (${aiValid}/${n} valid pages)</div></div></div>
<div class="panel"><div class="dist-title">${ICONS.layers}Findings across all pages</div>${severityBars(totals)}</div>
</div>
${highlightsHtml}
<ul class="toc">
<li><a href="#pages">Pages</a></li><li><a href="#top-site">Top issues</a></li><li><a href="#cat-dist">By category</a></li><li><a href="#dups">Duplicates</a></li><li><a href="#linking">Internal linking</a></li>
</ul>
</header>

<section id="pages" aria-labelledby="pages-h"><h2 id="pages-h"><span>Pages</span><span class="n" id="pages-count" role="status" aria-live="polite">${n}</span></h2>
<div class="table-scroll" tabindex="0" role="region" aria-labelledby="pages-h"><table class="pages"><caption>Worst Search score first (click or press Enter on column headers to sort)</caption>
<thead><tr><th scope="col" tabindex="0" role="button" aria-sort="none" data-sort="url">Page</th><th scope="col" tabindex="0" role="button" aria-sort="ascending" data-sort="s">Search</th><th scope="col" tabindex="0" role="button" aria-sort="none" data-sort="a">AI</th><th scope="col" tabindex="0" role="button" aria-sort="none" data-sort="p0">P0</th><th scope="col" tabindex="0" role="button" aria-sort="none" data-sort="p1">P1</th><th scope="col" tabindex="0" role="button" aria-sort="none" data-sort="p2">P2</th><th scope="col" tabindex="0" role="button" aria-sort="none" data-sort="p3">P3</th></tr></thead>
<tbody>
${rows}
</tbody></table></div></section>

<section id="top-site" aria-labelledby="top-site-h"><h2 id="top-site-h"><span>Top recurring issues</span><span class="n">${top.length}</span></h2>${topHtml}</section>

<section id="cat-dist" aria-labelledby="cat-dist-h"><h2 id="cat-dist-h"><span>Category issue distribution</span><span class="n">${Object.values(catTotals).reduce((a, b) => a + b, 0)}</span></h2>${catDistHtml}</section>

<section id="dups" aria-labelledby="dups-h"><h2 id="dups-h"><span>Duplicate titles &amp; descriptions</span><span class="n">${dups.length}</span></h2>${dupsHtml}</section>

<section id="linking" aria-labelledby="linking-h"><h2 id="linking-h"><span>Internal linking &amp; dead-end risk</span><span class="n">${lowLinkPages.length}</span></h2>${linkingHtml}</section>

<footer class="foot"><span>Generated by one-step-seo${version ? ` v${esc(version)}` : ""} (rules ${esc(rulesVer)}) — two scores, never blended. <a href="${esc(CHECKS_DOC_URL)}">Checks reference ${ICONS.ext}</a></span><span>${esc(origin)}</span></footer>
</main></div>
<script>
(function(){
  var sq=document.getElementById('site-q');
  var chips=[].slice.call(document.querySelectorAll('.site-chip'));
  var rows=[].slice.call(document.querySelectorAll('table.pages tbody tr'));
  var pCount=document.getElementById('pages-count');
  var filt='all';
  function filterRows(){
    var term=(sq&&sq.value||'').toLowerCase().trim();
    var shown=0;
    rows.forEach(function(r){
      var hay=r.getAttribute('data-search')||'';
      var okF=filt==='all'||(filt==='p0p1'&&r.getAttribute('data-p0p1')==='yes');
      var vis=okF&&(!term||hay.indexOf(term)!==-1);
      r.hidden=!vis;
      if(vis) shown++;
    });
    if(pCount) pCount.textContent=String(shown);
  }
  if(sq) sq.addEventListener('input',filterRows);
  chips.forEach(function(c){
    c.addEventListener('click',function(){
      filt=c.getAttribute('data-filter')||'all';
      chips.forEach(function(o){ o.setAttribute('aria-pressed',o===c?'true':'false'); });
      filterRows();
    });
  });
  var ths=[].slice.call(document.querySelectorAll('table.pages thead th[data-sort]'));
  function sortByHeader(th){
    var key=th.getAttribute('data-sort');
    var tbody=th.closest('table').querySelector('tbody');
    if(!tbody||!key) return;
    var dir=th.getAttribute('aria-sort')==='ascending'?-1:1;
    ths.forEach(function(o){ o.setAttribute('aria-sort',o===th?(dir===1?'ascending':'descending'):'none'); });
    rows.sort(function(a,b){
      if(key==='url') return dir*(a.getAttribute('data-search')||'').localeCompare(b.getAttribute('data-search')||'');
      var rawA=a.getAttribute('data-'+key);
      var rawB=b.getAttribute('data-'+key);
      var hasA=rawA!==null&&rawA!==''&&Number.isFinite(Number(rawA));
      var hasB=rawB!==null&&rawB!==''&&Number.isFinite(Number(rawB));
      if(!hasA&&!hasB) return 0;
      if(!hasA) return 1;
      if(!hasB) return -1;
      return dir*(Number(rawA)-Number(rawB));
    });
    rows.forEach(function(r){ tbody.appendChild(r); });
  }
  ths.forEach(function(th){
    th.addEventListener('click',function(){ sortByHeader(th); });
    th.addEventListener('keydown',function(e){
      if(e.key==='Enter'){ e.preventDefault(); sortByHeader(th); }
      if(e.key===' ') e.preventDefault();
    });
    th.addEventListener('keyup',function(e){
      if(e.key===' ') sortByHeader(th);
    });
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='/'&&document.activeElement!==sq&&!['input','textarea','select'].includes((document.activeElement&&document.activeElement.tagName||'').toLowerCase())){
      e.preventDefault();
      if(sq){sq.focus();sq.select();}
    }
    if(e.key==='Escape'&&document.activeElement===sq){
      if(sq){sq.value='';filterRows();sq.blur();}
    }
  });
  var tt=document.getElementById('theme-toggle');
  var metaCs=document.querySelector('meta[name="color-scheme"]');
  var modes=['auto','dark','light'];
  var mIdx=0;
  function setTheme(m){
    if(m==='auto'){
      document.documentElement.removeAttribute('data-theme');
      if(metaCs) metaCs.setAttribute('content','light dark');
      try{localStorage.removeItem('oss-theme');}catch(e){}
      if(tt) tt.textContent='Theme: Auto';
    }else{
      document.documentElement.setAttribute('data-theme',m);
      if(metaCs) metaCs.setAttribute('content',m);
      try{localStorage.setItem('oss-theme',m);}catch(e){}
      if(tt) tt.textContent='Theme: '+(m==='dark'?'Dark':'Light');
    }
  }
  try{
    var saved=localStorage.getItem('oss-theme');
    if(saved==='dark'||saved==='light'){ mIdx=modes.indexOf(saved); setTheme(saved); }
  }catch(e){}
  if(tt) tt.addEventListener('click',function(){
    mIdx=(mIdx+1)%modes.length;
    setTheme(modes[mIdx]);
  });
  if(globalThis.addEventListener){
    globalThis.addEventListener('storage',function(ev){
      if(ev&&ev.key==='oss-theme'){
        var nv=ev.newValue==='dark'||ev.newValue==='light'?ev.newValue:'auto';
        mIdx=modes.indexOf(nv);
        setTheme(nv);
      }
    });
  }
})();
</script>
</body>
</html>
`;
}

/**
 * Coverage-honesty line for the multi-page terminal summary. Pure for
 * testing. Returns null for single-page runs (no line printed).
 * @param {number} reported pages with reports
 * @param {number} cap the --pages value
 * @param {boolean} capped whether the crawl saw URLs it could not take
 * @param {number} maxCap the maximum --pages value (advice adapts at the top)
 * @returns {string | null}
 */
export function coverageLine(reported, cap, capped, maxCap) {
  if (reported <= 1) return null;
  const higher = cap < maxCap ? ` Re-run with a higher --pages (max ${maxCap}) to cover the rest.` : "";
  if (reported >= cap && capped) {
    return `Stopped at the --pages ${cap} cap — the crawl saw more URLs.${higher}`;
  }
  if (capped) {
    return `Audited ${reported} discovered pages; more URLs were seen but not reached.${higher}`;
  }
  return `Audited all ${reported} discovered pages.`;
}

/**
 * Pages sharing identical titles or meta descriptions — the classic
 * multi-page duplicate-content signal. Pure over report.json data
 * (page.title / page.metaDescription), so it needs no crawler changes.
 * Matching is case-insensitive on trimmed text; empty values are ignored.
 * @param {Report[]} pageReports
 * @returns {{ kind: string, value: string, pages: number[] }[]}
 */
export function findDuplicateTitles(pageReports) {
  const list = Array.isArray(pageReports) ? pageReports : [];
  /** @type {Map<string, number[]>} */
  const titles = new Map();
  /** @type {Map<string, number[]>} */
  const metas = new Map();
  list.forEach((r, i) => {
    /** @type {any} */
    const pg = r?.page && typeof r.page === "object" ? r.page : {};
    const t = String(pg.title ?? "")
      .trim()
      .toLowerCase();
    if (t) {
      const arr = titles.get(t) ?? [];
      arr.push(i);
      titles.set(t, arr);
    }
    const m = String(pg.metaDescription ?? "")
      .trim()
      .toLowerCase();
    if (m) {
      const arr = metas.get(m) ?? [];
      arr.push(i);
      metas.set(m, arr);
    }
  });
  /** @type {{ kind: string, value: string, pages: number[] }[]} */
  const out = [];
  for (const [value, pages] of titles) {
    if (pages.length > 1) out.push({ kind: "title", value, pages });
  }
  for (const [value, pages] of metas) {
    if (pages.length > 1) out.push({ kind: "meta description", value, pages });
  }
  return out;
}

/**
 * @typedef {{
 *   tool: string,
 *   reportType: string,
 *   version: string,
 *   rulesVersion: string,
 *   origin: string,
 *   checkedAt: string,
 *   pageCount: number,
 *   scores: {
 *     search: { average: number | null, band: string, min: number | null },
 *     ai: { average: number | null, band: string, min: number | null },
 *   },
 *   counts: Record<string, number>,
 *   topIssues: Array<{ id: string, severity: string, category: string, title: string, fix: string, pagesAffected: number, totalPages: number, reachPercent: number }>,
 *   duplicates: Array<{ kind: string, value: string, pages: Array<{ index: number, url: string }> }>,
 *   pages: Array<{
 *     index: number,
 *     url: string,
 *     finalUrl: string,
 *     title: string,
 *     metaDescription: string,
 *     scores: { search: { score: number | null, band: string }, ai: { score: number | null, band: string } },
 *     counts: Record<string, number>,
 *     topFindings: Array<{ id: string, severity: string, title: string, fix: string }>
 *   }>
 * }} SiteReport
 */

/**
 * Consolidated full-site JSON report for multi-page audits.
 * Pure and unit-tested.
 * @param {Report[]} pageReports
 * @param {{ version?: string, checkedAt?: string, origin?: string }} [meta]
 * @returns {SiteReport}
 */
export function buildSiteReport(pageReports, meta = {}) {
  const pages = Array.isArray(pageReports) ? pageReports : [];
  const n = pages.length;
  const agg = summarizeAggregate(pages);
  const first = n > 0 ? pages[0] : null;
  /** @type {any} */
  const firstSite = first?.site && typeof first.site === "object" ? first.site : {};
  const origin = meta.origin || String(firstSite.origin || first?.finalUrl || "");
  const version = meta.version || String(first?.version || PKG_VERSION);
  const checkedAt = meta.checkedAt || String(first?.checkedAt || new Date().toISOString());
  const rulesVer = String(first?.rulesVersion || RULES_VERSION);

  const searchBand = agg.avgSearch !== null ? scoreBand(agg.avgSearch) : "N/A";
  const aiBand = agg.avgAi !== null ? scoreBand(agg.avgAi) : "N/A";

  const top = siteTopFindings(pages, 10).map(({ finding, pages: hitCount, total }) => ({
    id: finding.id,
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
    fix: finding.fix,
    pagesAffected: hitCount,
    totalPages: total,
    reachPercent: total > 0 ? Math.round((hitCount / total) * 100) : 0,
  }));

  const dups = findDuplicateTitles(pages);
  const duplicates = dups.map((d) => ({
    kind: d.kind,
    value: d.value,
    pages: d.pages.map((idx) => ({
      index: idx + 1,
      url: pages[idx]?.finalUrl || pages[idx]?.url || `page-${idx + 1}`,
    })),
  }));

  const pageSummaries = pages.map((p, idx) => ({
    index: idx + 1,
    url: p?.url ?? "",
    finalUrl: p?.finalUrl ?? "",
    title: p?.page?.title ?? "",
    metaDescription: p?.page?.metaDescription ?? "",
    scores: {
      search: { score: p?.scores?.search?.score ?? null, band: p?.scores?.search?.band ?? "N/A" },
      ai: { score: p?.scores?.ai?.score ?? null, band: p?.scores?.ai?.band ?? "N/A" },
    },
    counts: p?.counts ?? { P0: 0, P1: 0, P2: 0, P3: 0, pass: 0 },
    topFindings: (p?.findings ?? [])
      .filter((f) => f && f.severity !== "pass")
      .slice(0, 5)
      .map((f) => ({ id: f.id, severity: f.severity, title: f.title, fix: f.fix })),
  }));

  return {
    tool: "one-step-seo",
    reportType: "site",
    version,
    rulesVersion: rulesVer,
    origin,
    checkedAt,
    pageCount: n,
    scores: {
      search: { average: agg.avgSearch, band: searchBand, min: agg.minSearch },
      ai: { average: agg.avgAi, band: aiBand, min: agg.minAi },
    },
    counts: agg.totals,
    topIssues: top,
    duplicates,
    pages: pageSummaries,
  };
}

/**
 * @param {Report} report
 * @param {{ indexHref?: string, pageCount?: number }} [opts] when set with
 *   indexHref, a breadcrumb back to the multi-page dashboard is rendered.
 * @returns {string}
 */
export function renderHtml(report, opts) {
  const actionable = (report.findings ?? []).filter((f) => f && f.severity !== "pass");
  const passed = (report.findings ?? []).filter((f) => f && f.severity === "pass");
  const first = topFixes(report, 3);
  const groups = groupByCategory(report);
  const checklist = citableChecklist(report);
  const monitor = monitorItems(report);
  const rulesVer = String(report.rulesVersion || RULES_VERSION);
  /** @type {Record<string, any>} */
  const pg = report.page && typeof report.page === "object" ? report.page : {};
  /** @type {Record<string, any>} */
  const st = report.site && typeof report.site === "object" ? report.site : {};
  const titleText = String(pg.title ?? "");
  const metaText = String(pg.metaDescription ?? "");
  const h1List = Array.isArray(pg.h1) ? pg.h1 : [];

  const fixFirst =
    first.length === 0
      ? `<p class="empty">No issues found. Nice.</p>`
      : `<ol class="topfix">\n${first
          .map((f) => {
            const meta = getFindingMeta(String(f.id ?? ""));
            const hue = SEV_HUE[String(f.severity)] ?? 45;
            return `<li style="--hue:${hue}"><div class="topfix-row"><div class="topfix-main"><span class="badge">${severityIcon(String(f.severity))}${esc(f.severity)}</span> <strong>${esc(f.title)}</strong> <code>${esc(f.id)}</code></div><div class="topfix-stat">Impact: ${esc(meta.impact)} &middot; Effort: ${esc(meta.effort)} &middot; Owner: ${esc(meta.owner)}</div></div><p class="finding-plain">${esc(meta.plain)}</p></li>`;
          })
          .join("\n")}\n</ol>`;

  const groupsHtml = groups
    .map((g) => {
      const cards = g.items.map(findingCard).join("\n");
      return `<section class="group" id="cat-${esc(g.key)}" data-group-cat="${esc(g.key)}" aria-labelledby="h-${esc(g.key)}">
<h3 id="h-${esc(g.key)}">${categoryIcon(g.key)}${esc(g.label)} <span class="group-count">${g.items.length}</span></h3>
<div class="cards">${cards}</div></section>`;
    })
    .join("\n");

  const checklistHtml =
    checklist.length === 0
      ? `<p class="empty">No citability signals were evaluated for this report.</p>`
      : `<ul class="checklist">\n${checklist
          .map(
            (c) =>
              `<li data-checked="${c.checked ? "yes" : "no"}"><span class="box" aria-hidden="true">${c.checked ? ICONS.check : ICONS.pending}</span><span>${esc(c.label)}</span></li>`,
          )
          .join("\n")}\n</ul>`;

  const passedHtml =
    passed.length === 0
      ? `<p class="empty">Nothing passed yet — start with “Fix this first”.</p>`
      : `<details class="passed"><summary>${passed.length} check${passed.length === 1 ? "" : "s"} passed</summary><ul>\n${passed
          .map((f) => `<li>${esc(f.title)} <code>${esc(f.id)}</code></li>`)
          .join("\n")}\n</ul></details>`;

  const monitorHtml =
    monitor.length === 0
      ? `<p class="empty">Nothing specific — re-audit after site changes.</p>`
      : `<ul>\n${monitor
          .map(
            (f) =>
              `<li><span class="badge" style="--hue:${SEV_HUE[String(f.severity)] ?? 45}">${severityIcon(String(f.severity))}${esc(f.severity)}</span> ${esc(f.title)} <code>${esc(f.id)}</code> — ${esc(f.fix || f.evidence)}</li>`,
          )
          .join("\n")}\n</ul>`;

  let psiHtml = "";
  if (report.page && report.page.psi) {
    const psi = report.page.psi;
    const lab = psi.lab;
    const field = psi.field;
    const lcpSec = lab && lab.lcpMs != null ? `${(lab.lcpMs / 1000).toFixed(2)}s` : "Unavailable";
    const clsVal = lab && lab.cls != null ? lab.cls.toFixed(3) : "Unavailable";
    const tbtVal = lab && lab.tbtMs != null ? `${Math.round(lab.tbtMs)}ms` : "Unavailable";
    const fcpSec = lab && lab.fcpMs != null ? `${(lab.fcpMs / 1000).toFixed(2)}s` : "Unavailable";
    const labScoreText = lab && lab.score != null ? `${lab.score}/100` : "Unavailable";

    const fieldRows =
      field && (field.lcpMs != null || field.cls != null || field.inpMs != null)
        ? `<div class="cwv-card">
<h4>${ICONS.globe}Chrome UX Report (CrUX Field)</h4>
<p class="finding-plain">75th percentile real-world user metrics (Rating: <strong>${esc(field.overallCategory || "Unavailable")}</strong>)</p>
<dl class="finding-meta">
<div><dt>Field LCP</dt><dd>${field.lcpMs != null ? `${(field.lcpMs / 1000).toFixed(2)}s` : "Unavailable"}</dd></div>
<div><dt>Field CLS</dt><dd>${field.cls != null ? field.cls.toFixed(3) : "Unavailable"}</dd></div>
<div><dt>Field INP</dt><dd>${field.inpMs != null ? `${Math.round(field.inpMs)}ms` : "Unavailable"}</dd></div>
<div><dt>Dataset</dt><dd>CrUX p75</dd></div>
</dl>
</div>`
        : `<p class="empty">No real-user Chrome UX Report (CrUX) data available for this URL yet (missing metrics are never treated as zero).</p>`;

    psiHtml = `<section id="psi" aria-labelledby="psi-h"><h2 id="psi-h"><span>Performance &amp; Core Web Vitals</span><span class="n">PageSpeed Insights (${esc(psi.strategy || "mobile")})</span></h2>
<p class="lede">Lab diagnostics and real-world Core Web Vitals measured via Google PageSpeed Insights.</p>
<div class="cwv-card" style="margin-bottom:12px;">
<h4>${ICONS.gauge}Lab Performance Score: ${labScoreText}</h4>
<dl class="finding-meta">
<div><dt>Largest Contentful Paint</dt><dd>${lcpSec}</dd></div>
<div><dt>Cumulative Layout Shift</dt><dd>${clsVal}</dd></div>
<div><dt>Total Blocking Time</dt><dd>${tbtVal}</dd></div>
<div><dt>First Contentful Paint</dt><dd>${fcpSec}</dd></div>
</dl>
</div>
${fieldRows}
</section>`;
  } else {
    psiHtml = `<section id="psi" aria-labelledby="psi-h"><h2 id="psi-h"><span>Performance &amp; Core Web Vitals</span><span class="n">Not measured (opt-in)</span></h2>
<p class="lede">Live Lighthouse Lab and Chrome UX Report (CrUX) Field metrics were not queried in this run. Unmeasured metrics are reported as unavailable, never zero.</p>
<div class="cwv-card">
<h4>${ICONS.zap}Measure Live Core Web Vitals (LCP, INP, CLS)</h4>
<p class="finding-plain">Set <code>PSI_API_KEY</code> in your environment and pass <code>--psi</code> to include Google PageSpeed Insights Lab and CrUX 75th-percentile Field data:</p>
<div class="cmd-box"><code>PSI_API_KEY=your_key npx one-step-seo page ${esc(report.url)} --psi</code></div>
</div>
</section>`;
  }

  const seoDetailsHtml = `<section id="seo-details" aria-labelledby="seo-details-h"><h2 id="seo-details-h"><span>SEO Details &amp; Page Signals</span><span class="n">${Number(pg.wordCount ?? 0)} words</span></h2>
<div class="detail-grid">
<div class="detail-card"><h3>${ICONS.fileText}Metadata &amp; Canonical</h3><dl class="kv-list">
<div class="kv-row"><dt>Title (${titleText.length} chars)</dt><dd>${titleText ? escTruncate(titleText, 90) : '<span class="empty">Missing</span>'}</dd></div>
<div class="kv-row"><dt>Meta description (${metaText.length} chars)</dt><dd>${metaText ? escTruncate(metaText, 110) : '<span class="empty">Missing</span>'}</dd></div>
<div class="kv-row"><dt>Canonical URL</dt><dd>${pg.canonical ? `<code>${escTruncate(pg.canonical, 80)}</code>` : '<span class="empty">Not set</span>'}</dd></div>
</dl></div>
<div class="detail-card"><h3>${ICONS.layers}Headings &amp; Content</h3><dl class="kv-list">
<div class="kv-row"><dt>H1 count (${h1List.length})</dt><dd>${h1List.length > 0 ? escTruncate(h1List.join(" | "), 90) : '<span class="empty">None</span>'}</dd></div>
<div class="kv-row"><dt>Word count</dt><dd>${Number(pg.wordCount ?? 0)}</dd></div>
<div class="kv-row"><dt>Images</dt><dd>${Number(pg.images ?? 0)}</dd></div>
<div class="kv-row"><dt>Links</dt><dd>${Number(pg.internalLinks ?? 0)} internal &middot; ${Number(pg.externalLinks ?? 0)} external</dd></div>
</dl></div>
<div class="detail-card"><h3>${ICONS.globe}Site Discovery Files</h3><dl class="kv-list">
<div class="kv-row"><dt>Origin</dt><dd>${st.origin ? `<code>${esc(st.origin)}</code>` : '<span class="empty">N/A</span>'}</dd></div>
<div class="kv-row"><dt>robots.txt</dt><dd>${st.robots ? "Found (200)" : "Missing"}</dd></div>
<div class="kv-row"><dt>sitemap.xml</dt><dd>${st.sitemap ? `Found (~${Number(st.sitemapUrls ?? 0)} URLs)` : "Missing"}</dd></div>
<div class="kv-row"><dt>llms.txt</dt><dd>${st.llms ? "Found (200)" : "Missing (optional)"}</dd></div>
</dl></div>
</div></section>`;

  const remediationHtml = `<section id="remediation" aria-labelledby="remediation-h"><h2 id="remediation-h"><span>Remediation &amp; Verification</span><span class="n">CLI workflow</span></h2>
<p class="lede">Apply fixes in priority order (P0 blockers &rarr; P1 high-impact &rarr; P2 optimizations &rarr; P3 polish), then re-run the audit to verify score improvements.</p>
<div class="detail-grid">
<div class="detail-card"><h3>${ICONS.terminal}1. Verify After Changes</h3>
<p class="finding-plain">Re-run the single-page audit to confirm findings are resolved:</p>
<div class="cmd-box"><code>npx one-step-seo page ${esc(report.url)}</code><button type="button" class="copy-fix no-print" data-copy="npx one-step-seo page ${esc(report.url)}">${ICONS.copy}Copy</button><span class="copied" role="status" aria-live="polite"></span></div>
</div>
<div class="detail-card"><h3>${ICONS.zap}2. Safe Local Auto-Fix (Dry-Run First)</h3>
<p class="finding-plain">Preview additive HTML <code>&lt;head&gt;</code> fixes on local build files before applying:</p>
<div class="cmd-box"><code>npx one-step-seo fix ./dist --url ${esc(report.finalUrl || report.url)}</code><button type="button" class="copy-fix no-print" data-copy="npx one-step-seo fix ./dist --url ${esc(report.finalUrl || report.url)}">${ICONS.copy}Copy</button><span class="copied" role="status" aria-live="polite"></span></div>
</div>
</div></section>`;

  const truncatedBanner = report.truncated
    ? `<p class="warn" role="note">Note: HTML exceeded the 5MB audit cap — checks ran on the head portion only.</p>`
    : ``;

  const total = actionable.length;
  const done = checklist.filter((c) => c.checked).length;
  const c = report.counts ?? { P0: 0, P1: 0, P2: 0, P3: 0, pass: 0 };
  const sAxis = isValidScore(report.scores?.search?.score)
    ? {
        valid: true,
        score: report.scores.search.score,
        band: report.scores.search.band || scoreBand(report.scores.search.score),
      }
    : { valid: false, score: null, band: "N/A" };
  const aAxis = isValidScore(report.scores?.ai?.score)
    ? {
        valid: true,
        score: report.scores.ai.score,
        band: report.scores.ai.band || scoreBand(report.scores.ai.score),
      }
    : { valid: false, score: null, band: "N/A" };
  const sText = sAxis.valid ? `${sAxis.score}/100 (${sAxis.band})` : "N/A";
  const aText = aAxis.valid ? `${aAxis.score}/100 (${aAxis.band})` : "N/A";
  const refused = total > 0 && actionable.every((f) => f.id === "T05-robots-disallow");
  const statusLabel = refused
    ? "Crawl Skipped"
    : Number(c.P0 ?? 0) > 0
      ? "Critical P0 Blockers"
      : Number(c.P1 ?? 0) > 0
        ? "Needs Attention"
        : "Healthy Foundation";
  const statusIcon = refused
    ? ICONS.info
    : Number(c.P0 ?? 0) > 0
      ? ICONS.alertCrit
      : Number(c.P1 ?? 0) > 0
        ? ICONS.alertWarn
        : ICONS.shieldOk;
  const statusHue = refused ? 45 : Number(c.P0 ?? 0) > 0 ? 0 : Number(c.P1 ?? 0) > 0 ? 25 : 145;
  const shareDesc = `Search SEO ${sText} | AI Visibility ${aText} — P0=${c.P0} P1=${c.P1} P2=${c.P2} P3=${c.P3}.`;
  const crumb =
    opts && opts.indexHref
      ? `<p class="crumbs no-print"><a href="${esc(opts.indexHref)}">${ICONS.arrowLeft} ${opts.pageCount ? `All ${Number(opts.pageCount)} pages` : "All pages"}</a></p>`
      : "";

  const catOptions = [
    `<option value="all">All categories</option>`,
    ...groups.map((g) => `<option value="${esc(g.key)}">${esc(g.label)} (${g.items.length})</option>`),
  ].join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="text-scale" content="scale">
${themeInitScript()}
<title>one-step-seo report &mdash; ${esc(report.finalUrl)}</title>
<meta name="description" content="${esc(shareDesc)}">
<meta property="og:title" content="one-step-seo report &mdash; ${esc(report.finalUrl)}">
<meta property="og:description" content="${esc(shareDesc)}">
<meta property="og:type" content="website">
<style>${siteCss()}</style>
</head>
<body>
<a class="skip" href="#main">Skip to report</a>

<div class="masthead no-print"><div class="masthead-in">
<div class="brand">${ICONS.brand}one-step-seo <span>report</span></div>
<div class="toolbar">
<label class="search">${ICONS.search}<input type="search" id="q" placeholder="Filter findings…" autocomplete="off" aria-label="Filter findings by text"><kbd class="kbd-hint">/</kbd></label>
<select id="cat-filter" class="cat-select" aria-label="Filter by category">${catOptions}</select>
<div class="chips" role="group" aria-label="Filter by severity">
<button type="button" class="chip" data-sev="all" aria-pressed="true">All</button>
<button type="button" class="chip" data-sev="P0" aria-pressed="false">P0 <span class="n">${c.P0}</span></button>
<button type="button" class="chip" data-sev="P1" aria-pressed="false">P1 <span class="n">${c.P1}</span></button>
<button type="button" class="chip" data-sev="P2" aria-pressed="false">P2 <span class="n">${c.P2}</span></button>
<button type="button" class="chip" data-sev="P3" aria-pressed="false">P3 <span class="n">${c.P3}</span></button>
<button type="button" class="chip mode-btn" id="exec-mode-btn" aria-pressed="false" title="Toggle Executive Mode (hide raw evidence &amp; code snippets)">${ICONS.sliders}Executive Mode</button>
<button type="button" class="chip mode-btn" id="theme-toggle" title="Switch color theme">Theme: Auto</button>
<button type="button" class="chip print-btn" onclick="window.print()" title="Print or save as PDF">${ICONS.printer}Print</button>
</div>
<span class="result-count" id="count" role="status" aria-live="polite">${total} finding${total === 1 ? "" : "s"}</span>
</div></div></div>

<div class="wrap"><main id="main">
<header class="hero">
${crumb}<div class="hero-top"><h1>one-step-seo report</h1><span class="status-pill" style="--hue:${statusHue}">${statusIcon}${esc(statusLabel)}</span></div>
<p class="url">${esc(report.url)}${report.finalUrl && report.finalUrl !== report.url ? ` &rarr; ${esc(report.finalUrl)}` : ""}<br>Checked ${esc(report.checkedAt)} &bull; v${esc(report.version)} &bull; Rules ${esc(rulesVer)}</p>
${truncatedBanner}
<div class="scores">
<div class="panel gauge-panel search-engine">${gauge(sAxis.score, sAxis.band, "Search SEO")}
<div><div class="axis">${ICONS.compass}Search SEO</div><div class="axis-sub">${esc(SEARCH_EXPLAINER)}</div></div></div>
<div class="panel gauge-panel ai-engine">${gauge(aAxis.score, aAxis.band, "AI Visibility")}
<div><div class="axis">${ICONS.sparkles}AI Visibility</div><div class="axis-sub">${esc(AI_EXPLAINER)}</div></div></div>
<div class="panel"><div class="dist-title">${ICONS.layers}Findings by severity</div>${severityBars(c)}</div>
</div>
<ul class="toc">
<li><a href="#summary">Summary</a></li><li><a href="#first">Fix this first</a></li><li><a href="#actions">All findings</a></li>
<li><a href="#seo-details">SEO details</a></li><li><a href="#citable">AI visibility &amp; citability</a></li>
<li><a href="#psi">Core Web Vitals</a></li><li><a href="#remediation">Remediation</a></li>
<li><a href="#passed">Passed</a></li><li><a href="#monitor">Monitor</a></li>
</ul>
</header>

<section id="summary" aria-labelledby="summary-h"><h2 id="summary-h">Executive summary</h2>
<p class="lede" id="exec-summary-text">${esc(verdictFor(report))} Search SEO ${esc(sText)} · AI Visibility ${esc(aText)}. ${total === 0 ? "No actionable issues." : refused ? "No pages were audited — robots.txt disallows this path." : `${total} actionable issue${total === 1 ? "" : "s"} — fix P0 today, P1 this week, P2 this month.`}</p>
<p class="no-print"><button type="button" class="chip" id="copy-summary">${ICONS.copy}<span class="btn-label">Copy summary</span></button></p></section>

<section id="first" aria-labelledby="first-h"><h2 id="first-h">Fix this first</h2>
<p class="lede">Highest impact per unit of effort, ranked by severity.</p>${fixFirst}</section>

<section id="actions" aria-labelledby="actions-h"><h2 id="actions-h"><span>All findings</span><span class="n">${total}</span></h2>
<p class="lede">Use the search box, category selector, and severity chips above to narrow this down. Every card has a one-click copy of its fix.</p>
${groups.length === 0 ? `<p class="none-msg">No issues found. Nice.</p>` : groupsHtml}
<p class="none-msg" id="no-matches" hidden>No findings match your current filter query. Try clearing the search or switching severity.</p>
</section>

${seoDetailsHtml}

<section id="citable" aria-labelledby="citable-h"><h2 id="citable-h"><span>Make this page more citable</span><span class="n">${done}/${checklist.length}</span></h2>
<p class="lede">AI Visibility readiness signals for generative search engines (ChatGPT Search, Claude, Perplexity, Google AI Overviews).</p>
<div class="progress" role="img" aria-label="${done} of ${checklist.length} citability signals present"><i style="width:${checklist.length ? ((done / checklist.length) * 100).toFixed(0) : 0}%"></i></div>
${checklistHtml}</section>

${psiHtml}

${remediationHtml}

<section id="passed" aria-labelledby="passed-h"><h2 id="passed-h"><span>What passed</span><span class="n">${passed.length}</span></h2>${passedHtml}</section>

<section id="monitor" aria-labelledby="monitor-h"><h2 id="monitor-h"><span>What to monitor</span><span class="n">${monitor.length}</span></h2>${monitorHtml}</section>

<footer class="foot"><span>Generated by one-step-seo v${esc(report.version)} (rules ${esc(rulesVer)}) &mdash; two scores, never blended. <a href="${esc(CHECKS_DOC_URL)}">Checks reference ${ICONS.ext}</a></span><span>${esc(report.url)}</span></footer>
</main></div>

<script>
(function(){
  var q=document.getElementById('q');
  var catSel=document.getElementById('cat-filter');
  var chips=[].slice.call(document.querySelectorAll('.chip[data-sev]'));
  var out=document.getElementById('count');
  var findings=[].slice.call(document.querySelectorAll('.finding'));
  var groups=[].slice.call(document.querySelectorAll('.group'));
  var sev='all';
  var cat='all';
  function apply(){
    var term=(q&&q.value||'').toLowerCase().trim();
    var shown=0;
    findings.forEach(function(el){
      var okSev=sev==='all'||el.getAttribute('data-sev')===sev;
      var okCat=cat==='all'||el.getAttribute('data-cat')===cat;
      var hay=el.getAttribute('data-search')||'';
      var vis=okSev&&okCat&&(!term||hay.indexOf(term)!==-1);
      el.hidden=!vis; if(vis) shown++;
    });
    groups.forEach(function(g){
      var any=false;
      [].forEach.call(g.querySelectorAll('.finding'),function(el){ if(!el.hidden) any=true; });
      g.hidden=!any;
    });
    var nm=document.getElementById('no-matches');
    if(nm) nm.hidden=shown>0||findings.length===0;
    if(out) out.textContent=shown+' of '+findings.length+' finding'+(findings.length===1?'':'s');
  }
  if(q) q.addEventListener('input',apply);
  if(catSel) catSel.addEventListener('change',function(){
    cat=catSel.value||'all';
    apply();
  });
  chips.forEach(function(c){ c.addEventListener('click',function(){
    sev=c.getAttribute('data-sev');
    chips.forEach(function(o){ o.setAttribute('aria-pressed', o===c?'true':'false'); });
    apply();
  });});
  var execBtn=document.getElementById('exec-mode-btn');
  if(execBtn) execBtn.addEventListener('click',function(){
    var on=document.body.classList.toggle('exec-mode');
    execBtn.setAttribute('aria-pressed',on?'true':'false');
  });
  var tt=document.getElementById('theme-toggle');
  var metaCs=document.querySelector('meta[name="color-scheme"]');
  var modes=['auto','dark','light'];
  var mIdx=0;
  function setTheme(m){
    if(m==='auto'){
      document.documentElement.removeAttribute('data-theme');
      if(metaCs) metaCs.setAttribute('content','light dark');
      try{localStorage.removeItem('oss-theme');}catch(e){}
      if(tt) tt.textContent='Theme: Auto';
    }else{
      document.documentElement.setAttribute('data-theme',m);
      if(metaCs) metaCs.setAttribute('content',m);
      try{localStorage.setItem('oss-theme',m);}catch(e){}
      if(tt) tt.textContent='Theme: '+(m==='dark'?'Dark':'Light');
    }
  }
  try{
    var saved=localStorage.getItem('oss-theme');
    if(saved==='dark'||saved==='light'){ mIdx=modes.indexOf(saved); setTheme(saved); }
  }catch(e){}
  if(tt) tt.addEventListener('click',function(){
    mIdx=(mIdx+1)%modes.length;
    setTheme(modes[mIdx]);
  });
  if(globalThis.addEventListener){
    globalThis.addEventListener('storage',function(ev){
      if(ev&&ev.key==='oss-theme'){
        var nv=ev.newValue==='dark'||ev.newValue==='light'?ev.newValue:'auto';
        mIdx=modes.indexOf(nv);
        setTheme(nv);
      }
    });
  }
  document.addEventListener('keydown',function(e){
    if(e.key==='/'&&document.activeElement!==q&&!['input','textarea','select'].includes((document.activeElement&&document.activeElement.tagName||'').toLowerCase())){
      e.preventDefault();
      if(q){q.focus();q.select();}
    }
    if(e.key==='Escape'&&document.activeElement===q){
      if(q){q.value='';apply();q.blur();}
    }
  });
  function copy(text,ok,fail){
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(ok,fail);
    }else{
      var ta=document.createElement('textarea');ta.value=text;
      document.body.appendChild(ta);ta.select();
      try{document.execCommand('copy');ok();}catch(e){fail();}
      document.body.removeChild(ta);
    }
  }
  [].forEach.call(document.querySelectorAll('.copy-fix'),function(btn){
    btn.addEventListener('click',function(){
      var text=btn.getAttribute('data-copy')||'';
      var note=btn.parentNode.querySelector('.copied');
      var done=function(good){
        if(note) note.textContent=good?'Copied ✓':'Copy failed';
        setTimeout(function(){ if(note) note.textContent=''; },2000);
      };
      copy.call(btn,text,function(){done(true);},function(){done(false);});
    });
  });
  var cs=document.getElementById('copy-summary');
  if(cs) cs.addEventListener('click',function(){
    var t=document.getElementById('exec-summary-text');
    var s=(t&&(t.innerText||t.textContent))||'';
    var lbl=cs.querySelector('.btn-label')||cs;
    var done=function(good){
      lbl.textContent=good?'Copied ✓':'Copy failed';
      setTimeout(function(){ lbl.textContent='Copy summary'; },2000);
    };
    copy.call(cs,s,function(){done(true);},function(){done(false);});
  });
})();
</script>
</body>
</html>
`;
}

/** SARIF level per severity (pass findings are omitted). @type {Record<string, string>} */
const SARIF_LEVEL = { P0: "error", P1: "error", P2: "warning", P3: "note" };

/**
 * Format a URL or local file path into a valid SARIF artifact URI reference.
 * Ensures the output is a parseable RFC 3986 URI (http, https, file).
 * @param {unknown} [rawUrl]
 * @returns {string}
 */
export function safeSarifUri(rawUrl) {
  const s = String(rawUrl || "").trim();
  if (!s) return "file:///unknown";
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "file:") {
      return u.href;
    }
  } catch {
    // not a valid URL
  }
  try {
    return pathToFileURL(s).href;
  } catch {
    return "file:///unknown";
  }
}

/**
 * SARIF v2.1.0 output for GitHub code scanning and other machine
 * consumers. One rule per distinct finding ID, one result per actionable
 * finding; passed checks are omitted (SARIF reports problems, not health).
 * @param {Report} report
 * @returns {object}
 */
export function renderSarif(report) {
  const actionable = (report.findings ?? []).filter((f) => f && f.severity !== "pass");
  /** @type {Map<string, string>} */
  const rules = new Map();
  for (const f of actionable) {
    if (!rules.has(f.id)) {
      const meta = getFindingMeta(String(f.id ?? ""));
      rules.set(f.id, meta.plain);
    }
  }
  const artifactUri = safeSarifUri(report.finalUrl || report.url);
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "one-step-seo",
            version: String(report.version ?? ""),
            informationUri: "https://github.com/6t9xstar/one-step-seo",
            rules: [...rules.entries()].map(([id, plain]) => ({
              id,
              shortDescription: { text: plain.slice(0, 300) || id },
              helpUri: CHECKS_DOC_URL,
            })),
          },
        },
        results: actionable.map((f) => ({
          ruleId: f.id,
          level: SARIF_LEVEL[f.severity] ?? "note",
          message: {
            text: `${f.title} — ${f.evidence}${f.fix ? ` Fix: ${f.fix}` : ""}`.slice(0, 2000),
          },
          locations: [{ physicalLocation: { artifactLocation: { uri: artifactUri } } }],
        })),
      },
    ],
  };
}

/**
 * Escape a field for CSV (RFC 4180 compliant) with spreadsheet formula-injection protection (CWE-1236).
 * Neutralizes formula triggers (equals, plus, minus, at-sign, tab, CR, pipe) to prevent code execution in spreadsheet applications.
 * @param {unknown} val
 * @returns {string}
 */
export function escCsv(val) {
  let str = String(val ?? "");
  // Defend against formula injection: if the field starts with =, +, -, at-sign, tab, CR, or pipe,
  // or contains leading whitespace followed by one of those characters, prefix with single quote.
  const trimmedLeading = str.replace(/^[\s\uFEFF\xA0]+/, "");
  if (/^[=+\-@\t\r|]/.test(trimmedLeading) || /^[=+\-@\t\r|]/.test(str)) {
    str = `'${str}`;
  }
  // Sanitize CR and LF to spaces to keep single row per finding in spreadsheets
  str = str.replace(/[\r\n]+/g, " ");
  if (str.includes(",") || str.includes('"') || str.includes("'") || str.includes("\t")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Render a report's findings as RFC 4180 CSV for automated pipelines and spreadsheets.
 * @param {Report | { findings?: Finding[] }} report
 * @returns {string}
 */
export function renderCsv(report) {
  const headers = [
    "Severity",
    "Check ID",
    "Category",
    "Title",
    "Evidence",
    "Fix",
    "SEO Impact",
    "GEO Impact",
  ];
  const rows = [headers.join(",")];
  for (const f of report.findings ?? []) {
    rows.push(
      [
        escCsv(f.severity),
        escCsv(f.id),
        escCsv(f.category),
        escCsv(f.title),
        escCsv(f.evidence),
        escCsv(f.fix),
        escCsv(f.seoImpact),
        escCsv(f.geoImpact),
      ].join(","),
    );
  }
  return rows.join("\n") + "\n";
}
