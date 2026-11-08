---
name: local-seo
description: Audit and optimize local business pages with LocalBusiness Schema.org JSON-LD, Name-Address-Phone (NAP) entity consistency, opening hours, geo-coordinates, and regional landing page hygiene.
---

# local-seo — Local Business SEO & Entity Signals

## 1. Description & Activation Criteria

Activate `local-seo` when the user wants to:

- Optimize brick-and-mortar stores, clinics, restaurants, agencies, or service-area businesses for local search pack and AI map/location answers.
- Generate or validate `LocalBusiness` (and subtypes like `Restaurant`, `Store`, `MedicalClinic`, `LegalService`, `FinancialService`) JSON-LD structured data (`S02-localbusiness` P2, `S01-none` P1, `S01-json-invalid` P1).
- Align visible Name, Address, and Phone (NAP) facts with `<title>`, `metaDescription`, `og:title` (`G04-entity` P3), and structured data.

## 2. Inputs & Prerequisites

- **Target**: Storefront homepage, location landing page (`/locations/austin`), or local HTML build file.
- **Required business facts (from the page or user — never fabricated)**:
  - Official business `name`, physical `PostalAddress` (`streetAddress`, `addressLocality`, `addressRegion`, `postalCode`, `addressCountry`), `telephone`, canonical `url`, and optional `openingHoursSpecification` / `geo`.

## 3. Step-by-Step Workflow

1. **Run a local-SEO audit & schema inspection**:
   - Execute `npx one-step-seo page <url> --skills local-seo --out ./seo-report`.
   - Run `npx one-step-seo schema <url> --generate localbusiness` to inspect existing JSON-LD and generate a starter `LocalBusiness` node grounded in the page's real title and URL.
2. **Validate `LocalBusiness` JSON-LD (`S01-none`, `S01-json-invalid`, `S02-localbusiness`)**:
   - Ensure valid JSON-LD exists (`S01-none` P1, `S01-json-invalid` P1) using `@type: "LocalBusiness"` or the most specific Schema.org subtype (`Restaurant`, `Dentist`, `AutoRepair`, `ProfessionalService`, etc.).
   - Populate `name`, `url`, `telephone`, `address` (`@type: "PostalAddress"`), `geo` (`@type: "GeoCoordinates"`), `image`, and `openingHoursSpecification` matching visible text on the page.
3. **Align location metadata & entity titles (`O01-title-missing`, `O02-meta-missing`, `G04-entity`)**:
   - Check `report.page.title` (30–60 chars) and `report.page.metaDescription` (120–155 chars) include the primary service and city/neighborhood naturally.
   - Ensure `og:title` matches `<title>` (`G04-entity` P3) so AI assistants attribute hours, address, and phone numbers to the right branch.
4. **Surface machine-extractable local facts (`G03-facts`, `C03-extractable`)**:
   - Present address, phone number, service areas, and business hours in clean semantic HTML (`<address>`, `<table>` with `<th>` headers, or structured `<dl>`/`<ul>` lists) rather than locking them inside images or canvas maps.

## 4. Tools & CLI Commands

```bash
# Audit a location page with the local-seo skill filter
npx one-step-seo page https://example.com/locations/chicago --skills local-seo --out ./seo-report

# Validate schema and generate a starter LocalBusiness JSON-LD snippet
npx one-step-seo schema https://example.com/locations/chicago --generate localbusiness

# Multi-location crawl to detect duplicate titles across city pages
npx one-step-seo audit https://example.com/locations --pages 25 --skills local-seo,duplicate-content --out ./seo-report
```

## 5. Evidence Requirements

- Cite `report.page.title`, `report.page.metaDescription`, `report.page.canonical`, and all `S01-*`, `S02-*`, and `G04-entity` findings from `report.findings`.
- Verify every field in recommended `LocalBusiness` JSON-LD (`telephone`, `streetAddress`, `postalCode`, `openingHours`) matches visible text on the audited page.

## 6. Expected Outputs

1. **Local Entity & NAP Audit**: Status of `<title>`, `metaDescription`, `<html lang>`, entity consistency, and JSON-LD schema.
2. **Validated `LocalBusiness` JSON-LD**: Copy-paste `<script type="application/ld+json">` block using the most specific Schema.org subtype and visible NAP details.
3. **Multi-Location Differentiation Plan** (when auditing multiple branch pages): Unique title/H1/description recommendations per location.

## 7. Limitations & External Data

- **Automated CLI checks**: HTML metadata, entity title consistency, extractable fact structures, and Schema.org `LocalBusiness` JSON-LD validation.
- **External data (off-page)**: Google Business Profile (GBP) verification status, third-party directory citations (Yelp, Apple Maps, Bing Places), and live map pack rankings cannot be queried from HTML alone and require external GBP/citation tools.

## 8. Safety & Approval Rules

- **Zero fabricated business data**: Never invent phone numbers, street addresses, geo-coordinates, price ranges, or aggregate customer ratings (`AggregateRating`). Use `[TODO: insert verified phone/address]` placeholders whenever a field is not present on the page or provided by the user.
- Never generate doorway city pages with spun duplicate text; every location page must represent a genuine branch or distinct service area.

## 9. Examples

```bash
# Offline audit of local storefront landing pages
npx one-step-seo audit ./dist/locations --pages 10 --skills local-seo --offline --out ./seo-report

# Inspect the local-seo skill rules
npx one-step-seo skills local-seo
```
