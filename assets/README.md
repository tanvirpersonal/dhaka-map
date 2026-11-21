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
