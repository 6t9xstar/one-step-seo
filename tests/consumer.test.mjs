import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {string} args
 * @param {Record<string, unknown>} [opts]
 */
function runNpm(args, opts = {}) {
  const isWin = process.platform === "win32";
  const cmd = isWin ? `npm.cmd ${args}` : `npm ${args}`;
  return execSync(cmd, {
    shell: isWin ? process.env.ComSpec || "cmd.exe" : "/bin/sh",
    stdio: "pipe",
    ...opts,
  });
}

test(
  "consumer: packed tarball installs and executes in clean ESM + TypeScript project",
  { timeout: 60000 },
  () => {
    const packDir = mkdtempSync(join(tmpdir(), "oss-pack-"));
    const consumerDir = mkdtempSync(join(tmpdir(), "oss-consumer-"));

    try {
      // 1. Pack the repository
      runNpm(`pack --pack-destination "${packDir}"`, { cwd: ROOT });

      const tarballs = readdirSync(packDir).filter((f) => f.endsWith(".tgz"));
      assert.equal(tarballs.length, 1, "Expected exactly one .tgz tarball generated");
      const firstTarball = tarballs[0];
      assert.ok(firstTarball, "Tarball must exist");
      const tarballPath = join(packDir, firstTarball);

      // 2. Initialise consumer package.json
      writeFileSync(
        join(consumerDir, "package.json"),
        JSON.stringify(
          {
            name: "seo-consumer-app",
            version: "1.0.0",
            type: "module",
          },
          null,
          2,
        ),
      );

      // 3. Install packed tarball
      runNpm(`install --no-audit --no-fund "${tarballPath}"`, { cwd: consumerDir });

      // Verify node_modules installation exists
      const installedPkgJson = join(consumerDir, "node_modules", "one-step-seo", "package.json");
      assert.ok(existsSync(installedPkgJson), "Package must be installed in node_modules");

      // 4. Test ESM root import and subpath imports
      const esmTestScript = `
      import assert from 'node:assert/strict';
      import * as root from 'one-step-seo';
      import * as checks from 'one-step-seo/checks';
      import * as report from 'one-step-seo/report';
      import * as schema from 'one-step-seo/schema';
      import * as skills from 'one-step-seo/skills';
      import * as robots from 'one-step-seo/robots';
      import * as crawl from 'one-step-seo/crawl';
      import * as intelligence from 'one-step-seo/intelligence';
      import * as autofix from 'one-step-seo/autofix';
      import * as monitor from 'one-step-seo/monitor';
      import * as pdf from 'one-step-seo/pdf';

      // Verify root API
      assert.equal(typeof root.buildReport, 'function', 'buildReport must be a function');
      assert.equal(typeof root.renderHtml, 'function', 'renderHtml must be a function');
      assert.equal(typeof root.renderMarkdown, 'function', 'renderMarkdown must be a function');
      assert.equal(typeof root.renderSiteIndex, 'function', 'renderSiteIndex must be a function');
      assert.equal(typeof root.buildSiteReport, 'function', 'buildSiteReport must be a function');
      assert.equal(typeof root.runChecks, 'function', 'runChecks must be a function');
      assert.equal(typeof root.computeScores, 'function', 'computeScores must be a function');
      assert.equal(typeof root.extractJsonLd, 'function', 'extractJsonLd must be a function');
      assert.equal(typeof root.validateSchema, 'function', 'validateSchema must be a function');
      assert.equal(typeof root.parseRobots, 'function', 'parseRobots must be a function');
      assert.equal(typeof root.getSiteFiles, 'function', 'getSiteFiles must be a function');
      assert.equal(typeof root.getSitemapUrls, 'function', 'getSitemapUrls must be a function');

      // Verify subpaths
      assert.ok(checks.THRESHOLDS && typeof checks.THRESHOLDS === 'object', 'checks.THRESHOLDS must exist');
      assert.ok(checks.PROFILES && typeof checks.PROFILES === 'object', 'checks.PROFILES must exist');
      assert.equal(typeof checks.runChecks, 'function', 'checks.runChecks must be a function');
      assert.equal(typeof report.renderHtml, 'function', 'report.renderHtml must exist');
      assert.equal(typeof schema.validateSchema, 'function', 'schema.validateSchema must exist');
      assert.ok(Array.isArray(skills.AGENT_SKILLS), 'skills.AGENT_SKILLS must be an array');
      assert.equal(typeof robots.parseRobots, 'function', 'robots.parseRobots must exist');
      assert.equal(typeof crawl.crawlSite, 'function', 'crawl.crawlSite must exist');
      assert.equal(typeof intelligence.analyzeSite, 'function', 'intelligence.analyzeSite must exist');
      assert.equal(typeof autofix.buildFixPlan, 'function', 'autofix.buildFixPlan must exist');
      assert.equal(typeof monitor.compareSnapshots, 'function', 'monitor.compareSnapshots must exist');
      assert.equal(typeof root.applyFixSession, 'function', 'root.applyFixSession must exist');
      assert.equal(String.fromCharCode(...pdf.renderPdf([{ text: 'x' }]).subarray(0, 5)), '%PDF-', 'pdf.renderPdf must produce a PDF');

      // Run end-to-end programmatic audit
      const pageData = {
        title: 'Consumer Programmatic Test Page',
        description: 'A test page validating consumer imports for one-step-seo.',
        h1: ['Consumer Programmatic Test Page'],
        h2: ['Feature Overview', 'API Integration'],
        canonical: 'https://consumer.example.com/',
        robotsMeta: 'index, follow',
        links: [{ href: 'https://consumer.example.com/api', text: 'API Docs', rel: '', isInternal: true }],
        images: [{ src: '/logo.png', alt: 'Consumer Logo', loading: 'lazy' }],
        scripts: [],
        wordCount: 350,
        text: 'This is body content for consumer integration testing.',
        headings: [{ level: 1, text: 'Consumer Programmatic Test Page' }],
        hasViewport: true,
        hasCharset: true,
        hasFavicon: true,
        ogTitle: 'Consumer Programmatic Test Page',
        ogDescription: 'A test page validating consumer imports.',
        ogImage: 'https://consumer.example.com/og.png',
        twitterCard: 'summary_large_image',
        schemaOrg: [],
        author: 'Engineering Team',
        hasMain: true,
        lang: 'en',
      };

      const siteFiles = {
        robots: 'User-agent: *\\nAllow: /\\n',
        sitemap: '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://consumer.example.com/</loc></url></urlset>',
        llms: '# LLMs.txt\\n> API documentation\\n',
        aiBlocked: false,
      };

      const findings = root.runChecks(pageData, siteFiles, { profile: 'standard' });
      assert.ok(Array.isArray(findings), 'runChecks must return an array of findings');

      const geo = root.geoDetails(pageData, siteFiles);
      const scores = root.computeScores(findings, geo);
      assert.ok(scores.search.score >= 0 && scores.search.score <= 100, 'Search score must be within [0, 100]');
      assert.ok(scores.ai.score >= 0 && scores.ai.score <= 100, 'AI score must be within [0, 100]');

      const rep = root.buildReport({
        url: 'https://consumer.example.com/',
        findings,
        scores,
        pageData,
      });
      assert.equal(rep.url, 'https://consumer.example.com/');
      assert.equal(rep.findings.length, findings.length);

      const html = root.renderHtml(rep);
      assert.ok(typeof html === 'string' && html.length > 500, 'renderHtml must return full HTML');
      assert.ok(html.includes('Consumer Programmatic Test Page'), 'HTML must include page title');
      assert.ok(!html.includes('https://cdn.') && !html.includes('https://fonts.googleapis'), 'HTML must not have remote assets');

      const md = root.renderMarkdown(rep);
      assert.ok(typeof md === 'string' && md.includes('Consumer Programmatic Test Page'), 'Markdown must render');

      console.log('OK: Consumer ESM imports and execution passed');
    `;

      writeFileSync(join(consumerDir, "test-esm.mjs"), esmTestScript);
      execSync(`"${process.execPath}" test-esm.mjs`, {
        cwd: consumerDir,
        stdio: "pipe",
      });

      // 5. Test TypeScript typings consumer with tsc
      const tsConsumerScript = `
      import {
        buildReport,
        computeScores,
        geoDetails,
        runChecks,
        renderHtml,
        FINDING_META,
        type Report,
        type Finding,
        type Scores,
        type ParsedPageData,
        type SiteFilesData,
      } from 'one-step-seo';
      import { THRESHOLDS, PROFILES } from 'one-step-seo/checks';

      const page: ParsedPageData = {
        title: 'TS Consumer',
        description: 'TS Description',
        h1: ['Main'],
        canonical: 'https://example.com/',
      };

      const files: SiteFilesData = {
        robots: {
          found: true,
          status: 200,
          sitemaps: [],
          disallowCount: 0,
          aiBlocked: false,
          blockedBots: [],
        },
      };

      const findings: Finding[] = runChecks(page, files);
      const geo = geoDetails(page, files);
      const scores: Scores = computeScores(findings, geo);
      const rep: Report = buildReport({
        url: 'https://example.com/',
        findings,
        scores,
        pageData: page,
      });

      const html: string = renderHtml(rep);
      if (!html || THRESHOLDS.titleMin !== 30 || !FINDING_META.T01) {
        throw new Error('Type assertion failed');
      }
    `;

      writeFileSync(join(consumerDir, "test-ts.ts"), tsConsumerScript);
      // Use project tsc to check consumer script against installed types
      const tscBin = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
      execSync(
        `"${tscBin}" test-ts.ts --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022`,
        {
          cwd: consumerDir,
          stdio: "pipe",
        },
      );

      // 6. Test installed CLI binaries in consumer directory
      const cliOutput = execSync(`npx one-step-seo --version`, {
        cwd: consumerDir,
        stdio: "pipe",
      })
        .toString()
        .trim();
      const pkgVersion = JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ).version;
      assert.equal(cliOutput, pkgVersion, "Installed CLI binary must output correct version");

      const doctorOutput = execSync(`npx one-step-seo doctor`, {
        cwd: consumerDir,
        stdio: "pipe",
      })
        .toString()
        .trim();
      assert.ok(doctorOutput.includes(`one-step-seo v${pkgVersion}`), "Doctor command must run successfully");
    } finally {
      try {
        rmSync(packDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      try {
        rmSync(consumerDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  },
);
