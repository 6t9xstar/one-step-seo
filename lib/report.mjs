/**
 * one-step-seo — report builders (JSON / Markdown / single-file HTML).
 * HTML is dependency-free with inline CSS.
 */
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

const SEARCH_EXPLAINER = "Crawlability, indexability, titles and links — what decides Google rankings.";
const AI_EXPLAINER =
  "Answer-first structure, extractable facts and AI-crawler access — what decides AI answers.";

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
    .replace(/"/g, "&quot;");
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
 * @property {object} site
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
  const search = Number(report.scores?.search?.score ?? 0);
  const ai = Number(report.scores?.ai?.score ?? 0);
  const actionable = (report.findings ?? []).filter((f) => f && f.severity !== "pass");
  if (actionable.length > 0 && actionable.every((f) => f.id === "T05-robots-disallow")) {
    return "Crawl skipped: robots.txt disallows this page, so nothing was audited. If the block is intentional, nothing to do — otherwise allow the path (or re-run with --force) and re-audit.";
  }
  if (p0 > 0) {
    return `Needs urgent attention: ${p0} critical (P0) issue${p0 === 1 ? "" : "s"} block${p0 === 1 ? "s" : ""} this page from ranking or being indexed. Fix P0 first, today.`;
  }
  if (search < 60 || ai < 60) {
    const weak =
      search < 60 && ai < 60
        ? "Search SEO and AI Visibility are both"
        : search < 60
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
  const L = [];
  L.push(`# one-step-seo report`);
  L.push(``);
  L.push(`- URL: ${escMd(report.url)}`);
  L.push(`- Final URL: ${escMd(report.finalUrl)}`);
  L.push(`- Checked: ${escMd(report.checkedAt)}`);
  L.push(`- Search SEO: **${report.scores.search.score}/100 (${report.scores.search.band})**`);
  L.push(`- AI Visibility: **${report.scores.ai.score}/100 (${report.scores.ai.band})**`);
  L.push(
    `- Counts: P0=${report.counts.P0} P1=${report.counts.P1} P2=${report.counts.P2} P3=${report.counts.P3} pass=${report.counts.pass}`,
  );
  if (report.truncated) {
    L.push(`- Note: HTML truncated at the 5MB audit cap; checks ran on the head portion only.`);
  }
  L.push(``);
  L.push(`## Executive summary`);
  L.push(``);
  L.push(verdictFor(report));
  L.push(``);
  L.push(
    `- Search SEO **${report.scores.search.score}/100 (${report.scores.search.band})** — ${SEARCH_EXPLAINER}`,
  );
  L.push(`- AI Visibility **${report.scores.ai.score}/100 (${report.scores.ai.band})** — ${AI_EXPLAINER}`);
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
      L.push(`- Lab Performance Score: **${psi.lab.score}/100**`);
      L.push(`- Largest Contentful Paint (LCP): **${(psi.lab.lcpMs / 1000).toFixed(2)}s** (lab)`);
      L.push(`- Cumulative Layout Shift (CLS): **${psi.lab.cls.toFixed(3)}** (lab)`);
      L.push(`- Total Blocking Time (TBT): **${Math.round(psi.lab.tbtMs)}ms** (lab)`);
      L.push(`- First Contentful Paint (FCP): **${(psi.lab.fcpMs / 1000).toFixed(2)}s** (lab)`);
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
  L.push(`---`);
  L.push(`Generated by one-step-seo v${escMd(report.version)}. Two scores, never blended.`);
  return L.join("\n") + "\n";
}

/** Severity -> hue for theming (CSS custom property --hue). @type {Record<string, number>} */
const SEV_HUE = { P0: 0, P1: 25, P2: 45, P3: 210, pass: 150 };

/** Band -> hue for the score gauges. @type {Record<string, number>} */
const BAND_HUE = { A: 145, B: 95, C: 45, D: 25, E: 15, F: 0 };

/**
 * SVG ring gauge for one score axis. Inline SVG so the report stays a single
 * offline file with no image requests.
 * @param {number} score
 * @param {string} band
 * @param {string} label
 * @returns {string}
 */
function gauge(score, band, label) {
  const isAi = /ai/i.test(label);
  const hue = BAND_HUE[band] ?? 0;
  const strokeColor = isAi ? "var(--accent-alt)" : "var(--accent)";
  const circumference = 2 * Math.PI * 34;
  const pct = Math.max(0, Math.min(100, Number(score) || 0));
  const dash = (pct / 100) * circumference;
  return `<div class="gauge ${isAi ? "gauge-ai" : "gauge-search"}"><svg viewBox="0 0 80 80" width="84" height="84" aria-hidden="true" focusable="false">
<circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" stroke-width="6.5" opacity=".12"/>
<circle class="gauge-fill" cx="40" cy="40" r="34" fill="none" stroke="${strokeColor}" stroke-width="6.5"
  stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${circumference.toFixed(1)}"
  transform="rotate(-90 40 40)"/></svg>
<div class="gauge-text"><span class="gauge-score">${esc(String(score))}</span><span class="gauge-band" style="--hue:${hue}">${esc(band)}</span></div></div>
<p class="sr-only">${esc(label)}: ${esc(String(score))} out of 100, band ${esc(band)}.</p>`;
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
  const hue = SEV_HUE[sev] ?? 45;
  const hay = [f.title, id, f.evidence, f.fix, meta.plain, f.category].join(" ").toLowerCase();
  return `<article class="finding" data-sev="${esc(sev)}" data-search="${esc(hay)}">
<header class="finding-head"><span class="badge" style="--hue:${hue}">${esc(sev)}</span>
<span class="finding-cat">${esc(f.category || "check")}</span>
<h4>${esc(f.title)}</h4></header>
<p class="finding-plain">${esc(meta.plain)}</p>
<dl class="finding-meta">
<div><dt>Check</dt><dd><code>${esc(id)}</code></dd></div>
<div><dt>Impact</dt><dd>${esc(meta.impact)}</dd></div>
<div><dt>Effort</dt><dd>${esc(meta.effort)}</dd></div>
<div><dt>Owner</dt><dd>${esc(meta.owner)}</dd></div></dl>
<p class="finding-row"><strong>Evidence</strong><span>${escTruncate(f.evidence, 300)}</span></p>
<p class="finding-row"><strong>Fix</strong><span>${f.fix ? escTruncate(f.fix, 300) : "—"}</span></p>
${
  meta.snippet
    ? `<details class="snippet"><summary>Copy-paste starting point</summary><pre><code>${esc(meta.snippet)}</code></pre></details>`
    : ""
}
<footer class="finding-foot"><button type="button" class="copy-fix no-print" data-copy="${esc(String(f.fix ?? ""))}">Copy fix</button><span class="copied" role="status" aria-live="polite"></span></footer>
</article>`;
}

/** Severity rank for ordering (lower is more urgent). @type {Record<string, number>} */
export const SEV_RANK = { P0: 0, P1: 1, P2: 2, P3: 3, pass: 4 };

/**
 * Shared design-system stylesheet for report.html and index.html.
 * Returned with surrounding newlines so `<style>${siteCss()}</style>`
 * renders byte-identically to the previous inline `<style>` block.
 * @returns {string}
 */
function siteCss() {
  return `
:root{
  --bg:#f8fafc;
  --fg:#0f172a;
  --muted:#64748b;
  --card:#ffffff;
  --line:#e2e8f0;
  --line-subtle:#f1f5f9;
  --code:#f1f5f9;
  --code-fg:#0f172a;
  --accent:#4f46e5;
  --accent-hover:#4338ca;
  --accent-fg:#ffffff;
  --accent-subtle:rgba(79,70,229,.08);
  --accent-border:rgba(79,70,229,.22);
  --accent-glow:rgba(79,70,229,.2);
  --accent-alt:#059669;
  --accent-alt-hover:#047857;
  --accent-alt-fg:#ffffff;
  --accent-alt-subtle:rgba(5,150,105,.08);
  --accent-alt-border:rgba(5,150,105,.22);
  --accent-alt-glow:rgba(5,150,105,.2);
  --shadow-sm:0 1px 3px rgba(0,0,0,.05),0 1px 2px rgba(0,0,0,.03);
  --shadow-md:0 4px 12px -2px rgba(0,0,0,.08),0 2px 6px -2px rgba(0,0,0,.04);
  --shadow-lg:0 12px 28px -4px rgba(0,0,0,.1);
  --radius-sm:6px;
  --radius-md:10px;
  --radius-lg:16px;
  --radius-full:9999px;
  color-scheme:light dark;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#090d16;
    --fg:#f8fafc;
    --muted:#94a3b8;
    --card:#111726;
    --line:#1e293b;
    --line-subtle:#141b2d;
    --code:#172033;
    --code-fg:#e2e8f0;
    --accent:#6366f1;
    --accent-hover:#818cf8;
    --accent-fg:#ffffff;
    --accent-subtle:rgba(99,102,241,.15);
    --accent-border:rgba(99,102,241,.35);
    --accent-glow:rgba(99,102,241,.3);
    --accent-alt:#10b981;
    --accent-alt-hover:#34d399;
    --accent-alt-fg:#ffffff;
    --accent-alt-subtle:rgba(16,185,129,.15);
    --accent-alt-border:rgba(16,185,129,.35);
    --accent-alt-glow:rgba(16,185,129,.3);
    --shadow-sm:0 1px 3px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.04);
    --shadow-md:0 6px 18px -2px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.04);
    --shadow-lg:0 16px 32px -4px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.06);
  }
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:76px}
body{margin:0;background:var(--bg);color:var(--fg);line-height:1.55;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:0 20px 60px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;left:-9999px;top:0;z-index:100;background:var(--accent);color:var(--accent-fg);padding:10px 18px;font-weight:700;border-radius:0 0 8px 0;text-decoration:none}
.skip:focus{left:0;top:0}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em;background:var(--code);color:var(--code-fg);padding:2px 6px;border-radius:var(--radius-sm)}
pre{background:var(--code);color:var(--code-fg);padding:14px;border-radius:var(--radius-md);overflow-x:auto;white-space:pre-wrap;word-break:break-word;margin:10px 0 0;font-size:12.5px;border:1px solid var(--line)}
pre code{background:none;padding:0}
.empty{color:var(--muted);font-style:italic}

.masthead{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.85);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid var(--line);transition:border-color .15s}
@media (prefers-color-scheme:dark){.masthead{background:rgba(9,13,22,.85)}}
.masthead-in{max-width:1180px;margin:0 auto;padding:10px 20px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.brand{font-weight:800;font-size:15px;letter-spacing:-.02em;white-space:nowrap;display:flex;align-items:center;gap:9px}
.brand-logo{flex:none}
.brand span{font-size:11px;font-weight:750;text-transform:uppercase;letter-spacing:.05em;color:var(--accent);background:var(--accent-subtle);border:1px solid var(--accent-border);padding:2.5px 8px;border-radius:var(--radius-full)}
.toolbar{display:flex;gap:10px;align-items:center;flex:1;flex-wrap:wrap;min-width:0}
.search{flex:1;min-width:200px;position:relative;display:flex;align-items:center}
.search input{width:100%;font:inherit;font-size:13.5px;padding:8px 38px 8px 34px;border-radius:var(--radius-md);border:1px solid var(--line);background:var(--bg);color:var(--fg);transition:all .15s ease}
.search input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-subtle);background:var(--card)}
.search svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);opacity:.5;pointer-events:none;transition:opacity .15s,color .15s}
.search input:focus ~ svg,.search:focus-within svg{opacity:1;color:var(--accent)}
.kbd-hint{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;font-weight:700;padding:1.5px 6px;border-radius:4px;background:var(--card);border:1px solid var(--line);color:var(--muted);pointer-events:none}
.chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.chip{font:inherit;font-size:12px;font-weight:700;padding:6px 12px;border-radius:var(--radius-full);border:1px solid var(--line);background:var(--card);color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .15s ease}
.chip:hover{border-color:var(--accent);color:var(--fg);background:var(--bg)}
.chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--accent-fg);box-shadow:0 2px 8px var(--accent-glow)}
.chip .n{font-size:11px;font-weight:600;opacity:.85;padding:1px 6px;border-radius:var(--radius-full);background:rgba(0,0,0,.15)}
.chip[aria-pressed="false"] .n{background:var(--code);color:var(--fg)}
.print-btn{font-size:11.5px;padding:5px 11px;color:var(--muted)}
.print-btn:hover{color:var(--fg);border-color:var(--line)}
.result-count{font-size:12px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:600}

.hero{padding:32px 0 6px}
h1{font-size:26px;font-weight:850;margin:0 0 8px;letter-spacing:-.025em}
.url{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:var(--muted);word-break:break-all;margin:0;line-height:1.5}
.scores{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;margin:24px 0}
.panel{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-lg);padding:20px 22px;box-shadow:var(--shadow-sm);transition:all .18s cubic-bezier(.16,1,.3,1)}
.panel:hover{box-shadow:var(--shadow-md)}
.gauge-panel{display:flex;gap:18px;align-items:center}
.gauge-panel.search-engine{border-top:3px solid var(--accent)}
.gauge-panel.ai-engine{border-top:3px solid var(--accent-alt)}
.gauge{position:relative;flex:none;color:var(--muted)}
.gauge svg{display:block}
.gauge-text{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;gap:3px}
.gauge-score{font-size:25px;font-weight:850;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.gauge-band{font-size:11px;font-weight:800;letter-spacing:.05em;padding:1.5px 7px;border-radius:var(--radius-full);color:hsl(var(--hue) 65% 35%);background:hsl(var(--hue) 70% 92%)}
@media (prefers-color-scheme:dark){.gauge-band{color:hsl(var(--hue) 75% 82%);background:hsl(var(--hue) 45% 20%)}}
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

.toc{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0 8px;padding:0;list-style:none}
.toc a{font-size:12.5px;font-weight:700;text-decoration:none;color:var(--muted);padding:6px 14px;border:1px solid var(--line);border-radius:var(--radius-full);background:var(--card);transition:all .15s ease}
.toc a:hover{color:var(--fg);border-color:var(--accent);background:var(--accent-subtle)}

section{margin:36px 0;scroll-margin-top:80px}
h2{font-size:19px;font-weight:800;margin:0 0 14px;letter-spacing:-.015em;padding-bottom:10px;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:baseline;justify-content:space-between}
h2 .n{font-size:12.5px;color:var(--muted);font-weight:650;font-variant-numeric:tabular-nums}
.lede{color:var(--muted);margin:0 0 16px;font-size:14px;line-height:1.5}

.topfix{list-style:none;margin:0;padding:0;display:grid;gap:12px;counter-reset:tf}
.topfix li{counter-increment:tf;position:relative;background:var(--card);border:1px solid var(--line);border-left:4px solid hsl(var(--hue) 68% 46%);border-radius:var(--radius-md);padding:16px 18px 16px 56px;box-shadow:var(--shadow-sm);transition:all .15s ease}
.topfix li:hover{border-color:var(--accent);transform:translateX(3px);box-shadow:var(--shadow-md)}
.topfix li::before{content:counter(tf);position:absolute;left:18px;top:16px;width:26px;height:26px;border-radius:var(--radius-full);background:var(--accent);color:var(--accent-fg);font-size:12.5px;font-weight:800;display:grid;place-items:center;box-shadow:0 2px 6px var(--accent-glow)}

.badge{display:inline-flex;align-items:center;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:var(--radius-sm);color:hsl(var(--hue) 68% 27%);background:hsl(var(--hue) 70% 92%);vertical-align:1px;white-space:nowrap;border:1px solid hsl(var(--hue) 65% 82%)}
@media (prefers-color-scheme:dark){.badge{color:hsl(var(--hue) 78% 82%);background:hsl(var(--hue) 45% 20%);border-color:hsl(var(--hue) 50% 30%)}}

.group h3{display:flex;align-items:center;gap:9px;font-size:15px;margin:26px 0 14px;color:var(--fg);font-weight:750;letter-spacing:-.01em}
.group-count{font-size:11px;font-weight:700;padding:2px 8px;border-radius:var(--radius-full);background:var(--code);color:var(--muted)}
.cards{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(340px,1fr))}
.finding{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-lg);padding:18px 20px;display:flex;flex-direction:column;gap:12px;box-shadow:var(--shadow-sm);transition:all .18s cubic-bezier(.16,1,.3,1)}
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
.copied{font-size:12px;color:var(--accent-alt);font-weight:750;display:inline-flex;align-items:center;gap:4px}
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
.checklist li[data-checked="yes"]{border-color:var(--accent-alt-border)}
.checklist li[data-checked="yes"] .box{color:var(--accent-alt)}
.checklist li[data-checked="no"]{border-style:dashed}
.checklist li[data-checked="no"] .box{color:var(--muted)}
.progress{height:9px;border-radius:var(--radius-full);background:var(--code);overflow:hidden;margin:0 0 18px;max-width:440px}
.progress i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent-alt));border-radius:var(--radius-full);transition:width .4s ease}

.cwv-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-lg);padding:18px 20px;box-shadow:var(--shadow-sm);margin-bottom:14px}
.cwv-card h4{margin:0 0 12px;font-size:15px;font-weight:750;letter-spacing:-.015em}

details.passed summary{cursor:pointer;font-weight:700;font-size:13.5px;padding:12px 16px;background:var(--card);border:1px solid var(--line);border-radius:var(--radius-md);box-shadow:var(--shadow-sm)}
details.passed ul{margin:12px 0 0;padding-left:24px;font-size:12.5px;columns:2;column-gap:30px}
details.passed li{break-inside:avoid;margin:3.5px 0}

.warn{border:1px solid #d97706;background:rgba(217,119,6,.1);border-radius:var(--radius-md);padding:12px 16px;font-size:13px}
footer.foot{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}

@media (max-width:760px){
  .cards{grid-template-columns:1fr}
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
  .wrap{max-width:none;padding:0}
  .finding,.panel,details.passed summary,.checklist li,.topfix li,#summary{break-inside:avoid;border-color:#bbb;box-shadow:none}
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

/** Extra rules only the site dashboard needs (pages table, reach bars). */
const DASHBOARD_CSS = `.table-scroll{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--card);box-shadow:var(--shadow-sm)}
table.pages{border-collapse:collapse;width:100%;font-size:13.5px;min-width:700px}
table.pages caption{caption-side:bottom;padding:10px 16px;font-size:12px;color:var(--muted);text-align:left}
table.pages th,table.pages td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--line);vertical-align:middle}
table.pages thead th{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);background:var(--code);white-space:nowrap}
table.pages tbody tr:last-child td{border-bottom:none}
table.pages tbody tr:hover{background:var(--accent-subtle)}
td.num{font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:700}
td.p-url{word-break:break-all;font-weight:650}
td.p-url a{color:var(--accent);text-decoration:none}
td.p-url a:hover{text-decoration:underline}
.reach{height:7px;border-radius:var(--radius-full);background:var(--code);overflow:hidden;margin-top:6px;max-width:250px}
.reach i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent-alt));border-radius:var(--radius-full)}
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
 * @param {Report[]} pageReports
 * @returns {string}
 */
export function renderSiteIndex(pageReports) {
  const pages = Array.isArray(pageReports) ? [...pageReports] : [];
  const n = pages.length;
  /** @type {Record<string, number>} */
  const totals = { P0: 0, P1: 0, P2: 0, P3: 0, pass: 0 };
  let searchSum = 0;
  let aiSum = 0;
  let searchMin = 100;
  let aiMin = 100;
  for (const r of pages) {
    const s = Number(r?.scores?.search?.score ?? 0);
    const a = Number(r?.scores?.ai?.score ?? 0);
    searchSum += s;
    aiSum += a;
    searchMin = Math.min(searchMin, s);
    aiMin = Math.min(aiMin, a);
    for (const k of Object.keys(totals)) totals[k] = (totals[k] ?? 0) + Number(r?.counts?.[k] ?? 0);
  }
  const avgSearch = n > 0 ? Math.round(searchSum / n) : 0;
  const avgAi = n > 0 ? Math.round(aiSum / n) : 0;
  /** @type {any} */
  const firstSite = n > 0 && pages[0]?.site && typeof pages[0]?.site === "object" ? pages[0]?.site : {};
  const first = n > 0 ? pages[0] : null;
  const origin = String(firstSite.origin || first?.finalUrl || "this site");
  const checkedAt = String(first?.checkedAt ?? "");
  const version = String(first?.version ?? "");

  const ordered = pages
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        a.r.scores.search.score - b.r.scores.search.score ||
        a.r.scores.ai.score - b.r.scores.ai.score ||
        a.i - b.i,
    );
  const rows = ordered
    .map(({ r, i }) => {
      const name = siteBasename(i);
      const s = r.scores.search;
      const a = r.scores.ai;
      const counts = r.counts ?? {};
      return `<tr><td class="p-url"><a href="./${esc(name)}.html">${esc(r.finalUrl)}</a></td><td class="num"><span class="badge" style="--hue:${BAND_HUE[s.band] ?? 0}">${s.score} ${esc(s.band)}</span></td><td class="num"><span class="badge" style="--hue:${BAND_HUE[a.band] ?? 0}">${a.score} ${esc(a.band)}</span></td><td class="num">${Number(counts.P0 ?? 0)}</td><td class="num">${Number(counts.P1 ?? 0)}</td><td class="num">${Number(counts.P2 ?? 0)}</td><td class="num">${Number(counts.P3 ?? 0)}</td></tr>`;
    })
    .join("\n");

  const top = siteTopFindings(pages, 5);
  const topHtml =
    top.length === 0
      ? `<p class="empty">No recurring issues — every page passed.</p>`
      : `<ol class="topfix">\n${top
          .map(({ finding: f, pages: hit, total }) => {
            const hue = SEV_HUE[String(f.severity)] ?? 45;
            const meta = getFindingMeta(String(f.id ?? ""));
            const pct = total > 0 ? Math.round((hit / total) * 100) : 0;
            return `<li style="--hue:${hue}"><span class="badge">${esc(f.severity)}</span> <strong>${esc(f.title)}</strong> <code>${esc(f.id)}</code> <small>on ${hit}/${total} pages</small><br><span class="finding-plain">${esc(String(f.fix || meta.plain).slice(0, 160))}</span><span class="reach" role="img" aria-label="${hit} of ${total} pages affected"><i style="width:${pct}%"></i></span></li>`;
          })
          .join("\n")}\n</ol>`;

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

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>one-step-seo site report — ${esc(origin)}</title>
<meta name="description" content="${esc(`Site audit of ${n} pages: avg Search ${avgSearch}/100, avg AI ${avgAi}/100.`)}">
<style>${siteCss()}
${DASHBOARD_CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to site report</a>
<div class="masthead no-print"><div class="masthead-in"><div class="brand"><svg class="brand-logo" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="var(--accent)" opacity="0.35"/><path d="M12 3a9 9 0 0 1 9 9" stroke="var(--accent)"/><circle cx="12" cy="12" r="3.5" fill="var(--accent-alt)"/></svg>one-step-seo <span>site report</span></div></div></div>
<div class="wrap"><main id="main">
<header class="hero">
<h1>Site audit</h1>
<p class="url">${esc(origin)} · ${n} page${n === 1 ? "" : "s"}${checkedAt ? ` · Checked ${esc(checkedAt)}` : ""}${version ? ` · v${esc(version)}` : ""}</p>
<div class="scores">
<div class="panel gauge-panel search-engine">${gauge(avgSearch, scoreBand(avgSearch), "Average Search SEO")}
<div><div class="axis">Avg Search SEO</div><div class="axis-sub">Average ${avgSearch}/100 · lowest ${n > 0 ? searchMin : "–"}</div></div></div>
<div class="panel gauge-panel ai-engine">${gauge(avgAi, scoreBand(avgAi), "Average AI Visibility")}
<div><div class="axis">Avg AI Visibility</div><div class="axis-sub">Average ${avgAi}/100 · lowest ${n > 0 ? aiMin : "–"}</div></div></div>
<div class="panel"><div class="dist-title">Findings across all pages</div>${severityBars(totals)}</div>
</div>
<ul class="toc">
<li><a href="#pages">Pages</a></li><li><a href="#top-site">Top issues</a></li><li><a href="#dups">Duplicates</a></li>
</ul>
</header>

<section id="pages" aria-labelledby="pages-h"><h2 id="pages-h"><span>Pages</span><span class="n">${n}</span></h2>
<div class="table-scroll"><table class="pages"><caption>Worst Search score first</caption>
<thead><tr><th scope="col">Page</th><th scope="col">Search</th><th scope="col">AI</th><th scope="col">P0</th><th scope="col">P1</th><th scope="col">P2</th><th scope="col">P3</th></tr></thead>
<tbody>
${rows}
</tbody></table></div></section>

<section id="top-site" aria-labelledby="top-site-h"><h2 id="top-site-h"><span>Top recurring issues</span><span class="n">${top.length}</span></h2>${topHtml}</section>

<section id="dups" aria-labelledby="dups-h"><h2 id="dups-h"><span>Duplicate titles &amp; descriptions</span><span class="n">${dups.length}</span></h2>${dupsHtml}</section>

<footer class="foot"><span>Generated by one-step-seo${version ? ` v${esc(version)}` : ""} — two scores, never blended.</span><span>${esc(origin)}</span></footer>
</main></div>
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

  const fixFirst =
    first.length === 0
      ? `<p class="empty">No issues found. Nice.</p>`
      : `<ol class="topfix">\n${first
          .map((f) => {
            const meta = getFindingMeta(String(f.id ?? ""));
            const hue = SEV_HUE[String(f.severity)] ?? 45;
            return `<li style="--hue:${hue}"><span class="badge">${esc(f.severity)}</span> <strong>${esc(f.title)}</strong> <code>${esc(f.id)}</code><br><span class="finding-plain">${esc(meta.plain)}</span></li>`;
          })
          .join("\n")}\n</ol>`;

  const groupsHtml = groups
    .map((g) => {
      const cards = g.items.map(findingCard).join("\n");
      return `<section class="group" id="cat-${esc(g.key)}" aria-labelledby="h-${esc(g.key)}">
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
    const lcpSec = lab ? (lab.lcpMs / 1000).toFixed(2) : "0.00";
    const clsVal = lab ? lab.cls.toFixed(3) : "0.000";
    const tbtVal = lab ? Math.round(lab.tbtMs) : 0;
    const fcpSec = lab ? (lab.fcpMs / 1000).toFixed(2) : "0.00";

    const fieldRows =
      field && (field.lcpMs != null || field.cls != null || field.inpMs != null)
        ? `<div class="cwv-card">
<h4>Chrome UX Report (CrUX Field)</h4>
<p class="finding-plain">75th percentile real-world user metrics (Rating: <strong>${esc(field.overallCategory)}</strong>)</p>
<dl class="finding-meta">
<div><dt>Field LCP</dt><dd>${field.lcpMs != null ? `${(field.lcpMs / 1000).toFixed(2)}s` : "N/A"}</dd></div>
<div><dt>Field CLS</dt><dd>${field.cls != null ? field.cls.toFixed(3) : "N/A"}</dd></div>
<div><dt>Field INP</dt><dd>${field.inpMs != null ? `${Math.round(field.inpMs)}ms` : "N/A"}</dd></div>
</dl>
</div>`
        : `<p class="empty">No real-user Chrome UX Report (CrUX) data available for this URL yet.</p>`;

    psiHtml = `<section id="psi" aria-labelledby="psi-h"><h2 id="psi-h"><span>Core Web Vitals</span><span class="n">PageSpeed Insights (${esc(psi.strategy || "mobile")})</span></h2>
<p class="lede">Lab diagnostics and real-world Core Web Vitals measured via Google PageSpeed Insights.</p>
<div class="cwv-card" style="margin-bottom:12px;">
<h4>Lab Performance Score: ${lab ? lab.score : 0}/100</h4>
<dl class="finding-meta">
<div><dt>Largest Contentful Paint</dt><dd>${lcpSec}s</dd></div>
<div><dt>Cumulative Layout Shift</dt><dd>${clsVal}</dd></div>
<div><dt>Total Blocking Time</dt><dd>${tbtVal}ms</dd></div>
<div><dt>First Contentful Paint</dt><dd>${fcpSec}s</dd></div>
</dl>
</div>
${fieldRows}
</section>`;
  }

  const truncatedBanner = report.truncated
    ? `<p class="warn" role="note">Note: HTML exceeded the 5MB audit cap — checks ran on the head portion only.</p>`
    : ``;

  const total = actionable.length;
  const done = checklist.filter((c) => c.checked).length;
  const c = report.counts;
  const refused = total > 0 && actionable.every((f) => f.id === "T05-robots-disallow");
  const shareDesc = `Search SEO ${report.scores.search.score}/100 (${report.scores.search.band}) | AI Visibility ${report.scores.ai.score}/100 (${report.scores.ai.band}) — P0=${c.P0} P1=${c.P1} P2=${c.P2} P3=${c.P3}.`;
  const crumb =
    opts && opts.indexHref
      ? `<p class="crumbs no-print"><a href="${esc(opts.indexHref)}">&larr; ${opts.pageCount ? `All ${Number(opts.pageCount)} pages` : "All pages"}</a></p>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
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
<div class="chips" role="group" aria-label="Filter by severity">
<button type="button" class="chip" data-sev="all" aria-pressed="true">All</button>
<button type="button" class="chip" data-sev="P0">P0 <span class="n">${c.P0}</span></button>
<button type="button" class="chip" data-sev="P1">P1 <span class="n">${c.P1}</span></button>
<button type="button" class="chip" data-sev="P2">P2 <span class="n">${c.P2}</span></button>
<button type="button" class="chip" data-sev="P3">P3 <span class="n">${c.P3}</span></button>
<button type="button" class="chip print-btn" onclick="window.print()" title="Print or save as PDF">Print</button>
</div>
<span class="result-count" id="count" role="status" aria-live="polite">${total} finding${total === 1 ? "" : "s"}</span>
</div></div></div>

<div class="wrap"><main id="main">
<header class="hero">
${crumb}<h1>one-step-seo report</h1>
<p class="url">${esc(report.url)}${report.finalUrl && report.finalUrl !== report.url ? ` &rarr; ${esc(report.finalUrl)}` : ""}<br>Checked ${esc(report.checkedAt)} &bull; v${esc(report.version)}</p>
${truncatedBanner}
<div class="scores">
<div class="panel gauge-panel search-engine">${gauge(report.scores.search.score, report.scores.search.band, "Search SEO")}
<div><div class="axis">Search SEO</div><div class="axis-sub">${esc(SEARCH_EXPLAINER)}</div></div></div>
<div class="panel gauge-panel ai-engine">${gauge(report.scores.ai.score, report.scores.ai.band, "AI Visibility")}
<div><div class="axis">AI Visibility</div><div class="axis-sub">${esc(AI_EXPLAINER)}</div></div></div>
<div class="panel"><div class="dist-title">Findings by severity</div>${severityBars(report.counts)}</div>
</div>
<ul class="toc">
<li><a href="#summary">Summary</a></li><li><a href="#first">Fix this first</a></li>${report.page && report.page.psi ? '<li><a href="#psi">Core Web Vitals</a></li>' : ""}
<li><a href="#actions">All findings</a></li><li><a href="#citable">Citability</a></li>
<li><a href="#passed">Passed</a></li><li><a href="#monitor">Monitor</a></li>
</ul>
</header>

<section id="summary" aria-labelledby="summary-h"><h2 id="summary-h">Executive summary</h2>
<p class="lede" id="exec-summary-text">${esc(verdictFor(report))} Search SEO ${report.scores.search.score}/100 (${esc(report.scores.search.band)}) · AI Visibility ${report.scores.ai.score}/100 (${esc(report.scores.ai.band)}). ${total === 0 ? "No actionable issues." : refused ? "No pages were audited — robots.txt disallows this path." : `${total} actionable issue${total === 1 ? "" : "s"} — fix P0 today, P1 this week, P2 this month.`}</p>
<p class="no-print"><button type="button" class="chip" id="copy-summary">Copy summary</button></p></section>

<section id="first" aria-labelledby="first-h"><h2 id="first-h">Fix this first</h2>
<p class="lede">Highest impact per unit of effort, ranked by severity.</p>${fixFirst}</section>
${psiHtml}
<section id="actions" aria-labelledby="actions-h"><h2 id="actions-h"><span>All findings</span><span class="n">${total}</span></h2>
<p class="lede">Use the search box and severity chips above to narrow this down. Every card has a one-click copy of its fix.</p>
${groups.length === 0 ? `<p class="none-msg">No issues found. Nice.</p>` : groupsHtml}
<p class="none-msg" id="no-matches" hidden>No findings match your current filter query. Try clearing the search or switching severity.</p>
</section>

<section id="citable" aria-labelledby="citable-h"><h2 id="citable-h"><span>Make this page more citable</span><span class="n">${done}/${checklist.length}</span></h2>
<div class="progress" role="img" aria-label="${done} of ${checklist.length} citability signals present"><i style="width:${checklist.length ? ((done / checklist.length) * 100).toFixed(0) : 0}%"></i></div>
${checklistHtml}</section>

<section id="passed" aria-labelledby="passed-h"><h2 id="passed-h"><span>What passed</span><span class="n">${passed.length}</span></h2>${passedHtml}</section>

<section id="monitor" aria-labelledby="monitor-h"><h2 id="monitor-h"><span>What to monitor</span><span class="n">${monitor.length}</span></h2>${monitorHtml}</section>

<footer class="foot"><span>Generated by one-step-seo v${esc(report.version)} &mdash; two scores, never blended.</span><span>${esc(report.url)}</span></footer>
</main></div>

<script>
(function(){
  var q=document.getElementById('q');
  var chips=[].slice.call(document.querySelectorAll('.chip[data-sev]'));
  var out=document.getElementById('count');
  var findings=[].slice.call(document.querySelectorAll('.finding'));
  var groups=[].slice.call(document.querySelectorAll('.group'));
  var sev='all';
  function apply(){
    var term=(q&&q.value||'').toLowerCase().trim();
    var shown=0;
    findings.forEach(function(el){
      var okSev=sev==='all'||el.getAttribute('data-sev')===sev;
      var hay=el.getAttribute('data-search')||'';
      var vis=okSev&&(!term||hay.indexOf(term)!==-1);
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
  chips.forEach(function(c){ c.addEventListener('click',function(){
    sev=c.getAttribute('data-sev');
    chips.forEach(function(o){ o.setAttribute('aria-pressed', o===c?'true':'false'); });
    apply();
  });});
  document.addEventListener('keydown',function(e){
    if(e.key==='/'&&document.activeElement!==q&&!['input','textarea'].includes((document.activeElement&&document.activeElement.tagName||'').toLowerCase())){
      e.preventDefault();
      if(q){q.focus();q.select();}
    }
    if(e.key==='Escape'&&document.activeElement===q){
      if(q){q.value='';apply();q.blur();}
    }
  });
  function copy(text,ok,fail){
    var note=null,btn=this;
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
          locations: [{ physicalLocation: { artifactLocation: { uri: report.finalUrl } } }],
        })),
      },
    ],
  };
}

/**
 * Escape a field for CSV (RFC 4180 compliant).
 * @param {unknown} val
 * @returns {string}
 */
function escCsv(val) {
  const str = String(val ?? "").replace(/\r?\n+/g, " ");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
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
