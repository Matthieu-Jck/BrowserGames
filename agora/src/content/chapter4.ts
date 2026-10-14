// chapter4.ts — "Why We Trade". Comparative advantage: two parties both get richer by
// specialising and trading, even when one is better at making everything.
import type { ChapterDef } from '@/journey/types';
import { comparativeAdvantage } from '@/econ/advantage';
import type { Producer } from '@/econ/types';
import { scorePrediction } from '@/scoring/grade';

export const ADA: Producer = { name: 'Ada', output: [10, 10] }; // bots, bread per hour
export const BEN_BREAD = 8;
const baseline = comparativeAdvantage(ADA, { name: 'Ben', output: [2, BEN_BREAD] });
const GAIN_PCT = (baseline.gain / baseline.autarkyValue) * 100; // ≈ 37.5%
const r = (n: number) => Math.round(n);

export const chapter4: ChapterDef = {
  id: 4,
  title: 'Why We Trade',
  subtitle: 'Gains hiding in plain sight',
  accent: '#c08aff',
  law: 'Specialising by comparative advantage and trading makes the total bigger — even against an absolute loser.',
  beats: [
    {
      id: 'ch4.meet',
      kind: 'narrate',
      scene: 'trade',
      sceneParams: { benGood0: 2, tot: 2.5, mode: 0 },
      title: 'Ada is better at everything',
      body:
        'Ada makes 10 robots or 10 loaves an hour. Ben manages 2 robots or 8 loaves. Ada beats ' +
        'Ben at both. Surely she should just do everything herself?',
    },
    {
      id: 'ch4.predict',
      kind: 'predict',
      scene: 'trade',
      sceneParams: { benGood0: 2, tot: 2.5, mode: 0 },
      title: 'Should Ada bother with Ben?',
      body:
        'If each fully specialises in what they’re comparatively best at and they trade, by how ' +
        'much does their combined output value rise? (Zero, if you think Ada should go it alone.)',
      predict: {
        prompt: 'Gain in total value from specialising + trading:',
        kind: 'slider',
        min: 0,
        max: 60,
        step: 1,
        unit: '%',
        initial: 0,
        answer: GAIN_PCT,
        tolerance: 12,
        verdict: (pct) => ({
          metric: 'gain',
          playerLabel: `You guessed +${r(pct)}%`,
          optimalLabel: `Actual gain +${r(GAIN_PCT)}%`,
          headline: pct < 8 ? 'You left a fortune on the table.' : 'You saw the hidden surplus.',
          detail:
            `Ben is hopeless at robots but only slightly worse at bread. So Ben bakes, Ada builds ` +
            `robots, and they swap. Output jumps by ${r(baseline.gain)} units of value (+${r(GAIN_PCT)}%) — ` +
            'with no one working harder. Ada’s advantage at bread was real but *comparative*: her time ' +
            'is worth far more on robots.',
        }),
      },
    },
    {
      id: 'ch4.sandbox',
      kind: 'sandbox',
      scene: 'trade',
      sceneParams: { benGood0: 2, tot: 2.5, mode: 0 },
      title: 'When does trade stop paying?',
      body: 'Make Ben better at robots. As his trade-offs come to match Ada’s, the gains evaporate.',
      sandbox: {
        intro: 'Slide Ben’s robot skill up. The gains shrink — and vanish when his opportunity costs equal Ada’s.',
        controls: [
          { key: 'benGood0', label: 'Ben’s robots / hour', min: 1, max: 10, step: 0.5, initial: 2 },
        ],
      },
    },
    {
      id: 'ch4.challenge',
      kind: 'challenge',
      scene: 'trade',
      sceneParams: { benGood0: 2, tot: 2.5, mode: 1 },
      title: 'Strike a deal',
      body:
        'A trade only happens if the price suits both. Ada won’t pay more bread per robot than it ' +
        'costs her to make one; Ben won’t take less than his. Set a price of robots (in bread) that ' +
        'both will accept.',
      challenge: {
        prompt: 'Price of one robot, in loaves of bread:',
        controls: [
          { key: 'tot', label: 'Loaves per robot', min: 0, max: 6, step: 0.1, initial: 2.5 },
        ],
        solution: { tot: 2.5 },
        evaluate: (params) => {
          const tot = params.tot ?? 2.5;
          const lo = baseline.termsOfTrade.min; // 1
          const hi = baseline.termsOfTrade.max; // 4
          const inside = tot > lo && tot < hi;
          const margin = Math.min(tot - lo, hi - tot);
          const ps = scorePrediction(tot, baseline.termsOfTrade.mid, 1.2);
          const severity = !inside ? 'catastrophic' : margin > 1 ? 'nailed' : margin > 0.5 ? 'close' : 'wrong';
          const stars = !inside ? 0 : margin > 1 ? 3 : margin > 0.5 ? 2 : 1;
          return {
            stars,
            score: inside ? Math.max(0, 100 - ps.error * 20) : 0,
            severity,
            view: {
              metric: 'terms of trade',
              playerLabel: `You offered ${tot.toFixed(1)} loaves/robot`,
              optimalLabel: `Both accept between ${lo.toFixed(0)} and ${hi.toFixed(0)}`,
              headline: inside ? 'Deal struck.' : tot <= lo ? 'Ada walks away.' : 'Ben walks away.',
              detail: inside
                ? `At ${tot.toFixed(1)} loaves per robot, Ada gets robots cheaper than building them ` +
                  'and Ben gets more for his bread than baking extra. Both win — that’s the whole point of trade.'
                : tot <= lo
                  ? `Below ${lo.toFixed(0)} loaves, Ada may as well build robots herself. No deal.`
                  : `Above ${hi.toFixed(0)} loaves, Ben may as well grow his own. No deal.`,
            },
          };
        },
      },
    },
  ],
};
