import { describe, it, expect } from 'vitest';
import {
  EditError, addFloor, addDc, deleteFloor, deleteDc, countUnder, nextFloorDefaults, updateServer, addServer, deleteServer, addRack, deleteRack, renameDc, toPlain, defaultRackId, firstEmptySlot,
} from '../../src/data/edit.js';
import { validate, normalize } from '../../src/data/schema.js';

const dev = (id, device_position, device_name = id) => ({ id, device_name, company: '해원회사', device_position });
const base = () => normalize({ version: 3, datacenters: [
  { id: '가산IDC', name: '가산IDC', floors: [{ id: '3F', level: 3, racks: [
    { id: 'RA', floorspaces: ['3A0101', '3A0102'], servers: [dev('RA:29-31:0', '3U (29-31)', 'web'), dev('RA:10-10:0', '1U (10-10)', 'db')] },
    { id: 'RB', floorspaces: ['3A0104'], servers: [] },
  ] }] },
  { id: '파주IDC', name: '파주IDC', floors: [{ id: '2F', level: 2, racks: [{ id: 'RA', floorspaces: ['2A0101'], servers: [] }] }] },
] });
const rackOf = (d, id, dc = '가산IDC') => d.datacenters.find((x) => x.id === dc).floors.flatMap((f) => f.racks).find((r) => r.id === id);
const err = (fn, re) => {
  expect(fn).toThrow(EditError);
  expect(fn).toThrow(re);
};
const check = (d) => validate(toPlain(d));

describe('edit ops', () => {
  it('never mutate the input; the result stays valid', () => {
    const d = base();
    const snap = JSON.stringify(d);
    const out = updateServer(d, '가산IDC', 'RA:10-10:0', { device_name: 'db2', company: '누리텍', device_position: '2u(11-12)' });
    expect(JSON.stringify(d)).toBe(snap);
    expect(rackOf(out, 'RA').servers[1]).toMatchObject({ device_name: 'db2', company: '누리텍', device_position: '2U (11-12)' });
    expect(check(out)).toMatchObject({ fatal: [], warnings: [] });
  });
  it('updateServer refuses unplaceable positions, but saves overlaps (they become warnings)', () => {
    const d = base();
    err(() => updateServer(d, '가산IDC', 'RA:10-10:0', { device_position: 'abc' }), /형식/);
    err(() => updateServer(d, '가산IDC', 'RA:10-10:0', { device_position: '2U (5-7)' }), /높이/);
    err(() => updateServer(d, '가산IDC', 'RA:10-10:0', { device_position: '1U (43-43)' }), /범위/);
    err(() => updateServer(d, '가산IDC', 'RA:10-10:0', { device_name: ' ' }), /장비 이름/);
    err(() => updateServer(d, '가산IDC', 'nope', {}), /없습니다/);
    const overlap = updateServer(d, '가산IDC', 'RA:10-10:0', { device_position: '1U (30-30)' });
    expect(check(overlap).warnings.map((w) => w.kind)).toEqual(['mount-overlap']);
  });
  it('addServer: id per the record rule; boundary share allowed', () => {
    const { data, serverId } = addServer(base(), '가산IDC', 'RA', { device_name: 'cache', company: '', device_position: '2U (31-32)' });
    expect(serverId).toBe('RA:31-32:0');
    expect(check(data)).toMatchObject({ fatal: [], warnings: [] });
    const again = addServer(data, '가산IDC', 'RA', { device_name: 'x', device_position: '2U (31-32)' });
    expect(again.serverId).toBe('RA:31-32:1');
    expect(check(again.data).warnings.map((w) => w.kind)).toEqual(['mount-overlap', 'mount-crowded']); // 3 devices on U31
    err(() => addServer(base(), '가산IDC', 'RA', { device_name: 'x', device_position: '' }), /장착 위치/);
  });
  it('deleteServer / deleteRack', () => {
    const d = deleteServer(base(), '가산IDC', 'RA:29-31:0');
    expect(rackOf(d, 'RA').servers.map((s) => s.id)).toEqual(['RA:10-10:0']);
    expect(rackOf(deleteRack(base(), '가산IDC', 'RB'), 'RB')).toBeUndefined();
    err(() => deleteRack(base(), '가산IDC', 'nope'), /없습니다/);
  });
  it('addRack: floorspace codes on this floor, contiguous, never on a taken cell', () => {
    const d = base();
    const { data, rackId } = addRack(d, '가산IDC', '3F', { floorspaces: '3B0201, 3B0202', name: '' });
    expect(rackId).toBe('RI-3B0201');
    const r = rackOf(normalize(toPlain(data)), 'RI-3B0201');
    expect(r).toMatchObject({ floorspaces: ['3B0201', '3B0202'], span: 2, zone: 'B' });
    err(() => addRack(d, '가산IDC', '3F', { floorspaces: '3A0102' }), /이미 랙 RA/);
    err(() => addRack(d, '가산IDC', '3F', { floorspaces: '2A0105' }), /층 번호는 3/);
    err(() => addRack(d, '가산IDC', '3F', { floorspaces: '3A0105,3A0107' }), /연속/);
    err(() => addRack(d, '가산IDC', '3F', { floorspaces: 'zz' }), /형식/);
    err(() => addRack(d, '가산IDC', '3F', { floorspaces: '3A0201', name: 'RB' }), /이미 있습니다/);
    expect(defaultRackId(d.datacenters[0], '3A0104')).toBe('RI-3A0104');
  });
  it('firstEmptySlot: first free cell of the zones (gap columns are not cells)', () => {
    const f = base().datacenters[0].floors[0];
    expect(firstEmptySlot(f)).toEqual({ row: 1, col: 3, floorspace: '3A0103' });
  });
  it('floors and DCs', () => {
    const d = base();
    expect(nextFloorDefaults(d.datacenters[0])).toEqual({ id: '4F', level: 4 });
    const f = addFloor(d, '가산IDC', { level: '' });
    expect(f.floorId).toBe('4F');
    err(() => addFloor(d, '가산IDC', { level: 3 }), /이미 있습니다/);
    err(() => addFloor(d, '가산IDC', { level: 10 }), /1–9/);
    expect(check(f.data).fatal).toEqual([]);
    const n = addDc(d, { name: '의왕IDC', level: '' });
    expect(n.dcId).toBe('의왕IDC');
    expect(n.data.datacenters[2]).toMatchObject({ id: '의왕IDC', floors: [{ id: '1F', level: 1, racks: [] }] });
    err(() => addDc(d, { name: '가산IDC' }), /이미 있습니다/);
    err(() => deleteFloor(d, '파주IDC', '2F'), /하나 이상/);
    expect(deleteFloor(f.data, '가산IDC', '4F').datacenters[0].floors).toHaveLength(1);
    expect(deleteDc(d, '파주IDC').datacenters).toHaveLength(1);
    err(() => deleteDc(deleteDc(d, '파주IDC'), '가산IDC'), /하나뿐/);
    expect(renameDc(d, '가산IDC', '가산 IDC').datacenters[0].name).toBe('가산 IDC');
    expect(countUnder(d.datacenters[0])).toEqual({ floors: 1, racks: 2, servers: 2 });
  });
  it('toPlain = stored tree without derived/view fields', () => {
    const s = JSON.stringify(toPlain(base()));
    expect(s).not.toMatch(/"(zones|unit|height_u|span|violation|invalid)"/);
  });
});
