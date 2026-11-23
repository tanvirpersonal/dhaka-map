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
- [x] assets/buildings/public/school.js
- [x] assets/streets/asphalt_primary.js
- [x] assets/streets/asphalt_secondary.js
- [x] assets/streets/residential_lane.js
- [x] assets/streets/footpath.js
- [x] assets/streets/dirt_track.js
- [x] src/assets/assetMatcher.js
- [x] src/world/assetReplacer.js

### Phase 5 – Edit mode
- [x] src/world/picker.js
- [x] src/ui/editPanel.js
- [x] src/world/editMode.js

### Phase 6 – Export & polish
- [x] src/export/glbExport.js
- [x] src/core/storage.js
- [x] assets/README.md (how to add new assets)
- [x] Final syntax/import check of all files (node --check + import/export cross-check + manifest paths: 0 problems)

## Status

**All planned files are built and pushed.** Not yet tested in a real browser/WebGL (only syntax, import graph and parser/matcher logic were verified in Node). First thing to do next session: run `python3 -m http.server`, open the page, and fix bugs one at a time (fix, then push each).

## Blender assets workflow (done)

- [x] `.glb` buildings: drop in `assets/buildings/<category>/`, run `node tools/scan-assets.mjs` (see `assets/README.md`)
- [x] Image street textures (`.png/.jpg`) in `assets/streets/`, later-added override built-ins per kind
- [x] tools/scan-assets.mjs auto-registers new assets in `manifest.json`

## Loader progress (done)

- [x] Loader bar with percent (index.html, css/style.css, `setLoaderProgress` in state.js)
- [x] Real download % in `src/data/overpass.js`: count query first, then count streamed ways (percent = ways seen / total ways)
- [x] Parse = indeterminate bar, generate = % by buildings; wired in `src/main.js` + `cityGenerator.js`
- [x] Add progress to Build City (asset replacement)

## Upgrade roadmap: performance + GTA-ready map (Phases 7-9)

Goal: big, fast, game-ready maps. Same rules: one file per push, tick the box in the same commit.

### Phase 7 – Performance
- [x] src/world/optimizer.js  (bake buildings/streets into merged chunk meshes: few draw calls; edit mode shows editable objects)
- [x] src/data/cache.js  (IndexedDB cache of OSM responses; repeat generates are instant)
- [x] src/world/quality.js  (quality presets: shadows, pixel ratio, fog distance)
- [x] Wire optimizer/cache/quality into main.js, cityGenerator.js, storage.js, glbExport.js, index.html + toolbar.js (quality dropdown)

### Phase 8 – GTA map features
- [x] parser: road oneway/lanes/maxspeed/name attributes (src/data/parser.js)
- [x] src/world/sidewalks.js  (curb + sidewalk ribbons along roads)
- [x] src/world/props.js  (instanced street lamps + trees)
- [x] src/export/gameData.js  (colliders, road graph, spawn points as JSON for the game)
- [x] Wire sidewalks/props into cityGenerator.js (+ footpath texture in assetReplacer.js), Export Game Data button

### Phase 9 – Preview tools
- [x] src/world/timeOfDay.js  (sun, sky, fog, window glow at night)
- [x] src/world/driveMode.js  (drive a test car, collide with buildings)
- [x] src/ui/minimap.js
- [x] Tiled Overpass fetch for bigger areas (src/data/overpass.js + mapPicker cap raised to 0.045 deg ~5 km)
- [x] Wire time slider, drive button, minimap into index.html/toolbar.js/main.js

### Phase 10 – Scale + visual quality (driven by browser measurements: 1,764 buildings = 5,840 draw calls, 872k tris, 80 MB geometry)
- [x] Pause rendering behind the loader (Build City 356 s -> 12 s)
- [x] src/world/layers.js  (z-fighting fix: ground/parks/roads/sidewalks drawn by renderOrder, no depth fighting)
- [x] src/world/optimizer.js: merge by material signature + vertex colors, indexed merge, 400 m chunks (measured: 5,840 -> 603 draw calls at 1,764 buildings)
- [x] src/assets/facade.js: facade-texture windows/curtain wall/corrugated metal + per-window night lighting; all 6 building modules converted (measured: 872k -> 333k tris, 80 -> 30 MB, heap 631 -> 159 MB)
- [x] Buildings face the nearest street (assetReplacer.js + src/world/streetIndex.js; verified on 4,000 random lots)
- [x] Ambient traffic on the road graph in drive mode (src/world/traffic.js: lane side, one-way, car following, junction waiting; 2 draw calls; 200 cars = 0.03 ms/step in Node; player collides with traffic via capsules)
- [x] Browser e2e + stress test now in the repo: `tools/e2e/` (see its README). Measured on the current code:
  - `traffic-e2e.js`: 15/15 checks pass in real Chromium, 0 console errors (generate, build, traffic on/off, drive with traffic, regenerate stops traffic)
  - `stress.js 0.03` (1,764 buildings, 44 streets, 4 download tiles, 200 traffic cars): generate 1.9 s, Build City 8.1 s, 602 baked meshes, 318k tris / 28.5 MB geometry, JS heap 179 MB
  - draw calls per frame: 610 without traffic, 612 with 200 cars (cars cost 2 draw calls, ~5k tris); traffic simulation 0.047 ms per step in the browser
  - frame times are not reported: the test browser uses software rendering (about 1 fps), so judge FPS on real hardware

## Fast, reliable map download (ported from the `gpt-1` branch + tightened)

`src/data/overpass.js`. The `gpt-1` branch only changed this file (commits 768bf2a, f573a99); `main` has tiling + cache that gpt-1 predates, so the ideas were ported by hand instead of merging.

- [x] From gpt-1: retries with exponential backoff and `Retry-After` for busy answers (408/429/5xx), per-attempt timeout, `remark` check (Overpass answers HTTP 200 with a remark when a query timed out), longer server-side timeout (90 s), Asia mirror `ovp.dresel.systems/api-as` first (nearby, sends CORS headers)
- [x] Server order by region: Asia mirror first for South/SE/East Asia, `overpass-api.de` first elsewhere; the last server that worked is remembered (localStorage `overpassBestEndpoint`) and tried first next time. A multi-tile area pays for a dead server only once
- [x] Faster failover than gpt-1: a timeout, stalled download (45 s without data), network error or `remark` moves to the next server immediately instead of retrying the same one 3 times; whole server list is tried twice before giving up
- [x] The count query (for the percentage) now runs IN PARALLEL with the data request and is sent second, so it can never delay the download. If it fails or is rejected, the bar shows MB instead of a percentage. (Branch `2` removed the count entirely; this keeps the percentage without the extra wait)
- [x] Loader shows what is happening: "Contacting…", "server is busy (503), retrying in 2 s…", "Trying another server: …"
- [x] Tests: `node tools/test/overpass-test.mjs` (14 offline tests against a fake Overpass server: busy, Retry-After, hung, dead, stalled, remark, slow/rejected count, remembered server, region order, multi-tile) and `tools/e2e/download-e2e.js` (11 real-browser checks)
- [ ] Not measured: real download speed. This sandbox cannot reach Overpass, so test on your network (Dhaka -> Asia mirror) and check the browser Network tab
- [ ] Candidate for later: smaller Overpass output (`out tags geom` for buildings, nodes only for roads) once it can be verified against a live server

## Branch `2` merged (done)
Merged into `main` (46c1e55): chase / cockpit / hood drive cameras (C or 1/2/3), wheel + suspension feel,
roadside trees kept clear of roads, graphics presets / colour pipeline. Kept from `main`: ambient traffic
(`src/world/traffic.js`) and the failover downloader (count query stays parallel instead of a preflight).
Checks after merge: 14/14 offline downloader tests, download e2e 11/11, traffic e2e 15/15 (cameras cycled while driving).

- Drive camera smoothing (Nov 23): camera position now rigid to the car, only heading and chase distance are smoothed (pull in fast, ease out slow); removes jitter/snapping.

## Real-city layout + layers (done, Nov 23)
- `src/data/layout.js`: `clearBuildingsFromRoads(data)` runs at the start of generateCity. Samples each footprint, slides it off any road
  corridor (half width + sidewalk + 0.8 m margin), shrinks it if squeezed, drops it if it would need >7 m move. Idempotent. Test: `node tools/test/layout-test.mjs`.
- Trees/lamps: lamps now also avoid other roads; trees and lamps avoid water. Trees were already kept clear of roads and buildings.
- `src/world/layerManager.js` + `src/ui/layersPanel.js` (toolbar **Layers** button): ground, greens, water, streets, sidewalks, buildings, trees, lamps, traffic
  each a named group, toggle individually (baked chunks carry `userData.layer`). e2e covers it (traffic-e2e 19/19).

## GLB road texture (Nov 23)
`assets/streets/Untitled.glb` (id `road_glb_segment`, kinds primary/secondary/residential) supplies the asphalt texture. Its preview quad is only a texture
carrier: the texture is tiled square along each road (one tile = road width), so lane lines never stretch. One shared material, one mesh per road, merged by
Build City. Fixed: the street swap loop skipped roads while replacing. Test: `node tools/e2e/roadtex-e2e.js`.

## Next ideas (unchecked = not started)

Done and verified in a real browser: Generate / Build / Edit swap / GLB export, buildings facing streets, props, sidewalks, traffic, drive mode.

- [ ] On-foot walk mode (player controller) for GTA-style games
- [ ] Traffic lights / stop signs at junctions, AI cars braking for the player
- [ ] Pedestrians on footpaths (use `spawnPoints.pedestrians` from the game-data export)
- [ ] Terrain/elevation (SRTM or similar) so hills and bridges are not flat
- [ ] Per-street swap in edit mode (street textures from `assets/streets`)
- [ ] More asset categories made in Blender (see `assets/README.md`): street signs, bus stops, fences, mosque/temple, bridges
- [ ] GitHub Pages deploy note + live link


## GitHub Pages module-load + favicon fix (Nov 23, 2026)

### Reported browser errors
- `src/data/projection.js` returned HTTP 503 while the browser was loading the city parser.
- `src/main.js` then reported `Failed to fetch dynamically imported module: ./data/parser.js`. This was a cascading ES-module graph failure: `parser.js` statically imported `projection.js`, so a failed dependency prevented the parser module from evaluating.
- `favicon.ico` returned 404 because the page did not declare a favicon and the browser requested its default `/favicon.ico`.

### Changes made
- `src/data/parser.js`: moved the small local equirectangular projection helper into the parser module. The parser no longer needs to fetch `projection.js` as a dependency, so a transient 503 on that standalone file cannot block city parsing. The existing `src/data/projection.js` is retained for any other module that may use it.
- `assets/favicon.svg`: added a lightweight project favicon.
- `index.html`: explicitly links to `assets/favicon.svg` using a repository-relative path, which works under the GitHub Pages project URL `/dhaka-map/`.

### Verification / follow-up
- Confirmed the updated source files and favicon were committed to the `main` branch.
- GitHub Pages live deployment could not be independently checked from this session. After Pages finishes deploying, hard-refresh the site (Ctrl+Shift+R) and confirm the Network panel no longer shows the parser import failure or favicon 404.
- If `parser.js` itself still returns 503 after deployment, that is a GitHub Pages/CDN availability problem rather than a parser dependency issue; retry after deployment/cache propagation and check the file URL directly.


## Blender road surface texture (Nov 23, 2026)

- Source: `assets/streets/Untitled.blend` (uploaded Blender project). The project contains an embedded 1024×1024 asphalt image datablock named `road_asphalt_secondary`; its original external source path pointed to a local machine and was not suitable for GitHub Pages.
- Extracted the embedded image and converted it to a compact 512×512 WebP at `assets/streets/road_asphalt.webp` (about 13 KB), so the browser can load it directly without parsing the Blender project.
- Registered `blender_road_asphalt` in `assets/manifest.json` as an image street asset for `primary` and `secondary` roads, with a 12 m repeat length. The existing asset loader already supports `type: "image"`, and Build City applies the manifest's last matching street asset, so no renderer rewrite was needed.
- The source `.blend` is retained unchanged. Residential lanes, footpaths and dirt tracks keep their existing materials; the Blender texture is assigned to primary and secondary roads only.
- Browser/WebGL visual verification is still required after GitHub Pages deploy: select an area, Generate City, then Build City and inspect primary/secondary road tiling and line orientation.


## GLB road model integration (Nov 23, 2026)

- Activated the uploaded `assets/streets/Untitled.glb` as `road_glb_segment` in `assets/manifest.json`, matching OSM `primary` and `secondary` road kinds.
- `src/assets/assetLoader.js` now loads the GLB through Three.js GLTFLoader, caches the source scene, measures its horizontal dimensions, and creates oriented/scaled instances along each road polyline segment. The GLB's own mesh materials/textures are retained.
- `src/world/assetReplacer.js` now swaps primary/secondary road ribbons for the GLB segment group during **Build City**. Residential lanes, footpaths, and dirt tracks continue using their existing materials.
- Disabled the legacy `asphalt_primary`, `asphalt_secondary`, and previous `blender_road_asphalt` image entry (`enabled: false`); disabled entries are excluded from street-asset lists and matching. This prevents the older replaceable road assets from overriding the GLB.
- The earlier `assets/streets/road_asphalt.webp` file is no longer selected; it is retained in the repo but inactive. The original `.blend` source is untouched.
- Visual verification is pending: the GLB's axis, pivot, width/length proportions, and segment seams must be checked in a real browser after deployment. If the model's long axis or pivot differs from the assumed horizontal bounding-box layout, orientation/offset may need a small adjustment.


### GLB road integration supersedes the earlier image-texture setup

The previous `road_asphalt.webp` image registration is now disabled. The active road asset is the uploaded `assets/streets/Untitled.glb`; the old primary/secondary procedural asphalt entries are disabled as well. GLB road geometry is placed along each OSM segment and uses `InstancedMesh` per source mesh to avoid one draw call per road segment. This is the current implementation; the earlier image-texture setup is not active.


### Removed obsolete road texture reference

Removed the disabled `blender_road_asphalt` manifest entry that still referenced the deleted/nonexistent `streets/road_asphalt.webp` file. The active road entry remains `road_glb_segment` pointing to `streets/Untitled.glb`. If an already-open browser tab still requests the old WebP, it is running a cached/previous GitHub Pages deployment; hard-refresh after the latest Pages deployment completes.
