import { it, expect } from 'vitest';
import { laneOf } from '../../src/ui/elevation.js';
import { sharedUnits } from '../../src/domain/mount.js';

const lanes = (list) => {
  const devs = list.map(([id, unit, h]) => ({ id, unit, height_u: h }));
  const shares = sharedUnits(devs.map((d) => ({ id: d.id, s: d.unit, e: d.unit + d.height_u - 1 })));
  return Object.fromEntries(laneOf(devs, shares));
};

it('legal layouts, including boundary-shared halves, use one lane', () => {
  expect(lanes([['a', 29, 3], ['b', 31, 2], ['c', 1, 1], ['d', 2, 4]])).toEqual({ a: 0, b: 0, c: 0, d: 0 });
});
it('violating overlaps get their own lanes', () => {
  expect(lanes([['a', 29, 1], ['b', 29, 1]])).toEqual({ a: 0, b: 1 });
  expect(lanes([['a', 10, 3], ['b', 11, 3], ['c', 14, 1]])).toEqual({ a: 0, b: 1, c: 0 });
  expect(lanes([['a', 29, 3], ['b', 31, 1]])).toEqual({ a: 0, b: 1 }); // containment at the boundary U
});
