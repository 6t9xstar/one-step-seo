/**
 * one-step-seo — dependency-free HTML parser for SEO signals.
 * Intentionally regex-based: good enough for audits, zero install weight.
 * Not a general HTML parser — keep patterns conservative.
 */

/** @param {RegExp} re @param {string} html @returns {string} */
function firstGroup(re, html) {
  const m = html.match(re);
  return m ? m[1].trim() : "";
}

/** @param {RegExp} re @param {string} html @returns {string[]} */
function allGroups(re, html) {
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1].trim());
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
    const name = m[1].toLowerCase();
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    attrs[name] = value;
  }
  return attrs;
}

/** @param {string} s @returns {string} */
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&copy;/gi, "(c)")
    .replace(/&reg;/gi, "(r)")
    .replace(/&trade;/gi, "(tm)")
    .replace(/&hellip;/gi, "...")
    .replace(/&mdash;/gi, "-")
    .replace(/&ndash;/gi, "-")
    .replace(/&#(\d+);/g, (_m, n) => {
      const cp = Number(n);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => {
      const cp = parseInt(h, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
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
      .replace(/<[^>]+>/g, " ")
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
 * @property {any} internalLinkCount
 * @property {any} externalLinkCount
 * @property {any} wordCount
 * @property {any} visibleText
 * @property {any} first150
 * @property {any} hasQuestion
 * @property {any} hasAnswerBlock
 * @property {any} faqDetected
 * @property {any} tables
 * @property {any} lists
 * @property {any} jsonLdBlocks
 * @property {any} htmlBytes
 */

/**
 * @param {string} html
 * @param {string} pageUrl
 * @returns {ParsedPage}
 */
export function parseHtml(html, pageUrl) {
  const head = firstGroup(/<head[\s\S]*?>([\s\S]*?)<\/head\s*>/i, html) || html.slice(0, 60000);
  const body = firstGroup(/<body[\s\S]*?>([\s\S]*?)<\/body\s*>/i, html) || html;

  const title = firstGroup(/<title[^>]*>([\s\S]*?)<\/title\s*>/i, html)
    .replace(/\s+/g, " ")
    .trim();

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

  const metaDescription = metaByName("description");
  const robotsMeta = metaByName("robots");
  const viewport = metaByName("viewport");

  const charset = firstGroup(/<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i, head) || "not-found";
  const lang = firstGroup(/<html\b[^>]*\blang\s*=\s*["']?([a-zA-Z-]+)/i, html) || "";

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
    headings.push({ level: Number(hm[1][1]), text: stripTags(hm[2]).slice(0, 300) });
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
    title: metaByProp("og:title"),
    description: metaByProp("og:description"),
    image: metaByProp("og:image"),
    url: metaByProp("og:url"),
    type: metaByProp("og:type"),
  };
  const twitter = {
    card: metaByName("twitter:card"),
    title: metaByName("twitter:title"),
    description: metaByName("twitter:description"),
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

  // ---- visible text stats ----
  const visibleText = stripTags(body);
  const words = visibleText ? visibleText.split(" ").filter(Boolean) : [];
  const wordCount = words.length;
  const first150 = words.slice(0, 150).join(" ");

  // Answer-first heuristic: question + direct answer near top?
  const questionRe = /\b(what|why|how|when|where|which|who|is|are|can|does|should)\b[^?.!]{5,120}[?]/i;
  const hasQuestion = questionRe.test(visibleText.slice(0, 4000));
  const hasAnswerBlock =
    hasQuestion || /^(tl;dr|in short|summary|answer)\s*:/im.test(visibleText.slice(0, 2000));

  const faqDetected =
    /faq/i.test(html.slice(0, 200000)) ||
    /application\/ld\+json/i.test(html) ||
    headings.some((h) => /frequently asked|faq/i.test(h.text));

  const tables = (body.match(/<table\b/gi) || []).length;
  const lists = (body.match(/<(ul|ol)\b/gi) || []).length;

  // JSON-LD script blocks (raw, validation lives in schema.mjs)
  const jsonLdBlocks = allGroups(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
    html
  );

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
    imagesWithoutAlt: images.filter((i) => !i.hasAlt || !i.alt.trim()).length,
    imagesWithoutDimensions: images.filter((i) => !i.width || !i.height).length,
    internalLinks: [...internal].slice(0, 500),
    externalLinks: [...external].slice(0, 500),
    internalLinkCount: internal.size,
    externalLinkCount: external.size,
    wordCount,
    visibleText,
    first150,
    hasQuestion,
    hasAnswerBlock,
    faqDetected,
    tables,
    lists,
    jsonLdBlocks,
    htmlBytes: html.length,
  };
}
