// types.ts — the market's public shapes: the `MarketService` contract (design §9), the only
// point of contact between the sim and the Crier, and the plain data it returns. Whatever
// reaches the sim is an integer: prices in centi-ocelles per item (◉ × 100), quantities in
// milli-items (mu, 1 item = 1 000 mu), times in absolute world epochs (minutes). Items are
// referenced by registry index (as the sim stores them) or by string id. Views for the UI
// (snapshot, board) carry ids and numbers only: the UI translates.
import type { ColonyProfileId, DistanceBand } from '@/content/colonies';
import type { Loc } from '@/content/types';

export type TradeSide = 'buy' | 'sell';

/** An item index (registry order) or an item id. */
export type ItemRef = number | string;

export interface MarketConfig {
  /** Shared world seed (WORLD_SEED): colonies, noise and events are the same for everyone. */
  readonly worldSeed: number;
  /** Absolute world epoch of the colony's founding: day 0 of growth, ramps and the first trade. */
  readonly foundingEpoch: number;
  /**
   * First epoch the market prices (default: foundingEpoch). Later for a colony saved before the
   * market existed: the market starts there at its no-trade equilibrium, without replaying.
   */
  readonly startEpoch?: number;
  /** World events (default true), the scripted first-trade shortage (default true), price noise (default true): off for tests and tools. */
  readonly events?: boolean;
  readonly firstTrade?: boolean;
  readonly noise?: boolean;
}

export type EventKind = 'shortage' | 'boom' | 'glut' | 'storm' | 'caravan';

/** A world event (or the scripted first trade): ids and numbers, the Gazette's text is the UI's. */
export interface MarketEvent {
  /** `w<window>` for a world event (one per 6 h window at most), `first-trade` for the scripted one. */
  readonly id: string;
  readonly kind: EventKind;
  /** Which NPC curve it multiplies. */
  readonly side: 'supply' | 'demand';
  readonly mult: number;
  /** Target item id; null for a tier boom. */
  readonly item: string | null;
  /** Target tier of a boom (1–4); 0 otherwise. */
  readonly tier: number;
  /** Host colony index (where the Gazette places it), −1 for world-wide events. */
  readonly colony: number;
  /** Absolute epochs: the Gazette announces it, it starts, it ends (exclusive). */
  readonly announce: number;
  readonly start: number;
  readonly end: number;
  readonly scripted: boolean;
}

/** What the sim reports at an epoch boundary: the trade of the epoch that just ended. */
export interface MarketEpochIn {
  /** Absolute world epoch that just ended (the flows happened during it): `sim.absEpoch() − 1` at the boundary. */
  readonly epoch: number;
  /** mu exported by the trade post's streams during that epoch, by item index. */
  readonly sold?: ArrayLike<number>;
  /** mu imported by standing orders during it, by item index. */
  readonly bought?: ArrayLike<number>;
  /**
   * mu traded at once (sold +, bought −) and NOT already booked through `book()` — for callers
   * that only log per-epoch totals. Its lasting price shock applies from the next epoch.
   */
  readonly spot?: ArrayLike<number>;
  /** Spot slippage ‰ for `spot` (Market Sense: 700); default 1 000. */
  readonly slippage?: number;
}

/** The integer price table the sim trades at for one epoch. */
export interface PriceTable {
  /** The epoch these prices apply to. */
  readonly epoch: number;
  /** Centi-ocelles per item, by item index; 0 for items that are not tradable (water). */
  readonly bid: number[];
  readonly ask: number[];
}

export interface MarketEpochOut extends PriceTable {
  /** Events that start / end at `epoch`, and Gazette announcements made then. */
  readonly started: MarketEvent[];
  readonly ended: MarketEvent[];
  readonly announced: MarketEvent[];
}

/** A spot trade priced along the market's depth (before the trade post's fee). */
export interface Quote {
  readonly item: number;
  readonly side: TradeSide;
  readonly qtyMu: number;
  /** False when the item is not tradable (then every amount is 0). */
  readonly ok: boolean;
  /** What the player receives (sell, rounded down) or pays (buy, rounded up), centi-ocelles. */
  readonly totalCents: number;
  /** Average per item, centi-ocelles (rounded). */
  readonly unitCents: number;
  /** Average price ÷ the epoch's bid (sell) or ask (buy): 0.787 for 9 000 plates sold at once. */
  readonly factor: number;
  /** Lasting price factor this trade leaves once settled: 0.75 (−25 %) for those 9 000 plates. */
  readonly shock: number;
}

/** A colony an import can come from: the trade post fills from the nearest one. */
export interface ImportSource {
  readonly colony: number;
  /** Delivery delay of that colony (minutes), before the trade post's own lift delay and research. */
  readonly delayMin: number;
  /** Its share of the item's NPC supply (0–1). */
  readonly share: number;
}

/** A sister colony as the UI and the orbital view see it (fixed for the world). */
export interface ColonyView {
  readonly idx: number;
  /** Stable key: a pinned colony's (`port_ecume`) or `<profile>_<rank>`. */
  readonly key: string;
  readonly profile: ColonyProfileId;
  readonly name: Loc;
  readonly band: DistanceBand;
  readonly delayMin: number;
  /** Position on Ysmère (degrees) and great-circle distance from the cirque (degrees). */
  readonly lat: number;
  readonly lon: number;
  readonly arc: number;
  /** Relative size (scales its share of its profile's trade). */
  readonly size: number;
  /** Growth of its trade per day (fraction). */
  readonly growth: number;
  /** Its unique resource, if any. */
  readonly unique: string | null;
  /** Item ids it supplies (unique included) and needs. */
  readonly supplies: readonly string[];
  readonly needs: readonly string[];
}

/** One tradable item in the snapshot. Prices in centi-ocelles; rates in items/min. */
export interface ItemMarket {
  readonly idx: number;
  readonly item: string;
  readonly tier: number;
  readonly unique: boolean;
  /** Reference value V (◉). */
  readonly value: number;
  readonly bid: number;
  readonly ask: number;
  readonly mid: number;
  /** mid ÷ V. */
  readonly r: number;
  /** The smoothed flow equilibrium alone (no event, noise or shock), ÷ V. */
  readonly eq: number;
  /** Base NPC supply and demand S0, D0 (items/min) at the last equilibrium step. */
  readonly depth: { readonly supply: number; readonly demand: number };
  /** Mid price (cents) once per hour, oldest first, up to 24 points. */
  readonly history: number[];
  /** Relative change of the mid over the history (−0.1 = −10 % in 24 h). */
  readonly trend: number;
  /** The player's average flows over the last equilibrium block (items/min). */
  readonly flow: { readonly sold: number; readonly bought: number };
  /** Where an import comes from, nearest first. */
  readonly sources: readonly ImportSource[];
}

/** The player's recent trade with one colony (centi-ocelles per minute, smoothed over ~1 h). */
export interface ColonyTrade {
  readonly colony: number;
  readonly exportCpm: number;
  readonly importCpm: number;
}

export interface MarketSnapshot {
  /** The epoch the current prices apply to. */
  readonly epoch: number;
  readonly colonies: readonly ColonyView[];
  /** Tradable items, in registry order. */
  readonly items: ItemMarket[];
  /** Events in progress, and those the Gazette has announced that have not started yet. */
  readonly events: { readonly active: MarketEvent[]; readonly announced: MarketEvent[] };
  /** Colonies the player traded with recently (non-zero only), for the freight arcs. */
  readonly trade: ColonyTrade[];
}

export interface BoardOptions {
  /**
   * Inputs the player makes at home: valued at the bid (what selling them would bring) and
   * counted in raw tiles. Others are bought at the ask. Default: every input is made at home.
   */
  readonly home?: ReadonlySet<string> | ((item: string) => boolean);
  /** Export flow of each recipe's output for the impact line (items/min, by item id); default: the player's recent flow. */
  readonly flows?: Readonly<Record<string, number>>;
  /** Craft speed ‰ (mods.craftSpeed); default 1 000. */
  readonly craftSpeed?: number;
  /** Deposit caps (items/min per tile) overriding BAL.market.tileCapPerMin, e.g. from the player's map. */
  readonly tileCaps?: Readonly<Record<string, number>>;
}

/** One line of « Ce qui rapporte » — ◉ amounts are floats (display only, never sim state). */
export interface BoardRow {
  readonly recipe: string;
  /** The recipe's output item and the machine assumed (the recipe's first). */
  readonly item: string;
  readonly machine: string;
  /** Crafts per minute per machine. */
  readonly cycles: number;
  /** ◉/min per machine: outputs at the bid; inputs at the bid (home) or ask (bought); energy. */
  readonly revenue: number;
  readonly inputs: number;
  readonly energy: number;
  /** cycles·[Σ outs·bid − Σ ins·(bid | ask)] − kW·energyCost. */
  readonly margin: number;
  /** Raw deposit tiles one machine's home-made chain occupies. */
  readonly tiles: number;
  /** ◉ per raw tile-minute: (revenue − bought inputs − the chain's energy) ÷ tiles; null without tiles. */
  readonly perTile: number | null;
  /** Export flow of the output used for the impact (items/min). */
  readonly flow: number;
  /** r(flow) ÷ r(0) − 1: « at your 120/min the price is −14 % ». */
  readonly impact: number;
}

/**
 * What the market saves: only what depends on the player's flows (JSON-safe numbers and
 * arrays, keyed by stable ids). Colonies, noise, events and depths are recomputed from the
 * seeds.
 */
export interface MarketSave {
  readonly v: 1;
  /** Last settled epoch (prices apply to epoch + 1). */
  readonly epoch: number;
  /** Epoch of the last equilibrium step, and epochs accumulated in the current block. */
  readonly heavyAt: number;
  readonly blockN: number;
  /** Per tradable item id: [ln r_f, ln event offset, ln shock, block sold, block bought, last sold, last bought, booked spot]. */
  readonly items: Readonly<Record<string, readonly number[]>>;
  /** Per item id: hourly mid prices (cents), oldest first. */
  readonly history: Readonly<Record<string, readonly number[]>>;
  /** Per colony key: [export, import] centi-ocelles per minute (smoothed). */
  readonly trade: Readonly<Record<string, readonly number[]>>;
}

/** The market as the sim sees it (design §9); a server client will implement it too. */
export interface MarketService {
  readonly impl: 'npc-v1' | 'server';
  /** Once per epoch, in order, online and in the offline catch-up alike. */
  settle(input: MarketEpochIn): MarketEpochOut;
  /** The current table (the epoch after the last settle). */
  prices(): PriceTable;
  /** Price a spot trade at the current depth (pure: nothing is booked). */
  quote(item: ItemRef, side: TradeSide, qtyMu: number, slippage?: number): Quote;
  /** Price AND book a spot trade: later quotes this epoch continue along the depth curve; its shock lands at the next settle. */
  book(item: ItemRef, side: TradeSide, qtyMu: number, slippage?: number): Quote;
  /** Colonies an import of the item can come from, nearest first. */
  sources(item: ItemRef): readonly ImportSource[];
  snapshot(): MarketSnapshot;
  board(recipes: readonly string[], energyCost: number, opts?: BoardOptions): BoardRow[];
  save(): MarketSave;
  prefetch?(fromEpoch: number, toEpoch: number): Promise<void>;
}
