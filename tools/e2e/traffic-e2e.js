// Browser e2e for ambient traffic + drive mode (uses harness.js: mocked CDN/tiles/Overpass, synthetic city).
const path = require('path');
const { boot } = require('./harness.js');
const OUT = path.join(__dirname, 'out', 'traffic');
const results = []; const ok = (name, pass, info = '') => { results.push([pass, name, info]); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

(async () => {
  const h = await boot({ span: 0.01, out: OUT, port: 8771 });
  const { page, errors } = h;
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // --- generate + build
  await h.selectArea();
  await page.click('#btn-generate');
  await h.waitStatus(/Primary city/, 180000);
  ok('city generated', true, await h.status());
  await page.click('#btn-build');
  await h.waitStatus(/City built/, 240000);
  ok('city built', true);
  ok('Traffic button enabled after generate', await ev(() => !document.getElementById('btn-traffic').disabled));

  // --- frame cost baseline (traffic off): median frame time over 60 frames
  const frameStats = (n) => ev(async (n) => {
    const { world } = await import('/src/world/scene.js');
    return new Promise((res) => { const t = []; let last = performance.now(); const f = () => { const now = performance.now(); t.push(now - last); last = now; if (t.length >= n) { world.onFrame.delete(f); t.sort((a, b) => a - b); res({ median: t[t.length >> 1], p90: t[Math.floor(t.length * 0.9)], calls: world.renderer.info.render.calls }); } }; world.onFrame.add(f); });
  }, n);
  const base = await frameStats(60);

  // --- traffic on
  await page.click('#btn-traffic');
  await h.waitStatus(/Traffic on/, 30000);
  const st = await ev(async () => { const { state } = await import('/src/core/state.js'); const { world } = await import('/src/world/scene.js'); const g = world.scene.getObjectByName('traffic'); return { on: state.traffic, group: !!g, inst: g && g.children[0].count, parts: g && g.children.length, active: document.getElementById('btn-traffic').classList.contains('active') }; });
  ok('traffic started', st.on && st.group, `${st.inst} cars, ${st.parts} instanced meshes`);
  ok('Traffic button shows active', st.active);

  const snap = () => ev(async () => { const { world } = await import('/src/world/scene.js'); const m = world.scene.getObjectByName('traffic').children[0]; const a = []; for (let i = 0; i < m.count; i++) a.push([m.instanceMatrix.array[i * 16 + 12], m.instanceMatrix.array[i * 16 + 14]]); return a; });
  const a0 = await snap(); await page.waitForTimeout(3000); const a1 = await snap();
  const moved = a0.filter((p, i) => Math.hypot(p[0] - a1[i][0], p[1] - a1[i][1]) > 0.5).length;
  ok('cars are moving', moved > a0.length * 0.5, `${moved}/${a0.length} moved > 0.5 m in 3 s`);
  const finite = a1.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  ok('car positions finite', finite);

  const withT = await frameStats(60);
  console.log(`   frame time (software GL, not representative of a real GPU): off ${base.median.toFixed(1)} ms / on ${withT.median.toFixed(1)} ms; draw calls off ${base.calls} / on ${withT.calls}`);
  ok('traffic adds only 2 draw calls', withT.calls - base.calls <= 3, `${base.calls} -> ${withT.calls}`);
  await h.shot('01-traffic');

  // --- drive with traffic
  await page.click('#btn-drive');
  await h.waitStatus(/Drive:|Driving/, 30000);
  ok('drive mode started with traffic running', (await ev(async () => (await import('/src/core/state.js')).state.mode)) === 'drive');
  // cycle the camera modes (chase -> cockpit -> hood -> chase) while driving; any exception shows up in browser errors
  for (const key of ['Digit2', 'Digit3', 'KeyC', 'Digit1']) { await page.keyboard.press(key); await page.waitForTimeout(250); }
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(4000);
  const speed = await ev(() => parseInt(document.getElementById('drive-speed').textContent, 10));
  ok('player car accelerates', speed > 10, `${speed} km/h`);
  await h.shot('02-drive-traffic');
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  ok('Esc leaves drive mode', (await ev(async () => (await import('/src/core/state.js')).state.mode)) === 'city');
  ok('traffic keeps running after drive', await ev(async () => (await import('/src/core/state.js')).state.traffic));

  // --- layers: each layer hides on its own, baked buildings included
  const lay = await ev(async () => {
    const { world } = await import('/src/world/scene.js');
    const { LAYER_DEFS, getLayer, setLayerVisible } = await import('/src/world/layerManager.js');
    const vis = () => world.cityRoot.getObjectByName('baked').children.filter((m) => m.visible).map((m) => m.userData.layer);
    const all = LAYER_DEFS.filter((d) => d.id !== 'traffic').map((d) => !!getLayer(d.id));
    const before = vis();
    setLayerVisible('buildings', false);
    const hid = vis(); const trees = getLayer('trees').visible;
    setLayerVisible('trees', false); const treesOff = getLayer('trees').visible, lampsOn = getLayer('lamps').visible;
    setLayerVisible('buildings', true); setLayerVisible('trees', true);
    return { all, hasB: before.includes('buildings'), hidB: !hid.includes('buildings'), keepsStreets: hid.includes('streets'), trees, treesOff, lampsOn, back: vis().includes('buildings'), treesBack: getLayer('trees').visible };
  });
  ok('every layer exists as its own group', lay.all.every(Boolean), JSON.stringify(lay.all));
  ok('hiding Buildings hides only baked buildings', lay.hasB && lay.hidB && lay.keepsStreets);
  ok('hiding Trees leaves Lamps alone', lay.trees && !lay.treesOff && lay.lampsOn);
  ok('layers can be shown again', lay.back && lay.treesBack);

  // --- off, then on again, then regenerate stops it
  await page.click('#btn-traffic'); await page.waitForTimeout(500);
  const off = await ev(async () => { const { world } = await import('/src/world/scene.js'); const { state } = await import('/src/core/state.js'); return { group: !!world.scene.getObjectByName('traffic'), flag: state.traffic, cbs: world.onFrame.size }; });
  ok('traffic toggles off cleanly', !off.group && !off.flag, `frame callbacks ${off.cbs}`);
  await page.click('#btn-traffic'); await h.waitStatus(/Traffic on/, 30000);
  await page.click('#btn-generate'); await h.waitStatus(/Primary city/, 180000);
  const after = await ev(async () => { const { world } = await import('/src/world/scene.js'); const { state } = await import('/src/core/state.js'); return { group: !!world.scene.getObjectByName('traffic'), flag: state.traffic }; });
  ok('regenerating the city stops traffic', !after.group && !after.flag);

  console.log('\nconsole/page errors:', errors.length ? errors : 'none');
  ok('no browser errors', errors.length === 0);
  const failed = results.filter(r => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await h.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('E2E CRASH', e); process.exit(2); });
