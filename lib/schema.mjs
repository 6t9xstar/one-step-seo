/**
 * one-step-seo — Schema.org JSON-LD helpers.
 * 100% original: detect, validate (structural), generate minimal snippets.
 */

/**
 * @param {string[]} blocks
 * @returns {{ items: Record<string, any>[], errors: string[] }}
 */
export function extractJsonLd(blocks) {
  const items = [];
  const errors = [];
  for (const raw of blocks) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of arr) {
        if (node && typeof node === "object") {
          // Expand @graph
          if (Array.isArray(node["@graph"])) {
            for (const g of node["@graph"]) items.push(g);
          } else {
            items.push(node);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`invalid JSON-LD block: ${msg.slice(0, 160)}`);
    }
  }
  return { items, errors };
}

const KNOWN_TYPES = new Set([
  "Organization",
  "Person",
  "WebSite",
  "WebPage",
  "Article",
  "BlogPosting",
  "NewsArticle",
  "BreadcrumbList",
  "FAQPage",
  "Product",
  "Service",
  "LocalBusiness",
  "Store",
  "Restaurant",
  "Event",
  "Review",
  "JobPosting",
  "VideoObject",
  "ImageObject",
]);

/**
 * @param {Record<string, any>} node
 * @returns {string}
 */
function typeOf(node) {
  const t = node["@type"];
  if (Array.isArray(t)) return t.join("+");
  return t ?? "(missing @type)";
}

/**
 * @param {Record<string, any>[]} items
 * @returns {{ types: string[], issues: { type: string, issue: string }[] }}
 */
export function validateSchema(items) {
  const issues = [];
  const types = items.map(typeOf);

  for (const node of items) {
    const t = node["@type"];
    if (!node["@context"]) {
      issues.push({ type: typeOf(node), issue: "missing @context (use https://schema.org)" });
    }
    if (!t) {
      issues.push({ type: "(unknown)", issue: "missing @type" });
      continue;
    }
    const flat = Array.isArray(t) ? t : [t];
    for (const single of flat) {
      if (!KNOWN_TYPES.has(single)) {
        issues.push({ type: single, issue: "unrecognized @type — check Schema.org spelling" });
      }
    }
    if ((t === "Article" || t === "BlogPosting" || t === "NewsArticle") && !node.headline) {
      issues.push({ type: String(t), issue: "Article without headline" });
    }
    if (t === "FAQPage" && !node.mainEntity) {
      issues.push({ type: "FAQPage", issue: "FAQPage without mainEntity questions" });
    }
    if (t === "BreadcrumbList" && !node.itemListElement) {
      issues.push({ type: "BreadcrumbList", issue: "BreadcrumbList without itemListElement" });
    }
  }
  return { types, issues };
}

/**
 * @param {string} kind
 * @param {{ name?: string, url?: string, description?: string }} [data]
 * @returns {Record<string, any>}
 */
export function generateSchema(
  kind,
  { name = "Example", url = "https://example.com", description = "" } = {}
) {
  const ctx = "https://schema.org";
  switch (kind.toLowerCase()) {
    case "organization":
      return {
        "@context": ctx,
        "@type": "Organization",
        name,
        url,
        logo: `${url}/favicon.ico`,
      };
    case "website":
      return {
        "@context": ctx,
        "@type": "WebSite",
        name,
        url,
      };
    case "breadcrumb":
      return {
        "@context": ctx,
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: url },
          { "@type": "ListItem", position: 2, name: name, item: `${url}/page/` },
        ],
      };
    case "article":
      return {
        "@context": ctx,
        "@type": "Article",
        headline: name,
        description: description || name,
        author: { "@type": "Organization", name },
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
      };
    case "faq":
      return {
        "@context": ctx,
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "What is this page about?",
            acceptedAnswer: { "@type": "Answer", text: description || name },
          },
        ],
      };
    default:
      return { "@context": ctx, "@type": "WebPage", name, url, description };
  }
}

/**
 * @param {string} kind
 * @param {{ name?: string, url?: string, description?: string }} [data]
 * @returns {string}
 */
export function schemaSnippet(kind, data) {
  return `<script type="application/ld+json">\n${JSON.stringify(generateSchema(kind, data), null, 2)}\n</script>`;
}
