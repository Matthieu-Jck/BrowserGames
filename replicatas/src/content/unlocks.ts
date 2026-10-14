// unlocks.ts — the Archive (permanent meta unlocks bought with Data) and the
// Mutation pool offered when a replica wakes after death.

export interface ArchiveUnlockDef {
  name: string;
  desc: string;
  cost: number;                 // Data
  kind: 'pack' | 'core' | 'perk' | 'codex';
  archetype?: 'laser' | 'kinetic' | 'nuclear' | 'speed' | 'repair';
}

export const ARCHIVE = {
  // ---------------------------------------------------------------- archetype packs (add META cards to pools)
  pack_laser: { name: 'Laser Pack', desc: 'Adds Microfocus Array, Prism Splitter and Coherence to reward pools.', cost: 25, kind: 'pack', archetype: 'laser' },
  pack_kinetic: { name: 'Kinetic Pack', desc: 'Adds Autoloader, Shock Absorbers and Gauss Engine to reward pools.', cost: 25, kind: 'pack', archetype: 'kinetic' },
  pack_nuclear: { name: 'Nuclear Pack', desc: 'Adds Containment Cell, Breeder Reactor and Meltdown to reward pools.', cost: 25, kind: 'pack', archetype: 'nuclear' },
  pack_speed: { name: 'Speed Pack', desc: 'Adds Flicker Drive, Predictive Targeting and Redline Core to reward pools.', cost: 25, kind: 'pack', archetype: 'speed' },
  pack_repair: { name: 'Repair Pack', desc: 'Adds Hull Spikes, Swarm Director and Persistent Shielding to reward pools.', cost: 25, kind: 'pack', archetype: 'repair' },
  // ---------------------------------------------------------------- archetype cores (starting loadouts)
  core_laser: { name: 'Laser Core', desc: 'New loadout: 2 Pulse Lasers become Focused Beams; start with the Targeting Suite (+1 Burden).', cost: 40, kind: 'core', archetype: 'laser' },
  core_kinetic: { name: 'Kinetic Core', desc: 'New loadout: 2 Pulse Lasers become Railshots; start with Heat Pumps (+1 Burden).', cost: 40, kind: 'core', archetype: 'kinetic' },
  core_nuclear: { name: 'Nuclear Core', desc: 'New loadout: 2 Pulse Lasers become Isotope Rounds; start with Rad Scrubbers (+1 Burden).', cost: 40, kind: 'core', archetype: 'nuclear' },
  core_speed: { name: 'Speed Core', desc: 'New loadout: 2 Pulse Lasers become Microthrusts; start with the Coprocessor (+1 Burden).', cost: 40, kind: 'core', archetype: 'speed' },
  core_repair: { name: 'Repair Core', desc: 'New loadout: 2 Shield Matrices become Nanite Clouds; start with Ablative Coating (+1 Burden).', cost: 40, kind: 'core', archetype: 'repair' },
  // ---------------------------------------------------------------- perks
  contingency_cache: { name: 'Contingency Cache', desc: 'Start runs with +20 Minerals.', cost: 30, kind: 'perk' },
  deep_stockpile: { name: 'Deep Stockpile', desc: '+2 Fuel capacity; start with a full tank.', cost: 20, kind: 'perk' },
  orbital_relay: { name: 'Orbital Relay', desc: 'Start with Scanner Lv1.', cost: 35, kind: 'perk' },
  payload_rack: { name: 'Payload Rack', desc: '+1 Payload slot.', cost: 25, kind: 'perk' },
  prelaunch_tuning: { name: 'Pre-Launch Tuning', desc: 'Choose 1 Mutation at run start.', cost: 30, kind: 'perk' },
  black_box: { name: 'Black Box Protocol', desc: 'Once per run, dying without a backup auto-forges a free backup at the last Forge you visited.', cost: 50, kind: 'perk' },
} satisfies Record<string, ArchiveUnlockDef>;

export type ArchiveId = keyof typeof ARCHIVE;

// ---------------------------------------------------------------- mutations
// "Slightly improved": pick 1 of 3 when a replica wakes (2 with Perfect Copy).

export interface MutationDef {
  name: string;
  desc: string;
  oncePerRun?: boolean;
}

export const MUTATIONS = {
  mut_hull: { name: 'Reinforced Frame', desc: '+6 max Hull.' },
  mut_refit: { name: 'Iterated Design', desc: 'Refit 2 random cards.' },
  mut_minerals: { name: 'Cached Feedstock', desc: '+20 Minerals.' },
  mut_purge: { name: 'Cleaner Genome', desc: 'Remove up to 2 cards from your deck.' },
  mut_fuel: { name: 'Expanded Tanks', desc: '+2 Fuel capacity, tank refilled.' },
  mut_card: { name: 'Inherited Technique', desc: 'Gain a random uncommon card of your dominant archetype.' },
  mut_payload: { name: 'Auxiliary Rack', desc: '+1 Payload slot and a random Payload.', oncePerRun: true },
  mut_shields: { name: 'Standing Field', desc: 'Start combats with 4 Shields. (Stacks twice.)' },
} satisfies Record<string, MutationDef>;

export type MutationId = keyof typeof MUTATIONS;
