// report.ts — the "while you were away" report: structured ids and numbers only (the UI
// localises). Shared by the offline catch-up and the online statistics panels.
import { N_ITEMS } from '@/content/registry';

export type IncidentKind =
  | 'storageFull' | 'storageEmpty' | 'storageOk' | 'brownout' | 'accEmpty' | 'accFull'
  | 'researchDone' | 'built' | 'orderPaused' | 'orderResumed' | 'leaseLapsed'
  // The purse went into the red (research held: its tokens could not be paid, D68), or back out.
  | 'researchHeld' | 'researchResumed';

/** `parcel`: a lease that lapsed (the purse could not pay its hour; docs/land.md). */
export interface Incident { tick: number; kind: IncidentKind; item?: number; ent?: number; ref?: string; parcel?: number }

export interface AwayReport {
  fromTick: number;
  toTick: number;
  /** 'direct' = ticked one by one; 'exact' = all regimes periodic; 'approx' = some averaged. */
  mode: 'direct' | 'exact' | 'approx';
  computeMs: number;
  warmups: number;
  /** Total ticks simulated by warm-ups (cost indicator). */
  warmTicks: number;
  produced: Float64Array;
  consumed: Float64Array;
  /** Net change of the Hearth stock per item (milli-items). */
  hearthDelta: Float64Array;
  creditsDelta: number;
  /** Through the Crier during the absence: mu sold / bought per item, ocelles earned / spent (centi-◉). */
  sold: Float64Array;
  bought: Float64Array;
  earned: number;
  spent: number;
  incidents: Incident[];
  /** Per-item estimate of what could not be stored because storage was full (milli-items). */
  lostMu: Float64Array;
  /**
   * Averaging error at the edges of approximate regimes: mu a store would have gone below 0
   * (clamped: created) — the honest error bar of 'approx' mode, per item.
   */
  clampedMu: Float64Array;
}

export function newReport(from: number): AwayReport {
  return {
    fromTick: from, toTick: from, mode: 'exact', computeMs: 0, warmups: 0, warmTicks: 0,
    produced: new Float64Array(N_ITEMS), consumed: new Float64Array(N_ITEMS),
    hearthDelta: new Float64Array(N_ITEMS), creditsDelta: 0, incidents: [], lostMu: new Float64Array(N_ITEMS),
    sold: new Float64Array(N_ITEMS), bought: new Float64Array(N_ITEMS), earned: 0, spent: 0,
    clampedMu: new Float64Array(N_ITEMS),
  };
}
