/**
 * one-step-seo — report builders (JSON / Markdown / single-file HTML).
 * HTML is dependency-free with inline CSS.
 */

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
 * @typedef {{ id: string, category: string, severity: string, title: string, evidence: string, fix: string }} Finding
 * @typedef {{ score: number, band: string }} Score
 * @typedef {object} Report
 * @property {string} tool
 * @property {string} version
 * @property {string} url
 * @property {string} finalUrl
 * @property {string} checkedAt
 * @property {{ search: Score, ai: Score }} scores
 * @property {Record<string, number>} counts
 * @property {Finding[]} findings
 * @property {boolean} [truncated]
 * @property {object} page
 * @property {object} site
 */

/**
 * @param {{ url: string, finalUrl: string, scores: Report["scores"], findings: Finding[], parsed: any, siteFiles: any, meta: { version: string }, truncated?: boolean, checkedAt?: string }} input
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
  L.push(`## Priority actions`);
  const actionable = report.findings.filter((f) => f.severity !== "pass");
  if (actionable.length === 0) L.push(`No issues found. Nice.`);
  for (const f of actionable) {
    L.push(`### [${f.severity}] ${escMd(f.title)} (${escMd(f.id)})`);
    L.push(`- Category: ${escMd(f.category)}`);
    L.push(`- Evidence: ${escMd(f.evidence)}`);
    if (f.fix) L.push(`- Fix: ${escMd(f.fix)}`);
  }
  L.push(``);
  L.push(`## Passed checks`);
  for (const f of report.findings.filter((f) => f.severity === "pass")) {
    L.push(`- ${escMd(f.title)} (${escMd(f.id)})`);
  }
  L.push(``);
  L.push(`---`);
  L.push(`Generated by one-step-seo v${escMd(report.version)}. Two scores, never blended.`);
  return L.join("\n") + "\n";
}

/**
 * @param {Report} report
 * @returns {string}
 */
export function renderHtml(report) {
  const rows = report.findings
    .map(
      (f) =>
        `<tr class="sev-${esc(f.severity)}"><td><strong>${esc(f.severity)}</strong></td><td>${esc(f.title)}<br><small>${esc(f.id)} · ${esc(f.category)}</small></td><td>${escTruncate(f.evidence, 300)}</td><td>${f.fix ? escTruncate(f.fix, 300) : "—"}</td></tr>`,
    )
    .join("\n");
  const truncatedBanner = report.truncated
    ? `<p class="warn" role="note">Note: HTML exceeded the 5MB audit cap — checks ran on the head portion only.</p>`
    : ``;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>one-step-seo report — ${esc(report.finalUrl)}</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:32px;line-height:1.55;max-width:1080px;margin-inline:auto}
.cards{display:flex;gap:16px;flex-wrap:wrap;margin:16px 0 24px}
.card{border:1px solid #ccc;border-radius:12px;padding:16px 20px;min-width:220px}
.score{font-size:40px;font-weight:800}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border:1px solid #ccc;padding:8px 10px;text-align:left;vertical-align:top}
tr.sev-P0{background:rgba(220,38,38,.08)}
tr.sev-P1{background:rgba(234,88,12,.08)}
.meta{color:#555;font-size:13px}
.warn{border:1px solid #d97706;background:rgba(217,119,6,.12);border-radius:8px;padding:10px 14px}
code{background:rgba(127,127,127,.15);padding:1px 6px;border-radius:6px}
</style>
</head>
<body>
<h1>one-step-seo report</h1>
<p class="meta">URL: <code>${esc(report.url)}</code><br>Final: <code>${esc(report.finalUrl)}</code><br>Checked: ${esc(report.checkedAt)} · v${esc(report.version)}</p>
${truncatedBanner}
<div class="cards">
<div class="card"><div>Search SEO</div><div class="score">${report.scores.search.score}<small>/100 ${esc(report.scores.search.band)}</small></div></div>
<div class="card"><div>AI Visibility</div><div class="score">${report.scores.ai.score}<small>/100 ${esc(report.scores.ai.band)}</small></div></div>
<div class="card"><div>Counts</div><div>P0=${report.counts.P0} · P1=${report.counts.P1} · P2=${report.counts.P2} · P3=${report.counts.P3} · pass=${report.counts.pass}</div></div>
</div>
<table>
<caption>Findings ordered by priority (P0 critical first, passed checks last)</caption>
<thead><tr><th scope="col">Priority</th><th scope="col">Check</th><th scope="col">Evidence</th><th scope="col">Fix</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<p class="meta">Generated by one-step-seo. Two scores, never blended.</p>
</body>
</html>
`;
}
