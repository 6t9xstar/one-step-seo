# SEO platform: audit → fix → verify → report → monitor

Since v0.12, one-step-seo runs the whole SEO workflow from one CLI. It is built from three engines, and each one also works on its own:

| Engine               | Module                                  | What it does                                                                                                                                                                                   |
| -------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SEO Intelligence** | `lib/crawl.mjs`, `lib/intelligence.mjs` | Crawls the site and runs every page check. Adds site-wide analysis (issues `X01`–`X27`), category scores, content topics, internal-link suggestions, refresh briefs and competitor comparison. |
| **SEO Auto-Fix**     | `lib/fix.mjs`, `lib/autofix.mjs`        | Writes fix plans for live sites. Applies safe, additive fixes to local source with a backup, verifies them on disk, records history and supports rollback.                                     |
| **SEO Monitoring**   | `lib/monitor.mjs`                       | Takes a snapshot per run and compares it with the previous one. Change alerts are levelled (critical, warning, info) and can be sent to a webhook.                                             |

Reporting (`lib/site-report.mjs`, `lib/pdf.mjs`) turns their output into Markdown, CSV and PDF reports. The PDF writer is built in and has no dependency.

## The one-command workflow

```bash
# 1. Audit: full crawl, link verification, site-wide analysis, PDF + CSV
one-step-seo audit https://example.com --deep --format html,md,json,csv,pdf

# 2a. Live site: a fix plan (nothing is modified)
one-step-seo fix https://example.com --all --safe-only

# 2b. Your source / build output: preview, then apply safe fixes
one-step-seo fix ./dist --url https://example.com --lang en          # dry run + diff
one-step-seo fix ./dist --url https://example.com --lang en --apply  # backup + write + verify

# 3. Deploy, then confirm against the audit from step 1
one-step-seo verify https://example.com --baseline ./seo-report

# 4. Client / developer report from the stored audit
one-step-seo report ./seo-report --format pdf,md,csv --client "Acme Ltd" --audience client

# 5. Watch for regressions (run on a schedule, or keep it running)
one-step-seo monitor https://example.com --interval 1440 --webhook "$SLACK_WEBHOOK_URL"
```

### `audit`

| Flag                      | Effect                                                                                                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--deep`                  | Same as `--all --check-links`. Crawls up to the 1,000-page cap unless `--pages` is given, using hybrid sitemap and link discovery.                                                                                                                       |
| `--technical`             | Runs only the technical, security and performance checks.                                                                                                                                                                                                |
| `--on-page`               | Runs only the on-page, schema, content-architecture and accessibility checks.                                                                                                                                                                            |
| `--competitors URL[,URL]` | Crawls up to 3 competitor sites, 5 pages each, and always honours their robots.txt. It compares page structure and the terms their pages emphasise that yours do not. This is **lexical**: there is no search volume, ranking, traffic or backlink data. |

Multi-page audits write, in addition to the existing per-page reports:

| File                                 | Content                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `site-intelligence.json`             | Every site-level issue with affected URLs, category scores, content analysis, the URL-parameter inventory (`crawlBudget`) and the scoring method |
| `site-report.md` / `site-report.pdf` | Readable report                                                                                                                                  |
| `site-issues.csv`                    | One row per issue × URL, for spreadsheets                                                                                                        |

Site-wide issue IDs:

| ID  | Issue                                | ID  | Issue                                                      |
| --- | ------------------------------------ | --- | ---------------------------------------------------------- |
| X01 | Broken internal URLs                 | X15 | hreflang errors                                            |
| X02 | Redirect chains                      | X16 | Keyword cannibalisation (heuristic)                        |
| X03 | Links to redirecting URLs            | X17 | Thin content                                               |
| X04 | Orphan pages                         | X18 | URL structure                                              |
| X05 | Pages > 3 clicks deep                | X19 | Slow responses (> 2 s, measured from the auditing machine) |
| X06 | Duplicate titles                     | X20 | http:// internal links on an https site                    |
| X07 | Duplicate descriptions               | X21 | Stale content (no update signal for 18 months)             |
| X08 | Duplicate content                    | X22 | Made-up URLs return HTTP 200 (soft 404)                    |
| X09 | Near-duplicates (heuristic)          | X23 | Made-up URLs under one section return HTTP 200             |
| X10 | Sitemap URLs that fail               | X24 | Crawler requests turned away (`--bots`)                    |
| X11 | noindex pages in sitemap             | X25 | Crawlers get a different page than browsers (`--bots`)     |
| X12 | Non-canonical URLs in sitemap        | X26 | Googlebot smartphone gets less than desktop (`--bots`)     |
| X13 | Indexable pages missing from sitemap | X27 | URL parameters that multiply crawlable URLs (heuristic)    |
| X14 | Canonical conflicts                  |     |                                                            |

X22 and X23 come from two extra requests a multi-page `audit` sends after the crawl: one for a made-up URL at the root (`/url-trap-probe-<random>`) and one inside the first section it found. A healthy site answers both with 404 or 410. The probes respect `robots.txt` and `--delay`, are never sent for single-page audits, and `--no-probes` turns them off.

X24–X26 come from the opt-in crawler check (`audit --bots`, or the `bots` command on its own): up to 10 pages are requested as Googlebot, Bingbot, Applebot and the AI crawlers and compared with a browser. Severity follows the most important crawler involved: search P1, AI search and assistants P2, training P3. The requests come from the auditing machine, so treat these as leads to confirm in the CDN or firewall.

X27 (crawl budget) needs no extra requests. It reads the internal links of every audited page, including links the crawl skipped (crawler traps, robots.txt, the page cap), and groups those URLs by query parameter. Page-builder widget ids are folded into one parameter (`e-page-0b1537f` → `e-page-*`). Parameters named for pagination, filters, sorting, tracking, sessions or site search count as crawl traps, and so does any other parameter on 25 or more URLs. For each parameter it records the URL count, the highest number seen and 3 example URLs. URLs that robots.txt already disallows for Googlebot are counted but not reported. It is P2 from 25 crawlable trap URLs and P3 below that. The recommendation drafts robots.txt `Disallow` lines for the `User-agent: *` group, anchored on `?` and `&` (`Disallow: /*?orderby=` and `Disallow: /*&orderby=`), but these are suggestions only: robots.txt is never written. It also says when canonical tags or `noindex` fit better, because blocking pagination or filter URLs can hide pages that are only linked from them. `site-intelligence.json` holds the whole inventory under `crawlBudget`, and `site-report.md` lists it under "URL parameters in internal links". X18 no longer lists "3+ query parameters" for a URL that carries an X27 parameter.

Issues marked _heuristic_ are labelled that way in every output.

### `fix`

Every finding is classified as one of three fix types:

- **safe**: mechanical and additive. Examples: charset, viewport, a missing canonical (pointing to the page itself), Open Graph and Twitter tags copied from the page's own title and description, a favicon link, WebPage JSON-LD built from the page's own metadata, a sitemap.xml listing indexable pages, and an allow-all robots.txt or a `Sitemap:` line.
- **approval**: changes strategy or content. Examples: noindex, a canonical that points elsewhere, duplicate titles or content, redirects, thin content. These are listed in the plan and never applied automatically.
- **manual**: needs a person or infrastructure. Examples: HTTPS, performance, copy.

Rules the engine follows:

- `fix <url>` writes `fix-plan.json` and `fix-plan.md`. Every entry has `status: proposed` and `verification: not-applied`. A live site is never modified, and `--apply` on a URL is refused.
- `fix <path>` is a dry run that prints a unified diff. `--apply` does the following:
  1. copies each file to `<file>.bak`, plus a copy in the fix session;
  2. writes it atomically;
  3. **reads it back from disk** and re-runs the fixers, so a fix is reported as cleared only if it really is;
  4. records the Search score before and after and the findings resolved.
- Language (`--lang`), og:image and alt text are never guessed. Alt-text suggestions are printed for review and never applied.
- An existing `sitemap.xml` is only appended to (entries are never removed). An existing `robots.txt` only gets a `Sitemap:` line; crawl rules are never changed.
- `fix --history` lists sessions. `fix --rollback [--session ID]` restores backups and deletes files the fix created. If a file was edited after the fix, rollback refuses unless you add `--force`, so later work is not lost.

### `verify`

`verify` re-audits the pages stored in a baseline folder and sorts each finding into one of four groups:

- **VERIFIED FIXED**: the finding is gone, or the same check now passes.
- **NEW / WORSE**: a new finding, or an existing one at a higher severity.
- **STILL OPEN**
- **not re-checked**: for example PSI or link checks when the original audit used flags that this run did not.

It writes `verification.json` (to `--out` if given, otherwise to the baseline folder). It exits **2** if there is a regression at or above `--fail-on` (default P1) or a page can no longer be fetched.

### `report`

The source can be any of:

- an existing audit folder (rendered from its JSON, plus `site-intelligence.json` and `verification.json` if present);
- a local directory (audited offline);
- a URL (audited: 25 pages by default with hybrid discovery).

Options:

- `--audience client` gives a plain-language summary.
- `--audience developer` adds every URL and the evidence.
- `--brand` and `--client` set the report header.

The report includes monitoring history (URLs) and fix sessions (local targets) when they exist. When data is missing, the report says so; no placeholder values are used.

### `monitor`

Each run crawls up to 25 pages by default (`--pages` / `--deep` to change). It saves a snapshot to `<state-dir>/monitor/<host>/` and compares it with the previous one.

| Level    | Changes                                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| critical | site down, robots.txt or sitemap removed, page broken, noindex added, canonical moved away, title removed, score drop ≥ 25, new P0 |
| warning  | robots.txt changed, title changed, page missing, schema removed, score drop ≥ 10, new P1, response time doubled, new broken URL    |
| info     | descriptions, H1, content changes, new pages, resolved issues, recoveries                                                          |

Exit code 2 is triggered by critical changes. `--fail-on P1` also triggers it on warnings, and `--fail-on P2` on any change. `--interval MIN` keeps running and re-checks every MIN minutes; Ctrl+C stops it cleanly. `--history` lists snapshots, and `--keep N` limits how many are kept (default 60).

**Webhook:** use `--webhook URL` or the `ONE_STEP_SEO_WEBHOOK` env var. The payload is JSON with a Slack-compatible `text` field and the full change list. It is sent only when a run has critical or warning changes (info-only runs stay quiet). The URL is never printed or logged, and it is refused in the config file.

## Project config file

Put `one-step-seo.config.json` in the working directory, or pass `--config FILE`; `--no-config` ignores it. Keys are the camelCase form of the flags. Command-line flags always win over the file.

```json
{
  "pages": 200,
  "crawl": "auto",
  "format": ["html", "md", "json", "pdf"],
  "checkLinks": true,
  "stateDir": ".one-step-seo",
  "brand": "Your Agency",
  "keep": 90
}
```

Keys that look like credentials are rejected. This covers `*key*`, `*token*`, `*secret*`, `*password*`, `*credential*` and `webhook`. Keep secrets in environment variables. `one-step-seo doctor --check-config` validates the file and exits 1 if it is invalid.

## State directory

Fix sessions and monitor snapshots live in `./.one-step-seo/`. Override it with `--state-dir DIR` or `ONE_STEP_SEO_STATE_DIR`. The directory is plain JSON plus file copies:

```
.one-step-seo/
  fix-history/<session-id>/manifest.json   # files, hashes, fixes, verification, scores
  fix-history/<session-id>/0000-index.html # backup copies
  monitor/<host>/snapshot-<time>.json      # one per monitor run (pruned to --keep)
  monitor/<host>/changes.json              # change log (last 200 runs)
```

It is in `.gitignore`. See [OPERATIONS.md](./OPERATIONS.md) for backup and restore.

## Integration status

| Integration                          | Status                | What is needed                                                                                           |
| ------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------- |
| PageSpeed Insights / Core Web Vitals | **Working** (`--psi`) | `PSI_API_KEY` env var (free key from Google Cloud)                                                       |
| Webhook alerts (Slack-compatible)    | **Working**           | A webhook URL via `--webhook` / `ONE_STEP_SEO_WEBHOOK`                                                   |
| Google Search Console                | Not integrated        | OAuth client and property access. Design notes: [GSC-INTEGRATION-DESIGN.md](./GSC-INTEGRATION-DESIGN.md) |
| Google Analytics 4                   | Not integrated        | GA4 Data API service account and property ID                                                             |
| Keyword volume / difficulty          | Not integrated        | A keyword data provider account (none is bundled; volumes are never estimated)                           |
| Rankings                             | Not integrated        | A SERP/rank-tracking provider                                                                            |
| Backlinks                            | Not integrated        | A backlink index provider                                                                                |
| JavaScript rendering                 | Not supported         | A headless browser, deliberately out of scope (zero dependencies)                                        |

Without these providers, the tool reports only what it measures by crawling. It does not show search volumes, rankings, traffic or backlink counts, and it does not use placeholder figures.

## Limitations

- **CLI, not hosted.** This is a local, single-user CLI and library. Multi-user workspaces, roles, a database and a web dashboard are not part of this project. The state directory is per-machine.
- **Raw HTML only.** Pages that render their content with client-side JavaScript are analysed as served. Such app shells are detected and reported as `T18-js-rendered` (P1), and an HTML page served at `/sitemap.xml` or `/llms.txt` is not mistaken for those files — but the rendered content itself is not audited.
- **One location.** Response times are measured from the machine running the audit, not from real users. Use `--psi` for Core Web Vitals field data.
- **Heuristics are labelled.** Near-duplicate, cannibalisation and term-gap analysis are text heuristics.
