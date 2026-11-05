import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtml } from "../lib/html.mjs";
import { runChecks } from "../lib/checks.mjs";
import { extractJsonLd } from "../lib/schema.mjs";
import { geoDetails, computeScores } from "../lib/score.mjs";
import {
  buildReport,
  renderHtml,
  renderMarkdown,
  renderCsv,
  esc,
  escCsv,
  safeSarifUri,
} from "../lib/report.mjs";
import {
  fetchWithRedirects,
  fetchText,
  isBlockedMetadataEndpoint,
  isPrivateOrLoopbackHost,
  isPrivateOrReservedIpv4,
  ipv4ToUint32,
  assertSafeDns,
  validateTargetUrl,
} from "../lib/fetch.mjs";

function siteFilesMock() {
  return {
    origin: "https://example.com",
    robots: { found: true, status: 200, sitemaps: [], disallowCount: 1, aiBlocked: false, textSample: "" },
    sitemap: {
      found: true,
      status: 200,
      url: "https://example.com/sitemap.xml",
      urlCount: 1,
      fromRobots: [],
    },
    llms: { found: false, status: 404, bytes: 0 },
  };
}

function fetchMock() {
  return {
    finalUrl: "https://example.com/",
    status: 200,
    statusChain: [{ url: "https://example.com/", status: 200 }],
    contentType: "text/html",
    ms: 5,
  };
}

const EVIL_INNER = `A reasonably long title <script>alert("xss")</script> padded to exceed sixty characters total`;
const EVIL_BODY = `<h1>Heading</h1><p><img src=x onerror=alert(1)>Hello &copy; 2026 &#x41;BC</p><script>alert("body")</script>`;

test("hostile page content is escaped in HTML reports", () => {
  const parsed = parseHtml(
    `<html><head><title>${EVIL_INNER}</title><meta name="description" content="Plain description here."></head><body>${EVIL_BODY}</body></html>`,
    "https://example.com/",
  );
  const findings = runChecks(parsed, siteFilesMock(), fetchMock(), {
    items: [],
    types: [],
    issues: [],
    errors: [],
  });
  const scores = computeScores(findings, geoDetails(parsed, siteFilesMock()));
  const report = buildReport({
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    scores,
    findings,
    parsed,
    siteFiles: siteFilesMock(),
    meta: { version: "0.0.0-test" },
  });
  const html = renderHtml(report);
  const md = renderMarkdown(report);
  assert.ok(!html.includes("<script>alert"), "raw script must not appear in HTML report");
  assert.ok(!html.includes("<svg onload"), "raw event handler must not appear");
  assert.ok(html.includes("&lt;script&gt;"), "escaped script must appear");
  assert.ok(md.includes("one-step-seo report"));
});

test("esc handles all dangerous characters", () => {
  assert.equal(esc(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;'");
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
});

test("entities decode for word counting", () => {
  const p = parseHtml(
    "<html><body><p>Hello &copy; 2026 &#x41;BC &unknown;</p></body></html>",
    "https://example.com/",
  );
  assert.ok(p.visibleText.includes("(c)"));
  assert.ok(p.visibleText.includes("ABC"));
});

test("invalid JSON-LD is reported, not thrown", () => {
  const { items, errors } = extractJsonLd(["{not json", "", '{"@type":"Article"}']);
  assert.equal(items.length, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /invalid JSON-LD/);
});

test("score bands hit every grade boundary", () => {
  /** @param {number[]} deductions @returns {number} */
  const scoreFor = (deductions) => {
    /** @type {Record<number, string>} */
    const sev = { 25: "P0", 10: "P1", 3: "P2", 1: "P3" };
    const findings = deductions.map((d, i) => ({
      id: `T${i}-x`,
      category: "technical",
      severity: sev[d] ?? "P2",
    }));
    return computeScores(findings, { score: 100 }).search.score;
  };
  assert.equal(computeScores([], { score: 100 }).search.band, "A");
  assert.equal(scoreFor([10]), 90);
  assert.equal(scoreFor([10, 3]), 87);
  const b = computeScores(
    [
      { id: "a", category: "t", severity: "P1" },
      { id: "b", category: "t", severity: "P2" },
    ],
    { score: 0 },
  );
  assert.equal(b.search.score, 87);
  assert.equal(b.search.band, "B");
  assert.equal(scoreFor([25]), 75);
  const d = computeScores(
    [
      { id: "a", category: "t", severity: "P1" },
      { id: "b", category: "t", severity: "P1" },
      { id: "c", category: "t", severity: "P1" },
      { id: "d", category: "t", severity: "P2" },
    ],
    { score: 0 },
  );
  assert.equal(d.search.score, 67);
  assert.equal(d.search.band, "D");
  assert.equal(scoreFor([25, 25]), 50);
});

test("GEO-only findings do not move the Search score", () => {
  const onlyGeo = [
    { id: "G01-llms", category: "geo", severity: "P2" },
    { id: "G02-ai-blocked", category: "geo", severity: "P1" },
  ];
  assert.equal(computeScores(onlyGeo, { score: 0 }).search.score, 100);
});

test("perfect GEO signals score 100", () => {
  const parsed = parseHtml(
    `<html lang="en"><head><title>What is X? A reasonably long and descriptive title here</title><meta name="description" content="A full-length meta description that comfortably exceeds one hundred and twenty characters for testing."></head><body><h1>What is X?</h1><p>What is X? X is a direct answer in forty to sixty words that explains the topic clearly and concisely for both humans and machines alike right now.</p><h2>Details</h2><table><tr><td>a</td></tr></table><ul><li>b</li></ul><h2>FAQ</h2><p>How does it work? It works.</p><p>${"word ".repeat(320)}</p></body></html>`,
    "https://example.com/",
  );
  const geo = geoDetails(parsed, {
    llms: { found: true },
    robots: { aiBlocked: false },
  });
  assert.equal(geo.score, 100);
});

test("isBlockedMetadataEndpoint blocks cloud metadata endpoints (SSRF)", () => {
  assert.equal(isBlockedMetadataEndpoint("http://169.254.169.254/latest/meta-data"), true);
  assert.equal(isBlockedMetadataEndpoint("http://metadata.google.internal/computeMetadata/v1/"), true);
  assert.equal(isBlockedMetadataEndpoint("http://metadata.internal/"), true);
  assert.equal(isBlockedMetadataEndpoint("http://100.100.100.200/latest/meta-data/"), true);
  assert.equal(isBlockedMetadataEndpoint("http://192.0.0.192/latest/meta-data/"), true);
  assert.equal(isBlockedMetadataEndpoint("http://instance-data/"), true);
  assert.equal(isBlockedMetadataEndpoint("http://[fd00:ec2::254]/latest/meta-data"), true);
  assert.equal(isBlockedMetadataEndpoint("http://[::ffff:169.254.169.254]/latest/"), true);
  assert.equal(isBlockedMetadataEndpoint("http://[::ffff:a9fe:a9fe]/latest/"), true);
  assert.equal(isBlockedMetadataEndpoint("http://[::ffff:192.0.0.192]/latest/"), true);
  assert.equal(isBlockedMetadataEndpoint("http://[::ffff:100.100.100.200]/latest/"), true);
  assert.equal(isBlockedMetadataEndpoint("http://[fe80::1]/"), true);
  assert.equal(isBlockedMetadataEndpoint("https://example.com/"), false);
  assert.equal(isBlockedMetadataEndpoint("http://127.0.0.1:3000/"), false);
});

test("isPrivateOrLoopbackHost correctly classifies private/internal and public hosts", () => {
  assert.equal(isPrivateOrLoopbackHost("localhost"), true);
  assert.equal(isPrivateOrLoopbackHost("sub.localhost"), true);
  assert.equal(isPrivateOrLoopbackHost("127.0.0.1"), true);
  assert.equal(isPrivateOrLoopbackHost("127.1.2.3"), true);
  assert.equal(isPrivateOrLoopbackHost("10.0.0.1"), true);
  assert.equal(isPrivateOrLoopbackHost("172.16.0.1"), true);
  assert.equal(isPrivateOrLoopbackHost("172.31.255.255"), true);
  assert.equal(isPrivateOrLoopbackHost("192.168.1.1"), true);
  assert.equal(isPrivateOrLoopbackHost("169.254.1.1"), true);
  assert.equal(isPrivateOrLoopbackHost("0.0.0.0"), true);
  assert.equal(isPrivateOrLoopbackHost("[::1]"), true);
  assert.equal(isPrivateOrLoopbackHost("[fe80::1]"), true);
  assert.equal(isPrivateOrLoopbackHost("[fc00::1]"), true);
  assert.equal(isPrivateOrLoopbackHost("[fd00::1]"), true);
  assert.equal(isPrivateOrLoopbackHost("[::ffff:7f00:1]"), true);
  assert.equal(isPrivateOrLoopbackHost("example.com"), false);
  assert.equal(isPrivateOrLoopbackHost("8.8.8.8"), false);
});

test("fetchWithRedirects rejects private/loopback when blockPrivateIps is set", async () => {
  const r = await fetchWithRedirects("http://127.0.0.1:3000/test", { blockPrivateIps: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /private\/internal network address/);
});

test("fetchText rejects private/loopback when blockPrivateIps is set", async () => {
  const r = await fetchText("http://127.0.0.1:3000/robots.txt", { blockPrivateIps: true });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /private\/internal network address/);
});

test("fetchWithRedirects rejects cloud metadata endpoints", async () => {
  const r = await fetchWithRedirects("http://169.254.169.254/latest/meta-data");
  assert.equal(r.ok, false);
  assert.match(r.error, /cloud metadata endpoint \(SSRF protection\)/);
});

test("fetchText rejects cloud metadata endpoints", async () => {
  const r = await fetchText("http://169.254.169.254/latest/meta-data");
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /cloud metadata endpoint \(SSRF protection\)/);
});

test("renderCsv produces valid RFC 4180 CSV with escaped fields", () => {
  const r = {
    findings: [
      {
        severity: "P1",
        id: "T01-https",
        category: "technical",
        title: "Not on HTTPS, insecure",
        evidence: 'Found "http://" link',
        fix: "Switch to https://.",
        seoImpact: "high",
        geoImpact: "medium",
      },
    ],
  };
  const csv = renderCsv(r);
  assert.ok(csv.includes("Severity,Check ID,Category,Title,Evidence,Fix,SEO Impact,GEO Impact"));
  assert.ok(csv.includes('"Not on HTTPS, insecure"'));
  assert.ok(csv.includes('"Found ""http://"" link"'));
});

test("isPrivateOrReservedIpv4 and isPrivateOrLoopbackHost cover all RFC-reserved ranges", () => {
  assert.equal(ipv4ToUint32("127.0.0.1"), 0x7f000001);
  assert.equal(ipv4ToUint32("invalid"), null);
  assert.equal(isPrivateOrReservedIpv4(0x7f000001), true);
  assert.equal(isPrivateOrReservedIpv4(0x08080808), false);

  // 0.0.0.0/8
  assert.equal(isPrivateOrLoopbackHost("0.0.0.1"), true);
  // 10.0.0.0/8
  assert.equal(isPrivateOrLoopbackHost("10.254.254.254"), true);
  // 100.64.0.0/10 (CGNAT / Alibaba metadata 100.100.100.200)
  assert.equal(isPrivateOrLoopbackHost("100.64.0.1"), true);
  assert.equal(isPrivateOrLoopbackHost("100.100.100.200"), true);
  assert.equal(isPrivateOrLoopbackHost("100.128.0.1"), false);
  // 127.0.0.0/8
  assert.equal(isPrivateOrLoopbackHost("127.0.0.1"), true);
  assert.equal(isPrivateOrLoopbackHost("127.255.255.255"), true);
  // 169.254.0.0/16
  assert.equal(isPrivateOrLoopbackHost("169.254.169.254"), true);
  // 172.16.0.0/12
  assert.equal(isPrivateOrLoopbackHost("172.16.0.1"), true);
  assert.equal(isPrivateOrLoopbackHost("172.31.255.255"), true);
  assert.equal(isPrivateOrLoopbackHost("172.32.0.1"), false);
  // 192.0.0.0/24 (Oracle Cloud 192.0.0.192)
  assert.equal(isPrivateOrLoopbackHost("192.0.0.192"), true);
  // 192.0.2.0/24 (TEST-NET-1)
  assert.equal(isPrivateOrLoopbackHost("192.0.2.1"), true);
  // 192.88.99.0/24 (6to4 Relay)
  assert.equal(isPrivateOrLoopbackHost("192.88.99.1"), true);
  // 192.168.0.0/16
  assert.equal(isPrivateOrLoopbackHost("192.168.0.1"), true);
  // 198.18.0.0/15 (Benchmarking)
  assert.equal(isPrivateOrLoopbackHost("198.18.0.1"), true);
  assert.equal(isPrivateOrLoopbackHost("198.19.255.255"), true);
  assert.equal(isPrivateOrLoopbackHost("198.20.0.1"), false);
  // 198.51.100.0/24 (TEST-NET-2)
  assert.equal(isPrivateOrLoopbackHost("198.51.100.1"), true);
  // 203.0.113.0/24 (TEST-NET-3)
  assert.equal(isPrivateOrLoopbackHost("203.0.113.1"), true);
  // 224.0.0.0/4 (Multicast)
  assert.equal(isPrivateOrLoopbackHost("224.0.0.1"), true);
  // 240.0.0.0/4 (Reserved / Broadcast)
  assert.equal(isPrivateOrLoopbackHost("240.0.0.1"), true);
  assert.equal(isPrivateOrLoopbackHost("255.255.255.255"), true);
  // Public IPs
  assert.equal(isPrivateOrLoopbackHost("1.1.1.1"), false);
  assert.equal(isPrivateOrLoopbackHost("8.8.8.8"), false);
  assert.equal(isPrivateOrLoopbackHost("93.184.216.34"), false);
  // IPv6
  assert.equal(isPrivateOrLoopbackHost("[ff02::1]"), true);
  assert.equal(isPrivateOrLoopbackHost("[2001:db8::1]"), true);
  assert.equal(isPrivateOrLoopbackHost("[100::1]"), true);
  assert.equal(isPrivateOrLoopbackHost("[2002::1]"), true);
  // Hostnames
  assert.equal(isPrivateOrLoopbackHost("app.local"), true);
  assert.equal(isPrivateOrLoopbackHost("db.internal"), true);
  assert.equal(isPrivateOrLoopbackHost("router.lan"), true);
  assert.equal(isPrivateOrLoopbackHost("nas.home"), true);
  assert.equal(isPrivateOrLoopbackHost("server.corp"), true);
});

test("escCsv neutralizes formula injection triggers (=, +, -, @, tab, cr)", () => {
  // Direct triggers
  assert.equal(escCsv("=SUM(A1:A10)"), `"'=SUM(A1:A10)"`);
  assert.equal(escCsv("+12345"), `"'+12345"`);
  assert.equal(escCsv("-5+2"), `"'-5+2"`);
  assert.equal(escCsv("@SUM(1,2)"), `"'@SUM(1,2)"`);
  assert.equal(escCsv("\tcmd"), `"'\tcmd"`);
  assert.equal(escCsv("\rcmd"), `"' cmd"`);

  // Leading whitespace before formula trigger
  assert.equal(escCsv("   =1+1"), `"'   =1+1"`);
  assert.equal(escCsv(" \t @alert"), `"' \t @alert"`);

  // Safe strings without triggers
  assert.equal(escCsv("Normal text"), "Normal text");
  assert.equal(escCsv("Text with comma, here"), `"Text with comma, here"`);
  assert.equal(escCsv('Text with "quotes"'), `"Text with ""quotes"""`);

  // Multiline sanitized
  assert.equal(escCsv("Line 1\nLine 2"), "Line 1 Line 2");
  assert.equal(escCsv("=Formula\nLine 2"), `"'=Formula Line 2"`);

  // Unicode text
  assert.equal(escCsv("Заголовок страницы"), "Заголовок страницы");
  assert.equal(escCsv("=Заголовок"), `"'=Заголовок"`);
});

test("safeSarifUri handles URLs, paths, and fallbacks", () => {
  assert.equal(safeSarifUri("https://example.com/audit"), "https://example.com/audit");
  assert.equal(safeSarifUri("http://127.0.0.1:3000/page"), "http://127.0.0.1:3000/page");
  assert.ok(safeSarifUri("C:\\temp\\file.html").startsWith("file:///"));
  assert.equal(safeSarifUri(""), "file:///unknown");
  assert.equal(safeSarifUri(null), "file:///unknown");
});

test("assertSafeDns detects loopback and validates DNS safety", async () => {
  const direct = await assertSafeDns("127.0.0.1");
  assert.equal(direct.safe, false);
  assert.match(direct.error ?? "", /blocked IP address/);

  const pubDirect = await assertSafeDns("8.8.8.8");
  assert.equal(pubDirect.safe, true);
});

test("validateTargetUrl checks schemes, metadata, and private IP blocks", async () => {
  const badScheme = await validateTargetUrl("ftp://example.com/");
  assert.equal(badScheme.ok, false);
  assert.match(badScheme.error ?? "", /blocked protocol/);

  const meta = await validateTargetUrl("http://169.254.169.254/latest/meta-data");
  assert.equal(meta.ok, false);
  assert.match(meta.error ?? "", /cloud metadata/);

  const priv = await validateTargetUrl("http://192.168.1.1/", { blockPrivateIps: true });
  assert.equal(priv.ok, false);
  assert.match(priv.error ?? "", /private\/internal network/);

  const good = await validateTargetUrl("https://example.com/");
  assert.equal(good.ok, true);
});
