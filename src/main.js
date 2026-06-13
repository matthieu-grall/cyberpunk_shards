/**
 * main.js — CP2077 Shard Network v2
 */

"use strict";

async function loadAllData() {
  const urls = [
    "./data/shards.json",
    "./data/entities.json",
    "./data/timeline.json",
    "./data/clusters.json",
  ];
  const responses = await Promise.all(urls.map((u) => fetch(u)));
  for (const [i, res] of responses.entries()) {
    if (!res.ok) throw new Error(`Failed to fetch ${urls[i]}: HTTP ${res.status}`);
  }
  return Promise.all(responses.map((r) => r.json()));
}

async function init() {
  const loadingEl = document.querySelector("#loading-overlay");

  try {
    const [shardsJson, entitiesJson, timelineJson, clustersJson] = await loadAllData();

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

    // Injecte les boutons d'onglets dans le DOM
    ViewManager.renderNav("#view-nav");

    // Traduit immédiatement les onglets dans la langue courante
    document.dispatchEvent(new CustomEvent('languageChanged', {
      detail: { language: I18n.getLanguage() }
    }));

    loadingEl?.classList.add("hidden");

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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}