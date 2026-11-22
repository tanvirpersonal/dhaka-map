// Mid-rise apartment block with balconies, a ground-floor plinth and a flat roof with a stair core.
import { box, mat, rng } from '../../../src/assets/moduleKit.js';
import { facadeBox } from '../../../src/assets/facade.js';

export const meta = { id: 'apartment_block', name: 'Apartment Block' };

const WALLS = [0xd8c7a8, 0xc9b8a0, 0xcfd2cc, 0xd9b9a2, 0xbfc8d0];

export function build(THREE, { width, depth, height, levels = 5, seed = 1 }) {
  const r = rng(seed);
  const g = new THREE.Group();
  const w = Math.max(5, width), d = Math.max(5, depth);
  const tint = WALLS[Math.floor(r() * WALLS.length)];
  const wall = mat(THREE, tint);
  const plinthH = 1.0;

  g.add(facadeBox(THREE, w, height, d, { type: 'window', color: tint, floors: Math.max(2, levels), seed: r() }));
  g.add(box(THREE, w + 0.2, plinthH, d + 0.2, mat(THREE, 0x8c8479)));

  // Roof slab, parapet and stair/water-tank core.
  g.add(box(THREE, w + 0.3, 0.3, d + 0.3, mat(THREE, 0x9a948a), 0, height, 0));
  const core = box(THREE, Math.min(4, w * 0.3), 2.4, Math.min(4, d * 0.3), wall, (r() - 0.5) * w * 0.3, height + 0.3, (r() - 0.5) * d * 0.3);
  g.add(core);
  g.add(box(THREE, 1.6, 1.6, 1.6, mat(THREE, 0x35506b, { roughness: 0.5 }), w * 0.28, height + 0.3, -d * 0.25));

  // Balconies on the front facade, one slab per floor.
  const floors = Math.max(1, levels);
  const floorH = (height - plinthH) / floors;
  const bal = mat(THREE, 0x7b756c);
  const n = Math.max(1, Math.floor(w / 6));
  for (let f = 1; f < floors; f++) {
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      g.add(box(THREE, Math.min(2.6, w / n - 0.8), 0.15, 1.1, bal, x, plinthH + floorH * f, d / 2 + 0.55));
    }
  }
  return g;
}
