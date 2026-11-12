/**
 * one-step-seo — helpers shared by the CLI command modules.
 * Presentation only: everything here prints or writes report files. Analysis
 * lives in the engine modules (crawl / intelligence / autofix / monitor).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderMarkdown, renderHtml, renderSarif, renderCsv, siteTopFindings } from "../report.mjs";
import { getFindingMeta } from "../finding-meta.mjs";
import { c } from "../colors.mjs";
import { resolveStateDir } from "../state.mjs";

let interrupted = false;

/** @returns {boolean} true once the user pressed Ctrl-C */
export function isInterrupted() {
  return interrupted;
}

/**
 * First Ctrl-C asks running work to stop after the current page; a second
 * one exits immediately.
 */
export function installInterruptHandler() {
  process.on("SIGINT", () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.error("\nInterrupted — finishing current page, then exiting…");
  });
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

/**
 * State directory for this invocation (flag > env > ./.one-step-seo).
 * @param {import("../args.mjs").ParsedArgs} args
 * @returns {string}
 */
export function stateDirOf(args) {
  return resolveStateDir(args.stateDir);
}

/**
 * Crawl options derived from parsed CLI arguments.
 * @param {import("../args.mjs").ParsedArgs} args
 * @returns {import("../crawl.mjs").CrawlOptions}
 */
export function crawlOptionsFrom(args) {
  return {
    pages: args.pages,
    crawl: args.crawl,
    concurrency: args.concurrency,
    delay: args.delay,
    timeout: args.timeout,
    force: args.force,
    stripQuery: args.stripQuery,
    include: args.include,
    exclude: args.exclude,
    maxDepth: args.maxDepth,
    checkLinks: args.checkLinks,
    skills: args.skills,
    excludeSkills: args.excludeSkills,
    profile: args.profile,
    blockPrivateIps: args.blockPrivateIps,
    all: args.all,
  };
}

/**
 * Crawl hooks that print warnings, debug lines and a TTY progress line.
 * @param {import("../args.mjs").ParsedArgs} args
 * @returns {import("../crawl.mjs").CrawlHooks & { done: () => void }}
 */
export function crawlHooks(args) {
  const showProgress = args.pages > 1 && (process.stderr.isTTY || args.verbose) && !args.quiet;
  return {
    warn: (m) => console.error(m),
    debug: (m) => {
      if (args.debug) console.error("debug:", m);
    },
    progress: ({ done, total, queued, current }) => {
      if (!showProgress) return;
      const pct = Math.min(100, Math.round((done / total) * 100));
      process.stderr.write(
        `\r[${done}/${total} pages (${pct}%)] queue: ${queued} | crawling: ${current || "/"}...    `,
      );
    },
    isInterrupted,
    done: () => {
      if (showProgress) process.stderr.write(`\r${" ".repeat(80)}\r`);
    },
  };
}

/**
 * Explain why a crawl that was allowed more than one page audited only the
 * start page. Every reason is read from what the crawl measured (served
 * links, sitemap URLs) and from the page's own findings (T18, T06) — nothing
 * is guessed. Returns no lines when the crawl was not limited this way.
 * @param {object} input
 * @param {number} input.pageCount pages actually audited
 * @param {number} input.requestedPages the page budget (--pages)
 * @param {import("../report.mjs").Report | undefined} input.report the start page's report
 * @param {{ links: string[] } | undefined} input.facts the start page's crawl facts
 * @param {string[]} input.sitemapUrls URLs the sitemap(s) declared
 * @param {string} input.crawlMode links | sitemap | auto
 * @returns {string[]}
 */
export function singlePageDiscoveryNote({
  pageCount,
  requestedPages,
  report,
  facts,
  sitemapUrls,
  crawlMode,
}) {
  if (pageCount !== 1 || requestedPages <= 1 || !report || !facts) return [];
  const findings = report.findings ?? [];
  /** @param {string} id */
  const failing = (id) => findings.find((f) => f && f.id === id && f.severity !== "pass");
  const appShell = failing("T18-js-rendered");
  const sitemap = failing("T06-sitemap");

  /** @type {string[]} */
  const reasons = [];
  if (facts.links.length === 0) {
    reasons.push(
      appShell
        ? "the start page's served HTML has no links to other pages on this site — it is an empty app shell and its links are only created by JavaScript in a browser (T18-js-rendered)"
        : "the start page's served HTML has no links to other pages on this site",
    );
  } else {
    reasons.push(
      `the start page links to ${facts.links.length} other URL(s) on this site, but none could be audited (they failed, redirected to an already-audited page, or were excluded by robots.txt or --include/--exclude — see warnings above)`,
    );
  }
  if (sitemapUrls.length > 0) {
    reasons.push(`the sitemap lists ${sitemapUrls.length} URL(s), but none of them could be audited`);
  } else if (sitemap) {
    reasons.push(
      String(sitemap.evidence ?? "").includes("HTML page")
        ? "/sitemap.xml returns an HTML page instead of an XML sitemap, so it lists no URLs (T06-sitemap)"
        : "no XML sitemap was found to list other URLs (T06-sitemap)",
    );
  } else if (crawlMode === "links") {
    reasons.push("the sitemap was not read (--crawl links)");
  } else {
    reasons.push("the sitemap lists no other URLs on this site");
  }

  const lines = [c.bold("Why only 1 page:") + " no other pages were found to audit, because"];
  for (const r of reasons) lines.push(`  - ${r}`);
  lines.push(
    `  Re-running with more --pages will not find more. ${
      appShell
        ? "Server-render or pre-render the public pages and publish a real /sitemap.xml"
        : "Add internal links or publish an XML sitemap"
    }, then audit again.`,
  );
  return lines;
}

/**
 * Print the top 3 urgent fixes with triage labels + the next command.
 * @param {import("../report.mjs").Report} report
 * @param {string} rerun the exact command that reproduces this audit
 */
export function printTopFixes(report, rerun) {
  const top = (report.findings ?? []).filter((f) => f && f.severity !== "pass").slice(0, 3);
  if (top.length === 0) {
    console.log("Top fixes: none — all checks passed.");
  } else {
    console.log(c.bold("Top fixes:"));
    for (const f of top) {
      const meta = getFindingMeta(String(f.id ?? ""));
      const hint = String(f.fix || meta.plain).slice(0, 120);
      console.log(`  ${c.severityBadge(f.severity)} ${f.title} (${f.id}) — ${hint}`);
      console.log(`    Impact: ${meta.impact} · Effort: ${meta.effort} · Owner: ${meta.owner}`);
    }
  }
  console.log(`Next: fix the items above, then re-run \`${rerun}\`.`);
}

/**
 * Top fixes across all audited pages: worst severity first, then most
 * widespread. Each finding counts once per page it appears on.
 * @param {import("../report.mjs").Report[]} pageReports
 * @param {string} rerun the exact command that reproduces this audit
 */
export function printTopFixesSite(pageReports, rerun) {
  const n = pageReports.length;
  const top = siteTopFindings(pageReports, 3);
  if (top.length === 0) {
    console.log("Top fixes: none — all checks passed.");
  } else {
    console.log(c.bold(`Top fixes across ${n} page${n === 1 ? "" : "s"}:`));
    for (const { finding: f, pages } of top) {
      const meta = getFindingMeta(String(f.id ?? ""));
      const hint = String(f.fix || meta.plain).slice(0, 120);
      const scope = pages > 1 ? ` — on ${pages}/${n} pages` : "";
      console.log(`  ${c.severityBadge(f.severity)} ${f.title} (${f.id})${scope} — ${hint}`);
      console.log(`    Impact: ${meta.impact} · Effort: ${meta.effort} · Owner: ${meta.owner}`);
    }
  }
  console.log(`Next: fix the items above, then re-run \`${rerun}\`.`);
}

/**
 * Write the per-page report files for the requested formats.
 * (`pdf` is a site-level format and is written by the site artifact writer.)
 * @param {string} outDir
 * @param {import("../report.mjs").Report} report
 * @param {string[]} formats
 * @param {string} [basename]
 * @param {{ indexHref?: string, pageCount?: number }} [htmlOpts] forwarded to renderHtml
 * @returns {string[]} written paths
 */
export function writeOutputs(outDir, report, formats, basename = "report", htmlOpts) {
  mkdirSync(outDir, { recursive: true });
  const written = [];
  if (formats.includes("json")) {
    const p = join(outDir, `${basename}.json`);
    writeFileSync(p, JSON.stringify(report, null, 2) + "\n", "utf8");
    written.push(p);
  }
  if (formats.includes("md")) {
    const p = join(outDir, `${basename}.md`);
    writeFileSync(p, renderMarkdown(report), "utf8");
    written.push(p);
  }
  if (formats.includes("html")) {
    const p = join(outDir, `${basename}.html`);
    writeFileSync(p, renderHtml(report, htmlOpts), "utf8");
    written.push(p);
  }
  if (formats.includes("sarif")) {
    const p = join(outDir, `${basename}.sarif`);
    writeFileSync(p, JSON.stringify(renderSarif(report), null, 2) + "\n", "utf8");
    written.push(p);
  }
  if (formats.includes("csv")) {
    const p = join(outDir, `${basename}.csv`);
    writeFileSync(p, renderCsv(report), "utf8");
    written.push(p);
  }
  return written;
}

/** @param {string} severity @param {Record<string, number>} counts @returns {boolean} */
export function breachesFailOn(severity, counts) {
  if (!severity) return false;
  /** @type {Record<string, number>} */
  const rank = { P0: 0, P1: 1, P2: 2 };
  const threshold = rank[severity];
  if (threshold === undefined) return false;
  for (const [sev, r] of Object.entries(rank)) {
    if (r <= threshold && (counts[sev] ?? 0) > 0) return true;
  }
  return false;
}

/**
 * Print the standard "Wrote …" trailer.
 * @param {string[]} written
 * @param {string} outDir
 * @param {string} startHere
 */
export function printWritten(written, outDir, startHere) {
  if (written.length > 12) {
    console.log(`Wrote ${written.length} files into ${outDir} — start at ${startHere}.`);
  } else {
    console.log(`Wrote:\n  ${written.join("\n  ")}`);
  }
}
