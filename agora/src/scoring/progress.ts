// progress.ts — persists the player's best result per beat/chapter, debounced to
// localStorage. The report card reads from here.
import { makeStore } from '@/core/save';
import { bus } from '@/core/bus';
import type { Progress } from './types';

const VERSION = 1;
const store = makeStore<Progress>('agora.progress.v1', VERSION, () => ({
  version: VERSION,
  beats: {},
  chapters: {},
  completed: false,
}));

let state: Progress = store.load();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  saveTimer = null;
  store.save(state);
}

function scheduleSave(): void {
  if (saveTimer != null) return;
  saveTimer = setTimeout(flush, 400);
}

export function getProgress(): Progress {
  return state;
}

/** Record stars for a beat, keeping the best, and roll it up to the chapter. */
export function recordBeat(beatId: string, chapter: number, stars: number): void {
  const prevBeat = state.beats[beatId] ?? -1;
  if (stars > prevBeat) state.beats[beatId] = stars;
  const prevChapter = state.chapters[chapter] ?? -1;
  if (stars > prevChapter) state.chapters[chapter] = stars;
  scheduleSave();
  bus.emit('progress:changed');
}

export function markComplete(): void {
  state.completed = true;
  scheduleSave();
  bus.emit('progress:changed');
}

export function wipeProgress(): void {
  store.clear();
  state = { version: VERSION, beats: {}, chapters: {}, completed: false };
  bus.emit('progress:changed');
}

/** Force a synchronous save (call on visibilitychange/pagehide). */
export function flushProgress(): void {
  if (saveTimer != null) clearTimeout(saveTimer);
  flush();
}
