/**
 * one-step-seo — SEO Auto-Fix engine (zero dependencies).
 *
 * Layers on top of the page fixers in lib/fix.mjs:
 *   - classification of every finding into safe / approval / manual
 *   - fix plans for remote audits (proposed changes only — a remote site is
 *     never modified, and nothing is reported as fixed)
 *   - site-file fixes for local source trees (sitemap.xml, robots.txt)
 *   - fix sessions: backup before modification, change history, rollback
 *   - on-disk verification: files are re-read and re-audited after writing,
 *     and a fix is only reported verified when its finding is actually gone
 *
 * Safety contract:
 *   - Only `safe` fixes are ever applied automatically. Anything that changes
 *     indexing, URLs, redirects, canonical strategy or existing copy is
 *     `approval` and is only ever proposed.
 *   - Existing robots.txt rules are never edited; the only automatic change to
 *     an existing robots.txt is appending a missing `Sitemap:` line.
 *   - Existing sitemap entries are never removed.
 */
import { readFileSync, existsSync, copyFileSync, rmSync, mkdirSync } from "node:fs";
import { join, relative, dirname, basename, sep } from "node:path";
import { planFixes } from "./fix.mjs";
import { analyzeLocalFile, collectHtmlFiles } from "./crawl.mjs";
import { extractSitemapUrls } from "./robots.mjs";
import { writeFileAtomic, writeJsonAtomic, readJson, sha256, newId, listDir } from "./state.mjs";
import { VERSION } from "./version.mjs";

/** @typedef {import("./intelligence.mjs").FixType} FixType */

/**
 * Approval-required finding ids (prefix match): acting on them changes
 * indexing, URL structure, redirects, canonical strategy or existing content.
 * @type {string[]}
 */
export const APPROVAL_FINDINGS = [
  "T03-redirects",
  "T07-noindex",
  "T08-canonical",
  "T17-canonical-http",
  "T12-url",
  "T05-robots-disallow",
  "O01-title-short",
  "O01-title-long",
  "O02-meta-short",
  "O02-meta-long",
  "O03-h1",
  "O04-headings",
  "O05-h2",
  "O08-alt",
  "O11-generic-anchors",
  "C0",
  "G02-ai-blocked",
  "G09-snippet-controls",
  "S03-faq-parity",
  "W03-hreflang",
];

/**
 * @param {string} s
 * @returns {string}
 */
function escAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Proposed markup for findings that have a mechanical, additive remedy.
 * Built only from data in the report itself (URL, title, description).
 * @type {Record<string, (report: any) => string>}
 */
const SAFE_SNIPPETS = {
  "T10-charset": () => `<meta charset="utf-8">`,
  "T11-viewport": () => `<meta name="viewport" content="width=device-width, initial-scale=1">`,
  "T08-canonical": (r) => `<link rel="canonical" href="${escAttr(r.finalUrl)}">`,
  "O06-og": (r) =>
    [
      r.page?.title ? `<meta property="og:title" content="${escAttr(r.page.title)}">` : "",
      r.page?.metaDescription
        ? `<meta property="og:description" content="${escAttr(r.page.metaDescription)}">`
        : "",
      `<meta property="og:url" content="${escAttr(r.finalUrl)}">`,
      `<!-- og:image needs a real, absolute image URL -->`,
    ]
      .filter(Boolean)
      .join("\n"),
  "W01-social": () => `<meta name="twitter:card" content="summary_large_image">`,
  "W02-og-url": (r) => `<meta property="og:url" content="${escAttr(r.finalUrl)}">`,
  "O07-favicon": () => `<link rel="icon" href="/favicon.ico">`,
  "O01-title-missing": (r) => (r.page?.h1?.[0] ? `<title>${escAttr(r.page.h1[0])}</title>` : ""),
  "S01-none": (r) =>
    r.page?.title
      ? `<script type="application/ld+json">${JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: r.page.title,
          url: r.finalUrl,
          ...(r.page.metaDescription ? { description: r.page.metaDescription } : {}),
        }).replace(/</g, String.fromCharCode(92) + "u003c")}</script>`
      : "",
};

/**
 * Classify a page finding and produce its proposed change (if any).
 * A missing canonical is safe to add (self-reference); a canonical that
 * points elsewhere is a strategy change and needs approval.
 * @param {{ id: string, title?: string }} finding
 * @param {any} report page report the finding belongs to
 * @returns {{ fixType: FixType, proposedChange: string }}
 */
export function classifyFinding(finding, report) {
  const id = String(finding?.id ?? "");
  if (id === "T08-canonical" && /missing/i.test(String(finding?.title ?? ""))) {
    return { fixType: "safe", proposedChange: SAFE_SNIPPETS["T08-canonical"]?.(report) ?? "" };
  }
  if (APPROVAL_FINDINGS.some((p) => id.startsWith(p))) return { fixType: "approval", proposedChange: "" };
  const snippet = SAFE_SNIPPETS[id]?.(report) ?? "";
  if (snippet) return { fixType: "safe", proposedChange: snippet };
  return { fixType: "manual", proposedChange: "" };
}

/**
 * @typedef {object} FixPlanEntry
 * @property {string} issueId
 * @property {"page" | "site"} scope
 * @property {string} url affected URL ("" for site-wide)
 * @property {string} severity
 * @property {string} description what was detected (with evidence)
 * @property {string} impact SEO impact
 * @property {string} recommendation
 * @property {string} proposedChange code/config to add ("" when none can be generated)
 * @property {FixType} fixType
 * @property {"proposed"} status remote plans are never applied
 * @property {"not-applied"} verification
 */

/**
 * XML-escape a URL for a sitemap <loc>.
 * @param {string} u
 * @returns {string}
 */
function xmlEsc(u) {
  return String(u)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Render a sitemap.xml for a list of absolute URLs (deduped, sorted).
 * @param {string[]} urls
 * @returns {string}
 */
export function buildSitemapXml(urls) {
  const unique = [...new Set(urls.filter((u) => /^https?:\/\//i.test(u)))].sort();
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    unique.map((u) => `  <url><loc>${xmlEsc(u)}</loc></url>\n`).join("") +
    `</urlset>\n`
  );
}

/**
 * Allow-all robots.txt that advertises the sitemap. Never restricts crawling.
 * @param {string} sitemapUrl
 * @returns {string}
 */
export function buildRobotsTxt(sitemapUrl) {
  return `User-agent: *\nAllow: /\n${sitemapUrl ? `\nSitemap: ${sitemapUrl}\n` : ""}`;
}

/**
 * Build a fix plan from audit results. Every entry is `proposed`: this is the
 * full issue-by-issue action list for a site the tool cannot write to.
 * @param {import("./report.mjs").Report[]} pageReports
 * @param {{ issues?: import("./intelligence.mjs").SiteIssue[] } | null} [analysis]
 * @param {{ safeOnly?: boolean, indexableUrls?: string[] }} [opts]
 * @returns {{ tool: string, version: string, generatedAt: string, mode: "plan", summary: Record<string, number>, entries: FixPlanEntry[], note: string }}
 */
export function buildFixPlan(pageReports, analysis = null, opts = {}) {
  /** @type {FixPlanEntry[]} */
  const entries = [];
  const reports = Array.isArray(pageReports) ? pageReports : [];
  for (const r of reports) {
    for (const f of r.findings ?? []) {
      if (!f || f.severity === "pass") continue;
      const { fixType, proposedChange } = classifyFinding(f, r);
      entries.push({
        issueId: f.id,
        scope: "page",
        url: r.finalUrl || r.url,
        severity: f.severity,
        description: `${f.title}${f.evidence ? ` — ${f.evidence}` : ""}`,
        impact: `Search: ${f.seoImpact || "-"} · AI visibility: ${f.geoImpact || "-"}`,
        recommendation: f.fix || "",
        proposedChange,
        fixType,
        status: "proposed",
        verification: "not-applied",
      });
    }
  }
  const first = reports[0];
  const origin = String(first?.site?.origin || "");
  // Site-file proposals, generated from pages that were actually audited.
  if (first && origin && /^https?:/i.test(origin)) {
    const urls = opts.indexableUrls ?? reports.map((r) => r.finalUrl);
    if (first.site?.sitemap === false && urls.length > 0) {
      entries.push({
        issueId: "T06-sitemap",
        scope: "site",
        url: `${origin}/sitemap.xml`,
        severity: "P1",
        description: `XML sitemap missing — generated from the ${urls.length} indexable page(s) audited in this run`,
        impact: "Search: medium · AI visibility: -",
        recommendation:
          "Publish this file at /sitemap.xml and reference it from robots.txt. Re-run with --all first so it lists every page.",
        proposedChange: buildSitemapXml(urls),
        fixType: "safe",
        status: "proposed",
        verification: "not-applied",
      });
    }
    if (first.site?.robots === false) {
      entries.push({
        issueId: "T05-robots",
        scope: "site",
        url: `${origin}/robots.txt`,
        severity: "P1",
        description: "robots.txt missing — allow-all starter that advertises the sitemap",
        impact: "Search: medium · AI visibility: medium",
        recommendation: "Publish this file at /robots.txt. It does not restrict any crawler.",
        proposedChange: buildRobotsTxt(`${origin}/sitemap.xml`),
        fixType: "safe",
        status: "proposed",
        verification: "not-applied",
      });
    }
  }
  for (const i of analysis?.issues ?? []) {
    for (const u of i.urls) {
      entries.push({
        issueId: i.id,
        scope: "site",
        url: u.url,
        severity: i.severity,
        description: `${i.title} — ${u.detail}`,
        impact: i.impact,
        recommendation: i.recommendation,
        proposedChange: "",
        fixType: i.fixType,
        status: "proposed",
        verification: "not-applied",
      });
    }
  }
  // The site-file proposals above supersede the per-page copies of the same finding.
  const siteIds = new Set(entries.filter((e) => e.scope === "site").map((e) => e.issueId));
  let kept = entries.filter((e) => !(e.scope === "page" && siteIds.has(e.issueId)));
  if (opts.safeOnly) kept = kept.filter((e) => e.fixType === "safe");
  /** @type {Record<string, number>} */
  const summary = { total: kept.length, safe: 0, approval: 0, manual: 0 };
  for (const e of kept) summary[e.fixType] = (summary[e.fixType] ?? 0) + 1;
  return {
    tool: "one-step-seo",
    version: VERSION,
    generatedAt: new Date().toISOString(),
    mode: "plan",
    summary,
    entries: kept,
    note: "Proposed changes only. Nothing was modified and nothing is fixed until the change is deployed and `one-step-seo verify` confirms it.",
  };
}

/**
 * Markdown rendering of a fix plan (grouped by fix type, then severity).
 * @param {ReturnType<typeof buildFixPlan>} plan
 * @returns {string}
 */
export function renderFixPlanMarkdown(plan) {
  /** @type {Record<string, number>} */
  const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
  /** @param {string} s */
  const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const lines = [
    `# SEO fix plan`,
    ``,
    `Generated ${plan.generatedAt} by one-step-seo v${plan.version}.`,
    ``,
    `> ${plan.note}`,
    ``,
    `| Fix type | Count | Meaning |`,
    `| --- | --- | --- |`,
    `| safe | ${plan.summary.safe ?? 0} | Additive, mechanical — apply to local source with \`one-step-seo fix <dir> --apply\` |`,
    `| approval | ${plan.summary.approval ?? 0} | Changes indexing, URLs or content — needs a human decision |`,
    `| manual | ${plan.summary.manual ?? 0} | Needs server configuration or new copy |`,
    ``,
  ];
  for (const type of ["safe", "approval", "manual"]) {
    const group = plan.entries
      .filter((e) => e.fixType === type)
      .sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
    if (group.length === 0) continue;
    lines.push(`## ${type[0]?.toUpperCase()}${type.slice(1)} fixes (${group.length})`, ``);
    for (const e of group) {
      lines.push(`### [${e.severity}] ${e.issueId} — ${e.url || "site-wide"}`, ``);
      lines.push(`- **Issue:** ${cell(e.description)}`);
      lines.push(`- **Impact:** ${cell(e.impact)}`);
      if (e.recommendation) lines.push(`- **Recommended:** ${cell(e.recommendation)}`);
      lines.push(`- **Status:** ${e.status} · **Verification:** ${e.verification}`);
      if (e.proposedChange) {
        const lang = e.proposedChange.startsWith("<?xml")
          ? "xml"
          : e.proposedChange.startsWith("<")
            ? "html"
            : "";
        const body =
          e.proposedChange.length > 4000 ? `${e.proposedChange.slice(0, 4000)}\n…` : e.proposedChange;
        lines.push(``, "```" + lang, body.trimEnd(), "```");
      }
      lines.push(``);
    }
  }
  return lines.join("\n");
}

/**
 * Derive the public URL of a local HTML file from a site base URL:
 * `<root>/blog/post.html` -> `<base>/blog/post.html`, `index.html` -> directory URL.
 * @param {string} baseUrl absolute http(s) URL of the site root
 * @param {string} rootDir
 * @param {string} file
 * @returns {string} "" when baseUrl is not a valid URL
 */
export function urlForFile(baseUrl, rootDir, file) {
  let rel = relative(rootDir, file).split(sep).join("/");
  if (/(^|\/)index\.html?$/i.test(rel)) rel = rel.replace(/index\.html?$/i, "");
  try {
    const base = new URL(baseUrl);
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    return new URL(rel.split("/").map(encodeURIComponent).join("/"), base).toString();
  } catch {
    return "";
  }
}

/**
 * Suggest alt text for images that have no alt attribute, derived from the
 * file name only. These are SUGGESTIONS for a human to confirm — a file name
 * is not a description, so they are never written automatically.
 * @param {{ src?: string, hasAlt?: boolean }[]} images
 * @returns {{ src: string, suggestedAlt: string }[]}
 */
export function suggestAltText(images) {
  /** @type {{ src: string, suggestedAlt: string }[]} */
  const out = [];
  for (const img of Array.isArray(images) ? images : []) {
    if (!img || img.hasAlt || !img.src) continue;
    const name = decodeURIComponentSafe(basename(String(img.src).split(/[?#]/)[0] ?? ""))
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b\d{2,}x\d{2,}\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    // Hashes, ids and camera file names say nothing about the picture.
    if (!name || !/[a-z]{3}/i.test(name) || /^(img|image|dsc|photo|screenshot)?\s*\d*$/i.test(name)) continue;
    out.push({ src: String(img.src), suggestedAlt: name[0]?.toUpperCase() + name.slice(1) });
  }
  return out;
}

/** @param {string} s @returns {string} */
function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Plan site-file fixes for a local source tree (pure: reads, never writes).
 * @param {string} rootDir absolute site root
 * @param {string[]} htmlFiles absolute paths under rootDir
 * @param {{ baseUrl?: string, only?: string[] | null }} [ctx]
 * @returns {{ planned: { name: string, findingId: string, file: string, summary: string, content: string, created: boolean }[], skipped: { name: string, reason: string }[] }}
 */
export function planSiteFixes(rootDir, htmlFiles, ctx = {}) {
  /** @type {{ name: string, findingId: string, file: string, summary: string, content: string, created: boolean }[]} */
  const planned = [];
  /** @type {{ name: string, reason: string }[]} */
  const skipped = [];
  const only = Array.isArray(ctx.only) && ctx.only.length > 0 ? ctx.only : null;
  const baseUrl = String(ctx.baseUrl || "");
  const sitemapPath = join(rootDir, "sitemap.xml");
  const robotsPath = join(rootDir, "robots.txt");
  let sitemapWillExist = existsSync(sitemapPath);

  if (!only || only.includes("sitemap")) {
    if (!baseUrl) {
      if (!existsSync(sitemapPath))
        skipped.push({
          name: "sitemap",
          reason: "needs --url (site base URL) to build absolute sitemap URLs",
        });
    } else {
      // Only indexable pages belong in a sitemap.
      const urls = htmlFiles
        .filter((f) => {
          try {
            const r = analyzeLocalFile(f, { siteRoot: rootDir });
            return !r.findings.some(
              (/** @type {any} */ x) => x.id === "T07-noindex" && x.severity !== "pass",
            );
          } catch {
            return false;
          }
        })
        .map((f) => urlForFile(baseUrl, rootDir, f))
        .filter(Boolean);
      if (!existsSync(sitemapPath)) {
        if (urls.length > 0) {
          planned.push({
            name: "sitemap",
            findingId: "T06-sitemap",
            file: sitemapPath,
            summary: `create sitemap.xml listing ${urls.length} indexable page(s)`,
            content: buildSitemapXml(urls),
            created: true,
          });
          sitemapWillExist = true;
        }
      } else {
        const text = readFileSync(sitemapPath, "utf8");
        const isUrlset = /<urlset[\s>]/i.test(text) && /<\/urlset\s*>/i.test(text);
        const have = new Set(extractSitemapUrls(text).map((u) => u.replace(/\/$/, "")));
        const missing = urls.filter((u) => !have.has(u.replace(/\/$/, "")));
        if (missing.length > 0 && isUrlset) {
          const add = missing
            .sort()
            .map((u) => `  <url><loc>${xmlEsc(u)}</loc></url>\n`)
            .join("");
          planned.push({
            name: "sitemap",
            findingId: "X13-missing-from-sitemap",
            file: sitemapPath,
            summary: `add ${missing.length} missing page(s) to sitemap.xml (existing entries untouched)`,
            content: text.replace(/<\/urlset\s*>/i, (close) => `${add}${close}`),
            created: false,
          });
        } else if (missing.length > 0) {
          skipped.push({
            name: "sitemap",
            reason: "existing sitemap.xml is not a plain <urlset> — left untouched",
          });
        }
      }
    }
  }

  if (!only || only.includes("robots")) {
    const sitemapUrl = baseUrl && sitemapWillExist ? urlForFile(baseUrl, rootDir, sitemapPath) : "";
    if (!existsSync(robotsPath)) {
      planned.push({
        name: "robots",
        findingId: "T05-robots",
        file: robotsPath,
        summary: `create allow-all robots.txt${sitemapUrl ? " with Sitemap: line" : ""}`,
        content: buildRobotsTxt(sitemapUrl),
        created: true,
      });
    } else if (sitemapUrl) {
      const text = readFileSync(robotsPath, "utf8");
      if (!/^\s*sitemap\s*:/im.test(text)) {
        planned.push({
          name: "robots",
          findingId: "T06-sitemap",
          file: robotsPath,
          summary: `append "Sitemap: ${sitemapUrl}" to robots.txt (crawl rules untouched)`,
          content: `${text.replace(/\s*$/, "")}\n\nSitemap: ${sitemapUrl}\n`,
          created: false,
        });
      }
    }
  }
  return { planned, skipped };
}

/** Site-file fixer names accepted by --only alongside FIXER_NAMES. */
export const SITE_FIXER_NAMES = ["sitemap", "robots"];

// ---------------------------------------------------------------------------
// Fix sessions: backup, history, rollback, verification
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SessionFile
 * @property {string} path absolute path of the modified file
 * @property {string} backup backup file name inside the session dir ("" when the file was created)
 * @property {boolean} created true when the fix created the file
 * @property {string} beforeSha sha256 before ("" when created)
 * @property {string} afterSha sha256 after
 * @property {string[]} fixes fixer names applied
 * @property {{ name: string, cleared: boolean }[]} verified on-disk verification per fixer
 * @property {{ before: number, after: number } | null} searchScore page Search score before/after (HTML files)
 * @property {string[]} resolvedFindings finding ids present before and gone after
 */

/**
 * @typedef {object} FixSession
 * @property {string} tool
 * @property {string} version
 * @property {string} id
 * @property {string} createdAt
 * @property {string} target
 * @property {"applied" | "rolled-back"} status
 * @property {string} [rolledBackAt]
 * @property {SessionFile[]} files
 */

/**
 * Directory holding fix sessions.
 * @param {string} stateDir
 * @returns {string}
 */
export function fixHistoryDir(stateDir) {
  return join(stateDir, "fix-history");
}

/**
 * Non-pass finding ids + Search score of a local HTML file (null when unreadable).
 * @param {string} file
 * @param {string} siteRoot
 * @returns {{ ids: Set<string>, search: number } | null}
 */
function snapshotFile(file, siteRoot) {
  try {
    const r = analyzeLocalFile(file, { siteRoot });
    return {
      ids: new Set(
        r.findings
          .filter((/** @type {any} */ f) => f.severity !== "pass")
          .map((/** @type {any} */ f) => String(f.id)),
      ),
      search: r.scores.search.score,
    };
  } catch {
    return null;
  }
}

/**
 * Apply planned changes as one recorded session: back up, write atomically,
 * then re-read every file from disk and verify.
 * @param {{
 *   stateDir: string,
 *   target: string,
 *   siteRoot: string,
 *   changes: { file: string, content: string, created?: boolean, fixes: string[], verify?: (onDisk: string) => { name: string, cleared: boolean }[] }[],
 *   backup?: boolean,
 * }} input
 * @returns {{ session: FixSession | null, files: SessionFile[], errors: { file: string, error: string }[] }}
 */
export function applyFixSession(input) {
  const backup = input.backup !== false;
  const id = newId();
  const dir = join(fixHistoryDir(input.stateDir), id);
  /** @type {SessionFile[]} */
  const files = [];
  /** @type {{ file: string, error: string }[]} */
  const errors = [];
  if (backup) mkdirSync(dir, { recursive: true });

  input.changes.forEach((ch, idx) => {
    const isHtml = /\.html?$/i.test(ch.file);
    const exists = existsSync(ch.file);
    const created = Boolean(ch.created) || !exists;
    try {
      const before = exists ? readFileSync(ch.file) : Buffer.alloc(0);
      const pre = isHtml && exists ? snapshotFile(ch.file, input.siteRoot) : null;
      let backupName = "";
      if (backup && exists) {
        backupName = `${String(idx).padStart(4, "0")}-${basename(ch.file)}`;
        copyFileSync(ch.file, join(dir, backupName));
      }
      writeFileAtomic(ch.file, ch.content);
      // Verification reads back what is actually on disk — never the planned string.
      const onDisk = readFileSync(ch.file);
      const post = isHtml ? snapshotFile(ch.file, input.siteRoot) : null;
      files.push({
        path: ch.file,
        backup: backupName,
        created,
        beforeSha: exists ? sha256(before) : "",
        afterSha: sha256(onDisk),
        fixes: ch.fixes,
        verified: ch.verify
          ? ch.verify(onDisk.toString("utf8"))
          : ch.fixes.map((name) => ({ name, cleared: onDisk.toString("utf8") === ch.content })),
        searchScore: pre && post ? { before: pre.search, after: post.search } : null,
        resolvedFindings: pre && post ? [...pre.ids].filter((x) => !post.ids.has(x)).sort() : [],
      });
    } catch (err) {
      errors.push({ file: ch.file, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** @type {FixSession | null} */
  let session = null;
  if (backup && files.length > 0) {
    session = {
      tool: "one-step-seo",
      version: VERSION,
      id,
      createdAt: new Date().toISOString(),
      target: input.target,
      status: "applied",
      files,
    };
    writeJsonAtomic(join(dir, "manifest.json"), session);
  } else if (backup) {
    rmSync(dir, { recursive: true, force: true });
  }
  return { session, files, errors };
}

/**
 * All recorded fix sessions, oldest first.
 * @param {string} stateDir
 * @returns {FixSession[]}
 */
export function listFixSessions(stateDir) {
  const root = fixHistoryDir(stateDir);
  /** @type {FixSession[]} */
  const out = [];
  for (const name of listDir(root)) {
    const m = readJson(join(root, name, "manifest.json"));
    if (m && m.tool === "one-step-seo" && Array.isArray(m.files)) out.push(m);
  }
  return out;
}

/**
 * Roll a session back: restore every file from its backup (or delete files the
 * session created). A file modified since the fix is NOT overwritten unless
 * `force` is set — its later edits would be lost.
 * @param {string} stateDir
 * @param {string} [sessionId] default: the most recent applied session
 * @param {{ force?: boolean }} [opts]
 * @returns {{ ok: boolean, error?: string, session?: FixSession, restored: string[], removed: string[], conflicts: string[] }}
 */
export function rollbackFixSession(stateDir, sessionId, opts = {}) {
  const sessions = listFixSessions(stateDir);
  const session = sessionId
    ? sessions.find((s) => s.id === sessionId)
    : [...sessions].reverse().find((s) => s.status === "applied");
  const empty = {
    restored: /** @type {string[]} */ ([]),
    removed: /** @type {string[]} */ ([]),
    conflicts: /** @type {string[]} */ ([]),
  };
  if (!session) {
    return {
      ok: false,
      error: sessionId ? `no fix session "${sessionId}"` : "no applied fix session to roll back",
      ...empty,
    };
  }
  if (session.status === "rolled-back") {
    return { ok: false, error: `session ${session.id} was already rolled back`, session, ...empty };
  }
  const dir = join(fixHistoryDir(stateDir), session.id);
  const conflicts = session.files
    .filter((f) => existsSync(f.path) && sha256(readFileSync(f.path)) !== f.afterSha)
    .map((f) => f.path);
  if (conflicts.length > 0 && !opts.force) {
    return {
      ok: false,
      error: `${conflicts.length} file(s) changed since the fix was applied — re-run with --force to overwrite them`,
      session,
      ...empty,
      conflicts,
    };
  }
  /** @type {string[]} */
  const restored = [];
  /** @type {string[]} */
  const removed = [];
  for (const f of session.files) {
    if (f.created) {
      rmSync(f.path, { force: true });
      removed.push(f.path);
    } else if (f.backup && existsSync(join(dir, f.backup))) {
      mkdirSync(dirname(f.path), { recursive: true });
      writeFileAtomic(f.path, readFileSync(join(dir, f.backup)));
      restored.push(f.path);
    }
  }
  session.status = "rolled-back";
  session.rolledBackAt = new Date().toISOString();
  writeJsonAtomic(join(dir, "manifest.json"), session);
  return { ok: true, session, restored, removed, conflicts };
}

/**
 * Plan page + site fixes for a local file or directory (pure: never writes).
 * For directories, `ctx.url` is the SITE BASE URL and each page gets its own
 * URL derived from its path — one shared URL would canonicalize every page to
 * the same address.
 * @param {string} target absolute path to an .html file or a directory
 * @param {import("./fix.mjs").FixContext & { isDirectory?: boolean }} [ctx]
 */
export function planLocalFixes(target, ctx = {}) {
  const isDir = Boolean(ctx.isDirectory);
  const rootDir = isDir ? target : dirname(target);
  const files = isDir ? collectHtmlFiles(target) : [target];
  const only = Array.isArray(ctx.only) && ctx.only.length > 0 ? ctx.only : null;
  const pageOnly = only ? only.filter((n) => !SITE_FIXER_NAMES.includes(n)) : null;
  const runPages = !only || (pageOnly?.length ?? 0) > 0;
  const pages = files.map((file) => {
    /** @type {string} */
    let html;
    try {
      html = readFileSync(file, "utf8");
    } catch (err) {
      return {
        file,
        html: "",
        error: err instanceof Error ? err.message : String(err),
        plan: null,
        pageCtx: null,
        altSuggestions: [],
      };
    }
    const pageUrl = isDir && ctx.url ? urlForFile(String(ctx.url), rootDir, file) : String(ctx.url || "");
    const pageCtx = { ...ctx, url: pageUrl, only: pageOnly };
    const plan = runPages
      ? planFixes(html, pageCtx)
      : { planned: [], skipped: [], verified: [], changed: false, newHtml: html };
    /** @type {{ src: string, suggestedAlt: string }[]} */
    let altSuggestions = [];
    try {
      altSuggestions = suggestAltText(analyzeLocalFile(file, { siteRoot: rootDir }).parsed.images);
    } catch {
      altSuggestions = [];
    }
    return { file, html, error: plan.error ?? null, plan, pageCtx, altSuggestions };
  });
  const site = isDir
    ? planSiteFixes(rootDir, files, { baseUrl: String(ctx.url || ""), only })
    : { planned: [], skipped: [] };
  return { rootDir, files, pages, site };
}
