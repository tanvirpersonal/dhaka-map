// Streets as flat ribbons. Primary replica uses plain colors; Build City swaps in textures.
// Ribbon UVs: u runs across the width (0..1), v runs along the length in meters / tileLength.

import * as THREE from 'three';
import { asDecal, LAYER } from './layers.js';

const KIND_COLOR = {
  primary: 0x3a3a3d, secondary: 0x47474a, residential: 0x58585b, footpath: 0xb7ab94, dirt: 0x8a7352,
};

const KIND_Y = { primary: 0.06, secondary: 0.05, residential: 0.04, footpath: 0.07, dirt: 0.03 };

const matCache = new Map();
export function plainRoadMaterial(kind) {
  if (!matCache.has(kind)) {
    const m = new THREE.MeshStandardMaterial({ color: KIND_COLOR[kind] || 0x555555, roughness: 0.95, side: THREE.DoubleSide });
    m.userData.shared = true;
    matCache.set(kind, m);
  }
  return matCache.get(kind);
}

/**
 * Build a ribbon geometry along a polyline.
 * @param {number[][]} points [[x,z],...]
 * @param {number} width meters
 * @param {number} tileLength meters of road per texture repeat along v
 */
export function ribbonGeometry(points, width, tileLength = 8) {
  const pos = [], uv = [], idx = [];
  const half = width / 2;
  let dist = 0;

  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let dx = next[0] - prev[0], dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    // perpendicular in the XZ plane
    const nx = -dz, nz = dx;

    if (i > 0) dist += Math.hypot(x - points[i - 1][0], z - points[i - 1][1]);
    const v = dist / tileLength;

    pos.push(x + nx * half, 0, z + nz * half, x - nx * half, 0, z - nz * half);
    uv.push(0, v, 1, v);

    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Make sure normals point up regardless of winding.
  const n = geo.getAttribute('normal');
  for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return geo;
}

/** Placeholder street mesh (plain color). Tagged so the replacer can find and retexture it. */
export function makeStreet(road) {
  if (road.points.length < 2) return null;
  const mesh = new THREE.Mesh(ribbonGeometry(road.points, road.width), plainRoadMaterial(road.kind));
  mesh.position.y = KIND_Y[road.kind] ?? 0.04;
  mesh.receiveShadow = true;
  mesh.name = `street_${road.id}`;
  mesh.userData.road = road;
  mesh.userData.placeholder = true;
  return asDecal(mesh, LAYER[road.kind] ?? LAYER.residential);
}
