/**
 * one-step-seo — GEO (AI-citation readiness) detail + dual scoring.
 * Two scores, never blended: Search SEO and AI Visibility.
 */
import { THRESHOLDS } from "./checks.mjs";

/** GEO signal weights (sum = 100). Keep in sync with docs/SCORING.md. */
export const GEO_WEIGHTS = {
  answerFirst: 25,
  extractable: 20,
  substantive: 15,
  faq: 10,
  singleH1: 10,
  headings: 5,
  entityBasics: 5,
  llms: 5,
  aiAllowed: 5,
};

/** Search deduction weights per severity. Keep in sync with docs/SCORING.md. */
export const SEARCH_WEIGHTS = { P0: 25, P1: 10, P2: 3, P3: 1 };

/**
 * Ruleset version stamped on every report as `rulesVersion`. Bump when any
 * check, threshold, or weight changes so `audit --diff` can tell rule drift
 * apart from site drift. Format YYYY.MM of the change.
 */
export const RULES_VERSION = "2026.10";

/** GEO-only finding IDs excluded from the Search score. G03-facts stays
 *  because it carries seoImpact=low (extractability helps both axes).
 *  G04/G05 are AI-discovery polish (P3) with no classic-ranking effect. */
export const GEO_ONLY_IDS = new Set([
  "G01-llms",
  "G02-ai-blocked",
  "G04-entity",
  "G05-llms-quality",
  "G06-freshness",
  "G07-question-headings",
  "G08-stat-density",
]);

/**
 * @param {any} parsed
 * @param {any} siteFiles
 * @returns {{ score: number, signals: { key: string, ok: boolean, weight: number }[] }}
 */
export function geoDetails(parsed, siteFiles) {
  /** @type {any} */
  const p = parsed && typeof parsed === "object" ? parsed : {};
  /** @type {any} */
  const site = siteFiles && typeof siteFiles === "object" ? siteFiles : {};
  /** @type {any} */
  const llms = site.llms && typeof site.llms === "object" ? site.llms : { found: false };
  /** @type {any} */
  const robots = site.robots && typeof site.robots === "object" ? site.robots : { aiBlocked: false };
  const signals = [
    { key: "answer-first", ok: !!p.hasAnswerBlock, weight: GEO_WEIGHTS.answerFirst },
    {
      key: "extractable (tables/lists)",
      ok: Number(p.tables ?? 0) > 0 || Number(p.lists ?? 0) > 0,
      weight: GEO_WEIGHTS.extractable,
    },
    {
      key: `substantive copy (>=${THRESHOLDS.geoSubstantiveWords}w)`,
      ok: Number(p.wordCount ?? 0) >= THRESHOLDS.geoSubstantiveWords,
      weight: GEO_WEIGHTS.substantive,
    },
    { key: "faq coverage", ok: !!p.faqDetected, weight: GEO_WEIGHTS.faq },
    {
      key: "single clear H1",
      ok: Array.isArray(p.h1s) ? p.h1s.length === 1 : false,
      weight: GEO_WEIGHTS.singleH1,
    },
    {
      key: "descriptive headings",
      ok: Array.isArray(p.h2s) ? p.h2s.length > 0 : false,
      weight: GEO_WEIGHTS.headings,
    },
    {
      key: "entity basics (title+desc)",
      ok: !!p.title && !!p.metaDescription,
      weight: GEO_WEIGHTS.entityBasics,
    },
    { key: "llms.txt", ok: !!llms.found, weight: GEO_WEIGHTS.llms },
    { key: "ai crawlers allowed", ok: !robots.aiBlocked, weight: GEO_WEIGHTS.aiAllowed },
  ];
  const score = signals.reduce((s, x) => s + (x.ok ? x.weight : 0), 0);
  return { score, signals };
}

/**
 * @param {number} score
 * @returns {string}
 */
function band(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

/**
 * Band letter for a 0–100 score. Exported for report.mjs dashboard gauges
 * so thresholds live in exactly one place.
 * @param {number} score
 * @returns {string}
 */
export function scoreBand(score) {
  return band(score);
}

/** @type {Record<string, number>} */
const SEARCH_DEDUCT = SEARCH_WEIGHTS;

/**
 * @param {{ severity: string, category: string, id: string }[]} findings
 * @param {{ score: number }} geo
 * @returns {{ search: { score: number, band: string }, ai: { score: number, band: string } }}
 */
export function computeScores(findings, geo) {
  let search = 100;
  const list = Array.isArray(findings) ? findings : [];
  for (const f of list) {
    if (!f || f.severity === "pass") continue;
    // GEO-only discovery findings (llms.txt presence, AI-bot allowlist) do not
    // affect the Search score. G03-facts intentionally still deducts: poor
    // extractability hurts classic ranking too (seoImpact=low).
    if (f.category === "geo" && GEO_ONLY_IDS.has(f.id)) continue;
    search -= SEARCH_DEDUCT[f.severity] ?? 0;
  }
  search = Math.max(0, Math.min(100, search));
  const ai = Math.max(0, Math.min(100, Number(geo?.score ?? 0)));
  return {
    search: { score: search, band: band(search) },
    ai: { score: ai, band: band(ai) },
  };
}
