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
 * Place the COMPLETE GLB road geometry along an OSM way.
 *
 * The source model is treated as one straight road section. Its longer horizontal
 * bounding-box axis is detected automatically (X or Z), then a clone is fitted to
 * every OSM segment. This preserves the model's meshes, materials, markings and
 * other authored geometry instead of extracting only its texture.
 */
const roadModelInfoCache = new Map();

async function getRoadModelInfo(entry) {
  if (!roadModelInfoCache.has(entry.id)) {
    const source = await loadGlb(entry);
    source.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(source);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const axis = size.x >= size.z ? 'x' : 'z';
    const length = axis === 'x' ? size.x : size.z;
    const width = axis === 'x' ? size.z : size.x;
    if (!(length > 0.001) || !(width > 0.001)) {
      throw new Error(`${entry.path}: road GLB must have measurable length and width`);
    }
    roadModelInfoCache.set(entry.id, { source, box, center, axis, length, width });
  }
  return roadModelInfoCache.get(entry.id);
}

export async function createStreetModel(road, entry) {
  const info = await getRoadModelInfo(entry);
  const { source, box, center, axis, length: modelLength, width: modelWidth } = info;
  const group = new THREE.Group();
  group.name = `street_glb_${road.id}`;
  const points = road.points || [];
  const roadWidth = Math.max(1, road.width || 5);
  let placed = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const segmentLength = Math.hypot(dx, dz);
    if (segmentLength < 0.15) continue;

    const segment = new THREE.Group();
    const model = source.clone(true);
    // Move the source model so its footprint is centered and its bottom sits at y=0.
    model.position.x -= center.x;
    model.position.y -= box.min.y;
    model.position.z -= center.z;

    const fit = new THREE.Group();
    fit.add(model);
    const longitudinalScale = (segmentLength + Math.min(0.6, roadWidth * 0.08)) / modelLength;
    const lateralScale = roadWidth / modelWidth;
    if (axis === 'x') fit.scale.set(longitudinalScale, lateralScale, lateralScale);
    else fit.scale.set(lateralScale, lateralScale, longitudinalScale);

    // Rotate the model's detected long axis to follow this OSM segment.
    segment.rotation.y = axis === 'x' ? Math.atan2(-dz, dx) : Math.atan2(dx, dz);
    segment.position.set((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
    segment.add(fit);
    segment.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    group.add(segment);
    placed++;
  }

  if (!placed) throw new Error(`${entry.path}: OSM road has no usable segments`);
  group.userData.streetAsset = entry.id;
  group.userData.road = road;
  group.userData.fullGlbGeometry = true;
  return group;
}

/** Textured material for a street kind or a specific street asset id. Cached. */
export async function getStreetMaterial(idOrKind) {
  const m = await loadManifest();
  const entry = m.streets.find((s) => s.id === idOrKind && s.enabled !== false) || m.streets.findLast((s) => s.enabled !== false && s.type !== 'glb' && s.kinds.includes(idOrKind));
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

export async function getStreetEntry(kind) {
  const m = await loadManifest();
  // findLast: assets you add later override the built-in ones for the same kind.
  return m.streets.findLast((s) => s.enabled !== false && s.kinds.includes(kind)) || null;
}


// Junction surface uses the same GLB road material and samples only its asphalt field.
const glbIntersectionMatCache = new Map();
export async function getRoadIntersectionMaterial(entry) {
  if (!entry || entry.type !== 'glb') return null;
  if (!glbIntersectionMatCache.has(entry.id)) {
    const roadMaterial = await glbRoadMaterial(entry);
    const material = roadMaterial.clone();
    // Keep the GLB texture shared; only the material state is specific to junctions.
    material.map = roadMaterial.map;
    material.emissiveMap = roadMaterial.emissiveMap;
    material.depthWrite = false;
    material.userData.shared = true;
    if (material.map) material.map.userData.shared = true;
    glbIntersectionMatCache.set(entry.id, material);
  }
  return glbIntersectionMatCache.get(entry.id);
}
