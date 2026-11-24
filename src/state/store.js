import { parse, serialize } from './hash.js';

/** @typedef {{dc:string|null, floor:string|null, rack:string|null, server:string|null}} ViewState */

/**
 * @param {{data:any, location:{hash:string}, history:{replaceState:Function}}} deps data = normalized v2 dataset
 */
export function createStore({ data, location, history }) {
  /** @type {ViewState} */
  let state = { dc: null, floor: null, rack: null, server: null };
  const subs = new Set();

  /** dcId -> {dc, floors, racks, servers}; floor/rack/server ids are unique within a DC only. */
  let dcs = new Map();
  /** Bumped by setData; the scene/UI compare it to know their cached build is stale. */
  let revision = 0;
  function index(d) {
    dcs = new Map();
    for (const dc of d.datacenters) {
      const floors = new Map();
      const racks = new Map();
      const servers = new Map();
      for (const floor of dc.floors) {
        floors.set(floor.id, floor);
        for (const rack of floor.racks) {
          racks.set(rack.id, { rack, floor });
          for (const server of rack.servers) servers.set(server.id, { server, rack, floor });
        }
      }
      dcs.set(dc.id, { dc, floors, racks, servers });
    }
    data = d;
  }
  index(data);
  /** The DC a lookup refers to; null on the map (no DC selected) — there is no implicit first DC. */
  const scope = (dcId) => dcs.get(dcId ?? state.dc) || null;

  const getDc = (id = state.dc) => dcs.get(id)?.dc || null;
  const getFloor = (id, dcId) => scope(dcId)?.floors.get(id) || null;
  const getRack = (id, dcId) => scope(dcId)?.racks.get(id) || null;
  const getServer = (id, dcId) => scope(dcId)?.servers.get(id) || null;

  const norm = (p) => ({ dc: p?.dc ?? null, floor: p?.floor ?? null, rack: p?.rack ?? null, server: p?.server ?? null });
  const same = (a, b) => a.dc === b.dc && a.floor === b.floor && a.rack === b.rack && a.server === b.server;

  const MAP = { dc: null, floor: null, rack: null, server: null };

  /**
   * Nearest valid ancestor inside the target DC. No `dc` or an unknown `dc` → the map (legacy hashes
   * such as `#floor=2F` without a DC have no DC to belong to).
   */
  function resolve(partial) {
    const p = norm(partial);
    if (p.dc == null || !dcs.has(p.dc)) return { ...MAP };
    const dc = p.dc;
    const { floors, racks, servers } = dcs.get(dc);
    const s = p.server != null ? servers.get(p.server) : null;
    if (s) return { dc, floor: s.floor.id, rack: s.rack.id, server: s.server.id };
    const r = p.rack != null ? racks.get(p.rack) : null;
    if (r) return { dc, floor: r.floor.id, rack: r.rack.id, server: null };
    if (p.floor != null && floors.has(p.floor)) return { dc, floor: p.floor, rack: null, server: null };
    return { dc, floor: null, rack: null, server: null };
  }

  const modeOf = (s) => (s.dc == null ? 'map' : s.server ? 'server' : s.rack ? 'rack' : s.floor ? 'floor' : 'overview');
  const mode = () => modeOf(state);

  /** Writes location.hash only; never mutates state. `next.dc` defaults to the current DC; `{dc: null}` = the map. */
  function navigate(next) {
    const dc = next && 'dc' in next ? next.dc : state.dc;
    location.hash = serialize(resolve({ ...next, dc }));
  }

  /** False until the first apply: that one always notifies, even when it resolves to the initial map state. */
  let applied = false;

  /** The only state mutator. `parsed` is a parsed hash; '' / `#map` / anything without a known dc → the map. */
  function apply(parsed, hashString) {
    const resolved = resolve(parsed);
    const canonical = serialize(resolved);
    if (hashString !== undefined ? hashString !== canonical : !same(resolved, norm(parsed))) history.replaceState(null, '', canonical);
    if (applied && same(resolved, state)) return;
    applied = true;
    const prev = state;
    state = resolved;
    for (const fn of [...subs]) fn(prev, state);
  }

  /**
   * Replaces the dataset (upload, edit, reset). The current state is re-resolved against the new data
   * (a deleted server falls back to its rack, a deleted DC to the map, …), or reset to the map with `reset`.
   * Subscribers are always notified, even when the state is unchanged, because the data behind it changed.
   */
  function setData(next, { reset = false } = {}) {
    index(next);
    revision++;
    const resolved = resolve(reset ? {} : state);
    history.replaceState(null, '', serialize(resolved));
    const prev = state;
    state = resolved;
    for (const fn of [...subs]) fn(prev, state);
  }

  function subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  }

  const selectDc = (dcId) => navigate({ dc: dcId });
  const showMap = () => navigate({ dc: null });
  const enterFloor = (floorId) => navigate({ floor: floorId });
  const openRack = (rackId) => navigate({ rack: rackId });
  const selectServer = (serverId) => navigate({ server: serverId });

  function up() {
    if (state.server) navigate({ floor: state.floor, rack: state.rack });
    else if (state.rack) navigate({ floor: state.floor });
    else if (state.floor) navigate({ dc: state.dc });
    else if (state.dc != null) showMap();
  }

  /** @param {'root'|'dc'|'floor'|'rack'|'server'} level root = the map, dc = the current DC's overview */
  function goLevel(level) {
    if (level === 'root') showMap();
    else if (level === 'dc') navigate({ dc: state.dc });
    else if (level === 'floor') navigate({ floor: state.floor });
    else if (level === 'rack') navigate({ floor: state.floor, rack: state.rack });
    else if (level === 'server') navigate({ ...state });
  }

  return {
    get state() {
      return state;
    },
    /** All datacenters in file order. */
    get datacenters() {
      return data.datacenters;
    },
    get data() {
      return data;
    },
    get revision() {
      return revision;
    },
    setData,
    mode,
    modeOf,
    subscribe,
    resolve,
    navigate,
    apply,
    selectDc,
    showMap,
    enterFloor,
    openRack,
    selectServer,
    up,
    goLevel,
    getDc,
    getFloor,
    getRack,
    getServer,
  };
}

/** Installs the hashchange listener and does the initial apply. */
export function bindHash(store, win) {
  const handler = () => store.apply(parse(win.location.hash), win.location.hash);
  win.addEventListener('hashchange', handler);
  handler();
  return () => win.removeEventListener?.('hashchange', handler);
}
