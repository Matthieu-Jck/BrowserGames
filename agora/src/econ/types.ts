// types.ts — the shared vocabulary of the economics engine. Everything here is plain
// data: pure functions in this folder take these in and return them, with no DOM,
// no Date.now and no Math.random (randomness flows from a seeded Rng).

/** A linear curve P = intercept + slope·Q. Demand: slope < 0. Supply: slope > 0. */
export interface LinearCurve {
  intercept: number; // choke price (demand) / reservation price (supply) at Q=0
  slope: number;
}

/** The free-market equilibrium and the surplus it generates. */
export interface MarketResult {
  priceStar: number;
  qtyStar: number;
  consumerSurplus: number;
  producerSurplus: number;
  totalSurplus: number;
}

export type OutcomeKind = 'shortage' | 'surplus' | 'clearing';

/** What happens if a single price is imposed on the market. */
export interface PriceOutcome {
  price: number;
  qd: number; // quantity demanded
  qs: number; // quantity supplied
  qTraded: number; // the short side rules
  gap: number; // qd − qs (positive ⇒ shortage)
  kind: OutcomeKind;
}

export type ControlKind = 'ceiling' | 'floor';

export interface ControlResult {
  kind: ControlKind;
  price: number;
  binding: boolean;
  qTraded: number;
  shortage: number; // qd − qs when a ceiling bites (else 0)
  surplus: number; // qs − qd when a floor bites (else 0)
  deadweightLoss: number;
  consumerSurplus: number;
  producerSurplus: number;
  csChange: number; // vs free market
  psChange: number;
  equilibrium: MarketResult;
}

export type TaxSide = 'buyer' | 'seller';

export interface TaxResult {
  perUnit: number;
  on: TaxSide;
  qty: number;
  buyerPrice: number; // what buyers pay
  sellerPrice: number; // what sellers keep
  taxRevenue: number;
  deadweightLoss: number;
  incidenceBuyer: number; // price rise borne by buyers
  incidenceSeller: number; // price drop borne by sellers
  csChange: number;
  psChange: number;
  equilibrium: MarketResult;
}

export interface AuctionConfig {
  seed: string | number;
  demand: LinearCurve;
  supply: LinearCurve;
  buyers?: number;
  sellers?: number;
  rounds?: number;
}

export interface AuctionTrade {
  round: number;
  price: number;
  buyerValue: number;
  sellerCost: number;
}

export interface AuctionResult {
  pricePerRound: number[]; // clearing price each round
  runningMean: number[]; // cumulative average — the curve that visibly settles
  trades: AuctionTrade[]; // every executed trade across all rounds
  finalMeanPrice: number; // settled-phase price (mean of the last quarter)
  equilibrium: MarketResult;
  convergenceError: number; // |finalMeanPrice − P*| / P*
  efficiency: number; // realized surplus / max surplus, settled phase
  values: number[]; // buyer reservation values (for the viz)
  costs: number[]; // seller reservation costs (for the viz)
}

export interface Producer {
  name: string;
  /** Units of each good this producer makes per hour of effort. */
  output: [number, number];
}

export interface TradeResult {
  producers: Array<{ name: string; oppCostGood0: number; oppCostGood1: number }>;
  /** Index of the producer with comparative advantage in each good. */
  caProducer: [number, number];
  hours: number;
  autarkyOutput: [number, number]; // 50/50 split, summed across producers
  specializedOutput: [number, number]; // each fully specialised in its CA good
  termsOfTrade: { min: number; max: number; mid: number }; // price of good0 in good1
  gainsExist: boolean;
  autarkyValue: number; // valued at the terms-of-trade midpoint
  specializedValue: number;
  gain: number;
}

export type FisheryPolicy = 'open' | 'quota';

export interface FisheryConfig {
  capacity: number; // carrying capacity K
  growthRate: number; // intrinsic growth r
  initialStock: number;
  seasons: number;
  boats: number;
  catchPerBoat: number;
  policy: FisheryPolicy;
  quota?: number; // total seasonal cap under 'quota'
}

export interface FisheryRun {
  stockPerSeason: number[];
  harvestPerSeason: number[];
  collapsed: boolean;
  collapseSeason: number | null;
  sustainableYield: number; // MSY = rK/4
  finalStock: number;
}
