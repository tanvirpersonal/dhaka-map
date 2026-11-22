// Industrial warehouse: corrugated shell, low-pitch roof, roller doors and a rooftop vent row.
import { box, mat, rng } from '../../../src/assets/moduleKit.js';
import { facadeBox } from '../../../src/assets/facade.js';

export const meta = { id: 'warehouse', name: 'Warehouse' };

const SHELL = [0xffffff, 0xe8e4d8, 0xdce6ee, 0xf0e6d0]; // tints over the corrugated-metal texture

export function build(THREE, { width, depth, height, seed = 1 }) {
  const r = rng(seed);
  const g = new THREE.Group();
  const w = Math.max(6, width), d = Math.max(6, depth);
  const h = Math.max(4, height);
  g.add(facadeBox(THREE, w, h, d, { type: 'ribbed', color: SHELL[Math.floor(r() * SHELL.length)] }));
  g.add(box(THREE, w * 0.98, 0.5, d * 0.98, mat(THREE, 0x6e7378, { roughness: 0.6, metalness: 0.2 }), 0, h, 0)); // roof

  // Roller doors on the front.
  const doors = Math.max(1, Math.min(4, Math.floor(w / 12)));
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + (w / doors) * (i + 0.5);
    g.add(box(THREE, Math.min(4.2, w / doors - 1.5), Math.min(4.2, h - 0.8), 0.12, mat(THREE, 0x4d5a66), x, 0, d / 2 + 0.07));
  }

  // Roof vents.
  const vents = Math.max(1, Math.floor(w / 10));
  for (let i = 0; i < vents; i++) {
    g.add(box(THREE, 1.2, 0.8, 1.2, mat(THREE, 0x555b60), -w / 2 + (w / vents) * (i + 0.5), h + 0.5, 0));
  }
  return g;
}
