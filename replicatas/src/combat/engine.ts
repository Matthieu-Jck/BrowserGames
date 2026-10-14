// engine.ts — the headless, synchronous, deterministic combat engine.
// Mutates CombatState and appends CombatEvents; UI/3D/audio drain the queue.
// No DOM, no WebGL — vitest drives this directly.
import type { Rng } from '@/core/rng';
import { BAL } from '@/core/balance';
import type {
  ActorState, CardInstance, CombatState, PlayerCombat,
} from './combat-types';
import { STATUSES } from './statuses';
import {
  applyStatus, dealDamage, interpret, loseHull, checkCond,
} from './effects';
import { drawCards, discardCard, exhaustCard, scoutResolve } from './piles';
import { chooseIntent, moveById } from './intents';
import { UPKEEPS } from './scripts';
import { getEnemy, effectiveCard, getPayload } from '@/content/registry';

export interface CombatConfig {
  enemies: string[];
  deck: CardInstance[];          // fresh instances (cloned from run deck)
  hull: number;
  hullMax: number;
  energyMax: number;
  drawPerTurn?: number;
  rng: Rng;
  ambient?: 'surface' | 'orbital';
  damageScale?: number;          // enemy damage multiplier from planet position
  hpScale?: number;
  playerFlags?: Record<string, number | boolean>;
  startBlock?: number;
  startStatuses?: Array<{ status: string; stacks: number }>;
  firstTurnEnergyBonus?: number;
  firstTurnDrawBonus?: number;
  retainCount?: number;
  plating?: number;              // player plating (Custodian Plating trophy)
  turnStartOps?: import('./combat-types').EffectOp[];  // upgrade-driven turn-start effects
}

export interface Combat {
  state: CombatState;
  rng: Rng;
  cfg: CombatConfig;
}

// TS narrows state.phase across mutating calls it can't see; route reads
// through a function so comparisons stay legal.
function phaseOf(state: CombatState): CombatState['phase'] {
  return state.phase;
}

// ---------------------------------------------------------------- start

export function startCombat(cfg: CombatConfig): Combat {
  const rng = cfg.rng;
  const player: PlayerCombat = {
    id: 'player', kind: 'player', name: 'PROBE',
    hp: cfg.hull, hpMax: cfg.hullMax, block: 0, statuses: {},
    plating: 0, moveIndex: 0, turnsAlive: 0,
    flags: { ...(cfg.playerFlags ?? {}) },
    energy: 0, energyMax: cfg.energyMax,
    hand: [], draw: [], discard: [], exhaustPile: [],
    cardsPlayedThisTurn: 0, cardsExhaustedThisCombat: 0,
    lastPlayedCardId: null, zeroCostUids: [], turnStartOps: [...(cfg.turnStartOps ?? [])],
    retainCount: cfg.retainCount ?? 0,
  };
  player.plating = cfg.plating ?? 0;

  const state: CombatState = {
    turn: 0, phase: 'player', player,
    enemies: [], events: [],
    deckCardIds: cfg.deck.map((c) => c.cardId),
    encounterEnemyIds: cfg.enemies,
    ambient: cfg.ambient ?? 'surface',
    enrageApplied: false, scoutPending: 0,
    damageScale: cfg.damageScale ?? 1,
  };

  for (const enemyId of cfg.enemies) {
    const def = getEnemy(enemyId);
    let hp = rng.int(def.hp[0], def.hp[1]);
    hp = Math.max(1, Math.floor(hp * (cfg.hpScale ?? 1)));
    state.enemies.push({
      id: `e${state.enemies.length}`, kind: 'enemy', enemyId, name: def.name,
      hp, hpMax: hp, block: 0, statuses: {},
      plating: def.plating ?? 0, mech: def.mech, tier: def.tier,
      moveIndex: 0, turnsAlive: 0, flags: {}, intentMoveId: null,
    });
  }

  state.events.push({ t: 'combatStart' });
  player.draw = rng.shuffle(cfg.deck);

  // innate cards rise to the top of the draw pile
  const innate: CardInstance[] = [];
  const rest: CardInstance[] = [];
  for (const inst of player.draw) {
    (effectiveCard(inst).innate ? innate : rest).push(inst);
  }
  player.draw = [...innate, ...rest];

  if (cfg.startBlock) { player.block = cfg.startBlock; state.events.push({ t: 'block', targetId: 'player', amount: cfg.startBlock, total: player.block }); }
  for (const s of cfg.startStatuses ?? []) applyStatus(state, player, s.status, s.stacks);

  for (const e of state.enemies) chooseIntent(state, rng, e);
  state.events.push({ t: 'intents' });
  startPlayerTurn({ state, rng, cfg });
  return { state, rng, cfg };
}

// ---------------------------------------------------------------- player turn

function startPlayerTurn(c: Combat): void {
  const { state, rng, cfg } = c;
  const p = state.player;
  state.turn++;
  state.phase = 'player';
  state.events.push({ t: 'turnStart', turn: state.turn });

  if (state.turn >= BAL.enrageTurn && !state.enrageApplied) {
    state.enrageApplied = true;
    state.events.push({ t: 'enrage' });
  }

  // shields expire (unless Persistent Shielding)
  if (!p.flags['persistShields']) p.block = 0;

  // energy refill (brownout consumes)
  let energy = p.energyMax;
  const brown = p.statuses['brownout'] ?? 0;
  if (brown > 0) { energy = Math.max(0, energy - brown); delete p.statuses['brownout']; }
  if (state.turn === 1 && cfg.firstTurnEnergyBonus) energy += cfg.firstTurnEnergyBonus;
  p.energy = energy;
  state.events.push({ t: 'energy', value: p.energy });

  // turn-start statuses (radiation/corrosion DoT on the player)
  for (const [sid, stacks] of Object.entries({ ...p.statuses })) {
    STATUSES[sid]?.hooks?.onTurnStart?.({ state, actor: p, rng }, stacks);
    if (phaseOf(state) === 'lost') return;
  }
  decayStatuses(p, 'turnStart');

  // installed power ops
  if (p.turnStartOps.length) {
    interpret(p.turnStartOps, { state, rng, source: p, target: null, beam: false, isAttack: false });
    if (phaseOf(state) !== 'player') return;
  }

  // draw
  let n = cfg.drawPerTurn ?? BAL.drawPerTurn;
  if (state.turn === 1 && cfg.firstTurnDrawBonus) n += cfg.firstTurnDrawBonus;
  if (p.flags['drawBonus']) n += p.flags['drawBonus'] as number;
  drawCards(state, rng, n);

  p.cardsPlayedThisTurn = 0;
  p.zeroCostUids = [];
}

// ---------------------------------------------------------------- play a card

export function canPlay(c: Combat, uid: string): { ok: boolean; reason?: string } {
  const { state } = c;
  if (state.phase !== 'player') return { ok: false, reason: 'not your turn' };
  if (state.scoutPending > 0) return { ok: false, reason: 'resolve scout first' };
  const inst = state.player.hand.find((x) => x.uid === uid);
  if (!inst) return { ok: false, reason: 'not in hand' };
  const def = effectiveCard(inst);
  if (def.unplayable) return { ok: false, reason: 'unplayable' };
  if (def.playableIf && !checkCond(def.playableIf, { state, rng: c.rng, source: state.player, target: null, beam: false, isAttack: false })) {
    return { ok: false, reason: 'condition not met' };
  }
  const cost = cardCost(c, inst);
  if (cost > state.player.energy) return { ok: false, reason: 'not enough energy' };
  return { ok: true };
}

export function cardCost(c: Combat, inst: CardInstance): number {
  const def = effectiveCard(inst);
  if (c.state.player.zeroCostUids.includes(inst.uid)) return 0;
  if (def.cost === 'X') return c.state.player.energy;
  let cost = def.cost;
  if (def.kind === 'power' && c.state.player.flags['optimizedBus'] && !c.state.player.flags['optimizedBusUsed']) cost = 0;
  return cost;
}

export function playCard(c: Combat, uid: string, targetId: string | null): boolean {
  const { state, rng } = c;
  const p = state.player;
  const check = canPlay(c, uid);
  if (!check.ok) return false;
  const inst = p.hand.find((x) => x.uid === uid)!;
  const def = effectiveCard(inst);

  let target: ActorState | null = null;
  if (def.target === 'enemy') {
    target = state.enemies.find((e) => e.id === targetId && e.hp > 0) ?? null;
    if (!target || (target.statuses['phased'] ?? 0) > 0) return false;
  } else if (def.target === 'randomEnemy') {
    const pool = state.enemies.filter((e) => e.hp > 0 && !(e.statuses['phased'] ?? 0));
    if (!pool.length) return false;
    target = rng.pick(pool);
  }

  const cost = cardCost(c, inst);
  const isX = def.cost === 'X' && !p.zeroCostUids.includes(inst.uid);
  const xValue = isX ? p.energy : undefined;
  if (def.kind === 'power' && p.flags['optimizedBus'] && !p.flags['optimizedBusUsed'] && def.cost !== 'X') {
    p.flags['optimizedBusUsed'] = true;
  }
  p.energy -= cost;
  state.events.push({ t: 'energy', value: p.energy });
  state.events.push({ t: 'cardPlayed', uid, cardId: inst.cardId, targetId: target?.id ?? null });

  // remove from hand immediately (effects like draw shouldn't redraw it)
  const hi = p.hand.findIndex((x) => x.uid === uid);
  p.hand.splice(hi, 1);
  const zi = p.zeroCostUids.indexOf(uid);
  if (zi >= 0) p.zeroCostUids.splice(zi, 1);

  const ctx = {
    state, rng, source: p as ActorState, target,
    beam: !!def.beam, isAttack: def.kind === 'attack', cardId: inst.cardId, xValue,
    aoe: def.target === 'allEnemies',
  };

  // Future Echo: play twice
  const echo = (p.statuses['echo'] ?? 0) > 0 && inst.cardId !== 'future_echo';
  if (echo) {
    p.statuses['echo']!--;
    if (p.statuses['echo']! <= 0) delete p.statuses['echo'];
  }

  interpret(def.effects, ctx);
  if (echo && state.phase === 'player') {
    state.events.push({ t: 'text', msg: `${def.name} echoes.` });
    interpret(def.effects, ctx);
  }

  // Prism Splitter: BEAM attacks splash all enemies
  const prism = p.flags['prismSplitter'];
  if (typeof prism === 'number' && def.beam && def.kind === 'attack' && state.phase === 'player') {
    for (const e of state.enemies.filter((x) => x.hp > 0)) {
      dealDamage(state, rng, p, e, prism, { isAttack: false });
    }
  }

  // primed (Overpressure) clears after an attack resolves
  if (def.kind === 'attack' && (p.statuses['primed'] ?? 0) > 0) delete p.statuses['primed'];

  p.cardsPlayedThisTurn++;
  p.lastPlayedCardId = inst.cardId;

  // pile destination
  if (def.kind === 'power') {
    p.exhaustPile.push(inst); // powers leave the combat deck silently
  } else if (def.exhaust) {
    p.exhaustPile.push(inst);
    p.cardsExhaustedThisCombat++;
    state.events.push({ t: 'exhaust', uid: inst.uid });
  } else {
    p.discard.push(inst);
  }
  return true;
}

// ---------------------------------------------------------------- payloads

export function usePayload(c: Combat, payloadId: string, targetId: string | null): boolean {
  const { state, rng } = c;
  if (state.phase !== 'player') return false;
  const def = getPayload(payloadId);
  let target: ActorState | null = null;
  if (def.target === 'enemy') {
    target = state.enemies.find((e) => e.id === targetId && e.hp > 0) ?? null;
    if (!target) return false;
  }
  state.events.push({ t: 'text', msg: `Payload: ${def.name}.`, cls: 'good' });
  interpret(def.effects, {
    state, rng, source: state.player, target, beam: false, isAttack: false,
    aoe: def.target === 'allEnemies',
  });
  return true;
}

// ---------------------------------------------------------------- end turn / enemy phase

export function endTurn(c: Combat): void {
  const { state, rng } = c;
  const p = state.player;
  if (state.phase !== 'player') return;
  if (state.scoutPending > 0) scoutResolve(state, []); // unresolved scout keeps order

  // player end-of-turn statuses (nanite heal, overheat burn)
  for (const [sid, stacks] of Object.entries({ ...p.statuses })) {
    STATUSES[sid]?.hooks?.onTurnEnd?.({ state, actor: p, rng }, stacks);
    if (phaseOf(state) === 'lost') return;
  }
  decayStatuses(p, 'turnEnd');

  // discard hand minus retained
  const retained: CardInstance[] = [];
  let retainLeft = p.retainCount;
  for (const inst of [...p.hand]) {
    const def = effectiveCard(inst);
    if (def.retain || retainLeft > 0) {
      if (!def.retain) retainLeft--;
      retained.push(inst);
      continue;
    }
    if (def.endOfTurn) {
      interpret(def.endOfTurn, { state, rng, source: p, target: null, beam: false, isAttack: false });
      if (phaseOf(state) === 'lost') return;
    }
    if (def.kind === 'statusCard') { exhaustCard(state, inst); continue; }
    discardCard(state, inst);
  }
  p.hand = p.hand.filter((x) => retained.includes(x));
  state.events.push({ t: 'discardHand' });

  // ------------------------------------------------ enemy phase
  state.phase = 'enemy';
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    UPKEEPS[enemy.enemyId!]?.(state, rng, enemy.id);
    if (state.phase !== 'enemy') return;

    decayStatuses(enemy, 'turnStart');

    // enemy DoT
    for (const [sid, stacks] of Object.entries({ ...enemy.statuses })) {
      STATUSES[sid]?.hooks?.onTurnStart?.({ state, actor: enemy, rng }, stacks);
    }
    if (enemy.hp <= 0) continue;
    if (state.phase !== 'enemy') return;

    // EMP skip
    if ((enemy.statuses['empd'] ?? 0) > 0) {
      enemy.statuses['empd']!--;
      if (enemy.statuses['empd']! <= 0) delete enemy.statuses['empd'];
      state.events.push({ t: 'text', msg: `${enemy.name} is stunned and skips its move.`, cls: 'good' });
      enemy.turnsAlive++;
      continue;
    }

    if (enemy.intentMoveId) {
      const def = getEnemy(enemy.enemyId!);
      const move = moveById(def, enemy.intentMoveId);
      state.events.push({ t: 'enemyMove', actorId: enemy.id, moveId: move.id, moveName: move.name });
      enemy.block = 0; // enemy shields expire when it acts
      interpret(move.effects, { state, rng, source: enemy, target: state.player, beam: false, isAttack: false });
      enemy.lastMoveId = move.id;
      enemy.moveIndex++;
      if (state.phase !== 'enemy') return;
    }
    decayStatuses(enemy, 'turnEnd');
    enemy.turnsAlive++;
  }

  if (state.phase !== 'enemy') return;
  for (const e of state.enemies) chooseIntent(state, rng, e);
  state.events.push({ t: 'intents' });
  startPlayerTurn(c);
}

// ---------------------------------------------------------------- helpers

function decayStatuses(actor: ActorState, when: 'turnStart' | 'turnEnd'): void {
  for (const [sid, stacks] of Object.entries({ ...actor.statuses })) {
    const def = STATUSES[sid];
    if (!def) continue;
    if (when === 'turnEnd' && def.decay === 'clearTurnEnd') { delete actor.statuses[sid]; continue; }
    const decays = (when === 'turnStart' && def.decay === 'turnStart')
      || (when === 'turnEnd' && def.decay === 'turnEnd');
    if (!decays) continue;
    const next = stacks - 1;
    if (next <= 0) delete actor.statuses[sid];
    else actor.statuses[sid] = next;
  }
}

/** Drain accumulated events (UI consumes). */
export function drainEvents(c: Combat): import('./combat-types').CombatEvent[] {
  const ev = c.state.events;
  c.state.events = [];
  return ev;
}

/** Combat-earned resources (from card effects). */
export function combatResources(c: Combat): { minerals: number; fuel: number; data: number } {
  const f = c.state.player.flags;
  return {
    minerals: (f['res_minerals'] as number) ?? 0,
    fuel: (f['res_fuel'] as number) ?? 0,
    data: (f['res_data'] as number) ?? 0,
  };
}

export { scoutResolve } from './piles';
export { intentPreview } from './intents';
export { loseHull };
