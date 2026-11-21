// Save / load a project as a .json file: selected area, parsed city data and the user's asset overrides.
// Loading rebuilds the city from the saved data (no network needed).

import { state, bus, setMode, setStatus, showLoader, hideLoader } from './state.js';

const VERSION = 1;

function download(text, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function saveProject() {
  if (!state.generated || !state.cityData) return setStatus('Nothing to save yet.');
  const d = state.cityData;
  const slim = (items) => items.map(({ tags, ...rest }) => rest); // drop raw OSM tags to keep files small
  const project = {
    version: VERSION,
    savedAt: new Date().toISOString(),
    area: state.area,
    built: state.built,
    overrides: state.overrides,
    cityData: { ...d, buildings: slim(d.buildings), roads: d.roads },
  };
  download(JSON.stringify(project), 'city-project.json');
  setStatus('Project saved.');
}

export function loadProject() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      showLoader('Loading project…');
      const project = JSON.parse(await file.text());
      if (project.version !== VERSION || !project.cityData) throw new Error('Unsupported project file.');
      await restore(project);
      setStatus('Project loaded.');
    } catch (e) {
      console.error(e);
      setStatus(`Load failed: ${e.message}`);
    } finally {
      hideLoader();
    }
  };
  input.click();
}

async function restore(project) {
  const { generateCity } = await import('../world/cityGenerator.js');
  const { buildCity, swapBuilding } = await import('../world/assetReplacer.js');
  const { flyToArea } = await import('../ui/mapPicker.js');

  state.area = project.area;
  state.cityData = project.cityData;
  state.overrides = project.overrides || {};
  flyToArea(project.area);

  await generateCity(document.getElementById('city-canvas'), state.cityData);
  state.generated = true;
  state.built = false;
  setMode('city');
  bus.emit('view:city');
  bus.emit('city:generated', state.cityData);

  if (project.built) {
    await buildCity(state.cityData, state.overrides);
    state.built = true;
    bus.emit('city:built');
  } else {
    for (const [id, assetId] of Object.entries(state.overrides)) await swapBuilding(id, assetId);
  }
  bus.emit('project:loaded');
}
