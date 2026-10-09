# Troubleshooting

## `Audit failed: no pages could be fetched.` (exit 2)

The start URL never returned usable HTML. Check, in order:

1. The URL loads in a browser (DNS, TLS, status 200).
2. It is `http(s)` — other schemes exit 1, not 2.
3. It serves `text/html` — PDFs, images, and JSON APIs are not auditable
   pages (`T04-content-type` would flag them anyway).
4. The server answers within `--timeout` (default 15 s; slow hosts may need
   `--timeout 30000`).
5. Redirects resolve within 5 hops — loops report `too many redirects`.

## `robots.txt disallows auditing … — crawl skipped`

The site asks crawlers not to visit that path. The audit wrote a minimal
report with a `T05-robots-disallow` P1 finding instead of crawling. If you
own the site or have permission, re-run with `--force`.

## A page times out but loads in my browser

Likely bot protection (WAF, Cloudflare challenge) distinguishing the audit
User-Agent from real browsers. Confirm with `--debug` (shows per-request
timings and statuses), then allowlist the `one-step-seo/` User-Agent or audit
a staging host without the challenge.

## `--fail-on` trips in CI but the site looks fine

Read `report.md`'s “Fix this first” — commonly `T01-https` (preview deploys
over plain HTTP) or `T02-status` (deploy preview needs auth). Gate on the
production URL, or gate `--fail-on P1` once P0s are resolved.

## `examples: no drift` fails after I changed a check

Expected: fixtures changed the generator inputs. Run `npm run examples` to
regenerate `examples/`, inspect the diff, and commit it alongside your change
(the PR template requires this).

## Coverage gate fails on branches

`npm run test:coverage:gate` needs Node 22+ for threshold flags and enforces
85/80/85 (lines/branches/functions). New code must bring tests covering both
sides of every branch — pure functions in `lib/` with unit tests in `tests/`
is the established pattern.

## Windows: `npm run check` / CLI crashes

Known-good on Windows + Node 18/20/22/24. If sockets hang on exit, make sure
you are on the latest `main` (abrupt `process.exit` on open sockets was
replaced with `process.exitCode`). Report leftovers with your Node version
and full command in a bug report.

## `quick` audits fewer pages than I asked for

`quick` caps at `--pages` (default 5) _or_ however many pages the crawl
discovers, whichever is smaller. A 2-page site yields 2 reports — that is
correct, not a bug.

## Still stuck?

Open a bug report (`.github/ISSUE_TEMPLATE/bug_report.yml`) with version,
Node version, full command, and expected vs. actual output.
