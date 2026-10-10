/**
 * one-step-seo — report diffing for regression tracking.
 * Compares two report.json objects (e.g. base-branch vs. PR audit):
 * score deltas, new/resolved findings, severity escalations.
 * Pure, zero dependencies. Findings match by stable finding ID.
 */

/** Severity rank for escalation checks (lower is more urgent). @type {Record<string, number>} */
const SEV_RANK = { P0: 0, P1: 1, P2: 2, P3: 3, pass: 4 };

/**
 * True when the value looks like a one-step-seo report.json.
 * @param {any} r
 * @returns {boolean}
 */
export function isReport(r) {
  if (!r || typeof r !== "object") return false;
  if (r.tool !== "one-step-seo") return false;
  if (!Array.isArray(r.findings)) return false;
  const scores = r.scores;
  if (!scores || typeof scores !== "object") return false;
  for (const axis of ["search", "ai"]) {
    const s = scores[axis];
    if (!s || typeof s.score !== "number") return false;
  }
  return true;
}

/**
 * @typedef {{ id: string, severity: string, title: string }} DiffFinding
 * @typedef {{
 *   url: string, finalUrl: string,
 *   rulesVersionChanged: boolean, oldRulesVersion: string, newRulesVersion: string,
 *   search: { old: number, new: number, delta: number },
 *   ai: { old: number, new: number, delta: number },
 *   newFindings: DiffFinding[], resolvedFindings: DiffFinding[],
 *   escalated: { id: string, title: string, oldSeverity: string, newSeverity: string }[]
 * }} ReportDiff
 */

/**
 * Diff an old report against a new one. Both must satisfy isReport()
 * (validated by the caller/CLI; unknown severities sort last).
 * @param {any} oldR
 * @param {any} newR
 * @returns {ReportDiff}
 */
export function diffReports(oldR, newR) {
  /** @type {Map<string, { severity: string, title: string }>} */
  const oldById = new Map();
  for (const f of oldR.findings ?? []) {
    if (f && f.id && !oldById.has(f.id)) oldById.set(f.id, { severity: f.severity, title: f.title ?? "" });
  }
  /** @type {Map<string, { severity: string, title: string }>} */
  const newById = new Map();
  for (const f of newR.findings ?? []) {
    if (f && f.id && !newById.has(f.id)) newById.set(f.id, { severity: f.severity, title: f.title ?? "" });
  }
  /** @type {DiffFinding[]} */
  const newFindings = [];
  /** @type {DiffFinding[]} */
  const resolvedFindings = [];
  /** @type {{ id: string, title: string, oldSeverity: string, newSeverity: string }[]} */
  const escalated = [];
  for (const [id, n] of newById) {
    const o = oldById.get(id);
    if (!o) {
      if (n.severity !== "pass") newFindings.push({ id, severity: n.severity, title: n.title });
    } else if ((SEV_RANK[n.severity] ?? 9) < (SEV_RANK[o.severity] ?? 9)) {
      escalated.push({ id, title: n.title, oldSeverity: o.severity, newSeverity: n.severity });
    }
  }
  for (const [id, o] of oldById) {
    if (!newById.has(id) && o.severity !== "pass") {
      resolvedFindings.push({ id, severity: o.severity, title: o.title });
    }
  }
  const bySeverity = (/** @type {DiffFinding} */ a, /** @type {DiffFinding} */ b) =>
    (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) || (a.id < b.id ? -1 : 1);
  newFindings.sort(bySeverity);
  resolvedFindings.sort(bySeverity);
  const oldRulesVersion = String(oldR.rulesVersion ?? "");
  const newRulesVersion = String(newR.rulesVersion ?? "");
  const searchOld = Number(oldR.scores?.search?.score ?? 0);
  const searchNew = Number(newR.scores?.search?.score ?? 0);
  const aiOld = Number(oldR.scores?.ai?.score ?? 0);
  const aiNew = Number(newR.scores?.ai?.score ?? 0);
  return {
    url: String(newR.url ?? oldR.url ?? ""),
    finalUrl: String(newR.finalUrl ?? oldR.finalUrl ?? ""),
    rulesVersionChanged: oldRulesVersion !== newRulesVersion,
    oldRulesVersion,
    newRulesVersion,
    search: { old: searchOld, new: searchNew, delta: searchNew - searchOld },
    ai: { old: aiOld, new: aiNew, delta: aiNew - aiOld },
    newFindings,
    resolvedFindings,
    escalated,
  };
}
