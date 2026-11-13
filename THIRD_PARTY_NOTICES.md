# Third-party notices

one-step-seo has no runtime dependencies. Some of its code is ported from
other open-source projects. Their licenses are reproduced below, as those
licenses require.

## Open SEO Crawler

- Project: <https://github.com/puneetindersingh/open-seo-crawler>
- Ported from commit `2dc7cef` (2026-11-10)
- License: MIT, Copyright (c) 2026 Puneet Inder Singh

These features were ported from the Python original into one-step-seo's
JavaScript, changed where noted:

| one-step-seo                                 | What was ported                                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/throttle.mjs`                           | Retries for rate limits and gateway errors with back-off and `Retry-After`; latency-aware pacing of slow hosts; firewall block page and CDN challenge detection |
| `lib/url-traps.mjs`                          | Crawler-trap URL filtering (feeds, APIs, page-builder pagination, repeated segments) and the URL hygiene helpers behind T24–T26 and T28–T29                     |
| `lib/crawl.mjs`                              | Retries, pacing and the firewall stop inside the crawl; soft-404 probes                                                                                         |
| `lib/page-checks.mjs`                        | Page checks T19–T30, O12, O13, C06 and P07                                                                                                                      |
| `lib/bot-check.mjs`, `lib/commands/bots.mjs` | Crawler readability check: the agent list and published user agents, robots.txt precedence, the page sample, the browser comparison and mobile parity           |
| `lib/intelligence.mjs` (X22–X26)             | Site issues built on the soft-404 probes and the crawler check                                                                                                  |

Changes from the original:

- TLS certificates are always verified. The original's crawler check
  retried a request without verification after a certificate error.
- The crawler check does not send a crawler's user agent to a page that
  robots.txt disallows for that crawler, unless `--force` is given. It
  reports the page as disallowed instead.
- Firewall blocks and CDN challenges are detected and reported, never
  bypassed.
- JavaScript is not rendered (no Playwright). Pages served as an empty app
  shell are pointed out instead.
- Not ported: the Flask web interface, installers, auto-update, the MCP
  server, XLSX export and JavaScript rendering.

### License

```text
MIT License

Copyright (c) 2026 Puneet Inder Singh

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
