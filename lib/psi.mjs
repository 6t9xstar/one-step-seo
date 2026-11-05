/**
 * one-step-seo — Google PageSpeed Insights (PSI) Core Web Vitals integration.
 * Zero external dependencies. Uses standard fetch.
 * Secure: Never leaks, logs, or persists the user's API key.
 */
import {
  abortRejection,
  isBlockedMetadataEndpoint,
  isPrivateOrLoopbackHost,
  validateTargetUrl,
  assertSafeDns,
} from "./fetch.mjs";
import net from "node:net";

export const DEFAULT_PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
export const DEFAULT_TIMEOUT_MS = 25000;

/**
 * Redact any API key patterns from URLs, queries, or error messages.
 * @param {unknown} text
 * @returns {string}
 */
export function redactKey(text) {
  if (!text) return "";
  return String(text)
    .replace(/([?&]key=)[^&]+/gi, "$1[REDACTED]")
    .replace(/AIza[0-9A-Za-z-_]{35}/g, "[REDACTED_KEY]");
}

/**
 * Extract a non-negative finite numeric audit value, or return null if missing/invalid.
 * @param {any} audits
 * @param {string} key
 * @returns {number | null}
 */
function extractNumericAudit(audits, key) {
  const audit = audits && typeof audits === "object" ? audits[key] : null;
  if (audit && typeof audit === "object") {
    const val = audit.numericValue;
    if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
      return val;
    }
  }
  return null;
}

/**
 * @typedef {{
 *   score: number | null,
 *   lcpMs: number | null,
 *   cls: number | null,
 *   fcpMs: number | null,
 *   tbtMs: number | null,
 *   speedIndexMs: number | null,
 *   ttfbMs: number | null
 * }} PsiLabMetrics
 *
 * @typedef {{
 *   overallCategory: string,
 *   lcpMs: number | null,
 *   cls: number | null,
 *   inpMs: number | null,
 *   fcpMs: number | null
 * }} PsiFieldMetrics
 *
 * @typedef {{
 *   url: string,
 *   strategy: "mobile" | "desktop",
 *   checkedAt: string,
 *   lab: PsiLabMetrics,
 *   field: PsiFieldMetrics | null
 * }} PsiData
 *
 * @typedef {{
 *   ok: boolean,
 *   status?: number,
 *   data?: PsiData,
 *   error?: string
 * }} PsiResult
 */

/**
 * Fetch PageSpeed Insights performance and Core Web Vitals for a URL.
 * Timeouts cover headers and body streaming. Response data is strictly validated.
 * @param {string} url
 * @param {{
 *   key?: string,
 *   strategy?: "mobile" | "desktop" | string,
 *   timeoutMs?: number,
 *   userAgent?: string,
 *   endpoint?: string,
 *   blockPrivateIps?: boolean
 * }} [opts]
 * @returns {Promise<PsiResult>}
 */
export async function fetchPsi(url, opts = {}) {
  const endpoint = opts.endpoint || DEFAULT_PSI_ENDPOINT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const strategy = opts.strategy === "desktop" ? "desktop" : "mobile";
  const key = opts.key ?? process.env.PSI_API_KEY ?? "";

  let requestUrl;
  try {
    requestUrl = new URL(endpoint);
    if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
      return { ok: false, error: `Invalid PSI protocol: ${requestUrl.protocol}` };
    }
    if (isBlockedMetadataEndpoint(requestUrl.toString())) {
      return { ok: false, error: "blocked request to cloud metadata endpoint (SSRF protection)" };
    }
    if (opts.blockPrivateIps && isPrivateOrLoopbackHost(requestUrl.hostname)) {
      return { ok: false, error: "blocked request to private/internal network address (SSRF protection)" };
    }
    requestUrl.searchParams.set("url", url);
    requestUrl.searchParams.set("strategy", strategy);
    requestUrl.searchParams.set("category", "performance");
    if (key) {
      requestUrl.searchParams.set("key", key);
    }
  } catch (err) {
    return {
      ok: false,
      error: `Invalid PSI request URL: ${redactKey(err instanceof Error ? err.message : String(err))}`,
    };
  }

  const initialCheck = await validateTargetUrl(requestUrl.toString(), {
    blockPrivateIps: opts.blockPrivateIps,
    allowPrivateIps: false,
  });
  if (!initialCheck.ok) {
    return {
      ok: false,
      error: initialCheck.error || "invalid PSI request URL (SSRF protection)",
    };
  }

  const initialHost = requestUrl.hostname;
  const initialIsPrivate = isPrivateOrLoopbackHost(initialHost);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === "function") timer.unref();

  const MAX_PSI_REDIRECTS = 3;
  let currentUrl = requestUrl.toString();

  try {
    /** @type {Record<string, string>} */
    const headers = {
      Accept: "application/json",
    };
    if (opts.userAgent) {
      headers["User-Agent"] = opts.userAgent;
    }

    /** @type {Response | undefined} */
    let res;
    for (let hop = 0; hop <= MAX_PSI_REDIRECTS; hop++) {
      res = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers,
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) {
          try {
            if (res.body) await res.body.cancel();
          } catch {
            // ignore
          }
          return {
            ok: false,
            status: res.status,
            error: `PSI redirect status ${res.status} without location header`,
          };
        }

        let nextUrl;
        try {
          nextUrl = new URL(loc, currentUrl);
        } catch {
          try {
            if (res.body) await res.body.cancel();
          } catch {
            // ignore
          }
          return {
            ok: false,
            status: res.status,
            error: `Invalid PSI redirect location: ${redactKey(loc)}`,
          };
        }

        const redirectCheck = await validateTargetUrl(nextUrl.toString(), {
          blockPrivateIps: opts.blockPrivateIps,
          allowPrivateIps: false,
          initialIsPrivate,
          isRedirect: true,
        });
        if (!redirectCheck.ok) {
          try {
            if (res.body) await res.body.cancel();
          } catch {
            // ignore
          }
          return {
            ok: false,
            status: 0,
            error: redirectCheck.error || "blocked redirect (SSRF protection)",
          };
        }

        // Never leak API key across origins
        if (nextUrl.origin !== new URL(currentUrl).origin) {
          nextUrl.searchParams.delete("key");
        }

        currentUrl = nextUrl.toString();
        try {
          if (res.body) await res.body.cancel();
        } catch {
          // ignore
        }

        if (hop === MAX_PSI_REDIRECTS) {
          return {
            ok: false,
            status: 0,
            error: `Too many redirects fetching PSI (>${MAX_PSI_REDIRECTS})`,
          };
        }
        continue;
      }
      break;
    }

    if (!res) {
      return { ok: false, error: "No response received from PSI" };
    }

    // Post-fetch DNS rebinding check on the final host
    if (opts.blockPrivateIps) {
      const finalHost = new URL(currentUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (!net.isIP(finalHost)) {
        const postDns = await assertSafeDns(finalHost);
        if (!postDns.safe) {
          try {
            if (res.body) await res.body.cancel();
          } catch {
            // ignore
          }
          return {
            ok: false,
            status: 0,
            error: postDns.error || "blocked DNS rebinding to private/internal IP (SSRF protection)",
          };
        }
      }
    }

    if (res.status === 429) {
      return {
        ok: false,
        status: 429,
        error: "Rate limit exceeded (HTTP 429). Check your Google PageSpeed API quota.",
      };
    }

    if (!res.ok) {
      let errMsg = res.statusText || String(res.status);
      try {
        const errJson = /** @type {any} */ (
          await Promise.race([res.json(), abortRejection(controller.signal)])
        );
        if (errJson && typeof errJson === "object" && errJson.error?.message) {
          errMsg = String(errJson.error.message);
        }
      } catch {
        // Fall back to status text
      }
      return {
        ok: false,
        status: res.status,
        error: `PSI HTTP ${res.status}: ${redactKey(errMsg)}`,
      };
    }

    const json = /** @type {any} */ (await Promise.race([res.json(), abortRejection(controller.signal)]));
    if (!json || typeof json !== "object") {
      return {
        ok: false,
        error: "Malformed PSI response: expected JSON object",
      };
    }

    const lr = json?.lighthouseResult ?? {};
    const audits = lr?.audits ?? {};
    const cats = lr?.categories ?? {};

    const rawScore = cats?.performance?.score;
    const score =
      typeof rawScore === "number" && Number.isFinite(rawScore) && rawScore >= 0
        ? Math.round(rawScore * 100)
        : null;

    const lab = {
      score,
      lcpMs: extractNumericAudit(audits, "largest-contentful-paint"),
      cls: extractNumericAudit(audits, "cumulative-layout-shift"),
      fcpMs: extractNumericAudit(audits, "first-contentful-paint"),
      tbtMs: extractNumericAudit(audits, "total-blocking-time"),
      speedIndexMs: extractNumericAudit(audits, "speed-index"),
      ttfbMs: extractNumericAudit(audits, "server-response-time"),
    };

    let field = null;
    const le = json?.loadingExperience;
    if (le && typeof le === "object" && le.metrics && Object.keys(le.metrics).length > 0) {
      const m = le.metrics;
      const extractPercentile = (/** @type {string} */ metricKey) => {
        const val = m[metricKey]?.percentile;
        return typeof val === "number" && Number.isFinite(val) && val >= 0 ? val : null;
      };
      const rawCls = extractPercentile("CUMULATIVE_LAYOUT_SHIFT_SCORE");
      const normalizedCls = rawCls != null ? (rawCls > 1 ? rawCls / 100 : rawCls) : null;

      field = {
        overallCategory: String(le.overall_category || "NONE"),
        lcpMs: extractPercentile("LARGEST_CONTENTFUL_PAINT_MS"),
        cls: normalizedCls,
        inpMs: extractPercentile("INTERACTION_TO_NEXT_PAINT"),
        fcpMs: extractPercentile("FIRST_CONTENTFUL_PAINT_MS"),
      };
    }

    return {
      ok: true,
      status: 200,
      data: {
        url,
        strategy,
        checkedAt: new Date().toISOString(),
        lab,
        field,
      },
    };
  } catch (err) {
    const isAbort =
      /** @type {{ name?: string }} */ (err)?.name === "AbortError" || controller.signal.aborted;
    const msg = isAbort ? `timeout after ${timeoutMs}ms` : err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: redactKey(msg),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate standard SEO/performance findings from a PSI result.
 * Strictly separates Lighthouse lab diagnostics from CrUX real-user data.
 * @param {PsiResult} psiResult
 * @returns {import("./report.mjs").Finding[]}
 */
export function psiFindings(psiResult) {
  if (!psiResult || !psiResult.ok || !psiResult.data) {
    return [
      {
        id: "P05-psi-error",
        category: "performance",
        severity: "P3",
        title: "PageSpeed Insights audit skipped",
        evidence: redactKey(psiResult?.error || "PageSpeed Insights query could not be completed"),
        fix: "Verify PSI_API_KEY environment variable and Google Cloud quota.",
        seoImpact: "low",
        geoImpact: "-",
      },
    ];
  }

  const { lab, field, strategy } = psiResult.data;
  const findings = [];

  // P03-psi-lab: Evaluate lab metrics
  const hasLabData =
    lab &&
    (lab.lcpMs != null || lab.cls != null || lab.tbtMs != null || lab.score != null || lab.fcpMs != null);

  if (!hasLabData) {
    findings.push({
      id: "P03-psi-lab",
      category: "performance",
      severity: "P3",
      title: "Core Web Vitals lab metrics unavailable",
      evidence: `Lighthouse lab metrics were missing or incomplete in API response (${strategy}).`,
      fix: "Verify that the page loads completely and is accessible to Google Lighthouse.",
      seoImpact: "low",
      geoImpact: "-",
    });
  } else {
    const lcpSec = lab.lcpMs != null ? `${(lab.lcpMs / 1000).toFixed(2)}s` : "N/A";
    const clsVal = lab.cls != null ? lab.cls.toFixed(3) : "N/A";
    const tbtVal = lab.tbtMs != null ? `${Math.round(lab.tbtMs)}ms` : "N/A";
    const scoreVal = lab.score != null ? `${lab.score}/100` : "N/A";
    const labEvidence = `LCP ${lcpSec}, CLS ${clsVal}, TBT ${tbtVal}, Score ${scoreVal} (${strategy})`;

    const isLabPoor =
      (lab.lcpMs != null && lab.lcpMs > 4000) ||
      (lab.cls != null && lab.cls > 0.25) ||
      (lab.tbtMs != null && lab.tbtMs > 600);
    const isLabNeedsImp =
      (lab.lcpMs != null && lab.lcpMs > 2500) ||
      (lab.cls != null && lab.cls > 0.1) ||
      (lab.tbtMs != null && lab.tbtMs > 200);

    if (isLabPoor) {
      findings.push({
        id: "P03-psi-lab",
        category: "performance",
        severity: "P1",
        title: "Poor Core Web Vitals (lab)",
        evidence: labEvidence,
        fix: "Optimize Largest Contentful Paint (target <2.5s) and prevent layout shifts (target <0.10). Compress images, defer non-critical JS, and stabilize layout dimensions.",
        seoImpact: "medium",
        geoImpact: "-",
      });
    } else if (isLabNeedsImp) {
      findings.push({
        id: "P03-psi-lab",
        category: "performance",
        severity: "P2",
        title: "Core Web Vitals need improvement (lab)",
        evidence: labEvidence,
        fix: "Improve LCP and CLS to meet Google Good thresholds (<2.5s LCP, <0.10 CLS).",
        seoImpact: "medium",
        geoImpact: "-",
      });
    } else {
      findings.push({
        id: "P03-psi-lab",
        category: "performance",
        severity: "pass",
        title: "Core Web Vitals within thresholds (lab)",
        evidence: labEvidence,
        fix: "",
        seoImpact: "medium",
        geoImpact: "-",
      });
    }
  }

  // P04-psi-field: Evaluate CrUX field data
  if (field && (field.lcpMs != null || field.cls != null || field.inpMs != null || field.fcpMs != null)) {
    const fieldLcpSec = field.lcpMs != null ? `${(field.lcpMs / 1000).toFixed(2)}s` : "N/A";
    const fieldCls = field.cls != null ? field.cls.toFixed(3) : "N/A";
    const fieldInp = field.inpMs != null ? `${Math.round(field.inpMs)}ms` : "N/A";
    const fieldEvidence = `CrUX 75th percentile: LCP ${fieldLcpSec}, CLS ${fieldCls}, INP ${fieldInp} (rating: ${field.overallCategory})`;

    const isSlow =
      field.overallCategory === "SLOW" ||
      field.overallCategory === "POOR" ||
      (field.lcpMs != null && field.lcpMs > 4000) ||
      (field.cls != null && field.cls > 0.25) ||
      (field.inpMs != null && field.inpMs > 500);

    const isAverage =
      field.overallCategory === "AVERAGE" ||
      field.overallCategory === "NEEDS_IMPROVEMENT" ||
      (field.lcpMs != null && field.lcpMs > 2500) ||
      (field.cls != null && field.cls > 0.1) ||
      (field.inpMs != null && field.inpMs > 200);

    if (isSlow) {
      findings.push({
        id: "P04-psi-field",
        category: "performance",
        severity: "P1",
        title: "Poor real-user Core Web Vitals (CrUX field)",
        evidence: fieldEvidence,
        fix: "Optimize real-world loading speed and interaction latency for mobile users.",
        seoImpact: "medium",
        geoImpact: "-",
      });
    } else if (isAverage) {
      findings.push({
        id: "P04-psi-field",
        category: "performance",
        severity: "P2",
        title: "Real-user Core Web Vitals need improvement (CrUX field)",
        evidence: fieldEvidence,
        fix: "Improve real-user 75th-percentile LCP, CLS, or INP to achieve Good status in Chrome UX Report.",
        seoImpact: "medium",
        geoImpact: "-",
      });
    } else {
      findings.push({
        id: "P04-psi-field",
        category: "performance",
        severity: "pass",
        title: "Real-user Core Web Vitals pass (CrUX field)",
        evidence: fieldEvidence,
        fix: "",
        seoImpact: "medium",
        geoImpact: "-",
      });
    }
  } else {
    findings.push({
      id: "P04-psi-field",
      category: "performance",
      severity: "pass",
      title: "No CrUX field data available",
      evidence: "Chrome UX Report has insufficient real-world traffic samples for this URL.",
      fix: "",
      seoImpact: "-",
      geoImpact: "-",
    });
  }

  return findings;
}
