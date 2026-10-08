# Checks

Deterministic, no guessing. Every finding carries evidence + fix.

## Technical (T00–T12)

HTTPS, HTTP 200, redirect chain ≤1, HTML content-type, robots.txt,
sitemap.xml (including `Sitemap:` URLs declared in robots.txt),
noindex check, canonical self-reference, html lang,
UTF-8 charset, responsive viewport, clean URL shape.

Bodies over 5 MiB are truncated for safety and reported as `T00-truncated`
(P2) — checks then cover the head portion only.

## On-page (O01–O10)

Title 30–60ch, meta 120–155ch, single H1, logical heading order,
H2s on long pages, complete Open Graph, favicon, image alt,
image dimensions (CLS), internal linking.

## Content (C01–C04)

Thin-content (<200 words), answer-first block in first 150 words,
extractable tables/lists, FAQ coverage.

## Schema (S01–S02)

JSON-LD present + valid JSON, known `@type` spelling, required
fields (Article headline, FAQ mainEntity, Breadcrumb items).
Only mark up visible content.

## GEO / AI (G01–G03)

`llms.txt` (optional), AI crawlers not blanket-blocked,
facts in extractable structures.

## Performance hints (P01–P02)

HTML payload size, image count. For lab data use PageSpeed;
this tool flags cheap static signals only.

## Severity

P0 critical → P1 high → P2 medium → P3 low → pass healthy.
Fix in that order.
