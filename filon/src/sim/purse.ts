// purse.ts — the purse's journal (D102): every change of the ocelles, summed by what made it,
// since this colony was opened (owner, 2026-10-16: « le chiffre soit réel, parce qu'actuellement
// il y a écrit −700 mais je gagne de l'argent »). Each place that changes `sim.credits` books the
// same cents here, so the kinds always add up to the purse's real change (purse.test.ts pins it).
// The HUD samples it once a game minute and reads the last hour from it (ui/purse-facts.ts).
// Runtime only, like `hearthIn`: neither saved nor hashed — a statistic of the session, which the
// catch-up keeps too (it runs the same trade, token and lease functions), integers only.
import type { Sim } from './state';

/** What changed the purse: the recurring flows, then the one-offs. */
export const PURSE_KINDS = [
  // recurring
  'sales', 'orders', 'tokens', 'fee', 'rental', 'rent',
  // one-offs
  'spotSell', 'spotBuy', 'land', 'reorient', 'reward', 'grant',
] as const;
export type PurseKind = (typeof PURSE_KINDS)[number];

/** The flows that come back every minute or hour: the HUD's figure. The rest are one-offs, told apart. */
export const RECURRING: ReadonlySet<PurseKind> = new Set<PurseKind>(['sales', 'orders', 'tokens', 'fee', 'rental', 'rent']);

export type PurseLog = Record<PurseKind, number>;

export const newPurseLog = (): PurseLog => Object.fromEntries(PURSE_KINDS.map((k) => [k, 0])) as PurseLog;

/** Book `cents` (+ in, − out) under `kind`; the caller has already changed `sim.credits` by as much. */
export function book(sim: Sim, kind: PurseKind, cents: number): void {
  sim.purseLog[kind] += cents;
}
