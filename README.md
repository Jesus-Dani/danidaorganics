# Danida Organics

Storefront + admin for a Nigerian herbal apothecary. Vanilla HTML/CSS/JS, no
build step, per `Danida_Organics_TRD.md` §1. The three spec documents in this
repo (`Danida_Organics_PRD.md`, `_TRD.md`, `_Interface_Spec.md`) are the
source of truth — this README is just the practical "how to run it" layer.

## Local development

```
netlify dev
```

Requires the [Netlify CLI](https://docs.netlify.com/cli/get-started/)
(`npm install -g netlify-cli`) and a `.env` file (copy `.env.example`) with:

```
JSONBIN_MASTER_KEY=...
JSONBIN_BIN_ID=...
ADMIN_PASSWORD=...
SESSION_SECRET=...
```

Without real JSONBin credentials, the storefront falls back to the bundled
seed (`data/seed.js`, ships with an empty product list) and admin saves will
fail at the JSONBin write step — everything else (auth, validation, routing,
cart, UI) is fully testable locally regardless.

## Deployment

1. Push this repo to GitHub, connect it to the founder's Netlify account
   (via the Netlify GitHub App, scoped to this repo only).
2. Set the four env vars above as Netlify environment variables (Site
   settings → Environment variables) — never commit real values.
3. Deploy, then verify:
   - `/.netlify/functions/products` GET returns the bin.
   - A `/products/:slug` URL opens the right product in a real browser.
   - **The same link pasted into an actual WhatsApp chat shows that
     product's own name/image/price** in the preview — not generic site
     branding. This can only be verified against a public HTTPS URL, not
     `localhost`, so it's the one thing that must be checked post-deploy.

## Still open before launch (see PRD §17 / TRD §17 for the full list)

- **Hero image/video** — `index.html`'s hero currently has no real asset;
  it degrades gracefully (hides on 404) but needs real photography.
- **Testimonials** — `js/config.js`'s `testimonials` array is intentionally
  empty (shows an honest "more stories coming soon" placeholder per PRD
  §7.11) rather than fabricated quotes. Add real founder-curated quotes
  there once available.
- **Catalogue** — no products/categories content beyond the 13
  categories/12 health goals seeded in `data/seed.js`; products are added
  through the admin once deployed.
- **JSONBin bin** — confirm the bin is actually seeded with
  `{ products: [], categories: [...], healthGoals: [...], updatedAt }`
  matching PRD §8, and that `JSONBIN_BIN_ID`/`JSONBIN_MASTER_KEY` are set.
- **Domain** — OG/canonical URLs default to the Netlify subdomain until a
  custom domain is confirmed (TRD §17).
- **NAFDAC / food-safety registration** — not displayed; confirm with the
  founder whether one should be (PRD §9, TRD §17).
- **Mobile Lighthouse ≥ 90** — run once deployed to a real URL; a local
  `netlify dev` run isn't representative of production CDN/caching.

## What was verified locally (this session)

Using a temporary seeded catalogue and fake JSONBin credentials (reverted
before commit — `data/seed.js` ships with `products: []`):

- Grid rendering, category/health-goal/search filtering (AND logic),
  pagination, empty states (both "no results for these filters" and
  "no products yet" for a genuinely empty catalogue).
- Quick-view routing (`/products/:slug`), Form→Weight two-step selector,
  cart drawer, WhatsApp message builder including the >1800-char
  length-safety fallback (tested with a 20-item cart).
- `product-meta.js` bot-detection branch (curl with a `WhatsApp/...`
  user-agent) and the human passthrough branch, including the slug-not-found
  fallback to generic OG tags.
- Admin: login, 5-attempt lockout with cooldown, session token verification,
  server-side validation with field-level errors, product form
  (multiselects, forms/weights repeater, draft autosave), category/health-goal
  managers with the two-step in-use delete confirmation, export/backup,
  catalogue-size indicator.
- Keyboard focus trapping in the quick-view, cart drawer, filter sheet, and
  admin dialogs; `Escape` closes all of them; `[hidden]` now reliably hides
  elements even under conflicting author CSS (see comment in `css/styles.css`).

Not verified (needs a real public deploy + real credentials): actual
JSONBin read/write round-trip, a real WhatsApp preview-card test, and
Lighthouse against production hosting.

A local Lighthouse run against `netlify dev` (mobile preset, empty
catalogue) scored 34/100 — this is **not representative**: Lighthouse's
mobile preset applies heavy CPU/network throttling on top of an
un-CDN'd, uncompressed local dev server with real Netlify Function
cold-starts and no build-step minification (deliberately out of scope per
TRD §1). Re-run Lighthouse against the actual production URL once
deployed; that number is the one that matters against the ≥90 target.
