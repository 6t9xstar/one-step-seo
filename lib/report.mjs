/**
 * one-step-seo — report builders (JSON / Markdown / single-file HTML / Site Dashboard / SARIF / CSV).
 * HTML is 100% dependency-free with inline CSS, zero external network requests,
 * dark/light/system themes, executive mode, and client-side filtering/sorting.
 */
import { pathToFileURL } from "node:url";
import { getFindingMeta } from "./finding-meta.mjs";
import { scoreBand, RULES_VERSION } from "./score.mjs";

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
 * @param {{ url: string, finalUrl: string, scores: Report["scores"], findings: Finding[], parsed: any, siteFiles: any, meta: { version: string }, truncated?: boolean, checkedAt?: string, psi?: any }} input
 * @returns {Report}
 */
export function buildReport({
  url,
  finalUrl,
  scores,
  findings,
  parsed,
  siteFiles,
  meta,
  truncated = false,
  checkedAt,
  psi = null,
}) {
  const sorted = [...findings].sort(priorityOrder);
  /** @type {Record<string, number>} */
  const counts = { P0: 0, P1: 0, P2: 0, P3: 0, pass: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  // Defensive normalization: buildReport is exported and called with partial
  // objects (tests, future commands). A missing `h1s` used to throw a TypeError
  // *after* a successful fetch, discarding the whole report.
  /** @type {any} */
  const p = parsed && typeof parsed === "object" ? parsed : {};
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
    version: meta.version,
    rulesVersion: RULES_VERSION,
    url,
    finalUrl,
    checkedAt: stampedAt,
    truncated: !!truncated,
    scores,
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
const SEV_HUE = { P0: 0, P1: 25, P2: 45, P3: 210, pass: 150 };

/** Band -> hue for the score gauges. @type {Record<string, number>} */
const BAND_HUE = { A: 145, B: 95, C: 45, D: 25, E: 15, F: 0, "N/A": 215 };

/**
 * Check whether a raw score value is a finite 0-100 number.
 * @param {unknown} v
 * @returns {v is number}
 */
function isValidScore(v) {
  return typeof v === "number" && Number.isFinite(v);
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
  const strokeColor = isAi ? "var(--accent-alt)" : "var(--accent)";
  const circumference = 2 * Math.PI * 34;
  const pct = valid ? Math.max(0, Math.min(100, score)) : 0;
  const dash = (pct / 100) * circumference;
  const scoreDisplay = valid ? String(score) : "N/A";
  const srText = valid
    ? `${label}: ${scoreDisplay} out of 100, band ${safeBand}.`
    : `${label}: Not available (N/A).`;
  return `<div class="gauge ${isAi ? "gauge-ai" : "gauge-search"}"><svg viewBox="0 0 80 80" width="84" height="84" aria-hidden="true" focusable="false">
<circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" stroke-width="6.5" opacity=".12"/>
<circle class="gauge-fill" cx="40" cy="40" r="34" fill="none" stroke="${strokeColor}" stroke-width="6.5"
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
  return `<article class="finding" data-sev="${esc(sev)}" data-cat="${esc(cat)}" data-search="${esc(hay)}">
<header class="finding-head"><span class="badge" style="--hue:${hue}">${esc(sev)}</span>
<span class="finding-cat">${esc(cat)}</span>
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
<footer class="finding-foot"><button type="button" class="copy-fix no-print" data-copy="${esc(String(f.fix ?? ""))}">Copy fix</button><span class="copied" role="status" aria-live="polite"></span></footer>
</article>`;
}

/** Severity rank for ordering (lower is more urgent). @type {Record<string, number>} */
export const SEV_RANK = { P0: 0, P1: 1, P2: 2, P3: 3, pass: 4 };

/**
 * Shared design-system stylesheet for report.html and index.html.
 * Supports automatic OS color-scheme, manual theme toggle via <meta name="color-scheme">,
 * Executive Mode toggle, responsive container queries, and print/PDF styling.
 * @returns {string}
 */
function siteCss() {
  return `
:root{
  --bg:#f8fafc;
  --fg:#0f172a;
  --muted:#475569;
  --card:#ffffff;
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
  --success:#059669;
  --success-border:rgba(5,150,105,.28);
  --shadow-sm:0 1px 3px rgba(15,23,42,.05),0 1px 2px rgba(15,23,42,.03);
  --shadow-md:0 6px 16px -3px rgba(15,23,42,.08),0 2px 6px -2px rgba(15,23,42,.04);
  --shadow-lg:0 14px 30px -4px rgba(15,23,42,.12);
  --radius-sm:6px;
  --radius-md:10px;
  --radius-lg:16px;
  --radius-full:9999px;
  --scrollbar-thumb:#94a3b8;
  --scrollbar-track:#f1f5f9;
  color-scheme:light dark;
  scrollbar-color:var(--scrollbar-thumb) var(--scrollbar-track);
}
:root:has(> head > meta[name="color-scheme"][content="light"]){color-scheme:light}
:root:has(> head > meta[name="color-scheme"][content="dark"]){color-scheme:dark}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:#090d16;
    --fg:#f8fafc;
    --muted:#94a3b8;
    --card:#111726;
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
    --success:#10b981;
    --success-border:rgba(16,185,129,.35);
    --shadow-sm:0 1px 3px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.04);
    --shadow-md:0 6px 18px -2px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.04);
    --shadow-lg:0 16px 32px -4px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.06);
    --scrollbar-thumb:#475569;
    --scrollbar-track:#0f172a;
  }
}
:root[data-theme="dark"]{
  --bg:#090d16;
  --fg:#f8fafc;
  --muted:#94a3b8;
  --card:#111726;
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
  --success:#10b981;
  --success-border:rgba(16,185,129,.35);
  --shadow-sm:0 1px 3px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.04);
  --shadow-md:0 6px 18px -2px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.04);
  --shadow-lg:0 16px 32px -4px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.06);
  --scrollbar-thumb:#475569;
  --scrollbar-track:#0f172a;
}
@supports (color:light-dark(white,black)){
  :root{
    --bg:light-dark(#f8fafc,#090d16);
    --fg:light-dark(#0f172a,#f8fafc);
    --muted:light-dark(#475569,#94a3b8);
    --card:light-dark(#ffffff,#111726);
    --line:light-dark(#e2e8f0,#1e293b);
    --line-subtle:light-dark(#f1f5f9,#151d2e);
    --code:light-dark(#f1f5f9,#172033);
    --code-fg:light-dark(#0f172a,#e2e8f0);
  }
}
@supports not (scrollbar-color:auto){
  ::-webkit-scrollbar{width:10px;height:10px}
  ::-webkit-scrollbar-track{background:var(--scrollbar-track)}
  ::-webkit-scrollbar-thumb{background:var(--scrollbar-thumb);border-radius:5px}
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:76px}
body{margin:0;background:var(--bg);color:var(--fg);line-height:1.55;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
body.exec-mode .tech-detail{display:none!important}
.wrap{max-width:1200px;margin:0 auto;padding:0 20px 64px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;left:-9999px;top:0;z-index:100;background:var(--accent);color:var(--accent-fg);padding:10px 18px;font-weight:700;border-radius:0 0 8px 0;text-decoration:none}
.skip:focus{left:0;top:0}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em;background:var(--code);color:var(--code-fg);padding:2px 6px;border-radius:var(--radius-sm)}
pre{background:var(--code);color:var(--code-fg);padding:14px;border-radius:var(--radius-md);overflow-x:auto;white-space:pre-wrap;word-break:break-word;margin:10px 0 0;font-size:12.5px;border:1px solid var(--line)}
pre code{background:none;padding:0}
.empty{color:var(--muted);font-style:italic}

.masthead{position:sticky;top:0;z-index:50;background:rgba(248,250,252,.88);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid var(--line);transition:border-color .15s}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .masthead{background:rgba(9,13,22,.88)}}
:root[data-theme="dark"] .masthead{background:rgba(9,13,22,.88)}
.masthead-in{max-width:1200px;margin:0 auto;padding:10px 20px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.brand{font-weight:800;font-size:15px;letter-spacing:-.02em;white-space:nowrap;display:flex;align-items:center;gap:9px}
.brand-logo{flex:none}
.brand span{font-size:11px;font-weight:750;text-transform:uppercase;letter-spacing:.05em;color:var(--accent);background:var(--accent-subtle);border:1px solid var(--accent-border);padding:2.5px 8px;border-radius:var(--radius-full)}
.toolbar{display:flex;gap:8px;align-items:center;flex:1;flex-wrap:wrap;min-width:0}
.search{flex:1;min-width:190px;position:relative;display:flex;align-items:center}
.search input{width:100%;font:inherit;font-size:13.5px;padding:7px 36px 7px 32px;border-radius:var(--radius-md);border:1px solid var(--line);background:var(--bg);color:var(--fg);transition:border-color .15s ease,box-shadow .15s ease}
.search input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-subtle);background:var(--card)}
.search svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);opacity:.5;pointer-events:none;transition:opacity .15s,color .15s}
.search input:focus ~ svg,.search:focus-within svg{opacity:1;color:var(--accent)}
.kbd-hint{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;font-weight:700;padding:1.5px 6px;border-radius:4px;background:var(--card);border:1px solid var(--line);color:var(--muted);pointer-events:none}
.cat-select{font:inherit;font-size:12px;font-weight:700;padding:6px 10px;border-radius:var(--radius-md);border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
.cat-select:hover{border-color:var(--accent)}
.chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.chip{font:inherit;font-size:12px;font-weight:700;padding:6px 11px;border-radius:var(--radius-full);border:1px solid var(--line);background:var(--card);color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:border-color .15s ease,background-color .15s ease,color .15s ease}
.chip:hover{border-color:var(--accent);color:var(--fg);background:var(--bg)}
.chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--accent-fg);box-shadow:0 2px 8px var(--accent-glow)}
.chip .n{font-size:11px;font-weight:600;opacity:.85;padding:1px 6px;border-radius:var(--radius-full);background:rgba(0,0,0,.15)}
.chip[aria-pressed="false"] .n{background:var(--code);color:var(--fg)}
.print-btn,.mode-btn{font-size:11.5px;padding:5px 11px;color:var(--muted)}
.print-btn:hover,.mode-btn:hover{color:var(--fg);border-color:var(--accent)}
.result-count{font-size:12px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:600}

.hero{padding:28px 0 6px}
.hero-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:8px}
h1{font-size:26px;font-weight:850;margin:0;letter-spacing:-.025em}
.status-pill{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:4px 12px;border-radius:var(--radius-full);border:1px solid hsl(var(--hue) 65% 78%);background:hsl(var(--hue) 70% 93%);color:hsl(var(--hue) 70% 26%)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .status-pill{color:hsl(var(--hue) 78% 84%);background:hsl(var(--hue) 45% 18%);border-color:hsl(var(--hue) 50% 32%)}}
:root[data-theme="dark"] .status-pill{color:hsl(var(--hue) 78% 84%);background:hsl(var(--hue) 45% 18%);border-color:hsl(var(--hue) 50% 32%)}
.url{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:var(--muted);word-break:break-all;margin:0;line-height:1.55}
.scores{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin:22px 0}
.panel{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-lg);padding:20px 22px;box-shadow:var(--shadow-sm);transition:box-shadow .18s cubic-bezier(.16,1,.3,1),border-color .18s ease}
.panel:hover{box-shadow:var(--shadow-md)}
.gauge-panel{display:flex;gap:18px;align-items:center}
.gauge-panel.search-engine{border-top:3px solid var(--accent)}
.gauge-panel.ai-engine{border-top:3px solid var(--accent-alt)}
.gauge{position:relative;flex:none;color:var(--muted)}
.gauge svg{display:block}
.gauge-text{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;gap:3px}
.gauge-score{font-size:25px;font-weight:850;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.gauge-band{font-size:11px;font-weight:800;letter-spacing:.05em;padding:1.5px 7px;border-radius:var(--radius-full);color:hsl(var(--hue) 65% 32%);background:hsl(var(--hue) 70% 92%)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .gauge-band{color:hsl(var(--hue) 75% 82%);background:hsl(var(--hue) 45% 20%)}}
:root[data-theme="dark"] .gauge-band{color:hsl(var(--hue) 75% 82%);background:hsl(var(--hue) 45% 20%)}
.axis{font-weight:750;font-size:15px;letter-spacing:-.01em}
.axis-sub{font-size:12px;color:var(--muted);margin-top:4px;line-height:1.45}
.dist-title{font-weight:750;font-size:14.5px;margin-bottom:12px;letter-spacing:-.01em}
.dist-stacked{display:flex;height:8px;border-radius:var(--radius-full);overflow:hidden;background:var(--code);margin-bottom:12px;gap:2px}
.dist-seg{display:block;height:100%;background:hsl(var(--hue) 70% 48%);border-radius:var(--radius-full);transition:width .3s ease}
.dist-row{display:grid;grid-template-columns:36px 1fr 32px;gap:10px;align-items:center;margin:6px 0;font-size:12px}
.dist-label{font-weight:750;color:var(--muted)}
.dist-track{height:8px;border-radius:var(--radius-full);background:var(--code);overflow:hidden}
.dist-fill{display:block;height:100%;border-radius:var(--radius-full);background:hsl(var(--hue) 70% 48%)}
.dist-count{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;color:var(--fg)}

.toc{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0 8px;padding:0;list-style:none}
.toc a{font-size:12.5px;font-weight:700;text-decoration:none;color:var(--muted);padding:6px 13px;border:1px solid var(--line);border-radius:var(--radius-full);background:var(--card);transition:all .15s ease}
.toc a:hover{color:var(--fg);border-color:var(--accent);background:var(--accent-subtle)}

section{margin:34px 0;scroll-margin-top:80px}
h2{font-size:19px;font-weight:800;margin:0 0 14px;letter-spacing:-.015em;padding-bottom:10px;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:baseline;justify-content:space-between}
h2 .n{font-size:12.5px;color:var(--muted);font-weight:650;font-variant-numeric:tabular-nums}
.lede{color:var(--muted);margin:0 0 16px;font-size:14px;line-height:1.5}

.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
.detail-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-lg);padding:16px 18px;box-shadow:var(--shadow-sm)}
.detail-card h3{margin:0 0 10px;font-size:13.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.kv-list{margin:0;padding:0;display:grid;gap:8px;font-size:13px}
.kv-row{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dashed var(--line-subtle);padding-bottom:6px}
.kv-row:last-child{border-bottom:none;padding-bottom:0}
.kv-row dt{color:var(--muted);font-weight:600}
.kv-row dd{margin:0;font-weight:700;text-align:right;word-break:break-word}

.topfix{list-style:none;margin:0;padding:0;display:grid;gap:12px;counter-reset:tf}
.topfix li{counter-increment:tf;position:relative;background:var(--card);border:1px solid var(--line);border-left:4px solid hsl(var(--hue) 68% 46%);border-radius:var(--radius-md);padding:16px 18px 16px 56px;box-shadow:var(--shadow-sm);transition:border-color .15s ease,transform .15s ease,box-shadow .15s ease}
.topfix li:hover{border-color:var(--accent);transform:translateX(3px);box-shadow:var(--shadow-md)}
.topfix li::before{content:counter(tf);position:absolute;left:18px;top:16px;width:26px;height:26px;border-radius:var(--radius-full);background:var(--accent);color:var(--accent-fg);font-size:12.5px;font-weight:800;display:grid;place-items:center;box-shadow:0 2px 6px var(--accent-glow)}
.topfix-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px}
.topfix-main{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.topfix-stat{display:inline-flex;align-items:center;gap:10px;font-size:12px;color:var(--muted);font-weight:600}
.topfix-count{white-space:nowrap;font-variant-numeric:tabular-nums}
.topfix li .finding-plain{margin:0;font-size:13px;color:var(--muted);line-height:1.5}

.badge{display:inline-flex;align-items:center;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:var(--radius-sm);color:hsl(var(--hue) 68% 27%);background:hsl(var(--hue) 70% 92%);vertical-align:1px;white-space:nowrap;border:1px solid hsl(var(--hue) 65% 82%)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .badge{color:hsl(var(--hue) 78% 82%);background:hsl(var(--hue) 45% 20%);border-color:hsl(var(--hue) 50% 30%)}}
:root[data-theme="dark"] .badge{color:hsl(var(--hue) 78% 82%);background:hsl(var(--hue) 45% 20%);border-color:hsl(var(--hue) 50% 30%)}

.group h3{display:flex;align-items:center;gap:9px;font-size:15px;margin:26px 0 14px;color:var(--fg);font-weight:750;letter-spacing:-.01em}
.group-count{font-size:11px;font-weight:700;padding:2px 8px;border-radius:var(--radius-full);background:var(--code);color:var(--muted)}
.cards{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(340px,1fr))}
.finding{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-lg);padding:18px 20px;display:flex;flex-direction:column;gap:12px;box-shadow:var(--shadow-sm);transition:border-color .18s ease,transform .18s cubic-bezier(.16,1,.3,1),box-shadow .18s cubic-bezier(.16,1,.3,1)}
.finding:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:var(--shadow-md)}
.finding[hidden]{display:none}
.finding-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.finding-head h4{font-size:14.5px;font-weight:750;margin:0;flex:1;min-width:200px;line-height:1.4;letter-spacing:-.015em}
.finding-cat{display:inline-flex;align-items:center;font-size:10px;font-weight:750;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:2px 7px;background:var(--code);border-radius:var(--radius-sm);border:1px solid var(--line-subtle)}
.finding-plain{margin:0;font-size:13px;color:var(--muted);line-height:1.5}
.finding-meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:0;padding:10px 12px;background:var(--code);border:1px solid var(--line-subtle);border-radius:var(--radius-md);font-size:11.5px}
.finding-meta dt{font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:750}
.finding-meta dd{margin:2px 0 0;font-weight:750;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.finding-meta code{font-size:11px;padding:0;background:none}
.finding-row{margin:0;font-size:13px;line-height:1.5}
.finding-row strong{display:block;font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:3px}
.finding-row span{word-break:break-word}
.finding-foot{display:flex;align-items:center;gap:10px;margin-top:auto;padding-top:10px;border-top:1px solid var(--line)}
button.copy-fix{font:inherit;font-size:12px;font-weight:700;padding:6px 14px;border-radius:var(--radius-md);border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .15s ease}
button.copy-fix:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-subtle);box-shadow:0 0 0 2px var(--accent-subtle)}
.copied{font-size:12px;color:var(--success);font-weight:750;display:inline-flex;align-items:center;gap:4px}
details.snippet summary{cursor:pointer;font-size:12px;font-weight:700;color:var(--accent)}
summary::marker{color:var(--muted)}
.none-msg{grid-column:1/-1;color:var(--muted);font-style:italic;padding:24px;text-align:center;background:var(--card);border:1px dashed var(--line);border-radius:var(--radius-lg)}

#summary{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:var(--radius-lg);padding:22px 24px;box-shadow:var(--shadow-sm)}
#summary h2{border-bottom:none;padding-bottom:0;margin-bottom:10px}
#summary .lede{margin-bottom:16px;font-size:14.5px}
#copy-summary{font:inherit;font-size:12.5px;font-weight:700;padding:7px 16px;border-radius:var(--radius-full);border:1px solid var(--accent-border);background:var(--accent-subtle);color:var(--accent);cursor:pointer;transition:all .15s ease;display:inline-flex;align-items:center;gap:6px}
#copy-summary:hover{background:var(--accent);color:var(--accent-fg);border-color:var(--accent);box-shadow:0 2px 10px var(--accent-glow)}

.checklist{list-style:none;margin:0 0 18px;padding:0;display:grid;gap:9px}
.checklist li{display:flex;gap:12px;align-items:center;font-size:13.5px;padding:10px 15px;background:var(--card);border:1px solid var(--line);border-radius:var(--radius-md);box-shadow:var(--shadow-sm);transition:border-color .15s ease}
.checklist .box{font-weight:800;flex:none;width:1.2em;text-align:center}
.checklist li[data-checked="yes"]{border-color:var(--success-border)}
.checklist li[data-checked="yes"] .box{color:var(--success)}
.checklist li[data-checked="no"]{border-style:dashed}
.checklist li[data-checked="no"] .box{color:var(--muted)}
.progress{height:9px;border-radius:var(--radius-full);background:var(--code);overflow:hidden;margin:0 0 18px;max-width:440px}
.progress i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent-alt));border-radius:var(--radius-full);transition:width .4s ease}

.cwv-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-lg);padding:18px 20px;box-shadow:var(--shadow-sm);margin-bottom:14px}
.cwv-card h4{margin:0 0 12px;font-size:15px;font-weight:750;letter-spacing:-.015em}
.cmd-box{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--code);border:1px solid var(--line);border-radius:var(--radius-md);padding:10px 14px;margin:8px 0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;overflow-x:auto}

details.passed summary{cursor:pointer;font-weight:700;font-size:13.5px;padding:12px 16px;background:var(--card);border:1px solid var(--line);border-radius:var(--radius-md);box-shadow:var(--shadow-sm)}
details.passed ul{margin:12px 0 0;padding-left:24px;font-size:12.5px;columns:2;column-gap:30px}
details.passed li{break-inside:avoid;margin:3.5px 0}

.warn{border:1px solid #d97706;background:rgba(217,119,6,.1);border-radius:var(--radius-md);padding:12px 16px;font-size:13px}
footer.foot{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
footer.foot a{color:var(--accent);text-decoration:none;font-weight:600}
footer.foot a:hover{text-decoration:underline}

@media (max-width:760px){
  .cards,.detail-grid{grid-template-columns:1fr}
  details.passed ul{columns:1}
  .wrap,.masthead-in{padding-left:14px;padding-right:14px}
  .gauge-panel{flex-direction:column;text-align:center;gap:14px}
  .finding-meta{grid-template-columns:repeat(2,1fr)}
  .toolbar{gap:8px}
  .search{min-width:100%}
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

.crumbs{font-size:13px;margin:0 0 16px}
.crumbs a{color:var(--accent);text-decoration:none;font-weight:700;display:inline-flex;align-items:center;gap:4px}
.crumbs a:hover{text-decoration:underline}
@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  .finding,.panel,.topfix li{transition:none}
}
`;
}

/** Extra rules only the site dashboard needs (responsive pages table, reach bars, sort controls). */
const DASHBOARD_CSS = `.table-scroll{container-type:inline-size;overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--card);box-shadow:var(--shadow-sm)}
table.pages{border-collapse:collapse;width:100%;font-size:13.5px;min-width:720px}
table.pages caption{caption-side:bottom;padding:10px 16px;font-size:12px;color:var(--muted);text-align:left}
table.pages th,table.pages td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--line);vertical-align:middle}
table.pages thead th{position:sticky;inset-block-start:0;z-index:1;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);background:var(--code);white-space:nowrap;cursor:pointer;user-select:none}
table.pages thead th:hover{color:var(--fg)}
table.pages tbody tr:last-child td{border-bottom:none}
table.pages tbody tr:hover{background:var(--accent-subtle)}
table.pages tbody tr[hidden]{display:none}
td.num{font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:700}
td.p-url{word-break:break-all;font-weight:650}
td.p-url a{color:var(--accent);text-decoration:none}
td.p-url a:hover{text-decoration:underline}
.topfix-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px}
.topfix-main{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.topfix-stat{display:inline-flex;align-items:center;gap:10px;font-size:12px;color:var(--muted);font-weight:600}
.topfix-count{white-space:nowrap;font-variant-numeric:tabular-nums}
.reach{display:inline-block;vertical-align:middle;width:100px;height:6px;border-radius:var(--radius-full);background:var(--code);overflow:hidden;flex-shrink:0}
.reach i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent-alt));border-radius:var(--radius-full);transition:width .3s ease}
.topfix li .finding-plain{margin:0;font-size:13px;color:var(--muted);line-height:1.5}
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
    if (typeof rawS === "number" && Number.isFinite(rawS)) {
      searchSum += rawS;
      searchValid++;
      searchMin = Math.min(searchMin, rawS);
      searchMax = Math.max(searchMax, rawS);
    }
    const rawA = r?.scores?.ai?.score;
    if (typeof rawA === "number" && Number.isFinite(rawA)) {
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

  const validOrdered = ordered.filter((e) => e.s.valid || e.a.valid);
  const worstEntry = validOrdered[0];
  const bestEntry = validOrdered.length > 0 ? validOrdered[validOrdered.length - 1] : undefined;
  /** @param {{ valid: boolean, score: number | null, band: string }} ax */
  const fmtCardScore = (ax) => (ax.valid ? `${ax.score}/100 (${esc(ax.band)})` : "N/A");
  const rankCardsHtml =
    worstEntry && bestEntry
      ? `<div class="detail-card"><h3>Lowest-Performing Page</h3><dl class="kv-list">
<div class="kv-row"><dt>URL</dt><dd><a href="./${esc(siteBasename(worstEntry.i))}.html#main">${esc(worstEntry.r.finalUrl)}</a></dd></div>
<div class="kv-row"><dt>Search SEO</dt><dd>${fmtCardScore(worstEntry.s)}</dd></div>
<div class="kv-row"><dt>AI Visibility</dt><dd>${fmtCardScore(worstEntry.a)}</dd></div>
</dl></div>
<div class="detail-card"><h3>Highest-Performing Page</h3><dl class="kv-list">
<div class="kv-row"><dt>URL</dt><dd><a href="./${esc(siteBasename(bestEntry.i))}.html#main">${esc(bestEntry.r.finalUrl)}</a></dd></div>
<div class="kv-row"><dt>Search SEO</dt><dd>${fmtCardScore(bestEntry.s)}</dd></div>
<div class="kv-row"><dt>AI Visibility</dt><dd>${fmtCardScore(bestEntry.a)}</dd></div>
</dl></div>`
      : `<div class="detail-card"><h3>Lowest-Performing Page</h3><p class="empty">N/A — no valid page scores available.</p></div>
<div class="detail-card"><h3>Highest-Performing Page</h3><p class="empty">N/A — no valid page scores available.</p></div>`;
  const highlightsHtml =
    n > 0
      ? `<div class="detail-grid" style="margin:18px 0">
${rankCardsHtml}
<div class="detail-card"><h3>Crawl &amp; Aggregation Summary</h3><dl class="kv-list">
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
            return `<li style="--hue:${hue}"><div class="topfix-row"><div class="topfix-main"><span class="badge">${esc(f.severity)}</span> <strong>${esc(f.title)}</strong> <code>${esc(f.id)}</code></div><div class="topfix-stat"><span class="topfix-count">on ${hit}/${total} pages</span><span class="reach" role="img" aria-label="${hit} of ${total} pages affected"><i style="width:${pct}%"></i></span></div></div><p class="finding-plain">${esc(String(f.fix || meta.plain).slice(0, 160))}</p></li>`;
          })
          .join("\n")}\n</ol>`;

  const catMax = Math.max(1, ...Object.values(catTotals));
  const catDistHtml = `<div class="panel">${CATEGORY_ORDER.map((ck) => {
    const cnt = Number(catTotals[ck] ?? 0);
    const label = CATEGORY_LABELS[ck] ?? ck;
    return `<div class="dist-row" style="grid-template-columns:120px 1fr 40px"><span class="dist-label">${esc(label)}</span><span class="dist-track"><span class="dist-fill" style="--hue:215;width:${((cnt / catMax) * 100).toFixed(1)}%"></span></span><span class="dist-count">${cnt}</span></div>`;
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
<title>one-step-seo site report — ${esc(origin)}</title>
<meta name="description" content="${esc(`Site audit of ${n} pages: avg Search ${avgSearchText}, avg AI ${avgAiText}.`)}">
<style>${siteCss()}
${DASHBOARD_CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to site report</a>
<div class="masthead no-print"><div class="masthead-in">
<div class="brand"><svg class="brand-logo" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="var(--accent)" opacity="0.35"/><path d="M12 3a9 9 0 0 1 9 9" stroke="var(--accent)"/><circle cx="12" cy="12" r="3.5" fill="var(--accent-alt)"/></svg>one-step-seo <span>site report</span></div>
<div class="toolbar">
<label class="search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg><input type="search" id="site-q" placeholder="Filter pages by URL or band…" autocomplete="off" aria-label="Filter pages by URL or band"><kbd class="kbd-hint">/</kbd></label>
<div class="chips" role="group" aria-label="Filter pages">
<button type="button" class="chip site-chip" data-filter="all" aria-pressed="true">All (${n})</button>
<button type="button" class="chip site-chip" data-filter="p0p1" aria-pressed="false">Has P0/P1</button>
<button type="button" class="chip mode-btn" id="theme-toggle" title="Switch color theme">Theme: Auto</button>
<button type="button" class="chip print-btn" onclick="window.print()" title="Print or save as PDF">Print</button>
</div>
</div>
</div></div>
<div class="wrap"><main id="main">
<header class="hero">
<h1>Site audit</h1>
<p class="url">${esc(origin)} · ${n} page${n === 1 ? "" : "s"}${checkedAt ? ` · Checked ${esc(checkedAt)}` : ""}${version ? ` · v${esc(version)}` : ""} · Rules ${esc(rulesVer)}</p>
<div class="scores">
<div class="panel gauge-panel search-engine">${gauge(avgSearch, avgSearchBand, "Average Search SEO")}
<div><div class="axis">Avg Search SEO</div><div class="axis-sub">Average ${avgSearchText} · lowest ${searchValid > 0 ? searchMin : "N/A"} · highest ${searchValid > 0 ? searchMax : "N/A"} (${searchValid}/${n} valid pages)</div></div></div>
<div class="panel gauge-panel ai-engine">${gauge(avgAi, avgAiBand, "Average AI Visibility")}
<div><div class="axis">Avg AI Visibility</div><div class="axis-sub">Average ${avgAiText} · lowest ${aiValid > 0 ? aiMin : "N/A"} · highest ${aiValid > 0 ? aiMax : "N/A"} (${aiValid}/${n} valid pages)</div></div></div>
<div class="panel"><div class="dist-title">Findings across all pages</div>${severityBars(totals)}</div>
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

<footer class="foot"><span>Generated by one-step-seo${version ? ` v${esc(version)}` : ""} (rules ${esc(rulesVer)}) — two scores, never blended. <a href="${esc(CHECKS_DOC_URL)}">Checks reference</a></span><span>${esc(origin)}</span></footer>
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
  var dir=1;
  function sortByHeader(th){
    var key=th.getAttribute('data-sort');
    var tbody=th.closest('table').querySelector('tbody');
    if(!tbody||!key) return;
    dir=-dir;
    ths.forEach(function(o){ o.setAttribute('aria-sort',o===th?(dir===1?'ascending':'descending'):'none'); });
    rows.sort(function(a,b){
      if(key==='url') return dir*(a.getAttribute('data-search')||'').localeCompare(b.getAttribute('data-search')||'');
      var rawA=a.getAttribute('data-'+key);
      var rawB=b.getAttribute('data-'+key);
      var hasA=rawA!==null&&rawA!=='';
      var hasB=rawB!==null&&rawB!=='';
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
      if(e.key==='Enter'||e.key===' '){ e.preventDefault(); sortByHeader(th); }
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
            return `<li style="--hue:${hue}"><div class="topfix-row"><div class="topfix-main"><span class="badge">${esc(f.severity)}</span> <strong>${esc(f.title)}</strong> <code>${esc(f.id)}</code></div><div class="topfix-stat">Impact: ${esc(meta.impact)} &middot; Effort: ${esc(meta.effort)} &middot; Owner: ${esc(meta.owner)}</div></div><p class="finding-plain">${esc(meta.plain)}</p></li>`;
          })
          .join("\n")}\n</ol>`;

  const groupsHtml = groups
    .map((g) => {
      const cards = g.items.map(findingCard).join("\n");
      return `<section class="group" id="cat-${esc(g.key)}" data-group-cat="${esc(g.key)}" aria-labelledby="h-${esc(g.key)}">
<h3 id="h-${esc(g.key)}">${esc(g.label)} <span class="group-count">${g.items.length}</span></h3>
<div class="cards">${cards}</div></section>`;
    })
    .join("\n");

  const checklistHtml =
    checklist.length === 0
      ? `<p class="empty">No citability signals were evaluated for this report.</p>`
      : `<ul class="checklist">\n${checklist
          .map(
            (c) =>
              `<li data-checked="${c.checked ? "yes" : "no"}"><span class="box" aria-hidden="true">${c.checked ? "✓" : "○"}</span><span>${esc(c.label)}</span></li>`,
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
              `<li><span class="badge" style="--hue:${SEV_HUE[String(f.severity)] ?? 45}">${esc(f.severity)}</span> ${esc(f.title)} <code>${esc(f.id)}</code> — ${esc(f.fix || f.evidence)}</li>`,
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
<h4>Chrome UX Report (CrUX Field)</h4>
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
<h4>Lab Performance Score: ${labScoreText}</h4>
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
<h4>Measure Live Core Web Vitals (LCP, INP, CLS)</h4>
<p class="finding-plain">Set <code>PSI_API_KEY</code> in your environment and pass <code>--psi</code> to include Google PageSpeed Insights Lab and CrUX 75th-percentile Field data:</p>
<div class="cmd-box"><code>PSI_API_KEY=your_key npx one-step-seo page ${esc(report.url)} --psi</code></div>
</div>
</section>`;
  }

  const seoDetailsHtml = `<section id="seo-details" aria-labelledby="seo-details-h"><h2 id="seo-details-h"><span>SEO Details &amp; Page Signals</span><span class="n">${Number(pg.wordCount ?? 0)} words</span></h2>
<div class="detail-grid">
<div class="detail-card"><h3>Metadata &amp; Canonical</h3><dl class="kv-list">
<div class="kv-row"><dt>Title (${titleText.length} chars)</dt><dd>${titleText ? escTruncate(titleText, 90) : '<span class="empty">Missing</span>'}</dd></div>
<div class="kv-row"><dt>Meta description (${metaText.length} chars)</dt><dd>${metaText ? escTruncate(metaText, 110) : '<span class="empty">Missing</span>'}</dd></div>
<div class="kv-row"><dt>Canonical URL</dt><dd>${pg.canonical ? `<code>${escTruncate(pg.canonical, 80)}</code>` : '<span class="empty">Not set</span>'}</dd></div>
</dl></div>
<div class="detail-card"><h3>Headings &amp; Content</h3><dl class="kv-list">
<div class="kv-row"><dt>H1 count (${h1List.length})</dt><dd>${h1List.length > 0 ? escTruncate(h1List.join(" | "), 90) : '<span class="empty">None</span>'}</dd></div>
<div class="kv-row"><dt>Word count</dt><dd>${Number(pg.wordCount ?? 0)}</dd></div>
<div class="kv-row"><dt>Images</dt><dd>${Number(pg.images ?? 0)}</dd></div>
<div class="kv-row"><dt>Links</dt><dd>${Number(pg.internalLinks ?? 0)} internal &middot; ${Number(pg.externalLinks ?? 0)} external</dd></div>
</dl></div>
<div class="detail-card"><h3>Site Discovery Files</h3><dl class="kv-list">
<div class="kv-row"><dt>Origin</dt><dd>${st.origin ? `<code>${esc(st.origin)}</code>` : '<span class="empty">N/A</span>'}</dd></div>
<div class="kv-row"><dt>robots.txt</dt><dd>${st.robots ? "Found (200)" : "Missing"}</dd></div>
<div class="kv-row"><dt>sitemap.xml</dt><dd>${st.sitemap ? `Found (~${Number(st.sitemapUrls ?? 0)} URLs)` : "Missing"}</dd></div>
<div class="kv-row"><dt>llms.txt</dt><dd>${st.llms ? "Found (200)" : "Missing (optional)"}</dd></div>
</dl></div>
</div></section>`;

  const remediationHtml = `<section id="remediation" aria-labelledby="remediation-h"><h2 id="remediation-h"><span>Remediation &amp; Verification</span><span class="n">CLI workflow</span></h2>
<p class="lede">Apply fixes in priority order (P0 blockers &rarr; P1 high-impact &rarr; P2 optimizations &rarr; P3 polish), then re-run the audit to verify score improvements.</p>
<div class="detail-grid">
<div class="detail-card"><h3>1. Verify After Changes</h3>
<p class="finding-plain">Re-run the single-page audit to confirm findings are resolved:</p>
<div class="cmd-box"><code>npx one-step-seo page ${esc(report.url)}</code><button type="button" class="copy-fix no-print" data-copy="npx one-step-seo page ${esc(report.url)}">Copy</button><span class="copied" role="status" aria-live="polite"></span></div>
</div>
<div class="detail-card"><h3>2. Safe Local Auto-Fix (Dry-Run First)</h3>
<p class="finding-plain">Preview additive HTML <code>&lt;head&gt;</code> fixes on local build files before applying:</p>
<div class="cmd-box"><code>npx one-step-seo fix ./dist --url ${esc(report.finalUrl || report.url)}</code><button type="button" class="copy-fix no-print" data-copy="npx one-step-seo fix ./dist --url ${esc(report.finalUrl || report.url)}">Copy</button><span class="copied" role="status" aria-live="polite"></span></div>
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
  const statusHue = refused ? 45 : Number(c.P0 ?? 0) > 0 ? 0 : Number(c.P1 ?? 0) > 0 ? 25 : 145;
  const shareDesc = `Search SEO ${sText} | AI Visibility ${aText} — P0=${c.P0} P1=${c.P1} P2=${c.P2} P3=${c.P3}.`;
  const crumb =
    opts && opts.indexHref
      ? `<p class="crumbs no-print"><a href="${esc(opts.indexHref)}">&larr; ${opts.pageCount ? `All ${Number(opts.pageCount)} pages` : "All pages"}</a></p>`
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
<div class="brand"><svg class="brand-logo" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="var(--accent)" opacity="0.35"/><path d="M12 3a9 9 0 0 1 9 9" stroke="var(--accent)"/><circle cx="12" cy="12" r="3.5" fill="var(--accent-alt)"/></svg>one-step-seo <span>report</span></div>
<div class="toolbar">
<label class="search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg><input type="search" id="q" placeholder="Filter findings…" autocomplete="off" aria-label="Filter findings by text"><kbd class="kbd-hint">/</kbd></label>
<select id="cat-filter" class="cat-select" aria-label="Filter by category">${catOptions}</select>
<div class="chips" role="group" aria-label="Filter by severity">
<button type="button" class="chip" data-sev="all" aria-pressed="true">All</button>
<button type="button" class="chip" data-sev="P0" aria-pressed="false">P0 <span class="n">${c.P0}</span></button>
<button type="button" class="chip" data-sev="P1" aria-pressed="false">P1 <span class="n">${c.P1}</span></button>
<button type="button" class="chip" data-sev="P2" aria-pressed="false">P2 <span class="n">${c.P2}</span></button>
<button type="button" class="chip" data-sev="P3" aria-pressed="false">P3 <span class="n">${c.P3}</span></button>
<button type="button" class="chip mode-btn" id="exec-mode-btn" aria-pressed="false" title="Toggle Executive Mode (hide raw evidence &amp; code snippets)">Executive Mode</button>
<button type="button" class="chip mode-btn" id="theme-toggle" title="Switch color theme">Theme: Auto</button>
<button type="button" class="chip print-btn" onclick="window.print()" title="Print or save as PDF">Print</button>
</div>
<span class="result-count" id="count" role="status" aria-live="polite">${total} finding${total === 1 ? "" : "s"}</span>
</div></div></div>

<div class="wrap"><main id="main">
<header class="hero">
${crumb}<div class="hero-top"><h1>one-step-seo report</h1><span class="status-pill" style="--hue:${statusHue}">${esc(statusLabel)}</span></div>
<p class="url">${esc(report.url)}${report.finalUrl && report.finalUrl !== report.url ? ` &rarr; ${esc(report.finalUrl)}` : ""}<br>Checked ${esc(report.checkedAt)} &bull; v${esc(report.version)} &bull; Rules ${esc(rulesVer)}</p>
${truncatedBanner}
<div class="scores">
<div class="panel gauge-panel search-engine">${gauge(sAxis.score, sAxis.band, "Search SEO")}
<div><div class="axis">Search SEO</div><div class="axis-sub">${esc(SEARCH_EXPLAINER)}</div></div></div>
<div class="panel gauge-panel ai-engine">${gauge(aAxis.score, aAxis.band, "AI Visibility")}
<div><div class="axis">AI Visibility</div><div class="axis-sub">${esc(AI_EXPLAINER)}</div></div></div>
<div class="panel"><div class="dist-title">Findings by severity</div>${severityBars(c)}</div>
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
<p class="no-print"><button type="button" class="chip" id="copy-summary">Copy summary</button></p></section>

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

<footer class="foot"><span>Generated by one-step-seo v${esc(report.version)} (rules ${esc(rulesVer)}) &mdash; two scores, never blended. <a href="${esc(CHECKS_DOC_URL)}">Checks reference</a></span><span>${esc(report.url)}</span></footer>
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
    var done=function(good){
      cs.textContent=good?'Copied ✓':'Copy failed';
      setTimeout(function(){ cs.textContent='Copy summary'; },2000);
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
