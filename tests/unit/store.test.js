import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore, bindHash } from '../../src/state/store.js';
import { parse } from '../../src/state/hash.js';

const mk = (id, n) => Array.from({ length: n }, (_, i) => ({ id: `${id}-s${i}`, hostname: 'h', unit: 1 + i, height_u: 1, services: [] }));
const floors = () => [
  { id: '1F', rows: 1, cols: 2, racks: [{ id: 'RA', row: 1, col: 1, total_u: 42, servers: mk('RA', 2) }] },
  { id: '2F', rows: 1, cols: 2, racks: [{ id: 'RB', row: 1, col: 1, total_u: 42, servers: mk('RB', 2) }] },
];
// Two DCs with the same floor/rack/server ids; only d2 has 3F/RC.
const data = { datacenters: [
  { id: 'd1', name: 'DC1', floors: floors() },
  { id: 'd2', name: 'DC2', floors: [...floors(), { id: '3F', rows: 1, cols: 1, racks: [{ id: 'RC', row: 1, col: 1, total_u: 42, servers: mk('RC', 1) }] }] },
] };

let loc, hist, store;
beforeEach(() => {
  loc = { hash: '' };
  hist = { replaceState: vi.fn((s, t, url) => { loc.hash = url; }) };
  store = createStore({ data, location: loc, history: hist });
});
const at = (o) => ({ dc: 'd1', floor: null, rack: null, server: null, ...o });
const full = at({ floor: '2F', rack: 'RB', server: 'RB-s1' });

describe('store', () => {
  it('navigate writes hash only; apply mutates', () => {
    store.navigate({ floor: '2F' });
    expect(loc.hash).toBe('#dc=d1&floor=2F');
    expect(store.state).toEqual({ dc: null, floor: null, rack: null, server: null });
    store.apply(parse(loc.hash));
    expect(store.state).toEqual(at({ floor: '2F' }));
    expect(hist.replaceState).not.toHaveBeenCalled();
  });
  it('mode derivation (dc does not change the mode)', () => {
    store.apply({ dc: 'd1' });
    expect(store.mode()).toBe('overview');
    store.apply({ dc: 'd1', floor: '2F' });
    expect(store.mode()).toBe('floor');
    store.apply({ dc: 'd1', rack: 'RB' });
    expect(store.mode()).toBe('rack');
    store.apply(full);
    expect(store.mode()).toBe('server');
    store.apply({ dc: 'd2' });
    expect(store.mode()).toBe('overview');
  });
  it('openRack from overview sets floor', () => {
    store.apply({ dc: 'd1' });
    store.openRack('RB');
    expect(loc.hash).toBe('#dc=d1&floor=2F&rack=RB');
  });
  it('server-only hash resolves full chain and canonicalizes', () => {
    store.apply({ dc: 'd1', server: 'RB-s1' });
    expect(store.state).toEqual(full);
    expect(hist.replaceState).toHaveBeenCalledTimes(1);
  });
  it('wrong floor with valid rack is corrected', () => {
    store.apply({ dc: 'd1', floor: '1F', rack: 'RB', server: null });
    expect(store.state).toEqual(at({ floor: '2F', rack: 'RB' }));
  });
  it('invalid ids fall back to nearest ancestor with replaceState', () => {
    store.apply({ dc: 'd1', floor: '2F', rack: 'RB', server: 'nope' });
    expect(store.state).toEqual(at({ floor: '2F', rack: 'RB' }));
    expect(hist.replaceState).toHaveBeenLastCalledWith(null, '', '#dc=d1&floor=2F&rack=RB');
    store.apply({ dc: 'd1', floor: '2F', rack: 'nope', server: null });
    expect(store.state).toEqual(at({ floor: '2F' }));
    store.apply({ dc: 'd1', floor: 'nope', rack: null, server: null });
    expect(store.state).toEqual(at());
    expect(loc.hash).toBe('#dc=d1');
    expect(hist.replaceState).toHaveBeenCalledTimes(3);
  });
  it('no dc → first DC, legacy floor/rack/server kept (replaceState then apply)', () => {
    const fn = vi.fn();
    store.subscribe(fn);
    store.apply(parse('#floor=2F&rack=RB'));
    expect(store.state).toEqual(at({ floor: '2F', rack: 'RB' }));
    expect(hist.replaceState).toHaveBeenLastCalledWith(null, '', '#dc=d1&floor=2F&rack=RB');
    expect(fn).toHaveBeenCalledTimes(1);
    store.apply(parse(''));
    expect(store.state).toEqual(at());
    expect(loc.hash).toBe('#dc=d1');
  });
  it('unknown dc → first DC overview', () => {
    store.apply(parse('#dc=nope&floor=3F&rack=RC'));
    expect(store.state).toEqual(at());
    expect(hist.replaceState).toHaveBeenLastCalledWith(null, '', '#dc=d1');
  });
  it('lookups are scoped to the target DC', () => {
    store.apply({ dc: 'd1', rack: 'RC' }); // RC only exists in d2
    expect(store.state).toEqual(at());
    store.apply({ dc: 'd2', rack: 'RC' });
    expect(store.state).toEqual({ dc: 'd2', floor: '3F', rack: 'RC', server: null });
    expect(store.getRack('RC').floor.id).toBe('3F');
    expect(store.getRack('RC', 'd1')).toBeNull();
    expect(store.getRack('RA', 'd1').rack).not.toBe(store.getRack('RA', 'd2').rack);
    expect(store.getFloor('3F')).toBeTruthy();
    expect(store.getFloor('3F', 'd1')).toBeNull();
  });
  it('selectDc navigates to that DC overview; navigate keeps the current DC', () => {
    store.apply(full);
    store.selectDc('d2');
    expect(loc.hash).toBe('#dc=d2');
    store.apply(parse(loc.hash));
    expect(store.state).toEqual({ dc: 'd2', floor: null, rack: null, server: null });
    store.enterFloor('3F');
    expect(loc.hash).toBe('#dc=d2&floor=3F');
    store.navigate({ dc: 'd1', server: 'RA-s0' });
    expect(loc.hash).toBe('#dc=d1&floor=1F&rack=RA&server=RA-s0');
  });
  it('up() chain stays in the DC; no-op at overview', () => {
    store.apply({ ...full, dc: 'd2' });
    const step = () => { store.up(); store.apply(parse(loc.hash)); return { ...store.state }; };
    expect(step()).toEqual({ dc: 'd2', floor: '2F', rack: 'RB', server: null });
    expect(step()).toEqual({ dc: 'd2', floor: '2F', rack: null, server: null });
    expect(step()).toEqual({ dc: 'd2', floor: null, rack: null, server: null });
    loc.hash = 'unchanged';
    store.up();
    expect(loc.hash).toBe('unchanged');
  });
  it('goLevel (root = current DC overview)', () => {
    store.apply({ ...full, dc: 'd2' });
    store.goLevel('root');
    expect(loc.hash).toBe('#dc=d2');
    store.goLevel('floor');
    expect(loc.hash).toBe('#dc=d2&floor=2F');
    store.goLevel('rack');
    expect(loc.hash).toBe('#dc=d2&floor=2F&rack=RB');
    store.goLevel('server');
    expect(loc.hash).toBe('#dc=d2&floor=2F&rack=RB&server=RB-s1');
  });
  it('subscribers get prev/next; no notify when unchanged', () => {
    const fn = vi.fn();
    const off = store.subscribe(fn);
    store.apply({ dc: 'd1', floor: '1F' });
    expect(fn).toHaveBeenCalledWith({ dc: null, floor: null, rack: null, server: null }, at({ floor: '1F' }));
    store.apply({ dc: 'd1', floor: '1F' });
    expect(fn).toHaveBeenCalledTimes(1);
    store.apply({ dc: 'd2', floor: '1F' });
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    store.apply({});
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('lookup helpers', () => {
    store.apply({ dc: 'd1' });
    expect(store.getDc().name).toBe('DC1');
    expect(store.getDc('d2').name).toBe('DC2');
    expect(store.getDc('x')).toBeNull();
    expect(store.datacenters.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(store.getFloor('1F').id).toBe('1F');
    expect(store.getRack('RB').floor.id).toBe('2F');
    expect(store.getServer('RB-s1')).toMatchObject({ rack: { id: 'RB' }, floor: { id: '2F' } });
    expect(store.getServer('x')).toBeNull();
  });
  it('bindHash applies initial hash and on hashchange', () => {
    const listeners = {};
    const win = { location: { hash: '#floor=1F' }, addEventListener: (n, f) => { listeners[n] = f; } };
    bindHash(store, win);
    expect(store.state).toEqual(at({ floor: '1F' }));
    win.location.hash = '#dc=d2&floor=2F&rack=RB';
    listeners.hashchange();
    expect(store.state).toEqual({ dc: 'd2', floor: '2F', rack: 'RB', server: null });
  });

  it('setData: re-resolves the state (deleted server → rack), bumps revision, always notifies', () => {
    store.apply(full);
    const fn = vi.fn();
    store.subscribe(fn);
    const next = structuredClone(data);
    next.datacenters[0].floors[1].racks[0].servers.pop(); // RB-s1 gone in d1
    const rev = store.revision;
    store.setData(next);
    expect(store.revision).toBe(rev + 1);
    expect(store.state).toEqual(at({ floor: '2F', rack: 'RB' }));
    expect(loc.hash).toBe('#dc=d1&floor=2F&rack=RB');
    expect(store.getServer('RB-s1')).toBe(null);
    expect(store.data).toBe(next);
    store.setData(next); // same state: still notified (the data behind it changed)
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('setData reset → first DC overview; unknown current dc handled', () => {
    store.apply({ dc: 'd2', floor: '3F' });
    store.setData(structuredClone(data), { reset: true });
    expect(store.state).toEqual(at());
    store.apply({ dc: 'd2', floor: '3F' });
    store.setData({ datacenters: [{ id: 'x', name: 'X', floors: floors() }] });
    expect(store.state).toEqual({ dc: 'x', floor: null, rack: null, server: null });
    expect(store.datacenters.map((d) => d.id)).toEqual(['x']);
  });
});
