/**
 * one-step-seo — minimal unified-diff generator (zero deps).
 *
 * Strategy: trim the common prefix/suffix so only the edited middle reaches
 * the LCS step (fix edits are a handful of lines, so the DP stays tiny);
 * pathological middles fall back to a single remove+add block instead of
 * blowing up memory.
 */

const CONTEXT = 3;
/** Max LCS table cells before falling back to a block replace. */
const LCS_CELL_BUDGET = 250_000;

/**
 * @typedef {{ t: " " | "-" | "+", line: string }} DiffOp
 */

/**
 * Line-level diff of two middle segments via LCS (prefix/suffix already
 * trimmed by the caller).
 * @param {string[]} a
 * @param {string[]} b
 * @returns {DiffOp[]}
 */
function lcsOps(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = new Int32Array((n + 1) * (m + 1));
  /** @param {number} i @param {number} j @returns {number} */
  const at = (i, j) => i * (m + 1) + j;
  /** @param {number} i @param {number} j @returns {number} */
  const d = (i, j) => dp[at(i, j)] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = a[i] === b[j] ? d(i + 1, j + 1) + 1 : Math.max(d(i + 1, j), d(i, j + 1));
    }
  }
  /** @type {DiffOp[]} */
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: " ", line: a[i] ?? "" });
      i++;
      j++;
    } else if (d(i + 1, j) >= d(i, j + 1)) {
      ops.push({ t: "-", line: a[i] ?? "" });
      i++;
    } else {
      ops.push({ t: "+", line: b[j] ?? "" });
      j++;
    }
  }
  while (i < n) {
    ops.push({ t: "-", line: a[i] ?? "" });
    i++;
  }
  while (j < m) {
    ops.push({ t: "+", line: b[j] ?? "" });
    j++;
  }
  return ops;
}

/**
 * Build a unified diff between two texts. Returns "" when identical.
 * @param {string} before
 * @param {string} after
 * @param {string} label shown in the ---/+++ headers
 * @returns {string}
 */
export function unifiedDiff(before, after, label = "file") {
  if (before === after) return "";
  const a = before.split("\n");
  const b = after.split("\n");

  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;

  const aMid = a.slice(p, a.length - s);
  const bMid = b.slice(p, b.length - s);

  /** @type {DiffOp[]} */
  let midOps;
  if (aMid.length * bMid.length <= LCS_CELL_BUDGET) {
    midOps = lcsOps(aMid, bMid);
  } else {
    midOps = [
      ...aMid.map((line) => ({ t: /** @type {const} */ ("-"), line })),
      ...bMid.map((line) => ({ t: /** @type {const} */ ("+"), line })),
    ];
  }

  /** @type {DiffOp[]} */
  const stream = [
    ...a.slice(0, p).map((line) => ({ t: /** @type {const} */ (" "), line })),
    ...midOps,
    ...a.slice(a.length - s).map((line) => ({ t: /** @type {const} */ (" "), line })),
  ];

  // Cluster change positions, then expand each cluster by CONTEXT lines and
  // merge overlapping ranges.
  /** @type {{ lo: number, hi: number }[]} */
  const ranges = [];
  for (let i = 0; i < stream.length; i++) {
    if (stream[i]?.t === " ") continue;
    const lo = Math.max(0, i - CONTEXT);
    const hi = Math.min(stream.length, i + 1 + CONTEXT);
    const last = ranges[ranges.length - 1];
    if (last && lo <= last.hi) last.hi = Math.max(last.hi, hi);
    else ranges.push({ lo, hi });
  }

  // Line numbers start at 1; "old" counts space+minus, "new" space+plus.
  let oldSeen = 0;
  let newSeen = 0;
  /** @type {string[]} */
  const out = [`--- a/${label}`, `+++ b/${label}`];

  let cursor = 0;
  for (const range of ranges) {
    // Count everything before this range to derive its starting lines.
    for (let i = cursor; i < range.lo; i++) {
      const t = stream[i]?.t;
      if (t === " " || t === "-") oldSeen++;
      if (t === " " || t === "+") newSeen++;
    }
    cursor = range.lo;

    let oldCount = 0;
    let newCount = 0;
    for (let i = range.lo; i < range.hi; i++) {
      const t = stream[i]?.t;
      if (t === " " || t === "-") oldCount++;
      if (t === " " || t === "+") newCount++;
    }
    const oldStart = oldCount === 0 ? oldSeen : oldSeen + 1;
    const newStart = newCount === 0 ? newSeen : newSeen + 1;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (let i = range.lo; i < range.hi; i++) {
      const op = stream[i];
      if (op) out.push(op.t + op.line);
      if (op?.t === " " || op?.t === "-") oldSeen++;
      if (op?.t === " " || op?.t === "+") newSeen++;
    }
    cursor = range.hi;
  }

  return out.join("\n") + "\n";
}
