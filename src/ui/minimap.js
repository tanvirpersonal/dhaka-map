// Minimap: a north-up 2D overview (roads, buildings, water, parks) with a live camera marker.
// The static map is drawn once per city; only the marker is redrawn (10 fps). Tap it to jump there.

import { state, bus } from '../core/state.js';
import { world } from '../world/scene.js';
import { isDriving } from '../world/driveMode.js';
import * as THREE from 'three';

const SIZE = 168;
let canvas, ctx, base = null, scale = 1, cx = 0, cz = 0, acc = 0, wired = false;

const toPx = (x, z) => [(x - cx) * scale + SIZE / 2, (z - cz) * scale + SIZE / 2];

function drawPolys(g, items, fill) {
  g.fillStyle = fill;
  for (const it of items) {
    g.beginPath();
    it.footprint.forEach(([x, z], i) => { const [px, py] = toPx(x, z); i ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.closePath();
    g.fill();
  }
}

/** Redraw the static layer for the current city. */
function rebuild() {
  const d = state.cityData;
  if (!d || !canvas) return;
  const b = d.bounds;
  cx = (b.minX + b.maxX) / 2; cz = (b.minZ + b.maxZ) / 2;
  scale = (SIZE - 8) / Math.max(b.width, b.depth);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  base = document.createElement('canvas');
  base.width = base.height = SIZE * dpr;
  const g = base.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = '#1b2430'; g.fillRect(0, 0, SIZE, SIZE);

  drawPolys(g, d.greens, '#2f4a33');
  drawPolys(g, d.water, '#2a5a86');
  g.lineCap = 'round'; g.lineJoin = 'round';
  const style = { primary: ['#e8c36a', 3], secondary: ['#c9c9c9', 2.2], residential: ['#8d96a0', 1.4], footpath: ['#4a5560', 0.6], dirt: ['#6b5a40', 1] };
  for (const kind of ['dirt', 'footpath', 'residential', 'secondary', 'primary']) {
    const [color, w] = style[kind];
    g.strokeStyle = color; g.lineWidth = Math.max(0.6, w * (SIZE / 200));
    g.beginPath();
    for (const r of d.roads) {
      if (r.kind !== kind) continue;
      r.points.forEach(([x, z], i) => { const [px, py] = toPx(x, z); i ? g.lineTo(px, py) : g.moveTo(px, py); });
    }
    g.stroke();
  }
  drawPolys(g, d.buildings, '#566273');

  canvas.style.display = 'block';
  draw();
}

const dir = new THREE.Vector3();
function marker() {
  if (isDriving()) return { x: world.camera.position.x, z: world.camera.position.z };
  return { x: world.controls.target.x, z: world.controls.target.z };
}

function draw() {
  if (!base || !world.camera) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(base, 0, 0, SIZE, SIZE);

  const m = marker();
  const [px, py] = toPx(m.x, m.z);
  world.camera.getWorldDirection(dir);
  const a = Math.atan2(dir.z, dir.x);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(a);
  ctx.fillStyle = '#3fa9f5'; ctx.strokeStyle = '#04121f'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, 5); ctx.lineTo(-2, 0); ctx.lineTo(-5, -5); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

function onTap(e) {
  if (isDriving() || !state.cityData) return;
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width * SIZE - SIZE / 2) / scale + cx;
  const z = ((e.clientY - r.top) / r.height * SIZE - SIZE / 2) / scale + cz;
  const t = world.controls.target;
  world.camera.position.x += x - t.x;
  world.camera.position.z += z - t.z;
  t.set(x, 0, z);
  world.controls.update();
}

export function initMinimap() {
  if (wired) { rebuild(); return; }
  wired = true;
  canvas = document.createElement('canvas');
  canvas.id = 'minimap';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvas.height = SIZE * dpr;
  canvas.style.cssText = `position:absolute;left:10px;top:54px;width:${SIZE}px;height:${SIZE}px;border:1px solid var(--line);` +
    'border-radius:8px;background:#1b2430;cursor:pointer;display:none;box-shadow:0 2px 10px rgba(0,0,0,.4)';
  ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  canvas.addEventListener('pointerdown', onTap);
  document.getElementById('city-view').appendChild(canvas);

  world.onFrame.add((dt) => { acc += dt; if (acc > 0.1) { acc = 0; draw(); } });
  bus.on('city:generated', rebuild);
  bus.on('project:loaded', rebuild);
  rebuild();
}
