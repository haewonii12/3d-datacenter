// v3 dataset validation + normalization. Three-free, pure.
//
// Stored tree (what files / IndexedDB / edits hold):
//   {version:3, datacenters:[{id, name, floors:[{id, level, racks:[{id, name?, floorspaces:[code…], total_u?,
//     servers:[{id, device_name, company, device_position}] }] }] }] }
// normalize() adds view-only fields: floor.zones/rows/cols, rack.zone/row/col/span/violation,
// server.unit/height_u/invalid/violation. Rules come from domain/mount.js and domain/floorspace.js only;
// a violation never excludes a rack or device — it is a warning plus a red flag.

import { parseFloorspaces, checkRackCells, layoutZones, placeRack } from '../domain/floorspace.js';
import { checkMounts } from '../domain/mount.js';
import { parsePosition, DEFAULT_TOTAL_U } from './records.js';

/** @typedef {{path:string, message:string, kind?:string, row?:number, target?:{dc:string, rack?:string, server?:string}}} Issue */

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isPosInt = (v) => isInt(v) && v > 0;
const hasStr = (v) => typeof v === 'string' && v.length > 0;
const totalOf = (r) => (isPosInt(r.total_u) ? r.total_u : DEFAULT_TOTAL_U);

/**
 * Core analysis shared by validate and normalize. Keys: rack "di:fi:ri", device "di:fi:ri:si".
 */
function analyze(json) {
  const fatal = [];
  const warnings = [];
  const info = { invalidPositions: 0 };
  const excludedRacks = new Set();
  const invalidServers = new Set();
  const rackViolations = new Map();
  const serverViolations = new Map();
  const positions = new Map();
  const cells = new Map();
  const out = { fatal, warnings, info, excludedRacks, invalidServers, rackViolations, serverViolations, positions, cells };
  const F = (path, message) => fatal.push({ path, message });
  const W = (path, message, extra = {}) => warnings.push({ path, message, ...extra });
  const flag = (map, key, reason) => map.set(key, [...(map.get(key) || []), reason]);

  const dcs = json && json.datacenters;
  if (!Array.isArray(dcs) || dcs.length === 0) {
    F('datacenters', 'datacenters must be a non-empty array');
    return out;
  }
  const dcIds = new Set();
  dcs.forEach((dc, di) => {
    const dp = `datacenters[${di}]`;
    if (!dc || typeof dc !== 'object') return F(dp, 'datacenter must be an object');
    if (!hasStr(dc.id)) F(`${dp}.id`, 'datacenter id is required');
    else if (dcIds.has(dc.id)) F(`${dp}.id`, `duplicate datacenter id "${dc.id}"`);
    else dcIds.add(dc.id);
    if (!Array.isArray(dc.floors) || dc.floors.length === 0) return F(`${dp}.floors`, 'floors must be a non-empty array');

    const floorIds = new Set();
    const rackIds = new Set();
    const serverIds = new Set();
    const dup = (set, id, path, what) => {
      if (set.has(id)) F(path, `duplicate ${what} id "${id}"`);
      else set.add(id);
    };
    dc.floors.forEach((floor, fi) => {
      const fp = `${dp}.floors[${fi}]`;
      if (!floor || typeof floor !== 'object') return F(fp, 'floor must be an object');
      if (!hasStr(floor.id)) F(`${fp}.id`, 'floor id is required');
      else dup(floorIds, floor.id, `${fp}.id`, 'floor');
      if (!isInt(floor.level)) F(`${fp}.level`, 'level must be an integer');
      const racks = Array.isArray(floor.racks) ? floor.racks : [];
      const placed = [];

      racks.forEach((rack, ri) => {
        const rp = `${fp}.racks[${ri}]`;
        const rkey = `${di}:${fi}:${ri}`;
        if (!rack || typeof rack !== 'object') return F(rp, 'rack must be an object');
        const row = rack.src?.row;
        if (!hasStr(rack.id)) F(`${rp}.id`, 'rack id is required');
        else dup(rackIds, rack.id, `${rp}.id`, 'rack');
        const target = { dc: dc.id, rack: rack.id };

        const { cells: rc, invalid } = parseFloorspaces(rack.floorspaces);
        if (!rc.length || invalid.length) {
          W(`${rp}.floorspaces`, `랙 ${rack.id}: floorspace를 해석할 수 없어 화면에 그리지 않으며 저장·내보내기에서도 빠집니다 (${invalid.join(',') || '비어 있음'})`, { kind: 'floorspace-invalid', row });
          excludedRacks.add(rkey);
        } else {
          if (isInt(floor.level) && rc.some((c) => c.floor !== floor.level)) {
            W(`${rp}.floorspaces`, `랙 ${rack.id}: floorspace의 층이 ${floor.id}와(과) 다릅니다`, { kind: 'floorspace-floor-mismatch', row, target });
          }
          cells.set(rkey, rc);
          placed.push({ id: rack.id, cells: rc, key: rkey, row, target });
        }

        const total = totalOf(rack);
        const servers = Array.isArray(rack.servers) ? rack.servers : [];
        const mounts = [];
        servers.forEach((s, si) => {
          const sp = `${rp}.servers[${si}]`;
          const skey = `${rkey}:${si}`;
          if (!s || typeof s !== 'object') return F(sp, 'device must be an object');
          if (!hasStr(s.id)) F(`${sp}.id`, 'device id is required');
          else dup(serverIds, s.id, `${sp}.id`, 'device');
          const pos = parsePosition(s.device_position, total);
          const srow = s.src?.row;
          if ('error' in pos) {
            invalidServers.add(skey);
            info.invalidPositions++;
            W(`${sp}.device_position`, `${s.device_name || s.id}: ${pos.error}. 이 장비는 화면에 그리지 않습니다`, { kind: 'position-invalid', row: srow, target: { dc: dc.id, rack: rack.id, server: s.id } });
            return;
          }
          positions.set(skey, pos);
          mounts.push({ id: skey, s: pos.s, e: pos.e, sp, row: srow, sid: s.id, name: s.device_name || s.id });
        });
        const byKey = new Map(mounts.map((m) => [m.id, m]));
        for (const issue of checkMounts(mounts)) {
          const first = byKey.get(issue.devices[0]);
          const names = issue.devices.map((k) => byKey.get(k).name);
          W(first.sp, `랙 ${rack.id}: ${names.join(' / ')} — ${issue.message}`, {
            kind: issue.kind,
            row: first.row,
            target: { dc: dc.id, rack: rack.id, server: first.sid },
          });
          for (const k of issue.devices) flag(serverViolations, k, issue.message);
          flag(rackViolations, rkey, `장비 장착 위반: ${names.join(' / ')}`);
        }
      });

      const byId = new Map(placed.map((p) => [p.id, p]));
      for (const issue of checkRackCells(placed)) {
        const first = byId.get(issue.racks[0]);
        W(`${fp}.racks`, issue.message, { kind: issue.kind, row: byId.get(issue.racks[issue.racks.length - 1])?.row, target: first?.target });
        for (const id of issue.racks) {
          const p = byId.get(id);
          if (p) flag(rackViolations, p.key, issue.message);
        }
      }
    });
  });
  return out;
}

/** @returns {{fatal:Issue[], warnings:Issue[], info:{invalidPositions:number}}} */
export function validate(json) {
  const { fatal, warnings, info } = analyze(json);
  return { fatal, warnings, info };
}

/** Fields normalize derives (dropped again by toStored). */
const DERIVED_FLOOR = ['zones', 'rows', 'cols'];
const DERIVED_RACK = ['zone', 'row', 'col', 'span', 'violation'];
const DERIVED_SERVER = ['unit', 'height_u', 'invalid', 'violation'];
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

/** Returns a new normalized v3 dataset (input is not mutated). Call only when validate() has no fatal issues. */
export function normalize(json) {
  const a = analyze(json);
  return {
    ...json,
    version: 3,
    datacenters: json.datacenters.map((dc, di) => ({
      ...dc,
      name: hasStr(dc.name) ? dc.name : dc.id,
      floors: dc.floors.map((floor, fi) => {
        const kept = (floor.racks || []).map((rack, ri) => ({ rack, ri })).filter(({ ri }) => !a.excludedRacks.has(`${di}:${fi}:${ri}`));
        const grid = layoutZones(kept.map(({ ri }) => a.cells.get(`${di}:${fi}:${ri}`)));
        return {
          ...omit(floor, DERIVED_FLOOR),
          ...grid,
          racks: kept.map(({ rack, ri }) => {
            const rkey = `${di}:${fi}:${ri}`;
            const cells = a.cells.get(rkey);
            const out = {
              ...omit(rack, DERIVED_RACK),
              name: hasStr(rack.name) ? rack.name : rack.id,
              floorspaces: cells.map((c) => c.code),
              total_u: totalOf(rack),
              ...placeRack(grid.zones, cells),
              servers: (rack.servers || []).map((s, si) => {
                const skey = `${rkey}:${si}`;
                const pos = a.positions.get(skey);
                const sv = { ...omit(s, DERIVED_SERVER), device_name: s.device_name ?? '', company: s.company ?? '' };
                if (pos) Object.assign(sv, { unit: pos.s, height_u: pos.e - pos.s + 1 });
                else sv.invalid = true;
                if (a.serverViolations.has(skey)) sv.violation = a.serverViolations.get(skey);
                return sv;
              }),
            };
            if (a.rackViolations.has(rkey)) out.violation = a.rackViolations.get(rkey);
            return out;
          }),
        };
      }),
    })),
  };
}

/** Normalized (or stored) → stored tree: what export, persistence and edits hold. */
export function toStored(data) {
  return {
    version: 3,
    datacenters: data.datacenters.map((dc) => ({
      id: dc.id,
      name: dc.name,
      floors: dc.floors.map((f) => ({
        ...omit(f, [...DERIVED_FLOOR, 'racks']),
        racks: f.racks.map((r) => ({
          ...omit(r, [...DERIVED_RACK, 'servers', 'src']),
          servers: r.servers.map((s) => omit(s, [...DERIVED_SERVER, 'src'])),
        })),
      })),
    })),
  };
}
