// save.ts — versioned localStorage persistence with a migration seam. Generic so the
// scoring layer (and anything else) can persist a typed blob safely in private mode.

const storage: Storage | null =
  typeof localStorage !== 'undefined' ? localStorage : null;

export interface Store<T> {
  load(): T;
  save(value: T): void;
  clear(): void;
}

interface Versioned {
  version: number;
}

/**
 * Build a typed, versioned store backed by localStorage.
 * On a version mismatch or any parse/quota error we fall back to `fresh()`,
 * so a broken or stale blob never crashes the journey.
 */
export function makeStore<T extends Versioned>(
  key: string,
  version: number,
  fresh: () => T,
): Store<T> {
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
