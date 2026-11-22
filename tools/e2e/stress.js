// Stress run: big synthetic city (default 0.03 deg ~ 3.3 km => 1,764 buildings, 4 download tiles) + traffic + drive.
const path = require('path');
const { boot } = require('./harness.js');
(async () => {
  const span = parseFloat(process.argv[2] || '0.03');
  const h = await boot({ span, out: path.join(__dirname, 'out', 'stress'), port: 8772 });
  const { page } = h; const R = {};
  await h.selectArea();
  let t = Date.now(); await page.click('#btn-generate'); await h.waitStatus(/Primary city|failed/, 300000); R.generateMs = Date.now() - t; R.generateStatus = await h.status();
  t = Date.now(); await page.click('#btn-build'); await h.waitStatus(/City built|Build failed/, 600000); R.buildMs = Date.now() - t;
  await page.waitForTimeout(800);
  R.city = await page.evaluate(async () => {
    const { world } = await import('/src/world/scene.js'); const { state } = await import('/src/core/state.js');
    const baked = world.cityRoot.getObjectByName('baked'); let tris = 0, bytes = 0;
    baked.children.forEach(c => { const g = c.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; for (const k in g.attributes) bytes += g.attributes[k].array.byteLength; if (g.index) bytes += g.index.array.byteLength; });
    return { buildings: state.cityData.buildings.length, roads: state.cityData.roads.length, bakedMeshes: baked.children.length, tris: Math.round(tris), geometryMB: +(bytes / 1048576).toFixed(1), heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576) };
  });
  const frames = (n) => page.evaluate(async (n) => { const { world } = await import('/src/world/scene.js'); return new Promise(res => { const t = []; let last = performance.now(); const f = () => { const now = performance.now(); t.push(now - last); last = now; if (t.length >= n) { world.onFrame.delete(f); t.sort((a, b) => a - b); res({ medianMs: +t[t.length >> 1].toFixed(1), calls: world.renderer.info.render.calls, tris: world.renderer.info.render.triangles }); } }; world.onFrame.add(f); }); }, n);
  R.overviewTrafficOff = await frames(40);
  await page.click('#btn-traffic'); await h.waitStatus(/Traffic on|No drivable/, 60000);
  R.traffic = await page.evaluate(async () => { const { world } = await import('/src/world/scene.js'); const g = world.scene.getObjectByName('traffic'); return { cars: g.children[0].count };});
  R.overviewTrafficOn = await frames(40);
  // CPU cost of the simulation step itself, inside the browser's JS engine
  R.trafficSimMsPerStep = await page.evaluate(async () => {
    const { makeTrafficSim } = await import('/src/world/traffic.js'); const { buildRoadGraph } = await import('/src/export/gameData.js'); const { state } = await import('/src/core/state.js');
    const sim = makeTrafficSim(buildRoadGraph(state.cityData.roads), { count: 200, seed: 1 }); const a = performance.now(); for (let i = 0; i < 600; i++) sim.step(1 / 60); return +((performance.now() - a) / 600).toFixed(3);
  });
  await page.click('#btn-drive'); await h.waitStatus(/Driving/, 30000);
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(3000);
  R.drive = { kmh: await page.evaluate(() => parseInt(document.getElementById('drive-speed').textContent, 10)), ...(await frames(40)) };
  await h.shot('stress-drive'); await page.keyboard.up('ArrowUp'); await page.keyboard.press('Escape');
  R.errors = h.errors.length; R.errorSample = h.errors.slice(0, 3);
  console.log(JSON.stringify(R, null, 1));
  await h.close();
})().catch(e => { console.error('STRESS CRASH', e); process.exit(1); });
