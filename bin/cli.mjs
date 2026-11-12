#!/usr/bin/env node
/**
 * one-step-seo CLI — zero dependencies, Node 18+.
 * Usage:
 *   one-step-seo audit <url> [--pages N] [--out DIR] [--format html,md,json] [--fail-on P0] [--crawl links|sitemap]
 *   one-step-seo page <url> [--out DIR] [--format html,md,json]
 *   one-step-seo quick <url> [--pages N] [--out DIR]
 *   one-step-seo schema <url> [--generate organization|website|article|faq|breadcrumb|product|event|localbusiness|howto]
 *   one-step-seo sitemap <url> [--json]
 *   one-step-seo llms <url> [--json]
 *   one-step-seo fix <path> [--apply] [--only a,b] [--url U] [--title T] [--description D] [--lang L] [--og-image U]
 *   one-step-seo diff <old-report.json> <new-report.json> [--json] [--fail-on P0]
 *   one-step-seo doctor [--json]
 *   one-step-seo (no command → interactive prompts on a TTY)
 */
import { readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fetchWithRedirects } from "../lib/fetch.mjs";
import { parseHtml } from "../lib/html.mjs";
import { getSiteFiles, getSitemapUrls, isDisallowed } from "../lib/robots.mjs";
import { MAX_LINK_CHECKS } from "../lib/checks.mjs";
import { schemaSnippet } from "../lib/schema.mjs";
import { computeScores } from "../lib/score.mjs";
import { SEV_RANK } from "../lib/report.mjs";
import { getFindingMeta, FINDING_META } from "../lib/finding-meta.mjs";
import { parseArgs, normalizeUrl, isLocalPath, CliError, MAX_PAGES } from "../lib/args.mjs";
import { diffReports, isReport } from "../lib/report-diff.mjs";
import { fetchPsi, psiFindings } from "../lib/psi.mjs";
import { createColorHelper, c } from "../lib/colors.mjs";
import { getSkills, getSkill, CATEGORIES } from "../lib/skills.mjs";
import {
  analyzeOne,
  analyzeLocalFile,
  toReport,
  blockedReport,
  checkPageLinks,
  applySkillsFilter,
  robotsPathOf,
  resolveLocalTarget,
} from "../lib/crawl.mjs";
import { VERSION, USER_AGENT as UA, UA_TOKEN } from "../lib/version.mjs";
import { loadConfig, extractConfigFlag, CONFIG_FILE } from "../lib/config.mjs";
import { resolveStateDir } from "../lib/state.mjs";
import {
  printTopFixes,
  writeOutputs,
  breachesFailOn,
  installInterruptHandler,
} from "../lib/commands/shared.mjs";
import { cmdAudit, auditLocalFile, auditLocalDirectory, writeSiteArtifacts } from "../lib/commands/audit.mjs";
import { cmdFix, ALL_FIXER_NAMES } from "../lib/commands/fix.mjs";
import { cmdVerify } from "../lib/commands/verify.mjs";
import { cmdMonitor } from "../lib/commands/monitor.mjs";
import { cmdReport } from "../lib/commands/report.mjs";

export { createColorHelper, c, analyzeOne };

/**
 * Check robots.txt for a crawl start URL. Warms the per-origin site-file
 * cache as a side effect. Never throws — a missing robots.txt means allowed.
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 * @returns {Promise<{ blocked: boolean, robotsText: string }>}
 */
async function checkRobotsAllowed(url, args) {
  let text = "";
  try {
    const site = await getSiteFiles(url, {
      timeoutMs: args.timeout,
      userAgent: UA,
      blockPrivateIps: Boolean(args.blockPrivateIps),
    });
    text = site.robots.text ?? "";
    if (args.debug) {
      console.error(
        `debug: robots.txt ${site.robots.found ? `found (${site.robots.disallowCount} disallow rules)` : "missing"} for ${site.origin}`,
      );
    }
  } catch {
    // Best-effort: without robots.txt there is nothing to enforce.
    text = "";
  }
  const blocked = !args.force && text !== "" && isDisallowed(text, UA_TOKEN, robotsPathOf(url));
  return { blocked, robotsText: text };
}

/**
 * Resolve and analyze a local HTML target (path or file:// URL), exiting with
 * a usage error when it does not exist.
 * @param {string} rawTarget
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
function analyzeLocalTarget(rawTarget, args) {
  const filePath = resolveLocalTarget(rawTarget);
  if (!filePath) {
    console.error(`Invalid file URL: ${rawTarget}`);
    process.exit(1);
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    console.error(`Local file not found: ${rawTarget}`);
    process.exit(1);
  }
  return analyzeLocalFile(filePath, { profile: args.profile });
}

function usage(code = 0) {
  console.log(`one-step-seo v${VERSION} — one command SEO + AI-visibility audit
Usage:
  one-step-seo [url|dir] (auto-find all website pages and provide full all-page report)
  one-step-seo site <url|dir> [--pages N|all] [--out DIR] [--crawl auto|links|sitemap]
  one-step-seo audit <url|dir> [--all] [--pages N|all] [--out DIR] [--format html,md,json] [--fail-on P0|P1|P2] [--crawl auto|links|sitemap] [--skills S] [--offline]
  one-step-seo page <url|file> [--out DIR] [--format html,md,json] [--skills S] [--offline]
  one-step-seo ai <url> [--out DIR] [--format html,md,json] [--json]
  one-step-seo quick <url|dir> [--pages N] [--out DIR]
  one-step-seo skills [skill-id] [--json]
  one-step-seo schema <url> [--generate organization|website|article|faq|breadcrumb|product|event|localbusiness|howto|video|job|course|review|recipe]
  one-step-seo sitemap <url> [--json]
  one-step-seo llms <url> [--json]
  one-step-seo audit <url> --deep | --technical | --on-page | --competitors URL[,URL]
  one-step-seo fix <path> [--apply] [--only NAMES] [--url U] [--title T] [--description D] [--lang L] [--og-image U]
  one-step-seo fix <url> [--safe-only] [--pages N|--all]   (fix plan: proposed changes, nothing modified)
  one-step-seo fix --history | --rollback [--session ID] [--force]
  one-step-seo verify [url|dir] [--baseline DIR] [--fail-on P0|P1|P2]
  one-step-seo report <url|dir|audit-folder> [--format pdf,md,csv,json] [--brand NAME] [--client NAME] [--audience full|client|developer]
  one-step-seo monitor <url> [--pages N] [--interval MIN] [--webhook URL] [--history] [--fail-on P0|P1|P2]
  one-step-seo diff <old-report.json> <new-report.json> [--json] [--fail-on P0|P1|P2]
  one-step-seo doctor [--json] [--check-config]
  one-step-seo (no command: interactive prompts when attached to a TTY)

Options:
  --all           auto-discover and audit all pages across the website (hybrid sitemap + link crawl)
  --pages N|all   pages to crawl (default 1, max 1000, or 'all'; 'quick' defaults to 5; 'site' defaults to all)
  --max-depth N   limit crawl depth from seed URL (1-50, default unlimited)
  --include PAT   only crawl URL paths matching substring or regex pattern
  --exclude PAT   skip URL paths matching substring or regex pattern
  --strip-query   strip search query parameters during crawl deduplication
  --out DIR       output directory (default ./seo-report)
  --format        comma list among html,md,json,sarif,csv,pdf (default html,md,json)
  --timeout MS    per-request timeout in ms (default 15000, 1000-120000)
  --fail-on SEV   exit 2 when any page has P0 (or P1/P2) findings — for CI gating
  --crawl MODE    audit discovery: auto (hybrid sitemap + link BFS), links, or sitemap (default links)
  --concurrency N parallel page fetches 1-8 (default 4)
  --delay MS      politeness pause between crawl batches in ms (default 250, 0-10000)
  --skills LIST   comma list of skill IDs or categories (e.g. onpage,schema,technical-seo)
  --exclude-skills LIST comma list of skill IDs or categories to exclude
  --offline       audit purely offline without network requests (local file/dir auditing)
  --debug         verbose diagnostics: parsed args, robots.txt status, per-page timings
  --quiet, -q     suppress informational messages; output errors and final summaries only
  --force         crawl even when robots.txt disallows the URL (documented override)
  --check-links   verify same-host link targets (capped at 100 checks/run, off by default)
  --block-private-ips  block SSRF requests targeting private, loopback, or metadata IPs
  --check-config  validate runtime configuration, CLI flags, and environment health
  --profile NAME  page-type calibration: default|blog|product|docs|home (default default)
  --psi           measure Core Web Vitals via Google PageSpeed Insights (reads PSI_API_KEY)
  --psi-strategy  performance strategy: mobile (default) or desktop
  --json          print JSON to stdout (sitemap / llms / doctor / fix / diff / ai / skills / verify / monitor)
  --deep          full-site crawl + link verification + site-wide analysis (same as --all --check-links)
  --technical     only technical checks (technical, security, performance skills)
  --on-page       only on-page checks (on-page, schema, content architecture, accessibility skills)
  --competitors L compare with up to 3 competitor sites (5 pages each; lexical, not search-volume data)
  --config FILE   read flag defaults from a JSON file (default ./${CONFIG_FILE}; --no-config to ignore)
  --state-dir DIR where fix history and monitoring snapshots are stored (default ./.one-step-seo)

Verify / report / monitor options:
  --baseline DIR  folder holding the earlier report*.json to verify against (default --out)
  --brand NAME    agency or author name printed on site reports
  --client NAME   client name printed on site reports
  --audience A    full (default), client (plain-language summary) or developer (every URL + evidence)
  --interval MIN  monitor: keep running and re-check every MIN minutes (1-10080)
  --webhook URL   monitor: POST alerts as JSON (or set ONE_STEP_SEO_WEBHOOK; never stored in config)
  --keep N        monitor: snapshots to retain per site (default 60)
  --history       monitor: list stored snapshots · fix: list recorded fix sessions

Fix options (fix is a dry-run unless --apply is given):
  --apply         write the fixes to disk (creates <file>.bak backups)
  --only NAMES    comma list: ${ALL_FIXER_NAMES.join(",")}
  --url URL       page URL for a single file; SITE BASE URL for a directory (each page gets its own URL)
  --safe-only     fix <url>: list only safe, mechanical fixes in the plan
  --rollback      undo the latest recorded fix session (or --session ID); --force overwrites later edits
  --session ID    fix session to roll back
  --title TEXT    <title> value when missing (else derived from the first <h1>)
  --description T meta description when missing (else derived from page text)
  --lang LANG     <html lang> value when missing (never guessed)
  --og-image URL  absolute image URL used for og:image
  --no-backup     skip the .bak copy and the rollback session on --apply

Exit codes:
  0 success · 1 usage or configuration error · 2 runtime failure, --fail-on breach,
  verify regression, or critical monitor change

Notes:
  - Multi-page audits write report.json/md/html for page 1 plus
    report-N.json/md/html for pages 2+ and an index.md linking all pages.
  - quick is audit with beginner defaults (5 pages, all formats).
  - ai runs a dedicated AI Search Visibility and Citability audit.
  - skills inspects available auditing capabilities and check coverage.
  - page/audit accept local HTML files (.html/.htm) or directories for 100% offline auditing.
  - audit/page skip robots.txt-disallowed URLs unless --force; a
    T05-robots-disallow report is written instead. schema warns only.
  - diff compares two report.json files (base vs. head) for CI regression
    gating; --fail-on trips on NEW or escalated findings only.
  - fix accepts local .html/.htm files or directories; additive fixes only. Every --apply is
    backed up, re-read from disk and verified; fix <url> writes a plan and changes nothing.
  - verify re-audits the pages of an earlier audit and reports fixed / new / still-open issues.
  - monitor stores a snapshot per run and reports changes against the previous one.
  - Scores are this tool's health indicators, not Google ranking scores. Search volume,
    rankings, traffic and backlinks are not measured by a crawl and are never reported.
  - Only audit sites you are allowed to crawl; respect robots.txt.
`);
  process.exit(code);
}

/**
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdPage(url, args) {
  const psiKey = process.env.PSI_API_KEY;
  if (args.psi && !psiKey) {
    throw new CliError(
      `--psi requires the PSI_API_KEY environment variable.\nGet a free API key at https://developers.google.com/speed/docs/insights/v5/get-started and run:\n  PSI_API_KEY=your_key one-step-seo page <url> --psi`,
      1,
    );
  }
  const { blocked, robotsText } = await checkRobotsAllowed(url, args);
  if (blocked) {
    console.error(
      `! robots.txt disallows auditing ${url} — crawl skipped (re-run with --force to override).`,
    );
    const blockedRep = blockedReport(url);
    const writtenBlocked = writeOutputs(resolve(args.out), blockedRep, args.formats);
    console.log(
      `Search SEO: ${c.scoreBadge(blockedRep.scores.search.score, blockedRep.scores.search.band)}  |  AI Visibility: ${c.scoreBadge(blockedRep.scores.ai.score, blockedRep.scores.ai.band)}`,
    );
    printTopFixes(blockedRep, `one-step-seo page ${url} --force`);
    console.log(`Wrote:\n  ${writtenBlocked.join("\n  ")}`);
    return;
  }
  const r = await analyzeOne(url, args.timeout, UA, null, args.profile, {
    blockPrivateIps: Boolean(args.blockPrivateIps),
  });
  if (!r.parsed) {
    console.error(`Fetch failed: ${r.fetched.error || r.fetched.status}`);
    process.exitCode = 2;
    return;
  }
  if (args.debug)
    console.error(`debug: page ${url} fetched in ${r.fetched.ms}ms (${r.fetched.html.length} chars)`);
  if (args.checkLinks) {
    await checkPageLinks(
      r,
      new Set(),
      {
        timeout: args.timeout,
        concurrency: args.concurrency,
        blockPrivateIps: args.blockPrivateIps,
        userAgent: UA,
      },
      { budget: MAX_LINK_CHECKS, checked: new Set() },
      robotsText,
    );
  }
  if (args.skills || args.excludeSkills) {
    r.findings = applySkillsFilter(r.findings, args.skills, args.excludeSkills);
    r.scores = computeScores(r.findings, r.geo);
  }
  const report = toReport(r, url);
  if (args.psi && psiKey) {
    if (args.debug) console.error(`debug: fetching PSI for ${report.finalUrl} (${args.psiStrategy})...`);
    const psiRes = await fetchPsi(report.finalUrl, {
      key: psiKey,
      strategy: args.psiStrategy,
      timeoutMs: 25000,
      userAgent: UA,
      blockPrivateIps: Boolean(args.blockPrivateIps),
    });
    if (psiRes.data) {
      report.page.psi = psiRes.data;
    }
    let extraFindings = psiFindings(psiRes);
    if (args.skills || args.excludeSkills) {
      extraFindings = applySkillsFilter(extraFindings, args.skills, args.excludeSkills);
    }
    if (extraFindings.length > 0) {
      for (const ef of extraFindings) {
        report.findings.push(ef);
        report.counts[ef.severity] = (report.counts[ef.severity] ?? 0) + 1;
      }
      report.findings.sort((a, b) => (SEV_RANK[a.severity] ?? 5) - (SEV_RANK[b.severity] ?? 5));
      report.scores = computeScores(report.findings, r.geo);
    }
  }
  const written = writeOutputs(resolve(args.out), report, args.formats);
  if (args.formats.includes("pdf")) {
    written.push(
      ...writeSiteArtifacts(
        resolve(args.out),
        ["pdf"],
        {
          origin: report.site.origin || url,
          checkedAt: report.checkedAt,
          pageReports: [report],
          analysis: null,
        },
        args,
      ),
    );
  }
  console.log(
    `Search SEO: ${c.scoreBadge(report.scores.search.score, report.scores.search.band)}  |  AI Visibility: ${c.scoreBadge(report.scores.ai.score, report.scores.ai.band)}`,
  );
  printTopFixes(report, `one-step-seo page ${url}`);
  console.log(`Wrote:\n  ${written.join("\n  ")}`);
  if (args.failOn && breachesFailOn(args.failOn, report.counts)) {
    console.error(`Fail-on threshold breached: found ${args.failOn} (or higher) findings.`);
    process.exitCode = 2;
    return;
  }
}

/**
 * AI-search visibility and citability audit.
 * Evaluates machine readability, entity definitions, and citation signals.
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdAi(url, args) {
  const local = isLocalPath(url);
  if (!local) {
    const { blocked } = await checkRobotsAllowed(url, args);
    if (blocked) {
      console.error(
        `! robots.txt disallows auditing ${url} — crawl skipped (re-run with --force to override).`,
      );
      const blockedRep = blockedReport(url);
      const writtenBlocked = writeOutputs(resolve(args.out), blockedRep, args.formats);
      console.log(
        `AI Visibility: ${c.scoreBadge(blockedRep.scores.ai.score, blockedRep.scores.ai.band)}  |  Search SEO: ${c.scoreBadge(blockedRep.scores.search.score, blockedRep.scores.search.band)}`,
      );
      printTopFixes(blockedRep, `one-step-seo ai ${url} --force`);
      if (writtenBlocked.length > 0) console.log(`Wrote:\n  ${writtenBlocked.join("\n  ")}`);
      return;
    }
  }
  const r = local
    ? analyzeLocalTarget(url, args)
    : await analyzeOne(url, args.timeout, UA, null, args.profile, {
        blockPrivateIps: Boolean(args.blockPrivateIps),
      });
  if (!r.parsed) {
    console.error(`Fetch failed: ${r.fetched.error || r.fetched.status}`);
    process.exitCode = 2;
    return;
  }
  if (args.debug) {
    console.error(`debug: page ${url} fetched in ${r.fetched.ms}ms (${r.fetched.html.length} chars)`);
  }
  if (args.skills || args.excludeSkills) {
    r.findings = applySkillsFilter(r.findings, args.skills, args.excludeSkills);
    r.scores = computeScores(r.findings, r.geo);
  }
  const report = toReport(r, url);
  const written = writeOutputs(resolve(args.out), report, args.formats);

  const robotsAiBlocked = r.siteFiles?.robots?.aiBlocked ?? false;
  const blockedBots = r.siteFiles?.robots?.blockedBots ?? [];
  const llmsFound = r.siteFiles?.llms?.found ?? false;
  const llmsBytes = r.siteFiles?.llms?.bytes ?? 0;
  const schemaTypes = r.schemaInfo?.types ?? [];
  const hasAuthor = Boolean(r.parsed.author);
  const hasLandmarks = Boolean(r.parsed.hasMainLandmark);
  const hasDirectAnswer = Boolean(r.parsed.hasAnswerBlock);

  const aiFindings = (report.findings ?? []).filter(
    (f) => f && (f.category === "geo" || (f.geoImpact && f.geoImpact !== "-")),
  );

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          tool: "one-step-seo",
          version: VERSION,
          url: report.finalUrl,
          aiScore: report.scores.ai.score,
          aiBand: report.scores.ai.band,
          searchScore: report.scores.search.score,
          searchBand: report.scores.search.band,
          signals: {
            robotsAiBlocked,
            blockedBots,
            llmsFound,
            llmsBytes,
            schemaTypes,
            hasAuthor,
            hasLandmarks,
            hasDirectAnswer,
          },
          findings: aiFindings,
          reports: written,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!args.quiet) {
    console.log(c.bold(`AI Search Visibility & Citability Audit: ${report.finalUrl}`));
    console.log(c.dim(`Evaluates machine readability, entity definitions, and citations for AI engines.\n`));
  }

  console.log(
    `AI Visibility: ${c.scoreBadge(report.scores.ai.score, report.scores.ai.band)}  |  Search SEO: ${c.scoreBadge(report.scores.search.score, report.scores.search.band)}`,
  );

  console.log(`\n${c.bold("Citability & Signal Checklist:")}`);
  /** @param {boolean} ok */
  const mark = (ok) => (ok ? c.green("  [✓] Pass: ") : c.yellow("  [✗] Missing: "));
  console.log(
    `${mark(!robotsAiBlocked)}AI crawlers in robots.txt${robotsAiBlocked ? ` (blocked: ${blockedBots.join(", ")})` : " (allowed or not restricted)"}`,
  );
  console.log(
    `${mark(llmsFound)}llms.txt discoverable${llmsFound ? ` (${llmsBytes} bytes)` : " — add /llms.txt for machine summaries"}`,
  );
  console.log(
    `${mark(schemaTypes.length > 0)}Structured Data (JSON-LD)${schemaTypes.length > 0 ? ` (${schemaTypes.join(", ")})` : " — no schema detected"}`,
  );
  console.log(
    `${mark(hasAuthor)}Author attribution${hasAuthor ? ` ("${r.parsed.author}")` : " — missing author metadata"}`,
  );
  console.log(
    `${mark(hasLandmarks)}Semantic content landmarks${hasLandmarks ? " (<main> or <article> present)" : " — consider using <main> or <article>"}`,
  );
  console.log(
    `${mark(hasDirectAnswer)}Direct Answer section${hasDirectAnswer ? " (concise answer block detected)" : " (40-90 words question/answer recommended)"}`,
  );

  const urgentAi = aiFindings.filter((f) => f.severity !== "pass").slice(0, 3);
  if (urgentAi.length > 0) {
    console.log(`\n${c.bold("Top AI Visibility Fixes:")}`);
    for (const f of urgentAi) {
      const meta = getFindingMeta(String(f.id ?? ""));
      const hint = String(f.fix || meta.plain).slice(0, 120);
      console.log(`  ${c.severityBadge(f.severity)} ${f.title} (${f.id}) — ${hint}`);
      console.log(`    Impact: ${meta.impact} · Effort: ${meta.effort} · Owner: ${meta.owner}`);
    }
  } else {
    console.log(`\nTop AI Visibility Fixes: none — all checked signals passed.`);
  }

  if (written.length > 0) {
    console.log(`\nWrote:\n  ${written.join("\n  ")}`);
  }

  if (args.failOn && breachesFailOn(args.failOn, report.counts)) {
    console.error(`Fail-on threshold breached: found ${args.failOn} (or higher) findings.`);
    process.exitCode = 2;
  }
}

/**
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdSchema(url, args) {
  const local = isLocalPath(url);
  const r = local
    ? analyzeLocalTarget(url, args)
    : await analyzeOne(url, args.timeout, UA, null, args.profile, {
        blockPrivateIps: Boolean(args.blockPrivateIps),
      });
  if (!r.parsed) {
    console.error(`Fetch failed: ${r.fetched.error || r.fetched.status}`);
    process.exitCode = 2;
    return;
  }
  if (!args.force && r.siteFiles) {
    try {
      const robotsText = String(r.siteFiles.robots?.text ?? "");
      const p = robotsPathOf(r.fetched.finalUrl);
      if (robotsText && isDisallowed(robotsText, UA_TOKEN, p)) {
        console.error(`! note: robots.txt disallows ${r.fetched.finalUrl} — results are diagnostic only.`);
      }
    } catch {
      // Best-effort diagnostic note; never blocks schema output.
    }
  }
  console.log(
    `Found ${r.schemaInfo.items.length} JSON-LD node(s): ${r.schemaInfo.types.join(", ") || "(none)"}`,
  );
  for (const e of r.schemaInfo.errors) console.log(`  ERROR: ${e}`);
  for (const i of r.schemaInfo.issues) console.log(`  ISSUE [${i.type}]: ${i.issue}`);
  if (args.generate) {
    console.log(`\n--- snippet (${args.generate}) ---`);
    try {
      console.log(
        schemaSnippet(args.generate, {
          name: r.parsed.title || url,
          url: r.fetched.finalUrl,
          description: r.parsed.metaDescription,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Cannot generate "${args.generate}": ${msg}`);
      console.error(`Provide a real page title + URL — placeholder "Example" data is refused.`);
      process.exit(1);
    }
  }
}

/**
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdSitemap(url, args) {
  let normalized;
  try {
    normalized = new URL(url).toString();
  } catch {
    console.error("Provide a valid URL, e.g. one-step-seo sitemap https://example.com");
    process.exit(1);
  }
  const siteFiles = await getSiteFiles(normalized, {
    timeoutMs: args.timeout,
    userAgent: UA,
    blockPrivateIps: Boolean(args.blockPrivateIps),
  });
  const out = {
    origin: siteFiles.origin,
    robotsFound: siteFiles.robots.found,
    robotsSitemaps: siteFiles.robots.sitemaps,
    sitemapFound: siteFiles.sitemap.found,
    sitemapUrl: siteFiles.sitemap.url,
    sitemapUrls: siteFiles.sitemap.urlCount,
    sitemapTruncated: !!siteFiles.sitemap.truncated,
    llmsFound: siteFiles.llms.found,
  };
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`Origin: ${out.origin}`);
    console.log(`robots.txt: ${out.robotsFound ? "found" : "MISSING"}`);
    console.log(
      `sitemap.xml: ${out.sitemapFound ? `found at ${out.sitemapUrl} (~${out.sitemapUrls} URLs)` : "MISSING"}`,
    );
    console.log(`llms.txt: ${out.llmsFound ? "found" : "missing (optional)"}`);
  }
}

/**
 * Draft a starter llms.txt from best-effort page data. Titles and URLs come
 * from the live page/sitemap; anything unknown is an explicit placeholder
 * so no facts are ever invented.
 * @param {string} host
 * @param {string} title
 * @param {string} desc
 * @param {string[]} seeds
 * @returns {string}
 */
function buildLlmsStarter(host, title, desc, seeds) {
  const lines = [
    `# ${title || host}`,
    ``,
    `> ${desc || "Machine-readable summary for AI assistants. Replace this line with a one-paragraph description of the site."}`,
    ``,
    `## Key pages`,
    ``,
  ];
  if (seeds.length === 0) {
    lines.push("(no sitemap URLs discovered — add your most-cited pages manually)");
  } else {
    for (const s of seeds) lines.push(`- ${s}`);
  }
  lines.push(
    ``,
    `## Optional`,
    ``,
    `- Replace the links above with your most-cited pages, each with a one-line description.`,
  );
  return lines.join("\n");
}

/**
 * Copy-paste robots.txt snippet that lets the major AI crawlers read public
 * content. Display names are hardcoded (short, readable); matching is
 * case-insensitive so capitalization is safe.
 * @returns {string}
 */
function aiRobotsSnippet() {
  const majors = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot"];
  const lines = ["# Let AI assistants read and cite your public content (optional)"];
  for (const b of majors) {
    lines.push(`User-agent: ${b}`, "Allow: /", "");
  }
  return lines.join("\n").trimEnd();
}

/**
 * llms.txt status + generated starter draft + AI-crawler robots snippet.
 * Diagnostic output only — nothing is written anywhere.
 * @param {string} url
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdLlms(url, args) {
  const site = await getSiteFiles(url, {
    timeoutMs: args.timeout,
    userAgent: UA,
    blockPrivateIps: Boolean(args.blockPrivateIps),
  });
  let title = "";
  let desc = "";
  try {
    const f = await fetchWithRedirects(url, {
      timeoutMs: args.timeout,
      userAgent: UA,
      blockPrivateIps: Boolean(args.blockPrivateIps),
    });
    if (f.ok && f.html) {
      const p = parseHtml(f.html, f.finalUrl);
      title = p.title;
      desc = p.metaDescription;
    }
  } catch {
    // Best-effort: the starter still works from sitemap URLs alone.
  }
  /** @type {string[]} */
  let seeds = [];
  try {
    seeds = (
      await getSitemapUrls(url, {
        timeoutMs: args.timeout,
        userAgent: UA,
        blockPrivateIps: Boolean(args.blockPrivateIps),
      })
    ).slice(0, 20);
  } catch {
    // Best-effort: an empty seed list is still a usable starter.
    seeds = [];
  }
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // Keep the raw URL as the heading fallback.
  }
  const starter = buildLlmsStarter(host, title, desc, seeds);
  const robotsSnippet = aiRobotsSnippet();
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          tool: "one-step-seo",
          version: VERSION,
          url,
          llmsFound: site.llms.found,
          llmsBytes: site.llms.bytes,
          starter,
          robotsSnippet,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(`llms.txt: ${site.llms.found ? `found (${site.llms.bytes} bytes)` : "missing (optional)"}`);
  console.log(`\n--- starter llms.txt (curate before publishing) ---`);
  console.log(starter);
  console.log(`\n--- robots.txt AI-crawler snippet (optional) ---`);
  console.log(robotsSnippet);
}

/** @param {import("../lib/args.mjs").ParsedArgs} args */
async function cmdDoctor(args) {
  const nodeMajor = Number(process.version.slice(1).split(".")[0]);
  const nodeOk = nodeMajor >= 18;
  // Under Bun (including the standalone executables) process.version is
  // Bun's Node-compatibility level, not an installed Node — say which it is.
  const bunVersion = process.versions.bun ?? "";
  const runtime = bunVersion ? `bun ${bunVersion}` : `node ${process.version}`;
  const fetchOk = typeof fetch === "function";
  const psiKey = Boolean(process.env.PSI_API_KEY);
  const isTty = Boolean(process.stdout.isTTY);
  const colorEnabled = Boolean(isTty && !process.env.NO_COLOR && process.env.TERM !== "dumb");

  /** @type {{ path: string, ok: boolean, keys: string[], error: string }} */
  const configStatus = { path: "", ok: true, keys: [], error: "" };
  try {
    const loaded = loadConfig({ explicitPath: CONFIG_PATH });
    if (loaded) {
      configStatus.path = loaded.path;
      configStatus.keys = Object.keys(loaded.config).filter((k) => k !== "$schema");
    }
  } catch (err) {
    configStatus.ok = false;
    configStatus.error = err instanceof Error ? err.message : String(err);
  }
  const info = {
    tool: "one-step-seo",
    version: VERSION,
    node: process.version,
    nodeOk,
    runtime,
    fetch: fetchOk,
    terminal: {
      isTTY: isTty,
      color: colorEnabled,
      noColor: Boolean(process.env.NO_COLOR),
    },
    env: {
      PSI_API_KEY: psiKey ? "configured" : "not set (optional for --psi)",
      ONE_STEP_SEO_WEBHOOK: process.env.ONE_STEP_SEO_WEBHOOK
        ? "configured"
        : "not set (optional for monitor alerts)",
    },
    stateDir: resolveStateDir(args.stateDir),
    config: configStatus.path
      ? { file: configStatus.path, keys: configStatus.keys }
      : configStatus.ok
        ? null
        : { error: configStatus.error },
    configCheck: configStatus.ok ? "ok" : "invalid",
  };
  if (args.json) console.log(JSON.stringify(info, null, 2));
  else {
    console.log(`one-step-seo v${VERSION}`);
    console.log(
      bunVersion
        ? `runtime: bun ${bunVersion} (Node API ${info.node}) (ok)`
        : `node ${info.node} ${info.nodeOk ? "(ok)" : "(NEEDS >=18)"}`,
    );
    console.log(`fetch: ${info.fetch ? "ok" : "missing"}`);
    console.log(
      `terminal: isTTY=${isTty}, color=${colorEnabled}${process.env.NO_COLOR ? " (NO_COLOR set)" : ""}`,
    );
    console.log(`env PSI_API_KEY: ${info.env.PSI_API_KEY}`);
    console.log(`env ONE_STEP_SEO_WEBHOOK: ${info.env.ONE_STEP_SEO_WEBHOOK}`);
    console.log(`state dir: ${info.stateDir}`);
    if (configStatus.path && !args.checkConfig) console.log(`config: ${configStatus.path}`);
    if (args.checkConfig) {
      if (!configStatus.ok) {
        console.log(`configuration check: INVALID — ${configStatus.error}`);
      } else if (configStatus.path) {
        console.log(
          `configuration check: ${configStatus.path} is valid (${configStatus.keys.length} key(s): ${configStatus.keys.join(", ") || "none"}) (ok)`,
        );
      } else {
        console.log(`configuration check: no ${CONFIG_FILE} found — built-in defaults in use (ok)`);
      }
    }
  }
  if (!info.nodeOk || !info.fetch) process.exit(2);
  if (args.checkConfig && !configStatus.ok) process.exit(1);
}

/**
 * Display registered auditing skills or detailed skill documentation.
 * @param {string} skillId
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
function cmdSkills(skillId, args) {
  if (skillId && skillId !== "list") {
    const skill = getSkill(skillId);
    if (!skill) {
      console.error(`Unknown skill: "${skillId}". Run "one-step-seo skills" to see all registered skills.`);
      process.exit(1);
    }
    if (args.json) {
      console.log(JSON.stringify(skill, null, 2));
      return;
    }
    console.log(`\n${c.bold(`Skill: ${skill.name}`)} (${c.cyan(skill.id)})`);
    console.log(`Category: ${CATEGORIES[skill.category]?.name ?? skill.category}`);
    console.log(`Offline Supported: ${skill.offlineSupported ? c.green("Yes") : c.yellow("No")}`);
    if (skill.agentSkill) {
      console.log(`Agent Workflow: ${skill.agentSkill}`);
    }
    console.log(`\n${c.bold("Description:")}\n  ${skill.description}`);
    console.log(`\n${c.bold("Purpose:")}\n  ${skill.purpose}`);
    console.log(`\n${c.bold(`Checks (${skill.checks.length} rules):`)}`);
    for (const check of skill.checks) {
      const meta = FINDING_META[check];
      const plain = meta ? ` — ${meta.plain.slice(0, 80)}…` : "";
      console.log(`  - ${c.bold(check)}${plain}`);
    }
    console.log(`\n${c.bold("Remediation:")}\n  ${skill.remediation}`);
    console.log(`\n${c.bold("Limitations:")}\n  ${skill.limitations}\n`);
    return;
  }

  const allSkills = getSkills();
  if (args.json) {
    console.log(JSON.stringify(allSkills, null, 2));
    return;
  }

  console.log(`\n${c.bold("One-Step SEO — Skills Registry")} (v${VERSION})\n`);
  console.log(
    `${"ID".padEnd(24)} ${"CATEGORY".padEnd(16)} ${"NAME".padEnd(36)} ${"OFFLINE".padEnd(8)} ${"CHECKS"}`,
  );
  console.log("-".repeat(96));
  for (const s of allSkills) {
    const id = s.id.padEnd(24);
    const cat = s.category.padEnd(16);
    const name = s.name.padEnd(36);
    const off = (s.offlineSupported ? "Yes" : "No").padEnd(8);
    const checks = `${s.checks.length} checks`;
    console.log(`${id} ${cat} ${name} ${off} ${checks}`);
  }
  console.log(
    `\nTotal: ${allSkills.length} skills across ${Object.keys(CATEGORIES).length} categories. Run "one-step-seo skills <skill-id>" for details.\n`,
  );
}

/**
 * Open a local report file in the default browser (best-effort).
 * Avoids cmd.exe /c start on Windows so paths containing '&' or spaces
 * cannot be interpreted as shell metacharacters.
 * @param {string} file
 * @returns {Promise<void>}
 */
async function openReport(file) {
  const opener =
    process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
  const openerArgs = [file];
  await new Promise((resolve) => {
    execFile(opener, openerArgs, { timeout: 8000, windowsHide: true }, () => resolve(undefined));
  });
}

/**
 * Beginner mode: ask 4 quick questions, then auto-discover and audit the site.
 * Only on an interactive TTY — piped/CI usage falls back to usage(1).
 */
async function cmdInteractive() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) usage(1);
  console.log("one-step-seo — answer 4 quick questions to audit a site.\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    let target = "";
    while (!target) {
      const raw = (
        (await rl.question("Website URL or local path (e.g. https://example.com or ./dist): ")) ?? ""
      ).trim();
      if (!raw) continue;
      if (isLocalPath(raw)) {
        target = raw;
        break;
      }
      const normalized = normalizeUrl(raw);
      if (!normalized) console.error("That URL did not parse — try again, e.g. https://example.com");
      else target = normalized;
    }
    let pages = MAX_PAGES;
    let isAll = true;
    const pagesRaw = (
      (await rl.question(
        `Pages to audit — "all" (auto-discover entire site) or 1-${MAX_PAGES} (default all): `,
      )) ?? ""
    )
      .trim()
      .toLowerCase();
    if (pagesRaw && pagesRaw !== "all" && pagesRaw !== "max") {
      const n = Number(pagesRaw);
      if (Number.isInteger(n) && n >= 1 && n <= MAX_PAGES) {
        pages = n;
        isAll = false;
      } else {
        console.error(`Invalid page count — auto-discovering all pages (up to ${MAX_PAGES}).`);
      }
    }
    const outRaw = ((await rl.question("Output folder (default ./seo-report): ")) ?? "").trim();
    const out = outRaw || "./seo-report";
    const openRaw = ((await rl.question("Open report when done? (Y/n): ")) ?? "").trim().toLowerCase();
    const open = openRaw !== "n" && openRaw !== "no";

    if (isLocalPath(target)) {
      const interactiveArgs = parseArgs(["audit", target, "--pages", String(pages), "--out", out]);
      if (isAll) interactiveArgs.all = true;
      auditLocalDirectory(target, interactiveArgs);
    } else {
      const crawlMode = isAll ? "auto" : "links";
      const interactiveArgs = parseArgs([
        "audit",
        target,
        "--pages",
        String(pages),
        "--crawl",
        crawlMode,
        "--out",
        out,
      ]);
      if (isAll) interactiveArgs.all = true;
      await cmdAudit(target, interactiveArgs);
    }
    if (open) {
      const indexFile = join(resolve(out), "index.html");
      const reportFile = join(resolve(out), "report.html");
      if (existsSync(indexFile)) {
        await openReport(indexFile);
      } else if (existsSync(reportFile)) {
        await openReport(reportFile);
      }
    }
  } finally {
    rl.close();
  }
}

/**
 * Regression diff between two report.json files (base vs. head).
 * Exit 1 on unreadable/invalid inputs, 0 otherwise (2 on --fail-on breach).
 * @param {string[]} files exactly [oldPath, newPath]
 * @param {import("../lib/args.mjs").ParsedArgs} args
 */
async function cmdDiff(files, args) {
  const [oldPath, newPath] = files;
  if (!oldPath || !newPath) {
    console.error("Provide two reports: one-step-seo diff old-report.json new-report.json");
    process.exit(1);
  }
  /** @param {string} p @returns {any} */
  const load = (p) => {
    let raw = "";
    try {
      raw = readFileSync(p, "utf8");
    } catch {
      console.error(`Cannot read ${p}`);
      process.exit(1);
    }
    try {
      return JSON.parse(raw);
    } catch {
      console.error(`Invalid JSON in ${p}`);
      process.exit(1);
    }
  };
  const oldR = load(oldPath);
  const newR = load(newPath);
  for (const [label, r] of [
    [oldPath, oldR],
    [newPath, newR],
  ]) {
    if (!isReport(r)) {
      console.error(`${label} is not a one-step-seo report.json (tool/scores/findings mismatch)`);
      process.exit(1);
    }
  }
  const d = diffReports(oldR, newR);
  /** @param {number} n @returns {string} */
  const signed = (n) => `${n > 0 ? "+" : ""}${n}`;
  if (args.json) {
    console.log(JSON.stringify({ tool: "one-step-seo", version: VERSION, ...d }, null, 2));
  } else {
    console.log(`Diff: ${oldPath} -> ${newPath}`);
    console.log(`URL: ${d.url}`);
    console.log(
      `Search SEO: ${d.search.old} -> ${d.search.new} (${signed(d.search.delta)})  |  AI Visibility: ${d.ai.old} -> ${d.ai.new} (${signed(d.ai.delta)})`,
    );
    if (d.rulesVersionChanged) {
      console.log(
        `! rules version changed ${d.oldRulesVersion || "(none)"} -> ${d.newRulesVersion || "(none)"} — deltas may reflect rule changes, not site changes.`,
      );
    }
    if (d.newFindings.length === 0 && d.resolvedFindings.length === 0 && d.escalated.length === 0) {
      console.log("No finding changes.");
    } else {
      for (const f of d.newFindings) console.log(`  NEW [${f.severity}] ${f.title} (${f.id})`);
      for (const f of d.resolvedFindings) console.log(`  RESOLVED [${f.severity}] ${f.title} (${f.id})`);
      for (const e of d.escalated)
        console.log(`  ESCALATED [${e.oldSeverity}->${e.newSeverity}] ${e.title} (${e.id})`);
    }
  }
  if (args.failOn) {
    /** @type {Record<string, number>} */
    const rank = { P0: 0, P1: 1, P2: 2 };
    const threshold = rank[args.failOn];
    const breach =
      threshold !== undefined &&
      (d.newFindings.some((f) => (rank[f.severity] ?? 9) <= threshold) ||
        d.escalated.some((e) => (rank[e.newSeverity] ?? 9) <= threshold));
    if (breach) {
      console.error(`Fail-on threshold breached: new or escalated ${args.failOn}+ findings.`);
      process.exitCode = 2;
    }
  }
}

// `--verbose` is also honoured from the env so CI logs can be made verbose
// without changing the command line.
let verbose = process.env.VERBOSE === "1";

/** Explicit --config path for this invocation ("" = default lookup). */
let CONFIG_PATH = "";

async function main() {
  let args;
  try {
    const cli = extractConfigFlag(process.argv.slice(2));
    CONFIG_PATH = cli.configPath;
    // doctor reports config problems itself instead of dying on them.
    const isDoctor = cli.argv.find((a) => !a.startsWith("-")) === "doctor";
    const loaded = cli.noConfig || isDoctor ? null : loadConfig({ explicitPath: cli.configPath });
    args = parseArgs([...(loaded?.argv ?? []), ...cli.argv]);
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`Error: ${err.message}`);
      process.exit(err.code);
    }
    throw err;
  }
  verbose = verbose || args.verbose || args.debug;
  if (args.action === "help") usage(0);
  if (args.action === "version") {
    console.log(VERSION);
    return;
  }
  const [cmd, rawUrl] = args._;
  if (!cmd) return cmdInteractive();
  if (cmd === "doctor") return cmdDoctor(args);
  if (cmd === "skills") return cmdSkills(rawUrl ?? "", args);
  // `fix` targets local file paths — must route before URL normalization.
  if (cmd === "fix") return cmdFix(rawUrl ?? "", args);
  // `diff` compares local report.json files — also routes before URLs.
  if (cmd === "diff") return cmdDiff(args._.slice(1), args);
  // verify and report take an optional URL / path / audit folder.
  if (cmd === "verify") return cmdVerify(rawUrl ?? "", args);
  if (cmd === "report") return cmdReport(rawUrl ?? "", args);
  if (cmd === "monitor") {
    const monitorUrl = normalizeUrl(rawUrl ?? "");
    if (!monitorUrl || isLocalPath(rawUrl ?? "")) {
      console.error("Provide a site URL to monitor, e.g. one-step-seo monitor https://example.com");
      process.exit(1);
    }
    return cmdMonitor(monitorUrl, args);
  }

  // Dedicated full-site audit command:
  if (cmd === "site") {
    if (!rawUrl) {
      console.error("Provide a valid URL or local directory path: one-step-seo site https://example.com");
      process.exit(1);
    }
    const explicitPages = args.explicit.includes("--pages") || args.explicit.includes("--max-pages");
    if (!explicitPages) {
      args.pages = MAX_PAGES;
      args.all = true;
    }
    const explicitCrawl = args.explicit.includes("--crawl");
    if (!explicitCrawl) {
      args.crawl = "auto";
    }
    if (isLocalPath(rawUrl) || args.offline) {
      return auditLocalDirectory(rawUrl, args);
    }
    const siteUrl = normalizeUrl(rawUrl);
    if (!siteUrl) {
      console.error(
        `Provide a valid URL or local path, e.g. one-step-seo site https://example.com (got "${rawUrl}").`,
      );
      process.exit(1);
    }
    return cmdAudit(siteUrl, args);
  }

  // Direct target shorthand (e.g. `npx one-step-seo https://example.com` or `npx one-step-seo ./dist`):
  if (args._.length === 1) {
    const target = cmd.trim();
    if (isLocalPath(target)) {
      const explicitPages = args.explicit.includes("--pages") || args.explicit.includes("--max-pages");
      if (!explicitPages) {
        args.pages = MAX_PAGES;
        args.all = true;
      }
      if (existsSync(target) && statSync(target).isFile()) {
        return auditLocalFile(target, args);
      }
      return auditLocalDirectory(target, args);
    }
    const isHttp = /^https?:\/\//i.test(target);
    const isDomain = /\.[a-z0-9]{2,}/i.test(target) && !target.startsWith("-");
    const isLocalhost = /^localhost(:\d+)?$/i.test(target) || /^127\.0\.0\.1(:\d+)?$/i.test(target);
    if (isHttp || isDomain || isLocalhost) {
      const directUrl = normalizeUrl(target);
      if (directUrl) {
        const explicitPages = args.explicit.includes("--pages") || args.explicit.includes("--max-pages");
        if (!explicitPages) {
          args.pages = MAX_PAGES;
          args.all = true;
        }
        const explicitCrawl = args.explicit.includes("--crawl");
        if (!explicitCrawl) {
          args.crawl = "auto";
        }
        return cmdAudit(directUrl, args);
      }
    }
  }

  // Local file or directory targets (or explicit --offline):
  if (args.offline && rawUrl && /^https?:\/\//i.test(rawUrl.trim())) {
    throw new CliError("--offline requires a local file or directory path (got remote http(s) URL).", 1);
  }
  if (rawUrl && (isLocalPath(rawUrl) || args.offline)) {
    if (cmd === "page") return auditLocalFile(rawUrl, args);
    if (cmd === "ai") return cmdAi(rawUrl, args);
    if (cmd === "schema") return cmdSchema(rawUrl, args);
    if (cmd === "audit" || cmd === "quick") {
      if (cmd === "quick") {
        const explicitPages = args.explicit.includes("--pages") || args.explicit.includes("--max-pages");
        if (!explicitPages) args.pages = 5;
      }
      return auditLocalDirectory(rawUrl, args);
    }
  }

  if (cmd === "quick") {
    const explicitPages = args.explicit.includes("--pages") || args.explicit.includes("--max-pages");
    if (!explicitPages) args.pages = 5;
    const quickUrl = normalizeUrl(rawUrl ?? "");
    if (!quickUrl) {
      console.error("Provide a valid URL or local file path, e.g. one-step-seo quick https://example.com");
      process.exit(1);
    }
    if (!args.quiet) {
      console.log(`Quick audit: up to ${args.pages} page(s), all formats, into ${args.out}.`);
    }
    return cmdAudit(quickUrl, args);
  }
  const url = normalizeUrl(rawUrl ?? "");
  if (!url) {
    console.error(
      `Provide a valid URL or local file path, e.g. one-step-seo ${cmd === "ai" ? "ai" : "audit"} https://example.com`,
    );
    process.exit(1);
  }
  if (cmd === "audit") return cmdAudit(url, args);
  if (cmd === "page") return cmdPage(url, args);
  if (cmd === "ai") return cmdAi(url, args);
  if (cmd === "schema") return cmdSchema(url, args);
  if (cmd === "sitemap") return cmdSitemap(url, args);
  if (cmd === "llms") return cmdLlms(url, args);
  console.error(`Unknown command: ${cmd}`);
  usage(1);
}

installInterruptHandler();

main().catch((err) => {
  if (err instanceof CliError) {
    console.error(`Error: ${err.message}`);
    process.exit(err.code);
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Runtime error: ${msg}`);
  if (verbose && err instanceof Error && err.stack) console.error(err.stack);
  process.exit(2);
});
