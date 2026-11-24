// CSV (Excel) ⇄ dataset. Pure: no DOM, no three.
// One row = one device (records.js FIELDS). A row with only build/floorspace/rack declares an empty rack.
// A multi-cell rack writes its floorspace list in one quoted cell: "3A0401,3A0402".

import { FIELDS, recordsToDataset, datasetToRecords } from './records.js';

/** Canonical columns, in export order, with accepted header aliases (compared after normalizeHeader). */
export const COLUMNS = [
  ['build_name', ['빌딩', '건물', '데이터센터', 'idc', 'build']],
  ['floorspace_name', ['floorspace', '상면', '상면명', '위치']],
  ['company', ['회사', '고객사', '회사명']],
  ['rack_name', ['랙', '랙이름', '랙명', 'rack']],
  ['device_position', ['장착위치', '유닛위치', 'position']],
  ['device_name', ['장비', '장비명', '장비이름', 'device']],
  ['total_u', ['랙u', '전체u', 'totalu']],
];
const REQUIRED = ['build_name', 'floorspace_name', 'rack_name'];

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

/**
 * CSV text → records (one per non-blank data row) with their Excel row numbers, or header errors.
 * @returns {{records:object[], rows:number[], errors:{path:string,message:string}[]}}
 */
export function csvToRecords(text) {
  const errors = [];
  const rows = parseCsv(text)
    .map((cells, i) => ({ cells, n: i + 1 }))
    .filter(({ cells }) => cells.some((c) => !blank(c)));
  if (!rows.length) {
    errors.push({ path: 'CSV', message: '내용이 없습니다' });
    return { records: [], rows: [], errors };
  }
  const header = rows[0].cells.map((h) => ALIAS.get(normalizeHeader(h)) ?? null);
  const missing = REQUIRED.filter((k) => !header.includes(k));
  if (missing.length) {
    errors.push({ path: `${rows[0].n}행 (헤더)`, message: `필수 열이 없습니다: ${missing.join(', ')}. 첫 행은 열 이름이어야 합니다` });
    return { records: [], rows: [], errors };
  }
  const records = [];
  const nums = [];
  for (const { cells, n } of rows.slice(1)) {
    const r = {};
    header.forEach((k, ci) => {
      if (k) r[k] = (cells[ci] ?? '').trim();
    });
    records.push(r);
    nums.push(n);
  }
  if (!records.length) errors.push({ path: 'CSV', message: '데이터 행이 없습니다' });
  return { records, rows: nums, errors };
}

/** CSV text → {json, fatal, warnings} like recordsToDataset; issues carry the Excel row. */
export function csvToDataset(text) {
  const { records, rows, errors } = csvToRecords(text);
  if (errors.length) return { json: null, fatal: errors, warnings: [] };
  return recordsToDataset(records, { rowOf: (i) => rows[i] });
}

const quote = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r;\t]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Dataset → CSV text with a UTF-8 BOM (so Excel opens Korean correctly). One row per device / empty rack. */
export function datasetToCsv(data) {
  const records = datasetToRecords(data);
  const keys = FIELDS.filter((k) => k !== 'total_u' || records.some((r) => r.total_u));
  const lines = [keys.join(',')];
  for (const r of records) lines.push(keys.map((k) => quote(r[k])).join(','));
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}
