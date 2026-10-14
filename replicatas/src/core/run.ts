// run.ts — RunState lifecycle: creation, derived stats, jumps, surface movement,
// combat config building, rewards, economy. The seam between map/content/combat.
import { makeRng, randomSeed, type Rng } from './rng';
import { BAL } from './balance';
import type { CardInstance, EffectOp } from '@/combat/combat-types';
import { makeInstance } from '@/combat/piles';
import type { MetaState } from './meta';
import { hasUnlock } from './meta';
import { genPlanet, actOfPlanet, type PlanetSpec } from '@/map/planet-gen';
import { genSurface, type SurfaceMap } from '@/map/surface-gen';
import { rollEncounter, planetScale } from '@/map/encounters';
import { candidateCount } from '@/map/scanner';
import type { CombatConfig } from '@/combat/engine';
import {
  getCard, getEnemy, getUpgrade, cardPool, UPGRADES, CARDS,
} from '@/content/registry';

export interface Backup {
  name: string;
  planetIndex: number;
  planetSlot: number;
  deck: CardInstance[];
  upgrades: string[];
  hullMax: number;
  minerals: number;
  fuel: number;
  payloads: string[];
}

export interface RewardBundle {
  cards: string[];               // combat schematic choices (pick one or skip)
  upgrades: string[];            // probe system choices (install one free, adds Burden)
  minerals: number;
  data: number;
  cardDrop: string | null;       // thematic drop (auto-added on claim)
  trophy: string | null;         // upgrade id
  fromBoss: boolean;
}

export interface RunState {
  version: 2;
  seed: string;
  regen: number;                 // bumped on wake-from-backup: regenerates the road ahead
  planetIndex: number;           // 1..25
  planetSlot: number;
  phase: 'surface' | 'galaxy' | 'dead' | 'ended';
  nodeId: string | null;
  visited: string[];
  surfaceOpts: { forceForge: boolean; forceFabricator: boolean };
  probe: { name: string; generation: number; hull: number; hullMax: number };
  deck: CardInstance[];
  upgrades: string[];
  payloads: string[];
  payloadSlots: number;
  resources: { minerals: number; fuel: number; fuelMax: number; data: number };
  backups: Backup[];
  lastForgeSnapshot: Backup | null;  // Black Box Protocol
  usedEvents: string[];
  mutations: string[];
  flags: Record<string, boolean | number | string>;
  removalsBought: number;
  planetsSinceFabricator: number;
  pendingReward: RewardBundle | null;
  nextCombatsEnergy: { count: number; bonus: number } | null;
  archiveUnlocks: string[];      // snapshot of meta.archive at run start (reward pools)
  dataGainMult: number;
  freeJumpUsed: boolean;
  rerollUsed: boolean;
  blackBoxUsed: boolean;
  stats: { kills: number; bestPlanet: number; dataEarned: number };
}

// ---------------------------------------------------------------- creation

const STARTING_DECK: string[] = [
  'pulse_laser', 'pulse_laser', 'pulse_laser', 'pulse_laser', 'pulse_laser',
  'shield_matrix', 'shield_matrix', 'shield_matrix', 'shield_matrix',
  'system_scan',
];

const CORE_SWAPS: Record<string, { remove: string[]; add: string[]; upgrade: string }> = {
  core_laser: { remove: ['pulse_laser', 'pulse_laser'], add: ['focused_beam', 'focused_beam'], upgrade: 'targeting_suite' },
  core_kinetic: { remove: ['pulse_laser', 'pulse_laser'], add: ['railshot', 'railshot'], upgrade: 'heat_pumps' },
  core_nuclear: { remove: ['pulse_laser', 'pulse_laser'], add: ['isotope_round', 'isotope_round'], upgrade: 'rad_scrubbers' },
  core_speed: { remove: ['pulse_laser', 'pulse_laser'], add: ['microthrust', 'microthrust'], upgrade: 'coprocessor' },
  core_repair: { remove: ['shield_matrix', 'shield_matrix'], add: ['nanite_cloud', 'nanite_cloud'], upgrade: 'ablative_coating' },
};

export function newRun(meta: MetaState, coreLoadout: string | null): RunState {
  const deckIds = [...STARTING_DECK];
  const upgrades: string[] = [];
  if (coreLoadout && CORE_SWAPS[coreLoadout] && hasUnlock(meta, coreLoadout)) {
    const swap = CORE_SWAPS[coreLoadout]!;
    for (const r of swap.remove) {
      const i = deckIds.indexOf(r);
      if (i >= 0) deckIds.splice(i, 1);
    }
    deckIds.push(...swap.add);
    upgrades.push(swap.upgrade);
  }
  const fuelMax = BAL.fuelCap + (hasUnlock(meta, 'deep_stockpile') ? 2 : 0);
  const run: RunState = {
    version: 2,
    seed: randomSeed(),
    regen: 0,
    planetIndex: 0,             // 0 = pre-launch; first jump goes to planet 1
    planetSlot: 0,
    phase: 'galaxy',
    nodeId: null,
    visited: [],
    surfaceOpts: { forceForge: false, forceFabricator: false },
    probe: { name: `R-${meta.generationCounter}`, generation: meta.generationCounter, hull: BAL.startHull, hullMax: BAL.startHull },
    deck: deckIds.map((id) => makeInstance(id)),
    upgrades,
    payloads: ['repair_canister'],
    payloadSlots: BAL.payloadSlots + (hasUnlock(meta, 'payload_rack') ? 1 : 0),
    resources: {
      minerals: BAL.startMinerals + (hasUnlock(meta, 'contingency_cache') ? 20 : 0),
      fuel: hasUnlock(meta, 'deep_stockpile') ? fuelMax : BAL.startFuel,
      fuelMax,
      data: 0,
    },
    backups: [],
    lastForgeSnapshot: null,
    usedEvents: [],
    mutations: [],
    flags: {},
    removalsBought: 0,
    planetsSinceFabricator: 0,
    pendingReward: null,
    nextCombatsEnergy: null,
    archiveUnlocks: [...meta.archive],
    dataGainMult: 1,
    freeJumpUsed: false,
    rerollUsed: false,
    blackBoxUsed: false,
    stats: { kills: 0, bestPlanet: 0, dataEarned: 0 },
  };
  if (hasUnlock(meta, 'orbital_relay')) run.flags['orbitalRelay'] = true;
  return run;
}

// ---------------------------------------------------------------- derived

export function runRng(run: RunState, tag: string): Rng {
  return makeRng(`${run.seed}:${tag}`);
}

export function act(run: RunState): 1 | 2 | 3 {
  return actOfPlanet(Math.max(1, run.planetIndex));
}

export function scannerLevel(run: RunState): number {
  let lv = 0;
  if (run.upgrades.includes('scanner1')) lv = 1;
  if (run.upgrades.includes('scanner2')) lv = 2;
  if (run.upgrades.includes('scanner3')) lv = 3;
  if (run.upgrades.includes('scanner4')) lv = 4;
  if (lv === 0 && run.flags['orbitalRelay']) lv = 1;
  return lv;
}

export function energyMax(run: RunState): number {
  return BAL.energyPerTurn + (run.upgrades.includes('war_core') ? 1 : 0);
}

export function totalBurden(run: RunState): number {
  return run.upgrades.reduce((sum, id) => sum + (getUpgrade(id)?.burden ?? 0), 0);
}

export function replicationCost(run: RunState): number {
  let cost = BAL.replicationBase
    + BAL.replicationPerBurden * totalBurden(run)
    + BAL.replicationPerBackup * countForgedThisRun(run);
  if (run.upgrades.includes('forge_core')) cost -= 10;
  if (run.upgrades.includes('assembly_swarm')) cost = Math.ceil(cost * 0.8);
  return Math.max(10, cost);
}

function countForgedThisRun(run: RunState): number {
  return (run.flags['backupsForged'] as number) ?? 0;
}

export function removalCost(run: RunState): number {
  return BAL.removalBase + BAL.removalStep * run.removalsBought;
}

export function dominantArchetype(run: RunState): string {
  const counts = new Map<string, number>();
  for (const inst of run.deck) {
    const a = getCard(inst.cardId).archetype;
    if (a === 'neutral' || a === 'status') continue;
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  let best = 'laser', bestN = -1;
  for (const [a, n] of counts) if (n > bestN) { best = a; bestN = n; }
  return best;
}

// ---------------------------------------------------------------- map access (pure regeneration)

export function currentPlanet(run: RunState): PlanetSpec {
  return genPlanet(run.seed, run.planetIndex, run.regen, run.planetSlot);
}

export function currentSurface(run: RunState): SurfaceMap {
  return genSurface(currentPlanet(run), {
    planetIndex: run.planetIndex,
    forceForge: run.surfaceOpts.forceForge,
    forceFabricator: run.surfaceOpts.forceFabricator,
  });
}

export function destinationCandidates(run: RunState): PlanetSpec[] {
  const next = run.planetIndex + 1;
  if (next === 10 || next === 20 || next > 20) {
    return [genPlanet(run.seed, next, run.regen, 0)];
  }
  const n = candidateCount(scannerLevel(run));
  const rerolled = (run.flags['rerollOffset'] as number) ?? 0;
  const specs: PlanetSpec[] = [];
  for (let i = 0; i < n; i++) specs.push(genPlanet(run.seed, next, run.regen, i + rerolled * 4));
  return specs;
}

export function jumpFuelCost(run: RunState, spec: PlanetSpec): number {
  if (act(run) === 3 || spec.story === 'act3') return 0;
  let cost = spec.fuelCost;
  if (run.upgrades.includes('ion_drive')) cost--;
  if (run.upgrades.includes('fusion_torch')) cost--;
  return Math.max(1, cost);
}

/** Execute a jump. Returns false if it can't be afforded. */
export function jumpTo(run: RunState, slot: number, opts?: { free?: boolean }): boolean {
  const next = run.planetIndex + 1;
  const spec = genPlanet(run.seed, next, run.regen, slot);
  const cost = opts?.free ? 0 : jumpFuelCost(run, spec);
  if (run.resources.fuel < cost) return false;
  run.resources.fuel -= cost;
  run.planetIndex = next;
  run.planetSlot = slot;
  run.stats.bestPlanet = Math.max(run.stats.bestPlanet, next);
  run.phase = 'surface';
  run.visited = [];
  run.planetsSinceFabricator++;
  run.surfaceOpts = {
    forceForge: next % 3 === 0 || next === 9 || next === 19,
    forceFabricator: run.planetsSinceFabricator >= 2,
  };
  const surface = currentSurface(run);
  run.nodeId = surface.start;
  run.visited = [surface.start];
  delete run.flags['flare'];
  delete run.flags['ventBonus'];
  delete run.flags['fabricatorDiscount'];
  // arrival income
  if (run.upgrades.includes('solar_sails')) gainFuel(run, 1);
  const def = spec.story ? null : null;
  void def;
  if (spec.type === 'volcanic') run.probe.hull = Math.max(1, run.probe.hull - 3);
  return true;
}

export function gainFuel(run: RunState, n: number): void {
  run.resources.fuel = Math.min(run.resources.fuelMax, run.resources.fuel + n);
}

export function gainData(run: RunState, n: number): void {
  const gained = Math.max(0, Math.floor(n * run.dataGainMult));
  run.resources.data += gained;
  run.stats.dataEarned += gained;
}

export function gainMinerals(run: RunState, n: number): void {
  run.resources.minerals = Math.max(0, run.resources.minerals + n);
}

// ---------------------------------------------------------------- combat integration

export function nodeSeed(run: RunState): string {
  return `${run.seed}:${run.planetIndex}:${run.regen}:${run.nodeId}`;
}

export function buildEncounter(run: RunState, kind: 'combat' | 'elite' | 'boss'): string[] {
  const rng = makeRng(nodeSeed(run) + ':enc');
  return rollEncounter(act(run), currentPlanet(run).type, kind, rng, run.planetIndex).enemies;
}

export function buildCombatConfig(run: RunState, enemies: string[]): CombatConfig {
  const rng = makeRng(nodeSeed(run) + ':combat');
  const flags: Record<string, number | boolean> = {};
  const turnStartOps: EffectOp[] = [];
  const startStatuses: Array<{ status: string; stacks: number }> = [];
  let startBlock = 0;
  let firstTurnEnergyBonus = 0;
  let firstTurnDrawBonus = 0;
  let retainCount = 0;
  let plating = 0;

  for (const id of run.upgrades) {
    switch (id) {
      case 'targeting_suite': turnStartOps.push({ op: 'status', status: 'primed', stacks: 3, to: 'self' }); break;
      case 'ablative_coating': flags['ablative'] = true; break;
      case 'point_defense_web': flags['pointDefense'] = true; break;
      case 'capacitor_bank': firstTurnEnergyBonus += 1; break;
      case 'coprocessor': firstTurnDrawBonus += 1; break;
      case 'buffer_cache': retainCount += 1; break;
      case 'heat_pumps': flags['heatPumps'] = 3; break;
      case 'rad_scrubbers': flags['radScrubbers'] = true; break;
      case 'optimized_bus': flags['optimizedBus'] = true; break;
      case 'storm_core': startBlock += 5; break;
      case 'custodian_plating': plating += 1; break;
      case 'chronal_shard': if (!run.flags['chronalUsed']) flags['chronalShard'] = true; break;
      case 'precog_lattice': flags['precog'] = true; break;
      default: break;
    }
  }
  // mutations
  const shieldStacks = run.mutations.filter((m) => m === 'mut_shields').length;
  if (shieldStacks) startBlock += 4 * Math.min(2, shieldStacks);
  // event riders
  if (run.nextCombatsEnergy && run.nextCombatsEnergy.count > 0) {
    firstTurnEnergyBonus += run.nextCombatsEnergy.bonus;
  }

  const cfg: CombatConfig = {
    enemies,
    deck: run.deck.map((c) => ({ ...c })),
    hull: run.probe.hull,
    hullMax: run.probe.hullMax,
    energyMax: energyMax(run),
    rng,
    ambient: currentPlanet(run).type === 'void' ? 'orbital' : 'surface',
    damageScale: planetScale(run.planetIndex),
    hpScale: planetScale(run.planetIndex) === 0.8 ? 0.85 : planetScale(run.planetIndex) === 1.2 ? 1.1 : 1,
    playerFlags: flags,
    startBlock,
    startStatuses,
    firstTurnEnergyBonus,
    firstTurnDrawBonus,
    retainCount,
    plating,
    turnStartOps,
  };
  return cfg;
}

/** Enemies start with 3 Radiation when the Solar Flare flag is set. */
export function applyFlareIfAny(run: RunState, state: import('@/combat/combat-types').CombatState): void {
  if (!run.flags['flare']) return;
  for (const e of state.enemies) e.statuses['radiation'] = 3;
}

export interface CombatResult {
  hull: number;
  minerals: number;
  fuel: number;
  data: number;
  autoRepair: number;
  chronalUsed: boolean;
  kills: number;
}

export function afterCombatWin(run: RunState, result: CombatResult, enemies: string[]): RewardBundle {
  // sync hull, apply auto-repair
  run.probe.hull = Math.min(run.probe.hullMax, Math.max(1, result.hull + result.autoRepair));
  if (result.chronalUsed) run.flags['chronalUsed'] = true;
  if (run.nextCombatsEnergy) {
    run.nextCombatsEnergy.count--;
    if (run.nextCombatsEnergy.count <= 0) run.nextCombatsEnergy = null;
  }
  run.stats.kills += result.kills;

  // loot from enemy defs
  const rng = makeRng(nodeSeed(run) + ':loot');
  let minerals = 0, data = 0;
  let cardDrop: string | null = null;
  let trophy: string | null = null;
  let isBoss = false;
  for (const id of enemies) {
    const def = getEnemy(id);
    minerals += rng.int(def.loot.minerals[0], def.loot.minerals[1]);
    data += rng.int(def.loot.data[0], def.loot.data[1]);
    if (def.tier === 'boss') isBoss = true;
    if (def.loot.cardDrop && !cardDrop && rng.chance(def.loot.cardDrop.chance)) cardDrop = def.loot.cardDrop.card;
    if (def.loot.trophy && !trophy && !run.upgrades.includes(def.loot.trophy.upgrade) && rng.chance(def.loot.trophy.chance)) {
      trophy = def.loot.trophy.upgrade;
    }
  }
  if (run.flags['forgeCorePity'] && enemies.includes('cancerous_forge')) {
    if (!run.upgrades.includes('forge_core')) trophy = 'forge_core';
    delete run.flags['forgeCorePity'];
  }
  const lootMult = (run.flags['combatLootMult'] as number) ?? 1;
  delete run.flags['combatLootMult'];
  if (run.upgrades.includes('salvage_rig')) minerals = Math.floor(minerals * 1.3);
  minerals = Math.floor(minerals * lootMult);
  if (run.upgrades.includes('recycler_loop')) minerals += 6;
  // combat-card-earned resources
  minerals += result.minerals;
  if (result.fuel) gainFuel(run, result.fuel);

  gainMinerals(run, minerals);
  gainData(run, data + result.data);

  // Combat schematics (cards) vs probe systems (upgrades) are separate prizes:
  // normals yield one OR the other; elites and bosses yield both.
  const tier = isBoss ? 'boss' : enemies.some((e) => getEnemy(e).tier === 'elite') ? 'elite' : 'normal';
  let cards: string[] = [];
  let upgradeOffer: string[] = [];
  if (tier === 'normal') {
    if (rng.chance(0.32)) upgradeOffer = rollUpgradeOffer(run, rng, 2);
    if (!upgradeOffer.length) cards = rollCardRewards(run, rng, tier);
  } else {
    cards = rollCardRewards(run, rng, tier);
    upgradeOffer = rollUpgradeOffer(run, rng, tier === 'boss' ? 3 : 2);
  }
  const bundle: RewardBundle = { cards, upgrades: upgradeOffer, minerals, data, cardDrop, trophy, fromBoss: isBoss };
  run.pendingReward = bundle;
  return bundle;
}

/** Probe systems winnable from combat: stocked upgrades you qualify for. */
export function rollUpgradeOffer(run: RunState, rng: Rng, count: number): string[] {
  const pool = Object.keys(UPGRADES).filter((id) => {
    const u = getUpgrade(id);
    if (u.trophy || u.cost === 0) return false;
    if (run.upgrades.includes(id)) return false;
    if (u.requires && !run.upgrades.includes(u.requires)) return false;
    if (u.act2Plus && act(run) < 2) return false;
    return true;
  });
  return rng.shuffle(pool).slice(0, count);
}

export function rollCardRewards(run: RunState, rng: Rng, tier: 'normal' | 'elite' | 'boss'): string[] {
  const meta = run.archiveUnlocks;
  const weights = BAL.rewardWeights[tier]!;
  const choices = run.upgrades.includes('weapons_hardpoint') ? 4 : BAL.rewardChoices;
  const picked: string[] = [];
  // lineage drift: archetype weight = 4 + copies in deck (neutral fixed 6)
  const archCounts = new Map<string, number>();
  for (const inst of run.deck) {
    const a = getCard(inst.cardId).archetype;
    archCounts.set(a, (archCounts.get(a) ?? 0) + 1);
  }
  const archWeight = (a: string): number =>
    a === 'neutral' ? BAL.neutralWeight : BAL.archetypeBaseWeight + (archCounts.get(a) ?? 0);

  for (let i = 0; i < choices && i < 12; i++) {
    const rarity = tier === 'boss'
      ? 'rare' as const
      : rng.weighted([['common', weights[0]!], ['uncommon', weights[1]!], ['rare', weights[2]!]] as const) as 'common' | 'uncommon' | 'rare';
    const archetypes = ['laser', 'kinetic', 'nuclear', 'speed', 'repair', 'neutral'] as const;
    const arch = rng.weighted(archetypes.map((a) => [a, archWeight(a)] as const));
    let pool = cardPool({ rarity, archetype: arch, unlockedMeta: meta }).filter((c) => !picked.includes(c));
    if (!pool.length) pool = cardPool({ rarity, unlockedMeta: meta }).filter((c) => !picked.includes(c));
    if (!pool.length) pool = cardPool({ unlockedMeta: meta }).filter((c) => !picked.includes(c));
    if (pool.length) picked.push(rng.pick(pool));
  }
  return picked;
}

// ---------------------------------------------------------------- deck ops

export function addCardToDeck(run: RunState, cardId: string): void {
  getCard(cardId);
  run.deck.push(makeInstance(cardId));
}

export function removeCardFromDeck(run: RunState, uid: string): void {
  const i = run.deck.findIndex((c) => c.uid === uid);
  if (i >= 0) run.deck.splice(i, 1);
}

export function refitCard(run: RunState, uid: string): boolean {
  const inst = run.deck.find((c) => c.uid === uid);
  if (!inst || inst.refitted) return false;
  if (!getCard(inst.cardId).refit) return false;
  inst.refitted = true;
  return true;
}

export function upgradeList(): typeof UPGRADES { return UPGRADES; }
export function cardList(): typeof CARDS { return CARDS; }
