/**
 * one-step-seo — GEO (AI-citation readiness) detail + dual scoring.
 * Two scores, never blended: Search SEO and AI Visibility.
 */

export function geoDetails(parsed, siteFiles) {
  const signals = [
    { key: "answer-first", ok: parsed.hasAnswerBlock, weight: 25 },
    { key: "extractable (tables/lists)", ok: parsed.tables > 0 || parsed.lists > 0, weight: 20 },
    { key: "substantive copy (>=300w)", ok: parsed.wordCount >= 300, weight: 15 },
    { key: "faq coverage", ok: parsed.faqDetected, weight: 10 },
    { key: "single clear H1", ok: parsed.h1s.length === 1, weight: 10 },
    { key: "descriptive headings", ok: parsed.h2s.length > 0, weight: 5 },
    { key: "entity basics (title+desc)", ok: !!parsed.title && !!parsed.metaDescription, weight: 5 },
    { key: "llms.txt", ok: siteFiles.llms.found, weight: 5 },
    { key: "ai crawlers allowed", ok: !siteFiles.robots.aiBlocked, weight: 5 },
  ];
  const score = signals.reduce((s, x) => s + (x.ok ? x.weight : 0), 0);
  return { score, signals };
}

function band(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

const SEARCH_WEIGHTS = { P0: 25, P1: 10, P2: 3, P3: 1 };

export function computeScores(findings, geo) {
  let search = 100;
  for (const f of findings) {
    if (f.severity === "pass") continue;
    // GEO-only findings barely affect the Search score and vice versa.
    if (f.category === "geo" && (f.id === "G01-llms" || f.id === "G02-ai-blocked")) continue;
    search -= SEARCH_WEIGHTS[f.severity] ?? 0;
  }
  search = Math.max(0, Math.min(100, search));
  const ai = Math.max(0, Math.min(100, geo.score));
  return {
    search: { score: search, band: band(search) },
    ai: { score: ai, band: band(ai) },
  };
}
