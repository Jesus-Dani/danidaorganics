// Non-secret config — safe to ship in client code.
// Real secrets (JSONBIN_MASTER_KEY, ADMIN_PASSWORD, SESSION_SECRET) live only
// as Netlify environment variables, read server-side by the Functions.

window.DANIDA_CONFIG = {
  cloudinary: {
    cloudName: "b9kcjnji",
    uploadPreset: "danidaorganics"
  },
  whatsapp: {
    // Full international format, digits only (no +, no spaces)
    number: "2348035954212"
  },
  instagram: {
    handle: "danidaorganics_herbs",
    url: "https://www.instagram.com/danidaorganics_herbs"
  },
  functions: {
    products: "/.netlify/functions/products",
    productMeta: "/.netlify/functions/product-meta"
  },
  // Used to build canonical/OG URLs. Defaults to the deployed origin at
  // runtime (window.location.origin) — this is just a documented fallback.
  siteName: "Danida Organics",

  // "Shop by category" is a curated homepage shortcut (PRD §7.3), not every
  // category — pick a handful here. Must match names in the bin's categories list.
  homepageCategoryCards: ["Culinary Spices", "Ayurvedic Herbs", "Essential Oils", "Teas", "Chinese Herbs"],

  // Founder-curated testimonials (PRD §7.11). Real quotes only — leave empty
  // (or under 2 entries) to show the "more stories coming soon" placeholder
  // rather than inventing customer quotes.
  testimonials: [],

  productsPerPage: 24
};
