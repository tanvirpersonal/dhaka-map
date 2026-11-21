// Time of day: sun position/color, sky + fog, hemisphere light, and night glow for windows and lamps.
// hour: 0..24 (6 = sunrise, 12 = noon, 18 = sunset).

import * as THREE from 'three';
import { world } from './scene.js';
import { bus } from '../core/state.js';

const NIGHT = new THREE.Color(0x0a1024);
const DAWN = new THREE.Color(0xf0a068);
const DAY = new THREE.Color(0x9fc4e8);
const SUN_DAY = new THREE.Color(0xffffff);
const SUN_LOW = new THREE.Color(0xffb36b);

let hour = 14;
let glowMats = null;

export const getHour = () => hour;
export const invalidateNightCache = () => { glowMats = null; };

function collectGlowMaterials() {
  const set = new Set();
  world.scene.traverse((o) => {
    if (o.material) [].concat(o.material).forEach((m) => { if (m.userData?.nightGlow) set.add(m); });
  });
  glowMats = [...set];
}

export function setTimeOfDay(h) {
  hour = ((h % 24) + 24) % 24;
  if (!world.scene) return;

  // Sun elevation: 0 at 6h and 18h, 1 at noon, negative at night.
  const t = (hour - 6) / 12;                  // 0..1 across daylight
  const elev = Math.sin(t * Math.PI);         // -..1
  const day = THREE.MathUtils.clamp(elev * 2.2, 0, 1);       // 0 night .. 1 full day
  const dusk = 1 - THREE.MathUtils.clamp(Math.abs(elev) * 4, 0, 1); // peaks at sunrise/sunset

  const sky = NIGHT.clone().lerp(DAY, day).lerp(DAWN, dusk * 0.7);
  world.scene.background = sky;
  if (world.scene.fog) world.scene.fog.color.copy(sky);

  const dist = 600;
  const az = t * Math.PI;                     // sun travels east -> west
  world.sun.position.set(Math.cos(az) * dist, Math.max(40, elev * dist), 220);
  world.sun.target.position.set(0, 0, 0);
  world.sun.intensity = 1.5 * day;
  world.sun.color.copy(SUN_LOW).lerp(SUN_DAY, THREE.MathUtils.clamp(elev * 1.5, 0, 1));
  world.hemi.intensity = 0.12 + 0.8 * day;

  // Night glow: windows and street lamps.
  if (!glowMats) collectGlowMaterials();
  const night = 1 - day;
  glowMats.forEach((m) => { m.emissiveIntensity = m.userData.glowMax ? night * m.userData.glowMax : night * 1.6; });
}

/** Keep the chosen time when a new city appears or assets are built (new materials need glow). */
export function initTimeOfDay() {
  const refresh = () => { invalidateNightCache(); setTimeOfDay(hour); };
  bus.on('city:generated', refresh);
  bus.on('city:built', refresh);
  bus.on('project:loaded', refresh);
}
