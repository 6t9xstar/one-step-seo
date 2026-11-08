---
name: answer-engine-optimization
description: Optimize content structure for featured snippets, Google AI Overviews, Perplexity, and ChatGPT Search with direct answer capsules, question H2s, labeled comparison tables, quantified facts, and FAQ parity.
---

# answer-engine-optimization — Answer Engine & Featured Snippet Optimization (AEO)

## 1. Description & Activation Criteria

Activate `answer-engine-optimization` when the user wants to:

- Win featured snippets, "People Also Ask" (PAA) expansions, Google AI Overviews, Perplexity citations, and ChatGPT Search passages.
- Structure prose into high-signal answer capsules (`C02-answer` P1), extractable lists/tables (`C03-extractable` P2, `C05-table-headers` P3), natural question headings (`G07-question-headings` P3), quantified facts (`G03-facts` P2, `G08-stat-density` P3), and synchronized visible + JSON-LD FAQs (`C04-faq` P1/P2, `S03-faq-parity` P3).
- Ensure snippet controls (`G09-snippet-controls` P2) do not block passage extraction.

## 2. Inputs & Prerequisites

- **Target**: Informational guides, documentation pages (`--profile docs`), comparison articles, or landing pages (live URL or local HTML).
- **Key CLI filters**:
  - `--skills answer-engine-optimization` (alias: `aeo`, `featured-snippets`).
  - `--profile docs`: Elevates `C04-faq` and `G01-llms` to `P1` for documentation hubs where Q&A retrieval is primary.

## 3. Step-by-Step Workflow

1. **Run an AEO-focused audit**:
   - Execute `npx one-step-seo page <url> --skills answer-engine-optimization --out ./seo-report` and `npx one-step-seo ai <url> --json`.
2. **Verify snippet eligibility (`G09-snippet-controls`)**:
   - Ensure neither `<meta name="robots">` nor `X-Robots-Tag` contains `nosnippet` or `max-snippet:0` (`G09-snippet-controls` P2), which blocks both classic featured snippets and AI Overview passage quoting. Use `data-nosnippet` selectively on cookie banners or nav chrome instead.
3. **Craft the 40–60 word Answer-First Capsule (`C02-answer`)**:
   - Worth **25/100 points** on the AI Visibility score (`GEO_WEIGHTS`).
   - Within the first ~120 words of body copy, pose the core user question (`What/Why/How/When/Where/Which/Who ...?`) or a `TL;DR:` / `In short:` lead-in followed immediately by a self-contained 40–60 word factual definition or direct answer.
4. **Convert walls of prose into extractable structures (`C03-extractable`, `C05-table-headers`, `G07-question-headings`)**:
   - Phrase at least half of `<h2>` headings (on pages with 3+ H2s) as real user questions (`G07-question-headings` P3).
   - Add ordered `<ol>` step lists for procedural "How-to" queries and semantic `<table>` grids with explicit `<th>` column headers (`C03-extractable` P2, `C05-table-headers` P3) for comparisons, specs, and pricing.
5. **Synchronize visible FAQs with `FAQPage` JSON-LD (`C04-faq`, `S03-faq-parity`)**:
   - Add 3–6 genuine user questions and concise answers on-page (`C04-faq`), and keep `<script type="application/ld+json">` `FAQPage` nodes 1:1 synchronized with visible copy (`S03-faq-parity` P3).

## 4. Tools & CLI Commands

```bash
# Audit answer-engine and snippet signals on a guide or docs page
npx one-step-seo page https://example.com/guides/what-is-rag --skills aeo --out ./seo-report

# Audit documentation pages with docs profile calibration
npx one-step-seo audit https://example.com/docs --pages 15 --profile docs --skills answer-engine-optimization --out ./seo-report

# Generate a starter FAQPage JSON-LD block to pair with visible FAQ copy
npx one-step-seo schema https://example.com/guides/what-is-rag --generate faq
```

## 5. Evidence Requirements

- Report both `report.scores.ai.score` (`report.scores.ai.band`) and `report.scores.search.score` (`report.scores.search.band`) separately.
- Quote `C02-answer`, `C03-extractable`, `C04-faq`, `C05-table-headers`, `G03-facts`, `G07-question-headings`, `G08-stat-density`, `G09-snippet-controls`, and `S03-faq-parity` `evidence` strings from `report.findings`.

## 6. Expected Outputs

1. **AEO Readiness Breakdown**: Status of snippet eligibility, answer capsule, question H2 ratio, table header hygiene, stat density, and FAQ parity.
2. **Answer Capsule & Heading Rewrite**: A crisp 40–60 word opening answer block and question-shaped H2 outline derived strictly from existing page facts.
3. **Synchronized FAQ HTML + JSON-LD**: Matching `<section>` FAQ markup and `FAQPage` JSON-LD.

## 7. Limitations & External Data

- **Structural readiness vs SERP volatility**: Featured snippets and AI Overviews depend on live query intent and search index competition; `one-step-seo` verifies deterministic structural extractability, never guaranteed SERP placement.
- **Offline support**: 100% supported on local Markdown-rendered HTML and static builds (`--offline`).

## 8. Safety & Approval Rules

- **Never invent statistics, benchmarks, or citations**: When remediating `G03-facts` or `G08-stat-density`, extract real numbers already stated on the page or use explicit `[TODO: insert verified metric + source]` markers.
- Never add `FAQPage` JSON-LD for questions that are hidden or absent from the visible page (`S03-faq-parity`).

## 9. Examples

```bash
# Inspect the answer-engine-optimization skill checks and aliases
npx one-step-seo skills answer-engine-optimization

# Run an offline AEO audit on built documentation HTML
npx one-step-seo audit ./dist/docs --pages 10 --profile docs --skills aeo --offline --out ./seo-report
```
