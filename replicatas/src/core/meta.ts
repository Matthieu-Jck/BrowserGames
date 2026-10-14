// meta.ts — permanent progression: banked Data, the Archive, deeds, stats.

export interface MetaState {
  version: 2;
  data: number;                  // banked Archive currency
  archive: string[];             // ArchiveId[]
  deeds: string[];               // 'boss:seraph0', 'kill:<enemyId>', 'ending:ouroboros'
  generationCounter: number;     // total probes ever — names the next lineage
  stats: { runs: number; wins: number; bestAct: number; bestPlanet: number; kills: number; deaths: number };
  endingsSeen: string[];
  lastDeathDeck: string[];       // card ids from the most recent lineage-ending death
}

export function newMeta(): MetaState {
  return {
    version: 2, data: 0, archive: [], deeds: [],
    generationCounter: 1,
    stats: { runs: 0, wins: 0, bestAct: 0, bestPlanet: 0, kills: 0, deaths: 0 },
    endingsSeen: [], lastDeathDeck: [],
  };
}

export function hasUnlock(meta: MetaState, id: string): boolean {
  return meta.archive.includes(id);
}

export function hasDeed(meta: MetaState, id: string): boolean {
  return meta.deeds.includes(id);
}

export function addDeed(meta: MetaState, id: string): void {
  if (!meta.deeds.includes(id)) meta.deeds.push(id);
}

export function act2Unlocked(meta: MetaState): boolean {
  return hasDeed(meta, 'boss:seraph0');
}

export function act3Unlocked(meta: MetaState): boolean {
  return hasDeed(meta, 'boss:prime');
}
