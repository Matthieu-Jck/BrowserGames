// tree-layout.ts — where the tech tree's cards go (D144), computed once from content alone: a
// SWIMLANE MATRIX read left to right, as Civilization VI's eras and Oxygen Not Included's research
// read (owner, 2026-10-19: « we need to rethink how to present the tech tree. Right now it doesn't
// work visually »).
//   · ROWS are the six themes (D128: Energy, Extraction, Machines, Commerce, Analytics, Logistics),
//     each a lane of its colour across the whole tree. Their order is the content's, changed only
//     where it saves lanes crossed: the order that makes the links between lanes skip the fewest
//     lanes (`laneOrder`), the content's first on a tie.
//   · COLUMNS are the tree's stages: the Heart (a pillar: everything grows from its kit), the PLANS
//     (D33: each plan path in its theme's lane — production with the Machines, logistics with
//     Logistics…), the research lab's plan (D71: a pillar every plan leads into, Tier 1 out of it),
//     then TIER 1 … TIER 4, a WALL between two tiers — wider and inked hard between Tier 1 and 2
//     (D118: « il doit être séparé du Tier 1 clairement ») — on which the Core's level the next
//     tier waits for is a lock, keyed by the node that makes that level possible (Synthesis,
//     Optics, Resonance: each the last column of its tier).
//   · In a lane, a tier's categories (D128) are cells, stacked when a theme has two (the Machines);
//     a category gate is then mostly a straight arrow along its lane, from the gate's cell across
//     the wall into the cell it opens (Energy → Power Grid → Power Plants → Great Power Plants).
//   · Inside a tier, a node's column is its longest chain of prerequisites of that tier, whatever
//     their category (Sugiyama's layering), so every link runs left to right: none loops back
//     round a block (the Twin Wire Mill → Synthesis loop of D128's tree). Its row in its cell is
//     the free one nearest its category parents'.
//   · Links run in right angles through the gaps between columns and the channels between lanes,
//     never across a card (`route`, D107).
// Pure: content in, geometry out — tested in tree-layout.test.ts (no overlap, links off the cards,
// every prerequisite left of what needs it, lanes and tiers in order). The screen (research.ts)
// draws it; the zoom's helpers (D111), a node's chain (D107) and the path to a node (D144) live
// here too, as they read the tree's shape and nothing else.
import { CATEGORIES, PLAN_IDS, PLAN_PATHS, THEME_IDS, TIER_GATE, categoryDef, categoryNodes, categoryOpens, isResearch, planDef, researchNode, tierCategories, treePrereq } from '@/content/research';
import { RESEARCH_IDS } from '@/content/registry';
import type { PlanLane, ResearchTier, ThemeId } from '@/content/types';

/** The root: the Heart and its starting kit (not a node of the tree's tables). */
export const ROOT = 'heart';
/** The plan research hangs from (D71): no lab, no research. */
export const LAB_PLAN = 'observatory';

// ── geometry (canvas px, at 100 %) ───────────────────────────────────────────

/** A plan's card and a research card (two lines: the name; the costs). */
export const P_W = 188, R_W = 224, CARD_H = 50;
/** Between two columns: where a link turns. */
const GAP = 44;
const P_PITCH = P_W + GAP, R_PITCH = R_W + GAP;
/** A row: a card and the paper under it. */
const ROW = CARD_H + 7;
/** A cell's header (its name and how much of it is learnt), and the paper under its last row. */
export const CELL_HEAD = 24;
const CELL_FOOT = 6;
/** Between two cells stacked in a lane's column (a channel links can run along), and their inset in the column. */
const CELL_GAP = 10, CELL_INSET = 6;
/** A lane's padding, and the channel between two lanes. */
const LANE_PAD = 4, LANE_GAP = 14;
/** The pillars: the Heart's, the research lab's (D71). */
export const HEART_W = 132, LAB_W = 184;
/** Inside a column, before its first card and after its last (a cell's inset, and room for a turn). */
const ZONE_PAD = 24;
/** A wall between two tiers; between Tier 1 and Tier 2 wider (D118). */
const WALL = 64, WALL_SPLIT = 112;
/** The outer margin, and the room above the first lane. */
const PAD = 16, TOP = 12;
/** How round a link's elbow is (px). */
const ELBOW_R = 10;
/** The radius of a wall's lock (the Core's level it waits for). */
export const KEY_R = 22;

const TIERS: readonly ResearchTier[] = [1, 2, 3, 4];

/**
 * The lane a plan path sits in (D144): the theme of what it makes — production smelts and
 * assembles (the Machines' Foundry and Workshop), logistics moves goods, energy powers, analytics
 * shows the base and computes, trade sells. Extraction has no plan path: the drill is in the kit.
 */
export const PATH_THEME: Readonly<Record<Exclude<PlanLane, 'gate'>, ThemeId>> = {
  production: 'dn', logistics: 'xp', energy: 'en', analytics: 'an', trade: 'cm',
};

export type Kind = 'root' | 'plan' | 'research';
/** A card: its id, kind, colour (`lane`: a plan's path, a research node's theme), stage and box. A pillar spans every lane. */
export interface Spot {
  id: string; kind: Kind; lane: string; theme: ThemeId | null;
  /** Its stage: 0 the Heart, the plans and the lab; 1–4 its tier. */
  tier: 0 | ResearchTier;
  x: number; y: number; w: number; h: number;
  pillar?: true;
}
/** A theme's lane: a band across the tree. */
export interface LaneBand { theme: ThemeId; y: number; h: number }
/** A stage's column: the Heart's pillar, the plans, the lab's pillar, a tier. */
export interface Zone { id: 'heart' | 'plans' | 'lab' | 't1' | 't2' | 't3' | 't4'; tier: 0 | ResearchTier; x: number; w: number }
/** A cell: a plan path (`kind` plan, its id the path's) or a category (D128) in its lane and stage. */
export interface Cell { id: string; kind: 'plan' | 'cat'; theme: ThemeId; tier: 0 | ResearchTier; gates: readonly string[]; x: number; y: number; w: number; h: number }
/**
 * A wall before a tier (2–4): its box, whether it is the strong one (Tier 1 | Tier 2, D118), the
 * node that keys its lock (`TIER_GATE`) and the lock's centre, level with that node.
 */
export interface Wall { tier: ResearchTier; x: number; w: number; strong: boolean; key: string; kx: number; ky: number }
/**
 * A link and its route (`d`, an SVG path: right angles in the gaps, never across a card). `line`
 * within a plan path or a category; `cross` from another category of the tier or another path;
 * `root` from the Heart; `lab` into or out of the research lab's pillar; `key` from a tier's gate
 * node into the lock on the wall it opens (its `to` is `wall:<tier>`).
 */
export interface Link { from: string; to: string; kind: 'line' | 'cross' | 'root' | 'lab' | 'key'; d: string }
/** A category gate (D128): from the gate's cell, across the wall, into the cell it opens, at their headers. */
export interface GateLink { from: string; to: string; d: string }
export interface TreeLayout {
  nodes: Spot[]; lanes: LaneBand[]; zones: Zone[]; cells: Cell[]; walls: Wall[];
  links: Link[]; gates: GateLink[];
  /** The lanes' top and bottom (the pillars' and walls' extent). */
  top: number; bottom: number;
  w: number; h: number;
}

/** A node's colour: a plan's path, a research node's theme. */
const laneOf = (id: string): string => planDef(id)?.lane ?? researchNode(id)?.theme ?? '';
/** The research lab's plan (D71): the gate between the plans and research. */
const isGate = (id: string): boolean => planDef(id)?.lane === 'gate';
/** A node's theme (the lane it sits in): a plan's by its path, a research node's own. */
export function themeOf(id: string): ThemeId | null {
  const p = planDef(id);
  if (p) return p.lane === 'gate' ? null : PATH_THEME[p.lane];
  return researchNode(id)?.theme ?? null;
}

/** The nodes that key a wall (D118): the node behind the Core's level each tier waits for. */
const KEYS: ReadonlySet<string> = new Set(TIERS.map((t) => TIER_GATE[t]).filter((g): g is string => !!g));

/**
 * An SVG path through these points, each corner rounded (`ELBOW_R`, less where a leg is short);
 * points in a line are dropped.
 */
export function elbowPath(pts: ReadonlyArray<readonly [number, number]>): string {
  const p = pts.filter((q, i) => i === 0 || q[0] !== pts[i - 1]![0] || q[1] !== pts[i - 1]![1]);
  if (p.length < 2) return '';
  let d = `M${p[0]![0]} ${p[0]![1]}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [ax, ay] = p[i - 1]!, [bx, by] = p[i]!, [cx, cy] = p[i + 1]!;
    const r = Math.min(ELBOW_R, Math.abs(bx - ax + by - ay) / 2, Math.abs(cx - bx + cy - by) / 2);
    const ix = bx - Math.sign(bx - ax) * r, iy = by - Math.sign(by - ay) * r;
    const ox = bx + Math.sign(cx - bx) * r, oy = by + Math.sign(cy - by) * r;
    d += ` L${ix} ${iy} Q${bx} ${by} ${ox} ${oy}`;
  }
  const last = p[p.length - 1]!;
  return `${d} L${last[0]} ${last[1]}`;
}

/** Does a route run through a card other than its two ends'? */
function blocked(pts: ReadonlyArray<readonly [number, number]>, cards: readonly Spot[], a: Spot, b: Spot | null): boolean {
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1]!, [x2, y2] = pts[i]!;
    const lx = Math.min(x1, x2), hx = Math.max(x1, x2), ly = Math.min(y1, y2), hy = Math.max(y1, y2);
    for (const s of cards) if (s !== a && s !== b && hx > s.x + 1 && lx < s.x + s.w - 1 && hy > s.y + 1 && ly < s.y + s.h - 1) return true;
  }
  return false;
}

/**
 * A link's route from (x1, y1) on its source's right edge to (x2, y2) on its target's left edge,
 * in right angles, never across a card: straight when level; else one turn, in the gap between
 * columns nearest the target that leaves both legs clear; else round by a channel between lanes or
 * cells (the nearest clear one), out at the gap right of the source, in at the gap left of the
 * target. `gaps`: the x of every gap between columns of the stage(s) it crosses, left to right.
 */
function route(x1: number, y1: number, x2: number, y2: number, a: Spot, b: Spot | null, gaps: readonly number[], channels: readonly number[], cards: readonly Spot[]): string {
  if (y1 === y2 && !blocked([[x1, y1], [x2, y2]], cards, a, b)) return elbowPath([[x1, y1], [x2, y2]]);
  const between = gaps.filter((g) => g > x1 && g < x2);
  for (const gx of [...between].reverse()) {
    const pts: Array<[number, number]> = [[x1, y1], [gx, y1], [gx, y2], [x2, y2]];
    if (!blocked(pts, cards, a, b)) return elbowPath(pts);
  }
  const xr = between[0] ?? (x1 + x2) / 2, xl = between[between.length - 1] ?? (x1 + x2) / 2;
  const byNear = [...channels].sort((u, v) => Math.abs(u - y2) + Math.abs(u - y1) - (Math.abs(v - y2) + Math.abs(v - y1)) || u - v);
  for (const c of byNear) {
    const pts: Array<[number, number]> = [[x1, y1], [xr, y1], [xr, c], [xl, c], [xl, y2], [x2, y2]];
    if (!blocked(pts, cards, a, b)) return elbowPath(pts);
  }
  return elbowPath([[x1, y1], [xl, y1], [xl, y2], [x2, y2]]);
}

/** The free row nearest `want` (upwards first on a tie). */
function nearestFree(want: number, used: ReadonlySet<number>): number {
  for (let k = 0; ; k++) {
    if (want - k >= 0 && !used.has(want - k)) return want - k;
    if (!used.has(want + k)) return want + k;
  }
}

/**
 * What a node needs by name (D128): a plan's prerequisites; a research node's own — the node before
 * it in its category, what it takes from another category of its tier — and its tier's gate. Its
 * category's gates are apart: the tree draws them between the cells, not node to node.
 */
export function ownPrereq(id: string): readonly string[] {
  const r = researchNode(id);
  if (!r) return treePrereq(id);
  const g = TIER_GATE[r.tier];
  return g && g !== id && !r.prereq.includes(g) ? [...r.prereq, g] : r.prereq;
}

/** Every tree node a node needs by name, theirs included (`ownPrereq`, all the way). */
function closureOf(id: string, out = new Set<string>()): Set<string> {
  for (const p of ownPrereq(id)) if (!out.has(p)) { out.add(p); closureOf(p, out); }
  return out;
}

/** A plan's column (D33): its longest chain of plans from the Heart (a plan with none is 1). */
function planDepth(): Map<string, number> {
  const depth = new Map<string, number>();
  const d = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const pre = treePrereq(id).filter((p) => !isGate(p));
    const v = pre.length ? 1 + Math.max(...pre.map(d)) : 1;
    depth.set(id, v);
    return v;
  };
  for (const id of PLAN_IDS) if (!isGate(id)) d(id);
  return depth;
}

/**
 * A research node's column in its tier: its longest chain of prerequisites of the same tier,
 * whatever their category, so every link of the tier runs left to right; a node that keys the next
 * tier's wall (`TIER_GATE`) stands in its tier's last column, against that wall.
 */
function researchCols(): { col: Map<string, number>; cols: Map<ResearchTier, number> } {
  const tierOf = (id: string): ResearchTier => researchNode(id)!.tier;
  let forced = new Map<string, number>();
  let col = new Map<string, number>();
  const c = (id: string): number => {
    const known = col.get(id);
    if (known !== undefined) return known;
    const same = researchNode(id)!.prereq.filter((p) => researchNode(p)?.tier === tierOf(id));
    const v = Math.max(forced.get(id) ?? 0, same.length ? 1 + Math.max(...same.map(c)) : 0);
    col.set(id, v);
    return v;
  };
  const cols = new Map<ResearchTier, number>();
  // Twice: the keys pushed to their tier's last column, then what follows them (none today) after them.
  for (let pass = 0; pass < 3; pass++) {
    col = new Map();
    for (const id of RESEARCH_IDS) c(id);
    for (const t of TIERS) cols.set(t, 1 + Math.max(0, ...RESEARCH_IDS.filter((id) => tierOf(id) === t).map((id) => col.get(id)!)));
    const next = new Map<string, number>();
    for (const k of KEYS) next.set(k, cols.get(tierOf(k))! - 1);
    if ([...next].every(([k, v]) => col.get(k) === v)) break;
    forced = next;
  }
  return { col, cols };
}

/** The links between lanes, as pairs of themes: the ones the lane order tries to keep short. */
function crossLanePairs(): Array<[ThemeId, ThemeId]> {
  const out: Array<[ThemeId, ThemeId]> = [];
  for (const id of RESEARCH_IDS) {
    const r = researchNode(id)!;
    for (const p of r.prereq) {
      const q = researchNode(p);
      if (q && q.tier === r.tier && q.theme !== r.theme) out.push([q.theme, r.theme]);
    }
  }
  for (const id of PLAN_IDS) {
    const t = themeOf(id);
    if (!t) continue;
    for (const p of treePrereq(id)) { const u = themeOf(p); if (u && u !== t) out.push([u, t]); }
  }
  return out;
}

let PAIRS: Array<[ThemeId, ThemeId]> | null = null;
/** How many lanes the links between lanes skip, the lanes in this order. */
export function laneCost(order: readonly ThemeId[]): number {
  PAIRS ??= crossLanePairs();
  const pos = new Map(order.map((t, i) => [t, i]));
  let cost = 0;
  for (const [a, b] of PAIRS) cost += Math.max(0, Math.abs(pos.get(a)! - pos.get(b)!) - 1);
  return cost;
}

let LANE_ORDER: ThemeId[] | null = null;
/**
 * The lanes, top to bottom: of every order of the six themes, the one whose links between lanes
 * skip the fewest lanes (`laneCost`); on a tie the nearest the content's (`THEME_IDS`: the fewest
 * pairs swapped), then the first met. Deterministic, and computed once.
 */
export function laneOrder(): readonly ThemeId[] {
  if (LANE_ORDER) return LANE_ORDER;
  const base = THEME_IDS;
  let best: ThemeId[] = [...base], bestCost = Infinity, bestSwaps = Infinity;
  const perm = (left: ThemeId[], rest: ThemeId[]): void => {
    if (!rest.length) {
      const cost = laneCost(left);
      let swaps = 0;
      for (let i = 0; i < left.length; i++) for (let j = i + 1; j < left.length; j++) if (base.indexOf(left[i]!) > base.indexOf(left[j]!)) swaps++;
      if (cost < bestCost || (cost === bestCost && swaps < bestSwaps)) { best = [...left]; bestCost = cost; bestSwaps = swaps; }
      return;
    }
    for (let k = 0; k < rest.length; k++) perm([...left, rest[k]!], [...rest.slice(0, k), ...rest.slice(k + 1)]);
  };
  perm([], [...base]);
  LANE_ORDER = best;
  return best;
}

/** Rows within a cell: the node with the most to come in its cell first, each nearest its cell parents' rows. */
function cellRows(ids: readonly string[], colOf: (id: string) => number, parentsOf: (id: string) => readonly string[]): { row: Map<string, number>; rows: number } {
  const mine = new Set(ids);
  const inCell = (id: string): string[] => parentsOf(id).filter((p) => mine.has(p));
  const kids = (id: string): number => ids.filter((k) => inCell(k).includes(id)).reduce((s, k) => s + 1 + kids(k), 0);
  const order = [...ids].sort((a, b) => colOf(a) - colOf(b) || kids(b) - kids(a) || ids.indexOf(a) - ids.indexOf(b));
  const row = new Map<string, number>(), taken = new Map<number, Set<number>>();
  let rows = 1;
  for (const id of order) {
    const parents = inCell(id).filter((p) => row.has(p));
    const used = taken.get(colOf(id)) ?? new Set<number>();
    const r = nearestFree(parents.length ? Math.round(parents.reduce((s, p) => s + row.get(p)!, 0) / parents.length) : 0, used);
    taken.set(colOf(id), used.add(r));
    row.set(id, r);
    rows = Math.max(rows, r + 1);
  }
  return { row, rows };
}

const cellH = (rows: number): number => CELL_HEAD + rows * ROW - (ROW - CARD_H) + CELL_FOOT;

/** Where every node goes, from content alone (computed once: `treeLayout`). */
function computeLayout(): TreeLayout {
  const lanes = laneOrder();
  const depth = planDepth();
  const { col, cols } = researchCols();
  const plans = PLAN_IDS.filter((id) => !isGate(id));
  const maxDepth = Math.max(...plans.map((id) => depth.get(id)!));

  // ── the columns, left to right ──
  const zones: Zone[] = [];
  let x = PAD;
  zones.push({ id: 'heart', tier: 0, x, w: HEART_W });
  x += HEART_W + GAP / 2;
  const plansW = 2 * ZONE_PAD + maxDepth * P_PITCH - GAP;
  zones.push({ id: 'plans', tier: 0, x, w: plansW });
  x += plansW + GAP / 2;
  zones.push({ id: 'lab', tier: 0, x, w: LAB_W });
  x += LAB_W + GAP / 2;
  const wallsX: Array<{ tier: ResearchTier; x: number; w: number }> = [];
  for (const t of TIERS) {
    const w = 2 * ZONE_PAD + cols.get(t)! * R_PITCH - GAP;
    zones.push({ id: `t${t}` as Zone['id'], tier: t, x, w });
    x += w;
    if (t < 4) {
      const ww = t === 1 ? WALL_SPLIT : WALL;
      wallsX.push({ tier: (t + 1) as ResearchTier, x, w: ww });
      x += ww;
    }
  }
  const width = x + PAD;
  const zoneOf = (tier: 0 | ResearchTier): Zone => zones.find((z) => (tier === 0 ? z.id === 'plans' : z.tier === tier))!;

  // ── the lanes, top to bottom: each stage's cells stacked in its lane ──
  const nodes: Spot[] = [], cells: Cell[] = [], bands: LaneBand[] = [];
  /** Per tier, the order of each lane's categories (a later tier's by where its gates stand). */
  const stackIdx = new Map<string, number>();
  let y = TOP;
  const top = y;
  for (const theme of lanes) {
    const stacks: Array<{ tier: 0 | ResearchTier; items: Array<{ id: string; kind: 'plan' | 'cat'; ids: readonly string[]; row: Map<string, number>; rows: number; gates: readonly string[] }> }> = [];
    // The plan path of this theme (one at most).
    const paths = PLAN_PATHS.filter((p) => PATH_THEME[p as Exclude<PlanLane, 'gate'>] === theme);
    stacks.push({
      tier: 0,
      items: paths.map((p) => {
        const ids = plans.filter((id) => laneOf(id) === p);
        const { row, rows } = cellRows(ids, (id) => depth.get(id)!, (id) => treePrereq(id));
        return { id: p, kind: 'plan' as const, ids, row, rows, gates: [] };
      }),
    });
    for (const t of TIERS) {
      const mine = tierCategories(t).filter((c) => CATEGORIES[c].theme === theme);
      // Barycentre of the gates' places in the tier before (D128), the table's order on a tie.
      const bary = (c: string): number => {
        const g = CATEGORIES[c as keyof typeof CATEGORIES].gates as readonly string[];
        const at = g.map((k) => stackIdx.get(k)).filter((v): v is number => v !== undefined);
        return at.length ? at.reduce((s, v) => s + v, 0) / at.length : 0;
      };
      const ordered = [...mine].sort((a, b) => bary(a) - bary(b) || mine.indexOf(a) - mine.indexOf(b));
      ordered.forEach((c, k) => stackIdx.set(c, k));
      stacks.push({
        tier: t,
        items: ordered.map((c) => {
          const ids = categoryNodes(c);
          const { row, rows } = cellRows(ids, (id) => col.get(id)!, (id) => researchNode(id)!.prereq);
          return { id: c, kind: 'cat' as const, ids, row, rows, gates: CATEGORIES[c].gates as readonly string[] };
        }),
      });
    }
    const content = Math.max(...stacks.map((s) => s.items.reduce((h, it, k) => h + cellH(it.rows) + (k ? CELL_GAP : 0), 0)));
    const laneH = LANE_PAD * 2 + content;
    for (const s of stacks) {
      const z = zoneOf(s.tier);
      let cy = y + LANE_PAD;
      s.items.forEach((it, k) => {
        const last = k === s.items.length - 1;
        const h = last ? y + laneH - LANE_PAD - cy : cellH(it.rows);
        cells.push({ id: it.id, kind: it.kind, theme, tier: s.tier, gates: it.gates, x: z.x + CELL_INSET, y: cy, w: z.w - 2 * CELL_INSET, h });
        for (const id of it.ids) {
          const c = it.kind === 'plan' ? depth.get(id)! - 1 : col.get(id)!;
          const pitch = it.kind === 'plan' ? P_PITCH : R_PITCH;
          nodes.push({
            id, kind: it.kind === 'plan' ? 'plan' : 'research', lane: laneOf(id), theme, tier: s.tier,
            x: z.x + ZONE_PAD + c * pitch, y: cy + CELL_HEAD + it.row.get(id)! * ROW, w: it.kind === 'plan' ? P_W : R_W, h: CARD_H,
          });
        }
        cy += h + CELL_GAP;
      });
    }
    bands.push({ theme, y, h: laneH });
    y += laneH + LANE_GAP;
  }
  const bottom = y - LANE_GAP;
  const height = bottom + PAD;

  // ── the pillars: the Heart's and the lab's, every lane high ──
  const heartZ = zones[0]!, labZ = zones[2]!;
  const heart: Spot = { id: ROOT, kind: 'root', lane: '', theme: null, tier: 0, x: heartZ.x, y: top + LANE_PAD, w: HEART_W, h: bottom - top - 2 * LANE_PAD, pillar: true };
  const lab: Spot = { id: LAB_PLAN, kind: 'plan', lane: 'gate', theme: null, tier: 0, x: labZ.x, y: top + LANE_PAD, w: LAB_W, h: bottom - top - 2 * LANE_PAD, pillar: true };
  nodes.unshift(heart);
  nodes.push(lab);
  const at = new Map(nodes.map((s) => [s.id, s]));

  // The gaps a link may turn in: between the columns of each stage, and in its pads.
  const gapsOf = (z: Zone, pitch: number, n: number): number[] => {
    const out = [z.x + ZONE_PAD / 2];
    for (let k = 1; k < n; k++) out.push(z.x + ZONE_PAD + k * pitch - GAP / 2);
    out.push(z.x + z.w - ZONE_PAD / 2);
    return out;
  };
  const plansZ = zoneOf(0);
  const gapsPlans = gapsOf(plansZ, P_PITCH, maxDepth);
  const gapsTier = new Map(TIERS.map((t) => [t, gapsOf(zoneOf(t), R_PITCH, cols.get(t)!)]));
  // Channels: between lanes, and between two cells stacked in a column.
  const channels: number[] = [];
  for (let k = 1; k < bands.length; k++) channels.push(bands[k]!.y - LANE_GAP / 2);
  for (const c of cells) if (cells.some((d) => d !== c && d.tier === c.tier && d.theme === c.theme && d.y > c.y)) channels.push(c.y + c.h + CELL_GAP / 2);
  channels.sort((u, v) => u - v);

  const links: Link[] = [];
  const cy = (s: Spot): number => s.y + s.h / 2;
  // The Heart into each path's first plans; plan to plan; each path's last plans into the lab (D71).
  for (const id of plans) {
    const b = at.get(id)!;
    const pre = treePrereq(id);
    if (!pre.length) links.push({ from: ROOT, to: id, kind: 'root', d: route(heart.x + heart.w, cy(b), b.x, cy(b), heart, b, gapsPlans, channels, nodes) });
    for (const p of pre) {
      const a = at.get(p)!;
      links.push({ from: p, to: id, kind: laneOf(p) === laneOf(id) ? 'line' : 'cross', d: route(a.x + a.w, cy(a), b.x, cy(b), a, b, gapsPlans, channels, nodes) });
    }
  }
  for (const lane of PLAN_PATHS) {
    const mine = plans.filter((id) => laneOf(id) === lane);
    const last = Math.max(...mine.map((id) => depth.get(id)!));
    for (const id of mine) if (depth.get(id) === last) {
      const a = at.get(id)!;
      links.push({ from: id, to: LAB_PLAN, kind: 'lab', d: route(a.x + a.w, cy(a), lab.x, cy(a), a, lab, gapsPlans, channels, nodes) });
    }
  }
  // Research: the lab into Tier 1's first nodes; within a tier, every prerequisite but those another
  // already brings (`closureOf`); a tier's key into its wall's lock.
  for (const id of RESEARCH_IDS) {
    const r = researchNode(id)!;
    const b = at.get(id)!;
    const pre = r.prereq.filter((p) => p === LAB_PLAN ? r.tier === 1 : researchNode(p)?.tier === r.tier);
    for (const p of pre) {
      if (pre.some((q) => q !== p && closureOf(q).has(p))) continue;
      const a = at.get(p)!;
      const kind: Link['kind'] = p === LAB_PLAN ? 'lab' : researchNode(p)!.cat === r.cat ? 'line' : 'cross';
      const y1 = p === LAB_PLAN ? cy(b) : cy(a);
      links.push({ from: p, to: id, kind, d: route(a.x + a.w, y1, b.x, cy(b), a, b, gapsTier.get(r.tier)!, channels, nodes) });
    }
  }
  const walls: Wall[] = wallsX.map((w) => {
    const key = TIER_GATE[w.tier]!;
    const k = at.get(key)!;
    return { ...w, strong: w.tier === 2, key, kx: w.x + w.w / 2, ky: cy(k) };
  });
  for (const w of walls) {
    const k = at.get(w.key)!;
    links.push({ from: w.key, to: `wall:${w.tier}`, kind: 'key', d: elbowPath([[k.x + k.w, w.ky], [w.kx - KEY_R, w.ky]]) });
  }

  // The category gates (D128): from the gate's cell, at its header, across the wall to the cell it
  // opens; level, a straight arrow; else a turn of its own in the wall, the turns spread over it.
  const gates: GateLink[] = [];
  const cellOf = new Map(cells.filter((c) => c.kind === 'cat').map((c) => [c.id, c]));
  for (const w of walls) {
    const into = cells.filter((c) => c.kind === 'cat' && c.tier === w.tier)
      .flatMap((c) => c.gates.map((g) => ({ g: cellOf.get(g)!, c })))
      .sort((u, v) => u.c.y - v.c.y || u.g.y - v.g.y);
    const bent = into.filter(({ g, c }) => g.y !== c.y);
    for (const { g, c } of into) {
      const fy = g.y + CELL_HEAD / 2, ty = c.y + CELL_HEAD / 2;
      const n = bent.findIndex((b) => b.g === g && b.c === c);
      const gx = Math.round(w.x + (w.w * (n + 1)) / (bent.length + 1));
      gates.push({ from: g.id, to: c.id, d: fy === ty ? elbowPath([[g.x + g.w, fy], [c.x, ty]]) : elbowPath([[g.x + g.w, fy], [gx, fy], [gx, ty], [c.x, ty]]) });
    }
  }

  return { nodes, lanes: bands, zones, cells, walls, links, gates, top, bottom, w: width, h: height };
}

let LAYOUT: TreeLayout | null = null;
/** The tree's layout (computed once: content does not change while the game runs). */
export function treeLayout(): TreeLayout {
  LAYOUT ??= computeLayout();
  return LAYOUT;
}

// ── zoom (D111) ─────────────────────────────────────────────────────────────

/** The closest the tree zooms in: a little past its own size. */
export const ZOOM_MAX = 1.25;
/** The farthest it ever zooms out, whatever the window (the whole tree's fit is usually above). */
export const ZOOM_FLOOR = 0.08;
/** The least the tree opens at on its own (D144): the cards' names still read. */
export const ZOOM_OPEN_MIN = 0.45;

/** The zoom at which the whole tree fits a view of this size (never above its own size). */
export function fitZoom(viewW: number, viewH: number, L: Pick<TreeLayout, 'w' | 'h'>): number {
  return Math.max(ZOOM_FLOOR, Math.min(1, viewW / L.w, viewH / L.h));
}

/**
 * The zoom the tree opens at (D144), as Civilization VI's: every lane in the view's height, the
 * tiers scrolled through sideways — never under `ZOOM_OPEN_MIN` (a phone scrolls both ways then),
 * never above its own size.
 */
export function openZoom(viewH: number, L: Pick<TreeLayout, 'h'>): number {
  return Math.max(ZOOM_OPEN_MIN, Math.min(1, viewH / L.h));
}

/**
 * How much a card shows at a zoom: `near` all of it; `mid` what it unlocks and its name, larger, on
 * two lines (its costs are too small to read: the detail pane has them); `far` a tile of its state's
 * colour with its icon (its name in its tooltip): the tree reads as a map, its tiers and lanes named
 * by the rails.
 */
export function zoomLevel(z: number): 'near' | 'mid' | 'far' {
  return z >= 0.75 ? 'near' : z >= 0.4 ? 'mid' : 'far';
}

// ── a node's chain (D107, D128) and the path to it (D144) ────────────────────

/**
 * A node's chain (D107, D128): what it needs and what needs it, all the way, but through the gates
 * no further. A gate it needs is in its chain, not what the gate needs: the lab's plan into Tier 1,
 * the node behind its tier's Core level (and its key into the wall: `key:<node>`), and the
 * categories its own and its needs' wait for (their nodes, and the gate between them:
 * `cat:<gate>>cat:<category>`). What needs it: its children by name, all the way, and the
 * categories its category opens (their nodes, no further). Selecting a node lights its chain and
 * fades the rest.
 */
export function chainOf(id: string): { nodes: Set<string>; links: Set<string> } {
  const nodes = new Set<string>([id]), links = new Set<string>();
  const gateFor = (p: string, child: string): boolean => {
    const r = researchNode(child);
    return !!r && (p === LAB_PLAN || (p === TIER_GATE[r.tier] && researchNode(p)?.cat !== r.cat));
  };
  const cats = (n: string): void => {
    const c = researchNode(n)?.cat;
    for (const g of categoryDef(c ?? '')?.gates ?? []) {
      links.add(`cat:${g}>cat:${c}`);
      for (const k of categoryNodes(g)) nodes.add(k);
    }
  };
  const up = (n: string): void => {
    cats(n);
    if (planDef(n) && !treePrereq(n).length) links.add(`${ROOT}>${n}`);
    for (const p of ownPrereq(n)) {
      links.add(`${p}>${n}`);
      const r = researchNode(n);
      if (r && p === TIER_GATE[r.tier]) links.add(`key:${p}`);
      if (nodes.has(p)) continue;
      nodes.add(p);
      if (!gateFor(p, n)) up(p);
    }
  };
  const down = (n: string): void => {
    for (const c of childrenOf(n)) {
      if (gateFor(n, c)) continue;
      links.add(`${n}>${c}`);
      if (!nodes.has(c)) { nodes.add(c); down(c); }
    }
  };
  up(id);
  down(id);
  if (KEYS.has(id)) links.add(`key:${id}`);
  const c = researchNode(id)?.cat;
  if (c) for (const k of categoryOpens(c)) {
    links.add(`cat:${c}>cat:${k}`);
    for (const n of categoryNodes(k)) nodes.add(n);
  }
  return { nodes, links };
}

let CHILDREN: Map<string, string[]> | null = null;
/** The tree nodes that need this one by name (plans and research: `ownPrereq`). */
export function childrenOf(id: string): readonly string[] {
  if (!CHILDREN) {
    CHILDREN = new Map();
    for (const n of [...PLAN_IDS, ...RESEARCH_IDS]) for (const p of ownPrereq(n)) CHILDREN.set(p, [...(CHILDREN.get(p) ?? []), n]);
  }
  return CHILDREN.get(id) ?? [];
}

/**
 * The path to a node (D144, as Civilization VI and Oxygen Not Included show a goal's): every node
 * it still waits for — its prerequisites all the way, its tier's gate, every node of its category's
 * gates (`treePrereq`) — not yet in `done`, in the order the tree reads, left to right then top to
 * bottom (every prerequisite stands left of what needs it, so that order can be followed). Empty
 * when nothing is missing; the node itself is not in it.
 */
export function pathTo(id: string, done: ReadonlySet<string>): string[] {
  const need = new Set<string>();
  const walk = (n: string): void => {
    for (const p of treePrereq(n)) if (!done.has(p) && !need.has(p)) { need.add(p); walk(p); }
  };
  walk(id);
  const at = new Map(treeLayout().nodes.map((s) => [s.id, s]));
  return [...need].filter((n) => at.has(n)).sort((a, b) => at.get(a)!.x - at.get(b)!.x || at.get(a)!.y - at.get(b)!.y || (a < b ? -1 : a > b ? 1 : 0));
}

/** Is this id a research node keying a wall (D118: Synthesis, Optics, Resonance)? */
export const isKey = (id: string): boolean => KEYS.has(id) && isResearch(id);
