/**
 * view-timeline.js
 * ----------------
 * Lore chronology visualisation for the CP2077 Shard Network tool.
 *
 * Design:
 *   - Horizontal scrollable SVG timeline.
 *   - Era bands as coloured horizontal swim-lanes spanning the full date range.
 *   - Events plotted as vertical markers on a central axis, sized by importance.
 *   - Hover/click reveals a detail card with description, entities, and source shards.
 *   - Category filter and era filter chips in the toolbar (right-hand slot).
 *
 * Rendering approach:
 *   - D3 for scale + axis.
 *   - Pure SVG for the timeline body (no force simulation needed).
 *   - HTML overlay for detail cards (easier layout, no SVG foreignObject).
 */

"use strict";

// ---------------------------------------------------------------------------
// Sidebar HTML template
// ---------------------------------------------------------------------------

const SIDEBAR_HTML = `
  <aside class="sidebar" id="timeline-sidebar" aria-label="Event details">
    <section class="sidebar__section" aria-labelledby="event-heading">
      <h2 class="sidebar__section-title" id="event-heading">Event details</h2>
      <div id="event-panel" aria-live="polite"></div>
    </section>
  </aside>`;

const TL = {
  MARGIN:       { top: 60, right: 80, bottom: 50, left: 150 },
  ROW_HEIGHT:   80,     // px per era swim-lane
  AXIS_Y:       null,   // computed at mount
  DOT_RADIUS:   { confirmed: 9, inferred: 6 },
  YEAR_MIN:     1985,
  YEAR_MAX:     2080,
  TICK_YEARS:   [1990, 2000, 2010, 2020, 2030, 2040, 2050, 2060, 2070, 2077],
};

// Category colour map (consistent with cluster colours where overlapping)
const CATEGORY_COLORS = {
  Corporate:     "#e6a817",
  Military:      "#b07af5",
  Political:     "#f4a261",
  Technology:    "#67d4a8",
  Cultural:      "#f78fb3",
  Social:        "#7eb8f7",
  Personal:      "#aaaaaa",
  Economic:      "#8bc34a",
  Institutional: "#4dd0e1",
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _svg      = null;
let _tooltip  = null;
let _activeId = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an SVG path string for a vertical teardrop / lozenge marker.
 *
 * @param {number} cx - Centre x.
 * @param {number} cy - Centre y (top of axis line).
 * @param {number} r  - Radius.
 * @returns {string}
 */
function markerPath(cx, cy, r) {
  return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r} Z`;
}

/**
 * Clamp a value between min and max.
 */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function shardUrl(shard) {
  if (!shard || !shard.title) return "";
  const title = shard.title.replace(/ /g, "_").replace(/:/g, "");
  return `https://cyberpunk.fandom.com/wiki/${encodeURIComponent(title)}`;
}

// ---------------------------------------------------------------------------
// Detail card
// ---------------------------------------------------------------------------

/**
 * Show or hide the event details in the sidebar.
 *
 * @param {object|null} event - Timeline event object, or null to hide.
 * @param {object[]}    shards - Full shard array for cross-ref.
 */
function showCard(event, shards) {
  const panel = document.getElementById("event-panel");
  if (!panel) return;

  if (!event) {
    panel.innerHTML = "<p>Select an event to view details.</p>";
    _activeId = null;
    return;
  }

  _activeId = event.id;

  // Source shards
  const sourceShardsHtml = (event.source_shards || [])
    .map((sid) => {
      const s = shards.find((sh) => sh.id === sid);
      return s
        ? `<li class="tl-card__shard"><a class="tl-card__shard-link" href="${shardUrl(s)}" target="_blank" rel="noopener">${s.title}</a></li>`
        : `<li class="tl-card__shard tl-card__shard--missing">${sid}</li>`;
    })
    .join("");

  // Entities
  const entitiesHtml = (event.entities || [])
    .map((e) => `<span class="tl-card__tag">${e}</span>`)
    .join("");

  panel.innerHTML = `
    <div class="tl-card__header">
      <span class="tl-card__year">${event.year}${event.year_end ? "–" + event.year_end : ""}</span>
      <span class="tl-card__cat" style="color:${CATEGORY_COLORS[event.category] || "#aaa"}">${event.category}</span>
      <span class="tl-card__certainty tl-card__certainty--${event.certainty}">${event.certainty}</span>
    </div>
    <h3 class="tl-card__title">${event.label}</h3>
    <p class="tl-card__desc">${event.description}</p>
    ${entitiesHtml ? `<div class="tl-card__entities">${entitiesHtml}</div>` : ""}
    ${sourceShardsHtml ? `<p class="tl-card__shards-label">Source shards</p><ul class="tl-card__shards">${sourceShardsHtml}</ul>` : ""}`;
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

/**
 * Render the timeline into the given container element.
 *
 * @param {HTMLElement} container
 * @param {object}      tlData    - Parsed timeline.json content.
 * @param {object[]}    shards    - Parsed shards array.
 */
function renderTimeline(container, tlData, shards) {
  // Clear previous content
  container.innerHTML = "";

  const events = tlData.events;
  const eras   = tlData._meta.eras;

  // -------------------------------------------------------------------------
  // Layout calculations
  // -------------------------------------------------------------------------

  const totalW  = Math.max(container.clientWidth, 1200);
  const eraH    = TL.ROW_HEIGHT;
  const totalH  = TL.MARGIN.top + eras.length * eraH + TL.MARGIN.bottom;
  const innerW  = totalW - TL.MARGIN.left - TL.MARGIN.right;

  // Year → x scale
  const xScale = d3
    .scaleLinear()
    .domain([TL.YEAR_MIN, TL.YEAR_MAX])
    .range([0, innerW]);

  // Era label → y mid-point
  const eraYMid = (eraId) => {
    const idx = eras.findIndex((e) => e.id === eraId);
    return TL.MARGIN.top + idx * eraH + eraH / 2;
  };

  // -------------------------------------------------------------------------
  // SVG scaffold
  // -------------------------------------------------------------------------

  const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgEl.setAttribute("width",   totalW);
  svgEl.setAttribute("height",  totalH);
  svgEl.setAttribute("viewBox", `0 0 ${totalW} ${totalH}`);
  svgEl.setAttribute("aria-label", "CP2077 lore chronology");
  container.appendChild(svgEl);

  _svg = d3.select(svgEl);

  const g = _svg.append("g")
    .attr("transform", `translate(${TL.MARGIN.left},0)`);

  // -------------------------------------------------------------------------
  // Era swim-lanes
  // -------------------------------------------------------------------------

  eras.forEach((era, i) => {
    const y = TL.MARGIN.top + i * eraH;

    // Background band
    g.append("rect")
      .attr("x", 0)
      .attr("y", y)
      .attr("width", innerW)
      .attr("height", eraH)
      .attr("fill", era.color)
      .attr("fill-opacity", i % 2 === 0 ? 0.07 : 0.04)
      .attr("class", "tl-era-band");

    // Era label (left margin)
    g.append("text")
      .attr("x", -8)
      .attr("y", y + eraH / 2)
      .attr("text-anchor", "end")
      .attr("dominant-baseline", "central")
      .attr("fill", era.color)
      .attr("font-size", "10px")
      .attr("font-family", "'Share Tech Mono', monospace")
      .attr("opacity", 0.8)
      .text(era.label);
  });

  // -------------------------------------------------------------------------
  // Horizontal axis line
  // -------------------------------------------------------------------------

  const axisY = TL.MARGIN.top + eras.length * eraH;

  g.append("line")
    .attr("x1", 0).attr("x2", innerW)
    .attr("y1", axisY).attr("y2", axisY)
    .attr("stroke", "rgba(0,0,0,0.12)")
    .attr("stroke-width", 1);

  // Year tick marks
  TL.TICK_YEARS.forEach((year) => {
    const x = xScale(year);

    g.append("line")
      .attr("x1", x).attr("x2", x)
      .attr("y1", TL.MARGIN.top).attr("y2", axisY + 6)
      .attr("stroke", "rgba(0,0,0,0.08)")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", year === 2077 ? "none" : "4 4");

    g.append("text")
      .attr("x", x)
      .attr("y", axisY + 18)
      .attr("text-anchor", "middle")
      .attr("fill", year === 2077 ? "#b07a17" : "#555555")
      .attr("font-size", year === 2077 ? "11px" : "10px")
      .attr("font-family", "'Share Tech Mono', monospace")
      .attr("font-weight", year === 2077 ? "bold" : "normal")
      .text(year);
  });

  // -------------------------------------------------------------------------
  // Event markers
  // -------------------------------------------------------------------------

  // Stack events within the same year to avoid overlap
  const yearBuckets = new Map();
  events.forEach((evt) => {
    const bucket = yearBuckets.get(evt.year) || [];
    bucket.push(evt);
    yearBuckets.set(evt.year, bucket);
  });

  const dotGroup = g.append("g").attr("class", "tl-dots");

  events.forEach((evt) => {
    const bucket = yearBuckets.get(evt.year);
    const stackIdx = bucket.indexOf(evt);
    const x = xScale(evt.year);
    const yMid = eraYMid(evt.era);

    // Vertical stagger offset so events in the same year don't overlap
    const yOffset = (stackIdx - (bucket.length - 1) / 2) * 25;
    const cy = clamp(yMid + yOffset, TL.MARGIN.top + 14, axisY - 14);

    const r = evt.certainty === "confirmed"
      ? TL.DOT_RADIUS.confirmed
      : TL.DOT_RADIUS.inferred;

    const fill = CATEGORY_COLORS[evt.category] || "#aaa";

    // Connector line from dot to axis
    dotGroup.append("line")
      .attr("x1", x).attr("x2", x)
      .attr("y1", cy + r).attr("y2", axisY)
      .attr("stroke", fill)
      .attr("stroke-width", 0.5)
      .attr("stroke-opacity", 0.3)
      .attr("class", `tl-connector tl-connector--${evt.id}`);

    // Dot
    const dot = dotGroup.append("circle")
      .attr("class", `tl-dot tl-dot--${evt.certainty}`)
      .attr("data-id", evt.id)
      .attr("cx", x)
      .attr("cy", cy)
      .attr("r", r)
      .attr("fill", fill)
      .attr("fill-opacity", 0.85)
      .attr("stroke", evt.certainty === "confirmed" ? "#fff" : fill)
      .attr("stroke-width", evt.certainty === "confirmed" ? 1.5 : 1)
      .attr("stroke-opacity", 0.6)
      .attr("stroke-dasharray", evt.certainty === "inferred" ? "3 2" : "none")
      .style("cursor", "pointer");

    // Year label for important events
    if (evt.certainty === "confirmed") {
      const shortLabel = evt.label.length > 20 ? evt.label.substring(0, 17) + "..." : evt.label;
      dotGroup.append("text")
        .attr("x", x)
        .attr("y", cy - r - 4)
        .attr("text-anchor", "middle")
        .attr("fill", fill)
        .attr("font-size", "9px")
        .attr("font-family", "'Share Tech Mono', monospace")
        .attr("opacity", 0.7)
        .attr("pointer-events", "none")
        .text(shortLabel);
    }

    // Interaction
    dot
      .on("mouseenter", function () {
        if (_activeId !== evt.id) {
          d3.select(this)
            .transition().duration(120)
            .attr("r", r * 1.5)
            .attr("fill-opacity", 1);
        }
        // Show brief label near the dot
        const labelEl = dotGroup.append("text")
          .attr("class", "tl-hover-label")
          .attr("x", x + r + 5)
          .attr("y", cy + 4)
          .attr("fill", "#111111")
          .attr("font-size", "11px")
          .attr("font-family", "'Share Tech Mono', monospace")
          .attr("pointer-events", "none")
          .text(evt.label);

        // Ensure label doesn't overflow right edge
        const bbox = labelEl.node().getBBox();
        if (x + r + 5 + bbox.width > innerW - 10) {
          labelEl.attr("x", x - r - 5).attr("text-anchor", "end");
        }
      })
      .on("mouseleave", function () {
        if (_activeId !== evt.id) {
          d3.select(this)
            .transition().duration(120)
            .attr("r", r)
            .attr("fill-opacity", 0.85);
        }
        dotGroup.selectAll(".tl-hover-label").remove();
      })
      .on("click", function () {
        dotGroup.selectAll(".tl-dot")
          .classed("tl-dot--active", (d, i, nodes) =>
            nodes[i].getAttribute("data-id") === evt.id
          )
          .classed("tl-dot--dim", (d, i, nodes) =>
            nodes[i].getAttribute("data-id") !== evt.id
          );
        showCard(evt, shards);
      });
  });
}

// ---------------------------------------------------------------------------
// View handler
// ---------------------------------------------------------------------------

const TimelineView = {

  mount(container, data) {
    container.style.display = "flex";

    container.innerHTML = `
      <div class="timeline-main">
        <div class="timeline-wrap" id="timeline-wrap">
          <div class="timeline-scroll" id="timeline-scroll"></div>
        </div>
      </div>
      ${SIDEBAR_HTML}`;

    const scrollEl = document.getElementById("timeline-scroll");
    scrollEl.style.overflowX = "auto";
    scrollEl.style.overflowY = "hidden";
    scrollEl.style.width = "100%";
    scrollEl.style.height = "100%";
    scrollEl.style.position = "relative";

    // Defer render by one animation frame so the scroll container has real
    // clientWidth before renderTimeline reads it.
    requestAnimationFrame(() => {
      if (document.getElementById("timeline-scroll")) {
        renderTimeline(scrollEl, data.timeline, data.shards);
      }
    });
  },

  unmount() {
    _svg = null;
    _activeId = null;
    const container = document.querySelector("#view-container");
    if (container) container.style.display = "";
  },
};

// ---------------------------------------------------------------------------
// Registration + export
// ---------------------------------------------------------------------------

if (typeof window !== "undefined" && window.ViewManager) {
  ViewManager.registerView("timeline", "Lore Timeline", TimelineView);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { TimelineView };
} else {
  window.TimelineView = TimelineView;
}
