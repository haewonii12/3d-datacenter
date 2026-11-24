import { validate, normalize } from './schema.js';
import { csvToDataset, decodeBytes } from './csv.js';
import { recordsToDataset } from './records.js';
import { checkSites } from '../domain/sites.js';

const EMPTY_INFO = { invalidPositions: 0 };

/**
 * @param {string} search e.g. location.search
 * @returns {string}
 */
export function resolveDataUrl(search) {
  const override = new URLSearchParams(search || '').get('data');
  if (override) return override;
  const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
  return `${base.endsWith('/') ? base : base + '/'}data/datacenter.json`;
}

/**
 * @param {string} url
 * @returns {Promise<{data: any|null, fatal: {path:string,message:string}[], warnings: {path:string,message:string}[], info: {invalidPositions:number}}>}
 */
export async function loadDataset(url) {
  const fail = (message) => ({
    data: null,
    fatal: [{ path: url, message }],
    warnings: [],
    info: EMPTY_INFO,
  });
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    return fail(`fetch failed: ${e && e.message ? e.message : e}`);
  }
  if (!res.ok) return fail(`HTTP ${res.status} ${res.statusText || ''}`.trim());
  return parseDataset(await res.text(), url);
}

/**
 * Records (field format, one row per device) → validated dataset. `rowLabel(n)` renders an issue's row
 * ("5행" for CSV, "#5" for a JSON array), so every message points back at the source.
 */
function fromRecords(conv, source, rowLabel) {
  const where = (x) => ({ ...x, path: x.row != null ? `${source} ${rowLabel(x.row)}` : `${source} ${x.path}` });
  if (!conv.json) return { data: null, fatal: conv.fatal.map(where), warnings: conv.warnings.map(where), info: EMPTY_INFO };
  const r = checkDataset(conv.json);
  return { ...r, fatal: r.fatal.map(where), warnings: [...conv.warnings, ...r.warnings].map(where) };
}

/**
 * JSON text → dataset. A top-level array is the field-record format; an object is a stored v3 tree.
 */
export function parseDataset(text, source = 'file') {
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { data: null, fatal: [{ path: source, message: `JSON parse error: ${e && e.message ? e.message : e}` }], warnings: [], info: EMPTY_INFO };
  }
  if (Array.isArray(json)) return fromRecords(recordsToDataset(json), source, (n) => `#${n}`);
  return checkDataset(json);
}

/** Validates + normalizes an already-parsed v3 tree. */
export function checkDataset(json) {
  const { fatal, warnings, info } = validate(json);
  if (fatal.length) return { data: null, fatal, warnings, info };
  const data = normalize(json);
  return { data, fatal, warnings: [...warnings, ...checkSites(data)], info };
}

/** True for files handled as CSV (Excel "CSV", "CSV UTF-8", tab-separated text). */
export const isCsvName = (name) => /\.(csv|tsv|txt)$/i.test(name || '');

/** CSV bytes → same result shape as parseDataset; messages cite the Excel row ("file.csv 5행"). */
export function parseCsvDataset(bytes, source = 'file.csv') {
  return fromRecords(csvToDataset(decodeBytes(bytes)), source, (n) => `${n}행`);
}
