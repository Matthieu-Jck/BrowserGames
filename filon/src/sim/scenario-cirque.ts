// scenario-cirque.ts — the cirque worked to the full, from the grown debug base on (owner,
// 2026-10-15: « les bases d'exemple en debug devraient être plus optimales et optimiser
// l'extraction des ressources dans le cirque et prendre la majorité de la place », D82). The
// tutorial levels keep the tutorial's few drills; past it a player covers every deposit of the
// cirque and smelts what the coal allows:
//   - every cirque deposit covered by as many drills as its lines carry (D85: a line takes what a
//     ribbon moves — 60 a minute, 120 once swift — and no more, so no drill stands backed up; a
//     line that leads into machines only, the coal into the kilns, what they burn, D87), each
//     joining a line off it with room, the most first, or a new one: the second iron field's ore
//     sold through the trade post; on map 4 each drill wholly on its ore's blocks (D104);
//   - once the arc furnace is researched, smelters on the iron lines (no coal: the cirque's coal
//     is the tutorial's kilns' already), their plates into the Heart;
//   - a sand field on the free floor feeding arc furnaces, their glass onto the glass line;
//   - the lines that carry more than a plain ribbon's 60 a minute laid again as swift ribbons.
// What a later step of the late base takes up (the tired copper vein's line, D82's `farCopper`)
// leaves its drills to `reattach`: joined to the new line, or taken up — never a line to nowhere.
// Each piece goes through the builder's hands (scenarios.ts `Builder`: real commands, costs
// granted when short, what the map refuses skipped), so the level stays a player's base. Pure
// engine code: no DOM, no clock, integers only.
import { buildingDef, buildingIdx, itemIdx } from '@/content/registry';
import { CIRQUE } from '@/content/world';
import { footprint } from './entities';
import { checkpoint, join, rollback, type BeltTiles } from './dev';
import { MachineNode } from './flow/nodes';
import { oreBlockOf } from './ore-blocks';
import type { FNode } from './flow/node';
import type { Builder } from './scenarios';
import { tileIndex } from './world/grid';

/**
 * Spots the fill's furnaces and their collectors try (`placeFeeding`'s default is 40): an extra the
 * level can do without, on a floor already crowded, so a cheap search (D87: the quartz works and
 * line left a land's fill searching for seconds and finding nothing).
 */
const FILL_TRIES = 20;

/** The most drills a deposit takes (its blob of about 37 tiles: some whole on the ore, some astride its rim). */
const DRILLS_PER_DEPOSIT = 12;
/** Tiles round a deposit's centre a new drill is sought within. */
const DEPOSIT_R = 6;
/** A drill astride a deposit's rim: at least this many of its four tiles on the ore (the second pass). */
const RIM_ORE = 2;
/** Smelters on power for the ore the extra drills bring: arc furnaces (20 plates a minute each), else electric smelters (10, D106). */
const EXTRA_SMELTERS = 2;
/** Sand collectors (15 a minute each) an arc furnace's glass takes (60 a minute); one with fewer than half of them is taken back up. */
const SAND_PER_ARC = 4;
/** Glass smelters in the sand field. */
const GLASS_SMELTERS = 2;
/** What a line carries a minute: a plain ribbon, a swift one; what the trade post's entrance line takes from the drills (its router share and the glass ride it too). */
const PLAIN = 60, SWIFT = 120, POST_SHARE = 60;

/**
 * The deposits covered: at the end of the grown level, while the base is still open — the late
 * base's works laid after route round them, where laid last they found every deposit boxed in by
 * the works' lines.
 */
export function mineCirque(b: Builder): void {
  mineDeposits(b);
}

/** Last, on what the levels leave free: arc furnaces on the iron lines, the sand field, and the busy lines made swift. */
export function fillCirque(b: Builder): void {
  b.optional(() => moreSmelters(b));
  b.optional(() => sandField(b));
  b.optional(() => swiftLines(b));
}

/** What a drill mines a minute: its deposit tiles' caps, up to its own rate. */
function rateOf(b: Builder, id: number): number {
  const sim = b.sim, e = sim.ents.get(id);
  if (!e) return 0;
  const [w, h] = footprint(e.def, e.rot);
  let mu = 0;
  for (let y = e.y; y < e.y + h; y++) for (let x = e.x; x < e.x + w; x++) if (sim.grid.ore(x, y) >= 0) mu += sim.grid.capMuPerEpoch(x, y);
  return Math.min(buildingDef(e.def).drill?.perMin ?? 0, Math.floor(mu / 1000));
}

/**
 * What the machines at the end of these drills' lines burn of `item` a minute (their recipes'
 * inputs at their speed), when those lines lead into machines only; null when one leads on into a
 * store, the Heart or the trade post, which take whatever comes (D87: the coal line into the two
 * kilns takes about 25 a minute, not a ribbon's 60 — a drill more on it stood backed up, D85).
 */
function burnOf(b: Builder, roles: readonly string[], item: number): number | null {
  const sim = b.sim;
  sim.ensureCompiled();
  const g = sim.graph, counted = new Set<FNode>();
  let mu = 0;
  for (const r of roles) {
    const start = b.ids[r] ? g.nodeByEnt.get(b.ids[r]!) : undefined;
    if (!start) return null;
    const seen = new Set<FNode>([start]), todo: FNode[] = [start];
    for (let i = 0; i < todo.length; i++) {
      for (const e of todo[i]!.outE) {
        const d = g.nodes[g.eDst[e]!]!;
        if (seen.has(d)) continue;
        seen.add(d);
        if (d.kind === 'chain' || d.kind === 'fork') { todo.push(d); continue; }
        if (!(d instanceof MachineNode) || !d.recipe) return null;
        if (counted.has(d)) continue;
        counted.add(d);
        const inp = d.recipe.ins.find((x) => x.item === item);
        if (inp) mu += Math.floor((inp.mu * 600 * d.speed) / (d.recipe.ticks * 1000));
      }
    }
  }
  return Math.floor(mu / 1000);
}

/** What a line carries a minute: a swift ribbon's once Swift Ribbons are learnt (the busy lines are laid again so at the end), the trade post's share on its entrance line. */
function capOf(b: Builder, role: string): number {
  if (role === 'post.in') return POST_SHARE;
  return b.sim.unlocked('xp_swift') ? SWIFT : PLAIN;
}

/**
 * Drills whose line a later step took up (the late base's `farCopper` swaps the tired copper
 * vein's line for the far copper's): each one's own ribbons taken up, then joined to the line of
 * `lineRole` — or, where it cannot be, the drill taken up too (refunded): no line ends nowhere.
 */
export function reattach(b: Builder, prefix: string, lineRole: string): void {
  const sim = b.sim, line = b.lines[lineRole];
  const belts = new Set([buildingIdx('ribbon'), buildingIdx('swift_ribbon')]);
  for (const role of Object.keys(b.ids).filter((r) => r.startsWith(prefix)).sort()) {
    const e = sim.ents.get(b.ids[role]!);
    if (!e) { delete b.ids[role]; delete b.lines[role]; continue; }
    for (const [x, y, r] of b.lines[role] ?? []) { const o = sim.entityAt(x, y); if (o && belts.has(o.def) && o.rot === r) sim.remove(x, y); }
    delete b.lines[role];
    const id = e.id;
    if (line && guarded(b, [], () => { const l = join(sim, id, line); if (l) b.lines[role] = l; return l; })) continue;
    sim.remove(e.x, e.y);
    delete b.ids[role];
  }
}

/**
 * A placement step of the fill (`roles`: what it names), taken back up when it leaves a line that
 * ends nowhere: a line laid over another one's ribbon turns it, and two lines then face each other
 * across a junction (the scenario test checks every level for such dead ends).
 */
function guarded(b: Builder, roles: readonly string[], f: () => unknown): boolean {
  const sim = b.sim;
  const dead = (): number => { sim.ensureCompiled(); return sim.graph.chains.filter((c) => !c.outE.length).length; };
  const before = dead(), cp = checkpoint(sim);
  if (!f()) return false;
  if (dead() <= before) return true;
  rollback(sim, cp);
  for (const r of roles) { delete b.ids[r]; delete b.lines[r]; }
  return false;
}

/** Arc furnaces (Mechanics' Arc Furnace, D70) smelt with power alone: the cirque's coal no longer bounds its plates and glass. */
const arc = (b: Builder): boolean => b.sim.unlocked('dn_arc');
/** The best smelter on power the base has learnt: the arc furnace, else the electric smelter (Tier 1, D106), else none. */
const powerSmelter = (b: Builder): string | null => (arc(b) ? 'arc_furnace' : b.sim.unlocked('dn_esmelt') ? 'electric_smelter' : null);

/** The drill roles of the base standing on a deposit (within `DEPOSIT_R` of its centre) whose lines were kept. */
function drillsOn(b: Builder, at: readonly [number, number]): string[] {
  const sim = b.sim, drill = buildingIdx('drill');
  return Object.entries(b.ids).filter(([role, id]) => {
    const e = sim.ents.get(id);
    if (!e || e.def !== drill || !b.lines[role]) return false;
    const dx = e.x + 1 - at[0], dy = e.y + 1 - at[1];
    return dx * dx + dy * dy <= DEPOSIT_R * DEPOSIT_R;
  }).map(([role]) => role).sort();
}

/**
 * Every cirque deposit covered as far as its lines carry: drills joining the line off it with the
 * most room (D85: a line takes no more than it moves, so no drill stands backed up); a deposit with
 * no line or whose lines are full gets one of its own — into the trade post's entrance line (its
 * ore sold), else onto an iron line into the Heart, else into the Heart — while those take more.
 */
function mineDeposits(b: Builder): void {
  const nth = new Map<string, number>();
  let postRoom = POST_SHARE;
  for (const d of CIRQUE.deposits) {
    const k = nth.get(d.item) ?? 0;
    nth.set(d.item, k + 1);
    const at = b.deposit(d.item, k), tag = `${d.item.split('_')[0]}${k ? k + 1 : ''}`;
    // A whole drill's rate on this deposit (its richest tile's cap, four tiles, up to the drill's own rate).
    const tile = b.sim.grid.capMuPerEpoch(at[0], at[1]);
    const whole = Math.min(buildingDef(buildingIdx('drill')).drill!.perMin, Math.floor((4 * tile) / 1000)) || 1;
    const load = new Map<string, number>(), cap = new Map<string, number>();
    for (const r of drillsOn(b, at)) { load.set(r, rateOf(b, b.ids[r]!)); cap.set(r, capOf(b, r)); }
    // Lines into machines only take what the machines burn: what is left of it goes to the first one.
    const burn = load.size ? burnOf(b, [...load.keys()], itemIdx(d.item)) : null;
    if (burn !== null) {
      let spare = Math.max(0, burn - [...load.values()].reduce((x, y) => x + y, 0));
      for (const r of load.keys()) { cap.set(r, Math.min(cap.get(r)!, load.get(r)! + spare)); spare = 0; }
    }
    let fresh = 0;
    /** A line of its own off the deposit: its room is what its end takes. */
    const newLine = (): string | null => {
      const role = `${tag}.a${fresh ? fresh + 1 : ''}`;
      fresh++;
      const intos: Array<[number | string, number]> = [
        ...(b.lines['post.in'] && postRoom >= whole ? [['post.in', postRoom] as [string, number]] : []),
        ...['iron1', 'iron2'].filter((r) => b.lines[r] && d.item === 'iron_ore' && (cap.get(r) ?? capOf(b, r)) - (load.get(r) ?? 0) >= whole).map((r) => [r, (cap.get(r) ?? capOf(b, r)) - (load.get(r) ?? 0)] as [string, number]),
        [b.H, capOf(b, role)],
      ];
      for (const [into, room] of intos) {
        if (!guarded(b, [role], () => b.optional(() => b.source(role, 'drill', at, into, { item: d.item, r: DEPOSIT_R })))) continue;
        b.wireByPole(role);
        const rate = rateOf(b, b.ids[role]!);
        if (into === 'post.in') postRoom -= room;
        else if (typeof into === 'string') load.set(into, (load.get(into) ?? 0) + Math.min(room, capOf(b, role)));
        load.set(role, rate);
        cap.set(role, Math.min(room, capOf(b, role)));
        return role;
      }
      return null;
    };
    if (!load.size && !newLine()) continue;
    // Whole on the ore first, then astride its rim (a drill mines the ore tiles under it) — not on a
    // land of whole blocks (D104): there a deposit has no rim, and a drill half on sand is what it ends.
    const rims = oreBlockOf(b.sim.grid) === 1;
    for (let n = 0, misses = 0, part: number | undefined; n < DRILLS_PER_DEPOSIT && misses < 4; n++) {
      if (misses === 2 && part === undefined && rims) part = RIM_ORE;
      // The lines with room, the most first: a drill boxed in from one may still reach another.
      const intos = [...load.keys()].filter((r) => (cap.get(r) ?? 0) - load.get(r)! >= whole)
        .sort((p, q) => ((cap.get(q) ?? 0) - load.get(q)!) - ((cap.get(p) ?? 0) - load.get(p)!) || (p < q ? -1 : 1));
      if (!intos.length) { if (fresh >= 2) break; const r = newLine(); if (!r) break; intos.push(r); }
      const role = `${tag}.f${n + 1}`;
      const into = intos.find((i) => guarded(b, [role], () => b.optional(() => b.source(role, 'drill', at, i, { item: d.item, orePart: part, r: DEPOSIT_R }))));
      if (!into) { misses++; continue; }
      b.wireByPole(role);
      load.set(into, load.get(into)! + rateOf(b, b.ids[role]!));
    }
  }
}

/**
 * Smelters on power on the iron lines (a router on each), their plates into the Heart: arc
 * furnaces, or electric smelters before them (D106) — once researched only: before it, a kiln more
 * would share the cirque's coal, which the tutorial's two kilns already burn (about two dozen a
 * minute), and stand cold.
 */
function moreSmelters(b: Builder): void {
  const iron = b.laid(...Object.keys(b.lines).filter((r) => /^iron\d?(\.a\d*)?$/.test(r)));
  const def = powerSmelter(b);
  if (!iron.length || !def) return;
  for (let k = 0; k < EXTRA_SMELTERS; k++) {
    const role = `smelter${k + 1}`;
    if (!guarded(b, [role, `plates.s${k + 1}`], () => b.fed(role, def, b.mid(b.deposit('iron_ore'), b.deposit('iron_ore', 1)), [{ lines: iron }], b.H, `plates.s${k + 1}`, false))) continue;
    b.recipe(role, 'arc_plate');
    b.wireByPole(role);
  }
}

/**
 * Arc furnaces on the free floor, each with its own sand collectors (the cirque's sand is
 * everywhere: the floor itself), their glass joining the glass line already running into the
 * Heart (and the trade post): a short line, where one laid across the whole base to the Heart
 * would cost the build seconds. A furnace that gets fewer than half its collectors is taken back
 * up with them: it would stand starved. Before the arc furnace, none: the coal is the kilns'.
 */
function sandField(b: Builder): void {
  const sim = b.sim;
  if (!b.lines['glass'] || !arc(b)) return;
  for (let g = 1; g <= GLASS_SMELTERS; g++) {
    const role = `glassworks${g}`, near = b.middle('glass');
    const sands = Array.from({ length: SAND_PER_ARC }, (_, k) => `${role}.sand${k + 1}`);
    const cp = checkpoint(sim);
    if (!guarded(b, [role], () => b.source(role, 'arc_furnace', near, 'glass', { r: 10, tries: FILL_TRIES }))) break;
    b.recipe(role, 'arc_glass');
    let into: number | string = b.ids[role]!, got = 0;
    for (const sand of sands) {
      if (!guarded(b, [sand], () => b.source(sand, 'sand_collector', b.centre(role), into, { tries: FILL_TRIES }))) continue;
      into = sand;
      got++;
    }
    if (got * 2 < SAND_PER_ARC) {
      rollback(sim, cp);
      for (const r of [role, ...sands]) { delete b.ids[r]; delete b.lines[r]; }
      break;
    }
    b.wireByPole(role, ...sands.filter((r) => b.ids[r]));
  }
}

/**
 * The lines that now carry more than a plain ribbon's 60 a minute (the deposits' collector lines,
 * the trade post's entrance) laid again as swift ribbons (D24: laid over, the routers kept).
 */
function swiftLines(b: Builder): void {
  const sim = b.sim;
  if (!sim.unlocked('xp_swift')) return;
  const ribbon = buildingIdx('ribbon');
  // The deposits' trunk lines and their own lines (`.a`: others join them), the trade post's entrance: a drill's own short line stays plain.
  const roles = Object.keys(b.lines).filter((r) => /^(iron|coal|copper|post\.in)/.test(r) && !r.includes('.f'));
  for (const role of roles) {
    const plain: BeltTiles = (b.lines[role] ?? []).filter(([x, y, r]) => { const e = sim.ents.get(sim.grid.occ[tileIndex(x, y)]!); return e?.def === ribbon && e.rot === r; });
    if (plain.length < 2) continue;
    b.afford([['iron_plate', plain.length], ['gear', plain.length]]);
    sim.placeBelts('swift_ribbon', plain);
  }
}
