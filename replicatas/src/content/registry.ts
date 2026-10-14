// registry.ts — merged content lookups. Everything that references content by id
// goes through here, so a bad id throws loudly (and validate.ts checks at startup).
import type { Rng } from '@/core/rng';
import type { Archetype, CardDef, CardInstance, EnemyDef } from '@/combat/combat-types';
import { CARDS, type CardId } from './cards';
import { ENEMIES, type EnemyId } from './enemies';
import { EVENTS, type EventId } from './events';
import { UPGRADES, type UpgradeId, type UpgradeDef } from './upgrades';
import { PAYLOADS, type PayloadId, type PayloadDef } from './payloads';
import { ARCHIVE, MUTATIONS } from './unlocks';

export { CARDS, ENEMIES, EVENTS, UPGRADES, PAYLOADS, ARCHIVE, MUTATIONS };
export type { CardId, EnemyId, EventId, UpgradeId, PayloadId };

export function getCard(id: string): CardDef {
  const def = (CARDS as Record<string, CardDef>)[id];
  if (!def) throw new Error(`unknown card: ${id}`);
  return def;
}

export function getEnemy(id: string): EnemyDef {
  const def = (ENEMIES as Record<string, EnemyDef>)[id];
  if (!def) throw new Error(`unknown enemy: ${id}`);
  return def;
}

export function getPayload(id: string): PayloadDef {
  const def = (PAYLOADS as Record<string, PayloadDef>)[id];
  if (!def) throw new Error(`unknown payload: ${id}`);
  return def;
}

export function getUpgrade(id: string): UpgradeDef {
  const def = (UPGRADES as Record<string, UpgradeDef>)[id];
  if (!def) throw new Error(`unknown upgrade: ${id}`);
  return def;
}

/** Card def with refit overrides applied for a specific instance. */
export function effectiveCard(inst: CardInstance): CardDef {
  const base = getCard(inst.cardId);
  if (!inst.refitted || !base.refit) return base;
  return {
    ...base,
    cost: base.refit.cost ?? base.cost,
    effects: base.refit.effects ?? base.effects,
    text: base.refit.text ?? base.text,
    exhaust: base.refit.exhaust ?? base.exhaust,
    name: `${base.name}+`,
  };
}

// ---------------------------------------------------------------- pools

const ARCH_LIST: Archetype[] = ['laser', 'kinetic', 'nuclear', 'speed', 'repair', 'neutral'];

export function cardPool(opts: {
  rarity?: 'common' | 'uncommon' | 'rare';
  archetype?: Archetype;
  unlockedMeta: string[];        // archive unlock ids owned
}): CardId[] {
  const metaArchetypes = new Set(
    opts.unlockedMeta
      .map((id) => (ARCHIVE as Record<string, { kind: string; archetype?: string }>)[id])
      .filter((u) => u && u.kind === 'pack' && u.archetype)
      .map((u) => u!.archetype as string),
  );
  return (Object.keys(CARDS) as CardId[]).filter((id) => {
    const c = getCard(id);
    if (c.kind === 'curse' || c.kind === 'statusCard') return false;
    if (c.source === 'starter' || c.source === 'drop' || c.source === 'special') return false;
    if (c.source === 'meta' && !metaArchetypes.has(c.archetype)) return false;
    if (opts.rarity && c.rarity !== opts.rarity) return false;
    if (opts.archetype && c.archetype !== opts.archetype) return false;
    return true;
  });
}

export function randomCardOfArchetype(arch: Archetype, rng: Rng): CardId | null {
  const pool = (Object.keys(CARDS) as CardId[]).filter((id) => {
    const c = getCard(id);
    return c.archetype === arch && (c.source === 'base' || c.source === 'meta')
      && c.kind !== 'curse' && c.kind !== 'statusCard';
  });
  return pool.length ? rng.pick(pool) : null;
}

export function paradoxPool(): CardId[] {
  return (Object.keys(CARDS) as CardId[]).filter((id) => getCard(id).archetype === 'paradox');
}

export function isValidArchetype(a: string): a is Archetype {
  return ARCH_LIST.includes(a as Archetype) || a === 'paradox';
}
