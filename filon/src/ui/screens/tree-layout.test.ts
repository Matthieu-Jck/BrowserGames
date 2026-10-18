// tree-layout.test.ts — the tech tree's layout (D107, D128): computed from content alone, it must
// keep its cards apart (two siblings in one slot take a row each), its links off the cards (each
// turns in the gaps between sub-columns and runs along the gaps between categories), stack each
// tier's own categories in its band (a block each, paper between, every node in its own block under
// its header), draw each category gate from the gate's block across the gutter to the block it
// opens, keep the tier bands apart (Tier 1 and Tier 2 further, an ink rule between them: D118), and
// light a selected node's chain without spilling through the gates. The launch dialog's estimates
// are the engine's (`launchSources`: sim/research/research.test.ts).
import { describe, it, expect } from 'vitest';
import { CATEGORIES, RESEARCH, categoryNodes, tierCategories } from '@/content/research';
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

  it('no two cards overlap', () => {
    const hits: string[] = [];
    for (let i = 0; i < L.nodes.length; i++) for (let j = i + 1; j < L.nodes.length; j++) {
      const a = L.nodes[i]!, b = L.nodes[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) hits.push(`${a.id} × ${b.id}`);
    }
    expect(hits).toEqual([]);
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

  it('each tier stacks its own categories (D128): a block each in its band, paper between, every node in its block under its header', () => {
    const blocks = new Map(L.cats.map((k) => [k.id, k]));
    for (const tier of [1, 2, 3, 4] as const) {
      const band = L.tiers.find((t) => t.tier === tier)!;
      const mine = tierCategories(tier).map((c) => blocks.get(c)!);
      expect(mine.every(Boolean), `Tier ${tier}`).toBe(true);
      for (let k = 0; k < mine.length; k++) {
        const b = mine[k]!;
        expect(b.x >= band.x && b.x + b.w <= band.x + band.w, b.id).toBe(true);
        if (k) expect(b.y, `${b.id} under ${mine[k - 1]!.id}`).toBeGreaterThan(mine[k - 1]!.y + mine[k - 1]!.h);
      }
    }
    for (const k of L.cats) for (const id of categoryNodes(k.id)) {
      const s = at.get(id)!;
      expect(s.x >= k.x && s.x + s.w <= k.x + k.w && s.y + s.h <= k.y + k.h, `${id} in ${k.id}`).toBe(true);
      expect(s.y, `${id} under ${k.id}'s header`).toBeGreaterThanOrEqual(k.y + 26 + (k.gates.length ? 22 : 0));
    }
  });

  it('each category gate is a line from the gate’s block across the gutter to the block it opens, its turn its own (D128)', () => {
    const blocks = new Map(L.cats.map((k) => [k.id, k]));
    const want = Object.entries(CATEGORIES).flatMap(([c, k]) => k.gates.map((g) => `${g}>${c}`)).sort();
    expect(L.gates.map((g) => `${g.from}>${g.to}`).sort()).toEqual(want);
    const turns = new Set<number>();
    for (const g of L.gates) {
      const a = blocks.get(g.from)!, b = blocks.get(g.to)!;
      expect(g.d.startsWith(`M${a.x + a.w} `), g.from).toBe(true);
      const ls = legs(g.d), last = ls[ls.length - 1]!;
      expect(last[2], g.to).toBe(b.x);
      const turn = ls.find(([x1, , x2]) => x1 === x2);
      if (turn) {
        expect(turn[0] > a.x + a.w && turn[0] < b.x, `${g.from}>${g.to} turns in the gutter`).toBe(true);
        expect(turns.has(turn[0]), `${g.from}>${g.to} shares its turn`).toBe(false);
        turns.add(turn[0]);
      }
    }
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

  it('Tier 1 and Tier 2 stand further apart than the other tiers, a strong rule down that gap (D118)', () => {
    const [t1, t2, t3] = L.tiers as [typeof L.tiers[0], typeof L.tiers[0], typeof L.tiers[0]];
    const gap12 = t2.x - (t1.x + t1.w), gap23 = t3.x - (t2.x + t2.w);
    expect(gap12).toBeGreaterThan(gap23 * 2);
    expect(L.rule).not.toBeNull();
    expect(L.rule!.x).toBeCloseTo(t1.x + t1.w + gap12 / 2, 6);
    expect([L.rule!.y, L.rule!.h]).toEqual([t1.y, t1.h]);
  });

  it('a node’s chain: what it needs and what needs it, through the gates no further (D128: the categories’ too)', () => {
    const c = chainOf('en_bigwind');
    // What it needs: the node before it, its category's gate (the Power Grid, whole) and its tier's
    // (Optics); what needs it: the categories its own opens (the Great Power Plants).
    for (const id of ['en_solarfarm', 'en4', 'en_heavyacc', 'en_tower', 'enK', 'tr6']) expect(c.nodes.has(id), id).toBe(true);
    expect(c.links.has('cat:t2_grid>cat:t3_plants') && c.links.has('cat:t3_plants>cat:t4_plants')).toBe(true);
    // No further than the gates: not what the Power Grid waits for, nor its own category's other line.
    for (const id of ['en2', 'en_pitch', 'en5', 'en_cellgen', 'tr3', 'tr1', 'xp_swift', 'kiln']) expect(c.nodes.has(id), id).toBe(false);
    // Optics' own chain: Ceramics before it; what its tier gate opens is not in it.
    const g = chainOf('tr6').nodes;
    expect(g.has('tr3')).toBe(true);
    expect(g.has('en_solarfarm') || g.has('tr8')).toBe(false);
    // Across categories of a tier: the Compute Plan needs the Server Room.
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
