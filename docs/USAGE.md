# Usage

## Install

```bash
npm i -g one-step-seo
# or run without installing
npx one-step-seo audit https://example.com
```

Requires Node 18+.

## Commands

```bash
# Full audit (crawl up to N pages over internal links)
one-step-seo audit https://example.com --pages 5 --out ./seo-report --format html,md,json

# Single page
one-step-seo page https://example.com/pricing --out ./seo-report

# Schema: detect + validate, optionally print a starter snippet
one-step-seo schema https://example.com --generate faq

# Sitemap / robots / llms.txt overview
one-step-seo sitemap https://example.com
one-step-seo sitemap https://example.com --json

# Environment check
one-step-seo doctor
```

## Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--pages N` | `1` | Pages to crawl for `audit` (max 20, BFS over internal links) |
| `--out DIR` | `./seo-report` | Output directory |
| `--format` | `html,md,json` | Which reports to write |
| `--timeout MS` | `15000` | Per-request timeout |
| `--generate KIND` | — | `organization\|website\|article\|faq\|breadcrumb` snippet |
| `--json` | — | JSON to stdout (`sitemap`, `doctor`) |

## Outputs

- `report.json` — machine-readable (scores, counts, findings)
- `report.md` — human-readable priority list
- `report.html` — shareable single-file report
- Multi-page runs add `report-2.json/.md`, etc.

## Exit codes

- `0` ok · `1` usage error · `2` runtime/fetch failure
