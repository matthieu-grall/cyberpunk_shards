/**
 * graph-builder.js
 * ----------------
 * Transforms raw shard + entity JSON datasets into a D3-ready graph structure.
 *
 * Output shape:
 *   { nodes: Node[], links: Link[] }
 *
 * Node: { id, name, type, tier, faction, degree, shardCount, shards[] }
 * Link: { source, target, weight, shardIds[] }
 */

"use strict";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalise an entity name string to a consistent entity ID.
 * Attempts to match against the known entities catalogue; falls back to a
 * slugified version of the name for unlisted entities.
 *
 * @param {string} name - Raw entity name as found in shard data.
 * @param {Map<string, object>} entityMap - Pre-built name → entity lookup.
 * @returns {string} Resolved entity ID.
 */
function resolveEntityId(name, entityMap) {
  const matched = entityMap.get(name.toLowerCase().trim());
  if (matched) return matched.id;
  // Fallback: generate a stable slug-based ID for unlisted entities
  return "ent_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/**
 * Build a name → entity lookup map from the entities array.
 *
 * @param {object[]} entitiesData - Array of entity objects from entities.json.
 * @returns {Map<string, object>} Case-insensitive name → entity map.
 */
function buildEntityMap(entitiesData) {
  const map = new Map();
  for (const entity of entitiesData) {
    map.set(entity.name.toLowerCase(), entity);
    // Also index common short-form aliases
    if (entity.name.includes(" ")) {
      const parts = entity.name.split(" ");
      // Last name only
      map.set(parts[parts.length - 1].toLowerCase(), entity);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Core graph construction
// ---------------------------------------------------------------------------

/**
 * Build a graph node set from all entities that appear in at least one shard.
 *
 * @param {object[]} shardsData - Raw shard objects.
 * @param {object[]} entitiesData - Reference entity catalogue.
 * @returns {{ nodeMap: Map<string, object>, entityMap: Map<string, object> }}
 */
function buildNodeSet(shardsData, entitiesData) {
  const entityMap = buildEntityMap(entitiesData);
  // entityId → node accumulator
  const nodeMap = new Map();

  for (const shard of shardsData) {
    for (const rawName of shard.entities_mentioned) {
      const id = resolveEntityId(rawName, entityMap);
      const catalogEntry = entityMap.get(rawName.toLowerCase().trim());

      if (!nodeMap.has(id)) {
        nodeMap.set(id, {
          id,
          name: catalogEntry ? catalogEntry.name : rawName,
          type: catalogEntry ? catalogEntry.type : "Individual",
          tier: catalogEntry ? catalogEntry.tier : "minor",
          faction: catalogEntry ? catalogEntry.faction : "Unknown",
          description: catalogEntry ? catalogEntry.description : "",
          // Computed during link pass:
          degree: 0,
          shardCount: 0,
          shards: [],
        });
      }

      const node = nodeMap.get(id);
      node.shardCount += 1;
      node.shards.push({
        id: shard.id,
        title: shard.title,
        category: shard.category,
      });
    }
  }

  return { nodeMap, entityMap };
}

/**
 * Infer one or more high-level relationship “types” from a shard's summary/title.
 * This is a lightweight heuristic (keywords-based) to help highlight the meaning
 * behind a co‑occurrence link.
 *
 * @param {object} shard
 * @returns {Set<string>} Relation types (e.g. "conflict", "alliance", "warning")
 */
function inferRelationTypesFromShard(shard) {
  const text = `${shard.title || ""} ${shard.summary || ""}`.toLowerCase();
  const types = new Set(["cooccurrence"]);

  const has = (words) => words.some((w) => text.includes(w));

  if (has(["warn", "warning", "avert", "alert"])) types.add("warning");
  if (has(["attack", "kill", "murder", "fight", "fight", "shoot", "assault", "destroy", "ambush"])) types.add("conflict");
  if (has(["ally", "alliance", "partner", "help", "assist", "support", "join", "team"])) types.add("alliance");
  if (has(["work", "employ", "hire", "boss", "employee", "agent", "contract", "deal"])) types.add("employment");
  if (has(["former", "ex-", "ex ", "discard", "abandon", "betray", "betrayal", "rival"])) types.add("rift");
  if (has(["leader", "leadership", "control", "rule", "power", "take over", "seize"])) types.add("power");
  if (has(["love", "marry", "relationship", "romance", "partner"])) types.add("romance");
  if (has(["family", "brother", "sister", "father", "mother", "son", "daughter"])) types.add("family");
  if (has(["psycho", "psychosis", "mental", "therapy", "clinic", "doctor", "patient"])) types.add("medical");

  return types;
}

/**
 * Build the edge (link) set by creating a co-occurrence edge between every
 * pair of entities within each shard.
 *
 * @param {object[]} shardsData - Raw shard objects.
 * @param {Map<string, object>} nodeMap - Pre-built node map.
 * @param {Map<string, object>} entityMap - Name → entity lookup.
 * @returns {Map<string, object>} Edge key → link object.
 */
function buildEdgeSet(shardsData, nodeMap, entityMap) {
  // "sourceId|targetId" → link accumulator
  const edgeMap = new Map();

  for (const shard of shardsData) {
    const ids = shard.entities_mentioned.map((name) =>
      resolveEntityId(name, entityMap)
    );

    // Create one edge per unique pair within the shard
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        // Canonical key: always sort so A–B and B–A map to the same edge
        const [a, b] = [ids[i], ids[j]].sort();
        const key = `${a}|${b}`;

        if (!edgeMap.has(key)) {
          edgeMap.set(key, {
            source: a,
            target: b,
            weight: 0,
            shardIds: [],
            relationTypes: new Set(),
          });
        }

        const edge = edgeMap.get(key);
        edge.weight += 1;
        edge.shardIds.push(shard.id);
        inferRelationTypesFromShard(shard).forEach((t) => edge.relationTypes.add(t));
      }
    }
  }

  return edgeMap;
}

/**
 * Compute degree centrality for every node by counting incident edges.
 *
 * @param {Map<string, object>} nodeMap
 * @param {Map<string, object>} edgeMap
 */
function computeDegrees(nodeMap, edgeMap) {
  for (const edge of edgeMap.values()) {
    if (nodeMap.has(edge.source)) nodeMap.get(edge.source).degree += 1;
    if (nodeMap.has(edge.target)) nodeMap.get(edge.target).degree += 1;
  }
}

// ---------------------------------------------------------------------------
// Community detection (Louvain-lite — label propagation)
// ---------------------------------------------------------------------------

/**
 * Assign community labels via a simple label-propagation pass.
 * This is a lightweight approximation; for production use a proper Louvain
 * implementation (e.g. graphology-communities-louvain).
 *
 * @param {object[]} nodes
 * @param {object[]} links
 * @returns {Map<string, number>} nodeId → communityId
 */
function detectCommunities(nodes, links) {
  // Initialise each node in its own community
  const community = new Map(nodes.map((n, i) => [n.id, i]));

  // Build adjacency for fast lookup
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const link of links) {
    adj.get(link.source)?.push(link.target);
    adj.get(link.target)?.push(link.source);
  }

  // 5 propagation passes (sufficient for small graphs)
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    // Shuffle order to avoid order bias
    const shuffled = [...nodes].sort(() => Math.random() - 0.5);

    for (const node of shuffled) {
      const neighbours = adj.get(node.id) || [];
      if (neighbours.length === 0) continue;

      // Vote: pick the most common community among neighbours
      const votes = new Map();
      for (const nid of neighbours) {
        const c = community.get(nid);
        votes.set(c, (votes.get(c) || 0) + 1);
      }

      const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
      if (best !== community.get(node.id)) {
        community.set(node.id, best);
        changed = true;
      }
    }

    if (!changed) break; // Converged early
  }

  // Re-index community IDs to be contiguous integers starting at 0
  const uniqueCommunities = [...new Set(community.values())];
  const reindex = new Map(uniqueCommunities.map((c, i) => [c, i]));
  for (const [id, c] of community) {
    community.set(id, reindex.get(c));
  }

  return community;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the complete graph from raw JSON data.
 *
 * @param {{ shards: object[] }} shardsJson - Parsed shards.json content.
 * @param {{ entities: object[] }} entitiesJson - Parsed entities.json content.
 * @returns {{ nodes: object[], links: object[], meta: object }} D3-ready graph.
 */
function buildGraph(shardsJson, entitiesJson) {
  const shardsData = shardsJson.shards;
  const entitiesData = entitiesJson.entities;

  // 1. Build node and edge sets
  const { nodeMap, entityMap } = buildNodeSet(shardsData, entitiesData);
  const edgeMap = buildEdgeSet(shardsData, nodeMap, entityMap);

  // 2. Compute degree centrality
  computeDegrees(nodeMap, edgeMap);

  // 3. Materialise arrays (filter out isolated nodes with no edges)
  const links = [...edgeMap.values()];
  const connectedIds = new Set(links.flatMap((l) => [l.source, l.target]));

  const nodes = [...nodeMap.values()].filter(
    (n) => connectedIds.has(n.id) || n.shardCount > 1
  );

  // 4. Detect communities
  const communities = detectCommunities(nodes, links);
  for (const node of nodes) {
    node.community = communities.get(node.id) ?? 0;
  }

  // 5. Build shard lookup for tooltip enrichment
  const shardIndex = new Map(shardsData.map((s) => [s.id, s]));

  // 6. Attach shard details and inferred relation types to links
  for (const link of links) {
    link.shards = link.shardIds
      .map((sid) => shardIndex.get(sid))
      .filter(Boolean)
      .map((s) => ({ id: s.id, title: s.title, category: s.category }));

    // Convert internal Set to array for easier serialization + rendering.
    if (link.relationTypes instanceof Set) {
      link.relationTypes = [...link.relationTypes];
    }
  }

  return {
    nodes,
    links,
    meta: {
      nodeCount: nodes.length,
      linkCount: links.length,
      maxDegree: Math.max(...nodes.map((n) => n.degree)),
      maxWeight: Math.max(...links.map((l) => l.weight)),
      communityCount: new Set(nodes.map((n) => n.community)).size,
    },
  };
}

// ---------------------------------------------------------------------------
// Module export (works both as ES module and as browser global)
// ---------------------------------------------------------------------------

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildGraph };
} else {
  window.GraphBuilder = { buildGraph };
}
