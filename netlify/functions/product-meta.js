// Netlify Function: routed from /products/* via netlify.toml
// Bot crawlers (WhatsApp, Facebook, Instagram, Twitter/X, Slack) get a minimal
// HTML doc with per-product OG/Twitter meta tags, since they don't execute JS.
// Everyone else gets the normal static app shell, unchanged, so the SPA boots
// and client-side routing (js/router.js) takes over.

const JSONBIN_BASE = "https://api.jsonbin.io/v3/b";
const CLOUD_NAME = "b9kcjnji"; // matches js/config.js — not a secret
const SITE_NAME = "Danida Organics";

const BOT_SUBSTRINGS = ["WhatsApp", "facebookexternalhit", "Facebot", "Twitterbot", "Slackbot", "Instagram"];

function isBot(userAgent) {
  if (!userAgent) return false;
  return BOT_SUBSTRINGS.some((s) => userAgent.toLowerCase().includes(s.toLowerCase()));
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function minPrice(product) {
  let min = null;
  for (const form of product.forms || []) {
    for (const w of form.weights || []) {
      if (typeof w.price === "number" && (min === null || w.price < min)) min = w.price;
    }
  }
  return min;
}

function cloudinaryUrl(publicId, width = 1200) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/f_auto,q_auto,w_${width}/${publicId}`;
}

function metaHtml({ title, description, image, url }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    ${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ""}
    <meta property="og:url" content="${escapeHtml(url)}">
    <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    ${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ""}
  </head>
  <body></body>
</html>`;
}

async function fetchBin() {
  const res = await fetch(`${JSONBIN_BASE}/${process.env.JSONBIN_BIN_ID}/latest`, {
    headers: { "X-Master-Key": process.env.JSONBIN_MASTER_KEY }
  });
  if (!res.ok) throw new Error(`JSONBin GET failed: ${res.status}`);
  const data = await res.json();
  return data.record;
}

exports.handler = async (event) => {
  const userAgent = event.headers["user-agent"] || event.headers["User-Agent"] || "";
  const requestPath = event.path || "/";

  // event.rawUrl (Netlify's Lambda-compatible event) already carries the
  // correct scheme for the current environment (http in `netlify dev`,
  // https in production) — deriving it manually from headers guesses wrong
  // locally, since x-forwarded-proto isn't always set by the dev proxy.
  let origin;
  if (event.rawUrl) {
    origin = new URL(event.rawUrl).origin;
  } else {
    const proto = event.headers["x-forwarded-proto"] || "https";
    const host = event.headers["host"] || event.headers["Host"] || "";
    origin = `${proto}://${host}`;
  }

  if (!isBot(userAgent)) {
    // Human visitor: pass through to the deployed static app shell.
    try {
      const res = await fetch(`${origin}/index.html`);
      const html = await res.text();
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: html
      };
    } catch {
      return { statusCode: 502, body: "Unable to load app shell" };
    }
  }

  // Bot: resolve the slug and return meta-only HTML.
  const slug = requestPath.replace(/^\/products\/?/, "").split("/")[0].split("?")[0];

  const genericMeta = metaHtml({
    title: `${SITE_NAME} — Herbal Apothecary`,
    description: "A curated herbal apothecary: Ayurvedic, Chinese and Western herbs, spices, teas, roots, and more.",
    image: null,
    url: `${origin}${requestPath}`
  });

  if (!slug) {
    return { statusCode: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: genericMeta };
  }

  try {
    const bin = await fetchBin();
    const product = (bin.products || []).find((p) => p.slug === slug);

    if (!product) {
      return { statusCode: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: genericMeta };
    }

    const price = minPrice(product);
    const description = `${product.description || ""}${price !== null ? `, from ₦${price.toLocaleString("en-NG")}` : ""}`;
    const image = product.image ? cloudinaryUrl(product.image) : null;

    const html = metaHtml({
      title: `${product.name} – ${SITE_NAME}`,
      description,
      image,
      url: `${origin}/products/${product.slug}`
    });

    return { statusCode: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: html };
  } catch {
    return { statusCode: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: genericMeta };
  }
};
