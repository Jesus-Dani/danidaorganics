// Client-side routing (History API, not hash-based).
// Routes: "/" (grid), "/products/:slug" (grid + quick-view auto-opened),
// "/?category=X&goal=Y" (grid with filters pre-applied).
// Owns all history.pushState/replaceState calls; app.js only renders.

(function () {
  "use strict";

  function parseLocation() {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const match = path.match(/^\/products\/([^/]+)\/?$/);
    return {
      slug: match ? decodeURIComponent(match[1]) : null,
      category: params.get("category") || "",
      goal: params.get("goal") || ""
    };
  }

  async function handleRoute() {
    await window.DanidaApp.ready;
    const { slug, category, goal } = parseLocation();

    if (category || goal) {
      window.DanidaApp.setFiltersFromQuery({ category, goal });
    }

    if (slug) {
      const found = window.DanidaApp.openQuickViewBySlug(slug);
      if (!found) {
        window.DanidaApp.showNotFoundNotice();
        navigate("/", { replace: true });
      }
    } else {
      window.DanidaApp.closeQuickView();
    }
  }

  function navigate(path, opts = {}) {
    const method = opts.replace ? "replaceState" : "pushState";
    if (window.location.pathname + window.location.search !== path) {
      history[method]({}, "", path);
    } else if (method === "replaceState") {
      history.replaceState({}, "", path);
    }
    handleRoute();
  }

  function replace(path) {
    if (window.location.pathname + window.location.search === path) return;
    history.replaceState({}, "", path);
  }

  function goToProduct(slug, triggerEl) {
    // Only reachable from a rendered product card, so the app is already ready.
    history.pushState({}, "", `/products/${encodeURIComponent(slug)}`);
    window.DanidaApp.openQuickViewBySlug(slug, triggerEl);
  }

  function closeProduct() {
    const params = new URLSearchParams(window.location.search);
    const qs = params.toString();
    history.pushState({}, "", "/" + (qs ? `?${qs}` : ""));
    window.DanidaApp.closeQuickView();
  }

  window.addEventListener("popstate", handleRoute);
  window.addEventListener("DOMContentLoaded", handleRoute);

  window.DanidaRouter = { navigate, replace, goToProduct, closeProduct };
})();
