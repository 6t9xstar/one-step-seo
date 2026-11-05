<div align="center">

<p align="center">
  <img src="https://raw.githubusercontent.com/6t9xstar/one-step-seo/main/assets/logo.svg" width="130" alt="one-step-seo logo">
</p>

# ⚡ one-step-seo

**Next-Generation Dual-Engine Auditor for Traditional Search SEO & Generative AI Visibility (GEO / AEO).**

[![npm version](https://img.shields.io/npm/v/one-step-seo.svg?logo=npm&logoColor=white)](https://www.npmjs.com/package/one-step-seo)
[![CI Status](https://github.com/6t9xstar/one-step-seo/actions/workflows/ci.yml/badge.svg)](https://github.com/6t9xstar/one-step-seo/actions/workflows/ci.yml)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18.0.0-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Zero Dependencies](https://img.shields.io/badge/runtime%20dependencies-0-blue.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-purple.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/6t9xstar/one-step-seo.svg?logo=github&color=gold)](https://github.com/6t9xstar/one-step-seo/stargazers)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

<p align="center">
  <a href="#-the-modern-search-paradox">Why Dual-Engine?</a> •
  <a href="#-quickstart">Quickstart</a> •
  <a href="#-system-architecture">Architecture</a> •
  <a href="#-the-dual-score-engine">Dual Scoring</a> •
  <a href="#-cli-command-suite">CLI Suite</a> •
  <a href="#-rule-catalogue">Rule Catalogue</a> •
  <a href="#-audit-profiles">Profiles</a> •
  <a href="#-autonomous-ai-agents">AI Agent Skill</a> •
  <a href="#-cicd-pipeline">CI/CD</a> •
  <a href="#-comparison">Comparison</a>
</p>

---

</div>

`one-step-seo` is a zero-dependency, ultra-fast Node.js CLI and portable **Agent Skill** designed for developers, marketers, and autonomous coding agents. It performs comprehensive technical audits across on-page SEO, schema markup, performance signals, and modern Generative Engine Optimization (GEO/AEO) for AI search engines like **ChatGPT Search, Perplexity AI, Claude, and Google AI Overviews**.

> [!IMPORTANT]
> **Two distinct scores, never blended.** Search engines index technical crawl signals; AI models extract structured facts, direct answers, and citations. `one-step-seo` measures both side-by-side, providing prioritized P0–P3 remediation steps with actionable code snippets.

---

## 🔍 The Modern Search Paradox

```
┌──────────────────────────────────────────────┐    ┌──────────────────────────────────────────────┐
│            Classic Google Search             │    │         AI Search (ChatGPT / Perplexity)     │
├──────────────────────────────────────────────┤    ├──────────────────────────────────────────────┤
│ • Crawlability & Canonical indexation        │    │ • Direct, answer-first opening paragraphs    │
│ • Title tags, Meta descriptions, Clean H1s   │    │ • Extractable data tables, stats, & lists    │
│ • Fast server response & clean robots.txt    │    │ • /llms.txt discovery & AI crawler access    │
│ • Internal anchor texts & XML sitemaps       │    │ • Syntactic entity consistency & FAQ schemas │
└──────────────────────┬───────────────────────┘    └──────────────────────┬───────────────────────┘
                       │                                                   │
                       └───────────────────┬───────────────────────────────┘
                                           │
                                           ▼
         A page can rank #1 on Google yet be completely invisible to AI citation answers,
            or write great content that Google cannot crawl due to broken canonicals.
                       one-step-seo solves both in one command.
```

---

## ⚡ See It in 30 Seconds

```bash
npx one-step-seo quick https://your-site.com
```

<p align="center">
  <img src="https://raw.githubusercontent.com/6t9xstar/one-step-seo/main/assets/demo.svg" alt="Terminal demo: one-step-seo quick audit execution" width="800">
</p>

That single command audits technical SEO, on-page structure, content depth, JSON-LD schema, robots/sitemap policies, and AI crawler citability — outputting prioritized fixes right to your console:

```text
Search SEO: 86/100 (B)  |  AI Visibility: 80/100 (B)
Pages audited: 5
Counts: P0=0 P1=1 P2=2 P3=3 pass=39

Top fixes:
  [P1] Thin content (C01-thin) — Expand to fully answer the query; add examples, steps, data.
       Impact: medium · Effort: days · Owner: content
  [P2] llms.txt missing (G01-llms) — Add /llms.txt summarizing key pages for AI crawlers.
       Impact: medium · Effort: minutes · Owner: developer
  [P2] Schema FAQ markup missing (S01-schema) — Add JSON-LD FAQPage markup to earn rich snippets.
       Impact: high · Effort: minutes · Owner: developer

Wrote:
  ./seo-report/report.json   (machine-readable JSON schema)
  ./seo-report/report.md     (citable executive markdown summary)
  ./seo-report/report.html   (shareable standalone responsive dashboard)
```

---

## 🚀 Quickstart

Run directly with `npx` (no install required) or install globally:

```bash
# Instant beginner-friendly audit (sensible 5-page crawl, all report formats)
npx one-step-seo quick https://example.com

# Interactive wizard: guides you through goals, depths, and opens the HTML report
npx one-step-seo

# Full-site recursive crawl with custom output directory and multi-format reports (HTML, MD, JSON, CSV, SARIF)
npx one-step-seo audit https://example.com --pages 10 --out ./seo-report --format html,md,json,csv

# Deep-dive inspection of a single critical landing or pricing page
npx one-step-seo page https://example.com/pricing

# Inspect JSON-LD schema markup & generate production-ready starter snippets
npx one-step-seo schema https://example.com --generate faq

# Audit XML sitemaps, robots.txt, and canonical loops
npx one-step-seo sitemap https://example.com

# Check llms.txt compliance + generate AI-crawler robots.txt directives
npx one-step-seo llms https://example.com

# Safe auto-fix for local HTML build artifacts (diff preview first, then --apply)
npx one-step-seo fix ./dist/index.html --url https://example.com/

# Regression testing between two audit runs (ideal for PR gates)
npx one-step-seo diff ./seo-report/report-v1.json ./seo-report/report-v2.json --fail-on P0

# System preflight and network sanity check
npx one-step-seo doctor
```

---

## 📐 System Architecture

```
                                  ┌────────────────────────┐
                                  │   npx one-step-seo     │
                                  └───────────┬────────────┘
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    ▼                                                   ▼
       ┌─────────────────────────┐                         ┌─────────────────────────┐
       │   Single-Page Auditor   │                         │  Recursive Site Crawler │
       │ (Deep DOM & Signal AST) │                         │ (Polite, Same-Host Only)│
       └────────────┬────────────┘                         └────────────┬────────────┘
                    │                                                   │
                    └─────────────────────────┬─────────────────────────┘
                                              │
                                              ▼
                    ┌───────────────────────────────────────────────────┐
                    │            Signal Evaluation Pipeline             │
                    │ • Technical: HTTPS, Status, Canonical, Robots     │
                    │ • On-Page: Title, Meta, H1 Hierarchy, Anchors     │
                    │ • Content: Word Counts, Paragraph Flow, Thinness  │
                    │ • Schema: JSON-LD Extraction & Graph Validation   │
                    │ • GEO/AEO: Answer-first, Tables, Facts, llms.txt  │
                    └─────────────────────────┬─────────────────────────┘
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      ▼                                               ▼
         ┌─────────────────────────┐                     ┌─────────────────────────┐
         │     Search SEO Engine   │                     │    AI Visibility Engine │
         │ (100 - Penalty Model)   │                     │  (Additive 100 Checklist│
         └────────────┬────────────┘                     └────────────┬────────────┘
                      │                                               │
                      └───────────────────────┬───────────────────────┘
                                              │
                                              ▼
                    ┌───────────────────────────────────────────────────┐
                    │               Multi-Format Reporting              │
                    │ • report.json (Automated tooling & CI gates)      │
                    │ • report.md   (Human PR reviews & Agent action)   │
                    │ • report.html (Standalone executive dashboard)    │
                    │ • index.html  (Aggregated multi-page site rollup) │
                    └───────────────────────────────────────────────────┘
```

---

## 📊 The Dual-Score Engine

`one-step-seo` refuses to blend search crawlability with AI citability. They are calculated using different mathematical models grounded in actual web platform behavior:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  Search SEO Score (0–100, A–F)          │  AI Visibility Score (0–100, A–F)            │
├─────────────────────────────────────────┼──────────────────────────────────────────────┤
│ Model: Deductive Penalty Architecture   │ Model: Weighted Citability Checklist         │
│ Starts at 100 and deducts by severity:  │ Evaluates 9 direct citability criteria:      │
│ • P0 (Critical blocker): -25 pts        │ • Answer-first opening paragraph:  +25 pts   │
│ • P1 (High-impact issue): -10 pts       │ • Structured tables & clean lists: +20 pts   │
│ • P2 (Medium opportunity): -3 pts       │ • Substantive content (≥300 words): +15 pts  │
│ • P3 (Low-level polish):   -1 pt        │ • Direct FAQ question & answers:   +10 pts   │
│                                         │ • Clean, singular H1 heading:      +10 pts   │
│ Measures: Crawlability, indexability,   │ • Descriptive H2 topic breakdowns: +5 pts    │
│ canonical consistency, valid titles,    │ • Valid title & meta description:  +5 pts    │
│ internal link integrity, and schemas.   │ • Accessible /llms.txt directory:  +5 pts    │
│                                         │ • AI crawler tokens allowed:       +5 pts    │
└─────────────────────────────────────────┴──────────────────────────────────────────────┘
```

### Grade Bands

| Grade | Score Band | Meaning                                                                                   |
| :---: | :--------: | :---------------------------------------------------------------------------------------- |
| **A** | `90 – 100` | **Excellent**: Best practices fulfilled; maximum crawlability and quotation potential.    |
| **B** | `80 – 89`  | **Good**: Solid technical foundation; minor content expansion or schema opportunities.    |
| **C** | `70 – 79`  | **Fair**: Moderate indexing blockers or missing AI citability signals.                    |
| **D** | `60 – 69`  | **Poor**: Substantial technical defects, thin content, or blocked crawler directives.     |
| **F** |   `< 60`   | **Critical**: Severe P0 indexing failures, broken canonical loops, or missing foundation. |

---

## 🛠️ CLI Command Suite

| Command                  | Purpose                                                       | Primary Flags                                                       |
| :----------------------- | :------------------------------------------------------------ | :------------------------------------------------------------------ |
| `quick <url>`            | Fastest way to audit a site with sensible defaults.           | `--pages`, `--out`                                                  |
| `audit <url>`            | Comprehensive multi-page crawl and linked site dashboard.     | `--pages`, `--crawl`, `--profile`, `--psi`, `--fail-on`, `--format` |
| `page <url>`             | Deep dive on a single web page without crawling links.        | `--out`, `--format`, `--psi`, `--verbose`                           |
| `schema <url>`           | Validate JSON-LD and print copy-paste schema snippets.        | `--generate (video\|job\|course\|review\|recipe\|...)`              |
| `sitemap <url>`          | Audit sitemap index, robots.txt, and link seeds.              | `--json`                                                            |
| `llms <url>`             | Audit `/llms.txt` and generate AI crawler `robots.txt` rules. | `--json`                                                            |
| `fix <file\|dir>`        | Safe, dry-run diff patcher for local HTML files.              | `--apply`, `--url`, `--backup`                                      |
| `diff <a.json> <b.json>` | Detect score drops and finding escalations between builds.    | `--fail-on (P0\|P1)`                                                |
| `doctor`                 | Verify environment, HTTP parser, and network connectivity.    | `--verbose`                                                         |

---

## ⚡ Core Web Vitals & PageSpeed Insights (`--psi`)

Evaluate real lab performance and Chrome UX Report (CrUX) field data alongside traditional SEO and AI visibility:

```bash
# Set your API key in the environment (never committed or leaked)
export PSI_API_KEY="your_google_cloud_api_key"

# Audit a single page with mobile Core Web Vitals
npx one-step-seo page https://example.com --psi

# Audit multi-page crawl with desktop strategy
npx one-step-seo audit https://example.com --pages 5 --psi --psi-strategy desktop
```

- **Lab metrics**: Largest Contentful Paint (LCP), Cumulative Layout Shift (CLS), Total Blocking Time (TBT), First Contentful Paint (FCP), Speed Index, Time to First Byte (TTFB).
- **Field metrics**: Real-user 75th-percentile data directly from the Chrome UX Report (CrUX).
- **Security by design**: The key is read exclusively from `process.env.PSI_API_KEY`, never passed as a CLI flag or recorded in reports.

---

## 📑 Rule Catalogue (45+ Audited Signals)

<details>
<summary><b>Click to expand full audit rules breakdown (Technical, On-Page, Content, Schema, GEO)</b></summary>
<br>

### 🌐 Technical SEO (`T01` – `T15`)

- `T01-https`: Enforces HTTPS protocol; flags insecure HTTP connections.
- `T02-status`: Verifies HTTP 200 OK status; alerts on 4xx/5xx errors or broken redirects.
- `T03-redirect`: Flags long redirect chains and loops.
- `T04-canonical-missing`: Flags missing `<link rel="canonical">` tags.
- `T05-canonical-mismatch`: Detects cross-domain or mismatched canonical targets.
- `T06-canonical-relative`: Warns on relative canonical URLs prone to scraper confusion.
- `T07-noindex`: Detects conflicting or accidental `noindex` directives in meta or headers.
- `T08-robots-blocked`: Checks if `robots.txt` disallows Googlebot or general crawlers.
- `T09-viewport`: Validates mobile-friendly `<meta name="viewport">` configuration.
- `T10-response-time`: Measures Time to First Byte (TTFB) and flags slow servers (>800ms).
- `T11-html-size`: Alerts on heavy uncompressed HTML documents (>1MB).
- `T12-hreflang`: Validates alternate language annotations and missing return tags.
- `T13-mixed`: Detects active mixed-content subresources loaded over insecure HTTP.
- `T14-scripts`: Tracks excessive third-party blocking scripts.
- `T15-security-headers`: Checks for recommended headers (`X-Content-Type-Options`, `HSTS`).

### 📄 On-Page Signals (`O01` – `O11`)

- `O01-title-missing`: Flags missing or empty `<title>` tag.
- `O02-title-length`: Validates optimal title length (30–60 characters).
- `O03-h1-drift`: Detects severe semantic drift between `<title>` and `<h1>`.
- `O04-meta-missing`: Flags missing `<meta name="description">`.
- `O05-meta-length`: Validates description length (70–160 characters).
- `O06-h1-missing`: Flags pages lacking a primary `<h1>` tag.
- `O07-h1-multiple`: Warns on multiple conflicting `<h1>` headings.
- `O08-heading-order`: Flags skipped heading levels (e.g., `<h1>` directly to `<h3>`).
- `O09-img-alt`: Identifies informative images lacking descriptive `alt` attributes.
- `O10-internal-links`: Warns on orphan pages with insufficient internal navigation.
- `O11-generic-anchors`: Flags repetitive anchor text ("click here", "read more").

### ✍️ Content Quality (`C01` – `C05`)

- `C01-thin`: Identifies thin content (<300 words) unlikely to rank or satisfy queries.
- `C02-duplicate-title`: Identifies duplicate title tags across multiple crawled pages.
- `C03-keyword-stuffing`: Detects abnormal keyword repetition rates.
- `C04-reading-level`: Analyzes reading ease and overly complex sentence structures.
- `C05-structure-depth`: Verifies balanced section lengths under subheadings.

### 🧬 Structured Data & Schema (`S01` – `S03`)

- `S01-schema`: Detects presence of valid JSON-LD or Microdata schema markup.
- `S02-schema-invalid`: Flags malformed JSON syntax or schema.org structural errors.
- `S03-faq-parity`: Verifies that FAQ schema entries match visible page text verbatim.

### 🤖 Generative AI & Citability (`G01` – `G09`)

- `G01-llms`: Detects presence and accessibility of `/llms.txt` and `/llms-full.txt`.
- `G02-ai-blocked`: Checks if AI bots (`GPTBot`, `PerplexityBot`, `ClaudeBot`) are blocked.
- `G03-facts`: Evaluates density of structured data tables, numerical statistics, and bulleted lists.
- `G04-entity`: Inspects clear entity naming in opening paragraphs.
- `G05-llms-quality`: Validates markdown link formats and summaries within `llms.txt`.
- `G06-freshness`: Detects timestamp markers (`dateModified`, `datePublished`) for AI freshness.
- `G07-question-headings`: Checks for question-formatted H2/H3 headings matching user prompts.
- `G08-stat-density`: Evaluates presence of citable research figures and quantitative data.
- `G09-snippet-controls`: Alerts on `nosnippet` or `max-snippet:0` that prevent AI citation generation.

</details>

---

## 🎯 Audit Profiles

Calibrate scoring thresholds and checks to suit your specific website architecture:

```bash
# E-commerce: Stricter checks for product schema, price availability, and image alt text
npx one-step-seo audit https://shop.example.com --profile ecommerce

# Documentation: Emphasizes code blocks, H2/H3 hierarchies, and llms.txt integration
npx one-step-seo audit https://docs.example.com --profile docs

# News / Media: Focuses on freshness, author attribution, and Article schema markup
npx one-step-seo audit https://news.example.com --profile news
```

---

## 🤖 Autonomous AI Agents (`SKILL.md`)

`one-step-seo` ships with a native **Agent Skill** (`SKILL.md`) compatible with **Claude Code, Cursor, Codex, OpenCode**, and custom LLM agent workstreams:

```bash
# Install skill for Claude Code / Cursor
git clone --depth 1 https://github.com/6t9xstar/one-step-seo.git
cp one-step-seo/SKILL.md ~/.claude/skills/one-step-seo/SKILL.md
```

### Prompt Example:

> _"Audit https://my-saas.com using one-step-seo. Inspect the resulting report.json, propose fixes for any P0/P1 issues, draft an llms.txt file, and prepare an executive summary for our engineering team."_

The skill instructs agents to:

1. Parse the schema-validated `report.json` output.
2. Prioritize P0 (critical) and P1 (high-impact) findings first.
3. Apply conservative, additive fixes via `one-step-seo fix` with diff previews.
4. Keep Search SEO and AI Visibility scores separate in executive reports.

---

## 🔄 CI/CD Pipeline Integration

Gate pull requests and automatically prevent SEO or AI-visibility regressions with GitHub Actions:

```yaml
name: SEO & AI Visibility CI Gate

on:
  pull_request:
    branches: [main]

jobs:
  seo-audit:
    name: Audit Pull Request
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      # Fail the job if any P0 (critical blocker) is detected
      - name: Run SEO & GEO Audit
        run: |
          npx one-step-seo audit https://staging.example.com \
            --pages 5 \
            --out ./seo-report \
            --fail-on P0

      # Upload HTML and Markdown reports as job artifacts
      - name: Upload SEO Reports
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: seo-report
          path: ./seo-report/
```

---

<span id="-comparison"></span><span id="comparison"></span>

## 🏆 Modern SEO & AI Tooling Comparison

How `one-step-seo` compares to legacy desktop crawlers, browser-based performance runners, enterprise SaaS suites, and ad-hoc LLM scripts:

### Feature & Capability Matrix

| Capability                        |             `one-step-seo`              |      Google Lighthouse      |       Screaming Frog        |    Cloud SaaS (Ahrefs / Semrush)    |   Custom LLM / Browser Scripts    |
| :-------------------------------- | :-------------------------------------: | :-------------------------: | :-------------------------: | :---------------------------------: | :-------------------------------: |
| **Execution**                     |      `npx one-step-seo` (Instant)       |    Chrome DevTools / CLI    |      Desktop Java App       |        Web Dashboard (Cloud)        |       Python / Node Script        |
| **Runtime Dependencies**          |         **0 (Node 18+ stdlib)**         | Chromium Headless (~400MB)  |    Java Runtime (~500MB)    |         N/A (Remote Cloud)          |  Heavy (Playwright / Puppeteer)   |
| **Offline / Local Auditing**      |        ✅ **100% Offline-First**        | ⚠️ Local (requires browser) |      ✅ Local Desktop       |     ❌ Cloud only (Public URLs)     | ⚠️ Requires local browser engine  |
| **Search SEO Engine**             |    ✅ **Deductive Penalty (0–100)**     | ⚠️ Basic 10-point checklist |  ❌ Raw unweighted tables   |        ✅ Cloud health score        |    ❌ Subjective chat response    |
| **AI Visibility (GEO / AEO)**     |     ✅ **Dedicated 9-signal score**     |           ❌ None           |           ❌ None           |               ❌ None               | ⚠️ Uncalibrated unstructured text |
| **`/llms.txt` Audit & Generator** |       ✅ **Built-in CLI command**       |           ❌ None           |           ❌ None           |               ❌ None               |     ⚠️ Manual prompt required     |
| **AI Bot Governance Checks**      |     ✅ **GPTBot, ClaudeBot, etc.**      |           ❌ None           |   ⚠️ Raw robots.txt lines   |       ⚠️ Basic crawler rules        |              ❌ None              |
| **Automated HTML Fixer**          |    ✅ **Dry-run diff & safe patch**     |     ❌ Read-only audit      |     ❌ Read-only export     |    ❌ Read-only recommendations     |   ⚠️ Hallucination-prone edits    |
| **CI/CD Regression Tracking**     |   ✅ **`audit --diff` + `--fail-on`**   |    ⚠️ LHCI (heavy setup)    |      ❌ Manual diffing      |       ❌ Slow cloud crawling        |    ❌ Custom fragile glue code    |
| **GitHub Code Scanning**          |       ✅ **Native SARIF v2.1.0**        |     ❌ JSON / HTML only     |     ❌ CSV / Excel only     |     ❌ Third-party integrations     |      ❌ Custom parser needed      |
| **Multi-Format Export**           | ✅ **HTML, Markdown, JSON, SARIF, CSV** |     ⚠️ HTML / JSON only     |     ⚠️ CSV / Excel only     |         ⚠️ PDF / CSV export         |        ❌ Raw output only         |
| **SSRF & Metadata Protection**    |  ✅ **Cloud metadata & RFC1918 safe**   |    ⚠️ Generic HTTP agent    |  ⚠️ Standard network stack  |       ❌ Remote cloud crawler       |      ❌ Unvalidated request       |
| **Core Web Vitals Integration**   |    ✅ **PageSpeed & CrUX (`--psi`)**    |   ✅ Lab metrics built-in   |     ⚠️ API key required     |     ⚠️ Periodic CrUX snapshots      |              ❌ None              |
| **AI Agent Integration**          |    ✅ **Native `SKILL.md` included**    |    ❌ Manual CLI wrapper    | ❌ No native agent protocol |           ❌ Web UI only            |     ⚠️ Custom setup required      |
| **Privacy & Telemetry**           |    🔒 **Zero telemetry, 100% local**    |     ⚠️ Google telemetry     |    ⚠️ License validation    | ❌ Complete site data sent to cloud |             ⚠️ Varies             |
| **Cost & Licensing**              |         **Free (MIT License)**          |      Free (Apache 2.0)      |    $259 / year / license    |       $1,200 – $6,000+ / year       |     Varies / API token costs      |

---

### ⚡ Performance & Footprint Benchmark

Tested against standard modern production page audits:

| Metric                        |     `one-step-seo`      |     Google Lighthouse     |        Screaming Frog        | Custom Playwright Script  |
| :---------------------------- | :---------------------: | :-----------------------: | :--------------------------: | :-----------------------: |
| **Startup Latency**           |      **< 150 ms**       |     2,500 – 4,500 ms      |      6,000 – 12,000 ms       |     3,000 – 6,000 ms      |
| **RAM Footprint (1 page)**    |     **~35 – 55 MB**     |       450 – 850 MB        |        800 – 2,000 MB        |       500 – 950 MB        |
| **Engine Footprint**          | **0 MB (Zero install)** | ~380 MB (Chromium binary) |  ~600 MB (Java + binaries)   | ~400 MB (Browser drivers) |
| **Audit Speed (Single Page)** |    **~200 – 400 ms**    |     4,000 – 8,000 ms      |       1,500 – 3,000 ms       |     3,500 – 7,000 ms      |
| **CI/CD Pipeline Impact**     | **Near-zero overhead**  |  +45–90s container boot   | Not practical in headless CI |  +30–60s driver download  |

---

### 💡 Why Developers & Agents Choose `one-step-seo`

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                  THE ONE-STEP-SEO ADVANTAGE                                     │
├────────────────────────────────┬────────────────────────────────┬───────────────────────────────┤
│ 🚀 Zero-Dependency Speed       │ 🧠 The Dual-Engine Paradigm    │ 🛠️ Safe Local Auto-Fixer      │
│ Runs instantly with `npx`. No  │ Classic search engines index   │ Don't just detect defects —   │
│ Chrome download, no Python     │ crawl signals; AI assistants   │ patch them. Includes in-memory│
│ venv, no Java runtime, and zero│ extract structured answers.    │ verification, dry-run diffs,  │
│ telemetry. 100% portable.      │ Measure both side-by-side.     │ and automatic `.bak` backups. │
├────────────────────────────────┼────────────────────────────────┼───────────────────────────────┤
│ 🛡️ Native CI/CD & SARIF Gating │ ⚡ Integrated Core Web Vitals   │ 🤖 Autonomous Agent Ready     │
│ Fail PRs on P0/P1 breaches.    │ Lab diagnostics + Chrome UX    │ Features a native `SKILL.md`  │
│ Export industry-standard SARIF │ Report (CrUX) field data via   │ allowing Claude Code, Cursor, │
│ for native GitHub annotations. │ `--psi` without browser bloat. │ and OpenCode to self-remediate│
└────────────────────────────────┴────────────────────────────────┴───────────────────────────────┘
```

---

## 🔒 Privacy & Data Ethics

- **Zero Telemetry**: No analytics, no tracking pixels, no telemetry beacons.
- **100% Local Reports**: Reports stay on your local disk (`--out`) and are never sent to external servers.
- **Polite Crawler**: Enforces same-host restrictions, respects `robots.txt` by default, uses controlled delays between page fetches, and identifies itself clearly with a standard `User-Agent`.

---

## 📚 Documentation Index

- [Command-Line Reference & Flags (`docs/USAGE.md`)](./docs/USAGE.md)
- [Complete Check Definitions (`docs/CHECKS.md`)](./docs/CHECKS.md)
- [Scoring Formula & Mathematics (`docs/SCORING.md`)](./docs/SCORING.md)
- [GitHub Actions & CI Setup Recipes (`docs/CI.md`)](./docs/CI.md)
- [Frequently Asked Questions (`docs/FAQ.md`)](./docs/FAQ.md)
- [Troubleshooting Common Issues (`docs/TROUBLESHOOTING.md`)](./docs/TROUBLESHOOTING.md)
- [Project Roadmap (`docs/ROADMAP.md`)](./docs/ROADMAP.md)

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) and adhere to our [Code of Conduct](./CODE_OF_CONDUCT.md).

```bash
git clone https://github.com/6t9xstar/one-step-seo.git
cd one-step-seo
npm install
npm run check
```

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](./LICENSE) for details.

<div align="center">

<p align="center">
  <a href="https://www.star-history.com/#6t9xstar/one-step-seo&Date"><img src="https://api.star-history.com/svg?repos=6t9xstar/one-step-seo&type=Date" alt="Star history chart" width="600"></a>
</p>

**If one-step-seo improved your rankings or AI visibility, please consider starring the repository! ⭐**  
Maintained by [6t9xstar](https://github.com/6t9xstar).

</div>
