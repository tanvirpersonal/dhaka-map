// Small pitched-roof house. Fits any lot width x depth.
import { box, mat, gableRoof, rng } from '../../../src/assets/moduleKit.js';
import { facadeBox } from '../../../src/assets/facade.js';

export const meta = { id: 'house_small', name: 'Small House' };

const WALLS = [0xe8d8c0, 0xd9b99b, 0xeadfce, 0xc9d3c1, 0xe3c6b8];
const ROOFS = [0x8a4b38, 0x6f5a4c, 0x7a3f33, 0x5c5c66];

export function build(THREE, { width, depth, height, levels = 2, seed = 1 }) {
  const r = rng(seed);
  const g = new THREE.Group();
  const w = Math.max(3, width), d = Math.max(3, depth);
  const roofRise = Math.min(2.6, Math.max(1.2, d * 0.28));
  const wallH = Math.max(2.6, height - roofRise);

  g.add(facadeBox(THREE, w, wallH, d, { type: 'window', color: WALLS[Math.floor(r() * WALLS.length)], floors: Math.max(1, Math.min(levels, 2)), seed: r() }));
  const roof = gableRoof(THREE, w + 0.6, d + 0.6, roofRise, mat(THREE, ROOFS[Math.floor(r() * ROOFS.length)]), wallH);
  g.add(roof);

  // Door on the front.
  g.add(box(THREE, 1.0, 2.1, 0.12, mat(THREE, 0x5a3a24), (r() - 0.5) * (w * 0.4), 0, d / 2 + 0.05));

  return g;
}
