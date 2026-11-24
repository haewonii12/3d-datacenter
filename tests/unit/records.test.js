import { describe, it, expect } from 'vitest';
import { parsePosition, recordsToDataset, datasetToRecords, formatPosition } from '../../src/data/records.js';

const rec = (o) => ({ build_name: '가산IDC', company: '해원회사', ...o });

describe('parsePosition', () => {
  it('parses h U (s-e)', () => {
    expect(parsePosition('3U (29-31)')).toEqual({ h: 3, s: 29, e: 31 });
    expect(parsePosition('1U (39-39)')).toEqual({ h: 1, s: 39, e: 39 });
    expect(parsePosition(' 2u(31 - 32) ')).toEqual({ h: 2, s: 31, e: 32 });
  });
  it('rejects mismatched height, garbage, out of range', () => {
    expect(parsePosition('2U (5-7)')).toHaveProperty('error');
    expect(parsePosition('abc')).toHaveProperty('error');
    expect(parsePosition('1U (43-43)')).toHaveProperty('error');
    expect(parsePosition('1U (0-0)')).toHaveProperty('error');
  });
  it('formats', () => expect(formatPosition(29, 31)).toBe('3U (29-31)'));
});

describe('recordsToDataset', () => {
  const records = [
    rec({ floorspace_name: '3A0401,3A0402', rack_name: 'RI1', device_position: '3U (29-31)', device_name: 'web-01' }),
    rec({ floorspace_name: '3A0401,3A0402', rack_name: 'RI1', device_position: '2U (31-32)', device_name: 'web-02' }),
    rec({ floorspace_name: '3B0101', rack_name: 'RI2', device_position: '', device_name: '' }),
    rec({ floorspace_name: '1A0101', rack_name: 'RI3', device_position: '1U (1-1)', device_name: 'db' }),
    rec({ build_name: '파주IDC', floorspace_name: '2A0101', rack_name: 'RI1', device_position: '1U (1-1)', device_name: 'x' }),
  ];
  const { json, warnings } = recordsToDataset(records);

  it('groups build → floor → racks → servers', () => {
    expect(json.version).toBe(3);
    expect(json.datacenters.map((d) => d.id)).toEqual(['가산IDC', '파주IDC']);
    const g = json.datacenters[0];
    expect(g.floors.map((f) => f.id)).toEqual(['1F', '3F']);
    const f3 = g.floors[1];
    expect(f3.racks.map((r) => r.id)).toEqual(['RI1', 'RI2']);
    expect(f3.racks[0].floorspaces).toEqual(['3A0401', '3A0402']);
    expect(f3.racks[0].servers.map((s) => s.id)).toEqual(['RI1:29-31:0', 'RI1:31-32:0']);
    expect(f3.racks[0].servers[0]).toMatchObject({ device_name: 'web-01', company: '해원회사', device_position: '3U (29-31)', src: { row: 1 } });
    expect(f3.racks[1].servers).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('synthesizes unique ids for duplicate ranges', () => {
    const { json: j } = recordsToDataset([
      rec({ floorspace_name: '1A0101', rack_name: 'R', device_position: '1U (5-5)', device_name: 'a' }),
      rec({ floorspace_name: '1A0101', rack_name: 'R', device_position: '1U (5-5)', device_name: 'a' }),
    ]);
    expect(j.datacenters[0].floors[0].racks[0].servers.map((s) => s.id)).toEqual(['R:5-5:0', 'R:5-5:1']);
  });

  it('warns on floorspace mismatch (first value wins) and invalid floorspace; bad positions are left to the schema', () => {
    const { json: j, warnings: w } = recordsToDataset([
      rec({ floorspace_name: '1A0101', rack_name: 'R', device_position: '1U (1-1)', device_name: 'a' }),
      rec({ floorspace_name: '1A0102', rack_name: 'R', device_position: 'abc', device_name: 'b' }),
      rec({ floorspace_name: 'zzz', rack_name: 'Q', device_position: '1U (1-1)', device_name: 'c' }),
    ]);
    expect(w.map((x) => [x.kind, x.row])).toEqual([
      ['rack-floorspace-mismatch', 2],
      ['floorspace-invalid', 3],
    ]);
    const rack = j.datacenters[0].floors[0].racks[0];
    expect(rack.floorspaces).toEqual(['1A0101']);
    expect(rack.servers[1].id).toBe('R:invalid:0');
  });

  it('honours rowOf for CSV rows', () => {
    const { warnings: w } = recordsToDataset([rec({ floorspace_name: 'x', rack_name: 'R' })], { rowOf: (i) => i + 2 });
    expect(w[0].row).toBe(2);
  });

  it('fatal when nothing is usable', () => {
    expect(recordsToDataset([]).json).toBeNull();
    expect(recordsToDataset([{ rack_name: 'R' }]).json).toBeNull();
  });

  it('round-trips through datasetToRecords', () => {
    const back = recordsToDataset(datasetToRecords(json)).json;
    const strip = (d) => JSON.parse(JSON.stringify(d, (k, v) => (k === 'src' ? undefined : v)));
    expect(strip(back)).toEqual(strip(json));
  });
});
