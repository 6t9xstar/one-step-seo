# Usage

## Install

```bash
npm i -g one-step-seo
# or run without installing
npx one-step-seo audit https://example.com
```

Requires Node 18+. Both `--flag value` and `--flag=value` forms are accepted.

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
one-step-seo doctor --json
```

`page` audits exactly one URL. `audit --pages 1` is equivalent but also writes
`index.md` only when more than one page is audited.

## Flags

| Flag              | Default        | Meaning                                                                                 |
| ----------------- | -------------- | --------------------------------------------------------------------------------------- |
| `--pages N`       | `1`            | Pages to crawl for `audit` (integer 1–20, BFS over same-host links)                     |
| `--out DIR`       | `./seo-report` | Output directory (created with `mkdir -p`, existing files overwritten)                  |
| `--format`        | `html,md,json` | Which reports to write (`html`, `md`, `json` only — anything else exits 1)              |
| `--timeout MS`    | `15000`        | Per-request timeout in ms (integer 1000–120000; applies to pages + robots/sitemap/llms) |
| `--generate KIND` | —              | `organization\|website\|article\|faq\|breadcrumb\|product\|event\|localbusiness\|howto` |
| `--fail-on SEV`   | —              | `P0\|P1\|P2` — exit 2 when any audited page has that severity or higher (CI gating)     |
| `--crawl MODE`    | `links`        | `links` (BFS over internal links) or `sitemap` (reserved, currently link-driven)        |
| `--concurrency N` | `4`            | Parallel page fetches for `audit` (integer 1–8)                                         |
| `--json`          | —              | JSON to stdout (`sitemap`, `doctor`)                                                    |
| `--verbose`       | —              | Print error stacks on runtime failures (`VERBOSE=1` also works)                         |

## Outputs

- `report.json` — machine-readable (scores, counts, findings). Shape: `{ tool, version, url, finalUrl, checkedAt, truncated, scores: { search: { score, band }, ai: { score, band } }, counts: { P0, P1, P2, P3, pass }, findings: [{ id, category, severity, title, evidence, fix }], page: { title, metaDescription, canonical, wordCount, h1, images, internalLinks, externalLinks }, site: { origin, robots, sitemap, sitemapUrls, llms } }`
- `report.md` — human-readable priority list
- `report.html` — shareable single-file report (all pages: `report.html`, `report-2.html`, …)
- Multi-page runs add `report-2.json/.md/.html`, etc. plus `index.md` linking all pages
- `sitemap --json` shape: `{ origin, robotsFound, robotsSitemaps, sitemapFound, sitemapUrl, sitemapUrls, sitemapTruncated, llmsFound }`
- `doctor --json` shape: `{ tool, version, node, nodeOk, fetch }`

`--out` traversal note: the directory is resolved with `path.resolve()` and
created recursively. Do not point `--out` at a source directory — existing
`report.*` files there are overwritten without prompting.

## Exit codes

- `0` ok (including `--fail-on` when the threshold is not breached)
- `1` usage error (bad flags, bad URL, unknown command)
- `2` runtime/fetch failure or `--fail-on` breach
