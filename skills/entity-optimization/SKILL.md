---
name: entity-optimization
description: Audit and align Knowledge Graph entity disambiguation, E-E-A-T authorship, content freshness signals, Organization/Person/Article JSON-LD @graph linking, and title/H1/og:title consistency.
---

# entity-optimization — Entity SEO, Authorship & E-E-A-T Signals

## 1. Description & Activation Criteria

Activate `entity-optimization` when the user wants to:

- Strengthen brand, author, and topic entity disambiguation for Google Knowledge Graph and LLM retrieval systems.
- Audit E-E-A-T trust signals on editorial, medical, financial, technical, or B2B content: explicit authorship (`G10-author` P3), publication/review freshness dates (`G06-freshness` P3), `<title>` vs `og:title` entity consistency (`G04-entity` P3), `<title>` vs `<h1>` alignment (`O03-h1-drift` P3), and unified `@graph` structured data (`S01-none` P1, `S01-json-invalid` P1, `S02-organization` P2, `S02-article` P2).

## 2. Inputs & Prerequisites

- **Target**: Editorial articles, whitepapers, About/Team pages, or corporate homepages (live URL or local HTML).
- **Key CLI filters**:
  - `--skills entity-optimization` (aliases: `eeat`, `entity-seo`).
  - `schema --generate organization|website|article`: Generates starter entity JSON-LD blocks grounded in the page's actual metadata.

## 3. Step-by-Step Workflow

1. **Run an entity-scoped audit**:
   - Execute `npx one-step-seo page <url> --skills entity-optimization --out ./seo-report` and `npx one-step-seo ai <url> --json`.
2. **Eliminate entity naming drift (`G04-entity`, `O03-h1-drift`)**:
   - Inspect `report.page.title` and `report.page.h1`. When `O03-h1-drift` (`P3`) or `G04-entity` (`P3`) fires, align `<title>`, `<h1>`, and `og:title` so search engines and LLMs associate every fact on the page with one unambiguous entity name.
3. **Establish explicit authorship & publisher authority (`G10-author`)**:
   - On substantive pages (`>= 300` words), verify `<meta name="author">` or JSON-LD `author` (`Person` or `Organization` with `name`, `url`, and verified `sameAs` profile links) is declared (`G10-author` P3).
4. **Surface machine-readable freshness signals (`G06-freshness`)**:
   - Ensure date-sensitive articles expose `<time datetime="YYYY-MM-DD">` and matching JSON-LD `datePublished` + `dateModified` (`G06-freshness` P3).
5. **Link entities in a single JSON-LD `@graph` (`S01`, `S02`)**:
   - Connect `Organization` (`#organization`) -> `WebSite` (`#website`) -> `Person` (`#author`) -> `Article` (`#article`) via stable `@id` URIs so crawlers resolve the publisher, author, and subject graph without ambiguity.

## 4. Tools & CLI Commands

```bash
# Audit entity consistency, authorship, freshness, and JSON-LD on an article
npx one-step-seo page https://example.com/blog/distributed-consensus --skills entity-optimization --out ./seo-report

# Generate starter Organization and Article JSON-LD nodes
npx one-step-seo schema https://example.com --generate organization
npx one-step-seo schema https://example.com/blog/distributed-consensus --generate article

# Multi-page editorial E-E-A-T audit across blog posts
npx one-step-seo audit https://example.com/blog --pages 20 --profile blog --skills eeat --out ./seo-report
```

## 5. Evidence Requirements

- Quote `G04-entity`, `G06-freshness`, `G10-author`, `O03-h1-drift`, `S01-*`, and `S02-*` `evidence` strings from `report.findings`.
- Cite `signals.schemaTypes` and `signals.hasAuthor` from `one-step-seo ai <url> --json` alongside `report.page.title` and `report.page.h1`.

## 6. Expected Outputs

1. **Entity & E-E-A-T Alignment Table**: Comparison of `<title>`, `<h1>`, `og:title`, author metadata, freshness dates, and JSON-LD `@type` nodes.
2. **Unified `@graph` JSON-LD Block**: Copy-paste `<script type="application/ld+json">` linking `Organization`, `Person`, `WebPage`, and `Article` via `@id`.

## 7. Limitations & External Data

- **On-page vs off-page authority**: `one-step-seo` verifies machine-readable entity, authorship, and freshness declarations in HTML/JSON-LD; external backlink authority, Wikipedia/Wikidata notables, and brand search volume require external off-page datasets.
- **Offline support**: 100% supported offline (`--offline`).

## 8. Safety & Approval Rules

- **Never fabricate author credentials, biographies, `sameAs` social URLs, or fake `dateModified` timestamps**: Only bump `dateModified` when substantive editorial updates were actually made, and never invent fictional expert personas.

## 9. Examples

```bash
# Inspect the entity-optimization skill checks and aliases
npx one-step-seo skills entity-optimization

# Audit an offline static blog export for E-E-A-T and entity alignment
npx one-step-seo audit ./dist/blog --pages 15 --skills entity-optimization --offline --out ./seo-report
```
