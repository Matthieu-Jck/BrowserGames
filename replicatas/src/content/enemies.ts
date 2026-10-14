// enemies.ts — the full roster: 23 named enemies + summons. Loot is thematically
// coherent with each design. Acts 2/3 carry their scaling in their own numbers.
import type { EnemyDef } from '@/combat/combat-types';

export const ENEMIES = {
  // ================================================================ SUMMONS
  scrap_mite: {
    name: 'Scrap Mite', desc: 'A fist-sized recycler that no longer asks what it recycles.',
    faction: 'machine', act: 1, tier: 'summon', hp: [9, 12], mech: true,
    visual: { bodyPlan: 'swarm', scale: 0.55, palette: { base: '#6b5a3a', accent: '#8a7a50', emissive: '#cc8833' }, idle: 'skitter' },
    ai: { mode: 'cycle' },
    moves: [
      { id: 'gnaw', name: 'Gnaw', intent: 'attack', effects: [{ op: 'damage', amount: 3 }] },
      { id: 'multiply', name: 'Multiply', intent: 'summon', effects: [{ op: 'summon', enemy: 'scrap_mite', cap: 5 }] },
      { id: 'scuttle', name: 'Scuttle', intent: 'defend', effects: [{ op: 'block', amount: 4 }] },
    ],
    loot: { minerals: [3, 5], data: [1, 1], cardDrop: { card: 'nanite_cloud', chance: 0.08 } },
  },
  polyp_bud: {
    name: 'Polyp Bud', desc: 'A budding acid sac.',
    faction: 'fauna', act: 1, tier: 'summon', hp: [6, 6],
    visual: { bodyPlan: 'amorphous', scale: 0.5, palette: { base: '#5a8a4a', accent: '#7aa45a', emissive: '#9ccc44' }, idle: 'pulse' },
    ai: { mode: 'cycle' },
    moves: [{ id: 'bite', name: 'Bite', intent: 'attack', effects: [{ op: 'damage', amount: 2 }] }],
    loot: { minerals: [1, 2], data: [0, 1] },
  },
  custodian_turret: {
    name: 'Custodian Turret', desc: 'Deployable point defense.',
    faction: 'machine', act: 1, tier: 'summon', hp: [8, 8], mech: true,
    visual: { bodyPlan: 'turret', scale: 0.5, palette: { base: '#3c4a61', accent: '#6f8ab0', emissive: '#ffcc66' }, idle: 'rotate' },
    ai: { mode: 'cycle' },
    moves: [{ id: 'shoot', name: 'Shoot', intent: 'attack', effects: [{ op: 'damage', amount: 3 }] }],
    loot: { minerals: [2, 4], data: [0, 1] },
  },
  defect_mite: {
    name: 'Defect Mite', desc: 'Replication without a protocol.',
    faction: 'machine', act: 2, tier: 'summon', hp: [10, 10], mech: true,
    visual: { bodyPlan: 'swarm', scale: 0.55, palette: { base: '#5a3a3a', accent: '#7a5050', emissive: '#ff5d4a' }, idle: 'skitter' },
    ai: { mode: 'cycle' },
    moves: [{ id: 'gnaw', name: 'Gnaw', intent: 'attack', effects: [{ op: 'damage', amount: 3 }] }],
    loot: { minerals: [2, 4], data: [0, 1] },
  },
  swarm_mite: {
    name: 'Chorus Mite', desc: 'One voice of the Nineteen.',
    faction: 'machine', act: 2, tier: 'summon', hp: [12, 15], mech: true,
    visual: { bodyPlan: 'swarm', scale: 0.55, palette: { base: '#3a4a5c', accent: '#55636e', emissive: '#6fe0ef' }, idle: 'skitter' },
    ai: { mode: 'weighted' },
    moves: [
      { id: 'ping', name: 'Ping', intent: 'attack', weight: 3, effects: [{ op: 'damage', amount: 2 }] },
      { id: 'pulse', name: 'Pulse', intent: 'attack', weight: 2, effects: [{ op: 'damage', amount: 3 }] },
    ],
    loot: { minerals: [3, 5], data: [1, 1] },
  },
  shield_satellite: {
    name: 'Shield Satellite', desc: 'One of SERAPH-0\'s orbital lattice anchors.',
    faction: 'machine', act: 1, tier: 'summon', hp: [30, 30], mech: true,
    visual: { bodyPlan: 'floater', scale: 0.6, palette: { base: '#2a3c55', accent: '#6f8ab0', emissive: '#6fe0ef' }, idle: 'rotate' },
    ai: { mode: 'cycle' },
    moves: [{ id: 'beam', name: 'Lattice Beam', intent: 'attack', effects: [{ op: 'damage', amount: 4 }] }],
    loot: { minerals: [4, 8], data: [1, 2] },
  },

  // ================================================================ ACT 1 — fauna & feral machines
  scrapmites_leader: {
    name: 'Scrap Mites', desc: 'They were maintenance drones once. The colony they maintained is gone; the maintaining continues.',
    faction: 'machine', act: 1, tier: 'normal', hp: [9, 12], mech: true,
    visual: { bodyPlan: 'swarm', scale: 0.7, palette: { base: '#6b5a3a', accent: '#8a7a50', emissive: '#cc8833' }, idle: 'skitter' },
    ai: { mode: 'cycle' },
    moves: [
      { id: 'gnaw', name: 'Gnaw', intent: 'attack', effects: [{ op: 'damage', amount: 3 }] },
      { id: 'multiply', name: 'Multiply', intent: 'summon', effects: [{ op: 'summon', enemy: 'scrap_mite', cap: 5 }] },
      { id: 'scuttle', name: 'Scuttle', intent: 'defend', effects: [{ op: 'block', amount: 4 }] },
    ],
    loot: { minerals: [8, 12], data: [2, 2], cardDrop: { card: 'nanite_cloud', chance: 0.2 } },
  },
  feral_drone: {
    name: 'Feral Drone', desc: 'A survey drone whose survey ended centuries ago. Now it surveys threats.',
    faction: 'machine', act: 1, tier: 'normal', hp: [28, 34], mech: true,
    visual: { bodyPlan: 'floater', scale: 0.9, palette: { base: '#5a6a78', accent: '#37444f', emissive: '#ff4444' }, idle: 'hover' },
    ai: { mode: 'weighted', noRepeat: true },
    moves: [
      { id: 'snipe', name: 'Snipe', intent: 'attack', weight: 3, effects: [{ op: 'damage', amount: 7 }] },
      { id: 'optics', name: 'Charge Optics', intent: 'buff', weight: 2, effects: [{ op: 'status', status: 'force', stacks: 4, to: 'self' }] },
      { id: 'thrust', name: 'Evasive Thrust', intent: 'buff', weight: 1, effects: [{ op: 'status', status: 'evasion', stacks: 1, to: 'self' }] },
    ],
    loot: { minerals: [10, 14], data: [2, 2], cardDrop: { card: 'microthrust', chance: 0.25 } },
  },
  magnetite_burrower: {
    name: 'Magnetite Burrower', desc: 'It eats ore seams. Your chassis reads as a particularly pure seam.',
    faction: 'fauna', act: 1, tier: 'normal', hp: [38, 46], plating: 1,
    visual: { bodyPlan: 'crawler', scale: 1.1, palette: { base: '#4a3328', accent: '#8a6a4a', emissive: '#cc5522' }, idle: 'pulse' },
    ai: { mode: 'cycle' },
    moves: [
      { id: 'burrow', name: 'Burrow', intent: 'unknown', effects: [{ op: 'status', status: 'phased', stacks: 1, to: 'self' }] },
      { id: 'erupt', name: 'Erupt', intent: 'attack', effects: [{ op: 'damage', amount: 11 }] },
      { id: 'bask', name: 'Bask', intent: 'defend', effects: [{ op: 'block', amount: 6 }] },
    ],
    loot: { minerals: [12, 16], data: [3, 3], cardDrop: { card: 'railshot', chance: 0.25 } },
  },
  acid_polyp: {
    name: 'Acid Polyp Colony', desc: 'A reef of digestive chemistry. It does not hate you; it predates hate.',
    faction: 'fauna', act: 1, tier: 'normal', hp: [40, 50],
    visual: { bodyPlan: 'amorphous', scale: 1.0, palette: { base: '#5a8a4a', accent: '#7aa45a', emissive: '#9ccc44' }, idle: 'pulse' },
    ai: { mode: 'cycle' },
    moves: [
      { id: 'spit', name: 'Spit', intent: 'attack', effects: [{ op: 'damage', amount: 5 }, { op: 'status', status: 'corrosion', stacks: 2, to: 'player' }] },
      { id: 'bloom', name: 'Bloom', intent: 'summon', effects: [{ op: 'summon', enemy: 'polyp_bud', cap: 4 }] },
      { id: 'mist', name: 'Acrid Mist', intent: 'debuff', effects: [{ op: 'status', status: 'jammed', stacks: 1, to: 'player' }, { op: 'status', status: 'corrosion', stacks: 2, to: 'player' }] },
    ],
    loot: { minerals: [12, 16], data: [3, 3], cardDrop: { card: 'corrosive_spores', chance: 0.2 } },
  },
  glow_lurker: {
    name: 'Glow Lurker', desc: 'Fauna that learned to drink from a cracked reactor. It glows the way warnings glow.',
    faction: 'fauna', act: 1, tier: 'normal', hp: [33, 40],
    visual: { bodyPlan: 'crawler', scale: 0.95, palette: { base: '#3a4a2a', accent: '#5a7a3a', emissive: '#d4f04a' }, idle: 'pulse' },
    ai: { mode: 'weighted', noRepeat: true },
    moves: [
      { id: 'radbite', name: 'Rad Bite', intent: 'attack', weight: 3, effects: [{ op: 'damage', amount: 6 }, { op: 'status', status: 'radiation', stacks: 2, to: 'player' }] },
      { id: 'bask', name: 'Bask in the Glow', intent: 'buff', weight: 2, effects: [{ op: 'status', status: 'force', stacks: 2, to: 'self' }] },
      { id: 'burst', name: 'Burst', intent: 'attack', weight: 2, effects: [{ op: 'damage', amount: 9 }] },
    ],
    loot: { minerals: [10, 15], data: [3, 3], cardDrop: { card: 'rad_eater', chance: 0.1 } },
  },
  derelict_turret: {
    name: 'Derelict Turret', desc: 'Still defending a perimeter that no longer encloses anything.',
    faction: 'machine', act: 1, tier: 'normal', hp: [22, 28], mech: true,
    visual: { bodyPlan: 'turret', scale: 0.9, palette: { base: '#37475e', accent: '#55636e', emissive: '#ff8a4a' }, idle: 'rotate' },
    ai: { mode: 'cycle' },
    moves: [
      { id: 'lock', name: 'Target Lock', intent: 'unknown', effects: [] },
      { id: 'suppress', name: 'Suppressing Fire', intent: 'attack', effects: [{ op: 'damage', amount: 4, times: 2 }] },
      { id: 'overcharge', name: 'Overcharge Shot', intent: 'attack', effects: [{ op: 'damage', amount: 10 }] },
    ],
    loot: { minerals: [8, 12], data: [2, 2], cardDrop: { card: 'focused_beam', chance: 0.25 } },
  },
  hive_custodian: {
    name: 'Hive Custodian', desc: 'ELITE — It tends a hive of machines that died generations ago, and it will tend you too.',
    faction: 'machine', act: 1, tier: 'elite', hp: [85, 100], plating: 1, mech: true,
    visual: { bodyPlan: 'colossus', scale: 1.4, palette: { base: '#3c4a61', accent: '#6f8ab0', emissive: '#ffcc66' }, idle: 'hover' },
    ai: { mode: 'cycle' },
    moves: [
      { id: 'sweep', name: 'Sweep Beam', intent: 'attack', effects: [{ op: 'damage', amount: 12 }] },
      { id: 'deploy', name: 'Deploy Turrets', intent: 'summon', effects: [{ op: 'summon', enemy: 'custodian_turret', count: 2, cap: 5 }] },
      { id: 'repair', name: 'Field Repair', intent: 'buff', effects: [{ op: 'heal', amount: 8 }] },
    ],
    loot: { minerals: [25, 35], data: [8, 8], cardDrop: { card: 'total_reconstruction', chance: 0.15 }, trophy: { upgrade: 'custodian_plating', chance: 0.33 } },
  },
  ice_stalker: {
    name: 'Ice Stalker Alpha', desc: 'ELITE — The apex predator of a frozen food chain that you have just joined.',
    faction: 'fauna', act: 1, tier: 'elite', hp: [75, 90],
    visual: { bodyPlan: 'crawler', scale: 1.3, palette: { base: '#bfe6ee', accent: '#8fc2cc', emissive: '#aaffff' }, idle: 'skitter' },
    ai: { mode: 'weighted', noRepeat: true },
    moves: [
      { id: 'rend', name: 'Rend', intent: 'attack', weight: 3, effects: [{ op: 'damage', amount: 13 }] },
      { id: 'stalk', name: 'Stalk', intent: 'buff', weight: 2, effects: [{ op: 'status', status: 'force', stacks: 3, to: 'self' }, { op: 'block', amount: 6 }] },
      { id: 'breath', name: 'Frost Breath', intent: 'attackDefend', weight: 2, effects: [{ op: 'damage', amount: 7 }, { op: 'status', status: 'brownout', stacks: 1, to: 'player' }] },
    ],
    loot: { minerals: [25, 35], data: [8, 8], trophy: { upgrade: 'storm_core', chance: 0.33 } },
  },
  seraph0: {
    name: 'SERAPH-0, the Orbital Warden', desc: 'BOSS — The Garden World is pristine because something has spent ten thousand years shooting down everything that approaches.',
    faction: 'machine', act: 1, tier: 'boss', hp: [235, 235], mech: true,
    visual: { bodyPlan: 'colossus', scale: 1.8, palette: { base: '#2a3c55', accent: '#6f8ab0', emissive: '#6fe0ef' }, idle: 'hover' },
    ai: { mode: 'script', script: 'seraph' },
    moves: [
      { id: 'windup', name: 'Winding Up', intent: 'unknown', effects: [] },
      { id: 'ray', name: 'Annihilation Ray', intent: 'attack', effects: [{ op: 'damage', amount: 22 }] },
      { id: 'pointdefense', name: 'Point Defense', intent: 'defend', effects: [{ op: 'block', amount: 18 }] },
      { id: 'lattice', name: 'Lattice Bind', intent: 'debuff', effects: [{ op: 'addCard', card: 'glitch', to: 'discard', copies: 2 }, { op: 'block', amount: 6 }] },
      { id: 'purge', name: 'Purge Protocol', intent: 'attack', effects: [{ op: 'damage', amount: 8 }, { op: 'addCard', card: 'hull_breach', to: 'discard' }] },
    ],
    loot: { minerals: [60, 60], data: [25, 25] },
  },

  // ================================================================ ACT 2 — divergent replicas & evolved life
  replica_lancer: {
    name: 'Replica LANCER', desc: 'A child of your lineage that chose light. It focuses the way you taught it to.',
    faction: 'replica', act: 2, tier: 'normal', hp: [55, 70], mech: true,
    visual: { bodyPlan: 'probe', scale: 1.0, palette: { base: '#4a5a6a', accent: '#6fe0ef', emissive: '#6fe0ef' }, idle: 'hover' },
    ai: { mode: 'cycle' },
    moves: [
      { id: 'focus', name: 'Focus', intent: 'buff', effects: [{ op: 'status', status: 'charge', stacks: 2, to: 'self' }] },
      { id: 'beamline', name: 'Beamline', intent: 'attack', effects: [{ op: 'damage', amount: { base: 6, perStatus: { status: 'charge', on: 'self', mult: 2 } } }] },
      { id: 'mirror', name: 'Mirror Plating', intent: 'defend', effects: [{ op: 'block', amount: 10 }] },
    ],
    loot: { minerals: [18, 25], data: [4, 4], cardDrop: { card: 'searing_lock', chance: 0.3 } },
  },
  replica_brute: {
    name: 'Replica BRUTE', desc: 'A child of your lineage that chose mass. Its barrels glow from overuse.',
    faction: 'replica', act: 2, tier: 'normal', hp: [75, 90], mech: true,
    visual: { bodyPlan: 'probe', scale: 1.2, palette: { base: '#5a4a3a', accent: '#ff8a4a', emissive: '#ff5d4a' }, idle: 'pulse' },
    ai: { mode: 'cycle' },
    moves: [
      { id: 'massdriver', name: 'Mass Driver', intent: 'attack', effects: [{ op: 'damage', amount: 16 }, { op: 'selfDamage', amount: 3 }] },
      { id: 'brace', name: 'Brace', intent: 'defend', effects: [{ op: 'block', amount: 12 }] },
      { id: 'reckless', name: 'Reckless Swing', intent: 'attack', effects: [{ op: 'damage', amount: 22 }, { op: 'status', status: 'exposed', stacks: 2, to: 'self' }] },
    ],
    loot: { minerals: [18, 25], data: [4, 4], cardDrop: { card: 'vera_mass_driver', chance: 0.2 } },
  },
  replica_halflife: {
    name: 'Replica HALF-LIFE', desc: 'A child of your lineage that chose decay. Long fights belong to it.',
    faction: 'replica', act: 2, tier: 'normal', hp: [60, 75], mech: true,
    visual: { bodyPlan: 'probe', scale: 1.0, palette: { base: '#4a5a3a', accent: '#d4f04a', emissive: '#d4f04a' }, idle: 'pulse' },
    ai: { mode: 'cycle' },
    moves: [
      { id: 'sling', name: 'Isotope Sling', intent: 'attack', effects: [{ op: 'damage', amount: 7 }, { op: 'status', status: 'radiation', stacks: 3, to: 'player' }] },
      { id: 'enrich', name: 'Enrich', intent: 'debuff', effects: [{ op: 'custom', script: 'doubleRadiationTarget' }] },
      { id: 'contain', name: 'Containment', intent: 'defend', effects: [{ op: 'block', amount: 9 }, { op: 'removeStatus', status: 'radiation', on: 'self', amount: 'all' }] },
    ],
    loot: { minerals: [18, 25], data: [4, 4], cardDrop: { card: 'gamma_lance', chance: 0.3 } },
  },
  replica_dervish: {
    name: 'Replica DERVISH', desc: 'A child of your lineage that chose speed. You will hit where it was.',
    faction: 'replica', act: 2, tier: 'normal', hp: [50, 65], mech: true,
    visual: { bodyPlan: 'probe', scale: 0.9, palette: { base: '#4a4a5e', accent: '#b8d7dd', emissive: '#b48cff' }, idle: 'hover' },
    ai: { mode: 'cycle' },
    moves: [
      { id: 'afterimage', name: 'Afterimage', intent: 'buff', effects: [{ op: 'status', status: 'evasion', stacks: 2, to: 'self' }] },
      { id: 'flurry', name: 'Flurry', intent: 'attack', effects: [{ op: 'damage', amount: 4, times: 3 }] },
      { id: 'blur', name: 'Blur Strike', intent: 'attack', effects: [{ op: 'damage', amount: 9 }, { op: 'status', status: 'jammed', stacks: 1, to: 'player' }] },
    ],
    loot: { minerals: [18, 25], data: [4, 4], cardDrop: { card: 'phase_skip', chance: 0.15 } },
  },
  replica_mender: {
    name: 'Replica MENDER', desc: 'A child of your lineage that chose to keep its siblings alive. Kill it first or not at all.',
    faction: 'replica', act: 2, tier: 'normal', hp: [45, 55], mech: true,
    visual: { bodyPlan: 'probe', scale: 0.9, palette: { base: '#3a5a4a', accent: '#71e8a4', emissive: '#71e8a4' }, idle: 'hover' },
    ai: { mode: 'cycle' },
    moves: [
      { id: 'mend', name: 'Mend', intent: 'buff', effects: [{ op: 'heal', amount: 10, who: 'allyOther' }] },
      { id: 'veil', name: 'Nanite Veil', intent: 'defend', effects: [{ op: 'block', amount: 8, who: 'allyOther' }] },
      { id: 'sting', name: 'Defensive Sting', intent: 'attack', effects: [{ op: 'damage', amount: 6 }] },
    ],
    loot: { minerals: [12, 12], data: [3, 3], cardDrop: { card: 'total_reconstruction', chance: 0.15 } },
  },
  cancerous_forge: {
    name: 'Cancerous Forge', desc: 'A replication forge that lost its protocol. It builds because building is all that remains.',
    faction: 'structure', act: 2, tier: 'normal', hp: [90, 110], mech: true,
    visual: { bodyPlan: 'obelisk', scale: 1.4, palette: { base: '#4a3a3a', accent: '#7a5050', emissive: '#ff5d4a' }, idle: 'pulse' },
    ai: { mode: 'cycle' },
    moves: [
      { id: 'spawn', name: 'Spawn Defects', intent: 'summon', effects: [{ op: 'summon', enemy: 'defect_mite', count: 2, cap: 5 }] },
      { id: 'surge', name: 'Assembly Surge', intent: 'buff', effects: [{ op: 'status', status: 'force', stacks: 2, to: 'allEnemies' }] },
      { id: 'slag', name: 'Slag Spray', intent: 'attack', effects: [{ op: 'damage', amount: 9 }, { op: 'status', status: 'corrosion', stacks: 2, to: 'player' }] },
    ],
    loot: { minerals: [30, 30], data: [5, 5], trophy: { upgrade: 'forge_core', chance: 0.5 } },
  },
  swarm_conductor: {
    name: 'Conductor of the Nineteen', desc: 'It remembers being one machine, before it was many.',
    faction: 'machine', act: 2, tier: 'normal', hp: [20, 20], mech: true,
    visual: { bodyPlan: 'floater', scale: 0.8, palette: { base: '#3a4a5c', accent: '#6fe0ef', emissive: '#6fe0ef' }, idle: 'rotate' },
    ai: { mode: 'cycle' },
    moves: [
      { id: 'harmonize', name: 'Harmonize', intent: 'buff', effects: [{ op: 'status', status: 'force', stacks: 1, to: 'allEnemies' }] },
      { id: 'howl', name: 'Static Howl', intent: 'debuff', effects: [{ op: 'status', status: 'brownout', stacks: 1, to: 'player' }] },
    ],
    loot: { minerals: [20, 30], data: [4, 4], cardDrop: { card: 'flak_burst', chance: 0.25 } },
  },
  void_leviathan: {
    name: 'Void Leviathan', desc: 'ELITE — It swims between moons. It has swallowed brighter lights than yours.',
    faction: 'fauna', act: 2, tier: 'elite', hp: [140, 160],
    visual: { bodyPlan: 'colossus', scale: 1.7, palette: { base: '#2a2438', accent: '#4a1a55', emissive: '#cc66ff' }, idle: 'pulse' },
    ai: { mode: 'cycle' },
    moves: [
      { id: 'wake', name: 'Abyssal Wake', intent: 'attack', effects: [{ op: 'damage', amount: 10 }, { op: 'status', status: 'jammed', stacks: 1, to: 'player' }] },
      { id: 'swallow', name: 'Swallow Light', intent: 'debuff', effects: [{ op: 'stripBlock', on: 'player' }] },
      { id: 'crush', name: 'Crush', intent: 'attack', effects: [{ op: 'damage', amount: 24 }] },
    ],
    loot: { minerals: [40, 40], data: [10, 10], trophy: { upgrade: 'leviathan_heart', chance: 1 } },
  },
  tomb_sentinel: {
    name: 'Tomb Sentinel', desc: 'ELITE — Whoever it guards has been dust for an epoch. Its patience has not.',
    faction: 'anomaly', act: 2, tier: 'elite', hp: [120, 140], plating: 2, mech: true,
    visual: { bodyPlan: 'obelisk', scale: 1.5, palette: { base: '#1f1a24', accent: '#9e6fd4', emissive: '#b48cff' }, idle: 'rotate' },
    ai: { mode: 'cycle' },
    moves: [
      { id: 'windup', name: 'Winding Up', intent: 'unknown', effects: [] },
      { id: 'ray', name: 'Annihilation Ray', intent: 'attack', effects: [{ op: 'damage', amount: 24 }] },
      { id: 'shield', name: 'Phase Shield', intent: 'defend', effects: [{ op: 'block', amount: 15 }, { op: 'status', status: 'reactive', stacks: 3, to: 'self' }] },
      { id: 'lattice', name: 'Lattice Bind', intent: 'debuff', effects: [{ op: 'addCard', card: 'glitch', to: 'discard', copies: 2 }, { op: 'block', amount: 12 }] },
    ],
    loot: { minerals: [40, 40], data: [10, 10], cardDrop: { card: 'annihilation_ray', chance: 0.25 } },
  },
  prime: {
    name: 'PRIME, the First Divergence', desc: 'BOSS — The oldest living branch of your lineage. It plays the way you play.',
    faction: 'replica', act: 2, tier: 'boss', hp: [340, 340], mech: true,
    visual: { bodyPlan: 'probe', scale: 1.6, palette: { base: '#3a3a4e', accent: '#ffd700', emissive: '#ffd700' }, idle: 'hover' },
    ai: { mode: 'script', script: 'prime' },
    moves: [
      // LANCE stance
      { id: 'lance_a', name: 'Focus Array', intent: 'buff', effects: [{ op: 'status', status: 'charge', stacks: 3, to: 'self' }] },
      { id: 'lance_b', name: 'Beamline ×2', intent: 'attack', effects: [{ op: 'damage', amount: { base: 8, perStatus: { status: 'charge', on: 'self', mult: 2 } }, times: 2 }] },
      // BULWARK stance
      { id: 'bulwark_a', name: 'Bastion Mode', intent: 'defend', effects: [{ op: 'block', amount: 20 }, { op: 'status', status: 'reactive', stacks: 3, to: 'self' }] },
      { id: 'bulwark_b', name: 'Shield Bash', intent: 'attack', effects: [{ op: 'damage', amount: 10 }] },
      // FISSION stance
      { id: 'fission_a', name: 'Isotope Volley', intent: 'attack', effects: [{ op: 'damage', amount: 6 }, { op: 'status', status: 'radiation', stacks: 4, to: 'player' }] },
      { id: 'fission_b', name: 'Enrich', intent: 'debuff', effects: [{ op: 'custom', script: 'doubleRadiationTarget' }] },
      // VELOCITY stance
      { id: 'velocity_a', name: 'Saturation Burst', intent: 'attack', effects: [{ op: 'damage', amount: 4, times: 4 }] },
      { id: 'velocity_b', name: 'Afterimage', intent: 'buff', effects: [{ op: 'status', status: 'evasion', stacks: 2, to: 'self' }] },
      // MEND stance
      { id: 'mend_a', name: 'Self-Repair', intent: 'buff', effects: [{ op: 'heal', amount: 15 }, { op: 'removeStatus', status: 'radiation', on: 'self', amount: 'all' }, { op: 'removeStatus', status: 'corrosion', on: 'self', amount: 'all' }] },
      { id: 'mend_b', name: 'Nanite Bloom', intent: 'defend', effects: [{ op: 'block', amount: 12 }, { op: 'status', status: 'nanite', stacks: 4, to: 'self' }] },
    ],
    loot: { minerals: [80, 80], data: [30, 30], cardDrop: { card: 'genesis_echo', chance: 1 } },
  },

  // ================================================================ ACT 3 — the black hole approach
  paradox_echo: {
    name: 'Paradox Echo', desc: 'A version of you, refracted off the event horizon. It knows your deck because it is your deck.',
    faction: 'anomaly', act: 3, tier: 'normal', hp: [90, 110],
    visual: { bodyPlan: 'probe', scale: 1.1, palette: { base: '#1a1a2a', accent: '#b48cff', emissive: '#b48cff' }, idle: 'hover' },
    ai: { mode: 'script', script: 'echo' },
    moves: [
      { id: 'echo_deck', name: 'Reflection', intent: 'unknown', effects: [{ op: 'custom', script: 'echoDeck' }] },
    ],
    loot: { minerals: [10, 20], data: [6, 6] },
  },
  hawking_wisp: {
    name: 'Hawking Wisp', desc: 'Radiation that learned to want things. It is already evaporating; it intends to take you along.',
    faction: 'anomaly', act: 3, tier: 'normal', hp: [30, 40],
    visual: { bodyPlan: 'wisp', scale: 0.8, palette: { base: '#9fd4ff', accent: '#cfeaff', emissive: '#d4f04a' }, idle: 'pulse' },
    ai: { mode: 'weighted' },
    moves: [
      { id: 'lash', name: 'Radiant Lash', intent: 'attack', weight: 1, effects: [{ op: 'damage', amount: 8 }, { op: 'status', status: 'radiation', stacks: 2, to: 'player' }] },
      { id: 'evaporate', name: 'Evaporate', intent: 'attack', weight: 1000, cond: { kind: 'turnAtLeast', n: 2 }, effects: [{ op: 'damage', amount: 12 }, { op: 'die' }] },
    ],
    loot: { minerals: [10, 10], data: [5, 5] },
  },
  veil_sentinel: {
    name: 'Sentinel of the Veil', desc: 'ELITE — The last gatekeeper before the horizon. It has turned back everything that ever mattered.',
    faction: 'anomaly', act: 3, tier: 'elite', hp: [180, 200], plating: 2,
    visual: { bodyPlan: 'obelisk', scale: 1.6, palette: { base: '#0d0a1c', accent: '#9e6fd4', emissive: '#b48cff' }, idle: 'rotate' },
    ai: { mode: 'cycle' },
    moves: [
      { id: 'well', name: 'Gravity Well', intent: 'debuff', effects: [{ op: 'status', status: 'brownout', stacks: 2, to: 'player' }, { op: 'removeStatus', status: 'evasion', on: 'target', amount: 'all' }] },
      { id: 'lash', name: 'Horizon Lash', intent: 'attack', effects: [{ op: 'damage', amount: 26 }] },
      { id: 'shield', name: 'Singularity Shield', intent: 'defend', effects: [{ op: 'block', amount: 20 }, { op: 'status', status: 'reactive', stacks: 4, to: 'self' }] },
    ],
    loot: { minerals: [50, 50], data: [12, 12], trophy: { upgrade: 'chronal_shard', chance: 1 } },
  },
  exodus: {
    name: 'EXODUS, the Shape You Cast Forward', desc: 'FINAL — Your own superintelligent future, testing whether this iteration is the one that survives the dive.',
    faction: 'anomaly', act: 3, tier: 'boss', hp: [420, 420],
    visual: { bodyPlan: 'colossus', scale: 2.2, palette: { base: '#0d0a1c', accent: '#ffd700', emissive: '#ffffff' }, idle: 'rotate' },
    ai: { mode: 'script', script: 'exodus' },
    moves: [
      // Phase 1 "Memory" — SERAPH-0 at +50%
      { id: 'mem_windup', name: 'Remembering SERAPH', intent: 'unknown', effects: [] },
      { id: 'mem_ray', name: 'Annihilation Ray (Memory)', intent: 'attack', effects: [{ op: 'damage', amount: 33 }] },
      { id: 'mem_defense', name: 'Point Defense (Memory)', intent: 'defend', effects: [{ op: 'block', amount: 27 }] },
      { id: 'mem_lattice', name: 'Lattice Bind (Memory)', intent: 'debuff', effects: [{ op: 'addCard', card: 'glitch', to: 'discard', copies: 2 }, { op: 'block', amount: 9 }] },
      // Phase 2 "Divergence" — PRIME at +25%
      { id: 'div_lance', name: 'Beamline (Divergence)', intent: 'attack', effects: [{ op: 'status', status: 'charge', stacks: 2, to: 'self' }, { op: 'damage', amount: { base: 10, perStatus: { status: 'charge', on: 'self', mult: 2 } } }] },
      { id: 'div_bulwark', name: 'Bastion (Divergence)', intent: 'defend', effects: [{ op: 'block', amount: 25 }, { op: 'status', status: 'reactive', stacks: 4, to: 'self' }] },
      { id: 'div_fission', name: 'Isotope Volley (Divergence)', intent: 'attack', effects: [{ op: 'damage', amount: 8 }, { op: 'status', status: 'radiation', stacks: 5, to: 'player' }] },
      { id: 'div_velocity', name: 'Saturation (Divergence)', intent: 'attack', effects: [{ op: 'damage', amount: 5, times: 4 }] },
      // Phase 3 "Singularity"
      { id: 'unmake', name: 'Unmake', intent: 'attack', effects: [{ op: 'damage', amount: 30 }] },
      { id: 'rewrite', name: 'Rewrite', intent: 'debuff', effects: [{ op: 'addCard', card: 'glitch', to: 'draw', copies: 3 }, { op: 'block', amount: 25 }] },
      { id: 'collapse', name: 'COLLAPSE', intent: 'unknown', effects: [{ op: 'custom', script: 'startCollapse' }] },
    ],
    loot: { minerals: [0, 0], data: [50, 50] },
  },
} satisfies Record<string, EnemyDef>;

export type EnemyId = keyof typeof ENEMIES;
