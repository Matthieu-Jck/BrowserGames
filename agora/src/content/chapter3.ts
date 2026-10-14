// chapter3.ts — "When We Meddle". Price ceilings, price floors and taxes. The price was
// carrying information; jam it and surplus simply vanishes.
import type { ChapterDef } from '@/journey/types';
import { makeDemand, makeSupply } from '@/econ/curves';
import { priceControl, applyTax } from '@/econ/controls';
import { scorePrediction } from '@/scoring/grade';

export const CH3_DEMAND = makeDemand(100, 1); // P = 100 − Q
export const CH3_SUPPLY = makeSupply(20, 1); // P = 20 + Q  ⇒  clears at $60, 40 loaves
const r = (n: number) => Math.round(n);

// Tools: 0 = ceiling, 1 = floor, 2 = tax.
export const chapter3: ChapterDef = {
  id: 3,
  title: 'When We Meddle',
  subtitle: 'The price of fighting the price',
  accent: '#ffb454',
  law: 'Capping, flooring or taxing a price shrinks the trades that should happen — and destroys surplus.',
  beats: [
    {
      id: 'ch3.intro',
      kind: 'narrate',
      scene: 'controls',
      sceneParams: { tool: 0, price: 60, tax: 0, showEq: 1 },
      title: 'It seems unfair',
      body:
        'Bread clears at $60 and the poor can’t afford it. The obvious fix: make it illegal ' +
        'to charge more. A price ceiling. What could go wrong?',
    },
    {
      id: 'ch3.predict-ceiling',
      kind: 'predict',
      scene: 'controls',
      sceneParams: { tool: 0, price: 40, tax: 0, showEq: 1 },
      title: 'Cap it at $40',
      body: 'You cap bread at $40. Sixty people show up wanting a loaf. Predict how many actually get one.',
      predict: {
        prompt: 'Loaves that actually get sold under the $40 cap:',
        kind: 'slider',
        min: 0,
        max: 60,
        step: 1,
        unit: 'loaves',
        initial: 50,
        answer: 20, // supply at $40 = (40−20)/1
        tolerance: 6,
        verdict: (q) => {
          const c = priceControl(CH3_DEMAND, CH3_SUPPLY, { kind: 'ceiling', price: 40 });
          return {
            metric: 'loaves',
            playerLabel: `You expected ${r(q)}`,
            optimalLabel: `Only ${r(c.qTraded)} get made`,
            headline: `A shortage of ${r(c.shortage)} loaves.`,
            detail:
              `At $40 bakers will only make ${r(c.qTraded)} loaves — the rest lose money to bake. ` +
              `Sixty people want bread; ${r(c.shortage)} leave with nothing. The cap didn’t make ` +
              'bread cheaper for everyone. It made bread vanish, and birthed a queue (and a black market).',
          };
        },
      },
    },
    {
      id: 'ch3.sandbox-ceiling',
      kind: 'sandbox',
      scene: 'controls',
      sceneParams: { tool: 0, price: 40, tax: 0, showEq: 1 },
      title: 'Push the cap',
      body: 'Slide the cap down. The red triangle is deadweight loss — trades that should have happened, gone.',
      sandbox: {
        intro: 'The lower you force the price, the bigger the shortage and the more surplus you destroy.',
        controls: [
          { key: 'price', label: 'Price cap', min: 20, max: 100, step: 1, initial: 40, unit: '$' },
        ],
      },
    },
    {
      id: 'ch3.predict-tax',
      kind: 'predict',
      scene: 'controls',
      sceneParams: { tool: 2, price: 60, tax: 20, showEq: 1 },
      title: 'Tax the bakers',
      body:
        'You levy a $20 tax on bakers — they’re the ones who pay it to the city. So bakers bear ' +
        'the whole $20, right? Predict how much of it lands on buyers instead.',
      predict: {
        prompt: 'Of the $20 tax “on bakers”, dollars actually paid by buyers:',
        kind: 'slider',
        min: 0,
        max: 20,
        step: 1,
        unit: '$',
        initial: 0,
        answer: 10, // symmetric slopes ⇒ split 50/50
        tolerance: 4,
        verdict: (paid) => {
          const tx = applyTax(CH3_DEMAND, CH3_SUPPLY, { perUnit: 20, on: 'seller' });
          return {
            metric: 'incidence',
            playerLabel: `You said buyers pay $${r(paid)}`,
            optimalLabel: `Buyers actually pay $${r(tx.incidenceBuyer)}`,
            headline: 'Who signs the cheque doesn’t decide who pays.',
            detail:
              `Bakers raise the price to $${r(tx.buyerPrice)} and keep $${r(tx.sellerPrice)} after ` +
              `tax. Buyers eat $${r(tx.incidenceBuyer)} of the tax, bakers $${r(tx.incidenceSeller)} — ` +
              'split by how stubborn each side is, not by whose name is on the law. A tax on buyers ' +
              'would have landed in exactly the same place.',
          };
        },
      },
    },
    {
      id: 'ch3.sandbox-tax',
      kind: 'sandbox',
      scene: 'controls',
      sceneParams: { tool: 2, price: 60, tax: 12, showEq: 1 },
      title: 'Turn the tax up',
      body: 'The gold band is the revenue raised. The red triangle is what’s destroyed getting it.',
      sandbox: {
        intro: 'Raise the tax. Revenue grows, then stalls — but the deadweight loss keeps climbing.',
        controls: [
          { key: 'tax', label: 'Tax per loaf', min: 0, max: 60, step: 1, initial: 12, unit: '$' },
        ],
      },
    },
    {
      id: 'ch3.challenge',
      kind: 'challenge',
      scene: 'controls',
      sceneParams: { tool: 1, price: 60, tax: 0, showEq: 1 },
      title: 'The minimum wage',
      body:
        'Now a price floor on labour: a minimum wage. Workers are sellers, employers are buyers. ' +
        'Set it to lift pay — but push too high and jobs vanish into a glut of idle workers. Find ' +
        'the highest wage that still clears the market.',
      challenge: {
        prompt: 'Set the wage floor (the market clears at $60).',
        controls: [
          { key: 'price', label: 'Minimum wage', min: 40, max: 100, step: 1, initial: 60, unit: '$' },
        ],
        solution: { price: 60 },
        evaluate: (params) => {
          const wage = params.price ?? 60;
          const c = priceControl(CH3_DEMAND, CH3_SUPPLY, { kind: 'floor', price: wage });
          const ps = scorePrediction(wage, 60, 6); // highest non-destructive floor is the clearing wage
          const unemployed = r(c.surplus);
          return {
            stars: c.binding ? Math.min(ps.stars, 1) : ps.stars,
            score: Math.max(0, 100 - unemployed * 3),
            severity: c.binding ? (unemployed > 20 ? 'catastrophic' : 'wrong') : ps.severity,
            view: {
              metric: 'wage',
              playerLabel: `You set $${r(wage)}`,
              optimalLabel: c.binding ? `${unemployed} workers idle` : 'market clears',
              headline: c.binding ? `${unemployed} workers can’t find a job.` : 'No one priced out.',
              detail: c.binding
                ? `At $${r(wage)} more people want to work than there are jobs. ${unemployed} are left ` +
                  'unemployed — helped wages they can’t collect. Good intentions, real casualties.'
                : 'A floor at or below the clearing wage lifts no one and harms no one. The market was ' +
                  'already paying $60; the only way to truly raise it is to make labour more valuable.',
            },
          };
        },
      },
    },
  ],
};
