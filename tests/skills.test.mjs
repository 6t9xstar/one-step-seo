import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SKILLS,
  CATEGORIES,
  getSkills,
  getSkill,
  getCategories,
  filterSkills,
  getSkillForCheck,
} from "../lib/skills.mjs";
import { FINDING_META } from "../lib/finding-meta.mjs";

test("skills registry has at least 9 comprehensive skills", () => {
  const skills = getSkills();
  assert.ok(skills.length >= 9, `expected >= 9 skills, got ${skills.length}`);
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
  }
});

test("all checks referenced in skills are documented in FINDING_META", () => {
  for (const skill of SKILLS) {
    for (const check of skill.checks) {
      assert.ok(FINDING_META[check], `check ${check} in skill ${skill.id} must exist in FINDING_META`);
    }
  }
});

test("getSkill retrieves by case-insensitive id and handles misses", () => {
  const tech = getSkill("technical-seo");
  assert.ok(tech);
  assert.equal(tech.id, "technical-seo");
  assert.equal(tech.category, "technical");

  const techUpper = getSkill("TECHNICAL-SEO");
  assert.ok(techUpper);
  assert.equal(techUpper.id, "technical-seo");

  assert.equal(getSkill(""), undefined);
  assert.equal(getSkill("non-existent-skill"), undefined);
});

test("getCategories returns all categories with metadata and non-zero counts", () => {
  const cats = getCategories();
  assert.ok(cats.length >= 8);
  for (const c of cats) {
    assert.ok(CATEGORIES[c.category]);
    assert.equal(c.name, CATEGORIES[c.category].name);
    assert.ok(c.count > 0, `category ${c.category} should have registered skills`);
  }
});

test("filterSkills filters by offlineOnly, categories, inclusions and exclusions", () => {
  const offline = filterSkills({ offlineOnly: true });
  assert.ok(offline.length > 0);
  assert.ok(offline.every((s) => s.offlineSupported));

  const technical = filterSkills({ categories: ["technical"] });
  assert.ok(technical.length > 0);
  assert.ok(technical.every((s) => s.category === "technical"));

  const included = filterSkills({ include: ["onpage-seo"] });
  assert.equal(included.length, 1);
  assert.equal(included[0]?.id, "onpage-seo");

  const excluded = filterSkills({ exclude: ["performance-cwv"] });
  assert.ok(excluded.every((s) => s.id !== "performance-cwv"));
});

test("getSkillForCheck maps check IDs to primary skills", () => {
  assert.equal(getSkillForCheck("T01-https")?.id, "technical-seo");
  assert.equal(getSkillForCheck("O01-title-missing")?.id, "onpage-seo");
  assert.equal(getSkillForCheck("S01-none")?.id, "schema-structured-data");
  assert.equal(getSkillForCheck("G01-llms")?.id, "geo-ai-search");
  assert.equal(getSkillForCheck("unknown-check"), undefined);
  assert.equal(getSkillForCheck(""), undefined);
});
