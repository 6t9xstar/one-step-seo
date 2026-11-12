/**
 * Test helper: a small multi-page site with deliberate, known SEO problems,
 * served from an in-process HTTP server or written to a directory.
 *
 * Known problems (asserted on by the engine tests):
 *   /            healthy hub, links to most pages
 *   /pricing     duplicate title + description with /plans, identical body
 *   /plans       (same as /pricing)
 *   /guide       healthy long page
 *   /guide-copy  near-identical copy of /guide
 *   /hidden      noindex, listed in the sitemap
 *   /orphan      in the sitemap, linked from nowhere
 *   /old         301 -> /guide (linked from the hub)
 *   /gone        404 (linked from the hub, listed in the sitemap)
 *   /file.pdf    non-HTML asset (linked from the hub)
 */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

const WORDS =
  "Search engines reward pages that answer a question clearly and completely. " +
  "This guide explains how crawling, indexing and ranking fit together, with practical steps you can apply today. " +
  "Every section includes an example, a checklist and a measurable outcome so progress is easy to track over time. ";

/**
 * @param {{ title: string, description?: string, h1?: string, body?: string, head?: string, canonical?: string }} o
 * @returns {string}
 */
export function page(o) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title}</title>
${o.description ? `<meta name="description" content="${o.description}">` : ""}
${o.canonical ? `<link rel="canonical" href="${o.canonical}">` : ""}
<link rel="icon" href="/favicon.ico">
${o.head ?? ""}
</head>
<body>
<main>
<h1>${o.h1 ?? o.title}</h1>
${o.body ?? `<p>${WORDS.repeat(3)}</p>`}
</main>
</body>
</html>
`;
}

const DESC =
  "A clear one hundred and thirty character description that explains what this page offers and why a searcher should click through.";
const GUIDE_BODY = `<h2>How crawling works</h2><p>${WORDS.repeat(4)}</p><h2>How indexing works</h2><p>${WORDS.repeat(4)}</p><ul><li>Step one</li><li>Step two</li></ul>`;
const PLAN_BODY = `<h2>Plans</h2><p>${"Our plans include hosting, support and reporting for teams of every size, billed monthly or yearly. ".repeat(8)}</p>`;

/**
 * Site pages keyed by path. `{base}` is replaced with the origin.
 * @returns {Record<string, { status?: number, type?: string, body?: string, location?: string }>}
 */
export function siteRoutes() {
  return {
    "/": {
      body: page({
        title: "Acme SEO Toolkit — Home of Practical Search Guides",
        description: DESC,
        body: `<p>${WORDS.repeat(2)}</p><ul>
<li><a href="/pricing">Pricing</a></li><li><a href="/plans">Plans</a></li>
<li><a href="/guide">Crawling guide</a></li><li><a href="/guide-copy">Guide copy</a></li>
<li><a href="/hidden">Hidden</a></li><li><a href="/old">Old guide</a></li>
<li><a href="/gone">Gone</a></li><li><a href="/file.pdf">Brochure</a></li></ul>`,
      }),
    },
    "/pricing": {
      body: page({ title: "Acme Pricing and Plans for Every Team Size", description: DESC, body: PLAN_BODY }),
    },
    "/plans": {
      body: page({ title: "Acme Pricing and Plans for Every Team Size", description: DESC, body: PLAN_BODY }),
    },
    "/guide": {
      body: page({
        title: "Crawling and Indexing Guide for Site Owners",
        description: `${DESC} Guide.`,
        body: `${GUIDE_BODY}<p><a href="/">Home</a></p>`,
      }),
    },
    "/guide-copy": {
      body: page({
        title: "Crawling and Indexing Handbook for Website Owners",
        description: `${DESC} Handbook.`,
        body: `${GUIDE_BODY}<p><a href="/">Home</a> again</p>`,
      }),
    },
    "/hidden": {
      body: page({
        title: "Internal Staging Notes Not Meant for Search",
        description: `${DESC} Hidden.`,
        head: `<meta name="robots" content="noindex">`,
      }),
    },
    "/orphan": {
      body: page({ title: "An Orphaned Landing Page Nobody Links To", description: `${DESC} Orphan.` }),
    },
    "/old": { status: 301, location: "/guide" },
    "/gone": { status: 404, body: "<html><body><h1>Not found</h1></body></html>" },
    "/file.pdf": { type: "application/pdf", body: "%PDF-1.4 fake" },
    "/robots.txt": { type: "text/plain", body: "User-agent: *\nAllow: /\nSitemap: {base}/sitemap.xml\n" },
    "/sitemap.xml": {
      type: "application/xml",
      body: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
        "/",
        "/pricing",
        "/plans",
        "/guide",
        "/hidden",
        "/orphan",
        "/gone",
      ]
        .map((p) => `<url><loc>{base}${p}</loc></url>`)
        .join("")}</urlset>`,
    },
  };
}

/**
 * Start the fixture site. `mutate` may change routes between requests
 * (monitoring tests flip pages to noindex / 404 / new titles).
 * @param {Record<string, { status?: number, type?: string, body?: string, location?: string }>} [routes]
 * @returns {Promise<{ server: import("node:http").Server, base: string, routes: Record<string, any>, close: () => Promise<void> }>}
 */
export function startSite(routes = siteRoutes()) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
      const path = new URL(req.url ?? "/", base).pathname;
      const r = routes[path];
      if (!r) {
        res.writeHead(404, { "content-type": "text/html" });
        res.end("<html><body>not found</body></html>");
        return;
      }
      if (r.location) {
        res.writeHead(r.status ?? 301, { location: r.location });
        res.end();
        return;
      }
      res.writeHead(r.status ?? 200, { "content-type": r.type ?? "text/html; charset=utf-8" });
      res.end(
        String(r.body ?? "")
          .split("{base}")
          .join(base),
      );
    });
    server.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
      resolve({
        server,
        base,
        routes,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

/**
 * Write a broken local site into `dir` (for offline audit / fix tests).
 * @param {string} dir
 * @returns {string[]} written file paths
 */
export function writeLocalSite(dir) {
  /** @type {Record<string, string>} */
  const files = {
    "index.html": `<!doctype html>
<html>
<head>
<title>Local Site Home Page With a Reasonable Title</title>
</head>
<body>
<h1>Local home</h1>
<p>${WORDS.repeat(3)}</p>
<p><a href="about.html">About</a> <a href="blog/">Blog</a> <a href="missing.html">Missing</a></p>
<img src="img/team-photo.jpg">
</body>
</html>
`,
    "about.html": `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>About the Local Site and the People Behind It</title>
</head>
<body>
<h1>About us</h1>
<p>${WORDS.repeat(3)}</p>
<p><a href="index.html">Home</a></p>
</body>
</html>
`,
    "blog/index.html": `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Local Site Blog Index With Recent Articles</title>
<meta name="robots" content="noindex">
</head>
<body>
<h1>Blog</h1>
<p>${WORDS.repeat(3)}</p>
<p><a href="/index.html">Home</a></p>
</body>
</html>
`,
  };
  /** @type {string[]} */
  const written = [];
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, "utf8");
    written.push(p);
  }
  return written;
}
