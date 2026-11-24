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
  const ch = await page.evaluate(async () => {
    const { world } = await import('/src/world/scene.js');
    const { setBaked } = await import('/src/world/optimizer.js');
    const { getLayer } = await import('/src/world/layerManager.js');
    const out = { editable: [], baked: 0 };
    setBaked(false);
    world.cityRoot.getObjectByName('streets').children.forEach((m) => { if (m.userData.roadChunk) out.editable.push([m.name, m.geometry.attributes.position.count]); });
    out.walks = world.cityRoot.getObjectByName('sidewalks').children.length;
    out.lamps = getLayer('lamps') ? getLayer('lamps').children.length : -1;
    out.trees = getLayer('trees') ? getLayer('trees').children.length : -1;
    const st = (await import('/src/core/state.js')).state.cityData.roads.filter((q) => q.drivable);
    out.drivable = st.length;
    // asphalt vertex bounds cover each road's first point (within 12 m)
    const asph = world.cityRoot.getObjectByName('streets').children.find((m) => m.userData.roadChunk && /Asphalt/i.test(m.name));
    const pa = asph.geometry.attributes.position, near = (x, z) => { for (let i = 0; i < pa.count; i++) if (Math.hypot(pa.getX(i) - x, pa.getZ(i) - z) < 12) return true; return false; };
    out.roadsWithChunk = st.filter((q) => near(q.points[0][0], q.points[0][1])).length;
    setBaked(true);
    out.baked = world.cityRoot.getObjectByName('baked').children.length;
    // aerial shot over the first primary road
    const road = (await import('/src/core/state.js')).state.cityData.roads.find((q) => q.kind === 'primary');
    const [x, z] = road.points[0];
    world.camera.position.set(x + 20, 26, z + 30); world.controls.target.set(x + 20, 0, z); world.controls.update();
    return out;
  });
  console.log(JSON.stringify(ch));
  ok('every drivable road got the chunk: its asphalt covers all of them', ch.roadsWithChunk === ch.drivable, `${ch.roadsWithChunk}/${ch.drivable}`);
  ok('road chunk meshes were created (asphalt, curb, sidewalk, lamp parts)', ch.editable.length >= 4, ch.editable.map((e) => e.join(':')).join(' '));
  ok('coded sidewalks switched off', ch.walks === 0);
  ok('coded lamps switched off, trees kept', ch.lamps === 0 && ch.trees > 0, `lamps ${ch.lamps} trees ${ch.trees}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(__dirname, 'out', 'roadtex', 'aerial.png') });
  ok('old Untitled texture is no longer used for roads', Object.values(r.by).every((v) => v.glb === 0));
  await page.evaluate(() => { document.getElementById('btn-drive').click(); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(__dirname, 'out', 'roadtex', 'drive.png') });
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  ok('no browser errors', errors.length === 0, errors.join(' | '));
  await h.close(); process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
