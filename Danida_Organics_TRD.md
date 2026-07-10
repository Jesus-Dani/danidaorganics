# Danida Organics — Technical Requirements Document

**Version:** 2.1 — companion to `Danida_Organics_PRD.md` (v2.1)
**Scope:** Storefront with client-side routing, admin, two gateway functions, data + image services.

---

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Storefront | Vanilla HTML/CSS/JS, client-side routed (History API) | No framework; SPA with pretty URLs for products |
| Hosting | Netlify (static + Functions) | Free tier |
| Data store | JSONBin v3 | Holds products, categories, healthGoals |
| Image store/CDN | Cloudinary | Unsigned upload preset; `f_auto,q_auto` delivery |
| Write gate | Netlify Function `products.js` | Only path holding the JSONBin master key |
| Link-preview gate | Netlify Function `product-meta.js` | Serves bot-only meta HTML for `/products/:slug` |
| Client persistence | `localStorage` | Cart + admin drafts |

## 2. Repository structure

```
index.html
admin.html
/css/styles.css
/js/config.js               # non-secret: cloud name, preset, whatsapp number, ig handle, function paths
/js/router.js                # client-side routing: matches /products/:slug, updates title/meta, shows quick-view
/js/app.js                   # storefront logic: fetch, render, filter (category + healthGoal + search), cart
/js/admin.js                 # admin logic: auth, CRUD form (incl. forms/weights repeater), category/goal managers, cloudinary upload, save, export
/data/seed.js                # bundled fallback (products + categories + healthGoals)
/netlify/functions/products.js       # gateway: GET=load, POST=save (password-checked)
/netlify/functions/product-meta.js   # bot-aware per-product meta HTML
netlify.toml
/images, /video
```

## 3. Data schema

### 3.1 Product object

```ts
type WeightOption = { label: string; price: number };   // e.g. { label: "100g", price: 2800 }
type FormOption = { formLabel: string; weights: WeightOption[] };  // e.g. { formLabel: "Powder", weights: [...] }

type Product = {
  id: string;               // slug, unique, kebab-case
  slug: string;             // same as id; used in /products/:slug
  name: string;
  categories: string[];     // one or more of the category list (§3.3)
  healthGoals: string[];    // zero or more of the health-goal list (§3.3)
  regionNote?: string;      // optional, region/origin only — no sourcing-relationship claims
  description: string;      // short flavor/use note
  forms: FormOption[];      // at least one form; each form has at least one weight
  image: string;            // Cloudinary public_id, primary card image
  gallery: string[];        // additional Cloudinary public_ids
  inStock: boolean;
  order: number;            // manual sort index
};
```

Validation rules:
- `id`/`slug`: required, unique, lowercase kebab-case, generated from `name` on create (editable). Changing the slug after the product has been shared breaks old links — admin should warn on slug edit for an existing product.
- `forms`: at least one entry; each `weights` array has at least one entry; each `price` is an integer (naira, no kobo).
- `categories`: at least one entry, each must currently exist in the bin's `categories` list.
- `healthGoals`: zero or more, each must currently exist in the bin's `healthGoals` list.
- `image`: required before a product can be marked visible (draft can omit).
- Card price ("from ₦X") = minimum price across all `forms[].weights[].price`.

### 3.2 Bin wrapper

```ts
type Bin = {
  products: Product[];
  categories: string[];      // editable list, e.g. 13 at launch
  healthGoals: string[];     // editable list, e.g. 12 at launch
  updatedAt: string;         // ISO-8601
};
```

Deleting a category or health goal that's still referenced by products: admin shows a confirmation listing how many products use it, rather than silently deleting and orphaning the tag. Orphaned tags (if it happens anyway) simply stop appearing as a filter option; the product keeps the string but it won't match any active filter.

**`updatedAt` behavior:** set server-side by the gateway Function, not client-supplied — every successful admin save (POST) overwrites it with `new Date().toISOString()` at the moment of writing to JSONBin. Its purpose: (1) lets the storefront's SWR cache cheaply detect "has anything changed since I last fetched" by comparing timestamps rather than diffing the full product list; (2) gives a quick sanity check when troubleshooting ("did my last save actually go through?"); (3) dates each admin export/backup file, so a restored snapshot's age is unambiguous. The value seeded at initial bin creation (§8 of the PRD) is just a placeholder — the first real admin save immediately overwrites it.

### 3.3 Cart item (client-side, `localStorage` key `danida_cart`)

```ts
type CartItem = {
  productId: string;
  name: string;
  formLabel: string;
  weightLabel: string;
  unitPrice: number;
  qty: number;
  image: string;
};
```

### 3.4 Admin draft

Mirrors the in-progress product form (including the forms/weights repeater state) in `localStorage` key `danida_admin_draft`, cleared on successful save.

## 4. Client-side routing

- Routes: `/` (homepage, grid), `/products/:slug` (homepage + quick-view auto-opened for that product), optionally `/?category=X&goal=Y` (homepage with filters pre-applied, for shareable filtered views).
- Implemented via the History API (`pushState`/`popstate`), not hash-based, so URLs are clean (`/products/ashwagandha-root`).
- `netlify.toml` needs a catch-all rewrite (`/* -> /index.html 200`) so any deep link served directly by Netlify (not via client navigation) still boots the SPA, **except** requests matched as bots on `/products/*`, which are routed to the `product-meta` function instead (see §5).
- On route match to `/products/:slug`: fetch/read the product (from cache or gateway), open the quick-view with that product, update `document.title` and the meta description tag client-side (helps real browsers/tab titles; does not help bots, which is why §5 exists separately).
- On `popstate` (back/forward), close the quick-view / re-apply filters from the URL without a full reload.

## 5. Link-preview function (`product-meta.js`)

**Why:** WhatsApp, Facebook, Instagram, Twitter/X, and Slack's link-unfurling crawlers do not execute JavaScript. A pure client-side SPA would show generic homepage branding for every shared product link. This function intercepts those specific crawlers only.

- **Routing:** `netlify.toml` routes requests to `/products/*` through this function (or an Edge Function, if preferred) rather than directly to the static file, for all requests — the function itself decides whether to handle (bot) or pass through (human).
- **Bot detection:** check `User-Agent` against known crawler substrings (`WhatsApp`, `facebookexternalhit`, `Facebot`, `Twitterbot`, `Slackbot`, `Instagram`). This list is not exhaustive and should be treated as best-effort, not security-critical.
- **Bot response:** fetch the product by slug (same JSONBin read path as `products.js`, cached), return a minimal HTML document containing:
  ```html
  <html>
    <head>
      <title>{name} – Danida Organics</title>
      <meta property="og:title" content="{name} – Danida Organics">
      <meta property="og:description" content="{description}, from ₦{minPrice}">
      <meta property="og:image" content="{cloudinary image URL, f_auto,q_auto, fixed width}">
      <meta property="og:url" content="https://{domain}/products/{slug}">
      <meta name="twitter:card" content="summary_large_image">
    </head>
    <body></body>
  </html>
  ```
- **Human response:** serve the normal static `index.html` (read from the deployed build) unchanged, so the SPA boots and client routing (§4) takes over.
- **Fallback:** if the slug doesn't resolve to a product (deleted, typo), return generic site-level OG tags instead of erroring.

## 6. API contract — `/netlify/functions/products`

Same as v1: GET (public read, whole bin incl. categories/healthGoals), POST (admin write, password-checked, validates payload shape per §3). No changes beyond the payload now including `categories` and `healthGoals` arrays alongside `products`.

## 7. Image handling (Cloudinary)

- **Cloud name:** `b9kcjnji`. Referenced in `config.js`, not a secret — it appears in every delivered image URL regardless (`https://res.cloudinary.com/b9kcjnji/...`).
- **Upload preset:** `danidaorganics` (unsigned, per the account setup already completed). Also in `config.js`, also not a secret.
- **Accepted formats:** jpg, jpeg, png, webp — enforced at the preset level (uploads outside this list are rejected by Cloudinary before they reach the admin's product record).
- Unsigned preset scoped to a folder, unique filename / no overwrite, `f_auto,q_auto` + explicit width on delivery, blur-up placeholder via a tiny version of the same `public_id`.

## 8. WhatsApp checkout message spec

Template (line per cart item, now including form label, then total):

```
Hello Danida Organics 🌿 I'd like to order:
• {name} — {formLabel}, {weightLabel} ×{qty} — ₦{lineTotal, comma-separated}
...
Total: ₦{cartTotal, comma-separated}
(sent from danida-organics)
```

**Length safety:** before building the `wa.me` URL, check the encoded message length against a safe threshold (~1800 characters, conservative for cross-device WhatsApp link handling). If it would exceed that:
- Summarize: list item names + quantities only (drop per-line prices), keep the total, and append "Full breakdown to follow in chat."
- This keeps the link reliably openable while still giving the seller enough to start the conversation.

## 9. Rendering, caching & pagination

- SWR as in v1: render from cache/seed immediately, refresh in background.
- **Pagination:** grid renders an initial page (e.g. 24 products) with a "load more" control appending the next page from the already-fetched, already-cached full product list (no additional network calls — pagination is a client-side render concern, not a server paging concern, since the whole bin is fetched in one read).
- Filtering (category + healthGoal + search) operates on the full cached list, then paginates the filtered result.

## 10. Performance budget

Same targets as v1 (mobile Lighthouse ≥ 90, LCP < 2.5s, CLS < 0.05). Added consideration: with pagination in place, initial render cost stays bounded even as the full catalogue grows well past BeadRev's original scale.

## 11. Accessibility requirements

As v1, plus: the Form → Weight two-step selector in quick-view must be keyboard-operable and clearly announce that Weight options update when Form changes (e.g. via an ARIA live region), so screen-reader users aren't left on stale options. The mobile "Filters" control (collapsing search + category + health goal) must be a proper disclosure/dialog pattern, not a bare hidden div.

## 12. Error handling matrix

| Scenario | Behavior |
|---|---|
| GET fails, no cache | Render bundled seed, "showing saved version" notice |
| POST fails (network) | Keep admin changes in local draft, error toast, allow retry |
| POST fails (401) | "Incorrect password" inline, form retained |
| Cloudinary upload fails | Inline upload error, retry without losing other fields |
| Category/health-goal deleted while in use | Product keeps the (now orphaned) tag string; it just won't match any active filter until re-tagged |
| Slug not found (`/products/xyz` doesn't exist) | Fall back to the homepage grid with a small "product not found" notice; `product-meta` function returns generic site OG tags |
| WhatsApp message too long | Auto-summarized per §8, not blocked |
| Empty cart | Empty-state copy, "Order on WhatsApp" hidden/disabled |
| No results for a filter/search combination | "No products match these filters" empty state, with a "clear filters" action |
| 5th consecutive wrong admin password in a row | Login locked for a short cooldown (e.g. 60s) before another attempt is accepted; counter resets on a correct login |
| Admin session present but write returns 401 (e.g. password rotated) | Treat as logged-out: clear the session token, show the login screen with a neutral "please log in again" message (not a scary error) |

## 13. Security & admin auth

- Secrets only as Netlify env vars, admin password checked server-side, Cloudinary preset scoped, no PII stored anywhere (WhatsApp carries the actual order conversation).
- **Single shared credential:** one `ADMIN_PASSWORD` env var; no per-user accounts or roles (matches PRD §7.16 — the admin portal is for the founder alone).
- **Session:** on successful login, the gateway Function returns a short-lived signed session token (e.g. a signed value with an expiry, verified by the Function on each write — doesn't need to be a full JWT library, a simple HMAC-signed payload is enough at this scale). The signing key is a new env var, **`SESSION_SECRET`** — a long random string generated once at setup (not the same value as `ADMIN_PASSWORD`), never exposed to the client. The client stores the resulting token (not the secret) in `localStorage` and sends it with each write; the client also keeps the user "logged in" across visits by keeping this token until it expires or she logs out. Reads remain public and don't need the token.
- **Lockout:** the gateway Function tracks failed password attempts (in-memory per Function instance is acceptable at this scale, given a single admin user and low traffic) and rejects further attempts for a short cooldown after 5 consecutive failures, per the error-handling matrix above.
- **Logout:** a client-side action that discards the stored session token; nothing to invalidate server-side at this scale since tokens are short-lived by expiry.

## 14. Deployment pipeline

1. Push repo to GitHub, connect to Netlify.
2. Set environment variables: `JSONBIN_MASTER_KEY`, `JSONBIN_BIN_ID`, `ADMIN_PASSWORD`, `SESSION_SECRET`.
3. Configure `netlify.toml` redirects: SPA catch-all for normal routes, function-routed for `/products/*` (bot vs. human branch inside the function).
4. Deploy; verify `/.netlify/functions/products` GET works; verify a `/products/:slug` URL opens correctly in a real browser AND previews correctly when pasted into WhatsApp (test with a real message to yourself).
5. Smoke-test admin: add/edit/delete/duplicate a product, add/delete a category and a health goal, confirm storefront reflects changes.

## 15. Testing / QA checklist

- [ ] Mobile Lighthouse ≥ 90.
- [ ] Cart persists across reload; WhatsApp message correct including form + weight.
- [ ] A cart with many diverse items still produces an openable WhatsApp link (test the length-safety fallback deliberately with a large cart).
- [ ] `/products/:slug` opens the right product directly; back/forward browser navigation behaves correctly.
- [ ] Sharing a `/products/:slug` link in WhatsApp shows that product's name/image/price in the preview card, not generic site branding.
- [ ] Category filter, health-goal filter, and search combine correctly (AND logic); "no results" empty state appears when appropriate.
- [ ] Admin: category and health-goal managers correctly warn before deleting an in-use tag.
- [ ] Admin: duplicate-product shortcut produces an editable copy, not a live duplicate.
- [ ] Admin: export/backup button downloads a valid JSON snapshot of the current catalogue.
- [ ] Admin: session persists across a browser restart until logout; 5 wrong passwords in a row trigger the cooldown; logout clears the session.
- [ ] Pagination/"load more" renders correctly with a large seeded catalogue (test with 100+ dummy products).
- [ ] Keyboard-only pass across filters, search, quick-view (including Form → Weight), cart drawer, and admin.
- [ ] `prefers-reduced-motion` respected.

## 16. Browser / device support

Latest two versions of Chrome, Safari (iOS), Samsung Internet. Graceful (not full) degradation on older Android WebViews.

## 17. Open items for the business owner

- Confirm domain (for canonical URLs and OG tags to resolve correctly) — currently defaulting to a free Netlify subdomain at launch.
- Confirm whether a NAFDAC number or other food-safety registration should be displayed.
- Review the content guideline (no specific medical claims in descriptions) with whoever writes product copy.
- Flag if/when the catalogue approaches the JSONBin 100KB per-bin cap (roughly 150-200+ products at typical record size) or Cloudinary's 25 monthly credits (storage + bandwidth + transformations combined), so the stack can be revisited proactively rather than reactively.

## 18. Accounts & credentials on file (setup completed)

- **Netlify:** separate account under the founder's email (kept isolated from the builder's other Netlify projects, which share a different account's free-tier credit pool).
- **JSONBin:** account created; bin seeded with `{ products: [], categories: [...13], healthGoals: [...12], updatedAt }`. Bin ID and Master Key noted, held only as Netlify env vars.
- **Cloudinary:** cloud name `b9kcjnji`; unsigned upload preset `danidaorganics` (jpg/jpeg/png/webp only, folder-scoped, unique filename/no overwrite).
- **GitHub:** repo connected to the Netlify account via the Netlify GitHub App, scoped to this repository.
