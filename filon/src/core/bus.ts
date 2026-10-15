// bus.ts — typed event bus (agora's pattern): the seam between the app shell, renderers,
// DOM UI and persistence. The sim never imports it — it returns events, the app re-emits.
import type { Locale, MapView, NotifyKind, ScreenId, ToolId, ViewMode } from './kinds';

/**
 * Sound cues: what just happened, as the ear should hear it. Anyone may emit `sfx`; the shell
 * (app/sound.ts) queues it and src/audio plays it (recipes in audio/sfx.ts, levels and rate
 * limits in audio/cues.ts). Generic cues (a click, a tab, a toast) give way to a specific one
 * answering the same moment. See docs/audio.md.
 */
export type SfxCue =
  | 'click' | 'tab' | 'select' | 'open' | 'close' | 'view'
  | 'toast.info' | 'toast.good' | 'toast.warn' | 'toast.bad'
  | 'place' | 'ribbon' | 'demolish' | 'refused' | 'mark' | 'link' | 'unlink'
  | 'research' | 'quest' | 'sale' | 'purchase' | 'lift' | 'delivered' | 'notice' | 'vein';

/**
 * The intro's beats, in order (D31; ui/screens/intro.ts, app/intro.ts): Verrière at dusk, the
 * investor, CrierBelt's answer, the company's name, the Heart's landing in the cirque.
 */
export type IntroPanel = 'city' | 'investor' | 'crierbelt' | 'name' | 'landing';

export interface GameEvents {
  /** Play a sound cue (`n`: how many — ribbon tiles laid, buildings removed). */
  'sfx': { cue: SfxCue; n?: number };
  'locale:changed': { locale: Locale };
  'screen:opened': { id: ScreenId };
  'screen:closed': { id: ScreenId };
  'tool:changed': { tool: ToolId | null; def: string | null };
  /** The specialised view on show changed (D88). */
  'mapview:changed': { view: MapView };
  'view:changed': { mode: ViewMode };
  'selection:changed': { entity: number | null };
  'notify': { kind: NotifyKind; key: string; params?: Record<string, string | number> };
  'sim:structure': void;           // something was placed/removed/reconfigured
  'sim:research-done': { id: string };
  'sim:epoch': { epoch: number };
  'save:done': { at: number };
  'catchup:progress': { done: number; total: number };
  // The intro (D31): hooks for the audio's cues. A beat shows (`index` 0–4, IntroPanel order;
  // 'landing': the Heart starts down from the Ring) · CrierBelt's « Accordé » stamp lands on
  // the contract · the Heart touches down · it is over (`skipped`: cut short by « Passer » / Esc).
  'intro:panel': { panel: IntroPanel; index: number };
  'intro:stamp': void;
  'intro:land': void;
  'intro:done': { skipped: boolean };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
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
