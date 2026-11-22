// Facade textures: windows, curtain walls and corrugated metal as TEXTURES on a plain box,
// instead of one quad per window. A building wall becomes 2 triangles instead of hundreds,
// and every building shares the same material, so the optimizer merges a whole district into
// one draw call.
//
//   facadeBox(THREE, w, h, d, { type, color, floors, seed, x, y, z })
//
// - type: 'window' (punched windows), 'curtain' (glass tower), 'ribbed' (corrugated metal)
// - color: wall tint (vertex colors multiply the texture), so one texture serves every color
// - floors: how many window rows fit the wall height (the texture tile is exactly one floor tall)
// - seed: 0..1, picks which windows are lit at night (per-window hash in the shader)
//
// Night lighting: the material's emissiveIntensity is driven by timeOfDay.js (userData.nightGlow).

const CELL = {
  window:  { w: 3.0, nightGlow: true,  roughness: 0.85, metalness: 0.0 },
  curtain: { w: 2.4, nightGlow: true,  roughness: 0.28, metalness: 0.35 },
  ribbed:  { w: 1.5, nightGlow: false, roughness: 0.7,  metalness: 0.15 },
};

const N = 64; // texture size (power of two)
const lerp = (a, b, t) => a + (b - a) * t;
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

/** Paint one tile. Returns [r,g,b] for color and [r,g,b] for the emissive (lit-window) map. v = 0 at the bottom. */
function paint(type, u, v, px, py) {
  const n = (hash(px, py) - 0.5) * 8; // subtle grain
  if (type === 'window') {
    const wall = [236 + n, 232 + n, 224 + n];
    const inFrame = u > 0.20 && u < 0.80 && v > 0.30 && v < 0.82;
    if (inFrame) {
      const border = u < 0.235 || u > 0.765 || v < 0.335 || v > 0.785 || (u > 0.49 && u < 0.51);
      if (border) return { c: [86, 84, 82], e: [0, 0, 0] };
      const t = (v - 0.335) / 0.45;
      return { c: [lerp(58, 108, t) + n, lerp(88, 142, t) + n, lerp(120, 172, t) + n], e: [255, 205, 120] };
    }
    if (u > 0.17 && u < 0.83 && v > 0.27 && v <= 0.30) return { c: [190, 186, 178], e: [0, 0, 0] }; // sill
    return { c: wall, e: [0, 0, 0] };
  }
  if (type === 'curtain') {
    if (v < 0.2) return { c: [52 + n, 58 + n, 64 + n], e: [0, 0, 0] }; // spandrel band
    const mull = u < 0.04 || u > 0.96 || v > 0.975 || (v > 0.2 && v < 0.225);
    if (mull) return { c: [38, 42, 48], e: [0, 0, 0] };
    const t = (v - 0.225) / 0.75;
    const streak = Math.max(0, 1 - Math.abs(u - 0.3 - v * 0.4) * 6) * 26; // soft reflection streak
    return { c: [lerp(46, 104, t) + streak + n, lerp(90, 158, t) + streak + n, lerp(128, 190, t) + streak + n], e: [255, 225, 160] };
  }
  // ribbed
  const stripe = Math.floor(u * 6) % 2;
  const edge = Math.abs((u * 6) % 1 - 0.5) > 0.46;
  const g = edge ? 112 : stripe ? 172 : 150;
  return { c: [g + n, g + 3 + n, g + 5 + n], e: [0, 0, 0] };
}

function makeTextures(THREE, type) {
  const col = new Uint8ClampedArray(N * N * 4), emi = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const { c, e } = paint(type, (x + 0.5) / N, (y + 0.5) / N, x, y);
      const i = (y * N + x) * 4;
      col[i] = c[0]; col[i + 1] = c[1]; col[i + 2] = c[2]; col[i + 3] = 255;
      emi[i] = e[0]; emi[i + 1] = e[1]; emi[i + 2] = e[2]; emi[i + 3] = 255;
    }
  }
  const mk = (data, srgb) => {
    let tex;
    if (typeof document !== 'undefined') {
      // Canvas textures export cleanly to GLB; rows are written top-down so flip y.
      const cv = document.createElement('canvas'); cv.width = cv.height = N;
      const ctx = cv.getContext('2d');
      const img = new ImageData(N, N);
      for (let y = 0; y < N; y++) img.data.set(data.subarray((N - 1 - y) * N * 4, (N - y) * N * 4), y * N * 4);
      ctx.putImageData(img, 0, 0);
      tex = new THREE.CanvasTexture(cv);
    } else {
      tex = new THREE.DataTexture(new Uint8Array(data), N, N, THREE.RGBAFormat); // Node / tests
      tex.needsUpdate = true;
    }
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData.shared = true;
    return tex;
  };
  return { map: mk(col, true), emissiveMap: mk(emi, true) };
}

/** Random lit/unlit windows: hash of the window cell + the building seed (see aSeed attribute). */
function patchNightShader(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSeed;\nvarying float vSeed;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeed = aSeed;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSeed;\nfloat hash21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }')
      .replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  float seedQ = floor(vSeed * 1024.0 + 0.5); // quantize: interpolation error must not change the hash\n  totalEmissiveRadiance *= step(0.38, hash21(floor(vMapUv + 0.0001) + vec2(seedQ * 0.173, seedQ * 0.059)));');
  };
  material.customProgramCacheKey = () => 'facade-night-v1';
}

const matCache = new Map();
export function facadeMaterial(THREE, type = 'window') {
  const key = type;
  if (!matCache.has(key)) {
    const cfg = CELL[type];
    const { map, emissiveMap } = makeTextures(THREE, type);
    const m = new THREE.MeshStandardMaterial({
      map, vertexColors: true, roughness: cfg.roughness, metalness: cfg.metalness,
      ...(cfg.nightGlow ? { emissive: 0xffffff, emissiveMap, emissiveIntensity: 0 } : {}),
    });
    if (cfg.nightGlow) { patchNightShader(m); m.userData.nightGlow = true; }
    m.userData.shared = true;
    m.userData.facade = type;
    matCache.set(key, m);
  }
  return matCache.get(key);
}

/** A box whose four walls show the facade texture; top and bottom sample a plain wall texel. */
export function facadeBox(THREE, w, h, d, { type = 'window', color = 0xffffff, floors = 1, seed = 0, x = 0, y = 0, z = 0 } = {}) {
  const cfg = CELL[type];
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const colsW = Math.max(1, Math.round(w / cfg.w)), colsD = Math.max(1, Math.round(d / cfg.w));
  const rows = type === 'ribbed' ? 1 : Math.max(1, Math.round(floors));
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; 4 vertices each.
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (f === 2 || f === 3) uv.setXY(i, 0.03, 0.03);                        // roof / underside: plain wall
      else uv.setXY(i, uv.getX(i) * (f < 2 ? colsD : colsW), uv.getY(i) * rows);
    }
  }
  const c = new THREE.Color(color);
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3), seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; seeds[i] = seed; }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const mesh = new THREE.Mesh(geo, facadeMaterial(THREE, type));
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
