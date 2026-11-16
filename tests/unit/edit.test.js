import { describe, it, expect } from 'vitest';
import {
  EditError, addFloor, addDc, deleteFloor, deleteDc, countUnder, nextFloorDefaults, defaultDcId, updateServer, addServer, deleteServer, addRack, deleteRack, renameDc, toPlain, nextServerId, defaultRackId, firstEmptySlot,
} from '../../src/data/edit.js';
import { validate, normalize } from '../../src/data/schema.js';

const base = () => normalize({ version: 2, datacenters: [
  { id: 'd1', name: 'DC1', floors: [{ id: '1F', rows: 2, cols: 2, racks: [
    { id: 'RA', row: 1, col: 1, total_u: 42, servers: [
      { id: 'srv-00001', hostname: 'a', ip: '10.0.0.1', unit: 1, height_u: 2, services: [{ name: 'nginx', team: 'web', status: 'ok' }] },
      { id: 'srv-00007', hostname: 'b', ip: null, unit: 10, height_u: 1, services: [] },
    ] },
  ] }] },
  { id: 'd2', name: 'DC2', floors: [{ id: '1F', rows: 1, cols: 1, racks: [{ id: 'RA', row: 1, col: 1, servers: [{ id: 'srv-00001', hostname: 'a', unit: 1 }] }] }] },
] });
const rackA = (d, dc = 'd1') => d.datacenters.find((x) => x.id === dc).floors[0].racks.find((r) => r.id === 'RA');
const err = (fn, re) => {
  expect(fn).toThrow(EditError);
  expect(fn).toThrow(re);
};

describe('edit ops', () => {
  it('never mutate the input and keep the result valid', () => {
    const d = base();
    const snap = JSON.stringify(d);
    const out = updateServer(d, 'd1', 'srv-00001', { hostname: 'a2', unit: '3', height_u: '1' });
    expect(JSON.stringify(d)).toBe(snap);
    expect(rackA(out).servers[0]).toMatchObject({ hostname: 'a2', unit: 3, height_u: 1 });
    expect(validate(out)).toMatchObject({ fatal: [], warnings: [] });
  });
  it('updateServer: overlap, range, hostname rules (ids/hostnames scoped to the DC)', () => {
    const d = base();
    err(() => updateServer(d, 'd1', 'srv-00001', { unit: 9, height_u: 2 }), /겹칩니다/);
    err(() => updateServer(d, 'd1', 'srv-00001', { unit: 42, height_u: 2 }), /범위\(1–42\)/);
    err(() => updateServer(d, 'd1', 'srv-00001', { unit: 0 }), /1 이상의 정수/);
    err(() => updateServer(d, 'd1', 'srv-00001', { unit: '2.5' }), /정수/);
    err(() => updateServer(d, 'd1', 'srv-00001', { hostname: '  ' }), /호스트명/);
    err(() => updateServer(d, 'd1', 'srv-00001', { hostname: 'b' }), /이미 있습니다/);
    err(() => updateServer(d, 'd1', 'nope', {}), /없습니다/);
    // same height range as itself is fine; another DC's hostname "a" does not clash
    expect(rackA(updateServer(d, 'd1', 'srv-00001', { unit: 1, height_u: 2 })).servers[0].unit).toBe(1);
    expect(rackA(updateServer(d, 'd2', 'srv-00001', { hostname: 'b' }), 'd2').servers[0].hostname).toBe('b');
  });
  it('updateServer: services are cleaned (trimmed, team optional, bad status → unknown)', () => {
    const out = updateServer(base(), 'd1', 'srv-00001', {
      ip: ' ',
      services: [{ name: ' api ', team: '', status: 'down' }, { name: 'x', team: 't', status: 'weird' }],
    });
    const s = rackA(out).servers[0];
    expect(s.ip).toBe(null);
    expect(s.services).toEqual([{ name: 'api', team: null, status: 'down' }, { name: 'x', team: 't', status: 'unknown' }]);
    err(() => updateServer(base(), 'd1', 'srv-00001', { services: [{ name: '', team: 't' }] }), /서비스 1 이름/);
  });
  it('updateServer clears a stale invalid flag', () => {
    const d = base();
    rackA(d).servers[0].invalid = true;
    expect(rackA(updateServer(d, 'd1', 'srv-00001', {})).servers[0].invalid).toBeUndefined();
  });
  it('addServer: next srv id in the DC, sorted by unit, U checks', () => {
    const d = base();
    expect(nextServerId(d.datacenters[0])).toBe('srv-00008');
    const { data, serverId } = addServer(d, 'd1', 'RA', { hostname: 'c', unit: '5', height_u: '3', ip: '10.0.0.3' });
    expect(serverId).toBe('srv-00008');
    expect(rackA(data).servers.map((s) => s.unit)).toEqual([1, 5, 10]);
    expect(rackA(data).servers[1]).toEqual({ id: 'srv-00008', hostname: 'c', ip: '10.0.0.3', unit: 5, height_u: 3, services: [] });
    err(() => addServer(d, 'd1', 'RA', { hostname: 'c', unit: 2 }), /겹칩니다/);
    err(() => addServer(d, 'd1', 'RA', { hostname: 'a', unit: 20 }), /이미 있습니다/);
    err(() => addServer(d, 'd1', 'RX', { hostname: 'c', unit: 20 }), /랙 "RX"/);
  });
  it('deleteServer / deleteRack', () => {
    expect(rackA(deleteServer(base(), 'd1', 'srv-00007')).servers.map((s) => s.id)).toEqual(['srv-00001']);
    const out = deleteRack(base(), 'd1', 'RA');
    expect(out.datacenters[0].floors[0].racks).toEqual([]);
    expect(out.datacenters[1].floors[0].racks).toHaveLength(1); // same id in the other DC untouched
    err(() => deleteRack(base(), 'd1', 'RZ'), /없습니다/);
  });
  it('addRack: slot checks, default id pattern, explicit id uniqueness', () => {
    const d = base();
    const { data, rackId } = addRack(d, 'd1', '1F', { row: 2, col: 1 });
    expect(rackId).toBe('R-1F-02-01');
    expect(data.datacenters[0].floors[0].racks.map((r) => r.id)).toEqual(['RA', 'R-1F-02-01']);
    expect(data.datacenters[0].floors[0].racks[1]).toEqual({ id: 'R-1F-02-01', row: 2, col: 1, total_u: 42, servers: [] });
    err(() => addRack(d, 'd1', '1F', { row: 1, col: 1 }), /이미 랙이 있습니다/);
    err(() => addRack(d, 'd1', '1F', { row: 3, col: 1 }), /그리드\(2×2\) 밖/);
    err(() => addRack(d, 'd1', '1F', { row: 1, col: 2, id: 'RA' }), /이미 있습니다/);
    err(() => addRack(d, 'd1', '9F', { row: 1, col: 2 }), /층 "9F"/);
    expect(addRack(d, 'd1', '1F', { row: 1, col: 2, id: ' R-x ' }).rackId).toBe('R-x');
  });
  it('defaultRackId suffixes a taken id; firstEmptySlot is row-major', () => {
    const d = base();
    d.datacenters[0].floors[0].racks[0].id = 'R-1F-01-02';
    expect(defaultRackId(d.datacenters[0], '1F', 1, 2)).toBe('R-1F-01-02-2');
    expect(firstEmptySlot(base().datacenters[0].floors[0])).toEqual({ row: 1, col: 2 });
    expect(firstEmptySlot(base().datacenters[1].floors[0])).toBe(null);
  });
  it('renameDc requires a name', () => {
    expect(renameDc(base(), 'd2', ' 부산 ').datacenters[1].name).toBe('부산');
    err(() => renameDc(base(), 'd2', ''), /이름/);
    err(() => renameDc(base(), 'zz', 'x'), /데이터센터 "zz"/);
  });
  it('toPlain drops invalid flags only', () => {
    const d = base();
    rackA(d).servers[0].invalid = true;
    const p = toPlain(d);
    expect(rackA(p).servers[0].invalid).toBeUndefined();
    expect(rackA(p).servers[0].hostname).toBe('a');
  });
});

describe('normalize re-derives invalid', () => {
  it('a fixed server loses its flag after re-normalizing', () => {
    const d = base();
    rackA(d).servers[0].invalid = true;
    expect(rackA(normalize(d)).servers[0].invalid).toBeUndefined();
  });
});

describe('add floor / datacenter', () => {
  it('nextFloorDefaults: level above the top, `{level}F`, top floor grid', () => {
    const d = base();
    expect(nextFloorDefaults(d.datacenters[0])).toEqual({ id: '2F', level: 2, rows: 2, cols: 2 });
    d.datacenters[0].floors[0].level = 3;
    d.datacenters[0].floors[0].id = '4F';
    expect(nextFloorDefaults(d.datacenters[0])).toEqual({ id: '4F-2', level: 4, rows: 2, cols: 2 });
  });
  it('addFloor: defaults, explicit level/id, uniqueness and grid limits', () => {
    const d = base();
    const a = addFloor(d, 'd1', { rows: '3', cols: '4' });
    expect(a.floorId).toBe('2F');
    expect(a.data.datacenters[0].floors[1]).toEqual({ id: '2F', level: 2, rows: 3, cols: 4, racks: [] });
    expect(validate(a.data)).toMatchObject({ fatal: [], warnings: [] });
    const b = addFloor(d, 'd1', { level: '-1', rows: 2, cols: 2 });
    expect(b.floorId).toBe('-1F');
    expect(addFloor(d, 'd1', { id: 'B1', level: 0, rows: 2, cols: 2 }).floorId).toBe('B1');
    expect(d.datacenters[0].floors).toHaveLength(1); // input untouched
    err(() => addFloor(d, 'd1', { id: '1F', rows: 2, cols: 2 }), /층 ID "1F"/);
    err(() => addFloor(d, 'd1', { level: 1, rows: 2, cols: 2 }), /레벨 1 층이 이미/);
    err(() => addFloor(d, 'd1', { level: '1.5', rows: 2, cols: 2 }), /정수/);
    err(() => addFloor(d, 'd1', { rows: 0, cols: 2 }), /Row 수/);
    err(() => addFloor(d, 'd1', { rows: 2, cols: 61 }), /60 이하/);
  });
  it('addDc: new DC with an empty first floor, valid; id default and uniqueness', () => {
    const d = base();
    expect(defaultDcId(d)).toBe('dc-3');
    const { data, dcId } = addDc(d, { name: ' 광주 DC4 ', rows: 5, cols: 8 });
    expect(dcId).toBe('dc-3');
    expect(data.datacenters[2]).toEqual({ id: 'dc-3', name: '광주 DC4', floors: [{ id: '1F', level: 1, rows: 5, cols: 8, racks: [] }] });
    expect(validate(data)).toMatchObject({ fatal: [], warnings: [] });
    expect(addDc(d, { id: 'gj', name: 'x', floorId: 'G', rows: 1, cols: 1 }).data.datacenters[2].floors[0].id).toBe('G');
    err(() => addDc(d, { id: 'd1', name: 'x', rows: 1, cols: 1 }), /"d1"이\(가\) 이미/);
    err(() => addDc(d, { name: '', rows: 1, cols: 1 }), /이름/);
    err(() => addDc(d, { name: 'x', rows: 1, cols: 'a' }), /Col 수/);
  });
});

describe('delete floor / datacenter', () => {
  it('deleteFloor removes it with its racks; last floor is protected', () => {
    const two = addFloor(base(), 'd1', { rows: 1, cols: 1 }).data;
    const out = deleteFloor(two, 'd1', '1F');
    expect(out.datacenters[0].floors.map((f) => f.id)).toEqual(['2F']);
    expect(out.datacenters[1].floors.map((f) => f.id)).toEqual(['1F']); // same id in d2 untouched
    expect(validate(out).fatal).toEqual([]);
    expect(two.datacenters[0].floors).toHaveLength(2);
    err(() => deleteFloor(base(), 'd1', '1F'), /하나 이상/);
    err(() => deleteFloor(two, 'd1', '9F'), /층 "9F"/);
  });
  it('deleteDc removes it; the last DC is protected', () => {
    const out = deleteDc(base(), 'd1');
    expect(out.datacenters.map((d) => d.id)).toEqual(['d2']);
    expect(validate(out).fatal).toEqual([]);
    err(() => deleteDc(out, 'd2'), /하나뿐/);
    err(() => deleteDc(base(), 'zz'), /데이터센터 "zz"/);
  });
  it('countUnder counts a DC or a floor', () => {
    expect(countUnder(base().datacenters[0])).toEqual({ floors: 1, racks: 1, servers: 2 });
    expect(countUnder(base().datacenters[0].floors[0])).toEqual({ floors: 1, racks: 1, servers: 2 });
  });
});
