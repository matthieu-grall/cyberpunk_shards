/**
 * graph-renderer.js
 * -----------------
 * D3 v7 force-directed graph renderer for the CP2077 Shard Network visualisation.
 *
 * Responsibilities:
 *   - Initialise the SVG canvas and D3 force simulation.
 *   - Render nodes and links with visual encodings (size, colour, opacity).
 *   - Handle zoom/pan via d3.zoom.
 *   - Expose interaction hooks: hover, click, filter, reset.
 *
 * Visual encoding:
 *   - Node radius   ∝ sqrt(degree)  (size = connectivity)
 *   - Node colour   = entity type   (Corporation / Gang / Individual / …)
 *   - Node stroke   = tier          (legendary / major / minor)
 *   - Link opacity  ∝ weight        (thicker = more shared shards)
 *   - Link colour   = community of source node
 */

"use strict";

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------

/** Maps entity type → fill colour.  Chosen for contrast on dark background. */
const TYPE_COLORS = {
  Corporation:  "#e6a817",   // amber  — wealth, power
  Gang:         "#e05252",   // red    — danger, street
  Individual:   "#7eb8f7",   // sky    — human
  Institution:  "#67d4a8",   // teal   — system
  MilitaryUnit: "#b07af5",   // purple — force
  Band:         "#f78fb3",   // pink   — culture
  AI:           "#a0e84a",   // lime   — machine
  Faction:      "#f4a261",   // orange — collective
  default:      "#aaaaaa",   // grey   — unknown
};

/** Node border colour encodes narrative tier. */
const TIER_STROKES = {
  legendary: "#111111",
  major:     "#333333",
  minor:     "#555555",
  default:   "#777777",
};

// ---------------------------------------------------------------------------
// Renderer factory
// ---------------------------------------------------------------------------

/**
 * Create and attach a force-directed graph renderer to a DOM container.
 *
 * @param {string} containerId - CSS selector for the host <div> element.
 * @param {object} graph - { nodes, links, meta } from GraphBuilder.buildGraph().
 * @param {object} [options] - Optional configuration overrides.
 * @returns {object} Public API: { highlight, filter, reset, destroy }
 */
function createRenderer(containerId, graph, options = {}) {
  const cfg = Object.assign(
    {
      minRadius: 6,
      maxRadius: 36,
      linkBaseOpacity: 0.4,
      linkHighlightOpacity: 0.85,
      chargeStrength: -280,
      linkDistance: 80,
      collideMultiplier: 1.6,
      transitionDuration: 300,
    },
    options
  );

  const relationColors = options.relationColors || {
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

  const relationPriority = options.relationPriority || [
    "conflict",
    "warning",
    "alliance",
    "employment",
    "power",
    "rift",
    "romance",
    "family",
    "medical",
    "cooccurrence",
  ];


  // -------------------------------------------------------------------------
  // Canvas setup
  // -------------------------------------------------------------------------

  const container = document.querySelector(containerId);
  const width = container.clientWidth;
  const height = container.clientHeight;

  // Remove any pre-existing SVG (supports re-render)
  container.querySelector("svg")?.remove();

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("aria-label", "CP2077 Shard entity network graph");

  // Defs: arrow marker (not used for undirected, but useful for directed variants)
  const defs = svg.append("defs");
  defs
    .append("filter")
    .attr("id", "glow")
    .call((f) => {
      f.append("feGaussianBlur")
        .attr("stdDeviation", "3")
        .attr("result", "coloredBlur");
      const merge = f.append("feMerge");
      merge.append("feMergeNode").attr("in", "coloredBlur");
      merge.append("feMergeNode").attr("in", "SourceGraphic");
    });

  // Zoom group — everything inside here is zoomable/pannable
  const zoomGroup = svg.append("g").attr("class", "zoom-group");

  const zoom = d3
    .zoom()
    .scaleExtent([0.15, 4])
    .on("zoom", (event) => zoomGroup.attr("transform", event.transform));

  svg.call(zoom);

  // Double-click on SVG background resets zoom
  svg.on("dblclick.zoom", null).on("dblclick", () => {
    svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity);
  });

  // -------------------------------------------------------------------------
  // Scale functions
  // -------------------------------------------------------------------------

  const maxDeg = graph.meta.maxDegree || 1;
  const maxWt = graph.meta.maxWeight || 1;

  /**
   * Map node degree to visual radius using a square-root scale.
   * Keeps high-degree nodes dominant without drowning low-degree ones.
   */
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, maxDeg])
    .range([cfg.minRadius, cfg.maxRadius]);

  /**
   * Map link weight to stroke width.
   */
  const linkWidthScale = d3
    .scaleLinear()
    .domain([1, maxWt])
    .range([2, 8])
    .clamp(true);

  // -------------------------------------------------------------------------
  // Force simulation
  // -------------------------------------------------------------------------

  const simulation = d3
    .forceSimulation(graph.nodes)
    .force(
      "link",
      d3
        .forceLink(graph.links)
        .id((d) => d.id)
        .distance((d) => {
          // Longer distance for cross-faction edges to aid visual separation
          const sameType =
            d.source.type === d.target.type;
          return sameType
            ? cfg.linkDistance * 0.8
            : cfg.linkDistance * 1.3;
        })
        .strength(0.4)
    )
    .force("charge", d3.forceManyBody().strength(cfg.chargeStrength))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force(
      "collide",
      d3
        .forceCollide()
        .radius((d) => radiusScale(d.degree) * cfg.collideMultiplier)
        .iterations(2)
    )
    .alphaDecay(0.028);

  // -------------------------------------------------------------------------
  // Link layer
  // -------------------------------------------------------------------------

  const linkGroup = zoomGroup.append("g").attr("class", "links");

  const linkSelection = linkGroup
    .selectAll("line")
    .data(graph.links)
    .join("line")
    .attr("class", "graph-link")
    .attr("stroke", (d) => {
      const relTypes = Array.isArray(d.relationTypes) ? d.relationTypes : [];
      const relType =
        relationPriority.find((t) => relTypes.includes(t)) ||
        relTypes[0] ||
        "cooccurrence";

      return relationColors[relType] || TYPE_COLORS.default;
    })
    .attr("stroke-width", (d) => linkWidthScale(d.weight))
    .attr("stroke-opacity", cfg.linkBaseOpacity)
    .attr("stroke-linecap", "round");

  linkSelection.append("title").text((d) => {
    const relTypes = Array.isArray(d.relationTypes) ? d.relationTypes : [];
    const typeLabel = relTypes.length ? relTypes.join(", ") : "cooccurrence";
    const shardCount = Array.isArray(d.shards) ? d.shards.length : 0;
    return `Relation: ${typeLabel} (${shardCount} shard${shardCount === 1 ? "" : "s"})`;
  });

  // -------------------------------------------------------------------------
  // Node layer
  // -------------------------------------------------------------------------

  const nodeGroup = zoomGroup.append("g").attr("class", "nodes");

  const nodeSelection = nodeGroup
    .selectAll("g.node")
    .data(graph.nodes)
    .join("g")
    .attr("class", "node")
    .attr("role", "button")
    .attr("tabindex", "0")
    .attr("aria-label", (d) => `${d.name} — ${d.type}`)
    .call(
      // Drag behaviour: pin node to cursor while dragging
      d3
        .drag()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          // Release pin after drag so node still floats with simulation
          d.fx = null;
          d.fy = null;
        })
    );

  // Node circle
  nodeSelection
    .append("circle")
    .attr("class", "node-circle")
    .attr("r", (d) => radiusScale(d.degree))
    .attr("fill", (d) => TYPE_COLORS[d.type] || TYPE_COLORS.default)
    .attr("fill-opacity", 0.88)
    .attr("stroke", (d) => TIER_STROKES[d.tier] || TIER_STROKES.default)
    .attr("stroke-width", (d) => (d.tier === "legendary" ? 3 : d.tier === "major" ? 1.5 : 0.8));

  // Node label — only show for nodes with degree >= 3 to avoid clutter
  nodeSelection
    .append("text")
    .attr("class", "node-label")
    .attr("dy", (d) => radiusScale(d.degree) + 12)
    .attr("text-anchor", "middle")
    .attr("pointer-events", "none")
    .text((d) => (d.degree >= 3 ? d.name : ""))
    .attr("fill", "#111111")
    .attr("font-size", (d) =>
      d.tier === "legendary" ? "13px" : d.tier === "major" ? "11px" : "9px"
    )
    .attr("font-family", "'Share Tech Mono', 'Courier New', monospace");

  // -------------------------------------------------------------------------
  // Simulation tick callback
  // -------------------------------------------------------------------------

  simulation.on("tick", () => {
    linkSelection
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);

    nodeSelection.attr("transform", (d) => `translate(${d.x},${d.y})`);
  });

  // -------------------------------------------------------------------------
  // Interaction state
  // -------------------------------------------------------------------------

  /** ID of the currently selected/hovered node, or null. */
  let activeNodeId = null;

  /**
   * Compute the set of node IDs that are direct neighbours of the given node.
   *
   * @param {string} nodeId
   * @returns {Set<string>}
   */
  function getNeighbourIds(nodeId) {
    const neighbours = new Set([nodeId]);
    for (const link of graph.links) {
      const sid = link.source.id ?? link.source;
      const tid = link.target.id ?? link.target;
      if (sid === nodeId) neighbours.add(tid);
      if (tid === nodeId) neighbours.add(sid);
    }
    return neighbours;
  }

  /**
   * Highlight a node and its direct neighbourhood; dim everything else.
   * Call with null to reset all highlighting.
   *
   * @param {string|null} nodeId
   */
  function highlight(nodeId) {
    activeNodeId = nodeId;

    if (nodeId === null) {
      // Reset all visual states
      nodeSelection
        .transition()
        .duration(cfg.transitionDuration)
        .attr("opacity", 1);
      nodeSelection
        .select("circle")
        .transition()
        .duration(cfg.transitionDuration)
        .attr("filter", null);
      linkSelection
        .transition()
        .duration(cfg.transitionDuration)
        .attr("stroke-opacity", cfg.linkBaseOpacity);
      return;
    }

    const neighbours = getNeighbourIds(nodeId);

    // Dim non-neighbours
    nodeSelection
      .transition()
      .duration(cfg.transitionDuration)
      .attr("opacity", (d) => (neighbours.has(d.id) ? 1 : 0.08));

    // Glow on the selected node
    nodeSelection
      .select("circle")
      .transition()
      .duration(cfg.transitionDuration)
      .attr("filter", (d) =>
        d.id === nodeId ? "url(#glow)" : null
      );

    // Highlight incident links, dim others
    linkSelection
      .transition()
      .duration(cfg.transitionDuration)
      .attr("stroke-opacity", (d) => {
        const sid = d.source.id ?? d.source;
        const tid = d.target.id ?? d.target;
        return sid === nodeId || tid === nodeId
          ? cfg.linkHighlightOpacity
          : 0.03;
      });
  }

  // -------------------------------------------------------------------------
  // Node click / hover event wiring
  // -------------------------------------------------------------------------

  nodeSelection
    .on("mouseenter", (event, d) => {
      highlight(d.id);
      // Dispatch custom event so the UI panel can react
      container.dispatchEvent(
        new CustomEvent("node:hover", { detail: d, bubbles: true })
      );
    })
    .on("mouseleave", () => {
      // Only reset if no node is pinned (clicked)
      if (activeNodeId === null || document.querySelector(".node--pinned") === null) {
        highlight(null);
        container.dispatchEvent(
          new CustomEvent("node:hover", { detail: null, bubbles: true })
        );
      }
    })
    .on("click", (event, d) => {
      event.stopPropagation();
      // Toggle pin: clicking the same node twice unpins it
      const wasPinned = d3.select(event.currentTarget).classed("node--pinned");
      nodeSelection.classed("node--pinned", false);
      if (wasPinned) {
        highlight(null);
        container.dispatchEvent(
          new CustomEvent("node:select", { detail: null, bubbles: true })
        );
      } else {
        d3.select(event.currentTarget).classed("node--pinned", true);
        highlight(d.id);
        container.dispatchEvent(
          new CustomEvent("node:select", { detail: d, bubbles: true })
        );
      }
    });

  // Clicking the SVG background unpins everything
  svg.on("click", () => {
    nodeSelection.classed("node--pinned", false);
    highlight(null);
    container.dispatchEvent(
      new CustomEvent("node:select", { detail: null, bubbles: true })
    );
  });

  // -------------------------------------------------------------------------
  // Filter API
  // -------------------------------------------------------------------------

  /**
   * Filter the graph to dim elements not matching the given predicates.
   * Non-matching nodes and links are dimmed (low opacity).
   *
   * @param {function|object|null} predicates - Node predicate function, or object with nodePredicate and linkPredicate. Pass null to show all at full opacity.
   */
  function filter(predicates) {
    if (predicates === null) {
      nodeSelection.attr("opacity", 1);
      linkSelection.attr("opacity", cfg.linkBaseOpacity);
      return;
    }

    let nodePredicate, linkPredicate;
    if (typeof predicates === 'function') {
      // Backward compatibility: assume node predicate, and derive link predicate
      nodePredicate = predicates;
      linkPredicate = (d) => {
        const sid = d.source.id ?? d.source;
        const tid = d.target.id ?? d.target;
        return nodePredicate(d.source) && nodePredicate(d.target);
      };
    } else {
      nodePredicate = predicates.nodePredicate;
      linkPredicate = predicates.linkPredicate;
    }

    nodeSelection
      .transition()
      .duration(cfg.transitionDuration)
      .attr("opacity", (d) => (nodePredicate(d) ? 1 : 0.2));

    linkSelection
      .transition()
      .duration(cfg.transitionDuration)
      .attr("opacity", (d) => (linkPredicate(d) ? cfg.linkBaseOpacity : cfg.linkBaseOpacity * 0.2));
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  return {
    /** Highlight a node by ID (pass null to clear). */
    highlight,
    /** Filter visible nodes by predicate (pass null to show all). */
    filter,
    /** Reset zoom to identity transform. */
    resetZoom: () =>
      svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity),
    /** Fit zoom to show all nodes. */
    fitZoom: () => {
      const bounds = nodeSelection.data().reduce((acc, d) => {
        const r = radiusScale(d.degree);
        acc.xMin = Math.min(acc.xMin, d.x - r);
        acc.xMax = Math.max(acc.xMax, d.x + r);
        acc.yMin = Math.min(acc.yMin, d.y - r);
        acc.yMax = Math.max(acc.yMax, d.y + r);
        return acc;
      }, { xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity });

      const dx = bounds.xMax - bounds.xMin;
      const dy = bounds.yMax - bounds.yMin;
      const x = (bounds.xMin + bounds.xMax) / 2;
      const y = (bounds.yMin + bounds.yMax) / 2;
      const scale = Math.min(width / dx, height / dy) * 0.9; // 0.9 for padding
      const translate = [width / 2 - scale * x, height / 2 - scale * y];

      svg.transition().duration(600).call(
        zoom.transform,
        d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
      );
    },
    /** Remove the SVG and stop the simulation. */
    destroy: () => {
      simulation.stop();
      svg.remove();
    },
    /** Expose simulation for external control (e.g. reheat after data update). */
    simulation,
    /** Expose the selections for external styling. */
    selections: { nodes: nodeSelection, links: linkSelection },
  };
}

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createRenderer, TYPE_COLORS, TIER_STROKES };
} else {
  window.GraphRenderer = { createRenderer, TYPE_COLORS, TIER_STROKES };
}
