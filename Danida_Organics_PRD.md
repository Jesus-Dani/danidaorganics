# Danida Organics — Product Requirements Document

**Version:** 2.1 (revised after feature-by-feature walkthrough, inspired by Diaspora Co, Burlap & Barrel, and Starwest Botanicals) — LOCKED
**Owner:** [Founder name] (Danida Organics)
**Status:** Approved for build — Path A architecture (JSONBin + Cloudinary + Netlify Function, as BeadRev NG), extended with per-product URLs

> The catalogue is managed through a private admin page backed by a lightweight cloud database (JSONBin) and image host (Cloudinary), brokered by Netlify Functions. Content goes live without re-uploading the site.

---

## 1. Summary

Danida Organics is a **statically-hosted storefront** for a broad herbal apothecary catalogue: Ayurvedic, Chinese, and Western herbs, culinary spices, teas, roots, barks, seeds, nuts, leaves, berries, fruit & vegetable powders, and essential oils. Danida **curates and resells** — she does not farm — so product content is honest about origin (region only, when known) rather than claiming direct farm partnerships.

Products are browsed through **one grid with three ways in**: a small set of visual "shop by category" cards, a **category filter**, and a **health-goal filter** (both multi-tag, both editable by the founder), plus a basic **search bar**. Many products are sold in more than one **form** (e.g. powder vs. whole/cut), each with its own weight options and prices — the buyer picks form, then weight, in the product's quick-view.

**No on-site payment** — a multi-item cart compiles a single pre-filled **WhatsApp** message. Product content (text + images) is managed by the founder through a **private, password-gated admin page**. Unlike BeadRev's single-page-only model, individual products get their own **shareable, indexable URL** (still a static site, client-side routed) — because this catalogue's breadth and health-goal categorization are built to be found via search and shared product-by-product, not just browsed from one link.

Two priorities above all: a calm, **green-forward organic editorial feel**, and **very fast loads on any device** (Nigeria-first).

## 2. Goals

- Launch a clean, credible, browsable storefront across a wide, varied catalogue.
- Let the founder **add/edit/remove products, categories, and health goals herself** — no code, no redeveloper needed for day-to-day catalogue changes.
- Make it easy to **find products two ways**: by what they are (category) and by why someone wants them (health goal).
- Let a specific product be **shared with a correct preview** on WhatsApp/Instagram, and be **found via Google search**.
- **Frictionless ordering** via WhatsApp.
- Stay close to **free-tier hosting**, with an explicit eye on where free tiers stop being enough as the catalogue grows.

## 3. Non-goals (v1)

- No on-site payments or customer accounts.
- No inventory sync, shipping calculator, or order database (WhatsApp is the order record).
- No wholesale/B2B portal, no subscriptions, no blog.
- No per-product customer reviews system (the "what people are saying" section holds founder-curated testimonials, not an open review system).
- No multi-user admin accounts or roles — a single shared admin password, for the founder alone.
- No bulk import (CSV/spreadsheet) in v1 — products are entered one at a time through the admin form, aided by the duplicate-product shortcut.

## 4. Audience & context

Nigerian home cooks, wellness-conscious buyers (Ayurvedic/Chinese/Western herbal traditions), and small food/wellness businesses. Discovery via Instagram, WhatsApp, word of mouth, **and now organic search** (someone searching "ashwagandha root Nigeria" or "immune support herbs" should be able to land directly on a relevant product or category). Traffic is predominantly mobile.

## 5. System architecture (Path A, extended)

- **Storefront (static, Netlify)** — vanilla HTML/CSS/JS SPA with client-side routing for per-product URLs.
- **JSONBin (product *text*)** — hosted JSON store. Holds products, categories, and health goals.
- **Cloudinary (product *images*)** — stores + auto-optimises photos; admin uploads via unsigned preset.
- **Netlify Function — gateway (`products.js`)** — holds the JSONBin master key; GET = public read, POST = password-checked write.
- **Netlify Function — link preview (`product-meta.js`)** — new in this version. Detects link-preview bots (WhatsApp, Facebook, Instagram, Twitter/X, Slack) requesting a `/products/:slug` URL and returns a small HTML snippet with that product's real title, description, and image in the OG/Twitter meta tags, so shared links preview correctly. Regular browser requests pass through to the normal static app shell instead.

**Data flow**

- *Read (public):* Storefront → gateway Function → JSONBin → render (cached, SWR).
- *Write (admin):* Admin → gateway Function (verifies password) → JSONBin. Images → Cloudinary (unsigned) → `public_id` saved on the record.
- *Link preview:* Crawler bot → `product-meta` Function → reads product by slug → returns meta-only HTML. Human → same URL → static app shell → client JS renders the product's quick-view.

**Resilience & speed:** stale-while-revalidate; a bundled seed ships with the site for offline/JSONBin-down fallback; caching keeps requests under JSONBin's free-tier rate limit.

## 6. Information architecture

**Homepage (single scrollable page):**
1. Sticky slim header (wordmark, search icon, cart count).
2. Hero (image/video + tagline + CTA) with a **quality-focused trust badge strip** beneath (e.g. Quality-checked · Freshly packed · Wide variety · Trusted suppliers).
3. **Shop by category** — a small row of visual cards (e.g. Culinary Spices, Ayurvedic, Essential Oils, Best Sellers) as a quick visual entry point.
4. **Find your product** — search bar + Category filter + Health Goal filter (collapse into one "Filters" control on mobile).
5. Product grid (paginated / "load more", not all-at-once).
6. Testimonials ("what people are saying").
7. FAQ.
8. Freshness, storage & delivery.
9. Footer (Instagram, WhatsApp, wellness disclaimer).

**Product detail:** reachable two ways — tapping a card opens the **quick-view** as an overlay on the homepage, *or* navigating directly to `/products/:slug` opens the homepage with that product's quick-view automatically open (deep link). Same content, same component, two entry points.

> The **admin page** (`admin.html`) is a separate page, unlinked from public nav, password-gated.

## 7. Features (detailed)

### 7.1 Hero
Image or short looping video + brand line + "Shop now" CTA, poster preloaded as LCP. `prefers-reduced-motion` → poster only.

### 7.2 Trust badge strip
Thin row under the hero, static text (not per-product): e.g. Quality-checked · Freshly packed · Wide variety · Trusted suppliers. Founder can edit the wording later; not tied to product data.

### 7.3 Shop by category
3–5 large visual cards, each linking into the grid pre-filtered to that category (or "Best Sellers", a manually curated flag). Purely a homepage entry point, not a separate page.

### 7.4 Category filter
Multi-select-capable per product, single-select in the filter UI (choose one category to narrow the grid). 13 categories at launch: Roots, Barks, Seeds, Nuts, Leaves, Berries, Fruits & Vegetable Powders, Culinary Spices, Essential Oils, Teas, Ayurvedic Herbs, Chinese Herbs, Western Herbs. **Editable from admin** (add/rename/delete).

### 7.5 Health goal filter
Independent second filter, same interaction pattern as category. 12 goals at launch (from Starwest's model): Immune Support, Calm & Sleep, Digestive Balance, Heart Healthy Living, Mind & Focus, Energy & Vitality, Skin/Hair & Beauty, Mobility & Joint Comfort, Women's Wellness, Men's Wellness, Breath & Respiratory Comfort, Superfoods & Greens. **Editable from admin.** Category and health goal filters combine with AND logic (e.g. "Roots" + "Energy & Vitality" shows only products tagged with both).

### 7.6 Search
Client-side text search across product name and tags (categories + health goals). Combines with active filters (AND). Debounced input.

### 7.7 Product grid
Responsive grid (1→2→3 cols). Card: image, up to 2 tag pills (1 category + 1 health goal, with a "+N" indicator if more apply), name, one-line **region-only** note (e.g. "Grown in Northern Nigeria" — no invented sourcing-relationship claims, since Danida resells rather than farms), price shown as "from ₦[lowest price across all form/weight combinations]". **Sold-out** badge when `inStock:false`. **Paginated / "load more"** rather than rendering the full catalogue at once.

### 7.8 Quick-view (product detail)
Gallery with thumbnail strip; name; short description; region note; **Form selector** (only shown if the product has more than one form, e.g. Powder vs. Whole/Cut) → **Weight selector** for the chosen form (price depends on both); quantity stepper; Add to cart (disabled with an inline prompt until form + weight are chosen, if applicable). Deep-linkable via `/products/:slug`; also openable as a modal from the grid. Mobile: sticky Add to cart in the thumb zone.

### 7.9 Cart drawer
Line items show name, **form + weight**, qty, line price, remove icon. Subtotal in ₦, persisted in `localStorage`. Button: "Order on WhatsApp". No free-shipping thresholds or gamification — kept simple since delivery cost isn't calculated on-site.

### 7.10 WhatsApp checkout
Builds a `wa.me` link with an itemized message:
```
Hello Danida Organics 🌿 I'd like to order:
• Ashwagandha Root — Powder, 100g ×2 — ₦8,000
• Eucalyptus Oil — 10ml ×1 — ₦3,500
Total: ₦11,500
(sent from danida-organics)
```
**Length safety:** if the encoded message would exceed a safe URL length for opening WhatsApp reliably, the message is summarized (e.g. item names + total, with a note to confirm full details over chat) rather than silently failing.

### 7.11 Testimonials
2–4 short founder-curated quotes with customer first names; a real, intended section (not hidden-until-populated as originally planned) — ships with a couple of quotes at launch if available, otherwise a light "quotes coming soon" placeholder rather than being absent.

### 7.12 FAQ
3–6 Q&As: storage/freshness by product type, food-grade vs. wellness-use products, how WhatsApp ordering works, delivery.

### 7.13 Freshness, storage & delivery
Short guidance per broad product type (e.g. "store powders airtight, away from light"); one honest delivery line.

### 7.14 Wellness disclaimer
Footer text clarifying that product descriptions are not medical advice and products aren't intended to diagnose, treat, cure, or prevent disease — standard given the Ayurvedic/Chinese/wellness-adjacent catalogue. **Content guideline for the founder:** avoid specific medical claims in product descriptions; refer to traditional/common use rather than promising health outcomes.

### 7.15 Admin page (`admin.html`, private)
- Password gate, verified server-side.
- **Product CRUD**: add/edit/delete/reorder/**duplicate** (duplicate speeds up entering similar SKUs).
- **Product form fields**: name, categories (multi-select), health goals (multi-select), region note (optional, free text), short description, **forms repeater** (each form = label like "Powder" + a weights repeater of label/price pairs), image, gallery, in-stock toggle.
- **Category manager**: add/rename/delete category tags. Deleting a category that's still used by products prompts a warning (doesn't silently orphan it).
- **Health goal manager**: same pattern as category manager.
- **Image upload**: unsigned Cloudinary upload, stores `public_id`.
- **Export/backup**: a button to download the current catalogue as JSON, independent of JSONBin, for peace of mind.
- **Draft safety**: in-progress edits kept in the browser.

### 7.16 Admin portal — acceptance criteria

Explicit, testable criteria for what "done" means, since a feature list alone doesn't say when the admin is actually working correctly:

**Access & session**
- A single shared password (the `ADMIN_PASSWORD` env var) gates the entire admin page — no per-user accounts, logins, or roles.
- Entering the correct password keeps the session active until she explicitly logs out (not re-prompted every visit).
- After **5 consecutive wrong password attempts**, the login is locked out for a short cooldown (e.g. 60 seconds) before another attempt is accepted — basic brute-force protection given a single shared password guards the whole catalogue.
- A visible **Log out** action ends the session immediately.

**Product CRUD**
- Creating a product with all required fields (name, ≥1 category, ≥1 form with ≥1 weight+price, image) and saving results in that product appearing in the public storefront grid on next load — **no redeploy required**.
- Attempting to save a product missing a required field is blocked with an inline error identifying which field(s), not a generic failure message.
- Editing a product and saving updates the live storefront the same way; the admin list itself reflects the change immediately (optimistic UI), independent of the public site's own cache refresh timing.
- Deleting a product removes it from the public grid on next load and cannot be undone from the UI (no trash/restore in v1) — the export/backup button is the safety net.
- Duplicating a product creates an editable, unsaved copy with a new (blank or auto-suffixed) slug — it does not affect the original until the copy is separately saved.
- Reordering (drag or up/down controls) persists the new `order` values on save.

**Category & health-goal managers**
- Adding a new category/health goal makes it immediately available in the corresponding product-form multi-select and site-wide filter, without a redeploy.
- Renaming a category/health goal updates the label everywhere it's referenced (products, filters) — no orphaned old name left behind.
- Attempting to delete a category/health goal that's still tagged on ≥1 product shows a confirmation stating how many products reference it, and requires an explicit second confirmation to proceed.

**Images**
- Uploading an image shows upload progress and a preview once complete; a failed upload is retryable without losing other form field values already entered.

**Export/backup**
- The export button always produces a JSON file that is a valid, complete snapshot of the current `products` + `categories` + `healthGoals` — usable to manually restore the bin's contents if needed.

**Out of scope for v1 (explicit):** no edit history/audit log, no undo/trash for deleted products, no bulk CSV import, no multi-user roles.

## 8. Data model (stored in JSONBin)

```js
{
  "products": [
    {
      id: "ashwagandha-root",
      slug: "ashwagandha-root",
      name: "Ashwagandha Root",
      categories: ["Ayurvedic Herbs", "Roots"],
      healthGoals: ["Energy & Vitality", "Calm & Sleep"],
      regionNote: "Grown in Northern India",
      description: "Calming, grounding, traditionally used in tonics.",
      forms: [
        {
          formLabel: "Powder",
          weights: [
            { "label": "50g", "price": 1500 },
            { "label": "100g", "price": 2800 }
          ]
        },
        {
          formLabel: "Whole / Cut",
          weights: [
            { "label": "100g", "price": 2000 }
          ]
        }
      ],
      image: "danida/ashwagandha_xyz",
      gallery: [],
      inStock: true,
      order: 1
    }
  ],
  "categories": ["Roots","Barks","Seeds","Nuts","Leaves","Berries","Fruits & Vegetable Powders","Culinary Spices","Essential Oils","Teas","Ayurvedic Herbs","Chinese Herbs","Western Herbs"],
  "healthGoals": ["Immune Support","Calm & Sleep","Digestive Balance","Heart Healthy Living","Mind & Focus","Energy & Vitality","Skin/Hair & Beauty","Mobility & Joint Comfort","Women's Wellness","Men's Wellness","Breath & Respiratory Comfort","Superfoods & Greens"],
  "updatedAt": "2026-07-08T00:00:00Z"
}
```

## 9. Content & credibility plan

- **Photography consistency** across the whole range, even though it spans very different product types.
- **Honest sourcing language**: region only, no invented farm-direct claims — she curates and resells.
- **Quality-focused trust badges** rather than farm-partnership badges.
- **Wellness disclaimer** + content guideline against specific medical claims.
- **Testimonials** as a real section.
- **FAQ** to pre-empt repetitive WhatsApp questions.
- **Food safety / regulatory note**: display any relevant registration (e.g. NAFDAC number) once available.

## 10. Visual & brand direction

- Green-forward organic palette: sage/olive accent, warm cream background, near-black ink — leans into "Organics" in the name.
- Type: editorial serif (Fraunces) for names/headings + clean sans (Inter) body.
- Restraint over decoration; generous margins; multi-tag pills kept small and capped in number per card to avoid clutter.

## 11. Performance & scale requirements

- LCP < 2.5s, CLS < 0.05 on low-end Android; mobile Lighthouse ≥ 90.
- Grid uses pagination/"load more" rather than rendering the entire catalogue at once — this catalogue is expected to be materially larger than BeadRev's.
- Cloudinary `f_auto,q_auto` + responsive widths; lazy below fold.
- **Scale watch-items** (not blocking launch, but flagged): JSONBin's free-tier bin is capped at **100KB**, which at a typical product record size comfortably holds somewhere in the range of 150-200+ products; Cloudinary's free tier gives **25 credits/month**, a shared pool across storage, bandwidth, and transformations. Both should be monitored via the admin's catalogue-size indicator (§7.16-adjacent UI) and Cloudinary's own usage dashboard as the catalogue and traffic grow; revisit the stack (e.g. migrate JSONBin to Supabase's free tier) if either is approached.

## 12. Tech, hosting & deployment

- Storefront + admin: vanilla HTML/CSS/JS SPA with client-side routing (History API) for `/products/:slug`.
- Two Netlify Functions: `products.js` (data gateway) and `product-meta.js` (bot-aware link previews).
- `netlify.toml` redirects all paths to the app shell for normal visitors; `/products/*` requests are checked for known bot user-agents (WhatsApp/Facebook/Instagram/Twitter/Slack crawlers) and served correct per-product meta tags when matched.
- Deploy via GitHub repo connected to Netlify (required for Functions). The Netlify account used is separate from the builder's other Netlify projects (own free-tier credit pool), owned under the founder's name/email; GitHub access is granted to that account via the Netlify GitHub App, scoped to this one repository.

## 13. Security & secrets

- JSONBin master key + admin password + session-signing secret: Netlify environment variables only, never in client code.
- Cloudinary unsigned preset scoped/capped, can't overwrite existing assets.
- Admin page unlinked, password verified server-side; single shared credential, session persists until logout, lockout after 5 consecutive wrong attempts (see §7.16).

## 14. Service accounts & free-tier notes

- JSONBin, Cloudinary, Netlify as before — see scale watch-items in §11. Cloudinary cloud name `b9kcjnji`, unsigned preset `danidaorganics` (jpg/jpeg/png/webp only) already configured.

## 15. Accessibility & i18n

UTF-8; semantic landmarks; keyboard-operable filters/search/modal/drawer/form-then-weight selectors; visible focus; AA contrast.

## 16. Sharing / SEO

- Per-product canonical URLs, dynamic per-product `<title>`/meta description/OG/Twitter card image via the `product-meta` Function for bots, and via document/meta updates in client JS for real visitors.
- Category and health-goal filtered views can also carry shareable query-string state (e.g. `?category=Roots&goal=Energy`) so a filtered view is linkable too.
- Sitemap generation is a reasonable post-launch addition once the catalogue is populated.

## 17. Launch checklist

**Setup**
- [ ] JSONBin bin (products + categories + healthGoals); Bin ID + Master Key noted
- [x] Cloudinary account; cloud name `b9kcjnji` noted; unsigned preset `danidaorganics` created (jpg/jpeg/png/webp only)
- [ ] Instagram handle; WhatsApp business number confirmed

**Build & deploy**
- [ ] `config.js` filled: Cloud name, preset, WhatsApp number, Instagram, Function paths
- [ ] GitHub repo connected to Netlify
- [ ] Netlify env vars: `JSONBIN_MASTER_KEY`, `JSONBIN_BIN_ID`, `ADMIN_PASSWORD`, `SESSION_SECRET`
- [ ] Client-side routing + bot-detection meta Function both verified (test a shared product link's preview on WhatsApp)
- [ ] Hero media + trust badges + shop-by-category cards
- [ ] Products, categories, and health goals populated via admin
- [ ] Cart + WhatsApp message (including form/weight) correct; long-cart fallback tested
- [ ] Mobile Lighthouse ≥ 90
- [ ] Deployed to Netlify

## 18. Post-launch / future

Sitemap + broader SEO work; per-product certifications (organic, NAFDAC); recipes/usage content; bulk/subscription options; custom domain; revisit JSONBin/Cloudinary if catalogue outgrows free tiers.
