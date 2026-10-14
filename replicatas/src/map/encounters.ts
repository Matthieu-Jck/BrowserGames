// encounters.ts — encounter tables: (act, planet type, node kind, rng) → enemy group.
import type { Rng } from '@/core/rng';
import type { PlanetType } from './planet-gen';

export interface Encounter {
  enemies: string[];
}

type Table = Array<readonly [string[], number]>;

const ACT1_NORMAL: Table = [
  [['scrapmites_leader', 'scrap_mite', 'scrap_mite'], 3],
  [['feral_drone'], 3],
  [['magnetite_burrower'], 3],
  [['acid_polyp'], 3],
  [['glow_lurker'], 3],
  [['derelict_turret', 'derelict_turret'], 3],
  [['feral_drone', 'scrap_mite'], 2],
  [['glow_lurker', 'glow_lurker'], 1],
];

const ACT2_NORMAL: Table = [
  [['replica_lancer'], 3],
  [['replica_brute'], 3],
  [['replica_halflife'], 3],
  [['replica_dervish'], 3],
  [['replica_lancer', 'replica_mender'], 2],
  [['replica_brute', 'replica_mender'], 2],
  [['cancerous_forge', 'defect_mite'], 2],
  [['swarm_mite', 'swarm_mite', 'swarm_mite', 'swarm_mite', 'swarm_conductor'], 2],
  [['replica_dervish', 'replica_dervish'], 1],
];

const ACT3_NORMAL: Table = [
  [['paradox_echo'], 1],
  [['hawking_wisp', 'hawking_wisp', 'hawking_wisp'], 1],
];

// planet-type thematic bias: enemy table reweighting
const TYPE_BIAS: Partial<Record<PlanetType, Record<string, number>>> = {
  irradiated: { glow_lurker: 3 },
  derelict: { scrapmites_leader: 2, derelict_turret: 2, feral_drone: 2 },
  ice: { magnetite_burrower: 0.5 },
  volcanic: { magnetite_burrower: 2 },
  ocean: { acid_polyp: 2 },
  feral: { replica_lancer: 2, replica_brute: 2, replica_dervish: 2 },
  tomb: { cancerous_forge: 0.5 },
  colony: {},
};

export function rollEncounter(act: 1 | 2 | 3, type: PlanetType, kind: 'combat' | 'elite' | 'boss', rng: Rng, planetIndex: number): Encounter {
  if (kind === 'boss') {
    if (planetIndex === 10) return { enemies: ['seraph0', 'shield_satellite', 'shield_satellite'] };
    if (planetIndex === 20) return { enemies: ['prime'] };
    return { enemies: ['exodus'] };
  }
  if (kind === 'elite') {
    if (act === 1) return { enemies: [rng.pick(['hive_custodian', 'ice_stalker'])] };
    if (act === 2) return { enemies: [type === 'tomb' ? 'tomb_sentinel' : rng.pick(['void_leviathan', 'tomb_sentinel'])] };
    return { enemies: ['veil_sentinel'] };
  }
  const table = act === 1 ? ACT1_NORMAL : act === 2 ? ACT2_NORMAL : ACT3_NORMAL;
  const bias = TYPE_BIAS[type] ?? {};
  const weighted = table.map(([group, w]) => {
    let mult = 1;
    for (const e of group) if (bias[e]) mult = Math.max(mult, bias[e]!);
    return [group, w * mult] as const;
  });
  return { enemies: [...rng.weighted(weighted)] };
}

/** Position scaling inside an act: first third −20%, final third +20%. */
export function planetScale(planetIndex: number): number {
  const act = planetIndex <= 10 ? 1 : planetIndex <= 20 ? 2 : 3;
  if (act === 3) return 1;
  const pos = act === 1 ? planetIndex : planetIndex - 10; // 1..10
  if (pos <= 3) return 0.8;
  if (pos >= 7 && pos <= 9) return 1.2;
  if (pos === 10) return 1;     // boss carries its own numbers
  return 1;
}
