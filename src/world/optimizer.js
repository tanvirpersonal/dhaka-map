// Performance baking: merge the many small meshes of the city into a few chunk meshes.
//
// The editable groups ('buildings', 'streets', 'sidewalks') keep one object per building/road so
// picking and swapping work. For viewing/driving we hide them and show 'baked' instead.
//
// Draw-call reduction:
//  * Plain colored materials (most building parts, plain roads) are merged into ONE vertex-colored
//    material per roughness/metalness/side signature: the color moves into a per-vertex attribute.
//  * Textured materials (facades, street textures, night-glow windows) stay as they are, one bucket each.
//  * Everything is grouped by 400 m chunk (so frustum culling still works) and by renderOrder
//    (so flat ground decals keep their layering, see layers.js).
// Merging copies vertex arrays directly into the output buffers: no per-mesh geometry clones.

import * as THREE from 'three';
import { world } from './scene.js';
import { isDecal } from './layers.js';

const CHUNK = 400; // meters
const EDITABLE = ['buildings', 'streets', 'sidewalks'];

let baked = null;
/** Layer names (buildings/streets/sidewalks) the user switched off; honoured by editable and baked meshes. */
export const hiddenLayers = new Set();
const vcMaterials = new Map(); // signature -> shared vertex-color material

export const isBaked = () => !!baked && baked.visible;

function mergeable(m) {
  return m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial && !m.map && !m.vertexColors && !m.transparent
    && !m.userData.nightGlow && !(m.emissiveIntensity > 0 && m.emissive.getHex() !== 0);
}

function vertexColorMaterial(m) {
  const sig = `${m.roughness}|${m.metalness}|${m.side}|${m.depthWrite}|${m.flatShading}`;
  if (!vcMaterials.has(sig)) {
    const vm = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: m.roughness, metalness: m.metalness, side: m.side,
      depthWrite: m.depthWrite, flatShading: m.flatShading,
    });
    vm.userData.shared = true;
    vcMaterials.set(sig, vm);
  }
  return { sig, material: vcMaterials.get(sig) };
}

/** Every visible single-material mesh (and instance) under root, with its world matrix. */
function* sources(root) {
  root.updateWorldMatrix(true, true);
  const inst = new THREE.Matrix4();
  const stack = [root];
  while (stack.length) {
    const o = stack.pop();
    for (const c of o.children) stack.push(c);
    if (!o.isMesh || !o.visible || Array.isArray(o.material)) continue;
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, inst);
        yield { geo: o.geometry, matrix: inst.clone().premultiply(o.matrixWorld), material: o.material, order: o.renderOrder };
      }
    } else {
      yield { geo: o.geometry, matrix: o.matrixWorld.clone(), material: o.material, order: o.renderOrder };
    }
  }
}

function ensureGeometry(geo) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.boundingBox) geo.computeBoundingBox();
}

/** Merge items (geometry + matrix [+ flat color]) into one indexed BufferGeometry. */
function mergeItems(items, names) {
  let vCount = 0, iCount = 0;
  for (const it of items) {
    const g = it.geo, n = g.attributes.position.count;
    vCount += n; iCount += g.index ? g.index.count : n;
  }
  const out = {};
  const size = { position: 3, normal: 3, uv: 2, color: 3, aSeed: 1 };
  for (const nm of names) out[nm] = new Float32Array(vCount * size[nm]);
  const index = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);

  const p = new THREE.Vector3(), nrm = new THREE.Vector3(), nm3 = new THREE.Matrix3();
  let v0 = 0, i0 = 0;
  for (const { geo, matrix, color } of items) {
    const a = geo.attributes, n = a.position.count;
    nm3.getNormalMatrix(matrix);
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(a.position, i).applyMatrix4(matrix);
      out.position[(v0 + i) * 3] = p.x; out.position[(v0 + i) * 3 + 1] = p.y; out.position[(v0 + i) * 3 + 2] = p.z;
      nrm.fromBufferAttribute(a.normal, i).applyMatrix3(nm3).normalize();
      out.normal[(v0 + i) * 3] = nrm.x; out.normal[(v0 + i) * 3 + 1] = nrm.y; out.normal[(v0 + i) * 3 + 2] = nrm.z;
    }
    if (out.uv && a.uv) out.uv.set(a.uv.array, v0 * 2);
    if (out.color) {
      if (color) for (let i = 0; i < n; i++) { const o = (v0 + i) * 3; out.color[o] = color.r; out.color[o + 1] = color.g; out.color[o + 2] = color.b; }
      else if (a.color) out.color.set(a.color.array, v0 * 3);
      else out.color.fill(1, v0 * 3, (v0 + n) * 3);
    }
    if (out.aSeed && a.aSeed) out.aSeed.set(a.aSeed.array, v0);
    if (geo.index) for (let i = 0; i < geo.index.count; i++) index[i0 + i] = geo.index.getX(i) + v0;
    else for (let i = 0; i < n; i++) index[i0 + i] = v0 + i;
    v0 += n; i0 += geo.index ? geo.index.count : n;
  }

  const merged = new THREE.BufferGeometry();
  for (const nm of names) merged.setAttribute(nm, new THREE.BufferAttribute(out[nm], size[nm]));
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  merged.computeBoundingSphere();
  return merged;
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

  const buckets = new Map(); // "cx,cz|signature|order" -> { material, order, names, items }
  let before = 0;
  const c = new THREE.Vector3();

  for (const name of EDITABLE) {
    const group = root.getObjectByName(name);
    if (!group) continue;
    group.traverse((o) => { if (o.isMesh) before++; });
    for (const s of sources(group)) {
      ensureGeometry(s.geo);
      s.geo.boundingBox.getCenter(c).applyMatrix4(s.matrix);

      let sig, material, names = ['position', 'normal', 'uv'];
      if (mergeable(s.material)) {
        ({ sig, material } = vertexColorMaterial(s.material));
        s.color = s.material.color;
        names = ['position', 'normal', 'uv', 'color'];
      } else {
        sig = s.material.uuid; material = s.material;
        if (material.vertexColors) names = [...names, 'color'];
        if (material.userData.facade && s.geo.attributes.aSeed) names = [...names, 'aSeed'];
      }
      const key = `${name}|${Math.floor(c.x / CHUNK)},${Math.floor(c.z / CHUNK)}|${sig}|${s.order}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { layer: name, material, order: s.order, names, items: [] }));
      b.items.push(s);
    }
  }

  baked = new THREE.Group();
  baked.name = 'baked';
  let tris = 0;
  for (const { layer, material, order, names, items } of buckets.values()) {
    const merged = mergeItems(items, names);
    const mesh = new THREE.Mesh(merged, material);
    mesh.renderOrder = order;
    mesh.userData.layer = layer; // lets layerManager hide e.g. only the baked buildings
    mesh.visible = !hiddenLayers.has(layer);
    mesh.castShadow = !isDecal(order);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    tris += merged.index.count / 3;
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
  EDITABLE.forEach((n) => { const g = root.getObjectByName(n); if (g) g.visible = !on && !hiddenLayers.has(n); });
  if (baked) baked.visible = on;
}

/** Run fn with the editable objects visible (e.g. GLB export, picking), then restore. */
export async function withEditable(fn) {
  const was = isBaked();
  setBaked(false);
  try { return await fn(); } finally { if (was) setBaked(true); }
}

/** Re-apply hiddenLayers to the baked chunk meshes and editable groups. */
export function applyBakedLayerVisibility() {
  const root = world.cityRoot;
  if (baked) baked.children.forEach((m) => { m.visible = !hiddenLayers.has(m.userData.layer); });
  if (root) EDITABLE.forEach((n) => { const g = root.getObjectByName(n); if (g) g.visible = !isBaked() && !hiddenLayers.has(n); });
}

export function clearBaked() { disposeBaked(); }
