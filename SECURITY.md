# Security Policy

## Supported versions

| Version    | Supported        |
| ---------- | ---------------- |
| `>= 0.1.x` | Yes              |
| `< 0.1.0`  | No (pre-release) |

## Reporting a vulnerability

Email **security@example.com** with:

1. Affected version / commit
2. Reproduction steps (URL or fixture + command)
3. Impact assessment

Please do not open a public issue for unpatched vulnerabilities.

We aim to acknowledge within **3 business days** and ship or mitigate within **90 days**. We will credit reporters unless anonymity is requested.

## Scope notes

- This tool fetches URLs you point it at. Do not aim it at sites you are not allowed to crawl; respect `robots.txt` and rate limits.
- No network exfiltration: audits run locally, reports stay in `--out`. If you find telemetry, that is a bug — report it.
