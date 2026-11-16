import { it, expect } from 'vitest';
import { buildIndex, search } from '../../src/domain/search.js';

const data = { datacenters: [
  { id: 'A', name: '서울', floors: [{ id: '1F', racks: [{ id: 'RA', servers: [
    { id: 's1', hostname: 'web-01', services: [{ name: 'payment-api' }, { name: 'cache' }] },
    { id: 's2', hostname: 'db-01', services: [{ name: 'Payment-DB' }] },
    { id: 's3', hostname: 'payment-gw', services: [{ name: 'payment-proxy' }] },
  ] }] }] },
  { id: 'B', name: '부산', floors: [{ id: '1F', racks: [{ id: 'RA', servers: [
    { id: 's1', hostname: 'web-pus-01', services: [{ name: 'sms-gateway' }] },
  ] }] }] },
] };
const idx = buildIndex(data);

it('buildIndex entries span every DC and carry dcId', () => {
  expect(idx[0]).toEqual({ dcId: 'A', dcName: '서울', floorId: '1F', rackId: 'RA', serverId: 's1', hostname: 'web-01', services: ['payment-api', 'cache'] });
  expect(idx.length).toBe(4);
  expect(idx[3]).toMatchObject({ dcId: 'B', serverId: 's1', hostname: 'web-pus-01' });
});
it('hostname match', () => {
  expect(search(idx, 'DB-0', 20, 'A')).toEqual([{ type: 'hostname', dcId: 'A', floorId: '1F', rackId: 'RA', serverId: 's2', label: 'db-01', sub: 'RA' }]);
});
it('service match, case-insensitive', () => {
  const r = search(idx, 'CACHE', 20, 'A');
  expect(r).toEqual([{ type: 'service', dcId: 'A', floorId: '1F', rackId: 'RA', serverId: 's1', label: 'cache', sub: 'web-01' }]);
});
it('results from another DC show the DC name in sub', () => {
  expect(search(idx, 'web-pus', 20, 'A')).toEqual([{ type: 'hostname', dcId: 'B', floorId: '1F', rackId: 'RA', serverId: 's1', label: 'web-pus-01', sub: 'RA · 부산' }]);
  expect(search(idx, 'sms', 20, 'A')[0].sub).toBe('web-pus-01 · 부산');
  expect(search(idx, 'web-pus', 20, 'B')[0].sub).toBe('RA');
  expect(search(idx, 'web', 20, 'B').map((x) => x.sub)).toEqual(['RA · 서울', 'RA']);
});
it('dedupes server matching both as hostname', () => {
  const r = search(idx, 'payment', 20, 'A');
  expect(r.filter((x) => x.serverId === 's3')).toEqual([expect.objectContaining({ type: 'hostname' })]);
  expect(r.map((x) => x.serverId)).toEqual(['s1', 's2', 's3']);
});
it('limit and empty query', () => {
  expect(search(idx, 'payment', 2).length).toBe(2);
  expect(search(idx, '')).toEqual([]);
  expect(search(idx, '   ')).toEqual([]);
});
