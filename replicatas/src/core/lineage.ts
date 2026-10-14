// lineage.ts — the signature mechanic: replication forges, backups, death,
// wake-as-replica with mutations, and lineage-ending runs that bank Data.
import { makeRng, type Rng } from './rng';
import { BAL } from './balance';
import type { RunState, Backup } from './run';
import {
  replicationCost, dominantArchetype, currentSurface, addCardToDeck,
} from './run';
import type { MetaState } from './meta';
import { addDeed } from './meta';
import { MUTATIONS, randomCardOfArchetype, PAYLOADS } from '@/content/registry';
import type { Archetype } from '@/combat/combat-types';

// ---------------------------------------------------------------- forging

export function canReplicate(run: RunState): boolean {
  return run.resources.minerals >= replicationCost(run);
}

export function makeBackupSnapshot(run: RunState, frac: number): Backup {
  const keepPayloads = run.upgrades.includes('perfect_copy');
  return {
    name: `${run.probe.name}.${((run.flags['backupsForged'] as number) ?? 0) + 1}`,
    planetIndex: run.planetIndex,
    planetSlot: run.planetSlot,
    deck: run.deck.map((c) => ({ ...c })),
    upgrades: [...run.upgrades],
    hullMax: run.probe.hullMax + (run.upgrades.includes('hardened_genome') ? 10 : 0),
    minerals: Math.floor(run.resources.minerals * frac),
    fuel: Math.floor(run.resources.fuel * frac),
    payloads: keepPayloads ? [...run.payloads] : ['repair_canister'],
  };
}

export function replicate(run: RunState): boolean {
  const cost = replicationCost(run);
  if (run.resources.minerals < cost) return false;
  run.resources.minerals -= cost;
  run.flags['backupsForged'] = ((run.flags['backupsForged'] as number) ?? 0) + 1;
  let frac = BAL.backupResourceFrac;
  if (run.upgrades.includes('lineage_archive')) frac = 0.75;
  if (run.upgrades.includes('perfect_copy')) frac = 1;
  const backup = makeBackupSnapshot(run, frac);
  const maxBackups = run.upgrades.includes('distributed_lineage') ? 2 : 1;
  run.backups.push(backup);
  while (run.backups.length > maxBackups) run.backups.shift();
  return true;
}

/** Visiting any forge silently snapshots for Black Box Protocol. */
export function noteForgeVisit(run: RunState, hasBlackBox: boolean): void {
  if (hasBlackBox) run.lastForgeSnapshot = makeBackupSnapshot(run, BAL.backupResourceFrac);
}

// ---------------------------------------------------------------- death

export type DeathOutcome =
  | { kind: 'wake'; backups: Backup[] }
  | { kind: 'lineageEnds'; dataBanked: number };

export function onDeath(run: RunState, meta: MetaState): DeathOutcome {
  meta.stats.deaths++;
  if (run.backups.length === 0 && !run.blackBoxUsed && meta.archive.includes('black_box') && run.lastForgeSnapshot) {
    run.blackBoxUsed = true;
    run.backups.push(run.lastForgeSnapshot);
    run.lastForgeSnapshot = null;
  }
  if (run.backups.length > 0) {
    return { kind: 'wake', backups: run.backups };
  }
  // THE LINEAGE ENDS
  const banked = run.resources.data + run.stats.bestPlanet * BAL.dataPerPlanetBonus;
  meta.data += banked;
  meta.stats.runs++;
  meta.stats.bestPlanet = Math.max(meta.stats.bestPlanet, run.stats.bestPlanet);
  meta.stats.bestAct = Math.max(meta.stats.bestAct, run.planetIndex > 20 ? 3 : run.planetIndex > 10 ? 2 : 1);
  meta.stats.kills += run.stats.kills;
  meta.generationCounter++;
  meta.lastDeathDeck = run.deck.map((c) => c.cardId);
  run.phase = 'ended';
  return { kind: 'lineageEnds', dataBanked: banked };
}

// ---------------------------------------------------------------- waking

export function mutationOffer(run: RunState, rng: Rng): string[] {
  const pool = (Object.keys(MUTATIONS) as Array<keyof typeof MUTATIONS>).filter((id) => {
    if (id === 'mut_payload' && run.flags['mutPayloadUsed']) return false;
    if (id === 'mut_shields' && run.mutations.filter((m) => m === 'mut_shields').length >= 2) return false;
    return true;
  });
  return rng.shuffle(pool).slice(0, 3);
}

export function wakeFromBackup(run: RunState, meta: MetaState, backupIndex: number): void {
  const backup = run.backups[backupIndex];
  if (!backup) throw new Error('no such backup');
  run.backups.splice(backupIndex, 1);
  meta.generationCounter++;

  run.probe = {
    name: `R-${meta.generationCounter}`,
    generation: meta.generationCounter,
    hull: backup.hullMax,
    hullMax: backup.hullMax,
  };
  run.deck = backup.deck.map((c) => ({ ...c }));
  run.upgrades = [...backup.upgrades];
  run.payloads = [...backup.payloads];
  run.resources.minerals = backup.minerals;
  run.resources.fuel = Math.min(run.resources.fuelMax, backup.fuel);
  run.planetIndex = backup.planetIndex;
  run.planetSlot = backup.planetSlot;
  run.regen++;                   // everything ahead regenerates
  run.phase = 'surface';
  run.pendingReward = null;
  run.nextCombatsEnergy = null;
  delete run.flags['flare'];
  const surface = currentSurface(run);
  run.nodeId = surface.start;
  run.visited = [surface.start];
}

export function applyMutation(run: RunState, mutationId: string, rng: Rng): string {
  run.mutations.push(mutationId);
  switch (mutationId) {
    case 'mut_hull':
      run.probe.hullMax += 6; run.probe.hull += 6;
      return '+6 max Hull.';
    case 'mut_refit': {
      const candidates = run.deck.filter((c) => !c.refitted);
      const picks = rng.shuffle(candidates).slice(0, 2);
      for (const c of picks) c.refitted = true;
      return `Refitted ${picks.length} card${picks.length === 1 ? '' : 's'}.`;
    }
    case 'mut_minerals':
      run.resources.minerals += 20;
      return '+20 Minerals.';
    case 'mut_purge':
      run.flags['pendingFreeRemovals'] = ((run.flags['pendingFreeRemovals'] as number) ?? 0) + 2;
      return 'Remove up to 2 cards at the deck screen.';
    case 'mut_fuel':
      run.resources.fuelMax += 2;
      run.resources.fuel = run.resources.fuelMax;
      return '+2 Fuel capacity, tank refilled.';
    case 'mut_card': {
      const arch = dominantArchetype(run) as Archetype;
      const card = randomCardOfArchetype(arch, rng);
      if (card) { addCardToDeck(run, card); return `Gained ${card}.`; }
      return 'No technique found.';
    }
    case 'mut_payload': {
      run.flags['mutPayloadUsed'] = true;
      run.payloadSlots++;
      const ids = Object.keys(PAYLOADS);
      if (run.payloads.length < run.payloadSlots) run.payloads.push(rng.pick(ids));
      return '+1 Payload slot and a payload.';
    }
    case 'mut_shields':
      return 'Start combats with +4 Shields.';
    default:
      return '';
  }
}

export function mutationsToOffer(run: RunState): number {
  return run.upgrades.includes('perfect_copy') ? 2 : 1;
}

// ---------------------------------------------------------------- run-end bookkeeping (win paths)

export function bankRunData(run: RunState, meta: MetaState): number {
  const banked = run.resources.data + run.stats.bestPlanet * BAL.dataPerPlanetBonus;
  meta.data += banked;
  meta.stats.runs++;
  meta.stats.kills += run.stats.kills;
  meta.stats.bestPlanet = Math.max(meta.stats.bestPlanet, run.stats.bestPlanet);
  run.resources.data = 0;
  return banked;
}

export function recordBossKill(meta: MetaState, enemyId: string): void {
  addDeed(meta, `boss:${enemyId}`);
}

export function deathRng(run: RunState): Rng {
  return makeRng(`${run.seed}:death:${run.regen}:${run.stats.kills}`);
}
