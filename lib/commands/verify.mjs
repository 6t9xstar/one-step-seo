/**
 * one-step-seo — `verify` command.
 *
 * Re-audits the pages of an earlier audit (the baseline `report*.json` files)
 * and reports, per page, which issues are now resolved, which are new or
 * worse, and which are still open. This is the post-fix verification step:
 * an issue only counts as fixed when a fresh audit no longer finds it.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeOne, analyzeLocalFile, applySkillsFilter, toReport, resolveLocalTarget } from "../crawl.mjs";
import { computeScores } from "../score.mjs";
import { diffReports, isReport } from "../report-diff.mjs";
import { normalizeUrl, isLocalPath, CliError } from "../args.mjs";
import { readJson, writeJsonAtomic } from "../state.mjs";
import { VERSION, USER_AGENT } from "../version.mjs";
import { isInterrupted, sleep } from "./shared.mjs";

/**
 * Finding ids that are only produced when an opt-in flag is set. When the
 * re-audit did not run that measurement, their absence proves nothing.
 * @param {string} id
 * @param {import("../args.mjs").ParsedArgs} args
 * @returns {boolean}
 */
function notRechecked(id, args) {
  if (/^P0[345]-psi/.test(id)) return !args.psi;
  if (id === "T16-broken-links") return !args.checkLinks;
  return false;
}

/**
 * Number in a report file name (report.json = 1, report-7.json = 7).
 * @param {string} name
 * @returns {number}
 */
function reportIndex(name) {
  return Number(/(\d+)/.exec(name)?.[1] ?? 1) || 1;
}

/**
 * Load every page report in a directory (report.json, report-N.json).
 * @param {string} dir
 * @returns {any[]}
 */
export function loadBaselineReports(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((n) => /^report(-\d+)?\.json$/.test(n))
    .sort((a, b) => reportIndex(a) - reportIndex(b))
    .map((n) => readJson(join(dir, n)))
    .filter((r) => isReport(r));
}

/**
 * Lowercased forward-slash form of a path (cross-platform prefix compare).
 * @param {string} p
 * @returns {string}
 */
function normPath(p) {
  return p.split("\\").join("/").toLowerCase();
}

/**
 * @param {string} rawTarget optional URL / path filter ("" = every baseline page)
 * @param {import("../args.mjs").ParsedArgs} args
 */
export async function cmdVerify(rawTarget, args) {
  const baselineDir = resolve(args.baseline || args.out);
  let baseline = loadBaselineReports(baselineDir);
  if (baseline.length === 0) {
    throw new CliError(
      `No baseline reports found in ${baselineDir}.\nRun an audit first (one-step-seo audit <url> --out ${args.baseline || args.out}), or point --baseline at a folder with report.json files.`,
    );
  }
  // For a local directory target, site files (robots.txt / sitemap.xml /
  // llms.txt) are read from that directory — the same root the audit used.
  let localRoot = "";
  if (rawTarget) {
    /** @type {(r: any) => boolean} */
    let match;
    if (isLocalPath(rawTarget)) {
      const absPath = resolveLocalTarget(rawTarget);
      if (existsSync(absPath) && statSync(absPath).isDirectory()) localRoot = absPath;
      const abs = normPath(absPath);
      match = (r) => {
        try {
          return normPath(fileURLToPath(String(r.finalUrl))).startsWith(abs);
        } catch {
          return false;
        }
      };
    } else {
      const url = normalizeUrl(rawTarget);
      if (!url) throw new CliError(`Provide a valid URL or local path to verify (got "${rawTarget}").`);
      const host = new URL(url).host.toLowerCase().replace(/^www\./, "");
      match = (r) => {
        try {
          return new URL(String(r.finalUrl)).host.toLowerCase().replace(/^www\./, "") === host;
        } catch {
          return false;
        }
      };
    }
    baseline = baseline.filter(match);
    if (baseline.length === 0) {
      throw new CliError(`The baseline in ${baselineDir} has no pages for ${rawTarget}.`);
    }
  }

  /** @type {any[]} */
  const pages = [];
  let resolved = 0;
  let regressed = 0;
  let persisting = 0;
  let unreachable = 0;
  let first = true;
  for (const old of baseline) {
    if (isInterrupted()) break;
    const target = String(old.finalUrl || old.url);
    /** @type {any} */
    let r;
    try {
      if (/^file:/i.test(target)) {
        r = analyzeLocalFile(fileURLToPath(target), {
          profile: args.profile,
          ...(localRoot ? { siteRoot: localRoot } : {}),
        });
      } else {
        if (!first && args.delay > 0) await sleep(args.delay);
        r = await analyzeOne(target, args.timeout, USER_AGENT, null, args.profile, {
          blockPrivateIps: Boolean(args.blockPrivateIps),
        });
      }
    } catch (err) {
      r = { parsed: null, fetched: { error: err instanceof Error ? err.message : String(err), status: 0 } };
    }
    first = false;
    if (!r.parsed) {
      const why = String(r.fetched?.error || r.fetched?.status || "fetch failed");
      unreachable++;
      regressed++;
      pages.push({
        url: target,
        reachable: false,
        error: why,
        resolved: [],
        regressed: [],
        persisting: [],
        notRechecked: [],
      });
      if (!args.json) console.log(`! ${target} — could not be re-audited: ${why}`);
      continue;
    }
    if (args.skills || args.excludeSkills) {
      r.findings = applySkillsFilter(r.findings, args.skills, args.excludeSkills);
      r.scores = computeScores(r.findings, r.geo);
    }
    const fresh = toReport(r, target);
    const d = diffReports(old, fresh);
    const skipped = d.resolvedFindings.filter((f) => notRechecked(f.id, args));
    const fixed = d.resolvedFindings.filter((f) => !notRechecked(f.id, args));
    const worse = [
      ...d.newFindings.map((f) => ({ id: f.id, severity: f.severity, title: f.title })),
      ...d.escalated.map((e) => ({
        id: e.id,
        severity: e.newSeverity,
        title: `${e.title} (was ${e.oldSeverity})`,
      })),
    ];
    const newIds = new Set(fresh.findings.filter((f) => f.severity !== "pass").map((f) => f.id));
    const open = (old.findings ?? [])
      .filter((/** @type {any} */ f) => f && f.severity !== "pass" && newIds.has(f.id))
      .map((/** @type {any} */ f) => ({ id: f.id, severity: f.severity, title: f.title }));
    resolved += fixed.length;
    regressed += worse.length;
    persisting += open.length;
    pages.push({
      url: target,
      reachable: true,
      search: d.search,
      ai: d.ai,
      resolved: fixed,
      regressed: worse,
      persisting: open,
      notRechecked: skipped.map((f) => f.id),
    });
    if (!args.json) {
      /** @param {number} n */
      const signed = (n) => `${n > 0 ? "+" : ""}${n}`;
      console.log(
        `${target} — Search ${d.search.old} -> ${d.search.new} (${signed(d.search.delta)}), AI ${d.ai.old} -> ${d.ai.new} (${signed(d.ai.delta)})`,
      );
      for (const f of fixed) console.log(`  VERIFIED FIXED [${f.severity}] ${f.title} (${f.id})`);
      for (const f of worse) console.log(`  NEW / WORSE    [${f.severity}] ${f.title} (${f.id})`);
      if (!args.quiet)
        for (const f of open) console.log(`  STILL OPEN     [${f.severity}] ${f.title} (${f.id})`);
      if (skipped.length > 0) {
        console.log(
          `  not re-checked: ${skipped.map((f) => f.id).join(", ")} (needs the flag used in the original audit)`,
        );
      }
    }
  }

  const result = {
    tool: "one-step-seo",
    version: VERSION,
    reportType: "verification",
    checkedAt: new Date().toISOString(),
    baseline: baselineDir,
    summary: { pages: pages.length, resolved, regressed, persisting, unreachable },
    pages,
  };
  // Written next to the baseline unless --out names a different folder.
  const outDir = args.baseline && args.explicit.includes("--out") ? resolve(args.out) : baselineDir;
  const outFile = join(outDir, "verification.json");
  writeJsonAtomic(outFile, result);
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `\nVerification: ${resolved} fixed and verified · ${regressed} new or worse · ${persisting} still open · ${pages.length} page(s) re-audited`,
    );
    console.log(`Wrote:\n  ${outFile}`);
  }
  // Exit 2 on regressions at or above the threshold (default P1) or unreachable pages.
  /** @type {Record<string, number>} */
  const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const threshold = rank[args.failOn || "P1"] ?? 1;
  const breach =
    unreachable > 0 ||
    pages.some((p) => p.regressed.some((/** @type {any} */ f) => (rank[f.severity] ?? 9) <= threshold));
  if (breach) {
    console.error(
      `Verification failed: regressions at ${args.failOn || "P1"} or higher (or unreachable pages).`,
    );
    process.exitCode = 2;
  }
}
