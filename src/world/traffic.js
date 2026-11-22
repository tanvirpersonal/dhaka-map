// Ambient traffic: cars driving around the road graph (see export/gameData.js buildRoadGraph).
//
//  * makeTrafficSim(graph, opts)  - pure simulation, no WebGL (unit-testable)
//  * startTraffic() / stopTraffic() - instanced low-poly cars (2 draw calls for all of them)
//
// Cars keep to their side of the road (left- or right-hand traffic), respect one-way streets,
// follow the car in front, and pick a random exit at every intersection.

import * as THREE from 'three';
import { world } from './scene.js';
import { state } from '../core/state.js';
import { buildRoadGraph, guessDrivingSide } from '../export/gameData.js';

const CAR_LEN = 4.6;
const SPEED = { primary: 13, secondary: 10, residential: 7, footpath: 0, dirt: 5 }; // m/s

// ---------- pure simulation ----------

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function prepareEdge(e) {
  const cum = [0];
  for (let i = 1; i < e.points.length; i++) cum.push(cum[i - 1] + Math.hypot(e.points[i][0] - e.points[i - 1][0], e.points[i][1] - e.points[i - 1][1]));
  return { ...e, cum, len: cum[cum.length - 1], vmax: (e.maxspeed ? e.maxspeed / 3.6 * 0.8 : SPEED[e.kind] ?? 7) };
}

/** Point and unit tangent (in increasing point order) at distance d along a prepared edge. */
function sample(e, d) {
  const cum = e.cum;
  d = Math.max(0, Math.min(e.len, d));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1, t = (d - cum[i - 1]) / seg;
  const [x0, z0] = e.points[i - 1], [x1, z1] = e.points[i];
  const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
  return { x: x0 + dx * t, z: z0 + dz * t, tx: dx / l, tz: dz / l };
}

export function makeTrafficSim(graph, { side = 'right', count = 100, seed = 1 } = {}) {
  const rnd = mulberry(seed);
  const edges = new Map();
  for (const e of graph.edges) { const p = prepareEdge(e); if (p.len >= 8 && p.vmax > 0) edges.set(e.id, p); }

  // node -> ways to leave it: dir +1 starts at edge.from, dir -1 starts at edge.to (two-way streets only)
  const out = new Map();
  const add = (n, o) => { if (!out.has(n)) out.set(n, []); out.get(n).push(o); };
  for (const e of edges.values()) { add(e.from, { edge: e, dir: 1 }); if (!e.oneway) add(e.to, { edge: e, dir: -1 }); }

  const ways = [];
  for (const e of edges.values()) { ways.push({ edge: e, dir: 1 }); if (!e.oneway) ways.push({ edge: e, dir: -1 }); }
  const endNode = (w) => (w.dir > 0 ? w.edge.to : w.edge.from);

  const cars = [];
  const occupied = (edge, dir, s, self) => cars.some((o) => o !== self && o.edge === edge && o.dir === dir && Math.abs(o.s - s) < CAR_LEN + 2);
  const spawn = (car) => {
    // try a few random spots; accept the last one anyway so a crowded map can't hang
    for (let tries = 0; tries < 12; tries++) {
      const w = ways[Math.floor(rnd() * ways.length)];
      car.edge = w.edge; car.dir = w.dir; car.s = rnd() * w.edge.len; car.v = 0;
      if (!occupied(car.edge, car.dir, car.s, car)) break;
    }
    car.wait = 0; car.next = null;
    return car;
  };
  // a street is open for entry when no car is within one car length of its start
  const entryClear = (w, self) => !cars.some((o) => o !== self && o.edge === w.edge && o.dir === w.dir && o.s < CAR_LEN + 1.5);
  if (ways.length) for (let i = 0; i < count; i++) cars.push(spawn({ id: i, color: Math.floor(rnd() * 8), turns: 0, wait: 0, next: null }));

  function nextWay(car) {
    const node = car.dir > 0 ? car.edge.to : car.edge.from;
    const options = (out.get(node) || []).filter((o) => !(o.edge === car.edge && o.dir === -car.dir)); // no U-turn if avoidable
    const pool = options.length ? options : (out.get(node) || []).filter((o) => o.edge !== car.edge || o.dir !== car.dir);
    return pool.length ? pool[Math.floor(rnd() * pool.length)] : null;
  }

  function step(dt) {
    // cars in the same lane, ordered by distance travelled, so each can see the one ahead
    const lanes = new Map();
    for (const c of cars) { const k = `${c.edge.id}|${c.dir}`; (lanes.get(k) || lanes.set(k, []).get(k)).push(c); }
    for (const list of lanes.values()) list.sort((a, b) => a.s - b.s);

    for (const list of lanes.values()) {
      for (let i = 0; i < list.length; i++) {
        const c = list[i], lead = list[i + 1];
        let target = c.edge.vmax;
        if (lead) {
          const gap = lead.s - c.s - CAR_LEN;
          if (gap < 18) target = Math.min(target, Math.max(0, (gap - 2) * 1.1), lead.v + 1);
        }
        // slow down for the end of the street (intersection), then speed up again after the turn
        const left = c.edge.len - c.s;
        if (left < 14) target = Math.min(target, 4 + left * 0.4);
        const dv = target - c.v;
        c.v += Math.max(-10 * dt, Math.min(3.2 * dt, dv));
        if (c.v < 0) c.v = 0;
        c.s += c.v * dt;
      }
    }

    for (const c of cars) {
      if (c.s < c.edge.len) { c.wait = 0; continue; }
      const nw = c.next || (c.next = nextWay(c));
      if (!nw) { spawn(c); continue; }                 // dead end on a one-way: reappear somewhere else
      // wait at the junction until the next street has room; after 3 s go anyway so jams can't deadlock
      if (!entryClear(nw, c) && (c.wait += dt) < 3) { c.s = c.edge.len; c.v = 0; continue; }
      const carry = c.s - c.edge.len;
      c.edge = nw.edge; c.dir = nw.dir; c.s = Math.min(carry, nw.edge.len); c.turns++;
      c.wait = 0; c.next = null;
    }
  }

  /** World pose of a car: position in its lane and heading (atan2(dx, dz)). */
  function pose(c) {
    const e = c.edge;
    const p = sample(e, c.dir > 0 ? c.s : e.len - c.s);
    const tx = p.tx * c.dir, tz = p.tz * c.dir;
    const lane = e.oneway ? 0 : Math.min(e.width / 4, 3);
    const sgn = side === 'left' ? -1 : 1;
    return { x: p.x - tz * lane * sgn, z: p.z + tx * lane * sgn, heading: Math.atan2(tx, tz) };
  }

  return { cars, step, pose, edgeCount: edges.size };
}

// ---------- rendering ----------

const PALETTE = [0xc0392b, 0x2e86c1, 0xecf0f1, 0x2c3e50, 0xf1c40f, 0x7f8c8d, 0x27ae60, 0x8e44ad];
let running = null;

export const isTrafficOn = () => !!running;

export function startTraffic(count) {
  if (running || !state.cityData || !world.scene) return null;
  const graph = buildRoadGraph(state.cityData.roads);
  const side = guessDrivingSide(state.cityData.area);
  const totalLen = graph.edges.reduce((s, e) => s + e.length, 0);
  const n = count ?? Math.max(20, Math.min(200, Math.round(totalLen / 90)));
  const sim = makeTrafficSim(graph, { side, count: n, seed: 7 });
  if (!sim.cars.length) return null;

  const body = new THREE.BoxGeometry(1.8, 0.75, CAR_LEN - 0.4); body.translate(0, 0.62, 0);
  const cabin = new THREE.BoxGeometry(1.5, 0.6, 2.1); cabin.translate(0, 1.27, -0.15);
  const bodyMesh = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.3 }), sim.cars.length);
  const cabinMesh = new THREE.InstancedMesh(cabin, new THREE.MeshStandardMaterial({ color: 0x1b2733, roughness: 0.2, metalness: 0.4 }), sim.cars.length);
  const col = new THREE.Color();
  sim.cars.forEach((c, i) => bodyMesh.setColorAt(i, col.setHex(PALETTE[c.color])));
  for (const m of [bodyMesh, cabinMesh]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }

  const group = new THREE.Group();
  group.name = 'traffic';
  group.add(bodyMesh, cabinMesh);
  world.scene.add(group);

  const m4 = new THREE.Matrix4();
  const poses = new Float32Array(sim.cars.length * 3); // x, z, heading per car, for collisions
  const frame = (dt) => {
    const step = Math.min(dt, 0.1);
    sim.step(step);
    sim.cars.forEach((c, i) => {
      const p = sim.pose(c);
      poses[i * 3] = p.x; poses[i * 3 + 1] = p.z; poses[i * 3 + 2] = p.heading;
      m4.makeRotationY(p.heading).setPosition(p.x, 0.14, p.z);
      bodyMesh.setMatrixAt(i, m4); cabinMesh.setMatrixAt(i, m4);
    });
    bodyMesh.instanceMatrix.needsUpdate = true; cabinMesh.instanceMatrix.needsUpdate = true;
    if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
  };
  world.onFrame.add(frame);
  running = { group, frame, count: sim.cars.length, poses };
  return { cars: sim.cars.length, edges: sim.edgeCount, side };
}

export function stopTraffic() {
  if (!running) return;
  world.onFrame.delete(running.frame);
  world.scene.remove(running.group);
  running.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  running = null;
}

/**
 * Push a circle (the player's car) out of the traffic cars. Each traffic car is a capsule: the segment
 * 1.2 m ahead to 1.2 m behind its center, radius 1.05. Same contract as the building collider in
 * driveMode.js: returns {x, z, hit}.
 */
export function trafficCollide(x, z, r) {
  if (!running) return { x, z, hit: false };
  const { poses, count } = running;
  const R = r + 1.05; // combined radius
  let hit = false;
  for (let i = 0; i < count; i++) {
    const cx = poses[i * 3], cz = poses[i * 3 + 1];
    if (Math.abs(cx - x) > 4 + R || Math.abs(cz - z) > 4 + R) continue; // cheap reject
    const fx = Math.sin(poses[i * 3 + 2]), fz = Math.cos(poses[i * 3 + 2]);
    const t = Math.max(-1.2, Math.min(1.2, (x - cx) * fx + (z - cz) * fz)); // closest point on the axis
    const px = cx + fx * t, pz = cz + fz * t;
    let dx = x - px, dz = z - pz, d = Math.hypot(dx, dz);
    if (d >= R) continue;
    if (d < 1e-6) { dx = -fz; dz = fx; d = 1; } // dead center: leave sideways
    x = px + (dx / d) * R; z = pz + (dz / d) * R;
    hit = true;
  }
  return { x, z, hit };
}
