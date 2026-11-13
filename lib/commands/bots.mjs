/**
 * one-step-seo — `bots <url>` and `audit --bots`: what search and AI crawlers
 * get from a site's pages compared with a browser (engine: lib/bot-check.mjs,
 * ported from Open SEO Crawler, MIT). With --pages N the site is crawled
 * first and a sample is checked: the start page plus one page per section.
 */
import { BOT_AGENTS, BOT_ROBOTS_ONLY, BOT_SAMPLE_PAGES, runBotCheck, sampleBotPages } from "../bot-check.mjs";
import { c } from "../colors.mjs";
import { crawlSite, robotsPathOf } from "../crawl.mjs";
import { describeCrawlerFinding } from "../intelligence.mjs";
import { getSiteFiles, isDisallowed } from "../robots.mjs";
import { UA_TOKEN, USER_AGENT, VERSION } from "../version.mjs";
import { crawlHooks, crawlOptionsFrom, isInterrupted } from "./shared.mjs";

/** @type {Record<string, string>} */
const KIND_WORD = {
  search: "Search",
  "ai-search": "AI search",
  "ai-assistant": "AI assistant",
  training: "Training",
};

/** Worst first, for multi-page summaries. */
const STATE_ORDER = [
  "blocked",
  "challenged",
  "noindex",
  "different",
  "redirected",
  "thinner",
  "error",
  "disallowed",
  "same",
];

const CAVEAT =
  "Requests come from this machine with each crawler's user agent. CDNs and firewalls verify real crawlers by IP address, so treat a problem as a lead: check your CDN or firewall bot settings, and confirm Googlebot with the URL Inspection live test in Search Console.";

/**
 * The site's robots.txt, read with this tool's own user agent (cached per
 * origin, so an audit's earlier read is reused). Never throws.
 * @param {string} url
 * @param {import("../args.mjs").ParsedArgs} args
 * @returns {Promise<{ text: string, note: string }>}
 */
async function siteRobots(url, args) {
  try {
    const site = await getSiteFiles(url, {
      timeoutMs: args.timeout,
      userAgent: USER_AGENT,
      blockPrivateIps: Boolean(args.blockPrivateIps),
    });
    if (site.robots.found) return { text: site.robots.text ?? "", note: "" };
    const status = Number(site.robots.status) || 0;
    return {
      text: "",
      note:
        status >= 500 || status === 0
          ? `robots.txt could not be read (${status ? `HTTP ${status}` : "no answer"}), so every crawler counts as allowed here. Google treats a robots.txt that fails with a server error as disallowing the whole site for a while.`
          : "The site has no robots.txt, so every crawler is allowed.",
    };
  } catch {
    return { text: "", note: "robots.txt could not be read, so every crawler counts as allowed here." };
  }
}

/**
 * Options for runBotCheck from the CLI arguments, with a progress line on a TTY.
 * @param {import("../args.mjs").ParsedArgs} args
 * @param {{ text: string, note: string }} robots
 * @returns {{ options: import("../bot-check.mjs").BotCheckOptions, done: () => void }}
 */
function checkOptions(args, robots) {
  const showProgress = Boolean(process.stderr.isTTY) && !args.quiet && !args.json;
  return {
    options: {
      robotsText: robots.text,
      ...(robots.note ? { robotsNote: robots.note } : {}),
      force: Boolean(args.force),
      delay: args.delay,
      timeoutMs: args.timeout,
      blockPrivateIps: Boolean(args.blockPrivateIps),
      interrupted: isInterrupted,
      onProgress: (done, total) => {
        if (showProgress) process.stderr.write(`\r[${done}/${total} crawler-check requests]    `);
      },
    },
    done: () => {
      if (showProgress) process.stderr.write(`\r${" ".repeat(60)}\r`);
    },
  };
}

/**
 * The crawler check for `audit --bots`: a sample of the crawled pages.
 * @param {string} url the audit's start URL (whose robots.txt applies)
 * @param {import("../crawl.mjs").PageFacts[]} pages
 * @param {import("../args.mjs").ParsedArgs} args
 * @returns {Promise<import("../bot-check.mjs").BotCheckReport | null>}
 */
export async function crawlerCheckForAudit(url, pages, args) {
  if (isInterrupted()) return null;
  const sample = sampleBotPages(pages, BOT_SAMPLE_PAGES);
  if (sample.length === 0) {
    console.error("! Crawler check skipped: no crawled page answered 200 as an indexable page.");
    return null;
  }
  const robots = await siteRobots(url, args);
  if (!args.quiet) {
    console.error(
      `Crawler check: ${sample.length} page${sample.length === 1 ? "" : "s"} as ${BOT_AGENTS.length} crawlers and a browser…`,
    );
  }
  const { options, done } = checkOptions(args, robots);
  const report = await runBotCheck(sample, options);
  done();
  return report;
}

/**
 * One crawler's result on one page, or across the sample.
 * @param {import("../bot-check.mjs").BotCheckReport} report
 * @param {string} id
 * @returns {{ text: string, state: string }}
 */
function resultFor(report, id) {
  if (report.pages.length === 1) {
    const cell = report.pages[0]?.cells[id];
    if (!cell) return { text: "not checked", state: "error" };
    if (cell.state === "same") return { text: cell.detail, state: "same" };
    if (cell.state === "disallowed") return { text: "not requested (robots.txt)", state: "disallowed" };
    return { text: `${cell.state}: ${cell.detail}`, state: cell.state };
  }
  const v = report.verdicts[id];
  if (!v || v.checked === 0) return { text: "not checked", state: "error" };
  const parts = STATE_ORDER.filter((s) => (v.counts[s] ?? 0) > 0).map((s) => `${s} ${v.counts[s]}`);
  return { text: `${parts.join(", ")} (of ${v.checked} pages)`, state: v.state };
}

/**
 * @param {string} state
 * @param {string} text
 * @returns {string}
 */
function paint(state, text) {
  if (state === "same") return c.green(text);
  if (state === "disallowed") return c.gray(text);
  if (state === "redirected" || state === "thinner" || state === "error") return c.yellow(text);
  return c.red(text);
}

/**
 * Whether robots.txt allows a crawler on every page, some, or none.
 * @param {import("../bot-check.mjs").BotCheckReport} report
 * @param {string} id
 * @returns {string}
 */
function robotsWord(report, id) {
  const verdicts = report.pages.map((p) => p.robots[id] !== false);
  if (verdicts.every(Boolean)) return "allowed";
  return verdicts.some(Boolean) ? "partly disallowed" : "disallowed";
}

/**
 * Print the crawler check as a table plus the problems found per page.
 * @param {import("../bot-check.mjs").BotCheckReport} report
 */
export function printBotReport(report) {
  /** @type {{ cells: string[], state: string }[]} */
  const rows = [{ cells: ["Crawler", "Kind", "robots.txt", "Result"], state: "" }];
  for (const a of BOT_AGENTS) {
    const r = resultFor(report, a.id);
    rows.push({
      cells: [a.label, KIND_WORD[a.kind] ?? a.kind, robotsWord(report, a.id), r.text],
      state: r.state,
    });
  }
  for (const a of BOT_ROBOTS_ONLY) {
    rows.push({
      cells: [a.label, KIND_WORD[a.kind] ?? a.kind, robotsWord(report, a.id), "robots.txt rules only"],
      state: "",
    });
  }
  const widths = [0, 1, 2].map((i) => Math.max(...rows.map((r) => (r.cells[i] ?? "").length)));
  rows.forEach((r, n) => {
    const head = r.cells
      .slice(0, 3)
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join("  ");
    const last = r.cells[3] ?? "";
    console.log(
      `  ${n === 0 ? c.bold(head) : head}  ${n === 0 ? c.bold(last) : r.state ? paint(r.state, last) : c.dim(last)}`,
    );
  });

  const withFindings = report.pages.filter((p) => p.findings.length > 0);
  if (withFindings.length > 0) {
    console.log("");
    console.log(c.bold("Problems found:"));
    for (const p of withFindings) {
      console.log(`  ${p.url}`);
      for (const f of p.findings) console.log(`    ${c.red("!")} ${f.label}: ${describeCrawlerFinding(f)}`);
    }
  } else if (report.pages.some((p) => p.baseline.status === 200)) {
    console.log("");
    console.log(c.green("No crawler got a different page than the browser."));
  }
  console.log("");
  for (const note of report.notes) console.log(c.dim(`Note: ${note}`));
  console.log(c.dim(CAVEAT));
}

/**
 * `one-step-seo bots <url>`.
 * @param {string} url
 * @param {import("../args.mjs").ParsedArgs} args
 */
export async function cmdBots(url, args) {
  const robots = await siteRobots(url, args);
  if (!args.force && robots.text && isDisallowed(robots.text, UA_TOKEN, robotsPathOf(url))) {
    console.error(
      `! robots.txt disallows ${url} for ${UA_TOKEN}: not checked (re-run with --force on a site you own).`,
    );
    process.exitCode = 2;
    return;
  }
  /** @type {string[]} */
  let urls = [url];
  if (args.pages > 1 || args.all) {
    const hooks = crawlHooks(args);
    const crawl = await crawlSite(
      url,
      { ...crawlOptionsFrom(args), probes: false, checkLinks: false },
      hooks,
    );
    hooks.done();
    const sample = sampleBotPages(crawl.pages, BOT_SAMPLE_PAGES);
    if (sample.length > 0) urls = sample;
  }
  if (!args.quiet && !args.json) {
    console.log(
      `Crawler check: ${urls.length} page${urls.length === 1 ? "" : "s"} requested as ${BOT_AGENTS.length} crawlers and a browser, ${args.delay} ms apart.`,
    );
  }
  const { options, done } = checkOptions(args, robots);
  const report = await runBotCheck(urls, options);
  done();
  if (report.pages.length > 0 && report.pages.every((p) => p.baseline.error)) {
    process.exitCode = 2;
  }
  if (args.json) {
    console.log(JSON.stringify({ tool: "one-step-seo", version: VERSION, url, ...report }, null, 2));
    return;
  }
  printBotReport(report);
}
