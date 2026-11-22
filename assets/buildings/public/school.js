// School / public building: wide brick block, entrance portico with pillars, flat roof and flagpole.
import { box, mat, rng } from '../../../src/assets/moduleKit.js';
import { facadeBox } from '../../../src/assets/facade.js';

export const meta = { id: 'school', name: 'School / Public Building' };

const BRICK = [0xb5654a, 0xc07a5a, 0xa85a44, 0xd0b48a];

export function build(THREE, { width, depth, height, levels = 3, seed = 1 }) {
  const r = rng(seed);
  const g = new THREE.Group();
  const w = Math.max(8, width), d = Math.max(6, depth);
  g.add(facadeBox(THREE, w, height, d, { type: 'window', color: BRICK[Math.floor(r() * BRICK.length)], floors: Math.max(1, levels), seed: r() }));
  g.add(box(THREE, w + 0.4, 0.4, d + 0.4, mat(THREE, 0xd8d4cc), 0, height, 0));        // roof cornice
  g.add(box(THREE, w + 0.2, 0.8, d + 0.2, mat(THREE, 0x9b968c), 0, 0, 0));            // plinth

  // Entrance portico: slab + pillars + door.
  const pw = Math.min(8, w * 0.3);
  const stone = mat(THREE, 0xe4dfd4);
  g.add(box(THREE, pw, 0.35, 2.2, stone, 0, Math.min(3.6, height - 1), d / 2 + 1.1));
  const pillars = pw > 5 ? 4 : 2;
  for (let i = 0; i < pillars; i++) {
    const x = -pw / 2 + 0.3 + ((pw - 0.6) / (pillars - 1)) * i;
    g.add(box(THREE, 0.45, Math.min(3.6, height - 1), 0.45, stone, x, 0, d / 2 + 2));
  }
  g.add(box(THREE, 1.8, 2.5, 0.14, mat(THREE, 0x4a3524), 0, 0.5, d / 2 + 0.07));

  // Flagpole.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 6), mat(THREE, 0xcfcfcf));
  pole.position.set(w * 0.35, height + 3, d * 0.3);
  g.add(pole);
  g.add(box(THREE, 1.2, 0.7, 0.04, mat(THREE, 0x2e8b57), w * 0.35 + 0.6, height + 4.8, d * 0.3));
  return g;
}
