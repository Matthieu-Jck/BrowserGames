// chain.ts — a ribbon chain: a maximal run of same-pace belt tiles, from tail to head.
//
// Items ride it tile by tile (owner, 2026-10-13: "a case-by-case calculation, where each tick of
// ribbons forwards the item by 1 case, and the tick depends on the ribbon type speed. And if the
// ribbons are following each other, you can advance the things non stop"): each tile — a cell —
// holds one item or none, and on its tier's step (`stepAt`: every 600/perMin ticks on the world's
// clock, the same beat for every ribbon of that pace — 10 ticks for a ribbon, 5 for a swift one,
// 2 or 3 for an express one, 20 for a traction one) every item moves one cell on if the cell ahead
// is free, the head's into whatever the line hands on to. A line moves as one block, across the
// joins between chains too: a chain whose first cell is taken still accepts a new item on its
// step when that cell is being vacated (`willShift`), which needs the chain ahead to have
// decided first (the tick accepts chains downstream first: compile's `acceptOrder`). Where
// several lines meet (a chain's tail), the straight one has the cell first, then the side-loads
// (compile sorts `inE`). An item nobody takes stops at the head and everything behind it packs up
// one per tile. Items enter and leave whole; a feeder that hands on parts of an item (a store's
// outlet, whose port lets so many milli-items through a tick) loads them in a stage at the tail
// until a whole item is there and the first cell is free. Throughput is the beat: one item per
// step. The views draw the cells as they are (`cells`, `moved`, `via`, `lastOut`), easing each
// item from where it was over one step.
//
// Conduits (fluids) still flow continuously: a FIFO of parcels ("runs": an item, a quantity and
// the window of ticks in which it reaches the head), only the head run leaving, up to `thrMu` a tick.
//
// The Gleaners (D103, D112: they come in groups): a ribbon's exposed cells (`gleanCells`: its tiles
// beside open desert floor, sim/world/reach.ts) are raided once every `GLEAN_WINDOW` ticks on the
// world's clock. A raid (`raidAt`, from the chain's own draw) puts a group of three to five on posts
// beside a run of its exposed cells (`raidPosts`); from their turn on (`stagger` apart) each waits for
// the first thing to its taste that comes onto its cell, takes it — the whole item leaves the line,
// before the step moves it on — and takes no more that raid (`raidHeld`, a bit a post, hashed, saved:
// cleared once the raid is over). At night only (`ctx.glean`). So what the views show is what the sim
// does: a group waiting by the line, an item that rides up to one of them and is gone into its hands.
// The pattern repeats with the window: the catch-up folds it into a night group's period
// (graph/groups.ts `rotNight`) and the warm-ups count what is taken (`ctx.gleaned`), exactly as
// online. Whole items, counted: nothing vanishes unseen.
import { BAL } from '@/content/balance';
import { GLEANER_TASTE } from '@/content/gleaners';
import { N_ITEMS, itemDef, itemIdx } from '@/content/registry';
import { hash32, type StateHasher } from '@/core/hash';
import { ceilDiv } from '@/core/fixed';
import { MU } from '../constants';
import { FNode, type TickCtx } from './node';

export interface Run { item: number; mu: number; from: number; to: number }

const FLUID: boolean[] = [];
export const isFluidItem = (item: number): boolean => {
  let v = FLUID[item];
  if (v === undefined) FLUID[item] = v = itemDef(item).kind === 'fluid';
  return v;
};

/** Engine ticks per minute (10 a second). */
const TPM = 600;

/**
 * The Gleaners' raids repeat every GLEAN_WINDOW ticks (D112, `BAL.gleaners.window`: four minutes), so
 * a night group keeps an exact period offline (at most `PERIOD_MAX`).
 */
export const GLEAN_WINDOW = BAL.gleaners.window;
/** How long a raid's group may take (ticks), and how far apart their posts open. */
export const RAID_TICKS = BAL.gleaners.raid;
export const RAID_STAGGER = BAL.gleaners.stagger;

/** How many come to raid a chain with `n` exposed cells: `group.min` to `group.max` (fewer cells: one a cell). */
export function raidSize(n: number): number {
  const g = BAL.gleaners.group;
  return n < g.min ? n : Math.min(g.max, g.min + Math.floor((n - g.min) / g.per));
}

/**
 * A chain's raid (D112), from its exposed cells (ascending) and its own draw: the posts — a run of its
 * exposed cells round a drawn one, one a Gleaner — and the tick of the window its group takes up the
 * first (each next one `RAID_STAGGER` later; they all go at `at + RAID_TICKS`).
 */
export function planRaid(cells: readonly number[], seed: number): { posts: Int32Array; at: number } {
  const n = cells.length, size = raidSize(n);
  if (!size) return { posts: NO_POSTS, at: 0 };
  const centre = hash32(seed, 1) % n;
  const start = Math.max(0, Math.min(n - size, centre - (size >> 1)));
  return { posts: Int32Array.from(cells.slice(start, start + size)), at: hash32(seed, 2) % (GLEAN_WINDOW - RAID_TICKS) };
}
const NO_POSTS = new Int32Array(0);

let TASTE: Int16Array | null = null;
/** How likely the Gleaners take an item of this kind when they look at it (‰; 0: they leave it). */
export function gleanTaste(item: number): number {
  if (!TASTE) {
    TASTE = new Int16Array(N_ITEMS);
    for (const [id, p] of Object.entries(GLEANER_TASTE)) TASTE[itemIdx(id)] = p;
  }
  return TASTE[item] ?? 0;
}

/** Does a ribbon of `perMin` items a minute step at tick `now`? Every TPM/perMin ticks on average, on the world's clock. */
export function stepAt(perMin: number, now: number): boolean {
  return (((now % TPM) + TPM) % TPM) * perMin % TPM + perMin >= TPM;
}

/** The ticks between two steps of a ribbon of `perMin` (their pattern repeats over `stepPeriod`). */
export const stepPeriod = (perMin: number): number => TPM / gcdInt(TPM, perMin);
const gcdInt = (a: number, b: number): number => (b === 0 ? a : gcdInt(b, a % b));

/**
 * A line's items from an older save's runs (head first: item, milli-items, from, to — four numbers
 * each) onto `len` cells: the whole items packed from the head back, one per tile, in their order.
 * What does not fit, and the parts of items, are handed to `rest` (the Heart: nothing vanishes).
 * Returns item + 1 per cell, tail to head (0: empty).
 */
export function packRuns(runs: readonly number[], len: number, rest: (item: number, mu: number) => void): number[] {
  const cells = new Array<number>(len).fill(0);
  let at = len - 1;
  for (let i = 0; i + 3 < runs.length; i += 4) {
    const item = runs[i]!, mu = runs[i + 1]!;
    let whole = Math.floor(mu / MU);
    const part = mu - whole * MU;
    while (whole > 0 && at >= 0) { cells[at--] = item + 1; whole--; }
    if (whole > 0) rest(item, whole * MU);
    if (part > 0) rest(item, part);
  }
  return cells;
}

/** How cells say where their item came from (`via`): a tile behind on this chain, or nothing known (a restored state). */
export const VIA_BEHIND = -2, VIA_NONE = -1;

const NO_CELLS = new Int32Array(0);

export class Chain extends FNode {
  readonly kind = 'chain' as const;
  /** Milli-items on it (whole items in cells, the stage, and a conduit's runs). */
  content = 0;
  /** Cumulative milli-items pushed (statistics, flow heatmap). */
  pushedTotal = 0;

  // ── items: one cell per tile, tail (0) to head (L − 1) ─────────────────
  /** Item + 1 per tile (0: empty). */
  readonly cells: Int16Array;
  /** Per cell: the tick its item got there (the views ease it in over one step). */
  readonly moved: Int32Array;
  /** Per cell: where its item came from — the in-edge it entered by, `VIA_BEHIND` (the cell behind), `VIA_NONE`. */
  readonly via: Int32Array;
  /** Parts of an item being loaded at the tail (a store's outlet): its item, milli-items, the edge they came by. */
  stageItem = -1;
  stageMu = 0;
  stageVia = VIA_NONE;
  /** The last item to leave the head: item, tick, and the edge it left by (the views see it on its way). */
  lastOut = { item: -1, tick: -1, edge: -1 };
  /** A whole item given this tick, placed on the first cell once the step is done. */
  private inbox = -1;
  private inboxVia = VIA_NONE;
  /** Per tick: the step's verdict, the first empty cell (worked out once, in `accept`). */
  private stepNow = -1;

  // ── the Gleaners (D103, D112): set at compile from the land ──────────────
  /** Its cells the Gleaners reach at night (indices, ascending); empty: none. */
  gleanCells: Int32Array = NO_CELLS;
  /** Its raid: the posts (cell indices, one a Gleaner; empty: never raided) and the window tick the first is taken up. */
  raidPosts: Int32Array = NO_CELLS;
  raidAt = 0;
  /** Its own draw: the raid's place and time, a taste's roll. */
  gleanSeed = 0;
  /** The raid's state: a bit a post that has taken its item (hashed, snapshotted, saved; cleared once the raid is over). */
  raidHeld = 0;

  // ── fluids ───────────────────────────────────────────────────────────────
  runs: Run[] = [];
  head = 0;
  readonly transit: number;
  readonly capMu: number;

  constructor(
    /** Tile indices from tail to head. */
    readonly tiles: Int32Array,
    /** Building index of the tier (ribbon, swift, express, conduit…). */
    readonly tier: number,
    /** Its pace (content `belt`): items a minute; a conduit's travel time too. */
    readonly perMin: number,
    readonly ticksPerTile: number,
    readonly fluid: boolean,
  ) {
    super(0);
    const L = tiles.length;
    this.cells = new Int16Array(fluid ? 0 : L);
    this.moved = new Int32Array(fluid ? 0 : L);
    this.via = new Int32Array(fluid ? 0 : L).fill(VIA_NONE);
    this.transit = L * ticksPerTile;
    this.capMu = L * (fluid ? BAL.conduitDensity : BAL.beltDensity) * MU;
    this.thrMu = Math.round((perMin * MU) / TPM);
  }

  /** A conduit's throughput (milli-items a tick); a ribbon's average one. */
  readonly thrMu: number;

  get length(): number { return this.tiles.length; }

  /** Ticks between this ribbon's steps (on average) and the period of their pattern. */
  get stepTicks(): number { return TPM / this.perMin; }
  get period(): number { return stepPeriod(this.perMin); }

  /** Does it step at tick `now`? Asked three times a tick (offer, accept, update): the verdict is kept for the tick (D92: a warm-up asks it hundreds of millions of times). */
  steps(now: number): boolean {
    if (now !== this.stepsAt) { this.stepsAt = now; this.stepsIs = stepAt(this.perMin, now); }
    return this.stepsIs;
  }
  private stepsAt = NaN;
  private stepsIs = false;

  /** Every item on it, head first: its item and milli-items (a cell's whole item, the stage's part, a conduit's runs). */
  contents(): Array<{ item: number; mu: number }> {
    const out: Array<{ item: number; mu: number }> = [];
    if (this.fluid) {
      for (let i = this.head; i < this.runs.length; i++) out.push({ item: this.runs[i]!.item, mu: this.runs[i]!.mu });
      return out;
    }
    for (let i = this.cells.length - 1; i >= 0; i--) if (this.cells[i]) out.push({ item: this.cells[i]! - 1, mu: MU });
    if (this.stageMu > 0) out.push({ item: this.stageItem, mu: this.stageMu });
    return out;
  }

  /** The item on cell i (−1: none). */
  itemAt(i: number): number { return (this.cells[i] ?? 0) - 1; }

  /** Lay item on cell i (loading a save, recutting a line): no history to ease from. */
  place(i: number, item: number): void {
    if (this.cells[i]) this.content -= MU;
    this.cells[i] = item + 1;
    this.via[i] = VIA_NONE;
    this.content += MU;
  }

  headRun(): Run | undefined {
    return this.runs[this.head];
  }

  // ── tick phases ──────────────────────────────────────────────────────────

  override offer(e: number, _port: number, ctx: TickCtx): void {
    if (this.fluid) { this.offerFluid(e, ctx); return; }
    // The head's item, on a step.
    const h = this.cells[this.cells.length - 1]!;
    if (!h || !this.steps(ctx.now)) { ctx.offItem[e] = -1; ctx.offMu[e] = 0; return; }
    ctx.offItem[e] = h - 1;
    ctx.offMu[e] = MU;
  }

  /**
   * Will the first cell be free once this tick's step is done? Only on a step: the items from the
   * tail on all move up when there is a free cell ahead of them, or — the chain full — when its
   * head leaves (the chain ahead, or the building, has accepted it already: chains accept
   * downstream first) or goes round (a closed loop).
   */
  private willShift(ctx: TickCtx): boolean {
    if (this.stepNow !== ctx.now) return false;
    // A free cell anywhere ahead: the block from the tail moves up into it.
    if (this.content - this.stageMu < this.cells.length * MU) return true;
    const out = this.outE[0];
    if (out === undefined) return false;
    if (this.inE.includes(out)) return true; // a closed loop turns as one
    return ctx.offMu[out]! >= MU && ctx.acc[out]! >= MU;
  }

  override accept(ctx: TickCtx): void {
    if (this.fluid) { this.acceptFluid(ctx); return; }
    this.stepNow = this.steps(ctx.now) ? ctx.now : -1;
    let room = !this.cells[0] || this.willShift(ctx);
    let stItem = this.stageMu > 0 ? this.stageItem : -1, stFree = MU - this.stageMu;
    // Priority order: the straight feeder first, then side-loads (compile sorts inE).
    for (let k = 0; k < this.inE.length; k++) {
      const e = this.inE[k]!;
      const it = ctx.offItem[e]!, off = ctx.offMu[e]!;
      ctx.acc[e] = 0;
      if (it < 0 || off <= 0 || isFluidItem(it)) continue;
      if (off >= MU) {
        // A whole item: onto the first cell, if it is (being) freed (a part waiting in the stage goes in after it).
        if (room) { ctx.acc[e] = MU; room = false; }
        continue;
      }
      // A part of one: into the stage, one item at a time, up to a whole one.
      if ((stItem < 0 || stItem === it) && stFree > 0) {
        const a = Math.min(off, stFree);
        ctx.acc[e] = a;
        stFree -= a;
        stItem = it;
      }
    }
  }

  /** A whole item leaves all at once or not at all; a conduit's water as it fits. */
  override split(ctx: TickCtx): void {
    for (const e of this.outE) {
      const off = ctx.offMu[e]!, acc = ctx.acc[e]!;
      ctx.q[e] = this.fluid ? Math.min(off, acc) : off >= MU && acc >= MU ? MU : 0;
    }
  }

  override take(_port: number, item: number, mu: number, ctx: TickCtx): void {
    if (this.fluid) { this.takeFluid(mu, ctx); return; }
    const L = this.cells.length;
    this.cells[L - 1] = 0;
    this.content -= mu;
    this.lastOut.item = item;
    this.lastOut.tick = ctx.now;
    this.lastOut.edge = this.outE[0] ?? -1;
  }

  override give(_port: number, item: number, mu: number, ctx: TickCtx): void {
    if (this.fluid) { this.push(item, mu, ctx.now + this.transit); return; }
    this.content += mu;
    this.pushedTotal += mu;
    const via = ctx.edge ?? VIA_NONE;
    if (mu >= MU) { this.inbox = item; this.inboxVia = via; return; }
    this.stageItem = item;
    this.stageMu += mu;
    this.stageVia = via;
  }

  /** Phase C: on a step every item moves one cell on where it can, head first; then the new item comes onto the first cell. */
  override update(ctx: TickCtx): void {
    if (this.fluid) { this.updateFluid(ctx); return; }
    const c = this.cells, L = c.length, now = ctx.now;
    if (this.steps(now)) {
      // The Gleaners at their posts take what has come up to them, before the line moves on (D112).
      if (this.raidPosts.length) this.raidStep(ctx);
      for (let i = L - 2; i >= 0; i--) {
        if (!c[i] || c[i + 1]) continue;
        c[i + 1] = c[i]!;
        c[i] = 0;
        this.moved[i + 1] = now;
        this.via[i + 1] = VIA_BEHIND;
      }
      // A closed loop: the head goes round onto the tail it has just vacated (`take`, `give` did the counting).
    }
    if (this.inbox >= 0) {
      c[0] = this.inbox + 1;
      this.moved[0] = now;
      this.via[0] = this.inboxVia;
      this.inbox = -1;
    } else if (this.stageMu >= MU && !c[0]) {
      c[0] = this.stageItem + 1;
      this.moved[0] = now;
      this.via[0] = this.stageVia;
      this.stageMu -= MU;
      if (this.stageMu <= 0) { this.stageMu = 0; this.stageItem = -1; }
    }
  }

  /**
   * A step on a raided chain (D112). Outside its raid the posts are empty (`raidHeld` cleared); in it,
   * at night, each post whose turn has come and that holds nothing yet takes the item on its cell if
   * it is to their taste (a roll against the taste ‰ when below 1 000): the whole item leaves the line,
   * counted in `ctx.gleaned` (and logged online for the views), and that post takes no more this raid.
   */
  private raidStep(ctx: TickCtx): void {
    const now = ctx.now;
    const k = (((now % GLEAN_WINDOW) + GLEAN_WINDOW) % GLEAN_WINDOW) - this.raidAt;
    if (k < 0 || k >= RAID_TICKS) { this.raidHeld = 0; return; }
    if (!ctx.glean) return;
    const posts = this.raidPosts;
    for (let p = 0; p < posts.length; p++) {
      const bit = 1 << p;
      if (this.raidHeld & bit || k < p * RAID_STAGGER) continue;
      const i = posts[p]!, v = this.cells[i]!;
      if (!v) continue;
      const item = v - 1, taste = gleanTaste(item);
      if (!taste || (taste < 1000 && hash32(this.gleanSeed, k, p) % 1000 >= taste)) continue;
      this.cells[i] = 0;
      this.content -= MU;
      this.raidHeld |= bit;
      ctx.gleaned[item] = ctx.gleaned[item]! + MU;
      ctx.gleanLog?.push(this.tiles[i]!, item, now);
    }
  }

  // ── fluids: a FIFO of runs ───────────────────────────────────────────────

  private offerFluid(e: number, ctx: TickCtx): void {
    const h = this.runs[this.head];
    if (!h || h.from > ctx.now) { ctx.offItem[e] = -1; ctx.offMu[e] = 0; return; }
    const due = h.to <= ctx.now ? h.mu : ceilDiv(h.mu, h.to - ctx.now + 1);
    ctx.offItem[e] = h.item;
    ctx.offMu[e] = Math.min(due, this.thrMu);
  }

  private acceptFluid(ctx: TickCtx): void {
    let free = Math.min(this.thrMu, this.capMu - this.content);
    for (let k = 0; k < this.inE.length; k++) {
      const e = this.inE[k]!;
      const it = ctx.offItem[e]!, off = ctx.offMu[e]!;
      if (it < 0 || off <= 0 || free <= 0 || !isFluidItem(it)) { ctx.acc[e] = 0; continue; }
      const a = Math.min(off, free);
      ctx.acc[e] = a;
      free -= a;
    }
  }

  private takeFluid(mu: number, _ctx: TickCtx): void {
    this.content -= mu;
    const h = this.runs[this.head]!;
    h.mu -= mu;
    if (h.mu <= 0) this.head++;
    this.compact();
  }

  /** Append a parcel that reaches the head at `ready` (merging with the tail run if possible). Conduits only. */
  push(item: number, mu: number, ready: number): void {
    const n = this.runs.length;
    const back = n > this.head ? this.runs[n - 1]! : undefined;
    if (back && back.item === item && back.to >= ready - 1 && back.to <= ready && ready - back.from < BAL.runSpanTicks) {
      back.mu += mu;
      back.to = ready;
    } else {
      this.runs.push({ item, mu, from: ready, to: ready });
    }
    this.content += mu;
    this.pushedTotal += mu;
  }

  /** Coalesce the head: consecutive due runs of one item behave as one (canonical, periodic state). */
  private updateFluid(ctx: TickCtx): void {
    const due = ctx.now + 1;
    let h = this.runs[this.head];
    while (h && h.to <= due) {
      const nx = this.runs[this.head + 1];
      if (!nx || nx.item !== h.item || nx.to > due) break;
      nx.mu += h.mu;
      nx.from = Math.min(nx.from, h.from);
      this.head++;
      h = nx;
    }
    this.compact();
  }

  private compact(): void {
    if (this.head > 32 && this.head * 2 > this.runs.length) {
      this.runs = this.runs.slice(this.head);
      this.head = 0;
    }
  }

  /** A conduit's live runs, head first. */
  live(): Run[] {
    return this.runs.slice(this.head);
  }

  // ── state ────────────────────────────────────────────────────────────────

  override hash(h: StateHasher, now: number): void {
    if (!this.fluid) {
      // What is where; when it got there is the views' business (and the step's phase is the group's).
      h.ints(this.cells).int(this.stageItem).int(this.stageMu);
      if (this.raidPosts.length) h.int(this.raidHeld);
      return;
    }
    // Canonical form: due runs are equivalent whatever their age (clamped to 0), and
    // consecutive due runs of one item behave as one (see update), so they hash as one.
    let item = -1, mu = 0, n = 0;
    const flush = (): void => { if (item >= 0) { h.int(item).int(mu).int(0).int(0); n++; } item = -1; mu = 0; };
    for (let i = this.head; i < this.runs.length; i++) {
      const r = this.runs[i]!;
      if (r.to <= now) {
        if (r.item !== item) { flush(); item = r.item; }
        mu += r.mu;
        continue;
      }
      flush();
      h.int(r.item).int(r.mu).int(Math.max(0, r.from - now)).int(r.to - now);
      n++;
    }
    flush();
    h.int(n);
  }

  override snapshot(): unknown {
    if (!this.fluid) {
      return {
        cells: Array.from(this.cells), moved: Array.from(this.moved), via: Array.from(this.via),
        stage: [this.stageItem, this.stageMu, this.stageVia], content: this.content, out: { ...this.lastOut }, raid: this.raidHeld,
      };
    }
    return { runs: this.live().map((r) => ({ ...r })), content: this.content };
  }

  override restore(s: unknown, shift: number): void {
    if (!this.fluid) {
      const o = s as { cells: number[]; moved: number[]; via: number[]; stage: [number, number, number]; content: number; out: { item: number; tick: number; edge: number }; raid?: number };
      this.cells.set(o.cells);
      for (let i = 0; i < this.moved.length; i++) this.moved[i] = o.moved[i]! + shift;
      this.via.set(o.via);
      [this.stageItem, this.stageMu, this.stageVia] = o.stage;
      this.content = o.content;
      this.lastOut = { ...o.out, tick: o.out.tick + shift };
      this.raidHeld = o.raid ?? 0;
      this.inbox = -1;
      return;
    }
    const o = s as { runs: Run[]; content: number };
    this.runs = o.runs.map((r) => ({ item: r.item, mu: r.mu, from: r.from + shift, to: r.to + shift }));
    this.head = 0;
    this.content = o.content;
  }
}
