// Quality presets + adaptive resolution so big cities stay smooth on phones and laptops.

import * as THREE from 'three';
import { world } from './scene.js';

export const PRESETS = {
  low:    { pixelRatio: 1,   shadows: false, shadowMap: 1024, shadowRadius: 1, exposure: 1.08, fogNear: 250, fogFar: 1100 },
  medium: { pixelRatio: 1.5, shadows: true,  shadowMap: 1536, shadowRadius: 3, exposure: 1.12, fogNear: 450, fogFar: 1800 },
  high:   { pixelRatio: 2,   shadows: true,  shadowMap: 2048, shadowRadius: 4, exposure: 1.18, fogNear: 600, fogFar: 2600 },
};

let current = 'medium';
let maxPixelRatio = PRESETS.medium.pixelRatio;
let adaptive = true;

const store = {
  get() { try { return localStorage.getItem('cityQuality'); } catch { return null; } },
  set(v) { try { localStorage.setItem('cityQuality', v); } catch { /* ignore */ } },
};

export const currentQuality = () => current;

export function setQuality(name) {
  const p = PRESETS[name];
  if (!p || !world.renderer) return false;
  current = name;
  maxPixelRatio = Math.min(p.pixelRatio, window.devicePixelRatio || 1);
  world.renderer.setPixelRatio(maxPixelRatio);
  world.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  world.renderer.toneMappingExposure = p.exposure;
  world.renderer.shadowMap.enabled = p.shadows;
  if (world.sun) {
    world.sun.castShadow = p.shadows;
    if (world.sun.shadow.mapSize.x !== p.shadowMap) {
      world.sun.shadow.mapSize.set(p.shadowMap, p.shadowMap);
      world.sun.shadow.map?.dispose();
      world.sun.shadow.map = null;
    }
    world.sun.shadow.radius = p.shadowRadius;
  }
  if (world.scene.fog) { world.scene.fog.near = p.fogNear; world.scene.fog.far = p.fogFar; }
  // Shadow toggles need materials to recompile once.
  world.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
  store.set(name);
  return true;
}

/** Call once after initScene(): restores the saved preset and starts adaptive resolution. */
export function initQuality() {
  const saved = store.get();
  setQuality(PRESETS[saved] ? saved : 'medium');

  // Adaptive resolution: if the frame rate sags, lower the pixel ratio; if there is headroom, raise it back.
  let acc = 0, frames = 0, ratio = maxPixelRatio;
  world.onFrame.add((dt) => {
    if (!adaptive || dt > 0.25) return; // ignore tab-switch hitches
    acc += dt; frames++;
    if (frames < 90) return;
    const avgMs = (acc / frames) * 1000;
    acc = 0; frames = 0;
    if (avgMs > 28 && ratio > 0.75) ratio = Math.max(0.75, ratio - 0.25);
    else if (avgMs < 17 && ratio < maxPixelRatio) ratio = Math.min(maxPixelRatio, ratio + 0.25);
    else return;
    world.renderer.setPixelRatio(ratio);
    world.renderer.setSize(world.renderer.domElement.clientWidth, world.renderer.domElement.clientHeight, false);
  });
}

export function setAdaptive(on) { adaptive = on; }
