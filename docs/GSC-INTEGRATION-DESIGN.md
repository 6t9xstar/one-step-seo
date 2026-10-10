# Google Search Console integration — design (not implemented)

Goal: overlay real search-outcome data (impressions, clicks, CTR, position,
index state) onto deterministic audit findings, without turning the CLI
into an authenticated client by default.

## Why design-only for now

GSC access needs OAuth 2.0 user consent or service-account domain-wide
delegation — an order of magnitude more auth surface than the `PSI_API_KEY`
env-var pattern. It also needs review UX (which property? which pages?),
quota handling, and staleness semantics. This document is the complete spec
to implement from when approved.

## Proposed surface

```bash
# Credentials from files/env only — never flags, never committed:
GSC_CLIENT_ID=... GSC_CLIENT_SECRET=... GSC_REFRESH_TOKEN=... \
  one-step-seo audit https://example.com --pages 5 --gsc https://example.com/
```

- `--gsc PROPERTY`: a Search Console property (URL-prefix or domain). The
  CLI performs the OAuth refresh-token flow headlessly (no browser needed
  after first consent) and proceeds without GSC data if auth fails (warn
  once, exit code unchanged — audits must never fail for lack of GSC).
- Enrichment (additive, clearly labeled as observed data):
  - `searchanalytics.query`: top queries per audited URL (impressions,
    clicks, CTR, position) → new `page.gsc` section in `report.json`.
  - URL Inspection API: index state per URL → corroborates/contradicts our
    crawlability findings (a page we call healthy but Google never indexed
    gets a P1 `GSC-not-indexed` note, evidence-quoted from the API).
  - Sitemaps API: submitted vs. indexed counts → corroborates `T06`.
- New finding (only when GSC data is present): `GSC-*` IDs are reserved;
  first candidate is index-state mismatch. Never invents data: every
  GSC-backed line cites the API response timestamp.

## Credential handling (non-negotiable)

1. Three env vars only (`GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`,
   `GSC_REFRESH_TOKEN`); document Google Cloud Console setup, no values.
2. Tokens live in process memory; never logged, persisted, or embedded in
   reports (report `page.gsc` carries metrics + fetched-at, never tokens).
3. Repo must never contain real credentials: extend the secret scan
   (see PSI-DESIGN.md) with `ya29\.` access-token patterns outside this
   design doc's redacted examples (this file contains none).
4. `.gitignore` already covers `.env`; no dotenv loading built in.

## Scope boundaries

- Read-only GSC scopes (`webmasters.readonly`) — the tool never submits
  sitemaps, never requests indexing, never changes anything server-side.
- Offline-first preserved: `--gsc` absent (the default) behaves exactly as
  today; `--gsc` with failing auth degrades to a warning, never exit 2.
- No rank tracking, no competitor data, no keyword research — outcome
  overlay only. Correlation language (“pages fixing X also gained Y”)
  requires longitudinal data we do not store; never claim causation.

## Implementation sketch (when approved)

- `lib/gsc.mjs`: token refresh, `searchanalytics.query` (page-filtered,
  last 28d), `urlInspection.index.inspect` (batched, quota-aware),
  `sitemaps.list`. Same timeout/UA conventions as `lib/fetch.mjs`.
  Zero new dependencies (raw `fetch` + `URLSearchParams`).
- `bin/cli.mjs`: `--gsc PROPERTY` flag, enrichment step post-crawl,
  `GSC-*` findings, `page.gsc` + schema-report.json extension.
- Tests: local-HTTP stubs of all three endpoints (no network), missing-key
  usage error (exit 1), auth-failure degradation, secret-scan coverage.
- Docs: USAGE setup walkthrough (Cloud Console → OAuth consent → env),
  FAQ quota note, GSC.md crosswalk gains an “observed in GSC” column.

## Alternatives considered

- **Service-account only**: simpler headless auth but requires domain-wide
  delegation (Workspace admin) — offered as an option, not the default.
- **API-key access**: GSC has no API-key tier; impossible. (PSI differs.)
- **Always-on GSC**: rejected — contradicts offline-first + zero-config.
