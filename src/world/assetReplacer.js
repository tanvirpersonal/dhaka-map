// "Build City": replace placeholder boxes with asset modules and street ribbons with textured materials.
// Also exposes swapBuilding(), used by edit mode to change any single building.

import * as THREE from 'three';
import { world, disposeObject } from './scene.js';
import { getGroup } from './cityGenerator.js';
import { makeBuildingBox, footprintFrame } from './buildingFactory.js';
import { ribbonGeometry } from './streetFactory.js';
import {
  listBuildingAssets, createBuilding, getStreetMaterial, getStreetEntry, createStreetModel,
} from '../assets/assetLoader.js?v=full-glb-road-geometry-1';
import { matchBuildingAsset, seedFor } from '../assets/assetMatcher.js';
import { state } from '../core/state.js';
import { getStreetIndex, faceStreet } from './streetIndex.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Replace every placeholder in the current city. */
export async function buildCity(data, overrides = {}, onProgress = () => {}) {
  const assets = await listBuildingAssets();

  onProgress(0, 'streets');
  const junctionCount = await applyStreetTextures(data.roads);

  const group = getGroup('buildings');
  if (!group) throw new Error('No generated city to build.');

  const byId = new Map(data.buildings.map((b) => [b.id, b]));
  const targets = [...group.children];
  for (let i = 0; i < targets.length; i++) {
    const b = byId.get(targets[i].userData.building?.id);
    if (b) {
      const assetId = overrides[b.id] || matchBuildingAsset(b, assets);
      try {
        await placeBuilding(b, assetId);
      } catch (e) {
        console.warn(`Asset ${assetId} failed for ${b.id}, keeping box`, e);
      }
    }
    if (i % 40 === 39) { onProgress((i + 1) / targets.length, 'buildings'); await tick(); }
  }
  onProgress(1, 'buildings');
  return { junctionCount };
}

async function applyStreetTextures(roads) {
  const streets = getGroup('streets');
  if (!streets) return 0;

  // Remove the previous generated surface when Build City is run again.
  const oldJunctions = streets.getObjectByName('road_intersections');
  if (oldJunctions) { streets.remove(oldJunctions); disposeObject(oldJunctions); }

  for (const mesh of [...streets.children]) { // copy: GLB roads swap objects while we loop
    const road = mesh.userData.road;
    if (!road) continue;
    const entry = await getStreetEntry(road.kind);
    if (!entry) continue;
    if (entry.type === 'glb') {
      // Already applied during Generate City; avoid reloading/replacing the same road asset.
      if (mesh.userData.streetAsset === entry.id) continue;
      const model = await createStreetModel(road, entry);
      model.position.y = mesh.position.y;
      model.renderOrder = mesh.renderOrder; // keep the road's place in the ground layer order
      model.userData.road = road;
      model.userData.placeholder = false;
      if (mesh.geometry) mesh.geometry.dispose();
      streets.remove(mesh);
      streets.add(model);
      continue;
    }
    const material = await getStreetMaterial(road.kind);
    if (!material) continue;
    mesh.geometry.dispose();
    mesh.geometry = ribbonGeometry(road.points, road.width, entry.tileLength);
    mesh.material = material;
    mesh.userData.placeholder = false;
    mesh.userData.streetAsset = entry.id;
  }

  // Full GLB road sections overlap slightly at their endpoints; no flat texture
  // junction overlay is added on top of the authored 3D road geometry.
  const junctionCount = 0;
  return junctionCount;
}

/** Current scene object for a building (box or asset instance). */
export function findBuildingObject(buildingId) {
  const group = getGroup('buildings');
  return group?.children.find((o) => o.userData.building?.id === buildingId) || null;
}

/**
 * Put an asset module on a building's lot, replacing whatever is there now.
 * assetId === null restores the plain box placeholder.
 */
export async function placeBuilding(b, assetId) {
  const group = getGroup('buildings');
  if (!group) return null;
  const old = findBuildingObject(b.id);

  let obj;
  if (!assetId) {
    obj = makeBuildingBox(b);
  } else {
    const frame = footprintFrame(b);
    // Turn the front toward the nearest street (module +z is the front).
    const street = state.cityData ? getStreetIndex(state.cityData.roads).nearest(b.center[0], b.center[1], 60) : null;
    const face = faceStreet(frame, frame.center, street);
    // Shrink slightly on irregular lots so the module doesn't overhang concave footprints.
    const fill = Math.sqrt(Math.min(1, b.area / Math.max(1, frame.width * frame.depth)));
    const s = Math.max(0.75, fill);
    obj = await createBuilding(assetId, {
      width: face.width * s, depth: face.depth * s, height: b.height, levels: b.levels, seed: seedFor(b),
    });
    obj.position.set(frame.center[0], 0, frame.center[1]);
    obj.rotation.y = face.rotY;
    obj.userData.building = b;
    obj.userData.assetId = assetId;
    obj.name = `bld_${b.id}`;
  }

  if (old) { group.remove(old); disposeObject(old); }
  group.add(obj);
  return obj;
}

/** User-driven swap from edit mode. Records the choice so saves and rebuilds keep it. */
export async function swapBuilding(buildingId, assetId) {
  const old = findBuildingObject(buildingId);
  const b = old?.userData.building;
  if (!b) return null;
  if (assetId) state.overrides[buildingId] = assetId; else delete state.overrides[buildingId];
  return placeBuilding(b, assetId);
}
