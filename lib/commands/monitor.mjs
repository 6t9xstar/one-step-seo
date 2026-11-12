/**
 * one-step-seo — `monitor` command.
 *
 *   monitor <url>                 take a snapshot, compare with the previous one
 *   monitor <url> --interval 60   keep running, re-checking every 60 minutes
 *   monitor <url> --history       list stored snapshots and score trend
 *
 * Alerts go to the terminal and, when configured, to a webhook
 * (--webhook or ONE_STEP_SEO_WEBHOOK). Exit code 2 signals critical changes
 * (or warnings too with --fail-on P1), so cron / CI can act on it.
 */
import { join } from "node:path";
import {
  buildSnapshot,
  compareSnapshots,
  summarizeChanges,
  monitorDir,
  loadLatestSnapshot,
  saveSnapshot,
  appendChangeLog,
  listSnapshots,
  sendWebhook,
  isSnapshot,
} from "../monitor.mjs";
import { readJson } from "../state.mjs";
import { c } from "../colors.mjs";
import { VERSION } from "../version.mjs";
import { CliError } from "../args.mjs";
import { stateDirOf, isInterrupted, sleep } from "./shared.mjs";
import { runSiteAudit } from "./audit.mjs";

/** Default pages per monitoring run when --pages is not given. */
export const MONITOR_DEFAULT_PAGES = 25;

/**
 * Score trend from stored snapshots (oldest first).
 * @param {string} dir
 * @returns {{ takenAt: string, search: number | null, ai: number | null, pages: number, available: boolean }[]}
 */
export function snapshotHistory(dir) {
  /** @type {ReturnType<typeof snapshotHistory>} */
  const out = [];
  for (const name of listSnapshots(dir)) {
    const s = readJson(join(dir, name));
    if (!isSnapshot(s)) continue;
    out.push({
      takenAt: s.takenAt,
      search: s.averages?.search ?? null,
      ai: s.averages?.ai ?? null,
      pages: Object.keys(s.pages).length,
      available: s.available !== false,
    });
  }
  return out;
}

/**
 * One monitoring cycle: crawl, snapshot, compare, persist, alert.
 * @param {string} url
 * @param {import("../args.mjs").ParsedArgs} args
 * @returns {Promise<{ baseline: boolean, changes: import("../monitor.mjs").Change[], summary: Record<"critical" | "warning" | "info", number>, snapshotFile: string, snapshot: import("../monitor.mjs").Snapshot, webhook: { ok: boolean, status: number, error: string } | null }>}
 */
export async function monitorOnce(url, args) {
  const dir = monitorDir(stateDirOf(args), url);
  const previous = loadLatestSnapshot(dir);
  const { crawl } = await runSiteAudit(url, args);
  if (crawl.blocked) {
    throw new CliError(
      `robots.txt disallows crawling ${url} — nothing to monitor (re-run with --force to override).`,
      2,
    );
  }
  const snapshot = buildSnapshot(crawl);
  const changes = previous ? compareSnapshots(previous, snapshot) : [];
  const summary = summarizeChanges(changes);
  const snapshotFile = saveSnapshot(dir, snapshot, args.keep);
  if (previous) appendChangeLog(dir, { takenAt: snapshot.takenAt, summary, changes });

  /** @type {{ ok: boolean, status: number, error: string } | null} */
  let webhook = null;
  const hook = args.webhook || process.env.ONE_STEP_SEO_WEBHOOK || "";
  // Alert on anything actionable; routine info-only runs stay quiet.
  if (hook && (summary.critical > 0 || summary.warning > 0)) {
    webhook = await sendWebhook(hook, { site: url, takenAt: snapshot.takenAt, summary, changes });
  }
  return { baseline: !previous, changes, summary, snapshotFile, snapshot, webhook };
}

/**
 * @param {string} url
 * @param {import("../args.mjs").ParsedArgs} args
 */
export async function cmdMonitor(url, args) {
  const dir = monitorDir(stateDirOf(args), url);
  if (args.history) {
    const history = snapshotHistory(dir);
    if (args.json) {
      console.log(JSON.stringify({ tool: "one-step-seo", version: VERSION, site: url, history }, null, 2));
      return;
    }
    if (history.length === 0) {
      console.log(`No snapshots yet for ${url} in ${dir}. Run: one-step-seo monitor ${url}`);
      return;
    }
    console.log(`Monitoring history for ${url} (${history.length} snapshot(s)):`);
    for (const h of history) {
      console.log(
        `  ${h.takenAt.slice(0, 19).replace("T", " ")}  ${h.available ? `Search ${h.search ?? "n/a"} · AI ${h.ai ?? "n/a"} · ${h.pages} page(s)` : "SITE UNAVAILABLE"}`,
      );
    }
    return;
  }

  if (
    !args.explicit.includes("--pages") &&
    !args.explicit.includes("--all") &&
    !args.explicit.includes("--deep")
  ) {
    args.pages = MONITOR_DEFAULT_PAGES;
    if (!args.explicit.includes("--crawl")) args.crawl = "auto";
  }
  const levelFor = args.failOn === "P2" ? "info" : args.failOn === "P1" ? "warning" : "critical";
  /** @type {Record<string, number>} */
  const levelRank = { critical: 0, warning: 1, info: 2 };

  for (let cycle = 1; ; cycle++) {
    const run = await monitorOnce(url, args);
    if (args.json) {
      console.log(
        JSON.stringify(
          {
            tool: "one-step-seo",
            version: VERSION,
            site: url,
            takenAt: run.snapshot.takenAt,
            baseline: run.baseline,
            available: run.snapshot.available,
            averages: run.snapshot.averages,
            summary: run.summary,
            changes: run.changes,
            snapshot: run.snapshotFile,
            webhook: run.webhook,
          },
          null,
          2,
        ),
      );
    } else {
      const avg = run.snapshot.averages;
      console.log(
        `\n${c.bold(`Monitor ${url}`)} — ${run.snapshot.takenAt.slice(0, 19).replace("T", " ")} UTC — ${Object.keys(run.snapshot.pages).length} page(s), Search ${avg.search ?? "n/a"} · AI ${avg.ai ?? "n/a"}`,
      );
      if (!run.snapshot.available) console.log(c.red("  Site could not be audited (no page returned)."));
      if (run.baseline) {
        console.log("  Baseline snapshot captured — the next run reports what changed.");
      } else if (run.changes.length === 0) {
        console.log("  No changes since the previous snapshot.");
      } else {
        console.log(
          `  ${run.summary.critical} critical · ${run.summary.warning} warning · ${run.summary.info} info change(s):`,
        );
        const shown = args.quiet ? run.changes.filter((x) => x.level !== "info") : run.changes;
        for (const ch of shown.slice(0, 40)) {
          const tag =
            ch.level === "critical"
              ? c.red("CRITICAL")
              : ch.level === "warning"
                ? c.yellow("WARNING ")
                : "info    ";
          console.log(`  ${tag} ${ch.message} — ${ch.url}`);
          if (ch.before !== undefined && ch.after !== undefined && !args.quiet) {
            console.log(`           before: ${String(ch.before).slice(0, 100)}`);
            console.log(`           after:  ${String(ch.after).slice(0, 100)}`);
          }
        }
        if (shown.length > 40) console.log(`  …and ${shown.length - 40} more (see changes.json).`);
      }
      if (run.webhook) {
        console.log(
          run.webhook.ok ? "  Alert delivered to webhook." : `  ! Webhook alert failed: ${run.webhook.error}`,
        );
      }
      console.log(`  Snapshot: ${run.snapshotFile}`);
    }
    const breach =
      !run.snapshot.available ||
      run.changes.some((ch) => (levelRank[ch.level] ?? 9) <= (levelRank[levelFor] ?? 0));
    if (breach) process.exitCode = 2;

    if (!args.interval || isInterrupted()) break;
    if (!args.json && !args.quiet) {
      console.log(`  Next check in ${args.interval} minute(s) — Ctrl-C to stop. (cycle ${cycle} done)`);
    }
    // Sleep in short slices so Ctrl-C stops the loop promptly.
    const until = Date.now() + args.interval * 60_000;
    while (Date.now() < until && !isInterrupted()) {
      await sleep(Math.min(1000, until - Date.now()));
    }
    if (isInterrupted()) break;
  }
}
