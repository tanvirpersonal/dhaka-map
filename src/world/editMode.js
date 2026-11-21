// Edit mode: tap a building, choose any asset module from the panel, the building is swapped in place.

import { state, bus, setStatus } from '../core/state.js';
import { startPicking, stopPicking, highlight, clearHighlight } from './picker.js';
import { swapBuilding, findBuildingObject } from './assetReplacer.js';
import { showEditPanel, hideEditPanel } from '../ui/editPanel.js';

let active = false;
let wired = false;

async function select(obj) {
  if (!obj) {
    state.selectedBuildingId = null;
    clearHighlight();
    hideEditPanel();
    return;
  }
  const b = obj.userData.building;
  state.selectedBuildingId = b.id;
  highlight(obj);
  await showEditPanel(b, obj.userData.assetId || null);
  bus.emit('building:selected', b);
}

function wireOnce() {
  if (wired) return;
  wired = true;
  bus.on('building:swap', async ({ buildingId, assetId }) => {
    if (!active) return;
    try {
      const obj = await swapBuilding(buildingId, assetId);
      if (obj) await select(obj); // refresh highlight + panel for the new object
      setStatus(assetId ? `Swapped to ${assetId}.` : 'Restored plain box.');
    } catch (e) {
      console.error(e);
      setStatus(`Swap failed: ${e.message}`);
    }
  });
}

export function setEditMode(on) {
  wireOnce();
  active = on;
  if (on) {
    startPicking((obj) => select(obj));
  } else {
    stopPicking();
    hideEditPanel();
    state.selectedBuildingId = null;
  }
}

/** Re-select a building by id (e.g. after load). */
export function selectById(id) {
  const obj = findBuildingObject(id);
  if (obj) select(obj);
}
