import { it, expect } from 'vitest';
import { emptySlots, slotCount } from '../../src/domain/slots.js';

const floor = {
  level: 3,
  zones: [
    { id: 'A', colOffset: 0, rows: 2, cols: 3 },
    { id: 'B', colOffset: 5, rows: 1, cols: 2 },
  ],
  racks: [
    { row: 1, col: 1, span: 2 }, // 3A0101-02
    { row: 2, col: 3, span: 1 }, // 3A0203
    { row: 1, col: 6, span: 1 }, // 3B0101
  ],
};

it('emptySlots: only zone cells (gap columns are not slots); a span covers its cells', () => {
  expect(emptySlots(floor)).toEqual([
    { row: 1, col: 3, floorspace: '3A0103' },
    { row: 2, col: 1, floorspace: '3A0201' },
    { row: 2, col: 2, floorspace: '3A0202' },
    { row: 1, col: 7, floorspace: '3B0102' },
  ]);
});
it('slotCount = sum of zone cells', () => {
  expect(slotCount(floor)).toBe(8);
  expect(slotCount({ racks: [] })).toBe(0);
});
