// nodes.ts — flow nodes for buildings: machines (discrete integer crafting cycles scaled by
// power), drills (continuous, capped by deposit tiles), reservoirs (Hearth, silos, docks:
// stocks with capacity and unloader ports), forks (split/merge/filter), fuel generators and
// observatories. Reservoirs have a "virtual" mode used by the offline catch-up.
import type { RouterLogic } from '@/content/types';
import { BAL } from '@/content/balance';
import { N_ITEMS, type CRecipe } from '@/content/registry';
import type { StateHasher } from '@/core/hash';
import { St } from '../types';
import { FNode, allocRotating, type TickCtx } from './node';
import { isFluidItem, stepAt } from './chain';

const MU = 1000;

// ── Machine ─────────────────────────────────────────────────────────────────
export class MachineNode extends FNode {
  readonly kind = 'machine' as const;
  inBuf: Float64Array;
  inCap: Float64Array;
  outBuf: Float64Array;
  outCap: Float64Array;
  crafting = false;
  p = 0;
  carry = 0;
  /** Speed in ‰ (research, modules, tower, dug floor). */
  speed = 1000;
  needsPower: boolean;
  private free = new Float64Array(3);

  constructor(ent: number, readonly recipe: CRecipe | null, kw: number, idleKw: number) {
    super(ent);
    this.kw = kw;
    this.idleKw = idleKw;
    this.needsPower = kw > 0;
    const nIn = recipe?.ins.length ?? 0, nOut = recipe?.outs.length ?? 0;
    this.inBuf = new Float64Array(nIn);
    this.inCap = new Float64Array(nIn);
    this.outBuf = new Float64Array(nOut);
    this.outCap = new Float64Array(nOut);
    if (recipe) {
      recipe.ins.forEach((s, j) => { this.inCap[j] = s.mu * BAL.inBufCrafts; });
      recipe.outs.forEach((s, j) => { this.outCap[j] = s.mu * BAL.outBufCrafts; });
    }
    if (this.free.length < nIn) this.free = new Float64Array(nIn);
  }

  slotOf(item: number): number {
    const ins = this.recipe?.ins;
    if (!ins) return -1;
    for (let j = 0; j < ins.length; j++) if (ins[j]!.item === item) return j;
    return -1;
  }

  override offer(e: number, _port: number, ctx: TickCtx): void {
    if (!this.recipe || this.outBuf[0]! <= 0) { ctx.offItem[e] = -1; ctx.offMu[e] = 0; return; }
    const it = this.recipe.outs[0]!.item;
    ctx.offItem[e] = it;
    // One whole item at a time, all of it or nothing (`split`), as a drill's; a fluid as it comes;
    // a part left from an older save as it is.
    ctx.offMu[e] = isFluidItem(it) ? this.outBuf[0]! : Math.min(this.outBuf[0]!, MU);
  }

  override accept(ctx: TickCtx): void {
    const n = this.inE.length;
    if (!this.recipe) { for (const e of this.inE) ctx.acc[e] = 0; return; }
    for (let j = 0; j < this.inBuf.length; j++) this.free[j] = this.inCap[j]! - this.inBuf[j]!;
    const rot = n > 1 ? ctx.now % n : 0;
    for (let k = 0; k < n; k++) {
      const e = this.inE[(k + rot) % n]!;
      const it = ctx.offItem[e]!;
      const j = it < 0 ? -1 : this.slotOf(it);
      if (j < 0 || ctx.offMu[e]! <= 0) { ctx.acc[e] = 0; continue; }
      const a = Math.min(ctx.offMu[e]!, this.free[j]!);
      ctx.acc[e] = a > 0 ? a : 0;
      this.free[j] = this.free[j]! - ctx.acc[e]!;
    }
  }

  override split(ctx: TickCtx): void {
    const fluid = !!this.recipe && isFluidItem(this.recipe.outs[0]!.item);
    if (fluid && this.outE.length > 1) { allocRotating(this.outE, ctx.now % this.outE.length, this.outBuf[0] ?? 0, ctx.acc, ctx.q); return; }
    // A whole item to one way out, all of it or nothing, the ways taking turns; a fluid (or an old
    // save's part of an item) as it fits.
    const n = this.outE.length;
    let given = false;
    for (let k = 0; k < n; k++) {
      const e = this.outE[(k + ctx.now) % n]!;
      const off = ctx.offMu[e]!, acc = ctx.acc[e]!;
      if (fluid || off < MU) { ctx.q[e] = given ? 0 : Math.min(off, acc); if (ctx.q[e]! > 0) given = true; continue; }
      ctx.q[e] = !given && off > 0 && acc >= off ? off : 0;
      if (ctx.q[e]! > 0) given = true;
    }
  }

  override take(_port: number, _item: number, mu: number): void {
    this.outBuf[0] = this.outBuf[0]! - mu;
  }

  override give(_port: number, item: number, mu: number): void {
    const j = this.slotOf(item);
    if (j >= 0) this.inBuf[j] = this.inBuf[j]! + mu;
  }

  private canStart(): boolean {
    const r = this.recipe!;
    for (let j = 0; j < r.ins.length; j++) if (this.inBuf[j]! < r.ins[j]!.mu) return false;
    return true;
  }

  private start(ctx: TickCtx): void {
    const r = this.recipe!;
    for (let j = 0; j < r.ins.length; j++) {
      this.inBuf[j] = this.inBuf[j]! - r.ins[j]!.mu;
      ctx.consumed[r.ins[j]!.item] = ctx.consumed[r.ins[j]!.item]! + r.ins[j]!.mu;
    }
    this.crafting = true;
  }

  private canEmit(): boolean {
    const r = this.recipe!;
    for (let j = 0; j < r.outs.length; j++) if (this.outBuf[j]! + r.outs[j]!.mu > this.outCap[j]!) return false;
    return true;
  }

  override update(ctx: TickCtx): void {
    const r = this.recipe;
    if (!r) { this.status = St.NoJob; return; }
    const s = this.needsPower ? (this.net >= 0 ? ctx.sat[this.net]! : 0) : 1000;
    if (!this.crafting) {
      if (!this.canStart()) { this.status = St.Starved; return; }
      if (s <= 0) { this.status = St.Unpowered; return; }
      this.start(ctx);
    }
    if (s <= 0) { this.status = St.Unpowered; return; }
    const need = r.ticks * 1000;
    if (this.p < need) {
      const w = this.carry + s * this.speed;
      this.p += Math.floor(w / 1000);
      this.carry = w % 1000;
    }
    while (this.p >= need) {
      if (!this.canEmit()) { this.p = need; this.status = St.Blocked; return; }
      for (let j = 0; j < r.outs.length; j++) {
        this.outBuf[j] = this.outBuf[j]! + r.outs[j]!.mu;
        ctx.produced[r.outs[j]!.item] = ctx.produced[r.outs[j]!.item]! + r.outs[j]!.mu;
      }
      this.p -= need;
      this.crafting = false;
      if (this.canStart()) this.start(ctx);
      else { this.p = 0; this.carry = 0; break; }
    }
    this.status = s < 1000 ? St.LowPower : St.Ok;
  }

  override demand(): number {
    return this.crafting && this.status !== St.Blocked && this.status !== St.Unpowered ? this.kw : this.idleKw;
  }

  override hash(h: StateHasher): void {
    h.ints(this.inBuf).ints(this.outBuf).int(this.crafting ? 1 : 0).int(this.p).int(this.carry);
  }

  override snapshot(): unknown {
    return { inBuf: [...this.inBuf], outBuf: [...this.outBuf], crafting: this.crafting, p: this.p, carry: this.carry, status: this.status };
  }

  override restore(s: unknown): void {
    const o = s as { inBuf: number[]; outBuf: number[]; crafting: boolean; p: number; carry: number; status: number };
    this.inBuf.set(o.inBuf); this.outBuf.set(o.outBuf);
    this.crafting = o.crafting; this.p = o.p; this.carry = o.carry; this.status = o.status;
  }
}

// ── Drill ───────────────────────────────────────────────────────────────────
export class DrillNode extends FNode {
  readonly kind = 'drill' as const;
  outBuf = 0;
  carry = 0;
  readonly outCap = BAL.drillBufItems * MU;

  constructor(ent: number, readonly item: number, /** mu per epoch at full power */ public rateEp: number, kw: number, idleKw: number) {
    super(ent);
    this.kw = kw;
    this.idleKw = idleKw;
  }

  override offer(e: number, _port: number, ctx: TickCtx): void {
    // A drill drops whole items: its buffer hands one on once it holds all of it (owner,
    // 2026-10-13: a line several drills load stalled on the trickle of the last one, whose part of
    // an item never left room for the whole ones behind). A pump's water flows as it comes.
    const q = this.item < 0 ? 0 : isFluidItem(this.item) ? this.outBuf : this.outBuf >= MU ? MU : 0;
    if (q <= 0) { ctx.offItem[e] = -1; ctx.offMu[e] = 0; return; }
    ctx.offItem[e] = this.item;
    ctx.offMu[e] = q;
  }

  override split(ctx: TickCtx): void {
    if (isFluidItem(this.item)) {
      if (this.outE.length <= 1) super.split(ctx);
      else allocRotating(this.outE, ctx.now % this.outE.length, this.outBuf, ctx.acc, ctx.q);
      return;
    }
    // The whole item to one way out, all of it or nothing; the ways take turns.
    const n = this.outE.length;
    let given = false;
    for (let k = 0; k < n; k++) {
      const e = this.outE[(k + ctx.now) % n]!;
      const off = ctx.offMu[e]!;
      ctx.q[e] = !given && off > 0 && ctx.acc[e]! >= off ? off : 0;
      if (ctx.q[e]! > 0) given = true;
    }
  }

  override take(_port: number, _item: number, mu: number): void {
    this.outBuf -= mu;
  }

  override update(ctx: TickCtx): void {
    if (this.item < 0 || this.rateEp <= 0) { this.status = St.NoJob; return; }
    if (this.outBuf >= this.outCap) { this.status = St.Blocked; return; }
    const s = this.net >= 0 ? ctx.sat[this.net]! : 0;
    if (s <= 0) { this.status = St.Unpowered; return; }
    const w = this.carry + this.rateEp * s;
    let made = Math.floor(w / 600000);
    this.carry = w - made * 600000;
    if (this.outBuf + made > this.outCap) made = this.outCap - this.outBuf;
    this.outBuf += made;
    ctx.produced[this.item] = ctx.produced[this.item]! + made;
    this.status = s < 1000 ? St.LowPower : St.Ok;
  }

  override demand(): number {
    return this.status === St.Ok || this.status === St.LowPower ? this.kw : this.idleKw;
  }

  override hash(h: StateHasher): void { h.int(this.outBuf).int(this.carry); }
  override snapshot(): unknown { return { outBuf: this.outBuf, carry: this.carry, status: this.status }; }
  override restore(s: unknown): void {
    const o = s as { outBuf: number; carry: number; status: number };
    this.outBuf = o.outBuf; this.carry = o.carry; this.status = o.status;
  }
}

// ── Reservoir (Hearth, silo, dock store) ────────────────────────────────────
export const V_NORMAL = 0;
export const V_EMPTY = 1;
export const V_FULL = 2;

export class ReservoirNode extends FNode {
  readonly kind = 'reservoir' as const;
  /** Live stock (milli-items per item). The Hearth's array is the colony's central stock. */
  stock: Float64Array;
  /** Capacity per item (mu); a single value for every item. */
  cap: number;
  /** Item offered by each output port (-1 = closed). */
  portItems: number[];
  /** Per output port, mu per tick (on average). */
  portRate: number;
  /**
   * Its ports' pace in items a minute: a port hands out one whole item on each of its beats
   * (chain.ts `stepAt`, the ribbons' clock), as a ribbon steps (D57) — a part only when that is all
   * the store holds.
   */
  get portPerMin(): number { return Math.round((this.portRate * 600) / MU); }
  /** Silo: only one item kind (locked item, -1 = free). */
  single: boolean;
  locked = -1;
  /** Observatory: only these items are taken in (null = anything). */
  accepts: ReadonlySet<number> | null = null;

  // ── virtual mode (offline warm-ups) ──
  virtual = false;
  vState = new Uint8Array(N_ITEMS);
  /** Throttle rate for EMPTY (inflow) / FULL (outflow) items, mu per epoch. */
  vRate = new Float64Array(N_ITEMS);
  vCarry = new Float64Array(N_ITEMS);
  /** Small virtual stock (EMPTY) or virtual room (FULL) replenished at vRate. */
  vPool = new Float64Array(N_ITEMS);
  vIn = new Float64Array(N_ITEMS);
  vOut = new Float64Array(N_ITEMS);
  /** Items whose virtual state is not NORMAL (the only ones with pools). */
  vActive: number[] = [];
  private free = new Float64Array(N_ITEMS);
  private avail = new Float64Array(N_ITEMS);

  constructor(ent: number, stock: Float64Array, cap: number, portItems: number[], portRate: number, single: boolean, kw = 0) {
    super(ent);
    this.stock = stock;
    this.cap = cap;
    this.portItems = portItems;
    this.portRate = portRate;
    this.single = single;
    this.kw = kw;
    this.idleKw = kw;
    if (single) {
      for (let i = 0; i < stock.length; i++) if (stock[i]! > 0) { this.locked = i; break; }
    }
  }

  /**
   * The item an output port hands out (-1: none). A single-item reservoir offers its lock at
   * every port; the catch-up reads the same rule to know what a group pulls.
   */
  portItem(port: number): number {
    if (this.single) {
      // An unloader's virtual port names its chosen item: it gets it only while the silo holds it.
      const want = this.portItems[port] ?? -1;
      return want < 0 || want === this.locked ? this.locked : -1;
    }
    return this.portItems[port] ?? -1;
  }

  override offer(e: number, port: number, ctx: TickCtx): void {
    const it = this.portItem(port);
    if (it < 0 || !stepAt(this.portPerMin, ctx.now)) { ctx.offItem[e] = -1; ctx.offMu[e] = 0; return; }
    const avail = !this.virtual ? this.stock[it]! : this.vState[it] === V_EMPTY ? this.vPool[it]! : MU;
    if (avail <= 0) { ctx.offItem[e] = -1; ctx.offMu[e] = 0; return; }
    ctx.offItem[e] = it;
    ctx.offMu[e] = Math.min(avail, MU);
  }

  override accept(ctx: TickCtx): void {
    const n = this.inE.length;
    this.free.fill(-1);
    const rot = n > 1 ? ctx.now % n : 0;
    for (let k = 0; k < n; k++) {
      const e = this.inE[(k + rot) % n]!;
      const it = ctx.offItem[e]!;
      if (it < 0 || ctx.offMu[e]! <= 0 || isFluidItem(it) || (this.single && this.locked >= 0 && it !== this.locked) || (this.accepts && !this.accepts.has(it))) {
        ctx.acc[e] = 0;
        continue;
      }
      if (this.free[it]! < 0) {
        if (!this.virtual) this.free[it] = Math.max(0, this.cap - this.stock[it]!);
        else this.free[it] = this.vState[it] === V_FULL ? this.vPool[it]! : Number.MAX_SAFE_INTEGER;
      }
      const a = Math.min(ctx.offMu[e]!, this.free[it]!);
      ctx.acc[e] = a > 0 ? a : 0;
      this.free[it] = this.free[it]! - ctx.acc[e]!;
    }
  }

  override split(ctx: TickCtx): void {
    if (this.outE.length <= 1) { super.split(ctx); return; }
    // Several ports may draw the same item: share what is available.
    this.avail.fill(-1);
    const n = this.outE.length;
    const rot = ctx.now % n;
    for (let k = 0; k < n; k++) {
      const e = this.outE[(k + rot) % n]!;
      const it = ctx.offItem[e]!;
      if (it < 0) { ctx.q[e] = 0; continue; }
      if (this.avail[it]! < 0) {
        if (!this.virtual) this.avail[it] = this.stock[it]!;
        else this.avail[it] = this.vState[it] === V_EMPTY ? this.vPool[it]! : Number.MAX_SAFE_INTEGER;
      }
      const q = Math.min(ctx.offMu[e]!, ctx.acc[e]!, this.avail[it]!);
      ctx.q[e] = q > 0 ? q : 0;
      this.avail[it] = this.avail[it]! - ctx.q[e]!;
    }
  }

  override take(_port: number, item: number, mu: number): void {
    if (!this.virtual) { this.stock[item] = this.stock[item]! - mu; return; }
    this.vOut[item] = this.vOut[item]! + mu;
    if (this.vState[item] === V_EMPTY) this.vPool[item] = this.vPool[item]! - mu;
  }

  override give(_port: number, item: number, mu: number): void {
    if (this.single && this.locked < 0) this.locked = item;
    if (!this.virtual) { this.stock[item] = this.stock[item]! + mu; return; }
    this.vIn[item] = this.vIn[item]! + mu;
    if (this.vState[item] === V_FULL) this.vPool[item] = this.vPool[item]! - mu;
  }

  /** Virtual mode: replenish throttled pools (once per tick, before the phases). */
  vTick(): void {
    for (const it of this.vActive) {
      if (this.vRate[it]! <= 0) continue;
      const w = this.vCarry[it]! + this.vRate[it]!;
      const add = Math.floor(w / 600);
      this.vCarry[it] = w - add * 600;
      // Replenishment never banks more than a few ticks of throughput (an initial
      // remainder above that is kept and drained first).
      const lim = this.portRate * 4 + 4000;
      if (this.vPool[it]! < lim) this.vPool[it] = Math.min(this.vPool[it]! + add, lim);
    }
  }

  override update(): void {
    if (this.single && this.locked >= 0 && !this.virtual && this.stock[this.locked]! <= 0) this.locked = -1;
  }

  override demand(): number { return this.kw; }

  override hash(h: StateHasher): void {
    // Reservoir levels are boundary state, not internal state; only virtual pools count.
    if (!this.virtual) return;
    for (const it of this.vActive) h.int(it).int(this.vPool[it]!).int(this.vCarry[it]!);
  }

  override snapshot(): unknown {
    return { pool: [...this.vPool], carry: [...this.vCarry] };
  }

  override restore(s: unknown): void {
    const o = s as { pool: number[]; carry: number[] };
    this.vPool.set(o.pool);
    this.vCarry.set(o.carry);
  }
}

// ── Fork (junction) ─────────────────────────────────────────────────────────
/**
 * A routing block (kind `fork`: router, sorter, inverted sorter, overflow / underflow gate,
 * unloader, distributor): a small one-item buffer fed round-robin by its inputs, handed on by
 * its `mode` — see RouterLogic in content/types.ts. Its edges (to ribbons, machines, stores,
 * other routing blocks) and their roles are set by the graph compiler.
 */
export class ForkNode extends FNode {
  readonly kind = 'fork' as const;
  item = -1;
  mu = 0;
  cap = BAL.forkBufItems * MU;
  mode: RouterLogic = 'router';
  /** The chosen item of a sorter / inverted sorter / unloader (-1 = none). */
  sortItem = -1;
  /** Directional modes: the outputs (indices into outE) straight on, and to the sides. */
  fronts: number[] = [];
  sides: number[] = [];
  /** Per out-edge filter item (-1 = none), aligned with outE; routers and distributors. */
  filters: number[] = [];
  filtersOn = false;
  /**
   * Whose turn it is among the outputs: it moves on each tick something leaves, so items are
   * dealt out in turn — whole items arrive at a steady pace, and a tick-based turn (`now % n`)
   * fell on the same output every time. Kept modulo `turnMod` (compile: the lcm of the sets).
   */
  turn = 0;
  turnMod = 1;
  /** Something left this tick (the turn moves on in phase C). */
  private dealt = false;

  override offer(e: number, _port: number, ctx: TickCtx): void {
    if (this.mu <= 0) { ctx.offItem[e] = -1; ctx.offMu[e] = 0; return; }
    ctx.offItem[e] = this.item;
    // Whole items, one per output a tick (a part, when that is all it holds): a ribbon takes it
    // all or waits (Chain.wholeIn), so items are dealt out whole, not sliced across outputs.
    ctx.offMu[e] = Math.min(this.mu, MU);
  }

  override accept(ctx: TickCtx): void {
    const n = this.inE.length;
    const rot = n > 1 ? ctx.now % n : 0;
    let item = this.mu > 0 ? this.item : -1;
    let free = this.cap - this.mu;
    for (let k = 0; k < n; k++) {
      const e = this.inE[(k + rot) % n]!;
      const it = ctx.offItem[e]!;
      if (it < 0 || ctx.offMu[e]! <= 0 || free <= 0) { ctx.acc[e] = 0; continue; }
      if (item < 0) item = it;
      if (it !== item) { ctx.acc[e] = 0; continue; }
      const a = Math.min(ctx.offMu[e]!, free);
      ctx.acc[e] = a;
      free -= a;
    }
  }

  override split(ctx: TickCtx): void {
    const n = this.outE.length;
    for (let k = 0; k < n; k++) ctx.q[this.outE[k]!] = 0;
    if (!n || this.mu <= 0) return;
    let avail = this.mu;
    // Round-robin over a set of outputs (indices into outE), from whose turn it is.
    const give = (set: readonly number[]): void => {
      const m = set.length;
      const rot = m > 1 ? this.turn % m : 0;
      for (let j = 0; j < m && avail > 0; j++) {
        const e = this.outE[set[(j + rot) % m]!]!;
        const q = Math.min(ctx.offMu[e]!, ctx.acc[e]!, avail);
        if (q > 0) { ctx.q[e] = q; avail -= q; }
      }
    };
    switch (this.mode) {
      case 'sorter':
      case 'inverted': {
        const match = this.sortItem >= 0 && this.item === this.sortItem;
        give((this.mode === 'sorter') === match ? this.fronts : this.sides);
        return;
      }
      case 'overflow': give(this.fronts); give(this.sides); return;
      case 'underflow': give(this.sides); give(this.fronts); return;
      default: break;
    }
    // Router / unloader: filtered outputs matching the item first; non-matching filtered
    // outputs get nothing; the rest share round-robin.
    const rot = n > 1 ? this.turn % n : 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < n; k++) {
        const idx = (k + rot) % n;
        const e = this.outE[idx]!;
        const f = this.filtersOn ? (this.filters[idx] ?? -1) : -1;
        if (pass === 0) { if (f !== this.item || f < 0) continue; }
        else if (f >= 0) continue;
        const q = Math.min(ctx.offMu[e]!, ctx.acc[e]!, avail);
        if (q > 0) { ctx.q[e] = q; avail -= q; }
      }
    }
  }

  override take(_port: number, _item: number, mu: number): void {
    this.mu -= mu;
    this.dealt = true;
    if (this.mu <= 0) { this.mu = 0; this.item = -1; }
  }

  override give(_port: number, item: number, mu: number): void {
    this.item = item;
    this.mu += mu;
  }

  override update(): void {
    if (!this.dealt) return;
    this.dealt = false;
    this.turn = (this.turn + 1) % this.turnMod;
  }

  override hash(h: StateHasher): void { h.int(this.item).int(this.mu).int(this.turn); }
  override snapshot(): unknown { return { item: this.item, mu: this.mu, turn: this.turn }; }
  override restore(s: unknown): void {
    const o = s as { item: number; mu: number; turn?: number };
    this.item = o.item; this.mu = o.mu; this.turn = (o.turn ?? 0) % this.turnMod;
  }
}

// ── Fuel generator (coal generator, sunheart) ──────────────────────────────────────
export class GeneratorNode extends FNode {
  readonly kind = 'generator' as const;
  fuel = 0;
  carry = 0;
  readonly fuelCap: number;
  /** Output at full dispatch (kW, after modifiers). */
  outKw: number;

  constructor(ent: number, readonly fuelItem: number, /** mu per epoch at full output */ readonly burnEp: number, outKw: number) {
    super(ent);
    this.outKw = outKw;
    this.fuelCap = Math.max(5 * MU, Math.ceil(burnEp / 2));
  }

  /** Can it produce this tick? */
  fueled(): boolean { return this.fuel > 0; }

  override accept(ctx: TickCtx): void {
    let free = this.fuelCap - this.fuel;
    for (const e of this.inE) {
      if (ctx.offItem[e] !== this.fuelItem || free <= 0) { ctx.acc[e] = 0; continue; }
      const a = Math.min(ctx.offMu[e]!, free);
      ctx.acc[e] = a;
      free -= a;
    }
  }

  override give(_port: number, _item: number, mu: number): void { this.fuel += mu; }

  override update(ctx: TickCtx): void {
    const g = this.net >= 0 ? ctx.dispatch[this.net]! : 0;
    if (this.fuel <= 0) { this.status = St.NoFuel; this.carry = 0; return; }
    if (g <= 0) { this.status = St.Idle; return; }
    const w = this.carry + this.burnEp * g;
    let burn = Math.floor(w / 600000);
    this.carry = w - burn * 600000;
    if (burn > this.fuel) burn = this.fuel;
    this.fuel -= burn;
    ctx.consumed[this.fuelItem] = ctx.consumed[this.fuelItem]! + burn;
    this.status = St.Ok;
  }

  override hash(h: StateHasher): void { h.int(this.fuel).int(this.carry); }
  override snapshot(): unknown { return { fuel: this.fuel, carry: this.carry, status: this.status }; }
  override restore(s: unknown): void {
    const o = s as { fuel: number; carry: number; status: number };
    this.fuel = o.fuel; this.carry = o.carry; this.status = o.status;
  }
}

// ── Sink (the incinerator, D51) ───────────────────────────────────────────────
/**
 * Takes whatever each feed offers, whole, and destroys it: counted as consumed (statistics and
 * the absence report), nothing kept, no state. Its intake is the feeds' own pace — a ribbon's
 * throughput, a machine's output — so it never backs a line up.
 */
export class SinkNode extends FNode {
  readonly kind = 'sink' as const;
  override accept(ctx: TickCtx): void {
    for (const e of this.inE) ctx.acc[e] = ctx.offItem[e]! >= 0 && ctx.offMu[e]! > 0 ? ctx.offMu[e]! : 0;
  }
  override give(_port: number, item: number, mu: number, ctx: TickCtx): void {
    if (item >= 0 && mu > 0) ctx.consumed[item] = ctx.consumed[item]! + mu;
  }
  override hash(): void {}
  override snapshot(): unknown { return null; }
  override restore(): void {}
}

// ── Plain powered building without flows (no building compiles to it today) ──
export class ConsumerNode extends FNode {
  readonly kind = 'consumer' as const;
  constructor(ent: number, kw: number) {
    super(ent);
    this.kw = kw;
    this.idleKw = kw;
  }
  override update(ctx: TickCtx): void {
    this.status = this.net >= 0 && ctx.sat[this.net]! > 0 ? St.Ok : St.Unpowered;
  }
  override demand(): number { return this.kw; }
  override hash(): void {}
  override snapshot(): unknown { return null; }
  override restore(): void {}
}
