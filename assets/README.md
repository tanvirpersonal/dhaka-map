# Adding assets

Everything the city builder can place is registered in `manifest.json`. Add a file, add one manifest entry, done — Build City and the Edit-mode swap panel pick it up automatically.

## Building module (procedural, fits any lot exactly)

Create `assets/buildings/<category>/<name>.js`:

```js
import { box, mat, allWindows } from '../../../src/assets/moduleKit.js';

export const meta = { id: 'my_building', name: 'My Building' };

// Origin = footprint center on the ground. Local +x = long side, +z = depth, front faces +z.
export function build(THREE, { width, depth, height, levels, seed }) {
  const g = new THREE.Group();
  g.add(box(THREE, width, height, depth, mat(THREE, 0xcccccc)));
  allWindows(THREE, g, { width, depth, height, levels });
  return g;
}
```

Register it:

```json
{ "id": "my_building", "name": "My Building", "category": "residential", "type": "module",
  "path": "buildings/residential/my_building.js",
  "kinds": ["house", "generic"], "areaRange": [20, 300], "heightRange": [3, 12] }
```

- `kinds`: OSM building kinds it suits (`house, apartment, commercial, office, industrial, public, generic`). Earlier in the list = preferred.
- `areaRange` (m²) / `heightRange` (m): used by the automatic matcher.

## Building model (.glb)

Drop a `.glb` into `assets/buildings/<category>/` and register with `"type": "glb"` and its `path`. It is scaled to the lot's width × height × depth.

## Street texture

Create `assets/streets/<name>.js` exporting `makeTexture(THREE)` that returns a `THREE.CanvasTexture`
(u = across the road, v = along it; one tile = `tileLength` meters) and register it:

```json
{ "id": "my_road", "name": "My Road", "type": "module",
  "path": "streets/my_road.js", "kinds": ["secondary"], "tileLength": 10 }
```

Street kinds: `primary, secondary, residential, footpath, dirt`.

---

## Adding assets made in Blender (easiest workflow)

1. **Model** at real-world scale (1 Blender unit = 1 meter). Put the origin at the bottom center of the building (Object → Set Origin, then move the object so its base sits on Z = 0).
2. **Orientation:** make the front face **-Y** (Blender's default front view). The glTF exporter turns that into +Z, which is what the city builder treats as the front. Long side along X.
3. Apply transforms (`Ctrl+A` → All Transforms) and keep it to one mesh or a few joined objects. Keep it light (a few thousand triangles per building; the city can have hundreds).
4. **Export:** File → Export → glTF 2.0 (`.glb`), "+Y Up" on, "Apply Modifiers" on. Name it like `villa.glb`.
5. **Drop it** in the right folder, e.g. `assets/buildings/residential/villa.glb`.
6. **Register it:** run `node tools/scan-assets.mjs` from the repo root. It adds any new `.glb` to `manifest.json` with sensible defaults for that category.
7. Commit and push. The asset now appears in the Edit-mode swap panel and in automatic Build City matching.

The `.glb` is stretched to each lot's width × height × depth, so model it with a typical proportion for its type.

### Tuning an asset (optional sidecar)

Put a `.json` with the same name next to the file to override defaults:

```json
{ "name": "Villa", "kinds": ["house"], "areaRange": [100, 400], "heightRange": [4, 12] }
```

Run the scan script *after* creating the sidecar (it is read when the asset is first registered), or edit the entry in `manifest.json` directly.

### Street textures from Blender / images

Export a tileable `.png` or `.jpg` (road width across the image, length along it) into `assets/streets/`, add a sidecar such as `brick_lane.json` with `{ "kinds": ["secondary"], "tileLength": 6 }`, then run the scan script. Street assets you add later **override** the built-in one for the same kind.

### Categories

`residential`, `commercial`, `industrial`, `public` already exist under `assets/buildings/`. A new folder (e.g. `assets/buildings/religious/`) also works; it shows as its own group in the swap panel.
