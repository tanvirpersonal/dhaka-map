// City layers: every kind of thing in the city lives in its own named layer, so each can be shown,
// hidden or (for game code) fetched on its own. Rendering order of flat decals is in layers.js.
//
//   ground   - terrain slab           trees     - instanced trees
//   greens   - parks / grass          lamps     - instanced street lamps
//   water    - rivers / lakes         traffic   - ambient cars
//   streets  - road surfaces
//   sidewalks- curbs / walkways
//   buildings- boxes or asset modules
//
// Layers are found by object name under world.cityRoot (traffic lives in the scene root).

import { world } from './scene.js';
import { bus } from '../core/state.js';
import { hiddenLayers, applyBakedLayerVisibility } from './optimizer.js';

export const LAYER_DEFS = [
  { id: 'ground', label: 'Ground' },
  { id: 'greens', label: 'Parks' },
  { id: 'water', label: 'Water' },
  { id: 'streets', label: 'Streets' },
  { id: 'sidewalks', label: 'Sidewalks' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'trees', label: 'Trees' },
  { id: 'lamps', label: 'Street lamps' },
  { id: 'traffic', label: 'Traffic' },
];
const BAKED = new Set(['streets', 'sidewalks', 'buildings']);
const off = new Set(); // layer ids currently hidden by the user

/** The THREE object for a layer, or null if it does not exist (yet). */
export function getLayer(id) {
  return world.cityRoot?.getObjectByName(id) || world.scene?.getObjectByName(id) || null;
}

export const isLayerVisible = (id) => !off.has(id);

export function setLayerVisible(id, visible) {
  if (visible) off.delete(id); else off.add(id);
  if (BAKED.has(id)) {
    if (visible) hiddenLayers.delete(id); else hiddenLayers.add(id);
    applyBakedLayerVisibility();
  } else {
    const o = getLayer(id);
    if (o) o.visible = visible;
  }
  bus.emit('layers:changed', { id, visible });
}

/** Re-apply the user's choices after a (re)generation, e.g. new objects or a re-bake. */
export function registerCityLayers() {
  for (const id of off) {
    if (BAKED.has(id)) hiddenLayers.add(id);
    else { const o = getLayer(id); if (o) o.visible = false; }
  }
  applyBakedLayerVisibility();
}

export function resetLayers() { [...off].forEach((id) => setLayerVisible(id, true)); }
