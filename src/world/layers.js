// Ground-level layering without z-fighting.
//
// Ground, parks, water, roads and sidewalks are flat and only centimetres apart, so depth-buffer
// precision makes them flicker at distance. Instead we draw them first, in a fixed order
// (renderOrder), WITHOUT writing depth. Anything standing on the ground (buildings, props, cars)
// is drawn afterwards and is depth-tested only against other tall things, which is always correct
// because a flat decal can never hide something standing on it from an above-ground camera.

export const LAYER = {
  ground: -20, green: -19, water: -18,
  dirt: -17, residential: -16, secondary: -15, primary: -14, // road kinds: bigger roads on top at crossings
  footpath: -13,                                              // footpaths cross over roads
  sidewalk: -12,
};

/** Mark a mesh as a flat ground decal on the given layer. Works for shared materials too. */
export function asDecal(mesh, layer) {
  mesh.renderOrder = layer;
  [].concat(mesh.material).forEach((m) => { m.depthWrite = false; });
  return mesh;
}

export const isDecal = (renderOrder) => renderOrder < 0;
