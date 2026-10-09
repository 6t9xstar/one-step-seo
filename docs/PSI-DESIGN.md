# PageSpeed Insights integration — design (not implemented)

Goal: graduate `P01-html-size` / `P02-img-count` (header/size heuristics)
with real lab + field data, without compromising zero-dep, privacy, or
offline operation.

## Why opt-in

- Needs a Google API key (user-supplied, never ours, never committed).
- Needs network access to `googleapis.com` (offline audits must keep working).
- Adds seconds per page (API latency). Default runs stay instant and local.

## Proposed surface

```bash
# Key from the environment only — never a flag value (flags leak into shell
# history and CI logs):
PSI_API_KEY=... one-step-seo audit https://example.com --pages 5 --psi
```

- `--psi`: after the normal audit, fetch mobile + desktop strategies for
  each audited page (or page 1 only with `--psi-fast`?) and attach:
  - lab: LCP, CLS, INP (or TBT on older API), Speed Index, TTI
  - field: CrUX LCP/INP/CLS p75 where available
- Findings: `P03-psi-lab` (P2, performance) when lab LCP > 2.5s / CLS > 0.1,
  with evidence quoting the exact metric + strategy; missing field data is
  reported as “no CrUX data”, never a failure.
- `report.json`: additive `page.psi: { lab: {...}, field: {...} | null }`
  (schema-report.json extended, optional keys only).
- Quota discipline: one call per page per strategy, sequential with the
  existing `--delay` pause; `429` → warn once and continue without PSI data.

## Key handling (non-negotiable)

1. Read exclusively from `process.env.PSI_API_KEY` (documented in USAGE +
   error message when `--psi` is passed without it).
2. Never log, persist, or echo the key (findings carry metrics, never request
   URLs containing the key).
3. Repo must never contain a real key: extend `tests/config.test.mjs` with a
   scan failing on `AIza[0-9A-Za-z-_]{35}` outside this design doc's redacted
   examples (this file contains none).
4. `.gitignore` already covers `.env`; document `.env` loading is NOT built
   in (users export the variable themselves).

## Implementation sketch (when approved)

- `lib/psi.mjs`: `fetchPsi(url, { key, timeoutMs, strategy })` → normalized
  `{ lab, field } | { error }`. Pure `fetch`, same timeout/UA conventions as
  `lib/fetch.mjs`. Zero new dependencies.
- `bin/cli.mjs`: `--psi` flag (boolean), enrichment step after `toReport`
  (mutate a copy or rebuild — decide at implementation; must not disturb
  deterministic scores), new `P03-psi-lab` / `P03-psi-field` finding IDs in
  `lib/checks.mjs` + meta + CHECKS rows.
- Tests: local-HTTP stub of the PSI JSON shape (fixture, no network),
  missing-key usage error (exit 1), 429 degradation, schema conformance.
- Docs: USAGE section (key setup link to Google Cloud Console, no key
  values), FAQ cost/rate note, secret-safety paragraph in CONTRIBUTING.

## Alternatives considered

- **CrUX API directly**: narrower than PSI (field only); PSI already bundles it.
- **Bundled lab runner (Lighthouse)**: violates zero-dep + browser-free
  constraints. Rejected.
- **Always-on PSI**: rejected — latency, quota, key requirement, and offline
  breakage contradict the core promise.

## Decision log

- Deferred pending maintainer approval and a real API key workflow test.
  This document is the complete spec to implement from.
