// Offline test: buildings must never end up on a road corridor after clearBuildingsFromRoads().
import { clearBuildingsFromRoads, roadClearance } from '../../src/data/layout.js';

let fails = 0;
const ok = (c, m, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  — ' + x : ''}`); if (!c) fails++; };

let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const road = (pts, width, extra = {}) => ({ points: pts, width, drivable: true, highway: 'residential', kind: 'residential', ...extra });
const roads = [
  road([[-200, 0], [200, 0]], 10), road([[0, -200], [0, 200]], 7), road([[-200, -150], [200, 120]], 8),
  road([[-150, 80], [150, 90]], 5, { highway: 'service', kind: 'residential' }),
  road([[-100, -100], [100, 100]], 1.5, { drivable: false, kind: 'footpath', highway: 'footway' }),
];
const buildings = [];
for (let i = 0; i < 600; i++) {
  const cx = (rnd() - 0.5) * 380, cz = (rnd() - 0.5) * 380, w = 5 + rnd() * 25, d = 5 + rnd() * 18, a = rnd() * Math.PI;
  const c = Math.cos(a), s = Math.sin(a);
  const fp = [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, z]) => [cx + (x * c - z * s) / 2, cz + (x * s + z * c) / 2]);
  buildings.push({ id: 'b' + i, footprint: fp, center: [cx, cz], height: 10, levels: 3, area: w * d });
}
// explicit worst cases: dead on a road centerline, and a corner clipping a road
buildings.push({ id: 'onroad', footprint: [[-5, -4], [5, -4], [5, 4], [-5, 4]], center: [0, 0], height: 9, levels: 3, area: 80 });
buildings.push({ id: 'clip', footprint: [[40, 3], [55, 3], [55, 15], [40, 15]], center: [47, 9], height: 9, levels: 3, area: 180 });

const data = { roads, buildings: buildings.map((b) => ({ ...b })), greens: [], water: [] };
const before = data.buildings.length;
const t0 = performance.now();
const stats = clearBuildingsFromRoads(data);
const ms = performance.now() - t0;
console.log('stats', stats, `${before} -> ${data.buildings.length} buildings in ${ms.toFixed(0)} ms`);

// Independent brute-force check against every road
function dist(x, z, r) {
  let best = Infinity;
  for (let i = 1; i < r.points.length; i++) {
    const [x0, z0] = r.points[i - 1], [x1, z1] = r.points[i], ex = x1 - x0, ez = z1 - z0;
    const t = Math.max(0, Math.min(1, ((x - x0) * ex + (z - z0) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(x - x0 - ex * t, z - z0 - ez * t));
  }
  return best;
}
let worstPen = 0, bad = 0;
for (const b of data.buildings) {
  const fp = b.footprint;
  for (let i = 0; i < fp.length; i++) {
    const [ax, az] = fp[i], [bx, bz] = fp[(i + 1) % fp.length];
    for (let k = 0; k <= 20; k++) {
      const x = ax + ((bx - ax) * k) / 20, z = az + ((bz - az) * k) / 20;
      for (const r of roads) { const pen = roadClearance(r) - dist(x, z, r); if (pen > worstPen) worstPen = pen; if (pen > 0.1) { bad++; break; } }
    }
  }
}
ok(bad === 0, 'no footprint edge enters any road corridor', `worst intrusion ${worstPen.toFixed(3)} m`);
ok(!data.buildings.some((b) => b.id === 'onroad'), 'building centered on a road is dropped');
const clip = data.buildings.find((b) => b.id === 'clip');
ok(!clip || Math.min(...clip.footprint.map(([x, z]) => dist(x, z, roads[0]))) >= roadClearance(roads[0]) - 0.1, 'clipping building slid clear of the road');
ok(data.buildings.length > before * 0.5, 'most buildings survive', `${data.buildings.length}/${before}`);
const again = clearBuildingsFromRoads(data);
ok(again.moved + again.shrunk + again.removed === 0, 'second run changes nothing (idempotent)');
ok(data.buildings.every((b) => b.center.every(Number.isFinite) && b.footprint.every((p) => p.every(Number.isFinite))), 'all coordinates finite');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
