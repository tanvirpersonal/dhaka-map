// Export everything a game needs besides the visuals: building colliders, a road graph for traffic AI
// and spawn points, as one JSON file. Units: meters, x = east, z = south, y = up, origin = area center.

import { state } from '../core/state.js';
import { makeProjection } from '../data/projection.js';

// Rough left-hand-traffic regions: [south, west, north, east]. Override with exportGameData({drivingSide}).
const LEFT_REGIONS = [
  [5, 60, 38, 98],      // South Asia (Bangladesh, India, Pakistan, Sri Lanka, Nepal)
  [49, -11, 61, 2],     // UK + Ireland
  [24, 122, 46, 146],   // Japan
  [-48, 110, -9, 179],  // Australia + New Zealand
  [-11, 95, 21, 120],   // SE Asia (Thailand, Malaysia, Indonesia)
];

export function guessDrivingSide(area) {
  const lat = (area.south + area.north) / 2, lon = (area.west + area.east) / 2;
  return LEFT_REGIONS.some(([s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e) ? 'left' : 'right';
}

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const polyLen = (pts) => pts.reduce((l, p, i) => (i ? l + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

/**
 * Road graph: nodes at intersections/dead ends, edges between them following the road geometry.
 * Intersections = OSM nodes shared by 2+ road ways (needs road.nodeIds); older projects fall back
 * to endpoints snapped to a 0.5 m grid.
 */
export function buildRoadGraph(roads) {
  const drivable = roads.filter((r) => r.drivable && r.points.length >= 2);
  const useCount = new Map();
  for (const r of drivable) {
    const ids = r.nodeIds?.length === r.points.length ? r.nodeIds : null;
    if (!ids) continue;
    new Set(ids).forEach((id) => useCount.set(id, (useCount.get(id) || 0) + 1));
  }

  const nodes = new Map(); // key -> {id, x, z}
  const nodeFor = (key, p) => {
    if (!nodes.has(key)) nodes.set(key, { id: `n${nodes.size}`, x: round(p[0]), z: round(p[1]) });
    return nodes.get(key);
  };
  const snapKey = (p) => `s${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;

  const edges = [];
  for (const r of drivable) {
    const ids = r.nodeIds?.length === r.points.length ? r.nodeIds : null;
    const keyAt = (i) => (ids ? `o${ids[i]}` : snapKey(r.points[i]));
    const breaks = [0];
    for (let i = 1; i < r.points.length - 1; i++) if (ids && useCount.get(ids[i]) >= 2) breaks.push(i);
    breaks.push(r.points.length - 1);

    for (let b = 1; b < breaks.length; b++) {
      const pts = r.points.slice(breaks[b - 1], breaks[b] + 1);
      const from = nodeFor(keyAt(breaks[b - 1]), pts[0]);
      const to = nodeFor(keyAt(breaks[b]), pts[pts.length - 1]);
      if (from === to && pts.length < 3) continue;
      edges.push({
        id: `e${edges.length}`, road: r.id, name: r.name || undefined, kind: r.kind,
        from: from.id, to: to.id, length: round(polyLen(pts)), width: r.width, lanes: r.lanes,
        oneway: r.oneway, maxspeed: r.maxspeed || undefined,
        points: pts.map(([x, z]) => [round(x), round(z)]),
      });
    }
  }
  return { nodes: [...nodes.values()], edges };
}

/** Evenly spaced points along an edge, offset to the driving lane. Heading = atan2(dx, dz) (+z = 0 rad). */
function vehicleSpawns(edges, side) {
  const out = [];
  for (const e of edges) {
    if (e.length < 25) continue;
    const n = Math.max(1, Math.floor(e.length / 80));
    for (let k = 0; k < n; k++) {
      let target = (e.length * (k + 0.5)) / n, acc = 0;
      for (let i = 1; i < e.points.length; i++) {
        const [x0, z0] = e.points[i - 1], [x1, z1] = e.points[i];
        const seg = Math.hypot(x1 - x0, z1 - z0);
        if (acc + seg >= target && seg > 0) {
          const t = (target - acc) / seg, dx = (x1 - x0) / seg, dz = (z1 - z0) / seg;
          // With north up (-z), (-dz, dx) is the RIGHT of travel. Left-hand traffic uses the opposite lane;
          // one-way roads use the center.
          const lane = e.oneway ? 0 : e.width / 4;
          const sgn = side === 'left' ? -1 : 1;
          out.push({
            x: round(x0 + (x1 - x0) * t + -dz * lane * sgn), z: round(z0 + (z1 - z0) * t + dx * lane * sgn),
            heading: round(Math.atan2(dx, dz), 3), edge: e.id,
          });
          break;
        }
        acc += seg;
      }
    }
  }
  return out;
}

function pedestrianSpawns(roads) {
  const out = [];
  for (const r of roads) {
    if (r.kind !== 'footpath' || r.points.length < 2) continue;
    let carry = 10;
    for (let i = 1; i < r.points.length; i++) {
      const [x0, z0] = r.points[i - 1], [x1, z1] = r.points[i];
      const seg = Math.hypot(x1 - x0, z1 - z0);
      for (let d = carry; d < seg; d += 30) out.push({ x: round(x0 + ((x1 - x0) * d) / seg), z: round(z0 + ((z1 - z0) * d) / seg) });
      carry = ((carry - seg) % 30 + 30) % 30;
    }
  }
  return out;
}

export async function buildGameData(opts = {}) {
  const d = state.cityData;
  if (!d) throw new Error('Generate a city first.');
  const { findBuildingObject } = await import('../world/assetReplacer.js');
  const { unproject } = makeProjection(d.area);
  const [lat0, lon0] = unproject(0, 0);
  const drivingSide = opts.drivingSide || guessDrivingSide(d.area);
  const graph = buildRoadGraph(d.roads);

  return {
    format: 'city-builder-gamedata', version: 1,
    units: 'meters; x=east, z=south, y=up; origin=area center; heading=atan2(dx,dz)',
    origin: { lat: lat0, lon: lon0 }, area: d.area,
    bounds: { minX: round(d.bounds.minX), maxX: round(d.bounds.maxX), minZ: round(d.bounds.minZ), maxZ: round(d.bounds.maxZ) },
    drivingSide,
    buildings: d.buildings.map((b) => ({
      id: b.id, kind: b.kind, height: round(b.height), levels: b.levels,
      asset: findBuildingObject(b.id)?.userData.assetId || null,
      footprint: b.footprint.map(([x, z]) => [round(x), round(z)]),
    })),
    roadGraph: graph,
    spawnPoints: { vehicles: vehicleSpawns(graph.edges, drivingSide), pedestrians: pedestrianSpawns(d.roads) },
  };
}

export async function exportGameData(opts) {
  const data = await buildGameData(opts);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = 'city-gamedata.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return {
    buildings: data.buildings.length, nodes: data.roadGraph.nodes.length, edges: data.roadGraph.edges.length,
    vehicleSpawns: data.spawnPoints.vehicles.length, pedestrianSpawns: data.spawnPoints.pedestrians.length, drivingSide: data.drivingSide,
  };
}
