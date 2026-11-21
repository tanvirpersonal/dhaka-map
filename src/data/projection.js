// Local equirectangular projection: lat/lon -> meters around the area center.
// Three.js convention used across the app: x = east, z = south (so north is -z), y = up.

const R = 6378137; // Earth radius (m)

export function makeProjection(area) {
  const lat0 = (area.south + area.north) / 2;
  const lon0 = (area.west + area.east) / 2;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);

  const project = (lat, lon) => [
    ((lon - lon0) * Math.PI / 180) * R * cosLat,
    -((lat - lat0) * Math.PI / 180) * R,
  ];

  const unproject = (x, z) => [
    lat0 + (-z / R) * 180 / Math.PI,
    lon0 + (x / (R * cosLat)) * 180 / Math.PI,
  ];

  const [minX, minZ] = project(area.north, area.west);
  const [maxX, maxZ] = project(area.south, area.east);

  return { project, unproject, bounds: { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ } };
}
