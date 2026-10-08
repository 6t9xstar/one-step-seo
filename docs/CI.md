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

See `.github/workflows/seo-dogfood.yml` for a weekly scheduled example.
