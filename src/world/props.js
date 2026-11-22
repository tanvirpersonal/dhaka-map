// Street props, fully instanced: street lamps along main roads and trees along streets / in green areas.
// Each prop type is ONE InstancedMesh per part, so thousands of props cost only a handful of draw calls.
// Placement is deterministic (seeded) so reloads and saved projects look identical.

import * as THREE from 'three';
import { offsetPolyline } from './sidewalks.js';
import { rng, hashString } from '../assets/moduleKit.js';

const LAMP_SPACING = 38;
const TREE_SPACING = 14;

/** Points every `spacing` meters along a polyline, with the travel heading at each point. */
export function sampleAlong(points, spacing, start = spacing / 2) {
  const out = [];
  let carry = start;
  for (let i = 1; i < points.length; i++) {
    const [x0, z0] = points[i - 1], [x1, z1] = points[i];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (!len) continue;
    const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
    let d = carry;
    while (d < len) { out.push({ x: x0 + dx * d, z: z0 + dz * d, dx, dz }); d += spacing; }
    carry = d - len;
  }
  return out;
}

function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function boundsOf(poly) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  return { minX, maxX, minZ, maxZ };
}

/** Spatial hash of building footprints; also keeps trunks clear of lot edges. */
function buildingIndex(buildings) {
  const cell = 40, map = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const b of buildings) {
    const bb = boundsOf(b.footprint);
    for (let x = Math.floor((bb.minX - 4) / cell); x <= Math.floor((bb.maxX + 4) / cell); x++) {
      for (let z = Math.floor((bb.minZ - 4) / cell); z <= Math.floor((bb.maxZ + 4) / cell); z++) {
        const k = `${x},${z}`;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push({ b, bb });
      }
    }
  }
  return (x, z, pad = 2.5) => (map.get(key(x, z)) || []).some(({ b, bb }) => {
    if (x < bb.minX - pad || x > bb.maxX + pad || z < bb.minZ - pad || z > bb.maxZ + pad) return false;
    if (pointInPolygon(x, z, b.footprint)) return true;
    // Distance to polygon edges catches trees just outside a lot boundary.
    for (let i = 0, j = b.footprint.length - 1; i < b.footprint.length; j = i++) {
      const [ax, az] = b.footprint[j], [bx, bz] = b.footprint[i];
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < pad) return true;
    }
    return false;
  });
}

/** Road clearance index: reject trees inside the carriageway or too close to its edge. */
function roadClearanceIndex(roads) {
  const cell = 40, map = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const road of roads) {
    if (!road.points || road.points.length < 2) continue;
    const half = (road.width || 4) / 2;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i];
      const minX = Math.min(a[0], b[0]) - half - 5, maxX = Math.max(a[0], b[0]) + half + 5;
      const minZ = Math.min(a[1], b[1]) - half - 5, maxZ = Math.max(a[1], b[1]) + half + 5;
      for (let x = Math.floor(minX / cell); x <= Math.floor(maxX / cell); x++) {
        for (let z = Math.floor(minZ / cell); z <= Math.floor(maxZ / cell); z++) {
          const k = `${x},${z}`;
          if (!map.has(k)) map.set(k, []);
          map.get(k).push({ a, b, clearance: half + 4.5 });
        }
      }
    }
  }
  return (x, z) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
      for (const seg of map.get(`${gx},${gz}`) || []) {
        const dx = seg.b[0] - seg.a[0], dz = seg.b[1] - seg.a[1];
        const t = Math.max(0, Math.min(1, ((x - seg.a[0]) * dx + (z - seg.a[1]) * dz) / (dx * dx + dz * dz || 1)));
        if (Math.hypot(x - seg.a[0] - dx * t, z - seg.a[1] - dz * t) < seg.clearance) return false;
      }
    }
    return true;
  };
}

function lampMeshes(matrices) {
  const pole = new THREE.CylinderGeometry(0.09, 0.12, 6.5, 6); pole.translate(0, 3.25, 0);
  const arm = new THREE.BoxGeometry(1.4, 0.1, 0.1); arm.translate(0.6, 6.4, 0);
  const head = new THREE.BoxGeometry(0.5, 0.15, 0.3); head.translate(1.25, 6.3, 0);
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6, metalness: 0.4 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xfff1c4, emissive: 0xffe9a8, emissiveIntensity: 0 });
  glow.userData.nightGlow = true; // timeOfDay.js raises emissiveIntensity at night
  const make = (geo, mat) => {
    const im = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = false; im.frustumCulled = false; // instances span the whole city
    return im;
  };
  return [make(pole, metal), make(arm, metal), make(head, glow)];
}

function treeMeshes(items) {
  const trunk = new THREE.CylinderGeometry(0.15, 0.22, 2.4, 6); trunk.translate(0, 1.2, 0);
  const crown = new THREE.IcosahedronGeometry(1, 0); crown.translate(0, 3.4, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  const t = new THREE.InstancedMesh(trunk, trunkMat, items.length);
  const c = new THREE.InstancedMesh(crown, leafMat, items.length);
  const col = new THREE.Color();
  items.forEach((it, i) => {
    t.setMatrixAt(i, it.trunk);
    c.setMatrixAt(i, it.crown);
    c.setColorAt(i, col.setHSL(0.27 + it.tint * 0.08, 0.45, 0.28 + it.tint * 0.12));
  });
  c.castShadow = true;
  c.frustumCulled = false; t.frustumCulled = false;
  return [t, c];
}

/** @returns {THREE.Group} group named 'props' (instanced lamps + trees) */
export function makeProps(data) {
  const group = new THREE.Group();
  group.name = 'props';
  const inBuilding = buildingIndex(data.buildings);
  const roadClear = roadClearanceIndex(data.roads);
  const r = rng(hashString(`${data.area.south},${data.area.west}`));

  // Street lamps: alternate sides along primary/secondary/residential roads.
  const lamps = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const road of data.roads) {
    if (!road.drivable || road.bridge || road.tunnel || road.highway === 'service') continue;
    if (road.kind !== 'primary' && road.kind !== 'secondary' && road.kind !== 'residential') continue;
    const spacing = road.kind === 'residential' ? LAMP_SPACING * 1.4 : LAMP_SPACING;
    const off = road.width / 2 + 1.3;
    let side = 1;
    for (const p of sampleAlong(road.points, spacing, r() * spacing)) {
      side = -side;
      const x = p.x - p.dz * off * side, z = p.z + p.dx * off * side;
      if (inBuilding(x, z)) continue;
      // Arm points toward the road: rotate local +x to face the road center.
      q.setFromAxisAngle(up, Math.atan2(side * p.dx, side * p.dz));
      lamps.push(m4.clone().compose(new THREE.Vector3(x, 0.13, z), q.clone(), new THREE.Vector3(1, 1, 1)));
    }
  }
  if (lamps.length) lampMeshes(lamps).forEach((m) => group.add(m));

  // Trees: along residential/secondary roads (outer side of the sidewalk) and inside green areas.
  const trees = [];
  const addTree = (x, z) => {
    const s = 0.8 + r() * 0.9;
    const pos = new THREE.Vector3(x, 0, z);
    trees.push({
      tint: r(),
      trunk: m4.clone().compose(pos, new THREE.Quaternion(), new THREE.Vector3(s, s, s)),
      crown: m4.clone().compose(pos, new THREE.Quaternion(), new THREE.Vector3(s * 1.6, s * 1.5, s * 1.6)),
    });
  };
  for (const road of data.roads) {
    if (!road.drivable || road.bridge || road.tunnel || road.kind === 'primary' || road.highway === 'service') continue;
    for (const side of [1, -1]) {
      const line = offsetPolyline(road.points, side * (road.width / 2 + 6.5));
      for (const p of sampleAlong(line, TREE_SPACING, r() * TREE_SPACING)) {
        if (r() < 0.45 || inBuilding(p.x, p.z, 3) || !roadClear(p.x, p.z)) continue;
        addTree(p.x, p.z);
      }
    }
  }
  for (const g of data.greens) {
    const bb = boundsOf(g.footprint);
    const area = (bb.maxX - bb.minX) * (bb.maxZ - bb.minZ);
    const target = Math.min(120, Math.floor(area / 180));
    for (let i = 0, tries = 0; i < target && tries < target * 6; tries++) {
      const x = bb.minX + r() * (bb.maxX - bb.minX), z = bb.minZ + r() * (bb.maxZ - bb.minZ);
      if (pointInPolygon(x, z, g.footprint) && !inBuilding(x, z, 3) && roadClear(x, z)) { addTree(x, z); i++; }
    }
  }
  if (trees.length) treeMeshes(trees).forEach((m) => group.add(m));

  group.userData.counts = { lamps: lamps.length, trees: trees.length };
  return group;
}
