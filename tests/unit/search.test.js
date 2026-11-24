import { it, expect } from 'vitest';
import { buildIndex, search } from '../../src/domain/search.js';

const dev = (id, device_name, company) => ({ id, device_name, company });
const data = { datacenters: [
  { id: '가산IDC', name: '가산IDC', floors: [{ id: '3F', racks: [
    { id: 'RI1', name: 'RI20261120', floorspaces: ['3A0401'], servers: [dev('d1', 'web-01', '해원회사'), dev('d2', 'db-01', '해원회사'), dev('d3', 'payment-gw', '누리텍')] },
    { id: 'RI2', name: 'RI20261121', floorspaces: ['3A0402', '3A0403'], servers: [] },
  ] }] },
  { id: '파주IDC', name: '파주IDC', floors: [{ id: '2F', racks: [
    { id: 'RI1', name: 'RI20261120', floorspaces: ['2B0305'], servers: [dev('d1', 'web-pj-01', '다온시스템')] },
  ] }] },
] };
const idx = buildIndex(data);

it('buildIndex: one entry per device plus one per empty rack, across DCs', () => {
  expect(idx).toHaveLength(5);
  expect(idx[0]).toEqual({ dcId: '가산IDC', dcName: '가산IDC', floorId: '3F', rackId: 'RI1', rackName: 'RI20261120', cells: '3A0401', serverId: 'd1', deviceName: 'web-01', company: '해원회사' });
  expect(idx[3]).toMatchObject({ rackId: 'RI2', serverId: null, cells: '3A0402,3A0403' });
});
it('device name match (case-insensitive)', () => {
  expect(search(idx, 'DB-0', 20, '가산IDC')).toEqual([
    { type: 'device', dcId: '가산IDC', floorId: '3F', rackId: 'RI1', serverId: 'd2', label: 'db-01', sub: 'RI20261120 · 3A0401' },
  ]);
});
it('rack name match is reported once per rack (also for empty racks)', () => {
  const r = search(idx, 'ri2026112', 20, '가산IDC');
  expect(r.map((x) => [x.type, x.dcId, x.rackId, x.serverId])).toEqual([
    ['rack', '가산IDC', 'RI1', null],
    ['rack', '가산IDC', 'RI2', null],
    ['rack', '파주IDC', 'RI1', null],
  ]);
  expect(r[2].sub).toBe('2B0305 · 파주IDC');
});
it('company match', () => {
  const r = search(idx, '누리', 20, '가산IDC');
  expect(r).toEqual([{ type: 'company', dcId: '가산IDC', floorId: '3F', rackId: 'RI1', serverId: 'd3', label: '누리텍', sub: 'payment-gw · RI20261120' }]);
});
it('results from another DC show the DC name', () => {
  expect(search(idx, 'web-pj', 20, '가산IDC')[0].sub).toBe('RI20261120 · 2B0305 · 파주IDC');
  expect(search(idx, 'web-pj', 20, '파주IDC')[0].sub).toBe('RI20261120 · 2B0305');
});
it('limit and empty query', () => {
  expect(search(idx, 'e', 2)).toHaveLength(2);
  expect(search(idx, '')).toEqual([]);
  expect(search(idx, '   ')).toEqual([]);
});
