// colony.ts — opening the player's base and keeping its clock (plan §7, §9). The base's world
// clock is its founding minute plus its ticks; the wall clock runs on while the tab is closed,
// hidden or behind, and the difference is "time owed": the offline catch-up (sim/offline) pays it
// with the same engine, exactly, before the player looks. Opening = the newest whole save that
// opens (a damaged one falls back to the next), migrated, re-pointed to today's content
// (save-remap.ts), rebuilt on its land — the map version it was founded on (`mapV`, D63; absent:
// map 1), never today's. A save from a newer build stops everything instead (a map version this
// build does not know throws too): an older build must never load it and then save over it.
import { SAVE_VERSION, deserialize, serialize, type SaveData } from '@/sim/serialize';
import { remapSave, type RemapNote } from '@/sim/save-remap';
import { catchUp } from '@/sim/offline/catchup';
import type { AwayReport } from '@/sim/offline/report';
import { TICK_MS } from '@/sim/constants';
import { MapGen } from '@/sim/world/mapgen';
import type { Sim } from '@/sim/state';
import { migrate, SaveTooNew } from './migrate';
import { unseal, type Envelope } from './envelope';
import type { SaveSlots, SlotKey } from './slots';

/** The wall-clock ms the base's world clock shows. */
export const worldMs = (sim: Sim): number => sim.foundingEpoch * 60_000 + sim.tick * TICK_MS;

/** Whole ticks the base is behind the wall clock (0 when it is ahead: debug ticking, a clock set back). */
export const owedTicks = (sim: Sim, now: number): number => Math.max(0, Math.floor((now - worldMs(sim)) / TICK_MS));

export interface Opened {
  sim: Sim;
  env: Envelope;
  slot: SlotKey;
  /** What today's content changed in it (shown to the player), or null. */
  note: RemapNote | null;
  /** The payload version it was migrated from, or null. */
  migratedFrom: number | null;
}

/** An envelope's base, rebuilt (no catch-up), on the land it was founded on. */
export async function rebuild(env: Envelope): Promise<{ sim: Sim; note: RemapNote | null; migratedFrom: number | null }> {
  const m = migrate(await unseal(env));
  const r = remapSave(m.data);
  const sim = deserialize(r.data, new MapGen(r.data.worldSeed, r.data.playerSeed, r.data.mapV ?? 1));
  return { sim, note: r.note, migratedFrom: m.from === SAVE_VERSION ? null : m.from };
}

/** The player's base from its newest save that opens, or null when there is none. */
export async function openSaved(slots: SaveSlots): Promise<Opened | null> {
  let failure: unknown = null;
  let failed: Envelope | null = null;
  for (const c of await slots.candidates()) {
    try {
      const { sim, note, migratedFrom } = await rebuild(c.env);
      // Whatever a load had to change is kept as it was first: a newer save that did not open
      // (the next save will go over its slot), else the original of a migrated or remapped one.
      if (failed) await slots.backup('pre-migration', failed);
      else if (note || migratedFrom !== null) await slots.backup('pre-migration', c.env);
      slots.adopt(c);
      return { sim, env: c.env, slot: c.slot, note, migratedFrom };
    } catch (e) {
      if (e instanceof SaveTooNew) throw e;
      failure ??= e;
      failed ??= c.env;
      console.warn(`Ocelle: the save in slot ${c.slot} does not open`, e);
    }
  }
  if (failure) throw failure; // whole saves that all fail to open: never found a new base over them
  return null;
}

/** Pay the time owed (the report, or null when nothing was owed). */
export function catchUpTo(sim: Sim, now: number): AwayReport | null {
  const n = owedTicks(sim, now);
  if (n <= 0) return null;
  const report = catchUp(sim, n);
  sim.checkQuests(); // the catch-up does not run `step`, where quests are checked
  return report;
}

/**
 * What the base will do if left alone for `ticks` (« Avant de partir »): the catch-up that will pay
 * that absence, run on a copy. The base itself is untouched; the copy's state is what the base
 * will be (the market and the weather are functions of the world clock), as long as the player
 * changes nothing.
 */
export function forecast(sim: Sim, ticks: number): { report: AwayReport; sim: Sim } {
  const copy = deserialize(JSON.parse(JSON.stringify(serialize(sim))) as SaveData, sim.grid.source);
  return { report: catchUp(copy, ticks), sim: copy };
}

/** Save the base now. */
export const saveNow = (slots: SaveSlots, sim: Sim, now: number): Promise<Envelope> => slots.save(serialize(sim), now);
