---
name: content-quality
description: Evaluate content substance, word count thresholds by page profile, answer-first openings, extractable tables and lists, FAQ sections, and semantic HTML landmarks (<main>/<article>).
---

# content-quality — Content Depth & Extractability

## 1. Description & Activation Criteria

Activate `content-quality` when the user wants to:

- Evaluate whether a page has sufficient depth (`C01-thin`), an answer-first opening (`C02-answer`), structured lists/tables (`C03-extractable`, `C05-table-headers`), FAQ coverage (`C04-faq`), or semantic HTML landmarks (`G11-semantic-content`).
- Calibrate content checks for specific page types (`--profile blog|product|docs|home`).
- Improve both human readability and machine extractability for search snippets and AI summaries.

## 2. Inputs & Prerequisites

- **Target**: URL, local HTML file, or build directory.
- **Profile calibrations (`--profile`)**:
  - `default` / `blog`: Thin-content threshold `200` words (`C01-thin` P1); checks `C02-answer` (P1) and `C04-faq` (P2). Note: the AI Visibility `substantive` signal (`GEO_WEIGHTS.substantive`, +15 pts) requires `>=300` words across all profiles.
  - `product`: Thin-content threshold `120` words; skips `C02-answer` (product specs and pricing tables carry the answer).
  - `docs`: Thin-content threshold `200` words; elevates `C04-faq` and `G01-llms` to `P1`.
  - `home`: Thin-content threshold `100` words; skips `C02-answer`.

## 3. Step-by-Step Workflow

1. **Audit with the matching page-type profile**:
   - Run `npx one-step-seo page <target> --profile <blog|product|docs|home> --skills content-quality,geo-ai-search --out ./seo-report`.
2. **Assess content substance (`C01-thin` / `C01-length` / `C01-long`)**:
   - Inspect `report.page.wordCount` (computed after stripping `<head>`, `<script>`, `<style>`, `<noscript>`, and HTML comments).
   - If `C01-thin` fires, identify missing subtopics, specifications, or user questions that should be answered on the page.
3. **Evaluate answer-first structure (`C02-answer`)**:
   - Check whether the opening 120 words answer an informational question (`what`, `why`, `how`, `when`, `where`, `which`, `who`) or include an explicit summary marker (`TL;DR:`, `In short:`, `Key takeaway:`).
4. **Check structured extractability (`C03-extractable`, `C05-table-headers`, `C04-faq`)**:
   - Verify the page includes at least one `<ul>`/`<ol>` or `<table>` (`C03-extractable`).
   - Confirm every `<table>` uses `<th>` header cells (`C05-table-headers`) so search engines and LLMs can map cell values to column names.
   - Check for a visible FAQ section (`C04-faq`) and ensure it matches `FAQPage` JSON-LD (`S03-faq-parity`).
5. **Check semantic document landmarks (`G11-semantic-content`)**:
   - On articles of 600+ words, confirm prose is wrapped in `<main>` or `<article>` so parsers can isolate primary content from navigation boilerplate.

## 4. Tools & CLI Commands

```bash
# Audit an article with the blog profile
npx one-step-seo page https://example.com/blog/guide --profile blog --skills content-quality --out ./seo-report

# Audit documentation pages with stricter FAQ requirements
npx one-step-seo audit https://docs.example.com --pages 10 --profile docs --out ./seo-report
```

## 5. Evidence Requirements

- Cite `report.page.wordCount`, the active `--profile`, and the exact evidence from `C01`, `C02`, `C03`, `C04`, `C05`, and `G11`.
- Never claim a page is "high quality" or "authoritative" based solely on word count; report structural readiness signals honestly.

## 6. Expected Outputs

1. **Content Signal Scorecard**: Word count vs profile threshold, answer-first status, list/table count, table `<th>` status, FAQ detection, and `<main>`/`<article>` landmark presence.
2. **Structural Restructuring Plan**: Drafted 40–60 word opening answer block, semantic `<table>` with `<th>` headers, or FAQ section grounded strictly in the page's existing facts.

## 7. Limitations & External Data

- **Automated CLI checks**: Word count (body prose only), informational question + answer opening detection, `<ul>`/`<ol>`/`<table>` counts, `<th>` header presence, FAQ heading/schema detection, and `<main>`/`<article>` landmarks.
- **Advisory / manual judgment**: Factual accuracy, originality, tone of voice, and subject-matter expertise require human editorial review.

## 8. Safety & Approval Rules

- Never fabricate statistics, citations, customer quotes, or research findings when drafting content expansions or answer capsules. Use explicit `[TODO: insert verified metric]` placeholders where user data is needed.

## 9. Examples

```bash
# Check content quality on a product page using the product calibration
npx one-step-seo page https://example.com/shop/item --profile product --skills content-quality --out ./seo-report
```
