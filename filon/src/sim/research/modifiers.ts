// modifiers.ts — the modifier table compiled from the unlock tree's completed nodes (D33): the
// plans' effects first (a feature such as telemetry), in plan order, then research (+ branch
// mastery) in research-id order, with an integer floor after each step, so every engine computes
// the same values. Multipliers are permille; "add" values are plain integers.
import { BAL } from '@/content/balance';
import { PLAN_IDS, PLANS, RESEARCH, BRANCH_CORE, type ResearchId } from '@/content/research';
import { RESEARCH_IDS } from '@/content/registry';
import type { Effect, ModTarget, PlanDef, ResearchDef } from '@/content/types';

export type Mods = Record<ModTarget, number> & { flags: ReadonlySet<string>; slots: number };

const ADDITIVE: ReadonlySet<ModTarget> = new Set<ModTarget>([
  'landGrowth', 'pylonLink', 'dockShips', 'bridgeSpan', 'streams', 'tradeFee', 'solarNight',
]);

export function baseMods(): Mods {
  const m: Record<string, number> = {};
  const targets: ModTarget[] = [
    'digSpeed', 'rubbleYield', 'embeddedOre', 'windOut', 'solarOut', 'solarNight', 'geoOut', 'accCap', 'accRate',
    'genOut', 'craftSpeed', 'tradeFee', 'deliveryDelay', 'slippage', 'landPrice', 'landRent', 'landGrowth', 'farLand',
    'remoteBeltCost', 'remoteBuildDelay', 'pylonLink', 'dockShips', 'shipCap', 'shipSpeed', 'ring3Caps',
    'bridgeSpan', 'streams', 'excavatedSpeed', 'gustVariance', 'drifterDistance',
  ];
  for (const t of targets) m[t] = ADDITIVE.has(t) ? 0 : 1000;
  m.tradeFee = BAL.tradeFee[0]!;
  m.landGrowth = BAL.land.growth;
  return { ...(m as Record<ModTarget, number>), flags: new Set<string>(), slots: 1 };
}

/** Compile the modifier table for a set of completed tree nodes (plan and research ids). */
export function computeMods(done: ReadonlySet<string>): Mods {
  const m = baseMods() as Mods & Record<string, number>;
  const flags = new Set<string>();
  let slots = 1;
  const perBranch: Record<string, number> = { ex: 0, xp: 0, dn: 0, en: 0, cm: 0 };
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
    const r = RESEARCH[id as ResearchId] as ResearchDef;
    if (r.branch !== 'trunk') perBranch[r.branch] = (perBranch[r.branch] ?? 0) + 1;
    apply(r.effects);
  }
  // Mastery: Initiate (3 nodes) / Master (6 nodes) boost the branch's core stat.
  for (const [b, n] of Object.entries(perBranch)) {
    const t = BRANCH_CORE[b as keyof typeof BRANCH_CORE];
    const bonus = n >= 6 ? BAL.masterBonus : n >= 3 ? BAL.initiateBonus : 0;
    if (!bonus) continue;
    // Slippage is a cost: mastery lowers it.
    const f = t === 'slippage' ? 1000 - bonus : 1000 + bonus;
    m[t] = Math.floor((m[t]! * f) / 1000);
  }
  m.tradeFee = Math.max(20, m.tradeFee);
  return Object.assign(m, { flags, slots });
}

/** Stable hash input of a Mods table (part of offline regime keys). */
export function modsKey(m: Mods): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(m)) if (typeof v === 'number') parts.push(`${k}=${v}`);
  parts.push([...m.flags].sort().join(','));
  return parts.join(';');
}
