// validate.ts — startup invariant checks the type system can't express.
// Runs in dev and inside the vitest suite; throws loudly on bad content.
import type { CardDef, EffectOp, EnemyDef } from '@/combat/combat-types';
import { CARDS, ENEMIES, EVENTS, UPGRADES, PAYLOADS, getCard, getEnemy } from './registry';
import type { EventDef } from './events';
import type { UpgradeDef } from './upgrades';
import type { PayloadDef } from './payloads';
import { STATUSES } from '@/combat/statuses';
import { hasScript, UPKEEPS } from '@/combat/scripts';

function walkOps(ops: EffectOp[], fn: (op: EffectOp) => void): void {
  for (const op of ops) {
    fn(op);
    if (op.op === 'if') { walkOps(op.then, fn); if (op.else) walkOps(op.else, fn); }
    if (op.op === 'damage' && op.onKill) walkOps(op.onKill, fn);
    if (op.op === 'addTurnStartOps') walkOps(op.ops, fn);
  }
}

export function validateContent(): void {
  const errors: string[] = [];
  const cards = CARDS as Record<string, CardDef>;
  const enemies = ENEMIES as Record<string, EnemyDef>;
  const events = EVENTS as Record<string, EventDef>;
  const upgrades = UPGRADES as Record<string, UpgradeDef>;
  const payloads = PAYLOADS as Record<string, PayloadDef>;

  const checkOps = (where: string, ops: EffectOp[]): void => {
    walkOps(ops, (op) => {
      if (op.op === 'status' && !STATUSES[op.status]) errors.push(`${where}: unknown status ${op.status}`);
      if (op.op === 'removeStatus' && !STATUSES[op.status]) errors.push(`${where}: unknown status ${op.status}`);
      if (op.op === 'addCard' && !cards[op.card]) errors.push(`${where}: unknown card ${op.card}`);
      if (op.op === 'summon' && !enemies[op.enemy]) errors.push(`${where}: unknown enemy ${op.enemy}`);
      if (op.op === 'custom' && !hasScript(op.script)) errors.push(`${where}: unknown script ${op.script}`);
      if (op.op === 'damage' && typeof op.amount === 'object' && op.amount.perStatus && !STATUSES[op.amount.perStatus.status]) {
        errors.push(`${where}: unknown status in amount ${op.amount.perStatus.status}`);
      }
    });
  };

  for (const [id, card] of Object.entries(cards)) {
    checkOps(`card ${id}`, card.effects);
    if (card.refit?.effects) checkOps(`card ${id} (refit)`, card.refit.effects);
    if (card.endOfTurn) checkOps(`card ${id} (endOfTurn)`, card.endOfTurn);
  }

  for (const [id, enemy] of Object.entries(enemies)) {
    for (const move of enemy.moves) checkOps(`enemy ${id} move ${move.id}`, move.effects);
    if (enemy.loot.cardDrop && !cards[enemy.loot.cardDrop.card]) {
      errors.push(`enemy ${id}: unknown drop card ${enemy.loot.cardDrop.card}`);
    }
    if (enemy.loot.trophy && !upgrades[enemy.loot.trophy.upgrade]) {
      errors.push(`enemy ${id}: unknown trophy ${enemy.loot.trophy.upgrade}`);
    }
    if (enemy.ai.mode === 'script' && !enemy.ai.script) errors.push(`enemy ${id}: script mode without script`);
  }
  for (const id of Object.keys(UPKEEPS)) {
    if (!enemies[id]) errors.push(`upkeep for unknown enemy ${id}`);
  }

  for (const [id, ev] of Object.entries(events)) {
    for (const choice of ev.choices) {
      for (const out of choice.outcomes) {
        if (out.addCard && !cards[out.addCard]) errors.push(`event ${id}: unknown card ${out.addCard}`);
        if (out.addCurse && !cards[out.addCurse]) errors.push(`event ${id}: unknown curse ${out.addCurse}`);
        if (out.upgrade && !upgrades[out.upgrade]) errors.push(`event ${id}: unknown upgrade ${out.upgrade}`);
        if (out.startCombat) for (const e of out.startCombat) if (!enemies[e]) errors.push(`event ${id}: unknown enemy ${e}`);
      }
      if (choice.req?.upgrade && !upgrades[choice.req.upgrade]) errors.push(`event ${id}: unknown req upgrade ${choice.req.upgrade}`);
    }
  }

  for (const [id, p] of Object.entries(payloads)) checkOps(`payload ${id}`, p.effects);

  for (const [id, u] of Object.entries(upgrades)) {
    if (u.requires && !upgrades[u.requires]) errors.push(`upgrade ${id}: unknown requires ${u.requires}`);
  }

  // reward pools must be non-empty per rarity even with zero meta unlocks
  for (const rarity of ['common', 'uncommon', 'rare'] as const) {
    const pool = Object.values(cards).filter((c) => c.rarity === rarity && c.source === 'base');
    if (!pool.length) errors.push(`empty base pool for rarity ${rarity}`);
  }

  // sanity: getters work
  getCard('pulse_laser');
  getEnemy('seraph0');

  if (errors.length) {
    throw new Error(`content validation failed:\n${errors.join('\n')}`);
  }
}
