import { describe, it, expect } from 'vitest';
import { checkMounts, sharedUnits, isBoundaryShare } from '../../src/domain/mount.js';

const d = (id, s, e) => ({ id, s, e });
const kinds = (devs) => checkMounts(devs).map((i) => i.kind);

describe('checkMounts', () => {
  it('boundary share 3U (29-31) + 2U (31-32) is allowed', () => {
    expect(checkMounts([d('a', 29, 31), d('b', 31, 32)])).toEqual([]);
    expect(checkMounts([d('b', 31, 32), d('a', 29, 31)])).toEqual([]);
  });
  it('disjoint devices are fine', () => {
    expect(checkMounts([d('a', 1, 2), d('b', 3, 3), d('c', 10, 13)])).toEqual([]);
  });
  it('identical 1U ranges are a violation', () => {
    const issues = checkMounts([d('a', 29, 29), d('b', 29, 29)]);
    expect(issues.map((i) => i.kind)).toEqual(['mount-overlap']);
    expect(issues[0].devices.sort()).toEqual(['a', 'b']);
  });
  it('containment is a violation, including at the boundary U', () => {
    expect(kinds([d('a', 10, 13), d('b', 11, 11)])).toEqual(['mount-overlap']);
    expect(kinds([d('a', 29, 31), d('b', 31, 31)])).toEqual(['mount-overlap']);
    expect(kinds([d('a', 29, 29), d('b', 29, 31)])).toEqual(['mount-overlap']);
  });
  it('overlap of 2U or more is a violation', () => {
    expect(kinds([d('a', 10, 12), d('b', 11, 13)])).toEqual(['mount-overlap']);
  });
  it('a chain of boundary shares is allowed (max 2 per U)', () => {
    expect(checkMounts([d('a', 1, 3), d('b', 3, 5), d('c', 5, 8)])).toEqual([]);
  });
  it('defensive crowd check fires on corrupted triple', () => {
    expect(kinds([d('a', 5, 5), d('b', 5, 5), d('c', 5, 5)])).toContain('mount-crowded');
  });
});

describe('isBoundaryShare', () => {
  it('only lower.e == upper.s with both extending away', () => {
    expect(isBoundaryShare(d('a', 29, 31), d('b', 31, 32))).toBe(true);
    expect(isBoundaryShare(d('a', 29, 31), d('b', 31, 31))).toBe(false);
    expect(isBoundaryShare(d('a', 29, 29), d('b', 29, 31))).toBe(false);
  });
});

describe('sharedUnits', () => {
  it('marks halves of the shared U', () => {
    const m = sharedUnits([d('a', 29, 31), d('b', 31, 32), d('c', 1, 1)]);
    expect(m.get('a')).toEqual({ trimTop: true, trimBottom: false });
    expect(m.get('b')).toEqual({ trimTop: false, trimBottom: true });
    expect(m.has('c')).toBe(false);
  });
});
