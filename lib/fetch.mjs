/**
 * one-step-seo — minimal fetch layer (zero dependencies, Node 18+).
 * Follows redirects manually so the status chain is auditable.
 */

const DEFAULT_UA =
  "Mozilla/5.0 (compatible; one-step-seo/0.1.0; +https://github.com/your-org/one-step-seo)";

const MAX_REDIRECTS = 5;

export async function fetchWithRedirects(url, { timeoutMs = 15000, userAgent = DEFAULT_UA } = {}) {
  const chain = [];
  let current = url;
  const started = Date.now();

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
        ms: Date.now() - started,
        error: err?.name === "AbortError" ? `timeout after ${timeoutMs}ms` : String(err?.message ?? err),
      };
    } finally {
      clearTimeout(timer);
    }

    const status = res.status;
    const headers = Object.fromEntries(res.headers.entries());
    chain.push({ url: current, status });

    if (status >= 300 && status < 400 && headers.location) {
      current = new URL(headers.location, current).toString();
      // Drain body so sockets are reused.
      try {
        await res.arrayBuffer();
      } catch {
        // ignore
      }
      continue;
    }

    let html = "";
    try {
      html = await res.text();
    } catch (err) {
      return {
        ok: false,
        url,
        finalUrl: current,
        status,
        statusChain: chain,
        headers,
        html: "",
        ms: Date.now() - started,
        error: String(err?.message ?? err),
      };
    }

    return {
      ok: status >= 200 && status < 400,
      url,
      finalUrl: current,
      status,
      statusChain: chain,
      headers,
      html: status >= 200 && status < 300 ? html : "",
      rawHtmlOnError: status >= 200 && status < 300 ? "" : html.slice(0, 2000),
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
    ms: Date.now() - started,
    error: `too many redirects (>${MAX_REDIRECTS})`,
  };
}

export async function fetchText(url, { timeoutMs = 10000, userAgent = DEFAULT_UA } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": userAgent, accept: "*/*" },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, url, finalUrl: res.url, text: text.slice(0, 200_000) };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      url,
      finalUrl: url,
      text: "",
      error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err),
    };
  } finally {
    clearTimeout(timer);
  }
}
