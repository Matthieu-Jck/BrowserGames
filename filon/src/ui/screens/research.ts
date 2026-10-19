// research.ts — the tech tree screen (D33; T, or the HUD's tree chip): one tree, plans and research,
// drawn since D144 as a SWIMLANE MATRIX read left to right (owner, 2026-10-19: « we need to rethink
// how to present the tech tree. Right now it doesn't work visually and all. Let's take some
// inspiration from the best tech trees there are »; the layout and its reasons: ./tree-layout.ts):
//   · the six themes are lanes, top to bottom, each in its colour; the stages are columns, left to
//     right — the Heart (a pillar: its kit), the PLANS (each path in its theme's lane, a plan
//     unlocked with one click, paid from the Heart at once, D33), the research lab's plan (a pillar
//     every plan leads into, D71), then Tier 1 … Tier 4, a WALL before each from Tier 2 whose lock is
//     the Core's level that tier waits for (D118: its look at that level, padlocked while the Core is
//     below it, the tier's column hatched), keyed by a line from the node that makes that level
//     possible (Synthesis, Optics, Resonance), and Tier 2's two expertises (D93) said on its head;
//   · a tier's categories (D128) are cells in their lane, a header each — its name, a bar of how much
//     of it is learnt, a padlock while a category it waits for is unfinished —, the category gates
//     arrows along the lanes across the walls (dashed until the gate is finished);
//   · RAILS frozen round the view, as a spreadsheet's panes: the stages' heads along the top (their
//     progress; a tier's Core level, its key, its expertises), the lanes' names down the left; under
//     the view a TIER NAVIGATOR (a one-line map of the stages, each its progress and padlock, the
//     view's window on it — a click or a drag takes the view there), the AVAILABLE-NOW filter (the
//     count of what can start now; on, the rest dims — Factorio's « researchable only »), the zoom
//     bar (D111);
//   · each card says its state at a glance with a badge — ✓ done, ▶ ready (an amber ring: what to do
//     next), the % of a running project (its bar filling the card), a padlock (a prerequisite, a
//     category), the Core's look and level (its tier's level not reached) — and shows what it
//     unlocks first (its icons), then its costs: a plan's materials and « Débloquer »; a research
//     node's resources (D122: paid from the Core at launch, coral while the Core lacks one) and its AI
//     tokens (no price in ◉, no data, no time: D118, D122, D128);
//   · selecting a node (a click, a tap, Enter; D111: the mouse over a card only raises it) lights its
//     chain (`chainOf`: what it needs and what needs it, through the gates no further), dims the
//     rest, and numbers the PATH to it — every node it still waits for, in the order the tree reads
//     (`pathTo`; Civilization VI's path to a goal) — until another is selected, the empty tree
//     clicked or Esc pressed.
// The zoom (D111) runs from the whole tree in the view to 125 %; the tree opens with every lane in
// the view's height (`openZoom`), the stages scrolled through sideways, unless this viewer chose a
// zoom; the cards simplify as they shrink (`zoomLevel`).
// The header adds research's strip: slots, labs, the last minute's token bill (the Core's compute,
// the servers, the bank, the flow bought), the purse-in-the-red warning, the Compute Plan's switch
// and the Research Queue (each lab's queued node, ✕ to clear it); and the cards' legend.
// The detail pane gives the whole picture: what a node unlocks (a plain line per feature), its
// cost (its resources with what the Core holds, its tokens), the path to it (numbered as on the
// tree, the Core's levels and the expertises in their places), its progress (its tokens in, the
// flows that bring them — free, banked, bought — and the flow bought, which the player can change; a
// coral line while its lab has no power), the action (start, cancel, queue in a lab). « Lancer »
// opens the launch dialog at every tier (../launch-dialog.ts, D118, D122). The reconversion's
// button is gone (D107); a save's reconversion under way still runs out in the HUD.
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
  CATEGORIES, PLAN_IDS, PLAN_PATHS, THEMES, THEME_IDS, TIER_GATE, buildingsUnlockedBy, categoryDef, categoryDone, categoryName, categoryNodes,
  isPlan, isResearch, nodeName, pathPlans, planDef, researchNode, treePrereq, unmetGates,
} from '@/content/research';
import { RECIPES } from '@/content/recipes';
import { BUILDING_IDS, BUILDING_KIND, RESEARCH_IDS, buildingDef, buildingIdx, itemDef, itemIdx, toMu } from '@/content/registry';
import type { CategoryDef, Effect, PlanLane, RecipeDef, ResearchTier } from '@/content/types';
import { el, setAttr, setText } from '@/core/dom';
import { makeStore } from '@/core/store';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import { duration, num } from '@/i18n/format';
import type { Atlas } from '@/render/art/atlas';
import { C } from '@/render/art/tokens';
import type { Sim } from '@/sim/state';
import { effectiveCost, projectPermille, tokensLeft, type Project } from '@/sim/research/runtime';
import { buildingIcon, itemIcon } from '../build-bar';
import { glyph as inkGlyph } from '../glyphs';
import { itemRef } from '../mention';
import { compact } from '../stock-panel';
import { oc, ocNum } from '../trade-view';
import { nodeState, planState, projectTiming, readyPlans, researchState, type ResearchState } from '../tree-state';
import { planOffered } from '@/sim/systems/quests';
import { tierTwoOpen } from '@/sim/systems/expertise';
import { archiveGlyph } from './expertise';
import { mark as kitMark } from '../inspector/kit';
import {
  CELL_HEAD, KEY_R, LAB_PLAN, ROOT, ZOOM_FLOOR, ZOOM_MAX, chainOf, fitZoom, openZoom, ownPrereq, pathTo, treeLayout, zoomLevel,
  type Cell, type GateLink, type Link, type Spot, type Zone,
} from './tree-layout';

export interface ResearchHost {
  sim(): Sim;
  close(): void;
  notify(kind: 'good' | 'bad' | 'info' | 'warn', text: string): void;
  /** The node the tutorial's guide is after (null: none): the tree opens on it. */
  focus?(): string | null;
}

type Loc = 'fr' | 'en';

const TIERS: readonly ResearchTier[] = [1, 2, 3, 4];
/** What opens a tier: the lab's plan for Tier 1, then the node behind the Core's level it waits for (`TIER_GATE`). */
const gateOf = (tier: ResearchTier): string => TIER_GATE[tier] ?? LAB_PLAN;
/** A node's colour: a plan's path, a research node's theme. */
const laneOf = (id: string): string => planDef(id)?.lane ?? researchNode(id)?.theme ?? '';
/** The research lab's plan (D71): the gate between the plans and research, needing every other plan. */
const isGate = (id: string): boolean => planDef(id)?.lane === 'gate';

// ── what a node unlocks ─────────────────────────────────────────────────────

/** A glyph drawn in code for what has no building or item: the analytics readouts (D41), the market's ◉, the land (D60), research's features (D70). */
type Glyph = 'telemetry' | 'ledger' | 'power' | 'gauge' | 'coin' | 'land'
  | 'floor' | 'plan' | 'express' | 'rental' | 'queue' | 'forecast' | 'resale' | 'crossing' | 'far' | 'token';
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
  deepHeat: { b: 'fumarole_tap' }, genOut: { b: 'steam_boiler' }, // the coal generator's until D143
  // Trade and tokens (D68, D70).
  tradeFee: { g: 'coin' }, slippage: { g: 'coin' }, forwards: { g: 'coin' }, charters: { g: 'coin' },
  forecast: { g: 'forecast' }, floorPrices: { g: 'floor' }, tokenPlan: { g: 'plan' }, expressFreight: { g: 'express' },
  autoSell: [{ b: 'hearth' }, { g: 'coin' }],
  serverRental: [{ g: 'rental' }, { b: 'server' }],
  deliveryDelay: { b: 'trade_post' }, orders: { b: 'trade_post' }, tradeL2: { b: 'trade_post' }, tradeL3: { b: 'trade_post' },
  post2: { b: 'trade_post' }, post3: { b: 'trade_post' }, crierHouse: { b: 'trade_post' },
  // Research itself: a slot, the queue, the Core's compute (D122).
  slots: { b: 'observatory' }, researchQueue: [{ g: 'queue' }, { b: 'observatory' }], coreCompute: [{ b: 'hearth' }, { g: 'token' }],
  // The analytics path's readouts (D41), by their flags.
  telemetry: { g: 'telemetry' }, statistics: { g: 'ledger' }, power_log: { g: 'power' }, diagnostics: { g: 'gauge' },
};

const recipesOf = (id: string): RecipeDef[] => (Object.values(RECIPES) as RecipeDef[]).filter((r) => r.unlock === id);
const effectsOf = (id: string): readonly Effect[] => planDef(id)?.effects ?? researchNode(id)?.effects ?? [];
const heartLevelOf = (id: string): number => BAL.hearthUpgrades.findIndex((u) => u.unlock === id) + 2; // 1: none
const startBuildings = (): string[] => BUILDING_IDS.filter((b) => buildingDef(buildingIdx(b)).unlock === 'start');
/** An effect's key: its flag, `slots`, or its target. */
const effectKey = (ef: Effect): string => (ef.k === 'flag' ? ef.flag : ef.k === 'slots' ? 'slots' : ef.k === 'unlock' ? '' : ef.target);
/** How much an effect adds, in the player's units (tokens a minute for the Core's compute; tiles, orders, slots). */
const effectAmount = (ef: Effect): number => (ef.k === 'slots' ? ef.add : ef.k === 'add' ? ef.v : 0);

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
 * queued slabs, the first running; a price line going on dashed past « now » (forecast); a token
 * with rays (the Core's compute, D122).
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
  } else if (kind === 'token') {
    // A token with three rays: compute given (the Core's, D122).
    token(20, 21, 10);
    line([[20, 5.5], [20, 8.5]], C.lilacD, 2);
    line([[8.5, 9.5], [10.6, 11.6]], C.lilacD, 2);
    line([[31.5, 9.5], [29.4, 11.6]], C.lilacD, 2);
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

/** A feature's words (`tree.feat.<key>` and its line `.what`), or null when the dictionary has none. */
function featureText(key: string, amount: number): { label: string; what: string } | null {
  const label = tr(`tree.feat.${key}`);
  if (label.startsWith('⟦')) return null;
  const what = tr(`tree.feat.${key}.what`, { n: amount });
  return { label, what: what.startsWith('⟦') ? '' : what };
}

/** What the expertises leave of each family's research (D93): the research costs follow it. */
const famSig = (sim: Sim): string => THEME_IDS.map((f) => { const m = sim.mods.fam[f]; return `${m.time},${m.tokens},${m.resources}`; }).join(';');

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
  /** The cost chips (a plan's materials, a research's resources: their item and amount), to mark the ones the Heart lacks. */
  chips: Array<{ item: number; mu: number; node: HTMLElement }>;
  /** Research: its tokens (every tier, D122), the queue's tag. */
  tok: HTMLElement | null;
  qtag: HTMLElement | null;
  bar: HTMLElement | null;
  unlock: HTMLButtonElement | null;
  /** The state badge's figure: a running project's %. */
  pct: HTMLElement;
  /** Its number on the path to the focused node (D144); empty off it. */
  step: HTMLElement;
}

/** A cell on the canvas (D128, D144): a category's or a plan path's box, its header (name, bar, count). */
interface CellView { cell: Cell; box: HTMLElement; head: HTMLElement; count: HTMLElement; fill: HTMLElement }

/**
 * A tier on the canvas and its rail head (D118, D144): the head (its name, a bar of how much of it
 * is learnt; from Tier 2 the Core's level it needs, the node that keys it, Tier 2's expertises), its
 * column (hatched while the Core is below that level), the wall before it and the lock on the wall.
 */
interface TierView {
  head: HTMLElement; count: HTMLElement; fill: HTMLElement;
  core: HTMLElement | null; key: HTMLElement | null;
  zone: HTMLElement; wall: HTMLElement | null; lock: HTMLElement | null;
}

/** This viewer's zoom of the tree (D111), in this browser only; 0: the tree's own choice (D144: every lane in view). */
const ZOOM_STORE = makeStore<{ version: number; zoom: number }>('filon.tree.zoom.v2', 2, () => ({ version: 2, zoom: 0 }));
/** One step of the buttons and keys. */
const ZOOM_STEP = 1.25;
/** The lanes' bands stand this far in from the canvas's edges. */
const PAD_BAND = 6;

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

/** The filter's mark (D144): a play triangle in a ring — what can start now. */
function playGlyph(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'tr-playglyph');
  svg.setAttribute('aria-hidden', 'true');
  const ring = document.createElementNS(SVG_NS, 'circle');
  ring.setAttribute('cx', '8'); ring.setAttribute('cy', '8'); ring.setAttribute('r', '6.6');
  const tri = document.createElementNS(SVG_NS, 'path');
  tri.setAttribute('d', 'M6.4 4.9L11.2 8L6.4 11.1Z');
  svg.append(ring, tri);
  return svg;
}

/** The SVG path of an arrowhead pointing right, its tip at (x, y). */
const arrowHead = (x: number, y: number): string => `M${x - 9} ${y - 5.5} L${x} ${y} L${x - 9} ${y + 5.5} Z`;

/** The end point of an SVG route (its last « L x y »). */
function endOf(d: string): [number, number] {
  const m = /L(-?[\d.]+) (-?[\d.]+)\s*$/.exec(d);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

export class ResearchScreen {
  readonly root: HTMLElement;
  private readonly layout = treeLayout();
  private readonly views = new Map<string, NodeView>();
  private readonly paths: Array<{ link: Link; path: SVGPathElement }> = [];
  /** The categories' and plan paths' cells (D128, D144). */
  private readonly cells = new Map<string, CellView>();
  /** The categories' gates on the canvas (D128): the line and its arrowhead. */
  private readonly gatePaths: Array<{ link: GateLink; path: SVGPathElement; head: SVGPathElement }> = [];
  private readonly tiers = new Map<ResearchTier, TierView>();
  /** The plans' rail head (how many are taken) and the lab's (how many of the plans it needs). */
  private plansHead: { count: HTMLElement; fill: HTMLElement } | null = null;
  /** The research lab's pillar (D71): its « n/N » plans taken and their bar. */
  private gateHead: { count: HTMLElement; fill: HTMLElement } | null = null;
  /** The launch dialog of a research node (D118): how many tokens a minute to buy. */
  private readonly launch: LaunchDialog;
  private readonly view: HTMLElement;
  /** The rails (D144): the stages' heads over the view, the lanes' names left of it; their place in canvas px. */
  private readonly rail = el('div.tr-rail');
  private readonly laneRail = el('div.tr-lanerail', { 'aria-hidden': 'true' });
  private railEls: Array<{ el: HTMLElement; x: number; w: number }> = [];
  private laneEls: Array<{ el: HTMLElement; y: number; h: number }> = [];
  private railFrame = 0;
  /** The tier navigator (D144): a segment per stage, the view's window over them. */
  private readonly nav: HTMLElement;
  private readonly navWin = el('span.tr-navwin');
  private navSegs: Array<{ id: Zone['id']; seg: HTMLElement; fill: HTMLElement; count: HTMLElement }> = [];
  private navDrag = false;
  /** The available-now filter (D144): its button, its count, whether it is on. */
  private readonly filterBtn: HTMLButtonElement;
  private readonly filterCount = el('b.tr-filtern');
  private filterOn = false;
  /** The canvas (rebuilt with the language), whose `data-chain` fades what the focused node's chain leaves out. */
  private canvas: HTMLElement | null = null;
  /**
   * The node the player selected (owner, 2026-10-17: « il faut que le "focus" sur une tech se fasse
   * quand le joueur sélectionne une tech, pas au hover »): its chain lit, the rest faded, the path to
   * it numbered, until they select another, click the empty tree or press Esc. A click, a tap or
   * Enter on a card; the tree's own choice on opening (its first plan to take, the guide's node)
   * shows its detail, not a focus.
   */
  private focused: string | null = null;
  /** The node whose chain is painted (undefined: none painted since the canvas was built). */
  private chainFor: string | null | undefined = undefined;
  /** What the path's numbers were painted for: the focus and how much is done. */
  private stepSig = '';
  // The header: plans' restart reserve and research's strip (D68–D70).
  private readonly slotsEl = el('span.rs-slots');
  private slotsSig = '';
  private readonly labsText = el('span');
  private readonly labsEl: HTMLElement;
  private readonly billEl: HTMLElement;
  private readonly bill: Record<'label' | 'used' | 'free' | 'bank' | 'bought' | 'cents' | 'rental', HTMLElement>;
  /** The bill's bank chip, shown only while the bank counts (an older save's data, D122). */
  private readonly bankChip: HTMLElement;
  /** The Core's look at its level, on the bill's compute chip (redrawn when the level changes). */
  private readonly coreIcon = el('span.rs-bcore');
  private coreIconLv = 0;
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
  /** The cards' legend (D144): a swatch per state. */
  private readonly legendEl = el('span.tr-states');
  private readonly detail = el('aside.rs-detail.cartouche');
  private selected = '';
  /** What the research costs were computed for (null: not yet — a new base has nothing done, which is a signature too). */
  private costSig: string | null = null;
  /** The detail pane's live parts (costs held, progress, the labs' lines), run at each refresh. */
  private detailLive: Array<(sim: Sim) => void> = [];
  private detailSig = '';
  /** A plan just unlocked: its badge stamps « ✓ » for a moment. */
  private just: { id: string; until: number } | null = null;
  /** Dragging the canvas: where it started, and whether it moved (a drag is not a click). */
  private drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
  private dragged = false;
  /**
   * The zoom (D111; owner, 2026-10-17: « je veux pouvoir dézoomer dans le tech tree »): 1 its own
   * size, down to the whole tree in the view (`fitZoom`), up to `ZOOM_MAX`. This viewer's last
   * choice is kept in this browser (a convenience: `filon.tree.zoom.v2`); until they choose, the tree
   * opens with every lane in the view (D144: `openZoom`).
   */
  private zoom = 1;
  /** The paper above the canvas while it is shorter than the view (the whole tree in view): it stands in the middle. */
  private offY = 0;
  private chosenZoom = ZOOM_STORE.load().zoom;
  private zoomSave = 0;
  /** The fingers on the view (D96): two pinch the zoom about their middle. */
  private readonly fingers = new Map<number, { x: number; y: number }>();
  private pinch: { d0: number; z0: number } | null = null;
  /** The zoom bar: « − », the zoom (a click: 100 %), « + », « Tout voir ». */
  private readonly zoomPct = el<'button'>('button.tr-zbtn.tr-zpct', { type: 'button', 'data-tree-zoom': 'reset', onclick: () => this.setZoom(1) });
  private readonly zoomOut = el<'button'>('button.tr-zbtn', { type: 'button', 'data-tree-zoom': 'out', onclick: () => this.setZoom(this.zoom / ZOOM_STEP) }, '−');
  private readonly zoomIn = el<'button'>('button.tr-zbtn', { type: 'button', 'data-tree-zoom': 'in', onclick: () => this.setZoom(this.zoom * ZOOM_STEP) }, '+');
  private readonly zoomFit = el<'button'>('button.tr-zbtn.tr-zfit', { type: 'button', 'data-tree-zoom': 'fit', onclick: () => this.fit() }, [fitGlyph()]);

  /** The language the canvas was built in: a switch rebuilds it (names and labels are written once). */
  private builtIn: Loc | null = null;
  private readonly title = el('h1.lettering');
  private readonly stage: HTMLElement;

  constructor(private readonly atlas: Atlas, private readonly host: ResearchHost) {
    this.view = el('div.tr-view', {
      onpointerdown: (e: PointerEvent) => this.dragStart(e),
      onpointermove: (e: PointerEvent) => this.dragMove(e),
      onpointerup: (e: PointerEvent) => this.dragEnd(e),
      onpointercancel: (e: PointerEvent) => this.dragEnd(e),
      onwheel: (e: WheelEvent) => this.wheel(e),
      onscroll: () => this.scheduleRails(),
      // A click on the empty tree (not the end of a drag) lets the focus go.
      onclick: (e: MouseEvent) => { if (!this.dragged && !(e.target as Element).closest('.tr-node, button')) this.unfocus(); },
    });
    // A window resized (or the pane folded under the tree, D96): the whole tree's fit moves.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (this.root.isConnected) this.setZoom(this.zoom, undefined, false); }).observe(this.view);
    this.nav = el('div.tr-nav', {
      onpointerdown: (e: PointerEvent) => { this.navDrag = true; this.nav.setPointerCapture(e.pointerId); this.navTo(e); },
      onpointermove: (e: PointerEvent) => { if (this.navDrag) this.navTo(e); },
      onpointerup: (e: PointerEvent) => { this.navDrag = false; if (this.nav.hasPointerCapture(e.pointerId)) this.nav.releasePointerCapture(e.pointerId); },
      onpointercancel: () => { this.navDrag = false; },
    });
    this.filterBtn = el<'button'>('button.tr-filter', { type: 'button', 'data-tree-filter': '', 'aria-pressed': 'false', onclick: () => this.toggleFilter() }, [playGlyph(), this.filterCount]);
    this.labsEl = el('span.rs-labs', {}, [buildingIcon(atlas, 'observatory', 18), this.labsText]);
    this.launch = new LaunchDialog(atlas, { sim: () => host.sim(), launch: (id, buy) => this.begin(id, buy) });
    this.bill = {
      label: el('small'), used: el('span.v'), free: el('span.v'), bank: el('span.v'), bought: el('span.v'), cents: el('span.rs-bcost'), rental: el('span.rs-brent'),
    };
    // The last minute's tokens (D122): used = free (the Core's compute and the servers, under the
    // Core's look) + the bank (while it holds tokens) + bought; each part in words in the tooltip.
    this.bankChip = el('span.rs-bchip', { 'data-k': 'bank' }, [kitMark('store'), this.bill.bank]);
    this.billEl = el('span.rs-bill', { hidden: '' }, [
      this.bill.label,
      el('span.rs-bchip', { 'data-k': 'used' }, [mark('token'), this.bill.used]),
      el('span.rs-beq', {}, '='),
      el('span.rs-bchip', { 'data-k': 'free' }, [this.coreIcon, this.bill.free]),
      this.bankChip,
      el('span.rs-bchip', { 'data-k': 'bought' }, [inkGlyph('crier'), this.bill.bought]),
      this.bill.cents, this.bill.rental,
    ]);
    // The stage (D144): the rails frozen round the view, as a spreadsheet's panes; the tools under it.
    this.stage = el('div.tr-stage', {}, [
      el('div.tr-corner'), this.rail, this.laneRail, this.view,
      el('div.tr-tools', {}, [this.nav, this.filterBtn, el('div.tr-zoom', {}, [this.zoomOut, this.zoomPct, this.zoomIn, this.zoomFit])]),
    ]);
    this.root = el('section.screen.research.tree', { 'data-screen': 'research' }, [
      el('header.rs-head', {}, [
        this.title,
        this.slotsEl, this.labsEl, this.billEl, this.heldEl, this.planEl, this.planCmp, this.qheadEl, this.notesEl, this.reserveEl,
        this.legendEl,
        el('button.btn.rs-close', { onclick: () => host.close(), title: t('screen.close') }, '✕'),
      ]),
      el('div.rs-body', {}, [this.stage, this.detail]),
      this.launch.root,
    ]);
    this.build();
  }

  /** The canvas: lanes, columns, walls, cells, links, cards — and the rails and navigator — in the current language (rebuilt when it changes). */
  private build(): void {
    const L = this.layout;
    const loc = locale();
    this.builtIn = loc;
    this.views.clear();
    this.paths.length = 0;
    this.cells.clear();
    this.gatePaths.length = 0;
    this.tiers.clear();
    this.gateHead = null;
    this.plansHead = null;
    this.costSig = null;
    this.detailSig = '';
    this.chainFor = undefined;
    this.stepSig = '';
    setText(this.title, t('tree.title'));
    setAttr(this.stage, 'title', null);
    setAttr(this.view, 'title', t('tree.drag'));
    setAttr(this.zoomOut, 'title', t('tree.zoom.out'));
    setAttr(this.zoomIn, 'title', t('tree.zoom.in'));
    setAttr(this.zoomFit, 'title', t('tree.zoom.fit'));
    setAttr(this.zoomPct, 'title', t('tree.zoom.reset'));
    setAttr(this.nav, 'title', t('tree.nav.tip'));
    this.legendEl.replaceChildren(...this.legend());
    const canvas = el('div.tr-canvas', { style: `width:${L.w}px;height:${L.h}px` });
    if (this.filterOn) setAttr(canvas, 'data-filter', 'now');
    this.canvas = canvas;
    const span = `top:${L.top}px;height:${L.bottom - L.top}px`;
    // Back to front: the plans' wash and the tiers' columns, the lanes, the walls, the cells' boxes,
    // the links, the cells' heads and the walls' locks, the cards.
    const tierZone = new Map<ResearchTier, HTMLElement>();
    for (const z of L.zones) {
      if (z.id === 'plans') canvas.append(el('div.tr-zone', { 'data-zone': 'plans', style: `left:${z.x}px;width:${z.w}px;${span}` }));
      else if (z.tier) {
        const zone = el('div.tr-zone', { 'data-tier': String(z.tier), style: `left:${z.x}px;width:${z.w}px;${span}` });
        tierZone.set(z.tier, zone);
        canvas.append(zone);
      }
    }
    for (const b of L.lanes) canvas.append(el('div.tr-band', { 'data-lane': b.theme, style: `left:${PAD_BAND}px;top:${b.y}px;width:${L.w - 2 * PAD_BAND}px;height:${b.h}px` }));
    const walls = new Map<ResearchTier, { wall: HTMLElement; lock: HTMLElement }>();
    for (const w of L.walls) {
      const lvl = coreLevelFor(w.tier);
      const wall = el('div.tr-wall', { 'data-tier': String(w.tier), 'data-strong': w.strong ? '' : null, style: `left:${w.x}px;width:${w.w}px;${span}` });
      const lock = el('button.tr-key', {
        type: 'button', 'data-tier': String(w.tier), 'data-key': w.key,
        style: `left:${w.kx - KEY_R}px;top:${w.ky - KEY_R}px;width:${2 * KEY_R}px;height:${2 * KEY_R}px`,
        onclick: () => this.goTo(w.key),
      }, [buildingIcon(this.atlas, 'hearth', 30, lvl), el('span.tr-keylv', {}, String(lvl)), el('span.tr-keymark', {}, [mark('lock'), el('span.tr-gatecheck', {}, '✓')])]);
      walls.set(w.tier, { wall, lock });
      canvas.append(wall);
    }
    const heads: HTMLElement[] = [];
    // The plan paths' cells first, in the paths' order (D41), then the categories (D128).
    const plansFirst = [...L.cells].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'plan' ? -1 : 1)
      || (a.kind === 'plan' ? PLAN_PATHS.indexOf(a.id as PlanLane) - PLAN_PATHS.indexOf(b.id as PlanLane) : 0));
    for (const c of plansFirst) { const v = this.cellEl(c); canvas.append(v.box); heads.push(v.head); }
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'tr-links');
    svg.setAttribute('width', String(L.w));
    svg.setAttribute('height', String(L.h));
    // The gates first, under the nodes' links (D128): an arrow along a lane, across a wall.
    for (const link of L.gates) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'tr-gatelink');
      path.setAttribute('d', link.d);
      const head = document.createElementNS(SVG_NS, 'path');
      const [ex, ey] = endOf(link.d);
      head.setAttribute('class', 'tr-gatehead');
      head.setAttribute('d', arrowHead(ex, ey));
      svg.append(path, head);
      this.gatePaths.push({ link, path, head });
    }
    // Each link on its route (D107: right angles in the gaps, never across a card).
    for (const link of L.links) {
      if (!link.d) continue;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'tr-link');
      path.setAttribute('d', link.d);
      path.setAttribute('data-kind', link.kind);
      svg.append(path);
      this.paths.push({ link, path });
    }
    canvas.append(svg, ...heads);
    for (const { lock } of walls.values()) canvas.append(lock);
    for (const s of L.nodes) canvas.append(this.nodeEl(s));
    this.buildRails(loc, tierZone, walls);
    this.buildNav();
    const { scrollLeft, scrollTop } = this.view;
    this.view.replaceChildren(canvas);
    this.applyZoom();
    this.view.scrollLeft = scrollLeft;
    this.view.scrollTop = scrollTop;
    this.paintRails();
  }

  /** The cards' legend (D144), in the header: a swatch per state, as the cards draw it. */
  private legend(): HTMLElement[] {
    const sw = (k: string, label: string, inner: Array<Node | string>): HTMLElement =>
      el('span.tr-lg', { 'data-k': k }, [el('i.tr-lgsw', { 'data-state': k }, inner), el('span', {}, label)]);
    return [
      sw('done', t('tree.legend.done'), ['✓']),
      sw('ready', t('tree.legend.ready'), ['▶']),
      sw('active', t('tree.legend.active'), []),
      sw('locked', t('tree.legend.locked'), [mark('lock')]),
      sw('core', t('tree.legend.core'), [buildingIcon(this.atlas, 'hearth', 14, 3) ?? '']),
    ];
  }

  /**
   * The rails (D144): over the view, a head per stage — the plans (how many are taken), the lab,
   * each tier (its name and bar; from Tier 2 the Core's level it needs, padlocked below it, the node
   * that keys its wall, Tier 2's two expertises: D93, D118); left of it, each lane's name. They keep
   * their size at every zoom and follow the scroll (`paintRails`).
   */
  private buildRails(loc: Loc, zones: Map<ResearchTier, HTMLElement>, walls: Map<ResearchTier, { wall: HTMLElement; lock: HTMLElement }>): void {
    const L = this.layout;
    const rails: ResearchScreen['railEls'] = [];
    const bar = (): { bar: HTMLElement; fill: HTMLElement } => { const fill = el('i'); return { bar: el('span.tr-hbar', {}, fill), fill }; };
    for (const z of L.zones) {
      if (z.id === 'heart') continue;
      if (z.id === 'plans') {
        const b = bar(), count = el('small.tr-hcount');
        rails.push({ el: el('div.tr-colhead', { 'data-zone': 'plans', title: t('tree.legend.plan') }, [
          el('span.tr-th1', {}, [el('span.tr-tiername.lettering', {}, t('tree.part.plans')), b.bar, count]),
          el('small.tr-th2', {}, t('tree.legend.plan')),
        ]), x: z.x, w: z.w });
        this.plansHead = { count, fill: b.fill };
        continue;
      }
      if (z.id === 'lab') {
        rails.push({ el: el('div.tr-colhead', { 'data-zone': 'lab' }, [
          el('span.tr-th1', {}, [el('span.tr-tiername.lettering', {}, t('tree.part.research'))]),
          el('small.tr-th2', {}, t('tree.gate.caption')),
        ]), x: z.x, w: z.w });
        continue;
      }
      const tier = z.tier as ResearchTier;
      const lvl = coreLevelFor(tier);
      const b = bar(), count = el('small.tr-hcount');
      const key = tier > 1 ? el('button.tr-gate', {
        type: 'button', 'data-gate-id': gateOf(tier), title: t('tree.rs.opens.tip', { name: nodeName(gateOf(tier))[loc] }),
        onclick: () => this.goTo(gateOf(tier)),
      }, [mark('lock'), el('span.tr-gatecheck', {}, '✓'), el('span.tr-gname', {}, nodeName(gateOf(tier))[loc])]) : null;
      const core = tier > 1
        ? el('span.tr-core', { 'data-core': String(lvl) }, [mark('lock'), el('span.tr-gatecheck', {}, '✓'), buildingIcon(this.atlas, 'hearth', 20, lvl),
          el('span.tr-corelong', {}, t('tree.heartLevel', { n: lvl })), el('span.tr-coreshort', {}, t('tree.rs.coreShort', { n: lvl }))])
        : null;
      const head = el('div.tr-tierhead', { 'data-tier': String(tier) }, [
        el('span.tr-th1', {}, [el('span.tr-tiername.lettering', {}, t('tree.rs.tier', { n: tier })), b.bar, count]),
        el('span.tr-th2', {}, tier > 1
          ? [core, key, tier === 2 ? el('small.tr-gate-exp', { title: t('research.block.expertise') }, [archiveGlyph(), el('span', {}, t('tree.rs.opens.expertise'))]) : null]
          : [el('small', {}, t('tree.rs.opens')), el('button.tr-gate', { type: 'button', 'data-gate-id': LAB_PLAN, onclick: () => this.goTo(LAB_PLAN) }, [mark('lock'), el('span.tr-gatecheck', {}, '✓'), el('span.tr-gname', {}, nodeName(LAB_PLAN)[loc])])]),
      ]);
      rails.push({ el: head, x: z.x, w: z.w });
      const w = walls.get(tier);
      this.tiers.set(tier, { head, count, fill: b.fill, core, key, zone: zones.get(tier)!, wall: w?.wall ?? null, lock: w?.lock ?? null });
    }
    this.railEls = rails;
    this.rail.replaceChildren(el('div.tr-railin', {}, rails.map((r) => r.el)));
    this.laneEls = L.lanes.map((b) => ({ el: el('div.tr-lanelabel', { 'data-lane': b.theme }, [el('span.lettering', {}, THEMES[b.theme].name[loc])]), y: b.y, h: b.h }));
    this.laneRail.replaceChildren(el('div.tr-railin', {}, this.laneEls.map((r) => r.el)));
  }

  /** The tier navigator (D144): a segment per stage, as wide as its share of the tree, its name, bar and padlock. */
  private buildNav(): void {
    const L = this.layout;
    const zx = (id: Zone['id']): number => L.zones.find((z) => z.id === id)!.x;
    const spans: Array<{ id: Zone['id']; x0: number; x1: number; label: string }> = [
      { id: 'plans', x0: 0, x1: zx('t1'), label: t('tree.part.plans') },
      ...TIERS.map((k) => ({ id: `t${k}` as Zone['id'], x0: zx(`t${k}` as Zone['id']), x1: k < 4 ? zx(`t${k + 1}` as Zone['id']) : L.w, label: t('tree.rs.tierShort', { n: k }) })),
    ];
    this.navSegs = spans.map((s) => {
      const fill = el('i'), count = el('small');
      const seg = el('span.tr-navseg', { 'data-zone': s.id, style: `flex-grow:${s.x1 - s.x0}` }, [
        el('span.tr-navname', {}, [mark('lock'), el('b', {}, s.label), count]), el('span.tr-navbar', {}, fill), el('i.tr-navdot'),
      ]);
      return { id: s.id, seg, fill, count };
    });
    this.nav.replaceChildren(...this.navSegs.map((s) => s.seg), this.navWin);
  }

  /** The navigator pressed or dragged at this pointer: the view centred there (sideways). */
  private navTo(e: PointerEvent): void {
    const r = this.nav.getBoundingClientRect();
    if (!r.width) return;
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * this.layout.w;
    this.view.scrollLeft = x * this.zoom - this.view.clientWidth / 2;
    this.paintRails();
  }

  /**
   * A cell (D128, D144): its box in its theme's colour, and its header — its name, a bar of how
   * much of it is learnt and the count; a category's padlock while a category it waits for is
   * unfinished. A plan path's header is its `.tr-lane` (D41: what it is for in its tooltip).
   */
  private cellEl(k: Cell): CellView {
    const L = locale();
    const fill = el('i'), count = el('small.tr-catcount');
    const box = el('div.tr-cat', { 'data-cell': k.kind, 'data-cat': k.kind === 'cat' ? k.id : null, 'data-path': k.kind === 'plan' ? k.id : null, 'data-lane': k.theme, 'data-tier': String(k.tier), style: `left:${k.x}px;top:${k.y}px;width:${k.w}px;height:${k.h}px` });
    const name = k.kind === 'cat' ? categoryName(k.id)[L] : t(`tree.lane.${k.id}` as MsgKey);
    const kids = [mark('lock'), el('span.tr-catname.lettering', {}, name), el('span.tr-catbar', {}, fill), count];
    const style = `left:${k.x}px;top:${k.y}px;width:${k.w}px;height:${CELL_HEAD}px`;
    const head = k.kind === 'cat'
      ? el('div.tr-cathead', { 'data-cat': k.id, 'data-lane': k.theme, style, onclick: () => this.goTo(this.nextIn(categoryNodes(k.id))) }, kids)
      : el('div.tr-cathead.tr-lane', { 'data-kind': 'plan', 'data-lane': k.id, style, onclick: () => this.goTo(this.nextIn(pathPlans(k.id as PlanLane))) }, kids);
    const v: CellView = { cell: k, box, head, count, fill };
    this.cells.set(k.id, v);
    return v;
  }

  /** The first of these not done yet (the first of all when every one is). */
  private nextIn(ids: readonly string[]): string {
    const sim = this.host.sim();
    return ids.find((id) => !sim.done.has(id)) ?? ids[0] ?? ROOT;
  }

  private icon(ic: Icon, px: number): HTMLElement | null {
    if ('b' in ic) return buildingIcon(this.atlas, ic.b, px);
    if ('i' in ic) return itemIcon(this.atlas, itemIdx(ic.i), px);
    if (ic.g === 'coin') return el('span.coin.tr-coin', {}, '◉');
    const c = glyph(ic.g, px);
    c.style.width = c.style.height = `${px}px`;
    return c;
  }

  /**
   * A card: what it unlocks (its icons), its name, its costs (a plan's materials and « Débloquer »;
   * a research node's resources and tokens), its state badge (D144: ✓, ▶, %, a padlock, the Core's
   * level), its number on the focused node's path, a running project's bar. The Heart and the lab
   * are pillars as tall as the lanes: the Heart's kit; the lab's plans taken, its cost, « Débloquer ».
   */
  private nodeEl(s: Spot): HTMLElement {
    const L = locale();
    const res = s.kind === 'research';
    const pillar = !!s.pillar;
    const icons = s.id === ROOT ? [this.icon({ b: 'hearth' }, 72)] : iconsOf(s.id).map((ic, k) => this.icon(ic, k === 0 ? (pillar ? 72 : res ? 34 : 34) : pillar ? 28 : 20));
    const name = s.id === ROOT ? t('tree.root') : nodeName(s.id)[L];
    const cost = el(res ? 'span.tr-rcost' : 'span.tr-cost');
    let chips: NodeView['chips'] = [];
    let unlock: HTMLButtonElement | null = null, bar: HTMLElement | null = null;
    let qtag: HTMLElement | null = null, tok: HTMLElement | null = null;
    let lines: Array<HTMLElement | null>;
    if (s.kind === 'plan') {
      chips = planDef(s.id)!.cost.map(([it, n]) => {
        const item = itemIdx(it);
        return { item, mu: toMu(n), node: el('span.tr-chip', { title: itemDef(item).name[L] }, [itemIcon(this.atlas, item, 14), String(n)]) };
      });
      cost.replaceChildren(...chips.map((c) => c.node));
      unlock = el<'button'>('button.btn.primary.tr-unlock', { type: 'button', 'data-unlock': s.id, title: t('tree.unlock'), onclick: (e: Event) => { e.stopPropagation(); this.unlock(s.id); } }, [el('span.tr-unlockw', {}, t('tree.unlock'))]);
      lines = pillar ? [this.gateCountEl(), el('span.tr-line', {}, [cost]), unlock] : [el('span.tr-line', {}, [cost, unlock])];
    } else if (res) {
      // What it unlocks first (its icons, left), then its name and one line: a chip per resource it
      // takes from the Core at launch, then its tokens (D122: at every tier, no data; D118: no time
      // anywhere; D128: no price in ◉).
      tok = el('span.tr-tokbox');
      bar = el('span.tr-bar');
      qtag = el('span.tr-qtag');
      lines = [el('span.tr-rline', {}, [cost, tok])];
    } else {
      setText(cost, t('tree.start'));
      lines = [el('small.tr-pillsub', {}, t('tree.start')), el('span.tr-kit', {}, startBuildings().map((b) => buildingIcon(this.atlas, b, 30)))];
    }
    const r = researchNode(s.id);
    const pct = el('span.tr-b-pct');
    const step = el('span.tr-step');
    const badge = el('span.tr-badge', {}, [
      el('span.tr-b-ok', {}, '✓'), el('span.tr-b-go', {}, '▶'), el('span.tr-b-lock', {}, [mark('lock')]),
      r && r.tier > 1 ? el('span.tr-b-core', {}, [buildingIcon(this.atlas, 'hearth', 16, coreLevelFor(r.tier)), el('b', {}, String(coreLevelFor(r.tier)))]) : null,
      pct,
    ]);
    const node = el('div.tr-node.rs-card', {
      'data-id': s.id, 'data-kind': s.kind, 'data-lane': s.lane || null, 'data-tier': r ? String(r.tier) : null, 'data-cat': r?.cat ?? null,
      'data-pillar': pillar ? '' : null, 'data-keystone': r?.depth === 9 ? '' : null, 'data-long': [...name].length > (res ? 20 : 16) ? '' : null,
      role: 'button', tabindex: '0',
      style: `left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px`,
      onclick: () => this.select(s.id),
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select(s.id); } },
    }, pillar
      ? [el('span.tr-pillin', {}, [el('span.tr-icons', { 'data-n': '1' }, icons.slice(0, 1)), el('span.tr-name.lettering', {}, name), ...lines]), badge, step]
      : [
        el('span.tr-icons', { 'data-n': String(icons.length) }, icons),
        el('span.tr-main', {}, [el('span.tr-name.lettering', {}, name), ...lines]),
        bar ? el('span.tr-track', {}, bar) : null,
        badge, step, qtag,
      ]);
    this.views.set(s.id, { spot: s, node, cost, chips, tok, qtag, bar, unlock, pct, step });
    return node;
  }

  /** The lab's pillar (D71): how many of the plans it needs are taken, a bar under it. */
  private gateCountEl(): HTMLElement {
    const fill = el('i'), count = el('small');
    this.gateHead = { count, fill };
    return el('span.tr-pillcount', {}, [el('span.tr-hbar', {}, fill), count]);
  }

  /**
   * A research node's costs (what the expertises leave of its table's, D93): a chip per resource it
   * takes from the Core at launch (D122), and its AI tokens (D128: their price in ◉ no longer shown).
   */
  private fillCosts(v: NodeView, sim: Sim): void {
    const id = v.spot.id;
    const L = locale();
    const e = effectiveCost(id, sim.mods);
    // Compact from a thousand (« 1,2 k »); the detail pane has them whole, with what the Core holds.
    v.chips = e.cost.map((c) => ({
      item: c.item, mu: c.mu,
      node: el('span.tr-chip', { 'data-k': 'res', title: `${num(c.mu / 1000)} ${itemDef(c.item).name[L]}` }, [itemIcon(this.atlas, c.item, 14), shortNum(c.mu / 1000)]),
    }));
    v.cost.replaceChildren(...v.chips.map((c) => c.node));
    v.tok?.replaceChildren(el('span.tr-chip', { 'data-k': 'tok', title: t('tree.rs.tok.tip', { v: num(e.tokens) }) }, [mark('token'), tokShort(e.tokens)]));
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
    const chain = focus ? chainOf(focus) : null;
    if (this.canvas) setAttr(this.canvas, 'data-chain', chain ? '' : null);
    for (const [id, v] of this.views) setAttr(v.node, 'data-chain', chain?.nodes.has(id) ? (id === focus ? 'self' : '') : null);
    for (const { link, path } of this.paths) setAttr(path, 'data-chain', chain?.links.has(link.kind === 'key' ? `key:${link.from}` : `${link.from}>${link.to}`) ? '' : null);
    for (const { link, path, head } of this.gatePaths) {
      const on = chain?.links.has(`cat:${link.from}>cat:${link.to}`) ? '' : null;
      setAttr(path, 'data-chain', on);
      setAttr(head, 'data-chain', on);
    }
    // A cell stays lit while one of its nodes is in the chain (D128): its own, its gates, what it opens.
    const lit = new Set([...(chain?.nodes ?? [])].map((n) => researchNode(n)?.cat ?? (planDef(n) && !isGate(n) ? planDef(n)!.lane : undefined)).filter((c): c is string => !!c));
    for (const [c, v] of this.cells) { setAttr(v.box, 'data-chain', lit.has(c) ? '' : null); setAttr(v.head, 'data-chain', lit.has(c) ? '' : null); }
    for (const tv of this.tiers.values()) if (tv.lock) setAttr(tv.lock, 'data-chain', chain?.links.has(`key:${tv.lock.dataset.key}`) ? '' : null);
  }

  /**
   * The path to the focused node (D144): each node it still waits for numbered on its card, in the
   * order `pathTo` reads them (the detail pane lists them the same) — repainted when the focus or
   * what is done changes.
   */
  private paintSteps(sim: Sim): void {
    const f = this.focused && this.views.has(this.focused) && !sim.done.has(this.focused) ? this.focused : null;
    const sig = `${f}:${sim.done.size}`;
    if (sig === this.stepSig) return;
    this.stepSig = sig;
    const steps = f ? pathTo(f, sim.done) : [];
    const n = new Map(steps.map((id, k) => [id, k + 1]));
    for (const [id, v] of this.views) {
      const k = n.get(id);
      setText(v.step, k ? String(k) : '');
      setAttr(v.node, 'data-step', k ? '' : null);
    }
  }

  /** The player selects a node: its detail, and the focus on its chain (none for the Heart: it has none). */
  private select(id: string): void {
    if (this.dragged) return; // the end of a drag, not a click
    this.selected = id;
    this.focused = id === ROOT ? null : id;
    this.detailSig = '';
    this.refresh();
  }

  /** Select a node and bring it into the middle of the view (a step of a path, a cell's next node, a wall's key). */
  private goTo(id: string): void {
    if (!this.views.has(id)) return;
    this.select(id);
    this.views.get(id)!.node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  }

  /** The focus let go (a click on the empty tree, Esc): the whole tree back; the detail stays. */
  private unfocus(): boolean {
    if (!this.focused) return false;
    this.focused = null;
    this.paintChain();
    this.paintSteps(this.host.sim());
    return true;
  }

  /** Esc (D111): the launch dialog first (D118), then the focus, then the filter (D144), then the screen closes. */
  back(): boolean {
    if (this.launch.isOpen) { this.launch.close(); return true; }
    if (this.unfocus()) return true;
    if (this.filterOn) { this.toggleFilter(); return true; }
    return false;
  }

  /** The tree closed: a launch dialog left open goes with it (nothing was started). */
  closed(): void {
    this.launch.close();
  }

  /** The available-now filter (D144): on, what cannot start now fades — what can (and runs) stays lit. */
  private toggleFilter(): void {
    this.filterOn = !this.filterOn;
    if (this.canvas) setAttr(this.canvas, 'data-filter', this.filterOn ? 'now' : null);
    setAttr(this.filterBtn, 'aria-pressed', this.filterOn ? 'true' : 'false');
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
   * The wheel scrolls the tree (sideways when it has nothing to scroll up and down: D144, every lane
   * in the view, the wheel runs through the tiers); with Ctrl or ⌘ — and a trackpad's pinch, which
   * the browser sends so — it zooms about the pointer (D111).
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

  /** On opening: the zoom (this viewer's, else every lane in view), the guide's node, else the selection (or the first thing to do), brought into the middle of the view. */
  opened(): void {
    this.setZoom(this.chosenZoom > 0 ? this.chosenZoom : this.autoZoom(), undefined, false);
    const sim = this.host.sim();
    const focus = this.host.focus?.() ?? null;
    if (focus && this.views.has(focus)) { this.selected = focus; this.focused = null; this.detailSig = ''; this.refresh(); }
    else if (!this.selected || !this.views.has(this.selected)) {
      this.focused = null;
      this.selected = readyPlans(sim)[0]
        ?? RESEARCH_IDS.find((id) => researchState(sim, id) === 'active')
        ?? RESEARCH_IDS.find((id) => researchState(sim, id) === 'ready')
        ?? PLAN_IDS.find((id) => planState(sim, id) === 'poor')
        ?? RESEARCH_IDS.find((id) => researchState(sim, id) === 'poor')
        ?? ROOT;
      this.detailSig = '';
      this.refresh();
    }
    this.views.get(this.selected)?.node.scrollIntoView({ block: 'center', inline: 'center' });
    this.paintRails();
  }

  // ── zoom (D111) ──

  /** The farthest out: the whole tree in the view. */
  private minZoom(): number {
    return fitZoom(this.view.clientWidth || this.layout.w, this.view.clientHeight || this.layout.h, this.layout);
  }

  /** The tree's own zoom (D144): every lane in the view's height, its names readable. */
  private autoZoom(): number {
    return openZoom(this.view.clientHeight || this.layout.h, this.layout);
  }

  /**
   * Zoom to `z` (within the range), keeping the point under `at` (client coordinates; the view's
   * middle by default) where it was: the canvas is measured before and after, and the view scrolled
   * by the difference — in the view's own units, whatever zoom the screens stand under (D96). A
   * player's zoom is kept for the next opening (`save`).
   */
  private setZoom(z: number, at?: { x: number; y: number }, save = true): void {
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
    this.paintRails();
    if (changed && save) {
      this.chosenZoom = this.zoom;
      window.clearTimeout(this.zoomSave);
      this.zoomSave = window.setTimeout(() => ZOOM_STORE.save({ version: 2, zoom: this.chosenZoom }), 300);
    }
  }

  /** The canvas at the zoom: its CSS zoom, `--tz` for what keeps its size on screen, how much a card shows; the bar's state. */
  private applyZoom(): void {
    const c = this.canvas;
    if (!c) return;
    const z = this.zoom, lv = zoomLevel(z);
    c.style.zoom = String(z);
    c.style.setProperty('--tz', String(z));
    // Shorter than the view (the whole tree in it): the canvas in the view's middle, not at its top.
    const free = this.root.isConnected ? this.view.clientHeight - Math.ceil(this.layout.h * z) : 0;
    const off = free > 1 ? Math.floor(free / 2) : 0;
    if (off !== this.offY) { this.offY = off; this.view.style.paddingTop = off ? `${off}px` : ''; }
    setAttr(c, 'data-zoom', lv === 'near' ? null : lv);
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
    this.paintRails();
  }

  /** The zoom keys while the tree is open (D111; app/controls.ts): - and = (or +) a step, 0 the whole tree. */
  zoomKey(how: 'in' | 'out' | 'fit'): boolean {
    if (!this.root.isConnected) return false;
    if (how === 'fit') this.fit();
    else this.setZoom(how === 'in' ? this.zoom * ZOOM_STEP : this.zoom / ZOOM_STEP);
    return true;
  }

  private scheduleRails(): void {
    if (this.railFrame) return;
    this.railFrame = requestAnimationFrame(() => { this.railFrame = 0; this.paintRails(); });
  }

  /**
   * The rails where their stage and lane are, at the zoom and the scroll (D144): a stage's head over
   * its column, as wide as it shows — its long form, a shorter one, its name alone as it narrows
   * (`data-w`); a lane's name beside its band, its colour alone where the band is thin (`data-h`);
   * the navigator's window over the part of the tree in view.
   */
  private paintRails(): void {
    if (!this.root.isConnected) return;
    const v = this.view, z = this.zoom, sl = v.scrollLeft, st = v.scrollTop;
    for (const r of this.railEls) {
      const w = Math.round(r.w * z);
      r.el.style.transform = `translateX(${Math.round(r.x * z - sl)}px)`;
      r.el.style.width = `${w}px`;
      const cls = w >= 330 ? 'l' : w >= 150 ? 'm' : w >= 70 ? 's' : 'xs';
      if (r.el.dataset.w !== cls) r.el.dataset.w = cls;
    }
    for (const r of this.laneEls) {
      const h = Math.round(r.h * z);
      r.el.style.transform = `translateY(${Math.round(this.offY + r.y * z - st)}px)`;
      r.el.style.height = `${h}px`;
      const cls = h >= 96 ? 'l' : h >= 40 ? 'm' : 's';
      if (r.el.dataset.h !== cls) r.el.dataset.h = cls;
    }
    const W = this.layout.w;
    this.navWin.style.left = `${Math.max(0, (sl / z / W) * 100)}%`;
    this.navWin.style.width = `${Math.min(100, (v.clientWidth / z / W) * 100)}%`;
  }

  /** The plans a gate needs (D71: every other plan), and how many are taken. */
  private gateCount(sim: Sim, id: string): { n: number; of: number } {
    const pre = treePrereq(id);
    return { n: pre.filter((p) => sim.done.has(p)).length, of: pre.length };
  }

  /** What a node still needs by name (`ownPrereq`: a category's gates are said apart, D128). */
  private missing(sim: Sim, id: string): string {
    const L = locale();
    return ownPrereq(id).filter((p) => !sim.done.has(p)).map((p) => nodeName(p)[L]).join(', ');
  }

  /** What a node's category still waits for (D128), in a sentence: its gates not finished. */
  private gateText(sim: Sim, id: string): string {
    const r = researchNode(id);
    return r ? this.opensText(r.cat, unmetGates(id, sim.done)) : '';
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
   * « Lancer » (D118, D122): the launch dialog, at every tier — the resources it takes from the Core,
   * the free flow it gets, how many tokens a minute to buy from CrierBelt (often none at Tier 1) —
   * starts it from there. A node that cannot start says why.
   */
  private start(id: string): void {
    const sim = this.host.sim();
    if (!sim.researchBlock(id)) {
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
    if (!r.ok && r.reason) this.host.notify('bad', this.blockText(sim, id, r.reason));
    this.detailSig = '';
    this.refresh();
  }

  /** A research node's resources short in the Core (D122), milli-items by item: what it costs beyond the stock. */
  private resShort(sim: Sim, id: string): Array<{ item: number; mu: number }> {
    return effectiveCost(id, sim.mods).cost.filter((c) => sim.stock[c.item]! < c.mu).map((c) => ({ item: c.item, mu: c.mu - sim.stock[c.item]! }));
  }

  /** What its resources would leave CrierBelt's restart reserve short of (D36, D122), milli-items by item. */
  private resReserve(sim: Sim, id: string): Array<{ item: number; mu: number }> {
    return sim.reserveShort(effectiveCost(id, sim.mods).cost);
  }

  /** Why a research node cannot start, in words: what is missing, the Core's level, what is short (D122)… */
  private blockText(sim: Sim, id: string, block: string): string {
    if (block === 'prereq') return t('research.block.prereq', { list: this.missing(sim, id) });
    if (block === 'gate') return this.gateText(sim, id);
    if (block === 'core') return t('tree.rs.coreNeed', { n: coreLevelFor(tierOf(id)) });
    if (block === 'unaffordable') return t('research.block.unaffordable.list', { list: this.shortList(this.resShort(sim, id)) });
    if (block === 'reserve') return t('tree.reserved', { list: this.shortList(this.resReserve(sim, id)) });
    return t(`research.block.${block}` as MsgKey);
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
    this.costSig = null; // the detail's figures redrawn
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
      return core || (block ? this.blockText(sim, id, block) : t('research.start'));
    }
    if (isPlan(id)) {
      if (st !== 'poor') return st === 'done' ? t('tree.unlocked') : t('tree.ready');
      const short = this.reserveShort(sim, id);
      return short.length ? t('tree.reserved', { list: this.shortList(short) }) : t('tree.poor');
    }
    if (st === 'done') return t('research.done');
    if (st === 'active') return this.eta(sim, id) ?? t('research.active');
    const block = sim.researchBlock(id);
    return block ? this.blockText(sim, id, block) : t('research.start');
  }

  /**
   * A running project's end (`projectTiming`, as the HUD's chip; D118, D122: its tokens, no time of
   * its own): what it waits for — power for its lab, a token flow (none reaches it; held while the
   * purse is in the red) — or when its tokens will be in at these flows. Null when nothing can be said.
   */
  private eta(sim: Sim, id: string): string | null {
    const p = sim.projects.find((q) => q.id === id);
    if (!p) return null;
    const tm = projectTiming(sim, p);
    if (tm.waiting === 'power') return t('research.waitPower');
    if (tm.waiting === 'tokens') return tm.held ? t('tree.rs.held') : t('research.waitTokens');
    return Number.isFinite(tm.left) ? t('research.eta', { d: duration(tm.left) }) : null;
  }

  /**
   * A cost in the detail pane, a plan's or a research's (D128; owner, 2026-10-18, on « ≈ 50 ◉ chez
   * CrierBelt » and « Pris au Cœur au lancement, rendu si tu l'annules »: « delete that »), as the
   * placing tip says it (452375a): a chip per item — its icon, how many, and after it what the Core
   * holds now (« 60 / 3 010 »), the whole chip coral while it is short (live until it is paid); its
   * name and both figures on hover. The cards keep their compact chips.
   */
  private costList(cost: ReadonlyArray<{ item: number; mu: number }>, live: boolean): HTMLElement {
    const L = locale();
    return el('div.rs-costs', {}, cost.map((c) => {
      const n = Math.round(c.mu / 1000);
      const have = live ? el('small.rs-have') : null;
      const chip = el('span.rs-costchip', { 'data-item': String(c.item), title: itemDef(c.item).name[L] }, [itemIcon(this.atlas, c.item, 20), el('b', {}, num(n)), have]);
      if (have) this.detailLive.push((sim) => {
        const h = Math.floor(sim.stock[c.item]! / 1000);
        setText(have, `/ ${compact(h)}`);
        setAttr(chip, 'data-poor', sim.stock[c.item]! < c.mu ? '' : null);
        setAttr(chip, 'title', t('tip.costHave', { item: itemDef(c.item).name[L], n: num(n), have: num(h) }));
      });
      return chip;
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
    // Research costs are the table's (D72) less what the expertises take off (D93).
    const sig = famSig(sim);
    const costsChanged = sig !== this.costSig;
    this.costSig = sig;
    this.refreshCells(sim);
    this.refreshTiers(sim);
    const queued = new Map<string, number>();
    if (sim.mods.flags.has('researchQueue')) for (const lab of labsOf(sim)) { const q = sim.labQueue.get(lab.id); if (q && !queued.has(q)) queued.set(q, lab.n); }
    const now = performance.now();
    if (this.just && now > this.just.until) this.just = null;
    let ready = 0;
    for (const v of this.views.values()) {
      const id = v.spot.id;
      const st = this.stateOf(sim, id);
      if (st === 'ready') ready++;
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
        // The tier's Core level not reached (D118): the badge shows the Core's look and level.
        setAttr(v.node, 'data-core', st !== 'done' && !proj && !sim.tierCoreOpen(tierOf(id)) ? '' : null);
        // Its resources (D122): coral while the Core lacks one (paid once launched: none marked then).
        for (const c of v.chips) setAttr(c.node, 'data-poor', st !== 'done' && !proj && sim.stock[c.item]! < c.mu ? '' : null);
        const pm = proj ? projectPermille(proj) : st === 'done' ? 1000 : 0;
        v.bar!.style.width = `${pm / 10}%`;
        setText(v.pct, proj ? `${Math.floor(pm / 10)}%` : '');
        setAttr(v.node, 'data-held', proj && projectTiming(sim, proj).held ? '' : null);
        const q = queued.get(id);
        setText(v.qtag!, q ? String(q) : '');
        setAttr(v.node, 'data-queued', q ? '' : null);
        setAttr(v.qtag!, 'title', q ? t('tree.rs.queued.tip', { lab: t('tree.rs.lab', { n: q }) }) : null);
      }
    }
    setText(this.filterCount, String(ready));
    setAttr(this.filterBtn, 'data-some', ready ? '' : null);
    setAttr(this.filterBtn, 'title', tr('tree.filter.tip', { n: ready }));
    // Links: inked once their target is done, the theme's colour where they open the way (their
    // source done), faint while locked.
    const done = (id: string): boolean => id === ROOT || sim.done.has(id);
    for (const { link, path } of this.paths) {
      const from = done(link.from), to = link.kind === 'key' ? sim.tierCoreOpen(Number(link.to.slice(5)) as ResearchTier) : done(link.to);
      setAttr(path, 'data-state', to ? 'done' : from ? 'open' : 'locked');
      setAttr(path, 'data-hot', link.to === this.selected || link.from === this.selected ? '' : null);
    }
    // The categories' gates (D128): inked once the gate is finished, dashed while it is not.
    for (const { link, path, head } of this.gatePaths) {
      const st = categoryDone(link.from, sim.done) ? 'done' : 'locked';
      setAttr(path, 'data-state', st);
      setAttr(head, 'data-state', st);
    }
    this.paintChain();
    this.paintSteps(sim);
    this.refreshNav(sim);
    this.renderDetail(sim, L);
    this.launch.refresh();
  }

  /**
   * Research's strip in the header (D68–D70): the slots as pips, the labs (free of all), the last
   * minute's token bill (D122: used = free — the Core's compute and the claim's servers — + the bank +
   * bought at CrierBelt, for so many ◉), the purse-in-the-red warning, the Compute Plan's switch, the
   * Research Queue's labs.
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
      if (this.coreIconLv !== sim.hearthLevel) {
        this.coreIconLv = sim.hearthLevel;
        this.coreIcon.replaceChildren(...[buildingIcon(this.atlas, 'hearth', 16, sim.hearthLevel)].filter((n): n is HTMLCanvasElement => !!n));
      }
      setText(this.bill.label, t('tree.rs.bill'));
      setText(this.bill.used, tokShort(st.used));
      setText(this.bill.free, tokShort(st.fromCore + st.fromServers));
      setText(this.bill.bank, tokShort(st.fromBank));
      setText(this.bill.bought, tokShort(st.bought));
      this.bankChip.hidden = st.fromBank <= 0 && sim.tokenBank <= 0;
      setText(this.bill.cents, st.cents > 0 ? oc(-st.cents, false, 2) : oc(0, false, 0));
      setAttr(this.bill.cents, 'data-tone', st.cents > 0 ? 'bad' : null);
      setText(this.bill.rental, st.rental > 0 ? oc(st.rental, true, 2) : '');
      // What nobody needed is lost (D122: the Core's share first, then the servers', which Server Rental can sell).
      const lost = Math.max(0, st.core - st.fromCore) + Math.max(0, st.supply - st.fromServers);
      setAttr(this.billEl, 'title', t('tree.rs.bill.tip', {
        used: tokShort(st.used), core: tokShort(st.fromCore), own: tokShort(st.fromServers), bank: tokShort(st.fromBank),
        bought: tokShort(st.bought), cost: oc(st.cents), lost: tokShort(lost),
      }) + (st.rental > 0 ? ` ${t('tree.rs.bill.rental', { v: oc(st.rental) })}` : ''));
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
            el('button.rs-qname', { type: 'button', onclick: () => this.goTo(id) }, nodeName(id)[L]),
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

  /**
   * The cells (D41, D128, D144): how many of each one's nodes the claim owns — the bar and « 2/4 »,
   * ✓ once finished; a category whose gates are not all finished padlocked, its box hatched; the
   * selected node's cell lit. The lab's pillar: how many plans are taken (D71).
   */
  private refreshCells(sim: Sim): void {
    const L = locale(), sel = researchNode(this.selected)?.cat ?? planDef(this.selected)?.lane ?? null;
    for (const [c, v] of this.cells) {
      const ids = v.cell.kind === 'cat' ? categoryNodes(c) : pathPlans(c as PlanLane);
      const n = ids.filter((id) => sim.done.has(id)).length;
      setText(v.count, `${n}/${ids.length}`);
      v.fill.style.width = `${ids.length ? (n * 100) / ids.length : 100}%`;
      setAttr(v.head, 'data-full', n === ids.length ? '' : null);
      setAttr(v.head, 'data-on', sel === c ? '' : null);
      if (v.cell.kind === 'cat') {
        const k: CategoryDef = CATEGORIES[c as keyof typeof CATEGORIES];
        const locked = k.gates.some((g) => !categoryDone(g, sim.done));
        setAttr(v.head, 'data-locked', locked ? '' : null);
        setAttr(v.box, 'data-locked', locked ? '' : null);
        setAttr(v.head, 'title', `${t('tree.cat.tip', { name: k.name[L], n, of: ids.length, desc: k.desc[L] })}${k.gates.length ? ` — ${this.opensText(c)}` : ''}`);
      } else {
        const lane = c as PlanLane;
        setAttr(v.head, 'title', t('tree.path.tip', { path: t(`tree.lane.${lane}` as MsgKey), theme: t(`tree.path.${lane}` as MsgKey), n, of: ids.length }));
      }
    }
    if (this.gateHead) {
      const c = this.gateCount(sim, LAB_PLAN);
      setText(this.gateHead.count, t('tree.gate.all', c));
      this.gateHead.fill.style.width = `${c.of ? (c.n * 100) / c.of : 100}%`;
    }
    if (this.plansHead) {
      const ids = PLAN_IDS as readonly string[];
      const n = ids.filter((id) => sim.done.has(id)).length;
      setText(this.plansHead.count, `${n}/${ids.length}`);
      this.plansHead.fill.style.width = `${(n * 100) / ids.length}%`;
    }
  }

  /** « Ouvre quand la catégorie Commerce (Tier 1) est terminée » (D128): what a category waits for, in a sentence. */
  private opensText(c: string, only?: readonly string[]): string {
    const k = categoryDef(c);
    const gates = only ?? k?.gates ?? [];
    if (!k || !gates.length) return '';
    const L = locale();
    const names = gates.map((g) => categoryName(g)[L]);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')}${t('tree.cat.and')}${names[names.length - 1]}` : names[0]!;
    return t(gates.length > 1 ? 'tree.cat.opens.many' : 'tree.cat.opens.one', { list, n: k.tier - 1 });
  }

  /**
   * The tiers: open once their gate is done, the Core at their level (D118) and, for Tier 2, two
   * expertises chosen (D93); a tier whose Core level is not reached padlocked — its head's chip, its
   * column hatched, its wall and the wall's lock —; its bar and count; the selected node's tier lit.
   */
  private refreshTiers(sim: Sim): void {
    const sel = researchNode(this.selected)?.tier ?? null;
    for (const [tier, h] of this.tiers) {
      const core = sim.tierCoreOpen(tier);
      const keyDone = sim.done.has(gateOf(tier));
      const open = keyDone && core && (tier !== 2 || tierTwoOpen(sim));
      setAttr(h.head, 'data-open', open ? '' : null);
      setAttr(h.head, 'data-locked', core ? null : '');
      setAttr(h.head, 'data-keyed', keyDone ? '' : null);
      setAttr(h.zone, 'data-locked', core ? null : '');
      if (h.wall) setAttr(h.wall, 'data-locked', core ? null : '');
      if (h.lock) {
        setAttr(h.lock, 'data-open', core ? '' : null);
        setAttr(h.lock, 'title', core ? t('tree.rs.core.open', { n: sim.hearthLevel }) : t('tree.rs.core.tip', { lv: coreLevelFor(tier), n: sim.hearthLevel }));
      }
      setAttr(h.head, 'data-on', sel === tier ? '' : null);
      if (h.core) setAttr(h.core, 'title', core ? t('tree.rs.core.open', { n: sim.hearthLevel }) : t('tree.rs.core.tip', { lv: coreLevelFor(tier), n: sim.hearthLevel }));
      const ids = RESEARCH_IDS.filter((id) => tierOf(id) === tier);
      const n = ids.filter((id) => sim.done.has(id)).length;
      setText(h.count, `${n}/${ids.length}`);
      h.fill.style.width = `${(n * 100) / ids.length}%`;
    }
  }

  /** The navigator (D144): each stage's bar, its padlock while the Core is below its level, a dot while something there can start. */
  private refreshNav(sim: Sim): void {
    for (const s of this.navSegs) {
      const tier = s.id === 'plans' ? 0 : Number(s.id.slice(1)) as ResearchTier;
      const ids: readonly string[] = tier ? RESEARCH_IDS.filter((id) => tierOf(id) === tier) : PLAN_IDS;
      const n = ids.filter((id) => sim.done.has(id)).length;
      s.fill.style.width = `${(n * 100) / ids.length}%`;
      setText(s.count, `${n}/${ids.length}`);
      setAttr(s.seg, 'data-locked', tier && !sim.tierCoreOpen(tier) ? '' : null);
      setAttr(s.seg, 'data-full', n === ids.length ? '' : null);
      setAttr(s.seg, 'data-ready', ids.some((id) => this.views.get(id)?.node.dataset.state === 'ready') ? '' : null);
    }
  }

  /** The detail pane: what the selected node is, unlocks and costs, the path to it, its action. */
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
    const sig = `${id}:${this.costSig}:${proj ? 1 : 0}:${st}:${block}:${core ? 1 : 0}:${L}:${this.shortList(short)}:${qOn ? 1 : 0}:${labs}:${sim.done.size}:${sim.hearthLevel}:${tierTwoOpen(sim) ? 1 : 0}`;
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
    const kind = id === ROOT ? t('tree.start') : isGate(id) ? t('tree.kind.plan') : `${t('tree.kind.plan')} · ${t(`tree.lane.${laneOf(id)}` as MsgKey)}`;
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
    );
    kids.push(isGate(id) ? this.gatePart(id) : this.pathPart(sim, id, L));
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
   * is its step in the path, a material short its coral line in the cost, the gate's plans its bars —
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
   * slots full, no idle lab, its resources held back by CrierBelt's restart reserve (D122, as a
   * plan's), the purse in the red. A missing prerequisite alone: none, its step says it; a resource
   * short: none, its coral line in the cost says it (D111).
   */
  private researchWhy(sim: Sim, id: string, block: string): HTMLElement | null {
    const tier = tierOf(id);
    if (!sim.tierCoreOpen(tier)) {
      const lvl = coreLevelFor(tier);
      return this.whyLine('core', buildingIcon(this.atlas, 'hearth', 18, lvl), t('tree.rs.coreNeed', { n: lvl }));
    }
    if (block === 'prereq' || block === 'unaffordable') return null;
    // Its category waits for those of the tier before it builds on (D128): the path says how far each is.
    if (block === 'gate') return this.whyLine('gate', mark('lock'), this.gateText(sim, id));
    if (block === 'reserve') return this.whyLine('reserve', inkGlyph('crier'), t('tree.reserved', { list: this.shortList(this.resReserve(sim, id)) }));
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

  /**
   * The path to a node (D144; Civilization VI's path to a goal): every node it still waits for, in
   * the order the tree reads them — numbered as on the cards while the node is focused —, each a
   * chip (its icon, its name, its state's colour) that selects it; and in their places the Core's
   * levels its tier and those before wait for (D118: after the node that makes each possible) and
   * Tier 2's two expertises (D93). The first steps only, and how many more. Nothing when nothing is
   * missing.
   */
  private pathPart(sim: Sim, id: string, L: Loc): HTMLElement | null {
    if (sim.done.has(id) || id === ROOT) return null;
    const steps = pathTo(id, sim.done);
    const tier = researchNode(id)?.tier ?? 0;
    type Step = { k: 'node'; id: string; n: number } | { k: 'core'; lvl: number } | { k: 'exp' };
    const out: Step[] = [];
    steps.forEach((s, i) => out.push({ k: 'node', id: s, n: i + 1 }));
    // The Core's levels (D118) and Tier 2's expertises (D93), after what makes each possible.
    for (const t2 of TIERS) {
      if (t2 < 2 || t2 > tier) continue;
      const extra: Step[] = [];
      if (!sim.tierCoreOpen(t2)) extra.push({ k: 'core', lvl: coreLevelFor(t2) });
      if (t2 === 2 && !tierTwoOpen(sim)) extra.push({ k: 'exp' });
      if (!extra.length) continue;
      const after = out.findIndex((s) => s.k === 'node' && s.id === gateOf(t2));
      // The key itself done: the level comes before the first step of that tier (or last).
      const at = after >= 0 ? after + 1 : (() => { const k = out.findIndex((s) => s.k === 'node' && (researchNode(s.id)?.tier ?? 0) >= t2); return k >= 0 ? k : out.length; })();
      out.splice(at, 0, ...extra);
    }
    if (!out.length) return null;
    const MAX = 14;
    const chip = (s: Step): HTMLElement => {
      if (s.k === 'core') return el('span.rs-step', { 'data-k': 'core', title: t('tree.rs.coreNeed', { n: s.lvl }) }, [buildingIcon(this.atlas, 'hearth', 18, s.lvl), el('span', {}, t('tree.heartLevel', { n: s.lvl }))]);
      if (s.k === 'exp') return el('span.rs-step', { 'data-k': 'exp', title: t('research.block.expertise') }, [archiveGlyph(), el('span', {}, t('tree.path.exp'))]);
      const ic = iconsOf(s.id)[0];
      return el('button.rs-step', {
        type: 'button', 'data-step-id': s.id, 'data-state': this.stateOf(sim, s.id), 'data-lane': laneOf(s.id) || null,
        title: `${nodeName(s.id)[L]} — ${this.why(sim, s.id)}`, onclick: () => this.goTo(s.id),
      }, [el('b.rs-stepn', {}, String(s.n)), ic ? this.icon(ic, 18) : null, el('span', {}, nodeName(s.id)[L])]);
    };
    return el('section.rs-path', {}, [
      el('h4.lettering', {}, tr('tree.path.head', { n: steps.length })),
      el('div.rs-steps', {}, [...out.slice(0, MAX).map(chip), out.length > MAX ? el('small.rs-more', {}, tr('tree.path.more', { n: out.length - MAX })) : null]),
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
    const rows = this.giftRows(id, L);
    const kids: Array<HTMLElement | null> = [
      el('small.tr-kind', { 'data-kind': 'research', 'data-lane': r.theme }, `${t('tree.kind.research')} · ${t('tree.rs.tier', { n: r.tier })} · ${categoryName(r.cat)[L]}`),
      el('h3.lettering', {}, nodeName(id)[L]),
      el('p.rs-desc', {}, r.desc[L]),
      rows.length ? el('h4.lettering', {}, t('tree.unlocks')) : null,
      rows.length ? el('ul.tr-unlocks', {}, rows) : null,
      ...this.costPart(sim, id, st !== 'done' && !proj),
      st !== 'done' && !proj ? this.pathPart(sim, id, L) : null,
      proj ? this.progressPart(sim, proj) : null,
      el('footer.rs-actions', {}, [
        st === 'done' ? el('span.rs-tag', {}, t('research.done'))
          : proj ? el('button.btn', { type: 'button', onclick: () => this.cancel(id) }, t('research.cancel'))
            : el('button.btn.primary', { type: 'button', 'data-start': id, disabled: block ? '' : null, onclick: () => this.start(id) }, t('research.start')),
        st !== 'done' && !proj && block ? this.researchWhy(sim, id, block) : null,
      ]),
    ];
    if (st !== 'done' && sim.mods.flags.has('researchQueue')) kids.push(this.queuePart(sim, id, L));
    return kids;
  }

  /**
   * A research node's cost (D68, D69, D118, D122, D128): its resources as chips — what the Core holds
   * of each beside it, coral when short (live until it is launched: paid then) —, then its AI tokens;
   * the table's, whatever else the claim owns (D72), less what an expertise takes off (D93). No data,
   * no time (a research lasts as long as its tokens take to come), and no price in ◉ (D128: the
   * launch dialog says what a bought flow costs).
   */
  private costPart(sim: Sim, id: string, live: boolean): HTMLElement[] {
    const e = effectiveCost(id, sim.mods);
    const tok = el('div.rs-tokline', { 'data-k': 'tok', title: t('tree.rs.tok.tip', { v: num(e.tokens) }) }, [mark('token'), el('b', {}, num(e.tokens)), el('small', {}, t('tree.legend.tokens'))]);
    return [el('h4.lettering.rs-costhead', {}, [t('research.cost')]), e.cost.length ? this.costList(e.cost, live) : null, tok].filter((x): x is HTMLElement => !!x);
  }

  /**
   * A running project (D68, D118, D122): its tokens in of those it needs, a bar; the tokens a minute
   * it gets now — free (the Core's compute and the servers), from the bank, bought from CrierBelt —
   * and their ◉ a minute (the bought flow held while the purse is in the red); a coral line while its
   * lab has no power (it takes no tokens then); the flow it buys, − / + on the launch dialog's ladder
   * (`setTokenBuy`), while it still needs tokens; its end, or what it waits for.
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
    const usesTokens = (p.tokens ?? 0) > 0;
    if (usesTokens) row([mark('token'), t('tree.rs.prog.tokens')], (_s, q) => [q.tokIn ?? 0, q.tokens ?? 0, `${tokShort(q.tokIn ?? 0)} / ${tokShort(q.tokens ?? 0)}`], 'tok');
    // Its tokens now (D102, D118, D122): free, banked and bought, a minute; their ◉ a minute — icons, the words on hover.
    let now: HTMLElement | null = null;
    if (usesTokens) {
      const free = el('b'), bank = el('b'), bought = el('b'), cents = el('b');
      const coreIcon = el('span.rs-bcore');
      const bankChip = el('span.rs-tk', { 'data-k': 'bank' }, [kitMark('store'), bank]);
      now = el('div.rs-toknow', {}, [
        el('span.rs-tk', { 'data-k': 'free' }, [coreIcon, free]),
        bankChip,
        el('span.rs-tk', { 'data-k': 'bought' }, [inkGlyph('crier'), bought]),
        el('span.rs-tk', { 'data-k': 'cents' }, [el('span.coin-w', {}, '◉'), cents]),
      ]);
      const nowEl = now;
      let lv = 0;
      this.detailLive.push((s) => {
        const q = s.projects.find((x) => x.id === p.id);
        if (!q) return;
        if (lv !== s.hearthLevel) { lv = s.hearthLevel; coreIcon.replaceChildren(...[buildingIcon(this.atlas, 'hearth', 16, lv)].filter((n): n is HTMLCanvasElement => !!n)); }
        const tm = projectTiming(s, q), me = tokenFacts(s).projects.get(p.id);
        const c = Math.round(me?.centsPerMin ?? 0);
        setText(free, t('hud.perMin', { v: tokShort(tm.free) }));
        setText(bank, t('hud.perMin', { v: tokShort(tm.bank) }));
        bankChip.hidden = tm.bank <= 0 && s.tokenBank <= 0;
        setText(bought, tm.held ? t('tree.rs.toknow.held') : t('hud.perMin', { v: tokShort(tm.bought) }));
        setText(cents, t('hud.perMin', { v: ocNum(c, false, c < 100 ? 2 : 0) }));
        setAttr(nowEl, 'data-held', tm.held ? '' : null);
        setAttr(nowEl, 'data-in', tokensLeft(q) <= 0 ? '' : null);
        setAttr(nowEl, 'title', t('tree.rs.toknow.tip', { f: tokShort(tm.free), k: tokShort(tm.bank), b: tokShort(tm.bought), c: oc(c, false, 2) }));
      });
    }
    // Its lab without power (D122): it takes no tokens until it has some.
    const power = el('div.rs-heldnote.rs-powernote', { hidden: '', 'data-rs-power': '' }, [inkGlyph('noPower'), el('span', {}, t('tree.rs.noPower'))]);
    const flow = usesTokens ? this.flowControl(sim, p) : null;
    const eta = el('div.rs-live');
    const held = el('div.rs-heldnote', { hidden: '' }, t('tree.rs.held'));
    this.detailLive.push((s) => {
      const q = s.projects.find((x) => x.id === p.id);
      const tm = q ? projectTiming(s, q) : null;
      const pct = q ? t('research.progress', { v: Math.floor(projectPermille(q) / 10) }) : '';
      const end = q ? this.eta(s, p.id) : null;
      setText(eta, end ? `${pct} · ${end}` : pct);
      held.hidden = !tm?.held;
      setAttr(held, 'title', t('tree.rs.held.tip', { v: oc(s.credits) }));
      power.hidden = tm?.waiting !== 'power';
    });
    return el('section.rs-prog', {}, [el('h4.lettering', {}, t('tree.rs.progress')), ...rows, now, power, flow, eta, held]);
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
