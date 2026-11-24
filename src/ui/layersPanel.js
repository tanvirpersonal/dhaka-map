// "Layers" button + floating checklist: show/hide each city layer on its own.

import { state, bus } from '../core/state.js';
import { LAYER_DEFS, layerExists, isLayerVisible, setLayerVisible } from '../world/layerManager.js';

export function initLayersPanel() {
  const btn = document.getElementById('btn-layers');
  const panel = document.getElementById('layers-panel');
  if (!btn || !panel) return;

  const render = () => {
    panel.innerHTML = '<h3>Layers</h3>';
    for (const def of LAYER_DEFS) {
      const exists = layerExists(def.id);
      const row = document.createElement('label');
      row.className = 'layer-row' + (exists ? '' : ' missing');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isLayerVisible(def.id);
      cb.disabled = !exists;
      cb.onchange = () => setLayerVisible(def.id, cb.checked);
      row.append(cb, ' ' + def.label);
      panel.append(row);
    }
  };

  btn.onclick = () => { panel.classList.toggle('hidden'); if (!panel.classList.contains('hidden')) render(); };
  const refresh = () => {
    btn.disabled = !state.generated;
    // traffic is re-created on every start: re-apply a hidden state to the new group
    if (!isLayerVisible('traffic')) setLayerVisible('traffic', false);
    if (!panel.classList.contains('hidden')) render();
  };
  ['city:generated', 'project:loaded', 'traffic:changed', 'view:map'].forEach((e) => bus.on(e, refresh));
  refresh();
}
