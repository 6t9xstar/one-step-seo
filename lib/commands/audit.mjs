/**
 * one-step-seo — `audit` / `site` / `quick` / direct-target commands.
 *
 * `runSiteAudit()` and `runLocalAudit()` produce the data (crawl + site
 * intelligence + optional competitor comparison); the cmd* functions print
 * the summary and write the report files. `report`, `fix` (plan mode) and
 * `monitor` reuse the run* functions.
 */
import { writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  crawlSite,
  analyzeLocalFile,
  collectHtmlFiles,
  resolveLocalTarget,
  isHtmlFile,
  pageFacts,
  applySkillsFilter,
  toReport,
} from "../crawl.mjs";
import { analyzeSite, compareCompetitors } from "../intelligence.mjs";
import { crawlerCheckForAudit } from "./bots.mjs";
import { computeScores, scoreBand } from "../score.mjs";
import {
  renderSiteIndex,
  siteBasename,
  summarizeAggregate,
  buildSiteReport,
  coverageLine,
  findDuplicateTitles,
  escMd,
  SEV_RANK,
} from "../report.mjs";
import { renderSiteMarkdown, renderSiteCsv, renderSitePdf } from "../site-report.mjs";
import { fetchPsi, psiFindings } from "../psi.mjs";
import { canonicalizeUrl, normalizeUrl, CliError, MAX_PAGES } from "../args.mjs";
import { c } from "../colors.mjs";
import { VERSION, USER_AGENT } from "../version.mjs";
import {
  crawlOptionsFrom,
  crawlHooks,
  printTopFixes,
  printTopFixesSite,
  singlePageDiscoveryNote,
  writeOutputs,
  breachesFailOn,
  printWritten,
  isInterrupted,
  sleep,
} from "./shared.mjs";

/** Cap on competitor sites compared per audit, and pages crawled per competitor. */
export const MAX_COMPETITORS = 3;
export const COMPETITOR_PAGES = 5;

/**
 * @typedef {object} SiteAuditResult
 * @property {import("../crawl.mjs").CrawlResult} crawl
 * @property {ReturnType<typeof analyzeSite> | null} analysis
 * @property {ReturnType<typeof compareCompetitors> | null} competitors
 */

/**
 * Enrich page reports with PageSpeed Insights data (opt-in, needs PSI_API_KEY).
 * @param {import("../report.mjs").Report[]} pageReports
 * @param {import("../args.mjs").ParsedArgs} args
 * @param {string} psiKey
 */
async function applyPsi(pageReports, args, psiKey) {
  let first = true;
  for (const report of pageReports) {
    if (isInterrupted()) break;
    if (!first && args.delay > 0) await sleep(args.delay);
    first = false;
    if (args.debug) console.error("debug:", `fetching PSI for ${report.finalUrl} (${args.psiStrategy})...`);
    const psiRes = await fetchPsi(report.finalUrl, {
      key: psiKey,
      strategy: args.psiStrategy,
      timeoutMs: 25000,
      userAgent: USER_AGENT,
      blockPrivateIps: Boolean(args.blockPrivateIps),
    });
    if (psiRes.data) report.page.psi = psiRes.data;
    let extra = psiFindings(psiRes);
    if (args.skills || args.excludeSkills) extra = applySkillsFilter(extra, args.skills, args.excludeSkills);
    if (extra.length === 0) continue;
    for (const ef of extra) {
      report.findings.push(ef);
      report.counts[ef.severity] = (report.counts[ef.severity] ?? 0) + 1;
    }
    report.findings.sort((a, b) => (SEV_RANK[a.severity] ?? 5) - (SEV_RANK[b.severity] ?? 5));
    report.scores.search = computeScores(report.findings, { score: report.scores.ai.score }).search;
  }
}

/**
 * Crawl and analyze competitor sites listed in --competitors.
 * @param {import("../crawl.mjs").PageFacts[]} ownPages
 * @param {import("../args.mjs").ParsedArgs} args
 * @returns {Promise<ReturnType<typeof compareCompetitors> | null>}
 */
async function auditCompetitors(ownPages, args) {
  const urls = [
    ...new Set(
      args.competitors
        .split(",")
        .map((s) => normalizeUrl(s.trim()))
        .filter(Boolean),
    ),
  ];
  if (urls.length === 0) {
    throw new CliError(`--competitors needs one or more URLs, e.g. --competitors https://rival.example`);
  }
  if (urls.length > MAX_COMPETITORS) {
    console.error(`! comparing the first ${MAX_COMPETITORS} competitors only (${urls.length} given).`);
  }
  /** @type {{ url: string, pages: import("../crawl.mjs").PageFacts[] }[]} */
  const sets = [];
  for (const url of urls.slice(0, MAX_COMPETITORS)) {
    if (isInterrupted()) break;
    if (!args.quiet) console.error(`Comparing with ${url} (up to ${COMPETITOR_PAGES} pages)…`);
    const res = await crawlSite(
      url,
      {
        ...crawlOptionsFrom(args),
        pages: COMPETITOR_PAGES,
        crawl: "links",
        all: false,
        checkLinks: false,
        include: "",
        exclude: "",
        skills: "",
        excludeSkills: "",
        // A competitor's robots.txt is always honoured, whatever --force says.
        force: false,
        probes: false,
      },
      { warn: (m) => console.error(m), isInterrupted },
    );
    if (res.blocked) {
      console.error(`! ${url} disallows crawling in robots.txt — skipped.`);
      continue;
    }
    if (res.pages.length === 0) {
      console.error(`! ${url} could not be fetched — skipped.`);
      continue;
    }
    sets.push({ url, pages: res.pages });
  }
  return sets.length > 0 ? compareCompetitors(ownPages, sets) : null;
}

/**
 * Crawl a live site and run the site-level analysis.
 * @param {string} url
 * @param {import("../args.mjs").ParsedArgs} args
 * @returns {Promise<SiteAuditResult>}
 */
export async function runSiteAudit(url, args) {
  const psiKey = process.env.PSI_API_KEY;
  if (args.psi && !psiKey) {
    throw new CliError(
      `--psi requires the PSI_API_KEY environment variable.\nGet a free API key at https://developers.google.com/speed/docs/insights/v5/get-started and run:\n  PSI_API_KEY=your_key one-step-seo audit <url> --psi`,
      1,
    );
  }
  const hooks = crawlHooks(args);
  hooks.debug?.(
    `audit ${url} pages=${args.pages} crawl=${args.crawl} concurrency=${args.concurrency} delay=${args.delay} timeout=${args.timeout} force=${args.force}`,
  );
  const crawl = await crawlSite(url, crawlOptionsFrom(args), hooks);
  hooks.done();
  if (crawl.blocked || crawl.pageReports.length === 0) return { crawl, analysis: null, competitors: null };
  if (args.psi && psiKey) await applyPsi(crawl.pageReports, args, psiKey);
  const bots = args.bots ? await crawlerCheckForAudit(url, crawl.pages, args) : null;
  const analysis = analyzeSite({
    pages: crawl.pages,
    failures: crawl.failures,
    redirects: crawl.redirects,
    sitemapUrls: crawl.sitemapUrls,
    capped: crawl.capped,
    pageReports: crawl.pageReports,
    canon: (u) => canonicalizeUrl(u, Boolean(args.stripQuery)),
    probes: crawl.probes,
    bots,
  });
  const competitors = args.competitors ? await auditCompetitors(crawl.pages, args) : null;
  return { crawl, analysis, competitors };
}

/**
 * Write site-level artifacts (intelligence JSON, Markdown, CSV, PDF).
 * @param {string} outDir
 * @param {string[]} formats
 * @param {import("../site-report.mjs").SiteReportModel} model
 * @param {{ brand?: string, client?: string, audience?: string }} [opts]
 * @returns {string[]} written paths
 */
export function writeSiteArtifacts(outDir, formats, model, opts = {}) {
  mkdirSync(outDir, { recursive: true });
  /** @type {string[]} */
  const written = [];
  const render = {
    brand: opts.brand || "",
    client: opts.client || "",
    audience: /** @type {"full" | "client" | "developer"} */ (opts.audience || "full"),
  };
  if (formats.includes("json") && model.analysis) {
    const p = join(outDir, "site-intelligence.json");
    writeFileSync(
      p,
      JSON.stringify(
        {
          tool: "one-step-seo",
          reportType: "site-intelligence",
          version: VERSION,
          origin: model.origin,
          checkedAt: model.checkedAt,
          ...model.analysis,
          competitors: model.competitors ?? null,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    written.push(p);
  }
  if (formats.includes("md")) {
    const p = join(outDir, "site-report.md");
    writeFileSync(p, renderSiteMarkdown(model, render), "utf8");
    written.push(p);
  }
  if (formats.includes("csv")) {
    const p = join(outDir, "site-issues.csv");
    writeFileSync(p, renderSiteCsv(model), "utf8");
    written.push(p);
  }
  if (formats.includes("pdf")) {
    const p = join(outDir, "site-report.pdf");
    writeFileSync(p, renderSitePdf(model, render));
    written.push(p);
  }
  return written;
}

/**
 * Print the site-wide findings block.
 * @param {ReturnType<typeof analyzeSite>} analysis
 */
function printSiteFindings(analysis) {
  if (analysis.issues.length === 0) return;
  const s = analysis.summary.issueCounts;
  console.log(
    c.bold(`Site-wide findings: ${analysis.issues.length}`) +
      ` (P0=${s.P0 ?? 0} P1=${s.P1 ?? 0} P2=${s.P2 ?? 0} P3=${s.P3 ?? 0})`,
  );
  for (const i of analysis.issues.slice(0, 5)) {
    console.log(`  ${c.severityBadge(i.severity)} ${i.title} (${i.id})${i.heuristic ? " [heuristic]" : ""}`);
  }
  if (analysis.issues.length > 5) {
    console.log(`  …and ${analysis.issues.length - 5} more (see site-report.md / site-intelligence.json).`);
  }
}

/**
 * @param {string} url
 * @param {import("../args.mjs").ParsedArgs} args
 */
export async function cmdAudit(url, args) {
  const formats = args.formats;
  const { crawl, analysis, competitors } = await runSiteAudit(url, args);
  const pageReports = crawl.pageReports;
  const outDir = resolve(args.out);

  if (crawl.blocked) {
    console.error(
      `! robots.txt disallows auditing ${url} — crawl skipped (re-run with --force to override).`,
    );
    const report = pageReports[0];
    if (!report) return;
    const written = writeOutputs(outDir, report, formats);
    console.log(
      `\nSearch SEO: ${c.scoreBadge(report.scores.search.score, report.scores.search.band)}  |  AI Visibility: ${c.scoreBadge(report.scores.ai.score, report.scores.ai.band)}`,
    );
    printTopFixes(report, `one-step-seo audit ${url} --pages ${args.pages} --force`);
    console.log(`Wrote:\n  ${written.join("\n  ")}`);
    return;
  }

  if (pageReports.length === 0) {
    console.error("Audit failed: no pages could be fetched.");
    // Set exitCode instead of process.exit() so open fetch sockets can close
    // gracefully (abrupt exit crashes on Windows/Node 24, UV_HANDLE_CLOSING).
    process.exitCode = 2;
    return;
  }

  const withHtml = formats.includes("html");
  const orphans = crawl.orphanIndexes
    .map((idx) => pageReports[idx])
    .filter(/** @returns {r is import("../report.mjs").Report} */ (r) => Boolean(r));
  const dups = pageReports.length > 1 ? findDuplicateTitles(pageReports) : [];
  const isSiteAudit = pageReports.length > 1 || args.all || args._[0] === "site";
  const siteOpts =
    isSiteAudit && withHtml ? { indexHref: "index.html", pageCount: pageReports.length } : undefined;
  /** @type {string[]} */
  const written = [];
  pageReports.forEach((report, idx) => {
    written.push(...writeOutputs(outDir, report, formats, siteBasename(idx), siteOpts));
  });
  const origin = pageReports[0]?.finalUrl || url;
  if (formats.includes("json") && (args.all || args._[0] === "site")) {
    const siteReportPath = join(outDir, "site-report.json");
    writeFileSync(
      siteReportPath,
      JSON.stringify(buildSiteReport(pageReports, { version: VERSION, origin }), null, 2) + "\n",
      "utf8",
    );
    written.push(siteReportPath);
  }
  // A single-page audit writes site artifacts only for what needs them: the
  // PDF, a competitor comparison (JSON) and a crawler check (JSON, MD, CSV).
  const crawlerChecked = Boolean(analysis?.crawlerCheck);
  if (isSiteAudit || formats.includes("pdf") || competitors || crawlerChecked) {
    /** @param {string} f */
    const singlePageArtifact = (f) =>
      f === "pdf" ||
      (Boolean(competitors) && f === "json") ||
      (crawlerChecked && (f === "json" || f === "md" || f === "csv"));
    written.push(
      ...writeSiteArtifacts(
        outDir,
        isSiteAudit ? formats : formats.filter(singlePageArtifact),
        {
          origin,
          checkedAt: pageReports[0]?.checkedAt ?? new Date().toISOString(),
          pageReports,
          analysis,
          competitors,
        },
        args,
      ),
    );
  }
  // Index linking all pages. Format links are conditional: with
  // `--format json` no .md files exist, so unconditional links would 404.
  if (isSiteAudit) {
    const lines = [`# one-step-seo index`, ``, `Audited ${pageReports.length} pages.`, ``];
    if (withHtml) lines.push(`Browse the [site dashboard](./index.html).`, ``);
    if (formats.includes("md")) lines.push(`Site-wide analysis: [site-report.md](./site-report.md).`, ``);
    pageReports.forEach((r, idx) => {
      const name = siteBasename(idx);
      const links = [
        ...(formats.includes("md") ? [`[md](./${name}.md)`] : []),
        ...(formats.includes("json") ? [`[json](./${name}.json)`] : []),
        ...(formats.includes("html") ? [`[html](./${name}.html)`] : []),
        ...(formats.includes("sarif") ? [`[sarif](./${name}.sarif)`] : []),
        ...(formats.includes("csv") ? [`[csv](./${name}.csv)`] : []),
      ];
      lines.push(
        `- Page ${idx + 1}: ${r.finalUrl} — Search ${r.scores.search.score} (${r.scores.search.band}), AI ${r.scores.ai.score} (${r.scores.ai.band}) — ${links.join(" ")}`,
      );
    });
    lines.push(``);
    if (dups.length > 0) {
      lines.push(`## Duplicate titles & descriptions`, ``);
      for (const d of dups.slice(0, 10)) {
        const refs = d.pages.map((i) => `page ${i + 1}`).join(", ");
        lines.push(
          `- Duplicate ${d.kind} on ${refs}: "${d.value.slice(0, 120)}" — give each page a unique ${d.kind}.`,
        );
      }
      if (dups.length > 10) lines.push(`- …and ${dups.length - 10} more (see index.html).`);
      lines.push(``);
    }
    if (orphans.length > 0) {
      lines.push(`## Possibly orphaned pages`, ``);
      for (const o of orphans.slice(0, 10)) {
        lines.push(
          `- ${o.finalUrl} — no crawled page links to it (sitemap-only counts too); add contextual internal links or confirm it is intentionally standalone.`,
        );
      }
      if (orphans.length > 10) lines.push(`- …and ${orphans.length - 10} more (see index.html).`);
      lines.push(``);
    }
    if (analysis && analysis.issues.length > 0) {
      lines.push(`## Site-wide findings`, ``);
      for (const i of analysis.issues) {
        lines.push(`- [${i.severity}] ${i.title} (${i.id}) — ${i.count} URL(s). ${i.recommendation}`);
      }
      lines.push(``);
    }
    const indexPath = join(outDir, "index.md");
    writeFileSync(indexPath, lines.join("\n") + "\n", "utf8");
    written.push(indexPath);
    if (withHtml) {
      const dashboardPath = join(outDir, "index.html");
      writeFileSync(dashboardPath, renderSiteIndex(pageReports), "utf8");
      written.push(dashboardPath);
    }
  }

  const primary = pageReports[0];
  if (!primary) return;
  const agg = summarizeAggregate(pageReports);
  console.log(
    `\nSearch SEO: ${c.scoreBadge(primary.scores.search.score, primary.scores.search.band)}  |  AI Visibility: ${c.scoreBadge(primary.scores.ai.score, primary.scores.ai.band)}`,
  );
  console.log(
    `Pages audited: ${pageReports.length}${crawl.failed > 0 ? ` (${crawl.failed} failed or skipped — see warnings above)` : ""}`,
  );
  for (const line of singlePageDiscoveryNote({
    pageCount: pageReports.length,
    requestedPages: args.pages,
    report: primary,
    facts: crawl.pages[0],
    sitemapUrls: crawl.sitemapUrls,
    crawlMode: args.crawl,
  })) {
    console.log(line);
  }
  if (pageReports.length > 1) {
    console.log(
      `Aggregate: avg Search ${agg.avgSearch} / AI ${agg.avgAi} · min Search ${agg.minSearch} / AI ${agg.minAi}`,
    );
    console.log(
      `Totals: P0=${agg.totals.P0} P1=${agg.totals.P1} P2=${agg.totals.P2} P3=${agg.totals.P3} pass=${agg.totals.pass}`,
    );
    const coverage = coverageLine(pageReports.length, args.pages, crawl.capped, MAX_PAGES);
    if (coverage) console.log(coverage);
    if (dups.length > 0) {
      const dupTitles = dups.filter((d) => d.kind === "title").length;
      const dupMetas = dups.length - dupTitles;
      /** @type {string[]} */
      const parts = [];
      if (dupTitles > 0) parts.push(`${dupTitles} title${dupTitles === 1 ? "" : "s"}`);
      if (dupMetas > 0) parts.push(`${dupMetas} description${dupMetas === 1 ? "" : "s"}`);
      console.log(`Duplicates: shared ${parts.join(" + ")} across pages (see index.md).`);
    }
    if (orphans.length > 0) {
      console.log(`Orphaned pages (no inlinks from crawled pages):`);
      for (const o of orphans.slice(0, 5)) console.log(`  - ${o.finalUrl}`);
      if (orphans.length > 5) console.log(`  …and ${orphans.length - 5} more (see index.md).`);
    }
  }
  // A multi-page request that found one page still shows site findings (soft-404
  // probes), and so does a crawler check (--bots).
  if ((isSiteAudit || args.pages > 1 || args.bots) && analysis) printSiteFindings(analysis);
  if (competitors) {
    for (const comp of competitors.competitors) {
      console.log(
        `Competitor ${comp.url}: ${comp.profile.pages} page(s), avg ${comp.profile.averageWordCount} words (yours ${competitors.own.averageWordCount}); ${comp.termGaps.length} topic term(s) they emphasise that you do not.`,
      );
    }
    console.log(`  (lexical comparison of crawled pages — not search volume or rankings)`);
  }
  console.log(
    `Counts: P0=${primary.counts.P0} P1=${primary.counts.P1} P2=${primary.counts.P2} P3=${primary.counts.P3} pass=${primary.counts.pass}`,
  );
  if (pageReports.length > 1) {
    printTopFixesSite(pageReports, `one-step-seo audit ${url} --pages ${args.pages}`);
  } else {
    printTopFixes(primary, `one-step-seo audit ${url} --pages ${args.pages}`);
  }
  printWritten(
    written,
    outDir,
    pageReports.length > 1 && withHtml ? join(outDir, "index.html") : join(outDir, "index.md"),
  );

  if (args.failOn) {
    const breached = pageReports.some((r) => breachesFailOn(args.failOn, r.counts));
    if (breached) {
      console.error(`Fail-on threshold breached: found ${args.failOn} (or higher) findings.`);
      process.exitCode = 2;
    }
  }
}

/**
 * Map a local file:// link onto the audited tree: directory links resolve to
 * their index.html, and root-absolute links (`/about.html`) are re-rooted at
 * the site directory instead of the filesystem root.
 * @param {string} rootUrl file:// URL of the site root, with trailing slash
 * @returns {(u: string) => string}
 */
export function localCanon(rootUrl) {
  return (u) => {
    let url;
    try {
      url = new URL(u);
    } catch {
      return "";
    }
    if (url.protocol !== "file:") return "";
    url.hash = "";
    url.search = "";
    let s = url.toString();
    if (!s.startsWith(rootUrl)) {
      const tail = url.pathname.replace(/^\/[A-Za-z]:/, "").replace(/^\/+/, "");
      s = rootUrl + tail;
    }
    if (s.endsWith("/")) s += "index.html";
    return s;
  };
}

/**
 * Audit a local file or directory offline and run the site-level analysis.
 * @param {string} dirPath absolute path (directory, or a single .html file)
 * @param {import("../args.mjs").ParsedArgs} args
 * @param {(index: number, total: number, file: string) => void} [onPage]
 */
export function runLocalAudit(dirPath, args, onPage) {
  const isDir = statSync(dirPath).isDirectory();
  const files = isDir ? collectHtmlFiles(dirPath) : isHtmlFile(dirPath) ? [dirPath] : [];
  const siteRoot = isDir ? dirPath : resolve(dirPath, "..");
  const rootUrl = pathToFileURL(siteRoot).toString().replace(/\/?$/, "/");
  const canon = localCanon(rootUrl);
  const targets = files.slice(0, Math.min(files.length, args.pages));
  /** @type {import("../report.mjs").Report[]} */
  const pageReports = [];
  /** @type {import("../crawl.mjs").PageFacts[]} */
  const pages = [];
  /** @type {Map<string, string[]>} */
  const referrers = new Map();
  for (let i = 0; i < targets.length; i++) {
    if (isInterrupted()) break;
    const file = targets[i];
    if (!file) continue;
    // Site files (robots.txt / sitemap.xml / llms.txt) live at the site root —
    // not next to each nested page.
    const r = analyzeLocalFile(file, { profile: args.profile, siteRoot });
    const facts = pageFacts(r, r.fetched.finalUrl, canon);
    if (args.skills || args.excludeSkills) {
      r.findings = applySkillsFilter(r.findings, args.skills, args.excludeSkills);
      r.scores = computeScores(r.findings, r.geo);
    }
    pageReports.push(toReport(r, r.fetched.finalUrl));
    pages.push(facts);
    for (const l of facts.links) {
      const refs = referrers.get(l) ?? [];
      if (refs.length < 5) refs.push(facts.finalUrl);
      referrers.set(l, refs);
    }
    onPage?.(i, targets.length, file);
  }
  // Links to local files that do not exist are broken internal links.
  /** @type {import("../crawl.mjs").CrawlFailure[]} */
  const failures = [];
  for (const [link, refs] of referrers) {
    if (!link.startsWith(rootUrl)) continue;
    let path = "";
    try {
      path = fileURLToPath(link);
    } catch {
      continue;
    }
    if (!existsSync(path)) {
      failures.push({ url: link, status: 404, error: "file not found", kind: "fetch", referrers: refs });
    }
  }
  const capped = targets.length < files.length;
  const analysis =
    pages.length > 0 ? analyzeSite({ pages, failures, sitemapUrls: [], capped, pageReports, canon }) : null;
  return { files, targets, siteRoot, pageReports, pages, failures, analysis, capped };
}

/**
 * Audit a single local HTML file directly from disk.
 * @param {string} rawTarget
 * @param {import("../args.mjs").ParsedArgs} args
 */
export function auditLocalFile(rawTarget, args) {
  const filePath = resolveLocalTarget(rawTarget);
  if (!filePath) {
    console.error(`Invalid file URL: ${rawTarget}`);
    process.exit(1);
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    console.error(`Local file not found: ${rawTarget}`);
    process.exit(1);
  }
  const r = analyzeLocalFile(filePath, { profile: args.profile });
  if (args.skills || args.excludeSkills) {
    r.findings = applySkillsFilter(r.findings, args.skills, args.excludeSkills);
    r.scores = computeScores(r.findings, r.geo);
  }
  const report = toReport(r, r.fetched.finalUrl);
  const outDir = resolve(args.out);
  const written = writeOutputs(outDir, report, args.formats);
  if (args.formats.includes("pdf")) {
    written.push(
      ...writeSiteArtifacts(
        outDir,
        ["pdf"],
        { origin: rawTarget, checkedAt: report.checkedAt, pageReports: [report], analysis: null },
        args,
      ),
    );
  }
  console.log(
    `Search SEO: ${c.scoreBadge(report.scores.search.score, report.scores.search.band)}  |  AI Visibility: ${c.scoreBadge(report.scores.ai.score, report.scores.ai.band)}`,
  );
  printTopFixes(report, `one-step-seo page ${rawTarget}`);
  console.log(`Wrote:\n  ${written.join("\n  ")}`);
  if (args.failOn && breachesFailOn(args.failOn, report.counts)) {
    console.error(`Fail-on threshold breached: found ${args.failOn} (or higher) findings.`);
    process.exitCode = 2;
  }
}

/**
 * Audit a local directory of HTML files offline.
 * @param {string} rawTarget
 * @param {import("../args.mjs").ParsedArgs} args
 */
export function auditLocalDirectory(rawTarget, args) {
  const dirPath = resolveLocalTarget(rawTarget);
  if (!dirPath) {
    console.error(`Invalid file URL: ${rawTarget}`);
    process.exit(1);
  }
  if (!existsSync(dirPath)) {
    console.error(`Path not found: ${rawTarget}`);
    process.exit(1);
  }
  const outDir = resolve(args.out);
  const withHtml = args.formats.includes("html");
  /** @type {string[]} */
  const written = [];
  const audit = runLocalAudit(dirPath, args, (i, total, file) => {
    if (!args.quiet) console.log(`[${i + 1}/${total}] ${relative(process.cwd(), file)}`);
  });
  if (audit.files.length === 0) {
    console.error(`No .html or .htm files found in: ${rawTarget}`);
    process.exit(1);
  }
  const { pageReports, analysis } = audit;
  pageReports.forEach((report, i) => {
    written.push(
      ...writeOutputs(outDir, report, args.formats, i === 0 ? "report" : `report-${i + 1}`, {
        indexHref: withHtml && audit.targets.length > 1 ? "index.html" : undefined,
        pageCount: audit.targets.length,
      }),
    );
  });

  const primary = pageReports[0];
  if (!primary) return;

  if (pageReports.length > 1) {
    const agg = summarizeAggregate(pageReports);
    const avgSearch = agg.avgSearch ?? 0;
    const avgAi = agg.avgAi ?? 0;
    const searchBand = scoreBand(avgSearch);
    const aiBand = scoreBand(avgAi);
    console.log(
      `\nAudited ${pageReports.length} local page(s):\n` +
        `  Search SEO: ${c.scoreBadge(avgSearch, searchBand)}  |  AI Visibility: ${c.scoreBadge(avgAi, aiBand)}  (avg across pages)\n` +
        `  Lowest page: Search ${agg.minSearch} · AI ${agg.minAi}\n` +
        `  Aggregate findings: P0=${agg.totals.P0} P1=${agg.totals.P1} P2=${agg.totals.P2} P3=${agg.totals.P3} pass=${agg.totals.pass}`,
    );
    if (args.formats.includes("md")) {
      const idxPath = join(outDir, "index.md");
      const dups = findDuplicateTitles(pageReports);
      const lines = [
        `# Audit index — ${escMd(rawTarget)}`,
        "",
        `Generated: ${new Date().toISOString()}`,
        `Pages audited: ${pageReports.length}`,
        `Average Search score: **${avgSearch} (${searchBand})** · Average AI score: **${avgAi} (${aiBand})**`,
        "",
        "## Pages",
        "",
      ];
      for (let i = 0; i < pageReports.length; i++) {
        const pr = pageReports[i];
        if (!pr) continue;
        const b = i === 0 ? "report" : `report-${i + 1}`;
        const links = [
          ...(args.formats.includes("md") ? [`[md](./${b}.md)`] : []),
          ...(args.formats.includes("json") ? [`[json](./${b}.json)`] : []),
          ...(args.formats.includes("html") ? [`[html](./${b}.html)`] : []),
          ...(args.formats.includes("sarif") ? [`[sarif](./${b}.sarif)`] : []),
          ...(args.formats.includes("csv") ? [`[csv](./${b}.csv)`] : []),
        ];
        lines.push(
          `- ${escMd(pr.page.title || pr.url)} — Search ${pr.scores.search.score}, AI ${pr.scores.ai.score} — ${links.join(" ")}`,
        );
      }
      lines.push("");
      if (dups.length > 0) {
        lines.push(`## Duplicate titles & descriptions`, ``);
        for (const d of dups.slice(0, 10)) {
          const refs = d.pages.map((idx) => `page ${idx + 1}`).join(", ");
          lines.push(
            `- Duplicate ${d.kind} on ${refs}: "${escMd(d.value.slice(0, 120))}" — give each page a unique ${d.kind}.`,
          );
        }
        if (dups.length > 10) lines.push(`- …and ${dups.length - 10} more.`);
        lines.push(``);
      }
      if (analysis && analysis.issues.length > 0) {
        lines.push(`## Site-wide findings`, ``);
        for (const i of analysis.issues) {
          lines.push(`- [${i.severity}] ${escMd(i.title)} (${i.id}) — ${i.count} URL(s).`);
        }
        lines.push(``);
      }
      writeFileSync(idxPath, lines.join("\n"), "utf8");
      written.push(idxPath);
    }
    if (args.formats.includes("json") && (args.all || args._[0] === "site")) {
      const siteReportPath = join(outDir, "site-report.json");
      writeFileSync(
        siteReportPath,
        JSON.stringify(buildSiteReport(pageReports, { version: VERSION, origin: rawTarget }), null, 2) + "\n",
        "utf8",
      );
      written.push(siteReportPath);
    }
    written.push(
      ...writeSiteArtifacts(
        outDir,
        args.formats,
        { origin: rawTarget, checkedAt: primary.checkedAt, pageReports, analysis },
        args,
      ),
    );
    if (withHtml) {
      const idxHtml = join(outDir, "index.html");
      writeFileSync(idxHtml, renderSiteIndex(pageReports), "utf8");
      written.push(idxHtml);
    }
    if (analysis) printSiteFindings(analysis);
    printTopFixesSite(pageReports, `one-step-seo audit ${rawTarget} --pages ${args.pages}`);
  } else {
    if (args.formats.includes("pdf")) {
      written.push(
        ...writeSiteArtifacts(
          outDir,
          ["pdf"],
          { origin: rawTarget, checkedAt: primary.checkedAt, pageReports, analysis },
          args,
        ),
      );
    }
    console.log(
      `\nSearch SEO: ${c.scoreBadge(primary.scores.search.score, primary.scores.search.band)}  |  AI Visibility: ${c.scoreBadge(primary.scores.ai.score, primary.scores.ai.band)}`,
    );
    printTopFixes(primary, `one-step-seo audit ${rawTarget} --pages ${args.pages}`);
  }
  if (audit.capped && !args.quiet) {
    console.log(
      `Audited ${audit.targets.length} of ${audit.files.length} HTML files — add --pages all (or --deep) to audit the whole directory.`,
    );
  }

  printWritten(
    written,
    outDir,
    pageReports.length > 1 && withHtml ? join(outDir, "index.html") : join(outDir, "index.md"),
  );

  if (args.failOn) {
    const breached = pageReports.some((r) => breachesFailOn(args.failOn, r.counts));
    if (breached) {
      console.error(`Fail-on threshold breached: found ${args.failOn} (or higher) findings.`);
      process.exitCode = 2;
    }
  }
}
