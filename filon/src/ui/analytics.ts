// analytics.ts — what the Analytics path of the tech tree shows (D41), in one place for the
// HUD, the stats screen and the hotkeys:
//   · `analyticsOn(sim, feature)`: is a readout unlocked? Each analytics plan turns on its own
//     flag (`ANALYTICS` in content/research.ts): the HUD's rates (telemetry), the Statistics
//     screen and its HUD chip (statistics), the power history in it (power_log), the machines'
//     states in it (diagnostics), the Vent view and the wind's readings (anemometry, D95). Nothing
//     else reads those flags.
//   · `ANALYTICS_REVEALS`: what the spotlight (focus.ts) lifts out when an analytics plan is
//     unlocked — a `[data-…]` hook of the HUD — and CrierBelt's line for it.
//   · `UnlockWatch`: which plans are newly done since the last look; the first look at a colony
//     is its baseline, so a base loaded or swapped in does not replay its reveals.
//   · `machineStates(sim)`: the working buildings by state, worst first — the Diagnostics readout.
// Pure (no DOM): tested in node (analytics.test.ts).
import { ANALYTICS, type AnalyticsFeature } from '@/content/research';
import { BUILDING_KIND } from '@/content/registry';
import type { BuildingKind } from '@/content/types';
import type { MsgKey } from '@/i18n/i18n';
import type { Sim } from '@/sim/state';
import { St } from '@/sim/types';

/** Is this analytics readout unlocked (its plan taken)? */
export const analyticsOn = (sim: Pick<Sim, 'mods'>, f: AnalyticsFeature): boolean => sim.mods.flags.has(ANALYTICS[f]);

/** A reveal: the element lifted out of the dimmed base (a selector, resolved when it plays) and CrierBelt's line. */
export interface AnalyticsReveal { readonly target: string; readonly caption: MsgKey }

/** One per analytics plan (checked by analytics.test.ts): the rates on the Stock button, the rest on the Statistics chip. */
export const ANALYTICS_REVEALS: Readonly<Record<string, AnalyticsReveal>> = {
  telemetry: { target: '[data-hud-stock]', caption: 'focus.telemetry' }, // the Stock button: the rates live in its panel (D96)
  statistics: { target: '[data-hud-stats]', caption: 'focus.statistics' },
  power_log: { target: '[data-hud-stats]', caption: 'focus.power_log' },
  diagnostics: { target: '[data-hud-stats]', caption: 'focus.diagnostics' },
  anemometry: { target: '[data-hud-wind]', caption: 'focus.anemometry' }, // the Vent view's button (D95)
};

/** Which of `ids` became done since the last look. The first look at a colony (or a new one) only takes the baseline. */
export class UnlockWatch {
  private colony: object | null = null;
  private seen = new Set<string>();

  constructor(private readonly ids: readonly string[]) {}

  fresh(sim: { readonly done: ReadonlySet<string> }): string[] {
    if (sim !== this.colony) {
      this.colony = sim;
      this.seen = new Set(this.ids.filter((id) => sim.done.has(id)));
      return [];
    }
    const out = this.ids.filter((id) => sim.done.has(id) && !this.seen.has(id));
    for (const id of out) this.seen.add(id);
    return out;
  }
}

// ── Diagnostics: the machines' states ───────────────────────────────────────

/** A working building's state, as the inspector's status line reads it (`unlinked`: unpowered because no wire reaches it). */
export type MachineState = 'unlinked' | 'unpowered' | 'nofuel' | 'starved' | 'blocked' | 'nojob' | 'lowpower' | 'ok' | 'idle' | 'building' | 'dormant';

/** Display order, worst first: what stops a machine, then what slows it, then the rest. */
export const MACHINE_STATES: readonly MachineState[] = ['unlinked', 'unpowered', 'nofuel', 'starved', 'blocked', 'nojob', 'lowpower', 'ok', 'idle', 'building', 'dormant'];

/** The kinds that do work and report a state: machines, drills, pumps, generators, observatories. */
const WORKING: ReadonlySet<BuildingKind> = new Set<BuildingKind>(['machine', 'drill', 'pump', 'generator', 'lab']);

const OF_STATUS: Record<number, MachineState> = {
  [St.Ok]: 'ok', [St.Starved]: 'starved', [St.Blocked]: 'blocked', [St.Unpowered]: 'unpowered', [St.NoJob]: 'nojob',
  [St.Idle]: 'idle', [St.LowPower]: 'lowpower', [St.NoFuel]: 'nofuel', [St.Building]: 'building', [St.Dormant]: 'dormant',
};

/** One state's count, and how many of each building kind (by def index) are in it. */
export interface StateCount { state: MachineState; n: number; defs: Map<number, number> }

/** The base's working buildings by state, in `MACHINE_STATES` order, empty states left out. */
export function machineStates(sim: Sim): StateCount[] {
  const by = new Map<MachineState, StateCount>();
  for (const e of sim.ents.sorted()) {
    if (!WORKING.has(BUILDING_KIND[e.def] as BuildingKind)) continue;
    const node = sim.graph?.nodeByEnt.get(e.id);
    const st = e.builtAt !== 0 ? St.Building : sim.isDormant(e) ? St.Dormant : node ? node.status : St.Ok;
    const s: MachineState = st === St.Unpowered && sim.graph?.netOfEnt.get(e.id) === undefined ? 'unlinked' : OF_STATUS[st] ?? 'ok';
    let c = by.get(s);
    if (!c) by.set(s, (c = { state: s, n: 0, defs: new Map() }));
    c.n++;
    c.defs.set(e.def, (c.defs.get(e.def) ?? 0) + 1);
  }
  return MACHINE_STATES.filter((s) => by.has(s)).map((s) => by.get(s)!);
}
