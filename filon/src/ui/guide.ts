// guide.ts — the tutorial's guide. For the current quest's current step (content/quests.ts):
// an inked arrow and a pulsing ring on what to use next — a build-bar tab, then the building's
// slot, then (building in hand) the spot in the world; the Link tool; the tech tree (its HUD
// chip, then the node's « Débloquer » or a research card and its start button, D33); a line to
// branch with a router, then the ribbon on to the building it must feed; the Crier's ◉, its
// tab, the control in it… — and the step's one-line hint in a small cartouche at the arrow's tail.
// When a full screen covers what comes next out in the world, the arrow points at its ✕.
//
// The step is the first whose `done` objective does not hold yet (read from the sim, counters
// from the founding). `refresh` (4 Hz)
// decides what to point at, following the UI's state; `frame` keeps the arrow on it while the
// camera and the panels move (change-only writes). The layer never takes the pointer, except
// the bubble of a world target: a click glides the camera there. The guide hides while a full
// screen covers its target, while the naming modal is open, and when the player turns it off
// in the quest log (remembered in localStorage).
import { CIRQUE } from '@/content/world';
import { BUILDING_IDS, buildingDef, buildingIdx, itemIdx } from '@/content/registry';
import { BUILDINGS } from '@/content/buildings';
import type { GuideSpot, GuideTarget, QuestDef, QuestStep } from '@/content/quests';
import { RECIPES } from '@/content/recipes';
import type { BuildCategory, Loc, RecipeDef } from '@/content/types';
import { el, setAttr, setStyle, setText } from '@/core/dom';
import type { ScreenId } from '@/core/kinds';
import { makeStore } from '@/core/store';
import { locale, t } from '@/i18n/i18n';
import { CENTER } from '@/sim/constants';
import { footprint } from '@/sim/entities';
import { DX, DY, sideIndex } from '@/sim/types';
import { isLinkPoint } from '@/sim/power/links';
import type { Ent } from '@/sim/types';
import type { Sim } from '@/sim/state';
import { currentQuest, drillItem, objectiveProgress, producersOf, receives, stepApplies } from '@/sim/systems/quests';
import { PARCEL, parcelAt, parcelCentre } from '@/sim/world/land';
import { hintText } from './quest-log';

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

/** The current step, for the quest log's hint line. */
export interface GuideStep { quest: string; index: number; hint: Loc }

/** What the arrow points at: a DOM element, a spot in the world (tile centre, radius in tiles), or nothing. */
type Aim = (
  | { k: 'el'; el: Element; desc: string }
  | { k: 'world'; x: number; y: number; r: number; desc: string }
  | { k: 'none'; desc: string }
) & { text?: string };

const NONE: Aim = { k: 'none', desc: 'none' };
const prefs = makeStore<{ version: 1; on: boolean }>('filon.guide.v1', 1, () => ({ version: 1, on: true }));
const SVG = 'http://www.w3.org/2000/svg';

/** An element if it is in the page and drawn (display: none and detached ones are not). */
function shown(e: Element | null | undefined): Element | null {
  if (!e || !e.isConnected) return null;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? e : null;
}
const q = (sel: string): Element | null => shown(document.querySelector(sel));
const aimEl = (e: Element | null, desc: string): Aim | null => (e ? { k: 'el', el: e, desc } : null);

/** The first step of a quest still to do (counters count from the founding; a step for another land passed by, D87). */
export function stepIndex(sim: Sim, def: QuestDef): number {
  for (let i = 0; i < def.steps.length; i++) {
    const s = def.steps[i]!;
    if (!stepApplies(sim, s) || (s.done && objectiveProgress(sim, s.done).met)) continue;
    return i;
  }
  return def.steps.length - 1;
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
function lineOf(sim: Sim, from: readonly number[]): { tiles: number[]; fork: boolean } {
  const g = sim.graph;
  const out = { tiles: [] as number[], fork: false };
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
      if (d.kind === 'fork') out.fork = true;
      else for (const t of d.tiles ?? []) out.tiles.push(t);
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

/** A place in the world (content `GuideSpot`): tile centre and radius. */
export function spotOf(sim: Sim, at: GuideSpot): [number, number, number] | null {
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
    // The floor at the foot of the quartz vein's face, its middle (D87): where face cutters stand.
    const V = sim.grid.source.quartzVein;
    if (!V) return null;
    const m = (V.n - 1) / 2;
    return [V.x + m * V.dx + 1.5 * DX[V.look]!, V.y + m * V.dy + 1.5 * DY[V.look]!, V.n / 2 + 0.5];
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
  private on = prefs.load().on;
  private readonly svg: SVGSVGElement;
  private readonly arrow: SVGGElement;
  private readonly halo: SVGPathElement;
  private readonly line: SVGPathElement;
  private readonly head: SVGPathElement;
  private readonly ring: HTMLElement;
  private readonly bubble: HTMLElement;
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
    this.bubble = el('div.guide-bubble.cartouche', { onclick: () => this.go() }, [el('span.guide-mark', {}, '☞'), this.text]);
    this.root = el('div.guide', { 'data-screen': 'guide', hidden: true }, [this.svg, this.ring, this.bubble]);
  }

  /** Shown at all (the quest log's toggle)? */
  get enabled(): boolean { return this.on; }
  set enabled(v: boolean) {
    this.on = v;
    prefs.save({ version: 1, on: v });
    this.refresh();
  }

  /** The tree node the current step is after (an `unlock` step's first locked node, a `research` step's): the tree opens on it. */
  focusNode(): string | null {
    const sim = this.host.sim();
    const cur = currentQuest(sim);
    if (!cur || !this.on) return null;
    const tg = cur.def.steps[stepIndex(sim, cur.def)]?.target;
    if (tg?.k === 'unlock') return tg.ids.find((x) => !sim.unlocked(x)) ?? null;
    if (tg?.k === 'research') return tg.id;
    return null;
  }

  /** What the arrow points at, in words (FL.guide / the smoke test). */
  describe(): { quest: string | null; step: number; at: string } {
    return { quest: this.step?.quest ?? null, step: this.step?.index ?? -1, at: this.root.hasAttribute('hidden') ? 'hidden' : this.aim.desc };
  }

  /** 4 Hz: the current step, and what to point at in the UI as it stands. */
  refresh(): void {
    const sim = this.host.sim();
    const cur = currentQuest(sim);
    if (!cur) { this.step = null; this.aim = NONE; this.hide(); return; }
    const i = stepIndex(sim, cur.def);
    const s = cur.def.steps[i]!;
    this.step = { quest: cur.id, index: i, hint: s.hint };
    this.aim = this.resolve(sim, s);
    setText(this.text, this.aim.text ?? hintText(cur.def, s.hint));
    setAttr(this.bubble, 'title', this.aim.k === 'world' ? t('quest.guide.go') : null);
    setAttr(this.bubble, 'data-go', this.aim.k === 'world' ? '' : null);
    this.frame();
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

    // The bubble goes where there is room: above what sits low (the build bar), below what sits
    // high (the HUD), else beside; then it is kept on screen.
    const bw = this.bubble.offsetWidth || 220, bh = this.bubble.offsetHeight || 40;
    const gap = 74;
    let bx: number, by: number;
    if (cy > H * 0.62) { bx = cx - bw / 2; by = cy - rh / 2 - gap - bh; }
    else if (cy < H * 0.3) { bx = cx - bw / 2; by = cy + rh / 2 + gap; }
    else if (cx < W / 2) { bx = cx + rw / 2 + gap; by = cy - bh / 2; }
    else { bx = cx - rw / 2 - gap - bw; by = cy - bh / 2; }
    bx = Math.min(W - bw - 10, Math.max(10, bx));
    by = Math.min(H - bh - 10, Math.max(10, by));
    setStyle(this.bubble, 'left', `${Math.round(bx)}px`);
    setStyle(this.bubble, 'top', `${Math.round(by)}px`);

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
      case 'build': return this.build(sim, tg.def, tg.at);
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
        return { k: 'world', x: c[0], y: c[1], r: c[2], desc: `entity:${BUILDING_IDS[e.def]}` };
      }
      case 'link': {
        const tool = this.host.tool();
        if (tool && /link/i.test(tool.k)) {
          // Wiring: point at the first building the step still wants on the grid (else the Heart).
          const defs = s.done && 'defs' in s.done ? s.done.defs : [];
          const item = s.done && 'item' in s.done && s.done.item !== undefined ? itemIdx(s.done.item) : -1;
          const e = builtOf(sim, defs).find((x) => (item < 0 || drillItem(sim, x.id) === item) && !sim.graph?.netOfEnt.has(x.id));
          // A wire starts from a pillar or the Heart: with no source picked yet, the arrow points at
          // one that reaches the building, then at the building (playtest, 2026-10-15: the arrow on
          // the drill first made the click a refusal, against the hint « clique le Cœur puis… »).
          const from = e && !this.host.linkSource() ? linkFrom(sim, e) : 0;
          // Nothing of the grid reaches it (the hint: « Trop loin ? Pose un poteau entre les deux »):
          // the pole's slot (a new pole wires itself to the nearest pillar, D25), then back here.
          if (from < 0) return this.build(sim, 'mast', null);
          const c = centreOf(sim, from || (e ? e.id : sim.hearthId))!;
          return { k: 'world', x: c[0], y: c[1], r: c[2], desc: from ? `link:from:${BUILDING_IDS[sim.ents.get(from)!.def]}` : e ? `entity:${BUILDING_IDS[e.def]}` : 'hearth' };
        }
        const btn = q('[data-tool="link"]') ?? q('[data-guide="link"]') ?? q('.bb-link');
        if (btn) return aimEl(btn, 'tool:link');
        return (this.host.category() ? aimEl(q('.bb-tab[data-cat="energy"]'), 'tab:energy') : null) ?? aimEl(q('.hud-build'), 'hud:build');
      }
      case 'research': {
        if (this.host.screen() === 'research') {
          const card = q(`.rs-card[data-id="${tg.id}"]`);
          if (card && this.shownNode !== tg.id) { this.shownNode = tg.id; card.scrollIntoView({ block: 'nearest', inline: 'center' }); }
          if (card?.hasAttribute('data-on')) return aimEl(q('.rs-detail .rs-actions .btn.primary'), `research:start:${tg.id}`) ?? aimEl(card, `research:card:${tg.id}`);
          return aimEl(card, `research:card:${tg.id}`);
        }
        return aimEl(q('[data-hud-tree]'), 'hud:tree');
      }
      case 'unlock': {
        // The first node still locked: the HUD chip opens the tree, then the node's own button.
        const id = tg.ids.find((x) => !sim.unlocked(x));
        if (!id) return null;
        if (this.host.screen() !== 'research') return aimEl(q('[data-hud-tree]'), 'hud:tree');
        const node = q(`.tr-node[data-id="${id}"]`);
        if (node && this.shownNode !== id) { this.shownNode = id; node.scrollIntoView({ block: 'nearest', inline: 'center' }); }
        const btn = q(`.tr-node[data-id="${id}"] [data-unlock]:not([disabled])`);
        if (btn) return aimEl(btn, `tree:unlock:${id}`);
        if (node?.hasAttribute('data-on')) return aimEl(q('.rs-detail .rs-actions .btn.primary'), `tree:start:${id}`) ?? aimEl(node, `tree:node:${id}`);
        return aimEl(node, `tree:node:${id}`);
      }
      case 'branch': return this.branch(sim, tg.item, tg.to);
      case 'crier': {
        if (this.host.screen() !== 'market') return aimEl(q('[data-hud-crier]'), 'hud:crier');
        const on = document.querySelector('[data-crier-tab][data-on]')?.getAttribute('data-crier-tab');
        if (on !== tg.tab) return aimEl(q(`[data-crier-tab="${tg.tab}"]`), `crier:tab:${tg.tab}`);
        if (tg.focus === 'order') return aimEl(q('[data-order-item]'), 'crier:order');
        return null;
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
    if (lineOf(sim, from).fork) return this.build(sim, 'ribbon', centreOf(sim, want.id)!, `entity:${BUILDING_IDS[want.def]}`);
    // Before: only where to find the router (its tab, its slot), never a spot on the line —
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
      const first = (def === 'drill' && !sim.ents.sorted().some((e) => BUILDING_IDS[e.def] === 'drill')) || (!!at && !Array.isArray(at) && 'vein' in at);
      const spot = !first ? null : Array.isArray(at) ? at : at ? spotOf(sim, at) : null;
      return spot ? { k: 'world', x: spot[0], y: spot[1], r: spot[2], desc: desc ?? `spot:${JSON.stringify(at)}` } : null;
    }
    if (this.host.category() === cat) {
      const slot = q(`.bb-slot[data-def="${def}"]`);
      if (slot) return aimEl(slot, `slot:${def}`);
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

