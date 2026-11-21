// Loads assets/manifest.json and instantiates building modules / street materials on demand.

import * as THREE from 'three';

const ASSET_ROOT = new URL('../../assets/', import.meta.url);

let manifest = null;
const moduleCache = new Map();   // asset id -> imported JS module
const glbCache = new Map();      // asset id -> loaded GLTF scene
const streetMatCache = new Map(); // street id -> material

export async function loadManifest() {
  if (manifest) return manifest;
  const res = await fetch(new URL('manifest.json', ASSET_ROOT));
  if (!res.ok) throw new Error(`manifest.json: ${res.status}`);
  manifest = await res.json();
  return manifest;
}

export async function listBuildingAssets() {
  return (await loadManifest()).buildings;
}

export async function listStreetAssets() {
  return (await loadManifest()).streets;
}

export async function getBuildingAsset(id) {
  return (await loadManifest()).buildings.find((a) => a.id === id) || null;
}

async function loadModule(entry) {
  if (!moduleCache.has(entry.id)) {
    const url = new URL(entry.path, ASSET_ROOT).href;
    moduleCache.set(entry.id, import(/* @vite-ignore */ url));
  }
  return moduleCache.get(entry.id);
}

async function loadGlb(entry) {
  if (!glbCache.has(entry.id)) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const url = new URL(entry.path, ASSET_ROOT).href;
    glbCache.set(entry.id, new GLTFLoader().loadAsync(url).then((g) => g.scene));
  }
  return glbCache.get(entry.id);
}

/**
 * Create a building instance for one lot.
 * @param {string} assetId
 * @param {{width:number, depth:number, height:number, levels:number, seed:number}} fit
 * @returns {Promise<THREE.Group>} group with origin at footprint center on the ground
 */
export async function createBuilding(assetId, fit) {
  const entry = await getBuildingAsset(assetId);
  if (!entry) throw new Error(`Unknown building asset: ${assetId}`);

  let group;
  if (entry.type === 'glb') {
    const src = await loadGlb(entry);
    group = new THREE.Group();
    const model = src.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -box.min.y, -center.z);
    const wrap = new THREE.Group();
    wrap.add(model);
    wrap.scale.set(fit.width / (size.x || 1), fit.height / (size.y || 1), fit.depth / (size.z || 1));
    group.add(wrap);
  } else {
    const mod = await loadModule(entry);
    group = mod.build(THREE, fit);
  }

  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  group.userData.assetId = assetId;
  return group;
}

/** Textured material for a street kind or a specific street asset id. Cached. */
export async function getStreetMaterial(idOrKind) {
  const m = await loadManifest();
  const entry = m.streets.find((s) => s.id === idOrKind) || m.streets.findLast((s) => s.kinds.includes(idOrKind));
  if (!entry) return null;
  if (!streetMatCache.has(entry.id)) {
    let tex;
    if (entry.type === 'image') {
      // Blender/Photoshop-authored texture: u across the road, v along it, tiles every tileLength m.
      tex = await new THREE.TextureLoader().loadAsync(new URL(entry.path, ASSET_ROOT).href);
    } else {
      tex = (await loadModule(entry)).makeTexture(THREE);
    }
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.userData.shared = true;
    const material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide });
    material.userData.shared = true;
    material.userData.tileLength = entry.tileLength;
    streetMatCache.set(entry.id, material);
  }
  return streetMatCache.get(entry.id);
}

export async function getStreetEntry(kind) {
  const m = await loadManifest();
  // findLast: assets you add later override the built-in ones for the same kind.
  return m.streets.findLast((s) => s.kinds.includes(kind)) || null;
}
