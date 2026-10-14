// link-tool.ts — the « Relier » (Link) tool (D25): string and cut power wires by clicking. Pick
// a source — a pillar or the Hearth — by clicking it with the tool active (or with the
// inspector's « Relier » button), then each click on a building toggles a wire between it and
// the source: wired if it was not (when the rule allows: reach, free slots…), cut if it was.
// Clicking the source again lets it go; Shift+click on another pillar starts from that one.
// Esc or a right click unwinds: first the source, then the tool. It works in both views: the
// shell resolves the building under the cursor (volumes in iso, tiles in plan) and hands its
// id here; a left drag still pans. The preview tells the views what to draw: the source's
// reach, the buildings a click would wire, its wires, what a click on the hovered one does, and
// when the land bars that wire (D78), the tile that rises above it.
// The help with the wires (owner, 2026-10-14: "an area around them to show the distance of a
// cable, and to green only the machines that are not already connected"): the green marks only
// what is on no grid yet (a pillar: on another grid than the source's), what else is in reach is
// still wired by a click; the buildings waiting for a wire beyond the reach get a coral dashed
// frame. Before a source is picked, the hovered pillar shows its reach the same way, and so does a
// pillar held to be placed (`ghost`): where to put it to reach what waits.
import { gap2, isLinkPoint, linkable, linkCheck, linkPoint, wireObstacle } from '@/sim/power/links';
import type { LinkReason, Sim } from '@/sim/state';
import { footprint } from '@/sim/entities';
import type { Ent, Rot } from '@/sim/types';

/** What a click on a building would do: take it as the source, let the source go, wire, cut, or why not. */
export type LinkVerdict = 'pick' | 'drop' | 'link' | 'unlink' | LinkReason;

/** What a click did (the shell turns refusals into toasts). */
export interface LinkToolResult {
  picked?: number;
  dropped?: boolean;
  linked?: [number, number];
  unlinked?: [number, number];
  refused?: LinkReason;
  /** Wired to a building that sleeps (`Sim.dormancy`): its wire stays dashed until it wakes. */
  asleep?: 'research' | 'land';
}

export interface LinkPreview {
  /** The pillar or Hearth the wires start from (0: none chosen yet). */
  readonly source: number;
  /**
   * The reach ring: the source's footprint and wire reach (tiles) [x, y, w, h, reach] — before a
   * source is picked, the hovered pillar's; for a pillar in hand, the ghost's.
   */
  readonly ring: readonly [number, number, number, number, number] | null;
  /** In the ring's reach and wired by a click now, and on no grid yet (a pillar: not on the ring's grid), ascending. */
  readonly targets: readonly number[];
  /** With a ring: the buildings waiting for a wire (built, awake, on no grid, not pillars) beyond its reach, ascending. */
  readonly loose: readonly number[];
  /** The source's wires (a click on one cuts it). */
  readonly linked: readonly number[];
  /** No source yet: the pillars and the Hearth to start from, ascending. */
  readonly points: readonly number[];
  /** The building under the cursor (0: none) and what a click on it would do. */
  readonly hover: number;
  readonly verdict: LinkVerdict | null;
  /** The verdict is `blocked`: the first tile (from the source) that rises above the wire, [x, y]; else null. */
  readonly block: readonly [number, number] | null;
  /** Changes whenever anything above does (views redraw on it). */
  readonly sig: string;
}

const EMPTY: readonly number[] = [];

export class LinkTool {
  /** The tool is in hand. */
  active = false;
  /** The pillar or Hearth wires start from (0: none chosen yet). */
  source = 0;
  /** The building under the cursor (set by the shell each frame; 0 = none). */
  hover = 0;
  private cache: { key: string; ring: LinkPreview['ring']; targets: readonly number[]; loose: readonly number[]; points: readonly number[] } | null = null;
  private last: LinkPreview | null = null;
  private ghostLast: LinkPreview | null = null;

  constructor(private readonly sim: () => Sim) {}

  /** Take the tool, optionally from a source (ignored unless it is a pillar or the Hearth). */
  start(source = 0): void {
    this.active = true;
    const e = source ? this.sim().ents.get(source) : undefined;
    this.source = e && isLinkPoint(e.def) ? source : 0;
  }

  /** Put the tool away. */
  stop(): void {
    this.active = false;
    this.source = 0;
    this.hover = 0;
  }

  /** Esc / right click: let the source go first, then the tool. True if something went. */
  cancel(): boolean {
    if (!this.active) return false;
    if (this.source) { this.source = 0; return true; }
    this.stop();
    return true;
  }

  /** What a click on building `id` would do now (null: nothing at all). */
  verdict(id: number, shift = false): LinkVerdict | null {
    if (!id) return null;
    const sim = this.sim();
    const e = sim.ents.get(id);
    if (!e) return null;
    if (this.source && !sim.ents.get(this.source)) this.source = 0; // taken down meanwhile
    if (!this.source) return isLinkPoint(e.def) ? 'pick' : linkable(e.def) ? 'needs_pillar' : null;
    if (id === this.source) return 'drop';
    if (shift && isLinkPoint(e.def)) return 'pick';
    if (sim.links.has(this.source, id)) return 'unlink';
    const c = sim.canLink(this.source, id);
    return c.ok ? 'link' : c.reason;
  }

  /** A left click on building `id` (0: empty ground) — Shift picks another pillar as the source. */
  click(id: number, shift = false): LinkToolResult {
    const v = this.verdict(id, shift);
    const sim = this.sim();
    switch (v) {
      case null: return {};
      case 'pick': this.source = id; return { picked: id };
      case 'drop': this.source = 0; return { dropped: true };
      case 'link': {
        const r = sim.link(this.source, id);
        if (!r.ok) return { refused: r.reason };
        // A sleeping end takes the wire, which carries nothing until it wakes: say why it is dashed.
        const a = sim.ents.get(this.source), b = sim.ents.get(id);
        const asleep = (b && b.builtAt === 0 && sim.dormancy(b)) || (a && a.builtAt === 0 && sim.dormancy(a)) || undefined;
        return asleep ? { linked: [this.source, id], asleep } : { linked: [this.source, id] };
      }
      case 'unlink': return sim.unlink(this.source, id) ? { unlinked: [this.source, id] } : {};
      default: return { refused: v };
    }
  }

  /** What the views draw while the tool is in hand (cached: recomputed when wires, buildings, source or hover change). */
  preview(): LinkPreview {
    const sim = this.sim();
    if (this.source && !sim.ents.get(this.source)) this.source = 0;
    // The ring is the source's; before one is picked, the hovered pillar's.
    const hovered = !this.source && this.hover ? sim.ents.get(this.hover) : undefined;
    const from = this.source || (hovered && isLinkPoint(hovered.def) ? hovered.id : 0);
    const key = `${this.source}:${from}:${sim.links.version}:${sim.ents.map.size}:${sim.ents.nextId}:${sim.mods.pylonLink}:${sim.graph?.version ?? -1}`;
    if (!this.cache || this.cache.key !== key) this.cache = { key, ...this.scan(sim, from) };
    const verdict = this.verdict(this.hover);
    const sig = `${key}:${this.hover}:${verdict}`;
    if (this.last?.sig === sig) return this.last;
    const src = sim.ents.get(this.source), hov = sim.ents.get(this.hover);
    const block = verdict === 'blocked' && src && hov ? wireObstacle(src, hov, (x, y) => sim.grid.level(x, y)) : null;
    this.last = {
      source: this.source, ring: this.cache.ring, targets: this.cache.targets, loose: this.cache.loose, points: this.cache.points,
      linked: this.source ? sim.links.of(this.source).slice() : EMPTY, hover: this.hover, verdict, block, sig,
    };
    return this.last;
  }

  /**
   * A pillar in hand, its ghost at (x, y) turned `rot`: its reach, what it could wire there (on no
   * grid yet, the wire rule as for a built one: reach, height, the land between), and what waits
   * beyond. Null when `def` is not a pillar. Cached on the same inputs as `preview`.
   */
  ghost(def: number, x: number, y: number, rot: Rot): LinkPreview | null {
    if (!isLinkPoint(def)) return null;
    const sim = this.sim();
    const sig = `ghost:${def}:${x}:${y}:${rot}:${sim.links.version}:${sim.ents.map.size}:${sim.ents.nextId}:${sim.mods.pylonLink}:${sim.graph?.version ?? -1}`;
    if (this.ghostLast?.sig === sig) return this.ghostLast;
    const g: Ent = { id: 0, def, x, y, rot, cfg: 0, builtAt: 0 };
    const { ring, targets, loose } = this.reach(sim, g, (e) => linkCheck(g, e, sim.links, sim.mods, (tx, ty) => sim.grid.level(tx, ty)) === 'ok' && !isLinkPoint(e.def));
    this.ghostLast = { source: 0, ring, targets, loose, points: EMPTY, linked: EMPTY, hover: 0, verdict: null, block: null, sig };
    return this.ghostLast;
  }

  /** The ring and targets of pillar `from` (the source, or the hovered pillar before one is picked); without a source, the link points to start from. */
  private scan(sim: Sim, from: number): { ring: LinkPreview['ring']; targets: readonly number[]; loose: readonly number[]; points: readonly number[] } {
    const points = this.source ? EMPTY : sim.ents.sorted().filter((e) => isLinkPoint(e.def)).map((e) => e.id);
    const src = from ? sim.ents.get(from) : undefined;
    if (!src) return { ring: null, targets: EMPTY, loose: EMPTY, points };
    const grid = sim.graph?.netOfEnt.get(src.id);
    // A pillar of another grid is worth a wire (it joins the grids); one of the same grid is not.
    const r = this.reach(sim, src, (e) => sim.canLink(src.id, e.id).ok && (!isLinkPoint(e.def) || grid === undefined || sim.graph?.netOfEnt.get(e.id) !== grid));
    return { ...r, points };
  }

  /**
   * Pillar `src`'s reach ring, the buildings `wire` accepts among those in reach and on no grid
   * (a pillar's grid is `wire`'s to judge), and the ones waiting for a wire beyond.
   */
  private reach(sim: Sim, src: Ent, wire: (e: Ent) => boolean): { ring: LinkPreview['ring']; targets: readonly number[]; loose: readonly number[] } {
    const own = linkPoint(src.def, sim.mods)!;
    // Wires take the longer reach of their two ends: a pylon in sight may be farther than our own reach.
    let far = own.range;
    for (const e of sim.ents.sorted()) if (isLinkPoint(e.def)) far = Math.max(far, linkPoint(e.def, sim.mods)!.range);
    const netOf = sim.graph?.netOfEnt;
    const targets: number[] = [], loose: number[] = [];
    for (const e of sim.ents.sorted()) {
      if (e.id === src.id || !linkable(e.def)) continue;
      // Waiting for a wire: built, awake, on no grid (a pillar always has one once wired: never loose).
      const waits = !isLinkPoint(e.def) && e.builtAt === 0 && !sim.isDormant(e) && netOf?.get(e.id) === undefined;
      const unconnected = isLinkPoint(e.def) || waits;
      if (gap2(src, e) <= far * far && unconnected && wire(e)) targets.push(e.id);
      else if (waits) loose.push(e.id);
    }
    const [w, h] = footprint(src.def, src.rot);
    return { ring: [src.x, src.y, w, h, own.range], targets, loose };
  }
}

/** The footprint rectangle of an entity [x, y, w, h] (tiles), for highlights. */
export function footRect(e: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>): [number, number, number, number] {
  const [w, h] = footprint(e.def, e.rot);
  return [e.x, e.y, w, h];
}
