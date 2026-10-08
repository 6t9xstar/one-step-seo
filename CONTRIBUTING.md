# Contributing to one-step-seo

Thanks for helping. This project stays small on purpose: zero runtime dependencies, one command, two scores.
Tooling (ESLint, Prettier, TypeScript, @types/node) lives in `devDependencies` only and never ships.

## Quick start

```bash
git clone https://github.com/6t9xstar/one-step-seo.git
cd one-step-seo
node --version   # needs >= 18
npm install
npm run check    # typecheck + lint + format check + tests
node bin/cli.mjs audit https://example.com --out ./seo-report
```

## How to contribute

1. Fork → branch (`feat/<short-name>` or `fix/<short-name>`).
2. Add or update a check in `lib/` with a fixture in `tests/fixtures/`.
3. Add/extend a test in `tests/*.test.mjs` (`npm test` must pass).
4. Update `docs/CHECKS.md` if you added a check.
5. If you touched the generator inputs, run `npm run examples` so `examples/` stays fresh.
6. Open a PR using the template. Keep diffs focused.

## Commit style

Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.

## PR checklist

- [ ] `npm run check` passes (typecheck + lint + format + tests, Node 18/20/22 in CI)
- [ ] New check has fixture + test + docs line
- [ ] No new runtime dependencies (zero-dep policy — justify any exception; devDeps need a reason too)
- [ ] JSDoc annotations on new/changed functions so `tsc --checkJs` stays clean
- [ ] No invented SEO claims; each finding has evidence + fix
- [ ] README updated only if user-facing behavior changed

## Good first issues

Look for the `good first issue` label: new schema generators, new GEO signals, docs examples, extra fixtures.

## Questions

Open a Discussion or an issue — do not email drive-by patches with secrets inside.
