// research.ts — the tech tree screen (D33; T, or the HUD's tree chip): one tree, two kinds of
// node. On the left the plans grow from the Heart's starting kit in five paths of one theme each
// (D41, `PLAN_PATHS`: production, logistics, energy, analytics, trade; survey went, D117), each drawn as a
// band of its own colour with its name, what it is for and how much of it is unlocked: a plan
// unlocks with one click, paid from the Heart at once. A plan whose cost would eat into
// CrierBelt's restart reserve (D36) reads « short of materials » with that reason, and the header
// shows what the Heart's stock must keep while the buildings do not cover it.
// Between the two blocks stands the GATE (D71): the research lab's plan, in its own column, which
// needs every other plan — each path's last node links into it, a caption counts the plans taken.
// On the right the research (D68–D70) reads in four TIER BANDS (Tier 1 … Tier 4), a gutter between
// them — a strong ink rule and a wider gap between Tier 1 and Tier 2 (D118: « il doit être séparé du
// Tier 1 clairement ») —, each headed by the Core's level it needs from Tier 2 (D118, « Tier 2 · Cœur
// niveau 3 », the Core's look at that level, padlocked and the band hatched while the Core is below
// it) and by what opens it (the lab's plan, then a node of the trunk, standing in the band before;
// Tier 2 also two expertises chosen at the Core's Archive, D93). The trunk — « Fondations » —
// runs on top; under it one lane per family, well apart (D107), whose name changes with the tier
// (Commerce: Échange → Finance → Économie de marché) and which splits in two specialities from Tier 3
// (a sub-lane each, its name on the divider). The Synthesis stands alone at Tier 1's end, every
// family's Tier 1 joining it on one bus. Links run in right angles through the gaps between cards and
// lanes, never across a card; a node the player selects lights its whole chain — what it needs, what
// needs it — and fades the rest until another is selected, the empty tree clicked or Esc pressed
// (`chainOf`; D111: the mouse over a card only raises it). A research card shows what it unlocks
// first (buildings, recipes' items, a glyph for a feature), then its kinds of data (one more each
// tier, D71: Survey Data, Mechanics Data, atlases, codices) and, from Tier 2, its AI tokens and their
// price at CrierBelt now. No time anywhere (D118: a research takes as long as its data takes to reach
// the lab and its tokens to come in). The header adds research's strip: slots, labs, the last
// minute's token bill, the purse-in-the-red warning, the Compute Plan's switch and the Research
// Queue (each lab's queued node, ✕ to clear it).
// The detail pane gives the whole picture: what a node unlocks (a plain line per feature), its
// cost, its progress (each kind of data paid, its tokens in, the flows that bring them and the
// flow bought, which the player can change), the action (start, cancel, queue in a lab). « Lancer »
// starts a Tier 1 node at once; from Tier 2 it opens the launch dialog (../launch-dialog.ts, D118:
// how many tokens a minute to buy from CrierBelt, what it costs, when it would be done). The
// reconversion's button is gone (D107: « retire le bouton reconvert de l'arbre »); a save's
// reconversion under way still runs out in the HUD.
// The layout is computed once from content (`treeLayout`); the 4 Hz refresh writes states, costs
// and progress — the nodes' states and a project's state derived in ../tree-state.ts, which the
// HUD's chips read too. The sim decides; this only shows and asks (`unlockPlan`, `startResearch`,
// `setTokenBuy`, `cancelResearch`, `queueResearch`, `setTokenPlan`).
import { coreLevelFor, tokenFlowSteps } from '@/sim/systems/research';
import { tokenFacts } from '../token-facts';
import { LaunchDialog } from '../launch-dialog';
import '../styles/research.css';
import { BAL } from '@/content/balance';
import { ESSENTIAL, RESERVED } from '@/content/reserve';
import {
  FAMILIES, FAMILY_IDS, PLAN_IDS, PLAN_PATHS, SCIENCE, TIER1_WHOLE, TIER_GATE, buildingsUnlockedBy, familyName, isPlan, isResearch, nodeName,
  pathPlans, planDef, researchNode, treePrereq,
} from '@/content/research';
import { RECIPES } from '@/content/recipes';
import { BUILDING_IDS, BUILDING_KIND, RESEARCH_IDS, buildingDef, buildingIdx, itemDef, itemIdx, toMu } from '@/content/registry';
import type { Effect, FamilyId, PlanLane, RecipeDef, ResearchTier } from '@/content/types';
import { el, setAttr, setText } from '@/core/dom';
import { makeStore } from '@/core/store';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import { duration, num } from '@/i18n/format';
import type { Atlas } from '@/render/art/atlas';
import { C } from '@/render/art/tokens';
import type { Sim } from '@/sim/state';
import { branchCounts, effectiveCost, projectPermille, tokensLeft, type Project } from '@/sim/research/runtime';
import { buildingIcon, itemIcon } from '../build-bar';
import { glyph as inkGlyph } from '../glyphs';
import { itemMention, itemRef } from '../mention';
import { oc, ocNum } from '../trade-view';
import { nodeState, planState, projectTiming, readyPlans, researchState, type ResearchState } from '../tree-state';
import { planOffered } from '@/sim/systems/quests';
import { tierTwoOpen } from '@/sim/systems/expertise';
import { archiveGlyph } from './expertise';

export interface ResearchHost {
  sim(): Sim;
  close(): void;
  notify(kind: 'good' | 'bad' | 'info' | 'warn', text: string): void;
  /** The node the tutorial's guide is after (null: none): the tree opens on it. */
  focus?(): string | null;
  /**
   * The base's production of an item now, items a minute (the statistics' last ten minutes), for the
   * launch dialog's estimate of when a node's data would be in; null while not measured yet.
   */
  dataRate?(item: number): number | null;
}

type Loc = 'fr' | 'en';

// ── layout ──────────────────────────────────────────────────────────────────

/** The root: the Heart and its starting kit (not a node of the tree's tables). */
export const ROOT = 'heart';

// The plans' geometry (D33, D41): compact rows so the six paths fit a 900 px window.
const NODE_W = 186, NODE_H = 56;
const COL_W = 226, ROW_H = 66, LANE_GAP = 4;
const LABEL_W = 124, PAD = 16, HEAD_H = 40, BLOCK_GAP = 44;
/** A plan lane's band reaches this far above and below its rows (below: most of the « Débloquer » tab). */
const BAND_TOP = 4, BAND_BOTTOM = 7;
/** The research lab's gate (D71): its card, and the room left of it where the paths' links converge. */
const GATE_W = 220, GATE_GAP = 96;

// Research's geometry (D69, D107): wide cards (three lines: name; data; tokens from Tier 2), tier
// bands of sub-columns with a gutter between bands, lanes far enough apart for each tier's family
// name on their edge and for the links' channels. Links never cross a card: they turn in the gaps
// between sub-columns and run along the gaps between lanes (`route`). The rows close again after
// D107 widened them (owner, 2026-10-17: « reduce the space between each row of the research tree,
// this is too much »): half the gaps between rows, specialities and lanes; the tier gutters a little
// narrower; the gaps between sub-columns, where the links turn, as they were.
const R_NODE_W = 276, R_NODE_H = 60;
/** The gap between two sub-columns, where a link turns. */
const R_GAP = 60;
/** A sub-column: a node and its gap; a row: a node and 6 px. */
const R_COL_W = R_NODE_W + R_GAP, R_ROW_H = R_NODE_H + 6;
/** Between a family's two specialities (their divider and the second one's name sit there). */
const R_SPLIT = 14;
/** Between research lanes: room for the family's name over each tier band, and a channel links run along. */
const R_LANE_GAP = 20;
const R_LABEL_W = 156;
/** Inside a tier band, before its first node and after its last. */
const TIER_PAD = 26;
/** Between two tier bands: the paper shows through. */
const TIER_GUTTER = 22;
/**
 * Between Tier 1 and Tier 2 (D118; owner, 2026-10-17: « il doit être séparé du Tier 1 clairement »):
 * wider, a strong ink rule down its middle — Tier 1 is data alone, Tier 2 on waits for the Core's
 * level and takes AI tokens.
 */
const TIER_SPLIT = 58;
/** A tier band's head: « Tier 2 · Cœur niveau 3 » over « Ouvert par … ». */
const TIER_HEAD_H = 58;
/** A research band reaches this far above and below its rows. */
const R_BAND = 5;
/** How round a link's elbow is (px). */
const ELBOW_R = 10;

/** The research lanes, top to bottom: the trunk (« Fondations »), then the families. */
const RESEARCH_LANES: ReadonlyArray<'trunk' | FamilyId> = ['trunk', ...FAMILY_IDS];
const TIERS: readonly ResearchTier[] = [1, 2, 3, 4];
/** The plan research hangs from: no lab, no research (it opens Tier 1). */
const LAB_PLAN = 'observatory';
/** What opens a tier: the lab's plan for Tier 1, then the trunk's gates (`TIER_GATE`). */
const gateOf = (tier: ResearchTier): string => TIER_GATE[tier] ?? LAB_PLAN;

type Kind = 'root' | 'plan' | 'research';
interface Spot { id: string; kind: Kind; lane: string; x: number; y: number; w: number; h: number }
/** A lane: a plan path or a research lane — its label at (x, y), its band `w` wide to the block's right edge. */
interface Lane { id: string; kind: 'plan' | 'research'; x: number; y: number; w: number; h: number }
interface Block { kind: 'plan' | 'research'; x: number; y: number; w: number; h: number }
/**
 * A link and its route (`d`, an SVG path: elbows in the gaps, never across a card). Its kind: a
 * `line` within a lane (a path, a family's lineage, the trunk), a `cross` link from another lane (the
 * Synthesis's Tier 1, the Compute Plan's Server Room…), a `gate` — a trunk node opening a tier for a
 * family node, drawn only while that node is selected (the tier heads say what opens each
 * tier). `path`: a plan path's last node into the research lab's gate (inked once the whole path is taken).
 */
interface Link { from: string; to: string; gate: boolean; kind: 'line' | 'cross' | 'gate'; d: string; path?: PlanLane }
/** A tier band of the research block: its head on top, its stripe down to the block's bottom. */
interface TierCol { tier: ResearchTier; x: number; w: number; y: number; h: number }
/** A family's name over one tier band of its lane: the tier's name, or a speciality's from Tier 3. */
interface TierTag { lane: FamilyId; tier: ResearchTier; spec: string | null; x: number; y: number }
/** The divider between a family's two specialities, across Tiers 3 and 4. */
interface Split { lane: FamilyId; x: number; w: number; y: number }
/** The research lab's gate (D71): its column between the two blocks, the card's top left. */
interface GateCol { id: string; x: number; y: number }
/** The ink rule between Tier 1 and Tier 2 (D118): its x, down from the heads' top to the block's bottom. */
interface TierRule { x: number; y: number; h: number }
export interface TreeLayout {
  nodes: Spot[]; lanes: Lane[]; blocks: Block[]; links: Link[];
  tiers: TierCol[]; tags: TierTag[]; splits: Split[]; gate: GateCol | null; rule: TierRule | null;
  w: number; h: number;
}

const laneOf = (id: string): string => planDef(id)?.lane ?? researchNode(id)?.branch ?? '';
/** The research lab's plan (D71): the gate between the plans and research, needing every other plan. */
const isGate = (id: string): boolean => planDef(id)?.lane === 'gate';

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

/** Does a leg (axis-aligned, from (x1, y1) to (x2, y2)) run through a card other than its two ends'? */
function blocked(pts: ReadonlyArray<readonly [number, number]>, cards: readonly Spot[], a: Spot, b: Spot): boolean {
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1]!, [x2, y2] = pts[i]!;
    const lx = Math.min(x1, x2), hx = Math.max(x1, x2), ly = Math.min(y1, y2), hy = Math.max(y1, y2);
    for (const s of cards) if (s !== a && s !== b && hx > s.x + 1 && lx < s.x + s.w - 1 && hy > s.y + 1 && ly < s.y + s.h - 1) return true;
  }
  return false;
}

/**
 * A link's route from a node's right edge to another's left edge, in right angles (D107), never
 * across a card: along the source's row to the gap left of the target, down or up that gap, into
 * the target. When that row has cards on the way, or the target does not stand right of the
 * source's gap, it goes round: out to the gap right of the source, along a channel between lanes
 * (`channels`, the nearest first that is clear), back down or up the gap left of the target.
 */
function route(a: Spot, b: Spot, gap: number, channels: readonly number[], cards: readonly Spot[]): string {
  const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
  const xl = x2 - gap / 2, xr = x1 + gap / 2;
  const straight: Array<[number, number]> = [[x1, y1], [xl, y1], [xl, y2], [x2, y2]];
  if (x1 <= xl && !blocked(straight, cards, a, b)) return elbowPath(straight);
  let round: Array<[number, number]> = [];
  for (const c of channels) {
    round = [[x1, y1], [xr, y1], [xr, c], [xl, c], [xl, y2], [x2, y2]];
    if (!blocked(round, cards, a, b)) break;
  }
  return elbowPath(round.length ? round : straight);
}

/**
 * The plans' part (D33, D41): a node's column is its longest path from the root (a plan with no
 * prerequisite is column 1, the Heart column 0); within a path a node takes the free row of its
 * column nearest its in-path parents', so paths stay straight and rarely cross. The research
 * lab's plan (D71, lane `gate`, not a path) stands in its own column right of the block, level
 * with the Heart: each path's last node(s) — its plans in its last column — link into it, the
 * links joining one bus in the room left of it.
 */
function planPart(): { nodes: Spot[]; lanes: Lane[]; links: Link[]; block: Block; gate: GateCol | null; right: number; bottom: number } {
  const depth = new Map<string, number>();
  const d = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const pre = treePrereq(id).filter((p) => !isGate(p));
    const v = pre.length ? 1 + Math.max(...pre.map(d)) : 1;
    depth.set(id, v);
    return v;
  };
  const plans: readonly string[] = PLAN_IDS.filter((id) => !isGate(id));
  const gates: readonly string[] = PLAN_IDS.filter(isGate);
  const maxCol = Math.max(...plans.map(d));
  const row = new Map<string, number>();
  const laneRows = new Map<string, number>();
  for (const lane of PLAN_PATHS) {
    const mine = plans.filter((id) => laneOf(id) === lane).sort((a, b) => d(a) - d(b) || plans.indexOf(a) - plans.indexOf(b));
    const taken = new Map<number, Set<number>>();
    let rows = 1;
    for (const id of mine) {
      const parents = treePrereq(id).filter((p) => row.has(p) && laneOf(p) === lane);
      const r = nearestFree(parents.length ? Math.round(parents.reduce((s, p) => s + row.get(p)!, 0) / parents.length) : 0, taken.get(d(id)) ?? new Set());
      taken.set(d(id), (taken.get(d(id)) ?? new Set<number>()).add(r));
      row.set(id, r);
      rows = Math.max(rows, r + 1);
    }
    laneRows.set(lane, rows);
  }
  const top = PAD + HEAD_H;
  const x0 = PAD + LABEL_W;
  const w = (maxCol + 1) * COL_W - (COL_W - NODE_W);
  const nodes: Spot[] = [], lanes: Lane[] = [];
  let y = top;
  for (const lane of PLAN_PATHS) {
    const h = laneRows.get(lane)! * ROW_H - (ROW_H - NODE_H);
    lanes.push({ id: lane, kind: 'plan', x: x0 - LABEL_W, y, w: LABEL_W + w, h });
    for (const id of plans) if (laneOf(id) === lane) nodes.push({ id, kind: 'plan', lane, x: x0 + d(id) * COL_W, y: y + row.get(id)! * ROW_H, w: NODE_W, h: NODE_H });
    y += h + LANE_GAP + (ROW_H - NODE_H);
  }
  const bottom = y - LANE_GAP - (ROW_H - NODE_H);
  nodes.unshift({ id: ROOT, kind: 'root', lane: '', x: x0, y: Math.round((top + bottom) / 2 - NODE_H / 2), w: NODE_W, h: NODE_H });
  const at = new Map(nodes.map((s) => [s.id, s]));
  const right = x0 + w;
  let gate: GateCol | null = null;
  const gx = right + GATE_GAP;
  gates.forEach((g, k) => {
    const gy = Math.round((top + bottom) / 2 - NODE_H / 2) + k * ROW_H;
    const spot: Spot = { id: g, kind: 'plan', lane: 'gate', x: gx, y: gy, w: GATE_W, h: NODE_H };
    nodes.push(spot);
    at.set(g, spot);
    if (!gate) gate = { id: g, x: gx, y: gy };
  });
  // Plan links (a plan's column is right of its prerequisites': each turns in the gap left of it).
  const plink = (from: string, to: string, path?: PlanLane): Link => {
    const a = at.get(from)!, b = at.get(to)!;
    const gap = path ? GATE_GAP : COL_W - NODE_W;
    return { from, to, gate: false, kind: from === ROOT || laneOf(from) === laneOf(to) ? 'line' : 'cross', d: route(a, b, gap, [], nodes), ...(path ? { path } : {}) };
  };
  const links: Link[] = [];
  for (const id of plans) {
    const pre = treePrereq(id);
    if (!pre.length) links.push(plink(ROOT, id));
    for (const p of pre) links.push(plink(p, id));
  }
  for (const g of gates) for (const lane of PLAN_PATHS) {
    const mine = plans.filter((id) => laneOf(id) === lane);
    const last = Math.max(...mine.map(d));
    for (const id of mine) if (d(id) === last) links.push(plink(id, g, lane));
  }
  return {
    nodes, lanes, links, gate, bottom,
    block: { kind: 'plan', x: PAD - 6, y: PAD - 4, w: LABEL_W + w + 12, h: bottom - PAD + 12 },
    right: gates.length ? gx + GATE_W : right,
  };
}

/** The free row nearest `want` (upwards first on a tie). */
function nearestFree(want: number, used: ReadonlySet<number>): number {
  for (let k = 0; ; k++) {
    if (want - k >= 0 && !used.has(want - k)) return want - k;
    if (!used.has(want + k)) return want + k;
  }
}

/** Every tree node a node needs, its prerequisites' prerequisites included. */
function closureOf(id: string, out = new Set<string>()): Set<string> {
  for (const p of treePrereq(id)) if (!out.has(p)) { out.add(p); closureOf(p, out); }
  return out;
}

/**
 * Research's part (D69, D107), from `x0`: the lanes' labels, then the four tier bands, a gutter
 * between them. Within its tier a node's sub-column is its chain of same-lane, same-tier
 * prerequisites (a family's two depths a tier; the trunk's T2 runs three deep), and the Synthesis
 * (`TIER1_WHOLE`, D93) stands alone in Tier 1's last sub-column: every family's Tier 1 ends left of
 * it, so their links into it join one bus. The trunk's rows: the longest line keeps the top row
 * (Mechanics → Synthesis → Ceramics → Land Registry…), a side node takes the next. A family's lane
 * has one row, or two once it splits: its shared nodes sit between them, each speciality on its own;
 * two shared siblings in one slot take a row each. Tier 1 and Tier 2 stand further apart than the
 * other tiers, the rule between them (D118).
 */
function researchPart(x0: number): { nodes: Spot[]; lanes: Lane[]; links: Link[]; tiers: TierCol[]; tags: TierTag[]; splits: Split[]; rule: number; block: Block; right: number; bottom: number } {
  const ids: readonly string[] = RESEARCH_IDS;
  const R = (id: string) => researchNode(id)!;
  const sub = new Map<string, number>();
  const subOf = (id: string): number => {
    const known = sub.get(id);
    if (known !== undefined) return known;
    const r = R(id);
    const same = r.prereq.filter((p) => { const q = researchNode(p); return !!q && q.branch === r.branch && q.tier === r.tier && p !== TIER1_WHOLE; });
    const v = id === TIER1_WHOLE
      ? 1 + Math.max(0, ...ids.filter((k) => k !== TIER1_WHOLE && R(k).tier === r.tier).map(subOf))
      : same.length ? 1 + Math.max(...same.map(subOf)) : 0;
    sub.set(id, v);
    return v;
  };
  const cols = new Map<ResearchTier, number>(TIERS.map((k) => [k, 1]));
  for (const id of ids) cols.set(R(id).tier, Math.max(cols.get(R(id).tier)!, subOf(id) + 1));
  const tierX = new Map<ResearchTier, number>(), tierW = new Map<ResearchTier, number>();
  let x = x0 + R_LABEL_W, rule = 0;
  for (const k of TIERS) {
    const w = cols.get(k)! * R_COL_W - R_GAP + 2 * TIER_PAD;
    tierX.set(k, x);
    tierW.set(k, w);
    // Tier 1 | Tier 2: the wider gap and its rule (D118).
    if (k === 1) rule = x + w + TIER_SPLIT / 2;
    x += w + (k === 1 ? TIER_SPLIT : TIER_GUTTER);
  }
  const right = x - TIER_GUTTER;
  const nx = (id: string): number => tierX.get(R(id).tier)! + TIER_PAD + subOf(id) * R_COL_W;

  // The trunk's rows: column by column, the node with the most to come first, nearest its parents.
  const trunk = ids.filter((id) => R(id).branch === 'trunk');
  const kids = (id: string): number => trunk.filter((k) => R(k).prereq.includes(id)).reduce((s, k) => s + 1 + kids(k), 0);
  const order = [...trunk].sort((a, b) => R(a).tier - R(b).tier || subOf(a) - subOf(b) || kids(b) - kids(a) || trunk.indexOf(a) - trunk.indexOf(b));
  const trow = new Map<string, number>();
  const taken = new Map<string, Set<number>>();
  let trunkRows = 1;
  for (const id of order) {
    const parents = R(id).prereq.filter((p) => trow.has(p));
    const key = `${R(id).tier}:${subOf(id)}`;
    const used = taken.get(key) ?? new Set<number>();
    const r = nearestFree(parents.length ? Math.round(parents.reduce((s, p) => s + trow.get(p)!, 0) / parents.length) : 0, used);
    taken.set(key, used.add(r));
    trow.set(id, r);
    trunkRows = Math.max(trunkRows, r + 1);
  }

  const top = PAD + HEAD_H;
  const nodes: Spot[] = [], lanes: Lane[] = [], tags: TierTag[] = [], splits: Split[] = [];
  let y = top + TIER_HEAD_H + R_LANE_GAP;
  for (const lane of RESEARCH_LANES) {
    const mine = ids.filter((id) => R(id).branch === lane);
    let h: number;
    if (lane === 'trunk') {
      h = trunkRows * R_ROW_H - (R_ROW_H - R_NODE_H);
      for (const id of mine) nodes.push({ id, kind: 'research', lane, x: nx(id), y: y + trow.get(id)! * R_ROW_H, w: R_NODE_W, h: R_NODE_H });
    } else {
      const specs = Object.keys(FAMILIES[lane].specs ?? {});
      const split = specs.length > 1;
      // Shared nodes (no speciality) in the same slot — siblings of one parent at one depth, such as
      // Logistics' Long Bridges and Far Claim — take a row each, top first, instead of one spot; a
      // lone one is centred in its lane.
      const slot = (id: string): string => `${R(id).tier}:${subOf(id)}`;
      const shared = new Map<string, string[]>();
      for (const id of mine) if (specs.indexOf(R(id).spec ?? '') < 0) shared.set(slot(id), [...(shared.get(slot(id)) ?? []), id]);
      const rows = Math.max(split ? 2 : 1, ...[...shared.values()].map((g) => g.length));
      h = rows * R_NODE_H + (rows - 1) * R_SPLIT;
      for (const id of mine) {
        const k = specs.indexOf(R(id).spec ?? '');
        const g = shared.get(slot(id));
        const row = k >= 0 ? k : g && g.length > 1 ? g.indexOf(id) : -1;
        nodes.push({ id, kind: 'research', lane, x: nx(id), y: row < 0 ? y + (h - R_NODE_H) / 2 : y + row * (R_NODE_H + R_SPLIT), w: R_NODE_W, h: R_NODE_H });
      }
      const mid = y + R_NODE_H + R_SPLIT / 2;
      for (const k of TIERS) {
        const tx = tierX.get(k)! + 12;
        if (split && k >= 3) {
          tags.push({ lane, tier: k, spec: specs[0]!, x: tx, y: y - R_BAND });
          tags.push({ lane, tier: k, spec: specs[1]!, x: tx, y: mid });
        } else tags.push({ lane, tier: k, spec: null, x: tx, y: y - R_BAND });
      }
      if (split) splits.push({ lane, x: tierX.get(3)! + 4, w: right - tierX.get(3)! - 4, y: mid });
    }
    lanes.push({ id: lane, kind: 'research', x: x0, y, w: right - x0, h });
    y += h + R_LANE_GAP;
  }
  const bottom = y - R_LANE_GAP + R_BAND + 4;
  // Links (D107): a lineage within its lane; from another lane, only what the node does not already
  // need through another of its prerequisites (the Synthesis takes each family's last Tier 1 node,
  // not all of them); a tier's gate apart, drawn while the node it opens is selected. The
  // lab's plan, which opens Tier 1, is named by its head alone (its links would cross the labels).
  const at = new Map(nodes.map((s) => [s.id, s]));
  const links: Link[] = [];
  for (const id of ids) {
    const r = R(id);
    const pre = r.prereq.filter(isResearch);
    for (const p of pre) {
      const kind: Link['kind'] = R(p).branch === r.branch ? 'line' : p === TIER_GATE[r.tier] ? 'gate' : 'cross';
      if (kind === 'cross' && pre.some((q) => q !== p && closureOf(q).has(p))) continue;
      const a = at.get(p)!, b = at.get(id)!;
      // Going round: the channel next to the target's lane on the source's side first, then the
      // one next to the source's lane, then any other (nearest the target first).
      const lb = lanes.find((l) => l.id === r.branch)!, la = lanes.find((l) => l.id === R(p).branch)!;
      const above = (l: Lane): number => l.y - R_LANE_GAP / 2, below = (l: Lane): number => l.y + l.h + R_LANE_GAP / 2;
      const first = a.y < b.y ? [above(lb), below(la)] : [below(lb), above(la)];
      const rest = lanes.filter((l) => l.kind === 'research').flatMap((l) => [above(l), below(l)]).sort((u, v) => Math.abs(u - b.y) - Math.abs(v - b.y));
      links.push({ from: p, to: id, gate: kind === 'gate', kind, d: route(a, b, R_GAP, [...first, ...rest], nodes) });
    }
  }
  return {
    nodes, lanes, links, tags, splits, rule, right, bottom,
    tiers: TIERS.map((k) => ({ tier: k, x: tierX.get(k)!, w: tierW.get(k)!, y: top, h: bottom - top })),
    block: { kind: 'research', x: x0 - 6, y: PAD - 4, w: right - x0 + 12, h: bottom - PAD + 8 },
  };
}

/** Where every node goes, from content alone: the plans' block, then research's right of it. */
export function treeLayout(): TreeLayout {
  const P = planPart();
  const R = researchPart(P.right + BLOCK_GAP + 6);
  return {
    nodes: [...P.nodes, ...R.nodes], lanes: [...P.lanes, ...R.lanes], links: [...P.links, ...R.links],
    blocks: [P.block, R.block], tiers: R.tiers, tags: R.tags, splits: R.splits, gate: P.gate,
    rule: { x: R.rule, y: PAD + HEAD_H, h: R.bottom - PAD - HEAD_H },
    w: R.right + PAD, h: Math.max(P.bottom, R.bottom) + PAD,
  };
}

// ── zoom (D111) ─────────────────────────────────────────────────────────────

/** The closest the tree zooms in: a little past its own size. */
export const ZOOM_MAX = 1.25;
/** The farthest it ever zooms out, whatever the window (the whole tree's fit is usually above). */
export const ZOOM_FLOOR = 0.08;

/** The zoom at which the whole tree fits a view of this size (never above its own size). */
export function fitZoom(viewW: number, viewH: number, L: Pick<TreeLayout, 'w' | 'h'>): number {
  return Math.max(ZOOM_FLOOR, Math.min(1, viewW / L.w, viewH / L.h));
}

/**
 * How much a card shows at a zoom: `near` all of it; `mid` its icon and its name, larger, on two
 * lines (what it costs is too small to read); `far` its icon alone (its name in its tooltip): the
 * tree reads as a map, its tiers and lanes named by the pinned titles.
 */
export function zoomLevel(z: number): 'near' | 'mid' | 'far' {
  return z >= 0.7 ? 'near' : z >= 0.36 ? 'mid' : 'far';
}

/**
 * A node's chain (D107): what it needs and what needs it, all the way, but through the gates
 * (the lab's plan into Tier 1, a trunk node opening a tier): a gate the node needs is in its chain,
 * not what the gate needs; what a gate opens is not in the gate's chain. Hovering a node lights its
 * chain and fades the rest.
 */
export function chainOf(id: string): { nodes: Set<string>; links: Set<string> } {
  const nodes = new Set<string>([id]), links = new Set<string>();
  const gateFor = (p: string, child: string): boolean => {
    const r = researchNode(child);
    return !!r && (p === LAB_PLAN || (p === TIER_GATE[r.tier] && researchNode(p)?.branch !== r.branch));
  };
  const up = (n: string): void => {
    for (const p of treePrereq(n)) {
      links.add(`${p}>${n}`);
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
  return { nodes, links };
}

let CHILDREN: Map<string, string[]> | null = null;
/** The tree nodes that need this one (plans and research). */
function childrenOf(id: string): readonly string[] {
  if (!CHILDREN) {
    CHILDREN = new Map();
    for (const n of [...PLAN_IDS, ...RESEARCH_IDS]) for (const p of treePrereq(n)) CHILDREN.set(p, [...(CHILDREN.get(p) ?? []), n]);
  }
  return CHILDREN.get(id) ?? [];
}

// ── what a node unlocks ─────────────────────────────────────────────────────

/** A glyph drawn in code for what has no building or item: the analytics readouts (D41), the market's ◉, the land (D60), research's features (D70). */
type Glyph = 'telemetry' | 'ledger' | 'power' | 'gauge' | 'coin' | 'land'
  | 'floor' | 'plan' | 'express' | 'rental' | 'queue' | 'forecast' | 'resale' | 'crossing' | 'far';
type Icon = { b: string } | { i: string } | { g: Glyph };

/** What stands for an effect on the tree: the building or item it improves, or a glyph (one or two icons). */
const EFFECT_ICON: Readonly<Record<string, Icon | readonly Icon[]>> = {
  digSpeed: { b: 'excavator' }, rubbleYield: { i: 'stone' }, embeddedOre: { i: 'iron_ore' }, excavatedSpeed: { b: 'excavator' },
  digH3: [{ b: 'excavator' }, { i: 'stone' }], digH4: [{ b: 'excavator' }, { i: 'stone' }], basaltBits: { b: 'excavator' },
  deepFill: [{ b: 'backfiller' }, { i: 'water' }], tunnels: { b: 'ribbon' },
  // The land (D60): leases (Land Registry's flag), prices, rents, how each purchase raises the next, far land.
  lease: { g: 'land' }, landPrice: { g: 'land' }, landRent: { g: 'land' }, landGrowth: { g: 'land' }, farLand: { g: 'land' },
  neighbourCrossing: { g: 'crossing' }, farClaims: { g: 'far' },
  remoteBeltCost: { b: 'ribbon' }, remoteBuildDelay: { b: 'mast' }, pylonLink: { b: 'pylon' },
  ring3Caps: { b: 'deep_bore' }, bridgeSpan: { b: 'skybridge' }, forkFilters: { b: 'router' },
  craftSpeed: { i: 'gear' },
  windOut: { b: 'wind_flower' }, gustVariance: { b: 'wind_flower' }, stormHarvest: { b: 'wind_flower' }, solarOut: { b: 'sun_bulb' },
  accCap: { b: 'accumulator' }, accRate: { b: 'accumulator' }, geoOut: { b: 'fumarole_tap' },
  deepHeat: { b: 'fumarole_tap' }, genOut: { b: 'brazier' },
  // Trade and tokens (D68, D70).
  tradeFee: { g: 'coin' }, slippage: { g: 'coin' }, forwards: { g: 'coin' }, charters: { g: 'coin' },
  forecast: { g: 'forecast' }, floorPrices: { g: 'floor' }, tokenPlan: { g: 'plan' }, expressFreight: { g: 'express' },
  serverRental: [{ g: 'rental' }, { b: 'server' }],
  deliveryDelay: { b: 'trade_post' }, orders: { b: 'trade_post' }, tradeL2: { b: 'trade_post' }, tradeL3: { b: 'trade_post' },
  post2: { b: 'trade_post' }, post3: { b: 'trade_post' }, crierHouse: { b: 'trade_post' },
  // Research itself: a slot, the queue, the Core's data (D68).
  slots: { b: 'observatory' }, researchQueue: [{ g: 'queue' }, { b: 'observatory' }], heartData: [{ b: 'hearth' }, { i: 'journal_1' }],
  // The analytics path's readouts (D41), by their flags.
  telemetry: { g: 'telemetry' }, statistics: { g: 'ledger' }, power_log: { g: 'power' }, diagnostics: { g: 'gauge' },
};

const recipesOf = (id: string): RecipeDef[] => (Object.values(RECIPES) as RecipeDef[]).filter((r) => r.unlock === id);
const effectsOf = (id: string): readonly Effect[] => planDef(id)?.effects ?? researchNode(id)?.effects ?? [];
const heartLevelOf = (id: string): number => BAL.hearthUpgrades.findIndex((u) => u.unlock === id) + 2; // 1: none
const startBuildings = (): string[] => BUILDING_IDS.filter((b) => buildingDef(buildingIdx(b)).unlock === 'start');
/** An effect's key: its flag, `slots`, or its target. */
const effectKey = (ef: Effect): string => (ef.k === 'flag' ? ef.flag : ef.k === 'slots' ? 'slots' : ef.k === 'unlock' ? '' : ef.target);
/** How much an effect adds, in the player's units (data files a minute for the Core's data; tiles, orders, slots). */
const effectAmount = (ef: Effect): number => (ef.k === 'slots' ? ef.add : ef.k === 'add' ? (ef.target === 'heartData' ? ef.v / 1000 : ef.v) : 0);

/** The icons of what a node unlocks, most telling first (buildings, recipes' items, the Heart, effects); three at most. */
function iconsOf(id: string): Icon[] {
  if (id === ROOT) return [{ b: 'hearth' }, ...startBuildings().map((b) => ({ b }))].slice(0, 3); // the Heart, its kit
  const out: Icon[] = buildingsUnlockedBy(id).map((b) => ({ b }));
  for (const r of recipesOf(id)) out.push({ i: r.outs[0]![0] });
  if (heartLevelOf(id) > 1) out.push({ b: 'hearth' });
  for (const ef of effectsOf(id)) {
    const ic = EFFECT_ICON[effectKey(ef)];
    if (ic) out.push(...(Array.isArray(ic) ? ic : [ic as Icon]));
  }
  const seen = new Set<string>();
  const uniq = out.filter((ic) => { const k = JSON.stringify(ic); if (seen.has(k)) return false; seen.add(k); return true; });
  return (uniq.length ? uniq : [{ b: 'observatory' } as Icon]).slice(0, 3);
}

/**
 * A glyph inked on a paper card. The analytics readouts (D41): telemetry — three bars and a rising
 * line; the ledger — ruled rows with a coral tab; the power log — a bolt over a jagged line; the
 * diagnostics — a dial leaning to coral. The land (D60): parcels, the claim's washed turquoise, a
 * neighbouring base's hatched coral, a boundary stone; resale — the parcels and a coin; crossing — a
 * ribbon through the neighbour's parcels; far — a parcel away from the claim's, a dashed way to it.
 * Research's features (D70): a price line held by a coral floor; a token stamped ½ (the Compute
 * Plan); a crate with speed lines (express freight); a server rack and a coin (rental); three
 * queued slabs, the first running; a price line going on dashed past « now » (forecast).
 */
function glyph(kind: Exclude<Glyph, 'coin'>, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(size * 2);
  const g = c.getContext('2d')!;
  const s = c.width / 40;
  const line = (pts: ReadonlyArray<readonly [number, number]>, color: string, w: number, dash?: readonly number[]): void => {
    g.strokeStyle = color; g.lineWidth = w * s; g.setLineDash(dash ? dash.map((v) => v * s) : []); g.beginPath();
    pts.forEach(([x, y], k) => (k ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s)));
    g.stroke();
    g.setLineDash([]);
  };
  const box = (x: number, y: number, w: number, h: number, fill: string, lw = 1.6): void => {
    g.fillStyle = fill; g.strokeStyle = C.ink; g.lineWidth = lw * s;
    g.beginPath(); g.roundRect(x * s, y * s, w * s, h * s, 1.4 * s); g.fill(); g.stroke();
  };
  const coin = (x: number, y: number, r: number): void => {
    g.fillStyle = C.warn; g.strokeStyle = C.ink; g.lineWidth = 1.5 * s;
    g.beginPath(); g.arc(x * s, y * s, r * s, 0, Math.PI * 2); g.fill(); g.stroke();
    g.lineWidth = 1.1 * s; g.beginPath(); g.arc(x * s, y * s, r * 0.55 * s, 0, Math.PI * 2); g.stroke();
    g.fillStyle = C.ink; g.beginPath(); g.arc(x * s, y * s, r * 0.18 * s, 0, Math.PI * 2); g.fill();
  };
  /** The parcels (3 × 3 from x0, y0, k a side): `held` washed turquoise, `theirs` hatched coral (a neighbouring base's). */
  const parcels = (x0: number, y0: number, k: number, held: ReadonlyArray<readonly [number, number]>, theirs: ReadonlyArray<readonly [number, number]>): void => {
    for (let i = 1; i < 3; i++) { line([[x0 + i * k, y0], [x0 + i * k, y0 + 3 * k]], C.inkSoft, 1); line([[x0, y0 + i * k], [x0 + 3 * k, y0 + i * k]], C.inkSoft, 1); }
    g.fillStyle = C.turqL;
    for (const [cx, cy] of held) g.fillRect((x0 + cx * k + 0.6) * s, (y0 + cy * k + 0.6) * s, (k - 1.2) * s, (k - 1.2) * s);
    for (const [cx, cy] of theirs) for (let d = 2; d < 2 * k; d += 3) {
      const bx = x0 + cx * k, by = y0 + cy * k;
      line([[bx + Math.max(0, d - k), by + Math.min(d, k)], [bx + Math.min(d, k), by + Math.max(0, d - k)]], C.coral, 1.2);
    }
  };
  /** A hexagonal token (D68) centred at (x, y), radius r, with its spark. */
  const token = (x: number, y: number, r: number): void => {
    g.fillStyle = C.lilacL; g.strokeStyle = C.ink; g.lineWidth = 1.8 * s; g.beginPath();
    for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; (k ? g.lineTo : g.moveTo).call(g, (x + Math.cos(a) * r) * s, (y + Math.sin(a) * r) * s); }
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = C.lilacD; g.beginPath();
    const q = r * 0.55, p = r * 0.16;
    for (const [px, py, k] of [[x, y - q, 0], [x + p, y - p, 1], [x + q, y, 1], [x + p, y + p, 1], [x, y + q, 1], [x - p, y + p, 1], [x - q, y, 1], [x - p, y - p, 1]] as const) (k ? g.lineTo(px * s, py * s) : g.moveTo(px * s, py * s));
    g.closePath(); g.fill();
  };
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.fillStyle = C.paper; g.strokeStyle = C.ink; g.lineWidth = 2.4 * s;
  g.beginPath(); g.roundRect(4 * s, 5 * s, 32 * s, 30 * s, 5 * s); g.fill(); g.stroke();
  if (kind === 'telemetry') {
    const bars: Array<[number, number, string]> = [[10, 14, C.turqL], [18, 10, C.turq], [26, 18, C.turqD]];
    g.lineWidth = 1.6 * s;
    for (const [x, h, col] of bars) { g.fillStyle = col; g.fillRect(x * s, (31 - h) * s, 5 * s, h * s); g.strokeRect(x * s, (31 - h) * s, 5 * s, h * s); }
    line([[9, 22], [17, 17], [24, 19], [32, 10]], C.coralD, 2.4);
    g.fillStyle = C.coral; g.beginPath(); g.arc(32 * s, 10 * s, 2.6 * s, 0, Math.PI * 2); g.fill();
  } else if (kind === 'ledger') {
    g.fillStyle = C.coral; g.fillRect(27 * s, 5 * s, 5 * s, 9 * s);
    g.lineWidth = 1.4 * s; g.strokeRect(27 * s, 5 * s, 5 * s, 9 * s);
    for (const [y, w] of [[13, 15], [19, 22], [25, 18], [30, 22]] as const) {
      line([[9, y], [9 + w, y]], C.inkSoft, 1.8);
      g.fillStyle = C.turqD; g.fillRect((9 + w + 1.5) * s, (y - 1.4) * s, 2.8 * s, 2.8 * s);
    }
  } else if (kind === 'land' || kind === 'resale') {
    // Three by three parcels; the middle column and the top-left held, one hatched for a neighbouring base.
    const x0 = 8, y0 = 9, k = 8;
    parcels(x0, y0, k, [[0, 0], [1, 0], [1, 1], [1, 2]], [[2, 2]]);
    line([[x0, y0], [x0 + 2 * k, y0], [x0 + 2 * k, y0 + 3 * k], [x0 + k, y0 + 3 * k], [x0 + k, y0 + k], [x0, y0 + k], [x0, y0]], C.turqD, 2.2);
    if (kind === 'resale') coin(29, 28, 5.6);
    else {
      g.fillStyle = C.paperD; g.strokeStyle = C.ink; g.lineWidth = 1.4 * s;
      g.beginPath(); g.moveTo(29 * s, 4 * s); g.lineTo(33 * s, 4 * s); g.lineTo(34 * s, 10 * s); g.lineTo(28 * s, 10 * s); g.closePath(); g.fill(); g.stroke();
    }
  } else if (kind === 'crossing') {
    // The claim's column on the left, a neighbouring base's hatched beside it, a ribbon running through both.
    const x0 = 8, y0 = 9, k = 8;
    parcels(x0, y0, k, [[0, 0], [0, 1], [0, 2]], [[1, 0], [1, 1], [1, 2], [2, 0], [2, 2]]);
    line([[x0, y0], [x0 + k, y0], [x0 + k, y0 + 3 * k], [x0, y0 + 3 * k], [x0, y0]], C.turqD, 2);
    g.fillStyle = C.steelL; g.strokeStyle = C.ink; g.lineWidth = 1.3 * s;
    g.beginPath(); g.rect(6 * s, 18.6 * s, 28 * s, 4.8 * s); g.fill(); g.stroke();
    for (let xx = 9; xx < 33; xx += 4) line([[xx, 19.4], [xx + 1.6, 21], [xx, 22.6]], C.ink, 0.9);
  } else if (kind === 'far') {
    // The claim's parcel at the bottom left, another far up right, a dashed way between them.
    box(7, 21, 11, 11, C.turqL, 2);
    box(23, 8, 10, 10, C.turqL, 2);
    line([[18, 24], [24, 21], [27, 18]], C.inkSoft, 1.6, [2, 2.4]);
    g.fillStyle = C.coralD; g.beginPath(); g.arc(28 * s, 13 * s, 1.8 * s, 0, Math.PI * 2); g.fill();
  } else if (kind === 'floor') {
    // A price line falls and holds on the coral floor; the coin it is worth above.
    line([[7, 27], [33, 27]], C.coralD, 2.2, [3, 2.4]);
    line([[8, 11], [13, 16], [17, 13], [22, 24.5], [32, 24.5]], C.turqD, 2.4);
    coin(29, 12.5, 4.6);
  } else if (kind === 'plan') {
    // A token stamped ½: half the price.
    token(16, 20, 9.5);
    g.fillStyle = C.coralD; g.font = `700 ${13 * s}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('½', 29.5 * s, 27.5 * s);
  } else if (kind === 'express') {
    // A crate on its way, three speed lines behind it.
    box(17, 12, 15, 15, C.peach, 1.8);
    line([[17, 19.5], [32, 19.5]], C.ink, 1.2);
    line([[24.5, 12], [24.5, 27]], C.ink, 1.2);
    for (const [y, x] of [[14, 8], [19.5, 6], [25, 9]] as const) line([[x, y], [14, y]], C.turqD, 2);
  } else if (kind === 'rental') {
    // The claim's server rack, and the coin its idle tokens bring back.
    for (const y of [9, 16, 23]) {
      box(8, y, 16, 6, C.lilacL, 1.5);
      g.fillStyle = C.turq; g.beginPath(); g.arc(20.5 * s, (y + 3) * s, 1.2 * s, 0, Math.PI * 2); g.fill();
      line([[10.5, y + 3], [16, y + 3]], C.inkSoft, 1);
    }
    coin(29.5, 27, 5.2);
  } else if (kind === 'queue') {
    // Three slabs: the running one in turquoise, the next two waiting, an arrow into the queue.
    box(14, 8, 19, 6, C.turq, 1.6);
    box(14, 17, 19, 6, C.paperD, 1.6);
    box(14, 26, 19, 6, C.paperD, 1.6);
    g.fillStyle = C.coralD; g.beginPath(); g.moveTo(7 * s, 16.5 * s); g.lineTo(11.5 * s, 20 * s); g.lineTo(7 * s, 23.5 * s); g.closePath(); g.fill();
  } else if (kind === 'forecast') {
    // Axes; the price so far in ink, then on past « now » (dotted) as a dashed turquoise guess.
    line([[8, 9], [8, 31], [33, 31]], C.inkSoft, 1.4);
    line([[9, 26], [13, 21], [17, 24], [21, 17]], C.ink, 2.2);
    line([[21, 9], [21, 30]], C.inkSoft, 1, [1, 2.2]);
    line([[21, 17], [26, 14], [32, 9]], C.turqD, 2.2, [2.6, 2]);
    g.fillStyle = C.coral; g.beginPath(); g.arc(32 * s, 9 * s, 2.4 * s, 0, Math.PI * 2); g.fill();
  } else if (kind === 'power') {
    line([[8, 30], [13, 24], [17, 27], [22, 20], [26, 23], [32, 16]], C.turqD, 2.2);
    g.fillStyle = C.warn; g.strokeStyle = C.ink; g.lineWidth = 1.6 * s; g.beginPath();
    for (const [x, y, k] of [[22, 7, 0], [13, 19, 1], [19, 19, 1], [16, 29, 1], [27, 15, 1], [21, 15, 1], [22, 7, 1]] as const) (k ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s));
    g.fill(); g.stroke();
  } else {
    // The dial: an arc in three tones, its ticks, the needle leaning to the coral end.
    const cx = 20 * s, cy = 27 * s, r = 11 * s;
    for (const [a0, a1, col] of [[Math.PI, Math.PI * 1.4, C.turq], [Math.PI * 1.4, Math.PI * 1.7, C.warn], [Math.PI * 1.7, Math.PI * 2, C.coral]] as const) {
      g.strokeStyle = col; g.lineWidth = 4 * s; g.lineCap = 'butt'; g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
    }
    g.lineCap = 'round'; g.strokeStyle = C.ink; g.lineWidth = 1.5 * s; g.beginPath(); g.arc(cx, cy, r + 2.6 * s, Math.PI, Math.PI * 2); g.stroke();
    const a = Math.PI * 1.78;
    line([[20, 27], [20 + Math.cos(a) * 12, 27 + Math.sin(a) * 12]], C.ink, 2.2);
    g.fillStyle = C.ink; g.beginPath(); g.arc(cx, cy, 2.4 * s, 0, Math.PI * 2); g.fill();
  }
  return c;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Small inked marks that sit in a line of text (sized in em by the CSS): an AI token (a lilac
 * hexagon with its spark, D68), a closed padlock (a tier not open yet: its gate, the Core's level).
 */
function mark(kind: 'token' | 'lock'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', `tr-mark tr-mark-${kind}`);
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag: string, attrs: Record<string, string>): void => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
  };
  if (kind === 'token') {
    add('polygon', { class: 'm-hex', points: '8,1.3 14,4.7 14,11.3 8,14.7 2,11.3 2,4.7' });
    add('path', { class: 'm-spark', d: 'M8 4.4L9 7l2.6 1L9 9l-1 2.6L7 9 4.4 8 7 7z' });
  } else {
    add('path', { class: 'm-shackle', d: 'M5 7.4V5.2a3 3 0 0 1 6 0v2.2' });
    add('rect', { class: 'm-body', x: '3.2', y: '7.2', width: '9.6', height: '7', rx: '1.6' });
  }
  return svg;
}

/** A big count, compact from `from` on: « 800 », « 2,4 k », « 82 k », « 1,2 M », « 46 M » (one decimal under 10 k and under 10 M). */
function shortNum(n: number, from = 1000): string {
  if (n >= 999_500) return t('tree.rs.m', { v: num(n >= 9_950_000 ? Math.round(n / 1e6) : Math.round(n / 1e5) / 10) });
  if (n >= from) return t('tree.rs.k', { v: num(n >= 9_950 ? Math.round(n / 1000) : Math.round(n / 100) / 10) });
  return num(Math.round(n));
}

/** AI tokens, compact: « 800 », « 12,5 k », « 1,2 M ». */
const tokShort = (n: number): string => shortNum(n);

/** What `tokens` cost at CrierBelt now (centi-◉, the sim's own rounding). */
const tokenCents = (sim: Sim, tokens: number): number => Math.ceil((tokens * sim.tokenPriceK()) / 1000);

/** « ≈ 250 ◉ », « ≈ 60 k ◉ »: a price at a glance. */
function ocApprox(cents: number): string {
  const v = cents / 100;
  return t('tree.rs.oc', { v: shortNum(v, 10_000) });
}

/** A feature's words (`tree.feat.<key>` and its line `.what`), or null when the dictionary has none. */
function featureText(key: string, amount: number): { label: string; what: string } | null {
  const label = tr(`tree.feat.${key}`);
  if (label.startsWith('⟦')) return null;
  const what = tr(`tree.feat.${key}.what`, { n: amount });
  return { label, what: what.startsWith('⟦') ? '' : what };
}

/** What the expertises leave of each family's research (D93): the research costs follow it. */
const famSig = (sim: Sim): string => FAMILY_IDS.map((f) => { const m = sim.mods.fam[f]; return `${m.time},${m.tokens},${m.data}`; }).join(';');

/** A research node's tier (1 for anything else). */
const tierOf = (id: string): ResearchTier => researchNode(id)?.tier ?? 1;

/** The research labs, in entity order (their number on the screen: « Labo 1 »…). */
function labsOf(sim: Sim): Array<{ id: number; def: string; n: number }> {
  return sim.ents.sorted().filter((e) => BUILDING_KIND[e.def] === 'lab').map((e, k) => ({ id: e.id, def: BUILDING_IDS[e.def]!, n: k + 1 }));
}

// ── the screen ──────────────────────────────────────────────────────────────


interface NodeView {
  spot: Spot;
  node: HTMLElement;
  cost: HTMLElement;
  /** Plans: the cost chips (their item and amount), to mark the ones the Heart lacks. */
  chips: Array<{ item: number; mu: number; node: HTMLElement }>;
  /** Research: its tokens and their price (from Tier 2, D118), the queue's tag. */
  tok: HTMLElement | null;
  qtag: HTMLElement | null;
  bar: HTMLElement | null;
  unlock: HTMLButtonElement | null;
}

/** A research lane's label and its count. */
interface LaneHead { label: HTMLElement; count: HTMLElement }

/** This viewer's zoom of the tree (D111), in this browser only. */
const ZOOM_STORE = makeStore<{ version: number; zoom: number }>('filon.tree.zoom.v1', 1, () => ({ version: 1, zoom: 1 }));
/** One step of the buttons and keys. */
const ZOOM_STEP = 1.25;

/** « Tout voir »: four corners round a frame. */
function fitGlyph(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'tr-fitglyph');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4');
  svg.append(path);
  return svg;
}

export class ResearchScreen {
  readonly root: HTMLElement;
  private readonly layout = treeLayout();
  private readonly views = new Map<string, NodeView>();
  private readonly paths: Array<{ link: Link; path: SVGPathElement }> = [];
  private readonly heads = new Map<string, LaneHead>();
  /** The plan paths' labels (D41): the label (its tooltip) and its « n/of » unlocked. */
  private readonly pathHeads = new Map<PlanLane, { label: HTMLElement; count: HTMLElement }>();
  /**
   * The tier bands: the head (what opens it, the selected node's tier), its gate's pill, the Core's
   * level it needs (D118: its chip, null for Tier 1), its stripe and its pinned name — the last three
   * padlocked and hatched while the Core is below that level.
   */
  private readonly tierHeads = new Map<ResearchTier, { head: HTMLElement; gate: HTMLElement; core: HTMLElement | null; col: HTMLElement; pin: HTMLElement | null }>();
  /** The rule between Tier 1 and Tier 2 (D118). */
  private tierRule: HTMLElement | null = null;
  /** The launch dialog of a Tier 2+ node (D118): how many tokens a minute to buy. */
  private readonly launch: LaunchDialog;
  /** The research lab's gate (D71): its caption and its « n/N » plans taken. */
  private gateHead: { id: string; cap: HTMLElement; count: HTMLElement } | null = null;
  private readonly view: HTMLElement;
  /** The canvas (rebuilt with the language), whose `data-chain` fades what the focused node's chain leaves out. */
  private canvas: HTMLElement | null = null;
  /**
   * The node the player selected (owner, 2026-10-17: « il faut que le "focus" sur une tech se fasse
   * quand le joueur sélectionne une tech, pas au hover »): its chain lit, the rest faded, until they
   * select another, click the empty tree or press Esc. A click, a tap or Enter on a card; the tree's
   * own choice on opening (its first plan to take, the guide's node) shows its detail, not a focus.
   */
  private focused: string | null = null;
  /** The node whose chain is painted (undefined: none painted since the canvas was built). */
  private chainFor: string | null | undefined = undefined;
  // The header: plans' restart reserve and research's strip (D68–D70).
  private readonly slotsEl = el('span.rs-slots');
  private slotsSig = '';
  private readonly labsText = el('span');
  private readonly labsEl: HTMLElement;
  private readonly billEl: HTMLElement;
  private readonly bill: Record<'label' | 'used' | 'own' | 'bought' | 'cents' | 'rental', HTMLElement>;
  private readonly heldEl = el('span.rs-held', { hidden: '' });
  private readonly planEl = el<'button'>('button.rs-plan', { type: 'button', hidden: '', onclick: () => this.togglePlan() });
  /** The Compute Plan's comparison beside its switch (D102): what the tokens bought would cost an hour without it and with it, its fee in. */
  private readonly planCmp = el('span.rs-plancmp', { hidden: '' });
  private readonly qheadEl = el('span.rs-qhead', { hidden: '' });
  private qheadSig = '';
  private readonly notesEl = el('span.rs-notes');
  /** CrierBelt's restart reserve (D36): what the Heart's stock must keep, while the buildings do not cover it. */
  private readonly reserveEl = el('span.rs-reserve');
  private reserveSig = '';
  private readonly detail = el('aside.rs-detail.cartouche');
  private selected = '';
  /** What the research costs were computed for (null: not yet — a new base has nothing done, which is a signature too). */
  private costSig: string | null = null;
  /** The detail pane's live parts (costs held, progress, the labs' lines), run at each refresh. */
  private detailLive: Array<(sim: Sim) => void> = [];
  private detailSig = '';
  /** A plan just unlocked: its node stamps « ✓ » for a moment. */
  private just: { id: string; until: number } | null = null;
  /** Dragging the canvas: where it started, and whether it moved (a drag is not a click). */
  private drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
  private dragged = false;
  /**
   * The zoom (D111; owner, 2026-10-17: « je veux pouvoir dézoomer dans le tech tree »): 1 its own
   * size, down to the whole tree in the view (`fitZoom`), up to `ZOOM_MAX`; this viewer's last,
   * kept in this browser (a convenience: `filon.tree.zoom.v1`).
   */
  private zoom = ZOOM_STORE.load().zoom;
  private zoomSave = 0;
  /** The fingers on the view (D96): two pinch the zoom about their middle. */
  private readonly fingers = new Map<number, { x: number; y: number }>();
  private pinch: { d0: number; z0: number } | null = null;
  /** The corner's zoom bar: « − », the zoom (a click: 100 %), « + », « Tout voir ». */
  private readonly zoomPct = el<'button'>('button.tr-zbtn.tr-zpct', { type: 'button', 'data-tree-zoom': 'reset', onclick: () => this.setZoom(1) });
  private readonly zoomOut = el<'button'>('button.tr-zbtn', { type: 'button', 'data-tree-zoom': 'out', onclick: () => this.setZoom(this.zoom / ZOOM_STEP) }, '−');
  private readonly zoomIn = el<'button'>('button.tr-zbtn', { type: 'button', 'data-tree-zoom': 'in', onclick: () => this.setZoom(this.zoom * ZOOM_STEP) }, '+');
  private readonly zoomFit = el<'button'>('button.tr-zbtn.tr-zfit', { type: 'button', 'data-tree-zoom': 'fit', onclick: () => this.fit() }, [fitGlyph()]);
  /** The tiers' and lanes' names pinned over the view while the cards are small (D111): always at reading size. */
  private readonly pins = el('div.tr-pins', { 'aria-hidden': 'true' });
  private pinEls: Array<{ el: HTMLElement; kind: 'tier' | 'lane'; x: number; y: number; w: number; h: number }> = [];
  private pinFrame = 0;

  /** The language the canvas was built in: a switch rebuilds it (names and labels are written once). */
  private builtIn: Loc | null = null;
  private readonly title = el('h1.lettering');
  private readonly dragHint = el('small.tr-drag');

  constructor(private readonly atlas: Atlas, private readonly host: ResearchHost) {
    this.view = el('div.tr-view', {
      onpointerdown: (e: PointerEvent) => this.dragStart(e),
      onpointermove: (e: PointerEvent) => this.dragMove(e),
      onpointerup: (e: PointerEvent) => this.dragEnd(e),
      onpointercancel: (e: PointerEvent) => this.dragEnd(e),
      onwheel: (e: WheelEvent) => this.wheel(e),
      onscroll: () => this.schedulePins(),
      // A click on the empty tree (not the end of a drag) lets the focus go.
      onclick: (e: MouseEvent) => { if (!this.dragged && !(e.target as Element).closest('.tr-node, button')) this.unfocus(); },
    });
    // A window resized (or the pane folded under the tree, D96): the whole tree's fit moves.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (this.root.isConnected) this.setZoom(this.zoom); }).observe(this.view);
    this.labsEl = el('span.rs-labs', {}, [buildingIcon(atlas, 'observatory', 18), this.labsText]);
    this.launch = new LaunchDialog(atlas, { sim: () => host.sim(), dataRate: (item) => host.dataRate?.(item) ?? null, launch: (id, buy) => this.begin(id, buy) });
    this.bill = {
      label: el('small'), used: el('span.v'), own: el('span.v'), bought: el('span.v'), cents: el('span.rs-bcost'), rental: el('span.rs-brent'),
    };
    this.billEl = el('span.rs-bill', { hidden: '' }, [
      this.bill.label,
      el('span.rs-bchip', { 'data-k': 'used' }, [mark('token'), this.bill.used]),
      el('span.rs-beq', {}, '='),
      el('span.rs-bchip', { 'data-k': 'own' }, [buildingIcon(atlas, 'server', 16), this.bill.own]),
      el('span.rs-bchip', { 'data-k': 'bought' }, [inkGlyph('crier'), this.bill.bought]),
      this.bill.cents, this.bill.rental,
    ]);
    this.root = el('section.screen.research.tree', { 'data-screen': 'research' }, [
      el('header.rs-head', {}, [
        this.title,
        this.slotsEl, this.labsEl, this.billEl, this.heldEl, this.planEl, this.planCmp, this.qheadEl, this.notesEl, this.reserveEl,
        this.dragHint,
        el('button.btn.rs-close', { onclick: () => host.close(), title: t('screen.close') }, '✕'),
      ]),
      el('div.rs-body', {}, [
        el('div.tr-stage', {}, [this.view, this.pins, el('div.tr-zoom.cartouche', {}, [this.zoomOut, this.zoomPct, this.zoomIn, this.zoomFit])]),
        this.detail,
      ]),
      this.launch.root,
    ]);
    this.build();
  }

  /** The canvas: blocks, tier columns, lanes, links, nodes — in the current language (rebuilt when it changes). */
  private build(): void {
    const L = this.layout;
    const loc = locale();
    this.builtIn = loc;
    this.views.clear();
    this.paths.length = 0;
    this.heads.clear();
    this.pathHeads.clear();
    this.tierHeads.clear();
    this.gateHead = null;
    this.costSig = null;
    this.detailSig = '';
    this.chainFor = undefined;
    setText(this.title, t('tree.title'));
    setText(this.dragHint, t('tree.drag'));
    setAttr(this.zoomOut, 'title', t('tree.zoom.out'));
    setAttr(this.zoomIn, 'title', t('tree.zoom.in'));
    setAttr(this.zoomFit, 'title', t('tree.zoom.fit'));
    setAttr(this.zoomPct, 'title', t('tree.zoom.reset'));
    const canvas = el('div.tr-canvas', { style: `width:${L.w}px;height:${L.h}px` });
    this.canvas = canvas;
    // Back to front: the two blocks, the tier columns, the lanes, the links, the nodes.
    for (const b of L.blocks) {
      canvas.append(el('div.tr-block', { 'data-kind': b.kind, style: `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px` }, [
        el('div.tr-blockhead', {}, b.kind === 'plan'
          ? [el('h2.lettering', {}, t('tree.part.plans')), el('span.tr-legend', {}, [el('i.tr-swatch', { 'data-kind': 'plan' }), t('tree.legend.plan')])]
          : [el('h2.lettering', {}, t('tree.part.research')), this.researchLegend()]),
      ]));
    }
    for (const col of L.tiers) canvas.append(...this.tierEls(col));
    // Tier 1 | Tier 2 (D118): the strong ink rule down the wider gap between them.
    this.tierRule = L.rule ? el('div.tr-tierrule', { style: `left:${L.rule.x}px;top:${L.rule.y}px;height:${L.rule.h}px` }, [el('span.tr-rulecap', {}, [mark('lock')])]) : null;
    if (this.tierRule) canvas.append(this.tierRule);
    // Each lane's band (D41): its rows in its colour, from its first column to the block's right
    // edge. A plan path's starts after the Heart's column: the Heart stands apart, its links fan out.
    for (const lane of L.lanes) {
      if (lane.kind === 'plan') {
        const x = lane.x + LABEL_W + COL_W - 12;
        canvas.append(el('div.tr-band', {
          'data-kind': 'plan', 'data-lane': lane.id,
          style: `left:${x}px;top:${lane.y - BAND_TOP}px;width:${lane.x + lane.w - x + 8}px;height:${lane.h + BAND_TOP + BAND_BOTTOM}px`,
        }));
      } else {
        const x = lane.x + R_LABEL_W - 8;
        canvas.append(el('div.tr-band', {
          'data-kind': 'research', 'data-lane': lane.id,
          style: `left:${x}px;top:${lane.y - R_BAND}px;width:${lane.x + lane.w - x + 2}px;height:${lane.h + 2 * R_BAND}px`,
        }));
      }
    }
    for (const sp of L.splits) canvas.append(el('div.tr-split', { 'data-lane': sp.lane, style: `left:${sp.x}px;top:${sp.y}px;width:${sp.w}px` }));
    for (const lane of L.lanes) canvas.append(this.laneEl(lane));
    for (const tag of L.tags) {
      const f = FAMILIES[tag.lane];
      const name = tag.spec ? f.specs?.[tag.spec]?.[loc] ?? '' : familyName(tag.lane, tag.tier)[loc];
      canvas.append(el('span.tr-ttag', {
        'data-lane': tag.lane, 'data-spec': tag.spec, 'data-tier': String(tag.tier), style: `left:${tag.x}px;top:${tag.y}px`,
        title: tag.spec ? t('tree.rs.spec.tag', { family: f.name[loc], spec: name }) : null,
      }, name));
    }
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'tr-links');
    svg.setAttribute('width', String(L.w));
    svg.setAttribute('height', String(L.h));
    // Each link on its route (D107: right angles in the gaps, never across a card); a gate's below the others.
    for (const link of [...L.links].sort((a, b) => Number(b.gate) - Number(a.gate))) {
      if (!link.d) continue;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'tr-link');
      path.setAttribute('d', link.d);
      path.setAttribute('data-kind', link.kind);
      if (link.gate) path.setAttribute('data-gate', '');
      svg.append(path);
      this.paths.push({ link, path });
    }
    canvas.append(svg);
    for (const s of L.nodes) canvas.append(this.nodeEl(s));
    // The research lab's gate (D71): a caption over its card — every plan opens research — and how many are taken.
    if (L.gate) {
      const count = el('small.tr-pathcount');
      const cap = el('div.tr-gatecap', { 'data-lane': 'gate', style: `left:${L.gate.x}px;top:${L.gate.y - 50}px;width:${GATE_W}px` }, [
        el('span.tr-lanename.lettering', {}, t('tree.gate.caption')), count,
      ]);
      canvas.append(cap);
      this.gateHead = { id: L.gate.id, cap, count };
    }
    this.buildPins();
    const { scrollLeft, scrollTop } = this.view;
    this.view.replaceChildren(canvas);
    this.applyZoom();
    this.view.scrollLeft = scrollLeft;
    this.view.scrollTop = scrollTop;
    this.paintPins();
  }

  /** Research's legend, in its own marks: the kinds of data (one more each tier, D71), AI tokens from Tier 2 (D118: no time). */
  private researchLegend(): HTMLElement {
    const L = locale();
    const kinds = SCIENCE.map(([it], k) => el('span.rs-kind', { title: `${t('tree.rs.tier', { n: k + 1 })} · ${itemDef(itemIdx(it)).name[L]}` }, [itemIcon(this.atlas, itemIdx(it), 16)]));
    return el('span.tr-legend.rs-legend', {}, [
      el('span', { title: t('tree.legend.data.tip') }, [...kinds, t('tree.legend.data')]),
      el('span', { title: t('tree.legend.tokens.tip') }, [mark('token'), t('tree.legend.tokens.from')]),
    ]);
  }

  /**
   * A tier band: its stripe and its head — « Tier 2 · Cœur niveau 3 » (D118: from Tier 2, the Core's
   * level it needs, the Core's look at that level, padlocked while the Core is below it), and what
   * opens it (a button to it; Tier 2 also two expertises, D93).
   */
  private tierEls(col: TierCol): HTMLElement[] {
    const gate = gateOf(col.tier);
    const lvl = coreLevelFor(col.tier);
    const gateBtn = el('button.tr-gate', {
      type: 'button', 'data-gate-id': gate, title: t('tree.rs.opens.tip', { name: nodeName(gate)[locale()] }),
      onclick: () => { this.select(gate); this.views.get(gate)?.node.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); },
    }, [mark('lock'), el('span.tr-gatecheck', {}, '✓'), nodeName(gate)[locale()]]);
    const core = col.tier > 1
      ? el('span.tr-core', { 'data-core': String(lvl) }, [mark('lock'), el('span.tr-gatecheck', {}, '✓'), buildingIcon(this.atlas, 'hearth', 24, lvl), el('span', {}, t('tree.heartLevel', { n: lvl }))])
      : null;
    const head = el('div.tr-tierhead', { 'data-tier': String(col.tier), style: `left:${col.x}px;top:${col.y}px;width:${col.w}px;height:${TIER_HEAD_H}px` }, [
      el('span.tr-tiertitle', {}, [el('span.tr-tiername.lettering', {}, t('tree.rs.tier', { n: col.tier })), core ? el('span.tr-tierdot', {}, '·') : null, core]),
      el('span.tr-opens', {}, [el('small', {}, t('tree.rs.opens')), gateBtn,
        // Tier 2 also waits for two expertises chosen at the Core's Archive (D93).
        col.tier === 2 ? el('small.tr-gate-exp', { title: t('research.block.expertise') }, [archiveGlyph(), t('tree.rs.opens.expertise')]) : null]),
    ]);
    const stripe = el('div.tr-tiercol', { 'data-tier': String(col.tier), style: `left:${col.x}px;top:${col.y}px;width:${col.w}px;height:${col.h}px` });
    this.tierHeads.set(col.tier, { head, gate: gateBtn, core, col: stripe, pin: null });
    return [stripe, head];
  }

  /**
   * A lane's label, as tall as its band: a plan path's name, what it is for and how much of it is
   * unlocked (D41); the trunk's « Fondations »; a family's name, its count and the reconversion.
   */
  private laneEl(lane: Lane): HTMLElement {
    if (lane.kind === 'plan') {
      const style = `left:${lane.x}px;top:${lane.y - BAND_TOP}px;width:${LABEL_W - 14}px;height:${lane.h + BAND_TOP + BAND_BOTTOM}px`;
      const id = lane.id as PlanLane;
      const count = el('small.tr-pathcount');
      const label = el('div.tr-lane', { 'data-kind': 'plan', 'data-lane': id, style }, [
        el('span.tr-lanename.lettering', {}, t(`tree.lane.${id}` as MsgKey)),
        el('small.tr-paththeme', {}, t(`tree.path.${id}` as MsgKey)),
        count,
      ]);
      this.pathHeads.set(id, { label, count });
      return label;
    }
    const style = `left:${lane.x}px;top:${lane.y - R_BAND}px;width:${R_LABEL_W - 16}px;height:${lane.h + 2 * R_BAND}px`;
    const count = el('small.tr-pathcount');
    let name: string, theme: string;
    if (lane.id === 'trunk') {
      name = t('tree.rs.trunk');
      theme = t('tree.rs.trunk.theme');
    } else {
      const f = lane.id as FamilyId;
      name = FAMILIES[f].name[locale()];
      theme = FAMILIES[f].specs ? Object.values(FAMILIES[f].specs!).map((s) => s[locale()]).join(' · ') : FAMILIES[f].tiers[2][locale()];
    }
    const label = el('div.tr-lane', { 'data-kind': 'research', 'data-lane': lane.id, style }, [
      el('span.tr-lanename.lettering', {}, name), el('small.tr-paththeme', {}, theme), count,
    ]);
    this.heads.set(lane.id, { label, count });
    return label;
  }

  private icon(ic: Icon, px: number): HTMLElement | null {
    if ('b' in ic) return buildingIcon(this.atlas, ic.b, px);
    if ('i' in ic) return itemIcon(this.atlas, itemIdx(ic.i), px);
    if (ic.g === 'coin') return el('span.coin.tr-coin', {}, '◉');
    const c = glyph(ic.g, px);
    c.style.width = c.style.height = `${px}px`;
    return c;
  }

  private nodeEl(s: Spot): HTMLElement {
    const L = locale();
    const res = s.kind === 'research';
    const icons = iconsOf(s.id).map((ic, k) => this.icon(ic, k === 0 ? (res ? 34 : 36) : 20));
    const name = s.id === ROOT ? t('tree.root') : nodeName(s.id)[L];
    const cost = el(res ? 'span.tr-rcost' : 'span.tr-cost');
    let chips: NodeView['chips'] = [];
    let unlock: HTMLButtonElement | null = null, bar: HTMLElement | null = null;
    let qtag: HTMLElement | null = null, tok: HTMLElement | null = null;
    let lines: HTMLElement[];
    if (s.kind === 'plan') {
      chips = planDef(s.id)!.cost.map(([it, n]) => {
        const item = itemIdx(it);
        return { item, mu: toMu(n), node: el('span.tr-chip', { title: itemDef(item).name[L] }, [itemIcon(this.atlas, item, 14), String(n)]) };
      });
      cost.replaceChildren(...chips.map((c) => c.node));
      unlock = el<'button'>('button.btn.primary.tr-unlock', { type: 'button', 'data-unlock': s.id, onclick: (e: Event) => { e.stopPropagation(); this.unlock(s.id); } }, t('tree.unlock'));
      lines = [el('span.tr-line', {}, [cost, unlock])];
    } else if (res) {
      // What it unlocks first (its icons, left), then its name and one chip per kind of data (D71:
      // one kind a tier); from Tier 2 a third line, its tokens and their price at CrierBelt now
      // (D118: Tier 1 takes data alone, no time anywhere).
      tok = tierOf(s.id) >= 2 ? el('span.tr-tokbox') : null;
      bar = el('span.tr-bar');
      qtag = el('span.tr-qtag');
      lines = [el('span.tr-rline', {}, [cost]), tok ? el('span.tr-rfoot', {}, [tok]) : null].filter((x): x is HTMLElement => !!x);
    } else {
      setText(cost, t('tree.start'));
      lines = [el('span.tr-line', {}, [cost])];
    }
    const r = researchNode(s.id);
    const node = el('div.tr-node.rs-card', {
      'data-id': s.id, 'data-kind': s.kind, 'data-lane': s.lane || null, 'data-tier': r ? String(r.tier) : null, 'data-spec': r?.spec ?? null,
      'data-keystone': r?.depth === 9 ? '' : null, 'data-long': [...name].length > (res ? 19 : 15) ? '' : null, role: 'button', tabindex: '0',
      style: `left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px`,
      onclick: () => this.select(s.id),
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select(s.id); } },
    }, [
      el('span.tr-icons', { 'data-n': String(icons.length) }, icons),
      el('span.tr-main', {}, [el('span.tr-name.lettering', {}, name), ...lines]),
      bar ? el('span.tr-track', {}, bar) : null,
      el('span.tr-stamp', {}, '✓'),
      qtag,
    ]);
    this.views.set(s.id, { spot: s, node, cost, chips, tok, qtag, bar, unlock });
    return node;
  }

  /**
   * A research node's costs (what the expertises leave of its table's, D93): a chip per kind of data;
   * from Tier 2 its AI tokens and their price at CrierBelt now (D118).
   */
  private fillCosts(v: NodeView, sim: Sim): void {
    const id = v.spot.id;
    const L = locale();
    const e = effectiveCost(id, sim.mods);
    v.cost.replaceChildren(
      // Compact from a thousand (« 5,8 k »): a Tier 4 card holds four kinds; the detail pane has them whole.
      ...e.cost.map((c) => el('span.tr-chip', { 'data-k': 'data', title: `${num(c.mu / 1000)} ${itemDef(c.item).name[L]}` }, [itemIcon(this.atlas, c.item, 14), shortNum(c.mu / 1000)])),
    );
    v.tok?.replaceChildren(
      el('span.tr-chip', { 'data-k': 'tok', title: t('tree.rs.tok.tip', { v: num(e.tokens) }) }, [mark('token'), tokShort(e.tokens)]),
      el('span.tr-oc', { title: t('tree.rs.oc.tip', { p: oc(sim.tokenPriceK(), false, 0) }) }, ocApprox(tokenCents(sim, e.tokens))),
    );
  }

  // ── interaction ──

  /**
   * The focused node's whole chain (D107: what it needs and what needs it, `chainOf`) lit, the rest
   * faded — the node the player selected, by mouse, finger or key alike (the mouse over a card only
   * raises it, in the CSS). Zooming and panning keep it.
   */
  private paintChain(): void {
    const focus = this.focused && this.views.has(this.focused) ? this.focused : null;
    if (focus === this.chainFor) return;
    this.chainFor = focus;
    const chain = focus && this.views.has(focus) ? chainOf(focus) : null;
    if (this.canvas) setAttr(this.canvas, 'data-chain', chain ? '' : null);
    for (const [id, v] of this.views) setAttr(v.node, 'data-chain', chain?.nodes.has(id) ? (id === focus ? 'self' : '') : null);
    for (const { link, path } of this.paths) setAttr(path, 'data-chain', chain?.links.has(`${link.from}>${link.to}`) ? '' : null);
  }

  /** The player selects a node: its detail, and the focus on its chain (none for the Heart: it has none). */
  private select(id: string): void {
    if (this.dragged) return; // the end of a drag, not a click
    this.selected = id;
    this.focused = id === ROOT ? null : id;
    this.detailSig = '';
    this.refresh();
  }

  /** The focus let go (a click on the empty tree, Esc): the whole tree back; the detail stays. */
  private unfocus(): boolean {
    if (!this.focused) return false;
    this.focused = null;
    this.paintChain();
    return true;
  }

  /** Esc (D111): the launch dialog first (D118), then the focus, then the screen closes. */
  back(): boolean {
    if (this.launch.isOpen) { this.launch.close(); return true; }
    return this.unfocus();
  }

  /** The tree closed: a launch dialog left open goes with it (nothing was started). */
  closed(): void {
    this.launch.close();
  }

  private dragStart(e: PointerEvent): void {
    this.dragged = false;
    if (e.pointerType === 'touch') {
      this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // A second finger (D96): a pinch, no longer a drag.
      if (this.fingers.size === 2) {
        const [a, b] = [...this.fingers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        this.pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), z0: this.zoom };
        this.drag = null;
        setAttr(this.view, 'data-drag', null);
        return;
      }
    }
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    this.drag = { x: e.clientX, y: e.clientY, left: this.view.scrollLeft, top: this.view.scrollTop, moved: false };
  }

  private dragMove(e: PointerEvent): void {
    if (this.fingers.has(e.pointerId)) this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.fingers.size >= 2) {
      const [a, b] = [...this.fingers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      this.dragged = true; // the lift ends a pinch, not a tap
      this.setZoom((this.pinch.z0 * Math.hypot(a.x - b.x, a.y - b.y)) / this.pinch.d0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      return;
    }
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && dx * dx + dy * dy < 25) return;
    if (!d.moved) { d.moved = true; this.view.setPointerCapture(e.pointerId); setAttr(this.view, 'data-drag', ''); }
    this.view.scrollLeft = d.left - dx;
    this.view.scrollTop = d.top - dy;
  }

  private dragEnd(e: PointerEvent): void {
    this.fingers.delete(e.pointerId);
    if (this.fingers.size < 2 && this.pinch) {
      this.pinch = null;
      setTimeout(() => { this.dragged = false; }, 0);
    }
    if (this.drag?.moved) {
      this.dragged = true; // the click that follows this pointerup selects nothing
      if (this.view.hasPointerCapture(e.pointerId)) this.view.releasePointerCapture(e.pointerId);
      setTimeout(() => { this.dragged = false; }, 0);
    }
    this.drag = null;
    setAttr(this.view, 'data-drag', null);
  }

  /**
   * The wheel scrolls the tree (sideways when it has nothing to scroll up and down); with Ctrl or ⌘
   * — and a trackpad's pinch, which the browser sends so — it zooms about the pointer (D111).
   */
  private wheel(e: WheelEvent): void {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      this.setZoom(this.zoom * Math.min(2, Math.max(0.5, Math.exp(-dy * 0.002))), { x: e.clientX, y: e.clientY });
      return;
    }
    const v = this.view;
    if (v.scrollHeight > v.clientHeight + 1 && !e.shiftKey) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    v.scrollLeft += e.deltaY;
    e.preventDefault();
  }

  /** On opening: the guide's node, else the selection (or the first plan to take, else the first research to start), brought into view. */
  opened(): void {
    this.setZoom(this.zoom); // its range follows the window the tree opens in
    const sim = this.host.sim();
    const focus = this.host.focus?.() ?? null;
    if (focus && this.views.has(focus)) { this.selected = focus; this.focused = null; this.detailSig = ''; this.refresh(); }
    else if (!this.selected || !this.views.has(this.selected)) {
      this.focused = null;
      this.selected = readyPlans(sim)[0]
        ?? PLAN_IDS.find((id) => planState(sim, id) === 'poor')
        ?? RESEARCH_IDS.find((id) => researchState(sim, id) === 'ready')
        ?? ROOT;
      this.detailSig = '';
      this.refresh();
    }
    this.views.get(this.selected)?.node.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  // ── zoom (D111) ──

  /** The farthest out: the whole tree in the view. */
  private minZoom(): number {
    return fitZoom(this.view.clientWidth || this.layout.w, this.view.clientHeight || this.layout.h, this.layout);
  }

  /**
   * Zoom to `z` (within the range), keeping the point under `at` (client coordinates; the view's
   * middle by default) where it was: the canvas is measured before and after, and the view scrolled
   * by the difference — in the view's own units, whatever zoom the screens stand under (D96).
   */
  private setZoom(z: number, at?: { x: number; y: number }): void {
    const c = this.canvas;
    const z1 = Math.min(ZOOM_MAX, Math.max(this.minZoom(), z));
    if (!c || !this.root.isConnected) { this.zoom = z1; return; }
    const v = this.view, vr = v.getBoundingClientRect();
    const ax = at?.x ?? vr.left + vr.width / 2, ay = at?.y ?? vr.top + vr.height / 2;
    const r0 = c.getBoundingClientRect();
    const fx = r0.width ? (ax - r0.left) / r0.width : 0, fy = r0.height ? (ay - r0.top) / r0.height : 0;
    const changed = Math.abs(z1 - this.zoom) > 1e-4;
    this.zoom = z1;
    this.applyZoom();
    for (let k = 0; k < 2; k++) {
      const r1 = c.getBoundingClientRect(), u = vr.width ? v.clientWidth / vr.width : 1;
      v.scrollLeft += (r1.left + fx * r1.width - ax) * u;
      v.scrollTop += (r1.top + fy * r1.height - ay) * u;
    }
    this.paintPins();
    if (changed) {
      window.clearTimeout(this.zoomSave);
      this.zoomSave = window.setTimeout(() => ZOOM_STORE.save({ version: 1, zoom: this.zoom }), 300);
    }
  }

  /** The canvas at the zoom: its CSS zoom, `--tz` for what keeps its size on screen, how much a card shows; the bar's state. */
  private applyZoom(): void {
    const c = this.canvas;
    if (!c) return;
    const z = this.zoom, lv = zoomLevel(z);
    c.style.zoom = String(z);
    c.style.setProperty('--tz', String(z));
    setAttr(c, 'data-zoom', lv === 'near' ? null : lv);
    setAttr(this.pins, 'data-on', lv === 'near' ? null : lv);
    setText(this.zoomPct, t('tree.zoom.pct', { v: Math.round(z * 100) }));
    const min = this.root.isConnected ? this.minZoom() : ZOOM_FLOOR;
    setAttr(this.zoomOut, 'disabled', z <= min + 1e-3 ? '' : null);
    setAttr(this.zoomIn, 'disabled', z >= ZOOM_MAX - 1e-3 ? '' : null);
    setAttr(this.zoomFit, 'disabled', z <= min + 1e-3 ? '' : null);
  }

  /** « Tout voir »: the whole tree, centred. */
  private fit(): void {
    this.setZoom(0);
    this.view.scrollLeft = (this.view.scrollWidth - this.view.clientWidth) / 2;
    this.view.scrollTop = (this.view.scrollHeight - this.view.clientHeight) / 2;
    this.paintPins();
  }

  /** The zoom keys while the tree is open (D111; app/controls.ts): - and = (or +) a step, 0 the whole tree. */
  zoomKey(how: 'in' | 'out' | 'fit'): boolean {
    if (!this.root.isConnected) return false;
    if (how === 'fit') this.fit();
    else this.setZoom(how === 'in' ? this.zoom * ZOOM_STEP : this.zoom / ZOOM_STEP);
    return true;
  }

  /** The pinned names (D111): one per tier band (D118: from Tier 2 with the Core's level, padlocked below it), one per lane, in this language. */
  private buildPins(): void {
    const L = this.layout, loc = locale();
    const pins: ResearchScreen['pinEls'] = [];
    for (const col of L.tiers) {
      const lvl = coreLevelFor(col.tier);
      const pin = el('span.tr-pin', { 'data-kind': 'tier', 'data-tier': String(col.tier) }, col.tier > 1
        ? [el('span.lettering', {}, t('tree.rs.tier', { n: col.tier })), el('span.tr-pindot', {}, '·'),
          // The whole tree in view: under the tier's name, the level alone, so the pin fits its band.
          el('span.tr-pinsub', {}, [mark('lock'), buildingIcon(this.atlas, 'hearth', 20, lvl),
            el('span.tr-pinlong', {}, t('tree.heartLevel', { n: lvl })), el('span.tr-pinshort', {}, t('tree.rs.coreShort', { n: lvl }))])]
        : [el('span.lettering', {}, t('tree.rs.tier', { n: col.tier }))]);
      const h = this.tierHeads.get(col.tier);
      if (h) h.pin = pin;
      pins.push({ el: pin, kind: 'tier', x: col.x, y: col.y, w: col.w, h: col.h });
    }
    for (const lane of L.lanes) {
      const name = lane.kind === 'plan' ? t(`tree.lane.${lane.id}` as MsgKey) : lane.id === 'trunk' ? t('tree.rs.trunk') : FAMILIES[lane.id as FamilyId].name[loc];
      pins.push({ el: el('span.tr-pin', { 'data-kind': 'lane', 'data-lane': lane.id }, name), kind: 'lane', x: lane.x, y: lane.y, w: lane.w, h: lane.h });
    }
    this.pinEls = pins;
    this.pins.replaceChildren(...pins.map((p) => p.el));
  }

  private schedulePins(): void {
    if (this.pinFrame) return;
    this.pinFrame = requestAnimationFrame(() => { this.pinFrame = 0; this.paintPins(); });
  }

  /**
   * The pinned names where their band is, at the zoom and the scroll: a tier's along the view's top,
   * centred on the part of its band in view (held there while it is); a lane's along the left edge,
   * at its band's middle, but for one that would overlap the lane above (the thin plan paths at the
   * whole tree's size); out of view, hidden. Only while the cards are small (`zoomLevel` mid or far).
   */
  private paintPins(): void {
    if (zoomLevel(this.zoom) === 'near' || !this.root.isConnected) return;
    const v = this.view, z = this.zoom, sl = v.scrollLeft, st = v.scrollTop, W = v.clientWidth, H = v.clientHeight;
    const ox = v.offsetLeft + v.clientLeft, oy = v.offsetTop + v.clientTop;
    const place = (el: HTMLElement, x: number, y: number, mid: boolean): void => {
      el.hidden = false;
      el.style.transform = `translate(${Math.round(ox + x)}px, ${Math.round(oy + y)}px)${mid ? ' translateY(-50%)' : ''}`;
    };
    const lastY = new Map<number, number>(); // per column of lanes: the plans' block, research's
    for (const p of [...this.pinEls].sort((a, b) => a.y - b.y)) {
      p.el.hidden = false; // measured shown
      const x0 = p.x * z - sl, x1 = (p.x + p.w) * z - sl, y0 = p.y * z - st, y1 = (p.y + p.h) * z - st;
      if (p.kind === 'tier') {
        const w = p.el.offsetWidth || 70, left = Math.max(x0, 0), right = Math.min(x1, W);
        const x = Math.min(Math.max((left + right) / 2 - w / 2, left + 4), right - w - 4), y = Math.max(y0, 0) + 6;
        if (right - left > w + 8 && y1 > 24 && y < H - 20) place(p.el, x, y, false);
        else p.el.hidden = true;
      } else {
        const x = Math.max(x0, 0) + 6, y = (y0 + y1) / 2, h = p.el.offsetHeight || 20, prev = lastY.get(p.x) ?? -Infinity;
        if (y > 10 && y < H - 10 && x < W - 40 && x1 > 0 && y - prev >= h) { place(p.el, x, y, true); lastY.set(p.x, y); }
        else p.el.hidden = true;
      }
    }
  }

  /** The plans a gate needs (D71: every other plan), and how many are taken. */
  private gateCount(sim: Sim, id: string): { n: number; of: number } {
    const pre = treePrereq(id);
    return { n: pre.filter((p) => sim.done.has(p)).length, of: pre.length };
  }

  private missing(sim: Sim, id: string): string {
    const L = locale();
    return treePrereq(id).filter((p) => !sim.done.has(p)).map((p) => nodeName(p)[L]).join(', ');
  }

  /** What a plan would leave the restart reserve short of (D36), milli-items by item; empty unless it is the reason. */
  private reserveShort(sim: Sim, id: string): Array<{ item: number; mu: number }> {
    if (sim.planBlock(id) !== 'reserve') return [];
    return sim.reserveShort(planDef(id)!.cost.map(([it, n]) => ({ item: itemIdx(it), mu: toMu(n) })), id);
  }

  /** « 6 Plaque de fer, 2 Verre »: a shortfall, whole items rounded up, each item with its icon on the page. */
  private shortList(short: ReadonlyArray<{ item: number; mu: number }>): string {
    return short.map((c) => `${num(Math.ceil(c.mu / 1000))} ${itemRef(c.item)}`).join(', ');
  }

  /** The restart reserve's explanation, naming what it rebuilds. */
  private reserveTip(): string {
    return t('tree.reserve.tip', { items: ESSENTIAL.map((it) => itemRef(it)).join(', ') });
  }

  private unlock(id: string): void {
    const sim = this.host.sim();
    const r = sim.unlockPlan(id);
    if (!r.ok && r.reason) {
      this.host.notify('bad', r.reason === 'prereq' ? (isGate(id) ? t('tree.gate.needs', this.gateCount(sim, id)) : t('tree.block.prereq', { list: this.missing(sim, id) }))
        : r.reason === 'reserve' ? t('tree.block.reserve', { list: this.shortList(this.reserveShort(sim, id)) })
          : t(`tree.block.${r.reason}` as MsgKey));
    }
    else this.just = { id, until: performance.now() + 1400 };
    this.selected = id;
    this.detailSig = '';
    this.refresh();
  }

  /**
   * « Lancer » (D118): a Tier 1 node starts at once (the guide's and the smoke's path); from Tier 2
   * the launch dialog asks how many tokens a minute to buy from CrierBelt, and starts it from there.
   */
  private start(id: string): void {
    const sim = this.host.sim();
    if (tierOf(id) >= 2 && !sim.researchBlock(id) && effectiveCost(id, sim.mods).tokens > 0) {
      const ic = iconsOf(id)[0];
      this.launch.open(id, ic ? this.icon(ic, 44) : null);
      return;
    }
    this.begin(id, 0);
  }

  /** Start a node in the first idle lab, buying `buy` tokens a minute; a refusal says why. */
  private begin(id: string, buy: number): void {
    const sim = this.host.sim();
    const r = sim.startResearch(id, 0, buy);
    if (!r.ok && r.reason) this.host.notify('bad', r.reason === 'prereq' ? t('research.block.prereq', { list: this.missing(sim, id) })
      : r.reason === 'core' ? t('tree.rs.coreNeed', { n: coreLevelFor(tierOf(id)) }) : t(`research.block.${r.reason}` as MsgKey));
    this.detailSig = '';
    this.refresh();
  }

  private cancel(id: string): void {
    this.host.sim().cancelResearch(id);
    this.detailSig = '';
    this.refresh();
  }

  /** The Research Queue (an_queue): the node a lab starts once its project is done (null clears it). */
  private queue(lab: number, id: string | null): void {
    this.host.sim().queueResearch(lab, id);
    this.qheadSig = '';
    this.refresh();
  }

  /** The Compute Plan (cm_plan): subscribe or leave. */
  private togglePlan(): void {
    const sim = this.host.sim();
    sim.setTokenPlan(!sim.tokenPlan);
    this.costSig = null; // the tokens' price at CrierBelt changed
    this.refresh();
  }

  // ── state (derived in tree-state.ts, the HUD's too) ──

  private stateOf(sim: Sim, id: string): string {
    // A plan the tutorial has not reached yet (D101: each quest offers the few it is about): « later »,
    // drawn faint, its button off — the tree's shape shows, its choices come with the quests.
    if (id !== ROOT && isPlan(id) && !planOffered(sim, id)) return 'later';
    return id === ROOT ? 'done' : nodeState(sim, id, isPlan(id));
  }

  /** Why a node is where it is, in a few words (its tooltip, the detail pane). */
  private why(sim: Sim, id: string): string {
    if (id === ROOT) return t('tree.root.desc');
    const st = this.stateOf(sim, id);
    if (st === 'later') return t('tree.later');
    // A research node locked with its prerequisites in hand waits for the Core's level (D118) or Tier 2's expertises (D93).
    const core = isResearch(id) && !sim.tierCoreOpen(tierOf(id)) ? t('tree.rs.coreNeed', { n: coreLevelFor(tierOf(id)) }) : '';
    if (st === 'locked') {
      if (isGate(id)) return t('tree.gate.needs', this.gateCount(sim, id));
      const missing = this.missing(sim, id);
      if (missing) return core ? `${t('tree.needs', { list: missing })} · ${core}` : t('tree.needs', { list: missing });
      const block = sim.researchBlock(id);
      return core || (block ? t(`research.block.${block}` as MsgKey) : t('research.start'));
    }
    if (isPlan(id)) {
      if (st !== 'poor') return st === 'done' ? t('tree.unlocked') : t('tree.ready');
      const short = this.reserveShort(sim, id);
      return short.length ? t('tree.reserved', { list: this.shortList(short) }) : t('tree.poor');
    }
    if (st === 'done') return t('research.done');
    if (st === 'active') return this.eta(sim, id) ?? t('research.active');
    const block = sim.researchBlock(id);
    return block ? t(`research.block.${block}` as MsgKey) : t('research.start');
  }

  /**
   * A running project's end (`projectTiming`, as the HUD's chip; D118: no time of its own): what it
   * waits for — power for its lab, its data, a token flow (none reaches it; held while the purse is
   * in the red) — or when its tokens will be in at these flows. Null when nothing can be said.
   */
  private eta(sim: Sim, id: string): string | null {
    const p = sim.projects.find((q) => q.id === id);
    if (!p) return null;
    const tm = projectTiming(sim, p);
    if (tm.waiting === 'power') return t('research.waitPower');
    if (tm.waiting === 'data') return t('research.waiting');
    if (tm.waiting === 'tokens') return tm.held ? t('tree.rs.held') : t('research.waitTokens');
    return Number.isFinite(tm.left) ? t('research.eta', { d: duration(tm.left) }) : null;
  }

  /**
   * A plan's cost in the detail pane, one item a line: how many, its icon and name, and what the
   * Heart holds now (coral when short; live). The cards keep the compact chips.
   */
  private costList(cost: ReadonlyArray<{ item: number; mu: number }>, live: boolean): HTMLElement {
    return el('ul.tr-costs', {}, cost.map((c) => {
      const held = live ? el('small') : null;
      const li = el('li', {}, [el('b', {}, num(Math.round(c.mu / 1000))), itemMention(c.item), held]);
      if (held) this.detailLive.push((sim) => {
        setText(held, t('tree.have', { n: num(Math.floor(sim.stock[c.item]! / 1000)) }));
        setAttr(li, 'data-poor', sim.stock[c.item]! < c.mu ? '' : null);
      });
      return li;
    }));
  }

  private chips(cost: ReadonlyArray<{ item: number; mu: number }>, px: number): HTMLElement[] {
    return cost.map((c) => el('span.tr-chip', { title: itemDef(c.item).name[locale()] }, [itemIcon(this.atlas, c.item, px), num(Math.round(c.mu / 1000))]));
  }

  refresh(): void {
    const sim = this.host.sim();
    const L = locale();
    if (L !== this.builtIn) this.build();
    this.refreshStrip(sim, L);
    setText(this.notesEl, sim.notes > 0 ? t('research.notes', { v: Math.round(sim.notes / 100) }) : '');
    this.refreshReserve(sim, L);
    // Research costs are the table's (D72) less what the expertises take off (D93); what their tokens
    // come to in ◉ follows CrierBelt's token price.
    const sig = `${sim.tokenPriceK()}:${famSig(sim)}`;
    const costsChanged = sig !== this.costSig;
    this.costSig = sig;
    this.refreshLanes(sim);
    this.refreshPaths(sim);
    this.refreshTiers(sim);
    const queued = new Map<string, number>();
    if (sim.mods.flags.has('researchQueue')) for (const lab of labsOf(sim)) { const q = sim.labQueue.get(lab.id); if (q && !queued.has(q)) queued.set(q, lab.n); }
    const now = performance.now();
    if (this.just && now > this.just.until) this.just = null;
    for (const v of this.views.values()) {
      const id = v.spot.id;
      const st = this.stateOf(sim, id);
      setAttr(v.node, 'data-state', st);
      setAttr(v.node, 'data-on', id === this.selected ? '' : null);
      setAttr(v.node, 'data-just', this.just?.id === id ? '' : null);
      setAttr(v.node, 'title', `${id === ROOT ? t('tree.root') : nodeName(id)[L]} — ${this.why(sim, id)}`);
      if (v.spot.kind === 'plan') {
        const short = st === 'poor' ? this.reserveShort(sim, id) : [];
        for (const c of v.chips) setAttr(c.node, 'data-poor', st !== 'done' && (sim.stock[c.item]! < c.mu || short.some((x) => x.item === c.item)) ? '' : null);
        if (v.unlock) setAttr(v.unlock, 'disabled', st === 'ready' ? null : '');
      } else if (v.spot.kind === 'research') {
        if (costsChanged) this.fillCosts(v, sim);
        const proj = sim.projects.find((p) => p.id === id);
        v.bar!.style.width = proj ? `${projectPermille(proj) / 10}%` : st === 'done' ? '100%' : '0%';
        setAttr(v.node, 'data-held', proj && projectTiming(sim, proj).held ? '' : null);
        const q = queued.get(id);
        setText(v.qtag!, q ? String(q) : '');
        setAttr(v.node, 'data-queued', q ? '' : null);
        setAttr(v.qtag!, 'title', q ? t('tree.rs.queued.tip', { lab: t('tree.rs.lab', { n: q }) }) : null);
      }
    }
    // Links: inked once their prerequisite is done, dashed while it opens the way, faint while locked.
    const done = (id: string): boolean => id === ROOT || sim.done.has(id);
    for (const { link, path } of this.paths) {
      const from = link.path ? pathPlans(link.path).every((id) => sim.done.has(id)) : done(link.from);
      setAttr(path, 'data-state', done(link.to) ? 'done' : from ? 'open' : 'locked');
      // A trunk gate lights only for the node it opens (selecting the gate lights its tier's head instead).
      setAttr(path, 'data-hot', link.to === this.selected || (!link.gate && link.from === this.selected) ? '' : null);
    }
    this.paintChain();
    this.renderDetail(sim, L);
    this.launch.refresh();
  }

  /**
   * Research's strip in the header (D68–D70): the slots as pips, the labs (free of all), the last
   * minute's token bill (used = from the claim's servers + bought at CrierBelt, for so many ◉), the
   * purse-in-the-red warning, the Compute Plan's switch, the Research Queue's labs.
   */
  private refreshStrip(sim: Sim, L: Loc): void {
    const used = sim.projects.length, max = sim.mods.slots;
    const sSig = `${used}/${max}/${L}`;
    if (sSig !== this.slotsSig) {
      this.slotsSig = sSig;
      this.slotsEl.replaceChildren(el('small', {}, t('tree.rs.slots')), ...Array.from({ length: max }, (_, k) => el('i.rs-pip', { 'data-on': k < used ? '' : null })));
      setAttr(this.slotsEl, 'title', t('tree.rs.slots.tip', { used, max }));
    }
    const labs = labsOf(sim);
    const idle = labs.length ? sim.idleLabs().length : 0;
    setText(this.labsText, labs.length ? tr('tree.rs.labs', { n: idle, of: labs.length }) : t('tree.rs.noLab'));
    setAttr(this.labsEl, 'data-tone', labs.length ? (idle ? null : 'busy') : 'bad');
    setAttr(this.labsEl, 'title', labs.length ? t('tree.rs.labs.tip', { n: idle, of: labs.length }) : t('tree.rs.noLab.tip'));

    const st = sim.tokenStats;
    const showBill = st.totalUsed > 0 || sim.projects.some((p) => (p.tokens ?? 0) > 0);
    this.billEl.hidden = !showBill;
    if (showBill) {
      setText(this.bill.label, t('tree.rs.bill'));
      setText(this.bill.used, tokShort(st.used));
      setText(this.bill.own, tokShort(st.fromServers));
      setText(this.bill.bought, tokShort(st.bought));
      setText(this.bill.cents, st.cents > 0 ? oc(-st.cents, false, 2) : oc(0, false, 0));
      setAttr(this.bill.cents, 'data-tone', st.cents > 0 ? 'bad' : null);
      setText(this.bill.rental, st.rental > 0 ? oc(st.rental, true, 2) : '');
      const lost = Math.max(0, st.supply - st.fromServers);
      setAttr(this.billEl, 'title', t('tree.rs.bill.tip', { used: tokShort(st.used), own: tokShort(st.fromServers), bought: tokShort(st.bought), cost: oc(st.cents), lost: tokShort(lost) })
        + (st.rental > 0 ? ` ${t('tree.rs.bill.rental', { v: oc(st.rental) })}` : ''));
    }

    this.heldEl.hidden = !sim.researchHeld;
    if (sim.researchHeld) {
      setText(this.heldEl, `⚠ ${t('tree.rs.held')}`);
      setAttr(this.heldEl, 'title', t('tree.rs.held.tip', { v: oc(sim.credits) }));
    }

    const planOn = sim.mods.flags.has('tokenPlan') || sim.tokenPlan;
    this.planEl.hidden = !planOn;
    if (planOn) {
      const pSig = `${L}:${sim.tokenPlan ? 1 : 0}`;
      if (this.planEl.dataset.sig !== pSig) {
        this.planEl.dataset.sig = pSig;
        this.planEl.replaceChildren(glyph('plan', 18), el('span', {}, t('tree.rs.plan')), el('b', {}, t(sim.tokenPlan ? 'tree.rs.plan.on' : 'tree.rs.plan.off')));
      }
      setAttr(this.planEl, 'aria-pressed', sim.tokenPlan ? 'true' : 'false');
      const half = Math.floor((BAL.tokenCentsPerK * BAL.tokenPlan.priceFactor) / 1000);
      setAttr(this.planEl, 'title', t('tree.rs.plan.tip', {
        half: oc(half, false, 0), full: oc(BAL.tokenCentsPerK, false, 0), fee: oc(BAL.tokenPlan.feeCentsPerHour, false, 0),
        act: t(sim.tokenPlan ? 'tree.rs.plan.leave' : 'tree.rs.plan.join'),
      }));
    }
    // The plan's comparison at today's use (D102): an hour without it, an hour with it (its fee in); the cheaper lit.
    const tf = tokenFacts(sim);
    this.planCmp.hidden = !planOn || tf.usePerMin <= 0;
    if (planOn && tf.usePerMin > 0) {
      const better = tf.plan.with < tf.plan.without ? 'with' : 'without';
      const cSig = `${L}:${tf.plan.without}:${tf.plan.with}`;
      if (this.planCmp.dataset.sig !== cSig) {
        this.planCmp.dataset.sig = cSig;
        this.planCmp.replaceChildren(
          el('span.rs-cmp', { 'data-best': better === 'without' ? '' : null }, [el('small', {}, t('tree.rs.plan.without')), el('b', {}, t('purse.perHour', { v: `−${shortNum(Math.round(tf.plan.without / 100), 10_000)}` }))]),
          el('span.rs-cmp', { 'data-best': better === 'with' ? '' : null }, [el('small', {}, t('tree.rs.plan.with')), el('b', {}, t('purse.perHour', { v: `−${shortNum(Math.round(tf.plan.with / 100), 10_000)}` }))]),
        );
      }
      setAttr(this.planCmp, 'title', t('tree.rs.plan.cmp.tip', { n: shortNum(Math.round(tf.boughtPerMin), 10_000), fee: oc(tf.plan.fee, false, 0) }));
    }

    // The Research Queue's labs: each lab's queued node, ✕ to clear it.
    const qOn = sim.mods.flags.has('researchQueue');
    const queued = qOn ? labs.filter((l) => sim.labQueue.has(l.id)) : [];
    this.qheadEl.hidden = !queued.length;
    const qSig = `${L}:${queued.map((l) => `${l.n}=${sim.labQueue.get(l.id)}`).join(',')}`;
    if (qSig !== this.qheadSig) {
      this.qheadSig = qSig;
      this.qheadEl.replaceChildren(
        el('small', {}, t('tree.rs.queue')),
        ...queued.map((l) => {
          const id = sim.labQueue.get(l.id)!;
          return el('span.rs-qchip', { 'data-lab': String(l.id), title: t('tree.rs.queued.tip', { lab: t('tree.rs.lab', { n: l.n }) }) }, [
            el('b', {}, t('tree.rs.lab', { n: l.n })), '▸',
            el('button.rs-qname', { type: 'button', onclick: () => this.select(id) }, nodeName(id)[L]),
            el('button.rs-qx', { type: 'button', 'data-queue-clear': String(l.id), title: t('tree.rs.queue.clear'), onclick: () => this.queue(l.id, null) }, '✕'),
          ]);
        }),
      );
    }
  }

  /** The header's restart reserve (D36): what the Heart's stock must keep now, item by item; nothing once the buildings cover it. */
  private refreshReserve(sim: Sim, L: Loc): void {
    const keep = RESERVED.map((it) => ({ item: itemIdx(it), mu: sim.reserveFloor(itemIdx(it)) })).filter((c) => c.mu > 0);
    const sig = `${L}:${keep.map((c) => `${c.item}=${Math.ceil(c.mu / 1000)}`).join(',')}`;
    if (sig === this.reserveSig) return;
    this.reserveSig = sig;
    setAttr(this.reserveEl, 'title', keep.length ? this.reserveTip() : null);
    this.reserveEl.replaceChildren(...(keep.length ? [`${t('tree.reserve')} `, ...this.chips(keep.map((c) => ({ item: c.item, mu: Math.ceil(c.mu / 1000) * 1000 })), 14)] : []));
  }

  /** The plan paths' labels (D41): « n/of » unlocked, full once the whole path is; the tooltip says what the path is for. */
  private refreshPaths(sim: Sim): void {
    if (this.gateHead) {
      const c = this.gateCount(sim, this.gateHead.id);
      setText(this.gateHead.count, `${c.n}/${c.of}`);
      setAttr(this.gateHead.cap, 'data-full', c.n === c.of ? '' : null);
      setAttr(this.gateHead.cap, 'title', t('tree.gate.needs', c));
    }
    for (const [lane, h] of this.pathHeads) {
      const ids = pathPlans(lane);
      const n = ids.filter((id) => sim.done.has(id)).length;
      setText(h.count, `${n}/${ids.length}`);
      setAttr(h.label, 'data-full', n === ids.length ? '' : null);
      setAttr(h.label, 'title', t('tree.path.tip', { path: t(`tree.lane.${lane}` as MsgKey), theme: t(`tree.path.${lane}` as MsgKey), n, of: ids.length }));
    }
  }

  /** Research lanes: how many of its nodes the claim owns (« 4/10 »). */
  private refreshLanes(sim: Sim): void {
    const counts = branchCounts(sim.done);
    const L = locale();
    for (const [lane, h] of this.heads) {
      const of = RESEARCH_IDS.filter((id) => researchNode(id)!.branch === lane).length;
      const n = lane === 'trunk' ? RESEARCH_IDS.filter((id) => researchNode(id)!.branch === 'trunk' && sim.done.has(id)).length : counts[lane as FamilyId];
      setText(h.count, `${n}/${of}`);
      setAttr(h.label, 'data-full', n === of ? '' : null);
      setAttr(h.label, 'title', t('tree.rs.count.tip', { name: lane === 'trunk' ? t('tree.rs.trunk') : FAMILIES[lane as FamilyId].name[L], n, of }));
    }
  }

  /**
   * The tier bands: open once their gate is done, the Core at their level (D118) and, for Tier 2, two
   * expertises chosen (D93); a band whose Core level is not reached padlocked — its chip, its stripe
   * hatched, its pinned name, the rule before Tier 2 —; the selected node's tier lit, and the tier the
   * selected node opens.
   */
  private refreshTiers(sim: Sim): void {
    const sel = researchNode(this.selected)?.tier ?? null;
    for (const [tier, h] of this.tierHeads) {
      const core = sim.tierCoreOpen(tier);
      const open = sim.done.has(gateOf(tier)) && core && (tier !== 2 || tierTwoOpen(sim));
      setAttr(h.head, 'data-open', open ? '' : null);
      setAttr(h.head, 'data-locked', core ? null : '');
      setAttr(h.col, 'data-locked', core ? null : '');
      if (h.pin) setAttr(h.pin, 'data-locked', core ? null : '');
      setAttr(h.head, 'data-on', sel === tier ? '' : null);
      setAttr(h.head, 'data-opens', this.selected === gateOf(tier) ? '' : null);
      if (h.core) setAttr(h.core, 'title', core
        ? t('tree.rs.core.open', { n: sim.hearthLevel })
        : t('tree.rs.core.tip', { lv: coreLevelFor(tier), n: sim.hearthLevel }));
      if (tier === 2 && this.tierRule) setAttr(this.tierRule, 'data-locked', core ? null : '');
    }
  }

  /** The detail pane: what the selected node is, unlocks and costs, what it needs, its action. */
  private renderDetail(sim: Sim, L: Loc): void {
    const id = this.selected || ROOT;
    const plan = isPlan(id), res = isResearch(id);
    const proj = sim.projects.find((p) => p.id === id);
    const st = this.stateOf(sim, id);
    const block = res ? sim.researchBlock(id) : plan ? sim.planBlock(id) : null;
    const short = plan ? this.reserveShort(sim, id) : [];
    const qOn = res && sim.mods.flags.has('researchQueue');
    const labs = qOn ? labsOf(sim).map((l) => l.id).join(',') : '';
    const core = res ? sim.tierCoreOpen(tierOf(id)) : true;
    const sig = `${id}:${this.costSig}:${proj ? 1 : 0}:${st}:${block}:${core ? 1 : 0}:${L}:${this.shortList(short)}:${qOn ? 1 : 0}:${labs}`;
    if (sig !== this.detailSig) {
      this.detailSig = sig;
      this.detailLive = [];
      const kids = res ? this.researchDetail(sim, id, L, st as ResearchState, block, proj) : this.planDetail(sim, id, L, st, short);
      this.detail.replaceChildren(...kids.filter((k): k is HTMLElement => !!k));
    }
    for (const fn of this.detailLive) fn(sim);
  }

  /** The detail pane of the Heart or a plan (D33, D36). */
  private planDetail(sim: Sim, id: string, L: Loc, st: string, short: ReadonlyArray<{ item: number; mu: number }>): Array<HTMLElement | null> {
    const plan = isPlan(id);
    const name = id === ROOT ? t('tree.root') : nodeName(id)[L];
    const kind = id === ROOT ? t('tree.start') : `${t('tree.kind.plan')} · ${t(`tree.lane.${laneOf(id)}` as MsgKey)}`;
    // What it says: a plan's own line (or the building's it unlocks), the Heart's kit.
    const desc = id === ROOT ? t('tree.root.desc')
      : planDef(id)!.desc?.[L] ?? (buildingsUnlockedBy(id)[0] ? buildingDef(buildingIdx(buildingsUnlockedBy(id)[0]!)).desc[L] : '');
    const rows = this.giftRows(id, L);
    const kids: Array<HTMLElement | null> = [
      el('small.tr-kind', { 'data-kind': id === ROOT ? 'root' : 'plan' }, kind),
      el('h3.lettering', {}, name),
      desc ? el('p.rs-desc', {}, desc) : null,
      rows.length ? el('h4.lettering', {}, t('tree.unlocks')) : null,
      rows.length ? el('ul.tr-unlocks', {}, rows) : null,
    ];
    if (!plan) return kids;
    const p = planDef(id)!;
    kids.push(
      el('h4.lettering', {}, t('research.cost')),
      this.costList(p.cost.map(([it, n]) => ({ item: itemIdx(it), mu: toMu(n) })), st !== 'done'),
      el('small.tr-paid', {}, t('tree.paid')),
    );
    kids.push(isGate(id) ? this.gatePart(id) : this.prereqList(sim, id, L));
    kids.push(el('footer.rs-actions', {}, [
      st === 'done' ? el('span.rs-tag', {}, t('tree.unlocked'))
        : el('button.btn.primary', { 'data-unlock-detail': id, disabled: st === 'ready' ? null : '', onclick: () => this.unlock(id) }, t('tree.unlock')),
      this.planWhy(st, short),
      short.length ? el('p.rs-desc', {}, this.reserveTip()) : null,
    ]));
    return kids;
  }

  /**
   * The one line under a node's action, only for what the pane does not already show (D111; owner,
   * 2026-10-17: « no need to say it twice, the prerequisites line is enough »): a prerequisite missing
   * is its ✗ in the list, a material short its coral line in the cost, the gate's plans its bars —
   * no line for them. What is left is said with its icon, tersely.
   */
  private whyLine(key: string, icon: Element | null, text: string): HTMLElement {
    return el('small.rs-why', { 'data-why': key }, [icon, el('span', {}, text)]);
  }

  /** A plan: held back by CrierBelt's restart reserve (its cost is in hand, the reserve is not), or not offered yet by the tutorial. */
  private planWhy(st: string, short: ReadonlyArray<{ item: number; mu: number }>): HTMLElement | null {
    if (st === 'later') return this.whyLine('later', null, t('tree.later'));
    if (st === 'poor' && short.length) return this.whyLine('reserve', inkGlyph('crier'), t('tree.reserved', { list: this.shortList(short) }));
    return null;
  }

  /**
   * Research: the Core below the tier's level (D118: its look at that level — said even when a
   * prerequisite is missing too, as nothing else in the pane says it), two expertises to choose, the
   * slots full, no idle lab, the purse in the red (a missing prerequisite alone: none, its ✗ says it).
   */
  private researchWhy(sim: Sim, id: string, block: string): HTMLElement | null {
    const tier = tierOf(id);
    if (!sim.tierCoreOpen(tier)) {
      const lvl = coreLevelFor(tier);
      return this.whyLine('core', buildingIcon(this.atlas, 'hearth', 18, lvl), t('tree.rs.coreNeed', { n: lvl }));
    }
    if (block === 'prereq') return null;
    const icon = block === 'expertise' ? archiveGlyph()
      : block === 'no_lab' ? buildingIcon(this.atlas, 'observatory', 16)
        : block === 'slots' ? el('span.rs-whypips', {}, [el('i.rs-pip', { 'data-on': '' }), el('i.rs-pip', { 'data-on': '' })])
          : block === 'debt' ? el('span.coin', {}, '◉') : null;
    return this.whyLine(block, icon, t(`research.block.${block}` as MsgKey));
  }

  /** The gate's prerequisites (D71): every plan, counted path by path with a bar each, in the path's colour. */
  private gatePart(id: string): HTMLElement {
    const pre = new Set(treePrereq(id));
    const head = el('h4.lettering');
    this.detailLive.push((sim) => setText(head, t('tree.gate.all', this.gateCount(sim, id))));
    const rows = PLAN_PATHS.map((lane) => {
      const ids = pathPlans(lane).filter((p) => pre.has(p));
      const fill = el('span'), txt = el('small');
      const li = el('li.rs-gpath', { 'data-lane': lane }, [el('span.rs-gname', {}, t(`tree.lane.${lane}` as MsgKey)), el('span.rs-pbar', {}, fill), txt]);
      this.detailLive.push((sim) => {
        const n = ids.filter((p) => sim.done.has(p)).length;
        fill.style.width = `${ids.length ? (n * 100) / ids.length : 100}%`;
        setText(txt, `${n}/${ids.length}`);
        setAttr(li, 'data-full', n === ids.length ? '' : null);
      });
      return li;
    });
    return el('section.rs-gate', {}, [head, el('ul.rs-gpaths', {}, rows), el('small.rs-qnote', {}, t('tree.gate.opens'))]);
  }

  /** The prerequisites, ✓ / ✗ each. */
  private prereqList(sim: Sim, id: string, L: Loc): HTMLElement | null {
    const pre = id === ROOT ? [] : treePrereq(id);
    if (!pre.length) return null;
    return el('div', {}, [
      el('h4.lettering', {}, t('research.prereq')),
      el('ul.rs-pre', {}, pre.map((q) => el('li', { 'data-ok': sim.done.has(q) ? '' : null }, `${sim.done.has(q) ? '✓' : '✗'} ${nodeName(q)[L]}`))),
    ]);
  }

  /**
   * What a node unlocks, one row each: its buildings, its recipes (their item), a Heart level, and
   * each feature (D70) with its glyph, its name and a plain line on what it does.
   */
  private giftRows(id: string, L: Loc): HTMLElement[] {
    const rows: HTMLElement[] = [];
    for (const b of id === ROOT ? startBuildings() : buildingsUnlockedBy(id)) rows.push(el('li', {}, [buildingIcon(this.atlas, b, 24), buildingDef(buildingIdx(b)).name[L]]));
    if (id === ROOT) return rows;
    for (const r of recipesOf(id)) rows.push(el('li', {}, [itemIcon(this.atlas, itemIdx(r.outs[0]![0]), 24), r.name[L]]));
    const lvl = heartLevelOf(id);
    if (lvl > 1) rows.push(el('li', {}, [buildingIcon(this.atlas, 'hearth', 24, lvl), t('tree.heartLevel', { n: lvl })])); // its look at that level (D86)
    if (!isResearch(id)) return rows;
    for (const ef of effectsOf(id)) {
      const key = effectKey(ef);
      const words = key ? featureText(key, effectAmount(ef)) : null;
      if (!words) continue;
      const ic = EFFECT_ICON[key];
      const first = ic ? (Array.isArray(ic) ? ic[0] : ic) as Icon | undefined : undefined;
      rows.push(el('li.rs-feat', { 'data-feat': key }, [
        first ? this.icon(first, 24) : null,
        el('span', {}, [el('b', {}, words.label), words.what ? el('small', {}, words.what) : null]),
      ]));
    }
    return rows;
  }

  /** The detail pane of a research node (D68–D70). */
  private researchDetail(sim: Sim, id: string, L: Loc, st: ResearchState, block: string | null, proj: Project | undefined): Array<HTMLElement | null> {
    const r = researchNode(id)!;
    const fam = r.branch === 'trunk' ? null : r.branch;
    const laneName = fam ? familyName(fam, r.tier, r.spec)[L] : t('tree.rs.trunk');
    const rows = this.giftRows(id, L);
    const kids: Array<HTMLElement | null> = [
      el('small.tr-kind', { 'data-kind': 'research', 'data-lane': r.branch }, `${t('tree.kind.research')} · ${t('tree.rs.tier', { n: r.tier })} · ${laneName}`),
      el('h3.lettering', {}, nodeName(id)[L]),
      el('p.rs-desc', {}, r.desc[L]),
      rows.length ? el('h4.lettering', {}, t('tree.unlocks')) : null,
      rows.length ? el('ul.tr-unlocks', {}, rows) : null,
      ...this.costPart(sim, id),
      this.prereqList(sim, id, L),
      proj ? this.progressPart(sim, proj) : null,
      el('footer.rs-actions', {}, [
        st === 'done' ? el('span.rs-tag', {}, t('research.done'))
          : proj ? el('button.btn', { type: 'button', onclick: () => this.cancel(id) }, t('research.cancel'))
            : el('button.btn.primary', { type: 'button', disabled: block ? '' : null, onclick: () => this.start(id) }, t('research.start')),
        st !== 'done' && !proj && block ? this.researchWhy(sim, id, block) : null,
      ]),
    ];
    if (st !== 'done' && sim.mods.flags.has('researchQueue')) kids.push(this.queuePart(sim, id, L));
    return kids;
  }

  /**
   * A research node's cost (D68, D69, D118): its data files and, from Tier 2, its AI tokens and what
   * they would cost at CrierBelt now — the table's, whatever else the claim owns (D72), less what an
   * expertise takes off (D93). No time: a research lasts as long as its data and tokens take to come.
   */
  private costPart(sim: Sim, id: string): HTMLElement[] {
    const e = effectiveCost(id, sim.mods);
    const lines = el('ul.tr-costs.rs-rcosts', {}, [
      ...e.cost.map((c) => el('li', {}, [el('b', {}, num(c.mu / 1000)), itemMention(c.item)])),
      tierOf(id) >= 2
        ? el('li', { 'data-k': 'tok', title: t('tree.rs.oc.tip', { p: oc(sim.tokenPriceK(), false, 0) }) }, [
          el('b', {}, num(e.tokens)), el('span.rs-cl', {}, [mark('token'), t('tree.legend.tokens')]),
          el('small.rs-price', {}, t('tree.rs.price', { v: ocApprox(tokenCents(sim, e.tokens)) })),
        ])
        : null,
    ]);
    return [el('h4.lettering.rs-costhead', {}, [t('research.cost')]), lines];
  }

  /**
   * A running project (D68, D118): the data files paid of each cost and, from Tier 2, its tokens in of
   * those it needs — a bar each —; the tokens a minute it gets now from the claim's servers and from
   * CrierBelt, their ◉ a minute (held while the purse is in the red); the flow it buys, − / + on the
   * launch dialog's ladder (`setTokenBuy`), while it still needs tokens; its end, or what it waits for.
   */
  private progressPart(sim: Sim, p: Project): HTMLElement {
    const bar = (): { root: HTMLElement; fill: HTMLElement } => { const fill = el('span'); return { root: el('span.rs-pbar', {}, fill), fill }; };
    const rows: HTMLElement[] = [];
    const row = (label: Array<Node | string>, read: (sim: Sim, q: Project) => [number, number, string], k: string): void => {
      const b = bar(), txt = el('small');
      rows.push(el('div.rs-prow', { 'data-k': k }, [el('span.rs-plabel', {}, label), b.root, txt]));
      this.detailLive.push((s) => {
        const q = s.projects.find((x) => x.id === p.id);
        if (!q) return;
        const [a, of, text] = read(s, q);
        b.fill.style.width = `${of > 0 ? Math.min(100, (a * 100) / of) : 100}%`;
        setText(txt, text);
      });
    };
    p.cost.forEach((c, i) => row([itemIcon(this.atlas, c.item, 16) ?? '', itemDef(c.item).name[locale()]], (_s, q) => [q.paid[i]!, q.cost[i]!.mu, `${shortNum(Math.floor(q.paid[i]! / 1000), 10_000)} / ${shortNum(q.cost[i]!.mu / 1000, 10_000)}`], 'data'));
    const usesTokens = (p.tokens ?? 0) > 0;
    if (usesTokens) row([mark('token'), t('tree.rs.prog.tokens')], (_s, q) => [q.tokIn ?? 0, q.tokens ?? 0, `${tokShort(q.tokIn ?? 0)} / ${tokShort(q.tokens ?? 0)}`], 'tok');
    // Its tokens now (D102, D118): the servers' share and the flow bought, a minute; their ◉ a minute — icons, the words on hover.
    let now: HTMLElement | null = null;
    if (usesTokens) {
      const srv = el('b'), bought = el('b'), cents = el('b');
      now = el('div.rs-toknow', {}, [
        el('span.rs-tk', { 'data-k': 'servers' }, [buildingIcon(this.atlas, 'server', 16), srv]),
        el('span.rs-tk', { 'data-k': 'bought' }, [inkGlyph('crier'), bought]),
        el('span.rs-tk', { 'data-k': 'cents' }, [el('span.coin-w', {}, '◉'), cents]),
      ]);
      const nowEl = now;
      this.detailLive.push((s) => {
        const q = s.projects.find((x) => x.id === p.id);
        if (!q) return;
        const tm = projectTiming(s, q), me = tokenFacts(s).projects.get(p.id);
        const c = Math.round(me?.centsPerMin ?? 0);
        setText(srv, t('hud.perMin', { v: tokShort(tm.servers) }));
        setText(bought, tm.held ? t('tree.rs.toknow.held') : t('hud.perMin', { v: tokShort(tm.bought) }));
        setText(cents, t('hud.perMin', { v: ocNum(c, false, c < 100 ? 2 : 0) }));
        setAttr(nowEl, 'data-held', tm.held ? '' : null);
        setAttr(nowEl, 'data-in', tokensLeft(q) <= 0 ? '' : null);
        setAttr(nowEl, 'title', t('tree.rs.toknow.tip', { s: tokShort(tm.servers), b: tokShort(tm.bought), c: oc(c, false, 2) }));
      });
    }
    const flow = usesTokens ? this.flowControl(sim, p) : null;
    const eta = el('div.rs-live');
    const held = el('div.rs-heldnote', { hidden: '' }, t('tree.rs.held'));
    this.detailLive.push((s) => {
      const q = s.projects.find((x) => x.id === p.id);
      const pct = q ? t('research.progress', { v: Math.floor(projectPermille(q) / 10) }) : '';
      const end = q ? this.eta(s, p.id) : null;
      setText(eta, end ? `${pct} · ${end}` : pct);
      held.hidden = !(q && projectTiming(s, q).held);
      setAttr(held, 'title', t('tree.rs.held.tip', { v: oc(s.credits) }));
    });
    return el('section.rs-prog', {}, [el('h4.lettering', {}, t('tree.rs.progress')), ...rows, now, flow, eta, held]);
  }

  /**
   * The flow a running project buys (D118): − / + along the launch dialog's ladder (`tokenFlowSteps`,
   * up to what would bring all its tokens in a minute), each step a logged `setTokenBuy`; gone once its
   * tokens are in (a flow stops by itself then).
   */
  private flowControl(sim: Sim, p: Project): HTMLElement {
    const steps = tokenFlowSteps(p.tokens ?? 0);
    const val = el('b.rs-flowv', { 'data-rs-flow-v': '' });
    const set = (dir: -1 | 1): void => {
      const s = this.host.sim(), q = s.projects.find((x) => x.id === p.id);
      if (!q) return;
      const cur = q.buy ?? 0;
      const next = dir > 0 ? steps.find((v) => v > cur) : [...steps].reverse().find((v) => v < cur);
      if (next !== undefined) s.setTokenBuy(p.id, next);
      this.refresh();
    };
    const minus = el<'button'>('button.rs-flowbtn', { type: 'button', 'data-rs-flow': 'minus', title: t('tree.rs.flow.less'), onclick: () => set(-1) }, '−');
    const plus = el<'button'>('button.rs-flowbtn', { type: 'button', 'data-rs-flow': 'plus', title: t('tree.rs.flow.more'), onclick: () => set(1) }, '+');
    const root = el('div.rs-flow', { 'data-rs-flow-row': '' }, [
      el('span.rs-plabel', {}, [inkGlyph('crier'), t('tree.rs.flow')]), minus, el('span.rs-flowval', {}, [mark('token'), val]), plus,
    ]);
    const live = (s: Sim): void => {
      const q = s.projects.find((x) => x.id === p.id);
      if (!q) return;
      const cur = q.buy ?? 0;
      root.hidden = tokensLeft(q) <= 0;
      setText(val, cur > 0 ? t('hud.perMin', { v: num(cur) }) : t('tree.rs.flow.none'));
      setAttr(minus, 'disabled', cur <= 0 ? '' : null);
      setAttr(plus, 'disabled', cur >= steps[steps.length - 1]! ? '' : null);
      setAttr(root, 'title', t('tree.rs.flow.tip', { c: oc(Math.ceil((cur * s.tokenPriceK()) / 1000), false, 2) }));
    };
    this.detailLive.push(live);
    live(sim);
    return root;
  }

  /**
   * The Research Queue (an_queue, D70): one line per lab — what it runs, what it has queued — and
   * a button to queue this node there (✕ clears that lab's queue). A lab starts its queued node
   * as soon as its own project is done (and its prerequisites, a slot and the purse allow).
   */
  private queuePart(sim: Sim, id: string, L: Loc): HTMLElement {
    const labs = labsOf(sim);
    const waits = treePrereq(id).some((p) => !sim.done.has(p));
    const rows = labs.map((l) => {
      const run = el('small.rs-qrun'), next = el('small.rs-qnext');
      const put = el<'button'>('button.btn.rs-qput', { type: 'button', 'data-queue-lab': String(l.id), onclick: () => this.queue(l.id, id) }, t('tree.rs.queue.put'));
      const clear = el<'button'>('button.rs-qx', { type: 'button', title: t('tree.rs.queue.clear'), onclick: () => this.queue(l.id, null) }, '✕');
      const li = el('li.rs-qlab', { 'data-lab': String(l.id) }, [
        buildingIcon(this.atlas, l.def, 26),
        el('span.rs-qinfo', {}, [el('b', {}, t('tree.rs.lab', { n: l.n })), run, next]),
        put, clear,
      ]);
      this.detailLive.push((s) => {
        const p = s.projects.find((q) => q.lab === l.id);
        setText(run, p ? t('tree.rs.lab.runs', { name: nodeName(p.id)[L], v: Math.floor(projectPermille(p) / 10) }) : t('tree.rs.lab.idle'));
        const q = s.labQueue.get(l.id);
        setText(next, q ? t('tree.rs.lab.next', { name: nodeName(q)[L] }) : '');
        const here = q === id;
        setText(put, here ? t('tree.rs.queue.here') : t('tree.rs.queue.put'));
        setAttr(put, 'disabled', here || s.queueBlock(l.id, id) ? '' : null);
        setAttr(li, 'data-here', here ? '' : null);
        clear.hidden = !q;
      });
      return li;
    });
    return el('section.rs-queue', {}, [
      el('h4.lettering', {}, [glyph('queue', 18), t('tree.rs.queue')]),
      el('small.rs-qnote', {}, t('tree.rs.queue.note')),
      waits ? el('small.rs-why', {}, t('tree.rs.queue.wait')) : null, // the prerequisites' list says which
      labs.length ? el('ul.rs-qlabs', {}, rows) : el('small.rs-why', {}, t('tree.rs.noLab.tip')),
    ]);
  }
}
