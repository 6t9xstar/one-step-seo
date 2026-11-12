/**
 * one-step-seo — SEO Monitoring engine (zero dependencies).
 *
 * A monitor run crawls the site, reduces the result to a compact snapshot of
 * SEO-critical state, stores it, and compares it with the previous snapshot to
 * produce classified change events (critical / warning / info).
 *
 * Snapshots are plain JSON files under `<stateDir>/monitor/<host>/`, so history
 * is inspectable, diffable and trivially backed up. Scheduling is deliberately
 * external-friendly: run once per invocation (cron, Task Scheduler, CI) or loop
 * in-process with `--interval`.
 *
 * Only state the crawler can observe is monitored. Rankings, traffic and
 * backlinks are not observable from a crawl and are never reported.
 */
import { join } from "node:path";
import { createHash } from "node:crypto";
import { writeJsonAtomic, readJson, listDir, prune, slug } from "./state.mjs";
import { VERSION } from "./version.mjs";

/** @typedef {"critical" | "warning" | "info"} ChangeLevel */

/**
 * @typedef {object} PageSnapshot
 * @property {string} url
 * @property {number} status
 * @property {string} title
 * @property {string} metaDescription
 * @property {string} canonical
 * @property {boolean} noindex
 * @property {string} h1
 * @property {number} wordCount
 * @property {string} contentHash
 * @property {string[]} schemaTypes
 * @property {number} search
 * @property {number} ai
 * @property {number} ms
 * @property {{ id: string, severity: string }[]} findings non-pass findings
 */

/**
 * @typedef {object} Snapshot
 * @property {string} tool
 * @property {string} version
 * @property {string} takenAt
 * @property {string} startUrl
 * @property {boolean} available false when the start URL could not be audited
 * @property {{ robotsFound: boolean, robotsHash: string, sitemapFound: boolean, sitemapUrlCount: number, sitemapHash: string, llmsFound: boolean }} site
 * @property {Record<string, PageSnapshot>} pages keyed by canonical URL
 * @property {{ url: string, status: number, error: string }[]} failures
 * @property {string[]} sitemapUrls capped list of sitemap URLs
 * @property {{ search: number | null, ai: number | null }} averages
 */

/**
 * @typedef {object} Change
 * @property {string} type
 * @property {ChangeLevel} level
 * @property {string} url
 * @property {string} message
 * @property {string} [before]
 * @property {string} [after]
 */

/** Cap on sitemap URLs kept per snapshot. */
export const MAX_SNAPSHOT_SITEMAP_URLS = 2000;
/** Score drops (points) that raise a warning / a critical change. */
export const SCORE_DROP_WARNING = 10;
export const SCORE_DROP_CRITICAL = 25;

/** @type {Record<ChangeLevel, number>} */
const LEVEL_RANK = { critical: 0, warning: 1, info: 2 };

/**
 * @param {string} s
 * @returns {string}
 */
function hash(s) {
  return s ? createHash("sha1").update(s).digest("hex") : "";
}

/**
 * Reduce a crawl result to a monitoring snapshot.
 * @param {import("./crawl.mjs").CrawlResult} crawl
 * @param {{ robotsText?: string, robotsFound?: boolean, sitemapFound?: boolean, llmsFound?: boolean, takenAt?: string }} [site]
 * @returns {Snapshot}
 */
export function buildSnapshot(crawl, site = {}) {
  /** @type {Record<string, PageSnapshot>} */
  const pages = {};
  let searchSum = 0;
  let aiSum = 0;
  const n = crawl.blocked ? 0 : crawl.pages.length;
  for (let i = 0; i < n; i++) {
    const f = crawl.pages[i];
    const r = crawl.pageReports[i];
    if (!f || !r) continue;
    searchSum += r.scores.search.score;
    aiSum += r.scores.ai.score;
    pages[f.key] = {
      url: f.finalUrl,
      status: f.status,
      title: f.title,
      metaDescription: f.metaDescription,
      canonical: f.canonical,
      noindex: f.noindex,
      h1: f.h1,
      wordCount: f.wordCount,
      contentHash: f.contentHash,
      schemaTypes: [...f.schemaTypes].sort(),
      search: r.scores.search.score,
      ai: r.scores.ai.score,
      ms: f.ms,
      findings: r.findings
        .filter((x) => x && x.severity !== "pass")
        .map((x) => ({ id: x.id, severity: x.severity })),
    };
  }
  const sitemapUrls = [...crawl.sitemapUrls].sort().slice(0, MAX_SNAPSHOT_SITEMAP_URLS);
  const first = crawl.pageReports[0];
  return {
    tool: "one-step-seo",
    version: VERSION,
    takenAt: site.takenAt ?? new Date().toISOString(),
    startUrl: crawl.startUrl,
    available: n > 0,
    site: {
      robotsFound: site.robotsFound ?? Boolean(first?.site?.robots),
      robotsHash: hash(site.robotsText ?? crawl.robotsText ?? ""),
      sitemapFound: site.sitemapFound ?? Boolean(first?.site?.sitemap),
      sitemapUrlCount: crawl.sitemapUrls.length,
      sitemapHash: hash(sitemapUrls.join("\n")),
      llmsFound: site.llmsFound ?? Boolean(first?.site?.llms),
    },
    pages,
    failures: crawl.failures
      .filter((f) => f.kind === "fetch")
      .map((f) => ({ url: f.url, status: f.status, error: f.error })),
    sitemapUrls,
    averages: {
      search: n > 0 ? Math.round(searchSum / n) : null,
      ai: n > 0 ? Math.round(aiSum / n) : null,
    },
  };
}

/**
 * True when the value looks like a monitoring snapshot.
 * @param {any} s
 * @returns {boolean}
 */
export function isSnapshot(s) {
  return Boolean(
    s &&
    typeof s === "object" &&
    s.tool === "one-step-seo" &&
    typeof s.takenAt === "string" &&
    s.pages &&
    typeof s.pages === "object" &&
    s.site,
  );
}

/**
 * Compare two snapshots and classify what changed.
 * @param {Snapshot} prev
 * @param {Snapshot} cur
 * @returns {Change[]} sorted critical-first
 */
export function compareSnapshots(prev, cur) {
  /** @type {Change[]} */
  const changes = [];
  /** @param {string} type @param {ChangeLevel} level @param {string} url @param {string} message @param {string} [before] @param {string} [after] */
  const add = (type, level, url, message, before, after) => {
    changes.push({
      type,
      level,
      url,
      message,
      ...(before !== undefined ? { before } : {}),
      ...(after !== undefined ? { after } : {}),
    });
  };

  // ---- availability ----
  if (prev.available && !cur.available) {
    const why = cur.failures[0];
    add(
      "site-unavailable",
      "critical",
      cur.startUrl,
      `Site could not be audited: ${why ? why.error || `HTTP ${why.status}` : "start URL returned no page"}`,
    );
    return changes;
  }
  if (!prev.available && cur.available) {
    add("site-recovered", "info", cur.startUrl, "Site is reachable again");
  }

  // ---- site files ----
  if (prev.site.robotsFound && !cur.site.robotsFound) {
    add("robots-removed", "critical", cur.startUrl, "robots.txt is no longer served");
  } else if (!prev.site.robotsFound && cur.site.robotsFound) {
    add("robots-added", "info", cur.startUrl, "robots.txt is now served");
  } else if (prev.site.robotsHash !== cur.site.robotsHash) {
    add("robots-changed", "warning", cur.startUrl, "robots.txt content changed — review crawl rules");
  }
  if (prev.site.sitemapFound && !cur.site.sitemapFound) {
    add("sitemap-removed", "critical", cur.startUrl, "XML sitemap is no longer available");
  } else if (!prev.site.sitemapFound && cur.site.sitemapFound) {
    add("sitemap-added", "info", cur.startUrl, "XML sitemap is now available");
  } else if (prev.site.sitemapHash !== cur.site.sitemapHash) {
    const before = new Set(prev.sitemapUrls);
    const after = new Set(cur.sitemapUrls);
    const added = cur.sitemapUrls.filter((u) => !before.has(u));
    const removed = prev.sitemapUrls.filter((u) => !after.has(u));
    add(
      "sitemap-changed",
      removed.length > 0 ? "warning" : "info",
      cur.startUrl,
      `Sitemap changed: +${added.length} / -${removed.length} URLs` +
        (removed.length > 0 ? ` (removed e.g. ${removed.slice(0, 3).join(", ")})` : "") +
        (added.length > 0 ? ` (added e.g. ${added.slice(0, 3).join(", ")})` : ""),
      String(prev.site.sitemapUrlCount),
      String(cur.site.sitemapUrlCount),
    );
  }
  if (prev.site.llmsFound !== cur.site.llmsFound) {
    add(
      "llms-changed",
      "info",
      cur.startUrl,
      cur.site.llmsFound ? "llms.txt is now served" : "llms.txt is no longer served",
    );
  }

  // ---- pages ----
  const failedNow = new Map(cur.failures.map((f) => [f.url, f]));
  const curByUrl = new Map(Object.values(cur.pages).map((p) => [p.url, p]));
  for (const [key, before] of Object.entries(prev.pages)) {
    const after = cur.pages[key] ?? curByUrl.get(before.url);
    if (!after) {
      const failure =
        failedNow.get(before.url) ??
        [...failedNow.values()].find((f) => f.url.replace(/\/$/, "") === before.url.replace(/\/$/, ""));
      if (failure) {
        add(
          "page-broken",
          "critical",
          before.url,
          `Page now fails to load: ${failure.status ? `HTTP ${failure.status}` : failure.error}`,
          String(before.status),
          String(failure.status || failure.error),
        );
      } else {
        add(
          "page-missing",
          "warning",
          before.url,
          "Page was not found in this crawl (removed, unlinked, or beyond the page cap)",
        );
      }
      continue;
    }
    if (!before.noindex && after.noindex) {
      add("noindex-added", "critical", after.url, "Page is now noindex — it will drop out of search results");
    } else if (before.noindex && !after.noindex) {
      add("noindex-removed", "info", after.url, "Page is indexable again (noindex removed)");
    }
    if (before.status !== after.status) {
      add(
        "status-changed",
        after.status >= 400 || after.status === 0 ? "critical" : "warning",
        after.url,
        `HTTP status changed ${before.status} -> ${after.status}`,
        String(before.status),
        String(after.status),
      );
    }
    if (before.canonical !== after.canonical) {
      add(
        "canonical-changed",
        after.canonical && after.canonical !== after.url ? "critical" : "warning",
        after.url,
        "rel=canonical changed",
        before.canonical || "(none)",
        after.canonical || "(none)",
      );
    }
    if (before.title !== after.title) {
      add(
        "title-changed",
        after.title ? "warning" : "critical",
        after.url,
        after.title ? "Title changed" : "Title was removed",
        before.title,
        after.title || "(empty)",
      );
    }
    if (before.metaDescription !== after.metaDescription) {
      add(
        "description-changed",
        "info",
        after.url,
        after.metaDescription ? "Meta description changed" : "Meta description was removed",
        before.metaDescription,
        after.metaDescription || "(empty)",
      );
    }
    if (before.h1 !== after.h1) {
      add("h1-changed", "info", after.url, "H1 changed", before.h1 || "(none)", after.h1 || "(none)");
    }
    if (before.contentHash !== after.contentHash) {
      const dropped = before.wordCount >= 100 && after.wordCount < before.wordCount * 0.5;
      add(
        dropped ? "content-dropped" : "content-changed",
        dropped ? "warning" : "info",
        after.url,
        dropped
          ? `Visible content shrank by more than half (${before.wordCount} -> ${after.wordCount} words)`
          : `Content changed (${before.wordCount} -> ${after.wordCount} words)`,
        String(before.wordCount),
        String(after.wordCount),
      );
    }
    const lostSchema = before.schemaTypes.filter((t) => !after.schemaTypes.includes(t));
    if (lostSchema.length > 0) {
      add(
        "schema-removed",
        "warning",
        after.url,
        `Structured data removed: ${lostSchema.join(", ")}`,
        before.schemaTypes.join(", "),
        after.schemaTypes.join(", ") || "(none)",
      );
    }
    const drop = before.search - after.search;
    if (drop >= SCORE_DROP_WARNING) {
      add(
        "score-dropped",
        drop >= SCORE_DROP_CRITICAL ? "critical" : "warning",
        after.url,
        `Search SEO score fell ${drop} points`,
        String(before.search),
        String(after.search),
      );
    } else if (-drop >= SCORE_DROP_WARNING) {
      add(
        "score-improved",
        "info",
        after.url,
        `Search SEO score rose ${-drop} points`,
        String(before.search),
        String(after.search),
      );
    }
    const prevIds = new Map(before.findings.map((f) => [f.id, f.severity]));
    const curIds = new Map(after.findings.map((f) => [f.id, f.severity]));
    for (const [id, sev] of curIds) {
      if (prevIds.has(id)) continue;
      if (sev === "P0") add("new-issue", "critical", after.url, `New critical issue: ${id}`);
      else if (sev === "P1") add("new-issue", "warning", after.url, `New high-priority issue: ${id}`);
    }
    const resolved = [...prevIds]
      .filter(([id, sev]) => !curIds.has(id) && (sev === "P0" || sev === "P1"))
      .map(([id]) => id);
    if (resolved.length > 0) add("issues-resolved", "info", after.url, `Resolved: ${resolved.join(", ")}`);
    if (after.ms > 1500 && before.ms > 0 && after.ms > before.ms * 2) {
      add(
        "response-slower",
        "warning",
        after.url,
        `Response time doubled (${before.ms} ms -> ${after.ms} ms, measured from this machine)`,
        String(before.ms),
        String(after.ms),
      );
    }
  }
  const prevUrls = new Set(Object.values(prev.pages).map((p) => p.url));
  for (const [key, p] of Object.entries(cur.pages)) {
    if (!prev.pages[key] && !prevUrls.has(p.url)) add("page-added", "info", p.url, "New page discovered");
  }
  const prevFailed = new Set(prev.failures.map((f) => f.url));
  for (const f of cur.failures) {
    if (prevFailed.has(f.url) || prevUrls.has(f.url)) continue;
    add("broken-url", "warning", f.url, `New broken URL: ${f.status ? `HTTP ${f.status}` : f.error}`);
  }

  return changes.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
}

/**
 * Count changes per level.
 * @param {Change[]} changes
 * @returns {Record<ChangeLevel, number>}
 */
export function summarizeChanges(changes) {
  /** @type {Record<ChangeLevel, number>} */
  const out = { critical: 0, warning: 0, info: 0 };
  for (const c of changes) out[c.level]++;
  return out;
}

/**
 * Directory holding the snapshots of one site.
 * @param {string} stateDir
 * @param {string} startUrl
 * @returns {string}
 */
export function monitorDir(stateDir, startUrl) {
  let host = startUrl;
  try {
    host = new URL(startUrl).host;
  } catch {
    // keep the raw value; slug() makes it filesystem-safe
  }
  return join(stateDir, "monitor", slug(host));
}

/**
 * Snapshot file names of a site, oldest first.
 * @param {string} dir
 * @returns {string[]}
 */
export function listSnapshots(dir) {
  return listDir(dir).filter((n) => /^snapshot-.+\.json$/.test(n));
}

/**
 * Most recent stored snapshot (null when none or unreadable).
 * @param {string} dir
 * @returns {Snapshot | null}
 */
export function loadLatestSnapshot(dir) {
  const names = listSnapshots(dir);
  for (let i = names.length - 1; i >= 0; i--) {
    const s = readJson(join(dir, names[i] ?? ""));
    if (isSnapshot(s)) return s;
  }
  return null;
}

/**
 * Persist a snapshot and prune old ones.
 * @param {string} dir
 * @param {Snapshot} snapshot
 * @param {number} [keep] snapshots to retain (default 60)
 * @returns {string} written file path
 */
export function saveSnapshot(dir, snapshot, keep = 60) {
  const stamp = snapshot.takenAt.replace(/[:.]/g, "-");
  const file = join(dir, `snapshot-${stamp}.json`);
  writeJsonAtomic(file, snapshot);
  prune(dir, keep, (n) => /^snapshot-.+\.json$/.test(n));
  return file;
}

/**
 * Append one line to the site's change log (JSON Lines-style array file).
 * @param {string} dir
 * @param {{ takenAt: string, summary: Record<ChangeLevel, number>, changes: Change[] }} entry
 * @param {number} [keep]
 */
export function appendChangeLog(dir, entry, keep = 200) {
  const file = join(dir, "changes.json");
  const existing = readJson(file);
  const log = Array.isArray(existing) ? existing : [];
  log.push(entry);
  writeJsonAtomic(file, log.slice(-keep));
}

/**
 * POST an alert payload to a webhook (Slack-compatible `text` + full detail).
 * Never throws: resolves with the delivery outcome.
 * @param {string} webhookUrl
 * @param {{ site: string, takenAt: string, summary: Record<ChangeLevel, number>, changes: Change[] }} alert
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, error: string }>}
 */
export async function sendWebhook(webhookUrl, alert, opts = {}) {
  let u;
  try {
    u = new URL(webhookUrl);
  } catch {
    return { ok: false, status: 0, error: "invalid webhook URL" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, status: 0, error: "webhook URL must be http(s)" };
  }
  const top = alert.changes
    .slice(0, 10)
    .map((c) => `[${c.level}] ${c.message} — ${c.url}`)
    .join("\n");
  const body = JSON.stringify({
    text: `one-step-seo monitor: ${alert.site} — ${alert.summary.critical} critical, ${alert.summary.warning} warning, ${alert.summary.info} info\n${top}`,
    tool: "one-step-seo",
    version: VERSION,
    ...alert,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10000);
  try {
    const res = await (opts.fetchImpl ?? fetch)(u, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": `one-step-seo/${VERSION}` },
      body,
      signal: controller.signal,
      redirect: "error",
    });
    return { ok: res.ok, status: res.status, error: res.ok ? "" : `webhook responded ${res.status}` };
  } catch (err) {
    // Never echo the URL: webhook URLs embed their secret in the path.
    const name = /** @type {{ name?: string }} */ (err)?.name;
    return {
      ok: false,
      status: 0,
      error: name === "AbortError" ? "webhook timed out" : "webhook request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
