# World Map → 3D City Builder (base system)

A reusable base for GTA-like games: pick **any area on Earth**, generate a primary 3D replica of it, then **Build City** to swap placeholder boxes and flat streets for real asset modules. In **Edit mode** any building can be swapped for any asset in the library.

No build step: vanilla ES modules, Three.js + Leaflet loaded via import map (CDN). Serve the folder with any static server (`python3 -m http.server`) or GitHub Pages.

## How it works (user flow)

1. **Select Area** – a Leaflet map appears; drag a rectangle over the area.
2. **Generate City** – OSM data (Overpass API) is fetched and a primary replica is built: buildings = boxes, streets = flat ribbons.
3. **Build City** – every box is replaced by the nearest-fit building module from `assets/buildings/*`; every street gets a texture from `assets/streets/*`.
4. **Edit** – click a building, pick any asset module from the panel to swap it.
5. **Export** – GLB export and project save/load.

## Repo structure

```
index.html
css/style.css
src/
  core/        state.js, storage.js
  ui/          toolbar.js, mapPicker.js, editPanel.js
  data/        projection.js, overpass.js, parser.js
  world/       scene.js, buildingFactory.js, streetFactory.js, cityGenerator.js,
               assetReplacer.js, picker.js, editMode.js
  assets/      assetLoader.js, moduleKit.js, assetMatcher.js
  export/      glbExport.js
assets/
  manifest.json            <- registry of every asset module (add new assets here)
  buildings/{residential,commercial,industrial,public}/   building modules
  streets/                 street texture modules
```

Asset modules are JS files exporting `meta` + `build(THREE, opts)` (procedural, unit footprint, scaled to fit the lot). `.glb` files also work if listed in `manifest.json` with `"type": "glb"`.

---

## FOR CLAUDE: RESUME INSTRUCTIONS (read first after a session reset)

- Usage limits reset sessions. **Progress lives in this checklist.** Find the first unchecked `[ ]` item, build only that file, then immediately `git add`, tick the box in this README, commit and push (one file per push). Never batch many files.
- Keep each file small and self-contained. Don't rewrite files already marked `[x]` unless fixing a bug.
- Stack is fixed: no bundler, ES modules, import map (three@0.160.0, leaflet@1.9.4). Do not add a build step.
- Shared contracts: `state.js` exposes `state` + `bus` (`on/emit`). Events: `area:selected`, `city:generate`, `city:generated`, `city:build`, `city:built`, `mode:changed`, `building:selected`, `building:swap`.
- City data shape (from `parser.js`): `{ buildings:[{id, footprint:[[x,z]...], height, levels, kind, tags}], roads:[{id, points:[[x,z]...], kind, width}], bounds }` in meters, origin at area center.

## Planned file list / progress

### Phase 0 – Foundation
- [x] README.md
- [x] index.html
- [x] css/style.css
- [x] src/core/state.js
- [x] src/main.js

### Phase 1 – Map area selection
- [x] src/ui/mapPicker.js
- [x] src/ui/toolbar.js

### Phase 2 – Data pipeline
- [x] src/data/projection.js
- [x] src/data/overpass.js
- [x] src/data/parser.js

### Phase 3 – Primary city (boxes + ribbons)
- [x] src/world/scene.js
- [x] src/world/buildingFactory.js
- [x] src/world/streetFactory.js
- [x] src/world/cityGenerator.js

### Phase 4 – Asset system + Build City
- [x] assets/manifest.json
- [x] src/assets/moduleKit.js
- [x] src/assets/assetLoader.js
- [x] assets/buildings/residential/house_small.js
- [x] assets/buildings/residential/apartment_block.js
- [x] assets/buildings/commercial/shop_row.js
- [x] assets/buildings/commercial/office_tower.js
- [x] assets/buildings/industrial/warehouse.js
- [ ] assets/buildings/public/school.js
- [ ] assets/streets/asphalt_primary.js
- [ ] assets/streets/asphalt_secondary.js
- [ ] assets/streets/residential_lane.js
- [ ] assets/streets/footpath.js
- [ ] assets/streets/dirt_track.js
- [ ] src/assets/assetMatcher.js
- [ ] src/world/assetReplacer.js

### Phase 5 – Edit mode
- [ ] src/world/picker.js
- [ ] src/ui/editPanel.js
- [ ] src/world/editMode.js

### Phase 6 – Export & polish
- [ ] src/export/glbExport.js
- [ ] src/core/storage.js
- [ ] assets/README.md (how to add new assets)
- [ ] Final syntax/import check of all files
