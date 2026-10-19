// work-look.test.ts — which buildings look at work (D83): a machine while it crafts, through a
// passing stop (inputs late) for WORK_GRACE ticks and then switched off; a hard stop (its wire cut)
// switches it off at once; a turbine on no grid is off, wired it is on; a lab with no project is
// off; logistics keep one look. The tracker reports only the flips.
import { describe, it, expect } from 'vitest';
import { BUILDING_IDS } from '@/content/registry';
import { steadyPower, stockedSilo, testSim, wire, drillToHearth } from '@/sim/testkit';
import { WORK_GRACE, WorkLook, looksAtWork, workOf } from './work-look';

describe('work look', () => {
  it('a wire mill looks at work while it crafts, keeps the look WORK_GRACE ticks once its ore runs out, then is switched off', () => {
    const sim = testSim();
    steadyPower(sim);
    // A silo of copper ore (facing south: out at (511|512, 507)) over a wire mill (in at (512,508),
    // out at (512,509)) over the Heart's north input (512,510): logistics.test.ts's layout.
    stockedSilo(sim, 511, 506, 2, 'copper_ore', 4);
    const mill = sim.place('wire_mill', 512, 508, 2).id!; // on copper wire at once (D83)
    const look = new WorkLook();
    look.rebuild(sim);
    look.sample(sim);
    expect(look.isLit(mill)).toBe(false); // not compiled yet, no wire: off
    wire(sim, mill);
    let on = -1;
    for (let k = 0; k < 600 && on < 0; k++) {
      sim.step();
      if (look.sample(sim).includes(mill) && look.isLit(mill)) on = sim.tick;
    }
    expect(on).toBeGreaterThan(0);
    expect(workOf(sim, sim.ents.get(mill)!)).toBe('on');
    // The ore runs out: the last tick at work, then the grace, then off.
    let last = -1, off = -1;
    for (let k = 0; k < 3000 && off < 0; k++) {
      sim.step();
      if (workOf(sim, sim.ents.get(mill)!) === 'on') last = sim.tick;
      look.sample(sim);
      if (!look.isLit(mill)) off = sim.tick;
    }
    expect(workOf(sim, sim.ents.get(mill)!)).toBe('pause'); // starved: a passing stop
    expect(off - last).toBe(WORK_GRACE + 1);
  });

  it('a drill whose wire is cut is switched off at once (no grace for a hard stop); only flips are reported', () => {
    const sim = testSim();
    steadyPower(sim);
    const drill = drillToHearth(sim);
    const look = new WorkLook();
    look.rebuild(sim);
    sim.run(100);
    expect(look.sample(sim)).toContain(drill); // first sight counts as a flip
    expect(look.isLit(drill)).toBe(true);
    sim.step();
    expect(look.sample(sim)).not.toContain(drill); // nothing changed
    expect(look.sample(sim)).toEqual([]); // the same tick: no second sample
    expect(sim.unlink(sim.hearthId, drill)).toBe(true);
    sim.step();
    expect(workOf(sim, sim.ents.get(drill)!)).toBe('off');
    expect(look.sample(sim)).toContain(drill);
    expect(look.isLit(drill)).toBe(false);
    expect(look.counts().off).toBeGreaterThanOrEqual(1);
  });

  it('a wind turbine is off on no grid and on once wired; a lab with no project is off; ribbons keep one look', () => {
    const sim = testSim();
    const t = sim.place('wind_flower', 516, 515, 0);
    expect(t.ok, t.reason).toBe(true);
    const lab = sim.place('observatory', 506, 515, 0);
    expect(lab.ok, lab.reason).toBe(true);
    const ribbon = sim.place('ribbon', 520, 520, 0).id!;
    sim.run(5);
    expect(workOf(sim, sim.ents.get(t.id!)!)).toBe('off');
    expect(workOf(sim, sim.ents.get(lab.id!)!)).toBe('off');
    wire(sim, t.id!);
    sim.run(5);
    expect(workOf(sim, sim.ents.get(t.id!)!)).toBe('on');
    const look = new WorkLook();
    look.rebuild(sim);
    look.sample(sim);
    expect(look.isLit(t.id!)).toBe(true);
    expect(look.isLit(lab.id!)).toBe(false);
    expect(looksAtWork(sim.ents.get(ribbon)!.def)).toBe(false);
    expect(look.isLit(ribbon)).toBe(true);
    // Another colony (a debug base swapped in): what was known of this one is dropped, ids and all.
    const other = testSim();
    look.rebuild(other);
    expect(look.isLit(lab.id!)).toBe(true); // unknown until sampled
    expect(look.counts()).toEqual({ watched: 0, off: 0 });
  });

  it('watches the production kinds only: never logistics, the Heart or the excavator', () => {
    const watched = BUILDING_IDS.filter((_, i) => looksAtWork(i));
    for (const id of ['kiln', 'wire_mill', 'drill', 'sand_collector', 'auto_lab', 'pump', 'steam_boiler', 'observatory', 'server', 'wind_flower', 'sun_bulb', 'fumarole_tap']) expect(watched, id).toContain(id);
    for (const id of ['ribbon', 'router', 'silo', 'hearth', 'trade_post', 'mast', 'excavator', 'incinerator']) expect(watched, id).not.toContain(id);
  });
});
