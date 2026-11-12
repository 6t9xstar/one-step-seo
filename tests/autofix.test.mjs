// SEO Auto-Fix engine: classification, fix plans, site-file fixes, recorded
// sessions with on-disk verification, history and rollback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyFinding,
  buildSitemapXml,
  buildRobotsTxt,
  buildFixPlan,
  renderFixPlanMarkdown,
  urlForFile,
  suggestAltText,
  planSiteFixes,
  planLocalFixes,
  applyFixSession,
  listFixSessions,
  rollbackFixSession,
} from "../lib/autofix.mjs";
import { collectHtmlFiles } from "../lib/crawl.mjs";
import { writeLocalSite } from "./helpers/site-fixture.mjs";

/** Fresh temp dir per test (never shared, removed by the test that made it). */
const tmp = () => mkdtempSync(join(tmpdir(), "oss-autofix-"));

test("classifyFinding: missing canonical is safe, a canonical pointing elsewhere needs approval", () => {
  const report = { finalUrl: "https://a.example/x", url: "https://a.example/x" };
  assert.equal(classifyFinding({ id: "T08-canonical", title: "Canonical missing" }, report).fixType, "safe");
  assert.equal(
    classifyFinding({ id: "T08-canonical", title: "Canonical points elsewhere" }, report).fixType,
    "approval",
  );
  assert.equal(
    classifyFinding({ id: "T07-noindex", title: "Page set to noindex" }, report).fixType,
    "approval",
  );
  assert.equal(classifyFinding({ id: "T01-https", title: "Not on HTTPS" }, report).fixType, "manual");
});

test("buildSitemapXml dedupes, sorts, escapes and drops non-http URLs", () => {
  const xml = buildSitemapXml([
    "https://a.example/b?x=1&y=2",
    "https://a.example/a",
    "https://a.example/a",
    "file:///etc/passwd",
  ]);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.equal((xml.match(/<loc>/g) ?? []).length, 2);
  assert.ok(xml.indexOf("/a</loc>") < xml.indexOf("/b?"));
  assert.match(xml, /x=1&amp;y=2/);
  assert.doesNotMatch(xml, /passwd/);
});

test("buildRobotsTxt never restricts crawling", () => {
  const txt = buildRobotsTxt("https://a.example/sitemap.xml");
  assert.match(txt, /User-agent: \*\nAllow: \//);
  assert.match(txt, /Sitemap: https:\/\/a\.example\/sitemap\.xml/);
  assert.doesNotMatch(txt, /Disallow/);
});

test("buildFixPlan: every entry is proposed + not-applied, and --safe-only filters", () => {
  const reports = [
    {
      url: "https://a.example/",
      finalUrl: "https://a.example/",
      site: { origin: "https://a.example", sitemap: false, robots: false },
      findings: [
        { id: "T08-canonical", severity: "P2", title: "Canonical missing", evidence: "", fix: "add it" },
        { id: "T07-noindex", severity: "P0", title: "Page set to noindex", evidence: "", fix: "remove" },
        { id: "T01-https", severity: "P0", title: "Not on HTTPS", evidence: "", fix: "tls" },
        { id: "O01-title", severity: "pass", title: "ok", evidence: "", fix: "" },
      ],
    },
  ];
  const plan = buildFixPlan(/** @type {any} */ (reports));
  assert.equal(plan.mode, "plan");
  assert.ok(plan.entries.every((e) => e.status === "proposed" && e.verification === "not-applied"));
  assert.ok(!plan.entries.some((e) => e.issueId === "O01-title"), "passing checks are not fix entries");
  const ids = plan.entries.map((e) => e.issueId);
  assert.ok(ids.includes("T06-sitemap") && ids.includes("T05-robots"));
  const sitemap = plan.entries.find((e) => e.issueId === "T06-sitemap");
  assert.match(sitemap?.proposedChange ?? "", /<loc>https:\/\/a\.example\/<\/loc>/);
  assert.equal(plan.summary.total, plan.entries.length);

  const safe = buildFixPlan(/** @type {any} */ (reports), null, { safeOnly: true });
  assert.ok(safe.entries.length > 0);
  assert.ok(safe.entries.every((e) => e.fixType === "safe"));
  assert.ok(
    !safe.entries.some((e) => e.issueId === "T07-noindex"),
    "risky fixes never appear in a safe-only plan",
  );

  const md = renderFixPlanMarkdown(plan);
  assert.match(md, /proposed/i);
});

test("urlForFile maps files to pretty site URLs", () => {
  const root = join(tmpdir(), "site-root");
  assert.equal(urlForFile("https://a.example", root, join(root, "index.html")), "https://a.example/");
  assert.equal(
    urlForFile("https://a.example/", root, join(root, "blog", "index.html")),
    "https://a.example/blog/",
  );
  assert.equal(
    urlForFile("https://a.example", root, join(root, "about.html")),
    "https://a.example/about.html",
  );
  assert.equal(urlForFile("not a url", root, join(root, "about.html")), "");
});

test("suggestAltText proposes filename-based text only for images without alt", () => {
  const s = suggestAltText([
    { src: "img/team-photo_2024.jpg", hasAlt: false },
    { src: "logo.svg", hasAlt: true },
    { src: "IMG_1234.JPG", hasAlt: false },
  ]);
  assert.equal(s.length >= 1, true);
  assert.equal(s[0]?.src, "img/team-photo_2024.jpg");
  assert.match(s[0]?.suggestedAlt ?? "", /team photo/i);
  assert.ok(!s.some((x) => x.src === "logo.svg"));
});

test("planSiteFixes: creates files when missing, appends without removing when present", () => {
  const dir = tmp();
  try {
    writeLocalSite(dir);
    const files = collectHtmlFiles(dir);
    const fresh = planSiteFixes(dir, files, { baseUrl: "https://a.example" });
    const sm = fresh.planned.find((p) => p.name === "sitemap");
    assert.ok(sm?.created);
    assert.match(sm?.content ?? "", /https:\/\/a\.example\/about\.html/);
    assert.doesNotMatch(sm?.content ?? "", /blog/, "noindex pages are not added to the sitemap");

    // Existing sitemap with a URL the tool did not find: kept; missing pages appended.
    writeFileSync(
      join(dir, "sitemap.xml"),
      `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://a.example/legacy</loc></url></urlset>`,
    );
    writeFileSync(join(dir, "robots.txt"), "User-agent: *\nDisallow: /private\n");
    const existing = planSiteFixes(dir, files, { baseUrl: "https://a.example" });
    const sm2 = existing.planned.find((p) => p.name === "sitemap");
    assert.equal(sm2?.created, false);
    assert.match(sm2?.content ?? "", /legacy/);
    assert.match(sm2?.content ?? "", /about\.html/);
    const rb = existing.planned.find((p) => p.name === "robots");
    assert.match(rb?.content ?? "", /Disallow: \/private/, "crawl rules are untouched");
    assert.match(rb?.content ?? "", /Sitemap: https:\/\/a\.example\/sitemap\.xml/);

    const noUrl = planSiteFixes(dir, files, {});
    assert.ok(!noUrl.planned.some((p) => p.name === "sitemap" && p.created));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("planLocalFixes gives each page of a directory its own canonical URL", () => {
  const dir = tmp();
  try {
    writeLocalSite(dir);
    const plan = planLocalFixes(dir, { isDirectory: true, url: "https://a.example", lang: "en" });
    const canonicals = plan.pages
      .map((p) => /rel="canonical" href="([^"]+)"/.exec(p.plan?.newHtml ?? "")?.[1])
      .filter(Boolean)
      .sort();
    assert.deepEqual(canonicals, [
      "https://a.example/",
      "https://a.example/about.html",
      "https://a.example/blog/",
    ]);
    // Pure: nothing written.
    assert.equal(existsSync(join(dir, "sitemap.xml")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyFixSession backs up, verifies on disk, records history; rollback restores", () => {
  const dir = tmp();
  const state = tmp();
  try {
    writeLocalSite(dir);
    const plan = planLocalFixes(dir, { isDirectory: true, url: "https://a.example", lang: "en" });
    const originals = Object.fromEntries(plan.pages.map((p) => [p.file, p.html]));
    const changes = [
      ...plan.pages
        .filter((p) => p.plan?.changed)
        .map((p) => ({
          file: p.file,
          content: p.plan?.newHtml ?? "",
          fixes: (p.plan?.planned ?? []).map((x) => x.name),
        })),
      ...plan.site.planned.map((s) => ({
        file: s.file,
        content: s.content,
        created: s.created,
        fixes: [s.name],
      })),
    ];
    assert.ok(changes.length >= 4);
    const { session, errors } = applyFixSession({ stateDir: state, target: dir, siteRoot: dir, changes });
    assert.deepEqual(errors, []);
    assert.ok(session);
    assert.equal(session.status, "applied");
    for (const f of session.files) {
      assert.ok(
        f.verified.every((v) => v.cleared),
        `${f.path} verified on disk`,
      );
      assert.match(f.afterSha, /^[0-9a-f]{64}$/);
    }
    const home = session.files.find((f) => f.path === join(dir, "index.html"));
    assert.ok(home?.searchScore && home.searchScore.after > home.searchScore.before);
    assert.ok(home?.resolvedFindings.includes("T08-canonical"));
    assert.ok(existsSync(join(dir, "sitemap.xml")));

    assert.equal(listFixSessions(state).length, 1);

    // A file edited after the fix blocks rollback (its later edits would be lost)...
    const about = join(dir, "about.html");
    const fixedAbout = readFileSync(about, "utf8");
    writeFileSync(about, `${fixedAbout}<!-- later edit -->`);
    const refused = rollbackFixSession(state);
    assert.equal(refused.ok, false);
    assert.deepEqual(refused.conflicts, [about]);
    assert.equal(existsSync(join(dir, "sitemap.xml")), true, "nothing restored on refusal");

    // ...unless forced.
    const done = rollbackFixSession(state, session.id, { force: true });
    assert.equal(done.ok, true);
    for (const [file, html] of Object.entries(originals)) assert.equal(readFileSync(file, "utf8"), html);
    assert.equal(existsSync(join(dir, "sitemap.xml")), false, "files created by the fix are removed");
    assert.equal(listFixSessions(state)[0]?.status, "rolled-back");

    const again = rollbackFixSession(state, session.id);
    assert.equal(again.ok, false);
    assert.match(again.error ?? "", /already rolled back/);
    assert.equal(rollbackFixSession(state, "nope").ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  }
});
