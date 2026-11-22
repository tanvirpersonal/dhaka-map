// Fetch buildings, roads and a few extras from OpenStreetMap via the Overpass API,
// reporting real download progress.
//
// Skip a separate count query so the actual map download starts immediately.
// Overpass does not reliably expose a total response size, so progress uses streamed MB.

import { getCached, putCached } from './cache.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

function selectors({ south, west, north, east }) {
  const bbox = `${south},${west},${north},${east}`;
  return `  way["building"](${bbox});
  way["highway"](${bbox});
  way["landuse"~"grass|forest|park|recreation_ground"](${bbox});
  way["natural"="water"](${bbox});
  way["waterway"](${bbox});`;
}

const dataQuery = (area) => `[out:json][timeout:60];\n(\n${selectors(area)}\n);\nout body geom;`;

async function post(url, query, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
    signal,
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  return res;
}

/**
 * @param {object} area {south, west, north, east}
 * @param {(p: {phase:string, percent:number|null, ways:number, total:number|null, bytes:number}) => void} [onProgress]
 */
export async function fetchOsm(area, onProgress = () => {}) {
  let lastErr;

  for (const url of ENDPOINTS) {
    try {
      // Skip the separate count query: it doubles server round-trips and often adds
      // several seconds before the real map download even begins.
      onProgress({ phase: 'waiting', percent: null, ways: 0, total: null, bytes: 0 });
      const res = await post(url, dataQuery(area), AbortSignal.timeout(90000));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let text = '', bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        text += decoder.decode(value, { stream: true });

        // Stream bytes into the response buffer and keep the UI responsive.
        // Overpass does not reliably expose a usable total size, so show an honest
        // indeterminate progress bar instead of issuing a costly count request.
        onProgress({ phase: 'download', percent: null, ways: 0, total: null, bytes });
      }
      text += decoder.decode();

      const json = JSON.parse(text);
      if (!json.elements) throw new Error('Unexpected Overpass response');
      onProgress({ phase: 'download', percent: 100, ways: json.elements.length, total: json.elements.length, bytes });
      return json;
    } catch (e) {
      lastErr = e;
      console.warn(`Overpass endpoint failed: ${url}`, e);
    }
  }
  throw new Error(`Could not download map data (${lastErr?.message || 'network error'}). Try a smaller area.`);
}

// ---------- large areas: split into tiles, download one by one, merge ----------

export const TILE_DEG = 0.015; // ~1.6 km per tile side

/** Split an area into tiles of at most TILE_DEG per side (row-major). */
export function planTiles(area, tileDeg = TILE_DEG) {
  const nx = Math.max(1, Math.ceil((area.east - area.west) / tileDeg - 1e-9));
  const nz = Math.max(1, Math.ceil((area.north - area.south) / tileDeg - 1e-9));
  const dx = (area.east - area.west) / nx, dz = (area.north - area.south) / nz;
  const tiles = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      tiles.push({
        south: area.south + j * dz, north: area.south + (j + 1) * dz,
        west: area.west + i * dx, east: area.west + (i + 1) * dx,
      });
    }
  }
  return tiles;
}

/**
 * Like fetchOsm but for big areas: tiles are downloaded sequentially (kind to the public servers),
 * cached per tile, and merged with duplicate ways (those crossing tile edges) removed.
 * onProgress gets {phase, percent (overall), ways, total, bytes, tile, tiles}.
 */
export async function fetchOsmTiled(area, onProgress = () => {}) {
  const tiles = planTiles(area);
  if (tiles.length === 1) return fetchOsm(area, (p) => onProgress({ ...p, tile: 1, tiles: 1 }));

  const seen = new Set();
  const elements = [];
  let bytes = 0, waysSoFar = 0, tileBytes = 0;

  for (let t = 0; t < tiles.length; t++) {
    const tile = tiles[t];
    let raw = await getCached(tile, '|tile');
    tileBytes = 0;
    if (!raw) {
      raw = await fetchOsm(tile, (p) => {
        tileBytes = p.bytes;
        const within = p.percent == null ? 0 : p.percent / 100;
        onProgress({
          phase: p.phase, percent: ((t + within) / tiles.length) * 100,
          ways: waysSoFar + p.ways, total: null, bytes: bytes + p.bytes, tile: t + 1, tiles: tiles.length,
        });
      });
      putCached(tile, raw, '|tile');
      if (t < tiles.length - 1) await new Promise((r) => setTimeout(r, 400));
    }
    for (const el of raw.elements) {
      const key = `${el.type}${el.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      elements.push(el);
      if (el.type === 'way') waysSoFar++;
    }
    bytes += tileBytes; // 0 for tiles served from the cache
    onProgress({
      phase: 'download', percent: ((t + 1) / tiles.length) * 100, ways: waysSoFar, total: null,
      bytes, tile: t + 1, tiles: tiles.length,
    });
  }
  return { elements };
}
