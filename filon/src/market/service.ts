// service.ts — LocalMarketService, the NPC market behind the MarketService contract (design §9):
// what the sim's trade post calls once per epoch (`settle`, online and in the offline catch-up
// alike), to price spot trades (`quote`, `book`) and to source imports (`sources`); what the
// Crier screen and the orbital view read (`snapshot`, `board`); and what the save holds
// (`save`, `load`). It is a pure function of (world seed, absolute epoch, the player's flows,
// the founding epoch): a future server client implements the same contract.
import { ITEM_IDS, itemIdx } from '@/content/registry';
import { board } from './board';
import { GAP_RESEED, MarketEngine, type Boundaries } from './engine';
import type {
  BoardOptions, BoardRow, ColonyTrade, ColonyView, ImportSource, ItemMarket, ItemRef, MarketConfig,
  MarketEpochIn, MarketEpochOut, MarketSave, MarketService, MarketSnapshot, PriceTable, Quote, TradeSide,
} from './types';

const resolve = (item: ItemRef): number => (typeof item === 'number' ? item : itemIdx(item));
const plainQuote = (q: Quote): Quote => ({
  item: q.item, side: q.side, qtyMu: q.qtyMu, ok: q.ok, totalCents: q.totalCents, unitCents: q.unitCents, factor: q.factor, shock: q.shock,
});

export class LocalMarketService implements MarketService {
  readonly impl = 'npc-v1' as const;
  private readonly eng: MarketEngine;
  /** The colonies as the UI sees them (fixed for the world). */
  readonly colonies: readonly ColonyView[];

  constructor(readonly config: MarketConfig) {
    this.eng = new MarketEngine(config);
    this.colonies = this.eng.colonies.map((c): ColonyView => ({
      idx: c.idx, key: c.key, profile: c.profile, name: c.name, band: c.band, delayMin: c.delayMin,
      lat: c.lat, lon: c.lon, arc: c.arc, size: c.size, growth: c.growth, unique: c.unique,
      supplies: c.supplies, needs: c.needs,
    }));
  }

  /** The epoch the current prices apply to. */
  get epoch(): number {
    return this.eng.epoch + 1;
  }

  settle(input: MarketEpochIn): MarketEpochOut {
    const eng = this.eng;
    const out: Boundaries = { started: [], ended: [], announced: [] };
    const E = input.epoch;
    if (!Number.isInteger(E)) throw new RangeError(`market.settle: epoch ${E} is not an integer`);
    if (E > eng.epoch) {
      // Settles come once per epoch, in order; a gap (a misuse, or a colony saved before the
      // market) is filled with trade-free epochs, or restarted when every τ has long passed.
      if (E - eng.epoch - 1 > GAP_RESEED) eng.reset(E);
      for (let e = eng.epoch + 1; e < E; e++) eng.settleOne(e, undefined, undefined, undefined, 1000, out);
      eng.settleOne(E, input.sold, input.bought, input.spot, input.slippage ?? 1000, out);
    }
    // A stale epoch (≤ the last settled one) changes nothing and returns the current table.
    return { ...this.prices(), ...out };
  }

  prices(): PriceTable {
    return { epoch: this.eng.epoch + 1, bid: Array.from(this.eng.bid), ask: Array.from(this.eng.ask) };
  }

  quote(item: ItemRef, side: TradeSide, qtyMu: number, slippage = 1000): Quote {
    return plainQuote(this.eng.quote(resolve(item), side, qtyMu, slippage));
  }

  book(item: ItemRef, side: TradeSide, qtyMu: number, slippage = 1000): Quote {
    const q = this.eng.quote(resolve(item), side, qtyMu, slippage);
    this.eng.book(q);
    return plainQuote(q);
  }

  sources(item: ItemRef): readonly ImportSource[] {
    const i = resolve(item);
    return this.eng.tradable[i] ? this.eng.trade[i]!.sources : [];
  }

  snapshot(): MarketSnapshot {
    const eng = this.eng, t = eng.epoch + 1;
    const items = eng.items.map((i): ItemMarket => {
      const h = eng.hist[i]!, mid = eng.mid[i]!, first = h[0] ?? mid;
      return {
        idx: i, item: ITEM_IDS[i]!, tier: eng.tier[i]!, unique: eng.unique[i] === 1, value: eng.V[i]!,
        bid: eng.bid[i]!, ask: eng.ask[i]!, mid, r: mid / 100 / eng.V[i]!, eq: Math.exp(eng.lnRf[i]!),
        depth: { supply: eng.S0[i]!, demand: eng.D0[i]! },
        history: h.slice(), trend: first > 0 ? mid / first - 1 : 0,
        flow: { sold: eng.lastX[i]!, bought: eng.lastM[i]! },
        sources: eng.trade[i]!.sources,
      };
    });
    const trade: ColonyTrade[] = [];
    for (let c = 0; c < eng.colonies.length; c++) {
      const exportCpm = Math.round(eng.expCpm[c]!), importCpm = Math.round(eng.impCpm[c]!);
      if (exportCpm > 0 || importCpm > 0) trade.push({ colony: c, exportCpm, importCpm });
    }
    return {
      epoch: t, colonies: this.colonies, items,
      events: { active: eng.schedule.active(t), announced: eng.schedule.announced(t) },
      trade,
    };
  }

  board(recipes: readonly string[], energyCost: number, opts?: BoardOptions): BoardRow[] {
    return board(this.eng, recipes, energyCost, opts);
  }

  save(): MarketSave {
    const eng = this.eng;
    const items: Record<string, number[]> = {};
    const history: Record<string, number[]> = {};
    for (const i of eng.items) {
      const id = ITEM_IDS[i]!;
      items[id] = [eng.lnRf[i]!, eng.lnEv[i]!, eng.shock[i]!, eng.sumX[i]!, eng.sumM[i]!, eng.lastX[i]!, eng.lastM[i]!, eng.booked[i]!];
      history[id] = eng.hist[i]!.slice();
    }
    const trade: Record<string, number[]> = {};
    for (const c of eng.colonies) trade[c.key] = [eng.expCpm[c.idx]!, eng.impCpm[c.idx]!];
    return { v: 1, epoch: eng.epoch, heavyAt: eng.heavyAt, blockN: eng.blockN, items, history, trade };
  }

  /**
   * A market restored from its save: the flow-dependent state is copied back, everything else
   * recomputed from the config's seeds, so its future settles match the original's exactly.
   * Items or colonies added to the content since start fresh; removed ones are ignored.
   */
  static load(save: MarketSave, config: MarketConfig): LocalMarketService {
    if (!save || save.v !== 1) throw new Error(`market save: unsupported version ${String(save?.v)}`);
    if (![save.epoch, save.heavyAt, save.blockN].every(Number.isInteger) || !save.items || !save.history || !save.trade) {
      throw new Error('market save: malformed');
    }
    const svc = new LocalMarketService(config);
    const eng = svc.eng;
    eng.epoch = save.epoch;
    eng.heavyAt = save.heavyAt;
    eng.blockN = save.blockN;
    const fields = [eng.lnRf, eng.lnEv, eng.shock, eng.sumX, eng.sumM, eng.lastX, eng.lastM, eng.booked];
    for (const i of eng.items) {
      const id = ITEM_IDS[i]!;
      const v = save.items[id];
      if (v) fields.forEach((a, k) => { a[i] = Number.isFinite(v[k]) ? v[k]! : 0; });
      const h = save.history[id];
      if (h) eng.hist[i] = h.slice();
    }
    eng.expCpm.fill(0);
    eng.impCpm.fill(0);
    for (const c of eng.colonies) {
      const v = save.trade[c.key];
      if (v) { eng.expCpm[c.idx] = v[0] ?? 0; eng.impCpm[c.idx] = v[1] ?? 0; }
    }
    eng.rederive();
    return svc;
  }
}
