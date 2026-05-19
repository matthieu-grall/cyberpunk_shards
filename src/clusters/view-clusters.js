/**
 * view-clusters.js
 * ----------------
 * Thematic cluster visualisation for the CP2077 Shard Network tool.
 *
 * Design:
 *   - Mindmap layout: a central Cyberpunk themes node with seven branch clusters.
 *   - Each cluster branch connects to its sub-themes at the outer ring.
 *   - Click a cluster or sub-theme to inspect shards in the right-hand detail panel.
 *
 * Rendering:
 *   - Deterministic radial layout for consistent branch placement.
 *   - SVG for connections, nodes, and labels.
 */

"use strict";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const CL = {
  MIN_R:        60,     // minimum cluster bubble radius
  MAX_R:        120,    // maximum cluster bubble radius
  CHARGE:       -40,    // force-simulation repulsion between bubbles
  PADDING:      18,     // minimum gap between bubble edges
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _simulation  = null;
let _activeCl    = null;   // currently selected cluster id
let _activeSub   = null;   // currently selected sub-theme id

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Scale a cluster's shard count to a bubble radius.
 *
 * @param {number} count
 * @param {number} maxCount
 * @returns {number}
 */
function shardCountToRadius(count, maxCount) {
  const t = Math.sqrt(count / maxCount); // sqrt so visual area ∝ count
  return CL.MIN_R + t * (CL.MAX_R - CL.MIN_R);
}

function shardUrl(shard) {
  if (!shard || !shard.title) return "#";
  const title = shard.title.replace(/ /g, "_").replace(/:/g, "");
  return `https://cyberpunk.fandom.com/wiki/${encodeURIComponent(title)}`;
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

/**
 * Populate the right-hand detail panel with cluster or sub-theme data.
 *
 * @param {object|null}  cluster   - Cluster object.
 * @param {string|null}  subId     - Sub-theme ID to filter by, or null.
 * @param {object[]}     shards    - Full shard array.
 * @param {HTMLElement}  panelEl   - The panel container element.
 */
function populatePanel(cluster, subId, shards, panelEl) {
  if (!cluster) {
    panelEl.innerHTML = `
      <div class="detail-placeholder">
        <p>Click a cluster bubble to explore its shards.</p>
      </div>`;
    return;
  }

  // Which shard IDs to show?
  let shardIds = cluster.shard_ids;
  let subtitle = cluster.label;

  if (subId) {
    const sub = cluster.sub_themes.find((s) => s.id === subId);
    if (sub) {
      shardIds = sub.shard_ids;
      subtitle = `${cluster.short} › ${sub.label}`;
    }
  }

  const matchedShards = shardIds
    .map((sid) => shards.find((s) => s.id === sid))
    .filter(Boolean);

  // Sub-theme chips
  const subChips = (cluster.sub_themes || [])
    .map(
      (sub) => `
      <button class="cl-sub-chip ${subId === sub.id ? "active" : ""}"
              data-sub-id="${sub.id}"
              title="${sub.label}">
        ${sub.label}
      </button>`
    )
    .join("");

  // Keyword pills
  const keywords = (cluster.keywords || [])
    .map((k) => `<span class="cl-keyword">${k}</span>`)
    .join("");

  // Shard list
  const shardListHtml = matchedShards
    .map((s) => {
      const url = shardUrl(s);
      return `
      <li class="shard-item" data-category="${s.category}">
        <span class="shard-category">${s.category}</span>
        <a class="shard-title" href="${url}" target="_blank" rel="noopener">
          ${s.title}
        </a>
      </li>`;
    })
    .join("");

  panelEl.innerHTML = `
    <p id="detail-name" style="color:${cluster.color}">${cluster.label}</p>
    <p class="cl-panel-tone">Tone: <em>${cluster.emotional_tone}</em> · Format: <em>${cluster.dominant_format}</em></p>
    <p id="detail-description">${cluster.description}</p>
    <div class="cl-keywords">${keywords}</div>
    ${subChips ? `<div class="cl-sub-chips">${subChips}</div>` : ""}
    <p class="detail-shards-title">${matchedShards.length} shard${matchedShards.length !== 1 ? "s" : ""} in ${subId ? "sub-theme" : "cluster"}</p>
    ${matchedShards.length > 0
      ? `<ul id="detail-shards">${shardListHtml}</ul>`
      : `<div class="detail-placeholder"><p>No matching shards found for this selection.</p></div>`
    }`;

  // Wire sub-theme chip clicks
  panelEl.querySelectorAll(".cl-sub-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const clickedSub = chip.dataset.subId;
      const newSub = clickedSub === subId ? null : clickedSub;
      _activeSub = newSub;
      populatePanel(cluster, newSub, shards, panelEl);
    });
  });
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

/**
 * Render the cluster bubble chart.
 *
 * @param {HTMLElement} canvasEl   - The drawing area element.
 * @param {HTMLElement} panelEl    - The right-side detail panel element.
 * @param {object}      clData     - Parsed clusters.json.
 * @param {object[]}    shards     - Full shards array.
 */
function renderClusters(canvasEl, panelEl, clData, shards) {
  const clusters = clData.clusters;
  const W = canvasEl.clientWidth  || 1000;
  const H = canvasEl.clientHeight || 700;
  const cx = W / 2;
  const cy = H / 2;
  const centerR = 44;
  const branchRadius = Math.min(W, H) * 0.24;
  const leafRadius = Math.min(W, H) * 0.37;

  const maxClusterCount = Math.max(...clusters.map((c) => c.shard_ids.length), 1);
  const maxSubCount = Math.max(
    ...clusters.flatMap((c) => (c.sub_themes || []).map((s) => s.shard_ids.length)),
    1
  );

  const clusterNodes = clusters.map((cl, index) => {
    const angle = (Math.PI * 2 * index) / clusters.length - Math.PI / 2;
    const x = cx + Math.cos(angle) * branchRadius;
    const y = cy + Math.sin(angle) * branchRadius;
    return {
      ...cl,
      angle,
      x,
      y,
      r: shardCountToRadius(cl.shard_ids.length, maxClusterCount) * 0.8,
      label: cl.short || cl.label,
      subNodes: (cl.sub_themes || []).map((sub, subIndex) => {
        const offset = ((subIndex - ((cl.sub_themes || []).length - 1) / 2) * 0.18);
        const subAngle = angle + offset;
        const sx = cx + Math.cos(subAngle) * leafRadius;
        const sy = cy + Math.sin(subAngle) * leafRadius;
        return {
          ...sub,
          parentId: cl.id,
          x: sx,
          y: sy,
          r: 12 + Math.sqrt(sub.shard_ids.length / maxSubCount) * 12,
          angle: subAngle,
        };
      }),
    };
  });

  canvasEl.innerHTML = "";

  const svg = d3.select(canvasEl)
    .append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("aria-label", "Cyberpunk thematic mindmap");

  const defs = svg.append("defs");
  clusterNodes.forEach((cl) => {
    const grad = defs.append("radialGradient")
      .attr("id", `clgrad-${cl.id}`)
      .attr("cx", "40%").attr("cy", "35%")
      .attr("r", "70%");
    grad.append("stop").attr("offset", "0%")
      .attr("stop-color", cl.color).attr("stop-opacity", 0.35);
    grad.append("stop").attr("offset", "100%")
      .attr("stop-color", cl.color).attr("stop-opacity", 0.08);
  });

  const linkGroup = svg.append("g").attr("class", "cl-links");
  const nodeGroup = svg.append("g").attr("class", "cl-nodes");

  // center node
  nodeGroup.append("circle")
    .attr("class", "cl-center")
    .attr("cx", cx)
    .attr("cy", cy)
    .attr("r", centerR)
    .attr("fill", "rgba(230,168,23,0.12)")
    .attr("stroke", "#e6a817")
    .attr("stroke-width", 1.5);

  nodeGroup.append("text")
    .attr("class", "cl-center-label")
    .attr("x", cx)
    .attr("y", cy)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .attr("fill", "#e6a817")
    .attr("font-size", "12px")
    .attr("font-family", "'Share Tech Mono', monospace")
    .text("Cyberpunk themes");

  // links center → cluster
  clusterNodes.forEach((cl) => {
    linkGroup.append("line")
      .attr("class", "cl-link cl-link--cluster")
      .attr("x1", cx)
      .attr("y1", cy)
      .attr("x2", cl.x)
      .attr("y2", cl.y)
      .attr("stroke", cl.color)
      .attr("stroke-width", 1.2)
      .attr("stroke-opacity", 0.35);

    cl.subNodes.forEach((sub) => {
      linkGroup.append("line")
        .attr("class", "cl-link cl-link--sub")
        .attr("x1", cl.x)
        .attr("y1", cl.y)
        .attr("x2", sub.x)
        .attr("y2", sub.y)
        .attr("stroke", cl.color)
        .attr("stroke-width", 1)
        .attr("stroke-opacity", 0.2);
    });
  });

  const clusterGroups = nodeGroup.selectAll("g.cl-cluster")
    .data(clusterNodes)
    .join("g")
    .attr("class", "cl-cluster")
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .style("cursor", "pointer")
    .attr("pointer-events", "all")
    .on("click", (event, d) => {
      event.stopPropagation();
      _activeCl = d.id;
      _activeSub = null;
      highlightSelection(d.id, null);
      const rawCluster = clusters.find((cl) => cl.id === d.id) || d;
      populatePanel(rawCluster, null, shards, panelEl);
    });

  clusterGroups.append("circle")
    .attr("class", "cl-bubble")
    .attr("r", (d) => d.r)
    .attr("fill", (d) => `url(#clgrad-${d.id})`)
    .attr("stroke", (d) => d.color)
    .attr("stroke-width", 1.8)
    .attr("stroke-opacity", 0.55)
    .on("click", (event, d) => {
      event.stopPropagation();
      _activeCl = d.id;
      _activeSub = null;
      highlightSelection(d.id, null);
      const rawCluster = clusters.find((cl) => cl.id === d.id) || d;
      populatePanel(rawCluster, null, shards, panelEl);
    });

  clusterGroups.append("text")
    .attr("class", "cl-label")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("fill", (d) => d.color)
    .attr("font-size", "12px")
    .attr("font-family", "'Share Tech Mono', monospace")
    .attr("pointer-events", "none")
    .text((d) => d.label)
    .call(wrapText, 72);

  clusterGroups.append("text")
    .attr("class", "cl-count")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "hanging")
    .attr("dy", "0.7em")
    .attr("fill", "rgba(255,255,255,0.55)")
    .attr("font-size", "10px")
    .attr("font-family", "'Share Tech Mono', monospace")
    .attr("pointer-events", "none")
    .text((d) => `${d.shard_ids.length} shards`);

  const subGroups = linkGroup.selectAll("g.cl-subgroup")
    .data(clusterNodes.flatMap((cl) => cl.subNodes))
    .join("g")
    .attr("class", "cl-subgroup")
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .style("cursor", "pointer")
    .on("click", (event, d) => {
      event.stopPropagation();
      _activeCl = d.parentId;
      _activeSub = d.id;
      const clObj = clusters.find((c) => c.id === d.parentId);
      highlightSelection(d.parentId, d.id);
      populatePanel(clObj, d.id, shards, panelEl);
    });

  subGroups.append("circle")
    .attr("class", "cl-sub-bubble")
    .attr("r", (d) => d.r)
    .attr("fill", (d) => {
      const parent = clusterNodes.find((cl) => cl.id === d.parentId);
      return parent ? parent.color : "#777";
    })
    .attr("fill-opacity", 0.55)
    .attr("stroke", (d) => {
      const parent = clusterNodes.find((cl) => cl.id === d.parentId);
      return parent ? parent.color : "#777";
    })
    .attr("stroke-width", 1)
    .attr("stroke-opacity", 0.8);

  subGroups.append("text")
    .attr("class", "cl-sub-label")
    .attr("x", 0)
    .attr("y", (d) => d.r + 14)
    .attr("text-anchor", "middle")
    .attr("fill", "#d0d8e4")
    .attr("font-size", "10px")
    .attr("font-family", "'Share Tech Mono', monospace")
    .attr("pointer-events", "none")
    .text((d) => d.label)
    .call(wrapText, 80);

  svg.on("click", (event) => {
    if (event.target !== svg.node()) return;
    _activeCl = null;
    _activeSub = null;
    highlightSelection(null, null);
    populatePanel(null, null, shards, panelEl);
  });

  highlightSelection(null, null);

  function highlightSelection(clusterId, subId) {
    clusterGroups.select(".cl-bubble")
      .attr("stroke-opacity", (d) => (d.id === clusterId ? 0.95 : 0.35))
      .attr("stroke-width", (d) => (d.id === clusterId ? 2.8 : 1.8));

    clusterGroups.select(".cl-label")
      .attr("fill-opacity", (d) => (d.id === clusterId ? 1 : 0.55));

    clusterGroups.select(".cl-count")
      .attr("fill-opacity", (d) => (d.id === clusterId ? 1 : 0.5));

    subGroups.select(".cl-sub-bubble")
      .attr("fill-opacity", (d) => (d.id === subId ? 1 : 0.35))
      .attr("stroke-width", (d) => (d.id === subId ? 1.8 : 1));
  }

  function wrapText(text, width) {
    text.each(function () {
      const textEl = d3.select(this);
      const words = textEl.text().split(/\s+/).reverse();
      let word;
      let line = [];
      const lineHeight = 1.1;
      const y = textEl.attr("y") || 0;
      const dy = parseFloat(textEl.attr("dy") || 0);
      let tspan = textEl.text(null).append("tspan").attr("x", 0).attr("y", y).attr("dy", dy + "em");

      while ((word = words.pop())) {
        line.push(word);
        tspan.text(line.join(" "));
        if (tspan.node().getComputedTextLength() > width && line.length > 1) {
          line.pop();
          tspan.text(line.join(" "));
          line = [word];
          tspan = textEl.append("tspan").attr("x", 0).attr("y", y).attr("dy", lineHeight + "em").text(word);
        }
      }
    });
  }
}

// ---------------------------------------------------------------------------
// View handler
// ---------------------------------------------------------------------------

const ClustersView = {

  mount(container, data) {
    // Clear toolbar
    const toolbarRight = document.querySelector("#toolbar-right");
    if (toolbarRight) toolbarRight.innerHTML = "";

    // Layout: canvas left, panel right
    container.innerHTML = `
      <div class="clusters-layout">
        <div id="cl-canvas" class="cl-canvas" aria-label="Thematic cluster chart"></div>
        <aside class="sidebar" id="cl-sidebar" aria-label="Cluster details">
          <div class="sidebar__section">
            <h2 class="sidebar__section-title">Theme clusters</h2>
            <p class="cl-hint">Each bubble = one theme · Size = number of shards · Inner dots = sub-themes</p>
          </div>
          <div id="cl-detail-panel" style="flex:1;overflow-y:auto;padding:16px;">
            <div class="detail-placeholder">
              <p>Click a cluster bubble to explore its shards.</p>
            </div>
          </div>
        </aside>
      </div>`;

    const canvasEl = document.getElementById("cl-canvas");
    const panelEl  = document.getElementById("cl-detail-panel");

    // Defer by one animation frame so cl-canvas has real dimensions.
    requestAnimationFrame(() => {
      if (document.getElementById("cl-canvas")) {
        renderClusters(canvasEl, panelEl, data.clusters, data.shards);
      }
    });
  },

  unmount() {
    if (_simulation) {
      _simulation.stop();
      _simulation = null;
    }
    _activeCl  = null;
    _activeSub = null;

    const toolbarRight = document.querySelector("#toolbar-right");
    if (toolbarRight) toolbarRight.innerHTML = "";
  },
};

// ---------------------------------------------------------------------------
// Registration + export
// ---------------------------------------------------------------------------

if (typeof window !== "undefined" && window.ViewManager) {
  ViewManager.registerView("clusters", "Theme Clusters", ClustersView);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ClustersView };
} else {
  window.ClustersView = ClustersView;
}
