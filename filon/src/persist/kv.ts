// kv.ts — the little key-value store the saves live in: IndexedDB in the browser, a Map in the
// tests (vitest runs in Node, without IndexedDB). Values are structured-cloned either way, so
// what a test reads back is what the browser would.

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** In memory (tests, and the fallback when IndexedDB is refused: private windows, blocked storage). */
export class MemoryKV implements KV {
  private readonly m = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { const v = this.m.get(key); return v === undefined ? undefined : (structuredClone(v) as T); }
  async put(key: string, value: unknown): Promise<void> { this.m.set(key, structuredClone(value)); }
  async del(key: string): Promise<void> { this.m.delete(key); }
  async keys(): Promise<string[]> { return [...this.m.keys()].sort(); }
  /** Tests: reach in and damage a stored value. */
  raw(key: string): unknown { return this.m.get(key); }
}

const STORE = 'saves';

const done = <T>(r: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

/** The IndexedDB database `name` (one object store, out-of-line keys). */
export async function openIdb(name: string): Promise<KV> {
  const req = indexedDB.open(name, 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
  const db = await done(req);
  const tx = (mode: IDBTransactionMode): IDBObjectStore => db.transaction(STORE, mode).objectStore(STORE);
  // A write resolves once its transaction has committed (not merely when the request succeeded).
  const write = (f: (s: IDBObjectStore) => IDBRequest): Promise<void> => new Promise((resolve, reject) => {
    const s = tx('readwrite');
    f(s);
    s.transaction.oncomplete = () => resolve();
    s.transaction.onerror = () => reject(s.transaction.error);
    s.transaction.onabort = () => reject(s.transaction.error);
  });
  return {
    get: <T>(key: string) => done(tx('readonly').get(key)) as Promise<T | undefined>,
    put: (key, value) => write((s) => s.put(value, key)),
    del: (key) => write((s) => s.delete(key)),
    keys: async () => (await done(tx('readonly').getAllKeys())).map(String).sort(),
  };
}
