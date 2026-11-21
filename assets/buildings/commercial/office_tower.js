// Glass office tower: podium + shaft with horizontal glazing bands, setback crown and antenna.
import { box, mat, rng } from '../../../src/assets/moduleKit.js';

export const meta = { id: 'office_tower', name: 'Office Tower' };

const GLASS = [0x4f7fa8, 0x5b8aa0, 0x3f6f8f, 0x6d8fa5];

export function build(THREE, { width, depth, height, levels = 10, seed = 1 }) {
  const r = rng(seed);
  const g = new THREE.Group();
  const w = Math.max(8, width), d = Math.max(8, depth);
  const glass = mat(THREE, GLASS[Math.floor(r() * GLASS.length)], { roughness: 0.12, metalness: 0.55 });
  const frame = mat(THREE, 0x3a4048, { roughness: 0.5, metalness: 0.3 });

  const podiumH = Math.min(6, height * 0.12);
  const crownH = Math.min(8, height * 0.08);
  const shaftH = height - podiumH - crownH;

  g.add(box(THREE, w, podiumH, d, mat(THREE, 0x6b7077, { roughness: 0.6 })));
  g.add(box(THREE, w * 0.9, shaftH, d * 0.9, glass, 0, podiumH, 0));

  // Horizontal floor bands for a banded-curtain-wall look.
  const floors = Math.max(4, Math.min(levels, Math.floor(shaftH / 3.4)));
  const bandH = 0.28;
  for (let f = 1; f < floors; f++) {
    g.add(box(THREE, w * 0.9 + 0.12, bandH, d * 0.9 + 0.12, frame, 0, podiumH + (shaftH / floors) * f, 0));
  }

  // Setback crown + mechanical box + antenna.
  g.add(box(THREE, w * 0.7, crownH, d * 0.7, frame, 0, podiumH + shaftH, 0));
  g.add(box(THREE, w * 0.3, 2, d * 0.3, mat(THREE, 0x5d636b), 0, height, 0));
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, Math.min(18, height * 0.15), 6), frame);
  ant.position.y = height + 2 + Math.min(18, height * 0.15) / 2;
  ant.castShadow = true;
  g.add(ant);
  return g;
}
