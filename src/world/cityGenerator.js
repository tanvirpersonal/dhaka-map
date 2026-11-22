// Builds the PRIMARY replica: ground, greens, water, street ribbons and building boxes.

import * as THREE from 'three';
import { initScene, clearCity, world, frameCity } from './scene.js';
import { makeBuildingBox } from './buildingFactory.js';
import { makeStreet } from './streetFactory.js';
import { clearBaked } from './optimizer.js';
import { makeSidewalks } from './sidewalks.js';
import { makeProps } from './props.js';
import { asDecal, LAYER } from './layers.js';
import { initQuality } from './quality.js';

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

  // Ground slab slightly larger than the selected area.
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

  const streets = new THREE.Group(); streets.name = 'streets';
  data.roads.forEach((r) => { const m = makeStreet(r); if (m) streets.add(m); });
  root.add(streets);

  const sidewalks = makeSidewalks(data.roads);
  if (sidewalks) root.add(sidewalks);

  // Yield to the browser periodically so the loader can repaint on big areas.
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

  root.add(makeProps(data)); // instanced lamps + trees

  frameCity(bounds);
}

/** Convenience accessors used by the replacer / edit mode. */
export function getGroup(name) {
  return world.cityRoot?.getObjectByName(name) || null;
}
