---
name: seo-fix
description: Apply safe SEO fixes previewed from a one-step-seo report. Read-only by default.
---

# seo-fix sub-skill (opt-in writer)

Only run when the user explicitly asks to fix. Default: preview only.

## Allowed without asking (additive, verifiable)

- `<meta charset>`, viewport, `lang`, title/meta tweaks user approved
- Canonical link, OG/Twitter tags, favicon link
- Image `alt`, `width`/`height`, `loading="lazy"`
- JSON-LD snippets from `one-step-seo schema <url> --generate <kind>`
  (kinds: organization, website, article, faq, breadcrumb, product, event, localbusiness, howto)
- `robots.txt` sitemap line, `sitemap.xml` entry, `llms.txt` draft
- Snippets printed in `report.md` (“Copy-paste starting point”) and by
  `one-step-seo llms <url>` (starter `llms.txt`, AI-crawler `robots.txt`
  snippet) — review placeholders with the user before publishing

## Needs per-item approval

- Generated title/meta rewrites, heading restructuring
- New FAQ/answer blocks, internal-link insertions
- Any content rewrite

## Never do

- Fake reviews, stats, citations, business info, competitor claims
- Performance rewrites, redirects, link-building promises
- Write to `.git/`, secrets, lockfiles
- Claim guaranteed rankings or AI citations

## Protocol

1. `git status --porcelain` — refuse dirty tree unless user confirms.
2. For local `.html` files, prefer the built-in writer (dry-run first):
   ```bash
   npx one-step-seo fix <path> [--url U] [--lang L] [--only a,b]   # preview diff
   npx one-step-seo fix <path> --apply                              # writes + .bak
   ```
   It only applies the allow-listed additive fixes below, verifies each one
   in memory, and prints the unified diff before anything is written.
3. For any other file change, show a unified diff before writing.
4. Re-run `npx one-step-seo page <url>` after fixes; report score delta.
5. Keep backups; explain rollback (`git checkout -- <file>`).
