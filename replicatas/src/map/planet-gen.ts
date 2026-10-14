// planet-gen.ts — planet types and pure (seed → PlanetSpec) generation.
import { makeRng } from '@/core/rng';
import { PLANET_NAME_PARTS, STORY_WORLDS } from '@/content/story';

export type PlanetType =
  | 'rocky' | 'ice' | 'volcanic' | 'ocean' | 'gasmoon' | 'irradiated' | 'derelict'
  | 'colony' | 'feral' | 'tomb' | 'anomalous'
  | 'garden' | 'foundry' | 'void';

export type PlanetSize = 'moon' | 'standard' | 'rich';

export interface PlanetTypeDef {
  label: string;
  desc: string;
  // visual palette (terrain vertex colors low→high, sky, fog, atmosphere tint)
  palette: { terrain: [string, string, string, string]; sky: string; fog: string; atmo: string; water?: string };
  props: 'rocks' | 'shards' | 'vents' | 'spires' | 'crystals' | 'wreckage' | 'flora' | 'ruins' | 'none';
  sun: number;                  // light level 0..1
  richness: { minerals: number; fuel: number; data: number }; // bias multipliers
  hazardHull?: number;          // hull lost on landing
  acts: Array<1 | 2 | 3>;
}

export const PLANET_TYPES: Record<PlanetType, PlanetTypeDef> = {
  rocky: {
    label: 'Rocky World', desc: 'Cratered silicate. Honest ground, decent ore.',
    palette: { terrain: ['#3c2f28', '#6b5a48', '#8a7a64', '#b0a48c'], sky: '#1a1410', fog: '#241c14', atmo: '#8a7a64' },
    props: 'rocks', sun: 0.85, richness: { minerals: 1.4, fuel: 0.8, data: 1 }, acts: [1, 2],
  },
  ice: {
    label: 'Ice World', desc: 'Frozen volatiles to the horizon. Cheap propellant.',
    palette: { terrain: ['#2a3c44', '#5a7e8a', '#9fc6d0', '#e8f6fa'], sky: '#0c1418', fog: '#16242a', atmo: '#9fd4e0' },
    props: 'shards', sun: 0.6, richness: { minerals: 0.8, fuel: 1.6, data: 1 }, acts: [1, 2],
  },
  volcanic: {
    label: 'Volcanic World', desc: 'Active crust, rich seams, bad manners. −3 Hull on landing.',
    palette: { terrain: ['#1c0f0c', '#4a2018', '#8a3a20', '#d4622d'], sky: '#180a06', fog: '#2a120a', atmo: '#d4622d' },
    props: 'vents', sun: 0.7, richness: { minerals: 1.7, fuel: 0.7, data: 0.9 }, hazardHull: 3, acts: [1, 2],
  },
  ocean: {
    label: 'Ocean World', desc: 'A single sea with occasional opinions of land. Data-rich chemistry.',
    palette: { terrain: ['#0e2a36', '#14506b', '#2a7a8a', '#5aa48c'], sky: '#0a1c26', fog: '#10303e', atmo: '#3a8aaa', water: '#14506b' },
    props: 'flora', sun: 0.8, richness: { minerals: 0.8, fuel: 0.9, data: 1.5 }, acts: [1, 2],
  },
  gasmoon: {
    label: 'Gas-Giant Moon', desc: 'A small moon under a vast parent. Fuel skimming territory.',
    palette: { terrain: ['#241c2e', '#4a3a5e', '#6b5a8a', '#9a8ab0'], sky: '#100a18', fog: '#1c1426', atmo: '#76588c' },
    props: 'rocks', sun: 0.5, richness: { minerals: 0.7, fuel: 1.7, data: 1 }, acts: [1, 2],
  },
  irradiated: {
    label: 'Irradiated World', desc: 'Something went wrong here at reactor scale. The fauna adapted.',
    palette: { terrain: ['#1c2410', '#3a4a1c', '#6b7a2a', '#a4b03c'], sky: '#10160a', fog: '#1c2410', atmo: '#d4f04a' },
    props: 'crystals', sun: 0.65, richness: { minerals: 1, fuel: 0.8, data: 1.5 }, acts: [1, 2],
  },
  derelict: {
    label: 'Derelict Field', desc: 'Dead megastructure. Machines defend the corpse. No extraction.',
    palette: { terrain: ['#14181e', '#2a3440', '#3c4a5c', '#5a6b7e'], sky: '#080a0e', fog: '#10141a', atmo: '#5a6b7e' },
    props: 'wreckage', sun: 0.45, richness: { minerals: 1.5, fuel: 0.7, data: 1.4 }, acts: [1, 2],
  },
  colony: {
    label: 'Colony World', desc: 'Your descendants, settled and mostly peaceful. Lights on the night side.',
    palette: { terrain: ['#1c2a20', '#2c4a34', '#4a7a4c', '#7aa45a'], sky: '#0c140e', fog: '#142016', atmo: '#71e8a4' },
    props: 'ruins', sun: 0.8, richness: { minerals: 1, fuel: 1, data: 1.3 }, acts: [2],
  },
  feral: {
    label: 'Feral Colony', desc: 'A colony of your line that diverged badly. They defend what they became.',
    palette: { terrain: ['#241416', '#48201e', '#6b3028', '#8a4a36'], sky: '#140a0a', fog: '#201012', atmo: '#ff5d4a' },
    props: 'ruins', sun: 0.7, richness: { minerals: 1.3, fuel: 0.9, data: 1.2 }, acts: [2],
  },
  tomb: {
    label: 'Tomb World', desc: 'Pre-human. Pre-everything. The wardens still keep the hours.',
    palette: { terrain: ['#16121e', '#2a2238', '#443456', '#6b5486'], sky: '#0a0812', fog: '#120e1c', atmo: '#b48cff' },
    props: 'ruins', sun: 0.5, richness: { minerals: 1, fuel: 0.8, data: 1.8 }, acts: [2],
  },
  anomalous: {
    label: 'Anomalous World', desc: 'The survey data disagrees with itself. Twice.',
    palette: { terrain: ['#101c24', '#1e3a4a', '#2a5e6b', '#3c8a8a'], sky: '#081016', fog: '#0e1c24', atmo: '#6fe0ef' },
    props: 'crystals', sun: 0.6, richness: { minerals: 0.9, fuel: 0.9, data: 1.6 }, acts: [2],
  },
  garden: {
    label: 'Garden World', desc: 'CRADLE. Liquid water. Breathable margin. Defended.',
    palette: { terrain: ['#14301c', '#1d4a2a', '#3a7a3c', '#71b05a'], sky: '#0e1c26', fog: '#142a1c', atmo: '#71e8a4', water: '#1d4a55' },
    props: 'flora', sun: 1.0, richness: { minerals: 1, fuel: 1, data: 1 }, acts: [1],
  },
  foundry: {
    label: 'Foundry World', desc: 'ANVIL. The first divergence built itself a temple of industry.',
    palette: { terrain: ['#1c1410', '#3c2a1c', '#6b4a24', '#a4742d'], sky: '#120c08', fog: '#1e140c', atmo: '#ffd700' },
    props: 'ruins', sun: 0.7, richness: { minerals: 1.5, fuel: 1, data: 1.5 }, acts: [2],
  },
  void: {
    label: 'Deep Void', desc: 'No ground. Only the approach.',
    palette: { terrain: ['#0a0a12', '#12121e', '#1c1c2e', '#2a2a44'], sky: '#04040a', fog: '#080810', atmo: '#b48cff' },
    props: 'none', sun: 0.3, richness: { minerals: 0.8, fuel: 1, data: 1.5 }, acts: [3],
  },
};

export interface PlanetSpec {
  seedKey: string;              // deterministic identity: `${runSeed}:planet:${index}:${regen}:${slot}`
  name: string;
  type: PlanetType;
  size: PlanetSize;
  fuelCost: number;
  threat: 1 | 2 | 3 | 4 | 5;
  richness: { minerals: number; fuel: number; data: number };
  story?: 'garden' | 'foundry' | 'act3';
  act3Index?: number;           // 0..4 for the fixed strip
}

const ACT1_TYPES: PlanetType[] = ['rocky', 'ice', 'volcanic', 'ocean', 'gasmoon', 'irradiated', 'derelict'];
const ACT2_TYPES: PlanetType[] = ['rocky', 'ice', 'volcanic', 'ocean', 'colony', 'feral', 'tomb', 'anomalous', 'derelict'];

export function actOfPlanet(index: number): 1 | 2 | 3 {
  if (index <= 10) return 1;
  if (index <= 20) return 2;
  return 3;
}

export function planetName(rng: { pick<T>(a: readonly T[]): T; int(a: number, b: number): number }): string {
  return `${rng.pick(PLANET_NAME_PARTS.first)} ${rng.pick(PLANET_NAME_PARTS.second)} ${rng.int(2, 99)}`;
}

/** Generate one candidate destination. Pure in (runSeed, planetIndex, regen, slot). */
export function genPlanet(runSeed: string, planetIndex: number, regen: number, slot: number): PlanetSpec {
  const seedKey = `${runSeed}:planet:${planetIndex}:${regen}:${slot}`;
  const rng = makeRng(seedKey);
  const act = actOfPlanet(planetIndex);

  if (planetIndex === 10) {
    return { seedKey, name: STORY_WORLDS.gardenWorld, type: 'garden', size: 'standard', fuelCost: 2, threat: 5, richness: { minerals: 1, fuel: 1, data: 1 }, story: 'garden' };
  }
  if (planetIndex === 20) {
    return { seedKey, name: STORY_WORLDS.foundryWorld, type: 'foundry', size: 'standard', fuelCost: 2, threat: 5, richness: { minerals: 1.5, fuel: 1, data: 1.5 }, story: 'foundry' };
  }
  if (act === 3) {
    const i = planetIndex - 21;
    return { seedKey, name: STORY_WORLDS.act3[i] ?? 'The Dive', type: 'void', size: 'moon', fuelCost: 0, threat: 5, richness: { minerals: 0.8, fuel: 1, data: 1.5 }, story: 'act3', act3Index: i };
  }

  const types = act === 1 ? ACT1_TYPES : ACT2_TYPES;
  const type = rng.pick(types);
  const def = PLANET_TYPES[type];
  const size: PlanetSize = type === 'gasmoon'
    ? 'moon'
    : rng.weighted([['moon', 2], ['standard', 5], ['rich', 2]] as const) as PlanetSize;
  // rich worlds & derelicts cost more fuel
  let fuelCost = rng.int(2, 3);
  if (size === 'rich' || type === 'derelict' || type === 'tomb') fuelCost++;
  fuelCost = Math.min(4, fuelCost);
  const threat = Math.min(5, Math.max(1,
    rng.int(1, 3) + (size === 'rich' ? 1 : 0) + (type === 'tomb' || type === 'feral' ? 1 : 0))) as 1 | 2 | 3 | 4 | 5;
  return {
    seedKey, name: planetName(rng), type, size, fuelCost, threat,
    richness: { ...def.richness },
  };
}
