// Fetch buildings, roads and a few extras from OpenStreetMap via the Overpass API.

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

function buildQuery({ south, west, north, east }) {
  const bbox = `${south},${west},${north},${east}`;
  return `[out:json][timeout:60];
(
  way["building"](${bbox});
  way["highway"](${bbox});
  way["landuse"~"grass|forest|park|recreation_ground"](${bbox});
  way["natural"="water"](${bbox});
  way["waterway"](${bbox});
);
out body geom;`;
}

export async function fetchOsm(area) {
  const body = 'data=' + encodeURIComponent(buildQuery(area));
  let lastErr;

  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = await res.json();
      if (!json.elements) throw new Error('Unexpected Overpass response');
      return json;
    } catch (e) {
      lastErr = e;
      console.warn(`Overpass endpoint failed: ${url}`, e);
    }
  }
  throw new Error(`Could not download map data (${lastErr?.message || 'network error'}). Try a smaller area.`);
}
