// Leaflet map where the user drags a rectangle to choose the area to build.

import * as L from 'leaflet';
import { state, bus, setStatus } from '../core/state.js';

const MAX_SPAN_DEG = 0.02; // ~2.2 km; keeps Overpass requests and the 3D scene manageable

let map, rect, startLatLng, drawing = false, drawMode = true;

export function initMapPicker(container) {
  map = L.map(container, { zoomControl: true }).setView([23.7806, 90.4075], 15); // default: Dhaka

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  addControls();

  // Mouse + touch: use Leaflet's unified pointer events while draw mode is on.
  map.on('mousedown', onDown);
  map.on('mousemove', onMove);
  map.on('mouseup', onUp);
  map.getContainer().addEventListener('touchstart', (e) => touchToMouse(e, 'mousedown'), { passive: false });
  map.getContainer().addEventListener('touchmove', (e) => touchToMouse(e, 'mousemove'), { passive: false });
  map.getContainer().addEventListener('touchend', (e) => touchToMouse(e, 'mouseup'), { passive: false });

  bus.on('layout:resized', () => map.invalidateSize());
  bus.on('view:changed', (v) => { if (v === 'map') setTimeout(() => map.invalidateSize(), 50); });

  setDrawMode(true);
  setStatus('Drag a rectangle on the map to choose an area (toggle ✋ to pan).');
}

function addControls() {
  const Ctl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const div = L.DomUtil.create('div', 'leaflet-bar');
      const btn = L.DomUtil.create('a', '', div);
      btn.href = '#';
      btn.title = 'Toggle draw / pan';
      btn.style.cssText = 'width:34px;height:34px;line-height:34px;font-size:18px;text-align:center;';
      btn.textContent = '▭';
      L.DomEvent.on(btn, 'click', (e) => {
        L.DomEvent.stop(e);
        setDrawMode(!drawMode);
        btn.textContent = drawMode ? '▭' : '✋';
        setStatus(drawMode ? 'Draw mode: drag to select an area.' : 'Pan mode: move the map freely.');
      });
      L.DomEvent.disableClickPropagation(div);
      return div;
    },
  });
  new Ctl().addTo(map);
}

function setDrawMode(on) {
  drawMode = on;
  if (on) map.dragging.disable(); else map.dragging.enable();
  map.getContainer().style.cursor = on ? 'crosshair' : '';
}

function touchToMouse(e, type) {
  if (!drawMode || e.touches?.length > 1) return;
  const t = e.touches[0] || e.changedTouches[0];
  if (!t) return;
  e.preventDefault();
  const rectEl = map.getContainer().getBoundingClientRect();
  const pt = L.point(t.clientX - rectEl.left, t.clientY - rectEl.top);
  const latlng = map.containerPointToLatLng(pt);
  const fake = { latlng };
  if (type === 'mousedown') onDown(fake);
  else if (type === 'mousemove') onMove(fake);
  else onUp(fake);
}

function onDown(e) {
  if (!drawMode) return;
  drawing = true;
  startLatLng = e.latlng;
  if (rect) { rect.remove(); rect = null; }
  rect = L.rectangle(L.latLngBounds(startLatLng, startLatLng), {
    color: '#3fa9f5', weight: 2, fillOpacity: 0.15,
  }).addTo(map);
}

function onMove(e) {
  if (!drawing || !rect) return;
  rect.setBounds(clamp(L.latLngBounds(startLatLng, e.latlng)));
}

function onUp(e) {
  if (!drawing) return;
  drawing = false;
  const b = clamp(L.latLngBounds(startLatLng, e.latlng));
  rect.setBounds(b);
  const area = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
  if (Math.abs(area.north - area.south) < 0.0004 || Math.abs(area.east - area.west) < 0.0004) {
    setStatus('Area too small — drag a larger rectangle.');
    return;
  }
  state.area = area;
  bus.emit('area:selected', area);
}

// Limit the rectangle to MAX_SPAN_DEG on each axis, anchored at the start point.
function clamp(bounds) {
  let s = bounds.getSouth(), n = bounds.getNorth(), w = bounds.getWest(), e = bounds.getEast();
  if (n - s > MAX_SPAN_DEG) { if (startLatLng.lat <= (n + s) / 2) n = s + MAX_SPAN_DEG; else s = n - MAX_SPAN_DEG; }
  if (e - w > MAX_SPAN_DEG) { if (startLatLng.lng <= (e + w) / 2) e = w + MAX_SPAN_DEG; else w = e - MAX_SPAN_DEG; }
  return L.latLngBounds([s, w], [n, e]);
}

/** Jump the map to a location (used by save/load). */
export function flyToArea(area) {
  if (!map || !area) return;
  const b = L.latLngBounds([area.south, area.west], [area.north, area.east]);
  map.fitBounds(b);
  if (rect) rect.remove();
  rect = L.rectangle(b, { color: '#3fa9f5', weight: 2, fillOpacity: 0.15 }).addTo(map);
}
