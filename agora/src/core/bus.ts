// bus.ts — tiny typed event bus: the seam between journey logic, the canvas
// renderers, the DOM UI and persistence. Nothing reaches into another module's
// internals; they talk through these events.
import type { BeatKind, SceneId, Severity } from './kinds';

export interface GameEvents {
  // journey progression
  'beat:entered': { chapter: number; beatId: string; kind: BeatKind };
  'predict:locked': { beatId: string; value: number };
  'reveal': { beatId: string };
  'verdict': { beatId: string; severity: Severity; metric: string };
  'challenge:scored': { beatId: string; stars: number; score: number };
  'journey:complete': void;

  // render / presentation
  'scene:set': { id: SceneId };
  'accent:set': { color: string };
  'sandbox:changed': { key: string; value: number };

  // persistence
  'progress:changed': void;
}

type Handler<T> = (payload: T) => void;

class EventBus {
  private handlers = new Map<string, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(ev: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(ev);
    if (!set) { set = new Set(); this.handlers.set(ev, set); }
    set.add(fn as Handler<unknown>);
    return () => set!.delete(fn as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(
    ev: K,
    ...args: GameEvents[K] extends void ? [] : [GameEvents[K]]
  ): void {
    const set = this.handlers.get(ev);
    if (!set) return;
    for (const fn of [...set]) fn(args[0]);
  }
}

export const bus = new EventBus();
