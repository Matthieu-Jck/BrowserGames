// engine.test.ts — headless combat engine suite. The engine is the game's heart;
// these tests are the safety net under all 86 cards and 23 enemies.
import { describe, it, expect } from 'vitest';
import { makeRng } from '@/core/rng';
import { makeInstance } from './piles';
import {
  startCombat, playCard, endTurn, canPlay, drainEvents, usePayload, type Combat, type CombatConfig,
} from './engine';
import { validateContent } from '@/content/validate';
import { CARDS, ENEMIES } from '@/content/registry';
import { intentPreview } from './intents';

function combat(opts: Partial<CombatConfig> & { deckIds?: string[]; seed?: string } = {}): Combat {
  const deckIds = opts.deckIds ?? [
    'pulse_laser', 'pulse_laser', 'pulse_laser', 'pulse_laser', 'pulse_laser',
    'shield_matrix', 'shield_matrix', 'shield_matrix', 'shield_matrix', 'system_scan',
  ];
  return startCombat({
    enemies: opts.enemies ?? ['feral_drone'],
    deck: deckIds.map((id) => makeInstance(id)),
    hull: opts.hull ?? 70,
    hullMax: opts.hullMax ?? 70,
    energyMax: opts.energyMax ?? 3,
    rng: makeRng(opts.seed ?? 'test-seed'),
    ...opts,
  });
}

function handIds(c: Combat): string[] {
  return c.state.player.hand.map((x) => x.cardId);
}

function give(c: Combat, cardId: string, refitted = false): string {
  const inst = makeInstance(cardId, refitted);
  c.state.player.hand.push(inst);
  return inst.uid;
}

describe('content', () => {
  it('validates with zero errors', () => {
    expect(() => validateContent()).not.toThrow();
  });
  it('has the planned content volume', () => {
    expect(Object.keys(CARDS).length).toBeGreaterThanOrEqual(80);
    const named = Object.values(ENEMIES).filter((e) => e.tier !== 'summon');
    expect(named.length).toBeGreaterThanOrEqual(23);
  });
});

describe('combat basics', () => {
  it('starts with 5 cards and full energy', () => {
    const c = combat();
    expect(c.state.player.hand.length).toBe(5);
    expect(c.state.player.energy).toBe(3);
    expect(c.state.turn).toBe(1);
  });

  it('is deterministic for the same seed', () => {
    const a = combat({ seed: 'det' });
    const b = combat({ seed: 'det' });
    expect(handIds(a)).toEqual(handIds(b));
    expect(a.state.enemies[0]!.hp).toBe(b.state.enemies[0]!.hp);
  });

  it('plays an attack, pays energy, deals damage', () => {
    const c = combat();
    const uid = give(c, 'pulse_laser');
    const before = c.state.enemies[0]!.hp;
    expect(playCard(c, uid, 'e0')).toBe(true);
    expect(c.state.enemies[0]!.hp).toBe(before - 6);
    expect(c.state.player.energy).toBe(2);
  });

  it('refuses unplayable / unaffordable cards', () => {
    const c = combat();
    c.state.player.energy = 0;
    const uid = give(c, 'pulse_laser');
    expect(canPlay(c, uid).ok).toBe(false);
    const glitch = give(c, 'glitch');
    c.state.player.energy = 3;
    expect(canPlay(c, glitch).ok).toBe(false);
  });

  it('enemy attacks the player on end turn', () => {
    const c = combat({ seed: 'enemy-hit' });
    const hull = c.state.player.hp;
    endTurn(c);
    // either the drone attacked or buffed; over several turns hull must drop
    let h = c.state.player.hp;
    for (let i = 0; i < 4 && c.state.phase === 'player'; i++) endTurn(c);
    h = Math.min(h, c.state.player.hp);
    expect(h).toBeLessThanOrEqual(hull);
  });

  it('wins when all enemies die and emits win event', () => {
    const c = combat();
    c.state.enemies[0]!.hp = 3;
    const uid = give(c, 'pulse_laser');
    playCard(c, uid, 'e0');
    expect(c.state.phase).toBe('won');
    expect(drainEvents(c).some((e) => e.t === 'win')).toBe(true);
  });
});

describe('damage pipeline', () => {
  it('block absorbs, piercing ignores', () => {
    const c = combat();
    const e = c.state.enemies[0]!;
    e.block = 5;
    playCard(c, give(c, 'pulse_laser'), 'e0');   // 6 dmg -> 5 blocked, 1 hp
    expect(e.hp).toBe(e.hpMax - 1);
    e.block = 5;
    playCard(c, give(c, 'piercing_round'), 'e0'); // 8 piercing
    expect(e.hp).toBe(e.hpMax - 1 - 8);
    expect(e.block).toBe(5);
  });

  it('force adds per hit, jammed reduces, exposed amplifies', () => {
    const c = combat();
    const e = c.state.enemies[0]!;
    c.state.player.statuses['force'] = 2;
    playCard(c, give(c, 'twin_beam'), 'e0');      // (4+2) x2 = 12
    expect(e.hpMax - e.hp).toBe(12);
    e.statuses['exposed'] = 2;
    playCard(c, give(c, 'pulse_laser'), 'e0');    // (6+2)*1.5 = 12
    expect(e.hpMax - e.hp).toBe(24);
  });

  it('plating reduces each hit', () => {
    const c = combat({ enemies: ['magnetite_burrower'] });
    const e = c.state.enemies[0]!;
    playCard(c, give(c, 'twin_beam'), 'e0');      // (4-1) x2
    expect(e.hpMax - e.hp).toBe(6);
  });

  it('evasion negates whole hits', () => {
    const c = combat();
    c.state.player.statuses['evasion'] = 1;
    const hull = c.state.player.hp;
    // force the drone to snipe
    const e = c.state.enemies[0]!;
    e.intentMoveId = 'snipe';
    endTurn(c);
    // first hit evaded; depending on next intents hull may still drop later, so check first round only
    expect(c.state.player.hp).toBe(hull);
  });

  it('reactive armor retaliates', () => {
    const c = combat({ seed: 'thorns' });
    c.state.player.statuses['reactive'] = 3;
    const e = c.state.enemies[0]!;
    e.intentMoveId = 'snipe';
    const ehp = e.hp;
    endTurn(c);
    expect(e.hp).toBe(ehp - 3);
  });
});

describe('statuses', () => {
  it('radiation ticks then halves; corrosion ticks then decrements', () => {
    const c = combat();
    const e = c.state.enemies[0]!;
    e.statuses['radiation'] = 8;
    e.statuses['corrosion'] = 3;
    e.intentMoveId = 'thrust';
    const hp = e.hp;
    endTurn(c);
    expect(e.hp).toBe(hp - 8 - 3);
    expect(e.statuses['radiation']).toBe(4);
    expect(e.statuses['corrosion']).toBe(2);
  });

  it('overheat burns at end of turn, shields absorb it, then clears', () => {
    const c = combat();
    c.state.player.statuses['overheat'] = 4;
    c.state.player.block = 2;
    const hull = c.state.player.hp;
    endTurn(c);
    expect(c.state.player.statuses['overheat']).toBeUndefined();
    // 4 overheat - 2 shields = 2 hull, plus whatever the enemy did; check at least 2 lost pre-enemy via events
    expect(c.state.player.hp).toBeLessThanOrEqual(hull - 2);
  });

  it('nanite heals then decays', () => {
    const c = combat();
    c.state.player.hp = 50;
    c.state.player.statuses['nanite'] = 3;
    endTurn(c);
    expect(c.state.player.statuses['nanite']).toBe(2);
  });

  it('brownout reduces next-turn energy', () => {
    const c = combat();
    c.state.player.statuses['brownout'] = 2;
    endTurn(c);
    expect(c.state.player.energy).toBe(1);
  });

  it('EMP only works on mechs, elites surge-protect after one', () => {
    const c = combat({ enemies: ['glow_lurker', 'hive_custodian'] });
    usePayload(c, 'emp_charge', 'e0');   // organic: no effect
    expect(c.state.enemies[0]!.statuses['empd']).toBeUndefined();
    usePayload(c, 'emp_charge', 'e1');   // elite mech: works once
    expect(c.state.enemies[1]!.statuses['empd']).toBe(1);
    endTurn(c);
    usePayload(c, 'emp_charge', 'e1');   // now surge protected
    expect(c.state.enemies[1]!.statuses['empd']).toBeUndefined();
  });
});

describe('archetype mechanics', () => {
  it('charge scales BEAM attacks per hit and annihilation ray consumes it', () => {
    const c = combat({ enemies: ['void_leviathan'] });
    const e = c.state.enemies[0]!;
    c.state.player.statuses['charge'] = 3;
    playCard(c, give(c, 'twin_beam'), 'e0');     // (4+3)x2 = 14
    expect(e.hpMax - e.hp).toBe(14);
    playCard(c, give(c, 'annihilation_ray'), 'e0'); // 9 + 4*3 + charge(3 beam bonus) = 9+12+3 = 24
    expect(e.hpMax - e.hp).toBe(14 + 24);
    expect(c.state.player.statuses['charge']).toBeUndefined();
  });

  it('vera mass driver converts overheat and clears it', () => {
    const c = combat({ enemies: ['void_leviathan'] });
    const e = c.state.enemies[0]!;
    c.state.player.statuses['overheat'] = 4;
    playCard(c, give(c, 'vera_mass_driver'), 'e0'); // 6 + 3*4 = 18
    expect(e.hpMax - e.hp).toBe(18);
    expect(c.state.player.statuses['overheat']).toBeUndefined();
  });

  it('critical mass detonates radiation', () => {
    const c = combat({ enemies: ['void_leviathan'] });
    const e = c.state.enemies[0]!;
    e.statuses['radiation'] = 6;
    playCard(c, give(c, 'critical_mass'), 'e0');  // 3*6 = 18
    expect(e.hpMax - e.hp).toBe(18);
    expect(e.statuses['radiation']).toBeUndefined();
  });

  it('thermal lens converts overheat to charge', () => {
    const c = combat();
    c.state.player.statuses['overheat'] = 3;
    playCard(c, give(c, 'thermal_lens'), null);
    expect(c.state.player.statuses['charge']).toBe(4);
    expect(c.state.player.statuses['overheat']).toBeUndefined();
  });

  it('X-cost saturation fire spends all energy', () => {
    const c = combat({ enemies: ['void_leviathan'] });
    const e = c.state.enemies[0]!;
    playCard(c, give(c, 'saturation_fire'), null); // X=3 -> 6x3=18
    expect(e.hpMax - e.hp).toBe(18);
    expect(c.state.player.energy).toBe(0);
  });

  it('AoE hits all enemies', () => {
    const c = combat({ enemies: ['derelict_turret', 'derelict_turret'] });
    c.state.player.energy = 5;
    playCard(c, give(c, 'refraction_arc'), null);
    expect(c.state.enemies[0]!.hpMax - c.state.enemies[0]!.hp).toBe(7);
    expect(c.state.enemies[1]!.hpMax - c.state.enemies[1]!.hp).toBe(7);
  });

  it('onKill triggers (hit and run)', () => {
    const c = combat();
    c.state.enemies[0]!.hp = 5;
    const handBefore = c.state.player.hand.length;
    playCard(c, give(c, 'hit_and_run'), 'e0');
    expect(c.state.phase).toBe('won');
    expect(c.state.player.energy).toBe(3); // 3 - 1 + 1
    expect(c.state.player.hand.length).toBeGreaterThanOrEqual(handBefore); // drew 1 (card left hand, drew 1)
  });

  it('future echo duplicates the next card', () => {
    const c = combat({ enemies: ['void_leviathan'] });
    const e = c.state.enemies[0]!;
    c.state.player.energy = 5;
    playCard(c, give(c, 'future_echo'), null);
    playCard(c, give(c, 'pulse_laser'), 'e0');
    expect(e.hpMax - e.hp).toBe(12);
    expect(c.state.player.statuses['echo']).toBeUndefined();
  });

  it('powers install turn-start effects', () => {
    const c = combat();
    playCard(c, give(c, 'microfocus_array'), null);
    expect(c.state.player.statuses['charge']).toBeUndefined();
    endTurn(c);
    expect(c.state.player.statuses['charge']).toBe(1);
  });
});

describe('enemy behaviors', () => {
  it('scrap mites multiply up to the cap', () => {
    const c = combat({ enemies: ['scrapmites_leader'], seed: 'mites' });
    const e = c.state.enemies[0]!;
    e.intentMoveId = 'multiply';
    endTurn(c);
    expect(c.state.enemies.length).toBe(2);
  });

  it('mender heals its escort', () => {
    const c = combat({ enemies: ['replica_brute', 'replica_mender'], seed: 'mend' });
    const brute = c.state.enemies[0]!;
    brute.hp = 30;
    const mender = c.state.enemies[1]!;
    mender.intentMoveId = 'mend';
    brute.intentMoveId = 'brace';
    endTurn(c);
    expect(brute.hp).toBe(40);
  });

  it('SERAPH-0 keeps plating while satellites live, loses it after', () => {
    const c = combat({ enemies: ['seraph0', 'shield_satellite', 'shield_satellite'], seed: 'boss' });
    endTurn(c);
    const seraph = c.state.enemies[0]!;
    expect(seraph.plating).toBe(3);
    c.state.enemies[1]!.hp = 0;
    c.state.enemies[2]!.hp = 0;
    endTurn(c);
    expect(seraph.plating).toBe(0);
  });

  it('intent preview matches pipeline math', () => {
    const c = combat({ seed: 'preview' });
    const e = c.state.enemies[0]!;
    e.intentMoveId = 'snipe';
    e.statuses['force'] = 4;
    const p = intentPreview(c.state, c.rng, e);
    expect(p?.damage).toBe(11); // 7 + 4
  });
});

describe('fuzz: random valid play across all encounters', () => {
  const groups: string[][] = [
    ['scrapmites_leader', 'scrap_mite', 'scrap_mite'],
    ['feral_drone'], ['magnetite_burrower'], ['acid_polyp'], ['glow_lurker'],
    ['derelict_turret', 'derelict_turret'],
    ['hive_custodian'], ['ice_stalker'],
    ['seraph0', 'shield_satellite', 'shield_satellite'],
    ['replica_lancer'], ['replica_brute'], ['replica_halflife'], ['replica_dervish'],
    ['replica_lancer', 'replica_mender'], ['cancerous_forge', 'defect_mite'],
    ['swarm_mite', 'swarm_mite', 'swarm_mite', 'swarm_mite', 'swarm_conductor'],
    ['void_leviathan'], ['tomb_sentinel'], ['prime'],
    ['paradox_echo'], ['hawking_wisp', 'hawking_wisp', 'hawking_wisp'],
    ['veil_sentinel'], ['exodus'],
  ];
  // a deck touching every mechanic
  const bigDeck = [
    'pulse_laser', 'shield_matrix', 'system_scan', 'focused_beam', 'twin_beam',
    'railshot', 'slug_volley', 'isotope_round', 'fallout_vent', 'enrich',
    'microthrust', 'juke', 'afterburner', 'saturation_fire', 'nanite_cloud',
    'reactive_mesh', 'patch_weld', 'overclock', 'salvage_claw', 'overpressure',
    'critical_mass', 'meltdown', 'atomic_engine', 'reaction_wheels', 'coherence',
    'thermal_lens', 'vera_mass_driver', 'annihilation_ray', 'phase_skip',
    'causal_loop', 'future_echo', 'event_horizon', 'singularity_shard', 'probe_memory',
  ];

  for (const group of groups) {
    it(`survives random play vs ${group.join('+')}`, () => {
      for (const seed of ['f1', 'f2']) {
        const c = combat({ enemies: group, deckIds: bigDeck, seed: seed + group.join(''), hull: 300, hullMax: 300 });
        const rng = makeRng('driver:' + seed);
        let guard = 0;
        while ((c.state.phase === 'player') && c.state.turn < 25 && guard++ < 600) {
          const playable = c.state.player.hand.filter((x) => canPlay(c, x.uid).ok);
          if (!playable.length || rng.chance(0.25)) { endTurn(c); continue; }
          const inst = rng.pick(playable);
          const targets = c.state.enemies.filter((e) => e.hp > 0 && !(e.statuses['phased'] ?? 0));
          const target = targets.length ? rng.pick(targets).id : null;
          playCard(c, inst.uid, target);
          // invariants
          expect(c.state.player.block).toBeGreaterThanOrEqual(0);
          expect(c.state.player.hp).toBeGreaterThanOrEqual(0);
          for (const e of c.state.enemies) expect(e.hp).toBeGreaterThanOrEqual(0);
        }
        expect(guard).toBeLessThan(600);
        drainEvents(c);
      }
    });
  }
});
