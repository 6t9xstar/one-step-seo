---
name: ecommerce-seo
description: Audit and optimize e-commerce product and category pages using --profile product calibration, Product/Offer/Review/BreadcrumbList JSON-LD, faceted canonicals, and product image metadata.
---

# ecommerce-seo — E-Commerce & Product Page SEO

## 1. Description & Activation Criteria

Activate `ecommerce-seo` when the user wants to:

- Audit e-commerce product detail pages (PDPs), collection/category pages (PLPs), or SaaS pricing/catalog pages.
- Validate `Product`, `Offer`, `AggregateOffer`, `AggregateRating`, `Review`, and `BreadcrumbList` JSON-LD (`S01-none` P1, `S01-json-invalid` P1, `S02-product` P2, `S02-review` P2, `S02-breadcrumblist` P2).
- Prevent crawl traps and duplicate content from faceted filter URLs (`?color=blue&sort=price_asc`, `T12-url` P2, `T08-canonical` P1/P2) and fix product gallery image `alt`/CLS issues (`O08-alt` P1, `O09-img-dims` P2).

## 2. Inputs & Prerequisites

- **Target**: Product URL, category URL, or local e-commerce build directory.
- **Profile calibration (`--profile product`)**:
  - Lowers the thin-content threshold (`C01-thin`) from `200` words to **`120` words** (calibrated for concise spec-driven PDPs) and skips `C02-answer` (since PDPs lead with product specs and pricing rather than prose essays).

## 3. Step-by-Step Workflow

1. **Run a product-calibrated e-commerce audit**:
   - Execute `npx one-step-seo page <url> --profile product --skills ecommerce-seo --out ./seo-report` (or omit `--skills` for a full PDP audit with `--profile product`).
2. **Validate `Product` & `BreadcrumbList` structured data (`S01`, `S02`)**:
   - Run `npx one-step-seo schema <url> --generate product` and `npx one-step-seo schema <url> --generate breadcrumb`.
   - Ensure `Product` JSON-LD includes `name`, `description`, `image`, `sku`/`mpn`/`gtin` (when available), and nested `offers` (`@type: "Offer"`, `price`, `priceCurrency`, `availability`, `url`).
   - Only include `aggregateRating` or `review` when genuine customer reviews are visibly rendered on the PDP.
3. **Audit faceted URLs & canonical consolidation (`T08-canonical`, `T12-url`)**:
   - Filter/sort query URLs (`?size=m&sort=newest`) trigger `T12-url` (P2); ensure non-indexable filter combinations canonicalize (`T08-canonical`) to the clean base category or product URL.
4. **Optimize product media & social previews (`O08-alt`, `O09-img-dims`, `O06-og`)**:
   - Every product photo needs descriptive `alt` text naming the product, variant, and angle (`O08-alt` P1) plus explicit `width` and `height` attributes (`O09-img-dims` P2) to prevent Cumulative Layout Shift (CLS) on mobile PDPs.
   - Verify `og:title`, `og:description`, and high-resolution `og:image` (`O06-og` P2) for social commerce previews.
5. **Surface citable product specs for AI shopping assistants (`C03-extractable`, `G03-facts`, `G08-stat-density`)**:
   - Render dimensions, materials, compatibility, pricing, and shipping terms in a semantic `<table>` with `<th>` headers so AI shopping engines can compare and cite exact specs.

## 4. Tools & CLI Commands

```bash
# Audit a product page using the calibrated product profile
npx one-step-seo page https://example.com/products/ergonomic-chair --profile product --out ./seo-report

# Focused e-commerce schema, media, and canonical audit across 25 store URLs
npx one-step-seo audit https://example.com/collections --pages 25 --profile product --skills ecommerce-seo --out ./seo-report

# Generate starter Product and BreadcrumbList JSON-LD snippets
npx one-step-seo schema https://example.com/products/ergonomic-chair --generate product
npx one-step-seo schema https://example.com/products/ergonomic-chair --generate breadcrumb
```

## 5. Evidence Requirements

- Cite `report.scores.search.score`, `report.scores.ai.score`, `report.page.images`, `report.page.canonical`, and specific `S01-*`, `S02-*`, `O08-alt`, `O09-img-dims`, and `T08-canonical` findings from `report.findings`.
- Confirm all `Offer` prices, currencies, and stock availability values match visible PDP copy.

## 6. Expected Outputs

1. **PDP / Category Health Summary**: Dual Search & AI scores under `--profile product`, image metadata coverage, and canonical hygiene.
2. **Merchant-Ready JSON-LD `@graph`**: Unified `Product` + `Offer` + `BreadcrumbList` block matching visible page values.
3. **Faceted Navigation & Media Fixes**: Canonical rules for filter query params and `alt`/`width`/`height` fixes for product galleries.

## 7. Limitations & External Data

- **Automated CLI checks**: HTML product metadata, canonical/query-URL hygiene, image `alt`/dimensions, extractable spec tables, and syntactic/structural Schema.org validation.
- **External data**: Live Google Merchant Center feed status, GTIN registry lookups, and real-time inventory ERP syncs require external Merchant Center access.

## 8. Safety & Approval Rules

- **Never invent prices, stock status, or review ratings**: Fake `AggregateRating` or mismatched `Offer.price` values trigger manual structured-data penalties in Google Search.
- Confirm with the store owner before canonicalizing parameterized variant URLs (e.g., `?color=red`) if distinct color variants intentionally target separate search queries.

## 9. Examples

```bash
# Audit an offline static storefront export with product profile calibration
npx one-step-seo audit ./dist/products --pages 15 --profile product --offline --out ./seo-report

# Inspect the ecommerce-seo skill definition
npx one-step-seo skills ecommerce-seo
```
