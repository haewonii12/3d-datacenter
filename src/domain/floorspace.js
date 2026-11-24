// Floor-space cell codes and rack-cell rules. Pure: no DOM, no three.
// A code is `{floor 1 digit}{zone A-Z}{row 2 digits}{seq 2 digits}`: `3A0401` = 3층 A구역 4번째 줄 1번 칸.
// A rack occupies one or more cells written as a comma list (`3A0401,3A0402`); two racks never share a cell.

const CODE = /^(\d)([A-Z])(\d{2})(\d{2})$/;
const pad2 = (n) => String(n).padStart(2, '0');

/** @typedef {{code:string, floor:number, zone:string, row:number, seq:number}} Cell */

/** @returns {Cell|null} */
export function parseFloorspace(code) {
  const m = CODE.exec(String(code ?? '').trim().toUpperCase());
  if (!m) return null;
  const row = Number(m[3]);
  const seq = Number(m[4]);
  if (row < 1 || seq < 1) return null;
  return { code: m[0], floor: Number(m[1]), zone: m[2], row, seq };
}

export const formatFloorspace = ({ floor, zone, row, seq }) => `${floor}${zone}${pad2(row)}${pad2(seq)}`;

/** Splits a comma list into codes (blank entries dropped). */
export const splitFloorspaces = (value) =>
  (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map((s) => String(s).trim().toUpperCase())
    .filter(Boolean);

/**
 * @param {string|string[]} value `3A0401,3A0402` or an array of codes
 * @returns {{cells:Cell[], invalid:string[]}} valid cells sorted by seq
 */
export function parseFloorspaces(value) {
  const cells = [];
  const invalid = [];
  for (const code of splitFloorspaces(value)) {
    const c = parseFloorspace(code);
    if (c) cells.push(c);
    else invalid.push(code);
  }
  cells.sort((a, b) => a.floor - b.floor || a.zone.localeCompare(b.zone) || a.row - b.row || a.seq - b.seq);
  return { cells, invalid };
}

export const cellKey = (c) => `${c.floor}${c.zone}${pad2(c.row)}-${pad2(c.seq)}`;

/** True when all cells are on one floor/zone/row with consecutive, distinct seq numbers. */
export function isContiguous(cells) {
  if (!cells.length) return false;
  const [first] = cells;
  return cells.every(
    (c, i) => c.floor === first.floor && c.zone === first.zone && c.row === first.row && c.seq === first.seq + i,
  );
}

/** `3A0401` or `3A0401–03` for a contiguous span; otherwise the codes joined by `,`. */
export function spanLabel(cells) {
  if (!cells.length) return '';
  if (cells.length === 1) return cells[0].code;
  if (isContiguous(cells)) return `${cells[0].code}–${pad2(cells[cells.length - 1].seq)}`;
  return cells.map((c) => c.code).join(',');
}

/**
 * Rack-cell rules over the racks of one floor (or one DC).
 * - `rack-cell-conflict`: a cell used by two racks → both racks flagged (both kept).
 * - `rack-noncontiguous`: a rack's cells are not one consecutive run of a row.
 * @param {{id:string, cells:Cell[]}[]} racks
 * @returns {{kind:string, message:string, racks:string[]}[]}
 */
export function checkRackCells(racks) {
  const issues = [];
  const owner = new Map(); // cellKey -> rack id
  for (const rack of racks) {
    if (rack.cells.length > 1 && !isContiguous(rack.cells)) {
      issues.push({
        kind: 'rack-noncontiguous',
        message: `랙 ${rack.id}의 칸(${rack.cells.map((c) => c.code).join(',')})이 같은 줄에 연속되어 있지 않습니다`,
        racks: [rack.id],
      });
    }
    for (const c of rack.cells) {
      const k = cellKey(c);
      const other = owner.get(k);
      if (other === undefined) owner.set(k, rack.id);
      else if (other !== rack.id) {
        issues.push({ kind: 'rack-cell-conflict', message: `칸 ${c.code}을(를) 랙 ${other}와(과) ${rack.id}이(가) 함께 사용합니다`, racks: [other, rack.id] });
      }
    }
  }
  return issues;
}

/** Empty grid columns between two zones of a floor. */
export const ZONE_GAP = 2;

/**
 * Floor grid from its racks' cells: zones side by side in alphabetical order, each zone
 * `rows × cols` = max row × max seq of its cells, separated by ZONE_GAP empty columns.
 * @param {Cell[][]} cellLists cells of each rack on the floor
 * @returns {{zones:{id:string, colOffset:number, rows:number, cols:number}[], rows:number, cols:number}}
 */
export function layoutZones(cellLists) {
  const ext = new Map(); // zone -> {rows, cols}
  for (const cells of cellLists)
    for (const c of cells) {
      const z = ext.get(c.zone) || ext.set(c.zone, { rows: 0, cols: 0 }).get(c.zone);
      z.rows = Math.max(z.rows, c.row);
      z.cols = Math.max(z.cols, c.seq);
    }
  const zones = [];
  let offset = 0;
  for (const id of [...ext.keys()].sort()) {
    const { rows, cols } = ext.get(id);
    zones.push({ id, colOffset: offset, rows, cols });
    offset += cols + ZONE_GAP;
  }
  const last = zones[zones.length - 1];
  return {
    zones,
    rows: Math.max(1, ...zones.map((z) => z.rows)),
    cols: last ? last.colOffset + last.cols : 1,
  };
}

/**
 * Grid placement of a rack (row/col of its first cell, span = seq extent on that row).
 * @returns {{zone:string, row:number, col:number, span:number}}
 */
export function placeRack(zones, cells) {
  const [first] = cells;
  const z = zones.find((x) => x.id === first.zone);
  const sameRow = cells.filter((c) => c.zone === first.zone && c.row === first.row);
  const lo = Math.min(...sameRow.map((c) => c.seq));
  const hi = Math.max(...sameRow.map((c) => c.seq));
  return { zone: first.zone, row: first.row, col: (z ? z.colOffset : 0) + lo, span: hi - lo + 1 };
}

/** Cell under a grid slot, or null in a zone gap / outside. */
export function cellAt(floor, row, col) {
  for (const z of floor.zones || []) {
    const seq = col - z.colOffset;
    if (seq >= 1 && seq <= z.cols && row >= 1 && row <= z.rows) {
      return { code: formatFloorspace({ floor: floor.level, zone: z.id, row, seq }), floor: floor.level, zone: z.id, row, seq };
    }
  }
  return null;
}
