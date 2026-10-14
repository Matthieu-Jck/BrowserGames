// chapter1.ts — "The Price is a Signal". Supply, demand, and the single number that
// makes a shortage or a glut vanish: the price.
import type { ChapterDef } from '@/journey/types';
import { makeDemand, makeSupply } from '@/econ/curves';
import { solveEquilibrium, outcomeAtPrice } from '@/econ/equilibrium';
import { scorePrediction } from '@/scoring/grade';

// Bread market. Demand P = 100 − Q, Supply P = 20 + Q ⇒ clears at $60, 40 loaves.
export const CH1_DEMAND = makeDemand(100, 1);
export const CH1_SUPPLY = makeSupply(20, 1);
const EQ = solveEquilibrium(CH1_DEMAND, CH1_SUPPLY);
const r = (n: number) => Math.round(n);

export const chapter1: ChapterDef = {
  id: 1,
  title: 'The Price is a Signal',
  subtitle: 'Supply, demand, and the number that clears them',
  accent: '#5fd4f5',
  law: 'A free price moves until the amount wanted equals the amount offered.',
  beats: [
    {
      id: 'ch1.demand',
      kind: 'narrate',
      scene: 'supply-demand',
      sceneParams: { showSupply: 0, showEq: 0, price: -1, supplyShift: 0 },
      title: 'Demand',
      body:
        'A city wants bread. When bread is cheap, everyone buys; when it’s dear, most ' +
        'walk away. That downward line is demand — not a wish, but how much people will ' +
        'actually buy at each price.',
    },
    {
      id: 'ch1.supply',
      kind: 'narrate',
      scene: 'supply-demand',
      sceneParams: { showSupply: 1, showEq: 0, price: -1, supplyShift: 0 },
      title: 'Supply',
      body:
        'Bakers are the mirror image. The higher the price, the more it’s worth firing up ' +
        'the ovens. That upward line is supply. Two lines, pulling in opposite directions. ' +
        'Somewhere they cross.',
    },
    {
      id: 'ch1.predict',
      kind: 'predict',
      scene: 'supply-demand',
      sceneParams: { showSupply: 1, showEq: 0, price: -1, supplyShift: 0 },
      title: 'Where do they meet?',
      body: 'No one is allowed to set the price. Guess the one price where the market clears.',
      predict: {
        prompt: 'At what price does the bread market clear — no shortage, no leftovers?',
        kind: 'slider',
        min: 20,
        max: 100,
        step: 1,
        unit: '$',
        initial: 50,
        answer: EQ.priceStar,
        tolerance: 8,
        verdict: (price) => {
          const o = outcomeAtPrice(CH1_DEMAND, CH1_SUPPLY, price);
          const headline =
            o.kind === 'shortage'
              ? `A shortage of ${r(o.gap)} loaves.`
              : o.kind === 'surplus'
                ? `${r(-o.gap)} loaves rot unsold.`
                : 'The market clears.';
          const detail =
            o.kind === 'shortage'
              ? `At $${r(price)}, ${r(o.qd)} people want bread but bakers make only ` +
                `${r(o.qs)}. The rest queue for nothing.`
              : o.kind === 'surplus'
                ? `At $${r(price)}, bakers make ${r(o.qs)} loaves but only ${r(o.qd)} sell. ` +
                  'The difference goes stale.'
                : 'Quantity wanted equals quantity made. Nothing is wasted, no one is turned away.';
          return {
            metric: 'price',
            playerLabel: `You set the price at $${r(price)}`,
            optimalLabel: `It clears at $${r(EQ.priceStar)}`,
            headline,
            detail,
          };
        },
      },
    },
    {
      id: 'ch1.sandbox',
      kind: 'sandbox',
      scene: 'supply-demand',
      sceneParams: { showSupply: 1, showEq: 1, price: 60, supplyShift: 0 },
      title: 'Feel the gap',
      body: 'Now you hold the price. Slide it and watch the shortage or the glut breathe.',
      sandbox: {
        intro: 'Drag the price away from $60 and the market punishes you in both directions.',
        controls: [
          { key: 'price', label: 'Price', min: 20, max: 100, step: 1, initial: 60, unit: '$' },
        ],
      },
    },
    {
      id: 'ch1.challenge',
      kind: 'challenge',
      scene: 'supply-demand',
      sceneParams: { showSupply: 1, showEq: 0, price: 60, supplyShift: 30 },
      title: 'The frost',
      body:
        'Overnight, a frost kills part of the wheat. Supply shrinks — every loaf now costs ' +
        'more to make. The old price of $60 is suddenly wrong. Find the new clearing price.',
      challenge: {
        prompt: 'Set the price that clears the market after the frost.',
        controls: [
          { key: 'price', label: 'Price', min: 20, max: 130, step: 1, initial: 60, unit: '$' },
        ],
        solution: { price: 75 },
        evaluate: (params) => {
          const price = params.price ?? 60;
          const shiftedSupply = makeSupply(50, 1); // frost raises reservation 20 → 50
          const eq = solveEquilibrium(CH1_DEMAND, shiftedSupply); // P*=75, Q*=25
          const o = outcomeAtPrice(CH1_DEMAND, shiftedSupply, price);
          const ps = scorePrediction(price, eq.priceStar, 6);
          const headline =
            ps.severity === 'nailed'
              ? 'You found the new price.'
              : o.kind === 'shortage'
                ? `Still ${r(o.gap)} loaves short.`
                : `${r(-o.gap)} loaves wasted.`;
          const detail =
            ps.severity === 'nailed'
              ? `At $${r(price)} the smaller harvest clears perfectly. Higher prices aren’t ` +
                'greed here — they’re the signal that bread got scarce.'
              : `The frost pushed the clearing price up to $${r(eq.priceStar)}. You held it at ` +
                `$${r(price)}, and the gap didn’t close.`;
          return {
            stars: ps.stars,
            score: Math.max(0, 100 - ps.error * 4),
            severity: ps.severity,
            view: {
              metric: 'price',
              playerLabel: `You set $${r(price)}`,
              optimalLabel: `Clears at $${r(eq.priceStar)}`,
              headline,
              detail,
            },
          };
        },
      },
    },
  ],
};
