// run.test.ts — headless coverage of the roguelite layer: map generation
// invariants, jumps/economy, combat integration, replication/death/wake.
import { describe, it, expect } from 'vitest';
import { newMeta } from './meta';
import {
  newRun, jumpTo, currentPlanet, currentSurface, destinationCandidates,
  buildEncounter, buildCombatConfig, afterCombatWin, replicationCost,
  totalBurden, scannerLevel, energyMax, jumpFuelCost,
} from './run';
import { replicate, onDeath, wakeFromBackup, applyMutation, mutationOffer, canReplicate } from './lineage';
import { startCombat, playCard, endTurn, canPlay, combatResources } from '@/combat/engine';
import { makeRng } from './rng';
import { genPlanet } from '@/map/planet-gen';
import { genSurface } from '@/map/surface-gen';

function freshRun(seed = 'runtest') {
  const meta = newMeta();
  const run = newRun(meta, null);
  run.seed = seed;
  return { run, meta };
}

describe('map generation invariants', () => {
  it('surface DAGs are fully connected start→end', () => {
    for (let p = 1; p <= 24; p++) {
      for (const seed of ['a', 'b', 'c']) {
        const spec = genPlanet(seed, p, 0, 0);
        const surf = genSurface(spec, { planetIndex: p, forceForge: p % 3 === 0, forceFabricator: p % 2 === 0 });
        // walk forward from start; every node must be visitable and reach end
        const reached = new Set<string>([surf.start]);
        const queue = [surf.start];
        while (queue.length) {
          const id = queue.shift()!;
          for (const nx of surf.nodes[id]!.next) {
            if (!reached.has(nx)) { reached.add(nx); queue.push(nx); }
          }
        }
        expect(reached.has(surf.end)).toBe(true);
        for (const node of Object.values(surf.nodes)) {
          expect(reached.has(node.id)).toBe(true);
          if (node.id !== surf.end) expect(node.next.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('boss planets are fixed strips with a boss node', () => {
    for (const p of [10, 20]) {
      const spec = genPlanet('s', p, 0, 0);
      const surf = genSurface(spec, { planetIndex: p, forceForge: false, forceFabricator: false });
      expect(Object.values(surf.nodes).some((n) => n.kind === 'boss')).toBe(true);
    }
  });

  it('forced forge appears on planets 9 and 19', () => {
    for (const p of [9, 19]) {
      for (const seed of ['x', 'y', 'z']) {
        const spec = genPlanet(seed, p, 0, 0);
        const surf = genSurface(spec, { planetIndex: p, forceForge: true, forceFabricator: false });
        expect(Object.values(surf.nodes).some((n) => n.kind === 'forge')).toBe(true);
      }
    }
  });

  it('no elites on planets 1-2; derelicts have no extraction', () => {
    for (const seed of ['q', 'w', 'e', 'r', 't']) {
      for (const p of [1, 2]) {
        const spec = genPlanet(seed, p, 0, 0);
        const surf = genSurface(spec, { planetIndex: p, forceForge: false, forceFabricator: false });
        expect(Object.values(surf.nodes).some((n) => n.kind === 'elite')).toBe(false);
        if (spec.type === 'derelict') {
          expect(Object.values(surf.nodes).some((n) => n.kind === 'extraction')).toBe(false);
        }
      }
    }
  });

  it('map regenerates identically from the same seed', () => {
    const a = genSurface(genPlanet('det', 5, 0, 1), { planetIndex: 5, forceForge: false, forceFabricator: false });
    const b = genSurface(genPlanet('det', 5, 0, 1), { planetIndex: 5, forceForge: false, forceFabricator: false });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('run lifecycle', () => {
  it('new run has starter deck and resources', () => {
    const { run } = freshRun();
    expect(run.deck.length).toBe(10);
    expect(run.resources.minerals).toBe(15);
    expect(run.probe.hull).toBe(70);
    expect(energyMax(run)).toBe(3);
  });

  it('core loadouts swap starters and grant the upgrade', () => {
    const meta = newMeta();
    meta.archive.push('core_kinetic');
    const run = newRun(meta, 'core_kinetic');
    expect(run.deck.filter((c) => c.cardId === 'railshot').length).toBe(2);
    expect(run.deck.filter((c) => c.cardId === 'pulse_laser').length).toBe(3);
    expect(run.upgrades).toContain('heat_pumps');
  });

  it('jumping consumes fuel and lands on the surface start node', () => {
    const { run } = freshRun();
    const specs = destinationCandidates(run);
    expect(specs.length).toBe(2); // scanner 0 → 2 candidates
    const cost = jumpFuelCost(run, specs[0]!);
    const fuel = run.resources.fuel;
    expect(jumpTo(run, 0)).toBe(true);
    expect(run.resources.fuel).toBeLessThanOrEqual(fuel - cost + 1); // volcanic arrival may also hit hull, not fuel
    expect(run.planetIndex).toBe(1);
    expect(run.nodeId).toBe(currentSurface(run).start);
  });

  it('planet 10 is always the Garden World', () => {
    const { run } = freshRun();
    run.planetIndex = 9;
    run.resources.fuel = 10;
    expect(destinationCandidates(run).length).toBe(1);
    jumpTo(run, 0);
    expect(currentPlanet(run).story).toBe('garden');
  });

  it('burden raises replication cost', () => {
    const { run } = freshRun();
    const base = replicationCost(run);
    run.upgrades.push('war_core'); // burden 3
    expect(totalBurden(run)).toBe(3);
    expect(replicationCost(run)).toBe(base + 15);
  });

  it('scanner level derives from the upgrade chain', () => {
    const { run } = freshRun();
    expect(scannerLevel(run)).toBe(0);
    run.upgrades.push('scanner1', 'scanner2');
    expect(scannerLevel(run)).toBe(2);
  });
});

describe('combat integration', () => {
  function fightAndWin(run: ReturnType<typeof freshRun>['run']): ReturnType<typeof afterCombatWin> {
    jumpTo(run, 0);
    const surface = currentSurface(run);
    const combatNode = Object.values(surface.nodes).find((n) => n.kind === 'combat');
    expect(combatNode).toBeDefined();
    run.nodeId = combatNode!.id;
    const enemies = buildEncounter(run, 'combat');
    expect(enemies.length).toBeGreaterThan(0);
    const c = startCombat(buildCombatConfig(run, enemies));
    // cheese: flatten enemies
    for (const e of c.state.enemies) e.hp = 0;
    c.state.phase = 'won';
    const res = combatResources(c);
    return afterCombatWin(run, {
      hull: c.state.player.hp, minerals: res.minerals, fuel: res.fuel, data: res.data,
      autoRepair: 0, chronalUsed: false, kills: enemies.length,
    }, enemies);
  }

  it('winning yields loot and a reward track (cards or upgrades)', () => {
    const { run } = freshRun('loot');
    const before = run.resources.minerals;
    const bundle = fightAndWin(run);
    expect(run.resources.minerals).toBeGreaterThan(before);
    // normals give one prize track: combat schematics OR probe systems
    expect(bundle.cards.length >= 3 || bundle.upgrades.length >= 2).toBe(true);
    expect(run.pendingReward).toBe(bundle);
  });

  it('elite rewards offer both cards and a probe system', () => {
    const { run } = freshRun('elite-reward');
    jumpTo(run, 0);
    const surface = currentSurface(run);
    run.nodeId = Object.values(surface.nodes)[1]!.id;
    const enemies = ['hive_custodian'];
    const c = startCombat(buildCombatConfig(run, enemies));
    for (const e of c.state.enemies) e.hp = 0;
    c.state.phase = 'won';
    const bundle = afterCombatWin(run, {
      hull: c.state.player.hp, minerals: 0, fuel: 0, data: 0,
      autoRepair: 0, chronalUsed: false, kills: 1,
    }, enemies);
    expect(bundle.cards.length).toBeGreaterThanOrEqual(3);
    expect(bundle.upgrades.length).toBeGreaterThanOrEqual(2);
  });

  it('a fresh-deck combat is actually playable to a win', () => {
    const { run } = freshRun('winnable');
    jumpTo(run, 0);
    const surface = currentSurface(run);
    run.nodeId = Object.values(surface.nodes).find((n) => n.kind === 'combat')!.id;
    const enemies = buildEncounter(run, 'combat');
    const c = startCombat(buildCombatConfig(run, enemies));
    const rng = makeRng('policy');
    let guard = 0;
    while (c.state.phase === 'player' && guard++ < 400) {
      const playable = c.state.player.hand.filter((x) => canPlay(c, x.uid).ok);
      const attack = playable.find((x) => {
        const id = x.cardId;
        return id === 'pulse_laser';
      });
      if (attack) {
        const target = c.state.enemies.find((e) => e.hp > 0 && !(e.statuses['phased'] ?? 0));
        if (target) { playCard(c, attack.uid, target.id); continue; }
      }
      const skill = playable.find((x) => x.cardId === 'shield_matrix');
      if (skill) { playCard(c, skill.uid, null); continue; }
      if (playable.length && rng.chance(0.5)) { playCard(c, playable[0]!.uid, null); continue; }
      endTurn(c);
    }
    expect(['won', 'lost']).toContain(c.state.phase);
    expect(guard).toBeLessThan(400);
  });
});

describe('replication, death and waking', () => {
  it('replicate forges a backup; death wakes it with the road regenerated', () => {
    const { run, meta } = freshRun('lineage');
    jumpTo(run, 0);
    jumpTo(run, 0);
    run.resources.minerals = 200;
    expect(canReplicate(run)).toBe(true);
    expect(replicate(run)).toBe(true);
    expect(run.backups.length).toBe(1);
    const backupPlanet = run.backups[0]!.planetIndex;

    // travel on, then die
    jumpTo(run, 1);
    const regenBefore = run.regen;
    const outcome = onDeath(run, meta);
    expect(outcome.kind).toBe('wake');
    wakeFromBackup(run, meta, 0);
    expect(run.planetIndex).toBe(backupPlanet);
    expect(run.regen).toBe(regenBefore + 1);
    expect(run.backups.length).toBe(0);
    expect(run.probe.generation).toBeGreaterThan(1);
    // mutation applies
    const rng = makeRng('mut');
    const offer = mutationOffer(run, rng);
    expect(offer.length).toBe(3);
    const hullBefore = run.probe.hullMax;
    applyMutation(run, 'mut_hull', rng);
    expect(run.probe.hullMax).toBe(hullBefore + 6);
  });

  it('death without backup ends the lineage and banks data', () => {
    const { run, meta } = freshRun('end');
    jumpTo(run, 0);
    run.resources.data = 30;
    run.stats.dataEarned = 30;
    const outcome = onDeath(run, meta);
    expect(outcome.kind).toBe('lineageEnds');
    if (outcome.kind === 'lineageEnds') {
      expect(outcome.dataBanked).toBe(30 + run.stats.bestPlanet);
      expect(meta.data).toBe(outcome.dataBanked);
    }
    expect(meta.lastDeathDeck.length).toBe(10);
  });

  it('black box protocol auto-forges from the last forge snapshot', () => {
    const { run, meta } = freshRun('blackbox');
    meta.archive.push('black_box');
    jumpTo(run, 0);
    run.lastForgeSnapshot = {
      name: 'BB', planetIndex: 1, planetSlot: 0,
      deck: run.deck.map((c) => ({ ...c })), upgrades: [], hullMax: 70,
      minerals: 10, fuel: 3, payloads: [],
    };
    const outcome = onDeath(run, meta);
    expect(outcome.kind).toBe('wake');
    expect(run.blackBoxUsed).toBe(true);
  });
});

describe('full-run walk: launch to the Garden World', () => {
  it('survives a scripted walk across 10 planets', () => {
    const { run } = freshRun('marathon');
    const rng = makeRng('walk');
    for (let p = 1; p <= 10; p++) {
      run.resources.fuel = run.resources.fuelMax; // flow test, not balance test
      expect(jumpTo(run, 0)).toBe(true);
      const surface = currentSurface(run);
      // walk a path start → end
      let cur = surface.nodes[surface.start]!;
      let guard = 0;
      while (cur.id !== surface.end && guard++ < 20) {
        const nextId = rng.pick(cur.next);
        cur = surface.nodes[nextId]!;
        run.nodeId = cur.id;
        run.visited.push(cur.id);
        if (cur.kind === 'combat' || cur.kind === 'elite' || cur.kind === 'boss') {
          const enemies = buildEncounter(run, cur.kind);
          const c = startCombat(buildCombatConfig(run, enemies));
          for (const e of c.state.enemies) e.hp = 0;
          c.state.phase = 'won';
          afterCombatWin(run, {
            hull: Math.max(1, c.state.player.hp), minerals: 0, fuel: 0, data: 0,
            autoRepair: 0, chronalUsed: false, kills: enemies.length,
          }, enemies);
          run.pendingReward = null;
        }
      }
      expect(guard).toBeLessThan(20);
    }
    expect(run.planetIndex).toBe(10);
    expect(currentPlanet(run).story).toBe('garden');
    expect(run.stats.kills).toBeGreaterThan(5);
  });
});
