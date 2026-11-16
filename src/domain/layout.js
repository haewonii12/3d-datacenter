export const RACK = { w: 0.6, d: 1.2, h: 2.0 };
export const UNIT_H = 2.0 / 42;
export const COL_PITCH = 0.7;
export const ROW_PITCH = 2.4;
export const FLOOR_SPACING = 6.0;
/** Slab margin around the rack grid (total, not per side). */
export const SLAB_PAD = 1.0;

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * World x/z of a 1-based slot; grid centered at origin.
 * @param {{rows:number, cols:number}} floor
 * @returns {{x:number, z:number}}
 */
export function gridToWorld(floor, row, col) {
  return {
    x: (col - 1 - (floor.cols - 1) / 2) * COL_PITCH,
    z: (row - 1 - (floor.rows - 1) / 2) * ROW_PITCH,
  };
}

/** Inverse of gridToWorld: the 1-based slot under world x/z, or null outside the grid. */
export function worldToGrid(floor, x, z) {
  const col = Math.round(x / COL_PITCH + (floor.cols - 1) / 2) + 1;
  const row = Math.round(z / ROW_PITCH + (floor.rows - 1) / 2) + 1;
  return row >= 1 && row <= floor.rows && col >= 1 && col <= floor.cols ? { row, col } : null;
}

/** Slab size of a floor: cols×COL_PITCH by rows×ROW_PITCH plus SLAB_PAD. @returns {{w:number, d:number}} */
export function floorFootprint(floor) {
  return { w: floor.cols * COL_PITCH + SLAB_PAD, d: floor.rows * ROW_PITCH + SLAB_PAD };
}

/**
 * Bounding box of a DC's floor stack (centered on x/z, bottom slab at y=0).
 * @param {{rows:number, cols:number}[]} floors
 * @returns {{w:number, d:number, h:number, count:number}}
 */
export function stackExtent(floors) {
  let w = 0;
  let d = 0;
  for (const f of floors) {
    const fp = floorFootprint(f);
    w = Math.max(w, fp.w);
    d = Math.max(d, fp.d);
  }
  return { w, d, h: Math.max(0, floors.length - 1) * FLOOR_SPACING + RACK.h, count: floors.length };
}

/** @param {number} levelIndex 0 = lowest floor @returns {number} */
export function floorY(levelIndex) {
  return levelIndex * FLOOR_SPACING;
}

/** Center y of a server box relative to rack bottom (U1 at bottom). */
export function unitToY(unit, height_u = 1) {
  return (unit - 1 + height_u / 2) * UNIT_H;
}

/** @returns {{x:number,y:number,z:number}} odd row faces +z, even row -z */
export function frontNormal(row) {
  return { x: 0, y: 0, z: row % 2 === 1 ? 1 : -1 };
}

/** @returns {string} e.g. 'R03-C12' */
export function rackLabel(rack) {
  return `R${pad2(rack.row)}-C${pad2(rack.col)}`;
}

/** @returns {string} 'U10' or 'U10–11' */
export function unitRangeLabel(server) {
  const h = server.height_u || 1;
  return h >= 2 ? `U${server.unit}–${server.unit + h - 1}` : `U${server.unit}`;
}

/** @returns {string} e.g. '2F-R03-C12-U10' */
export function locationLabel(floor, rack, server) {
  return `${floor.id}-${rackLabel(rack)}-${unitRangeLabel(server)}`;
}
