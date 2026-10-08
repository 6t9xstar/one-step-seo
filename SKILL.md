---
name: one-step-seo
description: One-command SEO + AI-visibility audit for any website. Use when asked to audit SEO, check rankings readiness, validate schema, or improve AI citation.
---

# one-step-seo skill

Run a full SEO + GEO/AEO audit in one step. Zero dependencies, Node 18+.

## When to use

- User asks: "audit my SEO", "why aren't we ranking", "check this page", "fix schema", "AI search readiness", "GEO audit".
- Any framework: Astro, Next.js, WordPress, Shopify, static HTML.

## Workflow

1. Run the audit (never guess — always fetch the live URL):
   ```bash
   npx one-step-seo audit https://example.com --pages 5 --out ./seo-report
   ```
   Single page:
   ```bash
   npx one-step-seo page https://example.com/pricing --out ./seo-report
   ```
   CI gating (exit 2 on P0 or worse):
   ```bash
   npx one-step-seo audit https://example.com --pages 5 --out ./seo-report --fail-on P0
   ```
2. Read `./seo-report/report.json` (machine) or `report.md` (human). Multi-page runs also write `report-N.*` and `index.md`.
3. Present the **two scores separately** — Search SEO 0-100 and AI Visibility 0-100, never blended.
4. Fix in priority order P0 → P1 → P2. Each fix needs evidence from the report.

## Rules

- Never invent statistics, reviews, business facts, or competitor data.
- Only recommend Schema.org markup for content visible on the page.
- Prefer additive, reversible fixes. Show the exact snippet or diff.
- Distinguish: **verified fact** vs **observed data** vs **inference** vs **recommendation**.
- Never claim guaranteed rankings or guaranteed AI citations.

## Report shape

`report.json` fields: `scores {search {score,band}, ai {score,band}}`, `counts`, `findings[] {id, category, severity, title, evidence, fix}`.
Severity: P0 critical, P1 high, P2 medium, P3 low, pass healthy.

## Fix workflow

For safe auto-fixes on **local HTML files**, prefer the built-in writer:

```bash
npx one-step-seo fix ./dist --url https://example.com/          # dry-run diff
npx one-step-seo fix ./dist --url https://example.com/ --apply  # write + .bak
```

It is additive-only, previews a unified diff, verifies every fix in memory,
and never invents facts (language/titles/images need flags when they cannot
be derived from the page). For everything else, follow
`skills/seo-fix/SKILL.md`: default to preview and ask before writing files.
