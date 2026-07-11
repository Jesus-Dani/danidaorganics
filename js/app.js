// Storefront logic: fetch/cache, render, filter, quick-view, cart, WhatsApp checkout.
// Routing (URL <-> app state) lives in router.js and calls into the functions
// exposed on window.DanidaApp at the bottom of this file.

(function () {
  "use strict";

  const config = window.DANIDA_CONFIG;
  const BIN_CACHE_KEY = "danida_bin_cache";
  const CART_KEY = "danida_cart";
  const WA_SAFE_LENGTH = 1800;

  const state = {
    bin: null,
    filters: { category: "", goal: "", search: "" },
    page: 1,
    cart: loadCart(),
    qv: null // { product, formIndex, weightIndex, qty }
  };

  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });

  // ---------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatNaira(n) {
    return "₦" + Number(n || 0).toLocaleString("en-NG");
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
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

  function cldUrl(publicId, width) {
    if (!publicId) return "";
    return `https://res.cloudinary.com/${config.cloudinary.cloudName}/image/upload/f_auto,q_auto,w_${width}/${publicId}`;
  }

  function lazyImgHtml(publicId, alt, width) {
    if (!publicId) {
      return `<div class="image-placeholder-icon" aria-hidden="true"></div>`;
    }
    const tiny = cldUrl(publicId, 24);
    const full = cldUrl(publicId, width);
    return `<img src="${tiny}" data-src="${full}" alt="${escapeHtml(alt)}" loading="lazy" class="blur-up">`;
  }

  function initLazyImages(root) {
    const imgs = root.querySelectorAll("img[data-src]");
    if (!("IntersectionObserver" in window)) {
      imgs.forEach((img) => { img.src = img.dataset.src; img.classList.remove("blur-up"); });
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const img = entry.target;
          const loader = new Image();
          loader.onload = () => {
            img.src = img.dataset.src;
            img.classList.remove("blur-up");
          };
          loader.src = img.dataset.src;
          io.unobserve(img);
        });
      },
      { rootMargin: "200px" }
    );
    imgs.forEach((img) => io.observe(img));
  }

  function trapFocus(container, event) {
    if (!container) return;
    const focusables = Array.from(
      container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
    ).filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function showToast(message, ms = 3000) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.dataset.visible = "true";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toast.dataset.visible = "false"; }, ms);
  }

  // ---------------------------------------------------------------------
  // Data loading (SWR)
  // ---------------------------------------------------------------------

  function getCachedBin() {
    try {
      const raw = localStorage.getItem(BIN_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setCachedBin(bin) {
    try {
      localStorage.setItem(BIN_CACHE_KEY, JSON.stringify(bin));
    } catch {
      /* storage full/unavailable — non-fatal */
    }
  }

  async function fetchBin() {
    const res = await fetch(config.functions.products);
    if (!res.ok) throw new Error("products fetch failed: " + res.status);
    return res.json();
  }

  async function loadBin() {
    const cached = getCachedBin();
    if (cached) {
      state.bin = cached;
      renderAll();
      readyResolve();
      refreshInBackground();
      return;
    }
    renderSkeletonGrid();
    try {
      const fresh = await fetchBin();
      state.bin = fresh;
      setCachedBin(fresh);
      renderAll();
    } catch {
      state.bin = window.DANIDA_SEED;
      renderAll();
      showToast("Showing saved version — reconnecting…");
    }
    readyResolve();
  }

  async function refreshInBackground() {
    try {
      const fresh = await fetchBin();
      if (fresh.updatedAt !== state.bin.updatedAt) {
        state.bin = fresh;
        setCachedBin(fresh);
        renderAll();
      }
    } catch {
      /* keep showing cached data */
    }
  }

  // ---------------------------------------------------------------------
  // Cart persistence
  // ---------------------------------------------------------------------

  function loadCart() {
    try {
      const raw = localStorage.getItem(CART_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
    } catch {
      /* non-fatal */
    }
  }

  // ---------------------------------------------------------------------
  // Render: top-level
  // ---------------------------------------------------------------------

  function renderAll() {
    populateFilterControls();
    renderCategoryCards();
    applyFiltersAndRender();
  }

  function renderSkeletonGrid() {
    const grid = document.getElementById("product-grid");
    grid.setAttribute("aria-busy", "true");
    grid.innerHTML = Array.from({ length: 6 })
      .map(
        () => `
      <div class="product-card">
        <div class="product-card-media skeleton"></div>
        <div class="product-card-body">
          <div class="skeleton" style="height:14px;width:70%;margin-bottom:6px;border-radius:4px;"></div>
          <div class="skeleton" style="height:11px;width:50%;border-radius:4px;"></div>
        </div>
      </div>`
      )
      .join("");
  }

  // ---------------------------------------------------------------------
  // Shop by category
  // ---------------------------------------------------------------------

  function renderCategoryCards() {
    const wrap = document.getElementById("category-cards");
    const featured = config.homepageCategoryCards.filter((c) => state.bin.categories.includes(c));
    const rest = state.bin.categories.filter((c) => !featured.includes(c));

    wrap.innerHTML =
      featured
        .map(
          (cat) => `
      <button type="button" class="category-card" data-category-card="${escapeHtml(cat)}">
        <span class="category-card-icon" aria-hidden="true">🌿</span>
        <span class="category-card-label">${escapeHtml(cat)}</span>
      </button>`
        )
        .join("") +
      (rest.length > 0
        ? `
      <button type="button" class="category-card" id="more-categories-card">
        <span class="category-card-icon" aria-hidden="true">＋</span>
        <span class="category-card-label">More</span>
      </button>`
        : "");

    wrap.querySelectorAll("[data-category-card]").forEach((btn) => {
      btn.addEventListener("click", () => selectCategoryAndScroll(btn.dataset.categoryCard));
    });

    const moreBtn = document.getElementById("more-categories-card");
    if (moreBtn) moreBtn.addEventListener("click", () => openMoreCategoriesModal(rest));
  }

  function selectCategoryAndScroll(category) {
    state.filters.category = category;
    syncFilterControls();
    applyFiltersAndRender();
    pushFilterState();
    document.getElementById("finder").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openMoreCategoriesModal(categories) {
    document.getElementById("content-modal-title").textContent = "All categories";
    const body = document.getElementById("content-modal-body");
    body.innerHTML = `
      <div class="category-list-scroll">
        ${categories
          .map(
            (cat) => `
          <button type="button" class="category-card category-list-item" data-more-category="${escapeHtml(cat)}">
            <span class="category-card-icon" aria-hidden="true">🌿</span>
            <span class="category-card-label">${escapeHtml(cat)}</span>
          </button>`
          )
          .join("")}
      </div>`;
    body.querySelectorAll("[data-more-category]").forEach((btn) => {
      btn.addEventListener("click", () => {
        closeContentModal();
        selectCategoryAndScroll(btn.dataset.moreCategory);
      });
    });
    document.getElementById("content-modal").setAttribute("open", "");
    document.body.style.overflow = "hidden";
    document.getElementById("content-modal-close").focus();
  }

  // ---------------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------------

  function populateFilterControls() {
    const catOptions = state.bin.categories
      .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
      .join("");
    const goalOptions = state.bin.healthGoals
      .map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`)
      .join("");

    ["category-select", "sheet-category-select"].forEach((id) => {
      const el = document.getElementById(id);
      el.innerHTML = `<option value="">All categories</option>${catOptions}`;
    });
    ["goal-select", "sheet-goal-select"].forEach((id) => {
      const el = document.getElementById(id);
      el.innerHTML = `<option value="">All health goals</option>${goalOptions}`;
    });

    syncFilterControls();
  }

  function syncFilterControls() {
    document.getElementById("search-input").value = state.filters.search;
    document.getElementById("sheet-search-input").value = state.filters.search;
    document.getElementById("category-select").value = state.filters.category;
    document.getElementById("sheet-category-select").value = state.filters.category;
    document.getElementById("goal-select").value = state.filters.goal;
    document.getElementById("sheet-goal-select").value = state.filters.goal;

    const activeCount = (state.filters.category ? 1 : 0) + (state.filters.goal ? 1 : 0) + (state.filters.search ? 1 : 0);
    const badge = document.getElementById("active-count-badge");
    if (activeCount > 0) {
      badge.hidden = false;
      badge.textContent = String(activeCount);
    } else {
      badge.hidden = true;
    }
  }

  function getFilteredProducts() {
    const { category, goal, search } = state.filters;
    const q = search.trim().toLowerCase();
    return state.bin.products
      .filter((p) => !category || p.categories.includes(category))
      .filter((p) => !goal || (p.healthGoals || []).includes(goal))
      .filter((p) => {
        if (!q) return true;
        const haystack = [p.name, ...(p.categories || []), ...(p.healthGoals || [])].join(" ").toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  function renderActiveFilterPills() {
    const wrap = document.getElementById("active-filters");
    const pills = [];
    if (state.filters.category) {
      pills.push(`<span class="filter-pill" data-pill="category">${escapeHtml(state.filters.category)}<button type="button" aria-label="Remove category filter" data-remove-pill="category">✕</button></span>`);
    }
    if (state.filters.goal) {
      pills.push(`<span class="filter-pill" data-pill="goal">${escapeHtml(state.filters.goal)}<button type="button" aria-label="Remove health goal filter" data-remove-pill="goal">✕</button></span>`);
    }
    if (state.filters.search) {
      pills.push(`<span class="filter-pill" data-pill="search">"${escapeHtml(state.filters.search)}"<button type="button" aria-label="Clear search" data-remove-pill="search">✕</button></span>`);
    }
    if (pills.length > 0) {
      pills.push(`<button type="button" class="clear-filters-link" data-clear-all>Clear all</button>`);
    }
    wrap.innerHTML = pills.join("");

    wrap.querySelectorAll("[data-remove-pill]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.filters[btn.dataset.removePill] = "";
        syncFilterControls();
        applyFiltersAndRender();
        pushFilterState();
      });
    });
    const clearAll = wrap.querySelector("[data-clear-all]");
    if (clearAll) {
      clearAll.addEventListener("click", () => {
        state.filters = { category: "", goal: "", search: "" };
        syncFilterControls();
        applyFiltersAndRender();
        pushFilterState();
      });
    }
  }

  function pushFilterState() {
    const params = new URLSearchParams();
    if (state.filters.category) params.set("category", state.filters.category);
    if (state.filters.goal) params.set("goal", state.filters.goal);
    const qs = params.toString();
    const path = window.location.pathname.startsWith("/products/") ? window.location.pathname : "/";
    const url = path + (qs ? `?${qs}` : "");
    if (window.DanidaRouter) window.DanidaRouter.replace(url);
  }

  function applyFiltersAndRender(resetPage = true) {
    if (resetPage) state.page = 1;
    renderActiveFilterPills();
    renderGrid();
  }

  // ---------------------------------------------------------------------
  // Product grid
  // ---------------------------------------------------------------------

  function renderGrid() {
    const grid = document.getElementById("product-grid");
    const filtered = getFilteredProducts();
    const perPage = config.productsPerPage;
    const visible = filtered.slice(0, state.page * perPage);
    const loadMoreBtn = document.getElementById("load-more-btn");

    grid.setAttribute("aria-busy", "false");

    if (filtered.length === 0) {
      const hasActiveFilters = state.filters.category || state.filters.goal || state.filters.search;
      grid.innerHTML = hasActiveFilters
        ? `
        <div class="empty-state" style="grid-column:1/-1;">
          <p>No products match these filters.</p>
          <button type="button" class="btn btn-outline" data-clear-all-empty>Clear filters</button>
        </div>`
        : `
        <div class="empty-state" style="grid-column:1/-1;">
          <p>No products yet — check back soon.</p>
        </div>`;
      loadMoreBtn.hidden = true;
      const clearBtn = grid.querySelector("[data-clear-all-empty]");
      if (clearBtn) {
        clearBtn.addEventListener("click", () => {
          state.filters = { category: "", goal: "", search: "" };
          syncFilterControls();
          applyFiltersAndRender();
          pushFilterState();
        });
      }
      return;
    }

    grid.innerHTML = visible.map(productCardHtml).join("");
    initLazyImages(grid);

    grid.querySelectorAll("[data-product-card]").forEach((card) => {
      card.addEventListener("click", () => {
        const slug = card.dataset.productCard;
        if (window.DanidaRouter) window.DanidaRouter.goToProduct(slug, card);
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          card.click();
        }
      });
    });

    loadMoreBtn.hidden = visible.length >= filtered.length;
  }

  function productCardHtml(p) {
    const price = minPrice(p);
    const tags = [];
    if (p.categories && p.categories[0]) tags.push(`<span class="tag-pill category">${escapeHtml(p.categories[0])}</span>`);
    if (p.healthGoals && p.healthGoals[0]) tags.push(`<span class="tag-pill goal">${escapeHtml(p.healthGoals[0])}</span>`);
    const totalTags = (p.categories || []).length + (p.healthGoals || []).length;
    const overflow = totalTags - tags.length;
    if (overflow > 0) tags.push(`<span class="tag-pill overflow">+${overflow}</span>`);

    return `
    <button type="button" class="product-card" data-product-card="${escapeHtml(p.slug)}" tabindex="0">
      <div class="product-card-media">
        ${lazyImgHtml(p.image, p.name, 480)}
        <div class="product-card-tags">${tags.join("")}</div>
        ${!p.inStock ? `<span class="sold-out-badge">Sold out</span>` : ""}
      </div>
      <div class="product-card-body">
        <div class="product-card-name">${escapeHtml(p.name)}</div>
        ${p.regionNote ? `<div class="product-card-region">${escapeHtml(p.regionNote)}</div>` : ""}
        <div class="product-card-price">${price !== null ? "from " + formatNaira(price) : ""}</div>
      </div>
    </button>`;
  }

  // ---------------------------------------------------------------------
  // Quick-view
  // ---------------------------------------------------------------------

  function getProductBySlug(slug) {
    return state.bin && state.bin.products.find((p) => p.slug === slug);
  }

  function openQuickViewBySlug(slug, triggerEl) {
    const product = getProductBySlug(slug);
    if (!product) return false;
    state.qv = {
      product,
      formIndex: product.forms.length === 1 ? 0 : null,
      weightIndex: product.forms.length === 1 && product.forms[0].weights.length === 1 ? 0 : null,
      qty: 1,
      triggerEl: triggerEl || null
    };
    renderQuickView();
    document.getElementById("quickview-overlay").setAttribute("open", "");
    document.body.style.overflow = "hidden";
    document.getElementById("quickview-close").focus();

    document.title = `${product.name} – ${config.siteName}`;
    setMetaDescription(`${product.description || ""}${minPrice(product) !== null ? ", from " + formatNaira(minPrice(product)) : ""}`);
    return true;
  }

  function setMetaDescription(text) {
    let tag = document.querySelector('meta[name="description"]');
    if (!tag) {
      tag = document.createElement("meta");
      tag.setAttribute("name", "description");
      document.head.appendChild(tag);
    }
    tag.setAttribute("content", text);
  }

  function closeQuickView() {
    const overlay = document.getElementById("quickview-overlay");
    overlay.removeAttribute("open");
    document.body.style.overflow = "";
    document.title = `Danida Organics — Herbal Apothecary`;
    setMetaDescription("A curated herbal apothecary: Ayurvedic, Chinese and Western herbs, culinary spices, teas, roots, barks, seeds and more. Order on WhatsApp.");
    const trigger = state.qv && state.qv.triggerEl;
    state.qv = null;
    if (trigger && document.body.contains(trigger)) trigger.focus();
  }

  function showNotFoundNotice() {
    showToast("That product could not be found.");
  }

  function renderQuickView() {
    const { product } = state.qv;
    const body = document.getElementById("quickview-body");
    const gallery = [product.image, ...(product.gallery || [])].filter(Boolean);
    const selectedPrice = getSelectedPrice(product);
    const price = selectedPrice !== null ? selectedPrice : minPrice(product);
    const priceLabel = selectedPrice !== null ? formatNaira(price) : price !== null ? "from " + formatNaira(price) : "";

    const galleryHtml = `
      <div class="quickview-gallery-main">${lazyImgHtml(gallery[0], product.name, 640)}</div>
      ${
        gallery.length > 1
          ? `<div class="quickview-thumbs">${gallery
              .map(
                (g, i) =>
                  `<button type="button" class="quickview-thumb" data-thumb="${i}" aria-current="${i === 0 ? "true" : "false"}">${lazyImgHtml(g, product.name, 100)}</button>`
              )
              .join("")}</div>`
          : ""
      }`;

    body.innerHTML = `
      ${galleryHtml}
      <h2 class="quickview-name" id="qv-name">${escapeHtml(product.name)}</h2>
      ${product.regionNote ? `<div class="quickview-region">${escapeHtml(product.regionNote)}</div>` : ""}
      <p class="quickview-desc">${escapeHtml(product.description)}</p>
      ${!product.inStock ? `<p class="field-error" style="margin-bottom:16px;">Currently sold out.</p>` : ""}
      ${renderFormSelector(product)}
      ${renderWeightSelector(product)}
      <div class="selector-group">
        <span class="selector-label" id="qty-label">Quantity</span>
        <div class="qty-stepper" role="group" aria-labelledby="qty-label">
          <button type="button" data-qty-dec aria-label="Decrease quantity">−</button>
          <input type="text" inputmode="numeric" id="qty-input" value="${state.qv.qty}" readonly>
          <button type="button" data-qty-inc aria-label="Increase quantity">+</button>
        </div>
      </div>
      <p class="addtocart-prompt" id="addtocart-prompt" ${isSelectionComplete(product) ? "hidden" : ""}>
        ${product.forms.length > 1 ? "Choose a form and weight to continue." : "Choose a weight to continue."}
      </p>
      <div class="quickview-sticky-cta">
        <button type="button" class="btn btn-accent btn-block" id="add-to-cart-btn" ${!product.inStock || !isSelectionComplete(product) ? "disabled" : ""}>
          Add to cart${priceLabel ? " — " + priceLabel : ""}
        </button>
        <button type="button" class="btn btn-text btn-block" id="continue-shopping-btn">← Continue shopping</button>
      </div>
      <div class="sr-only" aria-live="polite" id="qv-live-region"></div>
    `;

    initLazyImages(body);
    wireQuickViewEvents(product, gallery);
  }

  function renderFormSelector(product) {
    if (product.forms.length <= 1) return "";
    return `
      <div class="selector-group">
        <span class="selector-label" id="form-label">Form</span>
        <div class="chip-row" role="group" aria-labelledby="form-label">
          ${product.forms
            .map(
              (f, i) =>
                `<button type="button" class="chip" data-form-chip="${i}" aria-pressed="${state.qv.formIndex === i}">${escapeHtml(f.formLabel)}</button>`
            )
            .join("")}
        </div>
      </div>`;
  }

  function renderWeightSelector(product) {
    const formIndex = state.qv.formIndex;
    if (formIndex === null) {
      if (product.forms.length > 1) return "";
      // single form, fall through
    }
    const form = formIndex !== null ? product.forms[formIndex] : product.forms[0];
    return `
      <div class="selector-group">
        <span class="selector-label" id="weight-label">Weight</span>
        <div class="chip-row" role="group" aria-labelledby="weight-label">
          ${form.weights
            .map(
              (w, i) =>
                `<button type="button" class="chip" data-weight-chip="${i}" aria-pressed="${state.qv.weightIndex === i}">${escapeHtml(w.label)} — ${formatNaira(w.price)}</button>`
            )
            .join("")}
        </div>
      </div>`;
  }

  function isSelectionComplete(product) {
    if (product.forms.length > 1) return state.qv.formIndex !== null && state.qv.weightIndex !== null;
    return state.qv.weightIndex !== null;
  }

  function getSelectedPrice(product) {
    if (!isSelectionComplete(product)) return null;
    const formIndex = product.forms.length > 1 ? state.qv.formIndex : 0;
    const weight = product.forms[formIndex].weights[state.qv.weightIndex];
    return weight ? weight.price : null;
  }

  function wireQuickViewEvents(product, gallery) {
    const body = document.getElementById("quickview-body");

    body.querySelectorAll("[data-thumb]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.thumb);
        const main = body.querySelector(".quickview-gallery-main");
        main.innerHTML = lazyImgHtml(gallery[i], product.name, 640);
        initLazyImages(main);
        body.querySelectorAll("[data-thumb]").forEach((t) => t.setAttribute("aria-current", "false"));
        btn.setAttribute("aria-current", "true");
      });
    });

    body.querySelectorAll("[data-form-chip]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.qv.formIndex = Number(btn.dataset.formChip);
        state.qv.weightIndex = null;
        renderQuickView();
        const live = document.getElementById("qv-live-region");
        if (live) live.textContent = `Weight options updated for ${product.forms[state.qv.formIndex].formLabel}`;
      });
    });

    body.querySelectorAll("[data-weight-chip]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.qv.weightIndex = Number(btn.dataset.weightChip);
        renderQuickView();
      });
    });

    const decBtn = body.querySelector("[data-qty-dec]");
    const incBtn = body.querySelector("[data-qty-inc]");
    if (decBtn) decBtn.addEventListener("click", () => { state.qv.qty = Math.max(1, state.qv.qty - 1); document.getElementById("qty-input").value = state.qv.qty; });
    if (incBtn) incBtn.addEventListener("click", () => { state.qv.qty = Math.min(99, state.qv.qty + 1); document.getElementById("qty-input").value = state.qv.qty; });

    const addBtn = body.querySelector("#add-to-cart-btn");
    if (addBtn) addBtn.addEventListener("click", () => addCurrentSelectionToCart(product));

    const continueBtn = body.querySelector("#continue-shopping-btn");
    if (continueBtn) {
      continueBtn.addEventListener("click", () => {
        if (window.DanidaRouter) window.DanidaRouter.closeProduct();
      });
    }
  }

  function addCurrentSelectionToCart(product) {
    const formIndex = product.forms.length > 1 ? state.qv.formIndex : 0;
    const form = product.forms[formIndex];
    const weight = form.weights[state.qv.weightIndex];

    const existing = state.cart.find(
      (item) => item.productId === product.id && item.formLabel === form.formLabel && item.weightLabel === weight.label
    );
    if (existing) {
      existing.qty += state.qv.qty;
    } else {
      state.cart.push({
        productId: product.id,
        name: product.name,
        formLabel: form.formLabel,
        weightLabel: weight.label,
        unitPrice: weight.price,
        qty: state.qv.qty,
        image: product.image
      });
    }
    saveCart();
    updateCartCount();
    showToast("Added to cart");
  }

  // ---------------------------------------------------------------------
  // Cart drawer
  // ---------------------------------------------------------------------

  function updateCartCount() {
    const count = state.cart.reduce((s, i) => s + i.qty, 0);
    const badge = document.getElementById("cart-count");
    if (count > 0) {
      badge.hidden = false;
      badge.textContent = String(count);
    } else {
      badge.hidden = true;
    }
  }

  function renderCart() {
    const itemsWrap = document.getElementById("cart-items");
    const checkoutBtn = document.getElementById("whatsapp-checkout-btn");

    if (state.cart.length === 0) {
      itemsWrap.innerHTML = `<div class="cart-empty">Your cart is empty.</div>`;
      checkoutBtn.disabled = true;
    } else {
      itemsWrap.innerHTML = state.cart
        .map(
          (item, i) => `
        <div class="cart-item">
          <div class="cart-item-img">${lazyImgHtml(item.image, item.name, 120)}</div>
          <div class="cart-item-info">
            <div class="cart-item-name">${escapeHtml(item.name)}</div>
            <div class="cart-item-variant">${escapeHtml(item.formLabel)}, ${escapeHtml(item.weightLabel)}</div>
            <div class="cart-item-qty">Qty ${item.qty}</div>
          </div>
          <div class="cart-item-price">${formatNaira(item.unitPrice * item.qty)}</div>
          <button type="button" class="cart-item-remove" data-remove-cart-item="${i}" aria-label="Remove ${escapeHtml(item.name)} from cart">✕</button>
        </div>`
        )
        .join("");
      initLazyImages(itemsWrap);
      checkoutBtn.disabled = false;

      itemsWrap.querySelectorAll("[data-remove-cart-item]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.cart.splice(Number(btn.dataset.removeCartItem), 1);
          saveCart();
          updateCartCount();
          renderCart();
        });
      });
    }

    const subtotal = state.cart.reduce((s, i) => s + i.unitPrice * i.qty, 0);
    document.getElementById("cart-subtotal").textContent = formatNaira(subtotal);
  }

  function openCart() {
    renderCart();
    document.getElementById("cart-overlay").setAttribute("open", "");
    document.body.style.overflow = "hidden";
  }

  function closeCart() {
    document.getElementById("cart-overlay").removeAttribute("open");
    document.body.style.overflow = "";
  }

  // ---------------------------------------------------------------------
  // WhatsApp checkout
  // ---------------------------------------------------------------------

  function buildWhatsAppUrl() {
    const total = state.cart.reduce((s, i) => s + i.unitPrice * i.qty, 0);
    const fullLines = state.cart.map(
      (i) => `• ${i.name} — ${i.formLabel}, ${i.weightLabel} ×${i.qty} — ${formatNaira(i.unitPrice * i.qty)}`
    );
    let message = `Hello Danida Organics 🌿 I'd like to order:\n${fullLines.join("\n")}\nTotal: ${formatNaira(total)}\n(sent from danida-organics)`;
    let encoded = encodeURIComponent(message);

    if (encoded.length > WA_SAFE_LENGTH) {
      const summaryLines = state.cart.map((i) => `• ${i.name} ×${i.qty}`);
      message = `Hello Danida Organics 🌿 I'd like to order:\n${summaryLines.join("\n")}\nTotal: ${formatNaira(total)}\nFull breakdown to follow in chat.\n(sent from danida-organics)`;
      encoded = encodeURIComponent(message);
    }

    return `https://wa.me/${config.whatsapp.number}?text=${encoded}`;
  }

  // ---------------------------------------------------------------------
  // Content modal (About / FAQ / Testimonials / Freshness / Contact)
  //
  // These sections used to live inline on the homepage; they're now opened
  // on demand from the header menu so the homepage stays to Hero + Shop.
  // ---------------------------------------------------------------------

  const FAQ_ITEMS = [
    {
      q: "How should I store what I order?",
      a: "Most powders and cut herbs keep best in an airtight container, away from direct light and heat. Whole roots, barks and seeds generally last longer than powdered forms — grind or use powders sooner rather than later for the best flavour and potency."
    },
    {
      q: "Are these products food-grade or for wellness use?",
      a: "It varies by product — some items in our range are culinary (spices, teas), others are traditionally used for wellness (Ayurvedic, Chinese and Western herbs). Each product's description notes its traditional or common use. If you're unsure how a specific item is meant to be used, ask us on WhatsApp before ordering."
    },
    {
      q: "How does ordering on WhatsApp work?",
      a: 'Add items to your cart, then tap "Order on WhatsApp." It opens a pre-filled message listing everything in your cart — form, weight, quantity and total — straight to our WhatsApp. We\'ll confirm availability, delivery and payment with you there.'
    },
    {
      q: "Do you deliver, and how much does it cost?",
      a: "Yes — delivery is arranged directly over WhatsApp once we know your location, since cost depends on where you are. We'll confirm the delivery fee and timeline before your order is finalised."
    }
  ];

  const CONTENT_SECTIONS = {
    about: {
      title: "Hello, and welcome",
      html: () => `
        <div class="about-us-inner">
          <p>We're so glad you're here. At Danida Organics, we believe that what you bring into your kitchen and your daily rituals shapes how you feel, move, and carry yourself through the world — and that healthy, graceful living rarely needs anything complicated.</p>
          <p>For generations, herbal traditions across the world — Ayurvedic, Chinese, West African and beyond — have leaned on roots, barks, seeds, and leaves as everyday companions, not trends. A warm tea to wind down with. A spice that turns a simple meal into something nourishing. A root passed down from a grandmother who swore by it.</p>
          <p>We don't farm these herbs ourselves — we curate them. We spend our time seeking out quality, consistency, and trusted suppliers, so that everything in our catalogue arrives the way it should: fresh, honestly described, and worth your time. Healthy living, to us, starts with what's simple, well-sourced, and time-tested.</p>
          <p>Take your time exploring — and if you're ever unsure what something is traditionally used for, just ask us on WhatsApp. We're always happy to talk herbs.</p>
        </div>`
    },
    faq: {
      title: "Frequently asked questions",
      html: () => `
        <div id="modal-faq-list">
          ${FAQ_ITEMS.map(
            (item) => `
            <div class="faq-item">
              <button class="faq-question" aria-expanded="false">
                ${escapeHtml(item.q)}
                <svg class="faq-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="faq-answer">${escapeHtml(item.a)}</div>
            </div>`
          ).join("")}
        </div>`,
      afterRender: (body) => {
        body.querySelectorAll(".faq-item").forEach((item) => {
          const btn = item.querySelector(".faq-question");
          btn.addEventListener("click", () => {
            const isOpen = item.hasAttribute("open");
            item.toggleAttribute("open", !isOpen);
            btn.setAttribute("aria-expanded", String(!isOpen));
          });
        });
      }
    },
    testimonials: {
      title: "What people are saying",
      html: () => {
        const quotes = config.testimonials || [];
        if (quotes.length >= 2) {
          return `<div class="testimonials-grid">${quotes
            .map(
              (t) => `
            <div class="testimonial-card">
              <p class="testimonial-quote">"${escapeHtml(t.quote)}"</p>
              <p class="testimonial-name">— ${escapeHtml(t.name)}</p>
            </div>`
            )
            .join("")}</div>`;
        }
        return `<div class="testimonials-grid"><div class="testimonial-card testimonial-placeholder">More stories coming soon.</div></div>`;
      }
    },
    freshness: {
      title: "Freshness, storage & delivery",
      html: () => `
        <div class="freshness-grid">
          <div class="freshness-item">
            <h3>Powders &amp; ground spices</h3>
            <p>Store airtight, away from light and heat, and use within a few months for the best flavour.</p>
          </div>
          <div class="freshness-item">
            <h3>Whole roots, barks &amp; seeds</h3>
            <p>Keep in a cool, dry place. Whole forms generally hold their potency longer than powdered ones.</p>
          </div>
          <div class="freshness-item">
            <h3>Delivery</h3>
            <p>Every order is confirmed and arranged over WhatsApp, with delivery cost and timing agreed before checkout.</p>
          </div>
        </div>`
    },
    contact: {
      title: "Contact us",
      html: () => `
        <p class="contact-intro">Questions about a herb, an order, or anything else? We'd love to hear from you.</p>
        <div class="contact-links">
          <a href="https://wa.me/${config.whatsapp.number}" class="btn btn-ink" target="_blank" rel="noopener">Message us on WhatsApp</a>
          <a href="${config.instagram.url}" class="btn btn-outline" target="_blank" rel="noopener">Follow on Instagram</a>
        </div>
        <p class="contact-note">We typically reply within a few hours during business days.</p>`
    }
  };

  function openContentModal(key) {
    const section = CONTENT_SECTIONS[key];
    if (!section) return;
    document.getElementById("content-modal-title").textContent = section.title;
    const body = document.getElementById("content-modal-body");
    body.innerHTML = section.html();
    if (section.afterRender) section.afterRender(body);
    document.getElementById("content-modal").setAttribute("open", "");
    document.body.style.overflow = "hidden";
    document.getElementById("content-modal-close").focus();
  }

  function closeContentModal() {
    const modal = document.getElementById("content-modal");
    const wasOpen = modal.hasAttribute("open");
    modal.removeAttribute("open");
    document.body.style.overflow = "";
    if (wasOpen) document.getElementById("menu-toggle").focus();
  }

  // ---------------------------------------------------------------------
  // Global event wiring
  // ---------------------------------------------------------------------

  function wireGlobalEvents() {
    document.getElementById("search-toggle").addEventListener("click", () => {
      document.getElementById("finder").scrollIntoView({ behavior: "smooth" });
      document.getElementById("search-input").focus();
    });

    document.getElementById("cart-toggle").addEventListener("click", openCart);
    document.querySelectorAll("[data-close-cart]").forEach((el) => el.addEventListener("click", closeCart));
    document.getElementById("cart-continue-shopping-btn").addEventListener("click", closeCart);
    document.getElementById("whatsapp-checkout-btn").addEventListener("click", () => {
      if (state.cart.length === 0) return;
      window.open(buildWhatsAppUrl(), "_blank", "noopener");
    });

    document.querySelectorAll("[data-close-quickview]").forEach((el) =>
      el.addEventListener("click", () => {
        if (window.DanidaRouter) window.DanidaRouter.closeProduct();
      })
    );

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (document.getElementById("quickview-overlay").hasAttribute("open")) {
          if (window.DanidaRouter) window.DanidaRouter.closeProduct();
        } else if (document.getElementById("cart-overlay").hasAttribute("open")) {
          closeCart();
        } else if (document.getElementById("filter-sheet").hasAttribute("open")) {
          closeFilterSheet();
        } else if (document.getElementById("content-modal").hasAttribute("open")) {
          closeContentModal();
        }
        return;
      }
      if (e.key === "Tab") {
        const openPanel = [
          ["quickview-overlay", ".quickview-panel"],
          ["cart-overlay", ".cart-panel"],
          ["filter-sheet", ".filter-sheet-panel"],
          ["content-modal", ".content-modal-panel"]
        ].find(([overlayId]) => document.getElementById(overlayId).hasAttribute("open"));
        if (openPanel) trapFocus(document.querySelector(openPanel[1]), e);
      }
    });

    const debouncedSearch = debounce((value) => {
      state.filters.search = value;
      syncFilterControls();
      applyFiltersAndRender();
    }, 250);

    ["search-input", "sheet-search-input"].forEach((id) => {
      document.getElementById(id).addEventListener("input", (e) => debouncedSearch(e.target.value));
    });

    ["category-select", "sheet-category-select"].forEach((id) => {
      document.getElementById(id).addEventListener("change", (e) => {
        state.filters.category = e.target.value;
        syncFilterControls();
        applyFiltersAndRender();
        pushFilterState();
      });
    });

    ["goal-select", "sheet-goal-select"].forEach((id) => {
      document.getElementById(id).addEventListener("change", (e) => {
        state.filters.goal = e.target.value;
        syncFilterControls();
        applyFiltersAndRender();
        pushFilterState();
      });
    });

    document.getElementById("filters-btn").addEventListener("click", openFilterSheet);
    document.querySelectorAll("[data-close-filter-sheet]").forEach((el) => el.addEventListener("click", closeFilterSheet));

    document.getElementById("load-more-btn").addEventListener("click", () => {
      state.page += 1;
      renderGrid();
    });

    document.querySelector("[data-nav-home]").addEventListener("click", (e) => {
      e.preventDefault();
      if (window.DanidaRouter) window.DanidaRouter.navigate("/");
    });

    const waLink = document.getElementById("footer-whatsapp-link");
    waLink.href = `https://wa.me/${config.whatsapp.number}`;

    wireMainMenu();
    document.querySelectorAll("[data-close-content-modal]").forEach((el) => el.addEventListener("click", closeContentModal));
  }

  function wireMainMenu() {
    const toggle = document.getElementById("menu-toggle");
    const menu = document.getElementById("main-menu");
    if (!toggle || !menu) return;

    function openMenu() {
      menu.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
    }
    function closeMenu() {
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    }

    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu.hidden) openMenu();
      else closeMenu();
    });

    menu.querySelectorAll("[data-scroll-link]").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        closeMenu();
        const target = document.querySelector(link.getAttribute("href"));
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    menu.querySelectorAll("[data-modal-link]").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        closeMenu();
        openContentModal(link.dataset.modalLink);
      });
    });

    document.addEventListener("click", (e) => {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== toggle) closeMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden) {
        closeMenu();
        toggle.focus();
      }
    });
  }

  function openFilterSheet() {
    document.getElementById("filter-sheet").setAttribute("open", "");
    document.body.style.overflow = "hidden";
  }
  function closeFilterSheet() {
    document.getElementById("filter-sheet").removeAttribute("open");
    document.body.style.overflow = "";
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  function init() {
    wireGlobalEvents();
    updateCartCount();
    loadBin();
  }

  document.addEventListener("DOMContentLoaded", init);

  window.DanidaApp = {
    ready,
    getProductBySlug,
    openQuickViewBySlug,
    closeQuickView,
    showNotFoundNotice,
    setFiltersFromQuery(query) {
      state.filters.category = query.category && (state.bin ? state.bin.categories.includes(query.category) : true) ? query.category : state.filters.category;
      state.filters.goal = query.goal && (state.bin ? state.bin.healthGoals.includes(query.goal) : true) ? query.goal : state.filters.goal;
      if (state.bin) {
        syncFilterControls();
        applyFiltersAndRender();
      }
    }
  };
})();
