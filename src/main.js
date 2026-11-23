// App bootstrap + workflow orchestration.
// Heavy modules are imported lazily so a partially built repo still loads.

import { state, bus, setMode, setStatus, showLoader, hideLoader, setLoaderProgress } from './core/state.js';

const $ = (id) => document.getElementById(id);

function layout() {
  const h = $('toolbar').getBoundingClientRect().height;
  document.documentElement.style.setProperty('--toolbar-h', `${Math.ceil(h)}px`);
  bus.emit('layout:resized');
}

function showView(name) {
  $('map-view').classList.toggle('active', name === 'map');
  $('city-view').classList.toggle('active', name === 'city');
  bus.emit('view:changed', name);
}

async function lazy(path) {
  try {
    return await import(path);
  } catch (e) {
    console.error(`Failed to load ${path}`, e);
    setStatus(`Module missing or failed: ${path}`);
    throw e;
  }
}

async function init() {
  window.addEventListener('resize', layout);
  layout();

  const { initToolbar } = await lazy('./ui/toolbar.js');
  initToolbar();
  (await lazy('./ui/layersPanel.js')).initLayersPanel();

  const { initMapPicker } = await lazy('./ui/mapPicker.js');
  initMapPicker($('map-view'));
}

// --- workflow -----------------------------------------------------------

bus.on('view:map', () => {
  setMode('select');
  showView('map');
  setStatus('Drag a rectangle on the map to choose an area.');
});

bus.on('view:city', () => showView('city'));

bus.on('area:selected', (area) => {
  state.area = area;
  state.generated = false;
  state.built = false;
  const kmH = (area.north - area.south) * 111.32;
  const kmW = (area.east - area.west) * 111.32 * Math.cos(((area.north + area.south) / 2) * Math.PI / 180);
  import('./data/overpass.js').then(({ planTiles }) => {
    const tiles = planTiles(area).length;
    const big = Math.max(kmW, kmH) > 3.2 ? ' Large area: needs a strong device; use Low quality if it lags.' : '';
    setStatus(`Area ${kmW.toFixed(1)} x ${kmH.toFixed(1)} km (${tiles} download tile${tiles > 1 ? 's' : ''}). Tap "Generate City".${big}`);
  });
});

const tick = () => new Promise((r) => setTimeout(r, 0));

// Merge the city into a few chunk meshes (see world/optimizer.js) for smooth viewing.
async function bake(label = 'Optimizing for speed…') {
  showLoader(label);
  setLoaderProgress(null, 'Merging meshes…');
  await tick();
  const { bakeCity } = await lazy('./world/optimizer.js');
  return bakeCity();
}

bus.on('city:generate', async () => {
  if (!state.area) return setStatus('Select an area first.');
  try {
    // Each stage shows its own bar: download (real %), parse (indeterminate), generate (real %).
    showLoader('Contacting map server…');
    const { getCached, putCached } = await lazy('./data/cache.js');
    let raw = await getCached(state.area);
    if (raw) {
      document.getElementById('loader-text').textContent = 'Using saved map data…';
      setLoaderProgress(100, 'loaded from cache, no download needed');
      await tick();
    } else {
      const { fetchOsmTiled } = await lazy('./data/overpass.js');
      raw = await fetchOsmTiled(state.area, (p) => {
        const mb = (p.bytes / 1048576).toFixed(1);
        const tileNote = p.tiles > 1 ? `tile ${p.tile}/${p.tiles} · ` : '';
        if (p.phase === 'waiting') {
          // The downloader says what it is doing: contacting, server busy (retrying), switching to another server.
          document.getElementById('loader-text').textContent = 'Contacting map server…';
          setLoaderProgress(p.tiles > 1 ? p.percent : null, `${tileNote}${p.note || 'Waiting for server…'}`);
          return;
        }
        document.getElementById('loader-text').textContent = 'Downloading map data…';
        const detail = p.total
          ? `${p.ways.toLocaleString()} / ${p.total.toLocaleString()} items · ${mb} MB`
          : `${tileNote}${mb} MB downloaded`;
        setLoaderProgress(p.percent, detail); // download shows its own 0-100% (overall across tiles)
      });
      putCached(state.area, raw); // fire and forget
    }

    showLoader('Parsing buildings and streets…');
    setLoaderProgress(null, 'Reading map data…');
    await tick(); // let the loader repaint
    const { parseOsm } = await lazy('./data/parser.js');
    state.cityData = parseOsm(raw, state.area);

    showLoader('Generating primary city…');
    const { generateCity } = await lazy('./world/cityGenerator.js');
    await generateCity($('city-canvas'), state.cityData, (frac) => {
      setLoaderProgress(frac * 100, `${state.cityData.buildings.length.toLocaleString()} buildings`);
    });
    const stats = await bake();

    state.generated = true;
    state.built = false;
    state.overrides = {};
    setMode('city');
    showView('city');
    const { buildings, roads } = state.cityData;
    setStatus(`Primary city: ${buildings.length} buildings, ${roads.length} streets, ${stats.drawCallsAfter} draw calls. Tap "Build City".`);
    bus.emit('city:generated', state.cityData);
  } catch (e) {
    console.error(e);
    setStatus(`Generate failed: ${e.message}`);
  } finally {
    hideLoader();
  }
});

bus.on('city:build', async () => {
  if (!state.generated) return;
  try {
    showLoader('Loading asset modules…');
    const { setBaked } = await lazy('./world/optimizer.js');
    setBaked(false); // build into the editable objects, then re-bake
    const { buildCity } = await lazy('./world/assetReplacer.js');
    await buildCity(state.cityData, state.overrides, (frac, what) => {
      document.getElementById('loader-text').textContent = what === 'streets' ? 'Texturing streets…' : 'Placing building modules…';
      setLoaderProgress(frac * 100, what === 'buildings' ? `${Math.round(frac * state.cityData.buildings.length).toLocaleString()} / ${state.cityData.buildings.length.toLocaleString()} buildings` : '');
    });
    state.built = true;
    const stats = await bake();
    setStatus(`City built with asset modules (${stats.drawCallsAfter} draw calls). Use Edit Mode to swap buildings.`);
    bus.emit('city:built');
  } catch (e) {
    console.error(e);
    setStatus(`Build failed: ${e.message}`);
  } finally {
    hideLoader();
  }
});

bus.on('mode:toggleEdit', async () => {
  if (!state.generated) return;
  const entering = state.mode !== 'edit';
  try {
    const { setEditMode } = await lazy('./world/editMode.js');
    if (entering) {
      (await lazy('./world/optimizer.js')).setBaked(false); // editable objects needed for picking
      setEditMode(true);
    } else {
      setEditMode(false);
      await bake('Applying your edits…'); // re-merge so swaps are fast to render
    }
    setMode(entering ? 'edit' : 'city');
    setStatus(entering ? 'Edit mode: click a building to swap its asset.' : 'Edit mode off.');
  } finally {
    hideLoader();
  }
});

bus.on('export:glb', async () => {
  try {
    showLoader('Exporting GLB…');
    const { exportGLB } = await lazy('./export/glbExport.js');
    await exportGLB();
  } catch (e) {
    setStatus(`Export failed: ${e.message}`);
  } finally {
    hideLoader();
  }
});

bus.on('time:set', async (h) => {
  const { setTimeOfDay } = await lazy('./world/timeOfDay.js');
  setTimeOfDay(h);
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  $('tod-label').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
});

// Ambient traffic on/off. Returns true when running afterwards.
async function setTraffic(on) {
  const t = await lazy('./world/traffic.js');
  if (on && !t.isTrafficOn()) {
    const r = t.startTraffic();
    if (!r) setStatus('No drivable roads in this area, so no traffic.');
  } else if (!on) {
    t.stopTraffic();
  }
  state.traffic = t.isTrafficOn();
  bus.emit('traffic:changed');
  return state.traffic;
}

bus.on('traffic:toggle', async () => {
  if (!state.generated) return;
  const on = await setTraffic(!state.traffic);
  if (on) setStatus('Traffic on: cars keep to their lane, follow one-way streets and queue at junctions.');
});

// A new/loaded city has a different road graph: stop the old traffic (the user can switch it on again).
for (const evt of ['city:generated', 'project:loaded']) bus.on(evt, () => { if (state.traffic) setTraffic(false); });

bus.on('mode:drive', async () => {
  if (!state.generated) return;
  const drive = await lazy('./world/driveMode.js');
  if (drive.isDriving()) return drive.stopDrive();
  if (state.mode === 'edit') bus.emit('mode:toggleEdit'); // leave edit mode first
  if (!state.traffic) await setTraffic(true);              // a drive test is more useful with other cars around
  drive.startDrive();
});

// Once the first city exists: minimap + time of day (kept lazy so the map screen loads fast).
bus.on('city:generated', async () => {
  const { initTimeOfDay, setTimeOfDay } = await lazy('./world/timeOfDay.js');
  if (!initTimeOfDay.done) { initTimeOfDay(); initTimeOfDay.done = true; }
  setTimeOfDay(parseFloat($('tod').value));
  (await lazy('./ui/minimap.js')).initMinimap();
});

bus.on('export:gamedata', async () => {
  try {
    showLoader('Building game data…');
    await tick();
    const { exportGameData } = await lazy('./export/gameData.js');
    const r = await exportGameData();
    setStatus(`Game data saved: ${r.buildings} colliders, ${r.edges} road segments, ${r.vehicleSpawns} vehicle + ${r.pedestrianSpawns} pedestrian spawns (${r.drivingSide}-hand traffic).`);
  } catch (e) {
    console.error(e);
    setStatus(`Game data export failed: ${e.message}`);
  } finally {
    hideLoader();
  }
});

bus.on('project:save', async () => (await lazy('./core/storage.js')).saveProject());
bus.on('project:load', async () => (await lazy('./core/storage.js')).loadProject());

init().catch((e) => console.error('Init failed', e));
