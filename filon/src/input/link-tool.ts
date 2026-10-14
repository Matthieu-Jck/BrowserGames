// link-tool.ts — the « Relier » (Link) tool (D25): string and cut power wires by clicking. Pick
// a source — a pillar or the Hearth — by clicking it with the tool active (or with the
// inspector's « Relier » button), then each click on a building toggles a wire between it and
// the source: wired if it was not (when the rule allows: reach, free slots…), cut if it was.
// Clicking the source again lets it go; Shift+click on another pillar starts from that one.
// Esc or a right click unwinds: first the source, then the tool. It works in both views: the
// shell resolves the building under the cursor (volumes in iso, tiles in plan) and hands its
// id here; a left drag still pans. The preview tells the views what to draw: the source's
// reach, the buildings a click would wire, its wires, and what a click on the hovered one does.
import { gap2, isLinkPoint, linkable, linkPoint } from '@/sim/power/links';
import type { LinkReason, Sim } from '@/sim/state';
import { footprint } from '@/sim/entities';
import type { Ent } from '@/sim/types';

/** What a click on a building would do: take it as the source, let the source go, wire, cut, or why not. */
export type LinkVerdict = 'pick' | 'drop' | 'link' | 'unlink' | LinkReason;

/** What a click did (the shell turns refusals into toasts). */
export interface LinkToolResult {
  picked?: number;
  dropped?: boolean;
  linked?: [number, number];
  unlinked?: [number, number];
  refused?: LinkReason;
}

export interface LinkPreview {
  /** The pillar or Hearth the wires start from (0: none chosen yet). */
  readonly source: number;
  /** The source's footprint and wire reach (tiles), for the range ring: [x, y, w, h, reach]. */
  readonly ring: readonly [number, number, number, number, number] | null;
  /** Buildings a click would wire to the source now (in reach, slots free), ascending. */
  readonly targets: readonly number[];
  /** The source's wires (a click on one cuts it). */
  readonly linked: readonly number[];
  /** No source yet: the pillars and the Hearth to start from, ascending. */
  readonly points: readonly number[];
  /** The building under the cursor (0: none) and what a click on it would do. */
  readonly hover: number;
  readonly verdict: LinkVerdict | null;
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
  private cache: { key: string; ring: LinkPreview['ring']; targets: readonly number[]; points: readonly number[] } | null = null;
  private last: LinkPreview | null = null;

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
        return r.ok ? { linked: [this.source, id] } : { refused: r.reason };
      }
      case 'unlink': return sim.unlink(this.source, id) ? { unlinked: [this.source, id] } : {};
      default: return { refused: v };
    }
  }

  /** What the views draw while the tool is in hand (cached: recomputed when wires, buildings, source or hover change). */
  preview(): LinkPreview {
    const sim = this.sim();
    if (this.source && !sim.ents.get(this.source)) this.source = 0;
    const key = `${this.source}:${sim.links.version}:${sim.ents.map.size}:${sim.ents.nextId}:${sim.mods.pylonLink}`;
    if (!this.cache || this.cache.key !== key) this.cache = { key, ...this.scan(sim) };
    const verdict = this.verdict(this.hover);
    const sig = `${key}:${this.hover}:${verdict}`;
    if (this.last?.sig === sig) return this.last;
    this.last = {
      source: this.source, ring: this.cache.ring, targets: this.cache.targets, points: this.cache.points,
      linked: this.source ? sim.links.of(this.source).slice() : EMPTY, hover: this.hover, verdict, sig,
    };
    return this.last;
  }

  /** The ring, the targets in reach of the source, or the link points to start from. */
  private scan(sim: Sim): { ring: LinkPreview['ring']; targets: readonly number[]; points: readonly number[] } {
    const src = this.source ? sim.ents.get(this.source) : undefined;
    if (!src) return { ring: null, targets: EMPTY, points: sim.ents.sorted().filter((e) => isLinkPoint(e.def)).map((e) => e.id) };
    const own = linkPoint(src.def, sim.mods)!;
    // Wires take the longer reach of their two ends: a pylon in sight may be farther than our own reach.
    let far = own.range;
    for (const e of sim.ents.sorted()) if (isLinkPoint(e.def)) far = Math.max(far, linkPoint(e.def, sim.mods)!.range);
    const targets: number[] = [];
    for (const e of sim.ents.sorted()) {
      if (e.id === src.id || !linkable(e.def) || gap2(src, e) > far * far) continue;
      if (sim.canLink(src.id, e.id).ok) targets.push(e.id);
    }
    const [w, h] = footprint(src.def, src.rot);
    return { ring: [src.x, src.y, w, h, own.range], targets, points: EMPTY };
  }
}

/** The footprint rectangle of an entity [x, y, w, h] (tiles), for highlights. */
export function footRect(e: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>): [number, number, number, number] {
  const [w, h] = footprint(e.def, e.rot);
  return [e.x, e.y, w, h];
}
