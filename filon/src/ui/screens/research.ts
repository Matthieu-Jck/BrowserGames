// research.ts — the tech tree screen (D33; T, or the HUD's tree chip): one tree, two kinds of
// node. On the left the plans grow from the Heart's starting kit in six paths of one theme each
// (D41, `PLAN_PATHS`: production, logistics, energy, analytics, trade, survey), each drawn as a
// band of its own colour with its name, what it is for and how much of it is unlocked: a plan
// unlocks with one click, paid from the Heart at once. On the right the research hangs from the
// observatory's plan — the trunk and the five branches, banded alike — and starts in an
// observatory as before (data, a minimum time, specialisation, reconversion).
// Each node shows the icons of what it unlocks (buildings, recipes' items, a glyph for a feature
// or an effect), its cost (materials; research: data and the minimum time) and its state
// (unlocked, ready, short of materials, waiting, locked — and why, in its tooltip and the
// detail pane); inked links run from each prerequisite to what it opens. A plan whose cost would
// eat into CrierBelt's restart reserve (D36) reads « short of materials » with that reason, and
// the header shows what the Heart's stock must keep while the buildings do not cover it. The canvas scrolls and
// pans by dragging; the detail pane on the right gives the whole picture and the action (its cost
// one item a line: how many, the item's icon and name, what the Heart holds).
// The layout is computed once from content (`treeLayout`: the longest path from the root is the
// column, the lanes are the rows); the 4 Hz refresh only writes states, costs and progress. The
// sim decides; this only shows and asks (`unlockPlan`, `startResearch`, `cancelResearch`, `respec`).
import { BAL } from '@/content/balance';
import { ESSENTIAL, RESERVED } from '@/content/reserve';
import { PLAN_IDS, PLAN_PATHS, buildingsUnlockedBy, isPlan, isResearch, nodeName, pathPlans, planDef, researchNode, treePrereq } from '@/content/research';
import { RECIPES } from '@/content/recipes';
import { BUILDING_IDS, BUILDING_KIND, RESEARCH_IDS, buildingDef, buildingIdx, itemDef, itemIdx, toMu } from '@/content/registry';
import type { Effect, PlanLane, RecipeDef } from '@/content/types';
import { el, setAttr, setText } from '@/core/dom';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import { duration, num } from '@/i18n/format';
import type { Atlas } from '@/render/art/atlas';
import { C } from '@/render/art/tokens';
import type { Sim } from '@/sim/state';
import { BRANCHES, branchCounts, effectiveCost, penalty, projectPermille, type BranchId } from '@/sim/research/runtime';
import { TPS } from '@/sim/constants';
import { buildingIcon, itemIcon } from '../build-bar';
import { itemMention, itemRef } from '../mention';

export interface ResearchHost {
  sim(): Sim;
  close(): void;
  notify(kind: 'good' | 'bad' | 'info' | 'warn', text: string): void;
  /** The node the tutorial's guide is after (null: none): the tree opens on it. */
  focus?(): string | null;
}

// ── layout ──────────────────────────────────────────────────────────────────

/** The root: the Heart and its starting kit (not a node of the tree's tables). */
export const ROOT = 'heart';

const NODE_W = 186, NODE_H = 56;
const COL_W = 226, ROW_H = 66, LANE_GAP = 4;
const LABEL_W = 124, PAD = 16, HEAD_H = 40, BLOCK_GAP = 36;
/** A lane's band reaches this far above and below its rows (below: most of the « Débloquer » tab). */
const BAND_TOP = 4, BAND_BOTTOM = 7;
const RESEARCH_LANES: readonly string[] = ['trunk', ...BRANCHES];

type Kind = 'root' | 'plan' | 'research';
interface Spot { id: string; kind: Kind; lane: string; x: number; y: number }
/** A lane: a plan path or a research branch — its label at (x, y), its band `w` wide to the block's right edge. */
interface Lane { id: string; kind: 'plan' | 'research'; x: number; y: number; w: number; h: number }
interface Block { kind: 'plan' | 'research'; x: number; y: number; w: number; h: number }
interface Link { from: string; to: string; gate: boolean }
export interface TreeLayout { nodes: Spot[]; lanes: Lane[]; blocks: Block[]; links: Link[]; w: number; h: number }

const laneOf = (id: string): string => planDef(id)?.lane ?? researchNode(id)?.branch ?? '';

/**
 * Where every node goes, from content alone. A node's column is its longest path from the root
 * (a plan with no prerequisite is column 1, the Heart column 0); research sits in its own block
 * right of the plans, from the column after the plans' last. Within a lane, a node takes the free
 * row of its column nearest to its in-lane parents', so branches stay straight and rarely cross.
 */
export function treeLayout(): TreeLayout {
  const depth = new Map<string, number>();
  const d = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const pre = treePrereq(id);
    const v = pre.length ? 1 + Math.max(...pre.map(d)) : 1;
    depth.set(id, v);
    return v;
  };
  const plans: readonly string[] = PLAN_IDS;
  const research: readonly string[] = RESEARCH_IDS;
  const maxPlanCol = Math.max(...plans.map(d));
  const minRes = Math.min(...research.map(d));
  const maxRes = Math.max(...research.map(d));

  const row = new Map<string, number>();
  const laneRows = new Map<string, number>();
  const assign = (ids: readonly string[], lanes: readonly string[]): void => {
    for (const lane of lanes) {
      const mine = ids.filter((id) => laneOf(id) === lane).sort((a, b) => d(a) - d(b) || ids.indexOf(a) - ids.indexOf(b));
      const taken = new Map<number, Set<number>>();
      let rows = 1;
      for (const id of mine) {
        const parents = treePrereq(id).filter((p) => row.has(p) && laneOf(p) === lane);
        const want = parents.length ? Math.round(parents.reduce((s, p) => s + row.get(p)!, 0) / parents.length) : 0;
        const used = taken.get(d(id)) ?? new Set<number>();
        let r = want;
        for (let k = 0; ; k++) {
          if (want - k >= 0 && !used.has(want - k)) { r = want - k; break; }
          if (!used.has(want + k)) { r = want + k; break; }
        }
        used.add(r);
        taken.set(d(id), used);
        row.set(id, r);
        rows = Math.max(rows, r + 1);
      }
      laneRows.set(lane, rows);
    }
  };
  assign(plans, PLAN_PATHS);
  assign(research, RESEARCH_LANES);

  const top = PAD + HEAD_H;
  const px0 = PAD + LABEL_W;
  const pw = (maxPlanCol + 1) * COL_W - (COL_W - NODE_W);
  const rx0 = px0 + pw + BLOCK_GAP + LABEL_W;
  const rw = (maxRes - minRes + 1) * COL_W - (COL_W - NODE_W);
  const nodes: Spot[] = [], lanes: Lane[] = [];
  const stack = (ids: readonly string[], laneIds: readonly string[], kind: 'plan' | 'research', x0: number, w: number, col: (id: string) => number): number => {
    let y = top;
    for (const lane of laneIds) {
      const h = laneRows.get(lane)! * ROW_H - (ROW_H - NODE_H);
      lanes.push({ id: lane, kind, x: x0 - LABEL_W, y, w: LABEL_W + w, h });
      for (const id of ids) if (laneOf(id) === lane) nodes.push({ id, kind, lane, x: x0 + col(id) * COL_W, y: y + row.get(id)! * ROW_H });
      y += h + LANE_GAP + (ROW_H - NODE_H);
    }
    return y - LANE_GAP - (ROW_H - NODE_H);
  };
  const planBottom = stack(plans, PLAN_PATHS, 'plan', px0, pw, d);
  const resBottom = stack(research, RESEARCH_LANES, 'research', rx0, rw, (id) => d(id) - minRes);
  nodes.unshift({ id: ROOT, kind: 'root', lane: '', x: px0, y: Math.round((top + planBottom) / 2 - NODE_H / 2) });

  const links: Link[] = [];
  for (const id of plans) {
    const pre = treePrereq(id);
    if (!pre.length) links.push({ from: ROOT, to: id, gate: false });
    for (const p of pre) links.push({ from: p, to: id, gate: false });
  }
  for (const id of research) for (const p of treePrereq(id)) links.push({ from: p, to: id, gate: isResearch(p) && laneOf(p) !== laneOf(id) });

  const bottom = Math.max(planBottom, resBottom);
  return {
    nodes, lanes, links,
    blocks: [
      { kind: 'plan', x: PAD - 6, y: PAD - 4, w: LABEL_W + pw + 12, h: planBottom - PAD + 12 },
      { kind: 'research', x: rx0 - LABEL_W - 6, y: PAD - 4, w: LABEL_W + rw + 12, h: resBottom - PAD + 12 },
    ],
    w: rx0 + rw + PAD, h: bottom + PAD,
  };
}

// ── icons: what a node unlocks ──────────────────────────────────────────────

/** A glyph drawn in code for what has no building or item: the analytics readouts (D41), the market's ◉, the land's parcels (D60). */
type Glyph = 'telemetry' | 'ledger' | 'power' | 'gauge' | 'coin' | 'land';
type Icon = { b: string } | { i: string } | { g: Glyph };

/** What stands for an effect on the tree: the building or item it improves, or a glyph. */
const EFFECT_ICON: Readonly<Record<string, Icon>> = {
  digSpeed: { b: 'excavator' }, rubbleYield: { i: 'stone' }, embeddedOre: { i: 'iron_ore' }, excavatedSpeed: { b: 'excavator' },
  digH3: { i: 'stone' }, digH4: { i: 'stone' }, basaltBits: { b: 'excavator' }, deepFill: { b: 'backfiller' }, tunnels: { b: 'ribbon' },
  // The land (D60): leases (Land Registry's flag), prices, rents, how each purchase raises the next, far land.
  lease: { g: 'land' }, landPrice: { g: 'land' }, landRent: { g: 'land' }, landGrowth: { g: 'land' }, farLand: { g: 'land' },
  remoteBeltCost: { b: 'ribbon' }, remoteBuildDelay: { b: 'beacon' }, pylonLink: { b: 'pylon' },
  ring3Caps: { b: 'deep_bore' }, dockShips: { b: 'skydock' }, shipCap: { b: 'skydock' }, shipSpeed: { b: 'skydock' },
  drifterDistance: { b: 'skydock' }, bridgeSpan: { b: 'skybridge' }, forkFilters: { b: 'router' }, modules1: { i: 'pace_bell' },
  modules2: { i: 'pace_bell' }, craftSpeed: { i: 'gear' },
  windOut: { b: 'wind_flower' }, gustVariance: { b: 'wind_flower' }, stormHarvest: { b: 'wind_flower' }, solarOut: { b: 'sun_bulb' },
  solarNight: { b: 'sun_bulb' }, accCap: { b: 'accumulator' }, accRate: { b: 'accumulator' }, geoOut: { b: 'fumarole_tap' },
  deepHeat: { b: 'fumarole_tap' }, genOut: { b: 'brazier' },
  tradeFee: { g: 'coin' }, slippage: { g: 'coin' }, forecast: { g: 'coin' }, forwards: { g: 'coin' }, charters: { g: 'coin' },
  deliveryDelay: { b: 'trade_post' }, orders: { b: 'trade_post' }, tradeL2: { b: 'trade_post' }, tradeL3: { b: 'trade_post' },
  crierHouse: { b: 'trade_post' }, slots: { b: 'observatory' },
  // The analytics path's readouts (D41), by their flags.
  telemetry: { g: 'telemetry' }, statistics: { g: 'ledger' }, power_log: { g: 'power' }, diagnostics: { g: 'gauge' },
};

const recipesOf = (id: string): RecipeDef[] => (Object.values(RECIPES) as RecipeDef[]).filter((r) => r.unlock === id);
const effectsOf = (id: string): readonly Effect[] => planDef(id)?.effects ?? researchNode(id)?.effects ?? [];
const heartLevelOf = (id: string): number => BAL.hearthUpgrades.findIndex((u) => u.unlock === id) + 2; // 1: none
const startBuildings = (): string[] => BUILDING_IDS.filter((b) => buildingDef(buildingIdx(b)).unlock === 'start');

/** The icons of what a node unlocks, most telling first (buildings, recipes' items, the Heart, effects); three at most. */
function iconsOf(id: string): Icon[] {
  if (id === ROOT) return [{ b: 'hearth' }, ...startBuildings().map((b) => ({ b }))].slice(0, 3); // the Heart, its kit
  const out: Icon[] = buildingsUnlockedBy(id).map((b) => ({ b }));
  for (const r of recipesOf(id)) out.push({ i: r.outs[0]![0] });
  if (heartLevelOf(id) > 1) out.push({ b: 'hearth' });
  for (const ef of effectsOf(id)) {
    const key = ef.k === 'flag' ? ef.flag : ef.k === 'slots' ? 'slots' : ef.k === 'unlock' ? '' : ef.target;
    const ic = EFFECT_ICON[key];
    if (ic) out.push(ic);
  }
  const seen = new Set<string>();
  const uniq = out.filter((ic) => { const k = JSON.stringify(ic); if (seen.has(k)) return false; seen.add(k); return true; });
  return (uniq.length ? uniq : [{ b: 'observatory' } as Icon]).slice(0, 3);
}

/**
 * A readout's glyph, inked on a paper card (D41): telemetry — three bars and a rising line; the
 * ledger — a sheet of ruled rows with a coral tab; the power log — a bolt over a jagged line; the
 * diagnostics — a dial whose needle leans to coral. The land (D60): a map of parcels, the claim's
 * washed turquoise and bordered, a sister claim's hatched coral, a boundary stone.
 */
function glyph(kind: Exclude<Glyph, 'coin'>, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(size * 2);
  const g = c.getContext('2d')!;
  const s = c.width / 40;
  const line = (pts: ReadonlyArray<readonly [number, number]>, color: string, w: number): void => {
    g.strokeStyle = color; g.lineWidth = w * s; g.beginPath();
    pts.forEach(([x, y], k) => (k ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s)));
    g.stroke();
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
  } else if (kind === 'land') {
    // Three by three parcels; the middle column and the top-left held, one hatched for a sister claim.
    const x0 = 8, y0 = 9, k = 8;
    g.lineWidth = 1 * s; g.strokeStyle = C.inkSoft;
    for (let i = 1; i < 3; i++) { line([[x0 + i * k, y0], [x0 + i * k, y0 + 3 * k]], C.inkSoft, 1); line([[x0, y0 + i * k], [x0 + 3 * k, y0 + i * k]], C.inkSoft, 1); }
    g.fillStyle = C.turqL;
    for (const [c, r] of [[0, 0], [1, 0], [1, 1], [1, 2]] as const) g.fillRect((x0 + c * k + 0.6) * s, (y0 + r * k + 0.6) * s, (k - 1.2) * s, (k - 1.2) * s);
    line([[x0, y0], [x0 + 2 * k, y0], [x0 + 2 * k, y0 + 3 * k], [x0 + k, y0 + 3 * k], [x0 + k, y0 + k], [x0, y0 + k], [x0, y0]], C.turqD, 2.2);
    for (let d = 2; d < 2 * k; d += 3) line([[x0 + 2 * k + Math.max(0, d - k), y0 + 2 * k + Math.min(d, k)], [x0 + 2 * k + Math.min(d, k), y0 + 2 * k + Math.max(0, d - k)]], C.coral, 1.3);
    g.fillStyle = C.paperD; g.strokeStyle = C.ink; g.lineWidth = 1.4 * s;
    g.beginPath(); g.moveTo(29 * s, 4 * s); g.lineTo(33 * s, 4 * s); g.lineTo(34 * s, 10 * s); g.lineTo(28 * s, 10 * s); g.closePath(); g.fill(); g.stroke();
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

/** A research's minimum time, compact enough for a node: « 45 min », « 4,2 h », « 18 h », « 1 j ». */
function shortTime(ticks: number): string {
  const min = ticks / TPS / 60;
  if (min < 60) return t('tree.time.min', { n: Math.round(min) });
  const h = min / 60;
  if (h < 24) return t('tree.time.h', { n: num(h < 10 ? Math.round(h * 10) / 10 : Math.round(h)) });
  return t('tree.time.d', { n: num(Math.round((h / 24) * 10) / 10) });
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
  time: HTMLElement | null;
  bar: HTMLElement | null;
  unlock: HTMLButtonElement | null;
}

export class ResearchScreen {
  readonly root: HTMLElement;
  private readonly layout = treeLayout();
  private readonly views = new Map<string, NodeView>();
  private readonly paths: Array<{ link: Link; path: SVGPathElement }> = [];
  private readonly heads = new Map<string, { mastery: HTMLElement; respec: HTMLButtonElement | null }>();
  /** The plan paths' labels (D41): the label (its tooltip) and its « n/of » unlocked. */
  private readonly pathHeads = new Map<PlanLane, { label: HTMLElement; count: HTMLElement }>();
  private readonly view: HTMLElement;
  private readonly slotsEl = el('span.rs-slots');
  private readonly labsEl = el('span.rs-labs');
  private readonly notesEl = el('span.rs-notes');
  /** CrierBelt's restart reserve (D36): what the Heart's stock must keep, while the buildings do not cover it. */
  private readonly reserveEl = el('span.rs-reserve');
  private reserveSig = '';
  private readonly detail = el('aside.rs-detail.cartouche');
  private selected = '';
  /** What the research costs were computed for (null: not yet — a new base has nothing done, which is a signature too). */
  private costSig: string | null = null;
  /** The detail pane's plan cost lines, kept live (what the Heart holds of each). */
  private costLive: Array<{ item: number; mu: number; li: HTMLElement; held: HTMLElement }> = [];
  private detailSig = '';
  private armed: { branch: BranchId; until: number } | null = null;
  /** A plan just unlocked: its node stamps « ✓ » for a moment. */
  private just: { id: string; until: number } | null = null;
  /** Dragging the canvas: where it started, and whether it moved (a drag is not a click). */
  private drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
  private dragged = false;

  /** The language the canvas was built in: a switch rebuilds it (names and labels are written once). */
  private builtIn: 'fr' | 'en' | null = null;
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
    this.root = el('section.screen.research.tree', { 'data-screen': 'research' }, [
      el('header.rs-head', {}, [
        this.title,
        this.slotsEl, this.labsEl, this.notesEl, this.reserveEl,
        this.dragHint,
        el('button.btn.rs-close', { onclick: () => host.close(), title: t('screen.close') }, '✕'),
      ]),
      el('div.rs-body', {}, [this.view, this.detail]),
    ]);
    this.build();
  }

  /** The canvas: blocks, lanes, links, nodes — in the current language (rebuilt when it changes). */
  private build(): void {
    const L = this.layout;
    this.builtIn = locale();
    this.views.clear();
    this.paths.length = 0;
    this.heads.clear();
    this.pathHeads.clear();
    this.costSig = null;
    this.detailSig = '';
    setText(this.title, t('tree.title'));
    setText(this.dragHint, t('tree.drag'));
    const canvas = el('div.tr-canvas', { style: `width:${L.w}px;height:${L.h}px` });
    // Back to front: the two blocks, the lanes, the links, the nodes.
    for (const b of L.blocks) {
      canvas.append(el(`div.tr-block`, { 'data-kind': b.kind, style: `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px` }, [
        el('div.tr-blockhead', {}, [
          el('h2.lettering', {}, t(b.kind === 'plan' ? 'tree.part.plans' : 'tree.part.research')),
          el('span.tr-legend', {}, [el('i.tr-swatch', { 'data-kind': b.kind }), t(b.kind === 'plan' ? 'tree.legend.plan' : 'tree.legend.research')]),
        ]),
      ]));
    }
    // Each lane's band (D41): its rows in its colour, from its first column to the block's right
    // edge. A plan path's starts after the Heart's column: the Heart stands apart, its links fan out.
    for (const lane of L.lanes) {
      const x = lane.x + LABEL_W + (lane.kind === 'plan' ? COL_W : 0) - 12;
      canvas.append(el('div.tr-band', {
        'data-kind': lane.kind, 'data-lane': lane.id,
        style: `left:${x}px;top:${lane.y - BAND_TOP}px;width:${lane.x + lane.w - x + 8}px;height:${lane.h + BAND_TOP + BAND_BOTTOM}px`,
      }));
    }
    for (const lane of L.lanes) canvas.append(this.laneEl(lane));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'tr-links');
    svg.setAttribute('width', String(L.w));
    svg.setAttribute('height', String(L.h));
    const at = new Map(L.nodes.map((s) => [s.id, s]));
    for (const link of L.links) {
      const a = at.get(link.from), b = at.get(link.to);
      if (!a || !b) continue;
      const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
      const dx = Math.max(24, (x2 - x1) / 2);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'tr-link');
      path.setAttribute('d', `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`);
      if (link.gate) path.setAttribute('data-gate', '');
      svg.append(path);
      this.paths.push({ link, path });
    }
    canvas.append(svg);
    for (const s of L.nodes) canvas.append(this.nodeEl(s));
    const { scrollLeft, scrollTop } = this.view;
    this.view.replaceChildren(canvas);
    this.view.scrollLeft = scrollLeft;
    this.view.scrollTop = scrollTop;
  }

  /**
   * A lane's label, as tall as its band: a plan path's name, what it is for and how much of it is
   * unlocked (D41); a research branch's name, its mastery and the reconversion button.
   */
  private laneEl(lane: Lane): HTMLElement {
    const style = `left:${lane.x}px;top:${lane.y - BAND_TOP}px;width:${LABEL_W - 14}px;height:${lane.h + BAND_TOP + BAND_BOTTOM}px`;
    if (lane.kind === 'plan') {
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
    const mastery = el('small.rs-mastery');
    let respec: HTMLButtonElement | null = null;
    if (lane.id !== 'trunk') {
      const b = lane.id as BranchId;
      respec = el<'button'>('button.rs-respec', { onclick: () => this.respec(b), title: t('research.respec.hint') }, t('research.respec'));
    }
    this.heads.set(lane.id, { mastery, respec });
    return el('div.tr-lane', { 'data-kind': 'research', 'data-lane': lane.id, style }, [
      el('span.tr-lanename.lettering', {}, t(`research.branch.${lane.id}` as MsgKey)), mastery, respec,
    ]);
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
    const icons = iconsOf(s.id).map((ic, k) => this.icon(ic, k === 0 ? 36 : 20));
    const name = s.id === ROOT ? t('tree.root') : nodeName(s.id)[L];
    const cost = el('span.tr-cost');
    const line = el('span.tr-line', {}, [cost]);
    let chips: NodeView['chips'] = [];
    let unlock: HTMLButtonElement | null = null, time: HTMLElement | null = null, bar: HTMLElement | null = null;
    if (s.kind === 'plan') {
      chips = planDef(s.id)!.cost.map(([it, n]) => {
        const item = itemIdx(it);
        return { item, mu: toMu(n), node: el('span.tr-chip', { title: itemDef(item).name[L] }, [itemIcon(this.atlas, item, 14), String(n)]) };
      });
      cost.replaceChildren(...chips.map((c) => c.node));
      unlock = el<'button'>('button.btn.primary.tr-unlock', { type: 'button', 'data-unlock': s.id, onclick: (e: Event) => { e.stopPropagation(); this.unlock(s.id); } }, t('tree.unlock'));
      line.append(unlock);
    } else if (s.kind === 'research') {
      time = el('span.tr-time');
      line.append(time);
      bar = el('span.tr-bar');
    } else {
      setText(cost, t('tree.start'));
    }
    const node = el('div.tr-node.rs-card', {
      'data-id': s.id, 'data-kind': s.kind, 'data-lane': s.lane || null, 'data-long': [...name].length > 15 ? '' : null, role: 'button', tabindex: '0',
      style: `left:${s.x}px;top:${s.y}px;width:${NODE_W}px;height:${NODE_H}px`,
      onclick: () => this.select(s.id),
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select(s.id); } },
    }, [
      el('span.tr-icons', { 'data-n': String(icons.length) }, icons),
      el('span.tr-main', {}, [el('span.tr-name.lettering', {}, name), line]),
      bar ? el('span.tr-track', {}, bar) : null,
      el('span.tr-stamp', {}, '✓'),
    ]);
    this.views.set(s.id, { spot: s, node, cost, chips, time, bar, unlock });
    return node;
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
      this.host.notify('bad', r.reason === 'prereq' ? t('tree.block.prereq', { list: this.missing(sim, id) })
        : r.reason === 'reserve' ? t('tree.block.reserve', { list: this.shortList(this.reserveShort(sim, id)) })
          : t(`tree.block.${r.reason}` as MsgKey));
    }
    else this.just = { id, until: performance.now() + 1400 };
    this.selected = id;
    this.detailSig = '';
    this.refresh();
  }

  private respec(b: BranchId): void {
    const sim = this.host.sim();
    if (sim.respecBlock(b)) return;
    const now = performance.now();
    if (!this.armed || this.armed.branch !== b || now > this.armed.until) { this.armed = { branch: b, until: now + 3000 }; this.refresh(); return; }
    this.armed = null;
    if (sim.respec(b)) this.host.notify('info', t('research.respecName', { branch: t(`research.branch.${b}` as MsgKey) }));
    this.refresh();
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
    if (st === 'locked') return t('tree.needs', { list: this.missing(sim, id) });
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

  /** ETA of a running project (game time at the current power), or null. */
  private eta(sim: Sim, id: string): string | null {
    const p = sim.projects.find((q) => q.id === id);
    if (!p) return null;
    const net = p.lab ? sim.graph?.nodeByEnt.get(p.lab)?.net ?? -1 : -1;
    const sat = p.lab ? (net >= 0 ? sim.netPower[net]?.sat ?? 0 : 0) : 1000;
    if (sat <= 0) return null;
    const left = Math.max(0, p.dur * 1000 - p.el) / sat / TPS;
    const short = p.cost.some((c, i) => p.paid[i]! < c.mu && p.el >= p.dur * 1000);
    return short ? t('research.waiting') : t('research.eta', { d: duration(left) });
  }

  /**
   * A cost in the detail pane, one item a line: its icon and name, how many, and what the Heart
   * holds now (coral when short). The cards keep the compact chips.
   */
  private costList(cost: ReadonlyArray<{ item: number; mu: number }>, sim?: Sim): HTMLElement {
    return el('ul.tr-costs', {}, cost.map((c) => {
      const held = sim ? el('small') : null;
      const li = el('li', {}, [el('b', {}, num(Math.round(c.mu / 1000))), itemMention(c.item), held]);
      if (held) this.costLive.push({ item: c.item, mu: c.mu, li, held });
      return li;
    }));
  }

  /** The detail pane's cost lines: what the Heart holds of each, and coral when short (4 Hz). */
  private refreshCostLive(sim: Sim): void {
    for (const c of this.costLive) {
      setText(c.held, t('tree.have', { n: num(Math.floor(sim.stock[c.item]! / 1000)) }));
      setAttr(c.li, 'data-poor', sim.stock[c.item]! < c.mu ? '' : null);
    }
  }

  private chips(cost: ReadonlyArray<{ item: number; mu: number }>, px: number, sim?: Sim): HTMLElement[] {
    return cost.map((c) => el('span.tr-chip', {
      title: itemDef(c.item).name[locale()], 'data-poor': sim && sim.stock[c.item]! < c.mu ? '' : null,
    }, [itemIcon(this.atlas, c.item, px), num(Math.round(c.mu / 1000))]));
  }

  refresh(): void {
    const sim = this.host.sim();
    const L = locale();
    if (L !== this.builtIn) this.build();
    setText(this.slotsEl, t('research.slots', { used: sim.projects.length, max: sim.mods.slots }));
    const idle = sim.idleLabs().length;
    const labs = sim.ents.sorted().filter((e) => BUILDING_KIND[e.def] === 'lab').length;
    setText(this.labsEl, labs ? tr('research.labs', { n: idle }) : t('research.noLab'));
    setText(this.notesEl, sim.notes > 0 ? t('research.notes', { v: Math.round(sim.notes / 100) }) : '');
    this.refreshReserve(sim, L);
    // Research costs depend on what is owned (the specialisation rule): rebuilt when that changes.
    const sig = [...sim.done].sort().join(',');
    const costsChanged = sig !== this.costSig;
    this.costSig = sig;
    this.refreshLanes(sim);
    this.refreshPaths(sim);
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
        if (costsChanged) {
          const e = effectiveCost(id, sim.done);
          v.cost.replaceChildren(...this.chips(e.cost, 14));
          setText(v.time!, shortTime(e.ticks));
        }
        const proj = sim.projects.find((p) => p.id === id);
        v.bar!.style.width = proj ? `${projectPermille(proj) / 10}%` : st === 'done' ? '100%' : '0%';
      }
    }
    // Links: inked once their prerequisite is done, dashed while it opens the way, faint while locked.
    const done = (id: string): boolean => id === ROOT || sim.done.has(id);
    for (const { link, path } of this.paths) {
      setAttr(path, 'data-state', done(link.to) ? 'done' : done(link.from) ? 'open' : 'locked');
      setAttr(path, 'data-hot', link.from === this.selected || link.to === this.selected ? '' : null);
    }
    this.renderDetail(sim, L);
  }

  /** The header's restart reserve (D36): what the Heart's stock must keep now, item by item; nothing once the buildings cover it. */
  private refreshReserve(sim: Sim, L: 'fr' | 'en'): void {
    const keep = RESERVED.map((it) => ({ item: itemIdx(it), mu: sim.reserveFloor(itemIdx(it)) })).filter((c) => c.mu > 0);
    const sig = `${L}:${keep.map((c) => `${c.item}=${Math.ceil(c.mu / 1000)}`).join(',')}`;
    if (sig === this.reserveSig) return;
    this.reserveSig = sig;
    setAttr(this.reserveEl, 'title', keep.length ? this.reserveTip() : null);
    this.reserveEl.replaceChildren(...(keep.length ? [`${t('tree.reserve')} `, ...this.chips(keep.map((c) => ({ item: c.item, mu: Math.ceil(c.mu / 1000) * 1000 })), 14)] : []));
  }

  /** The plan paths' labels (D41): « n/of » unlocked, full once the whole path is; the tooltip says what the path is for. */
  private refreshPaths(sim: Sim): void {
    for (const [lane, h] of this.pathHeads) {
      const ids = pathPlans(lane);
      const n = ids.filter((id) => sim.done.has(id)).length;
      setText(h.count, `${n}/${ids.length}`);
      setAttr(h.label, 'data-full', n === ids.length ? '' : null);
      setAttr(h.label, 'title', t('tree.path.tip', { path: t(`tree.lane.${lane}` as MsgKey), theme: t(`tree.path.${lane}` as MsgKey), n, of: ids.length }));
    }
  }

  private refreshLanes(sim: Sim): void {
    const counts = branchCounts(sim.done);
    for (const [lane, h] of this.heads) {
      if (lane === 'trunk') { setText(h.mastery, ''); continue; }
      const c = lane as BranchId;
      const n = counts[c];
      setText(h.mastery, sim.done.has(`${c}K`) ? t('research.mastery.grand') : n >= 6 ? t('research.mastery.master') : n >= 3 ? t('research.mastery.initiate') : `${n}/9`);
      if (!h.respec) continue;
      const why = sim.respecBlock(c);
      setAttr(h.respec, 'disabled', why ? '' : null);
      const armed = !!this.armed && this.armed.branch === c && performance.now() < this.armed.until;
      setText(h.respec, armed ? t('research.respec.confirm') : t('research.respec'));
      setAttr(h.respec, 'data-armed', armed ? '' : null);
      const cd = why === 'cooldown' ? duration((14 * 24 * 3600 * TPS - (sim.tick - sim.lastRespec)) / TPS) : '';
      setAttr(h.respec, 'title', why ? (why === 'cooldown' ? t('research.respec.cooldown', { d: cd }) : t(`research.respec.${why}` as MsgKey)) : t('research.respec.hint'));
    }
  }

  /** The detail pane: what the selected node is, unlocks and costs, what it needs, its action. */
  private renderDetail(sim: Sim, L: 'fr' | 'en'): void {
    const id = this.selected || ROOT;
    const plan = isPlan(id), res = isResearch(id);
    const proj = sim.projects.find((p) => p.id === id);
    const st = this.stateOf(sim, id);
    const block = res ? sim.researchBlock(id) : plan ? sim.planBlock(id) : null;
    const short = plan ? this.reserveShort(sim, id) : [];
    const sig = `${id}:${this.costSig}:${proj ? 1 : 0}:${st}:${block}:${L}:${this.shortList(short)}`;
    const live = el('div.rs-live');
    if (proj) setText(live, `${t('research.progress', { v: Math.floor(projectPermille(proj) / 10) })} · ${this.eta(sim, id) ?? ''}`);
    if (sig === this.detailSig) {
      const cur = this.detail.querySelector('.rs-live');
      if (cur && proj) setText(cur, live.textContent ?? '');
      this.refreshCostLive(sim);
      return;
    }
    this.detailSig = sig;
    this.costLive = [];
    const name = id === ROOT ? t('tree.root') : nodeName(id)[L];
    const kind = id === ROOT ? t('tree.start') : plan
      ? `${t('tree.kind.plan')} · ${t(`tree.lane.${laneOf(id)}` as MsgKey)}`
      : `${t('tree.kind.research')} · ${t(`research.branch.${laneOf(id)}` as MsgKey)}`;
    // What it says: a research's own line, a plan's (or the building's it unlocks), the Heart's kit.
    const desc = id === ROOT ? t('tree.root.desc')
      : res ? researchNode(id)!.desc[L]
        : planDef(id)!.desc?.[L] ?? (buildingsUnlockedBy(id)[0] ? buildingDef(buildingIdx(buildingsUnlockedBy(id)[0]!)).desc[L] : '');
    // What it unlocks, one row each: buildings, recipes, a Heart level.
    const rows: HTMLElement[] = [];
    const builds = id === ROOT ? startBuildings() : buildingsUnlockedBy(id);
    for (const b of builds) rows.push(el('li', {}, [buildingIcon(this.atlas, b, 24), buildingDef(buildingIdx(b)).name[L]]));
    if (id !== ROOT) {
      for (const r of recipesOf(id)) rows.push(el('li', {}, [itemIcon(this.atlas, itemIdx(r.outs[0]![0]), 24), r.name[L]]));
      const lvl = heartLevelOf(id);
      if (lvl > 1) rows.push(el('li', {}, [buildingIcon(this.atlas, 'hearth', 24), t('tree.heartLevel', { n: lvl })]));
    }
    const kids: Array<HTMLElement | null> = [
      el('small.tr-kind', { 'data-kind': id === ROOT ? 'root' : plan ? 'plan' : 'research' }, kind),
      el('h3.lettering', {}, name),
      desc ? el('p.rs-desc', {}, desc) : null,
      rows.length ? el('h4.lettering', {}, t('tree.unlocks')) : null,
      rows.length ? el('ul.tr-unlocks', {}, rows) : null,
    ];
    if (plan) {
      const p = planDef(id)!;
      kids.push(
        el('h4.lettering', {}, t('research.cost')),
        this.costList(p.cost.map(([it, n]) => ({ item: itemIdx(it), mu: toMu(n) })), st === 'done' ? undefined : sim),
        el('small.tr-paid', {}, t('tree.paid')),
      );
    } else if (res) {
      const e = effectiveCost(id, sim.done);
      const pen = penalty(id, sim.done);
      kids.push(
        el('h4.lettering', {}, t('research.cost')),
        this.costList(e.cost),
        pen.cost !== 1000 ? el('small.rs-pen', {}, t('research.penalty', { v: num(Math.round(pen.cost / 10) / 100) })) : null,
        el('p.rs-dur', {}, t('research.duration', { d: duration(e.ticks / TPS) })),
      );
    }
    const pre = id === ROOT ? [] : treePrereq(id);
    if (pre.length) {
      kids.push(
        el('h4.lettering', {}, t('research.prereq')),
        el('ul.rs-pre', {}, pre.map((q) => el('li', { 'data-ok': sim.done.has(q) ? '' : null }, `${sim.done.has(q) ? '✓' : '✗'} ${nodeName(q)[L]}`))),
      );
    }
    if (proj) kids.push(live);
    if (plan) {
      kids.push(el('footer.rs-actions', {}, [
        st === 'done' ? el('span.rs-tag', {}, t('tree.unlocked'))
          : el('button.btn.primary', { 'data-unlock-detail': id, disabled: st === 'ready' ? null : '', onclick: () => this.unlock(id) }, t('tree.unlock')),
        st !== 'done' && st !== 'ready' ? el('small.rs-why', {}, this.why(sim, id)) : null,
        short.length ? el('p.rs-desc', {}, this.reserveTip()) : null,
      ]));
    } else if (res) {
      kids.push(el('footer.rs-actions', {}, [
        sim.done.has(id) ? el('span.rs-tag', {}, t('research.done'))
          : proj ? el('button.btn', { onclick: () => this.cancel(id) }, t('research.cancel'))
            : el('button.btn.primary', { disabled: block ? '' : null, onclick: () => this.start(id) }, t('research.start')),
        !sim.done.has(id) && !proj && block ? el('small.rs-why', {}, block === 'prereq' ? t('research.block.prereq', { list: this.missing(sim, id) }) : t(`research.block.${block}` as MsgKey)) : null,
      ]));
    }
    this.detail.replaceChildren(...kids.filter((k): k is HTMLElement => !!k));
    this.refreshCostLive(sim);
  }
}
