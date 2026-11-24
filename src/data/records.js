// Field records (one row per device) → v3 dataset tree. Pure: no DOM, no three.
//   {build_name:"가산IDC", floorspace_name:"3A0401,3A0402", company:"해원회사", rack_name:"RI20261120",
//    device_position:"3U (29-31)", device_name:"web-01", total_u?:42}
// A row without device_position/device_name declares an empty rack.
// The tree keeps the original codes (rack.floorspaces, server.device_position); grid coordinates are derived
// later by schema.normalize, which also reports bad positions and mount / cell violations
// (rules live in domain/mount.js and domain/floorspace.js).

import { parseFloorspaces, splitFloorspaces } from '../domain/floorspace.js';

export const DEFAULT_TOTAL_U = 42;
export const FIELDS = ['build_name', 'floorspace_name', 'company', 'rack_name', 'device_position', 'device_name', 'total_u'];

const POSITION = /^\s*(\d+)\s*U\s*\(\s*(\d+)\s*-\s*(\d+)\s*\)\s*$/i;
const blank = (v) => v == null || String(v).trim() === '';
const str = (v) => (v == null ? '' : String(v).trim());

/**
 * `3U (29-31)` → {h:3, s:29, e:31}; anything else → {error}.
 * @returns {{h:number, s:number, e:number}|{error:string}}
 */
export function parsePosition(value, totalU = DEFAULT_TOTAL_U) {
  const m = POSITION.exec(String(value ?? ''));
  if (!m) return { error: `장착 위치 형식이 아닙니다: "${str(value)}" (예: 3U (29-31))` };
  const [h, s, e] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (s < 1 || e < s) return { error: `장착 위치 ${str(value)}: 시작 U가 끝 U보다 클 수 없습니다` };
  if (h !== e - s + 1) return { error: `장착 위치 ${str(value)}: 높이 ${h}U가 범위 ${s}–${e}(${e - s + 1}U)와 다릅니다` };
  if (e > totalU) return { error: `장착 위치 ${str(value)}: 랙 범위(1–${totalU})를 벗어납니다` };
  return { h, s, e };
}

export const formatPosition = (s, e) => `${e - s + 1}U (${s}-${e})`;

/** Device id rule (unique per rack): `{rack}:{s}-{e}:{k}`, or `{rack}:invalid:{k}` when unparsable. */
export function deviceId(rackName, pos, taken) {
  const base = 'error' in pos ? `${rackName}:invalid` : `${rackName}:${pos.s}-${pos.e}`;
  let k = 0;
  while (taken.has(`${base}:${k}`)) k++;
  const id = `${base}:${k}`;
  taken.add(id);
  return id;
}

/**
 * @param {object[]} records
 * @param {{rowOf?:(i:number)=>number}} [opts] source row number of record i (CSV: Excel row; JSON: index+1)
 * @returns {{json:any|null, fatal:{path:string,message:string,row?:number}[], warnings:{path:string,message:string,row?:number,kind:string}[]}}
 */
export function recordsToDataset(records, { rowOf = (i) => i + 1 } = {}) {
  const fatal = [];
  const warnings = [];
  if (!Array.isArray(records) || !records.length) {
    fatal.push({ path: 'records', message: '레코드가 없습니다' });
    return { json: null, fatal, warnings };
  }
  const W = (row, kind, message) => warnings.push({ path: `${row}행`, row, kind, message });

  /** build → {dc, floors: Map<level, floor>, racks: Map<rack_name, rack>} */
  const builds = new Map();
  const ids = new Map(); // rack object -> Set of device ids

  records.forEach((rec, i) => {
    const row = rowOf(i);
    if (!rec || typeof rec !== 'object') return W(row, 'record-invalid', '레코드가 객체가 아닙니다');
    const build = str(rec.build_name);
    const rackName = str(rec.rack_name);
    if (!build) return W(row, 'record-invalid', 'build_name이 비어 있어 건너뜁니다');
    if (!rackName) return W(row, 'record-invalid', 'rack_name이 비어 있어 건너뜁니다');

    let b = builds.get(build);
    if (!b) {
      b = { dc: { id: build, name: build, floors: [] }, floors: new Map(), racks: new Map() };
      builds.set(build, b);
    }

    let rack = b.racks.get(rackName);
    const codes = splitFloorspaces(rec.floorspace_name);
    if (!rack) {
      const { cells, invalid } = parseFloorspaces(codes);
      if (!cells.length || invalid.length) {
        return W(row, 'floorspace-invalid', `랙 ${rackName}의 floorspace_name "${str(rec.floorspace_name)}"을(를) 해석할 수 없어 건너뜁니다 (예: 3A0401)`);
      }
      const level = cells[0].floor;
      if (cells.some((c) => c.floor !== level)) {
        return W(row, 'floorspace-invalid', `랙 ${rackName}의 칸들이 서로 다른 층에 있어 건너뜁니다`);
      }
      let floor = b.floors.get(level);
      if (!floor) {
        floor = { id: `${level}F`, level, racks: [] };
        b.floors.set(level, floor);
      }
      const totalU = Number.isInteger(Number(rec.total_u)) && Number(rec.total_u) > 0 ? Number(rec.total_u) : DEFAULT_TOTAL_U;
      rack = { id: rackName, name: rackName, floorspaces: cells.map((c) => c.code), total_u: totalU, servers: [], src: { row } };
      floor.racks.push(rack);
      b.racks.set(rackName, rack);
      ids.set(rack, new Set());
    } else if (codes.length && [...codes].sort().join(',') !== [...rack.floorspaces].sort().join(',')) {
      W(row, 'rack-floorspace-mismatch', `랙 ${rackName}의 floorspace_name(${codes.join(',')})이 앞 행(${rack.floorspaces.join(',')})과 다릅니다. 앞 행 값을 사용합니다`);
    }

    const hasDevice = !blank(rec.device_position) || !blank(rec.device_name);
    if (!hasDevice) {
      if (!blank(rec.company) && !rack.company) rack.company = str(rec.company); // empty rack keeps its owner
      return; // empty rack row
    }

    const pos = parsePosition(rec.device_position, rack.total_u);
    const server = {
      id: deviceId(rackName, pos, ids.get(rack)),
      device_name: str(rec.device_name),
      company: str(rec.company),
      device_position: str(rec.device_position),
      src: { row },
    };
    rack.servers.push(server);
  });

  if (!builds.size) {
    fatal.push({ path: 'records', message: '유효한 레코드가 없습니다', row: undefined });
    return { json: null, fatal, warnings };
  }
  const datacenters = [...builds.values()].map(({ dc, floors }) => ({
    ...dc,
    floors: [...floors.values()].sort((a, b) => a.level - b.level),
  }));
  return { json: { version: 3, datacenters }, fatal, warnings };
}

/** v3 tree → flat records (inverse of recordsToDataset; empty racks become one row without a device). */
export function datasetToRecords(data) {
  const out = [];
  for (const dc of data.datacenters)
    for (const f of dc.floors)
      for (const r of f.racks) {
        const base = { build_name: dc.name || dc.id, floorspace_name: r.floorspaces.join(','), rack_name: r.name || r.id };
        const total = r.total_u && r.total_u !== DEFAULT_TOTAL_U ? { total_u: r.total_u } : {};
        if (!r.servers.length) out.push({ ...base, company: r.company ?? '', device_position: '', device_name: '', ...total });
        for (const s of r.servers)
          out.push({ ...base, company: s.company ?? '', device_position: s.device_position, device_name: s.device_name, ...total });
      }
  return out;
}
