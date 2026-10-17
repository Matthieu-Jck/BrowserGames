// tree-layout.test.ts — the tech tree's layout (D107): computed from content alone, it must keep
// its links off the cards (each turns in the gaps between sub-columns and runs along the gaps
// between lanes), put the Synthesis right of all of Tier 1 so every family's last Tier 1 node joins
// it on one bus, keep the tier bands apart, and light a hovered node's chain without spilling
// through the gates.
import { describe, it, expect } from 'vitest';
import { RESEARCH, TIER1_WHOLE } from '@/content/research';
import { ZOOM_FLOOR, ZOOM_MAX, chainOf, elbowPath, fitZoom, treeLayout, zoomLevel } from './research';

/** The straight legs of a route (its corners' curves cut to their ends: they stay within the gap). */
function legs(d: string): Array<[number, number, number, number]> {
  const pts: Array<[number, number]> = [];
  for (const m of d.matchAll(/([MLQ])([^MLQ]*)/g)) {
    const v = m[2]!.trim().split(/\s+/).map(Number);
    if (m[1] === 'Q') pts.push([v[2]!, v[3]!]); else pts.push([v[0]!, v[1]!]);
  }
  const out: Array<[number, number, number, number]> = [];
  for (let i = 1; i < pts.length; i++) out.push([pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1]]);
  return out;
}

describe('the tech tree’s layout (D107)', () => {
  const L = treeLayout();
  const at = new Map(L.nodes.map((s) => [s.id, s]));

  it('no link crosses a card: every leg stays out of every node but its own two', () => {
    for (const link of L.links) {
      expect(link.d, `${link.from} → ${link.to}`).not.toBe('');
      for (const [x1, y1, x2, y2] of legs(link.d)) {
        const lx = Math.min(x1, x2), hx = Math.max(x1, x2), ly = Math.min(y1, y2), hy = Math.max(y1, y2);
        for (const s of L.nodes) {
          if (s.id === link.from || s.id === link.to) continue;
          const hit = hx > s.x + 1 && lx < s.x + s.w - 1 && hy > s.y + 1 && ly < s.y + s.h - 1;
          expect(hit, `${link.from} → ${link.to} crosses ${s.id}`).toBe(false);
        }
      }
    }
  });

  it('a route is right angles with rounded corners, from the source’s right edge to the target’s left edge', () => {
    expect(elbowPath([[0, 0], [30, 0], [30, 40], [60, 40]])).toBe('M0 0 L20 0 Q30 0 30 10 L30 30 Q30 40 40 40 L60 40');
    expect(elbowPath([[0, 5], [80, 5]])).toBe('M0 5 L80 5');
    for (const link of L.links) {
      const a = at.get(link.from)!, b = at.get(link.to)!;
      expect(link.d.startsWith(`M${a.x + a.w} ${a.y + a.h / 2}`), link.from).toBe(true);
      expect(link.d.endsWith(`L${b.x} ${b.y + b.h / 2}`), link.to).toBe(true);
    }
  });

  it('the Synthesis stands right of all of Tier 1: each family’s last Tier 1 node joins it on one bus', () => {
    const synth = at.get(TIER1_WHOLE)!;
    for (const [id, r] of Object.entries(RESEARCH)) if (r.tier === 1 && id !== TIER1_WHOLE) expect(at.get(id)!.x + at.get(id)!.w, id).toBeLessThan(synth.x);
    const into = L.links.filter((l) => l.to === TIER1_WHOLE && l.kind === 'cross');
    expect(into.map((l) => l.from).sort()).toEqual(['an_relay', 'cm_floor', 'dn_wiremill', 'en2', 'ex_fastdrill', 'xp_guard']);
    // One bus: every route turns at the same x, left of the Synthesis.
    const turns = new Set(into.map((l) => legs(l.d).find(([x1, , x2]) => x1 === x2)![0]));
    expect(turns.size).toBe(1);
  });

  it('tier bands stand apart, a gutter between each', () => {
    for (let k = 1; k < L.tiers.length; k++) expect(L.tiers[k]!.x).toBeGreaterThan(L.tiers[k - 1]!.x + L.tiers[k - 1]!.w);
    for (const s of L.nodes) {
      const r = RESEARCH[s.id as keyof typeof RESEARCH];
      if (!r) continue;
      const band = L.tiers.find((t) => t.tier === r.tier)!;
      expect(s.x >= band.x && s.x + s.w <= band.x + band.w, s.id).toBe(true);
    }
  });

  it('a node’s chain: what it needs and what needs it, through the gates no further', () => {
    const c = chainOf('en_bigwind').nodes;
    for (const id of ['en_solarfarm', 'en4', 'en_heavyacc', 'en2', 'en_pitch', 'en_tower', 'tr6', 'tr_synth', 'observatory']) expect(c.has(id), id).toBe(true);
    for (const id of ['en5', 'en_cellgen', 'tr4', 'tr3', 'tr1', 'xp_swift', 'kiln']) expect(c.has(id), id).toBe(false);
    // A gate's own chain is the trunk's: what it opens is not in it.
    const g = chainOf('tr6').nodes;
    expect(g.has('tr4') && g.has('tr7') && g.has('tr8')).toBe(true);
    expect(g.has('en_solarfarm')).toBe(false);
    // Across lanes: the Compute Plan needs the Server Room.
    expect(chainOf('cm_plan').nodes.has('an_servers')).toBe(true);
    expect(chainOf('cm_plan').links.has('an_servers>cm_plan')).toBe(true);
  });

  it('the zoom (D111): from the whole tree in the view up to a little past its size; the cards simplify as it shrinks', () => {
    // A 1 440 × 900 window leaves the tree about 1 060 × 770: the whole tree is a fifth of its size.
    const fit = fitZoom(1060, 770, L);
    expect(fit).toBeCloseTo(Math.min(1060 / L.w, 770 / L.h), 6);
    expect(fit).toBeGreaterThan(0.12);
    expect(fit).toBeLessThan(0.3);
    expect(fitZoom(1e6, 1e6, L)).toBe(1); // never above its own size to fit
    expect(fitZoom(10, 10, L)).toBe(ZOOM_FLOOR);
    expect(ZOOM_MAX).toBeGreaterThan(1);
    expect([1, 0.7, 0.5, 0.36, 0.3, fit].map(zoomLevel)).toEqual(['near', 'near', 'mid', 'mid', 'far', 'far']);
  });
});
