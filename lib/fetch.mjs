/**
 * one-step-seo — minimal fetch layer (zero dependencies, Node 18+).
 * Follows redirects manually so the status chain is auditable.
 * Response bodies are capped (MAX_HTML_BYTES) so a giant page
 * can never OOM the process; oversized bodies are truncated and flagged.
 */

/** @type {string} */
const DEFAULT_UA = "Mozilla/5.0 (compatible; one-step-seo/0.2.0; +https://github.com/6t9xstar/one-step-seo)";

export const MAX_REDIRECTS = 5;
/** Cap for audited HTML bodies (5 MiB). Robots/sitemap/llms.txt use a smaller cap below. */
export const MAX_HTML_BYTES = 5 * 1024 * 1024;
/** Cap for small discovery files (robots.txt / sitemap / llms.txt). */
export const MAX_TEXT_BYTES = 200_000;

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
function abortRejection(signal) {
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
 * @param {Response} res
 * @param {number} maxBytes
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ text: string, truncated: boolean }>}
 */
async function readCappedText(res, maxBytes, signal) {
  if (!res.body) {
    const text = signal ? await Promise.race([res.text(), abortRejection(signal)]) : await res.text();
    return { text, truncated: false };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const { done, value } = signal
      ? await Promise.race([reader.read(), abortRejection(signal)])
      : await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      // Keep only the head portion; stop pulling from the socket.
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
  // Reassemble without re-splitting multi-byte characters.
  let text = "";
  for (const c of chunks) text += decoder.decode(c, { stream: true });
  text += decoder.decode();
  return { text, truncated };
}

/**
 * Fetch a page, following redirects manually (max MAX_REDIRECTS).
 * @param {string} url
 * @param {{ timeoutMs?: number, userAgent?: string }} [opts]
 * @returns {Promise<PageResult>}
 */
export async function fetchWithRedirects(url, { timeoutMs = 15000, userAgent = DEFAULT_UA } = {}) {
  /** @type {StatusStep[]} */
  const chain = [];
  let current = url;
  const started = Date.now();

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // A pending timer must never by itself keep the process alive.
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
        error:
          /** @type {{ name?: string, message?: string }} */ (err)?.name === "AbortError"
            ? `timeout after ${timeoutMs}ms`
            : String(/** @type {{ message?: unknown }} */ (err)?.message ?? err),
        contentType: "",
      };
    }
    // The timer deliberately stays armed past this point: --timeout is a
    // per-request deadline covering the body, not just the header phase.
    // Clearing it here is what let a slow-drip server hang the CLI forever.

    const status = res.status;
    /** @type {Record<string, string>} */
    const headers = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    chain.push({ url: current, status });

    if (status >= 300 && status < 400) {
      if (!headers.location) {
        // Redirect status without a Location header: treat as failure,
        // do not report ok:true.
        let truncated = false;
        try {
          ({ truncated } = await readCappedText(res, MAX_HTML_BYTES));
        } catch {
          // ignore — fall through with empty body
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
      current = nextUrl;
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
        error:
          /** @type {{ name?: string, message?: string }} */ (err)?.name === "AbortError"
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
 * Never throws; callers treat missing files as "not found".
 * @param {string} url
 * @param {{ timeoutMs?: number, userAgent?: string }} [opts]
 * @returns {Promise<TextResult>}
 */
export async function fetchText(url, { timeoutMs = 10000, userAgent = DEFAULT_UA } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": userAgent, accept: "*/*" },
    });
    const { text, truncated } = await readCappedText(res, MAX_TEXT_BYTES);
    return { ok: res.ok, status: res.status, url, finalUrl: res.url, text, truncated };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      url,
      finalUrl: url,
      text: "",
      truncated: false,
      error:
        /** @type {{ name?: string }} */ (err)?.name === "AbortError"
          ? "timeout"
          : String(/** @type {{ message?: unknown }} */ (err)?.message ?? err),
    };
  } finally {
    clearTimeout(timer);
  }
}
