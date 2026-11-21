// Fetch buildings, roads and a few extras from OpenStreetMap via the Overpass API,
// reporting real download progress.
//
// Overpass sends no total size, so we first ask it how many ways the query matches (a tiny
// "out count" request), then count ways as the JSON streams in: percent = ways seen / total.

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
const countQuery = (area) => `[out:json][timeout:30];\n(\n${selectors(area)}\n);\nout count;`;

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

/** Number of ways the query will return, or null if it can't be determined. */
async function countWays(url, area) {
  try {
    const json = await (await post(url, countQuery(area), AbortSignal.timeout(20000))).json();
    const n = parseInt(json.elements?.[0]?.tags?.ways, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null; // fall back to an indeterminate bar
  }
}

/**
 * @param {object} area {south, west, north, east}
 * @param {(p: {phase:string, percent:number|null, ways:number, total:number|null, bytes:number}) => void} [onProgress]
 */
export async function fetchOsm(area, onProgress = () => {}) {
  let lastErr;

  for (const url of ENDPOINTS) {
    try {
      onProgress({ phase: 'waiting', percent: null, ways: 0, total: null, bytes: 0 });
      const total = await countWays(url, area);
      onProgress({ phase: 'waiting', percent: total ? 0 : null, ways: 0, total, bytes: 0 });

      const res = await post(url, dataQuery(area));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const wayRe = /"type"\s*:\s*"way"/g;

      let text = '', bytes = 0, ways = 0, scanFrom = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        text += decoder.decode(value, { stream: true });

        // Count new way elements; stop before a possibly split match at the end of the buffer.
        wayRe.lastIndex = scanFrom;
        let m, lastEnd = scanFrom;
        while ((m = wayRe.exec(text))) { ways++; lastEnd = wayRe.lastIndex; }
        scanFrom = Math.max(lastEnd, text.length - 24);

        const percent = total ? Math.min(99, (ways / total) * 100) : null;
        onProgress({ phase: 'download', percent, ways, total, bytes });
      }
      text += decoder.decode();

      const json = JSON.parse(text);
      if (!json.elements) throw new Error('Unexpected Overpass response');
      onProgress({ phase: 'download', percent: 100, ways: total ?? ways, total, bytes });
      return json;
    } catch (e) {
      lastErr = e;
      console.warn(`Overpass endpoint failed: ${url}`, e);
    }
  }
  throw new Error(`Could not download map data (${lastErr?.message || 'network error'}). Try a smaller area.`);
}
