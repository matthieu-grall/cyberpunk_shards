/**
 * view-manager.js
 * ---------------
 * Central controller responsible for:
 *   - Registering the three visualisation views (Network, Timeline, Clusters).
 *   - Handling view switching: teardown of the active view, setup of the next.
 *   - Managing the shared top-bar navigation state (active button highlight).
 *   - Exposing a global data store so each view can access all loaded datasets.
 *
 * Views communicate through a minimal interface:
 *   { mount(container, data), unmount() }
 */

"use strict";

// ---------------------------------------------------------------------------
// Data store
// ---------------------------------------------------------------------------

/**
 * Shared in-memory store for all loaded JSON datasets.
 * Populated once by main.js after the parallel fetch resolves.
 *
 * @type {{ shards: object[]|null, entities: object[]|null, timeline: object|null, clusters: object|null }}
 */
const DataStore = {
  shards:   null,
  entities: null,
  timeline: null,
  clusters: null,
};

// ---------------------------------------------------------------------------
// View registry
// ---------------------------------------------------------------------------

/**
 * Registry of all available views.
 * Each entry maps a view ID to its handler object and DOM button.
 *
 * Shape:
 *   {
 *     id: string,
 *     label: string,
 *     handler: { mount(container, data), unmount() } | null,
 *     button: HTMLElement | null,
 *   }
 */
const viewRegistry = new Map();

// ---------------------------------------------------------------------------
// Active state
// ---------------------------------------------------------------------------

/** Currently mounted view ID, or null. */
let activeViewId = null;

/** The active view handler instance, or null. */
let activeHandler = null;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register a view with the manager.
 * Called by each visualisation module during bootstrap.
 *
 * @param {string} id - Unique view ID (e.g. "network", "timeline", "clusters").
 * @param {string} label - Display label for the nav button.
 * @param {object} handler - Object with mount() and unmount() methods.
 */
function registerView(id, label, handler) {
  viewRegistry.set(id, { id, label, handler, button: null });
}

// ---------------------------------------------------------------------------
// Navigation rendering
// ---------------------------------------------------------------------------

/**
 * Render the view-switcher navigation buttons into the designated container.
 * Should be called once after all views have been registered.
 *
 * @param {string} navSelector - CSS selector for the nav container element.
 */
function renderNav(navSelector) {
  const nav = document.querySelector(navSelector);
  if (!nav) return;

  nav.innerHTML = "";

  for (const view of viewRegistry.values()) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "view-btn";
    btn.dataset.viewId = view.id;
    btn.textContent = view.label;
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => switchTo(view.id));
    nav.appendChild(btn);
    view.button = btn;
  }
}

// ---------------------------------------------------------------------------
// View switching
// ---------------------------------------------------------------------------

/**
 * Tear down the currently active view (if any) and mount the requested view.
 *
 * @param {string} viewId - ID of the view to activate.
 */
function switchTo(viewId) {
  if (viewId === activeViewId) return;

  const target = viewRegistry.get(viewId);
  if (!target) {
    console.error(`[ViewManager] Unknown view: "${viewId}"`);
    return;
  }

  // --- Teardown ---
  if (activeHandler && typeof activeHandler.unmount === "function") {
    activeHandler.unmount();
  }

  // Update button states
  for (const view of viewRegistry.values()) {
    view.button?.setAttribute("aria-pressed", view.id === viewId ? "true" : "false");
    view.button?.classList.toggle("active", view.id === viewId);
  }

  // --- Setup ---
  const container = document.querySelector("#view-container");
  if (!container) {
    console.error("[ViewManager] #view-container not found in DOM.");
    return;
  }

  // Clear container content except persistent children
  container.innerHTML = "";

  activeViewId = viewId;
  activeHandler = target.handler;

  // Mount passes the full DataStore so the view can pick what it needs
  target.handler.mount(container, DataStore);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

if (typeof module !== "undefined" && module.exports) {
  module.exports = { DataStore, registerView, renderNav, switchTo };
} else {
  window.ViewManager = { DataStore, registerView, renderNav, switchTo };
}
