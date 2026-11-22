// Performance baking: merge the many small meshes of the city into a few chunk meshes.
//
// The editable groups ('buildings', 'streets', 'sidewalks') keep one object per building/road so
// picking and swapping work. For viewing/driving we hide them and show 'baked' instead: meshes are
// grouped by 200 m chunk x material and merged, so draw calls drop from thousands to a few dozen
// and frustum culling still works per chunk.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { world } from './scene.js';
import { isDecal } from './layers.js';

const CHUNK = 200; // meters
const EDITABLE = ['buildings', 'streets', 'sidewalks'];
const KEEP_ATTRS = ['position', 'normal', 'uv'];

let baked = null;

export const isBaked = () => !!baked && baked.visible;

function normalizeGeometry(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) if (!KEEP_ATTRS.includes(name)) g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}

/** Visit every drawable (mesh or instance) in a group as (geometry in world space, material). */
function* worldGeometries(root) {
  root.updateWorldMatrix(true, true);
  const m = new THREE.Matrix4();
  const stack = [root];
  while (stack.length) {
    const o = stack.pop();
    if (o.children.length) stack.push(...o.children);
    if (!o.isMesh || !o.visible || Array.isArray(o.material)) continue;
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        const g = normalizeGeometry(o.geometry);
        g.applyMatrix4(m.clone().premultiply(o.matrixWorld));
        yield { geo: g, material: o.material, order: o.renderOrder };
      }
    } else {
      const g = normalizeGeometry(o.geometry);
      g.applyMatrix4(o.matrixWorld);
      yield { geo: g, material: o.material, order: o.renderOrder };
    }
  }
}

function disposeBaked() {
  if (!baked) return;
  baked.parent?.remove(baked);
  baked.traverse((o) => o.geometry?.dispose());
  baked = null;
}

/** Build (or rebuild) the merged chunk meshes. Returns draw-call statistics. */
export function bakeCity() {
  const root = world.cityRoot;
  disposeBaked();

  const buckets = new Map(); // "cx,cz|materialUuid" -> { material, geos[] }
  let before = 0;

  for (const name of EDITABLE) {
    const group = root.getObjectByName(name);
    if (!group) continue;
    group.traverse((o) => { if (o.isMesh) before++; });
    const c = new THREE.Vector3();
    for (const { geo, material, order } of worldGeometries(group)) {
      geo.computeBoundingBox();
      geo.boundingBox.getCenter(c);
      const key = `${Math.floor(c.x / CHUNK)},${Math.floor(c.z / CHUNK)}|${material.uuid}|${order}`;
      if (!buckets.has(key)) buckets.set(key, { material, order, geos: [] });
      buckets.get(key).geos.push(geo);
    }
  }

  baked = new THREE.Group();
  baked.name = 'baked';
  let tris = 0;
  for (const { material, order, geos } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.renderOrder = order;
    mesh.castShadow = !isDecal(order);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    tris += merged.attributes.position.count / 3;
    baked.add(mesh);
  }
  root.add(baked);

  setBaked(true);
  return { objectsBefore: before, drawCallsAfter: baked.children.length, triangles: Math.round(tris) };
}

/** Show merged chunks (true) or the editable per-building objects (false). */
export function setBaked(on) {
  const root = world.cityRoot;
  if (!root) return;
  if (on && !baked) return;
  EDITABLE.forEach((n) => { const g = root.getObjectByName(n); if (g) g.visible = !on; });
  if (baked) baked.visible = on;
}

/** Run fn with the editable objects visible (e.g. GLB export, picking), then restore. */
export async function withEditable(fn) {
  const was = isBaked();
  setBaked(false);
  try { return await fn(); } finally { if (was) setBaked(true); }
}

export function clearBaked() { disposeBaked(); }
