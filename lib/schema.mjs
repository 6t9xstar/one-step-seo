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

/**
 * Recognised schema.org types. This exists to catch typos, not to be a complete
 * vocabulary — schema.org defines ~800 types, so an allowlist that flagged
 * everything unknown produced P2s on perfectly valid markup. `Question`,
 * `Answer`, `ListItem` and `HowToStep` are the *mandated children* of
 * `FAQPage`, `QAPage`, `BreadcrumbList` and `HowTo`, so any site emitting them
 * as top-level nodes was being penalised. Missing types are reported, but only
 * after this broad common set is excluded.
 */
const KNOWN_TYPES = new Set([
  // --- things / top level ---
  "Thing",
  "CreativeWork",
  "Person",
  "Organization",
  "Place",
  "Event",
  "Action",
  "Intangible",
  "Product",
  // --- organizations ---
  "Corporation",
  "EducationalOrganization",
  "GovernmentOrganization",
  "NGO",
  "PerformingGroup",
  "SportsTeam",
  "Airline",
  "LocalBusiness",
  "Store",
  "Restaurant",
  "FoodEstablishment",
  "LodgingBusiness",
  "Hotel",
  "MedicalOrganization",
  "ProfessionalService",
  "AutomotiveBusiness",
  "HomeAndConstructionBusiness",
  "LegalService",
  "FinancialService",
  "RealEstateAgent",
  "TravelAgency",
  "OnlineBusiness",
  "EmploymentAgency",
  // --- places ---
  "PostalAddress",
  "GeoCoordinates",
  "GeoShape",
  "AdministrativeArea",
  "Country",
  "City",
  "State",
  "Landform",
  "LandmarksOrHistoricalBuildings",
  "TouristAttraction",
  // --- creative works ---
  "Article",
  "BlogPosting",
  "NewsArticle",
  "TechArticle",
  "ScholarlyArticle",
  "Report",
  "Book",
  "Chapter",
  "Movie",
  "MusicRecording",
  "MusicAlbum",
  "MusicComposition",
  "Painting",
  "Photograph",
  "Sculpture",
  "TVSeries",
  "TVEpisode",
  "Podcast",
  "PodcastEpisode",
  "WebPage",
  "WebSite",
  "AboutPage",
  "CheckoutPage",
  "CollectionPage",
  "ContactPage",
  "FAQPage",
  "ItemPage",
  "MedicalWebPage",
  "ProfilePage",
  "QAPage",
  "RealEstateListing",
  "SearchResultsPage",
  "VideoGame",
  "VisualArtwork",
  "HowTo",
  "Recipe",
  "Review",
  "CriticReview",
  "UserReview",
  "MediaReview",
  "Recommendation",
  "Guide",
  "Dataset",
  "DigitalDocument",
  "PresentationDigitalDocument",
  "SpreadsheetDigitalDocument",
  "TextDigitalDocument",
  "NoteDigitalDocument",
  "Menu",
  "MenuSection",
  "MenuItem",
  // --- events ---
  "BusinessEvent",
  "ChildrensEvent",
  "ComedyEvent",
  "CourseInstance",
  "DanceEvent",
  "DeliveryEvent",
  "EducationEvent",
  "EventSeries",
  "ExhibitionEvent",
  "Festival",
  "FoodEvent",
  "Hackathon",
  "LiteraryEvent",
  "MusicEvent",
  "PublicationEvent",
  "SaleEvent",
  "ScreeningEvent",
  "SocialEvent",
  "SportsEvent",
  "TheaterEvent",
  "VisualArtsEvent",
  // --- structured value / intangibles ---
  "PropertyValue",
  "QuantitativeValue",
  "QualitativeValue",
  "StructuredValue",
  "MonetaryAmount",
  "PriceSpecification",
  "UnitPriceSpecification",
  "CompoundPriceSpecification",
  "DeliveryChargeSpecification",
  "PaymentChargeSpecification",
  "Offer",
  "AggregateOffer",
  "AggregateRating",
  "Rating",
  "InteractionCounter",
  "Audience",
  "PeopleAudience",
  "Brand",
  "DefinedTerm",
  "DefinedTermSet",
  "CategoryCode",
  "CategoryCodeSet",
  "EducationalOccupationalCredential",
  "OccupationalExperienceRequirements",
  "Language",
  "Sex",
  "GenderType",
  "ContactPoint",
  "ContactPointOption",
  "ServiceChannel",
  "HowToStep",
  "HowToSection",
  "HowToTip",
  "HowToSupply",
  "HowToTool",
  "Question",
  "Answer",
  "Comment",
  "ListItem",
  "ItemList",
  "BreadcrumbList",
  "OfferCatalog",
  "WebAPI",
  "EntryPoint",
  "ActionAccessSpecification",
  "DigitalDocumentPermission",
  "Grant",
  "NutritionInformation",
  "HowToDirection",
  "HowToItem",
  // --- products & commerce ---
  "ProductModel",
  "IndividualProduct",
  "ProductGroup",
  "SomeProducts",
  "Vehicle",
  "Car",
  "Drug",
  "DietarySupplement",
  "MerchantReturnPolicy",
  "MerchantReturnPolicySeasonalOverride",
  "OfferShippingDetails",
  "Order",
  "OrderItem",
  "OrderStatus",
  "ParcelDelivery",
  "Invoice",
  "Reservation",
  "Ticket",
  "ProgramMembership",
  "Service",
  "FinancialProduct",
  "LoanOrCredit",
  "PaymentCard",
  "BankAccount",
  "InvestmentOrDeposit",
  "CurrencyConversionService",
  // --- jobs & education ---
  "JobPosting",
  "Occupation",
  "OccupationAggregation",
  "OccupationAggregationByEmployer",
  "WorkBasedProgram",
  "EducationalOccupationalProgram",
  "Course",
  "LearningResource",
  "Syllabus",
  // --- health & medical ---
  "MedicalCondition",
  "MedicalProcedure",
  "MedicalTest",
  "MedicalTherapy",
  "MedicalDevice",
  "MedicalSignOrSymptom",
  "MedicalRiskFactor",
  "MedicalStudy",
  "MedicalGuideline",
  "MedicalCode",
  "DrugStrength",
  "DoseSchedule",
  "Patient",
  "Physician",
  "Hospital",
  "MedicalClinic",
  "DiagnosticLab",
  "MedicalSpecialty",
  "AnatomicalStructure",
  "AnatomicalSystem",
  "SuperficialAnatomy",
  "PhysicalExam",
  "Diet",
  "ExercisePlan",
  "LifestyleModification",
  "Substance",
  "MedicalEntity",
  // --- media ---
  "VideoObject",
  "AudioObject",
  "ImageObject",
  "ImageGallery",
  "MediaObject",
  "DataFeed",
  "DataFeedItem",
  "Clip",
  "MovieClip",
  "TVClip",
  "VideoGameClip",
  "Barcode",
  "Table",
  "SoftwareSourceCode",
  "SoftwareApplication",
  "WebApplication",
  "MobileApplication",
  "Game",
  "GameServer",
  // --- reviews & ratings handled above ---
  "EmployerAggregateRating",
  "EmployeeRole",
  // --- misc / commonly emitted ---
  "SearchAction",
  "ReadAction",
  "ViewAction",
  "WatchAction",
  "ListenAction",
  "BuyAction",
  "DonateAction",
  "OrderAction",
  "ReserveAction",
  "ScheduleAction",
  "WebPageElement",
  "SiteNavigationElement",
  "WPHeader",
  "WPFooter",
  "WPSideBar",
  "WPAdBlock",
  "SpecialAnnouncement",
  "SatiricalArticle",
  "AdvertiserContentArticle",
  "AnalysisNewsArticle",
  "AskPublicNewsArticle",
  "BackgroundNewsArticle",
  "OpinionNewsArticle",
  "ReportageNewsArticle",
  "ReviewNewsArticle",
  "LiveBlogPosting",
  "DiscussionForumPosting",
  "SocialMediaPosting",
  "Message",
  "EmailMessage",
  "Legislation",
  "LegislationObject",
  "MediaSubscription",
  "Newspaper",
  "Periodical",
  "PublicationIssue",
  "PublicationVolume",
  "Thesis",
  "Atlas",
  "Map",
  "3DModel",
  "ArchiveComponent",
  "ArchiveOrganization",
  "Consortium",
  "Library",
  "LibrarySystem",
  "Play",
  "Episode",
  "Series",
  "Season",
  "PodcastSeries",
  "RadioSeries",
  "ComicStory",
  "ComicIssue",
  "ComicCoverArt",
  "CoverArt",
  "Statement",
  "ExerciseAction",
  "BedDetails",
  "Room",
  "House",
  "Accommodation",
  "Apartment",
  "SingleFamilyResidence",
  "CampingPitch",
  "Resort",
  "Motel",
  "Hostel",
  "BedAndBreakfast",
  "Brewery",
  "CafeOrCoffeeShop",
  "Distillery",
  "FastFoodRestaurant",
  "IceCreamShop",
  "Winery",
  "Bakery",
  "BarOrPub",
  "NightClub",
  "Pharmacy",
  "VeterinaryCare",
  "EmergencyService",
  "FireStation",
  "PoliceStation",
  "PostOffice",
  "GovernmentOffice",
  "LegislativeBuilding",
  "Courthouse",
  "DefenceEstablishment",
  "CollegeOrUniversity",
  "HighSchool",
  "ElementarySchool",
  "MiddleSchool",
  "Preschool",
  "School",
  "ResearchOrganization",
  "Project",
  "ResearchProject",
  "FundingScheme",
  "FundingAgency",
  "MonetaryGrant",
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
