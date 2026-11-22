// Reusable browser harness (see tools/e2e/README.md): static server + mocked CDN/tiles/Overpass + synthetic city of N x N blocks.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
// three@0.160.0 and leaflet@1.9.4 are served to the page from local node_modules (the real page loads them from unpkg).
const NM = [process.env.NM, path.join(REPO, 'node_modules'), path.resolve(REPO, '..', 'node_modules')]
  .filter(Boolean).find((p) => fs.existsSync(path.join(p, 'three'))) || path.join(REPO, 'node_modules');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function synth(area, N) {
  const els = []; let id = 1;
  const g = (pts) => pts.map(([lat, lon]) => ({ lat, lon }));
  const P = 0.0013;
  for (let i = 0; i <= N; i++) {
    const lat = area.south + 0.0015 + i * P, lon = area.west + 0.0015 + i * P;
    els.push({ type: 'way', id: id++, nodes: [1000 + i * 10, 1005 + i * 10], tags: { highway: i % 3 === 0 ? 'primary' : 'residential', name: 'Road ' + i, lanes: i % 3 === 0 ? '4' : undefined }, geometry: g([[lat, area.west], [lat, area.east]]) });
    els.push({ type: 'way', id: id++, nodes: [2000 + i * 10, 2005 + i * 10], tags: { highway: i % 2 === 0 ? 'secondary' : 'footway', oneway: i === 1 ? 'yes' : undefined }, geometry: g([[area.south, lon], [area.north, lon]]) });
  }
  const kinds = ['house', 'apartments', 'commercial', 'office', 'industrial', 'school', 'yes', 'house', 'house'];
  for (let bi = 0; bi < N; bi++) for (let bj = 0; bj < N; bj++) {
    const lat0 = area.south + 0.0019 + bi * P, lon0 = area.west + 0.0019 + bj * P;
    for (let k = 0; k < 4; k++) {
      const la = lat0 + (k % 2) * 0.0004, lo = lon0 + Math.floor(k / 2) * 0.0004;
      const w = 0.00025 + ((bi + bj + k) % 3) * 0.00005, h = 0.0002 + ((bi * bj + k) % 3) * 0.00005;
      const kind = kinds[(bi * 7 + bj * 3 + k) % kinds.length];
      const tags = { building: kind === 'school' ? 'school' : kind };
      if ((bi + k) % 3 === 0) tags['building:levels'] = String(2 + ((bi + bj) % 10));
      els.push({ type: 'way', id: id++, nodes: [], tags, geometry: g([[la, lo], [la, lo + w], [la + h, lo + w], [la + h, lo], [la, lo]]) });
    }
  }
  const c = (a) => (a.south + a.north) / 2, d = (a) => (a.west + a.east) / 2;
  els.push({ type: 'way', id: id++, tags: { landuse: 'grass' }, geometry: g([[c(area)+0.0005,d(area)-0.002],[c(area)+0.0005,d(area)],[c(area)+0.0015,d(area)],[c(area)+0.0015,d(area)-0.002],[c(area)+0.0005,d(area)-0.002]]) });
  els.push({ type: 'way', id: id++, tags: { natural: 'water' }, geometry: g([[c(area)+0.003,d(area)+0.001],[c(area)+0.003,d(area)+0.003],[c(area)+0.004,d(area)+0.003],[c(area)+0.004,d(area)+0.001],[c(area)+0.003,d(area)+0.001]]) });
  return els;
}

async function boot({ span = 0.01, port = 8765, out, viewport = { width: 1280, height: 800 } } = {}) {
  fs.mkdirSync(out, { recursive: true });
  const area = { south: 23.780, west: 90.405, north: 23.780 + span, east: 90.405 + span };
  const N = Math.max(3, Math.floor((span - 0.0025) / 0.0013));
  const ELS = synth(area, N);
  const srv = spawn('python3', ['-m', 'http.server', String(port), '--directory', REPO], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  await ctx.route('https://unpkg.com/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    let file;
    if (p.startsWith('/three@0.160.0/')) file = path.join(NM, 'three', p.slice('/three@0.160.0/'.length));
    else if (p.startsWith('/leaflet@1.9.4/')) file = path.join(NM, 'leaflet', p.slice('/leaflet@1.9.4/'.length));
    if (file && fs.existsSync(file)) return route.fulfill({ status: 200, contentType: file.endsWith('.css') ? 'text/css' : 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
    return route.fulfill({ status: 404, body: 'nf' });
  });
  await ctx.route('https://*.tile.openstreetmap.org/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  // Overpass mock for ALL server hosts. stats.behave(host, kind, n) can return 'ok' (default), '503', or 'abort'
  // (n = how many data/count requests this host has seen so far). stats.log records every request.
  const stats = { overpassCalls: 0, log: [], seen: {}, behave: () => 'ok' };
  await ctx.route(/\/interpreter$/, (route) => {
    stats.overpassCalls++;
    const host = new URL(route.request().url()).host;
    const body = decodeURIComponent(route.request().postData() || '');
    const kind = body.includes('out count') ? 'count' : 'data';
    const key = host + '|' + kind; stats.seen[key] = (stats.seen[key] || 0) + 1;
    stats.log.push({ host, kind });
    const h = { 'access-control-allow-origin': '*' };
    const how = stats.behave(host, kind, stats.seen[key]);
    if (how === 'abort') return route.abort('failed');
    if (how === '503') return route.fulfill({ status: 503, headers: h, body: 'busy' });
    // tiles: return everything for whichever bbox (dedup handles overlaps)
    if (kind === 'count') return route.fulfill({ status: 200, contentType: 'application/json', headers: h, body: JSON.stringify({ elements: [{ type: 'count', id: 0, tags: { ways: String(ELS.length) } }] }) });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: h, body: JSON.stringify({ elements: ELS }) });
  });
  const status = () => page.locator('#status').innerText();
  const waitStatus = (re, ms = 120000) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('status').textContent), re.source, { timeout: ms });
  const shot = (n) => page.screenshot({ path: path.join(out, n + '.png') });
  const selectArea = () => page.evaluate(async (a) => { const { bus, state } = await import('/src/core/state.js'); state.area = a; bus.emit('area:selected', a); }, area);
  const close = async () => { await browser.close(); srv.kill(); };
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForSelector('.leaflet-container', { timeout: 20000 });
  return { page, ctx, area, ELS, errors, stats, status, waitStatus, shot, selectArea, close };
}
module.exports = { boot };
