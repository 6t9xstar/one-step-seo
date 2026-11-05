# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[SemVer](https://semver.org/).

## [0.9.1] - 2026-11-05

### Fixed

- **Site Dashboard & Report Missing-Score Handling (`lib/report.mjs`).**
  - Added `isValidScore()` (`typeof v === "number" && Number.isFinite(v)`) to distinguish valid numeric scores (including legitimate `0` scores) from `null`, `undefined`, `NaN`, and `Infinity`.
  - Fixed `renderSiteIndex()` so missing scores render `<span class="badge">N/A</span>` with `data-s=""` / `data-a=""` instead of defaulting to `0 F` and `data-s="0"`.
  - Fixed empty valid-score aggregation in `renderSiteIndex()` so `avgSearch` and `avgAi` resolve to `null` (rendering `N/A` in hero gauges and summary captions with `(0/N valid pages)`) when no pages have valid scores.
  - Excluded pages without valid scores from `Lowest-Performing Page` and `Highest-Performing Page` ranking cards and placed missing-score rows after valid numeric rows during initial and client-side column sorting while preserving real `0` (`0 F`) scores.
  - Updated `verdictFor()`, `renderMarkdown()`, and `renderHtml()` to guard missing scores with `isValidScore()` so unavailable scores never trigger false `< 60` verdicts or `null/100` labels.
- **Agent Skill Contract Alignment (`skills/*/SKILL.md` & `lib/skills.mjs`).**
  - Reconciled `skills/geo-optimization/SKILL.md` and `skills/seo-audit/SKILL.md` by replacing nonexistent `scores.ai.details.signals` references with `one-step-seo ai <url> --json` (`signals.*`), `report.md` (`## Make this page more citable`), and `citableChecklist(report)`.
  - Replaced nonexistent `report.page.titleLength`, `report.page.metaDescriptionLength`, `report.page.schemaTypes`, `report.site.llmsTxt`, and `report.site.aiCrawlersBlocked` references across `skills/*/SKILL.md` with canonical `lib/schema-report.json` paths (`report.page.title` / `metaDescription`, `report.site.llms`, and finding `evidence` on `S01-present` / `G02-ai-blocked`).
  - Aligned check thresholds in `skills/onpage-optimization/SKILL.md`, `skills/content-quality/SKILL.md`, `skills/core-web-vitals/SKILL.md`, `skills/internal-linking/SKILL.md`, `skills/technical-seo/SKILL.md`, and `skills/schema-validation/SKILL.md` with `THRESHOLDS` in `lib/checks.mjs` and `REQUIRED_PROPS` in `lib/schema.mjs`.
  - Registered documented CLI skill aliases (`structured-data`, `cwv`, `a11y`, `international-seo`, `i18n`) and aligned check severity metadata in `lib/skills.mjs`.
- **Documentation & Reporting Architecture Consistency (`README.md`, `SKILL.md`, `docs/USAGE.md`, `docs/SCORING.md`).**
  - Added `csv` to `--format` documentation and documented `--skills`, `--exclude-skills`, `--offline`, and `report.csv` in `docs/USAGE.md`.
  - Added `G10-author` and `G11-semantic-content` to `GEO_ONLY_IDS` in `docs/SCORING.md`.
  - Clarified the separation between the 13 Agent Skill playbooks (`skills/*/SKILL.md`) across 7 domains and the 14 executable CLI skill groups (`lib/skills.mjs`) across 9 categories in `README.md` and `SKILL.md`.
  - Corrected rule IDs, audit profile names (`product`, `docs`, `blog`, `home`), `--no-backup` flag syntax, and `one-step-seo diff` references in `README.md`.
- **Security & Accessibility Hardening (`lib/report.mjs`).**
  - Hardened `esc()` to escape single quotes (`'` -> `&#39;`) in addition to `&`, `<`, `>`, and `"`.
  - Added keyboard accessibility (`tabindex="0"`, `role="button"`, `aria-sort`, `Enter`/`Space` sorting, `/` and `Escape` search shortcuts) and polite live status announcements (`role="status" aria-live="polite"`) to the multi-page site dashboard (`index.html`).

## [0.9.0] - 2026-11-05

### Added

- **Structured 13-Skill Agent Library (`skills/*/SKILL.md` & `lib/skills.mjs`).**
  - Expanded `skills/` from 2 sub-skills into 13 standardized, 9-section Agent Skill playbooks across 7 domains:
    - Core Workflow: `seo-audit`, `seo-fix`
    - Technical SEO: `technical-seo`, `sitemap-robots`
    - On-Page & Content: `onpage-optimization`, `content-quality`, `duplicate-content`, `internal-linking`
    - GEO / AEO / AI Search: `geo-optimization`, `llms-txt`
    - Structured Data: `schema-validation`
    - Performance & Quality: `core-web-vitals`
    - Monitoring & Reporting: `seo-regression`
  - Expanded programmatic CLI skills registry (`SKILLS` in `lib/skills.mjs`) to 14 executable skills with alias resolution (`onpage-optimization`, `schema-validation`, `ecommerce-seo`, `geo-optimization`, `core-web-vitals`, `local-seo`, `content-quality`), `AGENT_SKILLS` catalog metadata, and `matchesSkillChecks()` supporting prefix rules (`S02-*`) and base-ID pass variants (`O01-title`).
- **Expanded Schema.org Required-Property Validation (`lib/schema.mjs`).**
  - Added required property validation in `REQUIRED_PROPS` for `LocalBusiness` (`name`), `WebSite` (`name`), `HowTo` (`name`), `JobPosting` (`title`), `Course` (`name`), `Recipe` (`name`), `Review` (`itemReviewed`), and `SoftwareApplication` (`name`), raising total validated schema types to 15.
- **Premium Reporting Redesign — "One Audit, Four Experiences" (`lib/report.mjs` & `templates/report.html`).**
  - **Visual & Accessibility System**: Deep navy/charcoal dark surfaces (`#090d16`, `#111726`), electric blue (`#2563eb` / `#3b82f6`) for Search SEO, violet (`#7c3aed` / `#8b5cf6`) for AI Visibility, emerald (`#059669` / `#10b981`) for pass states, `<meta name="color-scheme" content="light dark">`, `:root:has(...)` theme selectors, `@supports (color: light-dark(...))` progressive enhancement, manual **Theme Toggle** (`Auto / Dark / Light`), and **Executive Mode Toggle** (`Executive Mode: Off / On`).
  - **Individual Page Dashboard (`report.html`)**: Added status pill & `rulesVersion` in header, category filter (`#cat-filter`) in Findings Explorer, **SEO Details** (`#seo-details`), **AI Visibility & Citability** (`#citable`) with signal breakdown table, always-visible **Performance & Core Web Vitals** (`#psi`) distinguishing `Not measured (opt-in)` and `Unavailable` from real zero values, and **Remediation & Verification** (`#remediation`).
  - **Multi-Page Site Dashboard (`index.html`)**: Excluded `null`/`undefined` page scores from site-wide averages while displaying contributing page counts (`N/M valid pages`), added Highest & Lowest Performing Page cards, Crawl & Aggregation Summary, client-side URL/band search and column sorting on the Page Comparison Table, **Category Issue Distribution** (`#cat-dist`), and **Internal Linking & Dead-End Risk** (`#linking`).
  - **Markdown Report (`report.md`)**: Added `rulesVersion` header metadata, `## Page SEO & AI signal snapshot`, and `## Verification & next steps`.

### Fixed

- Removed duplicate `applySkillsFilter` invocation in `cmdPage` (`bin/cli.mjs`) and unified skill check filtering with `matchesSkillChecks` so `S02-<type>` findings and base-ID pass findings (`O01-title`, `O02-meta`, `O03-h1`, `O04-headings`) match their parent skill groups accurately.

## [0.8.0] - 2026-11-05

### Added

- **Centralized SSRF Protection & DNS Rebinding Defense (`lib/fetch.mjs`).**
  - Replaced ad-hoc host checks with comprehensive RFC-reserved address range classification: IPv4 (`0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10` CGNAT, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`, `240.0.0.0/4`, `255.255.255.255`) and IPv6 (`::1`, `::`, `fc00::/7` ULA, `fe80::/10` link-local, `ff00::/8` multicast, `::ffff:0:0/96` IPv4-mapped, `64:ff9b::/96`, `100::/64`, `2001:db8::/32`).
  - Added pre-connection DNS resolution checks (`dns.lookup`) to defend against DNS rebinding attacks when `--block-private-ips` is enabled or when public pages redirect.
  - Strict URL scheme validation restricting network requests to `http:` and `https:`, blocking `file:`, `ftp:`, `javascript:`, and other unexpected protocols.
  - Upgraded `fetchText()` from native follow to manual redirect inspection (up to 5 hops), enforcing identical SSRF checks on every hop for discovery files (`robots.txt`, `sitemap.xml`, `llms.txt`) and link checks.
- **Network Timeout Correctness & Resource Cleanup.**
  - Pass `controller.signal` to `readCappedText` in `fetchText()` and `fetchWithRedirects()`, ensuring response body reading cannot hang execution on slow-drip or stalled servers.
  - Hardened `fetchPsi()` timeouts to cover both HTTP headers and JSON response streaming.
  - Guaranteed `reader.releaseLock()` and stream body cancellation (`res.body?.cancel()`) across all success, error, timeout, and redirect paths.
- **PageSpeed Insights Metric Validation & INP Thresholds (`lib/psi.mjs`).**
  - Distinguishes missing metrics from real zero values (`null` vs `0`), preventing missing audits from emitting false passes (e.g. LCP 0.00s).
  - Emits `P03-psi-lab` (P3) when lab metrics are missing or incomplete rather than falsely passing.
  - Added full evaluation of CrUX INP (Interaction to Next Paint): >200ms triggers P2, >500ms triggers P1.
  - Resilient error handling for malformed JSON, partial API responses, and rate limits (429).
- **Report Security, Formula Injection Defense & Accessibility (`lib/report.mjs`).**
  - Added spreadsheet formula-injection protection (CWE-1236) in `escCsv`: values starting with `=`, `+`, `-`, `@`, `\t`, or `\r` are prefixed with single quotes (`'`).
  - Standardized SARIF v2.1.0 output: artifact locations use RFC 3986 parseable URIs (`safeSarifUri`) with robust fallbacks for local Windows and POSIX paths.
  - Verified and enhanced report accessibility: document language (`<html lang="en">`), skip-to-content links, heading hierarchies (`<h1>` -> `<h2>`), `aria-labelledby` landmark sections, and polite live status regions.
- **Audit Accuracy & Heuristic Realism.**
  - Removed speculative language around "guaranteed rankings" or "deciding Google rankings / AI answers", reframing findings around technical foundation, crawlability, indexability, and structural extractability.
- **Modular Skills Architecture (`lib/skills.mjs`) & `skills` Command.** First-class programmatic auditing skills registry organizing rules into 9 core capability domains (Technical SEO, On-Page SEO, Structured Data, Generative Engine Optimization, Performance & CWV, Security & Hygiene, Accessibility & UX, International & Local, and Content & Architecture).
  - Added `one-step-seo skills` to print an ANSI-formatted skills overview table with offline readiness and check counts.
  - Added `one-step-seo skills <skill-id>` to inspect detailed capabilities, mapped rules, remediation guides, and limitations.
  - Added `--json` output format for machine-readable skill catalog consumption.
- **Offline-First Auditing Engine for Local HTML Files & Directories.**
  - Direct local file auditing (`one-step-seo page ./dist/index.html` or `file:///...`) without running a web server.
  - Recursive local directory crawling (`one-step-seo audit ./dist --pages 10`) producing multi-page reports and linked dashboards.
  - Automatic discovery of local `robots.txt`, `sitemap.xml`, and `llms.txt` on disk with safe offline fallbacks.
  - Pure offline mode flag (`--offline`) ensuring zero external network calls.
- **Selective Skill Auditing (`--skills` & `--exclude-skills`).**
  - Added `--skills <list>` to run audits targeted to specific skill categories or IDs (e.g. `--skills onpage,schema`).
  - Added `--exclude-skills <list>` to skip specific auditing domains (e.g. `--exclude-skills performance-cwv`).
- **Dedicated AI Visibility Command (`one-step-seo ai <url>`).** First-class CLI command focusing on Generative Engine Optimization (GEO) and AI citability signals. Audits AI crawler access in `robots.txt`, `llms.txt`, JSON-LD entity structures, author attribution, semantic landmarks, and direct answer blocks with human checklist output and `--json` support.
- **Terminal UX & ANSI Styling Engine (`lib/colors.mjs`).**
  - Native, zero-dependency ANSI formatting engine respecting `process.stdout.isTTY`, the `NO_COLOR` standard, and `TERM=dumb`.
  - Color-coded severity badges (`[P0]` red, `[P1]` yellow, `[P2]` cyan, `[P3]` gray, `pass` green) and dual-score badges with grade band colors.
- **New Technical & Quality Audit Rules:**
  - `T17-canonical-http` (P1): Flags canonical tags specifying insecure `http://` on secure `https://` pages.
  - `O04-heading-empty` (P2): Detects empty heading elements (`<h1>`–`<h6>` with no visible text) that degrade accessibility and dilute search context.
  - `G10-author` (P3): Validates author or publisher attribution on substantive articles (≥300 words).
  - `G11-semantic-content` (P3): Validates semantic document landmarks (`<main>` and `<article>`) on long-form content (≥600 words) for AI document extraction.
- **CLI Workflow Enhancements:**
  - Added `--quiet` / `-q` flag to silence informational chatter in automated scripts and CI pipelines.
  - Added `doctor --check-config` to inspect and validate CLI options, defaults, and environment health.

## [0.7.0] - 2026-11-05

### Added

- **UI Pro Max Design System & Layout Fixes.** Re-architected HTML reports and site dashboard (`index.html`) using a refined two-color palette, fixed recurring issues reach bar constraints (`.topfix-row`), responsive layout, and stacked distribution bars.
- **SSRF & Cloud Metadata Protection.** Automatic blocking of cloud instance metadata services (`169.254.169.254`, `metadata.google.internal`, `100.100.100.200`, `[fd00:ec2::254]`) during recursive audits to prevent cloud credential exfiltration.
- **RFC 4180 CSV Export (`--format csv`).** Added full structured CSV export for automated data ingestion and spreadsheets.
- **Explicit UTF-8 Stream Writes.** Eliminates Windows code-page corruption across all file writing streams.

- **Google PageSpeed Insights & Core Web Vitals (`--psi`).** Opt-in integration
  fetching lab metrics (LCP, CLS, FCP, TBT, Speed Index, TTFB) and Chrome UX
  Report (CrUX) real-user 75th-percentile field data. Zero dependencies, pure
  `fetch`, strict `PSI_API_KEY` environment safety (never leaks or logs the key),
  and graceful 429 rate-limit degradation. Emits findings `P03-psi-lab`,
  `P04-psi-field`, and `P05-psi-error`.
- **Extended Schema.org Generators.** Added generator templates and structural
  validators for `video` (`VideoObject`), `job` (`JobPosting`), `course` (`Course`),
  `review` (`Review`), and `recipe` (`Recipe`).
- **Core Web Vitals Reporting.** Visualized Lab and Field diagnostics in single-file
  responsive HTML reports (`report.html`) and Markdown exports (`report.md`).
- **`audit --diff old.json new.json` — regression tracking.** Per-page
  score deltas plus NEW / RESOLVED / ESCALATED findings (terminal table +
  `--json`); `--fail-on` exits 2 only on new-or-escalated findings at the
  threshold, so pre-existing issues never fail the build. Warns when the two
  reports carry different `rulesVersion` stamps.
- **Rule versioning + benchmark corpus.** Every report carries
  `rulesVersion` (`lib/score.mjs`, currently `2026.10`; `schema-report.json`
  updated); `tests/scores.test.mjs` pins exact scores/counts for four
  fixtures so scoring-rule changes fail loudly instead of drifting.
- **`--format sarif`.** Same findings as SARIF v2.1.0 for GitHub code
  scanning (P0/P1 → error, P2 → warning, P3 → note; passes omitted);
  conditional `[sarif]` links in `index.md`. (JUnit declined: SARIF covers
  CI annotations; two formats would double the drift surface.)
- **`--profile blog|product|docs|home`.** Documented calibrations:
  product (thin threshold 120, skips answer-first), docs (FAQ + llms.txt
  bumped to P1), home (thin threshold 100, skips answer-first);
  blog/default byte-identical. Unknown names fall back to default. The AI
  readiness checklist is identical across profiles.
- **Reusable PR workflow** (`examples/github-pr-audit.yml`, kept out of
  `.github/workflows/` so it never runs here): audit preview, `--fail-on`
  gate, artifact upload, score-summary comment via `GITHUB_TOKEN` only;
  `docs/CI.md` documents the base-vs-head `diff` variant.
- **`--check-links` (bounded, off by default).** Verifies same-host link
  targets (capped at 100 checks/run via `MAX_LINK_CHECKS`, concurrency
  shared, known-200 and robots-disallowed targets skipped) → aggregated P1
  `T16-broken-links` per page with findings folded into scores/counts
  before reports are written.
- **`docs/GSC-INTEGRATION-DESIGN.md`** (design-only, mirrors PSI-DESIGN):
  read-only scopes, OAuth/service-account options, offline fallback,
  secret-scan rules. No implementation.
- **Snippet eligibility for AI answers: `G09-snippet-controls` (P2).**
  Google lifts passages only from snippet-eligible pages, so meta or
  `X-Robots-Tag` `nosnippet` / `max-snippet: 0` silently blocks AI-Overviews
  quoting. Follows the `G03` precedent (deducts Search like `G03`);
  `data-nosnippet` sections are evidence only, and paywalled content is
  explicitly excepted. Parser counts `data-nosnippet` elements.
- **Resource hygiene:** `T14-third-party-hosts` (P2 over 5 distinct script
  hosts) and `T15-security-headers` (P3 for missing CSP/HSTS/nosniff —
  skipped, not fired, when no headers were captured). Parser collects
  anchor texts (`linkTexts`) for the `O11` check.
- **2026 AI-crawler roll call.** `AI_BOTS` grows from 15 to 25 tokens
  (`claude-searchbot`, `claude-user`, `perplexity-user`, `googleother`,
  `facebookbot`, `meta-externalfetcher`, `amzn-user`, `mistralai-user`,
  `applebot`, `chatgpt-agent`), and `G02-ai-blocked` evidence now names the
  blocked tokens instead of “a known AI bot”.
- **Docs:** `docs/GSC.md` (every Search Console state → our finding +
  action, plus the 2026 AI-Overviews eligibility rules), “readiness
  signals, not Google scores” honesty lines, unified-`@graph` authoring
  guidance, evidence-tier + originality policy in `CONTRIBUTING.md`,
  re-audit cadence in FAQ, `docs/PSI-DESIGN.md` (opt-in PageSpeed spec —
  env-key only, offline fallback; no implementation, no keys touched).
- **Accuracy: `X-Robots-Tag` now fails `T07-noindex` (P0).** A header-level
  `noindex`/`none` blocks indexing exactly like the meta tag (and wins
  conflicts); previously such pages falsely passed. Token-matched, so
  `noimageindex` does not false-positive.
- **`T13-mixed-content` (P1 active / P2 passive).** http:// subresources on
  https pages, split by tag kind — scripts browsers block vs. images they
  degrade. New `subresources` parser collection (images, scripts, links).
- **Site-level duplicate detection.** Shared titles/metas across crawled
  pages surface in the terminal, `index.md`, and a new dashboard section
  (pure over `report.json`, no crawl change).
- **On-page precision:** `O11-generic-anchors` (P3, exact-match “click here”
  list), `O03-h1-drift` (P3, stopword-filtered H1/title overlap),
  `S03-faq-parity` (P3 both directions: markup-without-copy is a policy
  risk, copy-without-markup a missed opportunity).
- **GEO depth (all P3 + `GEO_ONLY_IDS`, zero Search-score effect):**
  `G06-freshness` (schema dates, `<time>`, dated update notes),
  `G07-question-headings` (question ratio over 3+ H2s),
  `G08-stat-density` (quantified metrics with units on 300+ word pages —
  presence, never density percentages), `C05-table-headers` (`<th>` in
  comparison tables).
- **Orphan detection.** CLI-side inlink map (sitemap-only counts as orphaned
  for equity) with redirect-credit transfer → terminal list + `index.md`
  section. Locked-out origins see exactly one request (pre-analysis gate).
- **Docs:** `docs/GSC.md` (every Search Console state → our finding +
  action), honesty lines (“readiness signals, not Google scores”), unified
  `@graph` authoring guidance, evidence-tier + originality policy in
  `CONTRIBUTING.md`, re-audit cadence in FAQ, `docs/PSI-DESIGN.md` (opt-in
  PageSpeed design, no implementation).
- **Site-wide `index.html` dashboard for multi-page audits.** Hero totals
  with average/minimum gauges, a worst-first pages table linking each
  `report[-N].html`, and top recurring issues across pages with reach bars.
  Reuses the report design system (one shared stylesheet, no new
  dependencies); per-page reports link back with an “All N pages”
  breadcrumb, and `index.md` points at the dashboard. Covered by
  `examples/site-index.html` under `examples:check`.
- **`report.html` share tags.** Every report now carries a meta description
  plus Open Graph title/description/type so shared links preview the scores.
- **Reduced-motion + breadcrumb styles** in the shared report stylesheet
  (`prefers-reduced-motion` disables smooth scrolling and card transitions).
- **Cap honesty without false alarms.** The “more URLs were seen” flag now
  fires only for genuinely new dropped links (nav-menu repeats no longer cry
  wolf), and the re-run-higher advice adapts at the `--pages` maximum via
  the pure, unit-tested `coverageLine()` helper. Validated end to end: the
  full 78-page apex site audits cleanly at `--pages 80` and `--pages 200`.
- **Badge contrast hardened** (P2-light 4.85 → 5.69, all pairs ≥5.6) against
  measured WCAG ratios.
  pages now prints top fixes aggregated across all pages (worst severity
  first, then most widespread, with per-page reach like “on 3/5 pages”),
  a failure/skipped counter, and cap honesty: “Stopped at the --pages N
  cap — the crawl saw more URLs” vs “Audited all N discovered pages”.
  File lists over ~12 entries condense to a count + `index.md` pointer.
- **Pragmatic same-host enforcement.** The crawl allows the start host plus
  the first redirect landing host (covers apex `<->` www), then locks:
  later cross-host redirect landings are skipped (warned, counted) with no
  report, no discovery fetches, and no link harvesting; discovered links are
  host-filtered as defense in depth. `analyzeOne` accepts an optional
  `allowedHosts` gate for this (ungated callers unchanged).
- **`one-step-seo quick <url>` — one-command beginner audit.** Sensible
  defaults (5 pages unless `--pages` is given, all formats), a one-line
  explainer, and the same reports + terminal summary as `audit`.
- **Interactive mode:** running with no command on a TTY asks four quick
  questions (URL with validation, pages, output folder, open report?) and
  runs the audit; piped/CI usage without a command still exits 1 with usage.
  `report.html` opens in the default browser on request (best-effort).
- **Terminal summary upgrade:** `audit`/`page`/`quick` now print the top 3
  urgent fixes with impact/effort/owner labels plus the exact re-run command.
- **`one-step-seo llms <url>` — AI-visibility paperwork.** Prints `llms.txt`
  status, a starter `llms.txt` draft (from live title/description + up to 20
  sitemap URLs, placeholders explicit, facts never invented), and a
  robots.txt snippet allowing the major AI crawlers. `--json` shape:
  `{ tool, version, url, llmsFound, llmsBytes, starter, robotsSnippet }`.
- **Plain-language finding metadata** (`lib/finding-meta.mjs`): every finding
  ID maps to a beginner-friendly explanation, impact (low/medium/high),
  effort (minutes/hours/days), owner (developer/content/SEO/agency), and —
  where safe — a copy-paste snippet (title, meta, canonical, OG, favicon,
  robots, llms.txt, JSON-LD skeletons). Unknown IDs degrade to a generic
  fallback; a test enforces dedicated entries for every emitted failure ID.
- **Richer reports:** executive summary + one-sentence verdict, “Fix this
  first” top 3, findings grouped by category with doc links, “Make this page
  more citable” checklist, “What passed”, “What to monitor”. `report.html`
  adds a copy-executive-summary button, print stylesheet, skip link, labelled
  sections, dark-mode-safe contrast, and responsive cards.
- **New checks:** `G04-entity` (P3: `og:title` vs `<title>` drift — pass when
  one contains the other; skipped without `og:title`/`<title>`), and
  `G05-llms-quality` (P3: `llms.txt` without headings or links; skipped when
  absent). Both are GEO-only (no Search-score effect), documented in
  `docs/SCORING.md`.
- **Crawler safety:** `robots.txt` is now enforced — `audit`/`page` refuse
  disallowed start URLs (writing a `T05-robots-disallow` P1 report instead)
  and skip disallowed discovered links; `--force` overrides (documented).
  Sitemap seeds are same-origin filtered. New `--delay MS` politeness pause
  (default 250 ms) and `--debug` diagnostics flag. `schema` warns (but
  proceeds) on disallowed URLs. User-Agent now follows `package.json`
  instead of a hardcoded version.
- **`lib/schema-report.json`:** draft-07 JSON Schema for `report.json`;
  example reports are conformance-tested against it.
- **Fixtures + examples:** 8 defect fixtures (missing title/meta/schema,
  broken canonical, thin content, duplicate H1, entity drift, llms quality)
  and 5 realistic page-type fixtures (WordPress, Next.js, product, blog,
  pricing) with `tests/fixtures.test.mjs` (18 tests: per-defect finding
  assertions plus live-server robots-refusal/`--force`/slow-page/sitemap
  tests); `examples/page-types.md` renders real scores + fixes per type.
- **Docs:** `docs/ROADMAP.md`, `docs/FAQ.md`, `docs/TROUBLESHOOTING.md`;
  README overhaul (who-it's-for, privacy, CI/agent usage, example output);
  `docs/CI.md` gains a copy-paste workflow, PR-comment format, and the
  machine-readable contract; `docs/USAGE.md` documents the new commands and
  flags; `SECURITY.md` supported versions updated.
- **Agent skills:** `SKILL.md` is now a full agent guide (audit → read
  `report.json` → prioritize → remediation plan → safe fixes with approval →
  client-ready summary, with the example prompt); sub-skills updated for the
  new commands, report sections, and JSON shapes.

### Fixed

- **`index.md` linked reports that were never written.** The `[md]`/`[json]`
  links were unconditional, so `--format json` produced an index of 404s.
  All three format links are now conditional on `--format`.
- **Robots-refused crawls claimed a “Solid foundation”.** `verdictFor` (and
  the HTML executive summary) now report “Crawl skipped: robots.txt
  disallows this page…” when `T05-robots-disallow` is the only finding.
- `G04-entity` no longer fires spuriously when `<title>` is empty (`O01`
  already covers that) — the check is skipped instead of piling on.
- `getSitemapUrls` could seed cross-host URLs from a malformed sitemap into
  the crawl queue; seeds are now same-origin filtered (children included).
- **`T06-sitemap` reported child-sitemap counts as URL counts.** For a
  `<sitemapindex>`, `countSitemapUrls` returns the number of _child sitemaps_, so
  a site with 2 children each holding tens of thousands of URLs was reported as
  `~2 URLs` — in the finding evidence, in `report.json`'s `site.sitemapUrls`, and
  in `sitemap --json`. The evidence now says `~N child sitemaps` for an index.
  Counting real URLs would mean fetching every child, which this synchronous
  check cannot do.

- **The schema `KNOWN_TYPES` allowlist produced spurious P2s on valid markup.** It
  held ~30 of schema.org's ~800 types, so `Question`, `Answer`, `ListItem` and
  `HowToStep` — the _mandated children_ of `FAQPage`, `QAPage`, `BreadcrumbList`
  and `HowTo` — were flagged "unrecognized @type" whenever emitted as top-level
  nodes. Expanded to ~350 common types. Genuine typos are still caught; that
  remains the check's purpose.

- **Answer-first detection was far too permissive and inflated the AI-Visibility
  score.** The largest GEO weight (25 points) fired on _any_ question mark in the
  first 4000 characters, so nav and breadcrumb links such as "Where is your office
  located?" collected the full weight on pages with no answer-first content. A
  question now only counts when a real answer follows it: informational
  interrogatives (`what`/`why`/`how`/`when`/`where`/`which`/`who`) matched against
  the opening, each requiring substantial prose before the next question mark.
  `is`/`are`/`can`/`does`/`should` are excluded — those forms are overwhelmingly
  nav links and CTAs rather than answer-first content. Explicit markers
  (`TL;DR:`, `In short:`) are now detected mid-page instead of only at the very
  start of the text.

- **A page missing its closing `</body>` counted `<title>` and meta text as body
  content.** The fallback used the entire raw HTML, so `wordCount` was inflated
  (a false thin-content pass) and the answer-first and FAQ signals were polluted
  by metadata. The fallback now strips `head`, `script`, `style`, `noscript` and
  comments first. The exported `hasQuestion` field, which nothing consumed, was
  removed.

## [0.3.0] - 2026-10-09

### Added

- **`one-step-seo fix <path>` — safe auto-fixes for local HTML files.** The
  audit → fix → verify loop is now closed end-to-end:
  - Dry-run by default: prints each planned fix with its finding ID and a
    unified diff; `--apply` writes with `<file>.bak` backups (`--no-backup`
    opts out) and warns when the target has uncommitted git changes.
  - Ten additive fixers — `charset`, `viewport`, `lang`, `title`,
    `description`, `canonical`, `og`, `og-url`, `twitter-card`, `favicon` —
    clearing `T10`, `T11`, `T09`, `O01-title-missing`, `O02-meta-missing`,
    `T08` (missing), `O06`, `W02`, `W01`, `O07` respectively. Nothing is
    ever removed; non-UTF8 encodings, custom viewports, alt text, `noindex`,
    and length rewrites are refused by design.
  - Never guesses: `--lang`, `--url`, `--title`, `--description`,
    `--og-image` supply values; title derives from the first `<h1>` and
    description from ≥40ch of page text when flags are absent. `--only`
    restricts the fixer set; `--json` emits a machine-readable plan.
  - Every plan is verified in memory: the patched document is re-parsed and
    each fix re-checked (partial fixes report `cleared: false`).
  - Works on a single file or a directory (recursive `.html`/`.htm` walk,
    `node_modules`/`.git` skipped, CRLF preserved) or a `file://` URL.
  - New `lib/fix.mjs` (pure fixer engine) and `lib/diff.mjs` (LCS unified
    diff with block-replace fallback); `fix` routes before URL normalization
    in the CLI.
- `coverage` job in `ci.yml` running `npm run test:coverage:gate`, so the
  85/80/85 thresholds are enforced on push rather than dev-only.
- `tests/config.test.mjs` fails when a `tests/*.test.mjs` file is missing from the
  `test` script, so new tests can no longer be silently skipped. It also asserts
  `test:coverage` uses a real Node flag and that no runtime dependencies exist.
- Regression tests for the v0.2.0 fixes: array `@type` schema validation,
  canonical/`og:url` normalisation, defensive `buildReport`, and `--verbose`
  acceptance.
- Coverage for `extractSitemapUrls` / `isSitemapIndex` / `getSitemapUrls` /
  `clearSitemapUrlsCache`, including a live-HTTP sitemap-index fixture.
- CLI integration tests for `--help`/`--version`, usage errors, `schema`,
  `sitemap` (both output modes), `--fail-on` breach and pass-through, and an
  end-to-end `audit --crawl sitemap` run.
- Unit coverage for the defensive paths in `score.mjs` and `report.mjs`
  (null inputs, clamps, band boundaries, escaping, renderer edge cases).
- `tests/fix.test.mjs` (22 unit tests: per-fixer detect/plan, idempotency,
  byte-identical healthy documents, flag-gated skips, encoding refusal, CRLF
  round-trip, no-`<head>` refusal, diff hunk structure) plus 5 CLI E2E tests
  (dry-run purity, `--apply` + backup + clean rerun, `--json` shape, usage
  errors, directory mode).

### Fixed

- `--timeout` only covered the header phase: the `AbortController` timer was
  cleared the moment `fetch()` resolved, so `readCappedText` then streamed the
  body with no deadline. A server that sent headers and stalled mid-body hung
  the CLI indefinitely. The timer now stays armed through the body read and is
  raced against it; `unref()` keeps a pending timer from holding the process
  open. Covered by a drip test that sends headers, never `end()`s, and was
  verified to fail against the previous implementation.
- `npm run test:coverage` passed a non-existent `--test-coverage` flag and failed
  immediately on every run with `node: bad option: --test-coverage`. It now uses
  `--experimental-test-coverage`. Strict thresholds moved to a separate
  `npm run test:coverage:gate` script, because `--test-coverage-lines/-branches/
-functions` are only available on Node 22+ and the CI matrix is 18/20/22.
- `getSitemapUrls` returned child-sitemap URLs from a `<sitemapindex>` as if they
  were pages, because an early `locs.length > 0` return made the
  follow-the-children branch unreachable. It now branches on the sitemap _shape_
  via the new exported `isSitemapIndex()`.
- The `tests/cli.test.mjs` fixture served `sitemap.xml` with a hardcoded
  portless `http://127.0.0.1/` `<loc>`, so sitemap-seeded URLs could never
  resolve. It now emits the server's real port.

### Changed

- `--crawl sitemap` is implemented; it was documented as "reserved, currently
  link-driven". `docs/USAGE.md` now describes the real behaviour.
- `publish.yml` runs `npm run examples:check` before `npm publish`.
- `CODE_OF_CONDUCT.md` pointed at a placeholder `conduct@example.com`; it now
  names the maintainer from `CODEOWNERS`.
- Added `.github/ISSUE_TEMPLATE/config.yml` routing usage questions to
  Discussions and security reports to private advisories, matching what
  `CONTRIBUTING.md` already told contributors to do.
- Docs for the new command: `docs/USAGE.md` (fix section + flags + JSON
  shape), `docs/CHECKS.md` (auto-fixable matrix), README quickstart/features,
  `SKILL.md` and `skills/seo-fix/SKILL.md` now point the fix protocol at
  `one-step-seo fix`.
- Version bumped to `0.3.0`. Test count 110 → 148 (55 at v0.2.0); coverage
  ≥94% lines / ≥81% branches / ≥95% functions — all above the 85/80/85 CI
  gate.

## [0.2.0] - 2026-10-09

### Fixed

- Cap audited HTML bodies at 5 MiB with a `truncated` flag and a `T00-truncated`
  P2 finding instead of risking an OOM crash on giant pages.
- Follow the first absolute `Sitemap:` URL declared in `robots.txt` when
  `/sitemap.xml` is missing (e.g. `sitemap_index.xml` setups).
- Validate `--format` (only `html,md,json`), `--pages` (1–20), `--timeout`
  (1000–120000 ms), and `--generate` kinds; invalid input now exits 1 with a
  clear message instead of silently succeeding.
- Decode numeric and common named HTML entities (`&#123;`, `&#x..;`, `&copy;`,
  `&mdash;`, …) so word counts and snippets are accurate.
- Report tables use `<caption>` and scoped headers for screen readers.
- **Security:** escape `</script` in `schemaSnippet` JSON-LD output to prevent
  XSS breakout when snippets are pasted into pages.
- **Crash guards:** malformed `Location` headers, invalid final URLs, and
  missing `viewport`/`robotsMeta` fields no longer throw — they emit `T02`
  failures or pass instead of crashing `runChecks`.
- Redirects without a `Location` header now report `ok: false` (previously
  reported `ok: true`).
- `faqDetected` only fires on `FAQPage` JSON-LD markup or explicit FAQ copy;
  mere presence of any JSON-LD no longer counts as FAQ coverage.
- `parseRobots` accumulates consecutive `User-agent:` groups per the robots
  spec (previously only the last agent was attributed), strips inline
  comments (`Disallow: / # tmp`), ignores empty `Disallow:` (allow-all), and
  expands the AI-bot list (Claude-Web, CCBot, Bytespider, Meta-ExternalAgent,
  Applebot-Extended, Grok, Amazonbot). Also accepts robots.txt files that
  only contain `Sitemap:` directives.
- `htmlBytes` uses UTF-8 byte length (was UTF-16 `String.length`).
- Schema finding IDs are sanitized (`S02-faqpage`, not `S02-FAQPage`) to
  match the `schema-finding.json` pattern; every `runChecks` output is
  validated against the schema in tests.
- Markdown reports escape `#`, `*`, `_`, `|`, backticks, and brackets in
  titles/evidence so hostile page content cannot inject headings or tables.
- HTML evidence/fix fields are sliced on the raw string before escaping
  (no more mid-entity truncation like `&am`).
- GEO-only findings (`G01-llms`, `G02-ai-blocked`) are excluded from the
  Search score via an explicit `GEO_ONLY_IDS` set; `G03-facts` intentionally
  still deducts (documented in `docs/SCORING.md`).
- `generateSchema` refuses placeholder `Example` data for identity types
  (Organization/WebSite/Article/Product/Event/LocalBusiness) — callers must
  supply real `name` + `url`. Removed the incorrect `logo: favicon.ico`
  field from Organization.
- CLI `process.exit` replaced with `process.exitCode` + `return` on Windows
  to avoid libuv assertion crashes on open sockets.
- `normalizeUrl` trims whitespace; crawl dedupe uses `canonicalizeUrl`
  (lowercase host, strip `utm_*`/`fbclid`/`gclid`/`msclkid`, drop hash,
  collapse trailing slash) keyed on `finalUrl` to prevent duplicate audits.
- `getSiteFiles` forwards caller `--timeout` (was hardcoded 10s) and caches
  by origin so multi-page crawls fetch robots/sitemap/llms.txt once.
- `fetchText` returns a `truncated` flag; sitemap index `<loc>` entries are
  counted as child sitemaps, not page URLs. Plaintext sitemaps (one URL per
  line) are detected.
- `examples/` are deterministic (`checkedAt` frozen to
  `2026-10-08T00:00:00.000Z`); `npm run examples:check` fails on drift
  without rewriting. Adds `report-sample.json` + full
  `report-bad-sample.{md,html,json}` variants.
- CI gate snippet in `docs/CI.md` uses ESM `import` (was broken `require()`).
  README counts updated to match real fixture output.

### Changed

- CLI arg parsing extracted to testable `lib/args.mjs`; `normalizeUrl`
  rejects non-http(s) input; supports `--flag=value` form for all flags.
- `getSiteFiles` result now includes the resolved `sitemap.url` and
  `sitemap.truncated`.
- `examples/report-sample.*` are generated by `npm run examples` from
  `tests/fixtures/good.html` and freshness-checked in CI.
- `README` skill install uses explicit clone/copy steps.
- `templates/report.html` documented as reference-only (runtime template
  lives in `lib/report.mjs → renderHtml()`).
- Shared `THRESHOLDS` export from `lib/checks.mjs`; `SEARCH_WEIGHTS`,
  `GEO_WEIGHTS`, `GEO_ONLY_IDS` exported from `lib/score.mjs` as single
  sources of truth for docs sync.
- Version bumped to `0.2.0`; User-Agent string updated.

### Added

- Dev-only tooling (never shipped): ESLint, Prettier, TypeScript `checkJs`,
  `@types/node`; `npm run check` runs typecheck + lint + format check + tests.
- JSDoc type annotations across `lib/` with a shared `ParsedPage` contract.
- Tests: local-HTTP fetch suite (redirects, loop cap, timeout, 5 MiB cap),
  robots parsing + sitemap follow-up, CLI arg validation, XSS/security
  regression suite, score band boundaries, GEO isolation, CLI E2E suite
  (`tests/cli.test.mjs`) covering page/audit/doctor/flag=value/fail-on
  against a fixture server, and `tests/report-schema.test.mjs` validating
  every finding against `lib/schema-finding.json` plus XSS/robots/args/
  canonicalization regressions.
- `CHANGELOG.md`, `tsconfig.check.json`, `eslint.config.mjs`,
  `.prettierrc.json`, `package-lock.json`.
- CLI flags: `--fail-on P0|P1|P2` (exit 2 for CI gating), `--crawl
links|sitemap` (sitemap reserved for forward-compat), `--concurrency N`
  (parallel page fetches, default 4, max 8), `--verbose` (stack traces),
  `--flag=value` syntax.
- Multi-page audit: per-page `report-N.html`, `index.md` linking all pages,
  aggregate avg/min scores and total counts in console output.
- Schema: `Product`, `Event`, `LocalBusiness`, `HowTo` generators + kinds;
  validator rules for Product offers, Event startDate, VideoObject
  thumbnailUrl, Organization name. Expanded `KNOWN_TYPES` (QAPage, Offer,
  AggregateRating, HowTo, Recipe, Course, SoftwareApplication, ItemList,
  SearchAction, PostalAddress, CreativeWork).
- P3 polish checks: `W01-social` (twitter:card), `W02-og-url` (og:url vs
  canonical), `W03-hreflang` (alternates complete).
- `canonicalizeUrl` helper in `lib/args.mjs`.
- `clearSiteFilesCache` export for tests.
- GitHub Actions hardening: `permissions: contents: read`, concurrency
  cancel-in-progress, SHA-pinned `checkout`/`setup-node`/`upload-artifact`,
  artifact `retention-days: 30`, `npm run examples:check` in CI, new
  `publish.yml` with OIDC provenance on release, npm dependabot ecosystem
  with grouped eslint/prettier/typescript PRs, dogfood audits real repo URL.
- `tsconfig.check.json`: `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`,
  dropped unnecessary `DOM` lib.
- `.gitignore`: `*.tsbuildinfo`, `.vscode/extensions.json` + settings
  un-ignored.
- `SECURITY.md`: GitHub Private Vulnerability Reporting link, 30-day
  mitigation SLA, zero-dep scope note.
- PR template requires `npm run check`, JSDoc, docs/CHECKS.md, and
  `npm run examples` regeneration.

## [0.1.0] - 2026-10-08

Initial release: one-command SEO + AI-visibility audit (`audit`, `page`,
`schema`, `sitemap`, `doctor`), dual 0–100 scores, JSON/Markdown/HTML reports,
`SKILL.md` + audit/fix sub-skills.
