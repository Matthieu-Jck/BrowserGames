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
// Blueprints (D154): the copy tool (a box: what stands in it becomes the clipboard, in hand at once
// as a paste), the paste (the blueprint as a ghost on the cursor, R turns it, M mirrors it when it
// can; a click lays the pieces that fit through `place`, paid whole or not at all), and the upgrade
// tool (a box: its ribbons one tier up). Every gesture that lays or takes down is one step of the
// undo stack (Ctrl/⌘+Z, undo.ts).
import { BUILDING_IDS, BUILDING_KIND, buildingDef, buildingIdx, costOf, isDragDef } from '@/content/registry';
import { footprint, forTiles } from '@/sim/entities';
import { oreSnap } from '@/sim/ore-blocks';
import { refundCost } from '@/sim/refund';
import { landReason } from '@/sim/systems/belt-plan';
import { entsInBox, mirrorBlocker, type Blueprint, type Plan } from '@/sim/systems/blueprint';
import type { PlaceCheck, PlaceReason, Sim } from '@/sim/state';
import { isRock, T, type Rot } from '@/sim/types';
import { beltPath } from './belt-path';
import { UndoStack, type UndoResult } from './undo';

/** The bridge end a drag lays in pairs over its obstacles (D73). */
const BRIDGE_ID = BUILDING_IDS[BUILDING_KIND.indexOf('bridge')] ?? '';
/** The camouflaged ribbon a drag buries where the land refuses the dragged one (D109). */
const CAMO_ID = BUILDING_IDS.find((_, i) => !!buildingDef(i).camo) ?? '';

export type ToolState =
  /** `turned`: R pressed since this building was taken in hand: its rotation is the player's, over a ribbon too (D98). */
  | { k: 'build'; def: string; rot: Rot; turned?: boolean }
  | { k: 'belt'; def: string; rot: Rot; from: [number, number] | null; flip: boolean }
  | { k: 'remove'; from: [number, number] | null }
  | { k: 'mark'; from: [number, number] | null; clear: boolean }
  /** The copy tool (D154): a box whose buildings become the clipboard. */
  | { k: 'copy'; from: [number, number] | null }
  /** A blueprint in hand (D154): turned `rot` quarter turns, mirrored left ⇄ right. */
  | { k: 'paste'; bp: Blueprint; rot: Rot; mirror: boolean }
  /** The upgrade tool (D154): a box whose ribbons go one tier up. */
  | { k: 'upgrade'; from: [number, number] | null };

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
  /** A conduit drag off a pipe's side (`split`: the new line draws its water there) or into it (`join`), the pipe kept as it runs (D152). The tip shows it. */
  tee?: 'split' | 'join';
  /**
   * The copy or upgrade tool's box (D154: tiles, inclusive) and what it would take — the buildings
   * a copy captures, the line pieces an upgrade lays over (also in `doomed`, refunded).
   */
  area?: { k: 'copy' | 'upgrade'; box: [number, number, number, number]; ids: number[] };
  /**
   * A paste or an upgrade planned (D154): pieces laid, kept as they stand, skipped; its box (the
   * paste's, x y w h); `short`: the Core cannot pay the whole (nothing would be laid); `gone`:
   * pieces whose building the content no longer knows.
   */
  plan?: { n: number; kept: number; skipped: number; short: boolean; gone: number; box?: [number, number, number, number] };
}

export interface ToolResult {
  placed?: number;
  removed?: number;
  refused?: PlaceReason;
  /** A ribbon drag laid in part: how many of its tiles it left out, and why the first one was (D77: a step wants a traction ribbon). */
  left?: { n: number; reason: PlaceReason };
  marked?: number;
  cleared?: number;
  /** A copy (D154): its pieces (the blueprint is the clipboard, in hand as a paste). */
  copied?: number;
  /** A paste or an upgrade refused whole: what the Core lacks (mu by item). */
  short?: Map<number, number>;
  /** Ribbons an upgrade laid over (D154). */
  upgraded?: number;
  /** A paste or an upgrade laid in part (D154): the pieces set aside, and why the first was. */
  skipped?: { n: number; reason: PlaceReason };
  /** An empty box: the copy took nothing. */
  empty?: boolean;
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
  /** The last copy (D154): Ctrl/⌘+V takes it in hand again. Not saved: the library keeps blueprints. */
  clipboard: Blueprint | null = null;
  /** Ctrl/⌘+Z (D154): each gesture that laid or took down, one step. */
  readonly undo = new UndoStack();
  /** The paste's plan, kept while nothing it reads has changed (cursor, turn, mirror, the base, the tick). */
  private planKey = '';
  private planned: (Plan & { box: [number, number, number, number] }) | null = null;

  constructor(private readonly sim: () => Sim) {}

  get def(): string | null {
    return this.state && (this.state.k === 'build' || this.state.k === 'belt') ? this.state.def : null;
  }

  /** The copy tool (D154): drag a box over what to copy. */
  copy(): void {
    this.state = { k: 'copy', from: null };
  }

  /** A blueprint in hand (D154): the clipboard by default. False when there is none. */
  paste(bp: Blueprint | null = this.clipboard): boolean {
    if (!bp) return false;
    this.state = { k: 'paste', bp, rot: 0, mirror: false };
    return true;
  }

  /** The upgrade tool (D154): drag a box over ribbons to lift them a tier. */
  upgrade(): void {
    this.state = { k: 'upgrade', from: null };
  }

  /**
   * M with a blueprint in hand: mirror it left ⇄ right — when every building in it has a mirror twin
   * (D154). Returns null when done (or nothing in hand), else the building that stops it.
   */
  mirror(): string | null {
    const s = this.state;
    if (s?.k !== 'paste') return null;
    const stop = mirrorBlocker(s.bp);
    if (stop) return stop;
    s.mirror = !s.mirror;
    return null;
  }

  /** Ctrl/⌘+Z: the last step taken back (null: nothing to undo). */
  undoLast(): UndoResult | null {
    return this.undo.undo(this.sim());
  }

  /** The paste in hand planned at the cursor (cached: a plan checks every piece). */
  private pastePlan(sim: Sim, s: Extract<ToolState, { k: 'paste' }>, h: [number, number]): Plan & { box: [number, number, number, number] } {
    const key = `${h[0]},${h[1]},${s.rot},${s.mirror},${sim.tick},${sim.ents.nextId},${sim.ents.map.size}`;
    if (key !== this.planKey || s.bp !== this.plannedBp || !this.planned) {
      const p = sim.planPaste(s.bp, h[0], h[1], s.rot, s.mirror);
      this.planned = { ...p, box: [p.layout.x, p.layout.y, p.layout.w, p.layout.h] };
      this.plannedBp = s.bp;
      this.planKey = key;
    }
    return this.planned;
  }
  private plannedBp: Blueprint | null = null;

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
    if ((s.k === 'belt' || s.k === 'remove' || s.k === 'mark' || s.k === 'copy' || s.k === 'upgrade') && s.from) { s.from = null; return true; }
    this.state = null;
    return true;
  }

  /** Drop a drag or a right box under way, keeping the tool in hand (a second finger came down, D96). */
  dropDrag(): boolean {
    if (this.rbox) { this.rbox = null; return true; }
    const s = this.state;
    if (s && (s.k === 'belt' || s.k === 'remove' || s.k === 'mark' || s.k === 'copy' || s.k === 'upgrade') && s.from) { s.from = null; return true; }
    return false;
  }

  /**
   * R: turn the building (or flip a ribbon drag's corner). A building turns from the way its ghost
   * shows it — over a ribbon a routing block takes the way the items enter (D98), a face cutter
   * faces its wall — and from then on, while it stays in hand, its rotation is the player's.
   */
  rotate(dir: 1 | -1 = 1): void {
    const s = this.state;
    if (!s || s.k === 'remove' || s.k === 'mark' || s.k === 'copy' || s.k === 'upgrade') return;
    if (s.k === 'paste') { s.rot = ((s.rot + dir + 4) & 3) as Rot; return; } // the blueprint turns about its middle (D154)
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
      const sim = this.sim();
      const [ox, oy] = snapOrigin(sim, s.def, s.rot, x, y);
      // What it would replace may come back with Ctrl+Z (D154).
      const was = sim.canPlace(s.def, ox, oy, sim.placementRot(s.def, ox, oy, s.rot, !!s.turned)).replaces;
      const r = this.undo.record(sim, was, () => sim.place(s.def, ox, oy, s.rot, undefined, !!s.turned));
      return r.ok ? { placed: 1 } : { refused: r.reason };
    }
    if (s.k === 'paste') {
      const sim = this.sim();
      const plan = this.pastePlan(sim, s, [x, y]);
      const r = this.undo.record(sim, plan.pieces.flatMap((p) => p.replaces), () => sim.paste(s.bp, x, y, s.rot, s.mirror));
      this.planKey = '';
      if (r.short) return { short: r.short, refused: 'unaffordable' };
      if (!r.placed && !r.set) return r.reason ? { refused: r.reason } : {};
      return r.skipped ? { placed: r.placed, skipped: { n: r.skipped, reason: r.reason ?? 'occupied' } } : { placed: r.placed };
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
      const plan = sim.planBelts(s.def, path);
      const out = plan.filter((st) => !st.skip && !st.ok);
      const placed = this.undo.record(sim, plan.flatMap((st) => st.replaces), () => sim.placeBelts(s.def, path));
      if (placed > 0) return out.length ? { placed, left: { n: out.length, reason: out[0]!.reason } } : { placed };
      // Nothing laid: the first refusal of the plan, if any.
      return out.length ? { refused: out[0]!.reason } : {};
    }
    if (s.k === 'remove' && s.from) {
      const [ax, ay] = s.from;
      s.from = null;
      return { removed: this.removeBox(ax, ay, x, y) };
    }
    if (s.k === 'copy' && s.from) {
      const [ax, ay] = s.from;
      s.from = null;
      const bp = this.sim().capture(ax, ay, x, y);
      if (!bp) return { empty: true };
      this.clipboard = bp;
      this.paste(bp); // in hand at once, as a ghost on the cursor
      return { copied: bp.pieces.length };
    }
    if (s.k === 'upgrade' && s.from) {
      const [ax, ay] = s.from;
      s.from = null;
      const sim = this.sim();
      const plan = sim.planUpgrade(ax, ay, x, y);
      if (!plan.n) return plan.reason ? { refused: plan.reason } : {};
      const r = this.undo.record(sim, plan.pieces.flatMap((p) => p.replaces), () => sim.upgradeArea(ax, ay, x, y));
      if (r.short) return { short: r.short, refused: 'unaffordable' };
      return r.skipped ? { upgraded: r.placed, skipped: { n: r.skipped, reason: r.reason ?? 'occupied' } } : { upgraded: r.placed };
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
    const ids = this.boxIds(ax, ay, bx, by);
    return this.undo.record(sim, ids, () => {
      let n = 0;
      for (const id of ids) {
        const e = sim.ents.get(id);
        if (e && sim.remove(e.x, e.y)) n++;
      }
      return n;
    });
  }

  /** Take one building down as one undo step (the inspector's « Démolir »). */
  removeOne(id: number): boolean {
    const sim = this.sim(), e = sim.ents.get(id);
    return !!e && this.undo.record(sim, [id], () => sim.remove(e.x, e.y));
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
    if (s?.k === 'copy' || s?.k === 'upgrade') {
      const from = s.from ?? h;
      const b: [number, number, number, number] = [Math.min(from[0], h[0]), Math.min(from[1], h[1]), Math.max(from[0], h[0]), Math.max(from[1], h[1])];
      if (s.k === 'copy') { out.area = { k: 'copy', box: b, ids: entsInBox(sim, b[0], b[1], b[2], b[3]) }; return out; }
      const plan = sim.planUpgrade(b[0], b[1], b[2], b[3]);
      out.area = { k: 'upgrade', box: b, ids: plan.pieces.flatMap((p) => p.replaces) };
      this.fromPlan(plan, out);
      return out;
    }
    if (s?.k === 'paste') {
      const plan = this.pastePlan(sim, s, h);
      this.fromPlan(plan, out);
      out.plan!.box = plan.box;
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
        if (st.tee && out.tee !== 'split') out.tee = st.tee; // a tee or a join (D152): the pipe stays as it runs
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

  /**
   * A paste's or an upgrade's plan as the ghost and the tip show it (D154): each piece (one already
   * standing as it should is shown, free), what the pieces replace (refunded, amber), the net cost, and
   * the first refusal — `unaffordable` when the Core cannot pay the whole, for then nothing is laid.
   */
  private fromPlan(plan: Plan, out: Preview): void {
    for (const p of plan.pieces) {
      out.pieces.push({ def: BUILDING_IDS[p.def]!, x: p.x, y: p.y, rot: p.rot, ok: p.ok, reason: p.reason });
      if (p.ok) for (const id of p.replaces) out.doomed.push(id);
    }
    for (const [item, mu] of plan.cost) out.cost.set(item, mu);
    out.reason = plan.short.size ? 'unaffordable' : plan.reason;
    out.plan = { n: plan.n, kept: plan.kept, skipped: plan.skipped, short: plan.short.size > 0, gone: plan.gone };
  }
}

/** Tiles an entity covers (for highlights). */
export function entityTiles(sim: Sim, id: number): Array<[number, number]> {
  const e = sim.ents.get(id);
  const out: Array<[number, number]> = [];
  if (e) forTiles(e, (x, y) => { out.push([x, y]); });
  return out;
}
