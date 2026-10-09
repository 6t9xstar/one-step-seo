# Scoring

Two scores, never blended. A page can rank in Google yet be
uncitable by AI answers — or the reverse.

These are **our readiness signals, not Google scores**: no tool can see
Google's ranking systems. The numbers measure how closely a page follows
publicly documented best practices for crawlability and AI citability.

Source of truth: `lib/score.mjs` (`SEARCH_WEIGHTS`, `GEO_WEIGHTS`,
`GEO_ONLY_IDS`) + `lib/checks.mjs` (`THRESHOLDS`).

## Search SEO (0–100, A–F)

Starts at 100, deducts per finding: P0 −25, P1 −10, P2 −3, P3 −1.
GEO-only discovery findings (`G01-llms`, `G02-ai-blocked`, `G04-entity`,
`G05-llms-quality`, `G06-freshness`, `G07-question-headings`,
`G08-stat-density`) do not affect it. `G03-facts` and `G09-snippet-controls`
intentionally still deduct (P2 −3 each): hard-to-extract facts hurt classic
ranking too (`seoImpact: low`), and snippet controls degrade classic
snippet display as well as AI quoting.

Worked example: a page with 1×P0 + 2×P1 + 1×P2 (non-GEO) scores
`100 − 25 − 20 − 3 = 52` → band F. Clamped to 0–100; no per-category cap.

## AI Visibility (0–100, A–F)

Weighted checklist (max 100):

| Signal               | Weight |
| -------------------- | ------ |
| Answer-first opening | 25     |
| Tables/lists         | 20     |
| ≥300 words           | 15     |
| FAQ coverage         | 10     |
| Single H1            | 10     |
| H2s                  | 5      |
| Title + meta present | 5      |
| llms.txt             | 5      |
| AI crawlers allowed  | 5      |

Partial credit: each signal is all-or-nothing; the AI score is the sum of
weights for passing signals (0–100, clamped).

## Bands

A ≥90 · B ≥80 · C ≥70 · D ≥60 · F <60.

Report both scores side by side with counts
(P0/P1/P2/P3/pass) so progress is trackable week to week.
