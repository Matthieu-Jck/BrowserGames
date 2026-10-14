// scenario-late.ts — the late debug base's advanced works (scenarios.ts `late`; owner, 2026-10-14:
// "qui est chargé de developper davantage la sauvegarde late game? actuellement elle n'est pas
// tres avancée", D66). Three works, each laid where the land allows and worked out as a player would,
// through commands, then linked by drifters (D61's lesson kept: what is big is drawn once as a
// plan, scenario-plans.ts, and laid whole where it fits):
//   - the potteries on the tarn's peak (map 2, D63): a pump on the tarn's edge, a conduit along
//     the rock top into a ceramic oven, its stone climbing from excavators digging the Crown's
//     inner foot, its ceramic down the terraces on traction ribbons into a skydock on the floor;
//   - the Fabrique on the guaranteed copper field past the Crown (`FABRIQUE`): a deep bore, wire,
//     circuits, gears, speed modules in a tower workshop, Mechanics Data into a second
//     observatory, thermal cores, round a second trade post that buys glass and plates and sells
//     the rest; its power on a pylon line over the Crown;
//   - the Ember Fields mine (when the land has that tier-3 site): a deep bore on embersalt into a
//     skydock, its power on the same pylon line, out to r 180–280.
// Drifters fly the ceramic and the embersalt to the Fabrique's skydock. Besides: a coal pit whose
// coal is flown home when the cirque keeps one coal drill (`coalPit`), a second copper bore whose
// ore is flown to the cirque's wire mill (`copperHome`), a geothermal plant on a vent where the
// land has one (`geothermal`). What the land does not allow is skipped and reported
// (`report.skipped`), never thrown.
import { BAL } from '@/content/balance';
import { BUILDING_KIND, buildingIdx, itemIdx } from '@/content/registry';
import { CENTER } from './constants';
import { checkpoint, hearthNetwork, join, lay, layTo, powerLine, pylonLine, rollback, routeLevel, routeOver, sideGoalsOver, spotsNear, type BeltTiles } from './dev';
import { footprint, worldPorts, type WorldPort } from './entities';
import { gap2 } from './power/links';
import { layPlan, planSpots, type Laid, type PlanSpec } from './scenario-plans';
import type { Builder } from './scenarios';
import type { Sim } from './state';
import { inReach } from './systems/landscape';
import { isWater, opposite, T, type Rot } from './types';
import { inWorld, tileIndex } from './world/grid';
import { parcelAt } from './world/land';
import { MapGen } from './world/mapgen';

/**
 * The Fabrique: the advanced industry on the guaranteed copper field past the Crown (every land
 * has one at r 70–110), round the second trade post (P, the second wharf). Everything flows down
 * the plan; the sell line runs up its left edge into the post's entrance (D64: it sells whatever
 * comes in), and every intermediate product spills onto it through an overflow gate (%) when its
 * consumers are full, so nothing ever backs up into the post's exit: the glass and plates it buys
 * come out in turn (D62), and one item held up would hold the other.
 * - copper ore from the deep bore on the field arrives at `e` (the bore's line, laid after),
 *   along a copper bus (row 3, leftwards) whose routers feed the two wire mills (M, N) below them;
 * - the post's exit (a swift ribbon: glass and plates together pass 60 a minute): an inverted
 *   sorter (I) sends the plates aside, down to the gear workshop (G), the glass on along a glass
 *   bus (row 2) whose routers drop it, across the copper bus on junctions, into the circuit
 *   workshops' other inputs (C, c); each mill hands its wire straight into its workshop below;
 * - circuits and gears down to a router each, dealing them to the etcher (T: speed modules,
 *   three times as fast as an electronics workshop) and to the assembly workshop (K: thermal
 *   cores); a data collector (J, D68) hands its files straight down into the research lab O;
 * - the skydock (D) receives the ceramic flown from the potteries and the embersalt flown from
 *   the Ember Fields: ceramic to K, embersalt to K, the rest down to the sell line.
 * Without an Ember Fields mine (`E` dropped) K and its lines go, junctions turned back to ribbons.
 * Checked on a flat world in all four turns: every port fed, no line ending nowhere.
 */
export const FABRIQUE: PlanSpec = {
  rows: [
    ' PPPPP',
    ' PPPPP .  .. ..',
    '→PPPPP>I>>R+>R+.',
    '↑PPPPP v .+R<+R<<e',
    '↑PPPPP v  vM vN',
    '↑      v  vM vN',
    '↑     GG  CC cc  DDD',
    '↑     GG  CC cc  DDD',
    '↑      v   v  v  DDD',
    '↑<<<<<<%.  v<<<  v v',
    '↑<<<<<<+<<<+<<<<<%.v',
    '↑<<<<<<+<<<%.    v v',
    '↑      v   v     v v',
    '↑     .R.  v     v v',
    '↑     v+<<<R>v   v v',
    '↑     vv   . v . v v',
    '↑     vv    v+<R<+<<',
    '↑     vv    v>vvv<',
    '↑    TTT  JJv KKK',
    '↑    TTT  JJv KKK',
    '↑    TTT   vv KKK',
    '↑     v   OOv  v',
    '↑     v   OOv  v',
    '↑<<<<<<<<<<<<<<<',
  ],
  mask: [
    '', '', '', '', '', '', '', '', '',
    '                 E',
    ' EEEEEE EEE EEEEEEE',
    '                 E',
    '                 E',
    '                 E',
    '            EE   E',
    '             E E E',
    '',
    '             EEEEE',
    '              EEE',
    '              EEE',
    '              EEE',
    '               E',
    '               E',
    '         EEEEEEE',
  ],
  swift: [[6, 2]],
  swaps: { E: [[7, 10, 'v'], [11, 10, 'v'], [13, 16, '<'], [15, 16, '<'], [17, 16, '<']] },
  key: {
    P: { role: 'post2', def: 'trade_post', turn: 3 },
    D: { role: 'dockW', def: 'skydock' },
    M: { role: 'mill2', def: 'wire_mill', recipe: 'copper_wire' },
    N: { role: 'mill3', def: 'wire_mill', recipe: 'copper_wire' },
    C: { role: 'circuits', def: 'workshop', recipe: 'circuit' },
    c: { role: 'circuits2', def: 'workshop', recipe: 'circuit' },
    G: { role: 'gears2', def: 'press', recipe: 'gear' },
    T: { role: 'bells', def: 'etcher', recipe: 'pace_bell' },
    J: { role: 'data2', def: 'data_collector' },
    O: { role: 'observatory2', def: 'observatory' },
    K: { role: 'cores', def: 'great_workshop', recipe: 'thermal_core' },
    I: { role: 'sorter2', def: 'inverted_sorter', filter: 'iron_plate' },
    R: { def: 'router' },
    '%': { def: 'overflow_gate' },
    e: { role: 'works.in', def: 'mark', dir: 3 },
  },
};

/** The Fabrique dock's outlets (the skydock's two out ports, by port index): ceramic, embersalt. */
const DOCK_OUT = { ceramic: 2, embersalt: 3 } as const;

/**
 * What the second post buys a minute: the circuit workshops' glass and the gear workshop's
 * plates, both from foundries a quarter hour away (plus the post's lift: about twenty minutes).
 * The gears take what the glass leaves of the exit's turns.
 */
export const FABRIQUE_BUY: Readonly<Record<string, number>> = { glass: 30, iron_plate: 25 };

// ── small geometry ───────────────────────────────────────────────────────────

/** `k` tiles from `p` toward `q`. */
export function toward(p: readonly [number, number], q: readonly [number, number], k: number): [number, number] {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  let d = 1;
  while ((d + 1) * (d + 1) <= dx * dx + dy * dy) d++;
  return [p[0] + Math.round((dx * k) / d), p[1] + Math.round((dy * k) / d)];
}

/** May the claim build on a tile: its land, or a parcel no sister claim owns (CrierBelt's, to buy)? */
export function buyable(sim: Sim, x: number, y: number): boolean {
  return sim.land.covers(x, y) || sim.land.sister(parcelAt(x, y)) < 0;
}

/** The tile nearest a point within `r` that passes `ok` (revealed), or null. */
export function nearestTile(sim: Sim, at: readonly [number, number], r: number, ok: (x: number, y: number) => boolean): [number, number] | null {
  let best: [number, number, number] | null = null;
  for (let y = at[1] - r; y <= at[1] + r; y++) {
    for (let x = at[0] - r; x <= at[0] + r; x++) {
      if (!inWorld(x, y) || !sim.revealed(x, y) || !ok(x, y)) continue;
      const d = (x - at[0]) * (x - at[0]) + (y - at[1]) * (y - at[1]);
      if (d <= r * r && (!best || d < best[2])) best = [x, y, d];
    }
  }
  return best ? [best[0], best[1]] : null;
}

/** Into a building's free inputs: each one's front tile → the way a line there points into it. */
function inlets(sim: Sim, id: number): Map<number, Rot> {
  const goals = new Map<number, Rot>();
  const e = sim.ents.get(id);
  if (!e) return goals;
  for (const p of worldPorts(e)) {
    if (p.io !== 'in' || !inWorld(p.fx, p.fy) || sim.grid.occ[tileIndex(p.fx, p.fy)] !== 0) continue;
    goals.set(tileIndex(p.fx, p.fy), opposite(p.dir));
  }
  return goals;
}

/** A line `routeOver` found: its tiles, ways and ribbons. */
type OverPath = ReadonlyArray<readonly [number, number, Rot, 'ribbon' | 'traction_ribbon']>;

/** Lay a line found by `routeOver` (its runs of ribbons and of traction ribbons), its cost granted first: whether all of it was laid. */
export function layOver(b: Builder, path: OverPath): boolean {
  const lifts = path.filter((p) => p[3] === 'traction_ribbon').length;
  b.afford([['iron_plate', 3 * 2 * lifts + 6], ['copper_wire', 3 * lifts + 3]]); // ×3 off the claim's land
  for (let i = 0; i < path.length;) {
    let j = i;
    while (j + 1 < path.length && path[j + 1]![3] === path[i]![3]) j++;
    const run: BeltTiles = path.slice(i, j + 1).map(([x, y, r]) => [x, y, r]);
    if (b.sim.placeBelts(path[i]![3], run) !== run.length) return false;
    i = j + 1;
  }
  return true;
}

/** Take a laid line back up (what it laid on free tiles). */
function unlay(sim: Sim, path: ReadonlyArray<readonly [number, number, ...unknown[]]>): void {
  for (const [x, y] of path) { const e = sim.entityAt(x, y); if (e && (e.def === RIBBON() || e.def === TRACTION())) sim.remove(x, y); }
}
const RIBBON = (): number => buildingIdx('ribbon');
const TRACTION = (): number => buildingIdx('traction_ribbon');

/** Rock an excavator at (x, y, rot) reaches (D54: from its footprint's edge) that it can dig without research, but what `keep` spares. */
function rockInReach(sim: Sim, x: number, y: number, rot: Rot, keep: (x: number, y: number) => boolean): number[] {
  const e = { def: buildingIdx('excavator'), x, y, rot } as const;
  const [w, h] = footprint(e.def, rot);
  const out: number[] = [];
  for (let ty = y - BAL.digReach; ty < y + h + BAL.digReach; ty++) {
    for (let tx = x - BAL.digReach; tx < x + w + BAL.digReach; tx++) {
      const t = sim.grid.terrain(tx, ty);
      if ((t === T.Rock1 || t === T.Rock2) && inReach(e, tx, ty) && !keep(tx, ty) && sim.grid.occ[tileIndex(tx, ty)] === 0 && !sim.designated.has(tileIndex(tx, ty))) out.push(tileIndex(tx, ty));
    }
  }
  return out;
}

// ── the potteries on the tarn's peak ─────────────────────────────────────────

/** Excavators digging the Crown's foot for the potteries' stone. */
const POTTERY_DIGGERS = 4; // three where the Crown's foot leaves room, as a rule
/** The least rock an excavator of theirs must reach to be worth placing (tiles). */
const DIG_MIN = 8;

type Tarn = { readonly x: number; readonly y: number; readonly level: number };

/**
 * The potteries (owner, 2026-10-14: "put the lake at the top of the moutain"; the lead: "a
 * mountain-top ceramic works on the peak by the tarn"): the oven on the peak at the tarn's level,
 * on its side toward the Heart; a pump on the tarn's edge and a conduit along the rock top into it
 * (water stays on its level: no lift for a conduit); its stone from excavators on the cirque's
 * floor digging the Crown's lower terraces nearby (never the peak's rock round the tarn), their
 * lines merging and climbing on traction ribbons; its ceramic down the terraces into a skydock
 * on the floor, whence drifters fly it to the Fabrique. Each oven spot tried whole, taken back
 * up when a part cannot be laid. Whether they stand.
 */
export function potteries(b: Builder): boolean {
  const sim = b.sim, tarn = sim.grid.source.tarn;
  if (!tarn) { b.skip('potteries:tarn'); return false; }
  b.affordAll(['ceramic_oven', 1], ['pump', 1], ['conduit', 24], ['skydock', 1], ['excavator', POTTERY_DIGGERS]);
  const inner = toward([tarn.x, tarn.y], b.heart, 5);
  const ovens = spotsNear(sim, 'ceramic_oven', inner, { r: 6, onRock: true, toward: b.heart })
    .filter(([x, y]) => sim.grid.level(x, y) === tarn.level).slice(0, 24);
  for (const [x, y, rot] of ovens) {
    const cp = checkpoint(sim);
    if (pottery(b, x, y, rot, tarn)) return true;
    rollback(sim, cp);
  }
  b.skip('potteries');
  return false;
}

/** A pump on the tarn's edge whose conduit along its level reaches the input `wet`: the shortest. */
function pumpSpot(sim: Sim, tarn: Tarn, wet: WorldPort): { x: number; y: number; rot: Rot; path: BeltTiles } | null {
  const touches = (tx: number, ty: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isWater(sim.grid.terrain(tx + dx, ty + dy)) && sim.grid.level(tx + dx, ty + dy) === tarn.level) return true;
    return false;
  };
  const goal = new Map([[tileIndex(wet.fx, wet.fy), opposite(wet.dir)]]);
  const pump = buildingIdx('pump');
  let best: { x: number; y: number; rot: Rot; path: BeltTiles } | null = null;
  for (let y = tarn.y - 6; y <= tarn.y + 6; y++) {
    for (let x = tarn.x - 6; x <= tarn.x + 6; x++) {
      if (sim.grid.level(x, y) !== tarn.level || !touches(x, y)) continue;
      for (const rot of [0, 1, 2, 3] as const) {
        const c = sim.canPlace('pump', x, y, rot);
        if (!c.ok || c.replaces.length) continue;
        const p = worldPorts({ def: pump, x, y, rot })[0]!;
        if (!inWorld(p.fx, p.fy) || sim.grid.occ[tileIndex(p.fx, p.fy)] !== 0) continue;
        const path = routeLevel(sim, [p.fx, p.fy], goal, 1500);
        if (path && (!best || path.length < best.path.length)) best = { x, y, rot, path };
      }
    }
  }
  return best;
}

function pottery(b: Builder, x: number, y: number, rot: Rot, tarn: Tarn): boolean {
  const sim = b.sim;
  const o = sim.place('ceramic_oven', x, y, rot);
  if (!o.ok) return false;
  const oven = o.id!;
  const ports = worldPorts(sim.ents.get(oven)!);
  const ins = ports.filter((p) => p.io === 'in'), out = ports.find((p) => p.io === 'out')!;
  // Water into the input nearer the tarn, stone into the other.
  const d2 = (p: WorldPort): number => (p.fx - tarn.x) ** 2 + (p.fy - tarn.y) ** 2;
  const [wet, dry] = d2(ins[0]!) <= d2(ins[1]!) ? [ins[0]!, ins[1]!] : [ins[1]!, ins[0]!];
  const ps = pumpSpot(sim, tarn, wet);
  if (!ps) return false;
  const pump = sim.place('pump', ps.x, ps.y, ps.rot);
  if (!pump.ok || sim.placeBelts('conduit', ps.path) !== ps.path.length) return false;
  // The skydock on the floor below the peak, toward the Heart; the ceramic down to it.
  const foot = toward([tarn.x, tarn.y], b.heart, 15);
  let dock = 0;
  let down: OverPath | null = null;
  for (const [dx, dy, dr] of spotsNear(sim, 'skydock', foot, { r: 7, toward: [x, y] }).slice(0, 12)) {
    const d = sim.place('skydock', dx, dy, dr);
    if (!d.ok) continue;
    down = routeOver(sim, [out.fx, out.fy], inlets(sim, d.id!), 20_000);
    if (down && layOver(b, down)) { dock = d.id!; break; }
    if (down) unlay(sim, down);
    sim.remove(dx, dy);
  }
  if (!dock || !down) return false;
  // Stone: excavators on the floor against the Crown's foot near the peak (never digging rock of
  // the tarn's level: the peak round it), the first one's line climbing into the oven, the others'
  // into the side of a line already laid.
  const at = toward([tarn.x, tarn.y], b.heart, 11);
  let stone: BeltTiles | null = null;
  const stones: BeltTiles[] = [];
  const diggers: number[] = [];
  const claimed = new Set<number>();
  const keep = (tx: number, ty: number): boolean => sim.grid.level(tx, ty) >= tarn.level || claimed.has(tileIndex(tx, ty));
  // Inside the cirque below the peak, and outside the Crown beyond it (their lines climb over).
  const beyond = toward([tarn.x, tarn.y], b.heart, -10);
  const cands = [...spotsNear(sim, 'excavator', at, { r: 14, toward: [x, y] }), ...spotsNear(sim, 'excavator', beyond, { r: 10, toward: [x, y] })]
    .map((s, k) => [s, rockInReach(sim, s[0], s[1], s[2], keep).length, k] as const)
    .filter(([, n]) => n >= DIG_MIN).sort((p, q) => q[1] - p[1] || p[2] - q[2]).slice(0, 60);
  for (const [[ex, ey, er]] of cands) {
    if (diggers.length >= POTTERY_DIGGERS) break;
    if (rockInReach(sim, ex, ey, er, keep).length < DIG_MIN) continue; // its rock is a neighbour's already
    const r = sim.place('excavator', ex, ey, er);
    if (!r.ok) continue;
    const sp = worldPorts(sim.ents.get(r.id!)!).find((p) => p.io === 'out')!;
    // The first one's line into the oven; the next ones into the side of a line laid (on the floor
    // or up the terraces).
    let line: BeltTiles | null = null;
    const goals: Map<number, Rot> = stone ? sideGoalsOver(sim, stones.flat()) : new Map([[tileIndex(dry.fx, dry.fy), opposite(dry.dir)]]);
    const up: OverPath | null = goals.size ? routeOver(sim, [sp.fx, sp.fy], goals, 20_000) : null;
    if (up && layOver(b, up)) line = up.map(([lx, ly, lr]) => [lx, ly, lr]);
    else if (up) unlay(sim, up);
    if (!line) { sim.remove(ex, ey); continue; }
    if (!stone) stone = line;
    stones.push(line);
    // Its rock claimed now, so the next excavator's reach counts only what is left. Nothing is
    // marked: with no mark in reach an excavator quarries, its rock left standing (owner,
    // 2026-10-14: the stone must not run out), so the Crown's foot keeps its shape.
    for (const t of rockInReach(sim, ex, ey, er, keep)) claimed.add(t);
    diggers.push(r.id!);
    b.ids[`digger${diggers.length}`] = r.id!;
    b.lines[`stone${diggers.length}`] = line;
  }
  if (!diggers.length) return false;
  b.ids.oven = oven;
  b.ids.pump = pump.id!;
  b.ids.dockT = dock;
  b.lines.ceramic = down.map(([lx, ly, lr]) => [lx, ly, lr]);
  b.recipe('oven', 'ceramic');
  b.wire('oven', 'pump', 'dockT', ...diggers.map((_, k) => `digger${k + 1}`));
  return true;
}

// ── the Fabrique on the copper field ─────────────────────────────────────────

/** The guaranteed copper field's centre (MapGen's own; else the revealed copper nearest r 90). */
function copperField(sim: Sim): [number, number] | null {
  if (sim.grid.source instanceof MapGen) return [sim.grid.source.copperField.cx, sim.grid.source.copperField.cy];
  return nearestTile(sim, [CENTER, CENTER - 90], 60, (x, y) => sim.grid.ore(x, y) === itemIdx('copper_ore'));
}

/**
 * Survey beacons out to a far point (each lifts the fog 40 tiles round it, D48's scouting): from the
 * Heart along the way there, one where the fog begins, until the point lies in the clear — the
 * pylons that carry the power out stand only on revealed land.
 */
function surveyTo(b: Builder, at: readonly [number, number]): void {
  const sim = b.sim;
  let len = 0;
  const dx0 = at[0] - CENTER, dy0 = at[1] - CENTER;
  while ((len + 1) * (len + 1) <= dx0 * dx0 + dy0 * dy0) len++;
  for (let k = 0; k < 12 && !sim.revealed(at[0], at[1]); k++) {
    // The farthest revealed tile along the way, a couple of tiles back from the fog's edge.
    let d = 0;
    while (d < len) { const [x, y] = toward(b.heart, at, d + 1); if (!sim.revealed(x, y)) break; d++; }
    const p = toward(b.heart, at, Math.max(0, d - 2));
    b.affordDef('beacon');
    let placed = false;
    for (let r = 0; r <= 6 && !placed; r++) {
      for (let dy = -r; dy <= r && !placed; dy++) {
        for (let dx = -r; dx <= r && !placed; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const c = sim.canPlace('beacon', p[0] + dx, p[1] + dy, 0);
          if (c.ok && !c.replaces.length) placed = sim.place('beacon', p[0] + dx, p[1] + dy, 0).ok;
        }
      }
    }
    if (!placed) { b.skip('survey'); return; }
  }
}

/** Buy the parcels round a point (the fog lifts with them) and set a survey beacon there; the way there surveyed first. */
function claimAround(b: Builder, at: readonly [number, number], r: number, role: string): void {
  surveyTo(b, at);
  b.landAround(at, r);
  b.affordDef('beacon');
  for (const [x, y, rot] of spotsNear(b.sim, 'beacon', at, { r: 9 }).slice(0, 20)) {
    const e = b.sim.place('beacon', x, y, rot);
    if (e.ok) { b.ids[role] = e.id!; return; }
  }
}

/** Take a laid plan back up (its ribbons, blocks and buildings). */
function unlayPlan(sim: Sim, l: Laid): void {
  for (const [x, y] of l.tiles) if (sim.entityAt(x, y)) sim.remove(x, y);
}

/**
 * The Fabrique (`FABRIQUE`): the copper field's parcels bought, a deep bore on its copper, the
 * plan laid where it fits nearest the bore (its land bought; a sister claim's left alone), the
 * bore's line into the plan's copper entry, the post's standing orders, speed modules in the
 * circuit workshops; power by a pylon line from the base's grid, then masts. `ember`: the Ember
 * Fields mine is coming, so the thermal cores' part is laid too. Whether it stands.
 */
export function fabrique(b: Builder, ember: boolean): boolean {
  const sim = b.sim;
  const field = copperField(sim);
  if (!field) { b.skip('fabrique:copper'); return false; }
  claimAround(b, field, 10, 'beaconCu');
  const bore = b.put('boreCu', 'deep_bore', field, { item: 'copper_ore', r: 6, toward: b.heart });
  if (!bore) return false;
  const drop = new Set(ember ? [] : ['E']);
  // Where the plan fits round a point between the bore and the Heart, its copper entry nearest the
  // bore first: a short line, not one round the plan's sell line.
  const [bx, by] = b.centre('boreCu');
  const entryOf = (cells: ReadonlyArray<readonly [number, number, string]>): readonly [number, number] => { const c = cells.find(([, , ch]) => ch === 'e'); return c ? [c[0], c[1]] : [0, 0]; };
  const spots = planSpots(sim, FABRIQUE, toward([bx, by], b.heart, 16), 22, (x, y) => buyable(sim, x, y), drop, 12)
    .map(([plan, ax, ay], k) => { const [i, j] = entryOf(plan.cells); return [plan, ax, ay, (ax + i - bx) ** 2 + (ay + j - by) ** 2, k] as const; })
    .sort((p, q) => p[3] - q[3] || p[4] - q[4]);
  let laid: Laid | null = null;
  for (const [plan, ax, ay] of spots) {
    if (!b.landFor(plan.cells.map(([i, j]) => [ax + i, ay + j] as const))) continue;
    const l = layPlan(sim, plan, ax, ay, (def, n) => b.affordDef(def, n));
    if (!l) continue;
    const entry = l.marks['works.in']!;
    b.crossings();
    if (layTo(sim, bore, new Map([[tileIndex(entry[0], entry[1]), entry[2]]]), -1, 40_000)) { laid = l; break; }
    unlayPlan(sim, l);
  }
  if (!laid) { b.skip('fabrique:plan'); const e = sim.ents.get(bore)!; sim.remove(e.x, e.y); delete b.ids.boreCu; return false; }
  Object.assign(b.ids, laid.ids);
  b.lines['works.return'] = laid.ret;
  // The post's trade: glass and plates bought, out of its one exit in turn (D62); its entrance
  // sells what the sell line brings (D64).
  const post = laid.ids.post2!;
  const ask = (it: string): number => Math.floor((sim.prices.ask[itemIdx(it)]! * 3) / 2);
  for (const [item, n] of Object.entries(FABRIQUE_BUY)) if (typeof sim.addImport(post, item, n, ask(item)) !== 'number') b.skip(`import:${item}`);
  // The skydock's outlets: the ceramic down to J and K, the embersalt to K.
  sim.ensureCompiled();
  if (!sim.setPortItem(laid.ids.dockW!, DOCK_OUT.ceramic, 'ceramic')) b.skip('dockW:ceramic');
  if (ember && !sim.setPortItem(laid.ids.dockW!, DOCK_OUT.embersalt, 'embersalt')) b.skip('dockW:embersalt');
  // Power: a pylon line over the Crown to the post, then masts to the rest.
  wireFar(b, 'post2');
  b.wire('boreCu', 'dockW', 'mill2', 'mill3', 'circuits', 'circuits2', 'gears2', 'bells', 'data2', 'observatory2', 'cores');
  // Speed modules (Pace, Pace II) in the circuit workshops: the wire mills outrun them.
  for (const r of ['circuits', 'circuits2']) {
    b.afford([['pace_bell', 1]]);
    if (b.ids[r] && !sim.setModule(b.ids[r]!, true)) b.skip(`module:${r}`);
  }
  return true;
}

/**
 * Copper flown home: a second bore (or drill) on the copper field, its ore into the Fabrique's skydock,
 * drifters flying it to the potteries' skydock in the cirque, whose outlet joins the line into the
 * cirque's wire mill (the tutorial's tired vein gives it 2.5 ore a minute). Whether it stands.
 */
export function copperHome(b: Builder): boolean {
  const sim = b.sim, dockW = b.ids.dockW, dockT = b.ids.dockT, line = b.lines['copper'];
  const field = copperField(sim);
  if (!dockW || !dockT || !b.ids.mill || !line || !field) return false;
  // A deep bore where the field still has room for one, else a drill (20 ore a minute: what the mill takes).
  const bore = b.optional(() => b.put('boreCu2', 'deep_bore', field, { item: 'copper_ore', r: 7, toward: b.centre('dockW') }))
    || b.put('boreCu2', 'drill', field, { item: 'copper_ore', r: 8, toward: b.centre('dockW') });
  if (!bore) return false;
  b.crossings();
  const feed = layTo(sim, bore, inlets(sim, dockW), -1, 40_000);
  if (!feed) { b.skip('line:boreCu2'); const e = sim.ents.get(bore)!; sim.remove(e.x, e.y); delete b.ids.boreCu2; return false; }
  b.lines['boreCu2'] = feed;
  const path = join(sim, dockT, line);
  const port = path ? worldPorts(sim.ents.get(dockT)!).find((p) => p.io === 'out' && p.fx === path[0]![0] && p.fy === path[0]![1]) : undefined;
  if (!path || !port) { b.skip('line:copperHome'); if (path) unlay(sim, path); return false; }
  sim.ensureCompiled();
  sim.setPortItem(dockT, port.idx, 'copper_ore');
  b.lines['copperHome'] = path;
  b.wire('boreCu2');
  flyRoute(b, 'dockW', 'dockT', 'copper_ore', 1);
  return true;
}

// ── the Ember Fields mine ────────────────────────────────────────────────────

/** The Ember Fields site (MapGen's), if the land has one: its centre. */
export function emberSite(sim: Sim): [number, number] | null {
  if (!(sim.grid.source instanceof MapGen)) return null;
  const s = sim.grid.source.sites.find((q) => q.id === 'emberfields');
  return s ? [s.cx, s.cy] : null;
}

/**
 * The Ember Fields mine (tier 3: embersalt for the thermal cores, Atlas Lore, tr6): the site's
 * parcels bought (the fog lifts with them; a beacon besides), a deep bore on the embersalt and a
 * skydock its line runs into, both on the base's grid by a pylon line from the nearest pillar
 * (the Fabrique's). Whether it stands.
 */
export function emberMine(b: Builder): boolean {
  const sim = b.sim, at = emberSite(sim);
  if (!at) return false;
  claimAround(b, at, 9, 'beaconE');
  const bore = b.put('boreE', 'deep_bore', at, { item: 'embersalt', r: 5, toward: b.heart });
  if (!bore) return false;
  b.affordDef('skydock');
  let dock = 0;
  for (const [x, y, rot] of spotsNear(sim, 'skydock', toward(b.centre('boreE'), b.heart, 6), { r: 6, toward: b.centre('boreE') }).slice(0, 16)) {
    const d = sim.place('skydock', x, y, rot);
    if (!d.ok) continue;
    const line = lay(sim, bore, d.id!);
    if (line) { dock = d.id!; b.lines.ember = line; break; }
    sim.remove(x, y);
  }
  if (!dock) { b.skip('dockE'); const e = sim.ents.get(bore)!; sim.remove(e.x, e.y); delete b.ids.boreE; return false; }
  b.ids.dockE = dock;
  wireFar(b, 'boreE');
  b.wire('dockE');
  return true;
}

// ── the coal pit: coal flown home ────────────────────────────────────────────

/** Coal drills and bores on the cirque's own coal (inside the Crown's foot). */
function cirqueCoalDrills(sim: Sim, crownOuter: number): number {
  const coal = itemIdx('coal');
  let n = 0;
  for (const e of sim.ents.map.values()) {
    if (BUILDING_KIND[e.def] !== 'drill' || (e.x - CENTER) ** 2 + (e.y - CENTER) ** 2 > crownOuter * crownOuter) continue;
    if (sim.grid.ore(e.x, e.y) === coal || sim.grid.ore(e.x + 1, e.y + 1) === coal) n++;
  }
  return n;
}

/** The coal nearest the Heart past the Crown that a deep bore covers whole (level floor, land the claim may buy), within `R`. */
function coalDeposit(sim: Sim, from: number, R: number): [number, number] | null {
  const coal = itemIdx('coal');
  let best: [number, number, number] | null = null;
  for (let y = CENTER - R; y <= CENTER + R; y++) {
    for (let x = CENTER - R; x <= CENTER + R; x++) {
      const d = (x - CENTER) * (x - CENTER) + (y - CENTER) * (y - CENTER);
      if (d < from * from || d > R * R || (best && d >= best[2]) || sim.grid.ore(x, y) !== coal) continue;
      let all = true;
      for (let j = 0; j < 3 && all; j++) for (let i = 0; i < 3 && all; i++) all = sim.grid.ore(x + i, y + j) === coal && sim.grid.level(x + i, y + j) === 0 && buyable(sim, x + i, y + j);
      if (all) best = [x + 1, y + 1, d];
    }
  }
  return best ? [best[0], best[1]] : null;
}

/** How far out the coal pit may be (tiles). */
const COAL_PIT_R = 130;

/**
 * The coal pit, for a cirque short of coal (one drill on its deposit: the tutorial's lines cut the
 * rest of it up): a deep bore on the nearest coal past the Crown into a skydock, and a skydock in
 * the cirque by the smelters' coal line, its outlet joining that line ahead of both smelters;
 * drifters between. Whether it stands.
 */
export function coalPit(b: Builder, crownOuter: number): boolean {
  const sim = b.sim;
  const line = b.lines['coal'];
  if (!line || cirqueCoalDrills(sim, crownOuter) >= 2) return false;
  const at = coalDeposit(sim, crownOuter + 4, COAL_PIT_R);
  if (!at) { b.skip('coalPit'); return false; }
  claimAround(b, at, 8, 'beaconC');
  const bore = b.put('boreC', 'deep_bore', at, { item: 'coal', r: 4, toward: b.heart });
  if (!bore) return false;
  b.affordDef('skydock', 2);
  let pit = 0;
  for (const [x, y, rot] of spotsNear(sim, 'skydock', toward(b.centre('boreC'), b.heart, 6), { r: 6, toward: b.centre('boreC') }).slice(0, 16)) {
    const d = sim.place('skydock', x, y, rot);
    if (!d.ok) continue;
    if (lay(sim, bore, d.id!)) { pit = d.id!; break; }
    sim.remove(x, y);
  }
  if (!pit) { b.skip('dockM'); const e = sim.ents.get(bore)!; sim.remove(e.x, e.y); delete b.ids.boreC; return false; }
  b.ids.dockM = pit;
  // The cirque's dock: its outlet into the side of the coal line, ahead of both smelters (before
  // the first routing block set on it: the glass smelter's branch).
  const k = line.findIndex(([x, y]) => { const e = sim.entityAt(x, y); return !!e && BUILDING_KIND[e.def] === 'fork'; });
  const upstream = k >= 1 ? line.slice(0, k + 1) : line;
  let home = 0;
  b.crossings();
  for (const [x, y, rot] of spotsNear(sim, 'skydock', b.middle('coal'), { r: 14 }).slice(0, 30)) {
    const d = sim.place('skydock', x, y, rot);
    if (!d.ok) continue;
    const path = join(sim, d.id!, upstream);
    const port = path ? worldPorts(sim.ents.get(d.id!)!).find((p) => p.io === 'out' && p.fx === path[0]![0] && p.fy === path[0]![1]) : undefined;
    if (path && port) { sim.ensureCompiled(); sim.setPortItem(d.id!, port.idx, 'coal'); home = d.id!; b.lines['coalHome'] = path; break; }
    if (path) unlay(sim, path);
    sim.remove(x, y);
  }
  if (!home) { b.skip('dockC'); return false; }
  b.ids.dockC = home;
  wireFar(b, 'boreC');
  b.wire('dockM', 'dockC');
  flyRoute(b, 'dockM', 'dockC', 'coal', 1);
  return true;
}

// ── geothermal power ─────────────────────────────────────────────────────────

/** How far out the late base taps a vent (tiles). */
const VENT_R = 160;

/**
 * A geothermal plant on the nearest vent (Geothermal Power, en5; Deep Heat, en8: 1.5 MW × 1.5,
 * day and night), where the land has one within `VENT_R` (an Ember Fields land, or one beside it):
 * its parcel bought, the plant on the grid by a pylon line. Whether it stands.
 */
export function geothermal(b: Builder): boolean {
  const sim = b.sim;
  if (!(sim.grid.source instanceof MapGen)) return false;
  const vents = sim.grid.source.ventSites.map((v) => [v.x, v.y, (v.x + 1 - CENTER) ** 2 + (v.y + 1 - CENTER) ** 2] as const)
    .filter(([, , d]) => d <= VENT_R * VENT_R).sort((p, q) => p[2] - q[2] || p[1] - q[1] || p[0] - q[0]);
  for (const [x, y] of vents) {
    if (!buyable(sim, x, y)) continue;
    surveyTo(b, [x + 1, y + 1]);
    b.landAround([x + 1, y + 1], 2);
    b.affordDef('fumarole_tap');
    const r = sim.place('fumarole_tap', x, y, 0);
    if (!r.ok) continue;
    b.ids.geo = r.id!;
    wireFar(b, 'geo');
    return true;
  }
  return false;
}

/** Drifters bought for a dock and a route of `ships` of them carrying `item` to another. */
export function flyRoute(b: Builder, from: string, to: string, item: string, ships: number): void {
  const sim = b.sim, a = b.ids[from], z = b.ids[to];
  if (!a || !z) { b.skip(`route:${item}`); return; }
  sim.ensureCompiled();
  for (let i = 0; i < ships; i++) {
    b.afford(Object.entries(BAL.drifterCost));
    if (!sim.buyDrifter(a)) { b.skip(`drifter:${from}`); return; }
  }
  if (sim.addRoute(a, z, item, ships) <= 0) b.skip(`route:${item}`);
}

/** Every remote construction landed (their kites): the build runs on until the last. */
export function waitKites(b: Builder): void {
  let last = 0;
  for (const e of b.sim.ents.map.values()) last = Math.max(last, e.builtAt);
  if (last > b.sim.tick) b.run(last - b.sim.tick + 10);
}

/** How far from the grid masts are still tried before pylons (tiles). */
const MAST_GAP = 30;

/** Wire one building far from the grid: masts when they reach it, else a pylon line (its cost granted, ×3 off the claim's land). */
export function wireFar(b: Builder, role: string): void {
  const sim = b.sim, id = b.ids[role], e = id ? sim.ents.get(id) : undefined;
  if (!id || !e) return;
  b.affordAll(['mast', 24], ['pylon', 90]);
  // Masts only when a pillar of the grid stands near (their breadth-first search spans the gap).
  let near = Infinity;
  for (const p of hearthNetwork(sim)) { const q = sim.ents.get(p); if (q) near = Math.min(near, gap2(q, e)); }
  if (near <= MAST_GAP * MAST_GAP) powerLine(sim, id);
  if (!sim.linksOf(id).length) pylonLine(sim, id);
  if (!b.sim.linksOf(id).length) b.skip(`wire:${role}`);
}
