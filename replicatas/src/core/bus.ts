// bus.ts — tiny typed event bus: the seam between game logic, UI, 3D and audio.
import type { CombatEvent } from '@/combat/combat-types';

export interface GameEvents {
  'screen:entered': { screen: string };
  'run:changed': void;            // any RunState mutation the HUD should reflect
  'combat:events': { events: CombatEvent[] };
  'combat:over': { won: boolean };
  'sfx': { name: string };
  'music': { mood: string };
  'flash': { v: number };
  'shake': { v: number };
  'subtitle': { text: string; secs?: number };
  'log': { text: string; cls?: 'good' | 'bad' | 'warn' };
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

  emit<K extends keyof GameEvents>(ev: K, ...args: GameEvents[K] extends void ? [] : [GameEvents[K]]): void {
    const set = this.handlers.get(ev);
    if (!set) return;
    for (const fn of [...set]) fn(args[0]);
  }
}

export const bus = new EventBus();
