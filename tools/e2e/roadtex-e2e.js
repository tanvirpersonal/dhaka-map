// Browser e2e: Build City uses the GLB road texture on drivable roads (tiled, not stretched).
const path = require('path');
const { boot } = require('./harness.js');
const results = []; const ok = (n, p, i = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${i ? '  — ' + i : ''}`); };
(async () => {
  const h = await boot({ span: 0.01, out: path.join(__dirname, 'out', 'roadtex'), port: 8772 });
  const { page, errors } = h;
  await h.selectArea();
  await page.click('#btn-generate'); await h.waitStatus(/Primary city/, 180000);
  await page.click('#btn-build'); await h.waitStatus(/City built/, 240000);
  const r = await page.evaluate(async () => {
    const { world } = await import('/src/world/scene.js');
    const { setBaked } = await import('/src/world/optimizer.js');
    setBaked(false);
    const st = world.cityRoot.getObjectByName('streets').children;
    const by = {};
    for (const m of st) { const k = m.userData.road?.kind; (by[k] ||= { n: 0, glb: 0 }).n++; if (m.userData.streetAsset === 'road_glb_segment' && m.material.map) by[k].glb++; }
    const glb = st.find((m) => m.userData.streetAsset === 'road_glb_segment');
    setBaked(true);
    return { by, mapSize: glb && [glb.material.map.image.width, glb.material.map.image.height], rep: glb && glb.material.map.repeat.toArray(), order: glb && glb.renderOrder };
  });
  console.log(JSON.stringify(r));
  for (const k of ['primary', 'secondary', 'residential']) if (r.by[k]) ok(`${k} roads use the GLB texture`, r.by[k].glb === r.by[k].n, `${r.by[k].glb}/${r.by[k].n}`);
  ok('texture loaded from the GLB', !!r.mapSize && r.mapSize[0] >= 256, JSON.stringify(r.mapSize));
  ok('preview-quad texture transform dropped', r.rep && r.rep[0] === 1 && r.rep[1] === 1);
  ok('road keeps a ground-layer render order', r.order < 0, String(r.order));
  await page.evaluate(() => { document.getElementById('btn-drive').click(); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(__dirname, 'out', 'roadtex', 'drive.png') });
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  ok('no browser errors', errors.length === 0, errors.join(' | '));
  await h.close(); process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
