/**
 * one-step-seo — text analysis primitives (pure, zero dependencies).
 *
 * Everything here is derived from the page's own words. Nothing in this module
 * is, or pretends to be, search-demand data: term counts are on-page frequency,
 * not search volume, and similarity is lexical, not a ranking signal.
 */
import { createHash } from "node:crypto";

/** English function words ignored by term extraction and similarity. */
export const STOPWORDS = new Set(
  (
    "a an the and or but nor so yet to of for with on in at by from into onto over under about after before " +
    "between through during without within along across behind beyond near off out up down is are was were be " +
    "been being am do does did doing have has had having will would shall should can could may might must " +
    "that this these those it its it's they them their theirs there here he she him her his hers we us our " +
    "ours you your yours i me my mine who whom whose which what when where why how all any both each few more " +
    "most other some such no not only own same than too very just also as if then else while because until " +
    "again further once s t don now get got new one two use used using make made via per vs etc"
  ).split(" "),
);

/**
 * Lowercased word tokens (letters/digits, unicode-aware). Tokens shorter than
 * `minLen` and pure numbers are dropped.
 * @param {string} text
 * @param {number} [minLen]
 * @returns {string[]}
 */
export function tokenize(text, minLen = 2) {
  const out = [];
  const re = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
  const s = String(text || "").toLowerCase();
  let m;
  while ((m = re.exec(s)) !== null) {
    const w = m[0].replace(/[’']s$/, "");
    if (w.length < minLen || /^\d+$/.test(w)) continue;
    out.push(w);
  }
  return out;
}

/**
 * Content-bearing tokens: tokenize() minus stopwords.
 * @param {string} text
 * @returns {string[]}
 */
export function contentTerms(text) {
  return tokenize(text, 3).filter((w) => !STOPWORDS.has(w));
}

/**
 * Most frequent content terms on a page (on-page frequency, NOT search volume).
 * @param {string} text
 * @param {number} [limit]
 * @returns {{ term: string, count: number }[]}
 */
export function topTerms(text, limit = 15) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const w of contentTerms(text)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

/**
 * Stable fingerprint of normalized visible text (case and whitespace folded).
 * Two pages with the same hash carry identical body copy.
 * @param {string} text
 * @returns {string} hex sha1, or "" for empty text
 */
export function contentHash(text) {
  const norm = String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return "";
  return createHash("sha1").update(norm).digest("hex");
}

const MASK64 = (1n << 64n) - 1n;

/**
 * 64-bit FNV-1a of a string.
 * @param {string} s
 * @returns {bigint}
 */
function fnv1a64(s) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i) & 0xff);
    h = (h * 0x100000001b3n) & MASK64;
    h ^= BigInt(s.charCodeAt(i) >> 8);
    h = (h * 0x100000001b3n) & MASK64;
  }
  return h;
}

/**
 * SimHash over 3-word shingles: near-identical documents get fingerprints a
 * few bits apart. Returns a 16-char hex string, or "" when the text is too
 * short to fingerprint meaningfully (< 3 tokens).
 * @param {string} text
 * @returns {string}
 */
export function simhash(text) {
  const words = tokenize(text, 1);
  if (words.length < 3) return "";
  const weights = new Int32Array(64);
  for (let i = 0; i + 2 < words.length; i++) {
    const h = fnv1a64(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    for (let b = 0; b < 64; b++) {
      weights[b] = (weights[b] ?? 0) + ((h >> BigInt(b)) & 1n ? 1 : -1);
    }
  }
  let out = 0n;
  for (let b = 0; b < 64; b++) if ((weights[b] ?? 0) > 0) out |= 1n << BigInt(b);
  return out.toString(16).padStart(16, "0");
}

/**
 * Hamming distance between two simhash hex strings (64 = unrelated / invalid).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function simhashDistance(a, b) {
  if (!a || !b || !/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) return 64;
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    x &= x - 1n;
    n++;
  }
  return n;
}

/**
 * Jaccard similarity of two term lists (as sets). 0 when either is empty.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number}
 */
export function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Strip a trailing brand segment from a title ("Pricing | Acme" -> "Pricing").
 * Only the last separator-delimited segment is dropped, and only when what
 * remains still has content.
 * @param {string} title
 * @returns {string}
 */
export function stripBrandSuffix(title) {
  const t = String(title || "").trim();
  const parts = t.split(/\s+[|–—·•:-]\s+/);
  if (parts.length < 2) return t;
  const head = parts.slice(0, -1).join(" ").trim();
  return head.length >= 3 ? head : t;
}
