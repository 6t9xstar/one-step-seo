import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtml } from "../lib/html.mjs";
import { runChecks } from "../lib/checks.mjs";
import { generateSchema, schemaSnippet, validateSchema } from "../lib/schema.mjs";
import { fetchWithRedirects } from "../lib/fetch.mjs";

function files(over = {}) {
  return {
    origin: "https://example.com",
    robots: { found: true, status: 200, sitemaps: [], disallowCount: 0, aiBlocked: false, textSample: "" },
    sitemap: {
      found: true,
      status: 200,
      url: "https://example.com/sitemap.xml",
      urlCount: 3,
      fromRobots: [],
    },
    llms: { found: true, status: 200, bytes: 200 },
    ...over,
  };
}

function fetched(over = {}) {
  return {
    finalUrl: "https://example.com/perfect/",
    status: 200,
    statusChain: [{ url: "https://example.com/perfect/", status: 200 }],
    contentType: "text/html; charset=utf-8",
    ms: 8,
    error: "",
    ...over,
  };
}

const PERFECT = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>A descriptive page title of forty characters</title>
<meta name="description" content="A well-crafted meta description that runs to about one hundred and forty characters total for testing purposes here.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="https://example.com/perfect/">
<link rel="icon" href="/favicon.ico">
<meta property="og:title" content="Perfect"><meta property="og:description" content="d"><meta property="og:image" content="https://example.com/og.png">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Perfect"}</script>
</head><body><h1>Perfect page</h1>
<p>What is this page? This page is a direct answer of about fifty words written first so both readers and machines get it immediately without scrolling anywhere else at all.</p>
<h2>Details</h2><table><tr><td>a</td></tr></table><ul><li>b</li></ul>
<h2>FAQ</h2><p>How does it work? It works well.</p>
<img src="/a.png" alt="A" width="100" height="100" loading="lazy">
<a href="https://example.com/1">1</a><a href="https://example.com/2">2</a>
<p>${"word ".repeat(400)}</p></body></html>`;

const BAD = `<!doctype html><html><head><title>${"T".repeat(80)}</title>
<meta name="description" content="${"D".repeat(200)}">
<meta name="robots" content="noindex">
<link rel="canonical" href="https://example.com/other/">
</head><body><h2>Sub first</h2><h4>Skipped</h4><p>Short thin page with no direct answer block anywhere near the top at all.</p>
${'<img src="/i.png">'.repeat(25)}
</body></html>`;

test("perfect page passes almost everything", () => {
  const p = parseHtml(PERFECT, "https://example.com/perfect/");
  const findings = runChecks(p, files(), fetched(), {
    items: [{ "@context": "https://schema.org", "@type": "Article", headline: "Perfect" }],
    types: ["Article"],
    issues: [],
    errors: [],
  });
  const bad = findings.filter((f) => f.severity === "P0" || f.severity === "P1");
  assert.deepEqual(
    bad.map((f) => f.id),
    [],
    `expected no P0/P1, got ${bad.map((f) => f.id).join(",")}`,
  );
});

test("bad page trips the remaining technical arms", () => {
  const p = parseHtml(BAD, "http://example.com/bad/?x=1");
  const findings = runChecks(
    p,
    files({
      robots: { found: false, status: 404, sitemaps: [], disallowCount: 0, aiBlocked: true, textSample: "" },
      sitemap: {
        found: false,
        status: 404,
        url: "https://example.com/sitemap.xml",
        urlCount: 0,
        fromRobots: [],
      },
      llms: { found: false, status: 404, bytes: 0 },
    }),
    fetched({
      finalUrl: "http://example.com/bad/?x=1",
      status: 500,
      statusChain: [
        { url: "http://example.com/a", status: 301 },
        { url: "http://example.com/b", status: 302 },
        { url: "http://example.com/bad/?x=1", status: 500 },
      ],
      contentType: "text/plain",
      error: "http status 500",
    }),
    { items: [], types: [], issues: [], errors: [] },
  );
  const byId = Object.fromEntries(findings.map((f) => [f.id, f.severity]));
  assert.equal(byId["T01-https"], "P0");
  assert.equal(byId["T02-status"], "P0");
  assert.equal(byId["T03-redirects"], "P1");
  assert.equal(byId["T04-content-type"], "P2");
  assert.equal(byId["T05-robots"], "P1");
  assert.equal(byId["T06-sitemap"], "P1");
  assert.equal(byId["T07-noindex"], "P0");
  assert.equal(byId["T08-canonical"], "P1");
  assert.equal(byId["T12-url"], "P2");
  assert.equal(byId["O01-title-long"], "P2");
  assert.equal(byId["O02-meta-long"], "P2");
  assert.equal(byId["O03-h1-missing"], "P1");
  assert.equal(byId["O04-headings"], "P2");
  assert.equal(byId["O06-og"], "P2");
  assert.equal(byId["O07-favicon"], "P2");
  assert.equal(byId["O08-alt"], "P1");
  assert.equal(byId["O10-internal"], "P1");
  assert.equal(byId["C01-thin"], "P1");
  assert.equal(byId["G02-ai-blocked"], "P1");
  assert.equal(byId["P02-img-count"], "P2");
});

test("T07-noindex honors the X-Robots-Tag header, which wins conflicts", () => {
  const p = parseHtml(PERFECT, "https://example.com/perfect/");
  const schemaInfo = {
    items: [{ "@context": "https://schema.org", "@type": "Article", headline: "Perfect" }],
    types: ["Article"],
    issues: [],
    errors: [],
  };
  /** @param {any} fetchOver */
  const sev = (fetchOver) => {
    const findings = runChecks(p, files(), fetched(fetchOver), schemaInfo);
    const f = findings.find((x) => x.id === "T07-noindex");
    assert.ok(f, "expected a T07-noindex finding");
    return f.severity;
  };
  assert.equal(sev({ headers: { "x-robots-tag": "noindex, nofollow" } }), "P0");
  assert.equal(sev({ headers: { "X-Robots-Tag": "none" } }), "P0");
  // noimageindex blocks images, not the page — must not false-positive.
  assert.equal(sev({ headers: { "x-robots-tag": "noimageindex" } }), "pass");
  assert.equal(sev({}), "pass");
});

test("T13-mixed grades active vs passive insecure subresources", () => {
  const schemaInfo = { items: [], types: [], issues: [], errors: [] };
  /** @param {string} html @param {string} finalUrl */
  const sev = (html, finalUrl) => {
    const findings = runChecks(parseHtml(html, finalUrl), files(), fetched({ finalUrl }), schemaInfo);
    const f = findings.find((x) => x.id === "T13-mixed");
    assert.ok(f, "expected a T13-mixed finding");
    return f.severity;
  };
  const head = `<meta charset="utf-8"><title>A sufficiently long page title here</title>`;
  assert.equal(
    sev(
      `<!doctype html><html lang="en"><head>${head}</head><body><h1>H</h1><img src="http://cdn.example.com/a.png" alt="a"></body></html>`,
      "https://example.com/img/",
    ),
    "P2",
  );
  assert.equal(
    sev(
      `<!doctype html><html lang="en"><head>${head}<script src="http://cdn.example.com/a.js"></script></head><body><h1>H</h1></body></html>`,
      "https://example.com/js/",
    ),
    "P1",
  );
  // Protocol-relative inherits https — not mixed. Plain-http pages are T01's job.
  assert.equal(
    sev(
      `<!doctype html><html lang="en"><head>${head}</head><body><h1>H</h1><img src="//cdn.example.com/a.png" alt="a"></body></html>`,
      "https://example.com/rel/",
    ),
    "pass",
  );
  assert.equal(
    sev(
      `<!doctype html><html lang="en"><head>${head}</head><body><h1>H</h1><img src="http://cdn.example.com/a.png" alt="a"></body></html>`,
      "http://example.com/plain/",
    ),
    "pass",
  );
});

test("O11 flags repeated generic anchors, O03-h1-drift flags title drift", () => {
  const schemaInfo = { items: [], types: [], issues: [], errors: [] };
  /** @param {string} html */
  const byId = (html) => {
    const findings = runChecks(
      parseHtml(html, "https://example.com/x/"),
      files(),
      fetched({ finalUrl: "https://example.com/x/" }),
      schemaInfo,
    );
    return new Map(findings.map((f) => [f.id, f.severity]));
  };
  const generic = byId(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A sufficiently long page title here</title></head><body><h1>H</h1><p><a href="/a">click here</a> <a href="/b">read more</a> <a href="/c">pricing plans</a></p></body></html>`,
  );
  assert.equal(generic.get("O11-generic-anchors"), "P3");
  const descriptive = byId(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A sufficiently long page title here</title></head><body><h1>H</h1><p><a href="/a">pricing plans</a> <a href="/b">read more about billing</a></p></body></html>`,
  );
  assert.equal(descriptive.get("O11-generic-anchors"), "pass");
  const drift = byId(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Acme Cloud Backup Plans For Small Business Teams</title></head><body><h1>Welcome to our website</h1></body></html>`,
  );
  assert.equal(drift.get("O03-h1-drift"), "P3");
  const aligned = byId(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Acme Cloud Backup Plans For Small Business Teams</title></head><body><h1>Acme cloud backup plans</h1></body></html>`,
  );
  assert.equal(aligned.get("O03-h1-drift"), "pass");
});

test("S03-faq-parity separates markup-only from copy-only FAQ", () => {
  /** @param {any[]} items */
  const schemaInfoFor = (items) => ({
    items,
    types: items.map(/** @param {any} n @returns {any} */ (n) => n["@type"]),
    issues: [],
    errors: [],
  });
  /** @param {string} html @param {any[]} items */
  const sev = (html, items) => {
    const findings = runChecks(
      parseHtml(html, "https://example.com/x/"),
      files(),
      fetched({ finalUrl: "https://example.com/x/" }),
      schemaInfoFor(items),
    );
    const f = findings.find((x) => x.id === "S03-faq-parity");
    assert.ok(f, "expected an S03-faq-parity finding");
    return f.severity;
  };
  const markupOnly = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A sufficiently long page title here</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}</script></head><body><h1>H</h1><p>Plain prose with no questions at all.</p></body></html>`;
  assert.equal(
    sev(markupOnly, [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [] }]),
    "P3",
  );
  const copyOnly = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A sufficiently long page title here</title></head><body><h1>H</h1><h2>FAQ</h2><p>How does it work? It works well.</p></body></html>`;
  assert.equal(sev(copyOnly, []), "P3");
  const both = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A sufficiently long page title here</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Q?","acceptedAnswer":{"@type":"Answer","text":"A."}}]}</script></head><body><h1>H</h1><h2>FAQ</h2><p>How does it work? It works well.</p></body></html>`;
  assert.equal(
    sev(both, [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{}] }]),
    "pass",
  );
});

test("every schema generator produces valid output", () => {
  for (const kind of [
    "organization",
    "website",
    "breadcrumb",
    "article",
    "faq",
    "product",
    "event",
    "localbusiness",
    "howto",
    "other",
  ]) {
    const node = generateSchema(kind, { name: "N", url: "https://example.com", description: "D" });
    assert.equal(node["@context"], "https://schema.org");
    assert.ok(typeof node["@type"] === "string");
    assert.ok(schemaSnippet(kind, { name: "N", url: "https://example.com" }).includes("application/ld+json"));
  }
});

test("checks: invalid URL, long-page H2s, payload size, hreflang arms", () => {
  const sf = {
    origin: "https://example.com",
    robots: { found: true },
    sitemap: { found: true },
    llms: { found: false },
  };
  const ok = {
    finalUrl: "https://example.com/x/",
    status: 200,
    statusChain: [{ url: "https://example.com/x/", status: 200 }],
    contentType: "text/html",
    ms: 1,
  };
  const empty = { items: [], types: [], issues: [], errors: [] };
  // Unparseable final URL short-circuits to a T02 P0.
  const badUrl = runChecks({}, sf, { finalUrl: "not a url", status: 0 }, empty);
  assert.equal(badUrl.length, 1);
  assert.equal(badUrl[0]?.id, "T02-status");
  assert.equal(badUrl[0]?.severity, "P0");
  // Long page without H2s, oversized HTML, hreflang present + broken.
  const page = runChecks(
    {
      h2s: [],
      wordCount: 700,
      htmlBytes: 400_000,
      hreflangs: [{ lang: "en", href: "https://example.com/en" }],
    },
    sf,
    ok,
    empty,
  );
  const byId = new Map(page.map((f) => [f.id, f.severity]));
  assert.equal(byId.get("O05-h2"), "P2");
  assert.equal(byId.get("P01-html-size"), "P2");
  assert.equal(byId.get("W03-hreflang"), "pass");
  const broken = runChecks({ hreflangs: [{ lang: "", href: "" }] }, sf, ok, empty);
  assert.equal(new Map(broken.map((f) => [f.id, f.severity])).get("W03-hreflang"), "P3");
});

test("schema validator flags each structural problem", () => {
  const v = validateSchema([
    { headline: "no context or type" },
    { "@context": "https://schema.org", "@type": "MadeUp" },
    { "@context": "https://schema.org", "@type": "Article" },
    { "@context": "https://schema.org", "@type": "FAQPage" },
    { "@context": "https://schema.org", "@type": "BreadcrumbList" },
    { "@context": "https://schema.org", "@type": ["Article", "BlogPosting"], headline: "ok" },
  ]);
  const issues = v.issues.map((i) => i.issue).join("|");
  assert.ok(issues.includes("missing @context"));
  assert.ok(issues.includes("missing @type"));
  assert.ok(issues.includes("unrecognized @type"));
  assert.ok(issues.includes("without headline"));
  assert.ok(issues.includes("without mainEntity"));
  assert.ok(issues.includes("without itemListElement"));
});

test("entity decoder drops invalid codepoints, keeps unknown entities", () => {
  const p = parseHtml("<html><body><p>A&#0;B&#x110000;C&unknown;D</p></body></html>", "https://example.com/");
  assert.ok(!p.visibleText.includes("&#0;"));
  assert.ok(p.visibleText.includes("&unknown;"));
});

test("garbage base URL degrades gracefully", () => {
  const p = parseHtml(
    '<html><head><link rel="canonical" href="/x"></head><body><a href="/y">y</a></body></html>',
    "::::",
  );
  assert.equal(p.canonical, "");
  assert.equal(p.internalLinkCount, 0);
});

test("connection refused surfaces a runtime error", async () => {
  const r = await fetchWithRedirects("http://127.0.0.1:1/unreachable", { timeoutMs: 3000 });
  assert.equal(r.ok, false);
  assert.ok(r.error.length > 0);
  assert.equal(r.html, "");
});

test("G09 blocks snippet-killing directives, allows the rest", () => {
  const schemaInfo = { items: [], types: [], issues: [], errors: [] };
  /** @param {string} robotsMeta @param {any} [headers] */
  const sev = (robotsMeta, headers = {}) => {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A sufficiently long page title here</title><meta name="robots" content="${robotsMeta}"></head><body><h1>H</h1></body></html>`;
    const findings = runChecks(
      parseHtml(html, "https://example.com/x/"),
      files(),
      fetched({ finalUrl: "https://example.com/x/", headers }),
      schemaInfo,
    );
    const f = findings.find((x) => x.id === "G09-snippet-controls");
    assert.ok(f, "expected a G09-snippet-controls finding");
    return f.severity;
  };
  assert.equal(sev("index, follow, nosnippet"), "P2");
  assert.equal(sev("index, follow, max-snippet:0"), "P2");
  assert.equal(sev("index, follow, max-snippet:120"), "pass");
  // Plain noindex (meta or header) belongs to T07 alone — G09 stays silent
  // to avoid piling on; it fires only for snippet-specific controls.
  assert.equal(sev("noindex, follow", {}), "pass");
  assert.equal(sev("index, follow", { "x-robots-tag": "noindex" }), "pass");
  assert.equal(sev("index, follow", { "x-robots-tag": "nosnippet" }), "P2");
  assert.equal(sev("index, follow", { "X-Robots-Tag": "max-snippet: 0" }), "P2");
  assert.equal(sev("index, follow", {}), "pass");
});

test("T14 counts third-party script hosts, T15 needs headers", () => {
  const schemaInfo = { items: [], types: [], issues: [], errors: [] };
  /** @param {string} scripts @param {any} [headers] */
  const byId = (scripts, headers) => {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A sufficiently long page title here</title>${scripts}</head><body><h1>H</h1></body></html>`;
    const fetchOver =
      headers === undefined
        ? { finalUrl: "https://example.com/x/" }
        : { finalUrl: "https://example.com/x/", headers };
    const findings = runChecks(
      parseHtml(html, "https://example.com/x/"),
      files(),
      fetched(fetchOver),
      schemaInfo,
    );
    return new Map(findings.map((f) => [f.id, f.severity]));
  };
  const sixHosts = ["a", "b", "c", "d", "e", "f"]
    .map((h) => `<script src="https://${h}.example.com/x.js"></script>`)
    .join("");
  assert.equal(byId(sixHosts).get("T14-third-party"), "P2");
  assert.equal(
    byId(`<script src="https://a.example.com/x.js"></script><script src="/local.js"></script>`).get(
      "T14-third-party",
    ),
    "pass",
  );
  const fullHeaders = {
    "content-security-policy": "default-src 'self'",
    "strict-transport-security": "max-age=31536000",
    "x-content-type-options": "nosniff",
  };
  assert.equal(byId("", fullHeaders).get("T15-security-headers"), "pass");
  const missing = byId("", { "strict-transport-security": "max-age=31536000" });
  assert.equal(missing.get("T15-security-headers"), "P3");
  // No headers captured at all (mocks, old reports) → check skipped, not fired.
  assert.ok(!byId("").has("T15-security-headers"), "T15 must skip when headers are unknown");
});

test("G06/G07/G08/C05 GEO and structure signals", () => {
  const schemaInfo = { items: [], types: [], issues: [], errors: [] };
  /** @param {string} html @param {any} [schema] */
  const byId = (html, schema = schemaInfo) => {
    const findings = runChecks(
      parseHtml(html, "https://example.com/x/"),
      files(),
      fetched({ finalUrl: "https://example.com/x/" }),
      schema,
    );
    return new Map(findings.map((f) => [f.id, f.severity]));
  };
  const head = `<meta charset="utf-8"><title>A sufficiently long page title here</title>`;
  // G06: schema dates pass; a dated "updated" note passes; nothing dates → P3.
  const dated = byId(
    `<!doctype html><html lang="en"><head>${head}</head><body><h1>H</h1><p>Updated March 3, 2026 with new figures.</p></body></html>`,
  );
  assert.equal(dated.get("G06-freshness"), "pass");
  const undated = byId(
    `<!doctype html><html lang="en"><head>${head}</head><body><h1>H</h1><p>Timeless prose with no dates anywhere.</p></body></html>`,
  );
  assert.equal(undated.get("G06-freshness"), "P3");
  // G07: 2/3 question H2s pass; 0/3 fail; fewer than 3 H2s exempt.
  const qHeads = byId(
    `<!doctype html><html lang="en"><head>${head}</head><body><h1>H</h1><h2>What is it?</h2><h2>How does it work?</h2><h2>Background</h2></body></html>`,
  );
  assert.equal(qHeads.get("G07-question-headings"), "pass");
  const flatHeads = byId(
    `<!doctype html><html lang="en"><head>${head}</head><body><h1>H</h1><h2>Overview</h2><h2>Details</h2><h2>Background</h2></body></html>`,
  );
  assert.equal(flatHeads.get("G07-question-headings"), "P3");
  const shortPage = byId(
    `<!doctype html><html lang="en"><head>${head}</head><body><h1>H</h1><h2>Overview</h2></body></html>`,
  );
  assert.ok(!shortPage.has("G07-question-headings"), "short pages are exempt from G07");
  // G08: metrics pass on long pages; short pages exempt.
  const measured = byId(
    `<!doctype html><html lang="en"><head>${head}</head><body><h1>H</h1><p>Costs $189, weighs 1.4 kg, and keeps 95% of testers happy.</p><p>${"word ".repeat(320)}</p></body></html>`,
  );
  assert.equal(measured.get("G08-stat-density"), "pass");
  const vague = byId(
    `<!doctype html><html lang="en"><head>${head}</head><body><h1>H</h1><p>Many people love it a lot and say great things.</p><p>${"word ".repeat(320)}</p></body></html>`,
  );
  assert.equal(vague.get("G08-stat-density"), "P3");
  // C05: th tables pass; th-less tables trip; no tables skip.
  const headed = byId(
    `<!doctype html><html lang="en"><head>${head}</head><body><h1>H</h1><table><tr><th>A</th></tr><tr><td>1</td></tr></table></body></html>`,
  );
  assert.equal(headed.get("C05-table-headers"), "pass");
  const headless = byId(
    `<!doctype html><html lang="en"><head>${head}</head><body><h1>H</h1><table><tr><td>1</td></tr></table></body></html>`,
  );
  assert.equal(headless.get("C05-table-headers"), "P3");
  const noTables = byId(
    `<!doctype html><html lang="en"><head>${head}</head><body><h1>H</h1><p>Text.</p></body></html>`,
  );
  assert.ok(!noTables.has("C05-table-headers"), "tables-free pages skip C05");
});

test("G02-ai-blocked names the blocked bot tokens", () => {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A sufficiently long page title here</title></head><body><h1>H</h1></body></html>`;
  const findings = runChecks(
    parseHtml(html, "https://example.com/x/"),
    files({
      robots: {
        found: true,
        status: 200,
        sitemaps: [],
        disallowCount: 1,
        aiBlocked: true,
        blockedBots: ["gptbot", "claudebot"],
        textSample: "",
      },
    }),
    fetched({ finalUrl: "https://example.com/x/" }),
    { items: [], types: [], issues: [], errors: [] },
  );
  const f = findings.find((x) => x.id === "G02-ai-blocked");
  assert.ok(f, "expected a G02-ai-blocked finding");
  assert.equal(f.severity, "P1");
  assert.match(f.evidence, /gptbot, claudebot/);
});
