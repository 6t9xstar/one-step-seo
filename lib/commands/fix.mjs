/**
 * one-step-seo — `fix` command.
 *
 *   fix <file|dir>            preview safe fixes (dry run)
 *   fix <file|dir> --apply    back up, write, re-read from disk and verify
 *   fix <url>                 fix PLAN for a live site (proposed changes only)
 *   fix --history             list recorded fix sessions
 *   fix --rollback            undo the latest session (or --session <id>)
 */
import { copyFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { planFixes, FIXER_NAMES } from "../fix.mjs";
import {
  planLocalFixes,
  applyFixSession,
  listFixSessions,
  rollbackFixSession,
  buildFixPlan,
  renderFixPlanMarkdown,
  SITE_FIXER_NAMES,
} from "../autofix.mjs";
import { resolveLocalTarget, isHtmlFile } from "../crawl.mjs";
import { unifiedDiff } from "../diff.mjs";
import { normalizeUrl, isLocalPath } from "../args.mjs";
import { VERSION } from "../version.mjs";
import { stateDirOf } from "./shared.mjs";
import { runSiteAudit } from "./audit.mjs";

/** Every name accepted by --only. */
export const ALL_FIXER_NAMES = [...FIXER_NAMES, ...SITE_FIXER_NAMES];

/** @param {string} f @returns {string} */
function rel(f) {
  const r = relative(process.cwd(), f);
  return r && !r.startsWith("..") ? r : f;
}

/**
 * `fix --history`
 * @param {import("../args.mjs").ParsedArgs} args
 */
function showHistory(args) {
  const sessions = listFixSessions(stateDirOf(args));
  if (args.json) {
    console.log(JSON.stringify({ tool: "one-step-seo", version: VERSION, sessions }, null, 2));
    return;
  }
  if (sessions.length === 0) {
    console.log(`No fix sessions recorded in ${stateDirOf(args)}.`);
    return;
  }
  console.log(`Fix history (${stateDirOf(args)}):`);
  for (const s of sessions) {
    const fixes = s.files.reduce((n, f) => n + f.fixes.length, 0);
    const cleared = s.files.reduce((n, f) => n + f.verified.filter((v) => v.cleared).length, 0);
    console.log(
      `  ${s.id}  ${s.createdAt.slice(0, 19).replace("T", " ")}  ${s.status.padEnd(11)} ${fixes} fix(es), ${cleared} verified, ${s.files.length} file(s)  ${s.target}`,
    );
  }
  console.log(`Undo one with: one-step-seo fix --rollback --session <id>`);
}

/**
 * `fix --rollback [--session id] [--force]`
 * @param {import("../args.mjs").ParsedArgs} args
 */
function rollback(args) {
  const res = rollbackFixSession(stateDirOf(args), args.session || undefined, { force: args.force });
  if (args.json) {
    console.log(JSON.stringify({ tool: "one-step-seo", version: VERSION, ...res }, null, 2));
  } else if (!res.ok) {
    console.error(`Rollback failed: ${res.error}`);
    for (const f of res.conflicts) console.error(`  changed since fix: ${rel(f)}`);
  } else {
    console.log(`Rolled back session ${res.session?.id}:`);
    for (const f of res.restored) console.log(`  restored ${rel(f)}`);
    for (const f of res.removed) console.log(`  removed  ${rel(f)} (created by the fix)`);
  }
  if (!res.ok) process.exitCode = 2;
}

/**
 * `fix <url>` — audit a live site and write a fix plan. Nothing is modified.
 * @param {string} url
 * @param {import("../args.mjs").ParsedArgs} args
 */
async function planRemote(url, args) {
  if (args.apply) {
    console.error(
      "fix --apply only works on local files: a live site cannot be modified from here.\n" +
        "Run `one-step-seo fix <url>` for the fix plan, apply it to your source with\n" +
        "`one-step-seo fix <dir> --apply`, deploy, then confirm with `one-step-seo verify <url>`.",
    );
    process.exit(1);
  }
  const { crawl, analysis } = await runSiteAudit(url, args);
  if (crawl.blocked) {
    console.error(
      `! robots.txt disallows auditing ${url} — no plan generated (re-run with --force to override).`,
    );
    process.exitCode = 2;
    return;
  }
  if (crawl.pageReports.length === 0) {
    console.error("Fix plan failed: no pages could be fetched.");
    process.exitCode = 2;
    return;
  }
  const plan = buildFixPlan(crawl.pageReports, analysis, {
    safeOnly: args.safeOnly,
    indexableUrls: crawl.pages.filter((p) => !p.noindex).map((p) => p.finalUrl),
  });
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, "fix-plan.json");
  const mdPath = join(outDir, "fix-plan.md");
  writeFileSync(jsonPath, JSON.stringify(plan, null, 2) + "\n", "utf8");
  writeFileSync(mdPath, renderFixPlanMarkdown(plan), "utf8");
  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  console.log(`Fix plan for ${url} — ${crawl.pageReports.length} page(s) audited`);
  console.log(
    `  ${plan.summary.safe ?? 0} safe · ${plan.summary.approval ?? 0} need approval · ${plan.summary.manual ?? 0} manual${args.safeOnly ? " (--safe-only: others omitted)" : ""}`,
  );
  for (const e of plan.entries.filter((x) => x.fixType === "safe").slice(0, 8)) {
    console.log(`  + [${e.severity}] ${e.issueId} ${e.url}`);
  }
  console.log(`Status: all changes are PROPOSED — nothing was modified and nothing is fixed yet.`);
  console.log(`Wrote:\n  ${jsonPath}\n  ${mdPath}`);
  console.log(
    `Next: apply to your source (one-step-seo fix <dir> --apply), deploy, then run one-step-seo verify ${url}.`,
  );
}

/**
 * Safe auto-fixes for local HTML files, or a fix plan for a live URL.
 * @param {string} rawTarget path, directory, file:// URL or http(s) URL
 * @param {import("../args.mjs").ParsedArgs} args
 */
export async function cmdFix(rawTarget, args) {
  if (args.history) return showHistory(args);
  if (args.rollback) return rollback(args);
  if (!rawTarget) {
    console.error("Provide a path: one-step-seo fix ./dist/index.html");
    process.exit(1);
  }
  if (!isLocalPath(rawTarget)) {
    const url = normalizeUrl(rawTarget);
    if (url && (/^https?:\/\//i.test(rawTarget) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(rawTarget))) {
      return planRemote(url, args);
    }
  }
  const abs = resolveLocalTarget(rawTarget);
  if (!abs) {
    console.error(`Invalid file URL: ${rawTarget}`);
    process.exit(1);
  }

  let stat;
  try {
    stat = statSync(abs);
  } catch {
    console.error(`Path not found: ${rawTarget}`);
    process.exit(1);
  }
  const isDirectory = stat.isDirectory();
  if (!isDirectory && !isHtmlFile(abs)) {
    const ext = /\.[^./\\]+$/.exec(abs)?.[0] ?? "";
    console.error(`fix only accepts .html/.htm files (got "${ext || "no extension"}").`);
    process.exit(1);
  }

  /** @type {string[] | null} */
  let only = null;
  if (args.only.trim()) {
    only = [
      ...new Set(
        args.only
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    const bad = only.filter((n) => !ALL_FIXER_NAMES.includes(n));
    if (bad.length > 0) {
      console.error(`Unknown fixer(s): ${bad.join(", ")}. Valid: ${ALL_FIXER_NAMES.join(", ")}`);
      process.exit(1);
    }
  }

  let url = "";
  if (args.url.trim()) {
    url = normalizeUrl(args.url);
    if (!url) {
      console.error(`--url must be an absolute http(s) URL (got "${args.url.slice(0, 60)}").`);
      process.exit(1);
    }
  }

  const local = planLocalFixes(abs, {
    url,
    title: args.title,
    description: args.description,
    lang: args.lang,
    ogImage: args.ogImage,
    only,
    isDirectory,
  });
  if (local.files.length === 0) {
    console.error(`No .html/.htm files found under ${rawTarget}`);
    process.exit(1);
  }

  // seo-fix protocol: warn (don't refuse) when targets have uncommitted work.
  if (args.apply) {
    try {
      const porcelain = execFileSync("git", ["status", "--porcelain", "--", ...local.files.map(rel)], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }).toString();
      if (porcelain.trim()) {
        console.error("! target file(s) have uncommitted changes — .bak backups will be written alongside");
      }
    } catch {
      // git unavailable / not a repo — non-fatal
    }
  }

  /** @type {any[]} */
  const jsonFiles = [];
  let plannedTotal = 0;
  let errored = false;
  /** @type {Parameters<typeof applyFixSession>[0]["changes"]} */
  const changes = [];
  /** @type {Map<string, any>} */
  const entryByFile = new Map();

  for (const page of local.pages) {
    const label = rel(page.file);
    if (page.error || !page.plan) {
      console.error(`! ${label}: ${page.error}`);
      errored = true;
      jsonFiles.push({
        file: label,
        planned: [],
        skipped: page.plan?.skipped ?? [],
        verified: [],
        changed: false,
        applied: false,
        error: page.error,
      });
      continue;
    }
    const plan = page.plan;
    plannedTotal += plan.planned.length;

    if (!args.json) {
      if (plan.planned.length === 0 && plan.skipped.length === 0) {
        console.log(`${label}: nothing to fix`);
      } else {
        console.log(label);
        for (const p of plan.planned) {
          console.log(`  + ${p.name.padEnd(12)} ${p.findingId.padEnd(18)} ${p.summary}`);
        }
        for (const s of plan.skipped) {
          console.log(`  ! ${s.name.padEnd(12)} skipped: ${s.reason}`);
        }
      }
      for (const a of page.altSuggestions.slice(0, 5)) {
        console.log(
          `  ? ${"alt".padEnd(12)} suggestion for ${a.src}: "${a.suggestedAlt}" (not applied — confirm it describes the image)`,
        );
      }
    }

    const entry = {
      file: label,
      planned: plan.planned.map((p) => ({
        name: p.name,
        findingId: p.findingId,
        summary: p.summary,
        partial: !!p.partial,
      })),
      skipped: plan.skipped,
      verified: plan.verified,
      altSuggestions: page.altSuggestions,
      changed: plan.changed,
      applied: false,
      error: /** @type {string | null} */ (null),
    };
    jsonFiles.push(entry);
    entryByFile.set(page.file, entry);

    if (!plan.changed) continue;
    if (!args.json) console.log(unifiedDiff(page.html, plan.newHtml, label).replace(/\n$/, ""));
    const pageCtx = page.pageCtx ?? {};
    changes.push({
      file: page.file,
      content: plan.newHtml,
      fixes: plan.planned.map((p) => p.name),
      // Verified against what is on disk: re-plan the written file and
      // confirm each applied fixer no longer has anything to do.
      verify: (onDisk) => {
        const again = planFixes(onDisk, pageCtx);
        const stillPlanned = new Set(again.planned.map((p) => p.name));
        return plan.planned.map((p) => ({ name: p.name, cleared: !stillPlanned.has(p.name) }));
      },
    });
  }

  /** @type {any[]} */
  const jsonSite = [];
  for (const s of local.site.planned) {
    const label = rel(s.file);
    plannedTotal++;
    if (!args.json) {
      console.log(label);
      console.log(`  + ${s.name.padEnd(12)} ${s.findingId.padEnd(18)} ${s.summary}`);
    }
    const entry = {
      file: label,
      name: s.name,
      findingId: s.findingId,
      summary: s.summary,
      created: s.created,
      applied: false,
    };
    jsonSite.push(entry);
    entryByFile.set(s.file, entry);
    changes.push({ file: s.file, content: s.content, created: s.created, fixes: [s.name] });
  }
  if (!args.json) {
    for (const s of local.site.skipped) console.log(`  ! ${s.name.padEnd(12)} skipped: ${s.reason}`);
  }

  let appliedFixes = 0;
  let appliedFiles = 0;
  /** @type {string | null} */
  let sessionId = null;
  if (args.apply && changes.length > 0) {
    // Side-by-side .bak copies (kept for compatibility) plus a recorded
    // session that `fix --rollback` can restore from.
    if (!args.noBackup) {
      for (const ch of changes) {
        try {
          if (!ch.created) copyFileSync(ch.file, `${ch.file}.bak`);
        } catch {
          // the session backup below still covers this file
        }
      }
    }
    const res = applyFixSession({
      stateDir: stateDirOf(args),
      target: abs,
      siteRoot: local.rootDir,
      changes,
      backup: !args.noBackup,
    });
    sessionId = res.session?.id ?? null;
    for (const f of res.files) {
      const entry = entryByFile.get(f.path);
      if (entry) {
        entry.applied = true;
        entry.verified = f.verified;
        if (f.searchScore) entry.searchScore = f.searchScore;
        entry.resolvedFindings = f.resolvedFindings;
      }
      appliedFixes += f.fixes.length;
      appliedFiles++;
      if (!args.json) {
        const marks = f.verified.map((v) => `${v.name} ${v.cleared ? "check" : "partial"}`).join(", ");
        const score = f.searchScore ? ` · Search ${f.searchScore.before} -> ${f.searchScore.after}` : "";
        console.log(`  verified: ${marks}${score}  (${rel(f.path)})`);
      }
    }
    for (const e of res.errors) {
      console.error(`! ${rel(e.file)}: write failed: ${e.error}`);
      errored = true;
      const entry = entryByFile.get(e.file);
      if (entry) entry.error = e.error;
    }
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          tool: "one-step-seo",
          version: VERSION,
          applied: args.apply,
          session: sessionId,
          files: jsonFiles,
          siteFiles: jsonSite,
        },
        null,
        2,
      ),
    );
  } else if (args.apply) {
    if (appliedFixes > 0) {
      const backupNote = args.noBackup ? "" : " (backups: *.bak)";
      console.log(`\nApplied ${appliedFixes} fix(es) to ${appliedFiles} file(s)${backupNote}.`);
      if (sessionId) console.log(`Session ${sessionId} recorded — undo with: one-step-seo fix --rollback`);
    } else if (plannedTotal > 0) {
      console.log(`\n${plannedTotal} fix(es) planned but no files were written.`);
    } else {
      console.log(`\nNothing to fix.`);
    }
  } else if (plannedTotal > 0) {
    console.log(
      `\n${plannedTotal} fix(es) planned — dry run, no files written. Re-run with --apply to write.`,
    );
  }

  if (errored) process.exitCode = 2;
}
