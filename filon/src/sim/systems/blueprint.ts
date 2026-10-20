// blueprint.ts — blueprints (D154): an area of the base taken as pieces relative to its corner
// (buildings with their rotation and settings, the ribbons and conduits with their ways, bridges,
// traction steps, poles, and the wires between two pieces), turned and mirrored, planned against
// the land piece by piece (`canPlace`: terrain, room, the claim's land, the D124 height rule,
// deposits) and laid through the very commands a player uses — `place`, then `link` for its wires
// and `recipe` / `forkFilter` for a piece already standing — each one logged, so every rule, cost,
// refund and kite (`builtAt` off the claim's land) applies as by hand and a replay needs no
// blueprint. No new rule for placing: a paste is a sequence of placements.
//
// The decisions (D154):
// - **Paid whole or not at all.** The pieces that fit are summed, net of what they replace, against
//   the Core's stock; short of anything, nothing is laid and the tip names the shortfall (the cost
//   chips in coral). A paste that stops half-way leaves half a smelter row nobody asked for.
// - **What does not fit is skipped and shown** (coral in the ghost, counted in the tip and the toast).
// - **A piece already standing there, turned alike, is kept** (shown, free); if its settings differ,
//   the blueprint's are applied to it (its recipe, its filters).
// - **Mirroring** is offered only when every building of the blueprint has a mirror twin: a rotation
//   whose ports fall where the mirror image's would (`mirrorRot`). Ribbons, conduits, bridges and
//   routing blocks always do; a 2 × 2 machine with its exit on one side does not, and such a
//   blueprint does not mirror (the shell says which building stops it).
// - Settings travel by content id (a recipe, a routing block's items), never by index, so a library
//   saved in the base survives a reordered content table; an id since retired drops its piece
//   (`gone`), a renamed one follows `RENAMED`.
//
// Also the upgrade of an area: every ribbon (and conduit, should they get tiers) in a box one tier up,
// to the next one unlocked, through `place` over it (its replace group): paid whole too.
// And the library, kept in the save (`Sim.blueprints`; commands `bpSave`, `bpRename`, `bpDelete`).
import { RENAMED } from '@/content/retired';
import {
  BUILDING_IDS, BUILDING_KIND, CRECIPES, ITEM_IDS, N_ITEMS, RECIPE_IDS, buildingDef, buildingIdx, costOf, hasBuilding, hasItem, hasRecipe, itemIdx, recipeIdx,
} from '@/content/registry';
import { filterOf, recipeOf, withFilter, withRecipe } from '../cfg';
import { footprint, worldPorts } from '../entities';
import { isLinkPoint } from '../power/links';
import { refundCost } from '../refund';
import { inWorld, tileIndex } from '../world/grid';
import type { Rot } from '../types';
import type { Sim } from '../state';
import { turns, type Cost, type PlaceReason } from './build';

/** One piece of a blueprint: its building, footprint origin from the blueprint's corner, rotation, settings. */
export interface BpPiece {
  def: string;
  x: number;
  y: number;
  rot: Rot;
  /** A machine's recipe (content id). */
  recipe?: string;
  /**
   * A routing block's items (content ids, null: anything): a router's or a distributor's per world
   * side (0 N, 1 E, 2 S, 3 W) as captured; a sorter's, an inverted sorter's or a gate's one item (side 0).
   */
  filters?: Array<string | null>;
}

export interface Blueprint {
  /** Its id in the library (0: not saved, the clipboard). */
  id: number;
  /** The player's name for it ('' until saved). */
  name: string;
  /** Its main building (content id): the library's icon (`mainBuilding`). */
  icon: string;
  /** Its size in tiles, as captured (unturned). */
  w: number;
  h: number;
  /** In capture order: by row, then column. */
  pieces: BpPiece[];
  /** Power wires between two of its pieces (indices, the lower first). */
  wires: Array<[number, number]>;
}

/** The kinds that make a line (what a blueprint's icon is not, while it holds anything else). */
const LINE_KINDS: ReadonlySet<string> = new Set(['belt', 'conduit', 'bridge', 'crossing', 'fork', 'fence', 'pole']);
/** Most pieces a blueprint holds: a box over a whole late base stays a blueprint, not a freeze. */
export const MAX_PIECES = 2000;
/** Longest name kept (the library's names are the player's). */
export const NAME_MAX = 40;

const MIR = (d: number): Rot => ((d === 1 ? 3 : d === 3 ? 1 : d) as Rot);

/** A building id as today's content knows it (`RENAMED` followed), or null when it is gone. */
function liveBuilding(id: string): number {
  const now = hasBuilding(id) ? id : RENAMED.buildings[id];
  return now && hasBuilding(now) ? buildingIdx(now) : -1;
}
const liveItem = (id: string | null | undefined): number => {
  if (!id) return -1;
  const now = hasItem(id) ? id : RENAMED.items[id];
  return now && hasItem(now) ? itemIdx(now) : -1;
};
const liveRecipe = (id: string | undefined): number => {
  if (!id) return -1;
  const now = hasRecipe(id) ? id : RENAMED.recipes[id];
  return now && hasRecipe(now) ? recipeIdx(now) : -1;
};

/** Is a routing block's filter per side (router, distributor), rather than one chosen item? */
const sided = (def: number): boolean => {
  const logic = buildingDef(def).logic ?? 'router';
  return logic === 'router' || logic === 'distributor';
};

// ── capture ──────────────────────────────────────────────────────────────────

/** The entities touching an inclusive box (not the Core), ascending ids. */
export function entsInBox(sim: Sim, ax: number, ay: number, bx: number, by: number): number[] {
  const x0 = Math.max(0, Math.min(ax, bx)), y0 = Math.max(0, Math.min(ay, by));
  const x1 = Math.max(ax, bx), y1 = Math.max(ay, by);
  const ids = new Set<number>();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inWorld(x, y)) continue;
      const id = sim.grid.occ[tileIndex(x, y)]!;
      if (id && id !== sim.hearthId) ids.add(id);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

/**
 * What stands in a box (every building touching it, as the demolition box takes them; never the
 * Core), as a blueprint: null when the box holds nothing. Its corner is the top-left of the
 * footprints taken, so a building half in the box comes whole.
 */
export function capture(sim: Sim, ax: number, ay: number, bx: number, by: number): Blueprint | null {
  const ids = entsInBox(sim, ax, ay, bx, by).slice(0, MAX_PIECES);
  if (!ids.length) return null;
  const ents = ids.map((id) => sim.ents.get(id)!);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of ents) {
    const [w, h] = footprint(e.def, e.rot);
    x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y); x1 = Math.max(x1, e.x + w); y1 = Math.max(y1, e.y + h);
  }
  ents.sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id);
  const index = new Map(ents.map((e, i) => [e.id, i]));
  const pieces = ents.map((e): BpPiece => {
    const p: BpPiece = { def: BUILDING_IDS[e.def]!, x: e.x - x0, y: e.y - y0, rot: e.rot };
    const k = BUILDING_KIND[e.def];
    if (k === 'machine') {
      const r = recipeOf(e.cfg);
      if (r > 0) p.recipe = RECIPE_IDS[r - 1];
    } else if (k === 'fork') {
      const n = sided(e.def) ? 4 : 1;
      const f: Array<string | null> = [];
      for (let s = 0; s < n; s++) { const it = filterOf(e.cfg, s); f.push(it >= 0 && it < N_ITEMS ? ITEM_IDS[it]! : null); }
      if (f.some((v) => v !== null)) p.filters = f;
    }
    return p;
  });
  const wires: Array<[number, number]> = [];
  for (const e of ents) {
    const a = index.get(e.id)!;
    for (const o of sim.linksOf(e.id)) {
      const b = index.get(o);
      if (b !== undefined && a < b) wires.push([a, b]);
    }
  }
  wires.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return { id: 0, name: '', icon: mainBuilding(pieces), w: x1 - x0, h: y1 - y0, pieces, wires };
}

/**
 * The building a blueprint is about (its icon and default name): the commonest one that works —
 * not a line piece (ribbon, conduit, bridge, junction, routing block, fence, pole) nor a store —,
 * the dearer on a tie; else the commonest store; a blueprint of lines alone is its commonest piece.
 */
export function mainBuilding(pieces: readonly BpPiece[]): string {
  const count = new Map<string, number>();
  for (const p of pieces) count.set(p.def, (count.get(p.def) ?? 0) + 1);
  const price = (id: string): number => { const d = liveBuilding(id); return d < 0 ? 0 : costOf(d).reduce((s, c) => s + c.mu, 0); };
  const best = (ids: string[]): string => ids.sort((a, b) => count.get(b)! - count.get(a)! || price(b) - price(a) || (a < b ? -1 : a > b ? 1 : 0))[0] ?? '';
  const kind = (id: string): string => { const d = liveBuilding(id); return d < 0 ? 'belt' : BUILDING_KIND[d]!; };
  const ids = [...count.keys()];
  const works = ids.filter((id) => !LINE_KINDS.has(kind(id)) && kind(id) !== 'storage');
  const stores = ids.filter((id) => kind(id) === 'storage');
  return best(works.length ? works : stores.length ? stores : ids);
}

// ── turning and mirroring ────────────────────────────────────────────────────

/** A building's ports at a rotation, relative to its footprint, as a sortable key (water ports are ports: the engine reads no difference, D142). */
function portsKey(def: number, rot: Rot, mirror: boolean): string {
  const [w] = footprint(def, rot);
  return worldPorts({ def, x: 0, y: 0, rot })
    .map((p) => (mirror ? `${w - 1 - p.x},${p.y},${MIR(p.dir)},${p.io}` : `${p.x},${p.y},${p.dir},${p.io}`))
    .sort()
    .join('|');
}

/**
 * The rotation that puts a building where its mirror image (left ⇄ right) would stand, or null when
 * none does: the same footprint, and its ports where the image's are. A line piece or a routing
 * block takes the mirrored way; a building without ports too (its footprint keeps its shape).
 */
export function mirrorRot(def: number, rot: Rot): Rot | null {
  const want = MIR(rot);
  if (!buildingDef(def).ports.length) return want;
  const target = portsKey(def, rot, true);
  const [w, h] = footprint(def, rot);
  for (const r of [want, 0, 1, 2, 3] as Rot[]) {
    const [rw, rh] = footprint(def, r);
    if (rw === w && rh === h && portsKey(def, r, false) === target) return r;
  }
  return null;
}

/** The first building of a blueprint without a mirror twin (content id), or null when it mirrors whole. */
export function mirrorBlocker(bp: Blueprint): string | null {
  for (const p of bp.pieces) {
    const d = liveBuilding(p.def);
    if (d >= 0 && mirrorRot(d, p.rot) === null) return BUILDING_IDS[d]!;
  }
  return null;
}

/** A piece as it would be laid: its blueprint index, building, world origin, rotation and settings. */
export interface LaidPiece {
  i: number;
  def: number;
  x: number;
  y: number;
  rot: Rot;
  cfg: number;
}

/** A blueprint turned (`turn` quarter turns clockwise) after a mirror, its middle on tile (hx, hy). */
export interface Layout {
  pieces: LaidPiece[];
  /** Its box in the world: corner and size. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pieces whose building today's content no longer knows (dropped). */
  gone: number;
}

/** The world side a captured side ends on, after the mirror then the turn. */
const sideAfter = (d: number, turn: Rot, mirror: boolean): number => ((mirror ? MIR(d) : d) + turn) & 3;

/**
 * Where each piece goes: the blueprint mirrored (left ⇄ right, when asked and possible) then turned
 * clockwise, its middle on the cursor's tile as a building's is (`originFor`: the upper-left of the
 * two middles on an even size). A router's or distributor's per-side items turn with it.
 */
export function layout(bp: Blueprint, hx: number, hy: number, turn: Rot, mirror: boolean): Layout {
  const W = turn & 1 ? bp.h : bp.w, H = turn & 1 ? bp.w : bp.h;
  const ox = hx - Math.floor((W - 1) / 2), oy = hy - Math.floor((H - 1) / 2);
  const pieces: LaidPiece[] = [];
  let gone = 0;
  bp.pieces.forEach((p, i) => {
    const def = liveBuilding(p.def);
    if (def < 0) { gone++; return; }
    let [fw, fh] = footprint(def, p.rot);
    let x = p.x, y = p.y, rot = p.rot, w = bp.w, h = bp.h;
    if (mirror) { x = w - x - fw; rot = mirrorRot(def, rot) ?? rot; }
    for (let k = 0; k < turn; k++) {
      const nx = h - y - fh, ny = x;
      x = nx; y = ny;
      [fw, fh] = [fh, fw];
      [w, h] = [h, w];
      rot = ((rot + 1) & 3) as Rot;
    }
    pieces.push({ i, def, x: ox + x, y: oy + y, rot, cfg: cfgOf(def, p, turn, mirror) });
  });
  return { pieces, x: ox, y: oy, w: W, h: H, gone };
}

/** A piece's settings as a `cfg` word, turned with it (validated again by `place`). */
function cfgOf(def: number, p: BpPiece, turn: Rot, mirror: boolean): number {
  const k = BUILDING_KIND[def];
  if (k === 'machine') {
    const r = liveRecipe(p.recipe);
    return r >= 0 ? withRecipe(0, r + 1) : 0;
  }
  if (k !== 'fork' || !p.filters) return 0;
  let cfg = 0;
  if (sided(def)) p.filters.forEach((id, d) => { const it = liveItem(id); if (it >= 0 && d < 4) cfg = withFilter(cfg, sideAfter(d, turn, mirror), it); });
  else { const it = liveItem(p.filters[0]); if (it >= 0) cfg = withFilter(cfg, 0, it); }
  return cfg;
}

// ── planning ─────────────────────────────────────────────────────────────────

/** One piece of a paste or an upgrade as planned. */
export interface PlanPiece extends LaidPiece {
  /** It would be laid (or, `kept`, it already stands). */
  ok: boolean;
  reason: PlaceReason;
  /** This very building already stands here, turned alike: nothing to lay (its settings applied when they differ). */
  kept: number;
  cost: Cost;
  replaces: number[];
}

export interface Plan {
  pieces: PlanPiece[];
  /** What the pieces that fit cost the Core, net of what they replace (mu by item; only what is spent). */
  cost: Map<number, number>;
  /** What the Core lacks of it (mu by item): while any, nothing is laid (D154: paid whole or not at all). */
  short: Map<number, number>;
  /** Pieces to lay, kept as they stand, and skipped (refused). */
  n: number;
  kept: number;
  skipped: number;
  /** The first refusal among the skipped pieces (null: none). */
  reason: PlaceReason | null;
  gone: number;
}

/** The entity standing at a piece's origin when it is the very same building, turned alike (0: none). */
function sameAt(sim: Sim, p: LaidPiece): number {
  if (!inWorld(p.x, p.y)) return 0;
  const e = sim.ents.get(sim.grid.occ[tileIndex(p.x, p.y)]!);
  return e && e.def === p.def && e.x === p.x && e.y === p.y && (e.rot === p.rot || !turns(p.def)) ? e.id : 0;
}

/** Check pieces against the land as it stands and sum what the ones that fit cost (one budget, D154). */
export function planPieces(sim: Sim, laid: readonly LaidPiece[], gone = 0): Plan {
  const plan: Plan = { pieces: [], cost: new Map(), short: new Map(), n: 0, kept: 0, skipped: 0, reason: null, gone };
  for (const p of laid) {
    const kept = sameAt(sim, p);
    if (kept) { plan.pieces.push({ ...p, ok: true, reason: 'ok', kept, cost: [], replaces: [] }); plan.kept++; continue; }
    const id = BUILDING_IDS[p.def]!;
    // A routing block keeps the blueprint's rotation over a ribbon (`turned`, D98): the ghost shows what `place` lays.
    const rot = sim.placementRot(id, p.x, p.y, p.rot, true);
    const c = sim.canPlace(id, p.x, p.y, rot);
    // Too dear on its own is no refusal of the piece: the paste is paid whole or not at all, below.
    const fits = c.ok || c.reason === 'unaffordable';
    plan.pieces.push({ ...p, rot, ok: fits, reason: fits ? 'ok' : c.reason, kept: 0, cost: c.cost, replaces: c.replaces });
    if (!fits) { plan.skipped++; plan.reason ??= c.reason; continue; }
    plan.n++;
    for (const k of c.cost) plan.cost.set(k.item, (plan.cost.get(k.item) ?? 0) + k.mu);
    for (const r of c.replaces) {
      const o = sim.ents.get(r);
      if (o) for (const k of refundCost(sim, o)) plan.cost.set(k.item, (plan.cost.get(k.item) ?? 0) - k.mu);
    }
  }
  for (const [item, mu] of plan.cost) {
    if (mu <= 0) { plan.cost.delete(item); continue; }
    if (sim.stock[item]! < mu) plan.short.set(item, mu - sim.stock[item]!);
  }
  return plan;
}

/** A paste planned: the blueprint laid out at the cursor, each piece checked, the whole costed. */
export function planPaste(sim: Sim, bp: Blueprint, hx: number, hy: number, turn: Rot, mirror: boolean): Plan & { layout: Layout } {
  const lay = layout(bp, hx, hy, turn, mirror && !mirrorBlocker(bp));
  return { ...planPieces(sim, lay.pieces, lay.gone), layout: lay };
}

// ── laying ───────────────────────────────────────────────────────────────────

export interface LayResult {
  /** Pieces laid, settings applied to pieces kept, wires strung. */
  placed: number;
  set: number;
  wired: number;
  /** Pieces skipped: refused by the plan, or by `place` when an earlier piece changed their ground. */
  skipped: number;
  /** The first refusal (the plan's, else the first `place` refused). */
  reason: PlaceReason | null;
  /** The whole refused for want of materials: what the Core lacks (mu by item). */
  short?: Map<number, number>;
  /** Entity ids laid, ascending. */
  ids: number[];
}

/**
 * The order pieces go down in: those that replace something first (their refund comes in before
 * the rest is paid), then the buildings, the poles, and the line pieces last (a ribbon dropped
 * where a routing block will stand is never laid then replaced); blueprint order within each.
 */
function rank(p: PlanPiece): number {
  if (p.replaces.length) return 0;
  const k = BUILDING_KIND[p.def]!;
  return k === 'pole' ? 2 : LINE_KINDS.has(k) ? 3 : 1;
}

/**
 * Lay a plan through the player's commands: nothing when the Core is short (the whole is refused);
 * else each piece that fits by `place` (logged, `turned` so a routing block keeps its rotation over a
 * ribbon), a kept piece's settings by `recipe` / `forkFilter`, then the blueprint's wires by `link`.
 */
export function lay(sim: Sim, plan: Plan, wires: ReadonlyArray<readonly [number, number]> = []): LayResult {
  const out: LayResult = { placed: 0, set: 0, wired: 0, skipped: plan.skipped, reason: plan.reason, ids: [] };
  if (plan.short.size) return { ...out, short: plan.short };
  const at = new Map<number, number>(); // blueprint index → entity id
  for (const p of plan.pieces) {
    if (!p.kept) continue;
    at.set(p.i, p.kept);
    if (configure(sim, p.kept, p.cfg)) out.set++;
  }
  const todo = plan.pieces.filter((p) => p.ok && !p.kept).sort((a, b) => rank(a) - rank(b) || a.i - b.i);
  for (const p of todo) {
    const r = sim.place(BUILDING_IDS[p.def]!, p.x, p.y, p.rot, p.cfg, true);
    if (r.ok && r.id) { at.set(p.i, r.id); out.placed++; out.ids.push(r.id); continue; }
    out.skipped++;
    out.reason ??= r.reason;
  }
  for (const [a, b] of wires) {
    const ea = at.get(a), eb = at.get(b);
    if (!ea || !eb || sim.links.has(ea, eb)) continue;
    const [s, t] = isLinkPoint(sim.ents.get(eb)!.def) && !isLinkPoint(sim.ents.get(ea)!.def) ? [eb, ea] : [ea, eb];
    if (sim.link(s, t).ok) out.wired++;
  }
  out.ids.sort((a, b) => a - b);
  return out;
}

/** A kept piece takes the blueprint's settings (a machine's recipe, a routing block's items) through the player's commands. */
function configure(sim: Sim, id: number, cfg: number): boolean {
  const e = sim.ents.get(id)!;
  if (e.cfg === cfg) return false;
  const k = BUILDING_KIND[e.def];
  if (k === 'machine') {
    const r = recipeOf(cfg);
    if (r === recipeOf(e.cfg)) return false;
    return sim.setRecipe(id, r > 0 ? CRECIPES[r - 1]!.id : null);
  }
  if (k !== 'fork') return false;
  let any = false;
  for (let s = 0; s < (sided(e.def) ? 4 : 1); s++) {
    const want = filterOf(cfg, s);
    if (want === filterOf(e.cfg, s)) continue;
    any = sim.setForkFilter(id, s as Rot, want >= 0 ? ITEM_IDS[want]! : null) || any;
  }
  return any;
}

/** Paste a blueprint at the cursor (`planPaste`, then `lay`). */
export function paste(sim: Sim, bp: Blueprint, hx: number, hy: number, turn: Rot, mirror: boolean): LayResult {
  return lay(sim, planPaste(sim, bp, hx, hy, turn, mirror), bp.wires);
}

// ── upgrading an area ────────────────────────────────────────────────────────

/**
 * Each tiered line piece's tiers, slowest first: the ribbons of one kind that are only faster
 * (not a lift, not buried, not glazed — each of those is a ribbon of its own), by their pace; the
 * conduits likewise (one today: nothing to upgrade). From the content, never a list.
 */
const TIERS: ReadonlyArray<readonly number[]> = (['belt', 'conduit'] as const).map((kind) =>
  BUILDING_IDS.map((_, i) => i)
    .filter((i) => { const b = buildingDef(i); return b.kind === kind && !!b.belt && !b.lift && !b.camo && !b.glazed; })
    .sort((a, b) => buildingDef(a).belt!.perMin - buildingDef(b).belt!.perMin || a - b));

/** The tier a line piece goes up to: the next faster one unlocked (null: none, or not a tiered piece). */
export function nextTier(sim: Sim, def: number): number | null {
  for (const tiers of TIERS) {
    const i = tiers.indexOf(def);
    if (i < 0) continue;
    for (let j = i + 1; j < tiers.length; j++) if (sim.unlocked(buildingDef(tiers[j]!).unlock)) return tiers[j]!;
    return null;
  }
  return null;
}

/** Does an upgrade mean anything yet: is any tier above the slowest unlocked? */
export function upgradeOpen(sim: Sim): boolean {
  return TIERS.some((t) => t.slice(1).some((d) => sim.unlocked(buildingDef(d).unlock)));
}

/** Every tiered line piece touching a box, one tier up (`nextTier`), planned and costed as a paste is. */
export function planUpgrade(sim: Sim, ax: number, ay: number, bx: number, by: number): Plan {
  const laid: LaidPiece[] = [];
  for (const id of entsInBox(sim, ax, ay, bx, by)) {
    const e = sim.ents.get(id)!;
    const to = nextTier(sim, e.def);
    if (to !== null) laid.push({ i: laid.length, def: to, x: e.x, y: e.y, rot: e.rot, cfg: 0 });
  }
  return planPieces(sim, laid);
}

/** Upgrade a box: its ribbons laid over by the next tier, through `place` (each replaced and refunded); paid whole. */
export function upgradeArea(sim: Sim, ax: number, ay: number, bx: number, by: number): LayResult {
  return lay(sim, planUpgrade(sim, ax, ay, bx, by));
}

/** What a blueprint's pieces cost at today's prices, nothing replaced (mu by item; the library's chips). */
export function blueprintCost(bp: Blueprint): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of bp.pieces) {
    const d = liveBuilding(p.def);
    if (d >= 0) for (const c of costOf(d)) out.set(c.item, (out.get(c.item) ?? 0) + c.mu);
  }
  return out;
}

// ── the library (kept in the save) ──────────────────────────────────────────

/** A name as kept: trimmed, at most `NAME_MAX` characters, no line breaks. */
export const cleanName = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

/** A blueprint as read from a save or a command: well formed, or null (dropped). */
export function cleanBlueprint(v: unknown): Blueprint | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Partial<Blueprint>;
  const int = (n: unknown, lo: number, hi: number): n is number => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;
  if (!int(b.w, 1, 4096) || !int(b.h, 1, 4096) || !Array.isArray(b.pieces) || !b.pieces.length || b.pieces.length > MAX_PIECES) return null;
  const pieces: BpPiece[] = [];
  for (const p of b.pieces as unknown[]) {
    const q = p as Partial<BpPiece>;
    if (!q || typeof q.def !== 'string' || !int(q.x, 0, 4095) || !int(q.y, 0, 4095) || !int(q.rot, 0, 3)) return null;
    const out: BpPiece = { def: q.def, x: q.x, y: q.y, rot: q.rot as Rot };
    if (typeof q.recipe === 'string') out.recipe = q.recipe;
    if (Array.isArray(q.filters) && q.filters.length <= 4) out.filters = q.filters.map((f) => (typeof f === 'string' ? f : null));
    pieces.push(out);
  }
  const wires: Array<[number, number]> = [];
  for (const w of Array.isArray(b.wires) ? b.wires : []) {
    if (Array.isArray(w) && int(w[0], 0, pieces.length - 1) && int(w[1], 0, pieces.length - 1) && w[0] !== w[1]) wires.push([Math.min(w[0], w[1]), Math.max(w[0], w[1])]);
  }
  return {
    id: int(b.id, 0, 1e9) ? b.id : 0, name: typeof b.name === 'string' ? cleanName(b.name) : '',
    icon: typeof b.icon === 'string' ? b.icon : mainBuilding(pieces), w: b.w, h: b.h, pieces, wires,
  };
}

/** Save a blueprint to the library under a name: a copy with the next id (returned; 0 when refused). */
export function saveBlueprint(sim: Sim, bp: Blueprint, name: string): number {
  const clean = cleanBlueprint({ ...bp, name: cleanName(name) });
  if (!clean || !clean.name) return 0;
  const id = sim.blueprints.reduce((m, b) => Math.max(m, b.id), 0) + 1;
  sim.blueprints.push({ ...clean, id });
  sim.log.push({ tick: sim.tick, cmd: { k: 'bpSave', bp: { ...clean, id: 0 }, name: clean.name } });
  return id;
}

export function renameBlueprint(sim: Sim, id: number, name: string): boolean {
  const b = sim.blueprints.find((x) => x.id === id), n = cleanName(name);
  if (!b || !n || b.name === n) return false;
  b.name = n;
  sim.log.push({ tick: sim.tick, cmd: { k: 'bpRename', id, name: n } });
  return true;
}

export function deleteBlueprint(sim: Sim, id: number): boolean {
  const i = sim.blueprints.findIndex((x) => x.id === id);
  if (i < 0) return false;
  sim.blueprints.splice(i, 1);
  sim.log.push({ tick: sim.tick, cmd: { k: 'bpDelete', id } });
  return true;
}
