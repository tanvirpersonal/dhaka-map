// Click-to-select buildings with a highlight box. Distinguishes taps from orbit drags.

import * as THREE from 'three';
import { world } from './scene.js';
import { getGroup } from './cityGenerator.js';

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let helper = null;
let handlers = null;

function buildingRoot(obj) {
  let o = obj;
  while (o && !o.userData?.building) o = o.parent;
  return o || null;
}

/** Returns the top-level building object under a pointer event, or null. */
export function pickBuilding(ev) {
  const group = getGroup('buildings');
  if (!group) return null;
  const el = world.renderer.domElement;
  const r = el.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, world.camera);
  const hit = raycaster.intersectObjects(group.children, true)[0];
  return hit ? buildingRoot(hit.object) : null;
}

export function highlight(obj) {
  clearHighlight();
  if (!obj) return;
  helper = new THREE.BoxHelper(obj, 0xf5a623);
  helper.material.depthTest = false;
  helper.renderOrder = 999;
  world.scene.add(helper);
}

export function clearHighlight() {
  if (!helper) return;
  world.scene.remove(helper);
  helper.geometry.dispose();
  helper.material.dispose();
  helper = null;
}

/** Start listening; onPick(buildingObject | null) fires on every tap. Returns a stop function. */
export function startPicking(onPick) {
  stopPicking();
  const el = world.renderer.domElement;
  let down = null;

  const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
  const onUp = (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 5) return; // it was an orbit/pan drag
    onPick(pickBuilding(e));
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  handlers = { el, onDown, onUp };
  return stopPicking;
}

export function stopPicking() {
  if (handlers) {
    handlers.el.removeEventListener('pointerdown', handlers.onDown);
    handlers.el.removeEventListener('pointerup', handlers.onUp);
    handlers = null;
  }
  clearHighlight();
}
