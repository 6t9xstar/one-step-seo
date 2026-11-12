# Operations: deployment, scheduling, maintenance, backup

one-step-seo is a zero-dependency Node.js (≥ 18) CLI and library. There is no server, database or account to run. "Deploying" it means installing it where your audits, fixes and monitors run: a laptop, a CI runner or a small VM.

## Install

```bash
npm install -g one-step-seo   # global CLI
npx one-step-seo doctor       # or run without installing
npm install one-step-seo      # as a library / project devDependency
```

`one-step-seo doctor` checks the following and prints a status for each:

- Node version
- whether `fetch` is available
- the state directory
- the config file in use
- whether `PSI_API_KEY` / `ONE_STEP_SEO_WEBHOOK` are set (values are never printed)

Add `--check-config` to validate the config file; an invalid file exits 1.

## Configuration and secrets

| Setting                | Where                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Flag defaults          | `one-step-seo.config.json` (commit it; it cannot contain secrets — such keys are rejected) |
| PageSpeed Insights key | `PSI_API_KEY` env var                                                                      |
| Monitor webhook        | `ONE_STEP_SEO_WEBHOOK` env var (or `--webhook`; never in the config file)                  |
| State location         | `ONE_STEP_SEO_STATE_DIR` env var or `--state-dir`                                          |

In CI, store `PSI_API_KEY` and `ONE_STEP_SEO_WEBHOOK` as encrypted secrets.

## CI quality gate (GitHub Actions)

```yaml
name: seo
on: [pull_request]
jobs:
  seo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci && npm run build # your site build → ./dist
      - run: npx one-step-seo audit ./dist --pages all --format md,json,sarif --fail-on P1
      - run: npx one-step-seo fix ./dist --url https://example.com # dry-run diff in the log
```

To gate a deploy on "nothing got worse", run `verify` against the audit stored from the previous deploy:

```bash
npx one-step-seo verify https://staging.example.com --baseline ./previous-audit --fail-on P1
```

See [CI.md](./CI.md) for SARIF upload and diff-based gating.

## Scheduled monitoring

Pick one of these options.

**Run continuously** in a long-lived process, for example under a process manager or in tmux:

```bash
one-step-seo monitor https://example.com --interval 1440 --state-dir /var/lib/one-step-seo
```

**cron** (Linux/macOS), daily at 06:00:

```cron
0 6 * * * ONE_STEP_SEO_WEBHOOK=https://hooks.slack.com/services/XXX /usr/bin/npx --yes one-step-seo monitor https://example.com --state-dir /var/lib/one-step-seo >> /var/log/one-step-seo.log 2>&1
```

**Windows Task Scheduler:**

```powershell
schtasks /Create /SC DAILY /ST 06:00 /TN one-step-seo-monitor /TR "cmd /c npx --yes one-step-seo monitor https://example.com --state-dir C:\one-step-seo"
```

**GitHub Actions schedule.** Persist the state directory between runs with `actions/cache`, otherwise every run is a baseline:

```yaml
on:
  schedule: [{ cron: "0 6 * * *" }]
jobs:
  monitor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: actions/cache@v4
        with:
          path: .one-step-seo
          key: seo-monitor-${{ github.run_id }}
          restore-keys: seo-monitor-
      - run: npx --yes one-step-seo monitor https://example.com
        env:
          ONE_STEP_SEO_WEBHOOK: ${{ secrets.SEO_WEBHOOK }}
```

Exit code 2 means a critical change, or a warning when `--fail-on P1` is set. Use it to fail the job or page someone.

## Backup and restore

All state is plain files under the state directory (default `./.one-step-seo`):

- `fix-history/` holds every applied fix session: a manifest with SHA-256 hashes plus the original files.
- `monitor/<host>/` holds the snapshots and the change log.

To back up, copy the directory:

```bash
tar czf one-step-seo-state-$(date +%F).tgz .one-step-seo
```

To restore, extract it back to the same path (or point `--state-dir` at it). Sessions and snapshots are discovered by directory listing, so no index needs rebuilding.

`fix --apply` also leaves a `<file>.bak` next to each changed file. That backup is independent of the state directory, so a fix can still be undone by hand if the state directory is lost.

Before a rollback overwrites anything, it compares each file's current hash with the hash recorded after the fix. If a file changed since then, the rollback stops and lists it. Re-run with `--force` only if you mean to discard those later edits.

## Maintenance

- **Retention.**
  - Monitor snapshots are pruned automatically to `--keep` (default 60 per site).
  - The change log keeps the last 200 runs.
  - Fix sessions are never pruned automatically. Delete old `fix-history/<id>/` folders once you no longer need to roll them back.
- **Upgrades.** Reports carry `version` and `rulesVersion`. When the rules version changes between two reports, `diff`/`verify` may show differences that come from new or changed checks rather than site changes. `diff` says so explicitly.
- **Politeness.** Crawls honour robots.txt (including query-string rules and sitemap entries), keep to the start host, and pause between batches (`--delay`, default 250 ms). Only audit sites you are allowed to crawl. `--force` overrides robots.txt and must be a deliberate choice.
- **Network safety.** `--block-private-ips` refuses private, loopback and cloud-metadata addresses. Use it when URLs come from untrusted input, for example a shared service wrapping this tool. Responses are size-capped, and compressed bodies are decoded with an output cap.

## Release checks (maintainers)

```bash
npm run check               # typecheck, lint, format, package verification, tests
npm run test:coverage:gate  # lines ≥ 85 %, branches ≥ 80 %, functions ≥ 85 %
npm run examples:check      # committed example reports match the generator
npm pack --dry-run          # inspect the published file list
```
