// balance.ts — every tuning constant in one place, so balancing is one diff.

export const BAL = {
  // player
  startHull: 70,
  energyPerTurn: 3,
  drawPerTurn: 5,
  maxHand: 10,
  payloadSlots: 2,
  startMinerals: 15,
  startFuel: 6,
  fuelCap: 10,

  // combat
  enrageTurn: 10,        // from this round all enemy damage +50%
  enrageMult: 1.5,
  chargeCap: 15,
  reactiveArmorCap: 12,
  naniteCap: 10,
  exposedMult: 1.5,
  jammedMult: 0.75,

  // map / acts
  planetsPerAct: 10,     // planet 10 / 20 are fixed story worlds
  act3Nodes: 5,
  surfaceNodes: { moon: 3, standard: 5, rich: 6 },
  nodeMix: { combat: 50, event: 18, extraction: 12, fabricator: 8, forge: 7, elite: 5 },
  jumpFuelMin: 2,
  jumpFuelMax: 4,

  // act scaling multipliers applied to enemy hp / damage
  actHp: { 1: 1.0, 2: 1.0, 3: 1.0 } as Record<number, number>, // rosters carry their own act scaling
  earlyPlanetMult: 0.8,  // first third of an act
  latePlanetMult: 1.2,   // final third

  // economy
  cardCost: { common: 35, uncommon: 55, rare: 90 } as Record<string, number>,
  removalBase: 15,
  removalStep: 5,
  fuelConvertMinerals: 12,
  fuelConvertAmount: 2,

  // rewards: rarity weights [common, uncommon, rare]
  rewardWeights: { normal: [62, 30, 8], elite: [35, 50, 15], boss: [0, 0, 1] } as Record<string, number[]>,
  rewardChoices: 3,
  archetypeBaseWeight: 4,
  neutralWeight: 6,

  // replication
  replicationBase: 30,
  replicationPerBurden: 5,
  replicationPerBackup: 10,
  backupResourceFrac: 0.5,
  forgeRepairFrac: 0.3,

  // meta
  dataPerPlanetBonus: 1,
};
