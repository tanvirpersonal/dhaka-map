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

// Distance from a point to a finite road segment (XZ plane).
function pointSegmentDistance(point, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-8) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / len2));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dz));
}

// A sidewalk facing another carriageway becomes a fake green median when both
// roads generate overlapping footpaths. Detect that side and omit the strip.
function isSideBlocked(road, roads, side) {
  const offset = road.width / 2 + WALK_WIDTH / 2 + 0.05;
  const samples = road.points.map(([x, z], i) => {
    const prev = road.points[Math.max(0, i - 1)];
    const next = road.points[Math.min(road.points.length - 1, i + 1)];
    let dx = next[0] - prev[0], dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    return [x - dz * offset * side, z + dx * offset * side];
  });

  let blocked = 0;
  for (const p of samples) {
    const nearRoad = roads.some((other) => {
      if (other === road || !other.drivable || other.bridge || other.tunnel || other.points.length < 2) return false;
      const clearance = (other.width || 5) / 2 + WALK_WIDTH * 0.55 + 0.2;
      for (let i = 1; i < other.points.length; i++) {
        if (pointSegmentDistance(p, other.points[i - 1], other.points[i]) < clearance) return true;
      }
      return false;
    });
    if (nearRoad) blocked++;
  }

  // Require a sustained parallel/adjacent road before suppressing this whole side;
  // a crossing street at one node must not erase an otherwise valid sidewalk.
  return samples.length > 1 && blocked / samples.length >= 0.45;
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
      // Do not build the inward-facing footpath between parallel carriageways:
      // it overlaps with its neighbour and reads as a wide green median in the scene.
      if (isSideBlocked(r, roads, side)) continue;
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
  asDecal(mesh, LAYER.sidewalk);
  const group = new THREE.Group();
  group.name = 'sidewalks';
  group.add(mesh);
  return group;
}
