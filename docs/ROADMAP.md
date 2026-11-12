# Roadmap

Where one-step-seo is heading. Items are ordered roughly by priority;
nothing here is promised on a date — issues and PRs decide the pace.

## Completed Milestones

### 0.12.0 (Current)

- [x] SEO Intelligence engine: site-wide issues X01–X21, category scores, content topics, internal-link suggestions, lexical competitor comparison
- [x] SEO Auto-Fix engine: fix plans for live URLs, safe/approval/manual classification, recorded fix sessions with on-disk verification, history and rollback
- [x] SEO Monitoring engine: snapshots, levelled change detection, webhook alerts, interval mode
- [x] `verify`, `report` (PDF/MD/CSV, client/developer audiences), `--deep` / `--technical` / `--on-page`
- [x] Optional sitemap XML generation from audited crawl paths (`fix <dir>` sitemap fixer)
- [x] Project config file (`one-step-seo.config.json`) and state directory

### 0.9.0

- [x] Expanded Agent Skill Library (`skills/*/SKILL.md` — 13 structured 9-section playbooks across 6 domains)
- [x] Expanded CLI skills registry (`lib/skills.mjs` — 14 executable skill groups, alias resolution, prefix/pass-variant check matching)
- [x] Expanded Schema.org required-property validators (`LocalBusiness`, `WebSite`, `HowTo`, `JobPosting`, `Course`, `Recipe`, `Review`, `SoftwareApplication`)
- [x] Premium Reporting Redesign ("One audit. Four experiences.") for `report.html`, `index.html`, and `report.md`
- [x] Interactive `report.html` controls: Dark/Light/Auto theme toggle, Executive Mode toggle, category filter, SEO Details, AI Citability breakdown, Core Web Vitals card, Remediation & Verification guide
- [x] Enhanced `index.html` multi-page site dashboard: valid-page score aggregation, sortable/filterable page matrix, Category Issue Distribution, Duplicate Metadata, and Internal Linking & Dead-End Risk

### 0.8.0

- [x] Modular skills architecture (`lib/skills.mjs`) & `skills` catalog command
- [x] Pure offline auditing for local HTML files & build directories (`page <file>`, `audit <dir>`, `--offline`)
- [x] Domain-focused audit filtering (`--skills`, `--exclude-skills`)
- [x] Dedicated AI Visibility command (`one-step-seo ai <url>`)
- [x] Centralized SSRF protection, full RFC-reserved range blocking & pre-connection DNS rebinding defense
- [x] Network timeout correctness & stream cancellation across HTML, discovery files, and PSI
- [x] PageSpeed Insights metric validation, missing vs zero classification & CrUX INP thresholds
- [x] CSV spreadsheet formula injection defense (CWE-1236) & SARIF 2.1.0 URI validation
- [x] Native zero-dependency ANSI terminal design system with TTY & `NO_COLOR` support
- [x] New audit rules: `T17-canonical-http`, `O04-heading-empty`, `G10-author`, `G11-semantic-content`
- [x] Automation flags: `--quiet` / `-q` and `doctor --check-config`

### 0.7.0

- [x] Responsive HTML dashboard & UI Pro Max design system
- [x] Cloud metadata SSRF blocking (AWS IMDSv2, GCP, Alibaba, Oracle)
- [x] RFC 4180 CSV export (`--format csv`)
- [x] Google PageSpeed Insights & Core Web Vitals lab + field metrics (`--psi`)
- [x] Extended Schema generators: `video`, `job`, `course`, `review`, `recipe`

### 0.5.0 – 0.6.0

- [x] Broken-link checking (`--check-links` opt-in)
- [x] Cross-page duplicate title and description detection
- [x] CI regression diff (`diff old.json new.json`) with `--fail-on`
- [x] SARIF export (`--format sarif`) for GitHub Code Scanning
- [x] Page-type calibrations (`--profile blog|product|docs|home`)

## Next Candidates (0.13 / 1.0)

- [ ] Multi-lingual and i18n heading pattern matching for non-English answer extraction
- [ ] Orphan page visualization graph in HTML site dashboard
- [ ] Standalone offline schema validator tool (`schema --validate file.json`)
- [ ] Search Console / GA4 connectors (opt-in, credentials via env; see GSC-INTEGRATION-DESIGN.md)
- [ ] Pluggable keyword / backlink data providers (opt-in, user-supplied API keys — never estimated)

## Non-goals (staying small on purpose)

- No browser automation dependencies (Puppeteer/Playwright).
- No speculative rank tracking, keyword stuffing, or opaque citation scores.
- No mandatory accounts, hosted services, or telemetry — 100% local-first and private.
- Zero runtime dependencies (`dependencies: {}`). Ever.

Have a use case that fits? Open a feature request — see `CONTRIBUTING.md`.
