import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SKILLS,
  AGENT_SKILLS,
  CATEGORIES,
  getSkills,
  getAgentSkills,
  getSkill,
  getCategories,
  filterSkills,
  getSkillForCheck,
  checkMatchesSkillRule,
  matchesSkillChecks,
} from "../lib/skills.mjs";
import { FINDING_META } from "../lib/finding-meta.mjs";
import { THRESHOLDS } from "../lib/checks.mjs";
import { validateSchema } from "../lib/schema.mjs";
import { VALID_FORMATS, VALID_GENERATE, VALID_FAIL_ON, VALID_CRAWL, VALID_PROFILES } from "../lib/args.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("skills registry has at least 22 comprehensive skills", () => {
  const skills = getSkills();
  assert.ok(skills.length >= 22, `expected >= 22 skills, got ${skills.length}`);
  for (const skill of skills) {
    assert.ok(skill.id, "skill must have id");
    assert.ok(skill.name, "skill must have name");
    assert.ok(skill.category, "skill must have category");
    assert.ok(skill.description, "skill must have description");
    assert.ok(skill.purpose, "skill must have purpose");
    assert.ok(Array.isArray(skill.checks) && skill.checks.length > 0, "skill must have checks");
    assert.ok(Array.isArray(skill.severities) && skill.severities.length > 0, "skill must have severities");
    assert.ok(skill.remediation, "skill must have remediation");
    assert.ok(skill.limitations, "skill must have limitations");
    assert.equal(typeof skill.offlineSupported, "boolean", "skill must specify offlineSupported");
    if (skill.agentSkill) {
      assert.ok(
        existsSync(join(ROOT, skill.agentSkill)),
        `skill ${skill.id} agentSkill path must exist: ${skill.agentSkill}`,
      );
    }
  }
});

test("all 24 structured AGENT_SKILLS exist on disk with complete 9-section SKILL.md workflow", () => {
  const agentSkills = getAgentSkills();
  assert.equal(agentSkills.length, 24);
  assert.deepEqual(agentSkills, AGENT_SKILLS);
  const requiredSections = [
    "## 1. Description & Activation Criteria",
    "## 2. Inputs & Prerequisites",
    "## 3. Step-by-Step Workflow",
    "## 4. Tools & CLI Commands",
    "## 5. Evidence Requirements",
    "## 6. Expected Outputs",
    "## 7. Limitations & External Data",
    "## 8. Safety & Approval Rules",
    "## 9. Examples",
  ];
  for (const entry of agentSkills) {
    const fullPath = join(ROOT, entry.path);
    assert.ok(existsSync(fullPath), `missing Agent Skill file: ${entry.path}`);
    const content = readFileSync(fullPath, "utf8");
    assert.match(
      content,
      new RegExp(`^---\\r?\\nname:\\s*${entry.id}\\r?\\ndescription:\\s*.+`),
      `${entry.id} frontmatter`,
    );
    for (const sec of requiredSections) {
      assert.ok(content.includes(sec), `${entry.path} missing required section: ${sec}`);
    }
  }
});

test("all checks referenced in skills are documented in FINDING_META", () => {
  for (const skill of SKILLS) {
    for (const check of skill.checks) {
      assert.ok(FINDING_META[check], `check ${check} in skill ${skill.id} must exist in FINDING_META`);
    }
  }
});

test("getSkill retrieves by case-insensitive id, alias, and handles misses", () => {
  const tech = getSkill("technical-seo");
  assert.ok(tech);
  assert.equal(tech.id, "technical-seo");
  assert.equal(tech.category, "technical");

  const techUpper = getSkill("TECHNICAL-SEO");
  assert.ok(techUpper);
  assert.equal(techUpper.id, "technical-seo");

  // Alias resolution
  assert.equal(getSkill("onpage-optimization")?.id, "onpage-seo");
  assert.equal(getSkill("schema-validation")?.id, "schema-structured-data");
  assert.equal(getSkill("structured-data")?.id, "schema-structured-data");
  assert.equal(getSkill("geo-optimization")?.id, "geo-ai-search");
  assert.equal(getSkill("core-web-vitals")?.id, "performance-cwv");
  assert.equal(getSkill("international-seo")?.id, "international-local");
  assert.equal(getSkill("accessibility-seo")?.id, "accessibility-ux");
  assert.equal(getSkill("security")?.id, "security-hygiene");
  assert.equal(getSkill("content-quality")?.id, "content-architecture");
  assert.equal(getSkill("aeo")?.id, "answer-engine-optimization");
  assert.equal(getSkill("eeat")?.id, "entity-optimization");
  assert.equal(getSkill("js-seo")?.id, "javascript-seo");
  assert.equal(getSkill("redirects")?.id, "http-status");
  assert.equal(getSkill("open-graph")?.id, "social-metadata");
  assert.equal(getSkill("images")?.id, "image-seo");
  assert.equal(getSkill("ecommerce")?.id, "ecommerce-seo");
  assert.equal(getSkill("local")?.id, "local-seo");

  // Focused skills
  assert.equal(getSkill("sitemap-robots")?.id, "sitemap-robots");
  assert.equal(getSkill("internal-linking")?.id, "internal-linking");
  assert.equal(getSkill("duplicate-content")?.id, "duplicate-content");
  assert.equal(getSkill("llms-txt")?.id, "llms-txt");
  assert.equal(getSkill("seo-regression")?.id, "seo-regression");
  assert.equal(getSkill("local-seo")?.id, "local-seo");
  assert.equal(getSkill("ecommerce-seo")?.id, "ecommerce-seo");
  assert.equal(getSkill("answer-engine-optimization")?.id, "answer-engine-optimization");
  assert.equal(getSkill("entity-optimization")?.id, "entity-optimization");
  assert.equal(getSkill("http-status")?.id, "http-status");
  assert.equal(getSkill("javascript-seo")?.id, "javascript-seo");
  assert.equal(getSkill("social-metadata")?.id, "social-metadata");
  assert.equal(getSkill("image-seo")?.id, "image-seo");

  assert.equal(getSkill(""), undefined);
  assert.equal(getSkill("non-existent-skill"), undefined);
});

test("getCategories returns all categories with metadata and non-zero counts", () => {
  const cats = getCategories();
  assert.ok(cats.length >= 9);
  for (const c of cats) {
    assert.ok(CATEGORIES[c.category]);
    assert.equal(c.name, CATEGORIES[c.category].name);
    assert.ok(c.count > 0, `category ${c.category} should have registered skills`);
  }
});

test("filterSkills filters by offlineOnly, categories, aliases, inclusions and exclusions", () => {
  const offline = filterSkills({ offlineOnly: true });
  assert.ok(offline.length > 0);
  assert.ok(offline.every((s) => s.offlineSupported));

  const technical = filterSkills({ categories: ["technical"] });
  assert.ok(technical.length >= 3);
  assert.ok(technical.every((s) => s.category === "technical"));

  const included = filterSkills({ include: ["onpage-optimization"] });
  assert.equal(included.length, 1);
  assert.equal(included[0]?.id, "onpage-seo");

  const excluded = filterSkills({ exclude: ["core-web-vitals"] });
  assert.ok(excluded.every((s) => s.id !== "performance-cwv"));
});

test("getSkillForCheck, checkMatchesSkillRule, and matchesSkillChecks handle prefixes and pass variants", () => {
  assert.equal(getSkillForCheck("T01-https")?.id, "technical-seo");
  assert.equal(getSkillForCheck("O01-title-missing")?.id, "onpage-seo");
  assert.equal(getSkillForCheck("S01-none")?.id, "schema-structured-data");
  assert.equal(getSkillForCheck("S02-product")?.id, "schema-structured-data");
  assert.equal(getSkillForCheck("S02-localbusiness")?.id, "schema-structured-data");
  assert.equal(getSkillForCheck("O01-title")?.id, "onpage-seo");
  assert.equal(getSkillForCheck("O02-meta")?.id, "onpage-seo");
  assert.equal(getSkillForCheck("O03-h1")?.id, "onpage-seo");
  assert.equal(getSkillForCheck("O08-images-none")?.id, "onpage-seo");
  assert.equal(getSkillForCheck("S01-present")?.id, "schema-structured-data");
  assert.equal(getSkillForCheck("C01-length")?.id, "content-architecture");
  assert.equal(getSkillForCheck("C01-long")?.id, "content-architecture");
  assert.equal(getSkillForCheck("G01-llms")?.id, "geo-ai-search");
  assert.equal(getSkillForCheck("unknown-check"), undefined);
  assert.equal(getSkillForCheck(""), undefined);

  assert.equal(checkMatchesSkillRule("S02-faqpage", "S02-"), true);
  assert.equal(checkMatchesSkillRule("O01-title", "O01-title-missing"), true);
  assert.equal(checkMatchesSkillRule("", "T01-https"), false);
  assert.equal(matchesSkillChecks("S02-article", new Set(["S02-"])), true);
  assert.equal(matchesSkillChecks("T01-https", new Set(["S02-"])), false);
  assert.equal(matchesSkillChecks("", new Set(["S02-"])), false);
});

test("validateSchema enforces required properties for LocalBusiness, WebSite, HowTo, JobPosting, Course, Recipe, Review, SoftwareApplication", () => {
  const cases = [
    [{ "@context": "https://schema.org", "@type": "LocalBusiness" }, "LocalBusiness without name"],
    [{ "@context": "https://schema.org", "@type": "WebSite" }, "WebSite without name"],
    [{ "@context": "https://schema.org", "@type": "HowTo" }, "HowTo without name"],
    [{ "@context": "https://schema.org", "@type": "JobPosting" }, "JobPosting without title"],
    [{ "@context": "https://schema.org", "@type": "Course" }, "Course without name"],
    [{ "@context": "https://schema.org", "@type": "Recipe" }, "Recipe without name"],
    [{ "@context": "https://schema.org", "@type": "Review" }, "Review without itemReviewed"],
    [
      { "@context": "https://schema.org", "@type": "SoftwareApplication" },
      "SoftwareApplication without name",
    ],
  ];
  for (const [node, expectedIssue] of cases) {
    const res = validateSchema([/** @type {Record<string, any>} */ (node)]);
    assert.ok(
      res.issues.some((i) => i.issue === expectedIssue),
      `expected "${expectedIssue}", got ${JSON.stringify(res.issues)}`,
    );
  }
});

test("Agent Skill contract validation: all 24 SKILL.md files reference canonical report.json fields and valid CLI commands/flags/skills", () => {
  const schemaReport = JSON.parse(readFileSync(join(ROOT, "lib/schema-report.json"), "utf8"));
  const topLevelProps = new Set(Object.keys(schemaReport.properties));
  const pageProps = new Set(Object.keys(schemaReport.properties.page.properties));
  const siteProps = new Set(Object.keys(schemaReport.properties.site.properties));
  const scoresProps = new Set(Object.keys(schemaReport.properties.scores.properties));
  const scoreAxisProps = new Set(Object.keys(schemaReport.properties.scores.properties.search.properties));

  const validSubcommands = new Set([
    "quick",
    "audit",
    "page",
    "ai",
    "skills",
    "schema",
    "sitemap",
    "llms",
    "fix",
    "diff",
    "doctor",
  ]);
  const validFlags = new Set([
    "--pages",
    "--out",
    "--format",
    "--timeout",
    "--generate",
    "--json",
    "--fail-on",
    "--crawl",
    "--concurrency",
    "--delay",
    "--debug",
    "--force",
    "--profile",
    "--check-links",
    "--apply",
    "--no-backup",
    "--only",
    "--url",
    "--title",
    "--description",
    "--lang",
    "--og-image",
    "--psi",
    "--psi-strategy",
    "--skills",
    "--exclude-skills",
    "--verbose",
    "--quiet",
    "-q",
    "--block-private-ips",
    "--check-config",
    "--offline",
    "--help",
    "-h",
    "--version",
    "-v",
  ]);

  const forbiddenFieldPatterns = [
    "scores.ai.details",
    "scores.search.details",
    "page.titleLength",
    "page.metaDescriptionLength",
    "page.schemaTypes",
    "site.llmsTxt",
    "site.aiCrawlersBlocked",
  ];

  for (const entry of getAgentSkills()) {
    const content = readFileSync(join(ROOT, entry.path), "utf8");

    // 1. No fabricated or nonexistent report fields
    for (const forbidden of forbiddenFieldPatterns) {
      assert.ok(
        !content.includes(forbidden),
        `${entry.path} must not reference nonexistent report field "${forbidden}"`,
      );
    }

    // 2. Validate explicit report.<prop>.<subprop> references against lib/schema-report.json
    const reportPathMatches = content.matchAll(
      /\breport\.([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_]+))?(?:\.([a-zA-Z0-9_]+))?/g,
    );
    for (const m of reportPathMatches) {
      const p1 = m[1];
      const p2 = m[2];
      const p3 = m[3];
      if (!p1 || ["json", "md", "html", "csv", "sarif"].includes(p1)) continue;
      assert.ok(topLevelProps.has(p1), `${entry.path} references unknown top-level report.${p1}`);
      if (p1 === "page" && p2) {
        assert.ok(pageProps.has(p2), `${entry.path} references unknown report.page.${p2}`);
      } else if (p1 === "site" && p2) {
        assert.ok(siteProps.has(p2), `${entry.path} references unknown report.site.${p2}`);
      } else if (p1 === "scores" && p2) {
        assert.ok(scoresProps.has(p2), `${entry.path} references unknown report.scores.${p2}`);
        if (p3) {
          assert.ok(scoreAxisProps.has(p3), `${entry.path} references unknown report.scores.${p2}.${p3}`);
        }
      }
    }

    // 3. Validate CLI subcommands, flags, and --skills values in bash code blocks
    const cliLines = content.matchAll(/npx\s+one-step-seo\s+([^\r\n`]+)/g);
    for (const m of cliLines) {
      const tokens = (m[1] ?? "").trim().split(/\s+/);
      const sub = tokens[0];
      assert.ok(
        sub && validSubcommands.has(sub),
        `${entry.path} invokes invalid CLI subcommand "${sub}" in "${m[0]}"`,
      );
      for (let i = 1; i < tokens.length; i++) {
        const tok = tokens[i] ?? "";
        if (tok.startsWith("-")) {
          const flagName = tok.split("=")[0] ?? tok;
          assert.ok(
            validFlags.has(flagName),
            `${entry.path} uses invalid CLI flag "${flagName}" in "${m[0]}"`,
          );
          const next = tokens[i + 1] ?? "";
          if ((flagName === "--skills" || flagName === "--exclude-skills") && next && !next.startsWith("<")) {
            const skillTokens = next.split(",").filter(Boolean);
            for (const st of skillTokens) {
              const matched = filterSkills({ include: [st] });
              assert.ok(
                matched.length > 0,
                `${entry.path} uses unresolved skill filter "${st}" in "${m[0]}"`,
              );
            }
          }
          if (flagName === "--profile" && next && !next.startsWith("<") && !next.includes("|")) {
            assert.ok(
              VALID_PROFILES.includes(next),
              `${entry.path} uses invalid --profile "${next}" in "${m[0]}"`,
            );
          }
          if (flagName === "--crawl" && next && !next.startsWith("<") && !next.includes("|")) {
            assert.ok(
              VALID_CRAWL.includes(next),
              `${entry.path} uses invalid --crawl "${next}" in "${m[0]}"`,
            );
          }
          if (flagName === "--fail-on" && next && !next.startsWith("<") && !next.includes("|")) {
            assert.ok(
              VALID_FAIL_ON.includes(next),
              `${entry.path} uses invalid --fail-on "${next}" in "${m[0]}"`,
            );
          }
          if (flagName === "--generate" && next && !next.startsWith("<") && !next.includes("|")) {
            assert.ok(
              VALID_GENERATE.includes(next),
              `${entry.path} uses invalid --generate "${next}" in "${m[0]}"`,
            );
          }
          if (flagName === "--format" && next && !next.startsWith("<") && !next.includes("|")) {
            for (const fmt of next.split(",")) {
              assert.ok(
                VALID_FORMATS.includes(fmt),
                `${entry.path} uses invalid --format "${fmt}" in "${m[0]}"`,
              );
            }
          }
        }
      }
    }
  }
});

test("agent skill playbooks and SKILL_REGISTRY match exact severities and THRESHOLDS in lib/checks.mjs", () => {
  const checksSrc = readFileSync(join(ROOT, "lib/checks.mjs"), "utf8");

  // Extract all actionable severities emitted per check ID in lib/checks.mjs
  /** @type {Map<string, Set<string>>} */
  const checkSeverities = new Map();
  const addSev = (/** @type {string} */ id, /** @type {string} */ sev) => {
    if (!["P0", "P1", "P2", "P3"].includes(sev)) return;
    if (!checkSeverities.has(id)) checkSeverities.set(id, new Set());
    checkSeverities.get(id)?.add(sev);
  };

  for (const m of checksSrc.matchAll(
    /\bF\(\s*["`']([A-Z]\d{2}-[a-z0-9-]*)["`']\s*,\s*["'][a-z]+["']\s*,\s*["'](P[0-3])["']/g,
  )) {
    if (m[1] && m[2]) addSev(m[1], m[2]);
  }
  for (const m of checksSrc.matchAll(
    /id:\s*["`']([A-Z]\d{2}-[a-z0-9-]*)["`'][\s\S]{0,160}?severity:\s*["'](P[0-3])["']/g,
  )) {
    if (m[1] && m[2]) addSev(m[1], m[2]);
  }
  // Dynamic / profile-bumped severity checks in lib/checks.mjs
  addSev("T13-mixed", "P1");
  addSev("T13-mixed", "P2");
  addSev("O10-internal", "P1");
  addSev("C01-thin", "P1");
  addSev("C04-faq", "P1");
  addSev("C04-faq", "P2");
  addSev("G01-llms", "P1");
  addSev("G01-llms", "P2");
  addSev("S02-", "P2");
  addSev("P03-psi-lab", "P1");
  addSev("P03-psi-lab", "P2");
  addSev("P04-psi-field", "P1");
  addSev("P04-psi-field", "P2");
  addSev("P05-psi-error", "P3");

  // 1. Every SKILL_REGISTRY entry's `severities` matches its checks in lib/checks.mjs
  for (const skill of getSkills()) {
    /** @type {Set<string>} */
    const actualSevs = new Set();
    for (const rule of skill.checks) {
      for (const [cid, sevs] of checkSeverities.entries()) {
        if (checkMatchesSkillRule(cid, rule)) {
          for (const s of sevs) actualSevs.add(s);
        }
      }
    }
    for (const declared of skill.severities) {
      assert.ok(
        actualSevs.has(declared),
        `skill "${skill.id}" declares severity ${declared}, but its checks (${skill.checks.join(", ")}) only emit [${[...actualSevs].join(", ")}]`,
      );
    }
  }

  // 2. Every explicit (`<ID>`, P0|P1|P2|P3) or `<ID>` P0|P1|P2|P3 claim in skills/*/SKILL.md matches lib/checks.mjs
  for (const entry of getAgentSkills()) {
    const content = readFileSync(join(ROOT, entry.path), "utf8");
    const pairPatterns = [
      /`([A-Z]\d{2}-[a-z0-9-]+)`\s*(?:\(\s*)?(P[0-3])/g,
      /\(`([A-Z]\d{2}-[a-z0-9-]+)`,\s*(P[0-3])\)/g,
    ];
    for (const pat of pairPatterns) {
      for (const m of content.matchAll(pat)) {
        const cid = m[1] ?? "";
        const sev = m[2] ?? "";
        const allowed = checkSeverities.get(cid);
        if (allowed) {
          assert.ok(
            allowed.has(sev),
            `${entry.path} claims ${cid} is ${sev}, but lib/checks.mjs defines [${[...allowed].join(", ")}]`,
          );
        }
      }
    }
  }

  // 3. Verify calibrated THRESHOLDS constants in lib/checks.mjs match playbook documentation
  assert.equal(THRESHOLDS.titleMin, 30);
  assert.equal(THRESHOLDS.titleMax, 60);
  assert.equal(THRESHOLDS.metaMin, 120);
  assert.equal(THRESHOLDS.metaMax, 155);
  assert.equal(THRESHOLDS.thinWords, 200);
  assert.equal(THRESHOLDS.longWords, 3000);
  assert.equal(THRESHOLDS.h2LongWords, 600);
  assert.equal(THRESHOLDS.geoSubstantiveWords, 300);
  assert.equal(THRESHOLDS.htmlBytesMax, 300_000);
  assert.equal(THRESHOLDS.imgCountMax, 20);
  assert.equal(THRESHOLDS.internalLinksMax, 200);
});
