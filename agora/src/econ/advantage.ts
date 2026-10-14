// advantage.ts — Chapter 4. Comparative advantage: why two parties both gain from
// trade even when one is better at making everything. Two producers, two goods.
import type { Producer, TradeResult } from './types';

const EPS = 1e-9;

/**
 * Compute opportunity costs, the comparative-advantage assignment, and the gains
 * from specialising and trading vs. self-sufficient autarky.
 *
 * Output of each good is valued in a common numeraire (good 1) with good 0 priced at
 * the terms-of-trade midpoint. The classic theorem: as long as the two producers'
 * opportunity costs differ, specialising raises total value — even if one producer
 * has an absolute advantage in both goods.
 */
export function comparativeAdvantage(
  a: Producer,
  b: Producer,
  hours = 100,
): TradeResult {
  // Opportunity cost of good 0 measured in good 1 forgone (= rate1 / rate0), and vice versa.
  const oppA0 = a.output[1] / a.output[0];
  const oppB0 = b.output[1] / b.output[0];
  const oppA1 = a.output[0] / a.output[1];
  const oppB1 = b.output[0] / b.output[1];

  const producers = [
    { name: a.name, oppCostGood0: oppA0, oppCostGood1: oppA1 },
    { name: b.name, oppCostGood0: oppB0, oppCostGood1: oppB1 },
  ];

  const gainsExist = Math.abs(oppA0 - oppB0) > EPS;

  // Lower opportunity cost of a good ⇒ comparative advantage in it.
  const ca0 = oppA0 <= oppB0 ? 0 : 1; // who makes good 0
  const ca1 = ca0 === 0 ? 1 : 0; // the other makes good 1
  const makers = [a, b];

  // Autarky: each producer splits its hours 50/50 and consumes its own output.
  const autarky0 = a.output[0] * (hours / 2) + b.output[0] * (hours / 2);
  const autarky1 = a.output[1] * (hours / 2) + b.output[1] * (hours / 2);

  // Full specialisation along comparative advantage.
  const spec0 = gainsExist ? makers[ca0]!.output[0] * hours : autarky0;
  const spec1 = gainsExist ? makers[ca1]!.output[1] * hours : autarky1;

  // Terms of trade (price of good 0 in good 1) lie strictly between the two opp costs.
  const lo = Math.min(oppA0, oppB0);
  const hi = Math.max(oppA0, oppB0);
  const mid = (lo + hi) / 2;

  const autarkyValue = autarky0 * mid + autarky1;
  const specializedValue = spec0 * mid + spec1;

  return {
    producers,
    caProducer: [ca0, ca1],
    hours,
    autarkyOutput: [autarky0, autarky1],
    specializedOutput: [spec0, spec1],
    termsOfTrade: { min: lo, max: hi, mid },
    gainsExist,
    autarkyValue,
    specializedValue,
    gain: specializedValue - autarkyValue,
  };
}
