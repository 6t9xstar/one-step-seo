/**
 * one-step-seo — additional per-page checks (T19–T30, O12, O13, C06, P07)
 * and the robots/canonical parsers the core checks share.
 *
 * Ported from Open SEO Crawler's page_checks.py, MIT License,
 * Copyright (c) 2026 Puneet Inder Singh — see THIRD_PARTY_NOTICES.md.
 * Rewritten for one-step-seo's dependency-free, regex-based parser. Changes
 * from the original:
 * - a document without a <head> tag is not reported as having every tag
 *   outside the head, and head-only tags placed after </head> are reported;
 * - robots directives are tokenized, so "max-image-preview:none" is not read
 *   as "none" (noindex, nofollow);
 * - soft-404 wording also covers "can't be found" (WordPress's default 404
 *   heading) and a bare "404" only counts as an error phrase, so a brand such
 *   as "Studio 404" passes;
 * - East Asian wide characters count as a full em in the SERP width estimate;
 * - checks that need HTTP headers or a status code are skipped for local
 *   files, which have neither.
 *
 * Every check reads only the HTML and headers already fetched: no extra
 * requests, deterministic, offline-testable.
 */
import { decodeEntities, parseAttributes } from "./html.mjs";
import {
  hasUnresolvedTemplate,
  isDevOrStagingHost,
  isInternalSearchUrl,
  isPaginationUrl,
} from "./url-traps.mjs";

/** @typedef {{ id: string, category: string, severity: string, title: string, evidence: string, fix: string, seoImpact: string, geoImpact: string }} Finding */
/** @typedef {[text: string, severity: string]} Note */

/** Every finding ID `extraPageChecks` can emit. */
export const EXTRA_CHECK_IDS = [
  "T19-head-placement",
  "T20-duplicate-tags",
  "T21-canonical-signals",
  "T22-robots-scoped",
  "T23-soft-404",
  "T24-unresolved-urls",
  "T25-malformed-hrefs",
  "T26-dev-links",
  "T27-insecure-forms",
  "T28-internal-search",
  "T29-rel-pagination",
  "T30-markup",
  "O12-serp-width",
  "O13-dead-anchors",
  "C06-placeholder",
  "P07-delivery",
];

/** @type {Record<string, number>} */
const SEVERITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

/**
 * @param {string} id @param {string} category @param {string} severity
 * @param {string} title @param {string} evidence @param {string} fix
 * @param {string} [seoImpact] @param {string} [geoImpact]
 * @returns {Finding}
 */
function F(id, category, severity, title, evidence, fix, seoImpact = "-", geoImpact = "-") {
  return { id, category, severity, title, evidence, fix, seoImpact, geoImpact };
}

/** @param {Note[]} notes @returns {string} the most severe level among the notes */
function worst(notes) {
  let level = "P3";
  for (const [, sev] of notes) if ((SEVERITY_RANK[sev] ?? 9) < (SEVERITY_RANK[level] ?? 9)) level = sev;
  return level;
}

/** @param {Note[]} notes @returns {string} */
const describe = (notes) => notes.map(([text]) => text).join("; ");

/** @param {string} s @returns {string} as many spaces as `s` has UTF-16 units */
const blank = (s) => " ".repeat(s.length);

/**
 * Comments, raw-text elements (script, style) and the text inside RCDATA
 * elements (title, textarea), whichever starts first — the way a browser's
 * tokenizer meets them. An unclosed one runs to the end of the document.
 */
const RAW_TEXT =
  /<!--[\s\S]*?(?:-->|$)|<(script|style)(?=[\s/>])[^>]*>[\s\S]*?(?:<\/\1\s*>|$)|(<(title|textarea)(?=[\s/>])[^>]*>)([\s\S]*?)(?=<\/\3\s*>|$)/gi;

/**
 * Raw HTML with comments, scripts and styles blanked to spaces, and the text
 * of <title>/<textarea> blanked (the tags stay). Offsets are kept, so a
 * position in the result is a position in the input.
 * @param {string} html
 * @returns {string}
 */
export function maskRawText(html) {
  return String(html ?? "").replace(RAW_TEXT, (m, _raw, open, _rc, inner) =>
    open === undefined ? blank(m) : open + blank(String(inner ?? "")),
  );
}

/**
 * Blank whole subtrees of the named elements (alternation, e.g.
 * "template|svg"). Nested subtrees are matched open-to-close by depth; one
 * that never closes is left alone.
 * @param {string} s
 * @param {string} names
 * @returns {string}
 */
function maskSubtrees(s, names) {
  const re = new RegExp(`<(\\/?)(${names})(?=[\\s/>])[^>]*?(\\/?)>`, "gi");
  /** @type {[number, number][]} */
  const spans = [];
  /** @type {string | null} */
  let outer = null;
  let depth = 0;
  let start = 0;
  for (const m of s.matchAll(re)) {
    const closing = m[1] === "/";
    const name = (m[2] ?? "").toLowerCase();
    const selfClosing = m[3] === "/";
    const at = m.index ?? 0;
    if (outer === null) {
      if (!closing && !selfClosing) {
        outer = name;
        depth = 1;
        start = at;
      }
      continue;
    }
    if (name !== outer || selfClosing) continue;
    depth += closing ? -1 : 1;
    if (depth === 0) {
      spans.push([start, at + m[0].length]);
      outer = null;
    }
  }
  if (spans.length === 0) return s;
  let out = "";
  let prev = 0;
  for (const [a, b] of spans) {
    out += s.slice(prev, a) + " ".repeat(b - a);
    prev = b;
  }
  return out + s.slice(prev);
}

/**
 * `maskRawText` plus every <template>, <svg> and <math> subtree blanked: their
 * <title> is an icon's accessible name and their links are not the page's.
 * @param {string} html
 * @returns {string}
 */
export function maskInert(html) {
  return maskSubtrees(maskRawText(html), "template|svg|math");
}

/** Elements the HTML parser keeps in <head>; any other element starts the body. */
const HEAD_TAGS = new Set([
  "html",
  "head",
  "base",
  "basefont",
  "bgsound",
  "link",
  "meta",
  "noframes",
  "noscript",
  "script",
  "style",
  "template",
  "title",
]);

/**
 * Where the document head ends as a browser parses it.
 * - `early: true` — an element that cannot be in <head> (a <div>, an <img> or
 *   <iframe> inside <noscript>, an <svg> …) comes before </head>. Browsers and
 *   Google end the head there; later head tags land in the body.
 * - `early: false` — the natural end: </head>, or the first body element when
 *   the optional </head> tag is omitted.
 * Null when nothing ends the head (no body content at all).
 * @param {string} html
 * @returns {{ at: number, tag: string, early: boolean } | null}
 */
export function headEnd(html) {
  const s = maskSubtrees(maskRawText(html), "template");
  const open = /<head(?=[\s/>])[^>]*>/i.exec(s);
  const start = open ? open.index + open[0].length : 0;
  const closeRe = /<\/head\s*>/gi;
  closeRe.lastIndex = start;
  const close = closeRe.exec(s);
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)/g;
  tagRe.lastIndex = start;
  let m;
  while ((m = tagRe.exec(s)) !== null) {
    const name = (m[1] ?? "").toLowerCase();
    if (HEAD_TAGS.has(name)) continue;
    if (close && close.index < m.index) break;
    return { at: m.index, tag: name, early: close !== null && name !== "body" };
  }
  return close ? { at: close.index, tag: "/head", early: false } : null;
}

/** @param {string} s @param {number} at @returns {number} 1-based line of offset `at` */
function lineAt(s, at) {
  let line = 1;
  for (let i = s.indexOf("\n"); i !== -1 && i < at; i = s.indexOf("\n", i + 1)) line++;
  return line;
}

/**
 * Start tags of one element name, parsed (pass masked HTML so comments,
 * scripts, templates and inline SVG are excluded).
 * @param {string} masked
 * @param {string} name
 * @returns {{ at: number, attrs: Record<string, string> }[]}
 */
function tagsNamed(masked, name) {
  const re = new RegExp(`<${name}(?=[\\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>`, "gi");
  return [...masked.matchAll(re)].map((m) => ({ at: m.index ?? 0, attrs: parseAttributes(m[0]) }));
}

/** @param {string | undefined} rel @returns {string[]} lowercased link types */
const relList = (rel) =>
  String(rel ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

/** @param {string} href @param {string} base @returns {string} absolute URL or "" */
function resolve(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

/** @param {string} url @returns {string} */
function hostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Comparison key for "same target": scheme, host and path without a trailing
 * slash, plus the query; the fragment is ignored.
 * @param {string} url
 * @returns {string}
 */
function targetKey(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return String(url ?? "")
      .replace(/#.*$/, "")
      .replace(/\/+$/, "");
  }
}

/** Helvetica/Arial advance widths in 1/1000 em (Google renders results in Arial). */
const WIDTHS = (() => {
  /** @type {Record<string, number>} */
  const w = {};
  const groups = /** @type {[string, number][]} */ ([
    [" !,./:;I[\\]ft", 278],
    ['"', 355],
    ["#$0123456789?L_abdeghnopqu", 556],
    ["%", 889],
    ["&ABEKPSVXY", 667],
    ["'", 191],
    ["()-`r", 333],
    ["*", 389],
    ["+<=>~", 584],
    ["@", 1015],
    ["CDHNRUw", 722],
    ["FTZ", 611],
    ["GOQ", 778],
    ["J", 500],
    ["Mm", 833],
    ["W", 944],
    ["ckvsxyz", 500],
    ["ijl", 222],
    ["^", 469],
    ["{}", 334],
    ["|", 260],
  ]);
  for (const [chars, width] of groups) for (const ch of chars) w[ch] = width;
  return w;
})();

/** Google cuts a desktop title near 580 px (Arial 20 px) and a description near 920 px (14 px). */
export const TITLE_PX_LIMIT = 580;
export const DESC_PX_LIMIT = 920;
/** Report only past these: just over the limit loses a character at most. */
const TITLE_PX_REPORT = 620;
const DESC_PX_REPORT = 990;

/** @param {number} cp @returns {boolean} East Asian wide/fullwidth character or emoji */
function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/**
 * Approximate rendered width of `text` in px at `size` px Arial. Characters
 * outside the table count as 556 (an average Latin glyph); East Asian wide
 * characters as a full em. An estimate: real widths vary with the device.
 * @param {string} text
 * @param {number} size
 * @returns {number}
 */
export function textPx(text, size) {
  let units = 0;
  for (const ch of String(text ?? "")) units += WIDTHS[ch] ?? (isWide(ch.codePointAt(0) ?? 0) ? 1000 : 556);
  return Math.round((units * size) / 1000);
}

/** Robots directives that carry a value ("max-snippet: 20"); never crawler names. */
const VALUED_DIRECTIVE = /^(max-snippet|max-image-preview|max-video-preview|unavailable_after)\s*:\s*(.*)$/;

/**
 * Directives in one comma-separated part. A valued directive keeps its value
 * ("max-image-preview:none" is not "none"); bare words separated only by
 * spaces ("noindex nofollow", a common slip) count separately.
 * @param {string} part lowercased
 * @returns {string[]}
 */
function directivesIn(part) {
  const text = part.trim();
  const valued = VALUED_DIRECTIVE.exec(text);
  if (valued) return [`${valued[1]}:${(valued[2] ?? "").trim()}`];
  const words = text.split(/\s+/).filter(Boolean);
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? "";
    out.push(word.endsWith(":") && i + 1 < words.length ? word + (words[++i] ?? "") : word);
  }
  return out;
}

/**
 * Directives of a robots meta tag's content, lowercased. Valued ones keep
 * their value: "max-image-preview:large", "unavailable_after:2026-01-01".
 * @param {string | null | undefined} value
 * @returns {Set<string>}
 */
export function robotsDirectives(value) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const part of String(value ?? "")
    .toLowerCase()
    .split(/[,;]/)) {
    for (const d of directivesIn(part)) out.add(d);
  }
  return out;
}

/**
 * X-Robots-Tag as a map of crawler → directives, with "" for every crawler.
 * Google documents "X-Robots-Tag: googlebot: noindex": a crawler name before
 * a colon scopes what follows to that crawler, until the next name.
 * Limitation: several X-Robots-Tag headers arrive joined with ", ", so an
 * unscoped header after a scoped one reads as part of that scope.
 * @param {string | null | undefined} value
 * @returns {Map<string, Set<string>>}
 */
export function parseXRobots(value) {
  /** @type {Map<string, Set<string>>} */
  const out = new Map();
  let scope = "";
  for (const raw of String(value ?? "")
    .toLowerCase()
    .split(/[,;]/)) {
    let part = raw.trim();
    const named = /^([a-z][a-z0-9_.-]*)\s*:\s*(.*)$/.exec(part);
    if (named && !VALUED_DIRECTIVE.test(part)) {
      scope = named[1] ?? "";
      part = named[2] ?? "";
    }
    for (const d of directivesIn(part)) {
      const set = out.get(scope) ?? new Set();
      set.add(d);
      out.set(scope, set);
    }
  }
  return out;
}

/** @param {Set<string> | undefined} set @returns {boolean} noindex or none */
const blocksIndexing = (set) => Boolean(set && (set.has("noindex") || set.has("none")));

/**
 * The canonical URL an HTTP Link header declares, resolved against `base`,
 * or "" when there is none: `Link: <https://example.com/page>; rel="canonical"`.
 * @param {string | null | undefined} value
 * @param {string} base
 * @returns {string}
 */
export function linkHeaderCanonical(value, base) {
  for (const m of String(value ?? "").matchAll(/<([^>]*)>([^<]*)/g)) {
    const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^\s;,"]+))/i.exec(m[2] ?? "");
    if (relList(rel?.[1] ?? rel?.[2]).includes("canonical")) return resolve((m[1] ?? "").trim(), base);
  }
  return "";
}

/**
 * Wording that means "this page is not here", checked against the title and
 * the first H1. A bare "404" counts only at the start ("404 – …").
 */
const SOFT_404 =
  /\b(?:page not found|not found|page (?:does not|doesn['’]?t) exist|page (?:is )?(?:no longer available|unavailable)|(?:cannot|can['’]?t|could not|couldn['’]?t) be found|nothing (?:was )?found|page (?:has been )?removed|error 404|404 error|404 page|seite nicht gefunden|página no encontrada|pagina non trovata|page introuvable|pagina niet gevonden)\b|^\s*404\b/i;

/** @param {string} value @returns {boolean} true when the date parses and has passed */
function datePassed(value) {
  const t = Date.parse(String(value ?? "").trim());
  return !Number.isNaN(t) && t < Date.now();
}

/** Head-only tags T19 looks for, with the severity of finding one outside <head>. */
const HEAD_ONLY = /** @type {[RegExp, string, string][]} */ ([
  [/<link(?=\s)[^>]*\srel\s*=\s*["']?canonical(?![\w-])/gi, "canonical", "P1"],
  [/<meta(?=\s)[^>]*\sname\s*=\s*["']?(?:robots|googlebot|bingbot)(?![\w-])/gi, "meta robots", "P1"],
  [/<link(?=\s)[^>]*\shreflang\s*=/gi, "hreflang", "P1"],
  [/<title(?=[\s>])/gi, "title", "P2"],
  [/<meta(?=\s)[^>]*\sname\s*=\s*["']?description(?![\w-])/gi, "meta description", "P2"],
]);

/**
 * @typedef {object} ExtraCheckOptions
 * @property {boolean} [offline] local file: no status code or HTTP headers
 * @property {number} [titleMax] title length the character check allows (O12 measures only within it)
 * @property {number} [metaMax] description length the character check allows
 */

/**
 * Additional per-page checks. A check with nothing to report returns nothing:
 * these are refinements, so a clean page does not gain a dozen "pass" rows.
 * Without `html` only the checks that need no markup run.
 * @param {string} html raw HTML as served ("" when unavailable)
 * @param {any} parsed parseHtml() result
 * @param {any} fetched fetch result: finalUrl, status, headers
 * @param {ExtraCheckOptions} [opts]
 * @returns {Finding[]}
 */
export function extraPageChecks(html, parsed, fetched, opts = {}) {
  /** @type {Finding[]} */
  const out = [];
  const raw = String(html ?? "");
  const page = parsed && typeof parsed === "object" ? parsed : {};
  const pageUrl = String(fetched?.finalUrl ?? "");
  const offline = Boolean(opts.offline);
  /** @type {Record<string, string>} */
  const headers = {};
  if (!offline && fetched?.headers && typeof fetched.headers === "object") {
    for (const [k, v] of Object.entries(fetched.headers)) headers[k.toLowerCase()] = String(v ?? "");
  }
  const status = Number(fetched?.status ?? 200) || 200;
  const masked = raw ? maskInert(raw) : "";
  const pageHost = hostname(pageUrl);
  const siteDomain = pageHost.replace(/^www\./, "");
  const robotsMeta = robotsDirectives(page.robotsMeta);
  const xRobots = parseXRobots(headers["x-robots-tag"]);
  const noindex = blocksIndexing(robotsMeta) || blocksIndexing(xRobots.get(""));
  /** @type {string[]} */
  const links = [
    ...(Array.isArray(page.internalLinks) ? page.internalLinks : []),
    ...(Array.isArray(page.externalLinks) ? page.externalLinks : []),
  ].map(String);
  const linkTags = masked ? tagsNamed(masked, "link") : [];

  // T19 — head-only tags that a browser (and Google) sees outside <head>.
  const end = raw ? headEnd(raw) : null;
  if (end) {
    const late = HEAD_ONLY.filter(([re]) => {
      let last = -1;
      for (const m of masked.matchAll(re)) last = m.index ?? -1;
      return last > end.at;
    });
    if (late.length > 0) {
      const labels = late.map(([, label]) => label).join(", ");
      const line = lineAt(raw, end.at);
      out.push(
        F(
          "T19-head-placement",
          "technical",
          worst(late.map(([, label, sev]) => /** @type {Note} */ ([label, sev]))),
          "Head tags outside <head> are ignored",
          end.early
            ? `${labels} come after a <${end.tag}> on line ${line}, which ends the <head> early`
            : `${labels} appear in the <body> (the <head> ends on line ${line})`,
          end.early
            ? `Move the <${end.tag}> into <body> (often a tracking <noscript> with an <iframe> or <img>, or a plugin's markup), or move the head tags above it.`
            : "Move these tags into <head>; Google reads them only there.",
          "high",
          "-",
        ),
      );
    }
  }

  // T20 — tags that must appear once.
  if (masked) {
    /** @type {Note[]} */
    const notes = [];
    const titles = [...masked.matchAll(/<title(?=[\s>])/gi)].length;
    if (titles > 1) notes.push([`${titles} <title> tags`, "P2"]);
    const canonicals = linkTags.filter((t) => relList(t.attrs.rel).includes("canonical"));
    if (canonicals.length > 1) {
      const hrefs = canonicals.map((t) => decodeEntities(t.attrs.href ?? "").trim());
      const targets = new Set(hrefs.map((h) => targetKey(resolve(h, pageUrl) || h)));
      notes.push(
        targets.size > 1
          ? [
              `${canonicals.length} canonical tags with different URLs (${[...new Set(hrefs)].slice(0, 2).join(" vs ")})`,
              "P1",
            ]
          : [`${canonicals.length} identical canonical tags`, "P3"],
      );
    }
    const metas = tagsNamed(masked, "meta");
    /** @param {string} name @returns {number} */
    const count = (name) => metas.filter((t) => (t.attrs.name ?? "").trim().toLowerCase() === name).length;
    const descriptions = count("description");
    if (descriptions > 1) notes.push([`${descriptions} meta descriptions`, "P2"]);
    const viewports = count("viewport");
    if (viewports > 1) notes.push([`${viewports} viewport tags`, "P3"]);
    if (notes.length > 0) {
      out.push(
        F(
          "T20-duplicate-tags",
          "technical",
          worst(notes),
          "Tags that must be unique appear more than once",
          describe(notes),
          "Keep one of each. Usually a theme and an SEO plugin both print them; with conflicting canonicals Google may ignore both.",
          "medium",
          "-",
        ),
      );
    }
  }

  // T21 — canonical signals that a single tag read does not show.
  {
    /** @type {Note[]} */
    const notes = [];
    const htmlRaw = String(page.canonicalRaw ?? "").trim();
    const htmlCanonical = String(page.canonical ?? "");
    const headerCanonical = linkHeaderCanonical(headers.link, pageUrl);
    if (headerCanonical && htmlCanonical && targetKey(headerCanonical) !== targetKey(htmlCanonical)) {
      notes.push([`the HTTP Link header says ${headerCanonical}, the HTML says ${htmlCanonical}`, "P1"]);
    }
    if (htmlRaw && (hasUnresolvedTemplate(htmlRaw) || hasUnresolvedTemplate(htmlCanonical))) {
      notes.push([`canonical "${htmlRaw.slice(0, 80)}" contains an unresolved template value`, "P1"]);
    } else if (htmlRaw) {
      if (htmlRaw.includes("#")) notes.push(["canonical contains a #fragment, which Google drops", "P2"]);
      if (!/^https?:\/\//i.test(htmlRaw))
        notes.push([`canonical is not an absolute URL ("${htmlRaw.slice(0, 60)}")`, "P3"]);
    }
    // A local file's canonical names its production URL, so "another URL"
    // cannot be judged offline (T08 maps local paths for the same reason).
    const local = offline || pageUrl.startsWith("file:");
    const target = htmlCanonical || headerCanonical;
    if (noindex && target && !local && targetKey(target) !== targetKey(pageUrl)) {
      notes.push(["noindex combined with a canonical to another URL sends conflicting signals", "P2"]);
    }
    if (notes.length > 0) {
      out.push(
        F(
          "T21-canonical-signals",
          "technical",
          worst(notes),
          "Canonical signals conflict or are malformed",
          describe(notes),
          "Declare one absolute canonical URL without a #fragment, in one place (HTML or the Link header, or both with the same URL), and do not combine it with noindex.",
          "medium",
          "-",
        ),
      );
    }
  }

  // T22 — robots rules that drop the page from one search engine only, or have expired.
  {
    /** @type {Note[]} */
    const notes = [];
    const botMeta = page.botRobotsMeta && typeof page.botRobotsMeta === "object" ? page.botRobotsMeta : {};
    if (!noindex) {
      for (const [bot, engine, sev] of /** @type {[string, string, string][]} */ ([
        ["googlebot", "Google", "P0"],
        ["bingbot", "Bing", "P1"],
      ])) {
        if (blocksIndexing(robotsDirectives(botMeta[bot]))) {
          notes.push([`<meta name="${bot}"> says noindex: removed from ${engine} only`, sev]);
        }
        if (blocksIndexing(xRobots.get(bot))) {
          notes.push([`X-Robots-Tag "${bot}: noindex": removed from ${engine} only`, sev]);
        }
      }
    }
    const expiry = [
      ...robotsMeta,
      ...robotsDirectives(botMeta.googlebot),
      ...(xRobots.get("") ?? []),
      ...(xRobots.get("googlebot") ?? []),
    ].find((d) => d.startsWith("unavailable_after:") && datePassed(d.slice(18)));
    if (expiry) {
      notes.push([
        `unavailable_after date (${expiry.slice(18)}) has passed, so Google no longer shows the page`,
        "P1",
      ]);
    }
    if (notes.length > 0) {
      out.push(
        F(
          "T22-robots-scoped",
          "technical",
          worst(notes),
          "Robots rules hide the page from some search engines",
          describe(notes),
          "Remove engine-specific noindex rules and expired unavailable_after dates unless leaving that search engine out is intended.",
          "high",
          "-",
        ),
      );
    }
  }

  // T23 — an error page served with a success status (needs a real HTTP status).
  if (!offline && status >= 200 && status < 300) {
    const title = String(page.title ?? "");
    const h1 = String(page.h1s?.[0]?.text ?? "");
    const words = Number(page.wordCount ?? 0);
    const where = SOFT_404.test(title)
      ? `the title says "${title.slice(0, 80)}"`
      : SOFT_404.test(h1)
        ? `the H1 says "${h1.slice(0, 80)}"`
        : "";
    if (where && words <= 350 && !/\barchives?\b/i.test(title)) {
      out.push(
        F(
          "T23-soft-404",
          "technical",
          "P1",
          "Soft 404: error page served with HTTP 200",
          `HTTP ${status}, but ${where} (${words} words)`,
          "Return a real 404 (or 410) status for missing pages, or 301-redirect the URL to its replacement.",
          "medium",
          "-",
        ),
      );
    }
  }

  // T24 — URLs a template printed without its value ("undefined", "[object Object]").
  {
    const junk = [...new Set(links.filter((u) => hasUnresolvedTemplate(u)))];
    if (hasUnresolvedTemplate(pageUrl)) junk.unshift(`${pageUrl} (this page)`);
    if (junk.length > 0) {
      out.push(
        F(
          "T24-unresolved-urls",
          "technical",
          "P1",
          "Links contain unresolved template values",
          `${junk.length} URL(s) with "undefined", "null" or "[object …]": ${junk.slice(0, 3).join(", ")}`,
          "Fix the template or script that builds these URLs; they lead to error pages and junk URLs.",
          "medium",
          "-",
        ),
      );
    }
  }

  // T25 — hrefs that are not URLs (reported here; the crawler never follows them).
  {
    const bad = /** @type {{ kind: string, href: string }[]} */ (
      Array.isArray(page.malformedHrefs) ? page.malformedHrefs : []
    );
    if (bad.length > 0) {
      const shown = bad
        .slice(0, 3)
        .map((b) =>
          b.kind === "email" ? `"${b.href}" (e-mail without mailto:)` : `"${b.href}" (text, not a URL)`,
        );
      out.push(
        F(
          "T25-malformed-hrefs",
          "technical",
          "P2",
          "Links whose href is not a URL",
          shown.join(", ") + (bad.length > 3 ? ` and ${bad.length - 3} more` : ""),
          "Use mailto: for e-mail links and a real URL for addresses (for example a Google Maps link). Without a scheme the text resolves relative to each page, creating a broken URL under every page that carries it.",
          "low",
          "-",
        ),
      );
    }
  }

  // T26 — links or resources on a host only a developer can reach, or a staging copy.
  if (!isDevOrStagingHost(pageHost, "")) {
    /** @type {Set<string>} */
    const hosts = new Set();
    const subresources = Array.isArray(page.subresources) ? page.subresources : [];
    for (const u of [...links, ...subresources.map((/** @type {any} */ s) => String(s?.url ?? ""))]) {
      const h = hostname(u);
      if (h && h !== pageHost && isDevOrStagingHost(h, siteDomain)) hosts.add(h);
    }
    if (hosts.size > 0) {
      out.push(
        F(
          "T26-dev-links",
          "technical",
          "P1",
          "Links or resources on a local or staging host",
          `${hosts.size} host(s): ${[...hosts].slice(0, 3).join(", ")}`,
          "Replace development and staging URLs with production ones (often left behind by a page builder or a search-and-replace that missed serialized data).",
          "medium",
          "-",
        ),
      );
    }
  }

  // T27 — forms on an HTTPS page that submit over plain HTTP.
  if (masked && pageUrl.startsWith("https:")) {
    let insecure = 0;
    for (const form of tagsNamed(masked, "form")) {
      const action = decodeEntities(form.attrs.action ?? "").trim();
      if (action && resolve(action, pageUrl).startsWith("http:")) insecure++;
    }
    if (insecure > 0) {
      out.push(
        F(
          "T27-insecure-forms",
          "technical",
          "P1",
          "Forms submit over HTTP",
          `${insecure} form(s) on this HTTPS page send their data to an http:// URL; browsers warn before submitting`,
          "Point every form action at an https:// URL.",
          "medium",
          "-",
        ),
      );
    }
  }

  // T28 — an internal search results page that can be indexed.
  if (isInternalSearchUrl(pageUrl) && !noindex) {
    out.push(
      F(
        "T28-internal-search",
        "technical",
        "P2",
        "Internal search results page is indexable",
        `${pageUrl} is a site-search URL without noindex`,
        'Add <meta name="robots" content="noindex, follow"> to search result pages and keep them out of the sitemap; every query creates another thin URL.',
        "medium",
        "-",
      ),
    );
  }

  // T29 — pagination crawlers cannot follow.
  {
    /** @type {Note[]} */
    const notes = [];
    const anchors = new Set(links.map(targetKey));
    const declared = linkTags
      .filter((t) => relList(t.attrs.rel).some((r) => r === "next" || r === "prev" || r === "previous"))
      .map((t) => resolve(decodeEntities(t.attrs.href ?? "").trim(), pageUrl))
      .filter(Boolean);
    const unlinked = declared.filter((u) => !anchors.has(targetKey(u)));
    if (unlinked.length > 0) {
      notes.push([
        `rel=next/prev points to ${unlinked.slice(0, 2).join(", ")}, but no <a href> on the page links there`,
        "P3",
      ]);
    }
    if (isPaginationUrl(pageUrl) && noindex)
      notes.push(["a paginated listing page (page 2+) is set to noindex", "P3"]);
    if (notes.length > 0) {
      out.push(
        F(
          "T29-rel-pagination",
          "technical",
          worst(notes),
          "Pagination is hard for crawlers to follow",
          describe(notes),
          "Link to the next and previous pages with ordinary <a href> links (Google no longer uses rel=next/prev), and keep paginated pages indexable with a self-referencing canonical.",
          "low",
          "-",
        ),
      );
    }
  }

  // T30 — document structure that changes how the page is parsed.
  if (masked) {
    /** @type {Note[]} */
    const notes = [];
    if (!/<!doctype\s+html/i.test(masked.slice(0, 4096)))
      notes.push(["no <!doctype html>: browsers render in quirks mode", "P3"]);
    const heads = [...masked.matchAll(/<head(?=[\s>])/gi)].length;
    const bodies = [...masked.matchAll(/<body(?=[\s>])/gi)].length;
    if (heads > 1) notes.push([`${heads} <head> elements`, "P2"]);
    if (bodies > 1) notes.push([`${bodies} <body> elements`, "P2"]);
    if (notes.length > 0) {
      out.push(
        F(
          "T30-markup",
          "technical",
          worst(notes),
          "Document structure problems",
          describe(notes),
          "Start the document with <!doctype html> and keep exactly one <head> and one <body>.",
          "low",
          "-",
        ),
      );
    }
  }

  // O12 — likely SERP truncation by rendered width, which a character count misses.
  {
    const title = String(page.title ?? "");
    const desc = String(page.metaDescription ?? "");
    /** @type {string[]} */
    const notes = [];
    // Only within the character limits, so a long title is not reported twice.
    if (title && [...title].length <= (opts.titleMax ?? 60)) {
      const px = textPx(title, 20);
      if (px > TITLE_PX_REPORT)
        notes.push(`title is about ${px} px wide; Google shows about ${TITLE_PX_LIMIT} px`);
    }
    if (desc && [...desc].length <= (opts.metaMax ?? 155)) {
      const px = textPx(desc, 14);
      if (px > DESC_PX_REPORT)
        notes.push(`meta description is about ${px} px wide; about ${DESC_PX_LIMIT} px is shown`);
    }
    if (notes.length > 0) {
      out.push(
        F(
          "O12-serp-width",
          "onpage",
          "P3",
          "Title or description likely truncated in results",
          notes.join("; "),
          "Shorten it or use narrower characters: capitals and wide letters (W, M) take more room than their count suggests.",
          "low",
          "-",
        ),
      );
    }
  }

  // O13 — jump links (#section) with no matching id on the page.
  if (masked && !page.appShell) {
    /** @type {Set<string>} */
    const wanted = new Set();
    for (const m of masked.matchAll(/<a(?=\s)[^>]*\shref\s*=\s*(?:"#([^"]*)"|'#([^']*)'|#([^\s>"']+))/gi)) {
      let frag = decodeEntities(m[1] ?? m[2] ?? m[3] ?? "");
      try {
        frag = decodeURIComponent(frag);
      } catch {
        // keep the undecoded fragment
      }
      // Skip "#", "#top", "#0" and router/action hashes (#/route, #!x, #action:…).
      if (!frag || /^(?:top|0)$/i.test(frag) || /[\s/!:=?&]/.test(frag)) continue;
      wanted.add(frag);
    }
    if (wanted.size > 0) {
      /** @type {Set<string>} */
      const ids = new Set();
      for (const m of masked.matchAll(/\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
        ids.add(decodeEntities(m[1] ?? m[2] ?? m[3] ?? ""));
      }
      const missing = [...wanted].filter((f) => !ids.has(f));
      if (missing.length > 0) {
        out.push(
          F(
            "O13-dead-anchors",
            "onpage",
            "P3",
            "Jump links point to missing sections",
            `${missing.length} link(s) with no matching id: ${missing
              .slice(0, 3)
              .map((f) => `#${f}`)
              .join(", ")}`,
            "Give the target element the matching id, or fix the link. Working jump links can also appear as 'Jump to' links in Google results.",
            "low",
            "-",
          ),
        );
      }
    }
  }

  // C06 — placeholder copy that shipped by accident.
  {
    const hits = String(page.visibleText ?? "").match(/\blorem\s+ipsum\b/gi);
    if (hits) {
      out.push(
        F(
          "C06-placeholder",
          "content",
          "P2",
          "Placeholder text on the page",
          `"lorem ipsum" appears ${hits.length} time(s) in the visible text`,
          "Replace the template filler with real content.",
          "medium",
          "medium",
        ),
      );
    }
  }

  // P07 — transfer settings that cost every request (needs the real response headers).
  if (Object.keys(headers).length > 0 && status >= 200 && status < 300) {
    /** @type {Note[]} */
    const notes = [];
    const bytes = Number(page.htmlBytes ?? 0) || raw.length;
    const encoding = (headers["content-encoding"] ?? "").trim().toLowerCase();
    if ((!encoding || encoding === "identity") && bytes > 20 * 1024) {
      notes.push([`${Math.round(bytes / 1024)} KB of HTML sent uncompressed (no gzip or brotli)`, "P2"]);
    }
    if (!headers.etag && !headers["last-modified"]) {
      notes.push(["no ETag or Last-Modified header, so crawlers cannot revalidate the page cheaply", "P3"]);
    }
    if (notes.length > 0) {
      out.push(
        F(
          "P07-delivery",
          "performance",
          worst(notes),
          "HTML delivery is not optimised",
          describe(notes),
          "Enable gzip or brotli for HTML on the server or CDN, and send an ETag or Last-Modified header so browsers and Google's crawlers can make conditional requests.",
          "low",
          "-",
        ),
      );
    }
  }

  return out;
}
