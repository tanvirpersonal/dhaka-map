// Sidewalks: a raised strip on both sides of drivable roads, merged into ONE mesh (one draw call).
// Gives the GTA look (curb, kerb-side walkway) without thousands of extra objects.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ribbonGeometry } from './streetFactory.js';
import { asDecal, LAYER } from './layers.js';

const WALK_WIDTH = 2.2;
const WALK_Y = 0.13; // above every road kind so the curb reads clearly
const SKIP_HIGHWAYS = new Set(['service', 'track', 'motorway', 'trunk']);

/** Offset a polyline sideways by d meters (positive = right of travel direction, north-up map). */
export function offsetPolyline(points, d) {
  return points.map(([x, z], i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let dx = next[0] - prev[0], dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    return [x - dz * d, z + dx * d];
  });
}

function polylineLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

const material = new THREE.MeshStandardMaterial({ color: 0xa8a297, roughness: 0.95, side: THREE.DoubleSide });
material.userData.shared = true;
export const sidewalkMaterial = material;

const CELL = 40;

/** Index of every drivable carriageway: lets a sidewalk ask "am I lying on somebody else's road?" */
export function carriagewayIndex(roads) {
  const segs = [], grid = new Map();
  for (const r of roads) {
    if (!r.drivable || r.points.length < 2) continue;
    const half = r.width / 2;
    for (let i = 1; i < r.points.length; i++) {
      const [x0, z0] = r.points[i - 1], [x1, z1] = r.points[i];
      const id = segs.length;
      segs.push({ road: r, x0, z0, ex: x1 - x0, ez: z1 - z0, half });
      for (let cx = Math.floor((Math.min(x0, x1) - half) / CELL); cx <= Math.floor((Math.max(x0, x1) + half) / CELL); cx++) {
        for (let cz = Math.floor((Math.min(z0, z1) - half) / CELL); cz <= Math.floor((Math.max(z0, z1) + half) / CELL); cz++) {
          const k = `${cx},${cz}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(id);
        }
      }
    }
  }
  return (x, z, own) => {
    for (const id of grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) || []) {
      const s = segs[id];
      if (s.road === own) continue;
      const t = Math.max(0, Math.min(1, ((x - s.x0) * s.ex + (z - s.z0) * s.ez) / (s.ex * s.ex + s.ez * s.ez || 1)));
      if (Math.hypot(x - s.x0 - s.ex * t, z - s.z0 - s.ez * t) < s.half + 0.2) return true;
    }
    return false;
  };
}

/** Densify a polyline to ~step meter spacing. */
function densify(points, step) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

/** Pieces of a sidewalk line that are NOT on another road (sidewalks are drawn above roads, so they would hide them). */
function freeRuns(line, onOtherRoad) {
  const pts = densify(line, 2), runs = [];
  let run = [];
  for (const p of pts) {
    if (onOtherRoad(p[0], p[1])) { if (run.length > 1) runs.push(run); run = []; }
    else run.push(p);
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/** @returns {THREE.Group|null} group named 'sidewalks' holding a single merged mesh */
export function makeSidewalks(roads) {
  const geos = [];
  const onRoad = carriagewayIndex(roads);
  for (const r of roads) {
    if (!r.drivable || r.bridge || r.tunnel || SKIP_HIGHWAYS.has(r.highway)) continue;
    if (r.points.length < 2 || polylineLength(r.points) < 8) continue;
    const off = r.width / 2 + WALK_WIDTH / 2 + 0.05;
    for (const side of [1, -1]) {
      for (const run of freeRuns(offsetPolyline(r.points, side * off), (x, z) => onRoad(x, z, r))) {
        const g = ribbonGeometry(run, WALK_WIDTH, 3);
        g.translate(0, WALK_Y, 0);
        geos.push(g);
      }
    }
  }
  if (!geos.length) return null;

  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(merged, material);
  mesh.receiveShadow = true;
  mesh.name = 'sidewalks_mesh';
  asDecal(mesh, LAYER.sidewalk);
  const group = new THREE.Group();
  group.name = 'sidewalks';
  group.add(mesh);
  return group;
}
