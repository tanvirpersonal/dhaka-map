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
  return (await loadManifest()).streets.filter((s) => s.enabled !== false);
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

export async function loadGlbScene(entry) { return loadGlb(entry); }

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

/**
 * Road asset from a .glb: its asphalt texture (edge lines + centre dashes) is repeated along the OSM road.
 * The model's flat preview quad is only used as the texture carrier; the texture is mapped square, so
 * one tile is as long as the road is wide and lane lines never stretch on short or long segments.
 * Returns ONE mesh per road with a shared material, so Build City can merge them into a few draw calls.
 */
const glbRoadMatCache = new Map(); // entry id -> material
async function glbRoadMaterial(entry) {
  if (!glbRoadMatCache.has(entry.id)) {
    const source = await loadGlb(entry);
    let src = null;
    source.traverse((o) => { if (!src && o.isMesh && o.material) src = [].concat(o.material)[0]; });
    if (!src) throw new Error(`${entry.path}: no mesh material found`);
    let map = null;
    if (src.map) {
      map = src.map.clone();
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.offset.set(0, 0); map.repeat.set(1, 1); map.rotation = 0; // drop the preview quad's KHR_texture_transform
      map.matrix.identity();
      map.anisotropy = 8;
      map.needsUpdate = true;
    }
    const m = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : (src.color || 0x333333), roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    if (map) { m.emissiveMap = map; m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 0.35; } // the asphalt is very dark: lift it so lane lines read in daylight
    m.depthWrite = false;
    m.userData.shared = true;
    if (map) map.userData.shared = true;
    glbRoadMatCache.set(entry.id, m);
  }
  return glbRoadMatCache.get(entry.id);
}

export async function createStreetModel(road, entry) {
  const { ribbonGeometry } = await import('../world/streetFactory.js');
  const mesh = new THREE.Mesh(ribbonGeometry(road.points, road.width, Math.max(road.width, 3)), await glbRoadMaterial(entry));
  mesh.name = `street_glb_${road.id}`;
  mesh.receiveShadow = true;
  mesh.userData.streetAsset = entry.id;
  return mesh;
}

/** Textured material for a street kind or a specific street asset id. Cached. */
export async function getStreetMaterial(idOrKind) {
  const m = await loadManifest();
  const entry = m.streets.find((s) => s.id === idOrKind && s.enabled !== false) || m.streets.findLast((s) => s.enabled !== false && !String(s.type).startsWith('glb') && s.kinds.includes(idOrKind));
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
    const material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide, depthWrite: false });
    material.userData.shared = true;
    material.userData.tileLength = entry.tileLength;
    streetMatCache.set(entry.id, material);
  }
  return streetMatCache.get(entry.id);
}

export async function getStreetEntry(kind, width = Infinity, { chunks = true } = {}) {
  const m = await loadManifest();
  // findLast: assets you add later override the built-in ones for the same kind.
  return m.streets.findLast((s) => s.enabled !== false && s.kinds.includes(kind)
    && (chunks || s.type !== 'glb-chunk')
    && width >= (s.minWidth ?? 0) && width <= (s.maxWidth ?? Infinity)) || null;
}
