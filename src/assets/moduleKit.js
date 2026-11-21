// Helpers shared by procedural asset modules (assets/buildings/**/*.js).
//
// Module contract:
//   export const meta = { id, name };
//   export function build(THREE, { width, depth, height, levels, seed }) -> THREE.Group
//     - origin at the footprint center ON THE GROUND (y = 0)
//     - local +x = width (long side), local +z = depth, front faces +z
//     - fill the given width x depth x height exactly (procedural, so no distortion)

export function rng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const matCache = new Map();
/** Shared standard material by color (flagged shared so dispose logic skips it). */
export function mat(THREE, color, opts = {}) {
  const key = `${color}|${opts.roughness ?? 0.85}|${opts.metalness ?? 0}|${opts.emissive ?? 0}|${opts.transparent ? 1 : 0}`;
  if (!matCache.has(key)) {
    const m = new THREE.MeshStandardMaterial({
      color, roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0,
      emissive: opts.emissive ?? 0x000000, transparent: !!opts.transparent, opacity: opts.opacity ?? 1,
    });
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return matCache.get(key);
}

/** Box positioned by its min corner on the ground plane: (x0, y0, z0) + size (w, h, d). Centered in x/z. */
export function box(THREE, w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Add a grid of window quads on one facade.
 * face: 'front' (+z), 'back' (-z), 'left' (-x), 'right' (+x)
 */
export function windows(THREE, group, { width, depth, height, levels, face = 'front', color = 0x5b7a99, inset = 0.02,
  cols = null, winW = 1.1, winH = 1.4, floorH = null, baseY = 0.6, topMargin = 0.4 }) {
  const along = face === 'front' || face === 'back' ? width : depth;
  const nCols = cols ?? Math.max(1, Math.floor(along / (winW * 2.1)));
  const fh = floorH ?? Math.max(2.6, (height - baseY - topMargin) / Math.max(1, levels));
  const nRows = Math.max(1, Math.floor((height - baseY - topMargin) / fh));
  const m = mat(THREE, color, { roughness: 0.25, metalness: 0.2 });
  m.userData.nightGlow = true; // timeOfDay.js lights windows at night
  m.emissive.set(0xffd27a);
  const geo = new THREE.PlaneGeometry(winW, winH);
  const mesh = new THREE.InstancedMesh(geo, m, nCols * nRows);
  const dummy = new THREE.Object3D();
  let i = 0;
  const step = along / nCols;
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const u = -along / 2 + step * (c + 0.5);
      const y = baseY + fh * r + fh * 0.5 + winH * 0.1;
      if (face === 'front') { dummy.position.set(u, y, depth / 2 + inset); dummy.rotation.set(0, 0, 0); }
      else if (face === 'back') { dummy.position.set(-u, y, -depth / 2 - inset); dummy.rotation.set(0, Math.PI, 0); }
      else if (face === 'right') { dummy.position.set(width / 2 + inset, y, -u); dummy.rotation.set(0, Math.PI / 2, 0); }
      else { dummy.position.set(-width / 2 - inset, y, u); dummy.rotation.set(0, -Math.PI / 2, 0); }
      dummy.updateMatrix();
      mesh.setMatrixAt(i++, dummy.matrix);
    }
  }
  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  return mesh;
}

/** Windows on all four faces. */
export function allWindows(THREE, group, opts) {
  ['front', 'back', 'left', 'right'].forEach((face) => windows(THREE, group, { ...opts, face }));
}

/** Simple gabled roof (ridge along x). */
export function gableRoof(THREE, w, d, rise, material, y = 0) {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0); shape.lineTo(d / 2, 0); shape.lineTo(0, rise); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  geo.translate(0, 0, -w / 2);
  geo.rotateY(Math.PI / 2);
  const m = new THREE.Mesh(geo, material);
  m.position.y = y;
  m.castShadow = true;
  return m;
}
