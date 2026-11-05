---
name: geo-optimization
description: Audit and optimize pages for AI search and Generative Engine Optimization (GEO/AEO), including direct answer blocks, factual density, entity consistency, question headings, author attribution, and snippet eligibility.
---

# geo-optimization — Generative Engine Optimization (GEO / AEO)

## 1. Description & Activation Criteria

Activate `geo-optimization` when the user wants to:

- Improve how a page is quoted, summarized, or cited by AI answer engines (ChatGPT Search, Claude, Perplexity, Google AI Overviews).
- Run the dedicated `one-step-seo ai <url>` command or inspect the **AI Visibility (0–100)** score and citability checklist.
- Remediate `G01-llms` through `G11-semantic-content` and `C02-answer` / `C03-extractable` / `C04-faq`.

## 2. Inputs & Prerequisites

- **Target**: URL, local HTML file, or build directory.
- **AI Visibility Scoring Model (`lib/score.mjs` -> `GEO_WEIGHTS`, max 100)**:
  - Answer-first opening (`hasAnswerBlock`): **25 pts**
  - Extractable tables or lists (`tables > 0 || lists > 0`): **20 pts**
  - Substantive depth (`wordCount >= 300`): **15 pts**
  - FAQ coverage (`faqDetected`): **10 pts**
  - Single clear `<h1>` (`h1s.length === 1`): **10 pts**
  - Section `<h2>` headings (`h2s.length >= 1`): **5 pts**
  - Title + meta description present: **5 pts**
  - `/llms.txt` published (`llms.found`): **5 pts**
  - AI crawlers allowed in `robots.txt` (`!robots.aiBlocked`): **5 pts**

## 3. Step-by-Step Workflow

1. **Run the dedicated AI Visibility audit**:
   - Execute `npx one-step-seo ai <url> --out ./seo-report` (or `npx one-step-seo page <file> --skills geo-ai-search --offline`).
2. **Check snippet and crawler eligibility gates (`G02-ai-blocked`, `G09-snippet-controls`)**:
   - Verify `robots.txt` does not block major AI crawlers (`G02-ai-blocked` P1).
   - Verify `<meta name="robots">` and `X-Robots-Tag` do not set `nosnippet` or `max-snippet: 0` (`G09-snippet-controls` P2), which prevent Google AI Overviews and search engines from lifting passages.
3. **Optimize the 25-point Answer-First Opening (`C02-answer`)**:
   - Place a direct, self-contained 40–60 word answer immediately after an informational question (`What/Why/How/When/Where/Which/Who ...?`) or an explicit summary lead-in (`TL;DR:`, `In short:`) within the first 120 words of body copy.
4. **Strengthen factual extractability (`C03-extractable`, `G03-facts`, `G07-question-headings`, `G08-stat-density`)**:
   - Add structured `<table>` (with `<th>` headers) or `<ul>`/`<ol>` blocks (`C03-extractable`, +20 pts).
   - Ensure pages with 300+ words include concrete dates, units, or quantified measurements (`G03-facts`, `G08-stat-density`) and phrase key `<h2>` headings as natural user questions (`G07-question-headings`).
5. **Verify entity, freshness, author, and landmark signals (`G04-entity`, `G06-freshness`, `G10-author`, `G11-semantic-content`)**:
   - Align `og:title` with `<title>` (`G04-entity`), include `<time datetime="...">` or schema `dateModified` (`G06-freshness`), declare author attribution (`G10-author`), and wrap long-form copy in `<main>`/`<article>` (`G11-semantic-content`).

## 4. Tools & CLI Commands

```bash
# Dedicated AI Search Visibility & Citability audit
npx one-step-seo ai https://example.com --out ./seo-report

# Machine-readable JSON output for agent pipelines
npx one-step-seo ai https://example.com --json

# Generate starter /llms.txt and AI crawler robots.txt snippet
npx one-step-seo llms https://example.com
```

## 5. Evidence Requirements

- Report the **AI Visibility** score (`0–100`, band `A–F`) separately from Search SEO.
- Cite every passing and failing signal from `scores.ai.details.signals` along with its exact point weight.
- Cite specific finding IDs (`G01`–`G11`, `C02`–`C05`) and their evidence strings from `report.json`.

## 6. Expected Outputs

1. **AI Visibility Scorecard & Signal Breakdown**: Point-by-point table showing earned vs available points out of 100.
2. **Citable Rewrite Proposals**: Drafted answer-first opening paragraph, question-phrased H2s, and structured comparison table grounded strictly in the page's existing content.
3. **Crawler & Snippet Policy Fixes**: Exact `robots.txt` and meta robots adjustments if AI bots or snippets are blocked.

## 7. Limitations & External Data

- **Readiness signals, never citation guarantees**: AI answer engines dynamically select sources based on query intent, retrieval rankings, and provider policies. `one-step-seo` measures structural citability and crawler access, never guaranteed LLM citations.
- **GEO-only score isolation**: `G01`, `G02`, `G04`, `G05`, `G06`, `G07`, `G08`, `G10`, and `G11` are in `GEO_ONLY_IDS` and never deduct from the Search SEO score (`G03-facts` and `G09-snippet-controls` deduct 3 pts from Search SEO because they also degrade classic search snippets).

## 8. Safety & Approval Rules

- **Never fabricate statistics or fake citations**: To satisfy `G03-facts` or `G08-stat-density`, only surface real metrics from the user's product/content or insert explicit `[TODO: add verified metric]` placeholders.
- Confirm with the site owner before allowing AI crawlers in `robots.txt`, as some publishers intentionally restrict AI training or retrieval bots.

## 9. Examples

```bash
# Run an AI visibility audit and inspect the citability checklist
npx one-step-seo ai https://example.com/docs/getting-started --out ./seo-report
```
