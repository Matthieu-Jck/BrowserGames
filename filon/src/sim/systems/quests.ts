// quests.ts (system) — the tutorial's quests (content/quests.ts, decision D28), one at a time,
// in content order. The current quest's objectives are read from the colony's state and its
// counters; when they hold, the quest completes: its reward goes into the Hearth (items, ◉,
// a building's or a Hearth level's materials, waived Crier fees, a title), the next quest
// becomes current and captures its baselines, and a `quest` event goes to the shell.
//
// When completion is checked — well-defined points, so a replay meets the same ones:
//   · every QUEST_CHECK_TICKS ticks (1 game second) at the end of `Sim.step` (`questStep`);
//   · in the `nameColony` command (quest 0 completes at once);
//   · `Sim.checkQuests()`, which the shell calls right after an offline catch-up (the
//     catch-up does not run `step`): what the absence achieved is credited at once, and the
//     next online check would find it anyway within a second, so an absence cannot skip one.
// Rate objectives (« 30 ore a minute ») are measured over whole game minutes: a window per rate
// objective starts when the quest becomes current, and at every epoch boundary at least a
// minute after its start `questStep` closes it (the rate is the counter's rise over it) and
// opens the next. So the first rate comes 1–2 minutes after a quest begins, then one per
// minute; after a catch-up the window spans the absence, i.e. its average rate.
//
// Every completion is logged as a `quest` command (with `force` for a debug completion). A
// replay re-runs the same steps, so the automatic completions happen again at the same ticks
// and log themselves; executing their logged entries is then refused (the quest is no longer
// current), so the logs match and nothing is paid twice. A forced entry is re-forced.
//
// Quest state is saved (serialize.ts) and hashed (`hashQuests`). Integers only: milli-items,
// ticks, centi-ocelles.
import { BAL } from '@/content/balance';
import { COLONY_NAME_MAX, QUEST_CHECK_TICKS, QUEST_IDS, QUESTS, type QuestDef, type QuestObjective, type QuestReward, type Reveal } from '@/content/quests';
import { CRECIPES, buildingIdx, costOf, itemIdx, recipeIdx, toMu } from '@/content/registry';
import type { StateHasher } from '@/core/hash';
import { recipeOf } from '../cfg';
import { CENTER, EPOCH } from '../constants';
import { footprint } from '../entities';
import { T, type Ent } from '../types';
import type { Sim } from '../state';
import { nextToHearth, tradePosts } from './trade';

export interface QuestState {
  /** Quests completed, in the order they were (ids), and the tick each one was. */
  done: string[];
  doneAt: number[];
  /** Index in QUEST_IDS of the current quest; QUEST_IDS.length once all are done. */
  cur: number;
  /** The current quest's counters when it became current, one per objective (mu; 0 when unused). */
  base: number[];
  /** Rate windows of the current quest, four numbers per objective [t0, v0, t1, v1]: the last
   * closed window ran from tick t0 (counter v0) to t1 (v1), and the open one started at t1
   * (t0 = −1: none closed yet). */
  win: number[];
  /** A name was given (the `nameColony` command). */
  named: boolean;
  /** The Crier's fees are waived while `tick` is below this (a reward). */
  feeFreeUntil: number;
  /** Titles earned (QUEST_TITLES ids). */
  titles: string[];
  /** The player skipped the tutorial: no more quests, and the whole interface shows. */
  skipped: boolean;
}

export function newQuestState(): QuestState {
  const q = QUESTS[QUEST_IDS[0]!] as QuestDef;
  return { done: [], doneAt: [], cur: 0, base: q.objectives.map(() => 0), win: q.objectives.flatMap(() => [-1, 0, -1, 0]), named: false, feeFreeUntil: 0, titles: [], skipped: false };
}

/** The current quest (null once every quest is done). */
export function currentQuest(sim: Sim): { id: string; index: number; def: QuestDef } | null {
  if (sim.quests.skipped) return null;
  const i = sim.quests.cur;
  const id = QUEST_IDS[i];
  return id ? { id, index: i, def: QUESTS[id] as QuestDef } : null;
}

// ── counters ────────────────────────────────────────────────────────────────

const sumOf = (arr: ArrayLike<number>, items: readonly string[]): number => {
  let s = 0;
  for (const it of items) s += arr[itemIdx(it)]!;
  return s;
};

/** Imports arrived so far (bought, minus what is still in flight), mu. */
function delivered(sim: Sim, items: readonly string[]): number {
  let s = sumOf(sim.trade.boughtTotal, items);
  const want = new Set(items.map((it) => itemIdx(it)));
  for (const sh of sim.trade.inflight) if (want.has(sh.item)) s -= sh.mu;
  return s;
}

/** The running counter behind an objective that counts *since* the quest began (mu), or 0. */
function counter(sim: Sim, o: QuestObjective): number {
  switch (o.k) {
    case 'produce':
    case 'rate': return sumOf(sim.produced, o.items);
    case 'export': return sumOf(sim.trade.soldTotal, o.items);
    case 'import': return delivered(sim, o.items);
    default: return 0;
  }
}

const SINCE = new Set<QuestObjective['k']>(['produce', 'export', 'import']);

// ── reading the colony ──────────────────────────────────────────────────────

/** The deposit item a drill extracts (−1: not a drill, or nothing under it). */
export function drillItem(sim: Sim, id: number): number {
  const n = sim.graph?.nodeByEnt.get(id) as { kind?: string; item?: number } | undefined;
  return n?.kind === 'drill' ? n.item ?? -1 : -1;
}

/** The item a building puts out: a drill's deposit, a machine's recipe output (−1: none). */
export function outputItem(sim: Sim, id: number): number {
  const n = sim.graph?.nodeByEnt.get(id) as { kind?: string; item?: number; recipe?: { outs: ReadonlyArray<{ item: number }> } | null } | undefined;
  if (n?.kind === 'drill') return n.item ?? -1;
  if (n?.kind === 'machine') return n.recipe?.outs[0]?.item ?? -1;
  return -1;
}

/** Built, awake buildings that put out `item` (drills on its deposit, machines on a recipe making it), in id order. */
export function producersOf(sim: Sim, item: number): number[] {
  const out: number[] = [];
  for (const e of sim.ents.sorted()) if (e.builtAt === 0 && !sim.isDormant(e) && outputItem(sim, e.id) === item) out.push(e.id);
  return out;
}

/** Does `item` reach building `id` from one of its producers through ribbons and routing blocks (a production line)? */
export function receives(sim: Sim, id: number, item: number, from: readonly number[] = producersOf(sim, item)): boolean {
  return from.some((p) => p !== id && flows(sim, p, id));
}

/**
 * Does flow go from one building to another through ribbons (bridges and junctions are part of
 * them) and routing blocks only — not through other machines or stores?
 */
export function flows(sim: Sim, fromId: number, toId: number): boolean {
  const g = sim.graph, start = g?.nodeByEnt.get(fromId), goal = g?.nodeByEnt.get(toId);
  if (!g || !start || !goal) return false;
  const seen = new Set([start]);
  const todo = [start];
  for (let i = 0; i < todo.length; i++) {
    for (const e of todo[i]!.outE) {
      const d = g.nodes[g.eDst[e]!]!;
      if (d === goal) return true;
      if (seen.has(d) || (d.kind !== 'chain' && d.kind !== 'fork')) continue;
      seen.add(d);
      todo.push(d);
    }
  }
  return false;
}

/** What this building puts out reaches the Heart. */
const reachesHearth = (sim: Sim, id: number): boolean => flows(sim, id, sim.hearthId);

/** Built, awake entities among `defs` that pass `ok` (in id order). */
function countBuilt(sim: Sim, defs: readonly string[], ok: (e: Ent) => boolean): number {
  const want = new Set(defs.map((d) => buildingIdx(d)));
  let n = 0;
  for (const e of sim.ents.sorted()) if (want.has(e.def) && e.builtAt === 0 && !sim.isDormant(e) && ok(e)) n++;
  return n;
}

/** On a grid (a wire reaches it): what the inspector's power row shows too. */
const onGrid = (sim: Sim, id: number): boolean => sim.graph?.netOfEnt.has(id) ?? false;

/** On a grid that serves it (last tick's satisfaction above 0). */
function powered(sim: Sim, id: number): boolean {
  const net = sim.graph?.netOfEnt.get(id);
  return net !== undefined && (sim.netPower[net]?.sat ?? 0) > 0;
}

/** Tiles dug out of rock so far (they stay `Dug`). */
function dugTiles(sim: Sim): number {
  let n = 0;
  for (const v of sim.grid.terrainDiff.values()) if (v === T.Dug) n++;
  return n;
}

/** A built building whose footprint centre lies r tiles or more from the Hearth's (doubled, integer). */
function beyond(sim: Sim, r: number): boolean {
  const c2 = 2 * CENTER + 1, r2 = 4 * r * r;
  for (const e of sim.ents.sorted()) {
    if (e.builtAt !== 0) continue;
    const [w, h] = footprint(e.def, e.rot);
    const dx = 2 * e.x + w - c2, dy = 2 * e.y + h - c2;
    if (dx * dx + dy * dy >= r2) return true;
  }
  return false;
}

/** Items sold by some export stream (any post). */
function streamItems(sim: Sim): Set<number> {
  const out = new Set<number>();
  for (const items of sim.trade.exports.values()) for (const it of items) if (it >= 0) out.add(it);
  return out;
}

/**
 * The output items of the first `n` lines of « Ce qui rapporte » at this epoch's prices —
 * the board the Crier screen shows (recipes unlocked, the colony's craft speed).
 */
export function boardTop(sim: Sim, n: number): number[] {
  const ids = CRECIPES.filter((r) => sim.unlocked(r.unlock)).map((r) => r.id);
  return sim.market.board(ids, BAL.market.energyCost, { craftSpeed: sim.mods.craftSpeed }).slice(0, n).map((r) => itemIdx(r.item));
}

// ── objectives ──────────────────────────────────────────────────────────────

/** An objective's progress, in display units (items, buildings, items/min; flags are 0 / 1). */
export interface ObjectiveProgress {
  have: number;
  need: number;
  met: boolean;
  /** A rate whose first full minute is not over yet. */
  measuring?: boolean;
}

const flag = (b: boolean): ObjectiveProgress => ({ have: b ? 1 : 0, need: 1, met: b });
const count = (have: number, need: number): ObjectiveProgress => ({ have, need, met: have >= need });
const NO_WIN: readonly number[] = [-1, 0, -1, 0];

/**
 * How far an objective is. `base`: its counter when the quest began (*since* kinds; 0 counts
 * from the founding, as the guide's steps do); `win`: its rate window [t0, v0, t1, v1].
 */
export function objectiveProgress(sim: Sim, o: QuestObjective, base = 0, win: readonly number[] = NO_WIN): ObjectiveProgress {
  switch (o.k) {
    case 'name': return flag(sim.quests.named);
    case 'build': {
      const it = o.item === undefined ? -1 : itemIdx(o.item);
      return count(countBuilt(sim, o.defs, (e) => it < 0 || drillItem(sim, e.id) === it), o.n);
    }
    case 'stock': return count(Math.floor(sumOf(sim.stock, o.items) / 1000), o.n);
    case 'produce': return count(Math.floor((sumOf(sim.produced, o.items) - base) / 1000), o.n);
    case 'rate': {
      const [t0, v0, t1, v1] = win as [number, number, number, number];
      if (t0 < 0 || t1 <= t0) return { have: 0, need: o.perMin, met: false, measuring: true };
      // Items per minute over the window, compared exactly: (v1 − v0)·EPOCH ≥ perMin·1000·(t1 − t0).
      return { have: Math.floor(((v1 - v0) * EPOCH) / ((t1 - t0) * 1000)), need: o.perMin, met: (v1 - v0) * EPOCH >= toMu(o.perMin) * (t1 - t0) };
    }
    case 'linked': {
      const it = o.item === undefined ? -1 : itemIdx(o.item);
      return count(countBuilt(sim, o.defs, (e) => (it < 0 || drillItem(sim, e.id) === it) && onGrid(sim, e.id)), o.n);
    }
    case 'powered': return count(countBuilt(sim, o.defs, (e) => powered(sim, e.id)), o.n);
    case 'research': return flag(sim.done.has(o.id) || sim.projects.some((p) => p.id === o.id));
    case 'unlocked': return count(o.ids.filter((id) => sim.unlocked(id)).length, o.ids.length);
    case 'post': return flag(tradePosts(sim).some((p) => nextToHearth(sim, p)));
    case 'export': return count(Math.floor((sumOf(sim.trade.soldTotal, o.items) - base) / 1000), o.n);
    case 'order': { const it = itemIdx(o.item); return flag(sim.trade.orders.some((x) => x.item === it)); }
    case 'import': return count(Math.floor((delivered(sim, o.items) - base) / 1000), o.n);
    case 'board': {
      const sold = streamItems(sim);
      return flag(sold.size > 0 && boardTop(sim, o.top).some((it) => sold.has(it)));
    }
    case 'dig': return count(dugTiles(sim), o.n);
    case 'reach': return flag(beyond(sim, o.r));
    case 'recipe': { const r = recipeIdx(o.recipe) + 1; return count(countBuilt(sim, o.defs, (e) => recipeOf(e.cfg) === r), o.n); }
    case 'stream': return flag(streamItems(sim).has(itemIdx(o.item)));
    case 'delivers': {
      const it = o.item === undefined ? -1 : itemIdx(o.item);
      return count(countBuilt(sim, o.defs, (e) => (it < 0 || drillItem(sim, e.id) === it) && reachesHearth(sim, e.id)), o.n);
    }
    case 'feeds': {
      const it = itemIdx(o.item), from = producersOf(sim, it);
      const r = o.recipe === undefined ? 0 : recipeIdx(o.recipe) + 1;
      return count(countBuilt(sim, o.to, (e) => (!r || recipeOf(e.cfg) === r) && receives(sim, e.id, it, from)), o.n);
    }
    default: { const never: never = o; return never; } // a new objective kind must be read here
  }
}

/** Progress of every objective of the current quest (empty once all quests are done). */
export function questProgress(sim: Sim): ObjectiveProgress[] {
  const q = currentQuest(sim);
  if (!q) return [];
  const st = sim.quests;
  return q.def.objectives.map((o, i) => objectiveProgress(sim, o, st.base[i] ?? 0, st.win.slice(4 * i, 4 * i + 4)));
}

/** Does the current quest hold (all its objectives, or one for an `any` quest)? */
export function questMet(sim: Sim): boolean {
  const q = currentQuest(sim);
  if (!q) return false;
  const pr = questProgress(sim);
  return q.def.any ? pr.some((p) => p.met) : pr.every((p) => p.met);
}

// ── rewards ─────────────────────────────────────────────────────────────────

/** The items a reward pays into the Hearth (items, a building's kit, a Hearth level's materials), merged. */
export function rewardItems(r: QuestReward): Array<{ item: number; mu: number }> {
  const out = new Map<number, number>();
  const add = (item: number, mu: number): void => { out.set(item, (out.get(item) ?? 0) + mu); };
  for (const [it, n] of r.items ?? []) add(itemIdx(it), toMu(n));
  if (r.kit) for (const c of costOf(buildingIdx(r.kit))) add(c.item, c.mu);
  if (r.hearthLevel) for (const [it, n] of BAL.hearthUpgrades[r.hearthLevel - 2]?.cost ?? []) add(itemIdx(it), toMu(n));
  return [...out].map(([item, mu]) => ({ item, mu }));
}

function payReward(sim: Sim, r: QuestReward, title: string | undefined): void {
  // Into the Hearth, past its cap if need be (nothing vanishes; refunds do the same).
  for (const { item, mu } of rewardItems(r)) sim.stock[item] = sim.stock[item]! + mu;
  if (r.credits) sim.credits += r.credits * 100;
  if (r.feeFreeMin) sim.quests.feeFreeUntil = Math.max(sim.quests.feeFreeUntil, sim.tick) + r.feeFreeMin * EPOCH;
  if (r.title && title && !sim.quests.titles.includes(title)) sim.quests.titles.push(title);
}

/** Are the Crier's fees waived right now (a reward)? */
export const feeWaived = (sim: Sim): boolean => sim.tick < sim.quests.feeFreeUntil;

// ── the quest machine ───────────────────────────────────────────────────────

/** The first quest not done yet (content order), as an index. */
function firstUndone(done: readonly string[]): number {
  const have = new Set(done);
  const i = QUEST_IDS.findIndex((id) => !have.has(id));
  return i < 0 ? QUEST_IDS.length : i;
}

/** Make the next undone quest current: capture its baselines, reset its rate windows. */
export function activate(sim: Sim): void {
  const st = sim.quests;
  st.cur = firstUndone(st.done);
  const objs = currentQuest(sim)?.def.objectives ?? [];
  st.base = objs.map((o) => (SINCE.has(o.k) ? counter(sim, o) : 0));
  st.win = objs.flatMap((o) => (o.k === 'rate' ? [-1, 0, sim.tick, counter(sim, o)] : [-1, 0, -1, 0]));
}

/** Complete the current quest: log it, pay it, move on. */
function finish(sim: Sim, force: boolean): string {
  const st = sim.quests;
  const q = currentQuest(sim)!;
  // An `any` quest's title is the one of the objective that completed it (the first, if forced).
  let title: string | undefined;
  if (q.def.reward.title) {
    const k = questProgress(sim).findIndex((p) => p.met);
    title = q.def.objectives[k >= 0 ? k : 0]?.title;
  }
  sim.log.push({ tick: sim.tick, cmd: force ? { k: 'quest', id: q.id, force: true } : { k: 'quest', id: q.id } });
  payReward(sim, q.def.reward, title);
  st.done.push(q.id);
  st.doneAt.push(sim.tick);
  activate(sim);
  sim.events.push(q.def.reward.title && title ? { k: 'quest', id: q.id, title } : { k: 'quest', id: q.id });
  return q.id;
}

/** Complete every quest in a row whose objectives hold now. Returns the ids completed. */
export function checkQuests(sim: Sim): string[] {
  const out: string[] = [];
  if (sim.quests.skipped) return out;
  while (sim.quests.cur < QUEST_IDS.length && questMet(sim)) out.push(finish(sim, false));
  return out;
}

/**
 * The `quest` command: complete quest `id` if it is the current one and its objectives hold —
 * or regardless with `force` (debug, `FL.completeQuest`). Then any next ones that already hold.
 */
export function completeQuest(sim: Sim, id: string, force = false): boolean {
  const q = currentQuest(sim);
  if (!q || q.id !== id || (!force && !questMet(sim))) return false;
  finish(sim, force);
  checkQuests(sim);
  return true;
}

/** A colony name as it will be kept: control characters dropped, spaces folded, trimmed; null if empty or too long. */
export function cleanName(name: string): string | null {
  const s = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > 0 && [...s].length <= COLONY_NAME_MAX ? s : null;
}

/** The `name` command: name (or rename) the claim. Quest 0 asks for it. */
/** Skip the tutorial (a logged command): no more quests or rewards; the whole interface shows. */
export function skipTutorial(sim: Sim): boolean {
  if (sim.quests.skipped) return false;
  sim.quests.skipped = true;
  sim.log.push({ tick: sim.tick, cmd: { k: 'skipQuests' } });
  return true;
}

/**
 * What the interface shows (null: everything — the tutorial is done or skipped): the reveals
 * of every quest up to the current one.
 */
export function revealed(sim: Sim): ReadonlySet<Reveal> | null {
  const st = sim.quests as QuestState | undefined;
  if (!st || st.skipped || st.cur >= QUEST_IDS.length) return null;
  const out = new Set<Reveal>();
  for (let i = 0; i <= st.cur; i++) for (const r of (QUESTS[QUEST_IDS[i]!] as QuestDef).reveals ?? []) out.add(r);
  return out;
}

export function nameColony(sim: Sim, name: string): boolean {
  const s = cleanName(name);
  if (s === null) return false;
  sim.colonyName = s;
  sim.quests.named = true;
  sim.log.push({ tick: sim.tick, cmd: { k: 'name', name: s } });
  checkQuests(sim);
  return true;
}

/** Online, at the end of every `Sim.step`: rate windows at epoch boundaries, a check every second. */
export function questStep(sim: Sim): void {
  const st = sim.quests;
  if (st.cur >= QUEST_IDS.length || st.skipped) return;
  if (sim.tick % EPOCH === 0) {
    const objs = currentQuest(sim)!.def.objectives;
    objs.forEach((o, i) => {
      const w = st.win;
      // Close the open window once it covers a whole minute (a quest begun mid-minute waits for the next boundary).
      if (o.k !== 'rate' || sim.tick - w[4 * i + 2]! < EPOCH) return;
      w[4 * i] = w[4 * i + 2]!; w[4 * i + 1] = w[4 * i + 3]!;
      w[4 * i + 2] = sim.tick; w[4 * i + 3] = counter(sim, o);
    });
  }
  if (sim.tick % QUEST_CHECK_TICKS === 0) checkQuests(sim);
}

// ── save & hash ─────────────────────────────────────────────────────────────

/** What the save keeps (serialize.ts): ids, not indices, so the quest table may grow. */
export interface QuestSave {
  done: string[];
  doneAt: number[];
  /** The quest `base` and `win` belong to. */
  cur: string | null;
  base: number[];
  win: number[];
  named: boolean;
  feeFreeUntil: number;
  titles: string[];
  skipped?: boolean;
}

export function saveQuests(st: QuestState): QuestSave {
  return {
    done: [...st.done], doneAt: [...st.doneAt], cur: QUEST_IDS[st.cur] ?? null,
    base: [...st.base], win: [...st.win], named: st.named, feeFreeUntil: st.feeFreeUntil, titles: [...st.titles], skipped: st.skipped,
  };
}

/** Restore a saved quest state (unknown ids are dropped; a quest table that changed re-baselines the current quest). */
export function loadQuests(sim: Sim, d: QuestSave): void {
  const st = sim.quests;
  const known = new Set<string>(QUEST_IDS);
  st.done = []; st.doneAt = [];
  d.done.forEach((id, i) => { if (known.has(id)) { st.done.push(id); st.doneAt.push(d.doneAt[i] ?? 0); } });
  st.named = d.named;
  st.feeFreeUntil = d.feeFreeUntil;
  st.titles = [...d.titles];
  st.skipped = !!d.skipped;
  st.cur = firstUndone(st.done);
  // The quest at that index, skipped or not: a skipped tutorial keeps the baselines it had (they are hashed).
  const id = QUEST_IDS[st.cur];
  const objs = id ? (QUESTS[id] as QuestDef).objectives : [];
  if (d.cur === (id ?? null) && d.base.length === objs.length && d.win.length === 4 * objs.length) {
    st.base = [...d.base];
    st.win = [...d.win];
  } else activate(sim);
}

/** The quest state in the colony hash (it changes what the Hearth will receive). */
export function hashQuests(st: QuestState, h: StateHasher): void {
  h.int(st.cur).int(st.named ? 1 : 0).int(st.skipped ? 1 : 0).int(st.feeFreeUntil).ints(st.doneAt).ints(st.base).ints(st.win);
  for (const id of st.done) h.str(id);
  for (const t of st.titles) h.str(t);
}
