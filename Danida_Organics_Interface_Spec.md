# Danida Organics — Interface Specification

**Version:** 2.1 — companion to `Danida_Organics_PRD.md` and `Danida_Organics_TRD.md` (both v2.1)
**Scope:** Visual design tokens + screen-by-screen component spec, revised for the green-forward palette, dual-facet browsing (category + health goal), shop-by-category cards, testimonials, per-product routing, and admin login/session states.

---

## 1. Design tokens (concrete values)

### Color (green-forward organic palette)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#F4F3EA` | Page background |
| `--bg-alt` | `#EDEEDF` | Hero / trust-badge strip background |
| `--surface` | `#FBFBF4` | Cards, modal, drawer |
| `--ink` | `#262A20` | Primary text, dark buttons ("Order on WhatsApp") |
| `--ink-muted` | `#6B7360` | Secondary text |
| `--ink-faint` | `#8C9481` | Tertiary text (card meta) |
| `--accent` | `#5F7A47` | Primary CTA ("Shop now", "Add to cart") |
| `--accent-fg` | `#F4F3EA` | Text on accent-filled elements |
| `--border` | `#DCE0D0` | Hairlines |
| `--border-strong` | `#C7CDB8` | Chip/input borders |
| `--image-placeholder` | `#E1E6D3` | Image loading/placeholder fill |
| `--tag-category-bg` / `--tag-category-fg` | `#E1E6D3` / `#3F4A34` | Category pill on cards |
| `--tag-goal-bg` / `--tag-goal-fg` | `#DCE7EE` / `#2E4C5C` | Health-goal pill (distinct cool tone so the two tag types read differently at a glance) |
| `--sold-out-bg` | `#262A20` | Sold-out badge |

### Type
`--font-display`: 'Fraunces', Georgia, serif (product names, headings, wordmark, 600 weight). `--font-body`: 'Inter', sans-serif (everything else, 400/500). Scale: 12/13/14/17/21/28px.

### Layout
`--radius-sm` 6px (buttons, badges), `--radius-md` 10px (cards, modal, drawer), `--radius-pill` 16px (chips/tags). Grid: 1 col mobile → 2 col ≥600px → 3 col ≥960px. Card image ratio 4:5.

### Motion
Same as v1: 150–200ms ease transitions, all wrapped in `prefers-reduced-motion` guards.

---

## 2. Screen: Header
Sticky, `--bg`, wordmark left (Fraunces 600), search icon + cart icon/badge right. No other nav links (single scrollable page; product detail reachable via URL, not a nav item).

## 3. Screen: Hero + trust badges
Hero: `--bg-alt`, image/video placeholder, brand line, "Shop now" CTA (scrolls to grid). Directly beneath: a thin centered row of 3–4 short phrases separated by hairline dividers — "Quality-checked · Freshly packed · Wide variety · Trusted suppliers" — static text, not tied to product data, editable copy only (not an admin-managed field).

## 4. Screen: Shop by category
Below the trust-badge strip: a labeled row ("Shop by category") of 4–5 large tappable cards (icon or image + label), each pre-filtering the grid to that category (or a curated "Best Sellers" flag) and scrolling down to it. Purely a homepage visual entry point — same filter mechanism as the Category dropdown, just a shortcut.

## 5. Screen: Find your product (search + filters)
Three controls: a search input (icon + "Search products" placeholder), a **Category** dropdown/select, a **Health goal** dropdown/select. Desktop: all three in one row. **Mobile: collapse into a single "Filters" button** that opens a sheet containing the search input and both dropdowns — three separate full-width controls stacked on a narrow screen would crowd the page, so mobile gets one entry point instead.

Selecting a category and/or health goal filters the grid with AND logic; search further narrows by name/tag match. Active filters are shown as removable pills above the grid with a "clear all" action.

## 6. Screen: Product grid
Card: image (or `--image-placeholder` + icon), up to **2 tag pills** (1 category using `--tag-category-*`, 1 health goal using `--tag-goal-*`; if a product has more tags than that, show a small "+N" pill rather than stacking more color pills), name (Fraunces 600, 13.5px), one-line region note (`--ink-faint`, 11px, e.g. "Grown in Northern India" — never an invented sourcing story), price ("from ₦X", 12px/500). Sold-out badge top-left when out of stock. Grid loads an initial page and shows a **"Load more"** button/control beneath rather than rendering the entire catalogue — this matters more here than it did for BeadRev's small jewelry line, given the size of this catalogue.

Empty state when a filter/search combination matches nothing: "No products match these filters" + a "Clear filters" action — this is a new case beyond v1's single-dimension empty state, since category + health goal + search can now combine.

## 7. Screen: Quick-view / product detail
Reachable by tapping a card (opens as an overlay) or by navigating directly to a product's own URL (same overlay, auto-opened over the homepage). Contents: gallery + thumbnail strip, name, description, region note, then:
- **Form selector** — only rendered if the product has more than one form (e.g. Powder vs. Whole/Cut); styled identically to the weight chips below it so the two-step selection reads as one flow, not two different UI patterns.
- **Weight selector** — options and prices update based on the chosen form (or show directly if there's only one form).
- Quantity stepper, then Add to cart — disabled with an inline "choose a form and weight" prompt until both are selected (or just weight, if the product has a single form).

Mobile: sticky Add to cart in the thumb zone; body scrolls independently above it so the Form/Weight/quantity controls don't get cramped. Closing (✕, Esc, scrim tap) returns the URL to `/` (or the prior filtered view) without a full reload, and returns focus to the triggering card if it was opened from the grid.

## 8. Screen: Cart drawer
Unchanged shape from v1, line items now show **form + weight** (e.g. "Ashwagandha Root — Powder, 100g"). No thresholds, no gamification. "Order on WhatsApp" as the single CTA, `--ink` fill (deliberately not `--accent`, keeping "send" actions visually distinct from "shop" actions).

## 9. Screen: Testimonials
A real, always-rendered section (not hidden-until-populated): 2–4 short italic quotes (Fraunces, 12px) in cards, first name attribution. If fewer than 2 quotes exist yet, show a light "more stories coming soon" placeholder card rather than omitting the section.

## 10. Screen: FAQ
Simple accordion or plain Q&A list, `--font-body`, no card wrapper needed — flows on `--bg`.

## 11. Screen: Freshness, storage & delivery
Unchanged from v1 in spirit — short guidance, no card wrapper.

## 12. Screen: Footer
`--bg-alt`, Instagram + WhatsApp links, and the **wellness disclaimer** (small print: not medical advice, not intended to diagnose/treat/cure/prevent disease).

## 13. Screen: Admin (`admin.html`)
Utilitarian, not on-brand editorial styling.

**Login screen:** single password field + submit, centered card, small wordmark only (no full branding). States: default, submitting, error ("incorrect password", field retained, focus returns to it), **locked out** (after 5 consecutive wrong attempts — field disabled, countdown text, e.g. "Too many attempts. Try again in 47s"). Once logged in, the session persists (no re-prompt on return visits) until an explicit **Log out** action, placed unobtrusively in the admin header.

Beyond v1's fields, the product form now includes:
- **Categories**: multi-select control against the current category list.
- **Health goals**: multi-select control against the current health-goal list.
- **Forms repeater**: add/remove a form (label field) each containing its own weights repeater (label + price rows) — a nested repeater, the most complex control in the admin.
- **Region note**: optional single-line text.
- **Description field**: helper text directly under the textarea — "Describe flavor, texture, or traditional use. Avoid claims that a product treats, cures, or prevents any condition." This puts the wellness-disclaimer content guideline in front of whoever is actually typing, rather than leaving it as a rule someone has to remember from a document.
- **Duplicate** action in the product list (alongside edit/delete/reorder) — creates an editable copy, not a live duplicate.
- **Category manager** and **Health goal manager**: simple add/rename/delete list screens; deleting an in-use tag shows a confirmation naming how many products reference it.
- **Export/backup** button: downloads the current catalogue as a JSON file.
- **Catalogue size indicator**: a small, unobtrusive line in the admin footer — "X products, ~Y KB" — so approaching JSONBin/Cloudinary free-tier limits is visible in the tool itself instead of depending on someone remembering to check externally.

## 14. Component states checklist (additions over v1)

| Component | States to design |
|---|---|
| Category/health-goal pill (card) | default, "+N overflow" variant |
| Form selector (quick-view) | hidden (single form), default, selected, focus-visible |
| Weight selector (quick-view) | updates when Form changes; default, selected, focus-visible |
| Mobile "Filters" button | default, active (sheet open), active-filter-count badge |
| Load more (grid) | default, loading, end-of-results (hidden/disabled) |
| Admin forms repeater | empty, one row, multiple rows, remove-row confirmation |
| Category/health-goal manager | list, add, rename inline, delete-confirmation (in-use warning) |
| Admin login | default, submitting, wrong-password error, locked-out (cooldown) |

## 15. Responsive breakpoints
Same as v1 (mobile <600px 1 col, tablet 600–959px 2 col, desktop ≥960px 3 col), with the added rule that the search+category+health-goal row collapses to the single "Filters" control below 600px.

---

This spec, together with the two mockups already rendered in conversation (v2 green-forward palette, v3 with shop-by-category cards/dual filters/testimonials), is the reference for the build in Claude Code.
