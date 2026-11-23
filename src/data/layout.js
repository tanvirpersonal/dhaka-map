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
