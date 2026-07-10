// Admin logic: auth/session/lockout, product CRUD (incl. forms/weights repeater),
// category/health-goal managers, Cloudinary upload, save, export/backup.

(function () {
  "use strict";

  const config = window.DANIDA_CONFIG;
  const SESSION_KEY = "danida_admin_session";
  const DRAFT_KEY = "danida_admin_draft";
  const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  const state = {
    session: null,
    bin: null,
    formDraft: null // { product, editingIndex, mode, slugManuallyEdited }
  };

  let lockoutInterval = null;

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

  function slugify(str) {
    return String(str || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
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

  function setSaveStatus(text) {
    const el = document.getElementById("save-status");
    el.textContent = text;
    if (text === "Saved just now") {
      setTimeout(() => { if (el.textContent === "Saved just now") el.textContent = ""; }, 2500);
    }
  }

  function findIndexById(id) {
    return state.bin.products.findIndex((p) => p.id === id);
  }

  // ---------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------

  function saveSession(token, expiresAt) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt }));
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s.token || !s.expiresAt || Date.now() > s.expiresAt) return null;
      return s;
    } catch {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    state.session = null;
  }

  function setLoginMessage(text, tone = "error") {
    const el = document.getElementById("admin-login-error");
    el.textContent = text;
    el.style.color = tone === "neutral" ? "var(--ink-muted)" : "#A83A3A";
  }

  // ---------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------

  async function handleLoginSubmit(e) {
    e.preventDefault();
    const passwordInput = document.getElementById("admin-password");
    const submitBtn = document.getElementById("admin-login-submit");
    setLoginMessage("");
    submitBtn.disabled = true;
    submitBtn.textContent = "Logging in…";

    try {
      const res = await fetch(config.functions.products, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", password: passwordInput.value })
      });
      const body = await res.json().catch(() => ({}));

      if (res.ok) {
        saveSession(body.token, body.expiresAt);
        state.session = { token: body.token, expiresAt: body.expiresAt };
        passwordInput.value = "";
        await enterAdminShell();
      } else if (res.status === 429) {
        startLockoutCountdown(body.retryAfter || 60);
      } else {
        setLoginMessage("Incorrect password.");
        passwordInput.focus();
        passwordInput.select();
      }
    } catch {
      setLoginMessage("Network error — try again.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Log in";
    }
  }

  function startLockoutCountdown(seconds) {
    const passwordInput = document.getElementById("admin-password");
    const submitBtn = document.getElementById("admin-login-submit");
    passwordInput.disabled = true;
    submitBtn.disabled = true;
    let remaining = seconds;
    clearInterval(lockoutInterval);

    function tick() {
      setLoginMessage(`Too many attempts. Try again in ${remaining}s`, "neutral");
      if (remaining <= 0) {
        clearInterval(lockoutInterval);
        passwordInput.disabled = false;
        submitBtn.disabled = false;
        setLoginMessage("");
        return;
      }
      remaining--;
    }
    tick();
    lockoutInterval = setInterval(tick, 1000);
  }

  function handleLogout() {
    clearSession();
    document.getElementById("admin-shell").hidden = true;
    document.getElementById("admin-login-screen").hidden = false;
    document.getElementById("admin-password").value = "";
  }

  function showLoginScreen(message) {
    document.getElementById("admin-shell").hidden = true;
    document.getElementById("admin-login-screen").hidden = false;
    setLoginMessage(message || "", "neutral");
  }

  // ---------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------

  function setAdminControlsEnabled(enabled) {
    ["add-product-btn", "export-btn", "add-category-btn", "add-goal-btn"].forEach((id) => {
      document.getElementById(id).disabled = !enabled;
    });
  }

  async function enterAdminShell() {
    document.getElementById("admin-login-screen").hidden = true;
    document.getElementById("admin-shell").hidden = false;
    setAdminControlsEnabled(false);
    await loadBinForAdmin();
    setAdminControlsEnabled(true);
    checkDraftBanner();
  }

  async function loadBinForAdmin() {
    try {
      const res = await fetch(config.functions.products);
      if (!res.ok) throw new Error("fetch failed");
      state.bin = await res.json();
    } catch {
      state.bin = window.DANIDA_SEED || { products: [], categories: [], healthGoals: [] };
      showToast("Could not load the latest catalogue — showing last known data.");
    }
    renderProductsTable();
    renderTagManagerTable("categories");
    renderTagManagerTable("healthGoals");
    renderCatalogueSize();
  }

  // ---------------------------------------------------------------------
  // Save gateway
  // ---------------------------------------------------------------------

  async function saveBinToServer(patch) {
    const payload = Object.assign(
      { products: state.bin.products, categories: state.bin.categories, healthGoals: state.bin.healthGoals },
      patch
    );

    setSaveStatus("Saving…");
    try {
      const res = await fetch(config.functions.products, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", token: state.session.token, data: payload })
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 401) {
        showLoginScreen("Please log in again.");
        setSaveStatus("");
        return { ok: false, reason: "session" };
      }
      if (res.status === 422) {
        setSaveStatus("");
        showToast("Some fields need attention.");
        return { ok: false, reason: "validation", body };
      }
      if (!res.ok) {
        setSaveStatus("");
        showToast("Save failed — your changes are kept locally. Try again.");
        return { ok: false, reason: "network" };
      }

      state.bin = body;
      setSaveStatus("Saved just now");
      return { ok: true };
    } catch {
      setSaveStatus("");
      showToast("Save failed — check your connection and try again.");
      return { ok: false, reason: "network" };
    }
  }

  // ---------------------------------------------------------------------
  // Cloudinary upload
  // ---------------------------------------------------------------------

  function uploadToCloudinary(file, onProgress) {
    return new Promise((resolve, reject) => {
      const url = `https://api.cloudinary.com/v1_1/${config.cloudinary.cloudName}/image/upload`;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", config.cloudinary.uploadPreset);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText).public_id);
          } catch {
            reject(new Error("Bad response from Cloudinary"));
          }
        } else {
          reject(new Error("Upload failed"));
        }
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(formData);
    });
  }

  // ---------------------------------------------------------------------
  // Draft safety
  // ---------------------------------------------------------------------

  function saveDraftDebounced() {
    clearTimeout(saveDraftDebounced._t);
    saveDraftDebounced._t = setTimeout(saveDraftNow, 400);
  }

  function saveDraftNow() {
    if (!state.formDraft) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state.formDraft));
    } catch {
      /* non-fatal */
    }
  }

  function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function checkDraftBanner() {
    const draft = loadDraft();
    const banner = document.getElementById("draft-banner");
    if (!draft) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.innerHTML = `
      <div class="repeater-block" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <span>You have an unsaved product draft ("${escapeHtml(draft.product.name || "untitled")}").</span>
        <span style="display:flex;gap:8px;">
          <button type="button" class="btn btn-accent" id="resume-draft-btn">Resume</button>
          <button type="button" class="btn btn-text" id="discard-draft-btn">Discard</button>
        </span>
      </div>`;
    document.getElementById("resume-draft-btn").addEventListener("click", () => {
      state.formDraft = draft;
      showProductFormDialog(draft.mode === "edit" ? "Edit product" : draft.mode === "duplicate" ? "Duplicate product" : "Add product");
      banner.hidden = true;
    });
    document.getElementById("discard-draft-btn").addEventListener("click", () => {
      clearDraft();
      banner.hidden = true;
    });
  }

  // ---------------------------------------------------------------------
  // Products table
  // ---------------------------------------------------------------------

  function renderProductsTable() {
    const tbody = document.getElementById("products-tbody");
    const sorted = state.bin.products.slice().sort((a, b) => (a.order || 0) - (b.order || 0));

    if (sorted.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--ink-muted);">No products yet. Click "Add product" to create your first one.</td></tr>`;
      return;
    }

    tbody.innerHTML = sorted
      .map(
        (p, i) => `
      <tr>
        <td>
          <button type="button" class="btn-icon" data-reorder="${i}:-1" aria-label="Move ${escapeHtml(p.name)} up" ${i === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="btn-icon" data-reorder="${i}:1" aria-label="Move ${escapeHtml(p.name)} down" ${i === sorted.length - 1 ? "disabled" : ""}>↓</button>
        </td>
        <td>${escapeHtml(p.name)}</td>
        <td>${(p.categories || []).map(escapeHtml).join(", ")}</td>
        <td>${minPrice(p) !== null ? formatNaira(minPrice(p)) : "—"}</td>
        <td>${p.inStock ? "In stock" : "Sold out"}</td>
        <td class="admin-row-actions">
          <button type="button" class="btn-text" data-edit-product="${escapeHtml(p.id)}">Edit</button>
          <button type="button" class="btn-text" data-duplicate-product="${escapeHtml(p.id)}">Duplicate</button>
          <button type="button" class="btn-text" data-delete-product="${escapeHtml(p.id)}">Delete</button>
        </td>
      </tr>`
      )
      .join("");

    tbody.querySelectorAll("[data-reorder]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [idx, dir] = btn.dataset.reorder.split(":").map(Number);
        handleReorder(idx, dir);
      });
    });
    tbody.querySelectorAll("[data-edit-product]").forEach((btn) =>
      btn.addEventListener("click", () => openEditProductForm(findIndexById(btn.dataset.editProduct)))
    );
    tbody.querySelectorAll("[data-duplicate-product]").forEach((btn) =>
      btn.addEventListener("click", () => openDuplicateProductForm(findIndexById(btn.dataset.duplicateProduct)))
    );
    tbody.querySelectorAll("[data-delete-product]").forEach((btn) =>
      btn.addEventListener("click", () => handleDeleteProduct(findIndexById(btn.dataset.deleteProduct)))
    );
  }

  async function handleReorder(sortedIndex, direction) {
    const sorted = state.bin.products.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const otherIndex = sortedIndex + direction;
    if (otherIndex < 0 || otherIndex >= sorted.length) return;
    const a = sorted[sortedIndex];
    const b = sorted[otherIndex];
    const tmp = a.order;
    a.order = b.order;
    b.order = tmp;
    const result = await saveBinToServer({ products: state.bin.products });
    if (result.ok) renderProductsTable();
  }

  async function handleDeleteProduct(index) {
    const product = state.bin.products[index];
    const ok = await confirmDialog(
      "Delete product?",
      `Delete "${product.name}"? This cannot be undone from here — use Export backup first if you're unsure.`,
      "Delete"
    );
    if (!ok) return;
    const updatedProducts = state.bin.products.filter((_, i) => i !== index);
    const result = await saveBinToServer({ products: updatedProducts });
    if (result.ok) {
      renderProductsTable();
      renderCatalogueSize();
      showToast("Product deleted");
    }
  }

  function openDuplicateProductForm(index) {
    const original = state.bin.products[index];
    const clone = JSON.parse(JSON.stringify(original));
    let base = `${clone.slug}-copy`;
    let candidate = base;
    let n = 2;
    while (state.bin.products.some((p) => p.slug === candidate)) {
      candidate = `${base}-${n}`;
      n++;
    }
    clone.slug = candidate;
    clone.id = candidate;
    clone.order = Math.max(0, ...state.bin.products.map((p) => p.order || 0)) + 1;

    state.formDraft = { product: clone, editingIndex: null, mode: "duplicate", slugManuallyEdited: true };
    showProductFormDialog("Duplicate product (unsaved copy)");
  }

  // ---------------------------------------------------------------------
  // Product form
  // ---------------------------------------------------------------------

  function blankProduct() {
    return {
      id: "",
      slug: "",
      name: "",
      categories: [],
      healthGoals: [],
      regionNote: "",
      description: "",
      forms: [],
      image: "",
      gallery: [],
      inStock: true,
      order: Math.max(0, ...state.bin.products.map((p) => p.order || 0)) + 1
    };
  }

  function openAddProductForm() {
    state.formDraft = { product: blankProduct(), editingIndex: null, mode: "add", slugManuallyEdited: false };
    showProductFormDialog("Add product");
  }

  function openEditProductForm(index) {
    const product = JSON.parse(JSON.stringify(state.bin.products[index]));
    state.formDraft = { product, editingIndex: index, mode: "edit", slugManuallyEdited: true, originalSlug: product.slug };
    showProductFormDialog("Edit product");
  }

  function showProductFormDialog(title) {
    document.getElementById("product-form-title").textContent = title;
    renderProductForm();
    document.getElementById("product-form-dialog").setAttribute("open", "");
    const first = document.getElementById("product-form").querySelector("input,select,textarea,button");
    if (first) first.focus();
  }

  function closeProductForm() {
    document.getElementById("product-form-dialog").removeAttribute("open");
    state.formDraft = null;
  }

  function multiselectHtml(fieldName, allOptions, selected) {
    return `<div class="multiselect-list" data-multiselect="${fieldName}">${allOptions
      .map(
        (opt) =>
          `<button type="button" class="multiselect-option" data-value="${escapeHtml(opt)}" aria-pressed="${selected.includes(opt)}">${escapeHtml(opt)}</button>`
      )
      .join("")}</div>`;
  }

  function galleryHtml(gallery) {
    return (gallery || [])
      .map(
        (g, i) => `
      <div style="position:relative;">
        <div class="upload-preview" style="width:70px;height:70px;"><img src="${cldUrl(g, 140)}" alt=""></div>
        <button type="button" class="btn-icon" data-remove-gallery="${i}" aria-label="Remove gallery image" style="position:absolute;top:-8px;right:-8px;background:var(--surface);border-radius:50%;border:1px solid var(--border);">✕</button>
      </div>`
      )
      .join("");
  }

  function formsRepeaterHtml(forms) {
    const blocks = (forms || [])
      .map(
        (f, fi) => `
      <div class="repeater-block" data-form-index="${fi}">
        <div class="repeater-row">
          <div class="field">
            <label for="form-label-${fi}">Form label</label>
            <input type="text" id="form-label-${fi}" data-form-label="${fi}" value="${escapeHtml(f.formLabel)}" placeholder="e.g. Powder">
          </div>
          <button type="button" class="btn btn-outline" data-remove-form="${fi}">Remove form</button>
        </div>
        <div data-weights-wrap="${fi}">
          ${(f.weights || [])
            .map(
              (w, wi) => `
            <div class="repeater-row" data-weight-index="${wi}">
              <div class="field">
                <label for="weight-label-${fi}-${wi}">Weight label</label>
                <input type="text" id="weight-label-${fi}-${wi}" data-weight-label="${fi}:${wi}" value="${escapeHtml(w.label)}" placeholder="e.g. 100g">
              </div>
              <div class="field">
                <label for="weight-price-${fi}-${wi}">Price (₦)</label>
                <input type="number" min="0" step="1" id="weight-price-${fi}-${wi}" data-weight-price="${fi}:${wi}" value="${w.price ?? ""}">
              </div>
              <button type="button" class="btn-icon" data-remove-weight="${fi}:${wi}" aria-label="Remove weight row">✕</button>
            </div>`
            )
            .join("")}
        </div>
        <button type="button" class="btn btn-text" data-add-weight="${fi}">+ Add weight</button>
      </div>`
      )
      .join("");

    const empty = !forms || forms.length === 0 ? `<p class="repeater-empty">No forms yet — add one below.</p>` : "";
    return empty + blocks + `<button type="button" class="btn btn-outline" id="add-form-btn">+ Add form</button>`;
  }

  function renderProductForm() {
    const { product, mode } = state.formDraft;
    const form = document.getElementById("product-form");

    form.innerHTML = `
      <div class="field" data-field="name">
        <label for="pf-name">Product name</label>
        <input type="text" id="pf-name" value="${escapeHtml(product.name)}">
        <p class="field-error" hidden></p>
      </div>
      <div class="field" data-field="slug">
        <label for="pf-slug">Slug (URL)</label>
        <input type="text" id="pf-slug" value="${escapeHtml(product.slug)}">
        <p class="field-help">Used in the product's shareable URL.${mode === "edit" ? " Changing this breaks any links already shared for this product." : ""}</p>
        <p class="field-error" hidden></p>
      </div>
      <div class="field" data-field="categories">
        <label>Categories</label>
        ${multiselectHtml("categories", state.bin.categories, product.categories || [])}
        <p class="field-error" hidden></p>
      </div>
      <div class="field" data-field="healthGoals">
        <label>Health goals</label>
        ${multiselectHtml("healthGoals", state.bin.healthGoals, product.healthGoals || [])}
      </div>
      <div class="field" data-field="regionNote">
        <label for="pf-region">Region note (optional)</label>
        <input type="text" id="pf-region" value="${escapeHtml(product.regionNote || "")}" placeholder="e.g. Grown in Northern Nigeria">
      </div>
      <div class="field" data-field="description">
        <label for="pf-description">Description</label>
        <textarea id="pf-description">${escapeHtml(product.description || "")}</textarea>
        <p class="field-help">Describe flavor, texture, or traditional use. Avoid claims that a product treats, cures, or prevents any condition.</p>
      </div>
      <div class="field" data-field="forms">
        <label>Forms &amp; weights</label>
        <div id="forms-repeater">${formsRepeaterHtml(product.forms)}</div>
        <p class="field-error" hidden></p>
      </div>
      <div class="field" data-field="image">
        <label>Primary image</label>
        <div class="upload-preview" id="image-preview">${product.image ? `<img src="${cldUrl(product.image, 200)}" alt="">` : ""}</div>
        <input type="file" id="image-upload-input" accept="image/jpeg,image/png,image/webp">
        <p class="upload-progress" id="image-upload-progress" hidden></p>
        <p class="upload-error" id="image-upload-error" hidden></p>
        <p class="field-error" hidden></p>
      </div>
      <div class="field" data-field="gallery">
        <label>Gallery images (optional)</label>
        <div id="gallery-list" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">${galleryHtml(product.gallery)}</div>
        <input type="file" id="gallery-upload-input" accept="image/jpeg,image/png,image/webp">
        <p class="upload-progress" id="gallery-upload-progress" hidden></p>
        <p class="upload-error" id="gallery-upload-error" hidden></p>
      </div>
      <div class="field" data-field="inStock">
        <label><input type="checkbox" id="pf-instock" ${product.inStock ? "checked" : ""}> In stock</label>
      </div>
      <div class="confirm-dialog-actions" style="justify-content:flex-end;">
        <button type="button" class="btn btn-outline" data-close-product-form>Cancel</button>
        <button type="submit" class="btn btn-accent">Save product</button>
      </div>
    `;

    wireProductFormEvents();
  }

  function clearFieldError(fieldName) {
    const wrap = document.querySelector(`[data-field="${fieldName}"]`);
    if (!wrap) return;
    wrap.classList.remove("has-error");
    const errEl = wrap.querySelector(".field-error");
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = "";
    }
  }

  function renderFieldErrors(errors) {
    document.querySelectorAll(".field[data-field]").forEach((w) => {
      w.classList.remove("has-error");
      const e = w.querySelector(".field-error");
      if (e) e.hidden = true;
    });
    Object.entries(errors).forEach(([field, message]) => {
      const wrap = document.querySelector(`[data-field="${field}"]`);
      if (!wrap) return;
      wrap.classList.add("has-error");
      const errEl = wrap.querySelector(".field-error");
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = message;
      }
    });
  }

  function focusFirstError(errors) {
    const first = Object.keys(errors)[0];
    const wrap = document.querySelector(`[data-field="${first}"]`);
    if (!wrap) return;
    const focusable = wrap.querySelector("input,select,textarea,button");
    if (focusable) focusable.focus();
    wrap.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function wireProductFormEvents() {
    const { product, mode } = state.formDraft;
    const form = document.getElementById("product-form");

    form.querySelector("#pf-name").addEventListener("input", (e) => {
      product.name = e.target.value;
      if (!state.formDraft.slugManuallyEdited) {
        product.slug = slugify(product.name);
        product.id = product.slug;
        form.querySelector("#pf-slug").value = product.slug;
      }
      clearFieldError("name");
      saveDraftDebounced();
    });

    form.querySelector("#pf-slug").addEventListener("input", (e) => {
      state.formDraft.slugManuallyEdited = true;
      product.slug = slugify(e.target.value);
      product.id = product.slug;
      clearFieldError("slug");
      saveDraftDebounced();
    });

    form.querySelectorAll("[data-multiselect] .multiselect-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        const field = btn.closest("[data-multiselect]").dataset.multiselect;
        const value = btn.dataset.value;
        const arr = product[field] || (product[field] = []);
        const idx = arr.indexOf(value);
        if (idx === -1) arr.push(value);
        else arr.splice(idx, 1);
        btn.setAttribute("aria-pressed", String(idx === -1));
        clearFieldError(field);
        saveDraftDebounced();
      });
    });

    form.querySelector("#pf-region").addEventListener("input", (e) => {
      product.regionNote = e.target.value;
      saveDraftDebounced();
    });
    form.querySelector("#pf-description").addEventListener("input", (e) => {
      product.description = e.target.value;
      saveDraftDebounced();
    });
    form.querySelector("#pf-instock").addEventListener("change", (e) => {
      product.inStock = e.target.checked;
      saveDraftDebounced();
    });

    wireFormsRepeaterEvents();
    wireImageUploadEvents();

    form.querySelectorAll("[data-close-product-form]").forEach((el) => el.addEventListener("click", closeProductForm));
    form.addEventListener("submit", submitProductForm);
  }

  function wireFormsRepeaterEvents() {
    const { product } = state.formDraft;
    const form = document.getElementById("product-form");

    form.querySelectorAll("[data-form-label]").forEach((input) => {
      input.addEventListener("input", (e) => {
        const fi = Number(input.dataset.formLabel);
        product.forms[fi].formLabel = e.target.value;
        saveDraftDebounced();
      });
    });
    form.querySelectorAll("[data-weight-label]").forEach((input) => {
      input.addEventListener("input", (e) => {
        const [fi, wi] = input.dataset.weightLabel.split(":").map(Number);
        product.forms[fi].weights[wi].label = e.target.value;
        saveDraftDebounced();
      });
    });
    form.querySelectorAll("[data-weight-price]").forEach((input) => {
      input.addEventListener("input", (e) => {
        const [fi, wi] = input.dataset.weightPrice.split(":").map(Number);
        product.forms[fi].weights[wi].price = e.target.value === "" ? null : parseInt(e.target.value, 10);
        saveDraftDebounced();
      });
    });
    form.querySelectorAll("[data-remove-weight]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [fi, wi] = btn.dataset.removeWeight.split(":").map(Number);
        product.forms[fi].weights.splice(wi, 1);
        rerenderFormsRepeater();
      });
    });
    form.querySelectorAll("[data-add-weight]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fi = Number(btn.dataset.addWeight);
        product.forms[fi].weights.push({ label: "", price: null });
        rerenderFormsRepeater();
      });
    });
    form.querySelectorAll("[data-remove-form]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fi = Number(btn.dataset.removeForm);
        product.forms.splice(fi, 1);
        rerenderFormsRepeater();
      });
    });
    const addFormBtn = form.querySelector("#add-form-btn");
    if (addFormBtn) {
      addFormBtn.addEventListener("click", () => {
        product.forms.push({ formLabel: "", weights: [{ label: "", price: null }] });
        rerenderFormsRepeater();
      });
    }
  }

  function rerenderFormsRepeater() {
    document.getElementById("forms-repeater").innerHTML = formsRepeaterHtml(state.formDraft.product.forms);
    wireFormsRepeaterEvents();
    clearFieldError("forms");
    saveDraftDebounced();
  }

  function wireImageUploadEvents() {
    const { product } = state.formDraft;
    const form = document.getElementById("product-form");

    const imgInput = form.querySelector("#image-upload-input");
    const imgProgress = form.querySelector("#image-upload-progress");
    const imgError = form.querySelector("#image-upload-error");
    const imgPreview = form.querySelector("#image-preview");

    imgInput.addEventListener("change", async () => {
      const file = imgInput.files[0];
      if (!file) return;
      imgError.hidden = true;
      imgProgress.hidden = false;
      imgProgress.textContent = "Uploading… 0%";
      try {
        const publicId = await uploadToCloudinary(file, (pct) => { imgProgress.textContent = `Uploading… ${pct}%`; });
        product.image = publicId;
        imgProgress.hidden = true;
        imgPreview.innerHTML = `<img src="${cldUrl(publicId, 200)}" alt="">`;
        clearFieldError("image");
        saveDraftDebounced();
      } catch {
        imgProgress.hidden = true;
        imgError.hidden = false;
        imgError.textContent = "Upload failed. Try again.";
      }
    });

    const galInput = form.querySelector("#gallery-upload-input");
    const galProgress = form.querySelector("#gallery-upload-progress");
    const galError = form.querySelector("#gallery-upload-error");

    galInput.addEventListener("change", async () => {
      const file = galInput.files[0];
      if (!file) return;
      galError.hidden = true;
      galProgress.hidden = false;
      galProgress.textContent = "Uploading… 0%";
      try {
        const publicId = await uploadToCloudinary(file, (pct) => { galProgress.textContent = `Uploading… ${pct}%`; });
        product.gallery = product.gallery || [];
        product.gallery.push(publicId);
        galProgress.hidden = true;
        document.getElementById("gallery-list").innerHTML = galleryHtml(product.gallery);
        wireGalleryRemoveEvents();
        saveDraftDebounced();
      } catch {
        galProgress.hidden = true;
        galError.hidden = false;
        galError.textContent = "Upload failed. Try again.";
      }
    });

    wireGalleryRemoveEvents();
  }

  function wireGalleryRemoveEvents() {
    document.querySelectorAll("[data-remove-gallery]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.removeGallery);
        state.formDraft.product.gallery.splice(i, 1);
        document.getElementById("gallery-list").innerHTML = galleryHtml(state.formDraft.product.gallery);
        wireGalleryRemoveEvents();
        saveDraftDebounced();
      });
    });
  }

  function validateProductDraft(p) {
    const errors = {};
    if (!p.name || !p.name.trim()) errors.name = "Name is required.";

    if (!p.slug || !SLUG_RE.test(p.slug)) {
      errors.slug = "Slug is required (lowercase letters, numbers, hyphens only).";
    } else {
      const dup = state.bin.products.some((existing, i) => existing.slug === p.slug && i !== state.formDraft.editingIndex);
      if (dup) errors.slug = "This slug is already used by another product.";
    }

    if (!p.categories || p.categories.length === 0) errors.categories = "Choose at least one category.";

    const formsValid =
      p.forms &&
      p.forms.length > 0 &&
      p.forms.every(
        (f) =>
          f.formLabel &&
          f.formLabel.trim() &&
          f.weights &&
          f.weights.length > 0 &&
          f.weights.every((w) => w.label && w.label.trim() && Number.isInteger(w.price) && w.price >= 0)
      );
    if (!formsValid) errors.forms = "Each form needs a label and at least one weight with a label and a whole-number price.";

    if (!p.image) errors.image = "Upload an image before saving.";

    return errors;
  }

  async function submitProductForm(e) {
    e.preventDefault();
    const { product, editingIndex } = state.formDraft;
    const errors = validateProductDraft(product);
    if (Object.keys(errors).length > 0) {
      renderFieldErrors(errors);
      focusFirstError(errors);
      return;
    }

    const updatedProducts = state.bin.products.slice();
    if (editingIndex !== null) updatedProducts[editingIndex] = product;
    else updatedProducts.push(product);

    const result = await saveBinToServer({ products: updatedProducts });
    if (result.ok) {
      clearDraft();
      closeProductForm();
      renderProductsTable();
      renderCatalogueSize();
      showToast("Product saved");
    } else if (result.reason === "validation" && result.body && result.body.productErrors) {
      const mine = result.body.productErrors.find((pe) => pe.id === product.id);
      if (mine) showToast(`Server rejected: ${mine.fields.join(", ")}`);
    }
  }

  // ---------------------------------------------------------------------
  // Category / health-goal managers
  // ---------------------------------------------------------------------

  function renderTagManagerTable(kind) {
    const tbodyId = kind === "categories" ? "categories-tbody" : "goals-tbody";
    const tbody = document.getElementById(tbodyId);
    const list = state.bin[kind] || [];

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--ink-muted);">None yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = list
      .map((name) => {
        const count = state.bin.products.filter((p) => (kind === "categories" ? p.categories : p.healthGoals || []).includes(name)).length;
        return `<tr data-tag-row="${escapeHtml(name)}">
        <td class="tag-name-cell">${escapeHtml(name)}</td>
        <td>${count}</td>
        <td class="admin-row-actions">
          <button type="button" class="btn-text" data-rename-tag="${escapeHtml(name)}">Rename</button>
          <button type="button" class="btn-text" data-delete-tag="${escapeHtml(name)}">Delete</button>
        </td>
      </tr>`;
      })
      .join("");

    tbody.querySelectorAll("[data-rename-tag]").forEach((btn) => {
      btn.addEventListener("click", () => startInlineRename(kind, btn.dataset.renameTag));
    });
    tbody.querySelectorAll("[data-delete-tag]").forEach((btn) => {
      btn.addEventListener("click", () => handleDeleteTag(kind, btn.dataset.deleteTag));
    });
  }

  function startInlineRename(kind, name) {
    const tbodyId = kind === "categories" ? "categories-tbody" : "goals-tbody";
    const row = document.querySelector(`#${tbodyId} [data-tag-row="${CSS.escape(name)}"]`);
    if (!row) return;
    const cell = row.querySelector(".tag-name-cell");
    cell.innerHTML = `<input type="text" value="${escapeHtml(name)}" style="width:100%;padding:6px;border:1px solid var(--border-strong);border-radius:6px;">`;
    const input = cell.querySelector("input");
    input.focus();
    input.select();

    const actionsCell = row.querySelector(".admin-row-actions");
    actionsCell.innerHTML = `<button type="button" class="btn-text" data-save-rename>Save</button><button type="button" class="btn-text" data-cancel-rename>Cancel</button>`;
    actionsCell.querySelector("[data-save-rename]").addEventListener("click", () => handleRenameTag(kind, name, input.value));
    actionsCell.querySelector("[data-cancel-rename]").addEventListener("click", () => renderTagManagerTable(kind));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleRenameTag(kind, name, input.value);
      }
      if (e.key === "Escape") renderTagManagerTable(kind);
    });
  }

  async function handleRenameTag(kind, oldName, newNameRaw) {
    const newName = newNameRaw.trim();
    if (!newName || newName === oldName) {
      renderTagManagerTable(kind);
      return;
    }
    if (state.bin[kind].includes(newName)) {
      showToast("That name is already used.");
      return;
    }
    const field = kind === "categories" ? "categories" : "healthGoals";
    const updatedList = state.bin[kind].map((n) => (n === oldName ? newName : n));
    const updatedProducts = state.bin.products.map((p) => {
      if (!p[field] || !p[field].includes(oldName)) return p;
      return Object.assign({}, p, { [field]: p[field].map((n) => (n === oldName ? newName : n)) });
    });
    const patch = { products: updatedProducts };
    patch[kind] = updatedList;
    const result = await saveBinToServer(patch);
    if (result.ok) {
      renderTagManagerTable(kind);
      renderProductsTable();
      showToast("Renamed");
    }
  }

  async function handleDeleteTag(kind, name) {
    const field = kind === "categories" ? "categories" : "healthGoals";
    const count = state.bin.products.filter((p) => (p[field] || []).includes(name)).length;
    const label = kind === "categories" ? "category" : "health goal";

    const body =
      count > 0
        ? `"${name}" is used by ${count} product${count === 1 ? "" : "s"}. Deleting it removes it from the filter list; those products keep the tag internally until re-tagged, but it won't match any active filter.`
        : `Delete ${label} "${name}"?`;
    const firstOk = await confirmDialog(`Delete ${label}?`, body, count > 0 ? "Continue" : "Delete");
    if (!firstOk) return;

    if (count > 0) {
      const secondOk = await confirmDialog(
        "Confirm deletion",
        `This is your final confirmation: delete "${name}", used by ${count} product${count === 1 ? "" : "s"}?`,
        "Delete"
      );
      if (!secondOk) return;
    }

    const updatedList = state.bin[kind].filter((n) => n !== name);
    const patch = {};
    patch[kind] = updatedList;
    const result = await saveBinToServer(patch);
    if (result.ok) {
      renderTagManagerTable(kind);
      showToast("Deleted");
    }
  }

  async function handleAddCategory() {
    const input = document.getElementById("new-category-input");
    const name = input.value.trim();
    if (!name) return;
    if (state.bin.categories.includes(name)) {
      showToast("That category already exists.");
      return;
    }
    const result = await saveBinToServer({ categories: [...state.bin.categories, name] });
    if (result.ok) {
      input.value = "";
      renderTagManagerTable("categories");
      showToast("Category added");
    }
  }

  async function handleAddGoal() {
    const input = document.getElementById("new-goal-input");
    const name = input.value.trim();
    if (!name) return;
    if (state.bin.healthGoals.includes(name)) {
      showToast("That health goal already exists.");
      return;
    }
    const result = await saveBinToServer({ healthGoals: [...state.bin.healthGoals, name] });
    if (result.ok) {
      input.value = "";
      renderTagManagerTable("healthGoals");
      showToast("Health goal added");
    }
  }

  // ---------------------------------------------------------------------
  // Export / backup + catalogue size
  // ---------------------------------------------------------------------

  function handleExport() {
    const payload = {
      products: state.bin.products,
      categories: state.bin.categories,
      healthGoals: state.bin.healthGoals,
      updatedAt: state.bin.updatedAt
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `danida-organics-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function renderCatalogueSize() {
    const el = document.getElementById("catalogue-size-indicator");
    const bytes = new Blob([
      JSON.stringify({ products: state.bin.products, categories: state.bin.categories, healthGoals: state.bin.healthGoals })
    ]).size;
    const kb = Math.round(bytes / 1024);
    el.textContent = `${state.bin.products.length} product${state.bin.products.length === 1 ? "" : "s"}, ~${kb} KB (JSONBin free tier caps a bin at 100 KB)`;
  }

  // ---------------------------------------------------------------------
  // Generic confirm dialog
  // ---------------------------------------------------------------------

  function confirmDialog(title, body, confirmLabel = "Confirm") {
    return new Promise((resolve) => {
      const dialog = document.getElementById("confirm-dialog");
      document.getElementById("confirm-dialog-title").textContent = title;
      document.getElementById("confirm-dialog-body").textContent = body;
      const confirmBtn = document.getElementById("confirm-dialog-confirm");
      const cancelBtn = document.getElementById("confirm-dialog-cancel");
      confirmBtn.textContent = confirmLabel;

      function cleanup(result) {
        dialog.removeAttribute("open");
        confirmBtn.removeEventListener("click", onConfirm);
        cancelBtn.removeEventListener("click", onCancel);
        resolve(result);
      }
      function onConfirm() { cleanup(true); }
      function onCancel() { cleanup(false); }

      confirmBtn.addEventListener("click", onConfirm);
      cancelBtn.addEventListener("click", onCancel);
      dialog.setAttribute("open", "");
      confirmBtn.focus();
    });
  }

  // ---------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------

  function wireTabs() {
    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", "false"));
        btn.setAttribute("aria-selected", "true");
        document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = true; });
        document.getElementById(`panel-${btn.dataset.tab}`).hidden = false;
      });
    });
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("admin-login-form").addEventListener("submit", handleLoginSubmit);
    document.getElementById("logout-btn").addEventListener("click", handleLogout);
    document.getElementById("add-product-btn").addEventListener("click", openAddProductForm);
    document.getElementById("export-btn").addEventListener("click", handleExport);
    document.getElementById("add-category-btn").addEventListener("click", handleAddCategory);
    document.getElementById("add-goal-btn").addEventListener("click", handleAddGoal);
    document.querySelectorAll("[data-close-product-form]").forEach((el) => el.addEventListener("click", closeProductForm));
    wireTabs();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (document.getElementById("product-form-dialog").hasAttribute("open")) closeProductForm();
        return;
      }
      if (e.key === "Tab") {
        const openDialog = ["product-form-dialog", "confirm-dialog"].find((id) => document.getElementById(id).hasAttribute("open"));
        if (openDialog) trapFocus(document.querySelector(`#${openDialog} .confirm-dialog-card`), e);
      }
    });

    const session = loadSession();
    if (session) {
      state.session = session;
      enterAdminShell();
    }
  });
})();
