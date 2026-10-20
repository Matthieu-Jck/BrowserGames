// orders.ts (system) — CrierBelt's delivery orders (D153, « Commandes de la Criée »): timed orders
// for the base's own goods, paid above the market, the goals of a base past its tutorial. The
// goods it asks for and the kits it pays are content (content/orders.ts), every number is
// `BAL.orders`; the trade system calls the two halves below at each minute's boundary.
//
// The life of an order, at the world's minute boundaries — online in `Sim.step`, offline in the
// catch-up, both through `tradeEpoch`, so its ledger is offline-exact:
//   · posted: once the tutorial is over (or skipped), the first order at the next boundary — quartz,
//     D146's surplus nobody tells the player to sell (`BAL.orders.first`) —, then one every
//     `everyMin` world minutes while fewer than `open` stand. It is drawn from the world's seed, the
//     claim's and the world minute (as the Gazette's events), among the goods the base can make now
//     at its Core's level (`orderGoods`), never one another standing order asks for; its size grows
//     with the Core's level, its price is the bid then plus a premium, CrierBelt's fee waived; it may
//     carry a special reward (a bonus in ocelles, a building kit, a research learnt early; never AI
//     tokens: the owner rules out any reserve of them);
//   · accepted (`acceptDelivery`, a logged command): its window starts, `windowMin` minutes. An offer
//     nobody accepts is withdrawn `offerMin` minutes after it was posted, without a word;
//   · filled (`fillAtPost`, called by each trade post before its sales): what a post's entrance
//     brought of an accepted order's item goes to the order first, within the post's lift, the
//     orders in the order they were posted; the rest is sold as ever. Off the market, as the starter
//     contract (D101): the prices never see it;
//   · closed (`deliveryEpoch`, after the posts): filled — paid in full at its price, its reward
//     delivered —, or its window run out — what it got is paid as the post would have sold it (the
//     bid less CrierBelt's fee): a missed order simply closes, its premium lost, nothing else (D153).
// Integers only (whole items, centi-◉, absolute epochs); every draw a hash of its inputs.
import { BAL } from '@/content/balance';
import { ORDER_GOODS, ORDER_KITS, type OrderGood } from '@/content/orders';
import { QUEST_IDS } from '@/content/quests';
import { RECIPES } from '@/content/recipes';
import { BUILDINGS } from '@/content/buildings';
import { ITEM_IDS, N_ITEMS, buildingDef, buildingIdx, costOf, hasResearch, itemDef, itemIdx, RESEARCH_IDS } from '@/content/registry';
import { RENAMED } from '@/content/retired';
import type { BuildingDef, RecipeDef } from '@/content/types';
import { ceilDiv, mulDiv } from '@/core/fixed';
import { hash32, type StateHasher } from '@/core/hash';
import { afterFee, valueCents } from '@/market/pricing';
import { book } from '../purse';
import { researchBlock } from './research';
import { LEDGER_MAX } from '../trade';
import type { Sim } from '../state';

/** A special reward (D153): a bonus in ocelles (centi-◉), a building kit to the Core, a research node learnt early. */
export type OrderReward =
  | { k: 'credits'; cents: number }
  | { k: 'kit'; def: string; n: number }
  | { k: 'node'; id: string };

export interface DeliveryOrder {
  id: number;
  /** The item asked (registry index). */
  item: number;
  /** Whole items asked, and delivered so far. */
  n: number;
  got: number;
  /** What it pays an item (centi-◉): the bid when it was posted plus its premium, no fee. */
  cents: number;
  /** Absolute world epochs: posted; the offer withdrawn unless accepted by then. */
  posted: number;
  offerEnd: number;
  /** Minutes to deliver once accepted. */
  windowMin: number;
  /** The epoch its window closes at, once accepted (−1: offered, not accepted). */
  due: number;
  /** An event order (bigger, always a reward), and the tutorial's first (quartz). */
  event?: boolean;
  first?: boolean;
  reward?: OrderReward;
}

/** An order closed: filled or missed, what it paid (centi-◉), and when. */
export interface ClosedOrder {
  id: number;
  item: number;
  n: number;
  got: number;
  cents: number;
  paid: number;
  what: 'filled' | 'missed';
  epoch: number;
  reward?: OrderReward;
}

export interface DeliveryState {
  /** The orders standing (offered or accepted), in the order they were posted. Saved, hashed. */
  open: DeliveryOrder[];
  nextId: number;
  /** The first order (the tutorial's next step) was posted. */
  firstPosted: boolean;
  /** The last orders closed, newest first (`BAL.orders.past`): statistics, saved, not hashed. */
  past: ClosedOrder[];
  /** Lifetime: orders filled, missed, and what they paid (centi-◉). Statistics. */
  filled: number;
  missed: number;
  paid: number;
}

export const newDeliveryState = (): DeliveryState => ({ open: [], nextId: 1, firstPosted: false, past: [], filled: 0, missed: 0, paid: 0 });

/** Salts of the draws (hash32 lanes): one per choice, so a change of one leaves the others. */
const SALT = 0x0d153;
const H = { item: 1, event: 2, size: 3, premium: 4, window: 5, reward: 6, rewardKind: 7, rewardPick: 8 } as const;
const draw = (sim: Sim, epoch: number, k: number): number => hash32(sim.worldSeed ^ SALT, sim.playerSeed, epoch, k);
/** An integer in [lo, hi] from a draw. */
const inRange = (h: number, [lo, hi]: readonly [number, number]): number => lo + (h % (hi - lo + 1));

/** Is the tutorial over (every quest met) or skipped: CrierBelt posts orders from then on. */
export function tutorialOver(sim: Sim): boolean {
  const q = sim.quests;
  return q.skipped || q.cur >= QUEST_IDS.length;
}

/** The recipes that make each item (by index), built once. */
let MAKERS: ReadonlyArray<ReadonlyArray<RecipeDef>> | null = null;
const makersOf = (item: number): ReadonlyArray<RecipeDef> => {
  if (!MAKERS) {
    const m: RecipeDef[][] = Array.from({ length: N_ITEMS }, () => []);
    for (const r of Object.values(RECIPES) as RecipeDef[]) for (const [id] of r.outs) m[itemIdx(id)]!.push(r);
    MAKERS = m;
  }
  return MAKERS[item] ?? [];
};

/**
 * Can the base make or extract this good now (D153: never something impossible)? A raw good: the
 * tree nodes that extract it held; a made good: a recipe that makes it unlocked, with a machine that
 * runs it unlocked too.
 */
export function canMake(sim: Sim, item: number): boolean {
  const g = ORDER_GOODS[ITEM_IDS[item] ?? ''];
  if (!g) return false;
  if (g.needs) return g.needs.every((u) => sim.unlocked(u));
  return makersOf(item).some((r) => sim.unlocked(r.unlock) && r.machines.some((m) => sim.unlocked((BUILDINGS as Record<string, BuildingDef>)[m]!.unlock)));
}

/** The goods CrierBelt may ask this base for now, ascending: makeable, at its Core's level, priced, none another standing order asks for. */
export function orderGoods(sim: Sim): number[] {
  const taken = new Set(sim.deliveries.open.map((o) => o.item));
  const out: number[] = [];
  for (const id of Object.keys(ORDER_GOODS).sort()) {
    const it = itemIdx(id), g = ORDER_GOODS[id]!;
    if (g.level > sim.hearthLevel || taken.has(it) || (sim.prices.bid[it] ?? 0) <= 0 || !canMake(sim, it)) continue;
    out.push(it);
  }
  return out.sort((a, b) => a - b);
}

/** A round number of items: by 5 under 50, 10 under 200, 25 under 1 000, 50 above; at least 5. */
export function roundItems(n: number): number {
  const step = n < 50 ? 5 : n < 200 ? 10 : n < 1000 ? 25 : 50;
  return Math.max(5, Math.round(n / step) * step);
}

/** The research nodes the tree offers now (its prereqs, gates and tier open; not learnt, running or queued), ascending. */
function offeredNodes(sim: Sim): string[] {
  const queued = new Set(sim.labQueue.values());
  return [...RESEARCH_IDS].filter((id) => !queued.has(id) && OFFERED.has(researchBlock(sim, id))).sort();
}
/** A node the tree offers: it could start but for a lab, a slot or its resources. */
const OFFERED: ReadonlySet<string | null> = new Set([null, 'slots', 'no_lab', 'unaffordable', 'reserve']);

/** A level's bonus (centi-◉, BAL.orders.bonus in ◉). */
const bonusAt = (level: number): number => BAL.orders.bonus[Math.max(1, Math.min(BAL.orders.bonus.length, level)) - 1]! * 100;

/** A special reward for an order posted at `epoch`: an event's is a research node the tree offers (else three times the bonus), an ordinary one's a bonus or a kit. */
function rewardFor(sim: Sim, epoch: number, event: boolean): OrderReward {
  const level = sim.hearthLevel;
  if (event) {
    const nodes = offeredNodes(sim);
    if (nodes.length) return { k: 'node', id: nodes[draw(sim, epoch, H.rewardPick) % nodes.length]! };
    return { k: 'credits', cents: bonusAt(level) * BAL.orders.eventWorth };
  }
  const kits = ORDER_KITS.filter((k) => sim.unlocked(buildingDef(buildingIdx(k.def)).unlock));
  if (kits.length && draw(sim, epoch, H.rewardKind) % 2 === 1) {
    // The latest kits the base has unlocked (the table runs from the first ones to the late ones).
    const last = kits.slice(-3);
    const k = last[draw(sim, epoch, H.rewardPick) % last.length]!;
    return { k: 'kit', def: k.def, n: k.n };
  }
  return { k: 'credits', cents: bonusAt(level) };
}

/** An item's price on an order: the bid plus `premium` ‰, rounded up to the centi-◉. */
const priceOf = (bid: number, premium: number): number => ceilDiv(bid * (1000 + premium), 1000);

/** The tutorial's next step (D146 problem 7): quartz, through the post (null when the base cannot cut quartz). */
function firstOrder(sim: Sim, epoch: number): DeliveryOrder | null {
  const F = BAL.orders.first, it = itemIdx(F.item), bid = sim.prices.bid[it] ?? 0;
  if (bid <= 0 || !canMake(sim, it)) return null;
  return {
    id: sim.deliveries.nextId++, item: it, n: F.n, got: 0, cents: priceOf(bid, F.premium), posted: epoch,
    offerEnd: epoch + BAL.orders.offerMin, windowMin: F.windowMin, due: -1, first: true, reward: { k: 'credits', cents: F.bonus * 100 },
  };
}

/** A new order drawn for `epoch` (null: nothing the base can make has a price). */
export function drawOrder(sim: Sim, epoch: number): DeliveryOrder | null {
  const goods = orderGoods(sim);
  if (!goods.length) return null;
  const O = BAL.orders;
  const weights = goods.map((it) => (ORDER_GOODS[ITEM_IDS[it]!] as OrderGood).w);
  let pick = draw(sim, epoch, H.item) % weights.reduce((a, b) => a + b, 0), item = goods[0]!;
  for (let i = 0; i < goods.length; i++) { if (pick < weights[i]!) { item = goods[i]!; break; } pick -= weights[i]!; }
  const g = ORDER_GOODS[ITEM_IDS[item]!]!;
  const level = Math.max(1, Math.min(O.worth.length, sim.hearthLevel));
  const event = level >= 2 && draw(sim, epoch, H.event) % 1000 < O.eventChance;
  // Its size: the level's worth (◉ at the item's reference value), drawn in the spread; an event's three times it.
  const worth = mulDiv(O.worth[level - 1]! * 100 * (event ? O.eventWorth : 1), inRange(draw(sim, epoch, H.size), O.spread), 1000);
  const ref = Math.max(1, Math.round((itemDef(item).value ?? 0) * 100));
  const n = roundItems(Math.floor(worth / ref));
  // Its window: the class's range in steps of 5 minutes, an event's half as long again.
  const [w0, w1] = O.window[g.cls];
  let windowMin = w0 + 5 * (draw(sim, epoch, H.window) % (Math.floor((w1 - w0) / 5) + 1));
  if (event) windowMin = 5 * ceilDiv(windowMin * O.eventWindow, 5000);
  const reward = event || draw(sim, epoch, H.reward) % 1000 < O.rewardChance ? rewardFor(sim, epoch, event) : undefined;
  return {
    id: sim.deliveries.nextId++, item, n, got: 0, cents: priceOf(sim.prices.bid[item]!, inRange(draw(sim, epoch, H.premium), O.premium)),
    posted: epoch, offerEnd: epoch + O.offerMin, windowMin, due: -1, ...(event ? { event: true } : {}), ...(reward ? { reward } : {}),
  };
}

/** What an order pays when filled (centi-◉). */
export const orderPay = (o: Pick<DeliveryOrder, 'n' | 'cents'>): number => o.n * o.cents;

// ── the command ───────────────────────────────────────────────────────────

/** Accept an offered order (logged): its window starts now. False when there is none such, or it was accepted already. */
export function acceptDelivery(sim: Sim, id: number): boolean {
  const o = sim.deliveries.open.find((x) => x.id === id);
  if (!o || o.due >= 0) return false;
  o.due = sim.absEpoch() + o.windowMin;
  sim.log.push({ tick: sim.tick, cmd: { k: 'acceptDelivery', id } });
  return true;
}

// ── the minute's boundary (systems/trade.ts `tradeEpoch`) ─────────────────

/**
 * A post's turn at the boundary, before its sales: the accepted orders take what its entrance
 * brought of their items (`own`, its store, D131), whole items within its lift's `budget` (mu), in
 * the order they were posted. Returns the mu taken (they leave by the post's lift, off the market).
 */
export function fillAtPost(sim: Sim, own: Float64Array, budget: number): number {
  let took = 0;
  for (const o of sim.deliveries.open) {
    if (o.due < 0 || o.got >= o.n) continue;
    const room = Math.floor((budget - took) / 1000);
    if (room <= 0) break;
    const k = Math.min(Math.floor(own[o.item]! / 1000), o.n - o.got, room);
    if (k <= 0) continue;
    own[o.item] = own[o.item]! - k * 1000;
    o.got += k;
    took += k * 1000;
    sim.trade.soldTotal[o.item] = sim.trade.soldTotal[o.item]! + k * 1000;
  }
  return took;
}

/** A payment through the Crier: the purse, its journal (D102: a one-off, `delivery`), the lifetime earnings, a ledger line from CrierBelt. */
function pay(sim: Sim, item: number, mu: number, cents: number): void {
  if (cents <= 0) return;
  sim.credits += cents;
  sim.trade.earned += cents;
  book(sim, 'delivery', cents);
  const t = sim.trade;
  t.ledger.push({ epoch: sim.absEpoch(), post: sim.hearthId, item, kind: 'delivery', mu, cents });
  if (t.ledger.length > LEDGER_MAX) t.ledger.splice(0, t.ledger.length - LEDGER_MAX);
}

/**
 * A filled order's special reward, delivered: a bonus paid with the order, a kit's materials to the
 * Core (above its cap too, as a refund: nothing vanishes), or a research node learnt — when the tree
 * no longer offers it (learnt or running meanwhile), an event's bonus instead. Whether the Mods changed.
 */
function deliverReward(sim: Sim, r: OrderReward, item: number): boolean {
  switch (r.k) {
    case 'credits': pay(sim, item, 0, r.cents); return false;
    case 'kit':
      for (const c of costOf(buildingIdx(r.def))) sim.stock[c.item] = sim.stock[c.item]! + c.mu * r.n;
      return false;
    case 'node':
      if (!hasResearch(r.id) || !offeredNodes(sim).includes(r.id)) { pay(sim, item, 0, bonusAt(sim.hearthLevel) * BAL.orders.eventWorth); return false; }
      sim.done.add(r.id);
      sim.rebuildDerived();
      sim.dirty = true;
      sim.jobsDirty = true;
      sim.events.push({ k: 'research', id: r.id }, { k: 'structure' });
      return true;
  }
}

/** Into the history (newest first, `BAL.orders.past` kept). */
function close(sim: Sim, o: DeliveryOrder, what: ClosedOrder['what'], paid: number, epoch: number): void {
  const st = sim.deliveries;
  st.past.unshift({ id: o.id, item: o.item, n: o.n, got: o.got, cents: o.cents, paid, what, epoch, ...(o.reward ? { reward: o.reward } : {}) });
  if (st.past.length > BAL.orders.past) st.past.length = BAL.orders.past;
  if (what === 'filled') st.filled++; else st.missed++;
  st.paid += paid;
}

/**
 * The orders' boundary, after every post took its share (`fillAtPost`): the filled ones paid and
 * rewarded, the ones whose window ran out closed (what they got paid at the bid less the post's fee
 * `feePermille`), the offers past their time withdrawn; then a new order posted when one is due.
 * Whether the Mods changed (a research learnt: the graph must be rebuilt, offline too).
 */
export function deliveryEpoch(sim: Sim, bid: readonly number[], feePermille: number): boolean {
  const st = sim.deliveries, now = sim.absEpoch();
  let changed = false;
  const keep: DeliveryOrder[] = [];
  for (const o of st.open) {
    if (o.due >= 0 && o.got >= o.n) {
      const cents = orderPay(o);
      pay(sim, o.item, o.n * 1000, cents);
      if (o.reward) changed = deliverReward(sim, o.reward, o.item) || changed;
      close(sim, o, 'filled', cents, now);
      sim.events.push({ k: 'delivery', what: 'filled', id: o.id, item: o.item, n: o.n, got: o.got, cents, ...(o.reward ? { reward: o.reward } : {}) });
    } else if (o.due >= 0 && now >= o.due) {
      const cents = o.got > 0 && (bid[o.item] ?? 0) > 0 ? afterFee(valueCents(o.got * 1000, bid[o.item]!, 'sell'), 'sell', feePermille) : 0;
      pay(sim, o.item, o.got * 1000, cents);
      close(sim, o, 'missed', cents, now);
      sim.events.push({ k: 'delivery', what: 'missed', id: o.id, item: o.item, n: o.n, got: o.got, cents });
    } else if (o.due < 0 && now >= o.offerEnd) {
      sim.events.push({ k: 'delivery', what: 'withdrawn', id: o.id, item: o.item, n: o.n, got: 0, cents: 0 });
    } else keep.push(o);
  }
  st.open = keep;
  // A new order: the first right after the tutorial, then on the world's clock while fewer stand.
  if (tutorialOver(sim) && st.open.length < BAL.orders.open && (!st.firstPosted || now % BAL.orders.everyMin === 0)) {
    const o = (!st.firstPosted ? firstOrder(sim, now) : null) ?? drawOrder(sim, now);
    if (o) {
      st.firstPosted = true;
      st.open.push(o);
      sim.events.push({ k: 'delivery', what: 'posted', id: o.id, item: o.item, n: o.n, got: 0, cents: o.cents, ...(o.reward ? { reward: o.reward } : {}), ...(o.first ? { first: true } : {}) });
    }
  }
  return changed;
}

// ── the readings the UI shares ────────────────────────────────────────────

/** The orders accepted and running (the HUD's chip), in the order they were posted. */
export const runningOrders = (sim: Sim): DeliveryOrder[] => sim.deliveries.open.filter((o) => o.due >= 0);

/** Game seconds left of an order's window (accepted) or of its offer (not): to the boundary of that epoch. */
export function orderSecondsLeft(sim: Sim, o: DeliveryOrder, tps: number, epochTicks: number): number {
  const end = o.due >= 0 ? o.due : o.offerEnd;
  return Math.max(0, (end - sim.absEpoch()) * (epochTicks / tps) - (sim.tick % epochTicks) / tps);
}

// ── save & hash ───────────────────────────────────────────────────────────

/** In a save, items by id (a save outlives the registry's order: 'plain' in FIELDS). */
type Saved<T extends { item: number }> = Omit<T, 'item'> & { item: string };
export interface DeliverySave {
  open: Array<Saved<DeliveryOrder>>;
  nextId: number;
  firstPosted: boolean;
  past?: Array<Saved<ClosedOrder>>;
  filled?: number;
  missed?: number;
  paid?: number;
}

export function saveDeliveries(st: DeliveryState): DeliverySave {
  const id = (i: number): string => ITEM_IDS[i]!;
  return {
    open: st.open.map((o) => ({ ...o, item: id(o.item), ...(o.reward ? { reward: { ...o.reward } } : {}) })),
    nextId: st.nextId, firstPosted: st.firstPosted,
    past: st.past.map((o) => ({ ...o, item: id(o.item) })),
    filled: st.filled, missed: st.missed, paid: st.paid,
  };
}

/** The rewards an order may carry today: one of another kind in a save is dropped at load. */
const REWARD_KINDS: ReadonlySet<string> = new Set<OrderReward['k']>(['credits', 'kit', 'node']);

/** An item id of a save, today's index (renamed ids followed; −1: gone). */
const itemOf = (id: string): number => {
  const i = ITEM_IDS.indexOf(id as never);
  return i >= 0 ? i : ITEM_IDS.indexOf((RENAMED.items as Record<string, string>)[id] as never);
};

/**
 * Load a save's orders (absent: none yet). An order whose item is gone from the content closes: what
 * it got is paid at its own price (CrierBelt holds those goods: nothing the base sent is lost).
 */
export function loadDeliveries(sim: Sim, d: DeliverySave | undefined): void {
  const st = newDeliveryState();
  if (d) {
    for (const o of d.open) {
      const it = itemOf(o.item);
      if (it < 0) { sim.credits += o.got * o.cents; continue; }
      const { reward, ...rest } = o;
      st.open.push({ ...rest, item: it, ...(reward && REWARD_KINDS.has(reward.k) ? { reward: { ...reward } } : {}) });
    }
    st.nextId = d.nextId;
    st.firstPosted = d.firstPosted;
    for (const o of d.past ?? []) { const it = itemOf(o.item); if (it >= 0) st.past.push({ ...o, item: it }); }
    st.filled = d.filled ?? 0;
    st.missed = d.missed ?? 0;
    st.paid = d.paid ?? 0;
  }
  sim.deliveries = st;
}

/** What of the orders is game state (the standing orders; not the history). */
export function hashDeliveries(st: DeliveryState, h: StateHasher): void {
  h.int(st.nextId).int(st.firstPosted ? 1 : 0).int(st.open.length);
  for (const o of st.open) {
    h.int(o.id).int(o.item).int(o.n).int(o.got).int(o.cents).int(o.posted).int(o.offerEnd).int(o.windowMin).int(o.due).int(o.event ? 1 : 0).int(o.first ? 1 : 0);
    const r = o.reward;
    if (r) h.str(r.k).str(r.k === 'kit' ? r.def : r.k === 'node' ? r.id : '').int(r.k === 'credits' ? r.cents : r.k === 'kit' ? r.n : 0);
  }
}
