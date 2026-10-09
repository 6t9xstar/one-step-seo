# Roadmap

Where one-step-seo is heading. Items are ordered roughly by priority;
nothing here is promised on a date — issues and PRs decide the pace.

## Next (0.4.x)

- [x] `quick` command + interactive mode for beginners
- [x] Executive summary, verdict, and “Fix this first” in reports
- [x] Impact / effort / owner triage labels + copy-paste snippets
- [x] `robots.txt` enforcement with `--force` override
- [x] `llms` command (starter `llms.txt` + AI-crawler `robots.txt` snippet)
- [x] Entity-consistency (`G04`) and `llms.txt`-quality (`G05`) checks
- [x] `report.json` JSON Schema (`lib/schema-report.json`)
- [x] Page-type fixtures + example reports (WordPress, Next.js, product, blog, pricing)

## Later (0.5.x candidates)

- Response-time signal: flag slow Time-to-First-Byte as a P2 performance hint
  (cheap header timing, no browser needed).
- Broken-link check: HEAD-request internal links found during the crawl and
  report 404s as P1 findings (opt-in `--check-links`, off by default for speed).
- Duplicate-content signal: near-identical `<title>`/H1 across crawled pages
  reported as a P1 site-level finding in `index.md`.
- `audit --diff` mode: compare two `report.json` files and print score deltas
  per page (regression tracking without new infrastructure).
- SARIF output (`--format sarif`) for GitHub code-scanning integration.
- More schema generators (VideoObject, JobPosting) and richer FAQ/HowTo
  question extraction from page copy.
- i18n: accept `--lang` hints for non-English answer-first detection.

## Non-goals (staying small on purpose)

- No browser automation, no Lighthouse scores, no lab performance data.
- No rank tracking, no keyword research, no competitor backlink data.
- No hosted service, no accounts, no telemetry — ever.
- No runtime dependencies. Ever.

Have a use case that fits? Open a feature request — see `CONTRIBUTING.md`.
