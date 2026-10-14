// save.ts — versioned localStorage persistence for run + meta, with migration seams.
import type { RunState } from './run';
import type { MetaState } from './meta';
import { newMeta } from './meta';

const RUN_KEY = 'replicatas.run.v2';
const META_KEY = 'replicatas.meta.v2';

const storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null;

export function saveRun(run: RunState): void {
  try { storage?.setItem(RUN_KEY, JSON.stringify(run)); } catch { /* quota / private mode */ }
}

export function loadRun(): RunState | null {
  try {
    const raw = storage?.getItem(RUN_KEY);
    if (!raw) return null;
    const run = JSON.parse(raw) as RunState;
    if (run.version !== 2) return migrateRun(run);
    return run;
  } catch { return null; }
}

export function clearRun(): void {
  try { storage?.removeItem(RUN_KEY); } catch { /* noop */ }
}

export function saveMeta(meta: MetaState): void {
  try { storage?.setItem(META_KEY, JSON.stringify(meta)); } catch { /* noop */ }
}

export function loadMeta(): MetaState {
  try {
    const raw = storage?.getItem(META_KEY);
    if (!raw) return newMeta();
    const meta = JSON.parse(raw) as MetaState;
    if (meta.version !== 2) return migrateMeta(meta);
    return { ...newMeta(), ...meta };
  } catch { return newMeta(); }
}

export function wipeAll(): void {
  clearRun();
  try { storage?.removeItem(META_KEY); } catch { /* noop */ }
}

// migration chains — extend when the save format changes
function migrateRun(_old: unknown): RunState | null { return null; }
function migrateMeta(_old: unknown): MetaState { return newMeta(); }
