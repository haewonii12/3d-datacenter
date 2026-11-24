import { describe, it, expect } from 'vitest';
import { usedU, occupancy, colorFor, bandFor, floorStats, BAND_COLORS } from '../../src/domain/occupancy.js';

const rack = (total_u, servers) => ({ id: 'r', total_u, servers: servers.map(([unit, height_u], i) => ({ id: 's' + i, unit, height_u })) });

describe('occupancy', () => {
  it('colorFor band boundaries', () => {
    expect(colorFor(0)).toBe('#3fb950');
    expect(colorFor(0.599)).toBe('#3fb950');
    expect(colorFor(0.6)).toBe('#d29922');
    expect(colorFor(0.849)).toBe('#d29922');
    expect(colorFor(0.85)).toBe('#f85149');
    expect(colorFor(1)).toBe('#f85149');
    expect(bandFor(0.7)).toBe('yellow');
    expect(BAND_COLORS.red).toBe('#f85149');
  });
  it('usedU counts overlaps once and clamps out-of-range', () => {
    // 1-2, 2-3 overlap => U1..3 = 3; 9-11 clamped to 9..10 = 2 => 5
    expect(usedU(rack(10, [[1, 2], [2, 2], [9, 3]]))).toBe(5);
    // unit 0 h3 => U0..2 -> clamp 1..2 = 2; unit 20 entirely outside = 0
    expect(usedU(rack(10, [[0, 3], [20, 2]]))).toBe(2);
    expect(usedU(rack(10, []))).toBe(0);
  });
  it('occupancy ratio', () => {
    expect(occupancy(rack(10, [[1, 5]]))).toBe(0.5);
  });
  it('floorStats avg includes empty racks', () => {
    const floor = { zones: [{ id: 'A', colOffset: 0, rows: 2, cols: 3 }], racks: [rack(10, [[1, 9]]), rack(10, []), rack(10, [[1, 6]])] };
    const s = floorStats(floor);
    expect(s).toEqual({ racks: 3, slots: 6, usedU: 15, totalU: 30, avg: 0.5, bands: { green: 1, yellow: 1, red: 1 } });
  });
  it('usedU: a boundary-shared U counts once; unparsable devices are not mounted', () => {
    expect(usedU(rack(42, [[29, 3], [31, 2]]))).toBe(4); // U29–32
    const r = rack(42, [[1, 2]]);
    r.servers.push({ id: 'bad', invalid: true });
    expect(usedU(r)).toBe(2);
  });
  it('floorStats with no racks', () => {
    expect(floorStats({ rows: 2, cols: 2, racks: [] }).avg).toBe(0);
  });
});
