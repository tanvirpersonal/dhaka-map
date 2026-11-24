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

/**
 * @param {{road:object}[]} roads wide drivable roads that should get chunks
 * @param {THREE.Object3D} scene the loaded .glb scene
 * @param {(x:number,z:number,own:object)=>boolean} onOtherRoad
 * @returns {THREE.Mesh[]}
 */
export async function buildRoadChunks(roads, scene, onOtherRoad) {
  const parts = classify(scene);
  if (!parts.some((p) => p.kind === 'asphalt')) throw new Error('road chunk .glb has no "Asphalt" mesh');
  const cache = new Map(), buckets = new Map();
  const M = new THREE.Matrix4(), R = new THREE.Matrix4(), T = new THREE.Matrix4(), S = new THREE.Matrix4();
  let used = 0, verts = 0;
  const perChunk = parts.reduce((n, p) => n + p.geo.attributes.position.count, 0);

  const add = (p, matrix) => {
    const g = p.geo.clone(); g.applyMatrix4(matrix);
    if (!buckets.has(p.material)) buckets.set(p.material, []);
    buckets.get(p.material).push(g);
  };

  for (const road of [...roads].sort((a, b) => b.width - a.width)) {
    const half = road.width / 2, fit = fitted(parts, road.width, cache);
    for (let i = 1; i < road.points.length && verts < MAX_VERTS; i++) {
      const [ax, az] = road.points[i - 1], [bx, bz] = road.points[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len, theta = Math.atan2(dx, dz);
      const n = Math.max(1, Math.round(len / 20)), step = len / n, sz = step / 20;
      R.makeRotationY(theta); S.makeScale(1, 1, sz);
      for (let k = 0; k < n; k++, used++) {
        verts += perChunk;
        const s = (k + 0.5) * step, ox = ax + dx * s, oz = az + dz * s;
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
          if (p.kind === 'lamp') { // keep lamp shape; only move it along the road
            const zc = -p.side * 5 * 1; // lamps sit at z = +5 (left) / -5 (right)
            T.makeTranslation(ox, -DROP, oz).multiply(R).multiply(new THREE.Matrix4().makeTranslation(0, 0, zc * sz - zc));
            M.copy(T);
          } else {
            M.makeTranslation(ox, -DROP, oz).multiply(R).multiply(S);
          }
          add(p, M);
        }
      }
      if (used % 40 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  }

  const meshes = [];
  for (const [material, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `road_chunk_${material.name || meshes.length}`;
    mesh.receiveShadow = true;
    mesh.castShadow = /metal|led|lamp/i.test(material.name || '');
    mesh.userData.roadChunk = true;
    meshes.push(mesh);
  }
  for (const f of cache.values()) f.forEach((p) => p.geo.dispose());
  parts.forEach((p) => p.geo.dispose());
  return meshes;
}
