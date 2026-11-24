const path = require('path');
const { boot } = require('./harness.js');
(async () => {
  const h = await boot({ span: 0.01, out: path.join(__dirname, 'out', 'bend'), port: 8774 });
  const { page } = h;
  await h.selectArea();
  await page.click('#btn-generate'); await h.waitStatus(/Primary city/, 180000);
  await page.evaluate(async () => {
    const { world } = await import('/src/world/scene.js');
    const { loadManifest, loadGlbScene } = await import('/src/assets/assetLoader.js');
    const { buildRoadChunks } = await import('/src/world/roadChunks.js');
    const { carriagewayIndex } = await import('/src/world/sidewalks.js');
    const { ribbonGeometry, plainRoadMaterial } = await import('/src/world/streetFactory.js');
    const THREE = await import('three');
    const entry = (await loadManifest()).streets.find((s) => s.id === 'road_chunk');
    // a winding road: short OSM-like segments with ~25 degree bends, plus a short 6 m stub
    const pts = []; let x = 2000, z = 2000, a = 0;
    for (let i = 0; i < 14; i++) { pts.push([x, z]); a += (i % 3 === 1 ? -0.5 : 0.35); const L = 9 + (i % 4) * 14; x += Math.sin(a + 1) * L; z += Math.cos(a + 1) * L; }
    const road = { id: 'bend', points: pts, width: 10, drivable: true, kind: 'primary', highway: 'primary' };
    const rib = new THREE.Mesh(ribbonGeometry(pts, 10, 10), plainRoadMaterial('secondary')); rib.position.y = 0.02;
    const grp = new THREE.Group(); grp.add(rib);
    (await buildRoadChunks([road], await loadGlbScene(entry), carriagewayIndex([road]))).forEach((m) => grp.add(m));
    world.cityRoot.add(grp);
    window.__pts = pts;
    const c = pts[7];
    world.camera.position.set(c[0], 150, c[1] + 1); world.controls.target.set(c[0], 0, c[1]); world.controls.update();
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(__dirname, 'out', 'bend', 'b.png') });
  await page.evaluate(async () => {
    const { world } = await import('/src/world/scene.js'); const c = window.__pts[7];
    world.camera.position.set(c[0] + 12, 22, c[1] + 24); world.controls.update();
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(__dirname, 'out', 'bend', 'b2.png') });
  await h.close(); process.exit(0);
})();
