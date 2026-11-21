// Side panel listing every building asset from the manifest; click one to swap the selected building.

import { bus } from '../core/state.js';
import { listBuildingAssets } from '../assets/assetLoader.js';

const panel = () => document.getElementById('edit-panel');

export async function showEditPanel(building, currentAssetId) {
  const el = panel();
  const assets = await listBuildingAssets();

  const byCat = {};
  assets.forEach((a) => (byCat[a.category] ||= []).push(a));

  el.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = `Building ${building.id.slice(1)}`;
  el.appendChild(h);

  const info = document.createElement('div');
  info.style.cssText = 'font-size:12px;color:var(--muted);margin-bottom:6px';
  info.textContent = `${building.kind} · ${Math.round(building.area)} m² · ${Math.round(building.height)} m`;
  el.appendChild(info);

  const mk = (label, assetId, isCurrent) => {
    const b = document.createElement('button');
    b.className = 'asset' + (isCurrent ? ' current' : '');
    b.textContent = label;
    b.onclick = () => bus.emit('building:swap', { buildingId: building.id, assetId });
    return b;
  };

  const g0 = document.createElement('div');
  g0.className = 'group';
  g0.textContent = 'placeholder';
  el.appendChild(g0);
  el.appendChild(mk('Plain box', null, !currentAssetId));

  Object.keys(byCat).forEach((cat) => {
    const g = document.createElement('div');
    g.className = 'group';
    g.textContent = cat;
    el.appendChild(g);
    byCat[cat].forEach((a) => el.appendChild(mk(a.name, a.id, a.id === currentAssetId)));
  });

  el.classList.remove('hidden');
}

export function hideEditPanel() {
  panel().classList.add('hidden');
  panel().innerHTML = '';
}
