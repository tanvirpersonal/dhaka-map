// Builds the PRIMARY replica: ground, greens, water, street ribbons and building boxes.

import * as THREE from 'three';
import { initScene, clearCity, world, frameCity } from './scene.js';
import { makeBuildingBox } from './buildingFactory.js';
import { makeStreet } from './streetFactory.js';
import { createStreetModel, getStreetEntry } from '../assets/assetLoader.js?v=full-glb-road-geometry-1';
import { clearBaked } from './optimizer.js';
// Versioned URL bypasses stale browser/CDN module caches after the tree-transform fix.
import { makeProps } from './props.js?v=tree-matrix-fix-2';
import { asDecal, LAYER } from './layers.js';
import { initQuality } from './quality.js';
import { clearBuildingsFromRoads } from '../data/layout.js';
import { registerCityLayers } from './layerManager.js';

function flatShape(footprint, y, color, name) {
  const shape = new THREE.Shape();
  footprint.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
  mesh.position.y = y;
  mesh.receiveShadow = true;
  mesh.name = name;
  return mesh;
}

export async function generateCity(canvas, data, onProgress = () => {}) {
  const firstRun = !world.renderer;
  initScene(canvas);
  if (firstRun) initQuality();
  clearBaked();
  clearCity();
  const root = world.cityRoot;
  const { bounds } = data;
  clearBuildingsFromRoads(data);

  const pad = 40;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(bounds.width + pad * 2, bounds.depth + pad * 2),
    new THREE.MeshStandardMaterial({ color: 0x7d8a63, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
  ground.receiveShadow = true;
  ground.name = 'ground';
  asDecal(ground, LAYER.ground);
  root.add(ground);
  world.ground = ground;

  const greens = new THREE.Group(); greens.name = 'greens';
  data.greens.forEach((g) => greens.add(asDecal(flatShape(g.footprint, 0.02, 0x5f8f4a, g.id), LAYER.green)));
  root.add(greens);

  const water = new THREE.Group(); water.name = 'water';
  data.water.forEach((w) => water.add(asDecal(flatShape(w.footprint, 0.03, 0x3c7fb5, w.id), LAYER.water)));
  root.add(water);

  // Load the matching GLB road surface immediately, not only after the user presses Build City.
  const streets = new THREE.Group(); streets.name = 'streets';
  for (let i = 0; i < data.roads.length; i++) {
    const road = data.roads[i];
    let mesh = null;
    try {
      const entry = await getStreetEntry(road.kind);
      if (entry?.type === 'glb') {
        mesh = await createStreetModel(road, entry);
        mesh.position.y = road.kind === 'primary' ? 0.06 : road.kind === 'secondary' ? 0.05 : 0.04;
        mesh.userData.road = road;
        mesh.userData.placeholder = false;
        mesh.userData.streetAsset = entry.id;
      }
    } catch (error) {
      console.warn(`Road GLB failed for ${road.id}; using procedural road surface.`, error);
    }
    if (!mesh) mesh = makeStreet(road);
    if (mesh) streets.add(mesh);
    if (i % 250 === 249) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  root.add(streets);

  const buildings = new THREE.Group(); buildings.name = 'buildings';
  for (let i = 0; i < data.buildings.length; i++) {
    buildings.add(makeBuildingBox(data.buildings[i]));
    if (i % 200 === 199) {
      onProgress((i + 1) / data.buildings.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress(1);
  root.add(buildings);

  try {
    root.add(makeProps(data));
  } catch (error) {
    console.warn('Street props skipped; continuing with the 3D city:', error);
    const fallbackProps = new THREE.Group();
    fallbackProps.name = 'props';
    root.add(fallbackProps);
  }

  registerCityLayers();
  frameCity(bounds);
}

/** Convenience accessors used by the replacer / edit mode. */
export function getGroup(name) {
  return world.cityRoot?.getObjectByName(name) || null;
}
