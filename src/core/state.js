// Shared app state + tiny event bus. Every module talks through this.

export const state = {
  mode: 'select',        // 'select' | 'city' | 'edit'
  area: null,            // { south, west, north, east }
  cityData: null,        // output of data/parser.js
  generated: false,      // primary replica exists
  built: false,          // asset modules applied
  selectedBuildingId: null,
  // buildingId -> assetId override chosen by the user (persisted in saves)
  overrides: {},
};

const listeners = new Map();

export const bus = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);
  },
  emit(event, payload) {
    (listeners.get(event) || []).forEach((fn) => {
      try { fn(payload); } catch (e) { console.error(`[bus:${event}]`, e); }
    });
  },
};

export function setMode(mode) {
  state.mode = mode;
  bus.emit('mode:changed', mode);
}

export function setStatus(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

export function showLoader(text) {
  const el = document.getElementById('loader');
  if (!el) return;
  document.getElementById('loader-text').textContent = text || 'Working…';
  el.classList.remove('hidden');
}

export function hideLoader() {
  document.getElementById('loader')?.classList.add('hidden');
}
