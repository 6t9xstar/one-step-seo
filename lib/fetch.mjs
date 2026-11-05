/**
 * one-step-seo — minimal fetch layer (zero dependencies, Node 18+).
 * Follows redirects manually so the status chain is auditable.
 * Response bodies are capped (MAX_HTML_BYTES) so a giant page
 * can never OOM the process; oversized bodies are truncated and flagged.
 */
import net from "node:net";
import dns from "node:dns/promises";

/** @type {string} */
const DEFAULT_UA = "Mozilla/5.0 (compatible; one-step-seo/0.2.0; +https://github.com/6t9xstar/one-step-seo)";

export const MAX_REDIRECTS = 5;
/** Cap for audited HTML bodies (5 MiB). Robots/sitemap/llms.txt use a smaller cap below. */
export const MAX_HTML_BYTES = 5 * 1024 * 1024;
/** Cap for small discovery files (robots.txt / sitemap / llms.txt). */
export const MAX_TEXT_BYTES = 200_000;

/**
 * Parse an IPv4 string into an unsigned 32-bit integer.
 * Returns null if not a valid 4-octet IPv4 address.
 * @param {string} ip
 * @returns {number | null}
 */
export function ipv4ToUint32(ip) {
  const parts = String(ip || "").split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (let i = 0; i < 4; i++) {
    const part = parts[i] ?? "";
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = parseInt(part, 10);
    if (n < 0 || n > 255) return null;
    num = ((num << 8) | n) >>> 0;
  }
  return num;
}

/**
 * Check if an IPv4 integer falls into private, loopback, link-local,
 * shared address space (CGNAT), test-net, benchmark, multicast, or reserved ranges.
 * @param {number} num
 * @returns {boolean}
 */
export function isPrivateOrReservedIpv4(num) {
  // 0.0.0.0/8 (Current network / "this host")
  if (num >>> 24 === 0) return true;
  // 10.0.0.0/8 (Private-Use Networks, RFC 1918)
  if (num >>> 24 === 10) return true;
  // 100.64.0.0/10 (Shared Address Space / CGNAT, RFC 6598 - includes Alibaba metadata 100.100.100.200)
  if ((num & 0xffc00000) >>> 0 === 0x64400000) return true;
  // 127.0.0.0/8 (Loopback, RFC 1122)
  if (num >>> 24 === 127) return true;
  // 169.254.0.0/16 (Link Local, RFC 3927 - includes AWS IMDS 169.254.169.254)
  if (num >>> 16 === ((169 << 8) | 254)) return true;
  // 172.16.0.0/12 (Private-Use Networks, RFC 1918: 172.16.0.0 - 172.31.255.255)
  if ((num & 0xfff00000) >>> 0 === 0xac100000) return true;
  // 192.0.0.0/24 (IETF Protocol Assignments, RFC 6890 - includes Oracle metadata 192.0.0.192)
  if (num >>> 8 === 0xc00000) return true;
  // 192.0.2.0/24 (TEST-NET-1, RFC 5737)
  if (num >>> 8 === 0xc00002) return true;
  // 192.88.99.0/24 (6to4 Relay Anycast, RFC 3068)
  if (num >>> 8 === 0xc05863) return true;
  // 192.168.0.0/16 (Private-Use Networks, RFC 1918)
  if (num >>> 16 === ((192 << 8) | 168)) return true;
  // 198.18.0.0/15 (Benchmarking, RFC 2544: 198.18.0.0 - 198.19.255.255)
  if ((num & 0xfffe0000) >>> 0 === 0xc6120000) return true;
  // 198.51.100.0/24 (TEST-NET-2, RFC 5737)
  if (num >>> 8 === 0xc63364) return true;
  // 203.0.113.0/24 (TEST-NET-3, RFC 5737)
  if (num >>> 8 === 0xcb0071) return true;
  // 224.0.0.0/4 (Multicast, RFC 5771: 224.0.0.0 - 239.255.255.255)
  if (num >>> 28 === 14) return true;
  // 240.0.0.0/4 (Reserved for Future Use / Broadcast, RFC 1112: 240.0.0.0 - 255.255.255.255)
  if (num >>> 28 === 15) return true;
  return false;
}

/**
 * Block well-known cloud instance metadata endpoints to prevent SSRF credential theft.
 * Covers AWS IMDSv1/v2, GCP, Azure, Alibaba, Oracle Cloud, and IPv6/IPv4-mapped variations.
 * @param {string} urlString
 * @returns {boolean}
 */
export function isBlockedMetadataEndpoint(urlString) {
  try {
    const u = new URL(urlString);
    const host = u.hostname.toLowerCase();
    const clean = host.replace(/^\[|\]$/g, "");
    if (
      clean === "169.254.169.254" ||
      clean === "metadata.google.internal" ||
      clean === "metadata.internal" ||
      clean === "metadata" ||
      clean === "100.100.100.200" ||
      clean === "192.0.0.192" ||
      clean === "instance-data" ||
      clean === "fd00:ec2::254"
    ) {
      return true;
    }
    // IPv4-mapped IPv6 representations for metadata endpoints
    if (clean.startsWith("::ffff:") || clean.includes(":ffff:")) {
      const sub = clean.replace(/^.*:ffff:/i, "");
      if (
        sub === "169.254.169.254" ||
        sub === "a9fe:a9fe" ||
        sub === "100.100.100.200" ||
        sub === "6464:64c8" ||
        sub === "192.0.0.192" ||
        sub === "c000:c0" ||
        sub === "c000:00c0"
      ) {
        return true;
      }
      const parts = sub.split(":");
      if (parts.length === 2) {
        const p1 = parseInt(parts[0] ?? "0", 16);
        const p2 = parseInt(parts[1] ?? "0", 16);
        if (!isNaN(p1) && !isNaN(p2)) {
          const ip = `${(p1 >> 8) & 0xff}.${p1 & 0xff}.${(p2 >> 8) & 0xff}.${p2 & 0xff}`;
          if (ip === "169.254.169.254" || ip === "100.100.100.200" || ip === "192.0.0.192") {
            return true;
          }
        }
      }
    }
    // IPv6 link-local queries (fe80::/10)
    if (/^fe80:/i.test(clean)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if a host belongs to private, loopback, or internal network ranges.
 * @param {string} host
 * @returns {boolean}
 */
export function isPrivateOrLoopbackHost(host) {
  const h = String(host || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .trim();
  if (!h) return false;
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".lan") ||
    h.endsWith(".home") ||
    h.endsWith(".corp") ||
    h === "0.0.0.0"
  ) {
    return true;
  }
  // Try IPv4 check
  const ip4 = ipv4ToUint32(h);
  if (ip4 !== null) {
    return isPrivateOrReservedIpv4(ip4);
  }
  // IPv6 loopback & unspecified
  if (h === "::1" || h === "::") return true;
  // IPv6 link-local (fe80::/10)
  if (/^fe[89ab][0-9a-f]:/i.test(h)) return true;
  // IPv6 unique local address (fc00::/7)
  if (/^f[cd][0-9a-f]{2}:/i.test(h)) return true;
  // IPv6 multicast (ff00::/8)
  if (/^ff[0-9a-f]{2}:/i.test(h)) return true;
  // IPv6 documentation (2001:db8::/32)
  if (/^2001:0?db8:/i.test(h)) return true;
  // IPv6 discard-only (100::/64)
  if (/^100:/i.test(h)) return true;
  // IPv6 6to4 (2002::/16)
  if (/^2002:/i.test(h)) return true;
  // IPv4-mapped IPv6
  if (h.startsWith("::ffff:") || h.includes(":ffff:")) {
    const sub = h.replace(/^.*:ffff:/i, "");
    if (isPrivateOrLoopbackHost(sub)) return true;
    const parts = sub.split(":");
    if (parts.length === 2) {
      const p1 = parseInt(parts[0] ?? "0", 16);
      const p2 = parseInt(parts[1] ?? "0", 16);
      if (!isNaN(p1) && !isNaN(p2)) {
        const ip = `${(p1 >> 8) & 0xff}.${p1 & 0xff}.${(p2 >> 8) & 0xff}.${p2 & 0xff}`;
        return isPrivateOrLoopbackHost(ip);
      }
    }
  }
  return false;
}

/**
 * Defend against DNS rebinding and internal network probing.
 * Checks whether the hostname resolves to any private/internal/reserved IP address.
 * @param {string} host
 * @returns {Promise<{ safe: boolean, error?: string }>}
 */
export async function assertSafeDns(host) {
  const clean = host.toLowerCase().replace(/^\[|\]$/g, "");
  // If it's already an IP address, check directly
  if (net.isIP(clean)) {
    if (isPrivateOrLoopbackHost(clean)) {
      return { safe: false, error: `blocked IP address ${clean} (SSRF protection)` };
    }
    return { safe: true };
  }
  // Hostname: resolve via dns.lookup (all addresses)
  try {
    const records = await dns.lookup(clean, { all: true });
    for (const rec of records) {
      if (isPrivateOrLoopbackHost(rec.address)) {
        return {
          safe: false,
          error: `blocked DNS resolution to private/internal IP ${rec.address} (SSRF protection)`,
        };
      }
    }
    return { safe: true };
  } catch (err) {
    return {
      safe: false,
      error: `DNS resolution failed for ${clean}: ${/** @type {Error} */ (err)?.message ?? err}`,
    };
  }
}

/**
 * Validate URL scheme, host, metadata, and SSRF restrictions before connecting.
 * @param {string} targetUrl
 * @param {{
 *   blockPrivateIps?: boolean,
 *   allowPrivateIps?: boolean,
 *   initialIsPrivate?: boolean,
 *   isRedirect?: boolean
 * }} [opts]
 * @returns {Promise<{ ok: boolean, error?: string, parsedUrl?: URL }>}
 */
export async function validateTargetUrl(
  targetUrl,
  { blockPrivateIps = false, allowPrivateIps = false, initialIsPrivate = false, isRedirect = false } = {},
) {
  let u;
  try {
    u = new URL(targetUrl);
  } catch {
    return { ok: false, error: `invalid URL: ${String(targetUrl || "").slice(0, 100)}` };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: `blocked protocol: only http: and https: are allowed, got ${u.protocol}` };
  }
  if (isBlockedMetadataEndpoint(targetUrl)) {
    return { ok: false, error: "blocked request to cloud metadata endpoint (SSRF protection)" };
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) {
    return { ok: false, error: "empty or invalid hostname" };
  }
  const isPrivate = isPrivateOrLoopbackHost(host);
  if (blockPrivateIps && isPrivate) {
    return { ok: false, error: "blocked request to private/internal network address (SSRF protection)" };
  }
  if (isRedirect && !allowPrivateIps && !initialIsPrivate && isPrivate) {
    return { ok: false, error: "blocked redirect to private/internal network address (SSRF protection)" };
  }
  // DNS rebinding check when blockPrivateIps is active, or on redirect from public to unverified domain
  if ((blockPrivateIps || (isRedirect && !allowPrivateIps && !initialIsPrivate)) && !net.isIP(host)) {
    const dnsCheck = await assertSafeDns(host);
    if (!dnsCheck.safe) {
      return { ok: false, error: dnsCheck.error };
    }
  }
  return { ok: true, parsedUrl: u };
}

/**
 * @typedef {{ url: string, status: number }} StatusStep
 * @typedef {{
 *   ok: boolean, url: string, finalUrl: string, status: number,
 *   statusChain: StatusStep[], headers: Record<string, string>,
 *   html: string, truncated: boolean, ms: number, error: string, contentType: string
 * }} PageResult
 */

/**
 * Rejects as soon as `signal` aborts. Lets a body read honour the same
 * per-request deadline as the header phase.
 * @param {AbortSignal} signal
 * @returns {Promise<never>}
 */
export function abortRejection(signal) {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("The operation was aborted.", "AbortError")),
      { once: true },
    );
  });
}

/**
 * Read a response body as text, stopping at `maxBytes` (UTF-8 aware
 * via TextDecoder streaming). Returns the text and whether it was cut.
 * The read honours `signal` so a server that sends headers then stalls
 * mid-body cannot hang the caller past the request deadline.
 * Readers are guaranteed released in all exit paths.
 * @param {Response} res
 * @param {number} maxBytes
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ text: string, truncated: boolean }>}
 */
export async function readCappedText(res, maxBytes, signal) {
  if (!res.body) {
    const text = signal ? await Promise.race([res.text(), abortRejection(signal)]) : await res.text();
    return { text, truncated: false };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      const { done, value } = signal
        ? await Promise.race([reader.read(), abortRejection(signal)])
        : await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        truncated = true;
        try {
          await reader.cancel();
        } catch {
          // ignore — socket cleanup is best-effort
        }
        break;
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  // Reassemble without re-splitting multi-byte characters.
  let text = "";
  for (const c of chunks) text += decoder.decode(c, { stream: true });
  text += decoder.decode();
  return { text, truncated };
}

/**
 * Fetch a page, following redirects manually (max MAX_REDIRECTS).
 * @param {string} url
 * @param {{ timeoutMs?: number, userAgent?: string, blockPrivateIps?: boolean, allowPrivateIps?: boolean }} [opts]
 * @returns {Promise<PageResult>}
 */
export async function fetchWithRedirects(
  url,
  { timeoutMs = 15000, userAgent = DEFAULT_UA, blockPrivateIps = false, allowPrivateIps = false } = {},
) {
  /** @type {StatusStep[]} */
  const chain = [];
  let current = url;
  const started = Date.now();

  const initialCheck = await validateTargetUrl(url, { blockPrivateIps, allowPrivateIps });
  if (!initialCheck.ok) {
    return {
      ok: false,
      url,
      finalUrl: url,
      status: 0,
      statusChain: chain,
      headers: {},
      html: "",
      truncated: false,
      ms: 0,
      error: initialCheck.error || "invalid URL",
      contentType: "",
    };
  }

  const initialHost = initialCheck.parsedUrl ? initialCheck.parsedUrl.hostname : "";
  const initialIsPrivate = isPrivateOrLoopbackHost(initialHost);

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const elapsed = Date.now() - started;
    const remainingMs = Math.max(50, timeoutMs - elapsed);
    if (elapsed >= timeoutMs) {
      return {
        ok: false,
        url,
        finalUrl: current,
        status: 0,
        statusChain: chain,
        headers: {},
        html: "",
        truncated: false,
        ms: elapsed,
        error: `timeout after ${timeoutMs}ms`,
        contentType: "",
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs);
    if (typeof timer.unref === "function") timer.unref();

    let res;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": userAgent,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const isAbort =
        /** @type {{ name?: string }} */ (err)?.name === "AbortError" || controller.signal.aborted;
      return {
        ok: false,
        url,
        finalUrl: current,
        status: 0,
        statusChain: chain,
        headers: {},
        html: "",
        truncated: false,
        ms: Date.now() - started,
        error: isAbort
          ? `timeout after ${timeoutMs}ms`
          : String(/** @type {{ message?: unknown }} */ (err)?.message ?? err),
        contentType: "",
      };
    }

    const status = res.status;
    /** @type {Record<string, string>} */
    const headers = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    chain.push({ url: current, status });

    if (status >= 300 && status < 400) {
      if (!headers.location) {
        let truncated = false;
        try {
          ({ truncated } = await readCappedText(res, MAX_HTML_BYTES, controller.signal));
        } catch {
          // ignore — fall through with empty body
        } finally {
          clearTimeout(timer);
        }
        return {
          ok: false,
          url,
          finalUrl: current,
          status,
          statusChain: chain,
          headers,
          html: "",
          truncated,
          ms: Date.now() - started,
          error: `redirect status ${status} without location header`,
          contentType: headers["content-type"] ?? "",
        };
      }

      let nextUrl = "";
      try {
        nextUrl = new URL(headers.location, current).toString();
      } catch {
        clearTimeout(timer);
        try {
          if (res.body) await res.body.cancel();
        } catch {
          // ignore
        }
        return {
          ok: false,
          url,
          finalUrl: current,
          status,
          statusChain: chain,
          headers,
          html: "",
          truncated: false,
          ms: Date.now() - started,
          error: `invalid redirect location: ${(headers.location || "").slice(0, 200)}`,
          contentType: headers["content-type"] ?? "",
        };
      }

      // Inspect every redirect destination before following it
      const redirectCheck = await validateTargetUrl(nextUrl, {
        blockPrivateIps,
        allowPrivateIps,
        initialIsPrivate,
        isRedirect: true,
      });
      if (!redirectCheck.ok) {
        clearTimeout(timer);
        try {
          if (res.body) await res.body.cancel();
        } catch {
          // ignore
        }
        return {
          ok: false,
          url,
          finalUrl: nextUrl,
          status: 0,
          statusChain: chain,
          headers: {},
          html: "",
          truncated: false,
          ms: Date.now() - started,
          error: redirectCheck.error || "blocked redirect (SSRF protection)",
          contentType: headers["content-type"] ?? "",
        };
      }

      current = nextUrl;
      clearTimeout(timer);
      // Cancel redirect bodies instead of buffering them so the OOM cap stays meaningful.
      try {
        if (res.body) await res.body.cancel();
        else await res.arrayBuffer();
      } catch {
        // ignore
      }
      continue;
    }

    let html = "";
    let truncated = false;
    try {
      ({ text: html, truncated } = await readCappedText(res, MAX_HTML_BYTES, controller.signal));
    } catch (err) {
      clearTimeout(timer);
      const isAbort =
        /** @type {{ name?: string }} */ (err)?.name === "AbortError" || controller.signal.aborted;
      return {
        ok: false,
        url,
        finalUrl: current,
        status,
        statusChain: chain,
        headers,
        html: "",
        truncated: false,
        ms: Date.now() - started,
        error: isAbort
          ? `timeout after ${timeoutMs}ms`
          : String(/** @type {{ message?: unknown }} */ (err)?.message ?? err),
        contentType: "",
      };
    }
    clearTimeout(timer);

    return {
      ok: status >= 200 && status < 400,
      url,
      finalUrl: current,
      status,
      statusChain: chain,
      headers,
      html: status >= 200 && status < 300 ? html : "",
      truncated,
      ms: Date.now() - started,
      error: status >= 200 && status < 300 ? "" : `http status ${status}`,
      contentType: headers["content-type"] ?? "",
    };
  }

  return {
    ok: false,
    url,
    finalUrl: current,
    status: 0,
    statusChain: chain,
    headers: {},
    html: "",
    truncated: false,
    ms: Date.now() - started,
    error: `too many redirects (>${MAX_REDIRECTS})`,
    contentType: "",
  };
}

/**
 * @typedef {{
 *   ok: boolean, status: number, url: string, finalUrl: string,
 *   text: string, truncated: boolean, error?: string
 * }} TextResult
 */

/**
 * Best-effort small-file fetch (robots.txt / sitemaps / llms.txt).
 * Follows redirects manually with SSRF destination inspection and full body timeout protection.
 * Never throws; callers treat missing files as "not found".
 * @param {string} url
 * @param {{ timeoutMs?: number, userAgent?: string, blockPrivateIps?: boolean, allowPrivateIps?: boolean }} [opts]
 * @returns {Promise<TextResult>}
 */
export async function fetchText(
  url,
  { timeoutMs = 10000, userAgent = DEFAULT_UA, blockPrivateIps = false, allowPrivateIps = false } = {},
) {
  const initialCheck = await validateTargetUrl(url, { blockPrivateIps, allowPrivateIps });
  if (!initialCheck.ok) {
    return {
      ok: false,
      status: 0,
      url,
      finalUrl: url,
      text: "",
      truncated: false,
      error: initialCheck.error || "invalid URL",
    };
  }

  const initialHost = initialCheck.parsedUrl ? initialCheck.parsedUrl.hostname : "";
  const initialIsPrivate = isPrivateOrLoopbackHost(initialHost);
  let current = url;
  const started = Date.now();

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const elapsed = Date.now() - started;
    const remainingMs = Math.max(50, timeoutMs - elapsed);
    if (elapsed >= timeoutMs) {
      return {
        ok: false,
        status: 0,
        url,
        finalUrl: current,
        text: "",
        truncated: false,
        error: "timeout",
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs);
    if (typeof timer.unref === "function") timer.unref();

    let res;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": userAgent, accept: "*/*" },
      });
    } catch (err) {
      clearTimeout(timer);
      const isAbort =
        /** @type {{ name?: string }} */ (err)?.name === "AbortError" || controller.signal.aborted;
      return {
        ok: false,
        status: 0,
        url,
        finalUrl: current,
        text: "",
        truncated: false,
        error: isAbort ? "timeout" : String(/** @type {{ message?: unknown }} */ (err)?.message ?? err),
      };
    }

    const status = res.status;
    if (status >= 300 && status < 400) {
      const loc = res.headers.get("location");
      if (!loc) {
        clearTimeout(timer);
        try {
          if (res.body) await res.body.cancel();
        } catch {
          // ignore
        }
        return {
          ok: false,
          status,
          url,
          finalUrl: current,
          text: "",
          truncated: false,
          error: `redirect status ${status} without location header`,
        };
      }

      let nextUrl = "";
      try {
        nextUrl = new URL(loc, current).toString();
      } catch {
        clearTimeout(timer);
        try {
          if (res.body) await res.body.cancel();
        } catch {
          // ignore
        }
        return {
          ok: false,
          status,
          url,
          finalUrl: current,
          text: "",
          truncated: false,
          error: `invalid redirect location: ${loc.slice(0, 200)}`,
        };
      }

      const redirectCheck = await validateTargetUrl(nextUrl, {
        blockPrivateIps,
        allowPrivateIps,
        initialIsPrivate,
        isRedirect: true,
      });
      if (!redirectCheck.ok) {
        clearTimeout(timer);
        try {
          if (res.body) await res.body.cancel();
        } catch {
          // ignore
        }
        return {
          ok: false,
          status: 0,
          url,
          finalUrl: nextUrl,
          text: "",
          truncated: false,
          error: redirectCheck.error || "blocked redirect (SSRF protection)",
        };
      }

      current = nextUrl;
      clearTimeout(timer);
      try {
        if (res.body) await res.body.cancel();
        else await res.arrayBuffer();
      } catch {
        // ignore
      }
      continue;
    }

    let text = "";
    let truncated = false;
    try {
      ({ text, truncated } = await readCappedText(res, MAX_TEXT_BYTES, controller.signal));
    } catch (err) {
      clearTimeout(timer);
      const isAbort =
        /** @type {{ name?: string }} */ (err)?.name === "AbortError" || controller.signal.aborted;
      return {
        ok: false,
        status,
        url,
        finalUrl: current,
        text: "",
        truncated: false,
        error: isAbort ? "timeout" : String(/** @type {{ message?: unknown }} */ (err)?.message ?? err),
      };
    }
    clearTimeout(timer);

    return {
      ok: res.ok,
      status: res.status,
      url,
      finalUrl: current,
      text,
      truncated,
    };
  }

  return {
    ok: false,
    status: 0,
    url,
    finalUrl: current,
    text: "",
    truncated: false,
    error: `too many redirects (>${MAX_REDIRECTS})`,
  };
}
