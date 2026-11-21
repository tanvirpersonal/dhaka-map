// Wires toolbar buttons to bus events and keeps their enabled state in sync.

import { state, bus } from '../core/state.js';

const $ = (id) => document.getElementById(id);

export function initToolbar() {
  $('btn-select-area').onclick = () => bus.emit('view:map');
  $('btn-generate').onclick = () => bus.emit('city:generate');
  $('btn-build').onclick = () => bus.emit('city:build');
  $('btn-edit').onclick = () => bus.emit('mode:toggleEdit');
  $('btn-export').onclick = () => bus.emit('export:glb');
  $('btn-save').onclick = () => bus.emit('project:save');
  $('btn-load').onclick = () => bus.emit('project:load');

  const refresh = () => {
    $('btn-generate').disabled = !state.area;
    $('btn-build').disabled = !state.generated;
    $('btn-edit').disabled = !state.generated;
    $('btn-export').disabled = !state.generated;
    $('btn-save').disabled = !state.generated;
    $('btn-edit').classList.toggle('active', state.mode === 'edit');
    $('btn-select-area').classList.toggle('primary', state.mode === 'select');
    $('btn-generate').classList.toggle('primary', !!state.area && !state.generated);
    $('btn-build').classList.toggle('primary', state.generated && !state.built);
  };

  ['area:selected', 'city:generated', 'city:built', 'mode:changed', 'view:map', 'project:loaded']
    .forEach((evt) => bus.on(evt, refresh));
  refresh();
}
