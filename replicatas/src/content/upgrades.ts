// upgrades.ts — relic-like probe upgrades. Every upgrade adds Burden, and Burden
// raises the cost of replicating yourself — the run's core tension.
// Behavior is implemented in code (combat config builder + run logic) keyed by id.

export interface UpgradeDef {
  name: string;
  desc: string;
  track: 'combat' | 'efficiency' | 'scanner' | 'fuel' | 'extraction' | 'replication' | 'trophy';
  cost: number;                 // minerals; 0 = not purchasable (trophy / drop)
  burden: number;
  requires?: string;            // upgrade id prerequisite (scanner chain)
  act2Plus?: boolean;
  trophy?: boolean;             // elite/boss loot only — never stocked
  visual?: 'barrel' | 'dish' | 'panel' | 'tank' | 'drill' | 'bay' | 'spike' | 'ring';
}

export const UPGRADES = {
  // ---------------------------------------------------------------- COMBAT
  targeting_suite: { name: 'Targeting Suite', desc: 'Your first Attack each turn deals +3 per hit.', track: 'combat', cost: 45, burden: 1, visual: 'barrel' },
  ablative_coating: { name: 'Ablative Coating', desc: 'The first attack hit you take each combat is halved.', track: 'combat', cost: 50, burden: 1, visual: 'ring' },
  point_defense_web: { name: 'Point-Defense Web', desc: 'Take 1 less from each hit of multi-hit attacks (min 1).', track: 'combat', cost: 55, burden: 1, visual: 'spike' },
  capacitor_bank: { name: 'Capacitor Bank', desc: '+1⚡ on your first turn each combat.', track: 'combat', cost: 60, burden: 2, visual: 'panel' },
  weapons_hardpoint: { name: 'Weapons Hardpoint', desc: 'Combat card rewards offer 4 choices.', track: 'combat', cost: 70, burden: 2, visual: 'barrel' },
  war_core: { name: 'War Core', desc: '+1⚡ every turn.', track: 'combat', cost: 110, burden: 3, act2Plus: true, visual: 'barrel' },

  // ---------------------------------------------------------------- EFFICIENCY
  coprocessor: { name: 'Coprocessor', desc: 'Draw +1 card on your first turn each combat.', track: 'efficiency', cost: 45, burden: 1 },
  recycler_loop: { name: 'Recycler Loop', desc: '+6 Minerals after each combat victory.', track: 'efficiency', cost: 50, burden: 1 },
  buffer_cache: { name: 'Buffer Cache', desc: 'You may retain 1 card each turn.', track: 'efficiency', cost: 55, burden: 1 },
  heat_pumps: { name: 'Heat Pumps', desc: 'The first 3 Overheat each turn deal no damage.', track: 'efficiency', cost: 60, burden: 2 },
  rad_scrubbers: { name: 'Rad Scrubbers', desc: 'Remove 1 of your Radiation before it ticks each turn.', track: 'efficiency', cost: 60, burden: 2 },
  optimized_bus: { name: 'Optimized Bus', desc: 'The first Power you play each combat costs 0.', track: 'efficiency', cost: 100, burden: 3 },

  // ---------------------------------------------------------------- SCANNER (chain)
  scanner1: { name: 'Spectrometer', desc: 'Scanner Lv1: see resource richness; node types on the current planet.', track: 'scanner', cost: 40, burden: 1, visual: 'dish' },
  scanner2: { name: 'Deep Survey Array', desc: 'Scanner Lv2: threat ratings; a 3rd destination candidate; node types before landing.', track: 'scanner', cost: 65, burden: 1, requires: 'scanner1', visual: 'dish' },
  scanner3: { name: 'Threat Library', desc: 'Scanner Lv3: enemy names on combat nodes; event titles.', track: 'scanner', cost: 90, burden: 2, requires: 'scanner2', visual: 'dish' },
  scanner4: { name: 'Quantum Telescope', desc: 'Scanner Lv4: loot previews; 1 free destination reroll per act.', track: 'scanner', cost: 120, burden: 2, requires: 'scanner3', visual: 'dish' },
  precog_lattice: { name: 'Precog Lattice', desc: 'Scout +1 whenever you Scout.', track: 'scanner', cost: 0, burden: 2, trophy: true, visual: 'dish' },

  // ---------------------------------------------------------------- FUEL
  drop_tanks: { name: 'Drop Tanks', desc: '+4 Fuel capacity.', track: 'fuel', cost: 35, burden: 1, visual: 'tank' },
  solar_sails: { name: 'Solar Sails', desc: '+1 Fuel on each planet arrival.', track: 'fuel', cost: 45, burden: 1, visual: 'panel' },
  fuel_synthesizer: { name: 'Fuel Synthesizer', desc: 'Fabricators can convert 12 Minerals → 2 Fuel.', track: 'fuel', cost: 55, burden: 1, visual: 'tank' },
  ion_drive: { name: 'Ion Drive', desc: 'All jumps cost −1 Fuel (min 1).', track: 'fuel', cost: 60, burden: 1, visual: 'tank' },
  fusion_torch: { name: 'Fusion Torch', desc: 'Jumps −1 more Fuel (min 1). Once per act, jump anywhere free.', track: 'fuel', cost: 95, burden: 2, requires: 'ion_drive', visual: 'tank' },

  // ---------------------------------------------------------------- EXTRACTION
  reinforced_drill: { name: 'Reinforced Drill', desc: 'Extraction sites yield +40% Minerals.', track: 'extraction', cost: 40, burden: 1, visual: 'drill' },
  salvage_rig: { name: 'Salvage Rig', desc: '+30% Minerals from combat loot.', track: 'extraction', cost: 50, burden: 1, visual: 'drill' },
  exotic_sifter: { name: 'Exotic Sifter', desc: 'Extraction sites also yield 3–5 Data.', track: 'extraction', cost: 60, burden: 1, visual: 'drill' },
  mobile_refinery: { name: 'Mobile Refinery', desc: 'Extraction sites also yield 1–2 Fuel.', track: 'extraction', cost: 65, burden: 1, visual: 'tank' },
  plasma_bore: { name: 'Plasma Bore', desc: 'Unlocks Deep Bore at extraction sites: double yield (70%) or lose 8 Hull (30%).', track: 'extraction', cost: 70, burden: 2, visual: 'drill' },

  // ---------------------------------------------------------------- REPLICATION
  assembly_swarm: { name: 'Assembly Swarm', desc: 'Replication costs −20%.', track: 'replication', cost: 60, burden: 0, visual: 'bay' },
  lineage_archive: { name: 'Lineage Archive', desc: 'Backups snapshot 75% of your Minerals & Fuel instead of 50%.', track: 'replication', cost: 55, burden: 1, visual: 'bay' },
  hardened_genome: { name: 'Hardened Genome', desc: 'Replicas wake with +10 max Hull.', track: 'replication', cost: 70, burden: 1, visual: 'bay' },
  distributed_lineage: { name: 'Distributed Lineage', desc: 'Store up to 2 backups; choose which wakes on death.', track: 'replication', cost: 90, burden: 2, visual: 'bay' },
  perfect_copy: { name: 'Perfect Copy', desc: 'Backups keep Payloads and 100% of resources. Choose 2 Mutations on death.', track: 'replication', cost: 130, burden: 2, act2Plus: true, visual: 'bay' },

  // ---------------------------------------------------------------- TROPHIES (elite/boss loot only)
  custodian_plating: { name: 'Custodian Plating', desc: 'Take 1 less damage from every hit (min 1).', track: 'trophy', cost: 0, burden: 2, trophy: true, visual: 'ring' },
  storm_core: { name: 'Storm Core', desc: 'Start each combat with 5 Shields.', track: 'trophy', cost: 0, burden: 1, trophy: true, visual: 'panel' },
  leviathan_heart: { name: 'Leviathan Heart', desc: '+12 max Hull.', track: 'trophy', cost: 0, burden: 1, trophy: true, visual: 'ring' },
  forge_core: { name: 'Forge Core', desc: 'Replication costs 10 fewer Minerals.', track: 'trophy', cost: 0, burden: 0, trophy: true, visual: 'bay' },
  chronal_shard: { name: 'Chronal Shard', desc: 'Once per lineage, a lethal hit leaves you at 1 Hull.', track: 'trophy', cost: 0, burden: 2, trophy: true, visual: 'spike' },
} satisfies Record<string, UpgradeDef>;

export type UpgradeId = keyof typeof UPGRADES;
