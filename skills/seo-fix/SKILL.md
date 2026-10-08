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
- `robots.txt` sitemap line, `sitemap.xml` entry, `llms.txt` draft

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
2. Show unified diff for every file change before writing.
3. Re-run `npx one-step-seo page <url>` after fixes; report score delta.
4. Keep backups; explain rollback (`git checkout -- <file>`).
