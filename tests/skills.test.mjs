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
import { validateSchema } from "../lib/schema.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("skills registry has at least 14 comprehensive skills", () => {
  const skills = getSkills();
  assert.ok(skills.length >= 14, `expected >= 14 skills, got ${skills.length}`);
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

test("all 13 structured AGENT_SKILLS exist on disk with complete 9-section SKILL.md workflow", () => {
  const agentSkills = getAgentSkills();
  assert.equal(agentSkills.length, 13);
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
  assert.equal(getSkill("ecommerce-seo")?.id, "schema-structured-data");
  assert.equal(getSkill("geo-optimization")?.id, "geo-ai-search");
  assert.equal(getSkill("core-web-vitals")?.id, "performance-cwv");
  assert.equal(getSkill("local-seo")?.id, "international-local");
  assert.equal(getSkill("content-quality")?.id, "content-architecture");

  // Focused skills
  assert.equal(getSkill("sitemap-robots")?.id, "sitemap-robots");
  assert.equal(getSkill("internal-linking")?.id, "internal-linking");
  assert.equal(getSkill("duplicate-content")?.id, "duplicate-content");
  assert.equal(getSkill("llms-txt")?.id, "llms-txt");
  assert.equal(getSkill("seo-regression")?.id, "seo-regression");

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
