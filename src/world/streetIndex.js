// Spatial index of drivable road segments: "what is the nearest street to this point?"
// Used to turn building fronts toward the street (assetReplacer.js).

const CELL = 40; // meters

const cache = new WeakMap(); // roads array -> index

export function getStreetIndex(roads) {
  if (!cache.has(roads)) cache.set(roads, buildStreetIndex(roads));
  return cache.get(roads);
}

export function buildStreetIndex(roads) {
  const segs = [];            // flat [x0, z0, x1, z1] per segment
  const grid = new Map();     // "cx,cz" -> segment ids

  for (const r of roads) {
    if (!r.drivable) continue;
    for (let i = 1; i < r.points.length; i++) {
      const [x0, z0] = r.points[i - 1], [x1, z1] = r.points[i];
      const id = segs.length / 4;
      segs.push(x0, z0, x1, z1);
      const ax = Math.floor(Math.min(x0, x1) / CELL), bx = Math.floor(Math.max(x0, x1) / CELL);
      const az = Math.floor(Math.min(z0, z1) / CELL), bz = Math.floor(Math.max(z0, z1) / CELL);
      for (let cx = ax; cx <= bx; cx++) for (let cz = az; cz <= bz; cz++) {
        const k = `${cx},${cz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(id);
      }
    }
  }

  return {
    /** Closest point on any street within maxDist meters, or null. */
    nearest(x, z, maxDist = 60) {
      const rc = Math.ceil(maxDist / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      let best = null;
      const seen = new Set();
      for (let dx = -rc; dx <= rc; dx++) for (let dz = -rc; dz <= rc; dz++) {
        for (const id of grid.get(`${cx + dx},${cz + dz}`) || []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const x0 = segs[id * 4], z0 = segs[id * 4 + 1], ex = segs[id * 4 + 2] - x0, ez = segs[id * 4 + 3] - z0;
          const t = Math.max(0, Math.min(1, ((x - x0) * ex + (z - z0) * ez) / (ex * ex + ez * ez || 1)));
          const px = x0 + ex * t, pz = z0 + ez * t, d = Math.hypot(x - px, z - pz);
          if (d <= maxDist && (!best || d < best.dist)) best = { x: px, z: pz, dist: d };
        }
      }
      return best;
    },
  };
}

/**
 * Pick the module rotation so its front (+z) faces the street.
 * frame = { angle, width, depth } from footprintFrame(): width is the lot's long side.
 * Returns { rotY, width, depth }: three.js rotation.y plus the dimensions to give the module.
 */
export function faceStreet(frame, center, street) {
  const a = frame.angle;
  const defRot = -a; // default: front = (-sin a, cos a) on the long side
  if (!street) return { rotY: defRot, width: frame.width, depth: frame.depth };

  let sx = street.x - center[0], sz = street.z - center[1];
  const len = Math.hypot(sx, sz);
  if (len < 1e-6) return { rotY: defRot, width: frame.width, depth: frame.depth };
  sx /= len; sz /= len;

  const nx = -Math.sin(a), nz = Math.cos(a);   // default front
  const ux = Math.cos(a), uz = Math.sin(a);    // long axis
  const dn = nx * sx + nz * sz, du = ux * sx + uz * sz;

  if (Math.abs(dn) * 1.25 >= Math.abs(du)) {
    // Street runs along a long side: front toward it (flip 180 degrees if it is behind).
    const f = dn >= 0 ? [nx, nz] : [-nx, -nz];
    return { rotY: Math.atan2(f[0], f[1]), width: frame.width, depth: frame.depth };
  }
  // Street is at a short end: turn 90 degrees and swap the module's width and depth.
  const f = du >= 0 ? [ux, uz] : [-ux, -uz];
  return { rotY: Math.atan2(f[0], f[1]), width: frame.depth, depth: frame.width };
}
