import { describe, it, expect } from 'vitest';
import { testSim, drillToHearth } from '@/sim/testkit';
import { resolveKey } from './bindings';
import { LinkTool } from './link-tool';

describe('the Link tool', () => {
  it('L takes it, on both layouts (a mnemonic: Lier / Link)', () => {
    const k = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    expect(resolveKey({ code: 'KeyL', key: 'l', ...k })).toEqual({ action: 'link' });
    expect(resolveKey({ code: 'KeyL', key: 'L', ...k, shiftKey: true })).toEqual({ action: 'link' });
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
});
