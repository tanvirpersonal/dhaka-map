// Primary replica: each OSM building becomes an extruded footprint ("box") placeholder.

import * as THREE from 'three';

const KIND_COLOR = {
  house: 0xd9b99b, apartment: 0xc9a38a, commercial: 0xb8c4d6, office: 0x9fb4cc,
  industrial: 0xa7a7a0, public: 0xd8cf9a, generic: 0xcfcfcf,
};

const matCache = new Map();
function materialFor(kind) {
  if (!matCache.has(kind)) {
    const m = new THREE.MeshStandardMaterial({ color: KIND_COLOR[kind] || KIND_COLOR.generic, roughness: 0.85 });
    m.userData.shared = true;
    matCache.set(kind, m);
  }
  return matCache.get(kind);
}

/** Build a placeholder mesh for one building. Returns a Mesh tagged with userData.building. */
export function makeBuildingBox(b) {
  const shape = new THREE.Shape();
  // Shape lives in the XY plane; we rotate so shape-y maps to world z.
  b.footprint.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // extrude along +y
  const mesh = new THREE.Mesh(geo, materialFor(b.kind));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `box_${b.id}`;
  mesh.userData.building = b;
  mesh.userData.placeholder = true;
  return mesh;
}

/** Oriented bounding rectangle of a footprint (long edge direction) for fitting asset modules. */
export function footprintFrame(b) {
  const pts = b.footprint;
  // Try the angle of each edge; keep the one that yields the smallest bounding area.
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    const ang = Math.atan2(z2 - z1, x2 - x1);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) {
      const rx = x * c - z * s, rz = x * s + z * c;
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
      minZ = Math.min(minZ, rz); maxZ = Math.max(maxZ, rz);
    }
    const area = (maxX - minX) * (maxZ - minZ);
    if (!best || area < best.area) {
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      // rotate center back to world space
      const wc = Math.cos(ang), ws = Math.sin(ang);
      best = { area, angle: ang, width: maxX - minX, depth: maxZ - minZ,
        center: [cx * wc - cz * ws, cx * ws + cz * wc] };
    }
  }
  // Make "width" the longer side so modules have a consistent frontage axis.
  if (best.depth > best.width) {
    return { angle: best.angle + Math.PI / 2, width: best.depth, depth: best.width, center: best.center };
  }
  return { angle: best.angle, width: best.width, depth: best.depth, center: best.center };
}
