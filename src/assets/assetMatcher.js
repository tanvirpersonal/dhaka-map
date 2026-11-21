// Chooses the best-fitting building asset for a lot, using manifest kinds + area/height ranges.

import { hashString } from './moduleKit.js';

function rangeScore(value, [min, max]) {
  if (value >= min && value <= max) return 0;           // inside range: perfect
  const dist = value < min ? (min - value) / min : (value - max) / max;
  return Math.min(1, dist);                              // 0..1 penalty
}

/**
 * @param {object} building parsed building ({kind, area, height, id})
 * @param {object[]} assets manifest.buildings
 * @returns {string} asset id
 */
export function matchBuildingAsset(building, assets) {
  const scored = assets.map((a) => {
    let score = 0;
    const kindIdx = a.kinds.indexOf(building.kind);
    score += kindIdx === -1 ? 3 : kindIdx * 0.3;          // exact kind wins; earlier in list = better
    score += rangeScore(building.area, a.areaRange) * 1.5;
    score += rangeScore(building.height, a.heightRange);
    return { id: a.id, score };
  });
  scored.sort((x, y) => x.score - y.score);

  // Several near-ties -> pick deterministically from the building id so reloads look identical.
  const best = scored[0].score;
  const ties = scored.filter((s) => s.score - best < 0.15);
  return ties[hashString(building.id) % ties.length].id;
}

/** Deterministic per-building seed for procedural variation. */
export function seedFor(building) {
  return hashString(building.id);
}
