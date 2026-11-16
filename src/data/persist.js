// Saved dataset in IndexedDB (the sample is ~3 MB, too close to localStorage's ~5 MB quota).
// One record: {data, source, savedAt}. Every call resolves (never rejects); failures come back as values.

const DB = 'dc-rack-3d';
const STORE = 'dataset';
const KEY = 'current';

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** @returns {Promise<{data:any, source:string, savedAt:string}|null>} */
export async function loadSaved() {
  try {
    return (await run('readonly', (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

/** @returns {Promise<string|null>} null on success, else an error message */
export async function save(data, source) {
  try {
    await run('readwrite', (s) => s.put({ data, source, savedAt: new Date().toISOString() }, KEY));
    return null;
  } catch (e) {
    return String(e?.message ?? e);
  }
}

export async function clearSaved() {
  try {
    await run('readwrite', (s) => s.delete(KEY));
  } catch {
    /* nothing saved */
  }
}
