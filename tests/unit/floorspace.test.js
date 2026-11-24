import { describe, it, expect } from 'vitest';
import { parseFloorspace, parseFloorspaces, isContiguous, checkRackCells, spanLabel } from '../../src/domain/floorspace.js';

describe('parseFloorspace', () => {
  it('reads floor, zone, row, seq', () => {
    expect(parseFloorspace('3A0401')).toEqual({ code: '3A0401', floor: 3, zone: 'A', row: 4, seq: 1 });
    expect(parseFloorspace(' 1c1207 ')).toEqual({ code: '1C1207', floor: 1, zone: 'C', row: 12, seq: 7 });
  });
  it('rejects malformed codes', () => {
    for (const bad of ['', '3A041', '3A04011', 'AA0401', '3A0001', '3A0400', null, '3-0401']) expect(parseFloorspace(bad)).toBeNull();
  });
});

describe('parseFloorspaces', () => {
  it('splits comma lists and sorts by seq', () => {
    const { cells, invalid } = parseFloorspaces('3A0403, 3A0401,3A0402');
    expect(cells.map((c) => c.code)).toEqual(['3A0401', '3A0402', '3A0403']);
    expect(invalid).toEqual([]);
  });
  it('reports invalid entries', () => {
    expect(parseFloorspaces('3A0401,xx').invalid).toEqual(['XX']);
  });
});

describe('isContiguous / spanLabel', () => {
  const c = (s) => parseFloorspaces(s).cells;
  it('one row, consecutive seq', () => {
    expect(isContiguous(c('3A0401,3A0402,3A0403'))).toBe(true);
    expect(isContiguous(c('3A0401,3A0403'))).toBe(false);
    expect(isContiguous(c('3A0401,3A0501'))).toBe(false);
    expect(isContiguous(c('3A0401,3B0402'))).toBe(false);
  });
  it('labels', () => {
    expect(spanLabel(c('3A0401'))).toBe('3A0401');
    expect(spanLabel(c('3A0401,3A0402'))).toBe('3A0401–02');
    expect(spanLabel(c('3A0401,3A0403'))).toBe('3A0401,3A0403');
  });
});

describe('checkRackCells', () => {
  const r = (id, s) => ({ id, cells: parseFloorspaces(s).cells });
  it('no issues for disjoint racks (multi-cell, no cap)', () => {
    expect(checkRackCells([r('A', '3A0401,3A0402,3A0403,3A0404,3A0405,3A0406'), r('B', '3A0407')])).toEqual([]);
  });
  it('flags both racks sharing a cell', () => {
    const issues = checkRackCells([r('A', '3A0401,3A0402'), r('B', '3A0402')]);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('rack-cell-conflict');
    expect(issues[0].racks.sort()).toEqual(['A', 'B']);
  });
  it('flags non-contiguous racks', () => {
    const issues = checkRackCells([r('A', '3A0401,3A0403')]);
    expect(issues.map((i) => i.kind)).toEqual(['rack-noncontiguous']);
  });
});
