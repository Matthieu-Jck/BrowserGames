// guide.ts — the tutorial's guide. For the current quest's current step (content/quests.ts):
// an inked arrow and a pulsing ring on what to use next — a build-bar tab, then the building's
// slot, then (building in hand) the spot in the world; the Link tool; the tech tree (its HUD
// chip, then the node's « Débloquer » or a research card and its start button, D33); a line to
// branch with a router, then the ribbon on to the building it must feed; the Crier's ◉, its
// tab, the control in it… — and the step's one-line hint in a small cartouche at the arrow's tail.
// When a full screen covers what comes next out in the world, the arrow points at its ✕.
//
// Two kinds of quest (D101). A guided quest's step is the first whose `done` objective does not
// hold yet (read from the sim, counters from the founding, in any order the player did them) and
// that never held before — a step done never comes back, even undone again (the guide remembers,
// per base, in localStorage) —, else the quest's closing line while it waits for its numbers (D98).
// A goal shows nothing by itself: on request (the log's « Indice », `toggleHint`) or once its
// objectives have not moved for `QUEST_HINT_AFTER` game ticks, one marker on its first hint still
// to do, until that hint's `done` holds — then it goes, and the next one waits to be asked for.
// `refresh` (4 Hz) decides what to point at, following the UI's state; `frame` keeps the arrow on it
// while the camera and the panels move (change-only writes). The bubble sits where there is room —
// off what it points at, the controls the step needs (the panel or card around the target), the
// quest log and the side panels —, follows resizes and scrolls, and tucks into a ☞ chip (its « – »;
// remembered). The layer never takes the pointer, except the bubble: a click on a world target's
// glides the camera there. The guide hides while a full screen covers its target, while the naming
// modal is open, and when the player turns it off in the quest log (remembered in localStorage).
import { CIRQUE } from '@/content/world';
import { BUILDING_IDS, BUILDING_KIND, ITEM_IDS, buildingDef, buildingIdx, costOf, itemIdx } from '@/content/registry';
import { BUILDINGS } from '@/content/buildings';
import { QUEST_HINT_AFTER, guideSteps, isGoal, type GuideSpot, type GuideTarget, type QuestDef, type QuestStep } from '@/content/quests';
import { RECIPES } from '@/content/recipes';
import type { BuildCategory, Loc, RecipeDef } from '@/content/types';
import { el, setAttr, setStyle, setText } from '@/core/dom';
import type { ScreenId } from '@/core/kinds';
import { makeStore } from '@/core/store';
import { num } from '@/i18n/format';
import { locale, t } from '@/i18n/i18n';
import { CENTER } from '@/sim/constants';
import { footprint, worldPorts } from '@/sim/entities';
import { DX, DY, sideIndex } from '@/sim/types';
import { gap2, isLinkPoint, linkCheck, linkPoint, wireReach } from '@/sim/power/links';
import { landOf } from '@/sim/systems/power';
import type { Ent } from '@/sim/types';
import type { Sim } from '@/sim/state';
import { currentQuest, drillItem, flows, objectiveProgress, producersOf, questProgress, receives, stepApplies } from '@/sim/systems/quests';
import { planCost } from '@/sim/systems/research';
import { looksAtWork } from '@/sim/systems/work';
import { stopWhy } from '@/sim/readouts/production';
import { windiest } from '@/sim/readouts/wind';
import { nearestWater } from '@/sim/readouts/water';
import { coreRefusals, machineRefusals } from '@/sim/readouts/core-door';
import { PARCEL, parcelAt, parcelCentre } from '@/sim/world/land';
import { itemRef } from './mention';
import { hintText } from './quest-log';
import { planState } from './tree-state';

export interface GuideHost {
  sim(): Sim;
  /** The open build category (null: not building). */
  category(): BuildCategory | null;
  /** The tool in hand: its kind ('build', 'belt', 'remove', 'mark', the Link tool…) and building. */
  tool(): { k: string; def: string | null } | null;
  /** The open full screen (null: the world). */
  screen(): ScreenId | null;
  /** The inspected entity (0: none). */
  selected(): number;
  /** CSS px of a tile's centre in the current view. */
  tileToScreen(tx: number, ty: number): [number, number];
  /** Glide the camera to a tile. */
  lookAt(tx: number, ty: number): void;
  /** Something modal is up (the naming modal): no guide. */
  blocked(): boolean;
  /** The Link tool's source, once one is picked (0: none yet, or the tool not in hand). */
  linkSource(): number;
  /** The land mode (D60): on or not, and the parcel picked in it (−1: none). */
  land(): { active: boolean; selected: number };
}

/** The current step (or a goal's hint on show), for the quest log's hint line. */
export interface GuideStep { quest: string; index: number; hint: Loc }

/** A goal quest's hint, as the quest log's « Indice » button shows it (D101). */
export interface HintState {
  /** The current quest is a goal (it has hints, no steps). */
  goal: boolean;
  /** Its marker is on screen (asked for, or the soft hint after a long stall). */
  shown: boolean;
  /** A hint is left to give (else every hint holds: the quest waits for its numbers). */
  left: boolean;
  /** It came by itself (no progress for a long while). */
  auto: boolean;
}

/** What the arrow points at: a DOM element, a spot in the world (tile centre, radius in tiles), or nothing. */
type Aim = (
  | { k: 'el'; el: Element; desc: string }
  | { k: 'world'; x: number; y: number; r: number; desc: string }
  | { k: 'none'; desc: string }
) & { text?: string };

const NONE: Aim = { k: 'none', desc: 'none' };
// The switch, the tucked bubble and the steps done, per base and quest (`passed`: « base|quest » →
// step indices; D101: a step done never comes back). The first store kept only the switch.
const prefsV1 = makeStore<{ version: 1; on: boolean }>('filon.guide.v1', 1, () => ({ version: 1, on: true }));
type Prefs = { version: 2; on: boolean; tucked: boolean; passed: Record<string, number[]> };
const prefs = makeStore<Prefs>('filon.guide.v2', 2, () => ({ version: 2, on: prefsV1.load().on, tucked: false, passed: {} }));
/** Bases kept in `passed` (the oldest go): a few debug bases and the player's own. */
const PASSED_KEEP = 24;
/** The base a guide memory belongs to. */
const baseKey = (sim: Sim): string => `${sim.playerSeed}:${sim.foundingEpoch}`;
const SVG = 'http://www.w3.org/2000/svg';

/** An element if it is in the page and drawn (display: none and detached ones are not). */
function shown(e: Element | null | undefined): Element | null {
  if (!e || !e.isConnected) return null;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? e : null;
}
const q = (sel: string): Element | null => shown(document.querySelector(sel));
const aimEl = (e: Element | null, desc: string): Aim | null => (e ? { k: 'el', el: e, desc } : null);

/**
 * The first step of a guided quest still to do (counters count from the founding; a step for another
 * land passed by, D87; one done before, `passed`, never again, D101), else its closing line.
 */
export function stepIndex(sim: Sim, def: QuestDef, passed?: ReadonlySet<number>): number {
  const steps = guideSteps(def);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (passed?.has(i) || !stepApplies(sim, s) || (s.done && objectiveProgress(sim, s.done).met)) continue;
    return i;
  }
  return steps.length - 1;
}

/** A goal's first hint still to do (D101), or −1 when every one holds. */
export function hintIndex(sim: Sim, def: QuestDef): number {
  const hints = def.hints ?? [];
  return hints.findIndex((s) => stepApplies(sim, s) && !(s.done && objectiveProgress(sim, s.done).met));
}

/** What the Core lacks of a cost, as the bubble says it (« Il manque au Cœur : 4 Fil de cuivre »); {} when it holds it all. */
function shortOf(sim: Sim, cost: ReadonlyArray<{ item: number; mu: number }>): { text?: string } {
  const lack = cost.filter((c) => sim.stock[c.item]! < c.mu);
  if (!lack.length) return {};
  return { text: t('quest.guide.short', { list: lack.map((c) => `${num(Math.ceil((c.mu - sim.stock[c.item]!) / 1000))} ${itemRef(ITEM_IDS[c.item]!)}`).join(', ') }) };
}

/** Has the base done every step of the quest (each step's `done` holds, a step for another land passed by)? */
function stepsDone(sim: Sim, def: QuestDef): boolean {
  return guideSteps(def).every((s) => !stepApplies(sim, s) || !s.done || objectiveProgress(sim, s.done).met);
}

/**
 * The first production building that stands still for good — unwired, or no recipe set — with why,
 * as the guide shows it. Not a research lab: between two projects it waits for the player's next
 * one, which is not what a quest waits for.
 */
function stalledAim(sim: Sim): Aim | null {
  for (const e of sim.ents.sorted()) {
    if (e.builtAt !== 0 || !looksAtWork(e.def) || BUILDING_KIND[e.def] === 'lab') continue;
    const why = stopWhy(sim, e);
    if (why !== 'unwired' && why !== 'recipe') continue;
    const c = centreOf(sim, e.id)!;
    return { k: 'world', x: c[0], y: c[1], r: c[2], desc: `stalled:${BUILDING_IDS[e.def]}:${why}`, text: t('quest.guide.stalled', { name: buildingDef(e.def).name[locale()], why: t(`mapview.why.${why}`) }) };
  }
  return null;
}

/**
 * The tree node an unlock step is after: the first of `ids` the Heart can take now (D101: « all
 * plans » points at one ready plan, not down the list), else the first still locked.
 */
function unlockNode(sim: Sim, ids: readonly string[]): string | null {
  const left = ids.filter((x) => !sim.unlocked(x));
  return left.find((x) => planState(sim, x) === 'ready') ?? left[0] ?? null;
}

/**
 * A trade post's exit that leads somewhere else than to any of `to` (its front tile taken by a
 * ribbon or a building, none of `to` reached): the tile in front of it, else null. A post's one exit
 * hands out all it bought (D62): what it leads into gets the purchases.
 */
function exitElsewhere(sim: Sim, to: readonly string[]): [number, number] | null {
  const want = builtOf(sim, to);
  for (const p of builtOf(sim, ['trade_post'])) {
    if (want.some((w) => flows(sim, p.id, w.id))) return null;
    const exit = worldPorts(p).find((w) => w.io === 'out');
    if (exit && sim.entityAt(exit.fx, exit.fy)) return [exit.fx, exit.fy];
  }
  return null;
}

/** Built, awake entities of these kinds, in id order. */
function builtOf(sim: Sim, defs: readonly string[]): ReturnType<Sim['ents']['sorted']> {
  const want = new Set(defs.map((d) => buildingIdx(d)));
  return sim.ents.sorted().filter((e) => want.has(e.def) && e.builtAt === 0);
}

/** A building's centre (tile) and half-size (tiles). */
function centreOf(sim: Sim, id: number): [number, number, number] | null {
  const e = sim.ents.get(id);
  if (!e) return null;
  const [w, h] = footprint(e.def, e.rot);
  return [e.x + (w - 1) / 2, e.y + (h - 1) / 2, Math.max(w, h) / 2 + 0.4];
}

/**
 * The newest built building that puts something out (a drill, a smelter, a mill…): the one whose
 * output ribbon the player is laying now. The Heart and the routing blocks are not producers.
 */
function newestProducer(sim: Sim): Ent | undefined {
  let best: Ent | undefined;
  for (const e of sim.ents.sorted()) {
    if (e.builtAt !== 0 || e.id === sim.hearthId) continue;
    const b = buildingDef(e.def);
    if (b.kind === 'fork' || !b.ports.some((p) => p.io === 'out')) continue;
    best = e; // ascending ids: the last one is the newest
  }
  return best;
}

/**
 * Where an output ribbon must end: the tile just outside a free input port of the Heart (nothing
 * on it yet), the nearest to the newest producer — the Heart only takes in (D34), every nozzle
 * is an input.
 */
function intakeOf(sim: Sim): [number, number, number] | null {
  const h = sim.ents.get(sim.hearthId);
  if (!h) return null;
  const p = newestProducer(sim);
  const ref = p ? centreOf(sim, p.id)! : centreOf(sim, h.id)!;
  let best: [number, number, number] | null = null, bestD = Infinity;
  for (const p of BUILDINGS.hearth.ports) {
    if (p.io !== 'in') continue;
    const s = sideIndex[p.side];
    const x = h.x + p.x + DX[s]!, y = h.y + p.y + DY[s]!;
    if (sim.entityAt(x, y)) continue; // already taken (a ribbon arrives there, or something else stands)
    const d = (x - ref[0]) ** 2 + (y - ref[1]) ** 2;
    if (d < bestD) { bestD = d; best = [x, y, 0.75]; }
  }
  return best ?? centreOf(sim, h.id);
}

/**
 * A production line (D34: machines are fed by lines, never by the Heart): the ribbon tiles that
 * carry what `from` puts out, followed through ribbons and routing blocks up to the first
 * machine or store, and whether a routing block already stands on it.
 */
function lineOf(sim: Sim, from: readonly number[]): { tiles: number[]; fork: boolean; open: boolean } {
  const g = sim.graph;
  // `open`: a routing block on it has a side free for one more branch (playtest 2026-10-16: a
  // router with every side taken left « un ruban depuis le routeur » with nowhere to start).
  const out = { tiles: [] as number[], fork: false, open: false };
  if (!g) return out;
  type N = { kind: string; outE: readonly number[]; tiles?: readonly number[] };
  const seen = new Set<N>();
  const todo: N[] = [];
  for (const id of from) {
    const n = g.nodeByEnt.get(id) as N | undefined;
    if (n) todo.push(n);
  }
  for (let i = 0; i < todo.length; i++) {
    for (const e of todo[i]!.outE) {
      const d = g.nodes[g.eDst[e]!] as unknown as N;
      if (seen.has(d) || (d.kind !== 'chain' && d.kind !== 'fork')) continue;
      seen.add(d);
      todo.push(d);
      if (d.kind === 'fork') {
        out.fork = true;
        const r = sim.ents.get((d as unknown as { ent: number }).ent);
        if (r && [0, 1, 2, 3].some((k) => !sim.entityAt(r.x + DX[k]!, r.y + DY[k]!))) out.open = true;
      } else for (const t of d.tiles ?? []) out.tiles.push(t);
    }
  }
  return out;
}

/**
 * Where a wire to `e` starts: the Heart, or a pillar of its grid that can wire it now (the
 * nearest); −1 when none can (too far: a pole between first).
 */
function linkFrom(sim: Sim, e: Ent): number {
  const grid = sim.graph?.netOfEnt.get(sim.hearthId);
  const d2 = (o: Ent): number => (o.x - e.x) * (o.x - e.x) + (o.y - e.y) * (o.y - e.y);
  const pillars = sim.ents.sorted().filter((o) => o.id !== sim.hearthId && isLinkPoint(o.def) && sim.graph?.netOfEnt.get(o.id) === grid)
    .sort((a, b) => d2(a) - d2(b) || a.id - b.id);
  return [sim.hearthId, ...pillars.map((o) => o.id)].find((id) => sim.canLink(id, e.id).ok) ?? -1;
}

/**
 * Where the next pole goes on the way to `e` when nothing of the Heart's grid reaches it: the free
 * tile nearest `e` where a new pole wires itself into the grid (D25: to a pillar in reach, the land
 * between allowing), searched round the grid's three pillars nearest `e` (playtest 2026-10-16: the
 * arrow sent the player for a pole, then straight back to the Link tool, never saying where).
 */
function poleSpot(sim: Sim, e: Ent): [number, number] | null {
  const grid = sim.graph?.netOfEnt.get(sim.hearthId);
  const mast = buildingIdx('mast'), land = landOf(sim), mp = linkPoint(mast, sim.mods);
  const pillars = sim.ents.sorted().filter((o) => isLinkPoint(o.def) && o.builtAt === 0 && sim.graph?.netOfEnt.get(o.id) === grid)
    .sort((a, b) => gap2(a, e) - gap2(b, e) || a.id - b.id).slice(0, 3);
  // Never on a building's way in or out: a pole there would block the line the next step lays.
  const fronts = new Set<number>();
  for (const o of sim.ents.sorted()) for (const w of worldPorts(o)) fronts.add(w.fy * 1024 + w.fx);
  let best: [number, number] | null = null, bestD = Infinity;
  for (const p of pillars) {
    const R = wireReach(mp, linkPoint(p.def, sim.mods)), [pw, ph] = footprint(p.def, p.rot);
    for (let y = p.y - R; y < p.y + ph + R; y++) {
      for (let x = p.x - R; x < p.x + pw + R; x++) {
        const pole = { id: -1, def: mast, x, y, rot: 0 } as unknown as Ent;
        const d = gap2(pole, e);
        if (d >= bestD || fronts.has(y * 1024 + x) || linkCheck(pole, p, sim.links, sim.mods, land) !== 'ok') continue;
        // Where it can stand, paid for or not: a pole the Core cannot pay for yet is the bubble's to say.
        const c = sim.canPlace('mast', x, y, 0);
        if ((c.ok || c.reason === 'unaffordable' || c.reason === 'reserve') && !c.replaces.length) { best = [x, y]; bestD = d; }
      }
    }
  }
  return best;
}

/** The Crown's windiest free spot for a turbine (D95), kept while the base stands as it is (the scan reads the whole Crown). */
const windySpots = new WeakMap<Sim, { key: string; spot: [number, number, number] | null }>();
function windySpot(sim: Sim): [number, number, number] | null {
  const key = `${sim.ents.map.size}:${sim.graph?.version ?? 0}`;
  const kept = windySpots.get(sim);
  if (kept?.key === key) return kept.spot;
  const R = (sim.grid.source.crownOuter ?? CIRQUE.crownOuter) + 1;
  const best = windiest(sim, 'wind_flower', CENTER, CENTER, R, 1, true)[0];
  const spot: [number, number, number] | null = best ? [best[0] + 1, best[1] + 1, 1.6] : null;
  windySpots.set(sim, { key, spot });
  return spot;
}

/** The nearest spot to the Core where a pump draws water (D114), kept while the base stands as it is. */
const waterSpotsKept = new WeakMap<Sim, { key: string; spot: [number, number, number] | null }>();
function waterSpot(sim: Sim): [number, number, number] | null {
  const key = `${sim.ents.map.size}:${sim.graph?.version ?? 0}`;
  const kept = waterSpotsKept.get(sim);
  if (kept?.key === key) return kept.spot;
  const w = nearestWater(sim);
  const spot: [number, number, number] | null = w ? [w[0] + 0.5, w[1] + 0.5, 1.2] : null;
  waterSpotsKept.set(sim, { key, spot });
  return spot;
}

/** A place in the world (content `GuideSpot`): tile centre and radius. */
export function spotOf(sim: Sim, at: GuideSpot): [number, number, number] | null {
  if ('windy' in at) return windySpot(sim);
  if ('water' in at) return waterSpot(sim);
  if ('deposit' in at) {
    const d = CIRQUE.deposits.find((x) => x.item === at.deposit);
    return d ? [CENTER + d.dx, CENTER + d.dy, d.radius + 0.5] : null;
  }
  if ('between' in at) {
    // Halfway from the Heart to the deposit: where a machine fed from that deposit goes.
    const d = CIRQUE.deposits.find((x) => x.item === at.between);
    return d ? [CENTER + d.dx / 2, CENTER + d.dy / 2, 3] : null;
  }
  if ('hearth' in at) return centreOf(sim, sim.hearthId);
  if ('intake' in at) return intakeOf(sim);
  if ('refused' in at) {
    // A door where something waits refused (D139): the Core's first, then a machine's (the slag at the
    // wire mill, « Les scories »): the line's last tile, where a sorter laid takes it in. None: the
    // newest wire mill, where the contract's slag goes.
    const r = coreRefusals(sim)[0] ?? machineRefusals(sim)[0];
    if (r) return [r.tile % 1024, Math.floor(r.tile / 1024), 0.75];
    const k = builtOf(sim, ['wire_mill']);
    return k.length ? centreOf(sim, k[k.length - 1]!.id) : null;
  }
  if ('beyond' in at) {
    // Past the Crown, due east (the cirque is closed, D45: no pass to point at).
    return [CENTER + CIRQUE.crownOuter + 4, CENTER, 3];
  }
  if ('newest' in at) {
    const all = builtOf(sim, [at.newest]);
    const e = all[all.length - 1];
    return e ? centreOf(sim, e.id) : null;
  }
  if ('vein' in at) {
    // The floor at the foot of the quartz vein's face, its middle (D87): where face cutters stand —
    // the tile the cursor takes for one whose back is on the face (a 2×2's corner tile is its origin:
    // the floor against the face, two out on a face looking west or north). Playtest 2026-10-16: the
    // ring's middle, 1.5 tiles out, put a cutter one row too far (« dos contre la roche »).
    const V = sim.grid.source.quartzVein;
    if (!V) return null;
    const m = (V.n - 1) / 2, out = (d: number): number => (d > 0 ? 1 : d < 0 ? -2 : 0);
    return [V.x + m * V.dx + out(DX[V.look]!), V.y + m * V.dy + out(DY[V.look]!), V.n / 2 + 0.5];
  }
  const e = builtOf(sim, [at.entity])[0];
  return e ? centreOf(sim, e.id) : null;
}

export class Guide {
  readonly root: HTMLElement;
  /** The current step (null: no quest, or every quest done). */
  step: GuideStep | null = null;
  private aim: Aim = NONE;
  /** The tree node last brought into view for a step (scrolled once, then left to the player). */
  private shownNode = '';
  /** Where the next pole goes on a link step (`poleSpot`), and the base it was worked out on. */
  private pole: [number, number] | null = null;
  private poleKey = '';
  private poleGraph: unknown = null;
  private readonly prefs: Prefs = prefs.load();
  private on = this.prefs.on;
  /** A goal's hint (D101): on show for this quest, and whether it came by itself. */
  private hint: { quest: string; auto: boolean; index: number } | null = null;
  /** The current goal's progress as last seen, the tick it last moved, and whether the soft hint came for this stall. */
  private watch: { quest: string; best: number[]; hint: number; since: number; nudged: boolean } | null = null;
  private readonly svg: SVGSVGElement;
  private readonly arrow: SVGGElement;
  private readonly halo: SVGPathElement;
  private readonly line: SVGPathElement;
  private readonly head: SVGPathElement;
  private readonly ring: HTMLElement;
  private readonly bubble: HTMLElement;
  /** The bubble's « – »: tucks it into a chip (D101). */
  private readonly tuckBtn: HTMLButtonElement;
  private readonly text: HTMLElement;

  constructor(private readonly host: GuideHost) {
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.setAttribute('class', 'guide-svg');
    this.arrow = document.createElementNS(SVG, 'g');
    this.arrow.setAttribute('class', 'guide-arrow');
    this.halo = document.createElementNS(SVG, 'path');
    this.halo.setAttribute('class', 'guide-halo');
    this.line = document.createElementNS(SVG, 'path');
    this.line.setAttribute('class', 'guide-line');
    this.head = document.createElementNS(SVG, 'path');
    this.head.setAttribute('class', 'guide-head');
    this.arrow.append(this.halo, this.line, this.head);
    this.svg.append(this.arrow);
    this.ring = el('div.guide-ring');
    this.text = el('span.guide-text.lettering');
    // « – » tucks the bubble into a ☞ chip beside the ring; a click on the chip brings it back (D101).
    this.tuckBtn = el<'button'>('button.guide-tuck', { type: 'button', 'data-guide-tuck': '', onclick: (e: Event) => { e.stopPropagation(); this.tuck(true); } }, '–');
    this.bubble = el('div.guide-bubble.cartouche', { onclick: () => (this.prefs.tucked ? this.tuck(false) : this.go()) }, [el('span.guide-mark', {}, '☞'), this.text, this.tuckBtn]);
    setAttr(this.bubble, 'data-tucked', this.prefs.tucked ? '' : null);
    this.root = el('div.guide', { 'data-screen': 'guide', hidden: true }, [this.svg, this.ring, this.bubble]);
  }

  /** Tuck the bubble into its chip, or bring it back (remembered). */
  tuck(v: boolean): void {
    this.prefs.tucked = v;
    prefs.save(this.prefs);
    setAttr(this.bubble, 'data-tucked', v ? '' : null);
    setAttr(this.bubble, 'title', v ? t('quest.guide.untuck') : null);
    this.frame();
  }

  /** The current goal's hint, for the quest log's button. */
  hintState(): HintState {
    const sim = this.host.sim();
    const cur = currentQuest(sim);
    if (!cur || !isGoal(cur.def)) return { goal: false, shown: false, left: false, auto: false };
    return { goal: true, shown: this.hint?.quest === cur.id, left: hintIndex(sim, cur.def) >= 0, auto: this.hint?.quest === cur.id && this.hint.auto };
  }

  /** The log's « Indice »: show the current goal's one marker, or put it away. */
  toggleHint(): void {
    const sim = this.host.sim();
    const cur = currentQuest(sim);
    if (!cur || !isGoal(cur.def)) return;
    const index = hintIndex(sim, cur.def);
    this.hint = this.hint?.quest === cur.id || index < 0 ? null : { quest: cur.id, auto: false, index };
    this.refresh();
  }

  /** The steps of a guided quest done on this base (D101: never shown again). */
  private passedOf(sim: Sim, quest: string): Set<number> {
    return new Set(this.prefs.passed[`${baseKey(sim)}|${quest}`] ?? []);
  }

  /** Remember the steps whose check holds now; saved when that adds one. */
  private pass(sim: Sim, quest: string, def: QuestDef, passed: Set<number>): void {
    const n = passed.size;
    guideSteps(def).forEach((s, i) => { if (s.done && stepApplies(sim, s) && objectiveProgress(sim, s.done).met) passed.add(i); });
    if (passed.size === n) return;
    const key = `${baseKey(sim)}|${quest}`;
    const all = this.prefs.passed;
    delete all[key];
    all[key] = [...passed].sort((a, b) => a - b);
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - PASSED_KEEP))) delete all[k];
    prefs.save(this.prefs);
  }

  /** Shown at all (the quest log's toggle)? */
  get enabled(): boolean { return this.on; }
  set enabled(v: boolean) {
    this.on = v;
    this.prefs.on = v;
    prefs.save(this.prefs);
    this.refresh();
  }

  /** The tree node the current step is after (an `unlock` step's first locked node, a `research` step's): the tree opens on it. */
  focusNode(): string | null {
    const sim = this.host.sim();
    const cur = currentQuest(sim);
    if (!cur || !this.on) return null;
    // A goal's tree target only while its hint is on show (D101: nothing unasked).
    const i = isGoal(cur.def) ? (this.hint?.quest === cur.id ? hintIndex(sim, cur.def) : -1) : stepIndex(sim, cur.def, this.passedOf(sim, cur.id));
    const tg = i >= 0 ? guideSteps(cur.def)[i]?.target : undefined;
    if (tg?.k === 'unlock') return unlockNode(sim, tg.ids);
    if (tg?.k === 'research') return tg.id;
    return null;
  }

  /** What the arrow points at, in words (FL.guide / the smoke test). */
  describe(): { quest: string | null; step: number; at: string; hint: boolean; tucked: boolean } {
    return { quest: this.step?.quest ?? null, step: this.step?.index ?? -1, at: this.root.hasAttribute('hidden') ? 'hidden' : this.aim.desc, hint: !!this.hint, tucked: this.prefs.tucked };
  }

  /** 4 Hz: the current step, and what to point at in the UI as it stands. */
  refresh(): void {
    const sim = this.host.sim();
    const cur = currentQuest(sim);
    if (!cur) { this.step = null; this.aim = NONE; this.hint = null; this.hide(); return; }
    if (this.hint && this.hint.quest !== cur.id) this.hint = null;
    let i: number;
    if (isGoal(cur.def)) {
      // A goal (D101): nothing unless asked for, or after a long stall — then one marker, gone once
      // its hint holds (the next one waits to be asked for: never a stream).
      this.nudge(sim, cur.id, cur.def);
      const h = this.hint ? cur.def.hints?.[this.hint.index] : undefined;
      if (this.hint && (!h || !stepApplies(sim, h) || (h.done && objectiveProgress(sim, h.done).met))) this.hint = null;
      i = this.hint ? this.hint.index : -1;
      if (i < 0) { this.step = null; this.aim = NONE; this.hide(); return; }
    } else {
      const passed = this.passedOf(sim, cur.id);
      this.pass(sim, cur.id, cur.def, passed);
      i = stepIndex(sim, cur.def, passed);
    }
    const s = guideSteps(cur.def)[i]!;
    this.step = { quest: cur.id, index: i, hint: s.hint };
    // A step whose check holds is never pointed at (D98: the last one, every step done, if a quest
    // ever ended on one — content's `questProblems` asks for a closing line there).
    this.aim = s.done && objectiveProgress(sim, s.done).met ? NONE : this.resolve(sim, s);
    // Every step done and the quest still short (it waits for its numbers): a production building
    // standing unwired or without a recipe is why, most likely — the arrow shows it and says so
    // (playtest 2026-10-16: an unwired copper drill left « Le filon fatigué » at 0/10, the guide blank).
    if (this.aim.k === 'none' && !this.host.screen() && stepsDone(sim, cur.def)) this.aim = stalledAim(sim) ?? NONE;
    setText(this.text, this.aim.text ?? hintText(cur.def, s.hint));
    setAttr(this.bubble, 'title', this.prefs.tucked ? t('quest.guide.untuck') : this.aim.k === 'world' ? t('quest.guide.go') : null);
    setAttr(this.tuckBtn, 'title', t('quest.guide.tuck'));
    setAttr(this.bubble, 'data-go', this.aim.k === 'world' ? '' : null);
    this.frame();
  }

  /**
   * A goal's soft hint (D101): its objectives' progress watched; once it has not moved for
   * `QUEST_HINT_AFTER` game ticks, the hint comes by itself, once for that stall, if a hint is left.
   * The hint on show goes once it holds (`refresh`); a hint the player put away stays away until
   * the next stall.
   */
  private nudge(sim: Sim, quest: string, def: QuestDef): void {
    // Progress: an objective past its best so far (the night's share moves with every gust: only a
    // new best counts), or one more hint done.
    const have = questProgress(sim).map((p) => p.have), hint = hintIndex(sim, def);
    const w = this.watch;
    if (!w || w.quest !== quest || sim.tick < w.since) {
      this.watch = { quest, best: have, hint, since: sim.tick, nudged: false };
      return;
    }
    if (have.some((v, i) => v > (w.best[i] ?? 0)) || hint !== w.hint) {
      w.best = have.map((v, i) => Math.max(v, w.best[i] ?? 0));
      w.hint = hint; w.since = sim.tick; w.nudged = false;
      return;
    }
    if (!w.nudged && !this.hint && sim.tick - w.since >= QUEST_HINT_AFTER && hint >= 0) {
      w.nudged = true;
      this.hint = { quest, auto: true, index: hint };
    }
  }

  /** Every frame: follow the target (the camera pans, panels move). */
  frame(): void {
    if (!this.on || this.host.blocked() || this.aim.k === 'none') { this.hide(); return; }
    const W = window.innerWidth, H = window.innerHeight;
    let cx: number, cy: number, rw: number, rh: number, round: boolean;
    if (this.aim.k === 'el') {
      // A panel rebuilt under it: hidden until the next refresh finds the new element.
      const r = this.aim.el.isConnected ? this.aim.el.getBoundingClientRect() : null;
      if (!r || r.width <= 0 || r.height <= 0) { this.hide(); return; }
      cx = r.left + r.width / 2; cy = r.top + r.height / 2; rw = r.width + 12; rh = r.height + 12; round = false;
    } else {
      // The circle's screen box (a squashed ellipse in iso, round in plan): eight points around it.
      const [sx, sy] = this.host.tileToScreen(this.aim.x, this.aim.y);
      let x0 = sx, x1 = sx, y0 = sy, y1 = sy;
      for (let k = 0; k < 8; k++) {
        const [px, py] = this.host.tileToScreen(this.aim.x + this.aim.r * Math.cos((k * Math.PI) / 4), this.aim.y + this.aim.r * Math.sin((k * Math.PI) / 4));
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      // Off screen: the ring waits at the edge, on the way there.
      cx = Math.min(W - 40, Math.max(40, (x0 + x1) / 2)); cy = Math.min(H - 40, Math.max(40, (y0 + y1) / 2));
      rw = Math.max(34, x1 - x0 + 10); rh = Math.max(24, y1 - y0 + 10); round = true;
    }
    setAttr(this.root, 'hidden', null);
    setStyle(this.ring, 'left', `${Math.round(cx - rw / 2)}px`);
    setStyle(this.ring, 'top', `${Math.round(cy - rh / 2)}px`);
    setStyle(this.ring, 'width', `${Math.round(rw)}px`);
    setStyle(this.ring, 'height', `${Math.round(rh)}px`);
    setAttr(this.ring, 'data-round', round ? '' : null);

    // The bubble goes where there is room (D101; playtest 2026-10-16: under the tree chip it covered
    // CrierBelt's message; owner, the same day: « here the tutorial blocks me from seeing what I'm
    // supposed to do », the Crier's order form under it): never over what it points at, nor the
    // controls the step needs — the card or panel round the target (a post's card and its form, a
    // tree node and the node's detail, the inspector) —, nor the quest log or the side panels. Tried
    // above what sits low (the build bar), below what sits high (the HUD), beside, then round the
    // target's corners and beside the log; the first spot clear is kept, else the one that covers
    // least. Worked out every frame, so it follows resizes and scrolls. Tucked: a ☞ chip at the
    // ring's corner, no arrow.
    const tucked = this.prefs.tucked;
    const bw = this.bubble.offsetWidth || (tucked ? 30 : 220), bh = this.bubble.offsetHeight || (tucked ? 30 : 40);
    const gap = tucked ? 6 : 74;
    const box = (r: DOMRect): [number, number, number, number] => [r.left, r.top, r.width, r.height];
    const keepOff: Array<[number, number, number, number]> = [[cx - rw / 2, cy - rh / 2, rw, rh]];
    const log = q('[data-screen="quests"]')?.getBoundingClientRect();
    if (log) keepOff.push(box(log));
    for (const sel of ['[data-screen="inspector"]', '[data-screen="stock"]', '[data-screen="land"]', '[data-screen="view"]']) {
      const r = q(sel)?.getBoundingClientRect();
      if (r) keepOff.push(box(r));
    }
    // The HUD's readouts (the purse, the power, the clock): a bubble by the tree chip covered them.
    for (const g of document.querySelectorAll('.hud-grp')) { const r = g.getBoundingClientRect(); if (r.width > 0 && r.height > 0) keepOff.push(box(r)); }
    if (this.aim.k === 'el') {
      const around = this.aim.el.closest('.cr-post, .tr-node, .rs-card, .inspector, .buildbar, .stockp, .land, .vpanel');
      if (around && around !== this.aim.el && shown(around)) keepOff.push(box(around.getBoundingClientRect()));
      const detail = this.aim.el.closest('#screens') ? q('#screens > [data-open] .rs-detail') : null;
      if (detail) keepOff.push(box(detail.getBoundingClientRect()));
    }
    const above: [number, number] = [cx - bw / 2, cy - rh / 2 - gap - bh];
    const below: [number, number] = [cx - bw / 2, cy + rh / 2 + gap];
    const right: [number, number] = [cx + rw / 2 + gap, cy - bh / 2];
    const left: [number, number] = [cx - rw / 2 - gap - bw, cy - bh / 2];
    const corners: Array<[number, number]> = [
      [cx + rw / 2 + gap * 0.6, cy - rh / 2 - gap * 0.6 - bh], [cx - rw / 2 - gap * 0.6 - bw, cy - rh / 2 - gap * 0.6 - bh],
      [cx + rw / 2 + gap * 0.6, cy + rh / 2 + gap * 0.6], [cx - rw / 2 - gap * 0.6 - bw, cy + rh / 2 + gap * 0.6],
    ];
    const first = tucked ? corners[0]! : cy > H * 0.62 ? above : cy < H * 0.3 ? below : cx < W / 2 ? right : left;
    const clamp = ([x, y]: [number, number]): [number, number] => [Math.min(W - bw - 10, Math.max(10, x)), Math.min(H - bh - 10, Math.max(10, y))];
    const overlap = ([x, y]: [number, number]): number => keepOff.reduce((s, [kx, ky, kw, kh]) =>
      s + Math.max(0, Math.min(x + bw, kx + kw) - Math.max(x, kx)) * Math.max(0, Math.min(y + bh, ky + kh) - Math.max(y, ky)), 0);
    // Beside the log, level with the target but under the HUD's top row: the way out for what sits
    // over the log (the tree chip).
    const hudLow = Math.max(0, ...[...document.querySelectorAll('.hud-grp')].map((g) => g.getBoundingClientRect()).filter((r) => r.top < 40).map((r) => r.bottom));
    const besideLog: [number, number] = log ? [log.right + 24, Math.max(cy - bh / 2, hudLow + 8)] : first;
    const spots = [first, right, below, left, above, ...corners, besideLog].map(clamp);
    let best = spots[0]!, least = Infinity;
    for (const sp of spots) { const o = overlap(sp); if (o < least) { least = o; best = sp; } if (o === 0) break; }
    const [bx, by] = best;
    setStyle(this.bubble, 'left', `${Math.round(bx)}px`);
    setStyle(this.bubble, 'top', `${Math.round(by)}px`);
    if (tucked) { setAttr(this.arrow, 'display', 'none'); return; }

    // The arrow: from the bubble's edge to the ring's edge, a slight inked curve, an open head.
    const [ax, ay] = edgePoint(bx, by, bw, bh, cx, cy);
    const [tx, ty] = ellipsePoint(cx, cy, rw / 2 + 3, rh / 2 + 3, ax, ay);
    const dx = tx - ax, dy = ty - ay, len = Math.hypot(dx, dy);
    if (len < 18) { setAttr(this.arrow, 'display', 'none'); return; }
    setAttr(this.arrow, 'display', null);
    const nx = -dy / len, ny = dx / len, bend = Math.min(26, len * 0.18);
    const mx = (ax + tx) / 2 + nx * bend, my = (ay + ty) / 2 + ny * bend;
    const d = `M${ax.toFixed(1)} ${ay.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}`;
    setAttr(this.halo, 'd', d);
    setAttr(this.line, 'd', d);
    // Head along the curve's end tangent (control point → tip).
    const hx = tx - mx, hy = ty - my, hl = Math.hypot(hx, hy) || 1;
    const ux = hx / hl, uy = hy / hl, k = 13;
    const p1 = `${(tx - ux * k + uy * k * 0.62).toFixed(1)} ${(ty - uy * k - ux * k * 0.62).toFixed(1)}`;
    const p2 = `${(tx - ux * k - uy * k * 0.62).toFixed(1)} ${(ty - uy * k + ux * k * 0.62).toFixed(1)}`;
    setAttr(this.head, 'd', `M${p1} L${tx.toFixed(1)} ${ty.toFixed(1)} L${p2}`);
    // The arrow nods towards its target.
    setStyle(this.arrow as unknown as HTMLElement, '--bx', `${(ux * 6).toFixed(1)}px`);
    setStyle(this.arrow as unknown as HTMLElement, '--by', `${(uy * 6).toFixed(1)}px`);
  }

  private hide(): void {
    setAttr(this.root, 'hidden', '');
  }

  /** A world target's bubble was clicked: glide there. */
  private go(): void {
    if (this.aim.k === 'world') this.host.lookAt(Math.round(this.aim.x), Math.round(this.aim.y));
  }

  /** What to point at for a step, given the UI as it stands. */
  private resolve(sim: Sim, s: QuestStep): Aim {
    const scr = this.host.screen();
    const tg = s.target;
    // Targets inside a full screen are handled per kind; anything else is out in the world, and
    // the way there is the open screen's ✕ (the tree after its unlock, the Crier after its stream).
    const inTree = tg.k === 'research' || tg.k === 'unlock';
    if (scr && !inTree && tg.k !== 'crier') return tg.k === 'none' ? NONE : this.closeAim();
    if (scr && inTree && scr !== 'research') return this.closeAim();
    if (scr && tg.k === 'crier' && scr !== 'market') return this.closeAim();
    return this.target(sim, tg, s) ?? NONE;
  }

  /** The open full screen's close button (research, statistics, the Crier); nothing under the menu. */
  private closeAim(): Aim {
    return aimEl(q('#screens > [data-open] .rs-close'), 'screen:close') ?? NONE;
  }

  private target(sim: Sim, tg: GuideTarget, s: QuestStep): Aim | null {
    switch (tg.k) {
      case 'build': {
        // Bought goods to a machine (D101: « La Criée »'s contract into the wire mill): a post whose one
        // exit already leads elsewhere hands its purchases there — that ribbon first, and why.
        const d = s.done;
        if (tg.def === 'ribbon' && d?.k === 'feeds' && d.from?.includes('trade_post')) {
          const away = exitElsewhere(sim, d.to);
          if (away) return { k: 'world', x: away[0], y: away[1], r: 0.8, desc: 'post:exit', text: t('quest.guide.exitTaken') };
        }
        return this.build(sim, tg.def, tg.at);
      }
      case 'recipe': {
        const name = (RECIPES as Record<string, RecipeDef>)[tg.recipe]?.name[locale()] ?? '';
        // The machine to set: one with no recipe yet first (never turn a working line over), then
        // one on another recipe.
        const all = builtOf(sim, tg.defs);
        const recipeId = (x: Ent): string | undefined => (sim.graph?.nodeByEnt.get(x.id) as { recipe?: { id: string } | null } | undefined)?.recipe?.id;
        const e = all.find((x) => !recipeId(x)) ?? all.find((x) => recipeId(x) !== tg.recipe) ?? all[0];
        if (e && this.host.selected() === e.id) {
          const btn = [...document.querySelectorAll('.inspector .insp-recipe')].find((b) => b.textContent === name);
          if (shown(btn)) return aimEl(btn!, `recipe:${tg.recipe}`);
        }
        if (!e) {
          // None to set yet: build one first (the bubble says so).
          const a = this.build(sim, tg.defs[0]!, { hearth: true });
          return a ? { ...a, text: t('quest.guide.first', { name: buildingDef(buildingIdx(tg.defs[0]!)).name[locale()] }) } : null;
        }
        const c = centreOf(sim, e.id)!;
        // A building still in hand (the smelter just placed): a click on it is a refused placement
        // (« Emplacement occupé »; playtest 2026-10-16) — the bubble says to put the tool away first.
        const held = this.host.tool();
        const text = held && held.def ? t('quest.guide.putAway', { name: buildingDef(e.def).name[locale()] }) : undefined;
        return { k: 'world', x: c[0], y: c[1], r: c[2], desc: `entity:${BUILDING_IDS[e.def]}`, ...(text ? { text } : {}) };
      }
      case 'link': {
        const tool = this.host.tool();
        // The first building the step still wants on the grid.
        const defs = s.done && 'defs' in s.done ? s.done.defs : [];
        const item = s.done && 'item' in s.done && s.done.item !== undefined ? itemIdx(s.done.item) : -1;
        const e = builtOf(sim, defs).find((x) => (item < 0 || drillItem(sim, x.id) === item) && !sim.graph?.netOfEnt.has(x.id));
        // A pole in hand while nothing of the grid reaches it: where the next pole goes, until one does.
        if (e && (tool?.def === 'mast' || tool?.def === 'pylon') && linkFrom(sim, e) < 0) {
          // Worked out again on a new base or a new graph (a pole just placed joins the grid only
          // once the graph is compiled again: worked out before, it was left out).
          const key = `${e.id}:${sim.ents.nextId}:${sim.links.size}`;
          if (key !== this.poleKey || sim.graph !== this.poleGraph) { this.poleKey = key; this.poleGraph = sim.graph; this.pole = poleSpot(sim, e); }
          if (this.pole) return { k: 'world', x: this.pole[0], y: this.pole[1], r: 0.9, desc: 'pole:spot', text: t('quest.guide.pole'), ...shortOf(sim, costOf(buildingIdx(tool.def))) };
          // No tile found (the slots of the pillars in reach all taken…): the building, and the rule.
          const c = centreOf(sim, e.id)!, mp = linkPoint(buildingIdx('mast'), sim.mods);
          return { k: 'world', x: c[0], y: c[1], r: c[2], desc: `pole:toward:${BUILDING_IDS[e.def]}`, text: t('quest.guide.poleToward', { r: mp?.range ?? 0 }) };
        }
        if (tool && /link/i.test(tool.k)) {
          // Wiring: point at that building (else the Heart).
          // A wire starts from a pillar or the Heart: with no source picked yet, the arrow points at
          // one that reaches the building, then at the building (playtest, 2026-10-15: the arrow on
          // the drill first made the click a refusal, against the hint « clique le Cœur puis… »).
          // A source picked that cannot wire it (« Trop loin pour un fil »; playtest 2026-10-16): back
          // to one that can — after Échap, since a click on another pillar strings a wire to it, or
          // cuts the one already there.
          const src = this.host.linkSource();
          const wrong = !!e && src > 0 && !sim.canLink(src, e.id).ok;
          const from = e && (!src || wrong) ? linkFrom(sim, e) : 0;
          // Nothing of the grid reaches it (the hint: « Trop loin ? Pose un poteau entre les deux »):
          // the pole's slot (a new pole wires itself to the nearest pillar, D25), then back here.
          if (from < 0) return this.build(sim, 'mast', null);
          const c = centreOf(sim, from || (e ? e.id : sim.hearthId))!;
          const text = wrong && from ? t('quest.guide.relink') : undefined;
          return { k: 'world', x: c[0], y: c[1], r: c[2], desc: from ? `link:from:${BUILDING_IDS[sim.ents.get(from)!.def]}` : e ? `entity:${BUILDING_IDS[e.def]}` : 'hearth', ...(text ? { text } : {}) };
        }
        const btn = q('[data-tool="link"]') ?? q('[data-guide="link"]') ?? q('.bb-link');
        if (btn) return aimEl(btn, 'tool:link');
        return (this.host.category() ? aimEl(q('.bb-tab[data-cat="energy"]'), 'tab:energy') : null) ?? aimEl(q('.hud-build'), 'hud:build');
      }
      case 'research': {
        if (this.host.screen() === 'research') {
          // « Lancer » opens the launch dialog at every tier (D122): its own « Lancer » next.
          const go = q('[data-launch]:not([hidden]) [data-launch-go]');
          if (go) return aimEl(go, `research:go:${tg.id}`);
          const card = q(`.rs-card[data-id="${tg.id}"]`);
          if (card && this.shownNode !== tg.id) { this.shownNode = tg.id; card.scrollIntoView({ block: 'nearest', inline: 'center' }); }
          if (card?.hasAttribute('data-on')) return aimEl(q('.rs-detail .rs-actions .btn.primary'), `research:start:${tg.id}`) ?? aimEl(card, `research:card:${tg.id}`);
          return aimEl(card, `research:card:${tg.id}`);
        }
        // A narrow window folds the tree's chip behind the research fold (D96): the arrow points at the fold.
        return aimEl(q('[data-hud-tree]') ?? q('[data-hud-fold="research"]'), 'hud:tree');
      }
      case 'unlock': {
        // The node to take (the first ready one, else the first still locked): the HUD chip opens
        // the tree, then the node's own button.
        const id = unlockNode(sim, tg.ids);
        if (!id) return null;
        if (this.host.screen() !== 'research') return aimEl(q('[data-hud-tree]') ?? q('[data-hud-fold="research"]'), 'hud:tree');
        const node = q(`.tr-node[data-id="${id}"]`);
        if (node && this.shownNode !== id) { this.shownNode = id; node.scrollIntoView({ block: 'nearest', inline: 'center' }); }
        const btn = q(`.tr-node[data-id="${id}"] [data-unlock]:not([disabled])`);
        if (btn) return aimEl(btn, `tree:unlock:${id}`);
        // A plan the Heart cannot pay for yet: the bubble says what it lacks (playtest 2026-10-16:
        // the arrow sat on a greyed « Débloquer », the research lab four copper wires short).
        const why = shortOf(sim, planCost(id));
        if (node?.hasAttribute('data-on')) {
          const a = aimEl(q('.rs-detail .rs-actions .btn.primary'), `tree:start:${id}`) ?? aimEl(node, `tree:node:${id}`);
          return a ? { ...a, ...why } : null;
        }
        const a = aimEl(node, `tree:node:${id}`);
        return a ? { ...a, ...why } : null;
      }
      // No router yet (D101: a glass smelter fed by its own coal drill passed the router's hints by):
      // its plan first, in the tree.
      case 'branch': {
        if (sim.unlocked(BUILDINGS.router.unlock)) return this.branch(sim, tg.item, tg.to);
        const a = this.target(sim, { k: 'unlock', ids: [BUILDINGS.router.unlock] }, s);
        return a ? { ...a, text: a.text ?? t('quest.guide.routerFirst') } : null;
      }
      case 'crier': {
        // The purse opens its card (D102), whose foot opens the Crier: the arrow on the purse, then on « Ouvrir la Criée ».
        if (this.host.screen() !== 'market') return aimEl(q('[data-hud-crier]') ?? q('[data-hud-purse]'), 'hud:crier');
        const on = document.querySelector('[data-crier-tab][data-on]')?.getAttribute('data-crier-tab');
        if (on !== tg.tab) return aimEl(q(`[data-crier-tab="${tg.tab}"]`), `crier:tab:${tg.tab}`);
        // The starter contract's « Signer » (D101), on the first post's card; no post yet: the bubble says so.
        if (tg.focus === 'starter') return aimEl(q('[data-starter-take]'), 'crier:starter') ?? { ...NONE, text: t('quest.guide.noPost') };
        if (tg.focus !== 'order') return null;
        // The form's item picker, then — once it shows the item the step orders — « Ajouter »
        // (playtest 2026-10-16: the form opens on copper ore, and the arrow stayed on the picker).
        const pick = q('[data-order-item]');
        const want = s.done?.k === 'order' ? s.done.item : null;
        if (!want || pick?.getAttribute('data-item') !== want) return aimEl(pick, 'crier:order');
        // The rate the step asks for (D90: 5 a minute, the form opens on 10), then « Ajouter ».
        const n = q('[data-order-n]') as HTMLInputElement | null;
        if (tg.n !== undefined && n && Number(n.value) !== tg.n) return aimEl(n, 'crier:order:n');
        return aimEl(q('[data-order-add]'), 'crier:order:add') ?? aimEl(pick, 'crier:order');
      }
      case 'brush': return aimEl(q('.bb-mark'), 'tool:mark') ?? aimEl(q('.hud-build'), 'hud:build');
      case 'land': {
        // Buy a parcel (D60): the land mode (the HUD's button), the parcel holding the spot, its « Acheter ».
        const spot = spotOf(sim, tg.at);
        if (!spot) return null;
        const p = parcelAt(Math.round(spot[0]), Math.round(spot[1]));
        const land = this.host.land();
        if (!land.active) return aimEl(q('[data-hud-land]'), 'hud:land');
        if (land.selected !== p) {
          const [cx, cy] = parcelCentre(p);
          return { k: 'world', x: cx, y: cy, r: PARCEL / 2, desc: 'land:parcel' };
        }
        return aimEl(q('[data-land-act="buy"]'), 'land:buy');
      }
      case 'name': return aimEl(q('[data-quest-name]'), 'quest:name');
      case 'hearth': {
        // The Core's next level (D101, « Le Cœur grandit »): the Core in the world, then the upgrade
        // at its card's foot.
        if (this.host.selected() === sim.hearthId) {
          const btn = q('.inspector [data-insp-act="hearth-up"]');
          if (shown(btn)) return aimEl(btn!, 'hearth:up');
        }
        const c = centreOf(sim, sim.hearthId);
        if (!c) return null;
        const held = this.host.tool();
        const text = held && held.def ? t('quest.guide.putAway', { name: buildingDef(buildingIdx('hearth')).name[locale()] }) : undefined;
        return { k: 'world', x: c[0], y: c[1], r: c[2], desc: 'entity:hearth', ...(text ? { text } : {}) };
      }
      // The Stock button (D96), until its panel is open: then the hint alone.
      case 'stock': return document.querySelector('[data-hud-stock][aria-expanded="true"]') ? null : aimEl(q('[data-hud-stock]'), 'hud:stock');
      case 'none': return null;
      default: { const never: never = tg; return never; }
    }
  }

  /**
   * Branch the line carrying `item` into a building among `to` (D34: lines feed machines): while
   * no routing block stands on that line, a router onto its tile nearest the building still to
   * feed (it replaces the ribbon, D24); then a ribbon on to that building.
   */
  private branch(sim: Sim, item: string, to: readonly string[]): Aim | null {
    const it = itemIdx(item);
    const from = producersOf(sim, it);
    const all = builtOf(sim, to);
    const want = all.find((e) => !receives(sim, e.id, it, from)) ?? all[0];
    if (!want) return null;
    // Once a router stands on the line: a ribbon from it to the building to feed.
    const line = lineOf(sim, from);
    if (line.fork && line.open) return this.build(sim, 'ribbon', centreOf(sim, want.id)!, `entity:${BUILDING_IDS[want.def]}`);
    // Before (or its routers' sides all taken): only where to find the router (its tab, its slot), never a spot on the line —
    // where to split it is the player's call (owner, 2026-10-12: "don't point it at any place").
    return this.build(sim, 'router', null, `line:${item}`);
  }

  /**
   * A building to place: its tab, its slot — and, in hand, where it goes only for the very first
   * drill (the player's first move). After that, where to build is the player's call, and a spot
   * worked out from content may already be taken (owner, 2026-10-12): the hint alone guides.
   */
  private build(sim: Sim, def: string, at: GuideSpot | [number, number, number] | null | undefined, desc?: string): Aim | null {
    const cat = buildingDef(buildingIdx(def)).category;
    const tool = this.host.tool();
    if (tool?.def === def) {
      // …and the quartz vein's foot (D87): far off past the Crown, the face cutter's one place.
      // …and the Crown's windiest spot for a turbine (D95: the guide reads the wind the player cannot see yet).
      // …and the water nearest the Core for the first pump (D114: up on the Crown by the tarn, today).
      const first = (def === 'drill' && !sim.ents.sorted().some((e) => BUILDING_IDS[e.def] === 'drill')) || (!!at && !Array.isArray(at) && ('vein' in at || 'windy' in at || 'water' in at));
      const spot = !first ? null : Array.isArray(at) ? at : at ? spotOf(sim, at) : null;
      return spot ? { k: 'world', x: spot[0], y: spot[1], r: spot[2], desc: desc ?? `spot:${JSON.stringify(at)}` } : null;
    }
    if (this.host.category() === cat) {
      // Its slot — and what the Core lacks to pay for it, if anything (the slot's cost turns coral).
      const slot = q(`.bb-slot[data-def="${def}"]`);
      if (slot) return { k: 'el', el: slot, desc: `slot:${def}`, ...shortOf(sim, costOf(buildingIdx(def))) };
    }
    // The tabs show only while building (D88): « Construire » first.
    if (!this.host.category()) return aimEl(q('.hud-build'), 'hud:build');
    return aimEl(q(`.bb-tab[data-cat="${cat}"]`), `tab:${cat}`);
  }
}

/** Where a segment from inside a box towards (px, py) leaves the box. */
function edgePoint(x: number, y: number, w: number, h: number, px: number, py: number): [number, number] {
  const cx = x + w / 2, cy = y + h / 2;
  const dx = px - cx, dy = py - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const s = Math.min(dx !== 0 ? (w / 2) / Math.abs(dx) : Infinity, dy !== 0 ? (h / 2) / Math.abs(dy) : Infinity);
  return [cx + dx * s, cy + dy * s];
}

/** The point of an ellipse (centre, radii) towards (px, py). */
function ellipsePoint(cx: number, cy: number, rx: number, ry: number, px: number, py: number): [number, number] {
  const a = Math.atan2(py - cy, px - cx);
  return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
}

