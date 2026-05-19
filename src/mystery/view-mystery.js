/**
 * view-mystery.js
 * ---------------
 * Mystery exploration view for FF:06:B5.
 *
 * Design:
 *   - Mindmap with FF:06:B5 at center.
 *   - Around: categories of ideas and ideas.
 *   - Clickable shards, detail pane on right.
 */

"use strict";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _activeShard = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getShardText(shard) {
  return shard?.text || shard?.summary || "";
}

function shardUrl(shard) {
  if (!shard || !shard.title) return "";
  const slug = encodeURIComponent(shard.title.replace(/\s+/g, "_"));
  return `https://cyberpunk.fandom.com/wiki/${slug}`;
}

function shardLinkHtml(shard) {
  const url = shardUrl(shard);
  if (!url) return shard.title || shard.id || "Unknown shard";
  return `<a href="${url}" target="_blank" rel="noopener">${shard.title}</a>`;
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function populatePanel(shard, panelEl) {
  if (!panelEl) return;
  if (!shard) {
    panelEl.innerHTML = `
      <div class="detail-placeholder">
        <p>Click a shard to see details.</p>
      </div>`;
    return;
  }

  panelEl.innerHTML = `
    <h3>${shardLinkHtml(shard)}</h3>
    <p><strong>Category:</strong> ${shard.category || "Unknown"}</p>
    <p><strong>Text:</strong> ${getShardText(shard) || "No text available."}</p>`;
}

// ---------------------------------------------------------------------------
// View handler
// ---------------------------------------------------------------------------

const MysteryView = {

  mount(container, data) {
    container.innerHTML = `
      <div class="mystery-layout">
        <div id="mystery-mindmap"></div>
        <div id="mystery-panel" class="mystery-panel"></div>
      </div>`;

    const shards = (data.shards || []).filter((s) => {
      const text = getShardText(s);
      return text.includes("FF:06:B5");
    });
    const panelEl = document.getElementById("mystery-panel");

    // Simple radial layout
    const width = 600;
    const height = 600;
    const radius = 200;

    const svg = d3.select("#mystery-mindmap")
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${width / 2},${height / 2})`);

    // Center node
    svg.append("circle")
      .attr("r", 30)
      .attr("fill", "#e6a817")
      .attr("stroke", "white")
      .attr("stroke-width", 2);

    svg.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", 5)
      .attr("fill", "white")
      .attr("font-size", "12px")
      .text("FF:06:B5");

    // Shard nodes around
    const angleStep = shards.length > 0 ? (2 * Math.PI) / shards.length : 0;
    if (shards.length === 0) {
      svg.append("text")
        .attr("y", 50)
        .attr("text-anchor", "middle")
        .attr("fill", "#aaa")
        .attr("font-size", "14px")
        .text("No shards reference FF:06:B5 in this dataset.");
    }

    shards.forEach((shard, i) => {
      const angle = i * angleStep;
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);

      const g = svg.append("g")
        .attr("transform", `translate(${x},${y})`)
        .style("cursor", "pointer")
        .on("click", () => {
          _activeShard = shard;
          populatePanel(_activeShard, panelEl);
        });

      g.append("circle")
        .attr("r", 20)
        .attr("fill", "#7eb8f7")
        .attr("stroke", "white")
        .attr("stroke-width", 1);

      g.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", 5)
        .attr("fill", "white")
        .attr("font-size", "10px")
        .text((shard.title || shard.id || "Shard").substring(0, 10) + "...");
    });

    populatePanel(null, panelEl);
  },

  unmount() {
    _activeShard = null;
  },
};

// ---------------------------------------------------------------------------
// Registration + export
// ---------------------------------------------------------------------------

if (typeof window !== "undefined" && window.ViewManager) {
  ViewManager.registerView("mystery", "FF:06:B5 Mystery", MysteryView);
}