// intents.ts — enemy move selection (cycle / weighted / scripted bosses) and
// the intent preview shown to the player. Preview uses the same damage pipeline
// in dry-run mode so displayed numbers always match what will happen.
import type { Rng } from '@/core/rng';
import type { ActorState, CombatState, EnemyDef, EnemyMove, IntentPreview } from './combat-types';
import { checkCond, dealDamage } from './effects';
import { getEnemy } from '@/content/registry';

export function chooseIntent(state: CombatState, rng: Rng, actor: ActorState): void {
  if (actor.hp <= 0) { actor.intentMoveId = null; return; }
  const def = getEnemy(actor.enemyId!);
  let move: EnemyMove | undefined;
  switch (def.ai.mode) {
    case 'cycle':
      move = def.moves[actor.moveIndex % def.moves.length];
      break;
    case 'weighted': {
      const ctx = { state, rng, source: actor, target: state.player, beam: false, isAttack: false };
      let pool = def.moves.filter((m) => !m.cond || checkCond(m.cond, ctx));
      if (def.ai.noRepeat && pool.length > 1) pool = pool.filter((m) => m.id !== actor.lastMoveId);
      if (!pool.length) pool = def.moves;
      move = rng.weighted(pool.map((m) => [m, m.weight ?? 1] as const));
      break;
    }
    case 'script':
      move = scriptedIntent(def.ai.script!, state, rng, actor, def);
      break;
  }
  actor.intentMoveId = move?.id ?? null;
}

export function moveById(def: EnemyDef, id: string): EnemyMove {
  const m = def.moves.find((x) => x.id === id);
  if (!m) throw new Error(`enemy ${def.name} has no move ${id}`);
  return m;
}

// ---------------------------------------------------------------- boss AIs

function scriptedIntent(script: string, state: CombatState, rng: Rng, actor: ActorState, def: EnemyDef): EnemyMove {
  switch (script) {
    case 'seraph': {
      // Phase 1 cycle: windup -> ray -> pointdefense -> lattice. Phase 2 (<=50%): purge every 3rd move.
      const phase2 = actor.hp <= actor.hpMax * 0.5;
      if (phase2 && actor.moveIndex % 3 === 2) return moveById(def, 'purge');
      const cycle = ['windup', 'ray', 'pointdefense', 'lattice'];
      return moveById(def, cycle[actor.moveIndex % cycle.length]!);
    }
    case 'prime': {
      // Stances rotate every 3 turns: lance -> bulwark -> fission -> velocity -> mend.
      // Within a stance, alternate its two moves. At <=50% hp the move gains a surge rider
      // (handled by move effects via cond turnAtLeast? no — extra hit baked into '_b' moves).
      const stances = ['lance', 'bulwark', 'fission', 'velocity', 'mend'];
      const stance = stances[Math.floor(actor.turnsAlive / 3) % stances.length]!;
      const sub = actor.turnsAlive % 2 === 0 ? 'a' : 'b';
      return moveById(def, `${stance}_${sub}`);
    }
    case 'exodus': {
      const hp = actor.hp;
      if (hp > 300) {
        const cycle = ['mem_windup', 'mem_ray', 'mem_defense', 'mem_lattice'];
        return moveById(def, cycle[actor.moveIndex % cycle.length]!);
      }
      if (hp > 150) {
        const cycle = ['div_lance', 'div_bulwark', 'div_fission', 'div_velocity'];
        return moveById(def, cycle[actor.moveIndex % cycle.length]!);
      }
      // Phase 3: unmake -> rewrite -> collapse (collapse only once; countdown rides upkeep)
      if (!actor.flags['collapseStarted'] && actor.moveIndex % 3 === 2) {
        actor.flags['collapseStarted'] = true;
        return moveById(def, 'collapse');
      }
      return moveById(def, actor.moveIndex % 2 === 0 ? 'unmake' : 'rewrite');
    }
    case 'echo':
      return moveById(def, 'echo_deck');
    default:
      throw new Error(`unknown ai script ${script}`);
  }
}

// ---------------------------------------------------------------- preview

export function intentPreview(state: CombatState, rng: Rng, actor: ActorState): IntentPreview | null {
  if (!actor.intentMoveId || actor.hp <= 0) return null;
  const def = getEnemy(actor.enemyId!);
  const move = moveById(def, actor.intentMoveId);
  const preview: IntentPreview = { kind: move.intent, moveName: move.name };
  let total = 0, hits = 0;
  const walk = (ops: import('./combat-types').EffectOp[]): void => {
    for (const op of ops) {
      if (op.op === 'damage') {
        const base = typeof op.amount === 'number' ? op.amount : op.amount.base;
        const times = typeof op.times === 'number' ? op.times : 1;
        const per = dealDamage(state, rng, actor, state.player, base, { isAttack: true, dryRun: true });
        total += per * times;
        hits += times;
      }
      if (op.op === 'if') { walk(op.then); }
    }
  };
  walk(move.effects);
  if (hits > 0) { preview.damage = total; preview.hits = hits; }
  return preview;
}
