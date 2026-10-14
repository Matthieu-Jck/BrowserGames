// debug-bases.ts — the debug bases' shell side (the main menu's « Débogage » page, FL.debugSave):
// a ready-made base at some stage of the game, built on the player's own land by
// src/sim/scenarios.ts, swapped in for the player's base — and the way back.
//
// The player's base is never touched (D1: one persistent base, saves are sacred). Loading a debug
// base keeps the player's Sim aside exactly as it stands — frozen: no tick, no command reaches it
// while it is aside — and swaps the debug base in (`App.setSim`); « Revenir à ma concession »
// swaps that very object back, so it comes back as it was left (same hash). Loading another level
// from a debug base replaces only the debug base. Nothing is saved today (no persistence before
// M7); when it lands, its autosave must write `realSim()` — the player's base, aside or in play —
// and never `app.sim` while a debug base is in, and boot must never load a debug base. While one
// is in, a badge stays on screen (ui/screens/menu.ts, `DebugBadge`), and its statistics history is
// its own: the player's is put back on return.
import { foundScenario, SCENARIO_IDS, type ScenarioId, type ScenarioReport } from '@/sim/scenarios';
import type { Sim } from '@/sim/state';
import type { Sample } from '@/ui/stats';
import { t } from '@/i18n/i18n';
import type { App } from './app';

export interface DebugBases {
  /** The levels offered, by advancement. */
  readonly levels: readonly ScenarioId[];
  /** The debug base on screen (null: the player's own base). */
  current(): ScenarioId | null;
  /** Build level `id` on the player's land and swap it in (the player's base kept aside); what the build did and how long it took (ms). */
  load(id: ScenarioId): { report: ScenarioReport; ms: number };
  /** Back to the player's own base, exactly as it was left. False when it is already in play. */
  restore(): boolean;
  /** The player's own base, in play or kept aside: the one persistence saves (M7), never a debug base. */
  realSim(): Sim;
}

/** Install the debug bases on the app; `changed` is called after every swap (the menu and the badge redraw). */
export function installDebugBases(app: App, changed: () => void): DebugBases {
  /** The player's base while a debug base is in (null: it is `app.sim`). */
  let real: Sim | null = null;
  let level: ScenarioId | null = null;
  /** The player's statistics history, kept with the base. */
  let history: { fine: Sample[]; coarse: Sample[] } | null = null;

  const swapIn = (sim: Sim): void => {
    app.setSim(sim);
    // The intro hides the Heart of an unnamed base until it lands (app/intro.ts): every debug base is named.
    app.buildings.show(sim.hearthId);
    if (app.lights.hidden.delete(sim.hearthId)) app.lights.rebuild(sim);
  };

  return {
    levels: SCENARIO_IDS,
    current: () => level,
    load: (id) => {
      const own = real ?? app.sim;
      const t0 = performance.now();
      const { sim, report } = foundScenario(id, {
        playerSeed: own.playerSeed,
        near: own.absEpoch(),
        name: t('debug.claimName', { n: SCENARIO_IDS.indexOf(id) + 1 }),
      });
      const ms = Math.round(performance.now() - t0);
      // What happened while it was built is its history, not news: no toasts or cues for it.
      sim.events.length = 0;
      if (!real) {
        real = app.sim;
        history = { fine: app.stats.fine.slice(), coarse: app.stats.coarse.slice() };
      }
      level = id;
      swapIn(sim);
      changed();
      return { report, ms };
    },
    restore: () => {
      if (!real) return false;
      const own = real;
      real = null;
      level = null;
      swapIn(own);
      if (history) { app.stats.fine.push(...history.fine); app.stats.coarse.push(...history.coarse); history = null; }
      changed();
      return true;
    },
    realSim: () => real ?? app.sim,
  };
}
