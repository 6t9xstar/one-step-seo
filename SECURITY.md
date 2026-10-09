# Security Policy

## Supported versions

| Version   | Supported                 |
| --------- | ------------------------- |
| `0.4.x`   | Yes                       |
| `0.3.x`   | Yes (security fixes only) |
| `< 0.3.0` | No (pre-release)          |

## Reporting a vulnerability

Prefer **GitHub Private Vulnerability Reporting**:
https://github.com/6t9xstar/one-step-seo/security/advisories/new

Email **mtaimoormalik99@gmail.com** if that form is unavailable. Include:

1. Affected version / commit
2. Reproduction steps (URL or fixture + command)
3. Impact assessment

Please do not open a public issue for unpatched vulnerabilities.

We aim to acknowledge within **3 business days** and ship or mitigate within
**30 days**. We will credit reporters unless anonymity is requested.

## Scope notes

- This tool fetches URLs you point it at. Do not aim it at sites you are not
  allowed to crawl; respect `robots.txt` and rate limits. Unauthorized
  crawling of third-party sites is out of scope.
- No network exfiltration: audits run locally, reports stay in `--out`. If you
  find telemetry, that is a bug — report it.
- Runtime dependencies: none (zero-dep). Security issues in `lib/` and `bin/`
  are in scope; issues in `devDependencies` (eslint, prettier, typescript) are
  lower priority but still welcome.
