// Shared Three.js scene: renderer, camera, orbit controls, lighting, ground. Singleton.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { bus } from '../core/state.js';

export const world = {
  scene: null, camera: null, renderer: null, controls: null, sun: null,
  cityRoot: null,     // Group holding everything generated for the current city
  ground: null,
  onFrame: new Set(), // callbacks (dt) run every frame
};

export function initScene(canvas) {
  if (world.renderer) return world; // already initialised, just reuse

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc4e8);
  scene.fog = new THREE.Fog(0x9fc4e8, 600, 2500);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 6000);
  camera.position.set(250, 300, 350);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.screenSpacePanning = false;

  scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a5a3a, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(300, 500, 200);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -600; sc.right = 600; sc.top = 600; sc.bottom = -600; sc.near = 10; sc.far = 1500;
  scene.add(sun);

  const cityRoot = new THREE.Group();
  cityRoot.name = 'cityRoot';
  scene.add(cityRoot);

  Object.assign(world, { scene, camera, renderer, controls, cityRoot, sun });

  const resize = () => {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    const h = canvas.clientHeight || canvas.parentElement.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  bus.on('layout:resized', resize);
  bus.on('view:changed', () => setTimeout(resize, 30));
  resize();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    controls.update();
    world.onFrame.forEach((fn) => fn(dt));
    renderer.render(scene, camera);
  });

  return world;
}

/** Remove and dispose everything currently in cityRoot. */
export function clearCity() {
  const root = world.cityRoot;
  if (!root) return;
  while (root.children.length) {
    const child = root.children[0];
    root.remove(child);
    disposeObject(child);
  }
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        if (m.map && !m.map.userData?.shared) m.map.dispose();
        if (!m.userData?.shared) m.dispose();
      });
    }
  });
}

/** Frame the camera on the city bounds. */
export function frameCity(bounds) {
  const size = Math.max(bounds.width, bounds.depth);
  world.camera.position.set(size * 0.55, size * 0.7, size * 0.75);
  world.controls.target.set(0, 0, 0);
  world.controls.maxDistance = size * 3;
  world.controls.update();
}
