/**
 * one-step-seo — Google PageSpeed Insights (PSI) Core Web Vitals integration.
 * Zero external dependencies. Uses standard fetch.
 * Secure: Never leaks, logs, or persists the user's API key.
 */

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
 * @typedef {{
 *   score: number,
 *   lcpMs: number,
 *   cls: number,
 *   fcpMs: number,
 *   tbtMs: number,
 *   speedIndexMs: number,
 *   ttfbMs: number
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
 * @param {string} url
 * @param {{
 *   key?: string,
 *   strategy?: "mobile" | "desktop" | string,
 *   timeoutMs?: number,
 *   userAgent?: string,
 *   endpoint?: string
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    /** @type {Record<string, string>} */
    const headers = {
      Accept: "application/json",
    };
    if (opts.userAgent) {
      headers["User-Agent"] = opts.userAgent;
    }

    const res = await fetch(requestUrl.toString(), {
      signal: controller.signal,
      headers,
    });
    clearTimeout(timer);

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
        const errJson = /** @type {any} */ (await res.json());
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

    const json = /** @type {any} */ (await res.json());
    const lr = json?.lighthouseResult ?? {};
    const audits = lr?.audits ?? {};
    const cats = lr?.categories ?? {};

    const rawScore = cats?.performance?.score;
    const score = typeof rawScore === "number" ? Math.round(rawScore * 100) : 0;

    const lab = {
      score,
      lcpMs: Number(audits["largest-contentful-paint"]?.numericValue ?? 0),
      cls: Number(audits["cumulative-layout-shift"]?.numericValue ?? 0),
      fcpMs: Number(audits["first-contentful-paint"]?.numericValue ?? 0),
      tbtMs: Number(audits["total-blocking-time"]?.numericValue ?? 0),
      speedIndexMs: Number(audits["speed-index"]?.numericValue ?? 0),
      ttfbMs: Number(audits["server-response-time"]?.numericValue ?? 0),
    };

    let field = null;
    const le = json?.loadingExperience;
    if (le && typeof le === "object" && le.metrics && Object.keys(le.metrics).length > 0) {
      const m = le.metrics;
      const rawCls = m["CUMULATIVE_LAYOUT_SHIFT_SCORE"]?.percentile;
      const normalizedCls = typeof rawCls === "number" ? (rawCls > 1 ? rawCls / 100 : rawCls) : null;

      field = {
        overallCategory: String(le.overall_category || "NONE"),
        lcpMs:
          typeof m["LARGEST_CONTENTFUL_PAINT_MS"]?.percentile === "number"
            ? m["LARGEST_CONTENTFUL_PAINT_MS"].percentile
            : null,
        cls: normalizedCls,
        inpMs:
          typeof m["INTERACTION_TO_NEXT_PAINT"]?.percentile === "number"
            ? m["INTERACTION_TO_NEXT_PAINT"].percentile
            : null,
        fcpMs:
          typeof m["FIRST_CONTENTFUL_PAINT_MS"]?.percentile === "number"
            ? m["FIRST_CONTENTFUL_PAINT_MS"].percentile
            : null,
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
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: redactKey(msg),
    };
  }
}

/**
 * Generate standard SEO/performance findings from a PSI result.
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
  const lcpSec = (lab.lcpMs / 1000).toFixed(2);
  const clsVal = lab.cls.toFixed(3);
  const labEvidence = `LCP ${lcpSec}s, CLS ${clsVal}, TBT ${Math.round(lab.tbtMs)}ms, Score ${lab.score}/100 (${strategy})`;

  if (lab.lcpMs > 4000 || lab.cls > 0.25) {
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
  } else if (lab.lcpMs > 2500 || lab.cls > 0.1) {
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

  // P04-psi-field: Evaluate CrUX field data
  if (field && (field.lcpMs != null || field.cls != null || field.inpMs != null)) {
    const fieldLcpSec = field.lcpMs != null ? `${(field.lcpMs / 1000).toFixed(2)}s` : "N/A";
    const fieldCls = field.cls != null ? field.cls.toFixed(3) : "N/A";
    const fieldInp = field.inpMs != null ? `${Math.round(field.inpMs)}ms` : "N/A";
    const fieldEvidence = `CrUX 75th percentile: LCP ${fieldLcpSec}, CLS ${fieldCls}, INP ${fieldInp} (rating: ${field.overallCategory})`;

    const isSlow =
      field.overallCategory === "SLOW" ||
      (field.lcpMs != null && field.lcpMs > 4000) ||
      (field.cls != null && field.cls > 0.25);
    const isAverage =
      field.overallCategory === "AVERAGE" ||
      (field.lcpMs != null && field.lcpMs > 2500) ||
      (field.cls != null && field.cls > 0.1);

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
