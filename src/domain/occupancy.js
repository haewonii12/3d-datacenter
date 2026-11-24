import { slotCount } from './slots.js';

/** @typedef {{id:string, unit:number, height_u:number}} Server */
/** @typedef {{id:string, total_u:number, servers:Server[]}} Rack */

export const BAND_COLORS = { green: '#3fb950', yellow: '#d29922', red: '#f85149' };

/**
 * Distinct U positions occupied (ranges clamped to 1..total_u, overlaps counted once).
 * @param {Rack} rack
 * @returns {number}
 */
export function usedU(rack) {
  const seen = new Set();
  for (const s of rack.servers || []) {
    if (s.invalid) continue; // unparsable position: not mounted
    const lo = Math.max(1, s.unit);
    const hi = Math.min(rack.total_u, s.unit + (s.height_u || 1) - 1);
    for (let u = lo; u <= hi; u++) seen.add(u);
  }
  return seen.size;
}

/** @param {Rack} rack @returns {number} */
export function occupancy(rack) {
  return usedU(rack) / rack.total_u;
}

/** @param {number} ratio @returns {'green'|'yellow'|'red'} */
export function bandFor(ratio) {
  if (ratio < 0.6) return 'green';
  if (ratio < 0.85) return 'yellow';
  return 'red';
}

/** @param {number} ratio @returns {string} hex color */
export function colorFor(ratio) {
  return BAND_COLORS[bandFor(ratio)];
}

/**
 * @param {{rows:number, cols:number, racks:Rack[]}} floor
 * @returns {{racks:number, slots:number, usedU:number, totalU:number, avg:number, bands:{green:number,yellow:number,red:number}}}
 */
export function floorStats(floor) {
  const bands = { green: 0, yellow: 0, red: 0 };
  let used = 0;
  let total = 0;
  for (const r of floor.racks) {
    used += usedU(r);
    total += r.total_u;
    bands[bandFor(occupancy(r))]++;
  }
  return {
    racks: floor.racks.length,
    slots: slotCount(floor),
    usedU: used,
    totalU: total,
    avg: total === 0 ? 0 : used / total,
    bands,
  };
}
