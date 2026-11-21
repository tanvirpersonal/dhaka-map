#!/usr/bin/env node
// Auto-register assets dropped into the assets/ folders.
//
//   node tools/scan-assets.mjs
//
// - assets/buildings/<category>/*.glb          -> building entries (type "glb")
// - assets/streets/*.png|jpg|jpeg|webp         -> street entries (type "image")
// Existing manifest entries are never changed; only missing files are added.
// Optional sidecar file next to an asset (same name, .json) overrides the defaults, e.g.
//   assets/buildings/residential/villa.json -> { "name": "Villa", "kinds": ["house"], "areaRange": [100, 400], "heightRange": [4, 12] }
//   assets/streets/brick_lane.json          -> { "kinds": ["residential"], "tileLength": 6 }

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const manifestPath = path.join(ROOT, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Defaults per building category (matches kinds produced by src/data/parser.js).
const CATEGORY_DEFAULTS = {
  residential: { kinds: ['house', 'apartment', 'generic'], areaRange: [15, 600], heightRange: [2.5, 30] },
  commercial: { kinds: ['commercial', 'office', 'generic'], areaRange: [30, 2000], heightRange: [3, 60] },
  industrial: { kinds: ['industrial', 'generic'], areaRange: [80, 8000], heightRange: [3.5, 16] },
  public: { kinds: ['public'], areaRange: [150, 9000], heightRange: [3.5, 22] },
};
const FALLBACK = { kinds: ['generic'], areaRange: [20, 1000], heightRange: [3, 30] };

const prettify = (s) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const sidecar = (file) => {
  const p = file.replace(/\.[^.]+$/, '.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
};
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

const knownPaths = new Set([...manifest.buildings, ...manifest.streets].map((a) => a.path));
const knownIds = new Set([...manifest.buildings, ...manifest.streets].map((a) => a.id));
let added = 0;

function uniqueId(base) {
  let id = base, n = 2;
  while (knownIds.has(id)) id = `${base}_${n++}`;
  knownIds.add(id);
  return id;
}

// Buildings: assets/buildings/<category>/*.glb
const bRoot = path.join(ROOT, 'buildings');
if (fs.existsSync(bRoot)) {
  for (const cat of fs.readdirSync(bRoot, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const f of fs.readdirSync(path.join(bRoot, cat.name)).filter((n) => /\.glb$/i.test(n))) {
      const file = path.join(bRoot, cat.name, f);
      if (knownPaths.has(rel(file))) continue;
      const base = f.replace(/\.glb$/i, '');
      const d = CATEGORY_DEFAULTS[cat.name] || FALLBACK;
      manifest.buildings.push({
        id: uniqueId(base.toLowerCase().replace(/[^a-z0-9_]+/g, '_')),
        name: prettify(base), category: cat.name, type: 'glb', path: rel(file),
        kinds: d.kinds, areaRange: d.areaRange, heightRange: d.heightRange,
        ...sidecar(file),
      });
      console.log(`+ building  ${rel(file)}`);
      added++;
    }
  }
}

// Streets: assets/streets/*.png|jpg|jpeg|webp
const sRoot = path.join(ROOT, 'streets');
if (fs.existsSync(sRoot)) {
  for (const f of fs.readdirSync(sRoot).filter((n) => /\.(png|jpe?g|webp)$/i.test(n))) {
    const file = path.join(sRoot, f);
    if (knownPaths.has(rel(file))) continue;
    const base = f.replace(/\.[^.]+$/, '');
    manifest.streets.push({
      id: uniqueId(base.toLowerCase().replace(/[^a-z0-9_]+/g, '_')),
      name: prettify(base), type: 'image', path: rel(file),
      kinds: ['residential'], tileLength: 8,
      ...sidecar(file),
    });
    console.log(`+ street    ${rel(file)}  (default kind: residential; add a .json sidecar to change)`);
    added++;
  }
}

if (added) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(added ? `Registered ${added} new asset(s) in assets/manifest.json` : 'Nothing new to register.');
