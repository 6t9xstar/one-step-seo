<p align="center">
  <img src="./assets/logo.svg" width="120" alt="one-step-seo logo">
</p>

<h1 align="center">one-step-seo</h1>

<p align="center">
  <strong>One command to audit any website for SEO + AI visibility.</strong><br>
  Zero-config CLI + AI skill. Two scores, never blended.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/one-step-seo"><img src="https://img.shields.io/npm/v/one-step-seo" alt="npm version"></a>
  <a href="https://github.com/6t9xstar/one-step-seo/actions/workflows/ci.yml"><img src="https://github.com/6t9xstar/one-step-seo/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License: MIT"></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node >= 18"></a>
  <a href="https://github.com/6t9xstar/one-step-seo/stargazers"><img src="https://img.shields.io/github/stars/6t9xstar/one-step-seo" alt="GitHub stars"></a>
  <a href="https://github.com/6t9xstar/one-step-seo/network/members"><img src="https://img.shields.io/github/forks/6t9xstar/one-step-seo" alt="GitHub forks"></a>
  <a href="https://github.com/6t9xstar/one-step-seo/commits/main"><img src="https://img.shields.io/github/last-commit/6t9xstar/one-step-seo" alt="Last commit"></a>
  <a href="./CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome"></a>
</p>

A page can rank in Google yet be uncitable by ChatGPT, Perplexity, or AI Overviews — or the reverse. `one-step-seo` measures **both** and tells you exactly what to fix, in plain language, with copy-paste snippets.

## See it in 30 seconds

![Terminal demo: npx one-step-seo quick scores a site 87 Search / 80 AI and writes three report files](./assets/demo.svg)

```bash
npx one-step-seo quick https://your-site.com
```

That one command checks technical SEO, on-page, content, schema, sitemap, performance hints, and GEO/AEO readiness — then writes `report.json` + `report.md` + `report.html` into `./seo-report/`, and prints the top 3 fixes in your terminal:

```text
Search SEO: 87/100 (B)  |  AI Visibility: 80/100 (B)
Pages audited: 5
Counts: P0=0 P1=1 P2=2 P3=0 pass=33
Top fixes:
  [P1] Thin content (C01-thin) — Expand to fully answer the query; add examples, steps, data.
    Impact: medium · Effort: days · Owner: content
  [P2] llms.txt missing (G01-llms) — Optional: add /llms.txt summarizing key pages for AI crawlers.
    Impact: medium · Effort: minutes · Owner: developer
  ...
Next: fix the items above, then re-run `one-step-seo audit https://your-site.com --pages 5`.
Wrote:
  ./seo-report/report.json
  ./seo-report/report.md
  ./seo-report/report.html
```

## Contents

- [Quickstart](#quickstart)
- [Who it is for](#who-it-is-for)
- [Scores](#scores)
- [Features](#features)
- [Reports](#reports)
- [AI-agent usage](#ai-agent-usage)
- [CI usage](#ci-usage)
- [Privacy](#privacy)
- [Comparison](#comparison)
- [Docs](#docs)
- [Contributing](#contributing)
- [License](#license)

## Quickstart

```bash
# Easiest: sensible defaults (5 pages, all formats)
npx one-step-seo quick https://example.com

# Interactive: answer 4 questions, optionally open the report after
npx one-step-seo

# Full control: crawl up to N pages
npx one-step-seo audit https://example.com --pages 5 --out ./seo-report

# Single page deep dive
npx one-step-seo page https://example.com/pricing

# Schema: detect, validate, print a starter snippet
npx one-step-seo schema https://example.com --generate faq

# Sitemap / robots / llms.txt overview
npx one-step-seo sitemap https://example.com

# llms.txt status + starter draft + AI-crawler robots.txt snippet
npx one-step-seo llms https://example.com

# Safe auto-fixes for local HTML — dry-run diff first, then --apply
npx one-step-seo fix ./dist/index.html --url https://example.com/

# Sanity check
npx one-step-seo doctor
```

Open `./seo-report/report.html` in a browser or read `report.md`. Every
finding carries a plain-language explanation, impact/effort/owner labels,
and — where safe — a copy-paste snippet.

## Who it is for

| You are…                    | You get…                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| **New to SEO**              | `quick` + interactive mode, plain-language findings, “Fix this first” top 3, no jargon needed |
| **Marketer / content lead** | Executive summary + verdict in `report.md`, citable checklist, impact/effort/owner per fix    |
| **Developer**               | Zero-dep CLI, exit codes + `--fail-on` for CI, JSON schema for `report.json`, copy-paste code |
| **Agency / freelancer**     | Shareable single-file `report.html` (print + copy-summary button), client-ready language      |
| **AI-agent user**           | `SKILL.md` + stable `report.json` shape — agents audit, plan, and explain fixes for you       |

## Scores

| Axis                          | What it measures                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Search SEO 0–100 (A–F)**    | Crawlability, indexability, title/meta/H1, canonical, sitemap, schema, internal links                           |
| **AI Visibility 0–100 (A–F)** | Answer-first opening, extractable facts/tables, FAQ coverage, entity consistency, `llms.txt`, AI-crawler access |

Bands: `A ≥90 · B ≥80 · C ≥70 · D ≥60 · F <60`

Why two scores? Because “rank” and “get cited by AI answers” are different
skills. A thin affiliate page can rank yet offer nothing quotable; a deep
essay can be AI-ready yet invisible to Google without titles and sitemaps.
One blended number would hide which half needs work — so the Search score
deducts per finding while the AI score is a weighted readiness checklist,
and they are reported side by side, never merged.

Real output (from [`examples/`](./examples/report-sample.md)):

```text
Search SEO: 87/100 (B)  |  AI Visibility: 80/100 (B)
Counts: P0=0 P1=1 P2=2 P3=0 pass=33
```

Priorities: **P0** critical (fix today) → **P1** high (this week) → **P2** medium (this month) → **P3** polish. Details: [`docs/SCORING.md`](./docs/SCORING.md). Full check list: [`docs/CHECKS.md`](./docs/CHECKS.md). More examples: [`examples/page-types.md`](./examples/page-types.md) (WordPress, Next.js, product, blog, pricing).

## Features

|                       |                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------- |
| **Zero dependencies** | Plain Node 18+ ESM. No Python, no Playwright, no browser.                                   |
| **Beginner friendly** | `quick`, interactive prompts, plain-language findings, top-3 terminal fix list              |
| **Any stack**         | Astro, Next.js, WordPress, Shopify, static HTML.                                            |
| **1–20 page crawl**   | `audit --pages N` walks same-host links automatically.                                      |
| **Polite crawler**    | Same-host only, `robots.txt` enforced (`--force` override), request delay, clear User-Agent |
| **Safe auto-fix**     | `fix` patches local HTML — dry-run diff, backups, additive only.                            |
| **AI paperwork**      | `llms` prints a starter `llms.txt` + AI-crawler `robots.txt` snippet.                       |
| **AI-agent ready**    | Ships `SKILL.md` for Claude Code, OpenCode, Codex, Cursor.                                  |
| **CI ready**          | Same command locally and in Actions, with report artifacts.                                 |
| **Original + MIT**    | Not a fork. No tracking, reports stay on your machine.                                      |

## Reports

| File          | For                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------- |
| `report.json` | Machines — scores, counts, every finding (schema: `lib/schema-report.json`)               |
| `report.md`   | Humans — executive summary, fix-first top 3, grouped actions, snippets, citable checklist |
| `report.html` | Sharing — single portable file, copy-summary button, print styles, mobile-friendly        |
| `index.html`  | Multi-page runs — site dashboard: totals, worst-first pages, recurring issues             |

Preview: [`examples/report-sample.md`](./examples/report-sample.md) · [`examples/report-sample.html`](./examples/report-sample.html) · [page-type examples](./examples/page-types.md) · [`examples/site-index.html`](./examples/site-index.html)

## AI-agent usage

Compatible with Claude Code, OpenCode, Codex, Cursor — anything that reads `SKILL.md`.

```bash
git clone --depth 1 https://github.com/6t9xstar/one-step-seo.git
cp one-step-seo/SKILL.md ~/.claude/skills/one-step-seo/SKILL.md
```

Or copy [`SKILL.md`](./SKILL.md) into your agent's skills folder and ask:

> "Audit https://my-site.com with one-step-seo, summarize the top 5 fixes, and create an implementation plan."

The skill teaches agents to run the audit, read `report.json` (stable,
schema-documented shape), prioritize P0/P1 with evidence, propose
additive-only fixes with diffs for approval, and write a client-ready
summary — never blending the two scores, never promising rankings.

Sub-skills: [`skills/seo-audit/SKILL.md`](./skills/seo-audit/SKILL.md) (audit → plan), [`skills/seo-fix/SKILL.md`](./skills/seo-fix/SKILL.md) (opt-in safe fixes, preview by default).

## CI usage

```yaml
- run: npx one-step-seo audit https://example.com --pages 5 --out ./seo-report --fail-on P0
- uses: actions/upload-artifact@v4
  with:
    name: seo-report
    path: seo-report/
```

`--fail-on P0` exits 2 on critical findings; artifacts keep the reports.
Full recipe (score gates, PR-comment format, scheduled audits): [`docs/CI.md`](./docs/CI.md).

## Privacy

- **No tracking, no telemetry, no accounts.** The only network requests are
  the ones your audit makes to the target site.
- Reports are written locally to `--out` and never uploaded anywhere.
- The crawler identifies itself (`one-step-seo/<version>`), stays same-host,
  pauses between requests, and obeys `robots.txt`.
- Only audit sites you own or are allowed to test. Security reports:
  [`SECURITY.md`](./SECURITY.md). If you ever find telemetry, that is a bug —
  please report it.

## Comparison

|                           | one-step-seo                  | claude-seo style plugins                 |
| ------------------------- | ----------------------------- | ---------------------------------------- |
| Install                   | `npx` — nothing to install    | Python venv + Playwright + setup command |
| Runtime                   | Zero-dep Node                 | Python + browser + API keys              |
| Beginner mode             | `quick` + interactive prompts | Agent-dependent                          |
| Works outside Claude Code | Yes (any terminal, any CI)    | No (plugin only)                         |
| Pages per run             | 1–20 crawl built in           | Agent-dependent                          |
| Report                    | JSON + Markdown + HTML files  | Chat transcript                          |
| License                   | MIT, original code            | MIT, fork-heavy                          |

## Docs

- [`docs/USAGE.md`](./docs/USAGE.md) — flags, formats, exit codes
- [`docs/CHECKS.md`](./docs/CHECKS.md) — all ~45 checks + crawler behavior
- [`docs/SCORING.md`](./docs/SCORING.md) — dual-score math
- [`docs/CI.md`](./docs/CI.md) — GitHub Actions recipe
- [`docs/FAQ.md`](./docs/FAQ.md) — questions, answered plainly
- [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) — fixes for common failures
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) — where the project is heading

## Contributing

PRs welcome — especially new checks with fixtures. See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Please follow the [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Security reports: [`SECURITY.md`](./SECURITY.md).

```bash
git clone https://github.com/6t9xstar/one-step-seo.git
cd one-step-seo
npm install
npm run check
```

## License

MIT — see [`LICENSE`](./LICENSE).

---

<p align="center">
  <a href="https://www.star-history.com/#6t9xstar/one-step-seo&Date"><img src="https://api.star-history.com/svg?repos=6t9xstar/one-step-seo&type=Date" alt="Star history chart"></a>
</p>

<p align="center">Star us if this saved you an audit. — <a href="https://github.com/6t9xstar/one-step-seo">6t9xstar/one-step-seo</a></p>
