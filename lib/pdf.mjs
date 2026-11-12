/**
 * one-step-seo — minimal PDF writer (zero dependencies).
 *
 * Produces a real, text-based PDF 1.4 document using the standard Helvetica
 * fonts every reader ships with (no font embedding, no images). Enough for a
 * paginated, selectable, printable report: headings, wrapped paragraphs,
 * bullet lines and a page footer.
 *
 * Text is encoded as WinAnsi (CP1252). Characters outside that set are
 * transliterated where a sensible ASCII form exists and replaced with "?"
 * otherwise.
 */

/** Helvetica advance widths (1/1000 em) for ASCII 32..126. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,
  500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469,
  556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** @type {Record<string, string>} */
const TRANSLITERATE = {
  "→": "->",
  "←": "<-",
  "↔": "<->",
  "≥": ">=",
  "≤": "<=",
  "≠": "!=",
  "✓": "[ok]",
  "✔": "[ok]",
  "✗": "[x]",
  "✘": "[x]",
  "×": "x",
  "−": "-",
};

// Non-breaking / thin / zero-width spaces, written as code points so the
// source stays unambiguous in any editor.
TRANSLITERATE[String.fromCharCode(0xa0)] = " ";
TRANSLITERATE[String.fromCharCode(0x2009)] = " ";
TRANSLITERATE[String.fromCharCode(0x202f)] = " ";
TRANSLITERATE[String.fromCharCode(0x200b)] = "";

/** Unicode -> CP1252 for the 0x80–0x9F block (the part that differs from Latin-1). */
/** @type {Record<number, number>} */
const CP1252 = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

/**
 * Convert a string to WinAnsi byte values (transliterating / replacing the rest).
 * @param {string} text
 * @returns {number[]}
 */
export function toWinAnsi(text) {
  /** @type {number[]} */
  const out = [];
  for (const ch of String(text ?? "")) {
    const mapped = TRANSLITERATE[ch];
    const src = mapped !== undefined ? mapped : ch;
    for (const c of src) {
      const cp = c.codePointAt(0) ?? 63;
      if (cp === 9) out.push(32);
      else if (cp < 32 || cp === 127) continue;
      else if (cp < 127 || (cp >= 0xa0 && cp <= 0xff)) out.push(cp);
      else out.push(CP1252[cp] ?? 63);
    }
  }
  return out;
}

/**
 * Width of WinAnsi bytes at a font size (points). Bold is approximated.
 * @param {number[]} bytes
 * @param {number} size
 * @param {boolean} bold
 * @returns {number}
 */
function widthOf(bytes, size, bold) {
  let w = 0;
  for (const b of bytes) w += b >= 32 && b <= 126 ? (HELVETICA_WIDTHS[b - 32] ?? 556) : 556;
  return (w / 1000) * size * (bold ? 1.08 : 1);
}

/**
 * Greedy word wrap to a maximum width. Over-long words are hard-split.
 * @param {string} text
 * @param {number} size
 * @param {boolean} bold
 * @param {number} maxWidth
 * @returns {number[][]} lines as WinAnsi byte arrays
 */
export function wrapText(text, size, bold, maxWidth) {
  /** @type {number[][]} */
  const lines = [];
  /** @type {number[]} */
  let line = [];
  /** @param {number[]} word */
  const pushWord = (word) => {
    const candidate = line.length > 0 ? [...line, 32, ...word] : word;
    if (widthOf(candidate, size, bold) <= maxWidth) {
      line = candidate;
      return;
    }
    if (line.length > 0) {
      lines.push(line);
      line = [];
    }
    let rest = word;
    while (widthOf(rest, size, bold) > maxWidth && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && widthOf(rest.slice(0, cut), size, bold) > maxWidth) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  };
  for (const word of String(text ?? "")
    .split(/\s+/)
    .filter(Boolean))
    pushWord(toWinAnsi(word));
  if (line.length > 0) lines.push(line);
  return lines.length > 0 ? lines : [[]];
}

/**
 * Escape WinAnsi bytes as a PDF literal string body.
 * @param {number[]} bytes
 * @returns {string} latin1 string
 */
function pdfString(bytes) {
  let s = "";
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += `\\${String.fromCharCode(b)}`;
    else s += String.fromCharCode(b);
  }
  return s;
}

/**
 * @typedef {{ text: string, style?: "title" | "h1" | "h2" | "body" | "bullet" | "small" | "space" }} PdfBlock
 */

/** @type {Record<string, { size: number, bold: boolean, before: number, after: number, indent: number }>} */
const STYLES = {
  title: { size: 22, bold: true, before: 0, after: 10, indent: 0 },
  h1: { size: 15, bold: true, before: 14, after: 6, indent: 0 },
  h2: { size: 11.5, bold: true, before: 9, after: 3, indent: 0 },
  body: { size: 10, bold: false, before: 0, after: 4, indent: 0 },
  bullet: { size: 10, bold: false, before: 0, after: 2, indent: 12 },
  small: { size: 8, bold: false, before: 0, after: 2, indent: 0 },
  space: { size: 10, bold: false, before: 0, after: 8, indent: 0 },
};

/**
 * Render blocks into a paginated PDF.
 * @param {PdfBlock[]} blocks
 * @param {{ title?: string, footer?: string }} [meta]
 * @returns {Buffer}
 */
export function renderPdf(blocks, meta = {}) {
  const PAGE_W = 595.28; // A4
  const PAGE_H = 841.89;
  const MARGIN = 54;
  const usable = PAGE_W - MARGIN * 2;
  const bottom = MARGIN + 18;

  /** @type {string[][]} one array of content-stream operators per page */
  const pages = [[]];
  let y = PAGE_H - MARGIN;
  const newPage = () => {
    pages.push([]);
    y = PAGE_H - MARGIN;
  };
  /** @param {string} op */
  const emit = (op) => {
    pages[pages.length - 1]?.push(op);
  };

  for (const block of Array.isArray(blocks) ? blocks : []) {
    const st = STYLES[block.style ?? "body"] ?? STYLES.body;
    if (!st) continue;
    if (block.style === "space") {
      y -= st.after;
      continue;
    }
    const lead = st.size * 1.35;
    const lines = wrapText(block.text, st.size, st.bold, usable - st.indent);
    if (y - st.before - lead < bottom) newPage();
    else y -= st.before;
    lines.forEach((line, i) => {
      if (y - lead < bottom) newPage();
      y -= lead;
      if (block.style === "bullet" && i === 0) {
        emit(
          `BT /F1 ${st.size} Tf ${(MARGIN + 2).toFixed(2)} ${y.toFixed(2)} Td (${pdfString([0x95])}) Tj ET`,
        );
      }
      emit(
        `BT /${st.bold ? "F2" : "F1"} ${st.size} Tf ${(MARGIN + st.indent).toFixed(2)} ${y.toFixed(2)} Td (${pdfString(line)}) Tj ET`,
      );
    });
    y -= st.after;
  }

  const footer = toWinAnsi(meta.footer ?? "");
  /** @type {string[]} */
  const objects = [];
  /** @param {string} body @returns {number} object number */
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = addObject(""); // 1 — filled in below
  const pagesId = addObject(""); // 2
  const fontRegular = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const fontBold = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );
  /** @type {number[]} */
  const pageIds = [];
  pages.forEach((ops, idx) => {
    const label = toWinAnsi(`Page ${idx + 1} of ${pages.length}`);
    const stream = [
      ...ops,
      `BT /F1 8 Tf ${MARGIN.toFixed(2)} ${(MARGIN - 6).toFixed(2)} Td (${pdfString(footer)}) Tj ET`,
      `BT /F1 8 Tf ${(PAGE_W - MARGIN - widthOf(label, 8, false)).toFixed(2)} ${(MARGIN - 6).toFixed(2)} Td (${pdfString(label)}) Tj ET`,
    ].join("\n");
    const contentId = addObject(
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    );
    pageIds.push(
      addObject(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> >>`,
      ),
    );
  });
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const infoId = addObject(
    `<< /Title (${pdfString(toWinAnsi(meta.title ?? "SEO report"))}) /Producer (one-step-seo) >>`,
  );

  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  /** @type {number[]} */
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
