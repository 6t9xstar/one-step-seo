---
name: seo-audit
description: Run a one-step-seo audit and turn findings into a prioritized action plan.
---

# seo-audit sub-skill

## Steps

1. Confirm target URL + scope (single page vs `--pages N` crawl). For
   beginners, `quick` applies sensible defaults (5 pages, all formats):
   ```bash
   npx one-step-seo quick <url> --out ./seo-report
   ```
2. Otherwise run:
   ```bash
   npx one-step-seo audit <url> --pages 5 --out ./seo-report --format html,md,json
   ```
   For CI gating, add `--fail-on P0` (exits 2 on critical findings).
   If the audit reports a `T05-robots-disallow` refusal, stop and ask the
   user before re-running with `--force`.
3. Open `report.json`. Summarize:
   - Search SEO score + band, AI Visibility score + band
   - Top P0/P1 findings with evidence quotes
   - Page-by-page notes for multi-page runs (see `index.md` for links)
4. Output sections:
   - Executive summary (3 bullets — reuse the report's verdict)
   - Priority actions (Problem → Evidence → Action → Impact → Effort → Owner)
   - Passed checks (1 line each)
   - 30/60/90-day plan
5. Never blend the two scores. Never promise rankings.

## Reading report.json

Stable shape (`lib/schema-report.json`): `scores.{search,ai}.{score,band}`,
`counts.{P0,P1,P2,P3,pass}`, `findings[]` (priority-sorted P0 first),
`page.*` facts, `site.*` booleans. `report.md` adds triage labels and
snippets per finding — quote them instead of inventing your own.

## Severity guide

- P0: page not indexable / no HTTPS / no title — fix today
- P1: title/meta/H1/alt/sitemap/answer-block — fix this week
- P2: OG, FAQ, tables, image dims, llms.txt — fix this month
- P3: polish (twitter:card, og:url, hreflang, entity drift, llms structure)
