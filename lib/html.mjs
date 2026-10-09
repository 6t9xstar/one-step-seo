/**
 * one-step-seo — dependency-free HTML parser for SEO signals.
 * Intentionally regex-based: good enough for audits, zero install weight.
 * Not a general HTML parser — keep patterns conservative.
 */

/** @param {RegExp} re @param {string} html @returns {string} */
function firstGroup(re, html) {
  const m = html.match(re);
  return m?.[1]?.trim() ?? "";
}

/** @param {RegExp} re @param {string} html @returns {string[]} */
function allGroups(re, html) {
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1]?.trim() ?? "");
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

/** @param {string} tag @returns {Record<string, string>} */
function parseAttributes(tag) {
  /** @type {Record<string, string>} */
  const attrs = {};
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(tag)) !== null) {
    const name = (m[1] ?? "").toLowerCase();
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    attrs[name] = value;
  }
  return attrs;
}

/** Named entities we decode. Anything not listed is left untouched. */
const NAMED_ENTITIES = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  copy: "(c)",
  reg: "(r)",
  trade: "(tm)",
  hellip: "...",
  mdash: "-",
  ndash: "-",
};

/**
 * Single-pass entity decode. Must be one pass: the previous chained
 * `.replace()` calls expanded `&amp;` *before* `&lt;`, so `&amp;lt;` decoded
 * twice into `<` and corrupted titles like "A &amp;lt; B".
 * @param {string} s
 * @returns {string}
 */
function decodeEntities(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body) => {
    if (body.charCodeAt(0) === 35 /* # */) {
      const isHex = body[1] === "x" || body[1] === "X";
      const cp = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    }
    const named = NAMED_ENTITIES[/** @type {keyof typeof NAMED_ENTITIES} */ (body.toLowerCase())];
    return named === undefined ? match : named;
  });
}

/** @param {string} html @returns {string} */
function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} href @param {string} base @returns {string} */
function resolveUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

/**
 * Parsed page signals. All properties are `any`-typed because the
 * regex parser is intentionally dynamic; consumers narrow what they use.
 * @typedef {object} ParsedPage
 * @property {any} title
 * @property {any} titleLength
 * @property {any} metaDescription
 * @property {any} metaDescriptionLength
 * @property {any} robotsMeta
 * @property {any} viewport
 * @property {any} charset
 * @property {any} lang
 * @property {any} canonical
 * @property {any} canonicalRaw
 * @property {any} hreflangs
 * @property {any} icon
 * @property {any} headings
 * @property {any} h1s
 * @property {any} h2s
 * @property {any} headingOrderOk
 * @property {any} og
 * @property {any} twitter
 * @property {any} images
 * @property {any} imagesWithoutAlt
 * @property {any} imagesWithoutDimensions
 * @property {any} internalLinks
 * @property {any} externalLinks
 * @property {any} linkTexts visible anchor texts, lowercased (capped)
 * @property {any} dataNosnippetCount elements carrying data-nosnippet
 * @property {any} subresources absolute subresource URLs with tag kind ({ url, kind })
 * @property {any} internalLinkCount
 * @property {any} externalLinkCount
 * @property {any} wordCount
 * @property {any} visibleText
 * @property {any} first150
 * @property {any} hasAnswerBlock
 * @property {any} faqDetected
 * @property {any} hasFaqMarkup FAQPage JSON-LD present (regardless of visible copy)
 * @property {any} faqCopyDetected visible FAQ signals (regardless of markup)
 * @property {any} tables
 * @property {any} tablesWithHeaders tables containing at least one th cell
 * @property {any} hasTimeTag a time element is present (freshness signal)
 * @property {any} lists
 * @property {any} jsonLdBlocks
 * @property {any} htmlBytes
 */

/**
 * Remove non-content regions from a document whose <body> could not be parsed.
 * Keeps text nodes; drops head, script, style, noscript and comments so the
 * visible-text statistics are not inflated by metadata.
 * @param {string} html
 * @returns {string}
 */
function stripNonContentBlocks(html) {
  return html
    .replace(/<head[\s\S]*?<\/head\s*>/gi, " ")
    .replace(/<script[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

/**
 * @param {string} html
 * @param {string} pageUrl
 * @returns {ParsedPage}
 */
export function parseHtml(html, pageUrl) {
  const head = firstGroup(/<head[\s\S]*?>([\s\S]*?)<\/head\s*>/i, html) || html.slice(0, 60000);
  // Fall back to the whole document only after stripping its non-content
  // regions. Using raw `html` here pulled <title>/meta text into the body
  // stats, inflating wordCount and polluting the answer-first signals on any
  // page missing a closing </body>.
  const bodyMatch = firstGroup(/<body[\s\S]*?>([\s\S]*?)<\/body\s*>/i, html);
  const body = bodyMatch || stripNonContentBlocks(html);

  const title = decodeEntities(
    firstGroup(/<title[^>]*>([\s\S]*?)<\/title\s*>/i, html)
      .replace(/\s+/g, " ")
      .trim(),
  );

  // ---- meta tags ----
  /** @type {Record<string, string>[]} */
  const metaTags = [];
  const metaRe = /<meta\b[^>]*>/gi;
  let mm;
  while ((mm = metaRe.exec(head)) !== null) metaTags.push(parseAttributes(mm[0]));

  /** @param {string} n @returns {string} */
  const metaByName = (n) => (metaTags.find((t) => (t.name ?? "").toLowerCase() === n)?.content ?? "").trim();
  /** @param {string} p @returns {string} */
  const metaByProp = (p) =>
    (metaTags.find((t) => (t.property ?? "").toLowerCase() === p)?.content ?? "").trim();

  const metaDescription = decodeEntities(metaByName("description"));
  const robotsMeta = metaByName("robots");
  const viewport = metaByName("viewport");

  const charset = firstGroup(/<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i, head) || "not-found";
  const lang = firstGroup(/<html\b[^>]*\blang\s*=\s*["']?([a-zA-Z]+(?:[-_][a-zA-Z0-9]+)*)/i, html) || "";

  // ---- canonical / hreflang / robots link headers handled elsewhere ----
  /** @type {Record<string, string>[]} */
  const linkTags = [];
  const linkRe = /<link\b[^>]*>/gi;
  let lm;
  while ((lm = linkRe.exec(head)) !== null) linkTags.push(parseAttributes(lm[0]));

  const canonical = linkTags.find((t) => (t.rel ?? "").toLowerCase() === "canonical")?.href ?? "";
  const hreflangs = linkTags
    .filter((t) => (t.rel ?? "").toLowerCase() === "alternate" && t.hreflang)
    .map((t) => ({ lang: t.hreflang, href: t.href ?? "" }));
  const icon = linkTags.some((t) => (t.rel ?? "").toLowerCase().includes("icon"));

  // ---- headings (document order) ----
  const headingRe = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  const headings = [];
  let hm;
  while ((hm = headingRe.exec(html)) !== null) {
    const level = hm[1]?.[1];
    if (level === undefined) continue;
    headings.push({ level: Number(level), text: stripTags(hm[2] ?? "").slice(0, 300) });
  }
  const h1s = headings.filter((h) => h.level === 1);
  const h2s = headings.filter((h) => h.level === 2);

  let headingOrderOk = true;
  let prev = 0;
  for (const h of headings) {
    if (prev !== 0 && h.level > prev + 1) {
      headingOrderOk = false;
      break;
    }
    prev = h.level;
  }

  // ---- open graph / twitter ----
  const og = {
    title: decodeEntities(metaByProp("og:title")),
    description: decodeEntities(metaByProp("og:description")),
    image: metaByProp("og:image"),
    url: metaByProp("og:url"),
    type: metaByProp("og:type"),
  };
  const twitter = {
    card: metaByName("twitter:card"),
    title: decodeEntities(metaByName("twitter:title")),
    description: decodeEntities(metaByName("twitter:description")),
    image: metaByName("twitter:image"),
  };

  // ---- images ----
  const images = [];
  const imgRe = /<img\b[^>]*>/gi;
  let im;
  while ((im = imgRe.exec(body)) !== null) {
    const a = parseAttributes(im[0]);
    images.push({
      src: a.src ?? "",
      alt: a.alt ?? "",
      hasAlt: "alt" in a,
      width: a.width ?? "",
      height: a.height ?? "",
      loading: a.loading ?? "",
    });
  }

  // ---- links ----
  let pageHost = "";
  try {
    pageHost = new URL(pageUrl).host.toLowerCase();
  } catch {
    pageHost = "";
  }
  const internal = new Set();
  const external = new Set();
  const aRe = /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  let am;
  while ((am = aRe.exec(body)) !== null) {
    const raw = am[2] ?? am[3] ?? am[4] ?? "";
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) continue;
    const abs = resolveUrl(raw, pageUrl);
    if (!abs) continue;
    let host = "";
    try {
      host = new URL(abs).host.toLowerCase();
    } catch {
      continue;
    }
    if (host === pageHost) internal.add(abs.split("#")[0]);
    else external.add(abs.split("#")[0]);
  }

  // ---- subresources (mixed-content detection): absolute URL + tag kind ----
  /** @type {{ url: string, kind: string }[]} */
  const subresources = [];
  const seenSub = new Set();
  /** @param {string} raw @param {string} kind @returns {void} */
  const addSub = (raw, kind) => {
    if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return;
    const abs = resolveUrl(raw, pageUrl);
    if (!abs || seenSub.has(abs)) return;
    seenSub.add(abs);
    subresources.push({ url: abs, kind });
  };
  for (const im of images) addSub(im.src ?? "", "img");
  // Scripts live in <head> (analytics, tag managers) as often as in <body>,
  // so scan the whole document — unlike images/links, position is irrelevant.
  const scriptRe = /<script\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  let sm;
  while ((sm = scriptRe.exec(html)) !== null) addSub(sm[2] ?? sm[3] ?? sm[4] ?? "", "script");
  for (const t of linkTags) addSub(t.href ?? "", "link");
  // linkTags above cover <head>; stylesheets/preloads can also appear in
  // <body> — scan it for subresource purposes (dedupe keeps one entry).
  const bodyLinkRe = /<link\b[^>]*>/gi;
  let blm;
  while ((blm = bodyLinkRe.exec(body)) !== null) addSub(parseAttributes(blm[0]).href ?? "", "link");

  // ---- link texts (generic-anchor detection): visible text per <a>,
  // lowercased + collapsed, capped. The href loop above only keeps URLs.
  const linkTexts = [];
  const aTextRe = /<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let tm;
  while ((tm = aTextRe.exec(body)) !== null && linkTexts.length < 200) {
    const t = stripTags(tm[1] ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (t) linkTexts.push(t.slice(0, 80));
  }

  // Snippet-control plumbing: sections excluded from snippets/AI quotes.
  const dataNosnippetCount = (body.match(/[\s]data-nosnippet([\s=>/]|$)/gi) || []).length;

  // ---- visible text stats ----
  const visibleText = stripTags(body);
  const words = visibleText ? visibleText.split(" ").filter(Boolean) : [];
  const wordCount = words.length;
  const first150 = words.slice(0, 150).join(" ");

  // Answer-first heuristic. A question only counts when it is actually
  // ANSWERED. Merely finding a question mark anywhere in the opening handed the
  // full 25-point weight to pages with no answer-first content at all — nav and
  // breadcrumb links ("Where is your office located?", "Can I book a demo?")
  // are boilerplate, not an answer.
  const ANSWER_WINDOW = 2000;
  // Informational interrogatives only. `is/are/can/does/should` were matched
  // before, and those forms are overwhelmingly nav links and CTAs rather than
  // answer-first content.
  const QUESTION_RE = /\b(?:what|why|how|when|where|which|who)\b[^?.!]{5,120}\?/gi;
  const opening = visibleText.slice(0, ANSWER_WINDOW);
  let hasAnswerBlock = false;
  let qm;
  while ((qm = QUESTION_RE.exec(opening)) !== null) {
    // Substantial prose must follow the question before the next one — real
    // answer text, not another link label.
    const answerChunk = opening.slice(qm.index + qm[0].length).split("?")[0] ?? "";
    const letters = (answerChunk.replace(/[^A-Za-z]/g, "").match(/[A-Za-z]/g) || []).length;
    if (letters >= 40) {
      hasAnswerBlock = true;
      break;
    }
  }
  if (!hasAnswerBlock) {
    // Explicit answer markers. `visibleText` has no newlines — stripTags
    // collapses all whitespace — so the previous `/^.../m` anchor could only
    // ever match position 0, making this branch dead code for any marker that
    // was not literally first on the page.
    hasAnswerBlock = /\b(?:tl;dr|in short|in summary|the answer)\s*:/i.test(opening);
  }

  // JSON-LD script blocks (raw, validation lives in schema.mjs)
  const jsonLdBlocks = allGroups(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
    html,
  );

  // FAQ is covered only when FAQPage markup or explicit FAQ copy exists —
  // the mere presence of *any* JSON-LD must not count.
  const hasFaqMarkup = jsonLdBlocks.some((b) => /"@type"\s*:\s*"FAQPage"/i.test(b));
  const faqCopyDetected =
    /faq/i.test(headings.map((h) => h.text).join("\n")) ||
    /\bfrequently asked questions\b/i.test(visibleText.slice(0, 20000));
  const faqDetected = hasFaqMarkup || faqCopyDetected;

  const tables = (body.match(/<table\b/gi) || []).length;
  const lists = (body.match(/<(ul|ol)\b/gi) || []).length;
  // Semantic tables carry <th> header cells (comparison tables AI systems
  // parse best). Match each table block so a <th> in one table cannot
  // credit a neighboring header-less table.
  const tableBlocks = body.match(/<table\b[\s\S]*?<\/table\s*>/gi) || [];
  const tablesWithHeaders = tableBlocks.filter((b) => /<th\b/i.test(b)).length;
  // Freshness plumbing: <time datetime> elements for the G06 signal.
  const hasTimeTag = /<time[\s>]/i.test(html);

  return {
    title,
    titleLength: [...title].length,
    metaDescription,
    metaDescriptionLength: [...metaDescription].length,
    robotsMeta,
    viewport,
    charset,
    lang,
    canonical: canonical ? resolveUrl(canonical, pageUrl) : "",
    canonicalRaw: canonical,
    hreflangs,
    icon,
    headings,
    h1s,
    h2s,
    headingOrderOk,
    og,
    twitter,
    images,
    // An `alt` attribute that is present but empty is CORRECT markup for a
    // decorative image — the O08 fix text explicitly recommends it. Only count
    // images with no `alt` attribute at all.
    imagesWithoutAlt: images.filter((i) => !i.hasAlt).length,
    imagesWithoutDimensions: images.filter((i) => !i.width || !i.height).length,
    internalLinks: [...internal].slice(0, 500),
    externalLinks: [...external].slice(0, 500),
    linkTexts,
    dataNosnippetCount,
    internalLinkCount: internal.size,
    externalLinkCount: external.size,
    subresources: subresources.slice(0, 200),
    wordCount,
    visibleText,
    first150,
    hasAnswerBlock,
    faqDetected,
    hasFaqMarkup,
    faqCopyDetected,
    tables,
    tablesWithHeaders,
    hasTimeTag,
    lists,
    jsonLdBlocks,
    htmlBytes: typeof Buffer !== "undefined" ? Buffer.byteLength(html, "utf8") : html.length,
  };
}
