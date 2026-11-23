// Procedural junction surfaces built from shared OpenStreetMap node IDs.
// The surface reuses the exact road GLB material; its UVs sample an asphalt-only texel
// so lane markings remain on the incoming road ribbons instead of crossing the junction.

import * as THREE from 'three';
import { asDecal, LAYER } from './layers.js';

const ROAD_Y = { primary: 0.06, secondary: 0.05, residential: 0.04, dirt: 0.03 };
const MIN_ARM_DOT = 0.985; // collapse duplicate, almost-collinear arms

function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

// Convex outline around the ends of every road arm. This gives a single watertight
// surface for T, cross, skewed and higher-order junctions without a fixed cross texture.
function convexHull(points) {
  const pts = points
    .map(([x, z]) => [x, z])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique = pts.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-4);
  if (unique.length <= 2) return unique;
  const lower = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function collectJunctions(roads) {
  const nodes = new Map();

  for (const road of roads) {
    if (!road.drivable || road.bridge || road.tunnel) continue;
    if (!Array.isArray(road.nodeIds) || road.nodeIds.length !== road.points?.length) continue;

    for (let i = 0; i < road.nodeIds.length; i++) {
      const id = road.nodeIds[i];
      if (id == null) continue;
      let list = nodes.get(String(id));
      if (!list) nodes.set(String(id), (list = []));
      let occurrence = list.find((v) => v.road.id === road.id);
      if (!occurrence) list.push((occurrence = { road, index: i }));
    }
  }

  const junctions = [];
  for (const [nodeId, occurrences] of nodes) {
    if (occurrences.length < 2) continue;
    const first = occurrences[0];
    const center = first.road.points[first.index];
    const arms = [];

    for (const { road, index } of occurrences) {
      for (const neighborIndex of [index - 1, index + 1]) {
        if (neighborIndex < 0 || neighborIndex >= road.points.length) continue;
        const neighbor = road.points[neighborIndex];
        let dx = neighbor[0] - center[0], dz = neighbor[1] - center[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.25) continue;
        dx /= len; dz /= len;

        const duplicate = arms.find((a) => a.dx * dx + a.dz * dz > MIN_ARM_DOT);
        if (duplicate) {
          duplicate.width = Math.max(duplicate.width, road.width || 5);
          duplicate.layer = Math.max(duplicate.layer, LAYER[road.kind] ?? LAYER.residential);
          duplicate.y = Math.max(duplicate.y, ROAD_Y[road.kind] ?? 0.04);
        } else {
          arms.push({
            dx, dz, width: road.width || 5,
            layer: LAYER[road.kind] ?? LAYER.residential,
            y: ROAD_Y[road.kind] ?? 0.04,
          });
        }
      }
    }

    if (arms.length < 3) continue;

    const points = [];
    for (const arm of arms) {
      const half = arm.width / 2;
      const reach = Math.max(3, half * 0.65 + 1.4);
      const px = -arm.dz, pz = arm.dx;
      const ex = center[0] + arm.dx * reach;
      const ez = center[1] + arm.dz * reach;
      points.push([ex + px * half, ez + pz * half]);
      points.push([ex - px * half, ez - pz * half]);
    }

    const outline = convexHull(points);
    if (outline.length < 3) continue;
    junctions.push({
      nodeId,
      center: [center[0], center[1]],
      outline,
      arms: arms.length,
      layer: Math.max(...arms.map((a) => a.layer)),
      y: Math.max(...arms.map((a) => a.y)) + 0.008,
    });
  }
  return junctions;
}

/** Return one shared asphalt mesh per OSM junction. Material must come from the road GLB. */
export function makeRoadIntersections(roads, material) {
  const group = new THREE.Group();
  group.name = 'road_intersections';

  if (!material) return group;
  const junctions = collectJunctions(roads);

  for (const junction of junctions) {
    const shape = new THREE.Shape();
    junction.outline.forEach(([x, z], i) => {
      if (i === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);

    // Sample a tiny asphalt-only patch from the existing GLB texture. A constant UV
    // prevents its center/edge lane stripes from being stretched across the junction.
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.27, 0.5);
    uv.needsUpdate = true;
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = junction.y;
    mesh.receiveShadow = true;
    mesh.name = `intersection_${junction.nodeId}`;
    mesh.userData.intersection = {
      nodeId: junction.nodeId,
      roadCount: junction.arms,
      center: junction.center,
    };
    asDecal(mesh, junction.layer);
    group.add(mesh);
  }

  group.userData.junctionCount = group.children.length;
  return group;
}
