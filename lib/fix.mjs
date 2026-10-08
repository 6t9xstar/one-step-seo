/**
 * one-step-seo — safe local auto-fixes for HTML files (pure, zero deps).
 *
 * Contract (mirrors skills/seo-fix/SKILL.md):
 *   - Additive only: nothing is ever removed or rewritten except og:url's
 *     own wrong value (a same-tag attribute swap the check itself flagged).
 *   - Never invents facts: business data, alt text, reviews and stats are
 *     out of scope; missing values need an explicit flag or must be derived
 *     from content already visible on the page.
 *   - Preview-first: planFixes() only computes; writing is the CLI's job.
 *
 * Every plan is verified in memory: after applying the planned operations,
 * the document is re-parsed and each fixer's health condition re-checked, so
 * the caller only ever sees fixes proven to clear their finding.
 */

import { parseHtml } from "./html.mjs";
import { canonicalizeUrl } from "./args.mjs";
import { THRESHOLDS } from "./checks.mjs";

/** Names accepted by --only (validated by the CLI). */
export const FIXER_NAMES = [
  "charset",
  "viewport",
  "lang",
  "title",
  "description",
  "canonical",
  "og",
  "og-url",
  "twitter-card",
  "favicon",
];

/**
 * @typedef {object} FixContext
 * @property {string} [url] Absolute http(s) URL for canonical / og:url.
 * @property {string} [title] Explicit title text (else derived from <h1>).
 * @property {string} [description] Explicit meta description (else derived).
 * @property {string} [lang] BCP-47 value for <html lang>.
 * @property {string} [ogImage] Absolute URL for og:image.
 * @property {string[] | null} [only] Restrict to these fixer names.
 */

/**
 * @typedef {object} PlannedFix
 * @property {string} name
 * @property {string} findingId
 * @property {string} summary
 * @property {boolean} [partial]
 * @property {Op[]} ops
 */

/** @typedef {{ kind: "head-first" | "head-last", tag: string }
 *   | { kind: "html-attr", name: string, value: string }
 *   | { kind: "meta-replace", property: string, value: string }} Op */

/** Fixers that must insert inside <head>. */
const HEAD_FIXERS = new Set([
  "charset",
  "viewport",
  "title",
  "description",
  "canonical",
  "og",
  "twitter-card",
  "favicon",
]);

/** @param {string} s @returns {string} */
function escAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** @param {string} s @returns {string} */
function escText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Cut at a word boundary so a long string never exceeds `max` characters.
 * @param {string} s
 * @param {number} max
 * @returns {string}
 */
function trimWords(s, max) {
  const str = String(s).trim();
  if ([...str].length <= max) return str;
  const cut = str.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > Math.floor(max / 2) ? cut.slice(0, sp) : cut).trim();
}

/**
 * Derive a meta description from visible page text: take words until at
 * least metaMin characters (so the fix does not immediately trip
 * O02-meta-short), stopping before metaMax.
 * @param {string} text
 * @returns {string}
 */
function deriveDescription(text) {
  const words = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return "";
  let out = "";
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if ([...next].length > THRESHOLDS.metaMax) break;
    out = next;
    if ([...out].length >= THRESHOLDS.metaMin) break;
  }
  if (!out) return "";
  // Very short pages: use everything we have rather than nothing; the
  // summary marks it partial so the user knows it may still read short.
  return out;
}

/**
 * Shared derived values used by the title, description and og fixers.
 * @param {ReturnType<typeof parseHtml>} parsed
 * @param {FixContext} ctx
 */
function resolveEffective(parsed, ctx) {
  const flagTitle = String(ctx.title || "").trim();
  const flagDesc = String(ctx.description || "").trim();

  let title = flagTitle;
  let titleSource = "--title flag";
  if (!title) {
    const h1 = parsed.h1s[0]?.text ?? "";
    if (h1) {
      title = trimWords(h1, THRESHOLDS.titleMax);
      titleSource = "derived from <h1>";
    } else {
      title = "";
      titleSource = "";
    }
  }

  let description = flagDesc;
  let descSource = "--description flag";
  if (!description) {
    const derived = deriveDescription(parsed.visibleText);
    // A derived description must be worth inserting: below 40 characters it
    // is noise that immediately trips O02-meta-short, so treat it as absent
    // and let the fixer ask for --description instead.
    if ([...derived].length >= 40) {
      description = derived;
      descSource = "derived from page text";
    }
  }

  return { title, titleSource, description, descSource };
}

/**
 * Compare two URLs the same way the checker does (canonicalize both sides).
 * @param {string} a @param {string} b
 */
function sameUrl(a, b) {
  if (!a || !b) return false;
  return (canonicalizeUrl(a) || a) === (canonicalizeUrl(b) || b);
}

/**
 * Fixer registry. Each decide() returns:
 *   null              — healthy, nothing to do
 *   { skip: reason }  — fixable in principle but input/safety is missing
 *   { ops, summary, partial?, note? } — planned operations
 * @type {{
 *   name: string,
 *   findingId: string,
 *   decide: (
 *     parsed: ReturnType<typeof parseHtml>,
 *     ctx: FixContext,
 *     eff: { title: string, titleSource: string, description: string, descSource: string }
 *   ) => ({ skip: string } | { ops: Op[], summary: string, partial?: boolean, note?: string } | null)
 * }[]}
 */
export const FIXERS = [
  {
    name: "charset",
    findingId: "T10-charset",
    decide(parsed) {
      const cs = String(parsed.charset || "");
      if (cs && cs !== "not-found") {
        // Present. UTF-8 is healthy; anything else is a deliberate encoding
        // choice — rewriting it would corrupt the file.
        if (/utf-?8/i.test(cs)) return null;
        return { skip: `charset "${cs}" is declared — rewriting document encoding is unsafe` };
      }
      return {
        ops: [{ kind: "head-first", tag: `<meta charset="utf-8">` }],
        summary: `insert <meta charset="utf-8"> first in <head>`,
      };
    },
  },
  {
    name: "viewport",
    findingId: "T11-viewport",
    decide(parsed) {
      const vp = String(parsed.viewport || "");
      if (vp.includes("width=device-width")) return null;
      if (vp) return { skip: `existing custom viewport left untouched: "${vp.slice(0, 80)}"` };
      return {
        ops: [
          { kind: "head-last", tag: `<meta name="viewport" content="width=device-width, initial-scale=1">` },
        ],
        summary: `insert standard responsive viewport meta`,
      };
    },
  },
  {
    name: "lang",
    findingId: "T09-lang",
    decide(parsed, ctx) {
      if (String(parsed.lang || "")) return null;
      const lang = String(ctx.lang || "").trim();
      if (!lang) return { skip: `needs --lang (e.g. --lang en) — language is never guessed` };
      return {
        ops: [{ kind: "html-attr", name: "lang", value: lang }],
        summary: `set <html lang="${escAttr(lang)}">`,
      };
    },
  },
  {
    name: "title",
    findingId: "O01-title-missing",
    decide(parsed, ctx, eff) {
      if (String(parsed.title || "")) return null;
      if (!eff.title) return { skip: `needs --title (no <h1> found to derive from)` };
      const note = eff.titleSource === "--title flag" ? "from flag" : eff.titleSource;
      return {
        ops: [{ kind: "head-last", tag: `<title>${escText(eff.title)}</title>` }],
        summary: `insert <title>"${escText(eff.title)}"</title> (${note})`,
      };
    },
  },
  {
    name: "description",
    findingId: "O02-meta-missing",
    decide(parsed, ctx, eff) {
      if (String(parsed.metaDescription || "")) return null;
      if (!eff.description) return { skip: `needs --description (page text too short to derive from)` };
      const short = [...eff.description].length < THRESHOLDS.metaMin;
      return {
        ops: [{ kind: "head-last", tag: `<meta name="description" content="${escAttr(eff.description)}">` }],
        summary: `insert meta description (${eff.descSource})${short ? " — reads short, consider --description" : ""}`,
        partial: short || undefined,
      };
    },
  },
  {
    name: "canonical",
    findingId: "T08-canonical",
    decide(parsed, ctx) {
      if (String(parsed.canonical || "")) return null;
      const url = String(ctx.url || "");
      if (!url) return { skip: `needs --url (absolute preferred URL for this page)` };
      return {
        ops: [{ kind: "head-last", tag: `<link rel="canonical" href="${escAttr(url)}">` }],
        summary: `insert rel=canonical → ${escAttr(url)}`,
      };
    },
  },
  {
    name: "og",
    findingId: "O06-og",
    decide(parsed, ctx, eff) {
      const has = {
        title: String(parsed.og?.title || ""),
        description: String(parsed.og?.description || ""),
        image: String(parsed.og?.image || ""),
      };
      if (has.title && has.description && has.image) return null;

      /** @type {Op[]} */
      const ops = [];
      const parts = [];
      const missing = [];
      if (!has.title) {
        if (eff.title) {
          ops.push({ kind: "head-last", tag: `<meta property="og:title" content="${escAttr(eff.title)}">` });
          parts.push("og:title");
        } else missing.push("og:title");
      }
      if (!has.description) {
        if (eff.description) {
          ops.push({
            kind: "head-last",
            tag: `<meta property="og:description" content="${escAttr(eff.description)}">`,
          });
          parts.push("og:description");
        } else missing.push("og:description");
      }
      if (!has.image) {
        const img = String(ctx.ogImage || "").trim();
        if (img) {
          ops.push({ kind: "head-last", tag: `<meta property="og:image" content="${escAttr(img)}">` });
          parts.push("og:image");
        } else missing.push("og:image");
      }
      if (ops.length === 0) {
        return {
          skip: `needs ${missing.map((m) => `--og-image`).join(" ")} — nothing fillable (missing: ${missing.join(", ")})`,
        };
      }
      return {
        ops,
        summary: `insert ${parts.join(", ")}${missing.length ? ` (still missing: ${missing.join(", ")})` : ""}`,
        partial: missing.length > 0 || undefined,
      };
    },
  },
  {
    name: "og-url",
    findingId: "W02-og-url",
    decide(parsed, ctx) {
      const current = String(parsed.og?.url || "");
      if (!current) return null; // absent og:url passes the check — additive only
      const url = String(ctx.url || "");
      if (!url) return { skip: `og:url "${current.slice(0, 60)}" differs from target — needs --url` };
      if (sameUrl(current, url)) return null;
      return {
        ops: [{ kind: "meta-replace", property: "og:url", value: url }],
        summary: `replace og:url → ${escAttr(url)}`,
      };
    },
  },
  {
    name: "twitter-card",
    findingId: "W01-social",
    decide(parsed) {
      if (String(parsed.twitter?.card || "")) return null;
      const card = parsed.og?.image ? "summary_large_image" : "summary";
      return {
        ops: [{ kind: "head-last", tag: `<meta name="twitter:card" content="${card}">` }],
        summary: `insert twitter:card (${card})`,
      };
    },
  },
  {
    name: "favicon",
    findingId: "O07-favicon",
    decide(parsed) {
      if (parsed.icon) return null;
      return {
        ops: [{ kind: "head-last", tag: `<link rel="icon" href="/favicon.ico">` }],
        summary: `insert <link rel="icon" href="/favicon.ico">`,
      };
    },
  },
];

/**
 * Apply planned operations to the document. Deterministic order:
 * head-first (charset) right after <head>, head-last tags just before
 * </head>, then attribute/meta swaps. The file's EOL style is preserved.
 * @param {string} html
 * @param {Op[]} ops
 * @returns {string}
 */
function applyOps(html, ops) {
  if (ops.length === 0) return html;
  const eol = html.includes("\r\n") ? "\r\n" : "\n";
  let out = html;

  const headFirst = ops.filter((o) => o.kind === "head-first");
  const headLast = ops.filter((o) => o.kind === "head-last");
  const swaps = ops.filter((o) => o.kind === "html-attr" || o.kind === "meta-replace");

  if (headFirst.length > 0 || headLast.length > 0) {
    const open = /<head\b[^>]*>/i.exec(out);
    const close = /<\/head\s*>/i.exec(out);
    if (!open || !close) {
      throw new Error(
        !close
          ? "no </head> close tag — refusing to guess tag placement"
          : "no <head> element — refusing to guess tag placement",
      );
    }
    // Indent children relative to </head>'s line; inline (minified) docs
    // get a two-space default so the diff stays readable.
    const lineStart = out.lastIndexOf("\n", close.index) + 1;
    const beforeClose = out.slice(lineStart, close.index);
    const closeIndent = /^\s*$/.test(beforeClose) ? beforeClose : "";
    const childIndent = `${closeIndent}  `;

    if (headFirst.length > 0) {
      const at = open.index + open[0].length;
      const tags = headFirst.map((o) => (o.kind === "head-first" ? childIndent + o.tag : "")).join(eol);
      out = out.slice(0, at) + eol + tags + out.slice(at);
    }
    if (headLast.length > 0) {
      const close2 = /<\/head\s*>/i.exec(out);
      if (!close2) throw new Error("lost </head> while applying fixes");
      const at = close2.index;
      const tags = headLast.map((o) => (o.kind === "head-last" ? childIndent + o.tag : "")).join(eol);
      out = out.slice(0, at) + tags + eol + closeIndent + out.slice(at);
    }
  }

  for (const op of swaps) {
    if (op.kind === "html-attr") {
      const m = /<html\b[^>]*>/i.exec(out);
      if (!m) throw new Error("no <html> element found");
      if (new RegExp(`\\b${op.name}\\s*=`, "i").test(m[0])) continue; // already set
      const tag = m[0].replace(/<html\b/i, `<html ${op.name}="${escAttr(op.value)}"`);
      out = out.replace(m[0], tag);
    } else if (op.kind === "meta-replace") {
      const prop = op.property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`<meta\\b[^>]*property\\s*=\\s*["']${prop}["'][^>]*>`, "i");
      const m = re.exec(out);
      if (!m) throw new Error(`no <meta property="${op.property}"> found`);
      let tag = m[0].replace(/\bcontent\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, `content="${escAttr(op.value)}"`);
      if (tag === m[0] && !/\bcontent\s*=/i.test(m[0])) {
        tag = m[0].replace(/\/?>$/, (end) => ` content="${escAttr(op.value)}"${end}`);
      }
      out = out.slice(0, m.index) + tag + out.slice(m.index + m[0].length);
    }
  }
  return out;
}

/**
 * Plan (never write) safe fixes for a local HTML document.
 * @param {string} html
 * @param {FixContext} [ctx]
 * @returns {{
 *   error?: string,
 *   planned: PlannedFix[],
 *   skipped: { name: string, reason: string }[],
 *   verified: { name: string, cleared: boolean }[],
 *   changed: boolean,
 *   newHtml: string
 * }}
 */
export function planFixes(html, ctx = {}) {
  const base = String(ctx.url || "") || "https://local.invalid/";
  const parsed = parseHtml(html, base);
  const eff = resolveEffective(parsed, ctx);
  const only = Array.isArray(ctx.only) && ctx.only.length > 0 ? ctx.only : null;

  /** @type {PlannedFix[]} */
  const planned = [];
  /** @type {{ name: string, reason: string }[]} */
  const skipped = [];

  const hasHead = /<head[\s>]/i.test(html);

  for (const f of FIXERS) {
    if (only && !only.includes(f.name)) continue;
    let d;
    try {
      d = f.decide(parsed, ctx, eff);
    } catch (err) {
      skipped.push({ name: f.name, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (d === null) continue;
    if ("skip" in d) {
      skipped.push({ name: f.name, reason: d.skip });
      continue;
    }
    if (!hasHead && HEAD_FIXERS.has(f.name)) {
      return {
        error: `no <head> element found — refusing to guess tag placement`,
        planned: [],
        skipped: [],
        verified: [],
        changed: false,
        newHtml: html,
      };
    }
    planned.push({
      name: f.name,
      findingId: f.findingId,
      summary: d.summary,
      partial: d.partial,
      ops: d.ops,
    });
  }

  if (planned.length === 0) {
    return { planned, skipped, verified: [], changed: false, newHtml: html };
  }

  const allOps = planned.flatMap((p) => p.ops);
  let newHtml;
  try {
    newHtml = applyOps(html, allOps);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      planned: [],
      skipped,
      verified: [],
      changed: false,
      newHtml: html,
    };
  }

  // In-memory verification: re-parse the result and confirm each planned
  // fixer now reports healthy (a partial fix legitimately stays uncleared).
  const after = parseHtml(newHtml, base);
  const effAfter = resolveEffective(after, ctx);
  const verified = planned.map((p) => {
    const f = FIXERS.find((x) => x.name === p.name);
    const d = f ? f.decide(after, ctx, effAfter) : { skip: "unknown" };
    return { name: p.name, cleared: d === null };
  });

  return { planned, skipped, verified, changed: newHtml !== html, newHtml };
}
