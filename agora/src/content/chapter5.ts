// chapter5.ts — "The Tragedy". A shared fishery: sustainable if restrained, dead if not.
// Where unregulated self-interest fails — and what fixes it.
import type { ChapterDef } from '@/journey/types';
import type { Severity } from '@/core/kinds';
import { simulateFishery, maxSustainableYield } from '@/econ/fishery';
import type { FisheryConfig } from '@/econ/types';

const BASE: Omit<FisheryConfig, 'policy' | 'boats' | 'catchPerBoat' | 'quota'> = {
  capacity: 1000,
  growthRate: 0.4,
  initialStock: 1000,
  seasons: 50,
};
const MSY = maxSustainableYield(BASE.growthRate, BASE.capacity); // 100
const r = (n: number) => Math.round(n);

export const chapter5: ChapterDef = {
  id: 5,
  title: 'The Tragedy',
  subtitle: 'When the market eats itself',
  accent: '#3fd9c8',
  law: 'A resource no one owns gets taken until it’s gone — unless a rule holds the total back.',
  beats: [
    {
      id: 'ch5.sea',
      kind: 'narrate',
      scene: 'fishery',
      sceneParams: { boats: 8, quota: 100, policy: 0, revealRun: 0 },
      title: 'A sea everyone shares',
      body:
        'Fish breed fast when the sea is full and slowly when it’s empty. At its best, it can ' +
        'regrow about 100 fish a season — its sustainable yield. Take only that, forever, and ' +
        'the sea never runs dry.',
    },
    {
      id: 'ch5.predict',
      kind: 'predict',
      scene: 'fishery',
      sceneParams: { boats: 16, quota: 100, policy: 0, revealRun: 1 },
      title: 'Everyone wants one more boat',
      body:
        'Each boat lands 10 fish a season. Ten boats is exactly sustainable — but an eleventh boat ' +
        'earns its owner real money today. So the boats keep coming. With 16 boats fishing flat out, ' +
        'predict how many fish are left after 50 seasons.',
      predict: {
        prompt: 'Fish remaining after 50 seasons (the sea holds up to 1000):',
        kind: 'slider',
        min: 0,
        max: 1000,
        step: 10,
        unit: 'fish',
        initial: 500,
        answer: 0,
        tolerance: 120,
        verdict: (guess) => {
          const run = simulateFishery({ ...BASE, policy: 'open', boats: 16, catchPerBoat: 10 });
          return {
            metric: 'fish',
            playerLabel: `You guessed ${r(guess)} left`,
            optimalLabel: `${r(run.finalStock)} left — collapsed in year ${run.collapseSeason}`,
            headline: 'The sea is empty.',
            detail:
              `Sixteen boats take 160 fish a season from a sea that regrows at most 100. Every ` +
              `skipper is acting sensibly for themselves — and together they fish it to death by ` +
              `year ${run.collapseSeason}. No villain, no mistake anyone could see from their own deck. ` +
              'That is the tragedy of the commons.',
          };
        },
      },
    },
    {
      id: 'ch5.sandbox',
      kind: 'sandbox',
      scene: 'fishery',
      sceneParams: { boats: 16, quota: 100, policy: 0, revealRun: 1 },
      title: 'Add and remove boats',
      body: 'Open access: every boat fishes as hard as it can. Find the knife-edge where the sea tips into collapse.',
      sandbox: {
        intro: 'Above ten boats, the fleet takes more than the sea can regrow — and it dies.',
        controls: [
          { key: 'boats', label: 'Boats on the water', min: 2, max: 30, step: 1, initial: 16 },
        ],
      },
    },
    {
      id: 'ch5.challenge',
      kind: 'challenge',
      scene: 'fishery',
      sceneParams: { boats: 30, quota: 100, policy: 1, revealRun: 1 },
      title: 'Save the fishery',
      body:
        'You’re the harbour master. Thirty boats want to fish, but you set one rule: a total seasonal ' +
        'quota. Set it so there are still fish in 50 years — and ideally keep the catch near its ' +
        'sustainable maximum.',
      challenge: {
        prompt: 'Total seasonal catch quota:',
        controls: [
          { key: 'quota', label: 'Quota (fish / season)', min: 0, max: 260, step: 5, initial: 150 },
        ],
        solution: { quota: 95 },
        evaluate: (params) => {
          const quota = params.quota ?? 150;
          const run = simulateFishery({ ...BASE, policy: 'quota', boats: 30, catchPerBoat: 10, quota });
          const ratio = quota / MSY;
          let stars: number;
          let severity: Severity;
          if (run.collapsed) { stars = 0; severity = 'catastrophic'; }
          else if (ratio >= 0.85 && ratio <= 1.02) { stars = 3; severity = 'nailed'; }
          else if (ratio >= 0.55) { stars = 2; severity = 'close'; }
          else { stars = 1; severity = 'wrong'; }
          return {
            stars,
            score: run.collapsed ? 0 : r(Math.min(quota, MSY) * (run.finalStock / BASE.capacity) * 10),
            severity,
            view: {
              metric: 'quota',
              playerLabel: `Quota ${r(quota)} / season`,
              optimalLabel: run.collapsed ? `collapsed in year ${run.collapseSeason}` : `${r(run.finalStock)} fish remain`,
              headline: run.collapsed
                ? 'You set the quota too high. It’s gone.'
                : ratio < 0.55
                  ? 'Sustainable — but you’re starving the fleet.'
                  : 'The fishery survives, and so does the catch.',
              detail: run.collapsed
                ? `A quota of ${r(quota)} still exceeds what the sea can regrow. The rule existed; it ` +
                  'just wasn’t strict enough. A weak limit on a commons is barely a limit at all.'
                : ratio < 0.55
                  ? `At ${r(quota)} the sea is safe, but you’re leaving food in the water every year. ` +
                    `The sustainable maximum is about ${r(MSY)}.`
                  : `A quota near ${r(MSY)} keeps the stock healthy AND lands the most fish year after ` +
                    'year. One rule on the total turns a death spiral into a steady harvest.',
            },
          };
        },
      },
    },
    {
      id: 'ch5.close',
      kind: 'narrate',
      scene: 'fishery',
      sceneParams: { boats: 8, quota: 95, policy: 1, revealRun: 1 },
      title: 'The hand has limits',
      body:
        'Markets coordinate beautifully when people trade things they own. But no one owned the sea — ' +
        'so its price never warned anyone, and self-interest emptied it. The fix isn’t to abolish the ' +
        'market; it’s to give the commons an owner, a quota, or a price. The invisible hand needs a rule ' +
        'to grip.',
    },
  ],
};
