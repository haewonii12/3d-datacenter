import { it, expect } from 'vitest';
import { emptySlots } from '../../src/domain/slots.js';

it('emptySlots = rows*cols - racks, 1-based', () => {
  const floor = { rows: 2, cols: 3, racks: [{ row: 1, col: 1 }, { row: 2, col: 3 }] };
  const e = emptySlots(floor);
  expect(e.length).toBe(4);
  expect(e).toEqual([{ row: 1, col: 2 }, { row: 1, col: 3 }, { row: 2, col: 1 }, { row: 2, col: 2 }]);
});
