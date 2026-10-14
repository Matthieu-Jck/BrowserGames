// piles.ts — hand/draw/discard/exhaust operations with seeded shuffles.
import type { Rng } from '@/core/rng';
import { uid } from '@/core/rng';
import { BAL } from '@/core/balance';
import type { CardInstance, CombatState } from './combat-types';

export function makeInstance(cardId: string, refitted = false): CardInstance {
  return { uid: uid('c'), cardId, refitted };
}

export function drawCards(state: CombatState, rng: Rng, n: number): void {
  const drawn: string[] = [];
  const p = state.player;
  for (let i = 0; i < n; i++) {
    if (p.hand.length >= BAL.maxHand) break;
    if (p.draw.length === 0) {
      if (p.discard.length === 0) break;
      p.draw = rng.shuffle(p.discard);
      p.discard = [];
    }
    const card = p.draw.shift()!;
    p.hand.push(card);
    drawn.push(card.uid);
  }
  if (drawn.length) state.events.push({ t: 'draw', uids: drawn });
}

export function discardCard(state: CombatState, inst: CardInstance): void {
  const p = state.player;
  const i = p.hand.findIndex((c) => c.uid === inst.uid);
  if (i >= 0) p.hand.splice(i, 1);
  p.discard.push(inst);
}

export function exhaustCard(state: CombatState, inst: CardInstance): void {
  const p = state.player;
  for (const pile of [p.hand, p.draw, p.discard]) {
    const i = pile.findIndex((c) => c.uid === inst.uid);
    if (i >= 0) pile.splice(i, 1);
  }
  p.exhaustPile.push(inst);
  p.cardsExhaustedThisCombat++;
  state.events.push({ t: 'exhaust', uid: inst.uid });
}

/** Scout: the top N draw cards become visible; the UI calls scoutResolve with kept order/discards. */
export function scoutReveal(state: CombatState, n: number): CardInstance[] {
  return state.player.draw.slice(0, n);
}

/** Resolve a scout: uids to discard (from the revealed top N); the rest keep their order. */
export function scoutResolve(state: CombatState, discardUids: string[]): void {
  const p = state.player;
  const n = state.scoutPending;
  if (n <= 0) return;
  const top = p.draw.slice(0, n);
  const keep = top.filter((c) => !discardUids.includes(c.uid));
  const toss = top.filter((c) => discardUids.includes(c.uid));
  p.draw = [...keep, ...p.draw.slice(n)];
  p.discard.push(...toss);
  state.scoutPending = 0;
}
