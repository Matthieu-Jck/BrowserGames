// scripts.ts — named escape-hatch functions for cards/moves too weird for the
// declarative effect language, plus per-enemy upkeep hooks (auras, countdowns).
import type { EffectCtx } from './effects';
import {
  applyStatus, dealDamage, gainBlock, heal, interpret, removeStatus,
} from './effects';
import { exhaustCard } from './piles';
import { getCard, randomCardOfArchetype, effectiveCard } from '@/content/registry';
import type { CombatState } from './combat-types';
import type { Rng } from '@/core/rng';

type Script = (ctx: EffectCtx) => void;

const scripts: Record<string, Script> = {
  // LASER — Thermal Lens: gain Charge = your Overheat + N, remove all Overheat
  thermalLens1: (ctx) => thermalLens(ctx, 1),
  thermalLens2: (ctx) => thermalLens(ctx, 2),
  // LASER — Coherence: double your Charge
  doubleChargeSelf(ctx) {
    const cur = ctx.source.statuses['charge'] ?? 0;
    if (cur > 0) applyStatus(ctx.state, ctx.source, 'charge', cur);
  },
  // NUCLEAR — Enrich: double the target's Radiation
  doubleRadiationTarget(ctx) {
    const t = ctx.target;
    if (!t) return;
    const cur = t.statuses['radiation'] ?? 0;
    if (cur > 0) applyStatus(ctx.state, t, 'radiation', cur);
  },
  // NUCLEAR — Rad-Eater Cultures: remove all your Radiation, heal that much (+bonus)
  radEater0: (ctx) => radEater(ctx, 0),
  radEater3: (ctx) => radEater(ctx, 3),
  // NUCLEAR — Breeder Reactor: radiation to a random enemy + 1 to self
  breeder2: (ctx) => breeder(ctx, 2),
  breeder3: (ctx) => breeder(ctx, 3),
  // PARADOX — Causal Loop: play a copy of the last card you played
  causalLoop(ctx) {
    const { state, rng } = ctx;
    const lastId = state.player.lastPlayedCardId;
    if (!lastId || lastId === 'causal_loop') return;
    const def = getCard(lastId);
    const enemies = state.enemies.filter((e) => e.hp > 0 && !(e.statuses['phased'] ?? 0));
    const target = def.target === 'self' || def.target === 'none' ? null
      : enemies.length ? rng.pick(enemies) : null;
    state.events.push({ t: 'text', msg: `Causal Loop replays ${def.name}.` });
    interpret(def.effects, {
      state, rng, source: state.player, target,
      beam: !!def.beam, isAttack: def.kind === 'attack', cardId: lastId,
    });
  },
  // PARADOX — Event Horizon: exhaust your hand, deal 7 per card exhausted to ALL
  eventHorizon(ctx) {
    const { state, rng } = ctx;
    const hand = [...state.player.hand];
    let n = 0;
    for (const inst of hand) { exhaustCard(state, inst); n++; }
    const dmg = 7 * n;
    if (dmg <= 0) return;
    for (const e of state.enemies.filter((x) => x.hp > 0)) {
      dealDamage(state, rng, state.player, e, dmg, { isAttack: true });
    }
  },
  // NEUTRAL — Probe Memory: add a random card of a random archetype to hand, free this turn
  probeMemory(ctx) {
    const { state, rng } = ctx;
    const arch = rng.pick(['laser', 'kinetic', 'nuclear', 'speed', 'repair'] as const);
    const cardId = randomCardOfArchetype(arch, rng);
    if (!cardId) return;
    const inst = { uid: `c_pm_${state.turn}_${Math.floor(rng.next() * 1e6)}`, cardId, refitted: false };
    if (state.player.hand.length < 10) {
      state.player.hand.push(inst);
      state.player.zeroCostUids.push(inst.uid);
      state.events.push({ t: 'addCard', cardId, to: 'hand' });
    }
  },
  // SPEED — Phase Skip: ALL enemies skip their next turn (ignores mech/surge rules)
  phaseSkipAll(ctx) {
    for (const e of ctx.state.enemies.filter((x) => x.hp > 0)) {
      e.statuses['empd'] = (e.statuses['empd'] ?? 0) + 1;
      ctx.state.events.push({ t: 'status', targetId: e.id, status: 'empd', stacks: 1, total: e.statuses['empd']! });
    }
  },
  // EXODUS — Collapse: start the 5-turn countdown
  startCollapse(ctx) {
    ctx.source.flags['countdown'] = 5;
    ctx.state.events.push({ t: 'text', msg: 'EXODUS begins to COLLAPSE the local spacetime. 5 turns.', cls: 'bad' });
  },
  // Paradox Echo — plays 3 random cards from YOUR deck against you
  echoDeck(ctx) {
    const { state, rng, source } = ctx;
    const ids = state.deckCardIds;
    if (!ids.length) return;
    for (let i = 0; i < 3; i++) {
      const cardId = rng.pick(ids);
      const def = getCard(cardId);
      state.events.push({ t: 'text', msg: `The Echo plays ${def.name}.`, cls: 'warn' });
      let dmgTotal = 0, blockTotal = 0, healTotal = 0;
      walkOps(def.effects, (op) => {
        if (op.op === 'damage') {
          const base = typeof op.amount === 'number' ? op.amount : op.amount.base;
          const times = typeof op.times === 'number' ? op.times : 1;
          dmgTotal += base * times;
        }
        if (op.op === 'block') blockTotal += typeof op.amount === 'number' ? op.amount : op.amount.base;
        if (op.op === 'heal') healTotal += typeof op.amount === 'number' ? op.amount : op.amount.base;
      });
      if (dmgTotal > 0) dealDamage(state, rng, source, state.player, dmgTotal, { isAttack: true });
      if (blockTotal > 0) gainBlock(state, source, blockTotal, false);
      if (healTotal > 0) heal(state, source, healTotal);
      if (state.phase !== 'enemy' && state.phase !== 'player') return;
    }
  },
};

function thermalLens(ctx: EffectCtx, bonus: number): void {
  const heat = ctx.source.statuses['overheat'] ?? 0;
  applyStatus(ctx.state, ctx.source, 'charge', heat + bonus);
  removeStatus(ctx.state, ctx.source, 'overheat', 'all');
}

function radEater(ctx: EffectCtx, bonus: number): void {
  const removed = removeStatus(ctx.state, ctx.source, 'radiation', 'all');
  if (removed + bonus > 0) heal(ctx.state, ctx.source, removed + bonus);
}

function breeder(ctx: EffectCtx, n: number): void {
  const { state, rng } = ctx;
  const pool = state.enemies.filter((e) => e.hp > 0);
  if (pool.length) applyStatus(state, rng.pick(pool), 'radiation', n);
  applyStatus(state, state.player, 'radiation', 1);
}

function walkOps(ops: import('./combat-types').EffectOp[], fn: (op: import('./combat-types').EffectOp) => void): void {
  for (const op of ops) {
    fn(op);
    if (op.op === 'if') { walkOps(op.then, fn); if (op.else) walkOps(op.else, fn); }
    if (op.op === 'damage' && op.onKill) walkOps(op.onKill, fn);
  }
}

export function runScript(name: string, ctx: EffectCtx): void {
  const fn = scripts[name];
  if (!fn) throw new Error(`unknown combat script: ${name}`);
  fn(ctx);
}

export function hasScript(name: string): boolean {
  return !!scripts[name];
}

// ---------------------------------------------------------------- enemy upkeep hooks
// Run at the start of each enemy's action. Keyed by enemy def id.

type Upkeep = (state: CombatState, rng: Rng, actorId: string) => void;

export const UPKEEPS: Record<string, Upkeep> = {
  // SERAPH-0: Plating 3 while any Shield Satellite lives
  seraph0(state, _rng, actorId) {
    const me = state.enemies.find((e) => e.id === actorId);
    if (!me) return;
    const satAlive = state.enemies.some((e) => e.enemyId === 'shield_satellite' && e.hp > 0);
    me.plating = satAlive ? 3 : 0;
  },
  // EXODUS: collapse countdown
  exodus(state, rng, actorId) {
    const me = state.enemies.find((e) => e.id === actorId);
    if (!me) return;
    const cd = me.flags['countdown'];
    if (typeof cd === 'number' && cd > 0) {
      const next = cd - 1;
      me.flags['countdown'] = next;
      if (next <= 0) {
        state.events.push({ t: 'text', msg: 'THE COLLAPSE COMPLETES.', cls: 'bad' });
        dealDamage(state, rng, me, state.player, 99, { isAttack: true });
        delete me.flags['countdown'];
      } else {
        state.events.push({ t: 'text', msg: `Collapse in ${next}…`, cls: 'bad' });
      }
    }
  },
};

// re-export for engine convenience
export { effectiveCard };
