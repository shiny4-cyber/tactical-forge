// The navigation graph: nodes from map.js, edges only where a body can walk, and A* over it.
// Edges are built once from a walkability test (a body's footprint along the line), so a
// doorway is an edge and a crate is not. All arrays are reused between searches; a path is a small array of node indices.
import { NODES, EXTRA_EDGES, MAP } from './map.js';
import { WORLD, walkClear, spotClear } from './collision.js';

const MAX_EDGE = 6.4;
const GRID_STEP = 3.0;

// A hand-authored node can land on a crate corner after the map is tuned. Snap it to the
// nearest floor a body fits on, so the graph never asks a bot to stand inside geometry.
function snapToFloor(node, maxRadius = 3) {
  if (spotClear(WORLD, node.x, node.z)) return { x: node.x, z: node.z };
  for (let radius = 0.25; radius <= maxRadius; radius += 0.25) {
    for (let step = 0; step < 32; step += 1) {
      const angle = (step / 32) * Math.PI * 2;
      const x = node.x + Math.cos(angle) * radius;
      const z = node.z + Math.sin(angle) * radius;
      if (spotClear(WORLD, x, z)) return { x, z };
    }
  }
  return { x: node.x, z: node.z };
}

// The authored nodes give the graph its meaning (doors, holds, sites). The grid gives it the
// density to route around a crate without a hand-placed waypoint for every corner: on a
// 3 m lattice over the floor, a walkable cell becomes a node unless a door or hold is already
// within 1.6 m of it.
function gridNodes(authored) {
  const out = [];
  for (let x = MAP.bounds.minX + 1.5; x <= MAP.bounds.maxX - 1.5; x += GRID_STEP) {
    for (let z = MAP.bounds.minZ + 1.5; z <= MAP.bounds.maxZ - 1.5; z += GRID_STEP) {
      let near = false;
      for (const node of authored) {
        if (Math.hypot(node.x - x, node.z - z) < 0.75) {
          near = true;
          break;
        }
      }
      if (near) continue;
      if (!spotClear(WORLD, x, z)) continue;
      out.push({ id: `g${out.length}`, x, z, lane: 'grid' });
    }
  }
  return out;
}

export function buildGraph(authored = NODES) {
  const graph = { nodes: [], edges: [], byId: new Map() };
  const snapped = authored.map((node) => ({ ...node, ...snapToFloor(node) }));
  const all = snapped.concat(gridNodes(snapped));
  for (let i = 0; i < all.length; i += 1) {
    const node = { ...all[i], index: i, links: [], hold: all[i].hold ?? null };
    graph.nodes.push(node);
    graph.edges.push([]);
    graph.byId.set(node.id, node);
  }
  const addEdge = (a, b) => {
    if (a === b) return;
    if (graph.edges[a].includes(b)) return;
    graph.edges[a].push(b);
    graph.edges[b].push(a);
  };
  for (let i = 0; i < graph.nodes.length; i += 1) {
    for (let j = i + 1; j < graph.nodes.length; j += 1) {
      const a = graph.nodes[i];
      const b = graph.nodes[j];
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      if (dx * dx + dz * dz > MAX_EDGE * MAX_EDGE) continue;
      if (!walkClear(WORLD, a.x, a.z, b.x, b.z)) continue;
      addEdge(i, j);
    }
  }
  for (const [aId, bId] of EXTRA_EDGES) {
    const a = graph.byId.get(aId);
    const b = graph.byId.get(bId);
    if (!a || !b) continue;
    // A hand-written edge is a hint, not an exemption: a crate moved onto the line must break
    // the edge, or the bots grind against it forever.
    if (!walkClear(WORLD, a.x, a.z, b.x, b.z)) continue;
    addEdge(a.index, b.index);
  }
  for (let i = 0; i < graph.nodes.length; i += 1) {
    graph.nodes[i].links = graph.edges[i];
  }
  return graph;
}

export const GRAPH = buildGraph();

export function nearestNode(graph, x, z, filter = null) {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < graph.nodes.length; i += 1) {
    const node = graph.nodes[i];
    if (filter && !filter(node)) continue;
    const dx = node.x - x;
    const dz = node.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

// A* with a binary heap. The scratch arrays live in the module and are reset by stamp, so a
// re-path costs no allocation after the first search.
const heap = new Int32Array(8192);
const heapScore = new Float64Array(8192);
const gScore = new Float64Array(512);
const cameFrom = new Int32Array(512);
const stamp = new Int32Array(512);
let stampCounter = 0;

function heapPush(node, score, size) {
  let i = size;
  heap[i] = node;
  heapScore[i] = score;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heapScore[parent] <= heapScore[i]) break;
    const tn = heap[parent];
    const ts = heapScore[parent];
    heap[parent] = heap[i];
    heapScore[parent] = heapScore[i];
    heap[i] = tn;
    heapScore[i] = ts;
    i = parent;
  }
  return size + 1;
}

function heapPop(size) {
  const top = heap[0];
  size -= 1;
  heap[0] = heap[size];
  heapScore[0] = heapScore[size];
  let i = 0;
  for (;;) {
    const left = i * 2 + 1;
    if (left >= size) break;
    const right = left + 1;
    let smallest = left;
    if (right < size && heapScore[right] < heapScore[left]) smallest = right;
    if (heapScore[i] <= heapScore[smallest]) break;
    const tn = heap[i];
    const ts = heapScore[i];
    heap[i] = heap[smallest];
    heapScore[i] = heapScore[smallest];
    heap[smallest] = tn;
    heapScore[smallest] = ts;
    i = smallest;
  }
  return top;
}

export function findPath(graph, startIndex, goalIndex) {
  if (startIndex < 0 || goalIndex < 0) return null;
  if (startIndex === goalIndex) return [startIndex];
  stampCounter += 1;
  const goal = graph.nodes[goalIndex];
  let size = 0;
  const start = graph.nodes[startIndex];
  stamp[startIndex] = stampCounter;
  gScore[startIndex] = 0;
  cameFrom[startIndex] = -1;
  size = heapPush(startIndex, 0, size);
  let guard = 0;
  while (size > 0 && guard < 16384) {
    guard += 1;
    const current = heapPop(size);
    size -= 1;
    if (current === goalIndex) {
      const path = [];
      let node = current;
      while (node !== -1) {
        path.push(node);
        node = cameFrom[node];
      }
      path.reverse();
      return path;
    }
    const node = graph.nodes[current];
    const baseScore = gScore[current] + 1;
    for (const next of node.links) {
      const candidate = baseScore + Math.hypot(graph.nodes[next].x - node.x, graph.nodes[next].z - node.z);
      if (stamp[next] === stampCounter && candidate >= gScore[next]) continue;
      stamp[next] = stampCounter;
      gScore[next] = candidate;
      cameFrom[next] = current;
      const h = Math.hypot(graph.nodes[next].x - goal.x, graph.nodes[next].z - goal.z);
      size = heapPush(next, candidate + h, size);
    }
  }
  return null;
}

// Node indices on the two lanes and the rotate, exposed for the tests and for the bots' route
// choice: a route is a lane id, and the site it ends at.
export function routeTo(graph, lane, site) {
  const wants = [];
  for (const node of graph.nodes) {
    if (lane === 'west' && (node.lane === 'west' || node.id === 's1')) wants.push(node.index);
    if (lane === 'east' && (node.lane === 'east' || node.id === 's2')) wants.push(node.index);
  }
  const siteNode = graph.nodes.find((node) => node.site === site);
  const laneEnd = wants.length ? wants[wants.length - 1] : nearestNode(graph, MAP.attackerSpawn.x, MAP.attackerSpawn.z);
  if (!siteNode) return null;
  return { entry: laneEnd, site: siteNode.index, path: findPath(graph, laneEnd, siteNode.index) };
}
