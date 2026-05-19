/**
 * view-network.js
 * ---------------
 * Wraps graph-builder + graph-renderer into the ViewManager view interface.
 *
 * Key fixes vs first version:
 *   - Renderer is created inside requestAnimationFrame so #graph-canvas has
 *     real dimensions (clientWidth/clientHeight > 0) when D3 reads them.
 *   - Reset-button listener is stored and removed on unmount to prevent
 *     accumulation across view switches.
 *   - MutationObserver disconnected on unmount.
 */

"use strict";

// ---------------------------------------------------------------------------
// Sidebar HTML template
// ---------------------------------------------------------------------------

const SIDEBAR_LEFT_HTML = `
  <aside class="sidebar sidebar--left" id="network-sidebar-left" aria-label="Entity types and relationships">
    <section class="sidebar__section" aria-labelledby="legend-heading">
      <h2 class="sidebar__section-title" id="legend-heading">Entity types</h2>
      <div id="legend-items" role="list"></div>
    </section>
  </aside>`;

const SIDEBAR_RIGHT_HTML = `
  <aside class="sidebar sidebar--right" id="network-sidebar-right" aria-label="Entity details">
    <div id="detail-panel" aria-live="polite">
      <p id="detail-name"></p>
      <div class="detail-meta">
        <span class="detail-tag type" id="detail-type"></span>
        <span class="detail-tag fac"  id="detail-faction"></span>
        <span class="detail-tag tier" id="detail-tier"></span>
      </div>
      <p id="detail-degree"></p>
      <p id="detail-description"></p>
      <p class="detail-shards-title">Appears in shards</p>
      <ul id="detail-shards" aria-label="Shards featuring this entity"></ul>
    </div>

    <div class="detail-placeholder" id="detail-placeholder">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <circle cx="24" cy="8"  r="4" stroke="currentColor" stroke-width="1.5"/>
        <circle cx="8"  cy="36" r="4" stroke="currentColor" stroke-width="1.5"/>
        <circle cx="40" cy="36" r="4" stroke="currentColor" stroke-width="1.5"/>
        <circle cx="24" cy="28" r="4" stroke="currentColor" stroke-width="1.5"/>
        <line x1="24" y1="12" x2="24" y2="24" stroke="currentColor" stroke-width="1"/>
        <line x1="20" y1="30" x2="10" y2="34" stroke="currentColor" stroke-width="1"/>
        <line x1="28" y1="30" x2="38" y2="34" stroke="currentColor" stroke-width="1"/>
      </svg>
      <p>Click any node to inspect its connections and shard appearances.</p>
    </div>
  </aside>`;

// ---------------------------------------------------------------------------
// Module-level state (reset on every unmount)
// ---------------------------------------------------------------------------

let _renderer      = null;
let _panelObserver = null;
let _resetHandler  = null;
let _viewAllHandler = null;
let _rafHandle     = null;

// ---------------------------------------------------------------------------
// View handler
// ---------------------------------------------------------------------------

const NetworkView = {

  mount(container, data) {
    // 1. Inject DOM structure synchronously
    container.innerHTML = `
      <div class="network-layout">
        ${SIDEBAR_LEFT_HTML}
        <div id="graph-canvas"
             role="main"
             aria-label="Entity network graph">
          <p class="canvas-hint">Scroll to zoom · Drag to pan · Click node to inspect · Dbl-click to reset zoom</p>
        </div>
        ${SIDEBAR_RIGHT_HTML}
      </div>`;

    // 2. Build graph data (pure computation, no DOM access)
    const graph = GraphBuilder.buildGraph(
      { shards: data.shards },
      { entities: data.entities }
    );

    // 3. Defer renderer creation until the browser has laid out the canvas div
    _rafHandle = requestAnimationFrame(() => {
      _rafHandle = null;
      _initRenderer(graph, data);
    });
  },

  unmount() {
    if (_rafHandle !== null) {
      cancelAnimationFrame(_rafHandle);
      _rafHandle = null;
    }
    _renderer?.destroy();
    _renderer = null;
    _panelObserver?.disconnect();
    _panelObserver = null;
    if (_resetHandler) {
      document.querySelector("#btn-reset")?.removeEventListener("click", _resetHandler);
      _resetHandler = null;
    }
    if (_viewAllHandler) {
      document.querySelector("#btn-view-all")?.removeEventListener("click", _viewAllHandler);
      _viewAllHandler = null;
    }
  },
};

// ---------------------------------------------------------------------------
// Relation types (inferred from shard text)
// ---------------------------------------------------------------------------

const RELATION_COLORS = {
  conflict: "#e05252",
  warning: "#f4a261",
  alliance: "#67d4a8",
  employment: "#7eb8f7",
  power: "#b07af5",
  rift: "#d46a6a",
  romance: "#f78fb3",
  family: "#9fd3c7",
  medical: "#8dd7ff",
  cooccurrence: "#777777",
};

// ---------------------------------------------------------------------------
// Internal init (runs inside rAF)
// ---------------------------------------------------------------------------

function _initRenderer(graph, data) {
  _renderer = GraphRenderer.createRenderer("#graph-canvas", graph, {
    relationColors: RELATION_COLORS,
  });

  UIController.renderLegend("#legend-items", GraphRenderer.TYPE_COLORS);
  UIController.renderRelationLegend("#legend-items", RELATION_COLORS);
  UIController.updateStats(graph.meta, graph.meta.nodeCount);

  // Add click handlers for legend filtering
  _initLegendFiltering(graph);

  // Start with full graph visible after simulation settles
  setTimeout(() => _renderer.fitZoom(), 1000);

  UIController.initSearch("#search-input", graph.nodes, (match) => {
    _renderer.highlight(match ? match.id : null);
    UIController.updateDetailPanel(match, data.shards);
  });

  const canvas = document.querySelector("#graph-canvas");

  canvas.addEventListener("node:select", (e) => {
    UIController.updateDetailPanel(e.detail, data.shards);
  });

  canvas.addEventListener("node:hover", (e) => {
    if (!canvas.querySelector(".node--pinned")) {
      UIController.updateDetailPanel(e.detail, data.shards);
    }
  });

  _resetHandler = () => {
    _renderer?.resetZoom();
    _renderer?.highlight(null);
    _renderer?.filter(null);
    UIController.updateDetailPanel(null, data.shards);
    UIController.updateStats(graph.meta, graph.meta.nodeCount);
    // Clear legend active states
    document.querySelectorAll("#legend-items .legend-row").forEach(r => r.classList.remove("active"));
    const si = document.querySelector("#search-input");
    if (si) si.value = "";
  };
  document.querySelector("#btn-reset")?.addEventListener("click", _resetHandler);

  _viewAllHandler = () => {
    _renderer?.fitZoom();
  };
  document.querySelector("#btn-view-all")?.addEventListener("click", _viewAllHandler);

  const panel       = document.getElementById("detail-panel");
  const placeholder = document.getElementById("detail-placeholder");
  if (panel && placeholder) {
    _panelObserver = new MutationObserver(() => {
      placeholder.style.display = panel.classList.contains("is-visible") ? "none" : "";
    });
    _panelObserver.observe(panel, { attributes: true, attributeFilter: ["class"] });
  }
}

// ---------------------------------------------------------------------------
// Legend filtering
// ---------------------------------------------------------------------------

function _initLegendFiltering(graph) {
  const legendContainer = document.querySelector("#legend-items");
  if (!legendContainer) return;

  let activeFilter = null;

  legendContainer.addEventListener("click", (e) => {
    const row = e.target.closest(".legend-row");
    if (!row) return;

    const type = row.dataset.type;
    const relation = row.dataset.relation;

    if (type) {
      // Filter by entity type
      if (activeFilter === `type-${type}`) {
        activeFilter = null;
        legendContainer.querySelectorAll(".legend-row").forEach(r => r.classList.remove("active"));
        _renderer.filter(null);
      } else {
        activeFilter = `type-${type}`;
        legendContainer.querySelectorAll(".legend-row").forEach(r => r.classList.remove("active"));
        row.classList.add("active");
        _renderer.filter((node) => node.type === type);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

if (typeof window !== "undefined" && window.ViewManager) {
  ViewManager.registerView("network", "Entity Network", NetworkView);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { NetworkView };
} else {
  window.NetworkView = NetworkView;
}
