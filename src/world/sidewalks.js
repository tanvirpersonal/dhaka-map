// Sidewalks: a raised strip on both sides of drivable roads, merged into ONE mesh (one draw call).
// Gives the GTA look (curb, kerb-side walkway) without thousands of extra objects.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ribbonGeometry } from './streetFactory.js';

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

/** @returns {THREE.Group|null} group named 'sidewalks' holding a single merged mesh */
export function makeSidewalks(roads) {
  const geos = [];
  for (const r of roads) {
    if (!r.drivable || r.bridge || r.tunnel || SKIP_HIGHWAYS.has(r.highway)) continue;
    if (r.points.length < 2 || polylineLength(r.points) < 8) continue;
    const off = r.width / 2 + WALK_WIDTH / 2 + 0.05;
    for (const side of [1, -1]) {
      const g = ribbonGeometry(offsetPolyline(r.points, side * off), WALK_WIDTH, 3);
      g.translate(0, WALK_Y, 0);
      geos.push(g);
    }
  }
  if (!geos.length) return null;

  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(merged, material);
  mesh.receiveShadow = true;
  mesh.name = 'sidewalks_mesh';
  const group = new THREE.Group();
  group.name = 'sidewalks';
  group.add(mesh);
  return group;
}
