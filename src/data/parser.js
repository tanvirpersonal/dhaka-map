// Convert raw Overpass JSON into the app's city data shape (meters, origin = area center).
//
// Output:
// {
//   buildings: [{ id, footprint:[[x,z]...], height, levels, kind, area, center:[x,z], tags }],
//   roads:     [{ id, points:[[x,z]...], kind, width, name, lanes, oneway, maxspeed, drivable, bridge, tunnel }],
//   greens:    [{ id, footprint }],
//   water:     [{ id, footprint }],
//   bounds, area (lat/lon bbox)
// }

import { makeProjection } from './projection.js';

const LEVEL_HEIGHT = 3.2;
const DEFAULT_LEVELS = 3;

const ROAD_WIDTH = {
  motorway: 14, trunk: 12, primary: 10, secondary: 8.5, tertiary: 7,
  unclassified: 6, residential: 6, service: 4, living_street: 5,
  pedestrian: 4, footway: 2, path: 1.6, cycleway: 2, track: 3.5, steps: 1.6,
};

// Map OSM highway values to street texture kinds used by assets/streets.
export function roadKind(highway) {
  if (['motorway', 'trunk', 'primary'].includes(highway)) return 'primary';
  if (['secondary', 'tertiary'].includes(highway)) return 'secondary';
  if (['residential', 'unclassified', 'service', 'living_street'].includes(highway)) return 'residential';
  if (['footway', 'pedestrian', 'path', 'cycleway', 'steps'].includes(highway)) return 'footpath';
  return 'dirt';
}

export function buildingKind(tags) {
  const b = tags.building;
  if (['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'residential', 'dormitory'].includes(b)) return 'house';
  if (['apartments', 'flats'].includes(b)) return 'apartment';
  if (['commercial', 'retail', 'shop', 'supermarket', 'kiosk', 'hotel'].includes(b) || tags.shop) return 'commercial';
  if (['office'].includes(b) || tags.office) return 'office';
  if (['industrial', 'warehouse', 'factory', 'garage', 'garages', 'shed', 'hangar'].includes(b)) return 'industrial';
  if (['school', 'university', 'college', 'hospital', 'public', 'civic', 'government', 'mosque', 'church', 'temple'].includes(b)
      || tags.amenity) return 'public';
  return 'generic';
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return Math.abs(a) / 2;
}

function centroid(pts) {
  let x = 0, z = 0;
  pts.forEach((p) => { x += p[0]; z += p[1]; });
  return [x / pts.length, z / pts.length];
}

function parseHeight(tags) {
  if (tags.height) {
    const h = parseFloat(String(tags.height).replace(',', '.'));
    if (!Number.isNaN(h) && h > 0) return h;
  }
  const lv = parseInt(tags['building:levels'], 10);
  if (!Number.isNaN(lv) && lv > 0) return lv * LEVEL_HEIGHT;
  return null;
}

export function parseOsm(raw, area) {
  const { project, bounds } = makeProjection(area);
  const toLocal = (geom) => geom.map((g) => project(g.lat, g.lon));

  const buildings = [], roads = [], greens = [], water = [];

  for (const el of raw.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const tags = el.tags || {};
    const pts = toLocal(el.geometry);

    if (tags.building) {
      if (pts.length < 4) continue;
      const ring = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]
        ? pts.slice(0, -1) : pts;
      if (ring.length < 3) continue;
      const a = polygonArea(ring);
      if (a < 6) continue; // ignore tiny sheds
      const h = parseHeight(tags);
      const levels = parseInt(tags['building:levels'], 10) || (h ? Math.max(1, Math.round(h / LEVEL_HEIGHT)) : DEFAULT_LEVELS);
      buildings.push({
        id: `b${el.id}`,
        footprint: ring,
        height: h || levels * LEVEL_HEIGHT,
        levels,
        kind: buildingKind(tags),
        area: a,
        center: centroid(ring),
        tags,
      });
    } else if (tags.highway) {
      if (tags.highway === 'proposed' || tags.highway === 'construction') continue;
      const lanes = parseInt(tags.lanes, 10) || 0;
      const speed = parseInt(tags.maxspeed, 10) || 0; // km/h (ignores "50 mph" style, falls back to 0)
      const oneway = tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === '-1'
        || tags.highway === 'motorway' || tags.junction === 'roundabout';
      const reversed = tags.oneway === '-1';
      const isRoad = !['footway', 'pedestrian', 'path', 'cycleway', 'steps'].includes(tags.highway);
      roads.push({
        id: `r${el.id}`,
        // OSM oneway=-1 means the way is drawn against traffic: flip so points follow travel direction.
        points: reversed ? [...pts].reverse() : pts,
        kind: roadKind(tags.highway),
        highway: tags.highway,
        width: lanes && isRoad ? Math.max(ROAD_WIDTH[tags.highway] || 5, lanes * 3.2) : (ROAD_WIDTH[tags.highway] || 5),
        name: tags.name || '',
        lanes: lanes || (isRoad ? (oneway ? 1 : 2) : 0),
        oneway,
        maxspeed: speed || 0,
        drivable: isRoad && !['track'].includes(tags.highway),
        bridge: !!tags.bridge && tags.bridge !== 'no',
        tunnel: !!tags.tunnel && tags.tunnel !== 'no',
      });
    } else if (tags.natural === 'water' || tags.waterway) {
      if (pts.length >= 4) water.push({ id: `w${el.id}`, footprint: pts.slice(0, -1) });
    } else if (tags.landuse) {
      if (pts.length >= 4) greens.push({ id: `g${el.id}`, footprint: pts.slice(0, -1) });
    }
  }

  return { buildings, roads, greens, water, bounds, area };
}
