---
name: llms-txt
description: Audit /llms.txt presence and Markdown structure, inspect AI crawler rules across 25 bot tokens in robots.txt, and generate curated starter llms.txt files.
---

# llms-txt — `/llms.txt` & AI Crawler Access Policy

## 1. Description & Activation Criteria

Activate `llms-txt` when the user wants to:

- Check if `/llms.txt` exists and follows the Markdown specification (`G01-llms`, `G05-llms-quality`).
- Generate a starter `/llms.txt` directory and AI-crawler `robots.txt` snippet using `one-step-seo llms <url>`.
- Audit which of the 25 recognized AI crawlers (`GPTBot`, `OAI-SearchBot`, `ChatGPT-User`, `ClaudeBot`, `Claude-SearchBot`, `PerplexityBot`, `Google-Extended`, `CCBot`, `Applebot-Extended`, etc.) are blocked or allowed in `/robots.txt` (`G02-ai-blocked`).

## 2. Inputs & Prerequisites

- **Target**: Live `http(s)` URL (for `one-step-seo llms <url>`) or local directory containing `llms.txt` and `robots.txt`.
- **`/llms.txt` Quality Requirements (`G05-llms-quality`)**:
  - Must be non-empty plain text / Markdown served at `<origin>/llms.txt` with HTTP `200`.
  - Must include at least one Markdown heading (`# Title` or `## Section`) **and** at least one Markdown link (`[Page Title](https://...)`) or URL.

## 3. Step-by-Step Workflow

1. **Run the `llms` generator and diagnostic command**:
   - Execute `npx one-step-seo llms <url> --json` (or without `--json` for human-readable output).
   - Inspect `llmsFound`, `llmsBytes`, `starter`, and `robotsSnippet`.
2. **Audit existing `/llms.txt` structure (`G01-llms`, `G05-llms-quality`)**:
   - If `G01-llms` (`P2`) fires, `/llms.txt` returned 404 or was empty.
   - If `G05-llms-quality` (`P3`) fires, `/llms.txt` exists but lacks Markdown headings (`#`) or links (`[title](url)`), making it harder for LLM agents to navigate.
3. **Audit AI crawler rules in `/robots.txt` (`G02-ai-blocked`)**:
   - Run `npx one-step-seo page <url> --skills llms-txt --out ./seo-report`.
   - If `G02-ai-blocked` (`P1`) fires, read the exact list of blocked user-agent tokens from the finding `evidence` (e.g., `robots.txt blocks AI crawler(s): gptbot, claudebot`).
4. **Curate the `/llms.txt` draft**:
   - Refine the generated `starter` output by replacing placeholder descriptions with concise 1-sentence descriptions of the site's canonical documentation, product, and FAQ URLs.

## 4. Tools & CLI Commands

```bash
# Check /llms.txt status and print a starter llms.txt + robots.txt snippet
npx one-step-seo llms https://example.com

# Machine-readable JSON output
npx one-step-seo llms https://example.com --json

# Audit G01, G02, G05, and G09 on a page
npx one-step-seo page https://example.com --skills llms-txt --out ./seo-report
```

## 5. Evidence Requirements

- Quote `llmsFound` and `llmsBytes` from `llms --json` or `report.site.llmsTxt`.
- Quote the exact blocked bot tokens from `G02-ai-blocked` evidence when `/robots.txt` restricts AI crawlers.

## 6. Expected Outputs

1. **Curated `/llms.txt` File**: Valid Markdown with `# Site Name`, `> One-paragraph summary`, and `## Key pages` containing annotated links to real URLs discovered on the site.
2. **AI Crawler `robots.txt` Policy Snippet**: Explicit `User-agent` / `Allow: /` rules for the user's chosen AI assistants.

## 7. Limitations & External Data

- **`llms.txt` is diagnostic & read-only**: `one-step-seo llms <url>` prints the starter draft to stdout and never writes to a remote server.
- **25-bot token registry**: `lib/robots.mjs` (`AI_BOTS`) checks 25 known AI user-agent tokens; a wildcard `User-agent: *` `Disallow: /` also blocks all crawlers and triggers `T05-robots-disallow`.

## 8. Safety & Approval Rules

- Never invent URLs in `/llms.txt` that do not exist on the target site; use only URLs discovered from the live page or `/sitemap.xml`.
- Always leave explicit placeholders where human curation is needed.

## 9. Examples

```bash
# Generate a starter llms.txt from live page metadata and up to 20 sitemap URLs
npx one-step-seo llms https://docs.example.com
```
