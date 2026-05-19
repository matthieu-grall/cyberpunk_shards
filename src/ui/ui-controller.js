/**
 * ui-controller.js
 * ----------------
 * Manages shared UI interactions across all views:
 *   - Node detail panel (used by network view)
 *   - Filter chip wiring helper
 *   - Search / spotlight input helper
 *   - Legend rendering helper
 *   - Stats bar updates
 *
 * Each view calls the functions it needs; this module is view-agnostic.
 */

"use strict";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setText(selector, text, root = document) {
  const el = root.querySelector(selector);
  if (el) el.textContent = text;
}

function setHTML(selector, html, root = document) {
  const el = root.querySelector(selector);
  if (el) el.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Legend builder
// ---------------------------------------------------------------------------

function renderLegend(containerId, typeColors) {
  const container = document.querySelector(containerId);
  if (!container) return;

  const entries = [
    { type: "Corporation",  label: "Corporation" },
    { type: "Gang",         label: "Gang / Clan" },
    { type: "Individual",   label: "Individual" },
    { type: "Institution",  label: "Institution" },
    { type: "MilitaryUnit", label: "Military unit" },
    { type: "Band",         label: "Band / Artists" },
  ];

  container.innerHTML =
    entries
      .map(
        ({ type, label }) => `
        <div class="legend-row" data-type="${type}">
          <span class="legend-dot" style="background:${typeColors[type] || "#aaa"}"></span>
          <span class="legend-label">${label}</span>
        </div>`
      )
      .join("");
}

function renderRelationLegend(containerId, relationColors) {
  const container = document.querySelector(containerId);
  if (!container) return;

  const labels = {
    conflict: "Conflict",
    warning: "Warning",
    alliance: "Alliance",
    employment: "Employment",
    power: "Power struggle",
    rift: "Rift",
    romance: "Romance",
    family: "Family",
    medical: "Medical",
    cooccurrence: "Co-occurrence",
  };

  container.insertAdjacentHTML(
    "beforeend",
    `
    <div class="legend-separator"></div>
    <h2 class="sidebar__section-title">Relationship types</h2>
    ` +
      Object.entries(relationColors)
        .map(
          ([type, color]) => `
          <div class="legend-row legend-row--info" data-relation="${type}">
            <span class="legend-square" style="background:${color}"></span>
            <span class="legend-label">${labels[type] || type}</span>
          </div>`
        )
        .join("")
  );
}

// ---------------------------------------------------------------------------
// Detail panel (network view)
// ---------------------------------------------------------------------------

function updateDetailPanel(node, allShards) {
  const panel = document.querySelector("#detail-panel");
  if (!panel) return;

  if (!node) {
    panel.classList.remove("is-visible");
    return;
  }

  panel.classList.add("is-visible");

  setText("#detail-name",        node.name,         panel);
  setText("#detail-type",        node.type,         panel);
  setText("#detail-faction",     node.faction || "—", panel);
  setText("#detail-tier",        node.tier || "—",  panel);
  setText("#detail-degree",      `${node.degree} connection${node.degree !== 1 ? "s" : ""}`, panel);
  setText("#detail-description", node.description || "No description available.", panel);

  const shardList = panel.querySelector("#detail-shards");
  if (shardList) {
    shardList.innerHTML =
      node.shards.length === 0
        ? "<li class='empty'>No shards found.</li>"
        : node.shards
            .map(
              (s) => {
                const urlTitle = s.title.replace(/ /g, '_').replace(/:/g, '');
                const url = `https://cyberpunk.fandom.com/wiki/${urlTitle}`;
                return `
              <li class="shard-item" data-category="${s.category}">
                <span class="shard-category">${s.category}</span>
                <a class="shard-title" href="${url}" target="_blank" rel="noopener noreferrer">${s.title}</a>
              </li>`;
              }
            )
            .join("");
  }
}

// ---------------------------------------------------------------------------
// Stats bar
// ---------------------------------------------------------------------------

function updateStats(meta, visibleNodes) {
  setText("#stat-nodes",       `${visibleNodes} / ${meta.nodeCount} nodes`);
  setText("#stat-links",       `${meta.linkCount} connections`);
  setText("#stat-communities", `${meta.communityCount} clusters`);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function initSearch(inputSelector, nodes, onMatch) {
  const input = document.querySelector(inputSelector);
  if (!input) return;

  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    if (query.length < 2) { onMatch(null); return; }

    const match = nodes.find((n) => {
      const name = String(n.name || "").toLowerCase();
      const faction = String(n.faction || "").toLowerCase();
      const type = String(n.type || "").toLowerCase();
      return name.includes(query) || faction.includes(query) || type.includes(query);
    });
    onMatch(match || null);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { input.value = ""; onMatch(null); }
  });
}

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------

function initFilterChips(chipsSelector, onFilter) {
  const container = document.querySelector(chipsSelector);
  if (!container) return;

  let activeType = null;

  container.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-filter-type]");
    if (!chip) return;

    const type = chip.dataset.filterType;
    if (activeType === type) {
      activeType = null;
      container.querySelectorAll("[data-filter-type]").forEach((c) =>
        c.classList.remove("active")
      );
      onFilter(null);
    } else {
      activeType = type;
      container.querySelectorAll("[data-filter-type]").forEach((c) =>
        c.classList.toggle("active", c.dataset.filterType === type)
      );
      onFilter((node) => node.type === type);
    }
  });
}

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    renderLegend,
    renderRelationLegend,
    updateDetailPanel,
    updateStats,
    initSearch,
    initFilterChips,
    setText,
    setHTML,
  };
} else {
  window.UIController = {
    renderLegend,
    renderRelationLegend,
    updateDetailPanel,
    updateStats,
    initSearch,
    initFilterChips,
    setText,
    setHTML,
  };
}
