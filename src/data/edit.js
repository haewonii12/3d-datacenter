// Pure edit operations on a normalized v2 dataset. Three-free and DOM-free.
// Each op returns a NEW dataset (the input is never mutated) or throws EditError with a Korean message,
// so an edit can never leave the data in a state the validator would reject.

export class EditError extends Error {}

const STATUSES = ['ok', 'warn', 'down', 'unknown'];
const pad2 = (n) => String(n).padStart(2, '0');
const fail = (msg) => {
  throw new EditError(msg);
};

/** Strips view-only flags so exported/persisted files stay plain schema data. */
export function toPlain(data) {
  return JSON.parse(JSON.stringify(data, (k, v) => (k === 'invalid' ? undefined : v)));
}

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
  return fail(`서버 "${serverId}"가 없습니다`);
}

const allServers = (dc) => dc.floors.flatMap((f) => f.racks.flatMap((r) => r.servers));
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

function posInt(v, what) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  if (!Number.isInteger(n) || n < 1) fail(`${what}은(는) 1 이상의 정수여야 합니다`);
  return n;
}

/** Throws unless U range [unit, unit+height-1] fits the rack and overlaps no other server. */
function checkUnits(rack, unit, height, ignoreId) {
  const hi = unit + height - 1;
  if (hi > rack.total_u) fail(`U${unit}–${hi}가 랙 범위(1–${rack.total_u})를 벗어납니다`);
  for (const s of rack.servers) {
    if (s.id === ignoreId) continue;
    const sHi = s.unit + (s.height_u || 1) - 1;
    if (unit <= sHi && s.unit <= hi) fail(`U${unit}–${hi}가 ${s.hostname}(U${s.unit}–${sHi})와 겹칩니다`);
  }
}

function checkHostname(dc, hostname, ignoreId) {
  if (allServers(dc).some((s) => s.id !== ignoreId && s.hostname === hostname)) fail(`호스트명 "${hostname}"이(가) 이미 있습니다`);
}

function cleanServices(services) {
  return (services || []).map((svc, i) => {
    const name = text(svc.name, `서비스 ${i + 1} 이름`);
    const team = text(svc.team, '팀', { required: false });
    const status = STATUSES.includes(svc.status) ? svc.status : 'unknown';
    return { name, team: team || null, status };
  });
}

/**
 * @param {{hostname?, ip?, unit?, height_u?, services?}} patch fields to change (strings from inputs are fine)
 */
export function updateServer(data, dcId, serverId, patch) {
  return edit(data, (d) => {
    const dc = locate(d, dcId);
    const { rack, server } = findServer(dc, serverId);
    const hostname = 'hostname' in patch ? text(patch.hostname, '호스트명') : server.hostname;
    const unit = 'unit' in patch ? posInt(patch.unit, '시작 U') : server.unit;
    const height = 'height_u' in patch ? posInt(patch.height_u, '높이') : server.height_u || 1;
    checkHostname(dc, hostname, serverId);
    checkUnits(rack, unit, height, serverId);
    server.hostname = hostname;
    server.unit = unit;
    server.height_u = height;
    if ('ip' in patch) server.ip = text(patch.ip, 'IP', { required: false }) || null;
    if ('services' in patch) server.services = cleanServices(patch.services);
    delete server.invalid;
  });
}

/** Next free `srv-NNNNN` id in the DC (ids are unique per DC). */
export function nextServerId(dc) {
  let max = 0;
  for (const s of allServers(dc)) {
    const m = /^srv-(\d+)$/.exec(s.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `srv-${String(max + 1).padStart(5, '0')}`;
}

/** @returns {{data:any, serverId:string}} */
export function addServer(data, dcId, rackId, fields) {
  let serverId;
  const out = edit(data, (d) => {
    const dc = locate(d, dcId);
    const { rack } = findRack(dc, rackId);
    const hostname = text(fields.hostname, '호스트명');
    const unit = posInt(fields.unit, '시작 U');
    const height = posInt(fields.height_u ?? 1, '높이');
    checkHostname(dc, hostname, null);
    checkUnits(rack, unit, height, null);
    serverId = nextServerId(dc);
    rack.servers.push({
      id: serverId,
      hostname,
      ip: text(fields.ip, 'IP', { required: false }) || null,
      unit,
      height_u: height,
      services: cleanServices(fields.services),
    });
    rack.servers.sort((a, b) => a.unit - b.unit);
  });
  return { data: out, serverId };
}

export function deleteServer(data, dcId, serverId) {
  return edit(data, (d) => {
    const { rack } = findServer(locate(d, dcId), serverId);
    rack.servers = rack.servers.filter((s) => s.id !== serverId);
  });
}

/** Default rack id, same pattern as the sample: `R-{floor}-{row}-{col}`, suffixed if taken. */
export function defaultRackId(dc, floorId, row, col) {
  const base = `R-${floorId}-${pad2(row)}-${pad2(col)}`;
  const taken = new Set(allRacks(dc).map((r) => r.id));
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

/** @returns {{data:any, rackId:string}} */
export function addRack(data, dcId, floorId, fields) {
  let rackId;
  const out = edit(data, (d) => {
    const dc = locate(d, dcId);
    const floor = dc.floors.find((f) => f.id === floorId) || fail(`층 "${floorId}"이(가) 없습니다`);
    const row = posInt(fields.row, 'Row');
    const col = posInt(fields.col, 'Col');
    if (row > floor.rows || col > floor.cols) fail(`슬롯 R${row}-C${col}이(가) 층 그리드(${floor.rows}×${floor.cols}) 밖입니다`);
    if (floor.racks.some((r) => r.row === row && r.col === col)) fail(`슬롯 R${row}-C${col}에 이미 랙이 있습니다`);
    rackId = text(fields.id, '랙 ID', { required: false }) || defaultRackId(dc, floorId, row, col);
    if (allRacks(dc).some((r) => r.id === rackId)) fail(`랙 ID "${rackId}"이(가) 이미 있습니다`);
    floor.racks.push({ id: rackId, row, col, total_u: 42, servers: [] });
    floor.racks.sort((a, b) => a.row - b.row || a.col - b.col);
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

/** First empty slot of a floor in row-major order, or null when full. */
export function firstEmptySlot(floor) {
  const taken = new Set(floor.racks.map((r) => `${r.row},${r.col}`));
  for (let row = 1; row <= floor.rows; row++)
    for (let col = 1; col <= floor.cols; col++) if (!taken.has(`${row},${col}`)) return { row, col };
  return null;
}

const MAX_GRID = 60; // rows/cols cap for new floors: keeps one floor at ≤ 3600 slots

function gridSize(v, what) {
  const n = posInt(v, what);
  if (n > MAX_GRID) fail(`${what}은(는) ${MAX_GRID} 이하여야 합니다`);
  return n;
}

function intValue(v, what) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  if (String(v ?? '').trim() === '' || !Number.isInteger(n)) fail(`${what}은(는) 정수여야 합니다`);
  return n;
}

/** Prefill for a new floor of `dc`: next level above the top floor, `{level}F`, same grid as the top floor. */
export function nextFloorDefaults(dc) {
  const levels = dc.floors.map((f, i) => (Number.isInteger(f.level) ? f.level : i + 1));
  const level = levels.length ? Math.max(...levels) + 1 : 1;
  const top = dc.floors[levels.indexOf(level - 1)] ?? dc.floors[dc.floors.length - 1];
  const taken = new Set(dc.floors.map((f) => f.id));
  let id = `${level}F`;
  for (let i = 2; taken.has(id); i++) id = `${level}F-${i}`;
  return { id, level, rows: top?.rows ?? 10, cols: top?.cols ?? 16 };
}

/** @param {{id?, level?, rows, cols}} fields empty id/level → nextFloorDefaults @returns {{data:any, floorId:string}} */
export function addFloor(data, dcId, fields) {
  let floorId;
  const out = edit(data, (d) => {
    const dc = locate(d, dcId);
    const def = nextFloorDefaults(dc);
    const level = String(fields.level ?? '').trim() === '' ? def.level : intValue(fields.level, '층 레벨');
    floorId = text(fields.id, '층 ID', { required: false }) || (level === def.level ? def.id : `${level}F`);
    if (dc.floors.some((f, i) => (Number.isInteger(f.level) ? f.level : i + 1) === level)) fail(`레벨 ${level} 층이 이미 있습니다`);
    if (dc.floors.some((f) => f.id === floorId)) fail(`층 ID "${floorId}"이(가) 이미 있습니다`);
    const rows = gridSize(fields.rows, 'Row 수');
    const cols = gridSize(fields.cols, 'Col 수');
    dc.floors.push({ id: floorId, level, rows, cols, racks: [] });
  });
  return { data: out, floorId };
}

/** `dc-N` not used yet. */
export function defaultDcId(data) {
  const taken = new Set(data.datacenters.map((d) => d.id));
  let n = data.datacenters.length + 1;
  while (taken.has(`dc-${n}`)) n++;
  return `dc-${n}`;
}

/**
 * New DC with its first floor (a DC needs ≥ 1 floor to be valid).
 * @param {{id?, name, floorId?, rows, cols}} fields @returns {{data:any, dcId:string}}
 */
export function addDc(data, fields) {
  let dcId;
  const out = edit(data, (d) => {
    dcId = text(fields.id, '데이터센터 ID', { required: false }) || defaultDcId(d);
    if (d.datacenters.some((x) => x.id === dcId)) fail(`데이터센터 ID "${dcId}"이(가) 이미 있습니다`);
    const name = text(fields.name, '데이터센터 이름');
    const floorId = text(fields.floorId, '층 ID', { required: false }) || '1F';
    const rows = gridSize(fields.rows, 'Row 수');
    const cols = gridSize(fields.cols, 'Col 수');
    d.datacenters.push({ id: dcId, name, floors: [{ id: floorId, level: 1, rows, cols, racks: [] }] });
  });
  return { data: out, dcId };
}

/** Removes a floor with its racks/servers; a DC keeps at least one floor. */
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
