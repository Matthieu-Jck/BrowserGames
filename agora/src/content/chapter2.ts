// chapter2.ts — "The Invisible Hand". Hundreds of strangers, no auctioneer, and a price
// that finds itself. The signature generative set-piece.
import type { ChapterDef } from '@/journey/types';
import { makeDemand, makeSupply } from '@/econ/curves';
import { solveEquilibrium } from '@/econ/equilibrium';
import { scorePrediction } from '@/scoring/grade';

export const CH2_DEMAND = makeDemand(100, 1); // P = 100 − Q
export const CH2_SUPPLY = makeSupply(20, 1); // P = 20 + Q  ⇒  clears at $60
export const CH2_SHOCK = 30; // a taste shock lifts demand by $30
const EQ = solveEquilibrium(CH2_DEMAND, CH2_SUPPLY);
const EQ2 = solveEquilibrium(makeDemand(100 + CH2_SHOCK, 1), CH2_SUPPLY); // post-shock
const r = (n: number) => Math.round(n);

export const chapter2: ChapterDef = {
  id: 2,
  title: 'The Invisible Hand',
  subtitle: 'Order without an organiser',
  accent: '#5fe39a',
  law: 'Self-interested trading with no central planner converges on the equilibrium price.',
  beats: [
    {
      id: 'ch2.crowd',
      kind: 'narrate',
      scene: 'auction',
      sceneParams: { revealRun: 0, buyers: 140, shock: 0 },
      title: 'A crowd, not a committee',
      body:
        'Here is the same market as a crowd. Each glowing mote is a person — buyers below, ' +
        'sellers above, drifting with no instructions and no one in charge.',
    },
    {
      id: 'ch2.secret',
      kind: 'narrate',
      scene: 'auction',
      sceneParams: { revealRun: 0, buyers: 140, shock: 0 },
      title: 'Everyone has a secret number',
      body:
        'Each buyer has a hidden top price they’ll pay; each seller, a hidden floor they’ll ' +
        'accept. Nobody can see anyone else’s. They just shout offers and take deals that ' +
        'don’t lose them money.',
    },
    {
      id: 'ch2.predict',
      kind: 'predict',
      scene: 'auction',
      sceneParams: { revealRun: 1, buyers: 140, shock: 0 },
      title: 'Where does it settle?',
      body: 'Let the crowd trade. With no auctioneer at all, what price will the deals converge on?',
      predict: {
        prompt: 'The settling price of this leaderless market:',
        kind: 'slider',
        min: 20,
        max: 100,
        step: 1,
        unit: '$',
        initial: 45,
        answer: EQ.priceStar,
        tolerance: 8,
        verdict: (price) => ({
          metric: 'price',
          playerLabel: `You guessed $${r(price)}`,
          optimalLabel: `The crowd found $${r(EQ.priceStar)}`,
          headline:
            Math.abs(price - EQ.priceStar) <= 8
              ? 'You saw the hand at work.'
              : 'The crowd ignored your guess.',
          detail:
            `No one decided $${r(EQ.priceStar)}. It emerged: every trade above it found no ` +
            'sellers, every trade below it found no buyers, and the deals squeezed toward the ' +
            'one price where supply meets demand. That is the invisible hand — not magic, just ' +
            'arithmetic done by a crowd.',
        }),
      },
    },
    {
      id: 'ch2.sandbox',
      kind: 'sandbox',
      scene: 'auction',
      sceneParams: { revealRun: 1, buyers: 140, shock: 0 },
      title: 'Resize the crowd',
      body: 'Twenty traders or two hundred — the same price keeps emerging. Try it.',
      sandbox: {
        intro: 'Change the crowd size and watch the price re-discover itself.',
        controls: [
          { key: 'buyers', label: 'Traders on each side', min: 20, max: 240, step: 10, initial: 140 },
        ],
      },
    },
    {
      id: 'ch2.challenge',
      kind: 'challenge',
      scene: 'auction',
      sceneParams: { revealRun: 1, buyers: 140, shock: CH2_SHOCK },
      title: 'The taste shock',
      body:
        'A craze hits: suddenly everyone wants more, at every price. Demand jumps. The crowd ' +
        'has no memo about it — but it will react. Predict the new settling price.',
      challenge: {
        prompt: 'After the demand shock, the crowd settles at:',
        controls: [
          { key: 'guess', label: 'New settling price', min: 20, max: 130, step: 1, initial: 60, unit: '$' },
        ],
        solution: { guess: EQ2.priceStar },
        evaluate: (params) => {
          const guess = params.guess ?? 60;
          const ps = scorePrediction(guess, EQ2.priceStar, 8);
          return {
            stars: ps.stars,
            score: Math.max(0, 100 - ps.error * 4),
            severity: ps.severity,
            view: {
              metric: 'price',
              playerLabel: `You said $${r(guess)}`,
              optimalLabel: `It settled at $${r(EQ2.priceStar)}`,
              headline: ps.severity === 'nailed' ? 'You tracked the shock.' : 'The price moved without you.',
              detail:
                `More demand at every price pushed the crossing up to $${r(EQ2.priceStar)}. No ` +
                'committee voted on it; the same crowd, trading the same way, simply re-converged ' +
                'on the new truth.',
            },
          };
        },
      },
    },
  ],
};
