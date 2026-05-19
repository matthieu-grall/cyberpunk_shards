/**
 * main.js
 * -------
 * Application entry point for CP2077 Shard Network v2.
 *
 * Execution order:
 *   1. Fetch all four JSON datasets concurrently.
 *   2. Populate the shared DataStore.
 *   3. Render the view-switcher navigation.
 *   4. Mount the default view (network graph).
 */

"use strict";

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/**
 * Fetch all four data files in parallel.
 *
 * @returns {Promise<[object, object, object, object]>}
 *   [shardsJson, entitiesJson, timelineJson, clustersJson]
 */
async function loadAllData() {
  const urls = [
    "./data/shards.json",
    "./data/entities.json",
    "./data/timeline.json",
    "./data/clusters.json",
  ];

  const responses = await Promise.all(urls.map((u) => fetch(u)));

  // Check all responses before parsing
  for (const [i, res] of responses.entries()) {
    if (!res.ok) {
      throw new Error(`Failed to fetch ${urls[i]}: HTTP ${res.status}`);
    }
  }

  return Promise.all(responses.map((r) => r.json()));
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function init() {
  const loadingEl = document.querySelector("#loading-overlay");

  try {
    // -----------------------------------------------------------------------
    // 1. Load all datasets
    // -----------------------------------------------------------------------
    const [shardsJson, entitiesJson, timelineJson, clustersJson] =
      await loadAllData();

    // -----------------------------------------------------------------------
    // 2. Populate shared DataStore
    // -----------------------------------------------------------------------
    ViewManager.DataStore.shards   = shardsJson.shards;
    ViewManager.DataStore.entities = entitiesJson.entities;
    ViewManager.DataStore.timeline = timelineJson;
    ViewManager.DataStore.clusters = clustersJson;

    console.info(
      `[CP2077] Data loaded — ${shardsJson.shards.length} shards, ` +
      `${entitiesJson.entities.length} entities, ` +
      `${timelineJson.events.length} timeline events, ` +
      `${clustersJson.clusters.length} clusters`
    );

    // -----------------------------------------------------------------------
    // 3. Render navigation
    // -----------------------------------------------------------------------
    ViewManager.renderNav("#view-nav");

    // -----------------------------------------------------------------------
    // 4. Hide loading overlay
    // -----------------------------------------------------------------------
    loadingEl?.classList.add("hidden");

    // -----------------------------------------------------------------------
    // 5. Mount default view
    // -----------------------------------------------------------------------
    ViewManager.switchTo("network");

  } catch (err) {
    console.error("[CP2077] Init failed:", err);
    if (loadingEl) {
      loadingEl.innerHTML = `
        <div class="error-state">
          <p class="error-title">Failed to load data</p>
          <p class="error-detail">${err.message}</p>
          <p class="error-hint">
            Serve with a local HTTP server:<br>
            <code>npx serve .</code> or VS Code Live Server
          </p>
        </div>`;
    }
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
