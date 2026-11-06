/**
 * one-step-seo — Terminal color and formatting helper (zero dependencies).
 * Respects process.stdout.isTTY, NO_COLOR standard (https://no-color.org),
 * and TERM=dumb.
 */

/**
 * @param {{ isTTY?: boolean }} [stream]
 * @param {Record<string, string | undefined>} [env]
 */
export function createColorHelper(stream = process.stdout, env = process.env) {
  const enabled = Boolean(stream?.isTTY && !env.NO_COLOR && env.TERM !== "dumb");
  return {
    enabled,
    /** @param {string | number} s */
    bold: (s) => (enabled ? `\x1b[1m${s}\x1b[0m` : String(s)),
    /** @param {string | number} s */
    dim: (s) => (enabled ? `\x1b[2m${s}\x1b[0m` : String(s)),
    /** @param {string | number} s */
    green: (s) => (enabled ? `\x1b[32m${s}\x1b[0m` : String(s)),
    /** @param {string | number} s */
    yellow: (s) => (enabled ? `\x1b[33m${s}\x1b[0m` : String(s)),
    /** @param {string | number} s */
    red: (s) => (enabled ? `\x1b[31m${s}\x1b[0m` : String(s)),
    /** @param {string | number} s */
    cyan: (s) => (enabled ? `\x1b[36m${s}\x1b[0m` : String(s)),
    /** @param {string | number} s */
    gray: (s) => (enabled ? `\x1b[90m${s}\x1b[0m` : String(s)),
    /** @param {string} sev */
    severityBadge: (sev) => {
      if (!enabled) return `[${sev}]`;
      if (sev === "P0") return `\x1b[1;31m[P0]\x1b[0m`;
      if (sev === "P1") return `\x1b[1;33m[P1]\x1b[0m`;
      if (sev === "P2") return `\x1b[36m[P2]\x1b[0m`;
      if (sev === "P3") return `\x1b[90m[P3]\x1b[0m`;
      if (sev === "pass") return `\x1b[32m[pass]\x1b[0m`;
      return `[${sev}]`;
    },
    /** @param {number} score @param {string} band */
    scoreBadge: (score, band) => {
      const text = `${score}/100 (${band})`;
      if (!enabled) return text;
      if (band === "A" || band === "B" || band === "good") return `\x1b[1;32m${text}\x1b[0m`;
      if (band === "C" || band === "D" || band === "needs-work" || band === "fair")
        return `\x1b[1;33m${text}\x1b[0m`;
      return `\x1b[1;31m${text}\x1b[0m`;
    },
  };
}

export const c = createColorHelper();
