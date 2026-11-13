/**
 * one-step-seo — crawl pacing, retries and server-protection signals.
 *
 * Ported from Open SEO Crawler (crawl_throttle.py, and the block/challenge
 * detection in app.py and challenge_browser.py), MIT License,
 * Copyright (c) 2026 Puneet Inder Singh — see THIRD_PARTY_NOTICES.md.
 *
 * Only the *detection* side of bot protection is ported. When a firewall or
 * CDN challenge answers, one-step-seo reports it and stops retrying; it never
 * tries to get past it.
 */

/** HTTP statuses worth one more try after a pause: rate limits and gateway hiccups. */
export const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/** Statuses a firewall or CDN uses to turn a request away. */
const BLOCK_STATUSES = new Set([403, 429, 503]);

// "Attention Required!" is Cloudflare's hard block page (detectWafBlock), not a challenge.
const CHALLENGE_TITLE = /just a moment|checking your browser|verifying you are human/i;

/**
 * Seconds a Retry-After header asks for, or null when absent or unreadable.
 * Accepts both legal forms: delta seconds ("120") and an HTTP date
 * ("Wed, 21 Oct 2026 07:28:00 GMT"). A date in the past gives 0.
 * @param {string | null | undefined} value
 * @param {number} [nowMs] current time in ms (injectable for tests)
 * @returns {number | null}
 */
export function parseRetryAfter(value, nowMs = Date.now()) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Math.max(Number(text), 0);
  // Only accept a real date: Date.parse also reads bare numbers and other
  // shapes, which the numeric branch above has already handled.
  if (!/[a-z]/i.test(text)) return null;
  const when = Date.parse(text);
  if (Number.isNaN(when)) return null;
  return Math.max((when - nowMs) / 1000, 0);
}

/**
 * Per-host request gap derived from how slowly the host is answering.
 *
 * `record(host, seconds)` feeds one healthy response time in; `gap(host)` is
 * the minimum gap, in seconds, to leave between two request starts to that
 * host (0 = no opinion: the configured delay applies untouched).
 *
 * A host counts as slow once its smoothed response time has stayed at or
 * above SLOW_SECONDS for SLOW_STREAK responses in a row (one heavy page does
 * not trip it), and as recovered once it drops under RECOVER_SECONDS. While
 * slow, requests are spaced so about TARGET_IN_FLIGHT are in flight, capped
 * at MAX_GAP. It never speeds a crawl up past the configured delay.
 */
export class LatencyThrottle {
  static SLOW_SECONDS = 1.5;
  static RECOVER_SECONDS = 1.0;
  static SLOW_STREAK = 3;
  static TARGET_IN_FLIGHT = 2;
  static MAX_GAP = 10;
  static SMOOTHING = 0.3;

  /** @param {boolean} [enabled] */
  constructor(enabled = true) {
    this.enabled = Boolean(enabled);
    /** @type {Map<string, number>} */
    this.avg = new Map();
    /** @type {Map<string, number>} */
    this.streak = new Map();
    /** @type {Set<string>} */
    this.slow = new Set();
    /** @type {string[]} */
    this.notices = [];
  }

  /**
   * Feed one healthy response time (seconds) for a host.
   * @param {string} host
   * @param {number} seconds
   */
  record(host, seconds) {
    if (!this.enabled) return;
    const s = Number(seconds);
    if (!Number.isFinite(s) || s <= 0) return;
    const prev = this.avg.get(host);
    const avg = prev === undefined ? s : prev + LatencyThrottle.SMOOTHING * (s - prev);
    this.avg.set(host, avg);
    const streak = avg >= LatencyThrottle.SLOW_SECONDS ? (this.streak.get(host) ?? 0) + 1 : 0;
    this.streak.set(host, streak);
    if (!this.slow.has(host)) {
      if (streak >= LatencyThrottle.SLOW_STREAK) {
        this.slow.add(host);
        this.notices.push(
          `${host} is answering slowly (about ${avg.toFixed(1)}s a page): spacing requests about ${this.gap(host).toFixed(1)}s apart`,
        );
      }
    } else if (avg < LatencyThrottle.RECOVER_SECONDS) {
      this.slow.delete(host);
      this.notices.push(`${host} is answering quickly again: back to normal speed`);
    }
  }

  /**
   * Minimum seconds between request starts for this host; 0 if none.
   * @param {string} host
   * @returns {number}
   */
  gap(host) {
    if (!this.enabled || !this.slow.has(host)) return 0;
    return Math.min((this.avg.get(host) ?? 0) / LatencyThrottle.TARGET_IN_FLIGHT, LatencyThrottle.MAX_GAP);
  }

  /**
   * True while the host is being paced.
   * @param {string} host
   * @returns {boolean}
   */
  isSlow(host) {
    return this.enabled && this.slow.has(host);
  }

  /**
   * Smoothed response time for a host, or null before any response.
   * @param {string} host
   * @returns {number | null}
   */
  average(host) {
    return this.avg.get(host) ?? null;
  }

  /**
   * Messages about hosts that turned slow or recovered since the last call.
   * @returns {string[]}
   */
  popNotices() {
    const out = this.notices;
    this.notices = [];
    return out;
  }
}

/**
 * Case-insensitive header lookup.
 * @param {Record<string, string> | undefined | null} headers
 * @param {string} name
 * @returns {string}
 */
export function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) return String(v ?? "");
  }
  return "";
}

/**
 * Name the firewall whose block page answered, or "" when none is recognised.
 * Retrying a block page against the same IP only escalates the block.
 * @param {number} status
 * @param {string} body response body (only the first few KB are read)
 * @returns {"wordfence" | "cloudflare" | "sucuri" | "siteground" | ""}
 */
export function detectWafBlock(status, body) {
  if (!BLOCK_STATUSES.has(status)) return "";
  const head = String(body ?? "")
    .slice(0, 4000)
    .toLowerCase();
  if (head.includes("wordfence")) return "wordfence";
  if (head.includes("attention required") && head.includes("cloudflare")) return "cloudflare";
  if (head.includes("sucuri") && (head.includes("website firewall") || head.includes("access denied"))) {
    return "sucuri";
  }
  if (head.includes("siteground") && (head.includes("blocked") || head.includes("security"))) {
    return "siteground";
  }
  return "";
}

/**
 * True when a response is a CDN bot challenge ("Just a moment…") rather than
 * the page. Detection only: the challenge is reported, never solved.
 * @param {number} status
 * @param {Record<string, string> | undefined | null} headers
 * @param {string} body
 * @returns {boolean}
 */
export function isChallengeResponse(status, headers, body) {
  if (headerValue(headers, "cf-mitigated").toLowerCase() === "challenge") return true;
  if (status !== 403 && status !== 503) return false;
  const head = String(body ?? "").slice(0, 8000);
  if (head.includes("challenge-platform") || head.includes("__cf_chl")) return true;
  return headerValue(headers, "server").toLowerCase().includes("cloudflare") && CHALLENGE_TITLE.test(head);
}

/**
 * Describe a response that a firewall or CDN challenge produced, or "".
 * @param {number} status
 * @param {Record<string, string> | undefined | null} headers
 * @param {string} body
 * @returns {string}
 */
export function protectionNote(status, headers, body) {
  if (isChallengeResponse(status, headers, body)) {
    const cdn = headerValue(headers, "server").toLowerCase().includes("cloudflare") ? "Cloudflare" : "CDN";
    return `${cdn} bot challenge (HTTP ${status})`;
  }
  const waf = detectWafBlock(status, body);
  if (waf) return `${waf[0]?.toUpperCase()}${waf.slice(1)} firewall block (HTTP ${status})`;
  return "";
}

/** @param {number} ms */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @typedef {object} RetryOptions
 * @property {number} [retries] extra attempts after the first (default 2; 0 disables)
 * @property {number} [baseDelayMs] first back-off when no Retry-After is sent (doubles each time)
 * @property {number} [maxWaitMs] longest single wait honoured; a longer Retry-After stops retrying
 * @property {(ms: number) => Promise<unknown>} [sleep] injectable for tests
 * @property {(info: { url: string, status: number, attempt: number, waitMs: number }) => void} [onRetry]
 */

/**
 * @template {{ status: number, headers?: Record<string, string>, html?: string, errorBody?: string, error?: string }} R
 * @typedef {object} RetryResult
 * @property {R} result the last response
 * @property {number} attempts retries actually made
 * @property {string} note why retrying stopped early ("" when it did not)
 */

/**
 * Call `fetchFn` and retry rate limits (429) and gateway errors (502/503/504)
 * with exponential back-off, honouring Retry-After. A firewall block page or a
 * CDN challenge is never retried: hammering it escalates the block.
 * @template {{ status: number, headers?: Record<string, string>, html?: string, errorBody?: string, error?: string }} R
 * @param {() => Promise<R>} fetchFn
 * @param {string} url for the onRetry callback
 * @param {RetryOptions} [opts]
 * @returns {Promise<RetryResult<R>>}
 */
export async function withRetries(fetchFn, url, opts = {}) {
  const retries = Math.max(0, Math.floor(opts.retries ?? 2));
  const baseDelayMs = Math.max(0, opts.baseDelayMs ?? 1000);
  const maxWaitMs = Math.max(0, opts.maxWaitMs ?? 30000);
  const sleep = opts.sleep ?? defaultSleep;
  let attempts = 0;
  for (;;) {
    const result = await fetchFn();
    const status = Number(result.status) || 0;
    const transient = /ECONNRESET|socket hang up/i.test(String(result.error ?? ""));
    if ((!RETRYABLE_STATUSES.has(status) && !transient) || attempts >= retries) {
      return { result, attempts, note: "" };
    }
    const protection = protectionNote(status, result.headers, String(result.html || result.errorBody || ""));
    if (protection) return { result, attempts, note: protection };
    const asked = parseRetryAfter(headerValue(result.headers, "retry-after"));
    const waitMs = asked !== null ? asked * 1000 : baseDelayMs * 2 ** attempts;
    if (waitMs > maxWaitMs) {
      return {
        result,
        attempts,
        note: `server asked to retry after ${Math.round(waitMs / 1000)}s — not waiting that long`,
      };
    }
    opts.onRetry?.({ url, status, attempt: attempts + 1, waitMs });
    await sleep(waitMs);
    attempts++;
  }
}
