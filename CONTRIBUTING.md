# Contributing to one-step-seo

Thanks for helping. This project stays small on purpose: zero dependencies, one command, two scores.

## Quick start

```bash
git clone https://github.com/your-org/one-step-seo.git
cd one-step-seo
node --version   # needs >= 18
npm test
node bin/cli.mjs audit https://example.com --out ./seo-report
```

## How to contribute

1. Fork → branch (`feat/<short-name>` or `fix/<short-name>`).
2. Add or update a check in `lib/` with a fixture in `tests/fixtures/`.
3. Add/extend a test in `tests/*.test.mjs` (`node --test tests/` must pass).
4. Update `docs/CHECKS.md` if you added a check.
5. Open a PR using the template. Keep diffs focused.

## Commit style

Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.

## PR checklist

- [ ] `npm test` passes on Node 18 + 20
- [ ] New check has fixture + test + docs line
- [ ] No new dependencies (zero-dep policy — justify any exception)
- [ ] No invented SEO claims; each finding has evidence + fix
- [ ] README updated only if user-facing behavior changed

## Good first issues

Look for the `good first issue` label: new schema generators, new GEO signals, docs examples, extra fixtures.

## Questions

Open a Discussion or an issue — do not email drive-by patches with secrets inside.
