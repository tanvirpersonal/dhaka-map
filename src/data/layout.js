// Layout clean-up: keeps buildings off the roads (carriageway + sidewalk + margin).
//
// OSM footprints and guessed road widths often disagree, so raw data puts building corners (or whole
// buildings) on the asphalt. This runs once, in meters, before anything is built:
//   1. sample each footprint (corners, edge points, interior grid)
//   2. find the deepest sample inside any road corridor
//   3. slide the whole building away from that road (repeat, up to MAX_ITER)
//   4. if it still touches a road, shrink it toward its center; if it needed a big move, drop it
// Everything downstream (boxes, asset modules, colliders, trees, game export) then sees clean data.

const WALK_WIDTH = 2.2;                       // keep in sync with sidewalks.js
const NO_SIDEWALK = new Set(['service', 'track', 'motorway', 'trunk']);
const MARGIN = 0.8;                           // extra gap between sidewalk edge and wall
const CELL = 30;
const MAX_ITER = 14;
const MAX_SHIFT = 7;                          // meters; a bigger move means the data is wrong: drop it
const TOL = 0.05;

/** Half-width of the strip a road occupies, including its sidewalk. */
export function roadClearance(road) {
  const half = (road.width || 4) / 2;
  if (!road.drivable) return half + 0.4;
  return half + (NO_SIDEWALK.has(road.highway) ? 0 : WALK_WIDTH) + MARGIN;
}

function buildRoadIndex(roads) {
  const segs = [], grid = new Map();
  for (const r of roads) {
    if (!r.points || r.points.length < 2 || r.bridge || r.tunnel) continue;
    const clear = roadClearance(r);
    for (let i = 1; i < r.points.length; i++) {
      const [x0, z0] = r.points[i - 1], [x1, z1] = r.points[i];
      const id = segs.length;
      segs.push({ x0, z0, ex: x1 - x0, ez: z1 - z0, clear });
      const pad = clear;
      const ax = Math.floor((Math.min(x0, x1) - pad) / CELL), bx = Math.floor((Math.max(x0, x1) + pad) / CELL);
      const az = Math.floor((Math.min(z0, z1) - pad) / CELL), bz = Math.floor((Math.max(z0, z1) + pad) / CELL);
      for (let cx = ax; cx <= bx; cx++) for (let cz = az; cz <= bz; cz++) {
        const k = `${cx},${cz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(id);
      }
    }
  }
  /** Deepest intrusion into any corridor at (x,z): { pen, nx, nz } (normal points away from the road). */
  return function intrusion(x, z, refX, refZ) {
    let best = null;
    for (const id of grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) || []) {
      const s = segs[id];
      const len2 = s.ex * s.ex + s.ez * s.ez || 1;
      const t = Math.max(0, Math.min(1, ((x - s.x0) * s.ex + (z - s.z0) * s.ez) / len2));
      const px = s.x0 + s.ex * t, pz = s.z0 + s.ez * t;
      let dx = x - px, dz = z - pz;
      const d = Math.hypot(dx, dz);
      const pen = s.clear - d;
      if (pen <= 0 || (best && pen <= best.pen)) continue;
      if (d > 1e-3) { dx /= d; dz /= d; }
      else { // exactly on the centerline: push toward the side the building center is on
        const l = Math.sqrt(len2); dx = -s.ez / l; dz = s.ex / l;
        if (dx * (refX - px) + dz * (refZ - pz) < 0) { dx = -dx; dz = -dz; }
      }
      best = { pen, nx: dx, nz: dz };
    }
    return best;
  };
}

function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function centroid(poly) {
  let x = 0, z = 0;
  for (const p of poly) { x += p[0]; z += p[1]; }
  return [x / poly.length, z / poly.length];
}

/** Points that stand for the whole footprint: corners, points along edges, interior grid. */
function samplePoints(poly) {
  const pts = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
    minX = Math.min(minX, ax); maxX = Math.max(maxX, ax); minZ = Math.min(minZ, az); maxZ = Math.max(maxZ, az);
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
    for (let k = 0; k < n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  const step = Math.max(3, Math.sqrt(((maxX - minX) * (maxZ - minZ)) / 250));
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let z = minZ + step / 2; z < maxZ; z += step) if (pointInPolygon(x, z, poly)) pts.push([x, z]);
  }
  pts.push(centroid(poly));
  return pts;
}

function worst(samples, intrusion, c) {
  let w = null;
  for (const [x, z] of samples) {
    const hit = intrusion(x, z, c[0], c[1]);
    if (hit && hit.pen >= TOL && (!w || hit.pen > w.pen)) w = hit;
  }
  return w;
}

/**
 * Mutates data.buildings in place. Idempotent (a second run changes nothing).
 * @returns {{moved:number, shrunk:number, removed:number}}
 */
export function clearBuildingsFromRoads(data) {
  const stats = { moved: 0, shrunk: 0, removed: 0 };
  const intrusion = buildRoadIndex(data.roads);
  const kept = [];

  for (const b of data.buildings) {
    let poly = b.footprint.map((p) => [p[0], p[1]]);
    let c = centroid(poly);
    let samples = samplePoints(poly);
    if (!worst(samples, intrusion, c)) { kept.push(b); continue; }

    let shiftX = 0, shiftZ = 0, shrinks = 0, ok = false;
    for (let round = 0; round <= 3 && !ok; round++) {
      for (let it = 0; it < MAX_ITER; it++) {
        const w = worst(samples, intrusion, c);
        if (!w) { ok = true; break; }
        if (w.pen < TOL) { ok = true; break; }
        const mx = w.nx * (w.pen + 0.05), mz = w.nz * (w.pen + 0.05);
        poly = poly.map(([x, z]) => [x + mx, z + mz]);
        samples = samples.map(([x, z]) => [x + mx, z + mz]);
        c = [c[0] + mx, c[1] + mz]; shiftX += mx; shiftZ += mz;
        if (Math.hypot(shiftX, shiftZ) > MAX_SHIFT) break;
      }
      if (ok || Math.hypot(shiftX, shiftZ) > MAX_SHIFT) break;
      // Squeezed between roads: shrink toward the center and try again.
      shrinks++;
      poly = poly.map(([x, z]) => [c[0] + (x - c[0]) * 0.82, c[1] + (z - c[1]) * 0.82]);
      samples = samplePoints(poly);
    }
    if (!ok || Math.hypot(shiftX, shiftZ) > MAX_SHIFT) { stats.removed++; continue; }

    if (shrinks) stats.shrunk++; else stats.moved++;
    b.footprint = poly;
    b.center = centroid(poly);
    kept.push(b);
  }
  data.buildings = kept;
  data.layoutStats = stats;
  return stats;
}

// ---------------------------------------------------------------------------------------------
// Keep everything on the ground slab. OSM returns whole ways, so roads, parks and water poke far
// beyond the selected area and would float in the sky next to the ground plane.

/** Liang-Barsky: part of segment a->b inside the box, as [t0, t1], or null. */
function clipSegment(a, b, B) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - B.minX], [dx, B.maxX - a[0]], [-dz, a[1] - B.minZ], [dz, B.maxZ - a[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/** Sutherland-Hodgman clip of a polygon against the box. */
function clipPolygon(poly, B) {
  const edges = [
    [(p) => p[0] >= B.minX, (a, b) => { const t = (B.minX - a[0]) / (b[0] - a[0]); return [B.minX, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[0] <= B.maxX, (a, b) => { const t = (B.maxX - a[0]) / (b[0] - a[0]); return [B.maxX, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[1] >= B.minZ, (a, b) => { const t = (B.minZ - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, B.minZ]; }],
    [(p) => p[1] <= B.maxZ, (a, b) => { const t = (B.maxZ - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, B.maxZ]; }],
  ];
  let out = poly;
  for (const [inside, cut] of edges) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(cut(prev, cur));
    }
    if (!out.length) return [];
  }
  return out;
}

/**
 * Cuts roads, parks and water at the area edge and drops buildings that stick out.
 * Mutates data in place. Returns counts.
 */
export function clipToBounds(data) {
  const B = data.bounds;
  const stats = { roadsCut: 0, roadsDropped: 0, areasCut: 0, buildingsDropped: 0 };
  const eps = 0.05;
  const inB = (x, z) => x >= B.minX - eps && x <= B.maxX + eps && z >= B.minZ - eps && z <= B.maxZ + eps;

  const roads = [];
  for (const r of data.roads) {
    const ids = r.nodeIds?.length === r.points.length ? r.nodeIds : null;
    const pieces = [];
    let cur = null, fresh = 0;
    const flush = () => { if (cur && cur.pts.length >= 2) pieces.push(cur); cur = null; };
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1], b = r.points[i], c = clipSegment(a, b, B);
      if (!c) { flush(); continue; }
      const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (!cur) {
        cur = { pts: [c[0] > 0 ? at(c[0]) : a], ids: [c[0] > 0 ? `clip:${r.id}:${fresh++}` : ids?.[i - 1]] };
      }
      cur.pts.push(c[1] < 1 ? at(c[1]) : b); cur.ids.push(c[1] < 1 ? `clip:${r.id}:${fresh++}` : ids?.[i]);
      if (c[1] < 1) flush();
    }
    flush();
    const total = pieces.reduce((n, p) => n + p.pts.length, 0);
    if (pieces.length === 1 && total === r.points.length && pieces[0].pts.every((p, i) => p === r.points[i])) { roads.push(r); continue; }
    let kept = 0;
    pieces.forEach((p, n) => {
      let len = 0; for (let i = 1; i < p.pts.length; i++) len += Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1]);
      if (len < 3) return;
      roads.push({ ...r, id: pieces.length > 1 ? `${r.id}#${n}` : r.id, points: p.pts, nodeIds: ids ? p.ids : r.nodeIds });
      kept++;
    });
    if (kept) stats.roadsCut++; else stats.roadsDropped++;
  }
  data.roads = roads;

  for (const key of ['greens', 'water']) {
    const out = [];
    for (const a of data[key]) {
      if (a.footprint.every((p) => inB(p[0], p[1]))) { out.push(a); continue; }
      const poly = clipPolygon(a.footprint, B);
      if (poly.length >= 3) { out.push({ ...a, footprint: poly }); stats.areasCut++; }
    }
    data[key] = out;
  }

  const before = data.buildings.length;
  data.buildings = data.buildings.filter((b) => b.footprint.every((p) => inB(p[0], p[1])));
  stats.buildingsDropped = before - data.buildings.length;
  data.clipStats = stats;
  return stats;
}
