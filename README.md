# one-step-seo

> One command to audit any website for **SEO + AI visibility**. Zero-config CLI + AI skill.

[![npm version](https://img.shields.io/npm/v/one-step-seo)](https://www.npmjs.com/package/one-step-seo)
[![CI](https://github.com/6t9xstar/one-step-seo/actions/workflows/ci.yml/badge.svg)](https://github.com/6t9xstar/one-step-seo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](./package.json)

**Two scores, never blended.** A page can rank in Google yet be uncitable by ChatGPT, Perplexity, or AI Overviews — or the reverse. `one-step-seo` measures both and tells you exactly what to fix.

```bash
npx one-step-seo audit https://your-site.com --pages 5
```

That one command checks technical SEO, on-page, content, schema, sitemap, performance hints, and GEO/AEO readiness — then writes `report.json` + `report.md` + `report.html` into `./seo-report/`.

- **Zero dependencies.** Plain Node 18+ ESM. No Python, no Playwright, no browser by default.
- **Any site.** Astro, Next.js, WordPress, Shopify, static HTML — if it serves HTML, it audits.
- **AI-agent ready.** Ships `SKILL.md` for Claude Code, OpenCode, Codex, and Cursor.
- **CI ready.** Same command locally and in GitHub Actions with artifact upload.
- **100% original.** Not a fork. MIT licensed, no tracking.

## 30-second quickstart

```bash
# No install needed
npx one-step-seo audit https://example.com --pages 5 --out ./seo-report

# Single page deep dive
npx one-step-seo page https://example.com/pricing

# Schema: detect, validate, print a starter snippet
npx one-step-seo schema https://example.com --generate faq

# Sitemap / robots / llms.txt overview
npx one-step-seo sitemap https://example.com

# Sanity check
npx one-step-seo doctor
```

Open `./seo-report/report.html` in a browser or read `report.md`. Example output in [`examples/report-sample.md`](./examples/report-sample.md).

## Scores

| Axis                          | What it measures                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Search SEO 0–100 (A–F)**    | Crawlability, indexability, title/meta/H1, canonical, sitemap, schema, internal links                           |
| **AI Visibility 0–100 (A–F)** | Answer-first opening, extractable facts/tables, FAQ coverage, entity consistency, `llms.txt`, AI-crawler access |

Details: [`docs/SCORING.md`](./docs/SCORING.md). Full check list: [`docs/CHECKS.md`](./docs/CHECKS.md).

## AI-agent usage

Compatible with Claude Code, OpenCode, Codex, Cursor — anything that reads `SKILL.md`.

```bash
git clone --depth 1 https://github.com/6t9xstar/one-step-seo.git
cp one-step-seo/SKILL.md ~/.claude/skills/one-step-seo/SKILL.md
```

Or copy [`SKILL.md`](./SKILL.md) into your agent's skills folder and ask:

> "Audit https://my-site.com with one-step-seo and give me P0 fixes first."

Sub-skills: [`skills/seo-audit/SKILL.md`](./skills/seo-audit/SKILL.md) (audit → plan), [`skills/seo-fix/SKILL.md`](./skills/seo-fix/SKILL.md) (opt-in safe fixes, preview by default).

## Comparison

|                           | one-step-seo                 | claude-seo style plugins                 |
| ------------------------- | ---------------------------- | ---------------------------------------- |
| Install                   | `npx` — nothing to install   | Python venv + Playwright + setup command |
| Runtime                   | Zero-dep Node                | Python + browser + API keys              |
| Works outside Claude Code | Yes (any terminal, any CI)   | No (plugin only)                         |
| Pages per run             | 1–20 crawl built in          | Agent-dependent                          |
| Report                    | JSON + Markdown + HTML files | Chat transcript                          |
| License                   | MIT, original code           | MIT, fork-heavy                          |

## Docs

- [`docs/USAGE.md`](./docs/USAGE.md) — flags, formats, exit codes
- [`docs/CHECKS.md`](./docs/CHECKS.md) — all ~40 checks
- [`docs/SCORING.md`](./docs/SCORING.md) — dual-score math
- [`docs/CI.md`](./docs/CI.md) — GitHub Actions recipe

## Contributing

PRs welcome — especially new checks with fixtures. See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Please follow the [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Security reports: [`SECURITY.md`](./SECURITY.md).

```bash
git clone https://github.com/6t9xstar/one-step-seo.git
cd one-step-seo
npm test
node bin/cli.mjs audit https://example.com --out ./seo-report
```

## License

MIT — see [`LICENSE`](./LICENSE).
