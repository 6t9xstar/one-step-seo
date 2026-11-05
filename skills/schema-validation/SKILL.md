---
name: schema-validation
description: Extract, validate, and generate Schema.org JSON-LD structured data, including @graph inheritance, 17 rich-result required-property rules, Product/LocalBusiness validation, and FAQ visible content parity.
---

# schema-validation — Structured Data & Rich Result Validation

## 1. Description & Activation Criteria

Activate `schema-validation` when the user wants to:

- Extract and validate JSON-LD `<script type="application/ld+json">` blocks on a page or local HTML file (`S01-json-invalid`, `S01-none`, `S02-*`, `S03-faq-parity`).
- Validate e-commerce `Product` (`offers` / `review` / `aggregateRating`), `LocalBusiness`, `Article`, `FAQPage`, `BreadcrumbList`, `Organization`, `WebSite`, `Event`, `VideoObject`, `HowTo`, `JobPosting`, `Course`, `Recipe`, `Review`, or `SoftwareApplication` markup.
- Generate clean, XSS-safe JSON-LD starter snippets across 14 Schema.org types using `one-step-seo schema <url> --generate <kind>`.

## 2. Inputs & Prerequisites

- **Target**: Live URL or local HTML file.
- **Supported `--generate` kinds (`lib/schema.mjs`)**:
  `organization`, `website`, `article`, `faq`, `breadcrumb`, `product`, `event`, `localbusiness`, `howto`, `video`, `job`, `course`, `review`, `recipe`.

## 3. Step-by-Step Workflow

1. **Inspect existing JSON-LD nodes and issues**:
   - Run `npx one-step-seo schema <url>` or `npx one-step-seo page <target> --skills schema-structured-data --out ./seo-report`.
2. **Fix JSON syntax errors first (`S01-json-invalid`, P0)**:
   - Unparseable JSON-LD (trailing commas, unescaped quotes, broken tags) costs 25 Search SEO points and is completely ignored by search engines.
3. **Resolve per-type required property issues (`S02-<type>`, P2)**:
   - Inspect every `S02-*` finding (`schema-structured-data`):
     - `Article` / `BlogPosting` / `NewsArticle`: requires `headline`
     - `Product`: requires `offers`, `review`, or `aggregateRating`
     - `FAQPage`: requires `mainEntity` questions array
     - `BreadcrumbList`: requires `itemListElement`
     - `Organization` / `LocalBusiness` / `WebSite` / `HowTo` / `Course` / `Recipe` / `SoftwareApplication`: requires `name`
     - `Event`: requires `startDate`
     - `VideoObject`: requires `thumbnailUrl`
     - `JobPosting`: requires `title`
     - `Review`: requires `itemReviewed`
4. **Verify FAQ content parity (`S03-faq-parity`, P3)**:
   - If a page has `FAQPage` JSON-LD without visible FAQ copy on the page, warn the user that invisible FAQ markup violates search engine structured data guidelines (`S03-faq-parity`).
   - If a page has visible FAQ headings/questions without `FAQPage` JSON-LD, generate the matching `FAQPage` snippet from the visible Q&A pairs.
5. **Generate valid JSON-LD snippets when missing (`S01-none`, P1)**:
   - Run `npx one-step-seo schema <url> --generate <kind>` to produce a starter `<script type="application/ld+json">` block seeded with the page's real `<title>`, `<meta name="description">`, and `finalUrl`.

## 4. Tools & CLI Commands

```bash
# Validate JSON-LD on a live URL and generate a Product schema snippet
npx one-step-seo schema https://example.com/shop/item --generate product

# Run schema-focused audit checks on a local HTML file
npx one-step-seo page ./dist/index.html --skills schema-validation --offline --out ./seo-report
```

## 5. Evidence Requirements

- Quote all detected `@type` values from `report.page.schemaTypes` (or `schema` command stdout).
- Quote exact `S01-json-invalid`, `S02-*`, and `S03-faq-parity` evidence strings.
- Confirm whether `@graph` blocks properly declare `"@context": "https://schema.org"` at the root or node level.

## 6. Expected Outputs

1. **Detected Schema Inventory**: Node count, `@type` list, syntax status, and property validation results.
2. **Ready-to-Paste JSON-LD `<script>` Block**: Validated against `lib/schema.mjs` with `</script` safely escaped as `<\/script` to prevent XSS breakout.

## 7. Limitations & External Data

- **Structural vocabulary check**: `lib/schema.mjs` validates JSON syntax, `@context` inheritance across `@graph` arrays, a 350+ type `KNOWN_TYPES` allowlist, and required properties for 17 core rich-result types.
- **No fabricated identity data**: `generateSchema` refuses to emit placeholder `"Example"` identity data when `name` or `url` is missing.

## 8. Safety & Approval Rules

- **Never invent ratings, prices, review counts, salaries, or event dates** in JSON-LD markup. Every property in `<script type="application/ld+json">` must match visible text on the page.
- Always escape `</script` as `<\/script` inside JSON-LD blocks (`schemaSnippet` enforces this automatically).

## 9. Examples

```bash
# Validate existing schema and generate LocalBusiness JSON-LD
npx one-step-seo schema https://example.com/contact --generate localbusiness
```
