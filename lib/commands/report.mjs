/**
 * one-step-seo — `report` command.
 *
 *   report <audit-output-dir>   re-render an existing audit (report*.json)
 *   report <url>                audit the site, then render
 *   report <local-site-dir>     audit local HTML, then render
 *
 * Formats: pdf, md, csv, json (default pdf,md,csv). `--brand`, `--client`
 * and `--audience client|developer|full` shape the document for agencies,
 * their clients, or developers.
 */
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listFixSessions } from "../autofix.mjs";
import { monitorDir } from "../monitor.mjs";
import { readJson } from "../state.mjs";
import { normalizeUrl, isLocalPath, CliError } from "../args.mjs";
import { resolveLocalTarget } from "../crawl.mjs";
import { stateDirOf } from "./shared.mjs";
import { runSiteAudit, runLocalAudit, writeSiteArtifacts } from "./audit.mjs";
import { loadBaselineReports } from "./verify.mjs";
import { snapshotHistory } from "./monitor.mjs";

/**
 * @param {string} rawTarget
 * @param {import("../args.mjs").ParsedArgs} args
 */
export async function cmdReport(rawTarget, args) {
  const target = rawTarget || args.out;
  const formats = args.explicit.includes("--format")
    ? args.formats.filter((f) => ["pdf", "md", "csv", "json"].includes(f))
    : ["pdf", "md", "csv"];
  if (formats.length === 0) {
    throw new CliError("report supports --format pdf, md, csv and json.");
  }
  const outDir = resolve(args.out);

  /** @type {import("../site-report.mjs").SiteReportModel} */
  let model;
  const local = isLocalPath(target);
  const abs = local ? resolveLocalTarget(target) : "";
  if (
    local &&
    abs &&
    existsSync(abs) &&
    statSync(abs).isDirectory() &&
    existsSync(join(abs, "report.json"))
  ) {
    // An existing audit output directory: render from the stored JSON.
    const pageReports = loadBaselineReports(abs);
    if (pageReports.length === 0) throw new CliError(`No valid report.json files in ${abs}.`);
    const intel = readJson(join(abs, "site-intelligence.json"));
    const verification = readJson(join(abs, "verification.json"));
    model = {
      origin: String(intel?.origin || pageReports[0]?.site?.origin || pageReports[0]?.finalUrl || target),
      checkedAt: String(pageReports[0]?.checkedAt || new Date().toISOString()),
      pageReports,
      analysis: intel && Array.isArray(intel.issues) ? intel : null,
      competitors: intel?.competitors ?? null,
      verification:
        verification?.reportType === "verification"
          ? { checkedAt: verification.checkedAt, ...verification.summary }
          : null,
    };
  } else if (local) {
    if (!abs || !existsSync(abs)) throw new CliError(`Path not found: ${target}`);
    if (!args.explicit.includes("--pages")) args.pages = 1000;
    const audit = runLocalAudit(abs, args);
    if (audit.pageReports.length === 0) throw new CliError(`No .html or .htm files found in: ${target}`);
    model = {
      origin: target,
      checkedAt: audit.pageReports[0]?.checkedAt ?? new Date().toISOString(),
      pageReports: audit.pageReports,
      analysis: audit.analysis,
    };
  } else {
    const url = normalizeUrl(target);
    if (!url) {
      throw new CliError(
        `Provide a URL, a local site directory, or an audit output folder: one-step-seo report https://example.com --format pdf`,
      );
    }
    if (
      !args.explicit.includes("--pages") &&
      !args.explicit.includes("--all") &&
      !args.explicit.includes("--deep")
    ) {
      args.pages = 25;
      if (!args.explicit.includes("--crawl")) args.crawl = "auto";
    }
    const { crawl, analysis, competitors } = await runSiteAudit(url, args);
    if (crawl.blocked)
      throw new CliError(`robots.txt disallows auditing ${url} (re-run with --force to override).`, 2);
    if (crawl.pageReports.length === 0) throw new CliError("Report failed: no pages could be fetched.", 2);
    model = {
      origin: crawl.pageReports[0]?.site?.origin || url,
      checkedAt: crawl.pageReports[0]?.checkedAt ?? new Date().toISOString(),
      pageReports: crawl.pageReports,
      analysis,
      competitors,
    };
  }

  // Attach what this tool has recorded for the same site: applied fixes and
  // monitoring history. Sections stay honest ("none recorded") when empty.
  const stateDir = stateDirOf(args);
  const first = String(model.pageReports[0]?.finalUrl || "");
  if (/^https?:/i.test(first)) {
    model.history = snapshotHistory(monitorDir(stateDir, first));
  } else if (/^file:/i.test(first)) {
    let firstPath = "";
    try {
      firstPath = fileURLToPath(first);
    } catch {
      firstPath = "";
    }
    model.fixSessions = listFixSessions(stateDir).filter((s) =>
      s.files.some((f) => firstPath && (f.path === firstPath || firstPath.startsWith(s.target))),
    );
  }

  const written = writeSiteArtifacts(outDir, formats, model, args);
  if (args.json) {
    console.log(
      JSON.stringify(
        { tool: "one-step-seo", origin: model.origin, pages: model.pageReports.length, written },
        null,
        2,
      ),
    );
    return;
  }
  console.log(
    `Report for ${model.origin} — ${model.pageReports.length} page(s)${model.analysis ? `, ${model.analysis.issues.length} site-wide finding(s)` : ""}`,
  );
  console.log(`Wrote:\n  ${written.join("\n  ")}`);
}
