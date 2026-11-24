// Pure edit operations on a normalized v3 dataset. Three-free and DOM-free.
// Each op returns a NEW dataset (the input is never mutated) or throws EditError with a Korean message.
// Mount overlaps are NOT refused here: the edit is saved and the rules (domain/mount.js) report them as
// warnings after re-validation. Refused: input that cannot be placed at all (bad position / floorspace code),
// and a new rack on a cell that is already taken (the editor never creates a cell conflict).

import { toStored } from './schema.js';
import { parsePosition, formatPosition, deviceId, DEFAULT_TOTAL_U } from './records.js';
import { parseFloorspaces, isContiguous, cellKey } from '../domain/floorspace.js';
import { emptySlots } from '../domain/slots.js';

export class EditError extends Error {}

const fail = (msg) => {
  throw new EditError(msg);
};

/** Strips view-only fields so exported/persisted files stay plain stored-tree data. */
export const toPlain = (data) => toStored(data);

function locate(data, dcId) {
  const dc = data.datacenters.find((d) => d.id === dcId);
  if (!dc) fail(`데이터센터 "${dcId}"가 없습니다`);
  return dc;
}

function findRack(dc, rackId) {
  for (const floor of dc.floors) {
    const rack = floor.racks.find((r) => r.id === rackId);
    if (rack) return { floor, rack };
  }
  return fail(`랙 "${rackId}"가 없습니다`);
}

function findServer(dc, serverId) {
  for (const floor of dc.floors)
    for (const rack of floor.racks) {
      const server = rack.servers.find((s) => s.id === serverId);
      if (server) return { floor, rack, server };
    }
  return fail(`장비 "${serverId}"가 없습니다`);
}

const allRacks = (dc) => dc.floors.flatMap((f) => f.racks);

/** Works on a deep copy; `fn` mutates it and the copy is returned. */
function edit(data, fn) {
  const copy = structuredClone(data);
  fn(copy);
  return copy;
}

function text(v, what, { required = true } = {}) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (required && !s) fail(`${what}을(를) 입력하세요`);
  return s;
}

function intValue(v, what) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  if (String(v ?? '').trim() === '' || !Number.isInteger(n)) fail(`${what}은(는) 정수여야 합니다`);
  return n;
}

/** Canonical `hU (s-e)`, or EditError when the position cannot be placed in the rack. */
function position(rack, value) {
  const pos = parsePosition(text(value, '장착 위치'), rack.total_u);
  if ('error' in pos) fail(pos.error);
  return formatPosition(pos.s, pos.e);
}

/** @param {{device_name?, company?, device_position?}} patch */
export function updateServer(data, dcId, serverId, patch) {
  return edit(data, (d) => {
    const { rack, server } = findServer(locate(d, dcId), serverId);
    if ('device_name' in patch) server.device_name = text(patch.device_name, '장비 이름');
    if ('company' in patch) server.company = text(patch.company, '회사', { required: false });
    if ('device_position' in patch) server.device_position = position(rack, patch.device_position);
  });
}

/** @param {{device_name, company?, device_position}} fields @returns {{data:any, serverId:string}} */
export function addServer(data, dcId, rackId, fields) {
  let serverId;
  const out = edit(data, (d) => {
    const { rack } = findRack(locate(d, dcId), rackId);
    const device_position = position(rack, fields.device_position);
    const device_name = text(fields.device_name, '장비 이름');
    serverId = deviceId(rack.id, parsePosition(device_position, rack.total_u), new Set(rack.servers.map((s) => s.id)));
    rack.servers.push({ id: serverId, device_name, company: text(fields.company, '회사', { required: false }), device_position });
  });
  return { data: out, serverId };
}

export function deleteServer(data, dcId, serverId) {
  return edit(data, (d) => {
    const { rack } = findServer(locate(d, dcId), serverId);
    rack.servers = rack.servers.filter((s) => s.id !== serverId);
  });
}

/** First free cell of a floor (zone order, row-major), or null. */
export function firstEmptySlot(floor) {
  return emptySlots(floor)[0] ?? null;
}

/** `RI-{first cell}`, suffixed when taken. */
export function defaultRackId(dc, code) {
  const base = `RI-${code || 'NEW'}`;
  const taken = new Set(allRacks(dc).map((r) => r.id));
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

/** @param {{name?, floorspaces:string}} fields comma list of cells on this floor @returns {{data:any, rackId:string}} */
export function addRack(data, dcId, floorId, fields) {
  let rackId;
  const out = edit(data, (d) => {
    const dc = locate(d, dcId);
    const floor = dc.floors.find((f) => f.id === floorId) || fail(`층 "${floorId}"이(가) 없습니다`);
    const { cells, invalid } = parseFloorspaces(text(fields.floorspaces, 'floorspace'));
    if (invalid.length || !cells.length) fail(`floorspace 형식이 아닙니다: ${invalid.join(', ') || '(비어 있음)'} (예: ${floor.level}A0101)`);
    if (cells.some((c) => c.floor !== floor.level)) fail(`floorspace의 층 번호는 ${floor.level}이어야 합니다`);
    if (!isContiguous(cells)) fail('여러 칸을 쓰는 랙은 같은 줄의 연속된 칸이어야 합니다');
    const taken = new Map();
    for (const r of floor.racks) for (const c of parseFloorspaces(r.floorspaces).cells) taken.set(cellKey(c), r.id);
    for (const c of cells) if (taken.has(cellKey(c))) fail(`칸 ${c.code}에 이미 랙 ${taken.get(cellKey(c))}이(가) 있습니다`);
    rackId = text(fields.name, '랙 이름', { required: false }) || defaultRackId(dc, cells[0].code);
    if (allRacks(dc).some((r) => r.id === rackId)) fail(`랙 "${rackId}"이(가) 이미 있습니다`);
    floor.racks.push({ id: rackId, name: rackId, floorspaces: cells.map((c) => c.code), total_u: DEFAULT_TOTAL_U, servers: [] });
  });
  return { data: out, rackId };
}

export function deleteRack(data, dcId, rackId) {
  return edit(data, (d) => {
    const { floor } = findRack(locate(d, dcId), rackId);
    floor.racks = floor.racks.filter((r) => r.id !== rackId);
  });
}

export function renameDc(data, dcId, name) {
  return edit(data, (d) => {
    locate(d, dcId).name = text(name, '데이터센터 이름');
  });
}

/** Prefill for a new floor of `dc`: next level above the top floor (1–9, the floorspace digit), id `{level}F`. */
export function nextFloorDefaults(dc) {
  const levels = dc.floors.map((f) => f.level).filter(Number.isInteger);
  const level = levels.length ? Math.max(...levels) + 1 : 1;
  return { id: `${level}F`, level };
}

/** @param {{level?}} fields empty level → nextFloorDefaults @returns {{data:any, floorId:string}} */
export function addFloor(data, dcId, fields) {
  let floorId;
  const out = edit(data, (d) => {
    const dc = locate(d, dcId);
    const level = String(fields.level ?? '').trim() === '' ? nextFloorDefaults(dc).level : intValue(fields.level, '층');
    if (level < 1 || level > 9) fail('층은 1–9 사이여야 합니다 (floorspace 첫 자리)');
    if (dc.floors.some((f) => f.level === level)) fail(`${level}층이 이미 있습니다`);
    floorId = `${level}F`;
    dc.floors.push({ id: floorId, level, racks: [] });
    dc.floors.sort((a, b) => a.level - b.level);
  });
  return { data: out, floorId };
}

/**
 * New DC (build) with its first floor; the build name is its id.
 * @param {{name, level?}} fields @returns {{data:any, dcId:string}}
 */
export function addDc(data, fields) {
  let dcId;
  const out = edit(data, (d) => {
    const name = text(fields.name, '데이터센터 이름');
    if (d.datacenters.some((x) => x.id === name || x.name === name)) fail(`데이터센터 "${name}"이(가) 이미 있습니다`);
    const level = String(fields.level ?? '').trim() === '' ? 1 : intValue(fields.level, '층');
    if (level < 1 || level > 9) fail('층은 1–9 사이여야 합니다 (floorspace 첫 자리)');
    dcId = name;
    d.datacenters.push({ id: dcId, name, floors: [{ id: `${level}F`, level, racks: [] }] });
  });
  return { data: out, dcId };
}

/** Removes a floor with its racks/devices; a DC keeps at least one floor. */
export function deleteFloor(data, dcId, floorId) {
  return edit(data, (d) => {
    const dc = locate(d, dcId);
    if (!dc.floors.some((f) => f.id === floorId)) fail(`층 "${floorId}"이(가) 없습니다`);
    if (dc.floors.length === 1) fail('데이터센터에는 층이 하나 이상 있어야 합니다. 데이터센터를 삭제하세요');
    dc.floors = dc.floors.filter((f) => f.id !== floorId);
  });
}

/** Removes a DC with everything in it; the dataset keeps at least one DC. */
export function deleteDc(data, dcId) {
  return edit(data, (d) => {
    locate(d, dcId);
    if (d.datacenters.length === 1) fail('데이터센터가 하나뿐이라 삭제할 수 없습니다');
    d.datacenters = d.datacenters.filter((x) => x.id !== dcId);
  });
}

/** `{floors, racks, servers}` counts under a DC or a floor (for confirm messages). */
export function countUnder(node) {
  const floors = node.floors ?? [node];
  const racks = floors.flatMap((f) => f.racks);
  return { floors: floors.length, racks: racks.length, servers: racks.reduce((a, r) => a + r.servers.length, 0) };
}
