// Fetch buildings, roads and a few extras from OpenStreetMap via the Overpass API.
//
// Built for speed and reliability (ported from the gpt-1 branch, then tightened):
//  * Asia-first server order for Asian areas (ovp.dresel.systems/api-as is nearby and sends CORS headers),
//    other regions start with the main FOSSGIS server. The last server that worked is tried first next time.
//  * Retries only for "busy" answers (408/429/5xx), honoring Retry-After, with exponential backoff.
//  * A server that times out, stalls mid-download, fails the network request or answers with an Overpass
//    "remark" (query rejected / timed out) is skipped immediately: failing over is faster than waiting again.
//  * The count query (for the percentage) runs IN PARALLEL with the data request, sent second, so it can never
//    delay the download. If it fails or is rejected the bar just shows MB instead of a percentage.

import { getCached, putCached } from './cache.js';

const ASIA = 'https://ovp.dresel.systems/api-as/interpreter';
const MAIN = 'https://overpass-api.de/api/interpreter';
const COFFEE = 'https://overpass.private.coffee/api/interpreter';

/** Tunables. Mutable so tests (and curious developers) can change them. */
export const overpassConfig = {
  endpoints: null,        // null = choose by area; or an explicit list
  dataTimeoutMs: 100000,  // max wait for the data response to START, per attempt
  countTimeoutMs: 15000,  // the count query is optional, don't wait long for it
  stallMs: 45000,         // abort a download that receives no bytes for this long
  retries: 1,             // extra attempts on the SAME server for busy answers (408/429/5xx)
  retryBaseMs: 1500,
  retryMaxMs: 10000,
  rounds: 2,              // go through the whole server list this many times
  roundPauseMs: 1500,
};

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };

// ---------- server choice ----------

/** Rough box around South, Southeast and East Asia, where the Asia mirror is the closest server. */
export function isAsia(area) {
  const lat = (area.south + area.north) / 2, lon = (area.west + area.east) / 2;
  return lat >= -12 && lat <= 55 && lon >= 60 && lon <= 150;
}

let lastGood = null;
const STORE_KEY = 'overpassBestEndpoint';
function loadLastGood() {
  if (lastGood) return lastGood;
  try { lastGood = globalThis.localStorage?.getItem(STORE_KEY) || null; } catch { /* storage blocked */ }
  return lastGood;
}
function rememberGood(url) {
  lastGood = url;
  try { globalThis.localStorage?.setItem(STORE_KEY, url); } catch { /* ignore */ }
}
/** For tests: forget which server worked last. */
export function resetOverpassState() {
  lastGood = null;
  try { globalThis.localStorage?.removeItem(STORE_KEY); } catch { /* ignore */ }
}

export function endpointsFor(area) {
  const base = overpassConfig.endpoints || (isAsia(area) ? [ASIA, COFFEE, MAIN] : [MAIN, COFFEE, ASIA]);
  const good = loadLastGood();
  return good && base.includes(good) ? [good, ...base.filter((u) => u !== good)] : [...base];
}

// ---------- queries ----------

function selectors({ south, west, north, east }) {
  const bbox = `${south},${west},${north},${east}`;
  return `  way["building"](${bbox});
  way["highway"](${bbox});
  way["landuse"~"grass|forest|park|recreation_ground"](${bbox});
  way["natural"="water"](${bbox});
  way["waterway"](${bbox});`;
}

const dataQuery = (area) => `[out:json][timeout:90];\n(\n${selectors(area)}\n);\nout body geom;`;
const countQuery = (area) => `[out:json][timeout:30];\n(\n${selectors(area)}\n);\nout count;`;

// ---------- HTTP ----------

/**
 * POST a query. Resolves {res, controller} as soon as the response headers arrive (controller can still
 * abort the body). Retries only busy statuses on the same server; everything else throws at once.
 */
async function post(url, query, { timeoutMs, retries = 0, signal, onRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener('abort', onOuterAbort, { once: true });
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: 'application/json' },
        body: 'data=' + encodeURIComponent(query),
        signal: controller.signal,
      });
      if (res.ok) return { res, controller };

      res.body?.cancel().catch(() => {});
      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        const ra = Number(res.headers.get('Retry-After'));
        const delay = Number.isFinite(ra) && ra > 0
          ? Math.min(ra * 1000, 15000)
          : Math.min(overpassConfig.retryBaseMs * 2 ** attempt, overpassConfig.retryMaxMs);
        onRetry?.(res.status, delay);
        await sleep(delay);
        continue; // finally{} below cleans up this attempt's timer
      }
      throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(timedOut ? `no response within ${Math.round(timeoutMs / 1000)} s` : 'cancelled');
      throw e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }
}

/** Number of ways the query will return, or null. Never throws, never retries. */
async function countWays(url, area, signal) {
  try {
    const { res } = await post(url, countQuery(area), { timeoutMs: overpassConfig.countTimeoutMs, signal });
    const n = parseInt((await res.json()).elements?.[0]?.tags?.ways, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** One complete download attempt from one server. Throws on any problem so the caller can fail over. */
async function downloadFrom(url, area, onProgress) {
  const host = hostOf(url);
  let total = null, bytes = 0, ways = 0;
  const countCtl = new AbortController();
  try {
    // Data request first, count second: if the server only allows one slot, the count is the one that loses.
    const dataP = post(url, dataQuery(area), {
      timeoutMs: overpassConfig.dataTimeoutMs, retries: overpassConfig.retries,
      onRetry: (status, delay) => onProgress({ phase: 'waiting', percent: null, ways: 0, total: null, bytes: 0,
        note: `${host} is busy (${status}), retrying in ${Math.ceil(delay / 1000)} s…` }),
    });
    countWays(url, area, countCtl.signal).then((n) => { total = n; });
    const { res, controller } = await dataP;
    if (!res.body) throw new Error('response has no readable body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const wayRe = /"type"\s*:\s*"way"/g;
    let text = '', scanFrom = 0, stalled = false;
    const arm = () => setTimeout(() => { stalled = true; controller.abort(); }, overpassConfig.stallMs);
    let stallTimer = arm();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(stallTimer); stallTimer = arm();
        bytes += value.length;
        text += decoder.decode(value, { stream: true });

        // Count ways as they stream in; stop short of a match that may be split across chunks.
        wayRe.lastIndex = scanFrom;
        let m, lastEnd = scanFrom;
        while ((m = wayRe.exec(text))) { ways++; lastEnd = wayRe.lastIndex; }
        scanFrom = Math.max(lastEnd, text.length - 24);

        onProgress({ phase: 'download', percent: total ? Math.min(99, (ways / total) * 100) : null, ways, total, bytes });
      }
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(stalled ? `download stalled (no data for ${Math.round(overpassConfig.stallMs / 1000)} s)` : 'cancelled');
      throw e;
    } finally {
      clearTimeout(stallTimer);
    }
    text += decoder.decode();

    const json = JSON.parse(text);
    // Overpass answers HTTP 200 with a "remark" when the query timed out or ran out of memory.
    if (json.remark) throw new Error(`query rejected: ${json.remark}`);
    if (!Array.isArray(json.elements)) throw new Error('unexpected response format');
    onProgress({ phase: 'download', percent: 100, ways: total ?? ways, total, bytes });
    return json;
  } finally {
    countCtl.abort(); // free the count request's server slot if it is still running
  }
}

/**
 * @param {object} area {south, west, north, east}
 * @param {(p: {phase:string, percent:number|null, ways:number, total:number|null, bytes:number, note?:string}) => void} [onProgress]
 */
export async function fetchOsm(area, onProgress = () => {}) {
  const list = endpointsFor(area);
  const failures = [];

  for (let round = 1; round <= overpassConfig.rounds; round++) {
    for (let i = 0; i < list.length; i++) {
      const url = list[i], host = hostOf(url);
      onProgress({ phase: 'waiting', percent: null, ways: 0, total: null, bytes: 0,
        note: round === 1 && i === 0 ? `Contacting ${host}…` : `Trying another server: ${host}…` });
      try {
        const json = await downloadFrom(url, area, onProgress);
        rememberGood(url);
        return json;
      } catch (e) {
        failures.push(`${host}: ${e.message}`);
        console.warn(`Overpass server failed: ${host}`, e);
      }
    }
    if (round < overpassConfig.rounds) await sleep(overpassConfig.roundPauseMs);
  }
  throw new Error(`All map servers failed (${failures.slice(-list.length).join('; ')}). Try a smaller area, or wait a minute and retry.`);
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
          phase: p.phase, percent: ((t + within) / tiles.length) * 100, note: p.note,
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
