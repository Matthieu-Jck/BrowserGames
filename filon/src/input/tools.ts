// tools.ts — the build tools, between raw pointer events (in tiles) and sim commands: place a
// building (the cursor sits in the middle of its footprint, R turns it; dropped on a ribbon a
// routing block takes the way the items enter there until R turns it, D98; a drill held over a
// deposit of whole blocks snaps onto their grid, D104), drag a ribbon (an L
// from press to release, R flips the corner), demolish (a click, or a box dragged with the
// tool or with the right button), and the pipette (pick the building under the cursor). A
// placement may go over buildings it replaces (same replace group, wholly inside); a ribbon
// drag is laid only on release, as the sim plans it whole (`planBelts`, D73: kept, laid,
// replaced, auto-junction, a traction ribbon up a step, a bridge pair over an obstacle) — until
// then the ghost is a transparent placeholder of that plan; one laid in part says how many tiles
// it left out and why. The preview tells the ghost what would happen — what it replaces, what it
// costs net — and why not.
import { BUILDING_IDS, BUILDING_KIND, buildingDef, buildingIdx, costOf, isDragDef } from '@/content/registry';
import { footprint, forTiles } from '@/sim/entities';
import { oreSnap } from '@/sim/ore-blocks';
import { refundCost } from '@/sim/refund';
import { landReason } from '@/sim/systems/belt-plan';
import type { PlaceCheck, PlaceReason, Sim } from '@/sim/state';
import { isRock, T, type Rot } from '@/sim/types';
import { beltPath } from './belt-path';

/** The bridge end a drag lays in pairs over its obstacles (D73). */
const BRIDGE_ID = BUILDING_IDS[BUILDING_KIND.indexOf('bridge')] ?? '';
/** The camouflaged ribbon a drag buries where the land refuses the dragged one (D109). */
const CAMO_ID = BUILDING_IDS.find((_, i) => !!buildingDef(i).camo) ?? '';

export type ToolState =
  /** `turned`: R pressed since this building was taken in hand: its rotation is the player's, over a ribbon too (D98). */
  | { k: 'build'; def: string; rot: Rot; turned?: boolean }
  | { k: 'belt'; def: string; rot: Rot; from: [number, number] | null; flip: boolean }
  | { k: 'remove'; from: [number, number] | null }
  | { k: 'mark'; from: [number, number] | null; clear: boolean };

export interface GhostPiece { def: string; x: number; y: number; rot: Rot; ok: boolean; reason: PlaceReason }

export interface Preview {
  pieces: GhostPiece[];
  /** Demolition box (tiles, inclusive) and the entities it would take. */
  box: [number, number, number, number] | null;
  /** Marking box (dig / fill) and how many tiles it would mark or clear. */
  mark: { box: [number, number, number, number]; clear: boolean; n: number } | null;
  /**
   * Entity ids that would go: the demolition box's catch (with `box`), or what the pieces that
   * fit would replace (without `box`; refunded, then built over).
   */
  doomed: number[];
  /** First refusal along the preview, if any. */
  reason: PlaceReason | null;
  /**
   * What the preview costs the Hearth (milli-items by item, only items actually spent): the
   * pieces' cost minus the refund of what they replace — so it compares with the stock.
   */
  cost: Map<number, number>;
  /** A ribbon drag in progress: nothing is laid before the release, the ghost is a placeholder (D73). */
  drag?: boolean;
  /** The drag's bridge pairs, start and end tiles [x0, y0, x1, y1]: what they leap over stays as it is. */
  leaps?: Array<[number, number, number, number]>;
  /**
   * Camouflaged pieces off the claim's land (D109): how many, and the land they are buried in — a
   * neighbouring base's (`neighbour_land`) when any is, else free land (`outside_zone`). The tip says it.
   */
  buried?: { n: number; land: PlaceReason };
}

export interface ToolResult {
  placed?: number;
  removed?: number;
  refused?: PlaceReason;
  /** A ribbon drag laid in part: how many of its tiles it left out, and why the first one was (D77: a step wants a traction ribbon). */
  left?: { n: number; reason: PlaceReason };
  marked?: number;
  cleared?: number;
}

/** Footprint origin that puts the cursor tile in the footprint's middle. */
export function originFor(def: string, rot: Rot, hx: number, hy: number): [number, number] {
  const [w, h] = footprint(buildingIdx(def), rot);
  return [hx - Math.floor((w - 1) / 2), hy - Math.floor((h - 1) / 2)];
}

/** `originFor`, a drill held over a deposit of whole blocks snapped onto their grid (D104: `oreSnap`). */
export function snapOrigin(sim: Sim, def: string, rot: Rot, hx: number, hy: number): [number, number] {
  const [ox, oy] = originFor(def, rot, hx, hy);
  return oreSnap(sim.grid, buildingIdx(def), ox, oy, rot);
}

export class Tools {
  state: ToolState | null = null;
  hover: [number, number] | null = null;
  /** Right-button demolition box (works with any tool in the plan view). */
  private rbox: [number, number] | null = null;
  private lastRot: Rot = 0;

  constructor(private readonly sim: () => Sim) {}

  get def(): string | null {
    return this.state && (this.state.k === 'build' || this.state.k === 'belt') ? this.state.def : null;
  }

  /** The marking brush: drag a box over rock (dig) or water / salt flats (fill). */
  mark(): void {
    this.state = { k: 'mark', from: null, clear: false };
  }

  select(def: string, rot: Rot = this.lastRot): void {
    this.state = isDragDef(def) ? { k: 'belt', def, rot, from: null, flip: false } : { k: 'build', def, rot };
  }

  demolish(): void {
    this.state = { k: 'remove', from: null };
  }

  /** Esc / right click: drop a drag in progress, else the tool. True if something went. */
  cancel(): boolean {
    if (this.rbox) { this.rbox = null; return true; }
    const s = this.state;
    if (!s) return false;
    if ((s.k === 'belt' || s.k === 'remove' || s.k === 'mark') && s.from) { s.from = null; return true; }
    this.state = null;
    return true;
  }

  /** Drop a drag or a right box under way, keeping the tool in hand (a second finger came down, D96). */
  dropDrag(): boolean {
    if (this.rbox) { this.rbox = null; return true; }
    const s = this.state;
    if (s && (s.k === 'belt' || s.k === 'remove' || s.k === 'mark') && s.from) { s.from = null; return true; }
    return false;
  }

  /**
   * R: turn the building (or flip a ribbon drag's corner). A building turns from the way its ghost
   * shows it — over a ribbon a routing block takes the way the items enter (D98), a face cutter
   * faces its wall — and from then on, while it stays in hand, its rotation is the player's.
   */
  rotate(dir: 1 | -1 = 1): void {
    const s = this.state;
    if (!s || s.k === 'remove' || s.k === 'mark') return;
    if (s.k === 'belt' && s.from) { s.flip = !s.flip; return; }
    const h = this.hover;
    const shown = s.k === 'build' && h ? this.sim().placementRot(s.def, ...snapOrigin(this.sim(), s.def, s.rot, h[0], h[1]), s.rot, !!s.turned) : s.rot;
    s.rot = ((shown + dir + 4) & 3) as Rot;
    if (s.k === 'build') s.turned = true;
    this.lastRot = s.rot;
  }

  /** Pipette: take the building under the cursor (same type, same rotation). */
  pipette(x: number, y: number): boolean {
    const e = this.sim().entityAt(x, y);
    if (!e) return false;
    const def = BUILDING_IDS[e.def]!;
    if (def === 'hearth') return false;
    this.select(def, e.rot);
    return true;
  }

  move(x: number, y: number): void {
    this.hover = [x, y];
  }

  /** Left (button 0) or right (2) press on a tile. */
  down(x: number, y: number, button: number): ToolResult {
    this.hover = [x, y];
    const s = this.state;
    if (button === 2) {
      // Right: with the brush, clear marks; drop a placement tool; else a demolition box.
      if (s?.k === 'mark') { s.from = [x, y]; s.clear = true; return {}; }
      if (s && s.k !== 'remove') { this.cancel(); return {}; }
      this.rbox = [x, y];
      return {};
    }
    if (!s) return {};
    if (s.k === 'build') {
      const [ox, oy] = snapOrigin(this.sim(), s.def, s.rot, x, y);
      const r = this.sim().place(s.def, ox, oy, s.rot, undefined, !!s.turned);
      return r.ok ? { placed: 1 } : { refused: r.reason };
    }
    if (s.k === 'mark') { s.from = [x, y]; s.clear = false; return {}; }
    s.from = [x, y];
    return {};
  }

  /** Tiles of an inclusive box. */
  private boxTiles(ax: number, ay: number, bx: number, by: number): number[] {
    const out: number[] = [];
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) out.push(y * 1024 + x);
    return out;
  }

  up(x: number, y: number, button: number): ToolResult {
    this.hover = [x, y];
    const ms = this.state;
    if (ms?.k === 'mark' && ms.from) {
      const [ax, ay] = ms.from;
      const clear = ms.clear;
      ms.from = null;
      ms.clear = false;
      const n = this.sim().designate(this.boxTiles(ax, ay, x, y), !clear);
      return clear ? { cleared: n } : { marked: n };
    }
    if (button === 2 && this.rbox) {
      const [ax, ay] = this.rbox;
      this.rbox = null;
      return { removed: this.removeBox(ax, ay, x, y) };
    }
    const s = this.state;
    if (!s || button !== 0) return {};
    if (s.k === 'belt' && s.from) {
      const path = beltPath(s.from[0], s.from[1], x, y, s.flip, s.rot);
      s.from = null;
      s.flip = false;
      s.rot = path[path.length - 1]![2];
      this.lastRot = s.rot;
      const sim = this.sim();
      // The plan before laying it: the tiles it leaves out (a drag over what is already there leaves none).
      const out = sim.planBelts(s.def, path).filter((st) => !st.skip && !st.ok);
      const placed = sim.placeBelts(s.def, path);
      if (placed > 0) return out.length ? { placed, left: { n: out.length, reason: out[0]!.reason } } : { placed };
      // Nothing laid: the first refusal of the plan, if any.
      return out.length ? { refused: out[0]!.reason } : {};
    }
    if (s.k === 'remove' && s.from) {
      const [ax, ay] = s.from;
      s.from = null;
      return { removed: this.removeBox(ax, ay, x, y) };
    }
    return {};
  }

  private boxIds(ax: number, ay: number, bx: number, by: number): number[] {
    const sim = this.sim();
    const ids = new Set<number>();
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) {
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) {
        const e = sim.entityAt(x, y);
        if (e && e.id !== sim.hearthId) ids.add(e.id);
      }
    }
    return [...ids].sort((a, b) => a - b);
  }

  private removeBox(ax: number, ay: number, bx: number, by: number): number {
    const sim = this.sim();
    let n = 0;
    for (const id of this.boxIds(ax, ay, bx, by)) {
      const e = sim.ents.get(id);
      if (e && sim.remove(e.x, e.y)) n++;
    }
    return n;
  }

  /** What the ghost shows for the current tool and hover. */
  preview(): Preview {
    const out: Preview = { pieces: [], box: null, doomed: [], reason: null, cost: new Map(), mark: null };
    const s = this.state, h = this.hover;
    if (!h) return out;
    const sim = this.sim();
    const box = this.rbox ?? (s?.k === 'remove' ? s.from ?? h : null);
    if (box) {
      out.box = [Math.min(box[0], h[0]), Math.min(box[1], h[1]), Math.max(box[0], h[0]), Math.max(box[1], h[1])];
      out.doomed = this.boxIds(box[0], box[1], h[0], h[1]);
      return out;
    }
    if (s?.k === 'mark') {
      const from = s.from ?? h;
      const b: [number, number, number, number] = [Math.min(from[0], h[0]), Math.min(from[1], h[1]), Math.max(from[0], h[0]), Math.max(from[1], h[1])];
      let n = 0;
      for (const t of this.boxTiles(b[0], b[1], b[2], b[3])) {
        const x = t % 1024, y = (t - x) / 1024;
        const tt = sim.grid.terrain(x, y);
        if (s.clear ? sim.designated.has(t) : !sim.designated.has(t) && (isRock(tt) || tt === T.Shallow || tt === T.Deep || tt === T.Salt)) n++;
      }
      out.mark = { box: b, clear: s.clear, n };
      return out;
    }
    if (!s || s.k === 'remove') return out;
    const add = (def: string, x: number, y: number, rot: Rot, c: PlaceCheck): void => {
      out.pieces.push({ def, x, y, rot, ok: c.ok, reason: c.reason });
      if (!c.ok && !out.reason) out.reason = c.reason;
      // A refusal found early carries no cost: show the building's own price anyway.
      for (const k of c.cost.length ? c.cost : costOf(buildingIdx(def))) out.cost.set(k.item, (out.cost.get(k.item) ?? 0) + k.mu);
      // What it replaces is refunded first: the cost shown is net of it, and the ghost marks it.
      for (const id of c.replaces) {
        const e = sim.ents.get(id);
        if (!e) continue;
        if (c.ok) out.doomed.push(id);
        for (const k of refundCost(sim, e)) out.cost.set(k.item, (out.cost.get(k.item) ?? 0) - k.mu);
      }
    };
    if (s.k === 'build') {
      const [ox, oy] = snapOrigin(sim, s.def, s.rot, h[0], h[1]);
      const rot = sim.placementRot(s.def, ox, oy, s.rot, !!s.turned); // a router over a ribbon takes the way its items enter, unless turned (D98)
      add(s.def, ox, oy, rot, sim.canPlace(s.def, ox, oy, rot));
    } else {
      // Exactly what the release will lay (the sim's plan, D73): kept tiles, ribbons, junctions,
      // traction steps, bridge pairs.
      const from = s.from ?? h;
      out.drag = !!s.from;
      out.leaps = [];
      let start: [number, number] | null = null; // the last bridge start seen, until its leap ends
      for (const st of sim.planBelts(s.def, beltPath(from[0], from[1], h[0], h[1], s.flip, s.rot))) {
        if (st.leapt) continue; // left as it is, under the leap
        if (!st.skip) {
          add(st.def, st.x, st.y, st.rot, st);
          if (st.def === BRIDGE_ID) {
            if (start) { out.leaps.push([start[0], start[1], st.x, st.y]); start = null; } else start = [st.x, st.y];
          }
        // This very ribbon already there: shown, free. A block the line runs through stays as it is.
        } else if (st.def === s.def) out.pieces.push({ def: s.def, x: st.x, y: st.y, rot: st.rot, ok: true, reason: 'ok' });
      }
    }
    // Buried pieces off the claim's land (D109): the tip names the land and their count.
    let n = 0, land: PlaceReason | null = null;
    for (const p of out.pieces) {
      if (p.def !== CAMO_ID) continue;
      const why = landReason(sim, p.x, p.y);
      if (!why) continue;
      n++;
      if (land !== 'neighbour_land') land = why;
    }
    if (n && land) out.buried = { n, land };
    // Only what is actually spent (a downgrade gives more back than it costs).
    for (const [item, mu] of out.cost) if (mu <= 0) out.cost.delete(item);
    return out;
  }
}

/** Tiles an entity covers (for highlights). */
export function entityTiles(sim: Sim, id: number): Array<[number, number]> {
  const e = sim.ents.get(id);
  const out: Array<[number, number]> = [];
  if (e) forTiles(e, (x, y) => { out.push([x, y]); });
  return out;
}
