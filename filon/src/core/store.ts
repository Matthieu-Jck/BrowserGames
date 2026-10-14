// store.ts — small versioned localStorage store (agora's makeStore) for SETTINGS only.
// Falling back to fresh() is fine for settings; the colony itself never resets silently
// (see persist/), because a player has exactly one colony.

const storage: Storage | null = (() => {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
})();

export interface Store<T> {
  load(): T;
  save(value: T): void;
  clear(): void;
}

interface Versioned { version: number }

export function makeStore<T extends Versioned>(key: string, version: number, fresh: () => T): Store<T> {
  return {
    load(): T {
      try {
        const raw = storage?.getItem(key);
        if (!raw) return fresh();
        const parsed = JSON.parse(raw) as T;
        if (parsed.version !== version) return fresh();
        return { ...fresh(), ...parsed };
      } catch {
        return fresh();
      }
    },
    save(value: T): void {
      try { storage?.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
    },
    clear(): void {
      try { storage?.removeItem(key); } catch { /* noop */ }
    },
  };
}

/** Raw synchronous key write (used for the lastseen marker on pagehide). */
export function writeRaw(key: string, value: string): void {
  try { storage?.setItem(key, value); } catch { /* noop */ }
}

export function readRaw(key: string): string | null {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}
