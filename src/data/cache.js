// IndexedDB cache for parsed-OSM downloads, so regenerating the same area is instant and offline-safe.
// Key = rounded bbox. Entries expire after 7 days. All functions fail soft (return null / do nothing).

const DB = 'city-builder-cache';
const STORE = 'osm';
const TTL_MS = 7 * 24 * 3600 * 1000;

const keyFor = (a, suffix = '') =>
  [a.south, a.west, a.north, a.east].map((v) => v.toFixed(5)).join(',') + suffix;

function open() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCached(area, suffix = '') {
  try {
    const db = await open();
    const entry = await new Promise((resolve, reject) => {
      const r = db.transaction(STORE).objectStore(STORE).get(keyFor(area, suffix));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    if (!entry || Date.now() - entry.savedAt > TTL_MS) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export async function putCached(area, data, suffix = '') {
  try {
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ savedAt: Date.now(), data }, keyFor(area, suffix));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* quota or private mode: ignore */
  }
}

export async function clearCache() {
  try {
    const db = await open();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = resolve;
    });
    db.close();
  } catch { /* ignore */ }
}
