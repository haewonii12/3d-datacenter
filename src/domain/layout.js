export const RACK = { w: 0.6, d: 1.2, h: 2.0 };
export const UNIT_H = 2.0 / 42;
export const COL_PITCH = 0.7;
export const ROW_PITCH = 2.4;
export const FLOOR_SPACING = 6.0;
/** Slab margin around the rack grid (total, not per side). */
export const SLAB_PAD = 1.0;

import { cellAt, spanLabel, parseFloorspaces } from './floorspace.js';

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

/** Width of a rack spanning `span` grid columns (the gaps between its cells are filled). */
export const rackWidth = (span = 1) => span * COL_PITCH - (COL_PITCH - RACK.w);

/**
 * Single footprint contract for a (multi-cell) rack: center x/z on the floor and width along x.
 * Every renderer, picker and camera uses this; nothing else calls gridToWorld for racks.
 * @returns {{cx:number, cz:number, w:number}}
 */
export function rackFootprint(floor, rack) {
  const span = rack.span || 1;
  const { x, z } = gridToWorld(floor, rack.row, rack.col);
  return { cx: x + ((span - 1) * COL_PITCH) / 2, cz: z, w: rackWidth(span) };
}

/** World rectangle (floor-local x/z) of a zone's cells, grown by `margin`. */
export function zoneRect(floor, zone, margin = 0) {
  const a = gridToWorld(floor, 1, zone.colOffset + 1);
  const b = gridToWorld(floor, zone.rows, zone.colOffset + zone.cols);
  return {
    x0: a.x - COL_PITCH / 2 - margin,
    x1: b.x + COL_PITCH / 2 + margin,
    z0: a.z - ROW_PITCH / 2 - margin,
    z1: b.z + ROW_PITCH / 2 + margin,
  };
}

/** Floorspace cell under world x/z (null in a zone gap or outside the grid). */
export function floorspaceAt(floor, x, z) {
  const slot = worldToGrid(floor, x, z);
  return slot ? cellAt(floor, slot.row, slot.col) : null;
}

/**
 * Vertical extent of a mounted device relative to the rack bottom. In a boundary-shared U the lower
 * device keeps the bottom half (trimTop) and the upper device the top half (trimBottom).
 * @param {{unit:number, height_u:number}} device
 * @param {{trimTop?:boolean, trimBottom?:boolean}} [share]
 * @returns {{y:number, h:number, lo:number, hi:number}} center y, height, bottom and top y
 */
export function mountY(device, share = {}) {
  const lo = (device.unit - 1 + (share.trimBottom ? 0.5 : 0)) * UNIT_H;
  const hi = (device.unit - 1 + device.height_u - (share.trimTop ? 0.5 : 0)) * UNIT_H;
  return { y: (lo + hi) / 2, h: hi - lo, lo, hi };
}

/** Display name of a device (the position when the record had no name). */
export const deviceLabel = (s) => s.device_name || s.device_position || '(이름 없음)';

/** @returns {string} the rack's name, e.g. 'RI20261120' */
export function rackLabel(rack) {
  return rack.name || rack.id;
}

/** @returns {string} '3A0401' or '3A0401–03' */
export function rackCellsLabel(rack) {
  return spanLabel(parseFloorspaces(rack.floorspaces).cells);
}

/** @returns {string} 'U10' or 'U10–11' */
export function unitRangeLabel(server) {
  if (server.invalid || server.unit == null) return server.device_position || '위치 오류';
  const h = server.height_u || 1;
  return h >= 2 ? `U${server.unit}–${server.unit + h - 1}` : `U${server.unit}`;
}

/** @returns {string} e.g. '3A0401-U29–31' */
export function locationLabel(floor, rack, server) {
  return `${rackCellsLabel(rack)}-${unitRangeLabel(server)}`;
}
