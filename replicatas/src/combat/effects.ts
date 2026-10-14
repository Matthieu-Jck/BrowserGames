// effects.ts — the EffectOp interpreter and the single damage pipeline.
// Everything that changes combat state flows through here; the engine and
// enemy moves both call interpret().
import type { Rng } from '@/core/rng';
import { BAL } from '@/core/balance';
import type {
  ActorState, Amount, CombatState, Condition, EffectOp,
} from './combat-types';
import { STATUSES } from './statuses';
import { drawCards, makeInstance, scoutReveal } from './piles';
import { runScript } from './scripts';
import { getCard, getEnemy } from '@/content/registry';

export interface EffectCtx {
  state: CombatState;
  rng: Rng;
  source: ActorState;
  target: ActorState | null;     // resolved primary target
  beam: boolean;                 // source card is [BEAM]
  isAttack: boolean;
  cardId?: string;
  xValue?: number;               // energy spent on an X-cost card
  aoe?: boolean;                 // card targets allEnemies: damage ops hit everyone
}

// ---------------------------------------------------------------- amounts

export function resolveAmount(a: Amount, ctx: EffectCtx): number {
  if (typeof a === 'number') return a;
  let n = a.base;
  if (a.perStatus) {
    const holder = a.perStatus.on === 'self' ? ctx.source : ctx.target;
    const stacks = holder?.statuses[a.perStatus.status] ?? 0;
    n += stacks * a.perStatus.mult;
  }
  if (a.perCardsExhausted && ctx.state.player) n += a.perCardsExhausted * ctx.state.player.cardsExhaustedThisCombat;
  if (a.perCardsPlayed) n += a.perCardsPlayed * ctx.state.player.cardsPlayedThisTurn;
  return Math.max(0, Math.floor(n));
}

export function checkCond(cond: Condition, ctx: EffectCtx): boolean {
  switch (cond.kind) {
    case 'targetHasStatus': return (ctx.target?.statuses[cond.status] ?? 0) >= (cond.min ?? 1);
    case 'selfHasStatus': return (ctx.source.statuses[cond.status] ?? 0) >= (cond.min ?? 1);
    case 'selfHpBelow': return ctx.source.hp < ctx.source.hpMax * cond.frac;
    case 'targetHpBelow': return !!ctx.target && ctx.target.hp < ctx.target.hpMax * cond.frac;
    case 'energyAtLeast': return ctx.state.player.energy >= cond.n;
    case 'turnAtLeast': return ctx.state.turn >= cond.n;
  }
}

// ---------------------------------------------------------------- hull loss (DoT / costs — no modifiers, pierces shields)

export function loseHull(state: CombatState, actor: ActorState, amount: number, cause: string): void {
  if (amount <= 0 || actor.hp <= 0) return;
  actor.hp = Math.max(0, actor.hp - amount);
  state.events.push({ t: 'hullLoss', targetId: actor.id, amount, hp: actor.hp, cause });
  if (actor.hp <= 0) handleDeath(state, actor);
}

export function handleDeath(state: CombatState, actor: ActorState): void {
  if (actor.kind === 'player') {
    // Chronal Shard trophy: once per lineage, a lethal hit leaves you at 1 Hull
    if (actor.flags['chronalShard'] && !actor.flags['chronalUsed']) {
      actor.hp = 1;
      actor.flags['chronalUsed'] = true;
      state.events.push({ t: 'text', msg: 'The Chronal Shard rewinds one second. You persist at 1 Hull.', cls: 'good' });
      return;
    }
    state.phase = 'lost';
    state.events.push({ t: 'lose' });
    return;
  }
  state.events.push({ t: 'die', actorId: actor.id });
  const alive = state.enemies.filter((e) => e.hp > 0);
  if (alive.length === 0 && state.phase !== 'lost') {
    state.phase = 'won';
    state.events.push({ t: 'win' });
  }
}

// ---------------------------------------------------------------- THE damage pipeline

export interface HitOpts {
  piercing?: boolean;
  isAttack?: boolean;
  beam?: boolean;
  dryRun?: boolean;
}

/** One attack hit. Returns hp damage actually dealt (post-block). */
export function dealDamage(
  state: CombatState, rng: Rng, source: ActorState, target: ActorState,
  base: number, opts: HitOpts = {},
): number {
  const isAttack = opts.isAttack !== false;
  let n = base;

  // dealer modifiers
  for (const [sid, stacks] of Object.entries(source.statuses)) {
    const hook = STATUSES[sid]?.hooks?.modifyDamageDealt;
    if (hook) n = hook(n, stacks, isAttack, !!opts.beam);
  }
  // enemy enrage + planet scaling
  if (source.kind === 'enemy') {
    n = Math.floor(n * state.damageScale);
    if (state.turn >= BAL.enrageTurn) n = Math.floor(n * BAL.enrageMult);
  }
  // taker modifiers
  for (const [sid, stacks] of Object.entries(target.statuses)) {
    const hook = STATUSES[sid]?.hooks?.modifyDamageTaken;
    if (hook) n = hook(n, stacks, isAttack);
  }
  n = Math.max(0, n);
  if (opts.dryRun) return n;

  // evasion: negate whole attack hits
  if (isAttack && (target.statuses['evasion'] ?? 0) > 0) {
    target.statuses['evasion']!--;
    if (target.statuses['evasion']! <= 0) delete target.statuses['evasion'];
    state.events.push({
      t: 'damage', sourceId: source.id, targetId: target.id,
      amount: 0, blocked: 0, hp: target.hp, evaded: true, beam: opts.beam,
    });
    return 0;
  }

  // plating: flat per-hit reduction
  if (target.plating > 0 && isAttack) n = Math.max(0, n - target.plating);
  // point-defense web (player upgrade): -1 per hit of multi-hit handled by caller flag
  if (isAttack && target.flags['pointDefense'] && (source.flags['multiHit'] as boolean)) n = Math.max(1, n - 1);
  // ablative coating: first hit each combat halved
  if (isAttack && target.flags['ablative'] && !target.flags['ablativeUsed']) {
    n = Math.ceil(n / 2);
    target.flags['ablativeUsed'] = true;
  }

  // block absorption
  let blocked = 0;
  if (!opts.piercing && target.block > 0) {
    blocked = Math.min(target.block, n);
    target.block -= blocked;
  }
  const hpLoss = n - blocked;
  target.hp = Math.max(0, target.hp - hpLoss);
  state.events.push({
    t: 'damage', sourceId: source.id, targetId: target.id,
    amount: hpLoss, blocked, hp: target.hp, beam: opts.beam,
  });

  // reactive armor retaliation (only on attack hits, and not recursively)
  const ra = target.statuses['reactive'] ?? 0;
  if (isAttack && ra > 0 && source.hp > 0 && !source.flags['retaliating']) {
    source.flags['retaliating'] = true;
    const rblocked = Math.min(source.block, ra);
    source.block -= rblocked;
    const rloss = ra - rblocked;
    source.hp = Math.max(0, source.hp - rloss);
    state.events.push({
      t: 'damage', sourceId: target.id, targetId: source.id,
      amount: rloss, blocked: rblocked, hp: source.hp,
    });
    source.flags['retaliating'] = false;
    if (source.hp <= 0) handleDeath(state, source);
  }

  if (target.hp <= 0) handleDeath(state, target);
  return hpLoss;
}

// ---------------------------------------------------------------- block / heal / status

export function gainBlock(state: CombatState, actor: ActorState, base: number, fromCard: boolean): void {
  let n = base;
  if (fromCard) {
    for (const [sid, stacks] of Object.entries(actor.statuses)) {
      const hook = STATUSES[sid]?.hooks?.modifyBlockGained;
      if (hook) n = hook(n, stacks);
    }
  }
  if (n <= 0) return;
  actor.block += n;
  state.events.push({ t: 'block', targetId: actor.id, amount: n, total: actor.block });
}

export function heal(state: CombatState, actor: ActorState, n: number): void {
  const healed = Math.min(n, actor.hpMax - actor.hp);
  if (healed <= 0) return;
  actor.hp += healed;
  state.events.push({ t: 'heal', targetId: actor.id, amount: healed, hp: actor.hp });
}

export function applyStatus(state: CombatState, target: ActorState, statusId: string, stacks: number): void {
  if (stacks <= 0 || target.hp <= 0) return;
  const def = STATUSES[statusId];
  if (!def) throw new Error(`unknown status ${statusId}`);
  // EMP: mechs only; elites/bosses become surge-protected after one
  if (statusId === 'empd' && target.kind === 'enemy') {
    if (!target.mech) {
      state.events.push({ t: 'text', msg: `${target.name} has no circuits to scramble.`, cls: 'warn' });
      return;
    }
    if (target.flags['surgeProtected']) {
      state.events.push({ t: 'text', msg: `${target.name} is surge protected.`, cls: 'warn' });
      return;
    }
    if (target.tier === 'elite' || target.tier === 'boss') target.flags['surgeProtected'] = true;
  }
  const cur = target.statuses[statusId] ?? 0;
  let next = cur + stacks;
  if (def.cap) next = Math.min(def.cap, next);
  target.statuses[statusId] = next;
  state.events.push({ t: 'status', targetId: target.id, status: statusId, stacks, total: next });
  // Gauss Engine power: whenever you gain Overheat, gain 1 Force
  if (statusId === 'overheat' && target.kind === 'player' && target.flags['gaussEngine']) {
    applyStatus(state, target, 'force', 1);
  }
}

export function removeStatus(state: CombatState, target: ActorState, statusId: string, amount: number | 'all'): number {
  const cur = target.statuses[statusId] ?? 0;
  if (cur <= 0) return 0;
  const removed = amount === 'all' ? cur : Math.min(cur, amount);
  const next = cur - removed;
  if (next <= 0) delete target.statuses[statusId];
  else target.statuses[statusId] = next;
  state.events.push({ t: 'statusRemoved', targetId: target.id, status: statusId });
  return removed;
}

// ---------------------------------------------------------------- summons

export function summonEnemy(state: CombatState, rng: Rng, enemyId: string, cap?: number): void {
  if (cap && state.enemies.filter((e) => e.hp > 0).length >= cap) return;
  if (state.enemies.filter((e) => e.hp > 0).length >= 5) return;
  const def = getEnemy(enemyId);
  const hp = rng.int(def.hp[0], def.hp[1]);
  const actor: ActorState = {
    id: `e${state.enemies.length}`,
    kind: 'enemy', enemyId, name: def.name,
    hp, hpMax: hp, block: 0, statuses: {},
    plating: def.plating ?? 0, mech: def.mech, tier: def.tier,
    moveIndex: 0, turnsAlive: 0, flags: {}, intentMoveId: null,
  };
  state.enemies.push(actor);
  state.events.push({ t: 'summon', enemyId, actorId: actor.id });
}

// ---------------------------------------------------------------- the interpreter

export function interpret(ops: EffectOp[], ctx: EffectCtx): void {
  for (const op of ops) {
    if (ctx.state.phase === 'won' || ctx.state.phase === 'lost') return;
    runOp(op, ctx);
  }
}

function aliveEnemies(state: CombatState): ActorState[] {
  return state.enemies.filter((e) => e.hp > 0);
}

function targetableEnemies(state: CombatState): ActorState[] {
  return aliveEnemies(state).filter((e) => !(e.statuses['phased'] ?? 0));
}

function runOp(op: EffectOp, ctx: EffectCtx): void {
  const { state, rng, source } = ctx;
  switch (op.op) {
    case 'damage': {
      const times = op.times === 'X' ? (ctx.xValue ?? 0) : (op.times ?? 1);
      if (times > 1) source.flags['multiHit'] = true;
      if (ctx.aoe && source.kind === 'player') {
        for (let i = 0; i < times; i++) {
          for (const e of targetableEnemies(state)) {
            const wasAlive = e.hp > 0;
            const n = resolveAmount(op.amount, { ...ctx, target: e });
            dealDamage(state, rng, source, e, n, { piercing: op.piercing, isAttack: true, beam: ctx.beam });
            // onKill rewards apply even when the kill ends the combat
            if (op.onKill && wasAlive && e.hp <= 0) for (const o of op.onKill) runOp(o, { ...ctx, target: e });
            if (state.phase !== 'player' && state.phase !== 'enemy') return;
          }
        }
        source.flags['multiHit'] = false;
        break;
      }
      for (let i = 0; i < times; i++) {
        let tgt = ctx.target;
        if (!tgt || tgt.hp <= 0) {
          // retarget random for multi-hit overflow / randomEnemy
          const pool = source.kind === 'player' ? targetableEnemies(state) : null;
          if (pool && pool.length) tgt = rng.pick(pool);
          else if (source.kind === 'enemy') tgt = state.player;
          else break;
        }
        const wasAlive = tgt.hp > 0;
        const n = resolveAmount(op.amount, { ...ctx, target: tgt });
        dealDamage(state, rng, source, tgt, n, { piercing: op.piercing, isAttack: true, beam: ctx.beam });
        // onKill rewards apply even when the kill ends the combat
        if (op.onKill && wasAlive && tgt.hp <= 0) for (const o of op.onKill) runOp(o, { ...ctx, target: tgt });
        if (state.phase !== 'player' && state.phase !== 'enemy') return;
      }
      source.flags['multiHit'] = false;
      break;
    }
    case 'block': {
      let who = source;
      if (op.who === 'allyOther' && source.kind === 'enemy') {
        const allies = aliveEnemies(state).filter((e) => e.id !== source.id);
        if (!allies.length) break;
        who = allies.reduce((a, b) => (a.hp / a.hpMax < b.hp / b.hpMax ? a : b));
      }
      gainBlock(state, who, resolveAmount(op.amount, ctx), source.kind === 'player');
      break;
    }
    case 'heal': {
      let who = source;
      if (op.who === 'allyOther' && source.kind === 'enemy') {
        const allies = aliveEnemies(state).filter((e) => e.id !== source.id && e.hp < e.hpMax);
        if (!allies.length) break;
        who = allies.reduce((a, b) => (a.hp / a.hpMax < b.hp / b.hpMax ? a : b));
      }
      heal(state, who, resolveAmount(op.amount, ctx));
      break;
    }
    case 'status': {
      const stacks = resolveAmount(op.stacks, ctx);
      const targets: ActorState[] =
        op.to === 'self' ? [source]
        : op.to === 'player' ? [state.player]
        : op.to === 'allEnemies' ? aliveEnemies(state)
        : ctx.target ? [ctx.target] : [];
      for (const t of targets) applyStatus(state, t, op.status, stacks);
      break;
    }
    case 'removeStatus': {
      const who = op.on === 'self' ? source : ctx.target;
      if (who) removeStatus(state, who, op.status, op.amount ?? 'all');
      break;
    }
    case 'draw':
      drawCards(state, rng, resolveAmount(op.count, ctx));
      break;
    case 'energy':
      state.player.energy = Math.max(0, state.player.energy + op.delta);
      state.events.push({ t: 'energy', value: state.player.energy });
      break;
    case 'selfDamage':
      loseHull(state, source, resolveAmount(op.amount, ctx), 'cost');
      break;
    case 'scout': {
      const n = Math.min(op.count, state.player.draw.length);
      state.scoutPending = n;
      state.events.push({ t: 'scout', count: n });
      scoutReveal(state, n);
      break;
    }
    case 'stripBlock': {
      const who = op.on === 'self' ? source : op.on === 'player' ? state.player : ctx.target;
      if (who && who.block > 0) {
        who.block = 0;
        state.events.push({ t: 'block', targetId: who.id, amount: 0, total: 0 });
      }
      break;
    }
    case 'resource':
      // resources are accrued onto combat flags; engine host applies to run after combat
      state.player.flags[`res_${op.resource}`] = ((state.player.flags[`res_${op.resource}`] as number) ?? 0) + op.delta;
      state.events.push({ t: 'text', msg: `${op.delta > 0 ? '+' : ''}${op.delta} ${op.resource}`, cls: 'good' });
      break;
    case 'addCard': {
      const copies = op.copies ?? 1;
      for (let i = 0; i < copies; i++) {
        getCard(op.card); // validate
        const inst = makeInstance(op.card);
        if (op.to === 'hand' && state.player.hand.length < BAL.maxHand) {
          state.player.hand.push(inst);
          if (op.costsZeroThisTurn) state.player.zeroCostUids.push(inst.uid);
        } else if (op.to === 'draw') {
          const idx = Math.floor(rng.next() * (state.player.draw.length + 1));
          state.player.draw.splice(idx, 0, inst);
        } else {
          state.player.discard.push(inst);
        }
        state.events.push({ t: 'addCard', cardId: op.card, to: op.to });
      }
      break;
    }
    case 'summon': {
      const count = op.count ?? 1;
      for (let i = 0; i < count; i++) summonEnemy(state, rng, op.enemy, op.cap);
      break;
    }
    case 'die':
      source.hp = 0;
      handleDeath(state, source);
      break;
    case 'if':
      if (checkCond(op.cond, ctx)) interpret(op.then, ctx);
      else if (op.else) interpret(op.else, ctx);
      break;
    case 'addTurnStartOps':
      state.player.turnStartOps.push(...op.ops);
      break;
    case 'setFlag':
      state.player.flags[op.flag] = op.value;
      break;
    case 'custom':
      runScript(op.script, ctx);
      break;
  }
}
