// App bootstrap + workflow orchestration.
// Heavy modules are imported lazily so a partially built repo still loads.

import { state, bus, setMode, setStatus, showLoader, hideLoader } from './core/state.js';

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
  setStatus('Area selected. Tap "Generate City".');
});

bus.on('city:generate', async () => {
  if (!state.area) return setStatus('Select an area first.');
  try {
    showLoader('Downloading map data…');
    const { fetchOsm } = await lazy('./data/overpass.js');
    const raw = await fetchOsm(state.area);

    showLoader('Parsing buildings and streets…');
    const { parseOsm } = await lazy('./data/parser.js');
    state.cityData = parseOsm(raw, state.area);

    showLoader('Generating primary city…');
    const { generateCity } = await lazy('./world/cityGenerator.js');
    await generateCity($('city-canvas'), state.cityData);

    state.generated = true;
    state.built = false;
    state.overrides = {};
    setMode('city');
    showView('city');
    const { buildings, roads } = state.cityData;
    setStatus(`Primary city: ${buildings.length} buildings, ${roads.length} streets. Tap "Build City".`);
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
    const { buildCity } = await lazy('./world/assetReplacer.js');
    await buildCity(state.cityData, state.overrides);
    state.built = true;
    setStatus('City built with asset modules. Use Edit Mode to swap buildings.');
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
  const { setEditMode } = await lazy('./world/editMode.js');
  setEditMode(entering);
  setMode(entering ? 'edit' : 'city');
  setStatus(entering ? 'Edit mode: click a building to swap its asset.' : 'Edit mode off.');
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

bus.on('project:save', async () => (await lazy('./core/storage.js')).saveProject());
bus.on('project:load', async () => (await lazy('./core/storage.js')).loadProject());

init().catch((e) => console.error('Init failed', e));
