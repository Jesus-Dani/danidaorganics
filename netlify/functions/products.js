// Netlify Function: /.netlify/functions/products
// GET  -> public read of the full bin (products, categories, healthGoals, updatedAt)
// POST -> { action: "login", password }              -> { token, expiresAt }
//         { action: "save", token, data }             -> writes bin, returns new bin
//
// Holds the only copy of JSONBIN_MASTER_KEY in the whole system. Never sent to the client.

const crypto = require("crypto");

const JSONBIN_BASE = "https://api.jsonbin.io/v3/b";
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // session persists ~30 days or until logout
const LOCKOUT_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

// In-memory per warm function instance — acceptable at this scale (TRD §13):
// single admin user, low traffic, resets harmlessly on cold start.
let failedAttempts = 0;
let lockoutUntil = 0;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input) {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
}

function sign(payload) {
  const secret = process.env.SESSION_SECRET;
  const body = base64url(JSON.stringify(payload));
  const sig = base64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const secret = process.env.SESSION_SECRET;
  const expected = base64url(crypto.createHmac("sha256", secret).update(body).digest());
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(base64urlDecode(body));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

async function jsonbinGet() {
  const res = await fetch(`${JSONBIN_BASE}/${process.env.JSONBIN_BIN_ID}/latest`, {
    headers: { "X-Master-Key": process.env.JSONBIN_MASTER_KEY }
  });
  if (!res.ok) throw new Error(`JSONBin GET failed: ${res.status}`);
  const data = await res.json();
  return data.record;
}

async function jsonbinPut(record) {
  const res = await fetch(`${JSONBIN_BASE}/${process.env.JSONBIN_BIN_ID}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": process.env.JSONBIN_MASTER_KEY
    },
    body: JSON.stringify(record)
  });
  if (!res.ok) throw new Error(`JSONBin PUT failed: ${res.status}`);
  const data = await res.json();
  return data.record;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateBin(data) {
  const productErrors = [];

  if (!Array.isArray(data.products)) return { error: "validation", message: "products must be an array" };
  if (!Array.isArray(data.categories)) return { error: "validation", message: "categories must be an array" };
  if (!Array.isArray(data.healthGoals)) return { error: "validation", message: "healthGoals must be an array" };

  const categorySet = new Set(data.categories);
  const healthGoalSet = new Set(data.healthGoals);
  const seenSlugs = new Set();

  data.products.forEach((p, index) => {
    const fields = [];
    if (!p.id || typeof p.id !== "string" || !SLUG_RE.test(p.id)) fields.push("id");
    if (!p.slug || typeof p.slug !== "string" || !SLUG_RE.test(p.slug)) fields.push("slug");
    if (p.slug && seenSlugs.has(p.slug)) fields.push("slug (duplicate)");
    if (p.slug) seenSlugs.add(p.slug);
    if (!p.name || typeof p.name !== "string" || !p.name.trim()) fields.push("name");
    if (!Array.isArray(p.categories) || p.categories.length === 0) {
      fields.push("categories");
    } else if (!p.categories.every((c) => categorySet.has(c))) {
      fields.push("categories (unknown tag)");
    }
    if (p.healthGoals && !Array.isArray(p.healthGoals)) {
      fields.push("healthGoals");
    } else if (Array.isArray(p.healthGoals) && !p.healthGoals.every((g) => healthGoalSet.has(g))) {
      fields.push("healthGoals (unknown tag)");
    }
    if (!Array.isArray(p.forms) || p.forms.length === 0) {
      fields.push("forms");
    } else {
      const formsValid = p.forms.every(
        (f) =>
          f &&
          typeof f.formLabel === "string" &&
          f.formLabel.trim() &&
          Array.isArray(f.weights) &&
          f.weights.length > 0 &&
          f.weights.every(
            (w) => w && typeof w.label === "string" && w.label.trim() && Number.isInteger(w.price) && w.price >= 0
          )
      );
      if (!formsValid) fields.push("forms (incomplete weight/price rows)");
    }
    if (!p.image || typeof p.image !== "string" || !p.image.trim()) fields.push("image");
    if (typeof p.inStock !== "boolean") fields.push("inStock");
    if (typeof p.order !== "number") fields.push("order");

    if (fields.length > 0) {
      productErrors.push({ index, id: p.id || null, name: p.name || null, fields });
    }
  });

  if (productErrors.length > 0) {
    return { error: "validation", productErrors };
  }
  return null;
}

async function handleGet() {
  try {
    const record = await jsonbinGet();
    return json(200, record);
  } catch (err) {
    return json(502, { error: "upstream_unavailable", message: err.message });
  }
}

function handleLogin(body) {
  const now = Date.now();
  if (now < lockoutUntil) {
    return json(429, { error: "locked", retryAfter: Math.ceil((lockoutUntil - now) / 1000) });
  }

  const password = typeof body.password === "string" ? body.password : "";
  const expected = process.env.ADMIN_PASSWORD || "";

  if (password && expected && password === expected) {
    failedAttempts = 0;
    const exp = Date.now() + TOKEN_TTL_MS;
    return json(200, { token: sign({ exp }), expiresAt: exp });
  }

  failedAttempts++;
  if (failedAttempts >= MAX_ATTEMPTS) {
    lockoutUntil = Date.now() + LOCKOUT_MS;
    failedAttempts = 0;
    return json(429, { error: "locked", retryAfter: Math.ceil(LOCKOUT_MS / 1000) });
  }
  return json(401, { error: "invalid_password" });
}

async function handleSave(body) {
  const session = verifyToken(body.token);
  if (!session) {
    return json(401, { error: "invalid_session" });
  }

  const data = body.data;
  if (!data || typeof data !== "object") {
    return json(400, { error: "validation", message: "Missing data payload" });
  }

  const validationError = validateBin(data);
  if (validationError) {
    return json(422, validationError);
  }

  const record = {
    products: data.products,
    categories: data.categories,
    healthGoals: data.healthGoals,
    updatedAt: new Date().toISOString()
  };

  try {
    const saved = await jsonbinPut(record);
    return json(200, saved);
  } catch (err) {
    return json(502, { error: "upstream_unavailable", message: err.message });
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    return handleGet();
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "invalid_json" });
    }

    if (body.action === "login") return handleLogin(body);
    if (body.action === "save") return handleSave(body);
    return json(400, { error: "unknown_action" });
  }

  return json(405, { error: "method_not_allowed" });
};
