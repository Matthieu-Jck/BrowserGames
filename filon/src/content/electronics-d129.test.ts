// electronics-d129.test.ts — D129's content (owner, 2026-10-18: « le electronics workshop devrait
// probablement avoir un style plus avancé, et demander plus en ressources que du verre et du cuivre…
// on peut le reléguer au Tier 2 et faire autre chose de plus basique au Tier 1 »): the electronics
// workshop a Tier 2 research node built like an electronics works, its circuit more than wire and
// glass; the assembly bench a plan in its place, winding coils and building motors; nothing of the
// plans or of Tier 1 — a plan's cost, a Tier 1 node's resources, a building either unlocks, the
// Core's level 3, the tutorial — asks for circuits any more.
import { describe, it, expect } from 'vitest';
import { BAL } from './balance';
import { BUILDINGS } from './buildings';
import { QUESTS } from './quests';
import { RECIPES } from './recipes';
import { PLANS, RESEARCH, researchNeeds } from './research';
import type { BuildingDef, PlanDef, ResearchDef } from './types';
import { makeableWith } from './validate';

const has = (cost: ReadonlyArray<readonly [string, number]>, item: string): boolean => cost.some(([it]) => it === item);
const plans = Object.entries(PLANS) as Array<[string, PlanDef]>;
const research = Object.entries(RESEARCH) as Array<[string, ResearchDef]>;
/** The tree nodes of the plans and Tier 1 (what a base has before the Core's level 3). */
const early = new Set([...plans.map(([id]) => id), ...research.filter(([, r]) => r.tier === 1).map(([id]) => id)]);

describe('D129: the electronics workshop at Tier 2, the assembly bench at Tier 1', () => {
  it('the workshop is a Tier 2 node of Automation, of its old plan’s id, its circuit a copper plate, two wires and a glass', () => {
    expect(PLANS).not.toHaveProperty('workshop');
    const node = RESEARCH.workshop as ResearchDef;
    expect([node.tier, node.cat]).toEqual([2, 't2_automation']);
    expect(BUILDINGS.workshop.unlock).toBe('workshop');
    expect(RECIPES.circuit.unlock).toBe('workshop');
    expect(RECIPES.circuit.ins.map(([it]) => it).sort()).toEqual(['copper_plate', 'copper_wire', 'glass']);
    // Built like an electronics works: steel, copper plates, cable, glass and oscillators.
    for (const it of ['steel', 'copper_plate', 'cable', 'glass', 'oscillator']) expect(has(BUILDINGS.workshop.cost, it), it).toBe(true);
    // Three intakes for the circuit's three inputs; its 2×2 kept (saves hold it).
    expect([BUILDINGS.workshop.w, BUILDINGS.workshop.h]).toEqual([2, 2]);
    expect(BUILDINGS.workshop.ports.filter((p) => p.io === 'in')).toHaveLength(3);
    // The servomotor waits for it, and the Server Room, and Optics (its thermal cores, the Core's level 4).
    for (const id of ['dn4', 'an_servers', 'tr6']) expect(researchNeeds(id), id).toContain('workshop');
  });

  it('the assembly bench is a plan of Production after the wire mill: coils from it, motors with Mechanics', () => {
    expect(PLANS.assembly_bench.lane).toBe('production');
    expect(PLANS.assembly_bench.prereq).toContain('wire_mill');
    expect(BUILDINGS.assembly_bench.unlock).toBe('assembly_bench');
    expect(RECIPES.copper_coil.machines).toEqual(['assembly_bench']);
    expect(RECIPES.motor.machines).toEqual(['assembly_bench']);
    expect(RECIPES.copper_coil.unlock).toBe('assembly_bench');
    expect(RECIPES.motor.unlock).toBe('tr1');
    // The plans alone make coils; Mechanics adds motors.
    const withPlans = makeableWith(new Set(plans.map(([id]) => id)));
    expect(withPlans.has('copper_coil')).toBe(true);
    expect(withPlans.has('motor')).toBe(false);
    expect(withPlans.has('circuit')).toBe(false);
    expect(makeableWith(new Set([...plans.map(([id]) => id), 'tr1'])).has('motor')).toBe(true);
    // The servomotor is a motor and two circuits.
    expect(RECIPES.pace_bell.ins.map(([it]) => it).sort()).toEqual(['circuit', 'motor']);
  });

  it('nothing of the plans or of Tier 1 asks for circuits; the Core’s level 3 is paid in motors', () => {
    for (const [id, p] of plans) expect(has(p.cost, 'circuit'), `plan ${id}`).toBe(false);
    for (const [id, r] of research) if (r.tier === 1) expect(has(r.cost, 'circuit'), `research ${id}`).toBe(false);
    for (const [id, b] of Object.entries(BUILDINGS) as Array<[string, BuildingDef]>) {
      if (early.has(b.unlock) || b.unlock === 'start') expect(has(b.cost, 'circuit'), `building ${id}`).toBe(false);
    }
    const l3 = BAL.hearthUpgrades.find((u) => u.unlock === 'tr_synth')!;
    expect(has(l3.cost, 'circuit')).toBe(false);
    expect(has(l3.cost, 'motor')).toBe(true);
    // The tutorial's last quest builds the bench and brings its coils to the Core, no circuits.
    expect(JSON.stringify(QUESTS.synth_parts)).not.toMatch(/'circuit'|"circuit"/);
    expect(JSON.stringify(QUESTS.synth_parts)).toMatch(/assembly_bench/);
  });

  it('coils and motors have uses: buildings, research, the Core, the Crier', () => {
    for (const it of ['copper_coil', 'motor']) {
      expect(Object.values(BUILDINGS as Record<string, BuildingDef>).some((b) => has(b.cost, it)), `${it}: a building`).toBe(true);
      expect(research.some(([, r]) => has(r.cost, it)), `${it}: research`).toBe(true);
    }
  });
});
