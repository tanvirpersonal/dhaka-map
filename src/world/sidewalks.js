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

// Spatial index of road segments. Sidewalk clipping queries only nearby cells,
// so the strict road-clearance test remains practical for large OSM selections.
function buildRoadSegmentIndex(roads, cellSize = 32) {
  const cells = new Map();
  const key = (x, z) => `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
  for (const road of roads) {
    if (!road.drivable || road.bridge || road.tunnel || road.points.length < 2) continue;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i];
      const segment = { road, a, b };
      const minX = Math.floor(Math.min(a[0], b[0]) / cellSize);
      const maxX = Math.floor(Math.max(a[0], b[0]) / cellSize);
      const minZ = Math.floor(Math.min(a[1], b[1]) / cellSize);
      const maxZ = Math.floor(Math.max(a[1], b[1]) / cellSize);
      for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
        const k = key(x * cellSize, z * cellSize);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(segment);
      }
    }
  }
  return { cells, cellSize, key };
}

// Find real 3+ arm junctions from shared OSM node IDs. Sidewalks are cut back
// around these nodes so no footpath material can occupy the intersection apron.
function buildJunctionExclusions(roads) {
  const nodes = new Map();
  for (const road of roads) {
    if (!road.drivable || road.bridge || road.tunnel || !Array.isArray(road.nodeIds)) continue;
    for (let i = 0; i < road.nodeIds.length; i++) {
      const id = road.nodeIds[i];
      if (id == null) continue;
      if (!nodes.has(String(id))) nodes.set(String(id), []);
      nodes.get(String(id)).push({ road, index: i });
    }
  }

  const zones = [];
  for (const occurrences of nodes.values()) {
    if (new Set(occurrences.map((v) => v.road.id)).size < 2) continue;
    const center = occurrences[0].road.points[occurrences[0].index];
    const arms = [];
    let maxWidth = 0;
    for (const { road, index } of occurrences) {
      maxWidth = Math.max(maxWidth, road.width || 5);
      for (const ni of [index - 1, index + 1]) {
        if (ni < 0 || ni >= road.points.length) continue;
        const p = road.points[ni];
        let dx = p[0] - center[0], dz = p[1] - center[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.25) continue;
        dx /= len; dz /= len;
        if (!arms.some((a) => a.dx * dx + a.dz * dz > 0.985)) arms.push({ dx, dz });
      }
    }
    if (arms.length >= 3) {
      zones.push({
        x: center[0], z: center[1],
        // Includes the junction polygon, curb return and the full footpath width.
        radius: maxWidth / 2 + WALK_WIDTH + 3.5,
      });
    }
  }
  return zones;
}

function nearbySegments(point, index) {
  const cx = Math.floor(point[0] / index.cellSize);
  const cz = Math.floor(point[1] / index.cellSize);
  const found = new Set();
  for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) {
    for (const segment of index.cells.get(index.key(x * index.cellSize, z * index.cellSize)) || []) found.add(segment);
  }
  return found;
}

// A sidewalk sample is valid only if its ENTIRE width clears every other road.
// This is the important difference from merely hiding a whole side of a road.
function isSidewalkSampleClear(ownerRoad, point, index, junctionZones) {
  for (const zone of junctionZones) {
    if (Math.hypot(point[0] - zone.x, point[1] - zone.z) < zone.radius + WALK_WIDTH / 2 + 0.5) return false;
  }

  for (const { road, a, b } of nearbySegments(point, index)) {
    if (road === ownerRoad) continue;
    const requiredClearance = (road.width || 5) / 2 + WALK_WIDTH / 2 + 0.75;
    if (pointSegmentDistance(point, a, b) < requiredClearance) return false;
  }
  return true;
}

// Densify each OSM way, offset it to the kerb, and split it wherever the
// sidewalk strip would touch a road corridor or a 3/4/multi-arm junction.
function makeClippedSidewalkRuns(road, side, index, junctionZones) {
  const centerline = [];
  for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(length / 1));
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      centerline.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  const last = road.points[road.points.length - 1];
  centerline.push([last[0], last[1]]);
  if (centerline.length < 2) return [];

  const offset = road.width / 2 + WALK_WIDTH / 2 + 0.05;
  const sidewalkPath = centerline.map(([x, z], i) => {
    const prev = centerline[Math.max(0, i - 1)];
    const next = centerline[Math.min(centerline.length - 1, i + 1)];
    let dx = next[0] - prev[0], dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    return [x - dz * offset * side, z + dx * offset * side];
  });

  const runs = [];
  let run = [];
  const flush = () => {
    if (run.length >= 2 && polylineLength(run) >= 3) runs.push(run);
    run = [];
  };

  for (const point of sidewalkPath) {
    if (isSidewalkSampleClear(road, point, index, junctionZones)) run.push(point);
    else flush();
  }
  flush();
  return runs;
}

const material = new THREE.MeshStandardMaterial({ color: 0xa8a297, roughness: 0.95, side: THREE.DoubleSide });
material.userData.shared = true;
export const sidewalkMaterial = material;

/** @returns {THREE.Group|null} group named 'sidewalks' holding a single merged mesh */
export function makeSidewalks(roads) {
  const geos = [];
  const roadIndex = buildRoadSegmentIndex(roads);
  const junctionZones = buildJunctionExclusions(roads);
  for (const r of roads) {
    if (!r.drivable || r.bridge || r.tunnel || SKIP_HIGHWAYS.has(r.highway)) continue;
    if (r.points.length < 2 || polylineLength(r.points) < 8) continue;
    for (const side of [1, -1]) {
      // Clip the strip against every nearby road footprint and multi-arm junction.
      // Only the safe portions are emitted, so the footpath texture never covers asphalt.
      const runs = makeClippedSidewalkRuns(r, side, roadIndex, junctionZones);
      for (const run of runs) {
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
