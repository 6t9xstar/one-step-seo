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
          // Expand @graph at any level (top-level or inside array items).
          if (Array.isArray(node["@graph"])) {
            // Per schema.org, @context declared on the parent applies to every
            // node in its @graph. Inherit it, otherwise each child is later
            // reported as "missing @context" even though the markup is valid —
            // @graph is the default Yoast / RankMath / Next.js pattern.
            const inherited = typeof node["@context"] === "string" ? node["@context"] : "";
            for (const g of node["@graph"]) {
              if (g && typeof g === "object") {
                if (Array.isArray(g["@graph"])) {
                  for (const nested of g["@graph"]) items.push(inheritContext(nested, inherited));
                } else {
                  items.push(inheritContext(g, inherited));
                }
              }
            }
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

/**
 * Copy an inherited `@context` onto a `@graph` child that does not declare its
 * own. Returns the same object when there is nothing to inherit, so valid
 * markup is never mutated.
 * @param {Record<string, any>} node
 * @param {string} context
 * @returns {Record<string, any>}
 */
function inheritContext(node, context) {
  if (!context || typeof node["@context"] === "string") return node;
  return { "@context": context, ...node };
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
  "QAPage",
  "Product",
  "Offer",
  "AggregateRating",
  "Review",
  "Service",
  "LocalBusiness",
  "Store",
  "Restaurant",
  "Event",
  "JobPosting",
  "VideoObject",
  "ImageObject",
  "HowTo",
  "Recipe",
  "Course",
  "SoftwareApplication",
  "ItemList",
  "SearchAction",
  "PostalAddress",
  "CreativeWork",
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
 * Per-type required-property rules. Keyed by the individual JSON-LD `type` string so an
 * array type (e.g. `["Article","BlogPosting"]`) is checked per element — the
 * old `t === "Article"` comparisons could never match an array and silently
 * skipped all of these.
 * @type {Record<string, { property: string, issue: string }>}
 */
const REQUIRED_PROPS = {
  Article: { property: "headline", issue: "Article without headline" },
  BlogPosting: { property: "headline", issue: "BlogPosting without headline" },
  NewsArticle: { property: "headline", issue: "NewsArticle without headline" },
  FAQPage: { property: "mainEntity", issue: "FAQPage without mainEntity questions" },
  BreadcrumbList: { property: "itemListElement", issue: "BreadcrumbList without itemListElement" },
  Event: { property: "startDate", issue: "Event without startDate" },
  VideoObject: { property: "thumbnailUrl", issue: "VideoObject without thumbnailUrl" },
  Organization: { property: "name", issue: "Organization without name" },
};

/**
 * @param {Record<string, any>} node
 * @param {string} type
 * @param {{ type: string, issue: string }[]} issues
 */
function checkRequiredProps(node, type, issues) {
  const rule = REQUIRED_PROPS[type];
  if (rule && !node[rule.property]) issues.push({ type, issue: rule.issue });
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
      checkRequiredProps(node, single, issues);
    }
    // Product needs one of three alternative properties, so it stays bespoke.
    if (flat.includes("Product") && !node.offers && !node.review && !node.aggregateRating) {
      issues.push({ type: "Product", issue: "Product without offers/review/aggregateRating" });
    }
  }
  return { types, issues };
}

/**
 * @param {string} kind
 * @param {{ name?: string, url?: string, description?: string }} [data]
 * @returns {Record<string, any>}
 */
export function generateSchema(kind, { name = "", url = "", description = "" } = {}) {
  const ctx = "https://schema.org";
  const k = kind.toLowerCase();
  const needsIdentity = ["organization", "website", "article", "product", "event", "localbusiness"];
  if (needsIdentity.includes(k) && (!name || !url)) {
    throw new Error(
      `generateSchema("${k}") requires { name, url } — refusing to emit placeholder "Example" data.`,
    );
  }
  const safeUrl = url || "https://example.com";
  const safeName = name || "Example page";
  switch (k) {
    case "organization":
      return {
        "@context": ctx,
        "@type": "Organization",
        name: safeName,
        url: safeUrl,
      };
    case "website":
      return {
        "@context": ctx,
        "@type": "WebSite",
        name: safeName,
        url: safeUrl,
      };
    case "breadcrumb":
      return {
        "@context": ctx,
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: safeUrl },
          { "@type": "ListItem", position: 2, name: safeName, item: `${safeUrl}/page/` },
        ],
      };
    case "article":
      return {
        "@context": ctx,
        "@type": "Article",
        headline: safeName,
        description: description || safeName,
        author: { "@type": "Organization", name: safeName },
        mainEntityOfPage: { "@type": "WebPage", "@id": safeUrl },
      };
    case "faq":
      return {
        "@context": ctx,
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "What is this page about?",
            acceptedAnswer: { "@type": "Answer", text: description || safeName },
          },
        ],
      };
    case "product":
      return {
        "@context": ctx,
        "@type": "Product",
        name: safeName,
        description: description || safeName,
        url: safeUrl,
      };
    case "event":
      return {
        "@context": ctx,
        "@type": "Event",
        name: safeName,
        description: description || safeName,
        url: safeUrl,
      };
    case "localbusiness":
      return {
        "@context": ctx,
        "@type": "LocalBusiness",
        name: safeName,
        url: safeUrl,
        description: description || safeName,
      };
    case "howto":
      return {
        "@context": ctx,
        "@type": "HowTo",
        name: safeName,
        description: description || safeName,
      };
    default:
      return { "@context": ctx, "@type": "WebPage", name: safeName, url: safeUrl, description };
  }
}

/**
 * @param {string} kind
 * @param {{ name?: string, url?: string, description?: string }} [data]
 * @returns {string}
 */
export function schemaSnippet(kind, data) {
  const json = JSON.stringify(generateSchema(kind, data), null, 2).replace(/<\/script/gi, "<\\/script");
  return `<script type="application/ld+json">\n${json}\n</script>`;
}
