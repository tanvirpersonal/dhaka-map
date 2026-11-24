// Road chunks: a .glb that holds a ready-made 20 m piece of street (asphalt + curbs + sidewalks + lamp posts).
// Build City lays copies of it along every wide road, so one asset gives the whole road system.
//
// The chunk's local axes: +z runs along the road (z = -10..10), x is across it, y up.
//   asphalt  - widened/narrowed to the real road width
//   curbs, sidewalks, lamps - slid sideways so they hug the road edge (their size never changes)
//   a side is skipped for a chunk when it would lie on another road (junctions, dual carriageways)
// Everything is merged per material, so a whole city costs a handful of meshes.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ASPHALT_HALF = 5.25;       // half width of the asphalt in the .glb
const DROP = 0.10;               // sink the chunk so the asphalt sits just above the ground decals
const CELL = 160;                // metres: size of one road mesh cell
const MAX_VERTS = 1_600_000;     // memory budget (the sidewalk alone is ~2k vertices per chunk); widest roads get chunks first,
                                 // the rest keep the flat textured ribbon

const sideOf = (s) => (/_L(_|\d|\||$)/.test(s) ? -1 : /_R(_|\d|\||$)/.test(s) ? 1 : 0);

/** Split the loaded scene into parts: { geo, material, kind: 'asphalt'|'side'|'lamp', side } (geometry baked to chunk space). */
function classify(scene) {
  scene.updateMatrixWorld(true);
  const parts = [], mats = new Map();
  scene.traverse((m) => {
    if (!m.isMesh) return;
    const chain = []; for (let o = m; o; o = o.parent) chain.push(o.name || '');
    const label = chain.join('|');
    const kind = /asphalt/i.test(label) ? 'asphalt' : /lamp/i.test(label) ? 'lamp' : /curb|sidewalk/i.test(label) ? 'side' : null;
    if (!kind) return;
    const geo = m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
    const src = Array.isArray(m.material) ? m.material[0] : m.material;
    if (!mats.has(src)) {
      const mat = src.clone();
      // No environment map in this scene: full metal would render black.
      mat.metalness = Math.min(mat.metalness, 0.2); mat.metalnessMap = null; mat.roughnessMap = null;
      mat.roughness = Math.max(0.6, mat.roughness === 1 ? 0.9 : mat.roughness);
      mat.userData.shared = true;
      if (mat.map) mat.map.userData.shared = true;
      mats.set(src, mat);
    }
    parts.push({ geo, material: mats.get(src), kind, side: sideOf(label) });
  });
  return parts;
}

/** Part geometry adjusted for one road width (cached by half-meter). */
function fitted(parts, width, cache) {
  const key = Math.round(width * 2);
  if (cache.has(key)) return cache.get(key);
  const half = key / 4, out = parts.map((p) => {
    const geo = p.geo.clone(), pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, p.kind === 'asphalt' ? pos.getX(i) * (half / ASPHALT_HALF) : pos.getX(i) + p.side * (half - ASPHALT_HALF));
    }
    pos.needsUpdate = true;
    geo.computeBoundingBox();
    return { ...p, geo };
  });
  cache.set(key, out);
  return out;
}

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * Bend a chunk part between two cross-sections: the start one (A, normal nA) and the end one (B, nB).
 * Neighbouring chunks share the very same cross-section, so curves and corners stay watertight
 * (no gaps, no overlaps). Normals are only turned to the chord direction.
 */
function bendPart(p, A, B, nA, nB, yaw) {
  const src = p.geo, pos = src.attributes.position, nor = src.attributes.normal, n = pos.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), c = Math.cos(yaw), s = Math.sin(yaw);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), z = pos.getZ(i), t = clamp01((z + 10) / 20), u = 1 - t;
    P[i * 3] = A[0] * u + B[0] * t + (nA[0] * u + nB[0] * t) * x;
    P[i * 3 + 1] = pos.getY(i) - DROP;
    P[i * 3 + 2] = A[1] * u + B[1] * t + (nA[1] * u + nB[1] * t) * x;
    const nx = nor.getX(i), nz = nor.getZ(i);
    N[i * 3] = nx * c + nz * s; N[i * 3 + 1] = nor.getY(i); N[i * 3 + 2] = -nx * s + nz * c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  if (src.attributes.uv) g.setAttribute('uv', src.attributes.uv);
  g.setIndex(src.index);
  return g;
}

/** Keep a lamp's shape: move it rigidly so its base (xBase, zc in chunk space) lands on `at`, turned to `yaw`. */
function placeLamp(p, xBase, zc, at, yaw) {
  const src = p.geo, pos = src.attributes.position, nor = src.attributes.normal, n = pos.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), c = Math.cos(yaw), s = Math.sin(yaw);
  for (let i = 0; i < n; i++) {
    const vx = pos.getX(i) - xBase, vz = pos.getZ(i) - zc;
    P[i * 3] = at[0] + vx * c + vz * s;
    P[i * 3 + 1] = pos.getY(i) - DROP;
    P[i * 3 + 2] = at[1] - vx * s + vz * c;
    const nx = nor.getX(i), nz = nor.getZ(i);
    N[i * 3] = nx * c + nz * s; N[i * 3 + 1] = nor.getY(i); N[i * 3 + 2] = -nx * s + nz * c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  if (src.attributes.uv) g.setAttribute('uv', src.attributes.uv);
  g.setIndex(src.index);
  return g;
}

/** Cross-section normal at polyline vertex j (between segment j-1 and j): the corner's miter, so the road keeps its width round a bend. */
function miterAt2(segN, j) {
  const prev = segN[j - 1], next = segN[j];
  if (!prev) return next;
  if (!next) return prev;
  const k = Math.min(2.5, 1 / Math.max(0.4, 1 + prev[0] * next[0] + prev[1] * next[1]));
  return [(prev[0] + next[0]) * k, (prev[1] + next[1]) * k];
}

/**
 * @param {object[]} roads wide drivable roads that should get chunks
 * @param {THREE.Object3D} scene the loaded .glb scene
 * @param {(x:number,z:number,own:object)=>boolean} onOtherRoad
 * @returns {THREE.Mesh[]}
 */
export async function buildRoadChunks(roads, scene, onOtherRoad) {
  const parts = classify(scene);
  if (!parts.some((p) => p.kind === 'asphalt')) throw new Error('road chunk .glb has no "Asphalt" mesh');
  const cache = new Map(), buckets = new Map();
  let used = 0, verts = 0;
  const perChunk = parts.reduce((n, p) => n + p.geo.attributes.position.count, 0);

  // One mesh per (material, 160 m cell): the camera can skip cells it cannot see, and far away
  // cells drop their sidewalk/lamp detail (see updateRoadSystem). One giant mesh would be drawn in full every frame.
  const add = (p, g, ox, oz) => {
    const cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL), key = `${cx},${cz}`;
    let perMat = buckets.get(p.material);
    if (!perMat) buckets.set(p.material, (perMat = new Map()));
    if (!perMat.has(key)) perMat.set(key, { kind: p.kind, cx, cz, geos: [] });
    perMat.get(key).geos.push(g);
  };

  for (const road of [...roads].sort((a, b) => b.width - a.width)) {
    const half = road.width / 2, fit = fitted(parts, road.width, cache);
    // drop duplicate points, then one direction + normal per segment
    const pts = road.points.filter((q, i, a) => i === 0 || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) > 0.3);
    if (pts.length < 2) continue;
    const segD = [], segN = [];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1], l = Math.hypot(dx, dz);
      segD.push([dx / l, dz / l, l]); segN.push([dz / l, -dx / l]);
    }
    for (let i = 0; i < segD.length && verts < MAX_VERTS; i++) {
      const [dx, dz, len] = segD[i], nSeg = segN[i], A0 = pts[i];
      const startN = i === 0 ? nSeg : miterAt2(segN, i), endN = i === segD.length - 1 ? nSeg : miterAt2(segN, i + 1);
      const yaw = Math.atan2(dx, dz);
      const cnt = Math.max(1, Math.round(len / 20)), step = len / cnt;
      for (let k = 0; k < cnt; k++, used++) {
        verts += perChunk;
        const a = [A0[0] + dx * step * k, A0[1] + dz * step * k], b = [A0[0] + dx * step * (k + 1), A0[1] + dz * step * (k + 1)];
        const na = k === 0 ? startN : nSeg, nb = k === cnt - 1 ? endN : nSeg;
        const ox = (a[0] + b[0]) / 2, oz = (a[1] + b[1]) / 2;
        // which sides are free of other roads?
        const free = {};
        for (const side of [-1, 1]) {
          free[side] = true;
          for (const lz of [-0.4, 0, 0.4]) {
            const l = side * (half + 1.5), z = lz * step;
            if (onOtherRoad(ox + dz * l + dx * z, oz - dx * l + dz * z, road)) { free[side] = false; break; }
          }
        }
        for (const p of fit) {
          if (p.kind !== 'asphalt' && !free[p.side]) continue;
          if (p.kind === 'lamp') {
            const zc = -p.side * 5, t = (zc + 10) / 20, xBase = p.side * (half + 1.5);
            const at = [a[0] * (1 - t) + b[0] * t + (na[0] * (1 - t) + nb[0] * t) * xBase, a[1] * (1 - t) + b[1] * t + (na[1] * (1 - t) + nb[1] * t) * xBase];
            add(p, placeLamp(p, xBase, zc, at, yaw), ox, oz);
          } else {
            add(p, bendPart(p, a, b, na, nb, yaw), ox, oz);
          }
        }
      }
      if (used % 40 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  }

  const meshes = [];
  for (const [material, cells] of buckets) {
    for (const { kind, cx, cz, geos } of cells.values()) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `road_chunk_${material.name || meshes.length}_${cx}_${cz}`;
      mesh.receiveShadow = true;
      mesh.castShadow = kind === 'lamp';
      mesh.userData.roadChunk = true;
      mesh.userData.layer = kind === 'asphalt' ? 'streets' : kind === 'lamp' ? 'lamps' : 'sidewalks';
      mesh.userData.cell = [(cx + 0.5) * CELL, (cz + 0.5) * CELL];
      mesh.userData.lodDist = kind === 'asphalt' ? Infinity : kind === 'lamp' ? 350 : 450; // metres from the camera
      meshes.push(mesh);
    }
  }
  for (const f of cache.values()) f.forEach((p) => p.geo.dispose());
  parts.forEach((p) => p.geo.dispose());
  return meshes;
}

// ---------------------------------------------------------------------------------------------
// Visibility of the road system: user layers (Layers panel) + distance detail.

/** Layer names ('streets' | 'sidewalks' | 'lamps') the user hid. Filled by layerManager. */
export const roadSystemHidden = new Set();
let lodInstalled = false;

/** Show/hide every road-system cell: hidden layers off, far curbs/sidewalks/lamps off. */
export function updateRoadSystem(camera, root) {
  const g = root.getObjectByName('roadSystem');
  if (!g) return;
  const cx = camera.position.x, cz = camera.position.z;
  for (const m of g.children) {
    const u = m.userData;
    if (roadSystemHidden.has(u.layer)) { m.visible = false; continue; }
    // a cell is ~170 m across, so add its half-diagonal to the distance limit
    m.visible = u.lodDist === Infinity || Math.hypot(u.cell[0] - cx, u.cell[1] - cz) < u.lodDist + CELL * 0.75;
  }
}

/** Call once; keeps the road system's detail in step with the camera (every 6 frames). */
export function installRoadSystemLod(world) {
  if (lodInstalled) return;
  lodInstalled = true;
  let n = 0;
  world.onFrame.add(() => { if (++n % 6 === 0) updateRoadSystem(world.camera, world.cityRoot); });
}
