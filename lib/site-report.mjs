/**
 * one-step-seo — site-level report renderers (Markdown / CSV / PDF).
 *
 * One model, three audiences:
 *   - "client"    : plain-language summary, priorities, what to do next
 *   - "developer" : every issue with affected URLs, evidence and fix type
 *   - "full"      : both (default)
 *
 * Every number comes from the audit data passed in. Sections whose data was
 * not collected (competitors, Core Web Vitals, fixes, history) say so instead
 * of showing placeholders.
 */
import { escCsv, summarizeAggregate, siteTopFindings } from "./report.mjs";
import { getFindingMeta } from "./finding-meta.mjs";
import { scoreBand } from "./score.mjs";
import { renderPdf } from "./pdf.mjs";
import { classifyFinding } from "./autofix.mjs";
import { VERSION } from "./version.mjs";

/** @typedef {ReturnType<typeof import("./intelligence.mjs").analyzeSite>} SiteAnalysis */

/**
 * @typedef {object} SiteReportModel
 * @property {string} origin
 * @property {string} checkedAt
 * @property {import("./report.mjs").Report[]} pageReports
 * @property {SiteAnalysis | null} [analysis]
 * @property {ReturnType<typeof import("./intelligence.mjs").compareCompetitors> | null} [competitors]
 * @property {{ id: string, createdAt: string, status: string, files: { path: string, fixes: string[], verified: { name: string, cleared: boolean }[] }[] }[]} [fixSessions]
 * @property {{ checkedAt: string, resolved: number, regressed: number, persisting: number } | null} [verification]
 * @property {{ takenAt: string, search: number | null, ai: number | null }[]} [history]
 */

/**
 * @typedef {object} RenderOptions
 * @property {"client" | "developer" | "full"} [audience]
 * @property {string} [brand] agency / author name shown on the report
 * @property {string} [client] client name shown on the report
 */

/** @type {Record<string, string>} */
const SEVERITY_LABEL = {
  P0: "Critical errors",
  P1: "High-priority warnings",
  P2: "Medium-priority improvements",
  P3: "Low-priority recommendations",
};

/**
 * @param {number | null | undefined} v
 * @returns {string}
 */
function fmtScore(v) {
  return typeof v === "number" && Number.isFinite(v) ? `${v}/100 (${scoreBand(v)})` : "not available";
}

/**
 * Flatten a model into issue rows (one per affected URL).
 * @param {SiteReportModel} model
 * @returns {{ scope: string, url: string, id: string, severity: string, category: string, title: string, evidence: string, fix: string, fixType: string, heuristic: boolean }[]}
 */
export function issueRows(model) {
  /** @type {ReturnType<typeof issueRows>} */
  const rows = [];
  for (const r of model.pageReports ?? []) {
    for (const f of r.findings ?? []) {
      if (!f || f.severity === "pass") continue;
      rows.push({
        scope: "page",
        url: r.finalUrl || r.url,
        id: f.id,
        severity: f.severity,
        category: f.category,
        title: f.title,
        evidence: f.evidence ?? "",
        fix: f.fix ?? "",
        fixType: classifyFinding(f, r).fixType,
        heuristic: false,
      });
    }
  }
  for (const i of model.analysis?.issues ?? []) {
    for (const u of i.urls) {
      rows.push({
        scope: "site",
        url: u.url,
        id: i.id,
        severity: i.severity,
        category: i.category,
        title: i.title,
        evidence: u.detail,
        fix: i.recommendation,
        fixType: i.fixType,
        heuristic: i.heuristic,
      });
    }
  }
  /** @type {Record<string, number>} */
  const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return rows.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || (a.url < b.url ? -1 : 1));
}

/**
 * CSV of every detected issue by URL (page-level and site-level).
 * @param {SiteReportModel} model
 * @returns {string}
 */
export function renderSiteCsv(model) {
  const headers = [
    "Scope",
    "URL",
    "Severity",
    "Issue ID",
    "Category",
    "Title",
    "Evidence",
    "Recommended fix",
    "Fix type",
    "Heuristic",
  ];
  const lines = [headers.join(",")];
  for (const r of issueRows(model)) {
    lines.push(
      [
        r.scope,
        r.url,
        r.severity,
        r.id,
        r.category,
        r.title,
        r.evidence,
        r.fix,
        r.fixType,
        r.heuristic ? "yes" : "no",
      ]
        .map(escCsv)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

/**
 * Structured outline shared by the Markdown and PDF renderers.
 * @param {SiteReportModel} model
 * @param {RenderOptions} [opts]
 * @returns {{ style: "title" | "h1" | "h2" | "body" | "bullet" | "small" | "space", text: string }[]}
 */
export function siteReportOutline(model, opts = {}) {
  const audience = opts.audience ?? "full";
  const dev = audience !== "client";
  const reports = model.pageReports ?? [];
  const agg = summarizeAggregate(reports);
  const analysis = model.analysis ?? null;
  const rows = issueRows(model);
  /** @type {ReturnType<typeof siteReportOutline>} */
  const out = [];
  /** @param {ReturnType<typeof siteReportOutline>[number]["style"]} style @param {string} text */
  const add = (style, text) => {
    out.push({ style, text });
  };

  add("title", `SEO audit report — ${model.origin}`);
  add(
    "small",
    [
      opts.client ? `Prepared for ${opts.client}` : "",
      opts.brand ? `Prepared by ${opts.brand}` : "",
      `Audited ${model.checkedAt.slice(0, 10)}`,
      `${reports.length} page${reports.length === 1 ? "" : "s"}`,
      `one-step-seo v${VERSION}`,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  // 1–2. scores
  add("h1", "1. Scores");
  add(
    "bullet",
    `Overall SEO health (average Search SEO score across audited pages): ${fmtScore(agg.avgSearch)}`,
  );
  add("bullet", `AI visibility (average): ${fmtScore(agg.avgAi)}`);
  const cs = analysis?.categoryScores ?? {};
  for (const [key, label] of [
    ["technical", "Technical SEO"],
    ["onpage", "On-page SEO"],
    ["content", "Content"],
    ["schema", "Structured data"],
    ["performance", "Performance hints"],
  ]) {
    if (cs[key ?? ""]) add("bullet", `${label}: ${fmtScore(cs[key ?? ""]?.score)}`);
  }
  add(
    "small",
    "How scores work: each page starts at 100 and loses 25 / 10 / 3 / 1 points per critical / high / medium / low issue. Category scores apply the same weights to one category. These are this tool's health indicators — not Google's ranking scores.",
  );

  // 3–4. severity overview
  /** @type {Record<string, number>} */
  const sev = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const r of rows) sev[r.severity] = (sev[r.severity] ?? 0) + 1;
  add("h1", "2. Issue overview");
  for (const k of ["P0", "P1", "P2", "P3"])
    add("bullet", `${SEVERITY_LABEL[k]}: ${sev[k]} (URL-level occurrences)`);
  if (analysis) {
    const s = analysis.summary;
    add("h2", "Indexability and crawl");
    add("bullet", `${s.indexablePages} indexable, ${s.noindexPages} noindex, ${s.failedUrls} failed URL(s)`);
    add(
      "bullet",
      `Sitemap URLs: ${s.sitemapUrls} · deepest page: ${s.maxClickDepth} click(s) from the start page`,
    );
    add(
      "bullet",
      `Average response time: ${s.averageResponseMs} ms (measured from the auditing machine) · average length: ${s.averageWordCount} words`,
    );
    if (s.crawlCapped)
      add("bullet", "The crawl reached its page cap — findings cover the audited pages only.");
  }

  // 5. priorities
  add("h1", "3. What to fix first");
  const top = siteTopFindings(reports, 8);
  if (top.length === 0 && (analysis?.issues.length ?? 0) === 0)
    add("body", "No actionable issues were found.");
  for (const { finding: f, pages } of top) {
    const meta = getFindingMeta(String(f.id));
    add("h2", `[${f.severity}] ${f.title} — ${pages} of ${reports.length} page(s)`);
    add("body", dev ? `${f.id}: ${f.fix || meta.plain}` : meta.plain || f.fix);
    add("small", `Impact: ${meta.impact} · Effort: ${meta.effort} · Owner: ${meta.owner}`);
  }

  // site-level issues
  if (analysis && analysis.issues.length > 0) {
    add("h1", "4. Site-wide findings");
    for (const i of analysis.issues) {
      add("h2", `[${i.severity}] ${i.title}${i.heuristic ? " (heuristic)" : ""}`);
      add("body", dev ? `${i.id}: ${i.description}` : i.impact);
      add("body", `Fix (${i.fixType}): ${i.recommendation}`);
      if (dev) {
        for (const u of i.urls.slice(0, 10)) add("bullet", `${u.url} — ${u.detail}`);
        if (i.count > 10) add("small", `…and ${i.count - 10} more (see the CSV export for the full list).`);
      }
    }
  }

  // content + keywords (on-page only)
  if (analysis) {
    add("h1", "5. Content and topic analysis");
    const c = analysis.content;
    if (c.topics.length > 0) {
      add(
        "body",
        `Topics the site covers most (terms appearing prominently on 2+ pages): ${c.topics
          .slice(0, 15)
          .map((t) => `${t.term} (${t.pages})`)
          .join(", ")}.`,
      );
    }
    add(
      "small",
      "Keyword opportunities: on-page term frequency only. Search volume, keyword difficulty and ranking positions are not measured by a crawl — connect a keyword data provider or Search Console for those.",
    );
    if (c.underlinkedPages.length > 0) {
      add("h2", "Substantial pages with almost no internal links");
      for (const p of c.underlinkedPages.slice(0, 8))
        add("bullet", `${p.url} — ${p.wordCount} words, ${p.inlinks} inlink(s)`);
    }
    if (c.linkSuggestions.length > 0) {
      add("h2", "Suggested internal links (heuristic)");
      for (const s of c.linkSuggestions.slice(0, dev ? 15 : 5)) {
        add(
          "bullet",
          `${s.from} -> ${s.to} (anchor idea: "${s.anchor}"; shared: ${s.sharedTerms.join(", ")})`,
        );
      }
    }
    if (c.briefs.length > 0) {
      add("h2", "Pages that need a content refresh");
      for (const b of c.briefs.slice(0, dev ? 10 : 5)) add("bullet", `${b.url} — ${b.gaps.join("; ")}`);
    }
  }

  // competitors
  add("h1", "6. Competitor comparison");
  if (model.competitors && model.competitors.competitors.length > 0) {
    const own = model.competitors.own;
    add(
      "bullet",
      `This site: ${own.pages} page(s), avg ${own.averageWordCount} words, ${own.pagesWithStructuredData} with structured data`,
    );
    for (const c of model.competitors.competitors) {
      add(
        "bullet",
        `${c.url}: ${c.profile.pages} page(s), avg ${c.profile.averageWordCount} words, ${c.profile.pagesWithStructuredData} with structured data`,
      );
      if (c.termGaps.length > 0) {
        add(
          "body",
          `Topics they emphasise that this site does not: ${c.termGaps
            .slice(0, 15)
            .map((g) => g.term)
            .join(", ")}.`,
        );
      }
    }
    add("small", model.competitors.note);
  } else {
    add(
      "body",
      "Not collected in this audit. Run `one-step-seo audit <url> --competitors <url,url>` to compare crawled pages.",
    );
  }

  // performance
  add("h1", "7. Performance");
  const psiPages = reports.filter((r) => r.page?.psi);
  if (psiPages.length > 0) {
    for (const r of psiPages.slice(0, 10)) {
      const perf = r.page.psi?.lab?.performanceScore ?? r.page.psi?.performanceScore;
      add(
        "bullet",
        `${r.finalUrl} — PageSpeed performance: ${typeof perf === "number" ? perf : "see page report"}`,
      );
    }
  } else {
    add(
      "body",
      "Core Web Vitals were not measured (opt-in). Re-run with --psi and a PSI_API_KEY for Google PageSpeed Insights lab and field data.",
    );
  }

  // fixes + verification + history
  add("h1", "8. Fixes and verification");
  const sessions = model.fixSessions ?? [];
  if (sessions.length === 0) add("body", "No fixes have been applied by this tool for this site.");
  for (const s of sessions.slice(-5)) {
    const fixes = s.files.reduce((n, f) => n + f.fixes.length, 0);
    const cleared = s.files.reduce((n, f) => n + f.verified.filter((v) => v.cleared).length, 0);
    add(
      "bullet",
      `${s.createdAt.slice(0, 16).replace("T", " ")} — session ${s.id}: ${fixes} fix(es) in ${s.files.length} file(s), ${cleared} verified on disk, status ${s.status}`,
    );
  }
  if (model.verification) {
    const v = model.verification;
    add(
      "bullet",
      `Last verification ${v.checkedAt.slice(0, 10)}: ${v.resolved} resolved, ${v.regressed} new or worse, ${v.persisting} still open`,
    );
  }
  add("h1", "9. History");
  const hist = model.history ?? [];
  if (hist.length < 2) {
    add("body", "No earlier snapshots to compare yet. `one-step-seo monitor <url>` records one per run.");
  } else {
    for (const h of hist.slice(-10))
      add("bullet", `${h.takenAt.slice(0, 10)} — Search ${h.search ?? "n/a"}, AI ${h.ai ?? "n/a"}`);
  }

  // per-URL detail
  if (dev) {
    add("h1", "10. Issues by URL");
    for (const r of reports.slice(0, 200)) {
      const open = (r.findings ?? []).filter((f) => f && f.severity !== "pass");
      add("h2", `${r.finalUrl} — Search ${r.scores.search.score}, AI ${r.scores.ai.score}`);
      if (open.length === 0) add("bullet", "No open issues.");
      for (const f of open)
        add("bullet", `[${f.severity}] ${f.id} ${f.title}${f.evidence ? ` — ${f.evidence}` : ""}`);
    }
    if (reports.length > 200) add("small", `…${reports.length - 200} more pages in the CSV / JSON exports.`);
  }
  return out;
}

/**
 * Markdown site report.
 * @param {SiteReportModel} model
 * @param {RenderOptions} [opts]
 * @returns {string}
 */
export function renderSiteMarkdown(model, opts = {}) {
  /** @param {string} s */
  const md = (s) =>
    String(s)
      .replace(/([<>|])/g, "\\$1")
      .replace(/\r?\n+/g, " ");
  const lines = [];
  for (const b of siteReportOutline(model, opts)) {
    if (b.style === "title") lines.push(`# ${md(b.text)}`, "");
    else if (b.style === "h1") lines.push("", `## ${md(b.text)}`, "");
    else if (b.style === "h2") lines.push("", `### ${md(b.text)}`, "");
    else if (b.style === "bullet") lines.push(`- ${md(b.text)}`);
    else if (b.style === "small") lines.push("", `_${md(b.text)}_`, "");
    else if (b.style === "space") lines.push("");
    else lines.push(md(b.text), "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

/**
 * PDF site report (text-based, paginated).
 * @param {SiteReportModel} model
 * @param {RenderOptions} [opts]
 * @returns {Buffer}
 */
export function renderSitePdf(model, opts = {}) {
  return renderPdf(siteReportOutline(model, opts), {
    title: `SEO audit report — ${model.origin}`,
    footer: `${opts.brand ? `${opts.brand} · ` : ""}${model.origin} · generated by one-step-seo v${VERSION}`,
  });
}
