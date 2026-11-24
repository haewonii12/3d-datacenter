import { describe, it, expect } from 'vitest';
import { validate, normalize, toStored } from '../../src/data/schema.js';
import { recordsToDataset } from '../../src/data/records.js';
import { checkDataset } from '../../src/data/load.js';
import { generate } from '../../scripts/gen-sample.mjs';

const dev = (id, device_position, device_name = id) => ({ id, device_name, company: '해원회사', device_position });
const tree = (racks, extra = {}) => ({
  version: 3,
  datacenters: [{ id: '가산IDC', name: '가산IDC', floors: [{ id: '3F', level: 3, racks }], ...extra }],
});
const kinds = (json) => validate(json).warnings.map((w) => w.kind);

describe('validate (v3 tree)', () => {
  it('fatal structure errors', () => {
    expect(validate({}).fatal[0].path).toBe('datacenters');
    expect(validate({ datacenters: [{ id: 'a', floors: [] }] }).fatal[0].path).toBe('datacenters[0].floors');
    expect(validate({ datacenters: [{ id: 'a', floors: [{ id: '1F', racks: [] }] }] }).fatal[0].path).toBe('datacenters[0].floors[0].level');
    const dupRack = tree([{ id: 'R', floorspaces: ['3A0101'], servers: [] }, { id: 'R', floorspaces: ['3A0102'], servers: [] }]);
    expect(validate(dupRack).fatal[0].message).toMatch(/duplicate rack id/);
    const dupDev = tree([{ id: 'R', floorspaces: ['3A0101'], servers: [dev('x', '1U (1-1)'), dev('x', '1U (2-2)')] }]);
    expect(validate(dupDev).fatal[0].message).toMatch(/duplicate device id/);
  });
  it('a clean tree has no issues', () => {
    expect(validate(tree([{ id: 'R', floorspaces: ['3A0101', '3A0102'], servers: [dev('a', '3U (29-31)'), dev('b', '2U (31-32)')] }]))).toEqual({
      fatal: [],
      warnings: [],
      info: { invalidPositions: 0 },
    });
  });
  it('mount violations are warnings with a target, not exclusions', () => {
    const json = tree([{ id: 'R', floorspaces: ['3A0101'], servers: [dev('a', '1U (29-29)'), dev('b', '1U (29-29)')] }]);
    const { warnings, fatal } = validate(json);
    expect(fatal).toEqual([]);
    expect(warnings.map((w) => w.kind)).toEqual(['mount-overlap']);
    expect(warnings[0].target).toEqual({ dc: '가산IDC', rack: 'R', server: 'a' });
    const n = normalize(json);
    const rack = n.datacenters[0].floors[0].racks[0];
    expect(rack.servers.map((s) => Boolean(s.violation))).toEqual([true, true]);
    expect(rack.violation).toHaveLength(1);
  });
  it('containment and 2U overlaps are violations', () => {
    expect(kinds(tree([{ id: 'R', floorspaces: ['3A0101'], servers: [dev('a', '3U (29-31)'), dev('b', '1U (31-31)')] }]))).toEqual(['mount-overlap']);
    expect(kinds(tree([{ id: 'R', floorspaces: ['3A0101'], servers: [dev('a', '3U (10-12)'), dev('b', '3U (11-13)')] }]))).toEqual(['mount-overlap']);
  });
  it('cell conflicts flag both racks and keep both', () => {
    const json = tree([
      { id: 'A', floorspaces: ['3A0101', '3A0102'], servers: [] },
      { id: 'B', floorspaces: ['3A0102'], servers: [] },
    ]);
    expect(kinds(json)).toEqual(['rack-cell-conflict']);
    const racks = normalize(json).datacenters[0].floors[0].racks;
    expect(racks.map((r) => r.id)).toEqual(['A', 'B']);
    expect(racks.every((r) => r.violation)).toBe(true);
  });
  it('bad positions: warning + device kept as invalid (not mounted)', () => {
    const json = tree([{ id: 'R', floorspaces: ['3A0101'], servers: [dev('a', '2U (5-7)'), dev('b', 'abc'), dev('c', '1U (1-1)')] }]);
    const v = validate(json);
    expect(v.warnings.map((w) => w.kind)).toEqual(['position-invalid', 'position-invalid']);
    expect(v.info.invalidPositions).toBe(2);
    const s = normalize(json).datacenters[0].floors[0].racks[0].servers;
    expect(s.map((x) => Boolean(x.invalid))).toEqual([true, true, false]);
    expect(s[2]).toMatchObject({ unit: 1, height_u: 1 });
  });
  it('unparsable floorspace: rack cannot be placed → warning, excluded from the view', () => {
    const json = tree([{ id: 'R', floorspaces: ['XX'], servers: [] }, { id: 'S', floorspaces: ['3A0101'], servers: [] }]);
    expect(kinds(json)).toEqual(['floorspace-invalid']);
    expect(normalize(json).datacenters[0].floors[0].racks.map((r) => r.id)).toEqual(['S']);
  });
  it('floorspace floor digit must match the floor level', () => {
    expect(kinds(tree([{ id: 'R', floorspaces: ['2A0101'], servers: [] }]))).toEqual(['floorspace-floor-mismatch']);
  });
});

describe('normalize', () => {
  const json = tree([
    { id: 'R1', floorspaces: ['3A0201', '3A0202', '3A0203'], servers: [dev('a', '3U (29-31)'), dev('b', '2U (31-32)')] },
    { id: 'R2', floorspaces: ['3B0105'], servers: [] },
  ]);
  const n = normalize(json);
  const f = n.datacenters[0].floors[0];
  it('derives the zone grid (zones side by side with a gap) and rack placement', () => {
    expect(f.zones).toEqual([
      { id: 'A', colOffset: 0, rows: 2, cols: 3 },
      { id: 'B', colOffset: 5, rows: 1, cols: 5 },
    ]);
    expect([f.rows, f.cols]).toEqual([2, 10]);
    expect(f.racks[0]).toMatchObject({ zone: 'A', row: 2, col: 1, span: 3, total_u: 42, name: 'R1' });
    expect(f.racks[1]).toMatchObject({ zone: 'B', row: 1, col: 10, span: 1 });
    expect(f.racks[0].servers[1]).toMatchObject({ unit: 31, height_u: 2, device_position: '2U (31-32)' });
  });
  it('does not mutate its input; toStored drops every derived field', () => {
    const copy = structuredClone(json);
    normalize(json);
    expect(json).toEqual(copy);
    const stored = toStored(n);
    const keys = JSON.stringify(stored).match(/"(zones|rows|cols|zone|row|col|span|unit|height_u|invalid|violation|src)"/g);
    expect(keys).toBeNull();
    expect(stored.datacenters[0].floors[0].racks[0]).toMatchObject({ id: 'R1', name: 'R1', total_u: 42, floorspaces: ['3A0201', '3A0202', '3A0203'] });
    expect(normalize(stored)).toEqual(n);
  });
});

describe('generated sample', () => {
  const records = generate();
  const { json, warnings } = recordsToDataset(records);
  const r = checkDataset(json);
  it('is valid with zero warnings (unknown builds included)', () => {
    expect(warnings).toEqual([]);
    expect(r.fatal).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
  it('has the three IDCs, multi-cell racks, shared U boundaries and empty racks', () => {
    expect(r.data.datacenters.map((d) => d.id)).toEqual(['가산IDC', '영등포IDC', '파주IDC']);
    const racks = r.data.datacenters.flatMap((d) => d.floors.flatMap((f) => f.racks));
    expect(racks.some((x) => x.span >= 2)).toBe(true);
    expect(racks.some((x) => x.span === 5)).toBe(true);
    expect(racks.some((x) => x.servers.length === 0)).toBe(true);
    const shared = racks.some((x) => x.servers.some((a) => x.servers.some((b) => a !== b && a.unit + a.height_u - 1 === b.unit)));
    expect(shared).toBe(true);
  });
  it('is deterministic', () => {
    expect(JSON.stringify(generate())).toBe(JSON.stringify(records));
  });
});
