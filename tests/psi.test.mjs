import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetchPsi, psiFindings, redactKey } from "../lib/psi.mjs";
import { generateSchema, validateSchema } from "../lib/schema.mjs";
import { buildReport, renderMarkdown, renderHtml } from "../lib/report.mjs";

/** @type {import("node:http").Server | null} */
let mockPsiServer = null;
/** @type {string} */
let mockPsiEndpoint = "";

const sampleGoodPsiResponse = {
  lighthouseResult: {
    categories: {
      performance: { score: 0.95 },
    },
    audits: {
      "largest-contentful-paint": { numericValue: 1200 },
      "cumulative-layout-shift": { numericValue: 0.02 },
      "first-contentful-paint": { numericValue: 800 },
      "total-blocking-time": { numericValue: 50 },
      "speed-index": { numericValue: 1100 },
      "server-response-time": { numericValue: 150 },
    },
  },
  loadingExperience: {
    overall_category: "FAST",
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 1400 },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 4 },
      INTERACTION_TO_NEXT_PAINT: { percentile: 90 },
      FIRST_CONTENTFUL_PAINT_MS: { percentile: 850 },
    },
  },
};

const sampleSlowPsiResponse = {
  lighthouseResult: {
    categories: {
      performance: { score: 0.42 },
    },
    audits: {
      "largest-contentful-paint": { numericValue: 4800 },
      "cumulative-layout-shift": { numericValue: 0.32 },
      "first-contentful-paint": { numericValue: 2400 },
      "total-blocking-time": { numericValue: 650 },
      "speed-index": { numericValue: 5200 },
      "server-response-time": { numericValue: 800 },
    },
  },
  loadingExperience: {
    overall_category: "SLOW",
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4500 },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 28 },
      INTERACTION_TO_NEXT_PAINT: { percentile: 550 },
      FIRST_CONTENTFUL_PAINT_MS: { percentile: 2600 },
    },
  },
};

before(
  () =>
    /** @type {Promise<void>} */ (
      new Promise((resolve) => {
        mockPsiServer = http.createServer((req, res) => {
          const u = new URL(req.url || "/", "http://127.0.0.1");
          if (u.pathname === "/rate-limited") {
            res.writeHead(429, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "Quota exceeded" } }));
          } else if (u.pathname === "/server-error") {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "Internal server error" } }));
          } else if (u.pathname === "/slow-page") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(sampleSlowPsiResponse));
          } else if (u.pathname === "/no-crux") {
            const noCrux = {
              lighthouseResult: sampleGoodPsiResponse.lighthouseResult,
              loadingExperience: { overall_category: "NONE" },
            };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(noCrux));
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(sampleGoodPsiResponse));
          }
        });
        mockPsiServer.listen(0, "127.0.0.1", () => {
          const addr = mockPsiServer?.address();
          mockPsiEndpoint = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/runPagespeed`;
          resolve();
        });
      })
    ),
);

after(
  () =>
    /** @type {Promise<void>} */ (
      new Promise((resolve) => {
        if (mockPsiServer) mockPsiServer.close(() => resolve());
        else resolve();
      })
    ),
);

test("fetchPsi retrieves and normalizes PageSpeed Insights metrics", async () => {
  const res = await fetchPsi("https://example.com/", {
    endpoint: mockPsiEndpoint,
    key: "mock-test-key-12345",
    strategy: "mobile",
  });

  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.ok(res.data);
  assert.equal(res.data.strategy, "mobile");
  assert.equal(res.data.lab.score, 95);
  assert.equal(res.data.lab.lcpMs, 1200);
  assert.equal(res.data.lab.cls, 0.02);
  assert.equal(res.data.lab.fcpMs, 800);
  assert.equal(res.data.lab.tbtMs, 50);
  assert.equal(res.data.lab.speedIndexMs, 1100);
  assert.equal(res.data.lab.ttfbMs, 150);

  assert.ok(res.data.field);
  assert.equal(res.data.field.overallCategory, "FAST");
  assert.equal(res.data.field.lcpMs, 1400);
  assert.equal(res.data.field.cls, 0.04);
  assert.equal(res.data.field.inpMs, 90);
  assert.equal(res.data.field.fcpMs, 850);
});

test("fetchPsi handles 429 rate limiting with graceful error", async () => {
  const u = new URL(mockPsiEndpoint);
  u.pathname = "/rate-limited";

  const res = await fetchPsi("https://example.com/", {
    endpoint: u.toString(),
    key: "mock-test-key-12345",
  });

  assert.equal(res.ok, false);
  assert.equal(res.status, 429);
  assert.match(res.error || "", /Rate limit exceeded/);
});

test("fetchPsi handles HTTP 500 error", async () => {
  const u = new URL(mockPsiEndpoint);
  u.pathname = "/server-error";

  const res = await fetchPsi("https://example.com/", {
    endpoint: u.toString(),
    key: "mock-test-key-12345",
  });

  assert.equal(res.ok, false);
  assert.equal(res.status, 500);
  assert.match(res.error || "", /Internal server error/);
});

test("fetchPsi handles invalid request URL", async () => {
  const res = await fetchPsi("https://example.com/", {
    endpoint: "not-a-valid-url://^&&",
  });
  assert.equal(res.ok, false);
  assert.match(res.error || "", /Invalid PSI request URL/);
});

test("fetchPsi handles no-CrUX response gracefully", async () => {
  const u = new URL(mockPsiEndpoint);
  u.pathname = "/no-crux";

  const res = await fetchPsi("https://example.com/", {
    endpoint: u.toString(),
    key: "mock-test-key-12345",
  });

  assert.equal(res.ok, true);
  assert.ok(res.data);
  assert.equal(res.data.field, null);
});

test("redactKey sanitizes API keys from URLs and strings", () => {
  const urlWithKey = "https://example.com/api?param=1&key=SECRETKEY987&other=2";
  const redacted = redactKey(urlWithKey);
  assert.ok(!redacted.includes("SECRETKEY987"));
  assert.ok(redacted.includes("key=[REDACTED]"));
  assert.equal(redactKey(""), "");
  assert.equal(redactKey(null), "");
});

test("psiFindings produces pass findings on fast lab and field data", async () => {
  const res = await fetchPsi("https://example.com/", {
    endpoint: mockPsiEndpoint,
    key: "mock-test-key-12345",
  });
  const findings = psiFindings(res);

  assert.equal(findings.length, 2);
  const lab = findings.find((f) => f.id === "P03-psi-lab");
  const field = findings.find((f) => f.id === "P04-psi-field");

  assert.ok(lab);
  assert.equal(lab.severity, "pass");
  assert.match(lab.title, /within thresholds/i);

  assert.ok(field);
  assert.equal(field.severity, "pass");
  assert.match(field.title, /pass/i);
});

test("psiFindings produces P1 findings on poor lab and field data", async () => {
  const u = new URL(mockPsiEndpoint);
  u.pathname = "/slow-page";

  const res = await fetchPsi("https://example.com/", {
    endpoint: u.toString(),
    key: "mock-test-key-12345",
  });
  const findings = psiFindings(res);

  assert.equal(findings.length, 2);
  const lab = findings.find((f) => f.id === "P03-psi-lab");
  const field = findings.find((f) => f.id === "P04-psi-field");

  assert.ok(lab);
  assert.equal(lab.severity, "P1");
  assert.match(lab.title, /Poor Core Web Vitals/i);

  assert.ok(field);
  assert.equal(field.severity, "P1");
  assert.match(field.title, /Poor real-user Core Web Vitals/i);
});

test("psiFindings handles intermediate P2 thresholds", () => {
  const p2Data = {
    ok: true,
    data: {
      url: "https://example.com/",
      strategy: /** @type {"mobile"} */ ("mobile"),
      checkedAt: new Date().toISOString(),
      lab: {
        score: 75,
        lcpMs: 2800,
        cls: 0.15,
        fcpMs: 1400,
        tbtMs: 220,
        speedIndexMs: 2600,
        ttfbMs: 300,
      },
      field: {
        overallCategory: "AVERAGE",
        lcpMs: 2700,
        cls: 0.12,
        inpMs: 220,
        fcpMs: 1300,
      },
    },
  };
  const findings = psiFindings(p2Data);
  const lab = findings.find((f) => f.id === "P03-psi-lab");
  const field = findings.find((f) => f.id === "P04-psi-field");

  assert.equal(lab?.severity, "P2");
  assert.equal(field?.severity, "P2");
});

test("psiFindings handles missing CrUX field data gracefully", async () => {
  const u = new URL(mockPsiEndpoint);
  u.pathname = "/no-crux";

  const res = await fetchPsi("https://example.com/", {
    endpoint: u.toString(),
    key: "mock-test-key-12345",
  });
  const findings = psiFindings(res);

  const field = findings.find((f) => f.id === "P04-psi-field");
  assert.ok(field);
  assert.equal(field.severity, "pass");
  assert.match(field.title, /No CrUX field data available/i);
});

test("psiFindings produces P05-psi-error on failed PSI queries", () => {
  const failedResult = {
    ok: false,
    error: "Connection refused",
  };
  const findings = psiFindings(failedResult);

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.id, "P05-psi-error");
  assert.equal(findings[0]?.severity, "P3");
  assert.match(findings[0]?.evidence || "", /Connection refused/);
});

test("extended schema generators produce valid Schema.org JSON-LD", () => {
  const kinds = ["video", "job", "course", "review", "recipe"];
  for (const kind of kinds) {
    const node = generateSchema(kind, {
      name: "Test Subject",
      url: "https://example.com/item",
      description: "Detailed description of the subject.",
    });
    assert.equal(node["@context"], "https://schema.org");
    assert.ok(typeof node["@type"] === "string");

    const validated = validateSchema([node]);
    assert.equal(validated.issues.length, 0, `Schema validation failed for ${kind}`);
  }
});

test("reports render Core Web Vitals section in Markdown and HTML", () => {
  const psiData = {
    url: "https://example.com/",
    strategy: "mobile",
    checkedAt: "2026-01-01T00:00:00Z",
    lab: {
      score: 92,
      lcpMs: 1600,
      cls: 0.03,
      fcpMs: 950,
      tbtMs: 40,
      speedIndexMs: 1400,
      ttfbMs: 120,
    },
    field: {
      overallCategory: "FAST",
      lcpMs: 1500,
      cls: 0.02,
      inpMs: 80,
      fcpMs: 900,
    },
  };

  const report = buildReport({
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    scores: {
      search: { score: 95, band: "A" },
      ai: { score: 90, band: "A" },
    },
    findings: [],
    parsed: { title: "Test", metaDescription: "Desc", htmlBytes: 1000 },
    siteFiles: {},
    meta: { version: "0.6.0" },
    psi: psiData,
  });

  assert.ok(report.page.psi);
  assert.equal(report.page.psi.lab.score, 92);

  const md = renderMarkdown(report);
  assert.ok(md.includes("Core Web Vitals (PageSpeed Insights)"));
  assert.ok(md.includes("Largest Contentful Paint (LCP)"));

  const html = renderHtml(report);
  assert.ok(html.includes("Core Web Vitals"));
  assert.ok(html.includes("Lab Performance Score: 92/100"));
});

test("fetchPsi handles malformed JSON responses cleanly", async () => {
  const badJsonServer = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("<html>Not JSON at all</html>");
  });
  await new Promise((resolve) => badJsonServer.listen(0, "127.0.0.1", () => resolve(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (badJsonServer.address())?.port;
  try {
    const res = await fetchPsi("https://example.com/", {
      endpoint: `http://127.0.0.1:${port}/runPagespeed`,
    });
    assert.equal(res.ok, false);
    assert.match(res.error || "", /JSON/i);
  } finally {
    badJsonServer.closeAllConnections?.();
    await new Promise((r) => badJsonServer.close(r));
  }
});

test("fetchPsi times out on stalled response bodies", async () => {
  const stallServer = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"lighthouseResult":');
    // Stalls and never sends the rest
  });
  await new Promise((resolve) => stallServer.listen(0, "127.0.0.1", () => resolve(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (stallServer.address())?.port;
  try {
    const started = Date.now();
    const res = await fetchPsi("https://example.com/", {
      endpoint: `http://127.0.0.1:${port}/runPagespeed`,
      timeoutMs: 500,
    });
    const elapsed = Date.now() - started;
    assert.equal(res.ok, false);
    assert.match(res.error || "", /timeout/);
    assert.ok(elapsed < 4000, `expected fast timeout, took ${elapsed}ms`);
  } finally {
    stallServer.closeAllConnections?.();
    await new Promise((r) => stallServer.close(r));
  }
});

test("fetchPsi enforces SSRF blocks on metadata and private IPs", async () => {
  const meta = await fetchPsi("https://example.com/", {
    endpoint: "http://169.254.169.254/latest/meta-data",
  });
  assert.equal(meta.ok, false);
  assert.match(meta.error || "", /cloud metadata/);

  const priv = await fetchPsi("https://example.com/", {
    endpoint: "http://127.0.0.1:8080/runPagespeed",
    blockPrivateIps: true,
  });
  assert.equal(priv.ok, false);
  assert.match(priv.error || "", /private\/internal network/);
});

test("psiFindings distinguishes missing metrics from 0 values and evaluates INP thresholds", () => {
  // Partial data with all lab metrics missing
  const partialData = {
    ok: true,
    data: {
      url: "https://example.com/",
      strategy: /** @type {"mobile"} */ ("mobile"),
      checkedAt: new Date().toISOString(),
      lab: {
        score: null,
        lcpMs: null,
        cls: null,
        fcpMs: null,
        tbtMs: null,
        speedIndexMs: null,
        ttfbMs: null,
      },
      field: null,
    },
  };
  const partialFindings = psiFindings(partialData);
  const lab = partialFindings.find((f) => f.id === "P03-psi-lab");
  assert.ok(lab);
  assert.equal(lab.severity, "P3");
  assert.match(lab.title, /lab metrics unavailable/i);

  // Field data with poor INP (>500ms)
  const poorInpData = {
    ok: true,
    data: {
      url: "https://example.com/",
      strategy: /** @type {"mobile"} */ ("mobile"),
      checkedAt: new Date().toISOString(),
      lab: {
        score: 95,
        lcpMs: 1200,
        cls: 0.02,
        fcpMs: 800,
        tbtMs: 50,
        speedIndexMs: 1100,
        ttfbMs: 150,
      },
      field: {
        overallCategory: "NONE",
        lcpMs: 1500,
        cls: 0.05,
        inpMs: 580, // Poor INP (>500ms)
        fcpMs: 1000,
      },
    },
  };
  const poorInpFindings = psiFindings(poorInpData);
  const field1 = poorInpFindings.find((f) => f.id === "P04-psi-field");
  assert.ok(field1);
  assert.equal(field1.severity, "P1");
  assert.match(field1.title, /Poor real-user Core Web Vitals/i);

  // Field data with INP needing improvement (>200ms)
  const avgInpData = {
    ok: true,
    data: {
      url: "https://example.com/",
      strategy: /** @type {"mobile"} */ ("mobile"),
      checkedAt: new Date().toISOString(),
      lab: poorInpData.data.lab,
      field: {
        overallCategory: "NONE",
        lcpMs: 1500,
        cls: 0.05,
        inpMs: 320, // Needs improvement (>200ms)
        fcpMs: 1000,
      },
    },
  };
  const avgInpFindings = psiFindings(avgInpData);
  const field2 = avgInpFindings.find((f) => f.id === "P04-psi-field");
  assert.ok(field2);
  assert.equal(field2.severity, "P2");
  assert.match(field2.title, /Real-user Core Web Vitals need improvement/i);
});

test("fetchPsi follows safe redirects and blocks dangerous redirect destinations", async () => {
  let redirectedKeyReceived = "";
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname === "/redirect-to-metadata") {
      res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data" });
      res.end();
      return;
    }
    if (url.pathname === "/redirect-to-private") {
      res.writeHead(302, { Location: "http://127.0.0.1:8080/private" });
      res.end();
      return;
    }
    if (url.pathname === "/redirect-safe") {
      res.writeHead(302, { Location: "/final-psi" + url.search });
      res.end();
      return;
    }
    if (url.pathname === "/final-psi") {
      redirectedKeyReceived = url.searchParams.get("key") || "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ lighthouseResult: { categories: { performance: { score: 0.95 } } } }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (server.address())?.port;

  try {
    // 1. Block redirect to metadata
    const metaRes = await fetchPsi("https://example.com/", {
      endpoint: `http://127.0.0.1:${port}/redirect-to-metadata`,
    });
    assert.equal(metaRes.ok, false);
    assert.match(metaRes.error || "", /metadata/i);

    // 2. Block redirect to private when blockPrivateIps is active
    const privRes = await fetchPsi("https://example.com/", {
      endpoint: `http://127.0.0.1:${port}/redirect-to-private`,
      blockPrivateIps: true,
    });
    assert.equal(privRes.ok, false);
    assert.match(privRes.error || "", /private\/internal|blocked/i);

    // 3. Follow safe relative redirect on same server and preserve key
    const safeRes = await fetchPsi("https://example.com/", {
      endpoint: `http://127.0.0.1:${port}/redirect-safe`,
      key: "secret-key-123",
    });
    assert.equal(safeRes.ok, true);
    assert.equal(safeRes.data?.lab?.score, 95);
    assert.equal(redirectedKeyReceived, "secret-key-123");
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});
