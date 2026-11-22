// Low commercial row: shopfronts with awnings on the ground floor, offices/flats above.
import { box, mat, rng } from '../../../src/assets/moduleKit.js';
import { facadeBox } from '../../../src/assets/facade.js';

export const meta = { id: 'shop_row', name: 'Shop Row' };

const WALLS = [0xd7c7b0, 0xcdb9a3, 0xe0d5c0, 0xc7ccd1];
const AWNING = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd68910, 0x884ea0];

export function build(THREE, { width, depth, height, levels = 2, seed = 1 }) {
  const r = rng(seed);
  const g = new THREE.Group();
  const w = Math.max(4, width), d = Math.max(4, depth);
  const groundH = Math.min(4, Math.max(3, height * 0.45));

  g.add(facadeBox(THREE, w, height, d, { type: 'window', color: WALLS[Math.floor(r() * WALLS.length)], floors: Math.max(1, levels), seed: r() }));
  g.add(box(THREE, w + 0.3, 0.35, d + 0.3, mat(THREE, 0x8c8a85), 0, height, 0)); // roof cap

  // Ground-floor shopfronts, each with a glass panel, door and awning.
  const shops = Math.max(1, Math.round(w / 5));
  const sw = w / shops;
  const glass = mat(THREE, 0x6e90ad, { roughness: 0.15, metalness: 0.3 });
  for (let i = 0; i < shops; i++) {
    const x = -w / 2 + sw * (i + 0.5);
    g.add(box(THREE, sw - 0.8, groundH - 1.0, 0.1, glass, x, 0.5, d / 2 + 0.05));
    g.add(box(THREE, sw - 0.4, 0.12, 1.3, mat(THREE, AWNING[Math.floor(r() * AWNING.length)]), x, groundH - 0.3, d / 2 + 0.65));
  }

  return g;
}
