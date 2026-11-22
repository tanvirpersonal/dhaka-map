// Browser e2e for the map downloader: failover, busy-retry, remembered server, cache. Mocked network (see harness.js).
const path = require('path');
const { boot } = require('./harness.js');
const OUT = path.join(__dirname, 'out', 'download');
const results = []; const ok = (name, pass, info = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const ASIA = 'ovp.dresel.systems', COFFEE = 'overpass.private.coffee', MAIN = 'overpass-api.de';

(async () => {
  const h = await boot({ span: 0.01, out: OUT, port: 8773 });
  const { page, stats, errors } = h;
  const best = () => page.evaluate(() => localStorage.getItem('overpassBestEndpoint'));
  const clearCache = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('city-builder-cache'); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
  // The status bar keeps the previous result, so reset it first or waitStatus would return immediately.
  const generate = async () => {
    await page.evaluate(() => { document.getElementById('status').textContent = 'starting…'; });
    await page.click('#btn-generate');
    await h.waitStatus(/Primary city|Generate failed/, 180000);
    return h.status();
  };
  const hosts = (kind) => stats.log.filter((l) => l.kind === kind).map((l) => l.host);

  await h.selectArea();

  // 1) Dhaka area: Asia mirror is asked first (data request before count request), then remembered.
  let st = await generate();
  ok('Dhaka: Asia mirror used first', hosts('data')[0] === ASIA && /Primary city/.test(st), `data requests: ${hosts('data')}`);
  ok('data request sent before the count request', stats.log[0].kind === 'data', JSON.stringify(stats.log.slice(0, 2)));
  ok('working server remembered in localStorage', (await best()) === `https://${ASIA}/api-as/interpreter`, await best());

  // 2) Same area again: served from the cache, zero network requests.
  stats.log.length = 0;
  st = await generate();
  ok('second generate of the same area uses the cache (no requests)', stats.log.length === 0 && /Primary city/.test(st), `${stats.log.length} requests`);

  // 3) Asia mirror is down (connection fails): fails over at once to the next server and remembers it.
  await clearCache(); stats.log.length = 0; stats.seen = {};
  stats.behave = (host) => (host === ASIA ? 'abort' : 'ok');
  const t0 = Date.now(); st = await generate(); const ms = Date.now() - t0;
  ok('Asia mirror down: city still generated via another server', /Primary city/.test(st), `${ms} ms, data requests: ${hosts('data')}`);
  ok('failover went Asia -> private.coffee', hosts('data')[0] === ASIA && hosts('data').includes(COFFEE));
  ok('new working server remembered', (await best()) === `https://${COFFEE}/api/interpreter`, await best());

  // 4) Next generate goes straight to the remembered server (no wasted request to the dead one).
  await clearCache(); stats.log.length = 0;
  st = await generate();
  ok('next download skips the dead server', hosts('data')[0] === COFFEE && !hosts('data').includes(ASIA), `data requests: ${hosts('data')}`);

  // 5) Busy server (503) is retried and the loader tells the user.
  await clearCache(); stats.log.length = 0; stats.seen = {};
  stats.behave = (host, kind, n) => (kind === 'data' && n === 1 ? '503' : 'ok');
  const notes = new Set();
  const poll = setInterval(() => page.evaluate(() => document.getElementById('loader-pct')?.textContent || '').then((t) => t && notes.add(t)).catch(() => {}), 150);
  st = await generate(); clearInterval(poll);
  ok('503 on the first data request is retried and succeeds', /Primary city/.test(st) && hosts('data').filter((x) => x === COFFEE).length === 2, `data requests: ${hosts('data')}`);
  ok('loader showed the "busy, retrying" message', [...notes].some((t) => /busy \(503\)/.test(t)), [...notes].slice(0, 4).join(' | '));

  console.log('\nbrowser errors:', errors.filter((e) => !/Failed to load resource|net::ERR/.test(e)));
  ok('no unexpected browser errors', errors.filter((e) => !/Failed to load resource|net::ERR/.test(e)).length === 0);
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await h.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('E2E CRASH', e); process.exit(2); });
