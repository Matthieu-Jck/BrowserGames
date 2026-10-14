// copy.ts — shared strings, and the blunt-verdict phrasebook. The voice is honest to a
// fault: when the player is wrong, it says so and shows the damage. Keyed by severity so
// the harshness is consistent across all five chapters.
import type { Severity } from '@/core/kinds';

export interface Tone {
  opener: string;
  tone: 'ok' | 'warn' | 'bad';
}

export const VERDICT_TONE: Record<Severity, Tone> = {
  nailed: { opener: 'Nailed it.', tone: 'ok' },
  close: { opener: 'Close — but the market doesn’t hand out partial credit.', tone: 'warn' },
  wrong: { opener: 'Wrong.', tone: 'bad' },
  catastrophic: { opener: 'Catastrophe.', tone: 'bad' },
};

/** A parting jab shown under the verdict, by severity. */
export const VERDICT_JAB: Record<Severity, string> = {
  nailed: 'You read the market correctly. It won’t always be this kind.',
  close: 'Close enough to feel clever, far enough to lose money.',
  wrong: 'The market does not care what you intended.',
  catastrophic: 'People got hurt by that decision. Real ones would have.',
};

export const INTRO = {
  kicker: 'An interactive on the laws of markets',
  title: 'AGORA',
  tagline:
    'No one runs the market. So why does it work? Step into the crowd and find out — ' +
    'one law, one wrong guess, one consequence at a time.',
  enter: 'Enter the market',
  resume: 'Resume',
};

export const OUTRO = {
  title: 'The market, in five laws',
  closing: {
    A: 'You understand the machine. You can see the hand now — and where it slips.',
    'B+': 'A sharp read of the market. A few laws still bite you when you look away.',
    B: 'Solid instincts. The market still surprised you more than once.',
    C: 'You grasp the shapes, but the consequences kept catching you out.',
    D: 'You meddled, and the market made you pay for it. Run it back.',
    F: 'You broke nearly everything you touched. The good news: so did every economy, once.',
  } as Record<string, string>,
};
