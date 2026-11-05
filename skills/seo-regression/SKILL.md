---
name: seo-regression
description: Compare baseline and candidate report.json files using one-step-seo diff, enforce CI/CD quality gates with --fail-on, and export SARIF 2.1.0 and hardened CSV reports.
---

# seo-regression — CI/CD SEO Regression & Release Gating

## 1. Description & Activation Criteria

Activate `seo-regression` when the user wants to:

- Compare two audit runs (`baseline.json` vs `candidate.json`) to detect score deltas, **NEW** findings, **RESOLVED** findings, and **ESCALATED** severities (`one-step-seo diff`).
- Gate pull requests or CI/CD deployments using `--fail-on P0|P1|P2` so builds fail only when regressions occur.
- Export `report.sarif` (OASIS SARIF 2.1.0 for GitHub Code Scanning) or formula-injection-hardened `report.csv` for spreadsheet tracking.

## 2. Inputs & Prerequisites

- **For `diff`**: Two valid `one-step-seo` JSON reports (`old-report.json` and `new-report.json`).
- **For CI export**: `--format html,md,json,sarif,csv` and optional `--fail-on <P0|P1|P2>`.

## 3. Step-by-Step Workflow

1. **Generate baseline and candidate reports**:
   - Baseline (e.g., `main` branch or production): `npx one-step-seo page https://example.com --out ./seo-baseline`
   - Candidate (e.g., PR preview or local `./dist` build): `npx one-step-seo page ./dist/index.html --offline --out ./seo-candidate`
2. **Run regression diff (`one-step-seo diff`)**:
   - Execute `npx one-step-seo diff ./seo-baseline/report.json ./seo-candidate/report.json --fail-on P1`.
   - Note that `diff --fail-on P1` exits with code `2` **only** if there are `NEW` or `ESCALATED` findings at `P0` or `P1` — pre-existing `P1` issues do not block the build.
3. **Check `rulesVersion` compatibility**:
   - Inspect `rulesVersionChanged` in the `diff` output. If `oldRulesVersion !== newRulesVersion`, note that score deltas may reflect updated scoring rules rather than site changes.
4. **Export SARIF 2.1.0 or CSV when requested**:
   - Run `npx one-step-seo audit <target> --format html,md,json,sarif,csv --out ./seo-report`.
   - Upload `report.sarif` to GitHub Code Scanning (`github/codeql-action/upload-sarif`).

## 4. Tools & CLI Commands

```bash
# Compare two report.json files and exit 2 if any new/escalated P0 or P1 findings appear
npx one-step-seo diff ./baseline/report.json ./candidate/report.json --fail-on P1

# Machine-readable JSON diff for PR comment bots
npx one-step-seo diff ./baseline/report.json ./candidate/report.json --json

# Export all formats including SARIF 2.1.0 and RFC 4180 CSV
npx one-step-seo page https://example.com --format html,md,json,sarif,csv --out ./seo-report
```

## 5. Evidence Requirements

- Report the exact Search SEO delta (`old -> new (+/-delta)`) and AI Visibility delta (`old -> new (+/-delta)`).
- List every `NEW`, `RESOLVED`, and `ESCALATED` finding with its `id`, `severity` (or `oldSeverity -> newSeverity`), and `title`.
- Report whether `rulesVersionChanged` is `true` or `false`.

## 6. Expected Outputs

1. **Regression Summary Table**: Score deltas, count of new/resolved/escalated findings, and CI gate pass/fail status (`exitCode 0` vs `exitCode 2`).
2. **CI Workflow Snippet**: GitHub Actions step running `one-step-seo diff` or uploading `report.sarif`.

## 7. Limitations & External Data

- **Single-page `report.json` inputs**: `one-step-seo diff` compares two individual `report.json` files validated by `isReport()`.
- **CSV sanitization**: `report.csv` prefixes cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r` (and DDE patterns) with a leading apostrophe (`'`) to prevent spreadsheet formula injection (CWE-1236), while `report.json` preserves raw values unchanged.

## 8. Safety & Approval Rules

- In GitHub Actions workflows, follow least-privilege permissions (`permissions: contents: read`, or `security-events: write` only on the job uploading SARIF) and pin third-party actions by commit SHA.

## 9. Examples

```bash
# Gate a local build against a saved baseline report
npx one-step-seo page ./dist/index.html --offline --out ./candidate
npx one-step-seo diff ./baseline/report.json ./candidate/report.json --fail-on P1
```
