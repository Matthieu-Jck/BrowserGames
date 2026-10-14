import { describe, it, expect } from 'vitest';
import { buildingDef, buildingIdx } from '@/content/registry';
import { testSim, drillToHearth } from '@/sim/testkit';
import { resolveKey } from './bindings';
import { LinkTool } from './link-tool';

describe('the Link tool', () => {
  it('L takes it, on both layouts (a mnemonic: Lier / Link)', () => {
    const k = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    expect(resolveKey({ code: 'KeyL', key: 'l', ...k })).toEqual({ action: 'link' });
    expect(resolveKey({ code: 'KeyL', key: 'L', ...k, shiftKey: true })).toEqual({ action: 'link' });
    expect(resolveKey({ code: 'KeyU', key: 'u', ...k })).toEqual({ action: 'hideUi' }); // hide the interface, both layouts
  });

  it('pick a pillar or the Heart, then each click toggles a wire; the source goes with a click on it', () => {
    const sim = testSim();
    const tool = new LinkTool(() => sim);
    const d = sim.place('drill', 516, 502, 2).id!; // 6 tiles from the Heart's edge, unwired
    const m = sim.place('mast', 520, 512, 0).id!; // wires itself to the Heart
    tool.start();
    expect(tool.click(d)).toEqual({ refused: 'needs_pillar' }); // a drill is no place to start from
    expect(tool.click(0)).toEqual({});
    expect(tool.click(sim.hearthId)).toEqual({ picked: sim.hearthId });
    expect(tool.verdict(d)).toBe('link');
    expect(tool.click(d)).toEqual({ linked: [sim.hearthId, d] });
    expect(sim.linksOf(d)).toEqual([sim.hearthId]);
    expect(tool.verdict(m)).toBe('unlink');
    expect(tool.click(m)).toEqual({ unlinked: [sim.hearthId, m] });
    expect(sim.linksOf(m)).toEqual([]);
    expect(tool.click(sim.hearthId)).toEqual({ dropped: true });
    expect(tool.source).toBe(0);
    // Shift+click starts from another pillar while one is chosen.
    tool.start(sim.hearthId);
    expect(tool.click(m, true)).toEqual({ picked: m });
    expect(sim.log.filter((l) => l.cmd.k === 'link' || l.cmd.k === 'unlink').map((l) => l.cmd.k)).toEqual(['link', 'unlink']);
  });

  it('refusals come back with their reason; Esc unwinds the source, then the tool', () => {
    const sim = testSim();
    const tool = new LinkTool(() => sim);
    const far = sim.place('drill', 516, 498, 0).id!; // 7 tiles above the Heart's reach
    tool.start(sim.hearthId);
    expect(tool.click(far)).toEqual({ refused: 'range' });
    expect(tool.cancel()).toBe(true);
    expect([tool.active, tool.source]).toEqual([true, 0]);
    expect(tool.cancel()).toBe(true);
    expect(tool.active).toBe(false);
    expect(tool.cancel()).toBe(false);
  });

  it('the preview: the source’s reach, what it could wire, its wires; with no source, where to start', () => {
    const sim = testSim();
    const d = drillToHearth(sim); // wired to the Heart
    const m = sim.place('mast', 520, 512, 0).id!;
    const s = sim.place('sand_collector', 522, 510, 3).id!; // in the Heart's reach too
    const tool = new LinkTool(() => sim);
    tool.start();
    let p = tool.preview();
    expect(p.source).toBe(0);
    expect(p.points).toEqual([sim.hearthId, m]);
    tool.start(sim.hearthId);
    tool.hover = s;
    p = tool.preview();
    expect(p.ring).toEqual([510, 510, 5, 5, 8]);
    expect(p.linked).toEqual([d, m]);
    expect(p.targets).toContain(s);
    expect(p.targets).not.toContain(d); // already wired: a click would cut it
    expect(p.verdict).toBe('link');
    expect(tool.preview()).toBe(p); // nothing moved: the same object (views redraw on its sig)
    tool.hover = d;
    expect(tool.preview().verdict).toBe('unlink');
  });

  it('marks only what is on no grid yet: turquoise in reach, dashed coral beyond; a hovered or held pillar shows its reach (owner, 2026-10-14)', () => {
    const sim = testSim();
    const d = drillToHearth(sim); // wired to the Heart
    const s = sim.place('sand_collector', 522, 510, 3).id!; // on no grid, in the Heart's reach
    const far = sim.place('drill', 516, 498, 0).id!; // on no grid, beyond the Heart's reach
    // A lone mast's grid: a collector in the Heart's reach too, already wired to it.
    const lone = sim.place('mast', 530, 512, 0).id!;
    const other = sim.place('sand_collector', 522, 512, 3).id!;
    expect(sim.link(lone, other).ok).toBe(true);
    sim.run(1);
    const tool = new LinkTool(() => sim);
    tool.start(sim.hearthId);
    let p = tool.preview();
    expect(p.targets).toContain(s);
    expect(p.targets).not.toContain(d); // wired to it: a click cuts it
    expect(p.targets).not.toContain(other); // on another grid: a click would wire it all the same, unmarked
    expect(tool.verdict(other)).toBe('link');
    expect(p.loose).toEqual([far]);
    // No source yet: the hovered pillar shows its reach and what it could wire.
    tool.cancel();
    tool.hover = sim.hearthId;
    p = tool.preview();
    expect(p.ring).toEqual([510, 510, 5, 5, 8]);
    expect(p.targets).toContain(s);
    // A mast in hand by the far drill: its reach, the drill in it.
    const g = tool.ghost(buildingIdx('mast'), 516, 501, 0)!;
    expect(g.ring).toEqual([516, 501, 1, 1, 6]);
    expect(g.targets).toEqual([far]);
    expect(g.loose).toContain(s);
    expect(tool.ghost(buildingIdx('drill'), 516, 501, 0)).toBeNull();
  });

  it('wiring a sleeping building says why its wire stays dashed', () => {
    const sim = testSim();
    const s = sim.place('sand_collector', 522, 510, 3).id!;
    const e = sim.ents.get(s)!;
    const unlock = buildingDef(e.def).unlock;
    sim.done.delete(unlock); // its research given back
    sim.rebuildDerived();
    expect(sim.dormancy(e)).toBe('research');
    const tool = new LinkTool(() => sim);
    tool.start(sim.hearthId);
    expect(tool.click(s)).toEqual({ linked: [sim.hearthId, s], asleep: 'research' });
    sim.run(1);
    expect(sim.graph.netOfEnt.get(s)).toBeUndefined(); // asleep: on no grid, wire or not
  });
});
