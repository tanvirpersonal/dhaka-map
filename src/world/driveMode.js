// Drive test: take a car for a spin through the generated map to check roads, scale and collisions.
// Keys: W/A/S/D or arrows, Space = handbrake, Esc = exit. On touch screens an on-screen pad appears.
// Pure physics/collision helpers are exported so they can be unit tested without WebGL.

import * as THREE from 'three';
import { world } from './scene.js';
import { state, setMode, setStatus } from '../core/state.js';
import { trafficCollide } from './traffic.js';

const WHEEL_BASE = 2.7, MAX_SPEED = 30, MAX_REVERSE = 8, ACCEL = 11, BRAKE = 26, MAX_STEER = 0.5;

// ---------- collisions (2D, circles vs building footprints) ----------

function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function makeCollider(buildings, cell = 30) {
  const grid = new Map();
  const polys = buildings.map((b) => b.footprint);
  polys.forEach((poly, idx) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    for (let cx = Math.floor(minX / cell); cx <= Math.floor(maxX / cell); cx++) {
      for (let cz = Math.floor(minZ / cell); cz <= Math.floor(maxZ / cell); cz++) {
        const k = `${cx},${cz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(idx);
      }
    }
  });

  /** Push a circle out of any building. Returns {x, z, hit} with the corrected center. */
  return function resolve(x, z, r) {
    let hit = false;
    const seen = new Set();
    for (let cx = Math.floor((x - r) / cell); cx <= Math.floor((x + r) / cell); cx++) {
      for (let cz = Math.floor((z - r) / cell); cz <= Math.floor((z + r) / cell); cz++) {
        for (const idx of grid.get(`${cx},${cz}`) || []) {
          if (seen.has(idx)) continue;
          seen.add(idx);
          const poly = polys[idx];
          let best = null; // closest point on the outline
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const [ax, az] = poly[j], [bx, bz] = poly[i];
            const ex = bx - ax, ez = bz - az;
            const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
            const px = ax + ex * t, pz = az + ez * t;
            const d = Math.hypot(x - px, z - pz);
            if (!best || d < best.d) best = { d, px, pz };
          }
          const inside = pointInPoly(x, z, poly);
          if (inside || best.d < r) {
            hit = true;
            const away = inside ? -1 : 1; // inside: push toward the nearest edge then out
            let nx = (x - best.px) * away, nz = (z - best.pz) * away;
            const len = Math.hypot(nx, nz) || 1;
            nx /= len; nz /= len;
            const push = inside ? best.d + r : r - best.d;
            x = inside ? best.px + nx * r : x + nx * push;
            z = inside ? best.pz + nz * r : z + nz * push;
          }
        }
      }
    }
    return { x, z, hit };
  };
}

// ---------- car physics ----------

export function makeCar(x = 0, z = 0, heading = 0) {
  return { x, z, heading, speed: 0, steer: 0 };
}

/** One physics step. inp = { up, down, left, right, brake } booleans. collide(x,z,r) -> {x,z,hit}. */
export function stepCar(c, inp, dt, collide) {
  if (inp.up) c.speed += ACCEL * dt;
  else if (inp.down) c.speed -= (c.speed > 0.5 ? BRAKE : ACCEL * 0.7) * dt;
  if (inp.brake) c.speed -= Math.sign(c.speed) * Math.min(Math.abs(c.speed), 35 * dt);

  // Rolling resistance + air drag.
  const drag = (1.2 + 0.012 * c.speed * c.speed) * dt;
  c.speed -= Math.sign(c.speed) * Math.min(Math.abs(c.speed), drag);
  c.speed = Math.max(-MAX_REVERSE, Math.min(MAX_SPEED, c.speed));

  // Steering eases toward the target and weakens at speed.
  const target = ((inp.left ? 1 : 0) - (inp.right ? 1 : 0)) * MAX_STEER / (1 + Math.abs(c.speed) * 0.07);
  c.steer += (target - c.steer) * Math.min(1, 8 * dt);

  c.heading += (c.speed / WHEEL_BASE) * Math.tan(c.steer) * dt;
  c.x += Math.sin(c.heading) * c.speed * dt;
  c.z += Math.cos(c.heading) * c.speed * dt;

  if (collide) {
    // Two circles (front and rear axle) approximate the car body.
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    let hit = false;
    for (const off of [1.3, -1.3]) {
      const r = collide(c.x + fx * off, c.z + fz * off, 1.05);
      if (r.hit) { c.x = r.x - fx * off; c.z = r.z - fz * off; hit = true; }
    }
    if (hit) c.speed *= 0.55;
  }
  return c;
}

// ---------- scene part ----------

let active = null; // { car, input, cleanup[] }
const input = { up: false, down: false, left: false, right: false, brake: false };

function buildCarMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 4.2), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.4, metalness: 0.3 }));
  body.position.y = 0.7;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2.0), new THREE.MeshStandardMaterial({ color: 0x1b2733, roughness: 0.2, metalness: 0.4 }));
  cabin.position.set(0, 1.3, -0.2);
  g.add(body, cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12); wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  for (const [x, z] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat); w.position.set(x, 0.38, z); g.add(w);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** Start on the longest drivable road, heading along it. */
function pickStart() {
  let best = null, bestLen = 0;
  for (const r of state.cityData.roads) {
    if (!r.drivable || r.points.length < 2) continue;
    let len = 0;
    for (let i = 1; i < r.points.length; i++) len += Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][1] - r.points[i - 1][1]);
    if (len > bestLen) { bestLen = len; best = r; }
  }
  if (!best) return makeCar(0, 0, 0);
  const [x0, z0] = best.points[0], [x1, z1] = best.points[1];
  return makeCar(x0, z0, Math.atan2(x1 - x0, z1 - z0));
}

function touchPad(onExit) {
  const pad = document.createElement('div');
  pad.id = 'drive-ui';
  pad.innerHTML = `
    <div class="drive-hud"><b id="drive-speed">0</b> km/h</div>
    <button class="drive-exit">Exit drive</button>
    <div class="drive-pad left"><button data-k="left">◀</button><button data-k="right">▶</button></div>
    <div class="drive-pad right"><button data-k="up">▲</button><button data-k="down">▼</button></div>`;
  pad.querySelector('.drive-exit').onclick = onExit;
  pad.querySelectorAll('[data-k]').forEach((b) => {
    const k = b.dataset.k;
    const set = (v) => (e) => { e.preventDefault(); input[k] = v; };
    b.addEventListener('pointerdown', set(true));
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, set(false)));
  });
  document.getElementById('city-view').appendChild(pad);
  return pad;
}

export function isDriving() { return !!active; }

export function startDrive() {
  if (active || !state.cityData) return;
  const resolveBuildings = makeCollider(state.cityData.buildings);
  const resolve = (x, z, r) => {
    const a = resolveBuildings(x, z, r), b = trafficCollide(a.x, a.z, r);
    return { x: b.x, z: b.z, hit: a.hit || b.hit };
  };
  const car = pickStart();
  const mesh = buildCarMesh();
  world.scene.add(mesh);
  world.controls.enabled = false;

  const keyMap = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'brake' };
  const onKey = (v) => (e) => {
    if (e.code === 'Escape' && v) return stopDrive();
    const k = keyMap[e.code];
    if (k) { input[k] = v; e.preventDefault(); }
  };
  const kd = onKey(true), ku = onKey(false);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  const pad = touchPad(stopDrive);
  const speedEl = pad.querySelector('#drive-speed');

  const camPos = new THREE.Vector3(), look = new THREE.Vector3();
  const frame = (dt) => {
    stepCar(car, input, Math.min(dt, 0.05), resolve);
    mesh.position.set(car.x, 0.05, car.z);
    mesh.rotation.y = car.heading;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    camPos.set(car.x - fx * 9, 4.6, car.z - fz * 9);
    world.camera.position.lerp(camPos, Math.min(1, 6 * dt));
    look.set(car.x + fx * 4, 1.2, car.z + fz * 4);
    world.camera.lookAt(look);
    speedEl.textContent = Math.abs(Math.round(car.speed * 3.6));
  };
  world.onFrame.add(frame);

  active = {
    prevMode: state.mode,
    cleanup: [() => world.onFrame.delete(frame), () => window.removeEventListener('keydown', kd),
      () => window.removeEventListener('keyup', ku), () => pad.remove(),
      () => { world.scene.remove(mesh); mesh.traverse((o) => o.geometry?.dispose()); }],
  };
  setMode('drive');
  setStatus('Driving: W/A/S/D or arrows, Space = handbrake, Esc = exit.');
}

export function stopDrive() {
  if (!active) return;
  active.cleanup.forEach((fn) => fn());
  Object.keys(input).forEach((k) => { input[k] = false; });
  world.controls.enabled = true;
  const t = world.controls.target;
  world.camera.position.set(t.x + 160, 200, t.z + 220); // back to an overview of the city
  world.controls.update();
  setMode('city');
  setStatus('Drive ended.');
  active = null;
}
