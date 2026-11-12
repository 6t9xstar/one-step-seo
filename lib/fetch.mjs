/**
 * one-step-seo — minimal fetch layer (zero dependencies, Node 18+).
 * Follows redirects manually so the status chain is auditable.
 * Response bodies are capped (MAX_HTML_BYTES) so a giant page
 * can never OOM the process; oversized bodies are truncated and flagged.
 */
import net from "node:net";
import dns from "node:dns/promises";
import nodeDns from "node:dns";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { VERSION as PKG_VERSION } from "./version.mjs";

/** @type {string} */
const DEFAULT_UA = `Mozilla/5.0 (compatible; one-step-seo/${PKG_VERSION}; +https://github.com/6t9xstar/one-step-seo)`;

export const MAX_REDIRECTS = 5;
/** Cap for audited HTML bodies (5 MiB). Robots/sitemap/llms.txt use a smaller cap below. */
export const MAX_HTML_BYTES = 5 * 1024 * 1024;
/** Cap for small discovery files (robots.txt / sitemap / llms.txt). */
export const MAX_TEXT_BYTES = 200_000;
/**
 * Cap on DECOMPRESSED bytes. The wire caps above bound what is read from the
 * socket, but a few kilobytes of gzip/brotli can inflate to gigabytes
 * (decompression bomb), so the inflated output is bounded separately.
 */
export const MAX_DECOMPRESSED_BYTES = 5 * 1024 * 1024;

/**
 * Inflate a gzip / deflate / brotli buffer with a hard output cap. Streams the
 * decoder so memory never exceeds `maxOut` (plus one chunk), and tolerates
 * input that was cut at the wire cap (returns what decoded, flagged truncated).
 * Resolves null when nothing could be decoded (not actually compressed).
 * @param {Buffer} buf
 * @param {"gzip" | "deflate" | "br"} kind
 * @param {number} [maxOut]
 * @returns {Promise<{ buf: Buffer, truncated: boolean } | null>}
 */
export function inflateCapped(buf, kind, maxOut = MAX_DECOMPRESSED_BYTES) {
  return new Promise((resolve) => {
    /** @type {import("node:stream").Transform} */
    let stream;
    try {
      stream =
        kind === "br"
          ? zlib.createBrotliDecompress({ finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH })
          : kind === "deflate"
            ? zlib.createInflate({ finishFlush: zlib.constants.Z_SYNC_FLUSH })
            : zlib.createGunzip({ finishFlush: zlib.constants.Z_SYNC_FLUSH });
    } catch {
      resolve(null);
      return;
    }
    /** @type {Buffer[]} */
    const out = [];
    let total = 0;
    let settled = false;
    /** @param {boolean} truncated */
    const finish = (truncated) => {
      if (settled) return;
      settled = true;
      stream.destroy();
      resolve(total > 0 ? { buf: Buffer.concat(out, total), truncated } : null);
    };
    stream.on("data", (/** @type {Buffer} */ chunk) => {
      if (settled) return;
      const room = maxOut - total;
      if (chunk.length > room) {
        if (room > 0) {
          out.push(chunk.subarray(0, room));
          total += room;
        }
        finish(true);
        return;
      }
      out.push(chunk);
      total += chunk.length;
    });
    stream.on("end", () => finish(false));
    // A decode error after partial output means the input was cut or corrupt:
    // keep what decoded and flag it rather than discarding the page.
    stream.on("error", () => finish(true));
    stream.end(buf);
  });
}

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
 * Parse and normalize an IPv6 string into an array of 8 16-bit unsigned integers.
 * Expands zero-compression ('::'), converts embedded IPv4 (e.g. '::ffff:127.0.0.1'),
 * and strips any scope identifiers (%eth0). Returns null if not a valid IPv6 string.
 * @param {string} ipStr
 * @returns {number[] | null}
 */
export function parseIpv6Hextets(ipStr) {
  let s = String(ipStr || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .trim();
  if (!s) return null;
  // Strip scope identifier if present (e.g., %eth0, %1)
  if (s.includes("%")) s = s.split("%")[0] ?? "";
  // Check for embedded dotted-quad IPv4 (e.g. ::ffff:192.168.1.1, ::127.0.0.1, 64:ff9b::10.0.0.1)
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    if (lastColon === -1) return null;
    const v4Part = s.slice(lastColon + 1);
    const num = ipv4ToUint32(v4Part);
    if (num === null) return null;
    const hA = ((num >>> 16) & 0xffff).toString(16);
    const hB = (num & 0xffff).toString(16);
    s = s.slice(0, lastColon + 1) + hA + ":" + hB;
  }
  if (s.includes(":::")) return null;
  const parts = s.split("::");
  if (parts.length > 2) return null;
  if (parts.length === 2) {
    if (parts[0]?.endsWith(":") || parts[1]?.startsWith(":")) return null;
    if (parts[0]?.startsWith(":") || parts[1]?.endsWith(":")) return null;
  } else if (s.startsWith(":") || s.endsWith(":")) {
    return null;
  }
  let left = parts[0] ? parts[0].split(":").filter(Boolean) : [];
  let right = parts[1] ? parts[1].split(":").filter(Boolean) : [];
  if (parts.length === 2) {
    const missing = 8 - (left.length + right.length);
    if (missing < 0) return null;
    const zeroes = new Array(missing).fill("0");
    left = [...left, ...zeroes, ...right];
  }
  if (left.length !== 8) return null;
  /** @type {number[]} */
  const hextets = [];
  for (let i = 0; i < 8; i++) {
    const segment = left[i] ?? "";
    if (!/^[0-9a-f]{1,4}$/i.test(segment)) return null;
    const val = parseInt(segment, 16);
    if (isNaN(val) || val < 0 || val > 0xffff) return null;
    hextets.push(val);
  }
  return hextets;
}

/**
 * Check if parsed IPv6 hextets fall into private, loopback, link-local, multicast,
 * ULA, documentation, discard, or embedded private IPv4 ranges (IPv4-mapped, 6to4, ISATAP, NAT64).
 * @param {number[]} h
 * @returns {boolean}
 */
export function isPrivateOrReservedIpv6(h) {
  if (h.length !== 8) return false;
  // Loopback (::1) and Unspecified (::)
  const isAllZeroExceptLast =
    h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0 && h[6] === 0;
  if (isAllZeroExceptLast && (h[7] === 0 || h[7] === 1)) return true;

  // Link-Local (fe80::/10 -> 0xfe80 to 0xfebf)
  if (((h[0] ?? 0) & 0xffc0) === 0xfe80) return true;

  // Unique Local Address (fc00::/7 -> 0xfc00 to 0xfdff, includes AWS IMDSv2 fd00:ec2::254)
  if (((h[0] ?? 0) & 0xfe00) === 0xfc00) return true;

  // Multicast (ff00::/8 -> 0xff00 to 0xffff)
  if (((h[0] ?? 0) & 0xff00) === 0xff00) return true;

  // Discard-Only (100::/64)
  if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) return true;

  // Documentation (2001:db8::/32)
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true;

  // 6to4 (2002::/16) - embeds 32-bit IPv4 in hextets 1 and 2
  if (h[0] === 0x2002) {
    const v4 = (((h[1] ?? 0) << 16) | (h[2] ?? 0)) >>> 0;
    if (isPrivateOrReservedIpv4(v4)) return true;
  }

  // IPv4-mapped IPv6 (::ffff:0:0/96 or expanded 0:0:0:0:0:ffff:a.b.c.d)
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    const v4 = (((h[6] ?? 0) << 16) | (h[7] ?? 0)) >>> 0;
    return isPrivateOrReservedIpv4(v4);
  }

  // IPv4-compatible IPv6 (::0:0/96, RFC 4291 deprecated)
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
    const v4 = (((h[6] ?? 0) << 16) | (h[7] ?? 0)) >>> 0;
    if (v4 !== 0 && v4 !== 1) {
      return isPrivateOrReservedIpv4(v4);
    }
  }

  // NAT64 / IPv4-translated (64:ff9b::/96 and 64:ff9b:1::/48)
  if (h[0] === 0x0064 && h[1] === 0xff9b) {
    if (h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
      const v4 = (((h[6] ?? 0) << 16) | (h[7] ?? 0)) >>> 0;
      return isPrivateOrReservedIpv4(v4);
    }
    if (h[2] === 1) {
      const v4 = (((h[6] ?? 0) << 16) | (h[7] ?? 0)) >>> 0;
      return isPrivateOrReservedIpv4(v4);
    }
  }

  // ISATAP (hextet 5 is 0x5efe or 0x0200:0x5efe)
  if (h[5] === 0x5efe || (h[4] === 0x0200 && h[5] === 0x5efe)) {
    const v4 = (((h[6] ?? 0) << 16) | (h[7] ?? 0)) >>> 0;
    return isPrivateOrReservedIpv4(v4);
  }

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
    // Check IPv6 normalized hextets
    const hextets = parseIpv6Hextets(clean);
    if (hextets !== null) {
      // fe80::/10 link-local
      if (((hextets[0] ?? 0) & 0xffc0) === 0xfe80) return true;
      // fd00:ec2::254 AWS IMDSv2
      if (
        hextets[0] === 0xfd00 &&
        hextets[1] === 0x0ec2 &&
        hextets[2] === 0 &&
        hextets[3] === 0 &&
        hextets[4] === 0 &&
        hextets[5] === 0 &&
        hextets[6] === 0 &&
        hextets[7] === 0x0254
      ) {
        return true;
      }
      // Check embedded IPv4 metadata (169.254.169.254, 100.100.100.200, 192.0.0.192)
      // in IPv4-mapped, IPv4-compatible, or NAT64
      const isMapped =
        hextets[0] === 0 &&
        hextets[1] === 0 &&
        hextets[2] === 0 &&
        hextets[3] === 0 &&
        hextets[4] === 0 &&
        hextets[5] === 0xffff;
      const isCompat =
        hextets[0] === 0 &&
        hextets[1] === 0 &&
        hextets[2] === 0 &&
        hextets[3] === 0 &&
        hextets[4] === 0 &&
        hextets[5] === 0;
      const isNat64 =
        hextets[0] === 0x0064 &&
        hextets[1] === 0xff9b &&
        hextets[2] === 0 &&
        hextets[3] === 0 &&
        hextets[4] === 0 &&
        hextets[5] === 0;
      if (isMapped || isCompat || isNat64) {
        const v4 = (((hextets[6] ?? 0) << 16) | (hextets[7] ?? 0)) >>> 0;
        if (
          v4 === 0xa9fea9fe || // 169.254.169.254
          v4 === 0x646464c8 || // 100.100.100.200
          v4 === 0xc00000c0 // 192.0.0.192
        ) {
          return true;
        }
      }
      // 6to4 metadata (2002:a9fe:a9fe::)
      if (hextets[0] === 0x2002) {
        const v4 = (((hextets[1] ?? 0) << 16) | (hextets[2] ?? 0)) >>> 0;
        if (v4 === 0xa9fea9fe || v4 === 0x646464c8 || v4 === 0xc00000c0) return true;
      }
    }
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
  // Try IPv6 normalized hextets check
  const hextets = parseIpv6Hextets(h);
  if (hextets !== null) {
    return isPrivateOrReservedIpv6(hextets);
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
 * @param {Response | any} res
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
  /** @type {(() => void) | undefined} */
  let onAbort;
  const abortPromise = signal
    ? new Promise((_resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
        signal.addEventListener("abort", onAbort, { once: true });
      })
    : null;
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      const { done, value } = abortPromise
        ? await Promise.race([reader.read(), abortPromise])
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
    if (signal && onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  // Check if content is gzipped, deflated, or brotli-compressed.
  const encoding = (res.headers?.get ? res.headers.get("content-encoding") : "")?.toLowerCase() || "";
  const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  if (totalLength >= 2) {
    const firstChunk = chunks[0];
    const isGzipMagic =
      firstChunk && firstChunk.byteLength >= 2 && firstChunk[0] === 0x1f && firstChunk[1] === 0x8b;
    /** @type {"gzip" | "deflate" | "br" | ""} */
    const kind =
      isGzipMagic || encoding === "gzip" || encoding === "x-gzip"
        ? "gzip"
        : encoding === "deflate"
          ? "deflate"
          : encoding === "br"
            ? "br"
            : "";
    if (kind) {
      const combined = Buffer.concat(
        chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)),
        totalLength,
      );
      // Bounded inflate: never trust the compression ratio of a remote body.
      const inflated = await inflateCapped(combined, kind, Math.max(maxBytes, MAX_DECOMPRESSED_BYTES));
      if (inflated) {
        return { text: inflated.buf.toString("utf-8"), truncated: truncated || inflated.truncated };
      }
      // Not actually compressed (mislabelled header) — fall through to raw decode.
    }
  }

  // Reassemble without re-splitting multi-byte characters.
  let text = "";
  for (const c of chunks) text += decoder.decode(c, { stream: true });
  text += decoder.decode();
  return { text, truncated };
}

/**
 * Perform an HTTP/HTTPS request with strict socket-level DNS pinning and SSRF protection.
 * Resolves DNS at the socket layer and pins the connection to the validated IP address,
 * eliminating the TOCTOU rebinding gap. Preserves correct TLS SNI and hostname certificate validation.
 *
 * @param {string} urlString
 * @param {{
 *   method?: string,
 *   headers?: Record<string, string>,
 *   signal?: AbortSignal,
 *   blockPrivateIps?: boolean,
 *   allowPrivateIps?: boolean,
 *   initialIsPrivate?: boolean,
 *   isRedirect?: boolean
 * }} [opts]
 * @returns {Promise<{
 *   status: number,
 *   headers: Headers,
 *   body: ReadableStream<Uint8Array> | null,
 *   ok: boolean,
 *   text: () => Promise<string>,
 *   json: () => Promise<any>,
 *   arrayBuffer: () => Promise<ArrayBuffer>
 * }>}
 */
export function safePinnedFetch(
  urlString,
  {
    method = "GET",
    headers = {},
    signal,
    blockPrivateIps = false,
    allowPrivateIps = false,
    initialIsPrivate = false,
    isRedirect = false,
  } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException("The operation was aborted.", "AbortError"));
    }

    let u;
    try {
      u = new URL(urlString);
    } catch {
      return reject(new Error(`invalid URL: ${String(urlString || "").slice(0, 100)}`));
    }

    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return reject(new Error(`blocked protocol: only http: and https: are allowed, got ${u.protocol}`));
    }

    if (isBlockedMetadataEndpoint(urlString)) {
      return reject(new Error("blocked request to cloud metadata endpoint (SSRF protection)"));
    }

    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host) {
      return reject(new Error("empty or invalid hostname"));
    }

    const isIp = net.isIP(host) !== 0;
    const isPrivate = isPrivateOrLoopbackHost(host);

    if (isIp) {
      if (blockPrivateIps && isPrivate) {
        return reject(new Error("blocked request to private/internal network address (SSRF protection)"));
      }
      if (isRedirect && !allowPrivateIps && !initialIsPrivate && isPrivate) {
        return reject(new Error("blocked redirect to private/internal network address (SSRF protection)"));
      }
    } else {
      if (blockPrivateIps && isPrivate) {
        return reject(new Error("blocked request to private/internal network address (SSRF protection)"));
      }
      if (isRedirect && !allowPrivateIps && !initialIsPrivate && isPrivate) {
        return reject(new Error("blocked redirect to private/internal network address (SSRF protection)"));
      }
    }

    const isHttps = u.protocol === "https:";
    const mod = isHttps ? https : http;
    const port = u.port ? parseInt(u.port, 10) : isHttps ? 443 : 80;

    /** @type {import("node:https").RequestOptions} */
    const reqOpts = {
      protocol: u.protocol,
      hostname: u.hostname,
      port,
      path: (u.pathname || "/") + (u.search || ""),
      method,
      headers,
    };

    if (isHttps) {
      reqOpts.servername = u.hostname;
    }

    // Socket-level DNS resolution & IP pinning
    if (!isIp) {
      reqOpts.lookup = (hostname, lookupOpts, cb) => {
        nodeDns.lookup(hostname, { all: true }, (err, addresses) => {
          if (err) return cb(/** @type {any} */ (err), "", 4);
          if (!addresses || addresses.length === 0) {
            return cb(new Error(`DNS resolution returned no records for ${hostname}`), "", 4);
          }
          for (const rec of addresses) {
            const addr = rec.address;
            const recIsPrivate = isPrivateOrLoopbackHost(addr);
            const recIsMeta = isBlockedMetadataEndpoint(addr);
            if (recIsPrivate || recIsMeta) {
              if (blockPrivateIps || (isRedirect && !allowPrivateIps && !initialIsPrivate)) {
                return cb(
                  new Error(`blocked DNS resolution to private/internal IP ${addr} (SSRF protection)`),
                  "",
                  4,
                );
              }
            }
          }
          const chosen = addresses[0];
          if (!chosen) {
            return cb(new Error(`DNS resolution returned no records for ${hostname}`), "", 4);
          }
          if (lookupOpts && lookupOpts.all) {
            cb(null, [chosen]);
          } else {
            cb(null, chosen.address, chosen.family);
          }
        });
      };
    }

    const req = mod.request(reqOpts, (res) => {
      const responseHeaders = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (Array.isArray(v)) {
          for (const item of v) responseHeaders.append(k, item);
        } else if (v !== undefined) {
          responseHeaders.set(k, v);
        }
      }

      const status = res.statusCode || 0;
      let streamClosed = false;
      const webBody = new ReadableStream({
        start(controller) {
          res.on("data", (chunk) => {
            if (streamClosed) return;
            try {
              controller.enqueue(chunk);
            } catch {
              streamClosed = true;
            }
          });
          res.on("end", () => {
            if (streamClosed) return;
            streamClosed = true;
            try {
              controller.close();
            } catch {
              // ignore already-closed controller (Node 18 redirect cancel race)
            }
          });
          res.on("error", (err) => {
            if (streamClosed) return;
            streamClosed = true;
            try {
              controller.error(err);
            } catch {
              // ignore already-closed controller
            }
          });
          res.on("close", () => {
            if (signal && onAbort) {
              signal.removeEventListener("abort", onAbort);
            }
            if (!streamClosed) {
              streamClosed = true;
              try {
                controller.close();
              } catch {
                // ignore
              }
            }
          });
        },
        cancel() {
          streamClosed = true;
          res.destroy();
        },
      });

      const readAllChunks = async () => {
        const reader = webBody.getReader();
        const chunks = [];
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(Buffer.from(value));
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {
            // ignore
          }
        }
        return Buffer.concat(chunks);
      };

      resolve({
        status,
        headers: responseHeaders,
        body: webBody,
        ok: status >= 200 && status < 300,
        arrayBuffer: async () => {
          const buf = await readAllChunks();
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        },
        text: async () => {
          const buf = await readAllChunks();
          if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
            try {
              return zlib.gunzipSync(buf, { maxOutputLength: MAX_DECOMPRESSED_BYTES * 4 }).toString("utf-8");
            } catch {
              // fallback
            }
          }
          return new TextDecoder("utf-8").decode(buf);
        },
        json: async () => {
          const buf = await readAllChunks();
          let raw = buf;
          if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
            try {
              raw = zlib.gunzipSync(buf, { maxOutputLength: MAX_DECOMPRESSED_BYTES * 4 });
            } catch {
              // fallback
            }
          }
          return JSON.parse(new TextDecoder("utf-8").decode(raw));
        },
      });
    });

    /** @type {(() => void) | undefined} */
    let onAbort;
    if (signal) {
      onAbort = () => {
        req.destroy(new DOMException("The operation was aborted.", "AbortError"));
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    req.on("error", (err) => {
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
      reject(err);
    });

    req.end();
  });
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
      res = await safePinnedFetch(current, {
        signal: controller.signal,
        headers: {
          "user-agent": userAgent,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-encoding": "gzip, deflate, br",
        },
        blockPrivateIps,
        allowPrivateIps,
        initialIsPrivate,
        isRedirect: i > 0,
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

    // Post-connection DNS rebinding defense: re-verify destination has not rebound to private IP
    if ((blockPrivateIps || !initialIsPrivate) && !allowPrivateIps) {
      const finalHost = new URL(current).hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (!net.isIP(finalHost)) {
        const postDns = await assertSafeDns(finalHost);
        if (!postDns.safe) {
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
            error: postDns.error || "blocked DNS rebinding to private/internal IP (SSRF protection)",
            contentType: "",
          };
        }
      }
    }

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
      res = await safePinnedFetch(current, {
        signal: controller.signal,
        headers: { "user-agent": userAgent, accept: "*/*", "accept-encoding": "gzip, deflate, br" },
        blockPrivateIps,
        allowPrivateIps,
        initialIsPrivate,
        isRedirect: i > 0,
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

    // Post-connection DNS rebinding defense: re-verify destination has not rebound to private IP
    if ((blockPrivateIps || !initialIsPrivate) && !allowPrivateIps) {
      const finalHost = new URL(current).hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (!net.isIP(finalHost)) {
        const postDns = await assertSafeDns(finalHost);
        if (!postDns.safe) {
          return {
            ok: false,
            status: 0,
            url,
            finalUrl: current,
            text: "",
            truncated: false,
            error: postDns.error || "blocked DNS rebinding to private/internal IP (SSRF protection)",
          };
        }
      }
    }

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
