// CSV (Excel) ⇄ dataset. Pure: no DOM, no three.
// One row = one server (plus its floor/rack). A row without server columns declares an empty rack;
// a row without rack columns declares an empty floor. Services live in one cell:
//   "nginx|웹플랫폼|ok; redis|SRE|warn"   (name|team|status, team/status optional)

/** Canonical columns, in export order, with accepted header aliases (compared after normalizeHeader). */
export const COLUMNS = [
  ['dc_id', ['데이터센터id', 'dcid']],
  ['dc_name', ['데이터센터', '데이터센터이름', 'dcname']],
  ['floor_id', ['층', '층id', 'floor']],
  ['floor_level', ['층레벨', '레벨', 'level']],
  ['floor_rows', ['층row수', '층행수', 'rows']],
  ['floor_cols', ['층col수', '층열수', 'cols']],
  ['rack_id', ['랙id', '랙', 'rack']],
  ['rack_row', ['랙row', '랙행', 'row']],
  ['rack_col', ['랙col', '랙열', 'col']],
  ['total_u', ['랙u', '전체u', 'totalu']],
  ['server_id', ['서버id', 'serverid']],
  ['hostname', ['호스트명', 'host']],
  ['ip', ['ip주소']],
  ['unit', ['시작u', 'u', 'startu']],
  ['height_u', ['높이u', '높이', 'height']],
  ['services', ['서비스']],
];
const REQUIRED = ['dc_id', 'floor_id'];

export const normalizeHeader = (h) => String(h ?? '').replace(/^﻿/, '').trim().toLowerCase().replace(/[\s_\-()]/g, '');

const ALIAS = new Map();
for (const [key, aliases] of COLUMNS) for (const a of [key, ...aliases]) ALIAS.set(normalizeHeader(a), key);

/** UTF-8 (BOM optional), falling back to CP949/EUC-KR — Korean Excel's default "CSV" encoding. */
export function decodeBytes(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(bytes);
  }
}

/** Delimiter of the header line: the most frequent of , ; \t outside quotes. */
function sniffDelimiter(text) {
  const line = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let max = -1;
  for (const d of [',', ';', '\t']) {
    const n = line.split(d).length - 1;
    if (n > max) [best, max] = [d, n];
  }
  return best;
}

/** RFC 4180 parser: quoted fields, "" escapes, CRLF/LF, newlines inside quotes. @returns {string[][]} */
export function parseCsv(text, delimiter = sniffDelimiter(text)) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const blank = (v) => v == null || String(v).trim() === '';
const pad2 = (n) => String(n).padStart(2, '0');

const STATUS_ALIAS = { 정상: 'ok', 경고: 'warn', 중단: 'down', 알수없음: 'unknown' };

/** Services cell → [{name, team?, status?}]; Korean status words are accepted. */
export function parseServices(cell) {
  if (blank(cell)) return [];
  return String(cell)
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [name, team, status] = s.split('|').map((x) => x.trim());
      const out = { name };
      if (team) out.team = team;
      if (status) out.status = STATUS_ALIAS[status] ?? status.toLowerCase();
      return out;
    });
}

/**
 * CSV text → v2 dataset JSON (not yet validated) + row-level errors.
 * `rowOfPath(path)` maps a validator path (datacenters[0].floors[1]…) back to "N행" for messages.
 * @returns {{json:any|null, errors:{path:string,message:string}[], rowOfPath:(p:string)=>string}}
 */
export function csvToDataset(text) {
  const errors = [];
  const E = (row, col, message) => errors.push({ path: col ? `${row}행 ${col}` : `${row}행`, message });
  // Keep each record's Excel row number (1-based) before dropping blank rows.
  const rows = parseCsv(text)
    .map((cells, i) => ({ cells, n: i + 1 }))
    .filter(({ cells }) => cells.some((c) => !blank(c)));
  const none = { json: null, errors, rowOfPath: (p) => p };
  if (!rows.length) {
    errors.push({ path: 'CSV', message: '내용이 없습니다' });
    return none;
  }
  const header = rows[0].cells.map((h) => ALIAS.get(normalizeHeader(h)) ?? null);
  const missing = REQUIRED.filter((k) => !header.includes(k));
  if (missing.length) {
    errors.push({ path: `${rows[0].n}행 (헤더)`, message: `필수 열이 없습니다: ${missing.join(', ')}. 첫 행은 열 이름이어야 합니다` });
    return none;
  }

  /** Integer cell; blank → undefined; garbage → error + NaN. */
  const int = (r, n, key) => {
    const v = r[key];
    if (blank(v)) return undefined;
    const x = Number(String(v).trim());
    if (!Number.isInteger(x)) {
      E(n, key, `정수가 아닙니다: "${v}"`);
      return NaN;
    }
    return x;
  };
  /** Sets obj[k]=v once; a different non-blank value later is a conflict. */
  const keep = (obj, k, v, n, col, what) => {
    if (v === undefined || v === '' || Number.isNaN(v)) return;
    if (obj[k] === undefined) obj[k] = v;
    else if (obj[k] !== v) E(n, col, `${what}의 ${col} 값이 앞 행과 다릅니다 (${obj[k]} ≠ ${v})`);
  };

  const dcs = new Map(); // dcId → {dc, floors: Map, racks: Map}
  const firstRow = new WeakMap(); // dc/floor/rack/server object → the row that introduced it

  rows.slice(1).forEach(({ cells, n }) => {
    const r = {};
    header.forEach((k, ci) => {
      if (k) r[k] = (cells[ci] ?? '').trim();
    });
    if (blank(r.dc_id)) return E(n, 'dc_id', '비어 있습니다');
    if (blank(r.floor_id)) return E(n, 'floor_id', '비어 있습니다');

    let d = dcs.get(r.dc_id);
    if (!d) {
      d = { dc: { id: r.dc_id, floors: [] }, floors: new Map(), racks: new Map() };
      dcs.set(r.dc_id, d);
      firstRow.set(d.dc, n);
    }
    keep(d.dc, 'name', r.dc_name || undefined, n, 'dc_name', `데이터센터 ${r.dc_id}`);

    let f = d.floors.get(r.floor_id);
    if (!f) {
      f = { id: r.floor_id, racks: [] };
      d.floors.set(r.floor_id, f);
      d.dc.floors.push(f);
      firstRow.set(f, n);
    }
    const what = `층 ${r.floor_id}`;
    keep(f, 'level', int(r, n, 'floor_level'), n, 'floor_level', what);
    keep(f, 'rows', int(r, n, 'floor_rows'), n, 'floor_rows', what);
    keep(f, 'cols', int(r, n, 'floor_cols'), n, 'floor_cols', what);

    const hasServer = ['server_id', 'hostname', 'ip', 'unit', 'height_u', 'services'].some((k) => !blank(r[k]));
    const hasRack = ['rack_id', 'rack_row', 'rack_col', 'total_u'].some((k) => !blank(r[k]));
    if (!hasRack) {
      if (hasServer) E(n, 'rack_row', '서버가 있는 행에는 랙 위치(rack_row, rack_col)가 필요합니다');
      return; // floor-only row
    }
    const row = int(r, n, 'rack_row');
    const col = int(r, n, 'rack_col');
    if (row === undefined || col === undefined) return E(n, row === undefined ? 'rack_row' : 'rack_col', '비어 있습니다');
    if (Number.isNaN(row) || Number.isNaN(col)) return;
    const rackId = r.rack_id || `R-${r.floor_id}-${pad2(row)}-${pad2(col)}`;
    let rack = d.racks.get(rackId);
    if (!rack) {
      rack = { id: rackId, row, col, servers: [] };
      d.racks.set(rackId, rack);
      f.racks.push(rack);
      firstRow.set(rack, n);
      rack.floorId = f.id;
    } else {
      if (rack.floorId !== f.id) E(n, 'floor_id', `랙 ${rackId}이(가) 앞 행에서는 층 ${rack.floorId}입니다`);
      if (rack.row !== row || rack.col !== col) E(n, 'rack_row', `랙 ${rackId}의 위치가 앞 행과 다릅니다 (R${rack.row}-C${rack.col})`);
    }
    keep(rack, 'total_u', int(r, n, 'total_u'), n, 'total_u', `랙 ${rackId}`);
    if (!hasServer) return; // empty rack row

    const unit = int(r, n, 'unit');
    if (unit === undefined) return E(n, 'unit', '서버 행에는 시작 U가 필요합니다');
    const id = r.server_id || r.hostname;
    if (!id) return E(n, 'server_id', 'server_id 또는 hostname 중 하나는 있어야 합니다');
    const server = { id, hostname: r.hostname || id, unit };
    if (r.ip) server.ip = r.ip;
    const h = int(r, n, 'height_u');
    if (h !== undefined) server.height_u = h;
    server.services = parseServices(r.services);
    rack.servers.push(server);
    firstRow.set(server, n);
  });

  // Defaults: floor grid = the furthest rack when rows/cols are blank; DC name = id.
  for (const { dc } of dcs.values()) {
    for (const f of dc.floors) {
      if (f.rows === undefined) f.rows = Math.max(1, ...f.racks.map((r) => r.row));
      if (f.cols === undefined) f.cols = Math.max(1, ...f.racks.map((r) => r.col));
      for (const r of f.racks) delete r.floorId;
    }
    if (dc.name === undefined) dc.name = dc.id;
  }
  const json = { version: 2, datacenters: [...dcs.values()].map((d) => d.dc) };

  /** "datacenters[0].floors[1].racks[2].servers[3].unit" → "5행 (servers[3].unit)"-style: deepest object's first row. */
  function rowOfPath(path) {
    const m = /^datacenters\[(\d+)\](?:\.floors\[(\d+)\](?:\.racks\[(\d+)\](?:\.servers\[(\d+)\])?)?)?(.*)$/.exec(path);
    if (!m) return path;
    let node = json.datacenters[m[1]];
    let rest = m[5];
    for (const [k, idx] of [['floors', m[2]], ['racks', m[3]], ['servers', m[4]]]) {
      if (idx === undefined) break;
      node = node?.[k]?.[idx];
    }
    const n = node && firstRow.get(node);
    rest = rest.replace(/^\./, '');
    return n ? `${n}행${rest ? ` ${rest}` : ''}` : path;
  }
  return { json: errors.length ? null : json, errors, rowOfPath };
}

const quote = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r;\t]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Dataset → CSV text with a UTF-8 BOM (so Excel opens Korean correctly). One row per server / empty rack / empty floor. */
export function datasetToCsv(data) {
  const keys = COLUMNS.map(([k]) => k);
  const lines = [keys.join(',')];
  const push = (o) => lines.push(keys.map((k) => quote(o[k])).join(','));
  for (const dc of data.datacenters)
    for (const f of dc.floors) {
      const fl = { dc_id: dc.id, dc_name: dc.name, floor_id: f.id, floor_level: f.level, floor_rows: f.rows, floor_cols: f.cols };
      if (!f.racks.length) push(fl);
      for (const r of f.racks) {
        const rk = { ...fl, rack_id: r.id, rack_row: r.row, rack_col: r.col, total_u: r.total_u };
        if (!r.servers.length) push(rk);
        for (const s of r.servers)
          push({
            ...rk,
            server_id: s.id,
            hostname: s.hostname,
            ip: s.ip,
            unit: s.unit,
            height_u: s.height_u,
            services: (s.services || [])
              .map((v) => [v.name, v.team ?? '', v.status ?? ''].join('|').replace(/\|+$/, ''))
              .join('; '),
          });
      }
    }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
