# CI

Run headless, zero dependencies — same command locally and in CI.

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
- run: npx one-step-seo audit https://example.com --pages 5 --out ./seo-report
- uses: actions/upload-artifact@v4
  with:
    name: seo-report
    path: seo-report/
    retention-days: 30
```

A copy-paste workflow is kept in this repo — adapt the URL and thresholds:

```yaml
# .github/workflows/seo-audit.yml
name: SEO audit
on:
  pull_request:
  schedule:
    - cron: "0 6 * * 1" # weekly Monday 06:00 UTC
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx one-step-seo audit https://example.com --pages 5 --out ./seo-report --fail-on P0
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: seo-report
          path: seo-report/
          retention-days: 30
```

`if: always()` keeps the reports even when `--fail-on` trips — the
artifact is the debugging evidence.

## Gate on P0 findings (built-in)

```yaml
- run: npx one-step-seo audit https://example.com --pages 5 --out ./seo-report --fail-on P0
```

`--fail-on P0` exits `2` when any audited page has P0 (or higher)
findings — no shell scripting required. Use `--fail-on P1` for a
stricter gate once P0s are resolved.

## Gate on scores (tiny ESM script)

```bash
node --input-type=module -e "import { readFileSync } from 'node:fs'; const r = JSON.parse(readFileSync('./seo-report/report.json','utf8')); if (r.scores.search.score < 70 || r.scores.ai.score < 60) { console.error('SEO gate tripped'); process.exit(2); }"
```

Note: this project is ESM (`"type": "module"`) — `require()` will fail.
Exit `2` matches the CLI's runtime/gate exit code.

## PR comment summary

Paste the executive summary into a review comment so marketers can read
the result without opening artifacts:

```markdown
## SEO audit — <url>

- Search SEO: **87/100 (B)** · AI Visibility: **80/100 (B)**
- Counts: P0=0 P1=1 P2=2 P3=0 pass=33
- Fix this first:
  1. [P1] Thin content (C01-thin) — expand with examples, steps, data.
  2. [P2] llms.txt missing (G01-llms) — add /llms.txt for AI crawlers.
- Full reports: workflow artifacts → `seo-report/` (`report.html` to share).
```

All three lines after the heading come straight from the terminal output
and `report.md`'s Executive summary — no manual analysis needed.

## PR regression checks (base vs. head)

A copy-paste workflow lives at `examples/github-pr-audit.yml` (kept out of
`.github/workflows/` so it never runs here): audit the preview deployment
with `--fail-on P0`, upload artifacts, and comment the score summary — all
with the automatic `GITHUB_TOKEN`, no extra secrets.

For true regression gating across deploys, audit production on a schedule,
keep its `report.json` as an artifact, then compare in PRs:

```bash
npx one-step-seo diff base-report.json seo-report/report.json --fail-on P1
```

`diff` prints score deltas plus NEW / RESOLVED / ESCALATED findings and
exits 2 only on new-or-escalated findings at the threshold — pre-existing
issues never fail the build. It also warns when the two reports were built
under different rules versions (`rulesVersion`), so scoring-rule changes
can't masquerade as site regressions.

## Machine-readable contract

`report.json` follows `lib/schema-report.json` (draft-07). Stable fields
for agents and integrations: `tool`, `version`, `rulesVersion`, `url`,
`finalUrl`, `checkedAt`, `scores.{search,ai}.{score,band}`,
`counts.{P0,P1,P2,P3,pass}`, `findings[].{id,category,severity,title,evidence,fix}`,
`page.*`, `site.*`.
Finding IDs match `^[A-Z]+[0-9]+-[a-z0-9-]+$` (`lib/schema-finding.json`).

See `.github/workflows/seo-dogfood.yml` for a weekly scheduled example.
