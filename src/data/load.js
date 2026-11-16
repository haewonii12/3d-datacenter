import { validate, normalize } from './schema.js';
import { csvToDataset, decodeBytes } from './csv.js';

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
 * @returns {Promise<{data: any|null, fatal: {path:string,message:string}[], warnings: {path:string,message:string}[], info: {missingHeightU:number}}>}
 */
export async function loadDataset(url) {
  const fail = (message) => ({
    data: null,
    fatal: [{ path: url, message }],
    warnings: [],
    info: { missingHeightU: 0 },
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

/** Validates + normalizes a dataset given as JSON text (uploaded file, fetched body). Same result shape as loadDataset. */
export function parseDataset(text, source = 'file') {
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { data: null, fatal: [{ path: source, message: `JSON parse error: ${e && e.message ? e.message : e}` }], warnings: [], info: { missingHeightU: 0 } };
  }
  return checkDataset(json);
}

/** Validates + normalizes an already-parsed dataset object. */
export function checkDataset(json) {
  const { fatal, warnings, info } = validate(json);
  return { data: fatal.length ? null : normalize(json), fatal, warnings, info };
}

/** True for files handled as CSV (Excel "CSV", "CSV UTF-8", tab-separated text). */
export const isCsvName = (name) => /\.(csv|tsv|txt)$/i.test(name || '');

/**
 * CSV bytes → same result shape as parseDataset. Row-level problems are fatal ("5행 unit …");
 * validator paths are mapped back to CSV rows so messages point at the spreadsheet.
 */
export function parseCsvDataset(bytes, source = 'file.csv') {
  const { json, errors, rowOfPath } = csvToDataset(decodeBytes(bytes));
  if (!json) return { data: null, fatal: errors, warnings: [], info: { missingHeightU: 0 } };
  const r = checkDataset(json);
  const map = (list) => list.map((x) => ({ ...x, path: `${source} ${rowOfPath(x.path)}` }));
  return { ...r, fatal: map(r.fatal), warnings: map(r.warnings) };
}
