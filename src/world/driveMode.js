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

  // Progressive steering: quick at low speed, restrained and stable at high speed.
  const speed01 = Math.min(1, Math.abs(c.speed) / MAX_SPEED);
  const target = ((inp.left ? 1 : 0) - (inp.right ? 1 : 0)) * MAX_STEER * (1 - speed01 * 0.48);
  c.steer += (target - c.steer) * (1 - Math.exp(-7.5 * dt));

  // A little lateral grip keeps the bicycle model predictable without arcade snapping.
  const yawRate = (c.speed / WHEEL_BASE) * Math.tan(c.steer);
  c.heading += yawRate * dt;
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
const CAMERA_MODES = ['chase', 'cockpit', 'hood'];
const CAMERA_LABELS = { chase: 'CHASE', cockpit: 'COCKPIT', hood: 'HOOD' };
const input = { up: false, down: false, left: false, right: false, brake: false };

function buildCarMesh() {
  const g = new THREE.Group();
  const suspension = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 4.2), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.4, metalness: 0.3 }));
  body.position.y = 0.7;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2.0), new THREE.MeshStandardMaterial({ color: 0x1b2733, roughness: 0.2, metalness: 0.4 }));
  cabin.position.set(0, 1.3, -0.2);
  suspension.add(body, cabin);
  g.add(suspension);

  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  const wheels = [];
  for (const [x, z, front] of [[-0.95, 1.4, true], [0.95, 1.4, true], [-0.95, -1.4, false], [0.95, -1.4, false]]) {
    const mount = new THREE.Group();
    mount.position.set(x, 0.38, z);
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    mount.add(wheel);
    g.add(mount);
    wheels.push({ mount, wheel, front });
  }
  g.userData.suspension = suspension;
  g.userData.wheels = wheels;
  g.userData.wheelSpin = 0;
  g.userData.bodyRoll = 0;
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

  let cameraMode = 'chase';
  const keyMap = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'brake' };
  const onKey = (v) => (e) => {
    if (e.code === 'Escape' && v) return stopDrive();
    if (e.code === 'KeyC' && v) { cameraMode = CAMERA_MODES[(CAMERA_MODES.indexOf(cameraMode) + 1) % CAMERA_MODES.length]; return; }
    if (e.code === 'Digit1' && v) { cameraMode = 'chase'; return; }
    if (e.code === 'Digit2' && v) { cameraMode = 'cockpit'; return; }
    if (e.code === 'Digit3' && v) { cameraMode = 'hood'; return; }
    const k = keyMap[e.code];
    if (k) { input[k] = v; e.preventDefault(); }
  };
  const kd = onKey(true), ku = onKey(false);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  const pad = touchPad(stopDrive);
  const hud = pad.querySelector('.drive-hud');
  const speedEl = pad.querySelector('#drive-speed');
  const cameraEl = document.createElement('span');
  cameraEl.className = 'drive-camera';
  cameraEl.textContent = 'CHASE · C';
  hud.append(' km/h ', cameraEl);
  const previousFov = world.camera.fov;
  const raycaster = new THREE.Raycaster();
  const rayOrigin = new THREE.Vector3();
  const rayDirection = new THREE.Vector3();
  let cameraCheckTimer = 0;
  let safeChaseDistance = 10.5;

  const previousCamera = { position: world.camera.position.clone(), target: world.controls.target.clone(), zoom: world.camera.zoom };
  const camPos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const desiredPos = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  let cameraDistance = 10.5, cameraHeight = 5.2, chaseDist = 10.5, camHeading = car.heading;
  let previousSpeed = 0;
  let suspensionVelocity = 0;
  let suspensionOffset = 0;
  const localCameraOffset = new THREE.Vector3();
  const upAxis = new THREE.Vector3(0, 1, 0);
  // Start directly in the chase position instead of sweeping in from the distant city overview.
  const startFx = Math.sin(car.heading), startFz = Math.cos(car.heading);
  camPos.set(car.x - startFx * cameraDistance, 0.05 + cameraHeight, car.z - startFz * cameraDistance);
  look.set(car.x + startFx * 3.2, 1.05, car.z + startFz * 3.2);
  world.camera.position.copy(camPos);
  world.camera.lookAt(look);
  const frame = (dt) => {
    dt = Math.min(dt, 0.05);
    stepCar(car, input, dt, resolve);
    mesh.position.set(car.x, 0.05, car.z);
    mesh.rotation.y = car.heading;

    // Wheel rotation follows distance travelled; front mounts steer independently.
    const wheelData = mesh.userData.wheels;
    mesh.userData.wheelSpin -= car.speed * dt / 0.38;
    for (const item of wheelData) {
      if (item.front) item.mount.rotation.y = car.steer;
      item.wheel.rotation.x = mesh.userData.wheelSpin;
    }

    // Spring-damper suspension reacts to acceleration and steering load.
    const longitudinalG = THREE.MathUtils.clamp((car.speed - previousSpeed) / Math.max(dt, 0.001) / 18, -1, 1);
    previousSpeed = car.speed;
    const lateralLoad = THREE.MathUtils.clamp(car.speed * car.speed * Math.abs(Math.tan(car.steer)) / (WHEEL_BASE * 12), 0, 0.12);
    const springTarget = THREE.MathUtils.clamp(-longitudinalG * 0.045 - lateralLoad, -0.065, 0.065);
    suspensionVelocity += (springTarget - suspensionOffset) * 32 * dt;
    suspensionVelocity *= Math.exp(-8.5 * dt);
    suspensionOffset += suspensionVelocity * dt;
    mesh.userData.suspension.position.y = suspensionOffset;
    const rollTarget = -Math.sign(car.steer) * lateralLoad * 0.8;
    mesh.userData.bodyRoll = THREE.MathUtils.lerp(mesh.userData.bodyRoll, rollTarget, 1 - Math.exp(-5 * dt));
    mesh.userData.suspension.rotation.z = mesh.userData.bodyRoll;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const speed01 = THREE.MathUtils.clamp(Math.abs(car.speed) / MAX_SPEED, 0, 1);
    const ease = 1 - Math.exp(-3.8 * dt);
    cameraDistance = THREE.MathUtils.lerp(cameraDistance, 9.5 + speed01 * 5.5, ease);
    cameraHeight = THREE.MathUtils.lerp(cameraHeight, 4.8 + speed01 * 2.2, ease);

    // Smooth only the camera's heading (shortest-angle). The position stays rigidly tied to the car,
    // so there is no positional lag that makes the car jitter inside the frame.
    let dh = car.heading - camHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    camHeading += dh * (1 - Math.exp(-(cameraMode === 'chase' ? 5 : 14) * dt));
    const cx = Math.sin(camHeading), cz = Math.cos(camHeading);

    if (cameraMode === 'chase') {
      cameraCheckTimer -= dt;
      if (cameraCheckTimer <= 0) {
        cameraCheckTimer = 0.08;
        rayOrigin.set(car.x, 1.55, car.z);
        rayDirection.set(-cx, 0.16, -cz).normalize();
        raycaster.set(rayOrigin, rayDirection);
        raycaster.far = cameraDistance;
        const hits = raycaster.intersectObjects(world.cityRoot.children, true);
        safeChaseDistance = hits.length ? Math.max(2.8, hits[0].distance - 0.65) : cameraDistance;
      }
      // Pull in quickly when blocked, ease back out slowly: no sudden snapping.
      const wanted = Math.min(cameraDistance, safeChaseDistance);
      chaseDist += (wanted - chaseDist) * (1 - Math.exp(-(wanted < chaseDist ? 9 : 1.6) * dt));
      camPos.set(car.x - cx * chaseDist, 0.05 + cameraHeight, car.z - cz * chaseDist);
      look.set(car.x + cx * (3.2 + speed01 * 3.5), 1.05 + speed01 * 0.35, car.z + cz * (3.2 + speed01 * 3.5));
    } else {
      // Camera positions are car-local: +Z is forward, +Y is up. Rigid to the car, heading lightly smoothed.
      const oy = cameraMode === 'cockpit' ? 1.58 : 1.18, oz = cameraMode === 'cockpit' ? 0.05 : 1.35;
      camPos.set(car.x + cx * oz, 0.05 + oy, car.z + cz * oz);
      const far = cameraMode === 'cockpit' ? 24 : 35;
      look.set(car.x + cx * far, 1.05, car.z + cz * far);
    }
    world.camera.position.copy(camPos);
    world.camera.lookAt(look);
    const targetFov = cameraMode === 'chase' ? 55 + speed01 * 9 : 68;
    world.camera.fov = THREE.MathUtils.lerp(world.camera.fov, targetFov, 1 - Math.exp(-4 * dt));
    world.camera.updateProjectionMatrix();
    speedEl.textContent = Math.abs(Math.round(car.speed * 3.6));
    cameraEl.textContent = `${CAMERA_LABELS[cameraMode]} · C`;
  };
  world.onFrame.add(frame);

  active = {
    prevMode: state.mode,
    cleanup: [() => world.onFrame.delete(frame), () => window.removeEventListener('keydown', kd),
      () => window.removeEventListener('keyup', ku), () => pad.remove(),
      () => { world.scene.remove(mesh); mesh.traverse((o) => { o.geometry?.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); }); },
      () => { world.camera.position.copy(previousCamera.position); world.camera.fov = previousFov; world.camera.zoom = previousCamera.zoom; world.camera.updateProjectionMatrix(); world.controls.target.copy(previousCamera.target); world.controls.enabled = true; world.controls.update(); }],
  };
  setMode('drive');
  setStatus('Drive: WASD/arrows · C or 1/2/3 = camera · Space = handbrake · Esc = exit.');
}

export function stopDrive() {
  if (!active) return;
  active.cleanup.forEach((fn) => fn());
  Object.keys(input).forEach((k) => { input[k] = false; });
  // Restore the exact pre-drive camera view via the active session cleanup.
  setMode('city');
  setStatus('Drive ended.');
  active = null;
}
