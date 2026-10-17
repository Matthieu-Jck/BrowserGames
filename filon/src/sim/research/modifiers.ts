// modifiers.ts — the modifier table compiled from the unlock tree's completed nodes (D33): the
// plans' effects first (a feature such as telemetry), in plan order, then research in research-id
// order, then the expertises in place at their rank (D93), in their slots' order, with an integer
// floor after each step, so every engine computes the same values. Multipliers are permille; "add"
// values are plain integers. The tree unlocks machines and features, not boosts (D70): the
// percentages are the expertises' alone — a production number (`mod`), or a family's research
// (`fam`: its nodes' time, tokens and data, ‰, read by `effectiveCost` when a project starts).
import { BAL } from '@/content/balance';
import { effectAt, expertiseDef } from '@/content/expertises';
import { FAMILY_IDS, PLAN_IDS, PLANS, RESEARCH, type ResearchId } from '@/content/research';
import { RESEARCH_IDS } from '@/content/registry';
import type { Effect, FamilyId, ModTarget, PlanDef, ResearchDef } from '@/content/types';

/** A family's research as the expertises leave it (‰ of the table's): its nodes' minimum time, AI tokens, data. */
export interface FamilyMods { time: number; tokens: number; data: number }

export type Mods = Record<ModTarget, number> & { flags: ReadonlySet<string>; slots: number; fam: Readonly<Record<FamilyId, FamilyMods>> };

const ADDITIVE: ReadonlySet<ModTarget> = new Set<ModTarget>([
  'landGrowth', 'pylonLink', 'dockShips', 'bridgeSpan', 'orders', 'tradeFee', 'heartData',
]);

export function baseMods(): Mods {
  const m: Record<string, number> = {};
  const targets: ModTarget[] = [
    'digSpeed', 'rubbleYield', 'embeddedOre', 'windOut', 'solarOut', 'geoOut', 'accCap', 'accRate',
    'genOut', 'craftSpeed', 'tradeFee', 'deliveryDelay', 'slippage', 'landPrice', 'landRent', 'landGrowth', 'farLand',
    'remoteBeltCost', 'remoteBuildDelay', 'pylonLink', 'dockShips', 'shipCap', 'shipSpeed', 'ring3Caps',
    'bridgeSpan', 'orders', 'excavatedSpeed', 'gustVariance', 'drifterDistance', 'heartData', 'drillRate', 'dataRate',
  ];
  for (const t of targets) m[t] = ADDITIVE.has(t) ? 0 : 1000;
  m.tradeFee = BAL.tradeFee; // nothing lowers it (D64)
  m.landGrowth = BAL.land.growth;
  const fam = Object.fromEntries(FAMILY_IDS.map((f) => [f, { time: 1000, tokens: 1000, data: 1000 }])) as Record<FamilyId, FamilyMods>;
  return { ...(m as Record<ModTarget, number>), flags: new Set<string>(), slots: 1, fam };
}

/**
 * Compile the modifier table for a set of completed tree nodes (plan and research ids) and the
 * expertises in place (D93: `held`, at their rank; systems/expertise.ts `heldExpertises`).
 */
export function computeMods(done: ReadonlySet<string>, held: ReadonlyArray<{ id: string; rank: number }> = []): Mods {
  const m = baseMods() as Mods & Record<string, number>;
  const fam = m.fam as Record<FamilyId, FamilyMods>;
  const flags = new Set<string>();
  let slots = 1;
  const apply = (effects: readonly Effect[]): void => {
    for (const ef of effects) {
      switch (ef.k) {
        case 'mul': m[ef.target] = Math.floor((m[ef.target]! * ef.permille) / 1000); break;
        case 'add': m[ef.target] = m[ef.target]! + ef.v; break;
        case 'flag': flags.add(ef.flag); break;
        case 'slots': slots += ef.add; break;
        case 'unlock': break;
      }
    }
  };
  for (const id of PLAN_IDS) if (done.has(id)) apply((PLANS[id] as PlanDef).effects ?? []);
  for (const id of RESEARCH_IDS) {
    if (!done.has(id)) continue;
    apply((RESEARCH[id as ResearchId] as ResearchDef).effects);
  }
  for (const { id, rank } of held) {
    const d = expertiseDef(id);
    if (!d) continue;
    const p = effectAt(d, rank);
    if (d.effect.k === 'mod') for (const t of d.effect.targets) m[t] = Math.floor((m[t]! * p) / 1000);
    else { const f = fam[d.family]; f[d.effect.aspect] = Math.floor((f[d.effect.aspect] * p) / 1000); }
  }
  return Object.assign(m, { flags, slots });
}

/** Stable hash input of a Mods table (part of offline regime keys). */
export function modsKey(m: Mods): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(m)) if (typeof v === 'number') parts.push(`${k}=${v}`);
  parts.push([...m.flags].sort().join(','));
  for (const f of FAMILY_IDS) parts.push(`${f}=${m.fam[f].time},${m.fam[f].tokens},${m.fam[f].data}`);
  return parts.join(';');
}
