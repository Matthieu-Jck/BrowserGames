// tree-layout.test.ts — the tech tree's layout (D107, D128, D144): computed from content alone, a
// swimlane matrix read left to right — the themes' lanes top to bottom, the stages (the Heart, the
// plans, the lab, Tier 1 … Tier 4) left to right, a wall before each tier (wider between Tier 1 and
// Tier 2: D118). It must keep its cards apart and inside their lane's cell, keep its links off the
// cards (right angles from a source's right edge to a target's left edge), stand every prerequisite
// left of what needs it (so the tree reads, and a path to a node can be followed, left to right),
// draw each category gate from its cell across the wall into the cell it opens, key each wall with
// the node behind its Core level, and light a selected node's chain without spilling through the
// gates. The launch dialog's estimates are the engine's (`launchSources`: sim/research/research.test.ts).
import { describe, it, expect } from 'vitest';
import { CATEGORIES, PLAN_IDS, PLAN_PATHS, RESEARCH, THEME_IDS, TIER_GATE, categoryNodes, tierCategories, treePrereq } from '@/content/research';
import { RESEARCH_IDS } from '@/content/registry';
import { CELL_HEAD, LAB_PLAN, PATH_THEME, ROOT, ZOOM_FLOOR, ZOOM_MAX, ZOOM_OPEN_MIN, chainOf, elbowPath, fitZoom, laneCost, laneOrder, openZoom, pathTo, themeOf, treeLayout, zoomLevel } from './tree-layout';

/** The legs of a route (its corners' curves cut to their ends — they stay within the gap —, flagged `curve`). */
function legs(d: string): Array<[number, number, number, number, boolean]> {
  const pts: Array<[number, number, boolean]> = [];
  for (const m of d.matchAll(/([MLQ])([^MLQ]*)/g)) {
    const v = m[2]!.trim().split(/\s+/).map(Number);
    if (m[1] === 'Q') pts.push([v[2]!, v[3]!, true]); else pts.push([v[0]!, v[1]!, false]);
  }
  const out: Array<[number, number, number, number, boolean]> = [];
  for (let i = 1; i < pts.length; i++) out.push([pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1], pts[i]![2]]);
  return out;
}

describe('the tech tree’s layout (D107, D144)', () => {
  const L = treeLayout();
  const at = new Map(L.nodes.map((s) => [s.id, s]));
  const zone = (id: string) => L.zones.find((z) => z.id === id)!;

  it('every plan, every research node, the Heart and the lab have a card', () => {
    for (const id of [ROOT, ...PLAN_IDS, ...RESEARCH_IDS]) expect(at.has(id), id).toBe(true);
    expect(L.nodes.length).toBe(1 + PLAN_IDS.length + RESEARCH_IDS.length);
  });

  it('no two cards overlap', () => {
    const hits: string[] = [];
    for (let i = 0; i < L.nodes.length; i++) for (let j = i + 1; j < L.nodes.length; j++) {
      const a = L.nodes[i]!, b = L.nodes[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) hits.push(`${a.id} × ${b.id}`);
    }
    expect(hits).toEqual([]);
  });

  it('no link crosses a card: every leg stays out of every card but its own two', () => {
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
      const a = at.get(link.from)!;
      for (const [x1, y1, x2, y2, curve] of legs(link.d)) if (!curve) expect(x1 === x2 || y1 === y2, `${link.from} → ${link.to}: a slanted leg`).toBe(true);
      expect(link.d.startsWith(`M${a.x + a.w} `), link.from).toBe(true);
      if (link.kind === 'key') continue;
      const b = at.get(link.to)!;
      const ls = legs(link.d), last = ls[ls.length - 1]!;
      expect(last[2], link.to).toBe(b.x);
      expect(last[3] >= b.y && last[3] <= b.y + b.h, `${link.from} → ${link.to} lands on its card`).toBe(true);
    }
  });

  it('every prerequisite stands left of what needs it (the tree reads left to right; D144: no link loops back)', () => {
    for (const id of [...PLAN_IDS, ...RESEARCH_IDS]) for (const p of treePrereq(id)) {
      const a = at.get(p)!, b = at.get(id)!;
      expect(a.x + a.w, `${p} before ${id}`).toBeLessThanOrEqual(b.x);
    }
  });

  it('the stages stand left to right, apart: the Heart, the plans, the lab, Tier 1 … Tier 4', () => {
    const ids = L.zones.map((z) => z.id);
    expect(ids).toEqual(['heart', 'plans', 'lab', 't1', 't2', 't3', 't4']);
    for (let k = 1; k < L.zones.length; k++) expect(L.zones[k]!.x).toBeGreaterThanOrEqual(L.zones[k - 1]!.x + L.zones[k - 1]!.w);
    for (const s of L.nodes) {
      const z = s.pillar ? zone(s.id === ROOT ? 'heart' : 'lab') : s.tier === 0 ? zone('plans') : zone(`t${s.tier}`);
      expect(s.x >= z.x && s.x + s.w <= z.x + z.w, s.id).toBe(true);
    }
  });

  it('a wall before each tier from Tier 2, between the tiers; the one before Tier 2 the widest (D118)', () => {
    expect(L.walls.map((w) => w.tier)).toEqual([2, 3, 4]);
    for (const w of L.walls) {
      const before = zone(`t${w.tier - 1}`), after = zone(`t${w.tier}`);
      expect(w.x).toBe(before.x + before.w);
      expect(w.x + w.w).toBe(after.x);
    }
    const [w2, w3, w4] = L.walls as [typeof L.walls[0], typeof L.walls[0], typeof L.walls[0]];
    expect(w2.strong && !w3.strong && !w4.strong).toBe(true);
    expect(w2.w).toBeGreaterThan(w3.w * 1.5);
  });

  it('each wall is keyed by the node behind its Core level (D118), in its tier’s last column, a straight line into the lock', () => {
    for (const w of L.walls) {
      expect(w.key).toBe(TIER_GATE[w.tier]);
      const k = at.get(w.key)!, z = zone(`t${w.tier - 1}`);
      expect(k.tier).toBe(w.tier - 1);
      const others = L.nodes.filter((s) => s.tier === k.tier && !s.pillar);
      expect(k.x, `${w.key} in its tier's last column`).toBe(Math.max(...others.map((s) => s.x)));
      expect(k.x + k.w).toBeLessThan(z.x + z.w);
      expect(w.ky).toBe(k.y + k.h / 2);
      const key = L.links.find((l) => l.kind === 'key' && l.from === w.key)!;
      expect(legs(key.d).length).toBe(1);
    }
  });

  it('the lanes are the six themes, apart, top to bottom; the order the fewest lanes skipped, the content’s nearest', () => {
    expect([...laneOrder()].sort()).toEqual([...THEME_IDS].sort());
    expect(L.lanes.map((l) => l.theme)).toEqual([...laneOrder()]);
    for (let k = 1; k < L.lanes.length; k++) expect(L.lanes[k]!.y).toBeGreaterThan(L.lanes[k - 1]!.y + L.lanes[k - 1]!.h);
    // Every card sits in its theme's lane; the pillars span them all.
    for (const s of L.nodes) {
      if (s.pillar) { expect(s.y).toBeGreaterThanOrEqual(L.top); expect(s.y + s.h).toBeLessThanOrEqual(L.bottom); continue; }
      const lane = L.lanes.find((l) => l.theme === s.theme)!;
      expect(s.y >= lane.y && s.y + s.h <= lane.y + lane.h, `${s.id} in ${s.theme}`).toBe(true);
    }
    // No order skips fewer lanes than the one chosen, the content's included; the Machines stand next
    // to the Analytics, which three of their links feed (the quartz workshop, the twin wire mill, the
    // electronics workshop).
    expect(laneCost(laneOrder())).toBeLessThanOrEqual(laneCost(THEME_IDS));
    const pos = (t: string) => laneOrder().indexOf(t as never);
    expect(Math.abs(pos('dn') - pos('an'))).toBe(1);
  });

  it('every plan path sits in its theme’s lane (D144), in a cell of the plans’ stage', () => {
    for (const p of PLAN_PATHS) {
      const cell = L.cells.find((c) => c.kind === 'plan' && c.id === p)!;
      expect(cell, p).toBeTruthy();
      expect(cell.theme).toBe(PATH_THEME[p as keyof typeof PATH_THEME]);
      for (const id of PLAN_IDS.filter((q) => RESEARCH[q as never] === undefined && themeOf(q) === cell.theme)) {
        const s = at.get(id)!;
        expect(s.x >= cell.x && s.x + s.w <= cell.x + cell.w && s.y >= cell.y + CELL_HEAD && s.y + s.h <= cell.y + cell.h, `${id} in ${p}`).toBe(true);
      }
    }
  });

  it('each tier’s categories are cells in their theme’s lane, every node in its cell under its header (D128)', () => {
    const cells = new Map(L.cells.filter((c) => c.kind === 'cat').map((c) => [c.id, c]));
    for (const tier of [1, 2, 3, 4] as const) {
      const z = zone(`t${tier}`);
      for (const c of tierCategories(tier)) {
        const k = cells.get(c)!;
        expect(k, c).toBeTruthy();
        expect(k.tier).toBe(tier);
        expect(k.x >= z.x && k.x + k.w <= z.x + z.w, c).toBe(true);
        const lane = L.lanes.find((l) => l.theme === CATEGORIES[c].theme)!;
        expect(k.y >= lane.y && k.y + k.h <= lane.y + lane.h, `${c} in its lane`).toBe(true);
        for (const id of categoryNodes(c)) {
          const s = at.get(id)!;
          expect(s.x >= k.x && s.x + s.w <= k.x + k.w && s.y + s.h <= k.y + k.h, `${id} in ${c}`).toBe(true);
          expect(s.y, `${id} under ${c}'s header`).toBeGreaterThanOrEqual(k.y + CELL_HEAD);
        }
      }
    }
    // Two cells of a lane in one tier stack, apart.
    for (const a of cells.values()) for (const b of cells.values()) {
      if (a === b || a.tier !== b.tier || a.theme !== b.theme) continue;
      expect(a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} and ${b.id} apart`).toBe(true);
    }
  });

  it('each category gate runs from its cell across the wall into the cell it opens, at their headers; level ones straight (D128, D144)', () => {
    const cells = new Map(L.cells.filter((c) => c.kind === 'cat').map((c) => [c.id, c]));
    const want = Object.entries(CATEGORIES).flatMap(([c, k]) => k.gates.map((g) => `${g}>${c}`)).sort();
    expect(L.gates.map((g) => `${g.from}>${g.to}`).sort()).toEqual(want);
    let straight = 0;
    for (const g of L.gates) {
      const a = cells.get(g.from)!, b = cells.get(g.to)!;
      expect(g.d.startsWith(`M${a.x + a.w} ${a.y + CELL_HEAD / 2}`), g.from).toBe(true);
      const ls = legs(g.d), last = ls[ls.length - 1]!;
      expect([last[2], last[3]], g.to).toEqual([b.x, b.y + CELL_HEAD / 2]);
      if (ls.length === 1) straight++;
      const wall = L.walls.find((w) => w.tier === b.tier)!;
      for (const [x1, , x2] of ls) if (x1 === x2) expect(x1 > wall.x && x1 < wall.x + wall.w, `${g.from}>${g.to} turns in the wall`).toBe(true);
    }
    // Most gates are one theme's flow along its lane: straight.
    expect(straight).toBeGreaterThanOrEqual(Math.ceil(L.gates.length * 0.6));
  });

  it('a node’s chain: what it needs and what needs it, through the gates no further (D128: the categories’ too)', () => {
    const c = chainOf('en_bigwind');
    for (const id of ['en_solarfarm', 'en4', 'en_heavyacc', 'en_tower', 'enK', 'tr6']) expect(c.nodes.has(id), id).toBe(true);
    expect(c.links.has('cat:t2_grid>cat:t3_plants') && c.links.has('cat:t3_plants>cat:t4_plants')).toBe(true);
    expect(c.links.has('key:tr6')).toBe(true);
    for (const id of ['en2', 'en_pitch', 'en5', 'en_cellgen', 'tr3', 'tr1', 'xp_swift', 'kiln']) expect(c.nodes.has(id), id).toBe(false);
    const g = chainOf('tr6').nodes;
    expect(g.has('tr3')).toBe(true);
    expect(g.has('en_solarfarm') || g.has('tr8')).toBe(false);
    expect(chainOf('tr6').links.has('key:tr6')).toBe(true);
    expect(chainOf('cm_plan').nodes.has('an_servers')).toBe(true);
    expect(chainOf('cm_plan').links.has('an_servers>cm_plan')).toBe(true);
    // Tier 1 hangs from the lab: its link lit; the Heart's into a path's first plan.
    expect(chainOf('en_pitch').links.has(`${LAB_PLAN}>en_pitch`)).toBe(true);
    expect(chainOf('router').links.has(`${ROOT}>router`)).toBe(true);
    // Every link a chain names exists on the tree.
    const ids = new Set([...L.links.map((l) => (l.kind === 'key' ? `key:${l.from}` : `${l.from}>${l.to}`)), ...L.gates.map((g) => `cat:${g.from}>cat:${g.to}`)]);
    for (const id of ['cm_plan', 'en_bigwind', 'dn_etcher', 'tr_synth', 'sorter']) for (const k of chainOf(id).links) {
      if (k.startsWith('cat:') || k.startsWith('key:') || ids.has(k)) continue;
      // A prerequisite another one already brings is not drawn (its link implied).
      expect(treePrereq(k.split('>')[1]!).includes(k.split('>')[0]!), k).toBe(true);
    }
  });

  it('the path to a node (D144): every need not done, in the order the tree reads, prerequisites first', () => {
    const none = new Set<string>();
    const p = pathTo('en_bigwind', none);
    expect(p).not.toContain('en_bigwind');
    for (const id of ['en_solarfarm', 'tr6', 'en4', 'en_heavyacc', 'en_pitch', 'en2', LAB_PLAN, 'router', 'tr_synth']) expect(p, id).toContain(id);
    for (let k = 0; k < p.length; k++) for (const q of treePrereq(p[k]!)) if (p.includes(q)) expect(p.indexOf(q), `${q} before ${p[k]}`).toBeLessThan(k);
    // What is done is not in it; a node with everything done has an empty path.
    const all = new Set([...PLAN_IDS, ...RESEARCH_IDS]);
    expect(pathTo('en_bigwind', all)).toEqual([]);
    const some = new Set(PLAN_IDS as readonly string[]);
    expect(pathTo('en_pitch', some)).toEqual([]);
    expect(pathTo('en2', some)).toEqual(['en_pitch']);
  });

  it('the zoom (D111, D144): opens with every lane in the view, its names readable; fits the whole tree; the cards simplify as it shrinks', () => {
    // A 1 440 × 900 window leaves the tree about 1 060 × 730.
    const fit = fitZoom(1060, 730, L);
    expect(fit).toBeCloseTo(Math.min(1060 / L.w, 730 / L.h), 6);
    expect(fit).toBeGreaterThan(0.12);
    expect(fit).toBeLessThan(0.4);
    expect(fitZoom(1e6, 1e6, L)).toBe(1);
    expect(fitZoom(10, 10, L)).toBe(ZOOM_FLOOR);
    expect(ZOOM_MAX).toBeGreaterThan(1);
    const open = openZoom(730, L);
    expect(open * L.h).toBeLessThanOrEqual(730 + 1e-6);
    expect(zoomLevel(open)).toBe('mid');
    expect(openZoom(300, L)).toBe(ZOOM_OPEN_MIN);
    expect([1, 0.75, 0.6, 0.4, 0.3, fit].map(zoomLevel)).toEqual(['near', 'near', 'mid', 'mid', 'far', 'far']);
  });

});
