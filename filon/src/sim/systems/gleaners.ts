// gleaners.ts — the Gleaners' nights (D103; owner, 2026-10-17: « pendant la nuit, un petit peuple
// alien du désert peut parcourir le désert et venir prendre certains items qui sont sur les tapis.
// Mais ils restent dans le désert uniquement, et ne viennent pas dans le cirque, ils ne montent pas
// les montagnes. Le joueur peut débloquer des sécurités pour cela »).
//
// Where they walk is the land's (sim/world/reach.ts, compiled with the graph); how they take is the
// ribbons' (sim/flow/chain.ts `gleanStep`, inside the flow phases, so the catch-up computes the same
// losses: offline.md). This system holds the rest, as statistics — never hashed, never a command:
// - the clock: they are out in the dark hours (`gleanNight`: the sun at or under `BAL.gleaners.darkSun`),
//   a world-clock input that changes only at a minute boundary, like the sun;
// - the night's tally: at dusk the lifetime count (`Sim.gleaned`) is noted (`dusk`), at dawn too
//   (`dawn`), and what was taken between is reported (`gleaners` event, `dawn`: the morning report)
//   and kept through the day (`takenSince`: the night so far, or the last one) — the same call
//   online and in the catch-up (`gleanEpoch`), both exact;
// - their first take of a night (`night` event, online at once, in a catch-up at the boundary): the
//   notice that introduces them, once per base (the UI remembers);
// - the marks on the lines (`marks`: tile → milli-items taken there since dusk), from each theft
//   online, and from each group's regime offline (`markTaken`, at its most exposed chain);
// - the last thefts (`recent`, tile, item, tick: online only) for the views' figures.
// Nothing vanishes unseen (CLAUDE.md, ARCHITECTURE.md §2): every item taken is counted here.
import { BAL } from '@/content/balance';
import { N_ITEMS } from '@/content/registry';
import { EPOCH } from '../constants';
import { sunPermille } from '../power/network';
import type { Sim } from '../state';

export interface GleanState {
  /** `Sim.gleaned` at the last nightfall (null: none yet — a base founded by day, or at night). Saved. */
  dusk: Float64Array | null;
  /** `Sim.gleaned` at the last dawn, after that nightfall (null: it is night, or no dawn yet). Saved. */
  dawn: Float64Array | null;
  /** Milli-items taken per ribbon tile since dusk (kept through the day until the next nightfall). Saved. */
  marks: Map<number, number>;
  /** They have struck this night (the `night` event is out). Not saved: a reload may tell it again, the UI says it once. */
  struck: boolean;
  /** Online: the last thefts, flat (tile, item, tick), oldest first — the views' figures. Not saved. */
  recent: number[];
}

export const newGleanState = (): GleanState => ({ dusk: null, dawn: null, marks: new Map(), struck: false, recent: [] });

/** How many thefts `recent` keeps (the views draw a figure for each one still under way). */
const RECENT = 48;

/** Are the Gleaners out in this world minute (D103)? The dark hours: the sun at or under `darkSun`. */
export function gleanNight(absEpoch: number): boolean {
  return sunPermille(absEpoch) <= BAL.gleaners.darkSun;
}

/** Before the flow phases (online): are they out this tick? */
export function gleanBefore(sim: Sim): void {
  sim.ctx.glean = gleanNight(sim.absEpoch()) ? 1 : 0;
  if (!sim.ctx.gleanLog) sim.ctx.gleanLog = [];
}

/** After the flow phases (online): this tick's thefts onto the lines' marks and the views' list; the night's first one told. */
export function gleanAfter(sim: Sim): void {
  const log = sim.ctx.gleanLog;
  if (!log || !log.length) return;
  const st = sim.gleaners;
  for (let i = 0; i + 2 < log.length; i += 3) {
    const tile = log[i]!;
    st.marks.set(tile, (st.marks.get(tile) ?? 0) + 1000);
    st.recent.push(tile, log[i + 1]!, log[i + 2]!);
  }
  log.length = 0;
  if (st.recent.length > RECENT * 3) st.recent.splice(0, st.recent.length - RECENT * 3);
  if (!st.struck) {
    st.struck = true;
    sim.events.push({ k: 'gleaners', what: 'night', taken: takenSince(sim) });
  }
}

/** What the Gleaners took in the night (item, milli-items), by item: the night so far, or by day the last one. */
export function takenSince(sim: Sim): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const from = sim.gleaners.dusk, to = sim.gleaners.dawn ?? sim.gleaned;
  for (let i = 0; i < N_ITEMS; i++) {
    const mu = to[i]! - (from ? from[i]! : 0);
    if (mu > 0) out.push([i, mu]);
  }
  return out;
}

/**
 * A minute boundary (online from `step`, offline from the catch-up: the same call, after the
 * expertises). Nightfall notes the count and clears the lines' marks; dawn reports the night. A
 * catch-up tells the night's first take here (online it is told at once, `gleanAfter`).
 */
export function gleanEpoch(sim: Sim): void {
  if (sim.tick % EPOCH !== 0) return;
  const e = sim.absEpoch();
  const was = gleanNight(e - 1), is = gleanNight(e);
  const st = sim.gleaners;
  if (was && !st.struck && takenSince(sim).length) {
    st.struck = true;
    sim.events.push({ k: 'gleaners', what: 'night', taken: takenSince(sim) });
  }
  if (!was && is) {
    st.dusk = sim.gleaned.slice();
    st.dawn = null;
    st.marks.clear();
    st.struck = false;
  } else if (was && !is) {
    st.dawn = sim.gleaned.slice();
    const taken = takenSince(sim);
    if (taken.length) sim.events.push({ k: 'gleaners', what: 'dawn', taken });
    st.struck = false;
  }
}

/** The catch-up's takings of one group (D103): counted, and marked on its most exposed line. */
export function markTaken(sim: Sim, tile: number, item: number, mu: number): void {
  sim.gleaned[item] = sim.gleaned[item]! + mu;
  if (tile >= 0) sim.gleaners.marks.set(tile, (sim.gleaners.marks.get(tile) ?? 0) + mu);
}
