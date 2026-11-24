const path = require('path');
const { boot } = require('./harness.js');
(async () => {
  const h = await boot({ span: 0.01, out: path.join(__dirname, 'out', 'junction'), port: 8773 });
  const { page } = h;
  await h.selectArea();
  await page.click('#btn-generate'); await h.waitStatus(/Primary city/, 180000);
  await page.click('#btn-build'); await h.waitStatus(/City built/, 240000);
  const pts = await page.evaluate(async () => {
    const { state } = await import('/src/core/state.js');
    const R = state.cityData.roads.filter((r) => r.drivable && r.width >= 7);
    const out = [];
    for (const a of R) for (const b of R) { if (a === b) continue;
      for (let i = 1; i < a.points.length; i++) for (let j = 1; j < b.points.length; j++) {
        const [x1,z1]=a.points[i-1],[x2,z2]=a.points[i],[x3,z3]=b.points[j-1],[x4,z4]=b.points[j];
        const d=(x2-x1)*(z4-z3)-(z2-z1)*(x4-x3); if (Math.abs(d)<1e-6) continue;
        const t=((x3-x1)*(z4-z3)-(z3-z1)*(x4-x3))/d, u=((x3-x1)*(z2-z1)-(z3-z1)*(x2-x1))/d;
        if (t>0&&t<1&&u>0&&u<1) out.push([x1+t*(x2-x1), z1+t*(z2-z1)]);
      } }
    return out.slice(0, 1);
  });
  console.log(JSON.stringify(pts));
  const [x, z] = pts[0];
  await page.evaluate(async ([x, z]) => {
    const { world } = await import('/src/world/scene.js');
    world.camera.position.set(x + 25, 45, z + 45); world.controls.target.set(x, 0, z); world.controls.update();
  }, [x, z]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(__dirname, 'out', 'junction', 'j.png') });
  await h.close(); process.exit(0);
})();
