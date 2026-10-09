# Usage

## Install

```bash
npm i -g one-step-seo
# or run without installing
npx one-step-seo audit https://example.com
```

Requires Node 18+. Both `--flag value` and `--flag=value` forms are accepted.

## Quickstart

```bash
# Easiest: one command, sensible defaults (5 pages, all formats)
npx one-step-seo quick https://your-site.com

# Interactive: answer 4 questions (URL, pages, output folder, open report?)
npx one-step-seo

# Full control
npx one-step-seo audit https://example.com --pages 5 --out ./seo-report
```

You get: Search SEO score + AI Visibility score (two separate 0–100 scores),
`report.json` + `report.md` + `report.html`, and prioritized fixes with the
top 3 printed in the terminal.

## Commands

```bash
# Full audit (crawl up to N pages over internal links)
one-step-seo audit https://example.com --pages 5 --out ./seo-report --format html,md,json

# Beginner shortcut: audit with 5 pages and all formats
one-step-seo quick https://example.com
one-step-seo quick https://example.com --pages 3 --out ./quick-report

# Single page
one-step-seo page https://example.com/pricing --out ./seo-report

# Schema: detect + validate, optionally print a starter snippet
one-step-seo schema https://example.com --generate faq

# Sitemap / robots / llms.txt overview
one-step-seo sitemap https://example.com
one-step-seo sitemap https://example.com --json

# llms.txt status + starter draft + AI-crawler robots.txt snippet (prints only)
one-step-seo llms https://example.com
one-step-seo llms https://example.com --json

# Safe auto-fixes for local HTML (dry-run diff by default)
one-step-seo fix ./dist/index.html
one-step-seo fix ./dist/index.html --apply --url https://example.com/ --lang en

# Environment check
one-step-seo doctor
one-step-seo doctor --json
```

`page` audits exactly one URL. `audit --pages 1` is equivalent but also writes
`index.md` only when more than one page is audited. `quick` is `audit` with
beginner defaults: 5 pages unless `--pages` is given explicitly.

Running with no command at all starts interactive mode on a TTY (URL, pages,
output folder, open-report prompt); piped/CI usage without a command prints
usage and exits 1.

## The `llms` command

`llms` helps with AI-visibility paperwork. It prints (never writes):

1. Current `llms.txt` status (found/missing, byte size).
2. A starter `llms.txt` draft built from the live page title/description and
   up to 20 sitemap URLs — curate it before publishing; unknown slots are
   explicit placeholders, never invented facts.
3. A `robots.txt` snippet allowing the major AI crawlers (`GPTBot`,
   `ClaudeBot`, `PerplexityBot`, `Google-Extended`, `CCBot`).

```bash
one-step-seo llms https://example.com
one-step-seo llms https://example.com --json   # { tool, version, url, llmsFound, llmsBytes, starter, robotsSnippet }
```

## The `fix` command

`fix` applies **additive-only** SEO fixes to local `.html`/`.htm` files (a file,
or a directory walked recursively — `node_modules` and `.git` are skipped).
It never removes content, never rewrites copy, and never invents facts:

- **Dry-run by default** — prints each planned fix with its finding ID plus a
  unified diff, writes nothing. `--apply` writes, creating `<file>.bak` backups
  (disable with `--no-backup`).
- **Verified in memory** — after planning, the document is re-parsed and each
  fix confirmed to clear its finding before you are asked to approve it.
- **Never guesses** — language, URLs, titles and images need explicit flags
  when they cannot be derived from content already on the page.

```bash
# Preview (nothing is written)
one-step-seo fix ./public/index.html --url https://example.com/

# Write the fixes + backups
one-step-seo fix ./public/index.html --apply --url https://example.com/ --lang en

# Only some fixers, machine-readable plan
one-step-seo fix ./public --only charset,viewport,twitter-card --json
```

Fixers and what they need:

| Fixer          | Clears              | Needs                                                              |
| -------------- | ------------------- | ------------------------------------------------------------------ |
| `charset`      | `T10-charset`       | charset absent (won't rewrite other encodings)                     |
| `viewport`     | `T11-viewport`      | viewport absent (custom ones untouched)                            |
| `lang`         | `T09-lang`          | `--lang`                                                           |
| `title`        | `O01-title-missing` | `--title`, else derived from the first `<h1>`                      |
| `description`  | `O02-meta-missing`  | `--description`, else derived from page text                       |
| `canonical`    | `T08-canonical`     | `--url`                                                            |
| `og`           | `O06-og`            | title/meta present; `--og-image` for the image (partial otherwise) |
| `og-url`       | `W02-og-url`        | existing wrong `og:url` + `--url`                                  |
| `twitter-card` | `W01-social`        | —                                                                  |
| `favicon`      | `O07-favicon`       | —                                                                  |

Hard exclusions (by design): alt text, `noindex` removal, title/description
length rewrites, image dimensions, `robots.txt`/`llms.txt`/sitemap edits, and
non-HTML templates (`.astro`, `.jsx`).

## Flags

| Flag              | Default        | Meaning                                                                                                                                                                                                                                                                                  |
| ----------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--pages N`       | `1`            | Pages to crawl for `audit` (integer 1–200, BFS over same-host links). The terminal reports whether all discovered pages were audited or the cap cut the crawl short (re-run higher, max 200)                                                                                             |
| `--out DIR`       | `./seo-report` | Output directory (created with `mkdir -p`, existing files overwritten)                                                                                                                                                                                                                   |
| `--format`        | `html,md,json` | Which reports to write (`html`, `md`, `json` only — anything else exits 1)                                                                                                                                                                                                               |
| `--timeout MS`    | `15000`        | Per-request timeout in ms (integer 1000–120000; applies to pages + robots/sitemap/llms)                                                                                                                                                                                                  |
| `--generate KIND` | —              | `organization\|website\|article\|faq\|breadcrumb\|product\|event\|localbusiness\|howto`                                                                                                                                                                                                  |
| `--fail-on SEV`   | —              | `P0\|P1\|P2` — exit 2 when any audited page has that severity or higher (CI gating)                                                                                                                                                                                                      |
| `--crawl MODE`    | `links`        | `links` (BFS over internal links) or `sitemap` (seeds from `sitemap.xml`, or the `Sitemap:` URL declared in `robots.txt`; follows up to 5 child sitemaps of a `<sitemapindex>`, caps seeds at 500, drops cross-host seeds, and warns + falls back to `links` when no sitemap URLs exist) |
| `--concurrency N` | `4`            | Parallel page fetches for `audit` (integer 1–8)                                                                                                                                                                                                                                          |
| `--delay MS`      | `250`          | Politeness pause between crawl batches in ms (integer 0–10000)                                                                                                                                                                                                                           |
| `--debug`         | —              | Verbose diagnostics: parsed audit parameters, `robots.txt` status, per-page timings (implies `--verbose` stacks)                                                                                                                                                                         |
| `--force`         | —              | Crawl even when `robots.txt` disallows the URL — use only on sites you own or are allowed to test; the refusal is otherwise reported as `T05-robots-disallow`                                                                                                                            |
| `--json`          | —              | JSON to stdout (`sitemap`, `doctor`, `fix`)                                                                                                                                                                                                                                              |
| `--verbose`       | —              | Print error stacks on runtime failures (`VERBOSE=1` also works)                                                                                                                                                                                                                          |
| `--apply`         | —              | `fix`: write fixes to disk (default is a dry-run diff; creates `<file>.bak` unless `--no-backup`)                                                                                                                                                                                        |
| `--only NAMES`    | —              | `fix`: comma list restricting which fixers run (`charset,viewport,lang,title,description,canonical,og,og-url,twitter-card,favicon`)                                                                                                                                                      |
| `--url URL`       | —              | `fix`: absolute http(s) URL used for `canonical` / `og-url` fixes                                                                                                                                                                                                                        |
| `--title TEXT`    | —              | `fix`: `<title>` content when missing (else derived from the first `<h1>`)                                                                                                                                                                                                               |
| `--description T` | —              | `fix`: meta description when missing (else derived from page text, ≥40ch)                                                                                                                                                                                                                |
| `--lang LANG`     | —              | `fix`: `<html lang>` value when missing (never guessed)                                                                                                                                                                                                                                  |
| `--og-image URL`  | —              | `fix`: absolute image URL for `og:image`                                                                                                                                                                                                                                                 |
| `--no-backup`     | —              | `fix`: skip the `.bak` copy on `--apply`                                                                                                                                                                                                                                                 |

## Outputs

- `report.json` — machine-readable (scores, counts, findings). Shape: `{ tool, version, url, finalUrl, checkedAt, truncated, scores: { search: { score, band }, ai: { score, band } }, counts: { P0, P1, P2, P3, pass }, findings: [{ id, category, severity, title, evidence, fix }], page: { title, metaDescription, canonical, wordCount, h1, images, internalLinks, externalLinks }, site: { origin, robots, sitemap, sitemapUrls, llms } }`. Formal JSON Schema: `lib/schema-report.json`.
- `report.md` — human-readable: executive summary + verdict, “Fix this first”
  (top 3 with impact/effort/owner), priority actions grouped by category with
  plain-language explanations and copy-paste snippets, “Make this page more
  citable” checklist, what passed, what to monitor.
- `report.html` — shareable single-file report (all pages: `report.html`, `report-2.html`, …):
  same sections as Markdown plus score cards, a “Copy executive summary”
  button, print stylesheet, skip link, and labelled sections for screen
  readers. Fully responsive.
- Multi-page runs add `report-2.json/.md/.html`, etc. plus `index.md` linking all pages
- Multi-page runs with the `html` format also write `index.html` — a site-wide
  dashboard (hero totals, worst-first pages table, top recurring issues).
  Per-page reports link back to it with an “All N pages” breadcrumb.
- `sitemap --json` shape: `{ origin, robotsFound, robotsSitemaps, sitemapFound, sitemapUrl, sitemapUrls, sitemapTruncated, llmsFound }`
- `doctor --json` shape: `{ tool, version, node, nodeOk, fetch }`
- `fix --json` shape: `{ tool, version, applied, files: [{ file, planned: [{ name, findingId, summary, partial }], skipped: [{ name, reason }], verified: [{ name, cleared }], changed, applied, error }] }`

`--out` traversal note: the directory is resolved with `path.resolve()` and
created recursively. Do not point `--out` at a source directory — existing
`report.*` files there are overwritten without prompting.

## Exit codes

- `0` ok (including `--fail-on` when the threshold is not breached, and `fix` dry-runs)
- `1` usage error (bad flags, bad URL/path, unknown command or fixer)
- `2` runtime/fetch failure, `--fail-on` breach, or a `fix` file error (read/write/refusal)
