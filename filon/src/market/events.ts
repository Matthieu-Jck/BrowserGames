// events.ts — the Crier's world events and its Gazette, as pure functions of (world seed,
// epoch). Time is cut into 6 h world windows aligned on absolute epochs; a window holds one
// event with probability 35 % (hash of the seed and the window), and further hashes draw its
// kind, target, host colony, start within the window, length and announcement lead (1–3 h).
// Every colony of a world thus sees the same events at the same epochs, whenever it was
// founded. Each colony adds its own scripted first trade: glass runs short at Port-Écume
// 20 min after its founding, for 2 h (BAL.market.firstTrade). Kinds (§6): shortage (demand ×2
// of an item), tier boom (demand ×1.5 of a tier), glut (supply ×1.8), storm season (demand
// ×2.5 of charged batteries), unique caravan (supply ×2 of a unique).
import { BAL } from '@/content/balance';
import { ITEMS } from '@/content/items';
import { ITEM_IDS, itemIdx } from '@/content/registry';
import type { ItemDef } from '@/content/types';
import { hash32, hashUnit } from '@/core/hash';
import { colonyByKey, type Colony, type ItemTrade } from './colonies';
import type { EventKind, MarketEvent } from './types';

const M = BAL.market;
const WIN = M.eventWindowMin;
export const EVENT_KINDS = Object.keys(M.events) as EventKind[];
/** The longest event (minutes): how far back a window can still matter. */
export const MAX_EVENT_MIN = Math.max(...EVENT_KINDS.map((k) => M.events[k].hours[1])) * 60;
const MAX_LEAD = M.eventLeadMin[1];
const SALT = { roll: 0xe7e1, kind: 0xe7e2, target: 0xe7e3, host: 0xe7e4, start: 0xe7e5, len: 0xe7e6, lead: 0xe7e7 } as const;

const tierOf = (i: number): number => (ITEMS[ITEM_IDS[i]!] as ItemDef).tier;

/** What events draw their targets from. */
export interface EventWorld {
  /** Tradable item indices, registry order. */
  readonly tradable: readonly number[];
  /** Unique resources among them. */
  readonly uniques: readonly number[];
  readonly trade: readonly ItemTrade[];
  readonly colonies: readonly Colony[];
}

/** Pick an index by integer weights from a hash. */
function pickWeighted(h: number, weights: readonly number[]): number {
  const total = weights.reduce((a, w) => a + w, 0);
  let r = h % total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** A colony from a list of shares (summing to 1), by a hashed unit; −1 for an empty list. */
function pickShare(u: number, list: ReadonlyArray<{ readonly colony: number; readonly share: number }>): number {
  let acc = 0;
  for (const e of list) {
    acc += e.share;
    if (u < acc) return e.colony;
  }
  return list.length ? list[list.length - 1]!.colony : -1;
}

/** The world event of window w, or null: the same for every colony of the world. */
export function windowEvent(seed: number, w: number, world: EventWorld): MarketEvent | null {
  if (hash32(seed, SALT.roll, w) % 1000 >= M.eventChance) return null;
  const kind = EVENT_KINDS[pickWeighted(hash32(seed, SALT.kind, w), EVENT_KINDS.map((k) => M.events[k].weight))]!;
  const spec = M.events[kind];
  const ht = hash32(seed, SALT.target, w);
  let item = -1, tier = 0;
  if (kind === 'boom') tier = 1 + pickWeighted(ht, M.eventTierWeights);
  else if (kind === 'storm') item = itemIdx(M.stormItem);
  else if (kind === 'caravan') item = world.uniques[ht % world.uniques.length]!;
  else item = world.tradable[pickWeighted(ht, world.tradable.map((i) => M.eventTierWeights[tierOf(i) - 1]!))]!;
  // The Gazette places a shortage at a buyer, a glut or a caravan at a supplier.
  const hu = hashUnit(seed, SALT.host, w);
  const colony = kind === 'shortage' ? pickShare(hu, world.trade[item]!.buyers)
    : kind === 'glut' || kind === 'caravan' ? pickShare(hu, world.trade[item]!.sources) : -1;
  const start = w * WIN + (hash32(seed, SALT.start, w) % WIN);
  const [h0, h1] = spec.hours;
  const end = start + (h0 + (hash32(seed, SALT.len, w) % (h1 - h0 + 1))) * 60;
  const [l0, l1] = M.eventLeadMin;
  const announce = start - (l0 + (hash32(seed, SALT.lead, w) % (l1 - l0 + 1)));
  return { id: `w${w}`, kind, side: spec.side, mult: spec.mult, item: item >= 0 ? ITEM_IDS[item]! : null, tier, colony, announce, start, end, scripted: false };
}

/** The colony's scripted first trade: a glass-bulb shortage at Port-Écume, announced at founding. */
export function firstTradeEvent(foundingEpoch: number, colonies: readonly Colony[]): MarketEvent {
  const f = M.firstTrade;
  const start = foundingEpoch + f.afterMin;
  return {
    id: 'first-trade', kind: 'shortage', side: 'demand', mult: f.mult, item: f.item, tier: 0,
    colony: colonyByKey(colonies, f.colony), announce: start - f.leadMin, start, end: start + f.durationMin, scripted: true,
  };
}

const byStart = (a: MarketEvent, b: MarketEvent): number => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The events around a moving epoch: window events memoised (pure, so the memo never needs
 * saving), plus the colony's own scripted ones.
 */
export class EventSchedule {
  private readonly memo = new Map<number, MarketEvent | null>();
  private readonly scan: Array<MarketEvent | null> = [];

  constructor(
    private readonly seed: number,
    private readonly world: EventWorld,
    private readonly own: readonly MarketEvent[],
    private readonly worldEvents: boolean,
  ) {}

  private window(w: number): MarketEvent | null {
    let e = this.memo.get(w);
    if (e === undefined) {
      e = this.worldEvents ? windowEvent(this.seed, w, this.world) : null;
      if (this.memo.size >= 96) for (const k of [...this.memo.keys()]) if (Math.abs(k - w) > 24) this.memo.delete(k);
      this.memo.set(w, e);
    }
    return e;
  }

  /** Every event whose [announce, end) can contain t (a superset: callers test the times). */
  private near(t: number): Array<MarketEvent | null> {
    const s = this.scan;
    s.length = 0;
    const w0 = Math.floor((t - MAX_EVENT_MIN) / WIN) - 1, w1 = Math.floor((t + MAX_LEAD) / WIN) + 1;
    for (let w = w0; w <= w1; w++) s.push(this.window(w));
    for (const e of this.own) s.push(e);
    return s;
  }

  /** Events in progress at t (start ≤ t < end), by start then id. */
  active(t: number): MarketEvent[] {
    const out: MarketEvent[] = [];
    for (const e of this.near(t)) if (e && e.start <= t && t < e.end) out.push(e);
    return out.sort(byStart);
  }

  /** Events the Gazette has announced by t that have not started yet. */
  announced(t: number): MarketEvent[] {
    const out: MarketEvent[] = [];
    for (const e of this.near(t)) if (e && e.announce <= t && t < e.start) out.push(e);
    return out.sort(byStart);
  }

  /** Append the events starting, ending and announced exactly at t. */
  boundaries(t: number, started: MarketEvent[], ended: MarketEvent[], announced: MarketEvent[]): void {
    for (const e of this.near(t)) {
      if (!e) continue;
      if (e.start === t) started.push(e);
      if (e.end === t) ended.push(e);
      if (e.announce === t) announced.push(e);
    }
  }
}

/** The events in progress at epoch t in a world (pure; for tests and tools). */
export function eventsAt(seed: number, t: number, world: EventWorld, own: readonly MarketEvent[] = []): MarketEvent[] {
  return new EventSchedule(seed, world, own, true).active(t);
}
