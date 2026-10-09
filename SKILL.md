---
name: one-step-seo
description: One-command SEO + AI-visibility audit for any website. Use when asked to audit SEO, check rankings readiness, validate schema, improve AI citation, or plan SEO fixes.
---

# one-step-seo skill

Run a full SEO + GEO/AEO audit in one step. Zero dependencies, Node 18+.

## When to use

- User asks: "audit my SEO", "why aren't we ranking", "check this page", "fix schema", "AI search readiness", "GEO audit".
- Example prompt to support: "Audit https://example.com with one-step-seo, summarize the top 5 fixes, and create an implementation plan."
- Any framework: Astro, Next.js, WordPress, Shopify, static HTML.

## Workflow

1. Run the audit (never guess — always fetch the live URL):
   ```bash
   npx one-step-seo audit https://example.com --pages 5 --out ./seo-report
   ```
   Beginner shortcut (5 pages, all formats):
   ```bash
   npx one-step-seo quick https://example.com
   ```
   Single page:
   ```bash
   npx one-step-seo page https://example.com/pricing --out ./seo-report
   ```
   CI gating (exit 2 on P0 or worse):
   ```bash
   npx one-step-seo audit https://example.com --pages 5 --out ./seo-report --fail-on P0
   ```
2. Read `./seo-report/report.json` (machine) or `report.md` (human). Multi-page runs also write `report-N.*`, `index.md`, and a site-wide `index.html` dashboard (totals, worst-first pages, recurring issues) — start there for the big picture.
3. Present the **two scores separately** — Search SEO 0-100 and AI Visibility 0-100, never blended.
4. Fix in priority order P0 → P1 → P2. Each fix needs evidence from the report.

## Reading report.json

Stable, schema-documented shape (`lib/schema-report.json`):

- `scores.search {score, band}` and `scores.ai {score, band}` — the two axes. Bands A–F.
- `counts {P0, P1, P2, P3, pass}` — severity totals for gating and progress tracking.
- `findings[] {id, category, severity, title, evidence, fix}` — priority-sorted, P0 first. Finding IDs match `^[A-Z]+[0-9]+-[a-z0-9-]+$`.
- `page {title, metaDescription, canonical, wordCount, h1[], images, internalLinks, externalLinks}` — page facts without re-fetching.
- `site {origin, robots, sitemap, sitemapUrls, llms}` — booleans + sitemap size.
- Severity: P0 critical (today) → P1 high (this week) → P2 medium (this month) → P3 polish → pass healthy.
- Categories: `technical`, `onpage`, `content`, `schema`, `geo`, `performance`.

## Prioritizing fixes

1. Take the first 3–5 non-`pass` findings (they are already priority-sorted).
2. For each: quote `evidence`, state `fix`, and add triage from `report.md` (“Fix this first”): impact (low/medium/high), effort (minutes/hours/days), owner (developer/content/SEO/agency).
3. Group by owner so the user can delegate: content fixes to writers, developer fixes to engineers.
4. Never present a fix without its evidence. Never invent statistics, reviews, business facts, or competitor data.

## Remediation plans

Structure every plan as:

- **Executive summary** (3 bullets: scores, verdict, biggest win).
- **Priority actions** (Problem → Evidence → Action → Impact → Effort → Owner).
- **Passed checks** (1 line each — reassure the user what is fine).
- **30/60/90-day plan** (P0/P1 now, P2 this month, P3 + monitoring later).
- **Verification**: re-run `npx one-step-seo page <url>` after fixes and report the score delta.

## Rules

- Never invent statistics, reviews, business facts, or competitor data.
- Only recommend Schema.org markup for content visible on the page.
- Prefer additive, reversible fixes. Show the exact snippet or diff.
- Distinguish: **verified fact** vs **observed data** vs **inference** vs **recommendation**.
- Never claim guaranteed rankings or guaranteed AI citations. Frame results as readiness signals and best practices.

## Explaining findings to non-technical users

- Lead with the verdict sentence from `report.md` (“Executive summary”).
- Translate each finding via its plain-language explanation (same section): no jargon, one sentence on why it matters to traffic or customers.
- Use impact/effort/owner labels so they know what to approve, how long it takes, and who does it.
- End with the citable checklist (“Make this page more citable”) for AI-visibility work.

## Client-ready summary

```markdown
## SEO audit — <url>

- Search SEO: **{search}/100 ({band})** · AI Visibility: **{ai}/100 ({band})**
- Verdict: {one-sentence verdict from report.md}
- Fix this first:
  1. [{sev}] {title} ({id}) — {one-line fix} (Impact: {x} · Effort: {y} · Owner: {z})
  2. …
- Passed: {count} checks, including {2–3 notable passes}.
- Next: {re-run command} after fixes. Full report: `report.html`.
```

## Report shape

`report.json` fields: `scores {search {score,band}, ai {score,band}}`, `counts`, `findings[] {id, category, severity, title, evidence, fix}`, `page`, `site`.
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

## AI-visibility paperwork

```bash
npx one-step-seo llms https://example.com   # llms.txt status + starter draft + robots snippet
```

Review the starter draft with the user before publishing — it contains
explicit placeholders where facts are unknown. The robots snippet allows the
major AI crawlers; only apply it when AI citation is wanted.
