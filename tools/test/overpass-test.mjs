// Offline tests for src/data/overpass.js using a local fake Overpass server (no internet needed).
//   node tools/test/overpass-test.mjs
// Scenarios: normal + percentage, busy-then-ok, Retry-After, hung server, dead server, stalled download,
// "remark" rejection, count query rejected / slow (must never delay the download), all servers failing,
// remembered best server, and region-based server order.

import http from 'node:http';
import { fetchOsm, fetchOsmTiled, planTiles, endpointsFor, overpassConfig, resetOverpassState } from '../../src/data/overpass.js';

const WAYS = 300;
const payload = JSON.stringify({ elements: Array.from({ length: WAYS }, (_, i) => ({ type: 'way', id: i + 1, tags: { building: 'yes' }, geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }] })) });
const log = [];                    // {route, kind, at}
const state = { busyServed: 0 };   // per-test counters
let t0 = 0;

const server = http.createServer((req, res) => {
  const route = req.url.split('/')[1];
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const kind = decodeURIComponent(body).includes('out count') ? 'count' : 'data';
    log.push({ route, kind, at: Date.now() - t0 });
    const json = (obj, delay = 0) => setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }, delay);
    const countOk = (delay = 0) => json({ elements: [{ type: 'count', id: 0, tags: { ways: String(WAYS) } }] }, delay);
    const streamData = () => { // 4 chunks, 25 ms apart, so progress is observable
      res.writeHead(200, { 'content-type': 'application/json' });
      const step = Math.ceil(payload.length / 4);
      let i = 0;
      const next = () => { if (i >= payload.length) return res.end(); res.write(payload.slice(i, i + step)); i += step; setTimeout(next, 25); };
      next();
    };
    switch (route) {
      case 'ok': return kind === 'count' ? countOk() : streamData();
      case 'slowcount': return kind === 'count' ? countOk(900) : streamData();
      case 'count429': if (kind === 'count') { res.writeHead(429); return res.end('busy'); } return streamData();
      case 'busy': if (kind === 'data' && state.busyServed++ < 1) { res.writeHead(503); return res.end('busy'); } return kind === 'count' ? countOk() : streamData();
      case 'busyRA': if (kind === 'data' && state.busyServed++ < 1) { res.writeHead(429, { 'retry-after': '1' }); return res.end('slow down'); } return kind === 'count' ? countOk() : streamData();
      case 'remark': return kind === 'count' ? countOk() : json({ remark: 'runtime error: Query timed out in "query" at line 3 after 91 seconds.', elements: [] });
      case 'stall': if (kind === 'count') return countOk(); res.writeHead(200, { 'content-type': 'application/json' }); return res.write(payload.slice(0, 200)); // never ends
      case 'hang': return;                       // never answers
      default: res.writeHead(404); return res.end();
    }
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const U = (route) => `http://127.0.0.1:${port}/${route}/api/interpreter`;
const DEAD = 'http://127.0.0.1:1/dead/api/interpreter'; // nothing listens on port 1 -> connection refused

const defaults = { ...overpassConfig };
let passed = 0, failed = 0;
async function test(name, fn) {
  Object.assign(overpassConfig, defaults, { dataTimeoutMs: 300, countTimeoutMs: 200, stallMs: 300, retryBaseMs: 20, roundPauseMs: 20 });
  resetOverpassState(); log.length = 0; state.busyServed = 0; t0 = Date.now();
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };
const AREA = { south: 23.78, west: 90.40, north: 23.79, east: 90.41 };
const quiet = console.warn; console.warn = () => {}; // expected failures are noisy

await test('normal download returns all ways with a growing percentage that ends at 100', async () => {
  overpassConfig.endpoints = [U('ok')];
  const pcts = []; const json = await fetchOsm(AREA, (p) => { if (p.phase === 'download') pcts.push(p.percent); });
  assert(json.elements.length === WAYS, `got ${json.elements.length} ways`);
  const nums = pcts.filter((p) => p != null);
  assert(nums.length >= 2, 'no percentages reported');
  assert(nums.every((p, i) => i === 0 || p >= nums[i - 1] - 1e-9), 'percentage went backwards');
  assert(nums.at(-1) === 100, `final ${nums.at(-1)}`);
});

await test('data request is sent BEFORE the count request (count can never delay it)', async () => {
  overpassConfig.endpoints = [U('ok')];
  await fetchOsm(AREA);
  assert(log[0].kind === 'data' && log.some((l) => l.kind === 'count'), JSON.stringify(log));
});

await test('a slow count query (900 ms) does not delay the download', async () => {
  overpassConfig.endpoints = [U('slowcount')]; overpassConfig.countTimeoutMs = 2000;
  const t = Date.now(); const json = await fetchOsm(AREA); const ms = Date.now() - t;
  assert(json.elements.length === WAYS && ms < 500, `took ${ms} ms`);
});

await test('rejected count query (429) is ignored: download succeeds, no extra data requests', async () => {
  overpassConfig.endpoints = [U('count429')];
  const pcts = []; const json = await fetchOsm(AREA, (p) => pcts.push(p.percent));
  assert(json.elements.length === WAYS && log.filter((l) => l.kind === 'data').length === 1, JSON.stringify(log));
});

await test('busy server (503) is retried once on the same server and succeeds', async () => {
  overpassConfig.endpoints = [U('busy')];
  const notes = []; const json = await fetchOsm(AREA, (p) => p.note && notes.push(p.note));
  assert(json.elements.length === WAYS, 'no data');
  assert(log.filter((l) => l.kind === 'data').length === 2, 'expected exactly 2 data requests');
  assert(notes.some((n) => /busy \(503\)/.test(n)), `notes: ${notes}`);
});

await test('Retry-After header is honored (waits about 1 s)', async () => {
  overpassConfig.endpoints = [U('busyRA')]; overpassConfig.retryBaseMs = 5;
  const t = Date.now(); await fetchOsm(AREA); const ms = Date.now() - t;
  assert(ms >= 950 && ms < 2500, `waited ${ms} ms`);
});

await test('hung server: fail over after the timeout (not 3 x timeout) and use the next server', async () => {
  overpassConfig.endpoints = [U('hang'), U('ok')];
  const t = Date.now(); const json = await fetchOsm(AREA); const ms = Date.now() - t;
  assert(json.elements.length === WAYS, 'no data');
  assert(ms >= 280 && ms < 800, `took ${ms} ms (timeout is 300)`);
  assert(log.filter((l) => l.route === 'hang' && l.kind === 'data').length === 1, 'hung server was retried');
});

await test('dead server (connection refused) fails over immediately', async () => {
  overpassConfig.endpoints = [DEAD, U('ok')];
  const t = Date.now(); const json = await fetchOsm(AREA); const ms = Date.now() - t;
  assert(json.elements.length === WAYS && ms < 250, `took ${ms} ms`);
});

await test('download that stalls mid-body is aborted and another server is used', async () => {
  overpassConfig.endpoints = [U('stall'), U('ok')];
  const json = await fetchOsm(AREA);
  assert(json.elements.length === WAYS, 'no data');
});

await test('HTTP 200 with a "remark" (query timed out) is treated as a failure and fails over', async () => {
  overpassConfig.endpoints = [U('remark'), U('ok')];
  const json = await fetchOsm(AREA);
  assert(json.elements.length === WAYS, 'got the remark response instead of real data');
});

await test('the server that worked is remembered and tried first next time', async () => {
  overpassConfig.endpoints = [U('hang'), U('ok')];
  await fetchOsm(AREA);
  log.length = 0;
  const t = Date.now(); await fetchOsm(AREA); const ms = Date.now() - t;
  assert(log[0].route === 'ok', `first request went to ${log[0].route}`);
  assert(ms < 250, `second download took ${ms} ms (should skip the hung server)`);
  assert(endpointsFor(AREA)[0] === U('ok'), 'endpointsFor does not put the good server first');
});

await test('all servers failing gives one clear error after the configured rounds', async () => {
  overpassConfig.endpoints = [U('hang'), U('remark')]; overpassConfig.rounds = 2;
  let err; try { await fetchOsm(AREA); } catch (e) { err = e; }
  assert(err && /All map servers failed/.test(err.message), `error: ${err && err.message}`);
  assert(/no response within/.test(err.message) && /query rejected/.test(err.message), err.message);
  assert(log.filter((l) => l.route === 'hang' && l.kind === 'data').length === 2, 'expected one attempt per round');
});

await test('server order: Asia mirror first for Dhaka, main server first for Paris, last-good moves to front', async () => {
  overpassConfig.endpoints = null;
  const dhaka = endpointsFor(AREA).map((u) => new URL(u).host);
  const paris = endpointsFor({ south: 48.85, west: 2.33, north: 48.86, east: 2.35 }).map((u) => new URL(u).host);
  assert(dhaka[0] === 'ovp.dresel.systems', `dhaka: ${dhaka}`);
  assert(paris[0] === 'overpass-api.de', `paris: ${paris}`);
  assert(dhaka.length === 3 && new Set(dhaka).size === 3, 'servers missing or duplicated');
});


await test('multi-tile area: dead first server is paid for ONCE, tiles are merged without duplicates', async () => {
  overpassConfig.endpoints = [U('hang'), U('ok')];
  const big = { south: 23.70, west: 90.35, north: 23.745, east: 90.38 }; // 3 x 2 = 6 tiles
  const tiles = planTiles(big).length;
  assert(tiles >= 4, `expected a multi-tile area, got ${tiles}`);
  const pcts = []; const notes = [];
  const json = await fetchOsmTiled(big, (p) => { if (p.percent != null) pcts.push(p.percent); if (p.note) notes.push(p.note); });
  assert(json.elements.length === WAYS, `duplicates not merged: ${json.elements.length} elements`);
  const hangTries = log.filter((l) => l.route === 'hang' && l.kind === 'data').length;
  assert(hangTries === 1, `hung server was tried ${hangTries} times across ${tiles} tiles`);
  assert(log.filter((l) => l.route === 'ok' && l.kind === 'data').length === tiles, 'every tile should be downloaded from the good server');
  assert(pcts.at(-1) === 100 && pcts.every((p, i) => i === 0 || p >= pcts[i - 1] - 1e-9), `overall percent not monotonic / not 100: ${pcts.slice(-3)}`);
  assert(notes.some((n) => /Trying another server/.test(n)), `notes: ${notes}`);
});

console.warn = quiet;
server.closeAllConnections?.(); server.close();
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
