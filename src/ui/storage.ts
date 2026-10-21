// Lokale Speicherung mit IndexedDB. Fällt IndexedDB aus (z.B. privater Modus, Vorschau-Sandbox),
// läuft die App im Speicher weiter und zeigt das deutlich an.

const DB = 'trading-strategy-lab';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;
let memory: Record<string, unknown> = {};
export let storageMode: 'indexeddb' | 'memory' = 'indexeddb';

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
  return dbPromise;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  if (storageMode === 'memory') return memory[key] as T | undefined;
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve, reject) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result as T | undefined);
      r.onerror = () => reject(r.error);
    });
  } catch {
    storageMode = 'memory';
    return memory[key] as T | undefined;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  if (storageMode === 'memory') {
    memory[key] = value;
    return;
  }
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    storageMode = 'memory';
    memory[key] = value;
  }
}

export function resetMemory() {
  memory = {};
}
