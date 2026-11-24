import { it, expect } from 'vitest';
import { gridToWorld, worldToGrid, floorY, unitToY, frontNormal, rackLabel, locationLabel, unitRangeLabel, rackFootprint, rackWidth, mountY, floorspaceAt, zoneRect, rackCellsLabel, UNIT_H, FLOOR_SPACING, COL_PITCH, ROW_PITCH, SLAB_PAD, RACK, floorFootprint, stackExtent } from '../../src/domain/layout.js';
import { overviewPreset, floorPreset } from '../../src/domain/camera.js';

it('gridToWorld centers grid at origin', () => {
  const f = { rows: 3, cols: 5 };
  expect(gridToWorld(f, 2, 3)).toEqual({ x: 0, z: 0 });
  const a = gridToWorld(f, 1, 1);
  expect(a.x).toBeCloseTo(-1.4);
  expect(a.z).toBeCloseTo(-2.4);
  const b = gridToWorld(f, 3, 5);
  expect(b.x).toBeCloseTo(1.4);
  expect(b.z).toBeCloseTo(2.4);
});
it('floorY stacks by spacing', () => {
  expect(floorY(0)).toBe(0);
  expect(floorY(2)).toBe(2 * FLOOR_SPACING);
});
it('unitToY', () => {
  expect(unitToY(1, 1)).toBeCloseTo(UNIT_H / 2);
  expect(unitToY(1, 42)).toBeCloseTo(1.0);
  expect(unitToY(10, 2)).toBeCloseTo(10 * (2 / 42));
});
it('frontNormal by row parity', () => {
  expect(frontNormal(1)).toEqual({ x: 0, y: 0, z: 1 });
  expect(frontNormal(2)).toEqual({ x: 0, y: 0, z: -1 });
  expect(frontNormal(3).z).toBe(1);
});
it('labels', () => {
  const rack = { id: 'RI1', name: 'RI20261120', floorspaces: ['3A0401', '3A0402'] };
  expect(rackLabel(rack)).toBe('RI20261120');
  expect(rackLabel({ id: 'RX' })).toBe('RX');
  expect(rackCellsLabel(rack)).toBe('3A0401–02');
  expect(locationLabel({ id: '3F' }, rack, { unit: 10, height_u: 1 })).toBe('3A0401–02-U10');
  expect(locationLabel({ id: '3F' }, rack, { unit: 29, height_u: 3 })).toBe('3A0401–02-U29–31');
  expect(unitRangeLabel({ unit: 5, height_u: 3 })).toBe('U5–7');
  expect(unitRangeLabel({ unit: 5, height_u: 1 })).toBe('U5');
  expect(unitRangeLabel({ invalid: true, device_position: 'abc' })).toBe('abc');
});

it('rackFootprint: a span-n rack covers n columns, centered on them', () => {
  const f = { rows: 3, cols: 5 };
  const one = rackFootprint(f, { row: 1, col: 2, span: 1 });
  expect(one.w).toBeCloseTo(RACK.w);
  expect(one.cx).toBeCloseTo(gridToWorld(f, 1, 2).x);
  const three = rackFootprint(f, { row: 1, col: 2, span: 3 });
  expect(three.w).toBeCloseTo(rackWidth(3));
  expect(three.w).toBeCloseTo(2 * COL_PITCH + RACK.w);
  expect(three.cx).toBeCloseTo(gridToWorld(f, 1, 3).x); // middle column
  // left/right edges line up with the outer cells' edges
  expect(three.cx - three.w / 2).toBeCloseTo(gridToWorld(f, 1, 2).x - RACK.w / 2);
  expect(three.cx + three.w / 2).toBeCloseTo(gridToWorld(f, 1, 4).x + RACK.w / 2);
});

it('mountY: boundary-shared U is split at its half; the two boxes touch without overlap', () => {
  const lower = mountY({ unit: 29, height_u: 3 }, { trimTop: true }); // 3U (29-31)
  const upper = mountY({ unit: 31, height_u: 2 }, { trimBottom: true }); // 2U (31-32)
  expect(lower.lo).toBeCloseTo(28 * UNIT_H);
  expect(lower.hi).toBeCloseTo(30.5 * UNIT_H);
  expect(upper.lo).toBeCloseTo(30.5 * UNIT_H);
  expect(upper.hi).toBeCloseTo(32 * UNIT_H);
  expect(lower.hi).toBeLessThanOrEqual(upper.lo + 1e-12);
  const plain = mountY({ unit: 10, height_u: 2 });
  expect(plain.y).toBeCloseTo(unitToY(10, 2));
  expect(plain.h).toBeCloseTo(2 * UNIT_H);
});

it('floorspaceAt / zoneRect map grid cells back to codes; zone gaps are null', () => {
  const f = { level: 3, rows: 2, cols: 7, zones: [{ id: 'A', colOffset: 0, rows: 2, cols: 3 }, { id: 'B', colOffset: 5, rows: 2, cols: 2 }] };
  const p = gridToWorld(f, 2, 6);
  expect(floorspaceAt(f, p.x, p.z).code).toBe('3B0201');
  const gap = gridToWorld(f, 1, 4);
  expect(floorspaceAt(f, gap.x, gap.z)).toBeNull();
  const r = zoneRect(f, f.zones[1]);
  expect(r.x1 - r.x0).toBeCloseTo(2 * COL_PITCH);
  expect(r.z1 - r.z0).toBeCloseTo(2 * ROW_PITCH);
});

it('floorFootprint / stackExtent use rows×ROW_PITCH, cols×COL_PITCH and the floor count', () => {
  expect(floorFootprint({ rows: 12, cols: 20 })).toEqual({ w: 20 * COL_PITCH + SLAB_PAD, d: 12 * ROW_PITCH + SLAB_PAD });
  const e = stackExtent([{ rows: 10, cols: 16 }, { rows: 14, cols: 24 }, { rows: 10, cols: 16 }]);
  expect(e.w).toBeCloseTo(24 * COL_PITCH + SLAB_PAD);
  expect(e.d).toBeCloseTo(14 * ROW_PITCH + SLAB_PAD);
  expect(e.h).toBeCloseTo(2 * FLOOR_SPACING + RACK.h);
  expect(e.count).toBe(3);
});

it('camera presets scale with floor size and floor count', () => {
  const len = ({ p, t }) => Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]);
  const small = { rows: 10, cols: 16 };
  const big = { rows: 14, cols: 24 };
  // Sample-sized DC (12×20, 4 floors) keeps the former framing distances (~55 / ~43).
  const seoul = Array.from({ length: 4 }, () => ({ rows: 12, cols: 20 }));
  expect(len(overviewPreset(seoul))).toBeGreaterThan(53);
  expect(len(overviewPreset(seoul))).toBeLessThan(58);
  expect(len(floorPreset(seoul[0], 0))).toBeGreaterThan(41);
  expect(len(floorPreset(seoul[0], 0))).toBeLessThan(45);
  expect(len(overviewPreset([big, big]))).toBeGreaterThan(len(overviewPreset([small, small])));
  expect(len(overviewPreset([small, small, small]))).toBeGreaterThan(len(overviewPreset([small])));
  expect(len(floorPreset(big, 0))).toBeGreaterThan(len(floorPreset(small, 0)));
  // Floor target is the floor center at its stacked height; overview target sits mid-stack.
  expect(floorPreset(big, 2).t).toEqual([0, 2 * FLOOR_SPACING, 0]);
  expect(overviewPreset(seoul).t[1]).toBeCloseTo((3 * FLOOR_SPACING) / 2 - 1);
});

it('worldToGrid inverts gridToWorld and rejects points outside the grid', () => {
  const f = { rows: 12, cols: 20 };
  for (const [row, col] of [[1, 1], [3, 12], [12, 20]]) {
    const w = gridToWorld(f, row, col);
    expect(worldToGrid(f, w.x + COL_PITCH * 0.4, w.z - ROW_PITCH * 0.4)).toEqual({ row, col });
  }
  const corner = gridToWorld(f, 1, 1);
  expect(worldToGrid(f, corner.x - COL_PITCH, corner.z)).toBe(null);
  expect(worldToGrid(f, corner.x, corner.z - ROW_PITCH)).toBe(null);
});
