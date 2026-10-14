// research.ts — the tech tree screen (D33; T, or the HUD's tree chip): one tree, two kinds of
// node. On the left the plans grow from the Heart's starting kit in six paths of one theme each
// (D41, `PLAN_PATHS`: production, logistics, energy, analytics, trade, survey), each drawn as a
// band of its own colour with its name, what it is for and how much of it is unlocked: a plan
// unlocks with one click, paid from the Heart at once. A plan whose cost would eat into
// CrierBelt's restart reserve (D36) reads « short of materials » with that reason, and the header
// shows what the Heart's stock must keep while the buildings do not cover it.
// Between the two blocks stands the GATE (D71): the research lab's plan, in its own column, which
// needs every other plan — each path's last node links into it, a caption counts the plans taken.
// On the right the research (D68–D70) reads in four TIER COLUMNS (Tier 1 … Tier 4), each headed by
// what opens it (the lab's plan, then a node of the trunk, standing in the column before). The trunk — « Fondations » — runs on top; under
// it one lane per family, whose name changes with the tier column (Commerce: Échange → Finance →
// Économie de marché) and which splits in two specialities from Tier 3 (a sub-lane each, its
// name on the divider). A research node shows what it unlocks (buildings, recipes' items, a glyph
// for a feature), what it uses as it runs — its kinds of data (one more each tier, D71: Survey
// Data, Mechanics Data, atlases, codices), AI tokens and their price at CrierBelt now —, its
// minimum time — the table's, whatever else the claim owns (D72: no spread penalty). The header adds research's
// strip: slots, labs, the last minute's token bill, the purse-in-the-red warning, the Compute
// Plan's switch and the Research Queue (each lab's queued node, ✕ to clear it).
// The detail pane gives the whole picture: what a node unlocks (a plain line per feature), its
// cost, its progress (each kind of data paid, tokens used, time), the
// action (start, cancel, queue in a lab) and its family's reconversion.
// The layout is computed once from content (`treeLayout`); the 4 Hz refresh writes states, costs
// and progress. The sim decides; this only shows and asks (`unlockPlan`, `startResearch`,
// `cancelResearch`, `queueResearch`, `setTokenPlan`, `respec`).
import '../styles/research.css';
import { BAL } from '@/content/balance';
import { ESSENTIAL, RESERVED } from '@/content/reserve';
import {
  FAMILIES, FAMILY_IDS, PLAN_IDS, PLAN_PATHS, SCIENCE, TIER_GATE, buildingsUnlockedBy, familyName, isPlan, isResearch, nodeName,
  pathPlans, planDef, researchNode, treePrereq,
} from '@/content/research';
import { RECIPES } from '@/content/recipes';
import { BUILDING_IDS, BUILDING_KIND, RESEARCH_IDS, buildingDef, buildingIdx, itemDef, itemIdx, toMu } from '@/content/registry';
import type { Effect, FamilyId, PlanLane, RecipeDef, ResearchTier } from '@/content/types';
import { el, setAttr, setText } from '@/core/dom';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import { duration, num } from '@/i18n/format';
import type { Atlas } from '@/render/art/atlas';
import { C } from '@/render/art/tokens';
import type { Sim } from '@/sim/state';
import { branchCounts, effectiveCost, projectPermille, tokensDue, type BranchId, type Project } from '@/sim/research/runtime';
import { TPS } from '@/sim/constants';
import { buildingIcon, itemIcon } from '../build-bar';
import { glyph as inkGlyph } from '../glyphs';
import { itemMention, itemRef } from '../mention';
import { oc } from '../trade-view';

export interface ResearchHost {
  sim(): Sim;
  close(): void;
  notify(kind: 'good' | 'bad' | 'info' | 'warn', text: string): void;
  /** The node the tutorial's guide is after (null: none): the tree opens on it. */
  focus?(): string | null;
}

type Loc = 'fr' | 'en';

// ── layout ──────────────────────────────────────────────────────────────────

/** The root: the Heart and its starting kit (not a node of the tree's tables). */
export const ROOT = 'heart';

// The plans' geometry (D33, D41): compact rows so the six paths fit a 900 px window.
const NODE_W = 186, NODE_H = 56;
const COL_W = 226, ROW_H = 66, LANE_GAP = 4;
const LABEL_W = 124, PAD = 16, HEAD_H = 40, BLOCK_GAP = 36;
/** A plan lane's band reaches this far above and below its rows (below: most of the « Débloquer » tab). */
const BAND_TOP = 4, BAND_BOTTOM = 7;
/** The research lab's gate (D71): its card, and the room left of it where the paths' links converge. */
const GATE_W = 220, GATE_GAP = 96;

// Research's geometry (D69): wider nodes (three lines: name, what it uses, its time and badge),
// tier columns of sub-columns, lanes far enough apart for each tier's family name on their edge.
const R_NODE_W = 256, R_NODE_H = 56;
/** A sub-column: a node and the gap its links cross; a row: a node and 8 px. */
const R_COL_W = 288, R_ROW_H = 64;
/** Between a family's two specialities (their divider and the second one's name sit there). */
const R_SPLIT = 18;
/** Between research lanes: room for the family's name over each tier column, on the band's edge. */
const R_LANE_GAP = 18;
const R_LABEL_W = 150;
/** Inside a tier column, before its first node and after its last. */
const TIER_PAD = 18;
const TIER_HEAD_H = 50;
/** A research band reaches this far above and below its rows. */
const R_BAND = 6;

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
/** A link; `path`: a plan path's last node into the research lab's gate (inked once the whole path is taken). */
interface Link { from: string; to: string; gate: boolean; path?: PlanLane }
/** A tier column of the research block: its head on top, its stripe down to the block's bottom. */
interface TierCol { tier: ResearchTier; x: number; w: number; y: number; h: number }
/** A family's name over one tier column of its lane: the tier's name, or a speciality's from Tier 3. */
interface TierTag { lane: FamilyId; tier: ResearchTier; spec: string | null; x: number; y: number }
/** The divider between a family's two specialities, across Tiers 3 and 4. */
interface Split { lane: FamilyId; x: number; w: number; y: number }
/** The research lab's gate (D71): its column between the two blocks, the card's top left. */
interface GateCol { id: string; x: number; y: number }
export interface TreeLayout {
  nodes: Spot[]; lanes: Lane[]; blocks: Block[]; links: Link[];
  tiers: TierCol[]; tags: TierTag[]; splits: Split[]; gate: GateCol | null;
  w: number; h: number;
}

const laneOf = (id: string): string => planDef(id)?.lane ?? researchNode(id)?.branch ?? '';
/** The research lab's plan (D71): the gate between the plans and research, needing every other plan. */
const isGate = (id: string): boolean => planDef(id)?.lane === 'gate';

/**
 * The plans' part (D33, D41): a node's column is its longest path from the root (a plan with no
 * prerequisite is column 1, the Heart column 0); within a path a node takes the free row of its
 * column nearest its in-path parents', so paths stay straight and rarely cross. The research
 * lab's plan (D71, lane `gate`, not a path) stands in its own column right of the block, level
 * with the Heart: each path's last node(s) — its plans in its last column — link into it.
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
  const links: Link[] = [];
  for (const id of plans) {
    const pre = treePrereq(id);
    if (!pre.length) links.push({ from: ROOT, to: id, gate: false });
    for (const p of pre) links.push({ from: p, to: id, gate: false });
  }
  const right = x0 + w;
  let gate: GateCol | null = null;
  const gx = right + GATE_GAP;
  gates.forEach((g, k) => {
    const gy = Math.round((top + bottom) / 2 - NODE_H / 2) + k * ROW_H;
    nodes.push({ id: g, kind: 'plan', lane: 'gate', x: gx, y: gy, w: GATE_W, h: NODE_H });
    if (!gate) gate = { id: g, x: gx, y: gy };
    for (const lane of PLAN_PATHS) {
      const mine = plans.filter((id) => laneOf(id) === lane);
      const last = Math.max(...mine.map(d));
      for (const id of mine) if (d(id) === last) links.push({ from: id, to: g, gate: false, path: lane });
    }
  });
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

/**
 * Research's part (D69), from `x0`: the lanes' labels, then the four tier columns. Within its
 * tier a node's sub-column is its chain of same-lane, same-tier prerequisites (a family's two
 * depths a tier; the trunk's T2 runs three deep). The trunk's rows: the longest line keeps the
 * top row (Mechanics → Ceramics → Land Registry…), a side node takes the next. A family's lane
 * has one row, or two once it splits: its shared nodes sit between them, each speciality on its own.
 */
function researchPart(x0: number): { nodes: Spot[]; lanes: Lane[]; links: Link[]; tiers: TierCol[]; tags: TierTag[]; splits: Split[]; block: Block; right: number; bottom: number } {
  const ids: readonly string[] = RESEARCH_IDS;
  const R = (id: string) => researchNode(id)!;
  const sub = new Map<string, number>();
  const subOf = (id: string): number => {
    const known = sub.get(id);
    if (known !== undefined) return known;
    const r = R(id);
    const same = r.prereq.filter((p) => { const q = researchNode(p); return !!q && q.branch === r.branch && q.tier === r.tier; });
    const v = same.length ? 1 + Math.max(...same.map(subOf)) : 0;
    sub.set(id, v);
    return v;
  };
  const cols = new Map<ResearchTier, number>(TIERS.map((k) => [k, 1]));
  for (const id of ids) cols.set(R(id).tier, Math.max(cols.get(R(id).tier)!, subOf(id) + 1));
  const tierX = new Map<ResearchTier, number>(), tierW = new Map<ResearchTier, number>();
  let x = x0 + R_LABEL_W;
  for (const k of TIERS) {
    const w = cols.get(k)! * R_COL_W - (R_COL_W - R_NODE_W) + 2 * TIER_PAD;
    tierX.set(k, x);
    tierW.set(k, w);
    x += w;
  }
  const right = x;
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
      h = split ? 2 * R_NODE_H + R_SPLIT : R_NODE_H;
      for (const id of mine) {
        const k = specs.indexOf(R(id).spec ?? '');
        nodes.push({ id, kind: 'research', lane, x: nx(id), y: k < 0 ? y + (h - R_NODE_H) / 2 : y + k * (R_NODE_H + R_SPLIT), w: R_NODE_W, h: R_NODE_H });
      }
      const mid = y + R_NODE_H + R_SPLIT / 2;
      for (const k of TIERS) {
        const tx = tierX.get(k)! + 10;
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
  // A gate is a prerequisite from another lane — a trunk node opening a tier: the tier heads say
  // what opens each tier, so a gate is drawn only while the node it opens is selected. The lab's
  // plan, which opens Tier 1, is named by its head alone (its links would cross the lanes' labels).
  const links: Link[] = [];
  for (const id of ids) for (const p of R(id).prereq) if (isResearch(p)) links.push({ from: p, to: id, gate: R(p).branch !== R(id).branch });
  return {
    nodes, lanes, links, tags, splits, right, bottom,
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
    w: R.right + PAD, h: Math.max(P.bottom, R.bottom) + PAD,
  };
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
  landResale: { g: 'resale' }, sisterCrossing: { g: 'crossing' }, farClaims: { g: 'far' },
  remoteBeltCost: { b: 'ribbon' }, remoteBuildDelay: { b: 'beacon' }, pylonLink: { b: 'pylon' },
  ring3Caps: { b: 'deep_bore' }, dockShips: { b: 'skydock' }, shipCap: { b: 'skydock' }, shipSpeed: { b: 'skydock' },
  drifterDistance: { b: 'skydock' }, bridgeSpan: { b: 'skybridge' }, forkFilters: { b: 'router' },
  modules1: { i: 'pace_bell' }, modules2: { i: 'pace_bell' }, craftSpeed: { i: 'gear' },
  windOut: { b: 'wind_flower' }, gustVariance: { b: 'wind_flower' }, stormHarvest: { b: 'wind_flower' }, solarOut: { b: 'sun_bulb' },
  accCap: { b: 'accumulator' }, accRate: { b: 'accumulator' }, geoOut: { b: 'fumarole_tap' },
  deepHeat: { b: 'fumarole_tap' }, genOut: { b: 'brazier' },
  // Trade and tokens (D68, D70).
  tradeFee: { g: 'coin' }, slippage: { g: 'coin' }, forwards: { g: 'coin' }, charters: { g: 'coin' },
  forecast: { g: 'forecast' }, floorPrices: { g: 'floor' }, tokenPlan: { g: 'plan' }, expressFreight: { g: 'express' },
  serverRental: [{ g: 'rental' }, { b: 'server' }],
  deliveryDelay: { b: 'trade_post' }, orders: { b: 'trade_post' }, tradeL2: { b: 'trade_post' }, tradeL3: { b: 'trade_post' },
  post3: { b: 'trade_post' }, crierHouse: { b: 'trade_post' },
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
 * sister claim's hatched coral, a boundary stone; resale — the parcels and a coin; crossing — a
 * ribbon through the sister's parcels; far — a parcel away from the claim's, a dashed way to it.
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
  /** The parcels (3 × 3 from x0, y0, k a side): `held` washed turquoise, `sister` hatched coral. */
  const parcels = (x0: number, y0: number, k: number, held: ReadonlyArray<readonly [number, number]>, sister: ReadonlyArray<readonly [number, number]>): void => {
    for (let i = 1; i < 3; i++) { line([[x0 + i * k, y0], [x0 + i * k, y0 + 3 * k]], C.inkSoft, 1); line([[x0, y0 + i * k], [x0 + 3 * k, y0 + i * k]], C.inkSoft, 1); }
    g.fillStyle = C.turqL;
    for (const [cx, cy] of held) g.fillRect((x0 + cx * k + 0.6) * s, (y0 + cy * k + 0.6) * s, (k - 1.2) * s, (k - 1.2) * s);
    for (const [cx, cy] of sister) for (let d = 2; d < 2 * k; d += 3) {
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
    // Three by three parcels; the middle column and the top-left held, one hatched for a sister claim.
    const x0 = 8, y0 = 9, k = 8;
    parcels(x0, y0, k, [[0, 0], [1, 0], [1, 1], [1, 2]], [[2, 2]]);
    line([[x0, y0], [x0 + 2 * k, y0], [x0 + 2 * k, y0 + 3 * k], [x0 + k, y0 + 3 * k], [x0 + k, y0 + k], [x0, y0 + k], [x0, y0]], C.turqD, 2.2);
    if (kind === 'resale') coin(29, 28, 5.6);
    else {
      g.fillStyle = C.paperD; g.strokeStyle = C.ink; g.lineWidth = 1.4 * s;
      g.beginPath(); g.moveTo(29 * s, 4 * s); g.lineTo(33 * s, 4 * s); g.lineTo(34 * s, 10 * s); g.lineTo(28 * s, 10 * s); g.closePath(); g.fill(); g.stroke();
    }
  } else if (kind === 'crossing') {
    // The claim's column on the left, a sister claim's hatched beside it, a ribbon running through both.
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
 * hexagon with its spark, D68), the minimum time's clock, a closed padlock (a tier not open yet).
 */
function mark(kind: 'token' | 'clock' | 'lock'): SVGSVGElement {
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
  } else if (kind === 'clock') {
    add('circle', { class: 'm-face', cx: '8', cy: '8.8', r: '6' });
    add('path', { class: 'm-hand', d: 'M8 5.6v3.4l2.4 1.4M6.4 1.4h3.2' });
  } else {
    add('path', { class: 'm-shackle', d: 'M5 7.4V5.2a3 3 0 0 1 6 0v2.2' });
    add('rect', { class: 'm-body', x: '3.2', y: '7.2', width: '9.6', height: '7', rx: '1.6' });
  }
  return svg;
}

/** A research's minimum time, compact enough for a node: « 45 min », « 4,2 h », « 18 h », « 1 j ». */
function shortTime(ticks: number): string {
  const min = ticks / TPS / 60;
  if (min < 60) return t('tree.time.min', { n: Math.max(1, Math.round(min)) });
  const h = min / 60;
  if (h < 24) return t('tree.time.h', { n: num(h < 10 ? Math.round(h * 10) / 10 : Math.round(h)) });
  return t('tree.time.d', { n: num(Math.round((h / 24) * 10) / 10) });
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

/** A cost multiplier (‰) as a badge: « ×1,60 ». */

/** A feature's words (`tree.feat.<key>` and its line `.what`), or null when the dictionary has none. */
function featureText(key: string, amount: number): { label: string; what: string } | null {
  const label = tr(`tree.feat.${key}`);
  if (label.startsWith('⟦')) return null;
  const what = tr(`tree.feat.${key}.what`, { n: amount });
  return { label, what: what.startsWith('⟦') ? '' : what };
}

/** The research labs, in entity order (their number on the screen: « Labo 1 »…). */
function labsOf(sim: Sim): Array<{ id: number; def: string; n: number }> {
  return sim.ents.sorted().filter((e) => BUILDING_KIND[e.def] === 'lab').map((e, k) => ({ id: e.id, def: BUILDING_IDS[e.def]!, n: k + 1 }));
}

// ── the screen ──────────────────────────────────────────────────────────────

type PlanState = 'done' | 'ready' | 'poor' | 'locked';
type ResearchState = 'done' | 'active' | 'ready' | 'waiting' | 'locked';

interface NodeView {
  spot: Spot;
  node: HTMLElement;
  cost: HTMLElement;
  /** Plans: the cost chips (their item and amount), to mark the ones the Heart lacks. */
  chips: Array<{ item: number; mu: number; node: HTMLElement }>;
  /** Research: its tokens and their price, the minimum time's text, the queue's tag. */
  tok: HTMLElement | null;
  time: HTMLElement | null;
  qtag: HTMLElement | null;
  bar: HTMLElement | null;
  unlock: HTMLButtonElement | null;
}

/** A research lane's label: its count and, for a family, the reconversion button. */
interface LaneHead { label: HTMLElement; count: HTMLElement; respec: HTMLButtonElement | null }

export class ResearchScreen {
  readonly root: HTMLElement;
  private readonly layout = treeLayout();
  private readonly views = new Map<string, NodeView>();
  private readonly paths: Array<{ link: Link; path: SVGPathElement }> = [];
  private readonly heads = new Map<string, LaneHead>();
  /** The plan paths' labels (D41): the label (its tooltip) and its « n/of » unlocked. */
  private readonly pathHeads = new Map<PlanLane, { label: HTMLElement; count: HTMLElement }>();
  /** The tier columns' heads: what opens each (its state) and the selected node's tier. */
  private readonly tierHeads = new Map<ResearchTier, { head: HTMLElement; gate: HTMLElement }>();
  /** The research lab's gate (D71): its caption and its « n/N » plans taken. */
  private gateHead: { id: string; cap: HTMLElement; count: HTMLElement } | null = null;
  private readonly view: HTMLElement;
  // The header: plans' restart reserve and research's strip (D68–D70).
  private readonly slotsEl = el('span.rs-slots');
  private slotsSig = '';
  private readonly labsText = el('span');
  private readonly labsEl: HTMLElement;
  private readonly billEl: HTMLElement;
  private readonly bill: Record<'label' | 'used' | 'own' | 'bought' | 'cents' | 'rental', HTMLElement>;
  private readonly heldEl = el('span.rs-held', { hidden: '' });
  private readonly planEl = el<'button'>('button.rs-plan', { type: 'button', hidden: '', onclick: () => this.togglePlan() });
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
  private armed: { branch: BranchId; until: number } | null = null;
  /** A plan just unlocked: its node stamps « ✓ » for a moment. */
  private just: { id: string; until: number } | null = null;
  /** Dragging the canvas: where it started, and whether it moved (a drag is not a click). */
  private drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
  private dragged = false;

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
    });
    this.labsEl = el('span.rs-labs', {}, [buildingIcon(atlas, 'observatory', 18), this.labsText]);
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
        this.slotsEl, this.labsEl, this.billEl, this.heldEl, this.planEl, this.qheadEl, this.notesEl, this.reserveEl,
        this.dragHint,
        el('button.btn.rs-close', { onclick: () => host.close(), title: t('screen.close') }, '✕'),
      ]),
      el('div.rs-body', {}, [this.view, this.detail]),
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
    setText(this.title, t('tree.title'));
    setText(this.dragHint, t('tree.drag'));
    const canvas = el('div.tr-canvas', { style: `width:${L.w}px;height:${L.h}px` });
    // Back to front: the two blocks, the tier columns, the lanes, the links, the nodes.
    for (const b of L.blocks) {
      canvas.append(el('div.tr-block', { 'data-kind': b.kind, style: `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px` }, [
        el('div.tr-blockhead', {}, b.kind === 'plan'
          ? [el('h2.lettering', {}, t('tree.part.plans')), el('span.tr-legend', {}, [el('i.tr-swatch', { 'data-kind': 'plan' }), t('tree.legend.plan')])]
          : [el('h2.lettering', {}, t('tree.part.research')), this.researchLegend()]),
      ]));
    }
    for (const col of L.tiers) canvas.append(...this.tierEls(col));
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
    const at = new Map(L.nodes.map((s) => [s.id, s]));
    for (const link of L.links) {
      const a = at.get(link.from), b = at.get(link.to);
      if (!a || !b) continue;
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'tr-link');
      if (link.path) {
        // Into the gate: along its own row to the plans block's edge, then converging with the others.
        const xr = x2 - GATE_GAP + 10, dx = (x2 - xr) / 2;
        path.setAttribute('d', `M${x1} ${y1} H${xr} C${xr + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`);
      } else {
        const dx = Math.max(24, (x2 - x1) / 2);
        path.setAttribute('d', `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`);
      }
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
    const { scrollLeft, scrollTop } = this.view;
    this.view.replaceChildren(canvas);
    this.view.scrollLeft = scrollLeft;
    this.view.scrollTop = scrollTop;
  }

  /** Research's legend, in its own marks: the kinds of data (one more each tier, D71), AI tokens, the minimum time. */
  private researchLegend(): HTMLElement {
    const L = locale();
    const kinds = SCIENCE.map(([it], k) => el('span.rs-kind', { title: `${t('tree.rs.tier', { n: k + 1 })} · ${itemDef(itemIdx(it)).name[L]}` }, [itemIcon(this.atlas, itemIdx(it), 16)]));
    return el('span.tr-legend.rs-legend', {}, [
      el('span', { title: t('tree.legend.data.tip') }, [...kinds, t('tree.legend.data')]),
      el('span', {}, [mark('token'), t('tree.legend.tokens')]),
      el('span', {}, [mark('clock'), t('tree.legend.time')]),
    ]);
  }

  /** A tier column: its stripe and its head — « Tier 2 » and what opens it (a button to it). */
  private tierEls(col: TierCol): HTMLElement[] {
    const gate = gateOf(col.tier);
    const gateBtn = el('button.tr-gate', {
      type: 'button', 'data-gate-id': gate, title: t('tree.rs.opens.tip', { name: nodeName(gate)[locale()] }),
      onclick: () => { this.select(gate); this.views.get(gate)?.node.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); },
    }, [mark('lock'), el('span.tr-gatecheck', {}, '✓'), nodeName(gate)[locale()]]);
    const head = el('div.tr-tierhead', { 'data-tier': String(col.tier), style: `left:${col.x}px;top:${col.y}px;width:${col.w}px;height:${TIER_HEAD_H}px` }, [
      el('span.tr-tiername.lettering', {}, t('tree.rs.tier', { n: col.tier })),
      el('span.tr-opens', {}, [el('small', {}, t('tree.rs.opens')), gateBtn]),
    ]);
    this.tierHeads.set(col.tier, { head, gate: gateBtn });
    return [el('div.tr-tiercol', { 'data-tier': String(col.tier), style: `left:${col.x}px;top:${col.y}px;width:${col.w}px;height:${col.h}px` }), head];
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
    let respec: HTMLButtonElement | null = null;
    let name: string, theme: string;
    if (lane.id === 'trunk') {
      name = t('tree.rs.trunk');
      theme = t('tree.rs.trunk.theme');
    } else {
      const f = lane.id as FamilyId;
      name = FAMILIES[f].name[locale()];
      theme = FAMILIES[f].specs ? Object.values(FAMILIES[f].specs!).map((s) => s[locale()]).join(' · ') : FAMILIES[f].tiers[2][locale()];
      respec = el<'button'>('button.rs-respec', { type: 'button', onclick: () => this.respec(f) }, t('research.respec'));
    }
    const label = el('div.tr-lane', { 'data-kind': 'research', 'data-lane': lane.id, style }, [
      el('span.tr-lanename.lettering', {}, name), el('small.tr-paththeme', {}, theme), count, respec,
    ]);
    this.heads.set(lane.id, { label, count, respec });
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
    let unlock: HTMLButtonElement | null = null, time: HTMLElement | null = null, bar: HTMLElement | null = null;
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
      // Three lines: the name; one chip per kind of data (D71: one kind a tier); its tokens, their
      // price at CrierBelt and its minimum time.
      time = el('span');
      tok = el('span.tr-tokbox');
      bar = el('span.tr-bar');
      qtag = el('span.tr-qtag');
      lines = [cost, el('span.tr-rfoot', {}, [tok, el('span.tr-time', { title: t('tree.legend.time') }, [mark('clock'), time])])];
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
    this.views.set(s.id, { spot: s, node, cost, chips, tok, time, qtag, bar, unlock });
    return node;
  }

  /** A research node's costs: a chip per kind of data, AI tokens and their price at CrierBelt now; its time. */
  private fillCosts(v: NodeView, sim: Sim): void {
    const id = v.spot.id;
    const L = locale();
    const e = effectiveCost(id);
    v.cost.replaceChildren(
      ...e.cost.map((c) => el('span.tr-chip', { 'data-k': 'data', title: `${num(c.mu / 1000)} ${itemDef(c.item).name[L]}` }, [itemIcon(this.atlas, c.item, 14), shortNum(c.mu / 1000, 10_000)])),
    );
    v.tok!.replaceChildren(
      el('span.tr-chip', { 'data-k': 'tok', title: t('tree.rs.tok.tip', { v: num(e.tokens) }) }, [mark('token'), tokShort(e.tokens)]),
      el('span.tr-oc', { title: t('tree.rs.oc.tip', { p: oc(sim.tokenPriceK(), false, 0) }) }, ocApprox(tokenCents(sim, e.tokens))),
    );
    setText(v.time!, shortTime(e.ticks));
  }

  // ── interaction ──

  private select(id: string): void {
    if (this.dragged) return; // the end of a drag, not a click
    this.selected = id;
    this.detailSig = '';
    this.refresh();
  }

  private dragStart(e: PointerEvent): void {
    this.dragged = false;
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    this.drag = { x: e.clientX, y: e.clientY, left: this.view.scrollLeft, top: this.view.scrollTop, moved: false };
  }

  private dragMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && dx * dx + dy * dy < 25) return;
    if (!d.moved) { d.moved = true; this.view.setPointerCapture(e.pointerId); setAttr(this.view, 'data-drag', ''); }
    this.view.scrollLeft = d.left - dx;
    this.view.scrollTop = d.top - dy;
  }

  private dragEnd(e: PointerEvent): void {
    if (this.drag?.moved) {
      this.dragged = true; // the click that follows this pointerup selects nothing
      if (this.view.hasPointerCapture(e.pointerId)) this.view.releasePointerCapture(e.pointerId);
      setTimeout(() => { this.dragged = false; }, 0);
    }
    this.drag = null;
    setAttr(this.view, 'data-drag', null);
  }

  /** The wheel scrolls the tree sideways when it has nothing to scroll up and down. */
  private wheel(e: WheelEvent): void {
    const v = this.view;
    if (v.scrollHeight > v.clientHeight + 1 && !e.shiftKey) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    v.scrollLeft += e.deltaY;
    e.preventDefault();
  }

  /** On opening: the guide's node, else the selection (or the first plan to take, else the first research to start), brought into view. */
  opened(): void {
    const sim = this.host.sim();
    const focus = this.host.focus?.() ?? null;
    if (focus && this.views.has(focus)) { this.selected = focus; this.detailSig = ''; this.refresh(); }
    else if (!this.selected || !this.views.has(this.selected)) {
      this.selected = PLAN_IDS.find((id) => sim.planBlock(id) === null)
        ?? PLAN_IDS.find((id) => sim.planBlock(id) === 'unaffordable' || sim.planBlock(id) === 'reserve')
        ?? RESEARCH_IDS.find((id) => sim.researchBlock(id) === null)
        ?? ROOT;
      this.detailSig = '';
      this.refresh();
    }
    this.views.get(this.selected)?.node.scrollIntoView({ block: 'nearest', inline: 'center' });
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

  /** Reconversion (per family): a first click arms it for 3 s, the second confirms. */
  private respec(b: BranchId): void {
    const sim = this.host.sim();
    if (sim.respecBlock(b)) return;
    const now = performance.now();
    if (!this.armed || this.armed.branch !== b || now > this.armed.until) { this.armed = { branch: b, until: now + 3000 }; this.refresh(); return; }
    this.armed = null;
    if (sim.respec(b)) this.host.notify('info', t('research.respecName', { branch: FAMILIES[b].name[locale()] }));
    this.detailSig = '';
    this.refresh();
  }

  /** A reconversion button's state (lane labels and the detail pane): disabled with its reason, armed, or its hint. */
  private paintRespec(btn: HTMLButtonElement, sim: Sim, f: FamilyId): void {
    const why = sim.respecBlock(f);
    setAttr(btn, 'disabled', why ? '' : null);
    const armed = !!this.armed && this.armed.branch === f && performance.now() < this.armed.until;
    setText(btn, armed ? t('research.respec.confirm') : t('research.respec'));
    setAttr(btn, 'data-armed', armed ? '' : null);
    const cd = why === 'cooldown' ? duration((14 * 24 * 3600 * TPS - (sim.tick - sim.lastRespec)) / TPS) : '';
    setAttr(btn, 'title', why ? (why === 'cooldown' ? t('research.respec.cooldown', { d: cd }) : t(`research.respec.${why}` as MsgKey)) : t('research.respec.hint'));
  }

  private start(id: string): void {
    const sim = this.host.sim();
    const r = sim.startResearch(id);
    if (!r.ok && r.reason) this.host.notify('bad', r.reason === 'prereq' ? t('research.block.prereq', { list: this.missing(sim, id) }) : t(`research.block.${r.reason}` as MsgKey));
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

  // ── state ──

  private planState(sim: Sim, id: string): PlanState {
    const b = sim.planBlock(id);
    // Short of materials, or of what may be spent above the restart reserve (D36): « poor » alike.
    return b === 'done' ? 'done' : b === 'prereq' ? 'locked' : b === 'unaffordable' || b === 'reserve' ? 'poor' : 'ready';
  }

  private researchState(sim: Sim, id: string): ResearchState {
    if (sim.done.has(id)) return 'done';
    if (sim.projects.some((p) => p.id === id)) return 'active';
    const block = sim.researchBlock(id);
    return block === 'prereq' ? 'locked' : block ? 'waiting' : 'ready';
  }

  private stateOf(sim: Sim, id: string): string {
    return id === ROOT ? 'done' : isPlan(id) ? this.planState(sim, id) : this.researchState(sim, id);
  }

  /** Why a node is where it is, in a few words (its tooltip, the detail pane). */
  private why(sim: Sim, id: string): string {
    if (id === ROOT) return t('tree.root.desc');
    const st = this.stateOf(sim, id);
    if (st === 'locked') return isGate(id) ? t('tree.gate.needs', this.gateCount(sim, id)) : t('tree.needs', { list: this.missing(sim, id) });
    if (isPlan(id)) {
      if (st !== 'poor') return st === 'done' ? t('tree.unlocked') : t('tree.ready');
      const short = this.reserveShort(sim, id);
      return short.length ? t('tree.reserved', { list: this.shortList(short) }) : t('tree.poor');
    }
    if (st === 'done') return t('research.done');
    if (st === 'active') return sim.researchHeld ? t('tree.rs.held') : this.eta(sim, id) ?? t('research.active');
    const block = sim.researchBlock(id);
    return block ? t(`research.block.${block}` as MsgKey) : t('research.start');
  }

  /** ETA of a running project (game time at the current power), or null. */
  private eta(sim: Sim, id: string): string | null {
    const p = sim.projects.find((q) => q.id === id);
    if (!p) return null;
    if (sim.researchHeld) return t('tree.rs.held');
    const net = p.lab ? sim.graph?.nodeByEnt.get(p.lab)?.net ?? -1 : -1;
    const sat = p.lab ? (net >= 0 ? sim.netPower[net]?.sat ?? 0 : 0) : 1000;
    if (sat <= 0) return null;
    const left = Math.max(0, p.dur * 1000 - p.el) / sat / TPS;
    const short = p.cost.some((c, i) => p.paid[i]! < c.mu && p.el >= p.dur * 1000);
    return short ? t('research.waiting') : t('research.eta', { d: duration(left) });
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
    // Research costs are the table's (D72); what they come to in ◉ follows CrierBelt's token price.
    const sig = `${sim.tokenPriceK()}`;
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
        setAttr(v.node, 'data-held', proj && sim.researchHeld ? '' : null);
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
    this.renderDetail(sim, L);
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

  /** Research lanes: how many of its nodes the claim owns (« 4/10 »), and the family's reconversion. */
  private refreshLanes(sim: Sim): void {
    const counts = branchCounts(sim.done);
    const L = locale();
    for (const [lane, h] of this.heads) {
      const of = RESEARCH_IDS.filter((id) => researchNode(id)!.branch === lane).length;
      const n = lane === 'trunk' ? RESEARCH_IDS.filter((id) => researchNode(id)!.branch === 'trunk' && sim.done.has(id)).length : counts[lane as FamilyId];
      setText(h.count, `${n}/${of}`);
      setAttr(h.label, 'data-full', n === of ? '' : null);
      setAttr(h.label, 'title', t('tree.rs.count.tip', { name: lane === 'trunk' ? t('tree.rs.trunk') : FAMILIES[lane as FamilyId].name[L], n, of }));
      if (h.respec) this.paintRespec(h.respec, sim, lane as FamilyId);
    }
  }

  /** The tier heads: open once their gate is done; the selected node's tier lit, and the tier the selected node opens. */
  private refreshTiers(sim: Sim): void {
    const sel = researchNode(this.selected)?.tier ?? null;
    for (const [tier, h] of this.tierHeads) {
      const open = sim.done.has(gateOf(tier));
      setAttr(h.head, 'data-open', open ? '' : null);
      setAttr(h.head, 'data-on', sel === tier ? '' : null);
      setAttr(h.head, 'data-opens', this.selected === gateOf(tier) ? '' : null);
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
    const sig = `${id}:${this.costSig}:${proj ? 1 : 0}:${st}:${block}:${L}:${this.shortList(short)}:${qOn ? 1 : 0}:${labs}`;
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
      st !== 'done' && st !== 'ready' ? el('small.rs-why', {}, this.why(sim, id)) : null,
      short.length ? el('p.rs-desc', {}, this.reserveTip()) : null,
    ]));
    return kids;
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
    if (lvl > 1) rows.push(el('li', {}, [buildingIcon(this.atlas, 'hearth', 24), t('tree.heartLevel', { n: lvl })]));
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
      proj ? this.progressPart(proj) : null,
      el('footer.rs-actions', {}, [
        st === 'done' ? el('span.rs-tag', {}, t('research.done'))
          : proj ? el('button.btn', { type: 'button', onclick: () => this.cancel(id) }, t('research.cancel'))
            : el('button.btn.primary', { type: 'button', disabled: block ? '' : null, onclick: () => this.start(id) }, t('research.start')),
        st !== 'done' && !proj && block ? el('small.rs-why', {}, block === 'prereq' ? t('research.block.prereq', { list: this.missing(sim, id) }) : t(`research.block.${block}` as MsgKey)) : null,
      ]),
    ];
    if (st !== 'done' && sim.mods.flags.has('researchQueue')) kids.push(this.queuePart(sim, id, L));
    if (fam) kids.push(this.familyPart(fam, L));
    return kids;
  }

  /**
   * A research node's cost (D68, D69): data files, AI tokens and what they would cost at CrierBelt
   * now, the minimum time — the table's, whatever else the claim owns (D72).
   */
  private costPart(sim: Sim, id: string): HTMLElement[] {
    const e = effectiveCost(id);
    const lines = el('ul.tr-costs.rs-rcosts', {}, [
      ...e.cost.map((c) => el('li', {}, [el('b', {}, num(c.mu / 1000)), itemMention(c.item)])),
      el('li', { title: t('tree.rs.oc.tip', { p: oc(sim.tokenPriceK(), false, 0) }) }, [
        el('b', {}, tokShort(e.tokens)), el('span.rs-cl', {}, [mark('token'), t('tree.legend.tokens')]),
        el('small.rs-price', {}, t('tree.rs.price', { v: ocApprox(tokenCents(sim, e.tokens)) })),
      ]),
      el('li', {}, [el('b', {}, duration(e.ticks / TPS)), el('span.rs-cl', {}, [mark('clock'), t('tree.legend.time')])]),
    ]);
    return [el('h4.lettering.rs-costhead', {}, [t('research.cost')]), lines];
  }

  /** A running project (D68): data files paid of each cost, tokens used of its total, time run of its minimum; its end. */
  private progressPart(p: Project): HTMLElement {
    const bar = (): { root: HTMLElement; fill: HTMLElement } => { const fill = el('span'); return { root: el('span.rs-pbar', {}, fill), fill }; };
    const rows: HTMLElement[] = [];
    const row = (label: Array<Node | string>, read: (sim: Sim, q: Project) => [number, number, string]): void => {
      const b = bar(), txt = el('small');
      rows.push(el('div.rs-prow', {}, [el('span.rs-plabel', {}, label), b.root, txt]));
      this.detailLive.push((sim) => {
        const q = sim.projects.find((x) => x.id === p.id);
        if (!q) return;
        const [a, of, text] = read(sim, q);
        b.fill.style.width = `${of > 0 ? Math.min(100, (a * 100) / of) : 100}%`;
        setText(txt, text);
      });
    };
    p.cost.forEach((c, i) => row([itemIcon(this.atlas, c.item, 16) ?? '', itemDef(c.item).name[locale()]], (_s, q) => [q.paid[i]!, q.cost[i]!.mu, `${shortNum(Math.floor(q.paid[i]! / 1000), 10_000)} / ${shortNum(q.cost[i]!.mu / 1000, 10_000)}`]));
    if (p.tokens) row([mark('token'), t('tree.rs.prog.tokens')], (_s, q) => [tokensDue(q), q.tokens ?? 0, `${tokShort(tokensDue(q))} / ${tokShort(q.tokens ?? 0)}`]);
    row([mark('clock'), t('tree.rs.prog.time')], (_s, q) => {
      const ran = Math.min(q.el, q.dur * 1000) / 1000;
      return [ran, q.dur, `${shortTime(ran)} / ${shortTime(q.dur)}`];
    });
    const eta = el('div.rs-live');
    const held = el('div.rs-heldnote', { hidden: '' }, t('tree.rs.held'));
    this.detailLive.push((sim) => {
      const q = sim.projects.find((x) => x.id === p.id);
      const pct = q ? t('research.progress', { v: Math.floor(projectPermille(q) / 10) }) : '';
      const end = q && !sim.researchHeld ? this.eta(sim, p.id) : null;
      setText(eta, end ? `${pct} · ${end}` : pct);
      held.hidden = !sim.researchHeld;
      setAttr(held, 'title', t('tree.rs.held.tip', { v: oc(sim.credits) }));
    });
    return el('section.rs-prog', {}, [el('h4.lettering', {}, t('tree.rs.progress')), ...rows, eta, held]);
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
      waits ? el('small.rs-why', {}, t('tree.rs.queue.wait', { list: this.missing(sim, id) })) : null,
      labs.length ? el('ul.rs-qlabs', {}, rows) : el('small.rs-why', {}, t('tree.rs.noLab.tip')),
    ]);
  }

  /** A family's corner of the pane: its name, how much of it is owned, and its reconversion (as on its lane's label). */
  private familyPart(f: FamilyId, L: Loc): HTMLElement {
    const count = el('small.tr-pathcount');
    const btn = el<'button'>('button.rs-respec', { type: 'button', onclick: () => this.respec(f) }, t('research.respec'));
    const of = RESEARCH_IDS.filter((id) => researchNode(id)!.branch === f).length;
    this.detailLive.push((s) => {
      const n = branchCounts(s.done)[f];
      setText(count, `${n}/${of}`);
      setAttr(count, 'title', t('tree.rs.family.count', { n, of }));
      this.paintRespec(btn, s, f);
    });
    return el('section.rs-fam', { 'data-lane': f }, [
      el('h4.lettering', {}, t('tree.rs.family')),
      el('div.rs-famrow', {}, [el('span.rs-famname.lettering', {}, FAMILIES[f].name[L]), count, btn]),
      el('small.rs-qnote', {}, t('research.respec.hint')),
    ]);
  }
}
