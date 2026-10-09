# FAQ

## What does one-step-seo actually do?

It fetches your pages like a search crawler would, runs ~40 deterministic
checks (technical SEO, on-page, content, schema, AI-visibility, performance
hints), and writes `report.json` + `report.md` + `report.html` with two
separate scores: **Search SEO 0–100** and **AI Visibility 0–100**.

## Why two scores instead of one?

A page can rank in Google yet be uncitable by ChatGPT, Perplexity, or AI
Overviews — or the reverse. One blended number hides which half needs work.
The two axes use different math (deductions vs. weighted checklist) and are
never combined. See `docs/SCORING.md`.

## Do I need to install anything?

No. `npx one-step-seo quick https://your-site.com` runs with plain Node 18+
and zero dependencies. Or run with no arguments for interactive prompts.

## Will it guarantee rankings or AI citations?

No — and distrust any tool that promises that. Results are **readiness
signals and best practices**: things known to help crawlers index, understand,
and quote your pages.

## Does it phone home / track me?

No. Audits run locally, reports stay in `--out`, there is no telemetry, no
account, and no network call except the ones your audit itself makes. Finding
telemetry would be treated as a security bug — see `SECURITY.md`.

## Which sites may I audit?

Sites you own or are explicitly allowed to test. The crawler identifies
itself (`one-step-seo/<version>` User-Agent), stays same-host, pauses between
requests, and obeys `robots.txt` unless you pass `--force` (documented
override for your own staging sites).

## How is this different from Lighthouse / PageSpeed?

Those measure browser performance deeply on one page. one-step-seo measures
SEO + AI-readiness breadth across up to 20 pages with no browser — it
complements them; for lab timing data it tells you to run PageSpeed.

## Can AI agents use it?

Yes — copy `SKILL.md` into your agent's skills folder (Claude Code,
OpenCode, Codex, Cursor) and ask: “Audit https://my-site.com with
one-step-seo and give me P0 fixes first.” `report.json` follows a stable
schema (`lib/schema-report.json`) for machine consumers.

## I found a wrong result. What now?

Open a bug report with the URL (or a minimal HTML fixture), the command,
and expected vs. actual. Better: add the fixture + test + docs line and
open a PR — see `CONTRIBUTING.md`.
