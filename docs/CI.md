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
```

Fail the build under a threshold with a tiny gate script:

```bash
node -e "const r=require('./seo-report/report.json'); if(r.scores.search.score<70||r.scores.ai.score<60){console.error('SEO gate tripped');process.exit(3)}"
```

See `.github/workflows/seo-dogfood.yml` for a weekly scheduled example.
