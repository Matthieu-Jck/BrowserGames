// scenario-late.ts — the late debug base's advanced works (scenarios.ts `late`; owner, 2026-10-14:
// "qui est chargé de developper davantage la sauvegarde late game? actuellement elle n'est pas
// tres avancée", D66). Three works, each laid where the land allows and worked out as a player would,
// through commands, each sending its goods where a ribbon can take them (D61's lesson kept: what
// is big is drawn once as a plan, scenario-plans.ts, and laid whole where it fits):
//   - the potteries on the tarn's peak (map 2, D63): a pump on the tarn's edge, a conduit along
//     the rock top into a ceramic oven, its stone climbing from excavators digging the Crown's
//     inner foot, its ceramic down the terraces on traction ribbons into the Core, which builds with it;
//   - the Fabrique on the guaranteed copper field past the Crown (`FABRIQUE`): a deep bore, wire,
//     copper plates, circuits, servomotors in an etcher, a second research lab (D122: fed by nothing),
//     round a second trade post that buys glass and motors and sells the rest; its power on a pylon
//     line over the Crown;
//   - the Ember Fields mine (when the land has that tier-3 site, out at r 180–280): a deep bore on
//     embersalt into a third trade post set beside it, which sells it where it is mined; its power
//     on a pylon line.
// Until D108 drifters flew the ceramic and the embersalt from skydocks to the Fabrique's, where a
// great workshop made thermal cores of them; with the skydocks gone, no ribbon a player would lay
// reaches from the far fields (125–350 tiles off the Fabrique on lands 1–3) and the cores went with
// them. Besides: when the cirque keeps one coal drill, that drill made a deep bore beside where it
// stood (`boreInPlace`, D85), else a coal pit past the Crown whose coal climbs back over it on
// traction ribbons into the smelters' line (`coalPit`); a geothermal plant on a vent where the land
// has one (`geothermal`). (A second copper bore's ore flown home to the cirque's wire mill went with
// the drifters too: the far drill's climb feeds that mill, `farCopper` in scenarios.ts.) What the land
// does not allow is skipped and reported (`report.skipped`), never thrown.
import { BAL } from '@/content/balance';
import { BUILDING_KIND, buildingDef, buildingIdx, itemIdx } from '@/content/registry';
import { CENTER } from './constants';
import { checkpoint, hearthNetwork, lay, layTo, powerLine, pylonLine, rollback, routeLevel, routeOver, sideGoals, sideGoalsOver, spotsNear, type BeltTiles } from './dev';
import { footprint, worldPorts, type WorldPort } from './entities';
import type { DrillNode } from './flow/nodes';
import { gap2, linkPoint } from './power/links';
import { layPlan, planSpots, type Laid, type PlanSpec } from './scenario-plans';
import type { Builder } from './scenarios';
import type { Sim } from './state';
import { inReach } from './systems/landscape';
import { isWater, opposite, T, type Ent, type Rot } from './types';
import { inWorld, tileIndex } from './world/grid';
import { parcelAt } from './world/land';
import { MapGen } from './world/mapgen';
import { isSpanTile } from './flow/chain';

/**
 * The Fabrique: the advanced industry on the guaranteed copper field past the Crown (every land
 * has one at r 70–110), round the second trade post (P, the second wharf). Everything flows down
 * the plan; the sell line runs up its left edge into the post's entrance (D64: it sells whatever
 * comes in), and every intermediate product spills onto it through an overflow gate (%) when its
 * consumers are full, so nothing ever backs up into the post's exit: the glass and motors it buys
 * come out in turn (D62), and one item held up would hold the other.
 * - copper ore from the deep bore on the field arrives at `e` (the bore's line, laid after),
 *   along a copper bus (row 3, leftwards) whose routers feed the electric smelter (S, D129: copper
 *   plates on power) and the two wire mills (M, N) below them;
 * - the smelter's plates and slag (D125) down into an inverted sorter (K): the slag straight on into
 *   an incinerator (X), the plates aside to both circuit workshops' side intakes (C, c: the
 *   circuit is a copper plate, two wires and a glass since D129) — no line from the post's exit
 *   carries them, so the glass the same workshops need never waits behind them there;
 * - the post's exit (a swift ribbon): an inverted sorter (I) sends the motors aside, down toward the
 *   etcher, the glass on along a glass bus (row 2) whose routers drop it, across the copper bus on
 *   junctions, into the circuit workshops' other inputs; each mill hands its wire straight into its
 *   workshop below;
 * - the motors and the circuits down to the etcher (T: servomotors, a motor and two circuits, three
 *   times as fast as an electronics workshop), what it leaves of them onto the sell line, sold at the
 *   post; below, the research lab O, fed by no line (D122: the data collector that filled it went
 *   with the data). Until D129 a press (G) made the etcher's gears of plates the post bought, and an
 *   inverted sorter turned its scrap aside.
 * Until D108 a skydock (D) stood on its right, the potteries' ceramic and the Ember Fields'
 * embersalt flown into it, and a great workshop (K) made thermal cores of them with the circuits:
 * both went with the drifters, and with them the sell line's second spill row.
 * Checked on a flat world in all four turns: every port fed, no line ending nowhere.
 */
export const FABRIQUE: PlanSpec = {
  rows: [
    ' PPPPP',
    ' PPPPP .  .. ..',
    '→PPPPP>I>>R+>R+..',
    '↑PPPPP v .+R<+R<R<e',
    '↑PPPPP v  vM vNSS',
    '↑      v  vM vNSS',
    '↑      v  CC<cc<Kv',
    '↑      v  CC^cc Xv',
    '↑<<<<<<v.  v^<+<<<',
    '↑<<<<<<%.  v<<<',
    '↑<<<<<<+<<<%.',
    '↑      v   v',
    '↑      v   v',
    '↑     .R.  v',
    '↑     v+<<<<',
    '↑     vv',
    '↑     vv',
    '↑     vv',
    '↑    TTT',
    '↑    TTT',
    '↑    TTT',
    '↑     v  OOO',
    '↑     v  OOO',
    '↑     v  OOO',
    '↑<<<<<<',
  ],
  swift: [[6, 2]],
  key: {
    P: { role: 'post2', def: 'trade_post', turn: 3 },
    M: { role: 'mill2', def: 'wire_mill', recipe: 'copper_wire' },
    N: { role: 'mill3', def: 'wire_mill', recipe: 'copper_wire' },
    C: { role: 'circuits', def: 'workshop', recipe: 'circuit' },
    c: { role: 'circuits2', def: 'workshop', recipe: 'circuit' },
    // D129: the circuits' copper plates, smelted on power off the copper bus; its slag (D125) straight
    // on into an incinerator, its plates aside to both workshops' side intakes.
    S: { role: 'plates2', def: 'electric_smelter', recipe: 'arc_copper' },
    K: { role: 'platesSort', def: 'inverted_sorter', filter: 'copper_plate' },
    X: { role: 'slagPit', def: 'incinerator' },
    T: { role: 'bells', def: 'etcher', recipe: 'pace_bell' },
    O: { role: 'observatory2', def: 'observatory' },
    // D129: the bought motors aside, down to the etcher (where the press's gears went until then).
    I: { role: 'sorter2', def: 'inverted_sorter', filter: 'motor' },
    R: { def: 'router' },
    '%': { def: 'overflow_gate' },
    e: { role: 'works.in', def: 'mark', dir: 3 },
  },
};

/**
 * What the second post buys a minute: the circuit workshops' glass and the etcher's motors, both
 * from foundries a quarter hour away (plus the post's lift: about twenty minutes). D129: no more
 * than the workshops and the etcher use (the smelter's 10 copper plates a minute make 10 circuits,
 * five servomotors' worth), so neither backs the exit up for long; the plates for the press went
 * with the press (the servomotor is a motor and two circuits now).
 */
export const FABRIQUE_BUY: Readonly<Record<string, number>> = { glass: 10, motor: 4 };

// ── small geometry ───────────────────────────────────────────────────────────

/** `k` tiles from `p` toward `q`. */
export function toward(p: readonly [number, number], q: readonly [number, number], k: number): [number, number] {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  let d = 1;
  while ((d + 1) * (d + 1) <= dx * dx + dy * dy) d++;
  return [p[0] + Math.round((dx * k) / d), p[1] + Math.round((dy * k) / d)];
}

/** May the claim build on a tile: its land, or a parcel no neighbouring base holds (CrierBelt's, to buy; D110)? */
export function buyable(sim: Sim, x: number, y: number): boolean {
  return sim.land.covers(x, y) || sim.land.neighbour(parcelAt(x, y)) < 0;
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
/**
 * Excavator spots tried for the first one before an oven spot is given up (D143): where the stone
 * finds a way up at all, it does from the first spot (lands 1–3), and an oven its stone cannot reach
 * cost the late build a second and a half for its 60.
 */
const DIG_FIRST_TRIES = 2;

type Tarn = { readonly x: number; readonly y: number; readonly level: number };

/**
 * The potteries (owner, 2026-10-14: "put the lake at the top of the moutain"; the lead: "a
 * mountain-top ceramic works on the peak by the tarn"): the oven on the peak at the tarn's level,
 * on its side toward the Heart; a pump on the tarn's edge and a conduit along the rock top into it
 * (water stays on its level: no lift for a conduit); its stone from excavators on the cirque's
 * floor digging the Crown's lower terraces nearby (never the peak's rock round the tarn), their
 * lines merging and climbing on traction ribbons; its ceramic down the terraces into a silo at the
 * peak's foot, and from it on along the floor into the Core, which builds with it — a free inlet of
 * the Core's, else the side of a line that ends there, across the lines in the way on junctions
 * (D108: into a skydock on the floor before, whence drifters flew it to the Fabrique; the climb
 * down finds no way through the lines round the Core, which only a floor line crosses). Each oven
 * spot tried whole, taken back up when a part cannot be laid. Whether they stand.
 */
export function potteries(b: Builder): boolean {
  // The tarn's peak (maps 2–3); on map 4 (D115) the spring's stream comes down the Crown from a
  // summit, and the works stand on a ledge beside it: each level it comes down to, the highest first,
  // the water there at that level (where the pump stands).
  const sim = b.sim, tarn = sim.grid.source.tarn, spring = sim.grid.source.spring;
  const anchors: Tarn[] = tarn ? [tarn] : spring ? streamLedges(sim, spring) : [];
  if (!anchors.length) { b.skip('potteries:tarn'); return false; }
  b.affordAll(['ceramic_oven', 1], ['pump', 1], ['conduit', 24], ['silo', 1], ['excavator', POTTERY_DIGGERS]);
  for (const at of anchors) {
    // The tarn's peak: its side toward the Heart; down a spring's stream (a ledge, a pool), round the water itself.
    const inner = tarn ? toward([at.x, at.y], b.heart, 5) : ([at.x, at.y] as const);
    // On the rock at its level up on the Crown; by a pool, on the floor.
    const ovens = spotsNear(sim, 'ceramic_oven', inner, { r: 6, onRock: at.level > 0, toward: b.heart })
      .filter(([x, y]) => sim.grid.level(x, y) === at.level).slice(0, 24);
    for (const [x, y, rot] of ovens) {
      const cp = checkpoint(sim);
      if (pottery(b, x, y, rot, at)) return true;
      rollback(sim, cp);
    }
  }
  b.skip('potteries');
  return false;
}

/**
 * The places down a spring's stream (map 4, D115): from the spring along the way its water runs (the
 * chunk's biome code), the first tile at each level it comes down to — a ledge where the potteries
 * may stand at its water's level —, then the pool it runs into on the floor (the Crown's narrow
 * ledges seldom hold the works; the floor round the pool does, its stone from the terraces nearby).
 */
function streamLedges(sim: Sim, spring: Tarn): Tarn[] {
  const g = sim.grid, out: Tarn[] = [];
  const FX = [1, 1, 0, -1, -1, -1, 0, 1], FY = [0, 1, 1, 1, 0, -1, -1, -1];
  // The spring wells up in a basin on its summit's plateau: the stream starts at the stream's tile
  // nearest it (the first found, row by row, of the nearest).
  let x = spring.x, y = spring.y, f = 0, near = Infinity;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    if (g.terrain(spring.x + dx, spring.y + dy) === T.River && dx * dx + dy * dy < near) { near = dx * dx + dy * dy; x = spring.x + dx; y = spring.y + dy; }
  }
  for (let n = 0; n < 40 && g.terrain(x, y) === T.River; n++) {
    const lv = g.level(x, y);
    if (lv >= 1 && !out.some((a) => a.level === lv)) out.push({ x, y, level: lv });
    f = (g.chunkAt(x >> 5, y >> 5).biome[(y & 31) * 32 + (x & 31)]! - 16) & 7;
    x += FX[f]!;
    y += FY[f]!;
  }
  // Into the pool: its middle, a tile or two on.
  if (g.terrain(x, y) === T.Shallow || g.terrain(x, y) === T.Deep) out.push({ x: x + FX[f]!, y: y + FY[f]!, level: g.level(x, y) });
  return out;
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
  // The ceramic down the terraces into a silo on the floor below the peak, its outlets toward the
  // Core; from the silo on into the Core. With `cross`, across a line on a junction where it must
  // (each try then taken back whole, junctions too).
  b.crossings();
  const descend = (cross: boolean): { silo: number; down: OverPath; on: BeltTiles } | null => {
    const spots = siloSpots(sim, tarn, b.heart);
    // On its own way, one search toward every spot's inlets first: walled in, each spot's own search
    // would spend its whole budget for nothing (D143: 0.4 s an oven spot on land 1).
    if (!cross && !routeOver(sim, [out.fx, out.fy], siloInlets(sim, spots), DOWN_ANY)) return null;
    for (const [sx, sy, sr] of spots) {
      const cp = cross ? checkpoint(sim) : null;
      const s = sim.place('silo', sx, sy, sr);
      if (!s.ok) continue;
      const down = routeOver(sim, [out.fx, out.fy], inlets(sim, s.id!), 20_000, cross);
      if (down && layOver(b, down)) {
        const on = layTo(sim, s.id!, intoHeart(sim), -1, 40_000);
        if (on) return { silo: s.id!, down, on };
      }
      if (cp) rollback(sim, cp);
      else { if (down) unlay(sim, down); sim.remove(sx, sy); }
    }
    return null;
  };
  // Stone: excavators on the floor against the Crown's foot near the peak (never digging rock of
  // the tarn's level: the peak round it), the first one's line climbing into the oven, the others'
  // into the side of a line already laid.
  const quarry = (): { diggers: number[]; lines: BeltTiles[] } | null => {
    const at = toward([tarn.x, tarn.y], b.heart, 11);
    const stones: BeltTiles[] = [];
    const diggers: number[] = [];
    const claimed = new Set<number>();
    // Never the peak's rock round the tarn (at its level); by a pool on the floor (map 4, D115) any rock.
    const keep = (tx: number, ty: number): boolean => (tarn.level > 0 && sim.grid.level(tx, ty) >= tarn.level) || claimed.has(tileIndex(tx, ty));
    // Inside the cirque below the peak, and outside the Crown beyond it (their lines climb over).
    const beyond = toward([tarn.x, tarn.y], b.heart, -10);
    const cands = [...spotsNear(sim, 'excavator', at, { r: 14, toward: [x, y] }), ...spotsNear(sim, 'excavator', beyond, { r: 10, toward: [x, y] })]
      .map((s, k) => [s, rockInReach(sim, s[0], s[1], s[2], keep).length, k] as const)
      .filter(([, n]) => n >= DIG_MIN).sort((p, q) => q[1] - p[1] || p[2] - q[2]).slice(0, 60);
    let fails = 0;
    for (const [[ex, ey, er]] of cands) {
      if (diggers.length >= POTTERY_DIGGERS || (!diggers.length && fails >= DIG_FIRST_TRIES)) break;
      if (rockInReach(sim, ex, ey, er, keep).length < DIG_MIN) continue; // its rock is a neighbour's already
      const r = sim.place('excavator', ex, ey, er);
      if (!r.ok) continue;
      const sp = worldPorts(sim.ents.get(r.id!)!).find((p) => p.io === 'out')!;
      // The first one's line into the oven; the next ones into the side of a line laid (on the floor
      // or up the terraces).
      let line: BeltTiles | null = null;
      const goals: Map<number, Rot> = stones.length ? sideGoalsOver(sim, stones.flat()) : new Map([[tileIndex(dry.fx, dry.fy), opposite(dry.dir)]]);
      const up: OverPath | null = goals.size ? routeOver(sim, [sp.fx, sp.fy], goals, 20_000) : null;
      if (up && layOver(b, up)) line = up.map(([lx, ly, lr]) => [lx, ly, lr]);
      else if (up) unlay(sim, up);
      if (!line) { sim.remove(ex, ey); fails++; continue; }
      stones.push(line);
      // Its rock claimed now, so the next excavator's reach counts only what is left. Nothing is
      // marked: with no mark in reach an excavator quarries, its rock left standing (owner,
      // 2026-10-14: the stone must not run out), so the Crown's foot keeps its shape.
      for (const t of rockInReach(sim, ex, ey, er, keep)) claimed.add(t);
      diggers.push(r.id!);
    }
    return diggers.length ? { diggers, lines: stones } : null;
  };
  // The ceramic's way down, then the stone. Walled in on its own way down — the peak's foot fenced
  // by lines laid before it (D143: on land 1 the boiler's coal line along the floor's rim and the
  // quartz line round the Crown; the ceramic had gone right round the Crown's far side while a coal
  // generator's line ringed the Core) — across a line on a junction, as the quartz line goes (D115).
  const way = descend(false) ?? descend(true);
  const dig = way ? quarry() : null;
  if (!way || !dig) return false;
  const { silo, down, on } = way;
  dig.diggers.forEach((id, k) => { b.ids[`digger${k + 1}`] = id; b.lines[`stone${k + 1}`] = dig!.lines[k]!; });
  const diggers = dig.diggers;
  b.ids.oven = oven;
  b.ids.pump = pump.id!;
  b.ids.potSilo = silo;
  b.lines.ceramic = down.map(([lx, ly, lr]) => [lx, ly, lr]);
  b.lines['ceramic.on'] = on;
  b.recipe('oven', 'ceramic');
  b.wire('oven', 'pump', ...diggers.map((_, k) => `digger${k + 1}`));
  return true;
}

/** The potteries' silo: how many spots are tried round each foot. */
const SILO_TRIES = 4;
/** The search toward every silo spot at once (tiles settled): three spots' own searches. */
const DOWN_ANY = 40_000;

/** The free inlets of a silo on each of these spots, were it placed there (the way into each). */
function siloInlets(sim: Sim, spots: ReadonlyArray<readonly [number, number, Rot]>): Map<number, Rot> {
  const def = buildingIdx('silo'), goals = new Map<number, Rot>();
  for (const [x, y, rot] of spots) {
    for (const p of worldPorts({ def, x, y, rot })) {
      if (p.io !== 'in' || !inWorld(p.fx, p.fy) || sim.grid.occ[tileIndex(p.fx, p.fy)] !== 0) continue;
      goals.set(tileIndex(p.fx, p.fy), opposite(p.dir));
    }
  }
  return goals;
}

/**
 * Where the potteries' silo may stand, best first: on the floor below the peak 15 tiles toward the
 * Core, then 19 and 11, then 15 tiles off that line by 30° either way — the straight line may hold
 * something already (D115: map 4's spring runs down to a pool on the floor's edge, a boiler on its
 * shore). A few spots round each foot, none twice. The 30° turn in integers (cos 866‰, sin 500‰):
 * no trigonometry in the engine.
 */
function siloSpots(sim: Sim, tarn: Tarn, heart: readonly [number, number]): Array<[number, number, Rot]> {
  const from: [number, number] = [tarn.x, tarn.y];
  const dx = heart[0] - tarn.x, dy = heart[1] - tarn.y;
  const feet = [15, 19, 11].map((k) => toward(from, heart, k));
  for (const s of [500, -500]) {
    const aside: [number, number] = [tarn.x + Math.round((dx * 866 - dy * s) / 1000), tarn.y + Math.round((dx * s + dy * 866) / 1000)];
    feet.push(toward(from, aside, 15));
  }
  const seen = new Set<string>();
  const out: Array<[number, number, Rot]> = [];
  for (const foot of feet) {
    let n = 0;
    for (const [x, y, r] of spotsNear(sim, 'silo', foot, { r: 5, toward: heart })) {
      if (n >= SILO_TRIES) break;
      const key = `${x},${y},${r}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([x, y, r]);
      n++;
    }
  }
  return out;
}

/**
 * The ways into the Core for a floor line: its free inlets, and the side of every line that ends in
 * it (each free floor tile beside one, and the way from it into the line) — the Core takes whatever
 * comes, so a line merged into one of its own is a way in when its inlets are taken.
 */
function intoHeart(sim: Sim): Map<number, Rot> {
  sim.ensureCompiled();
  const g = sim.graph;
  const goals = inlets(sim, sim.hearthId);
  for (const c of g.chains) {
    if (c.fluid || !g.hearth || !c.outE.some((e) => g.nodes[g.eDst[e]!] === g.hearth)) continue;
    const tiles: BeltTiles = Array.from(c.tiles.filter((t) => !isSpanTile(t)), (t) => { const x = t % 1024, y = (t - x) / 1024; return [x, y, sim.entityAt(x, y)?.rot ?? 0] as const; });
    for (const [t, r] of sideGoals(sim, tiles)) if (!goals.has(t)) goals.set(t, r);
  }
  return goals;
}

// ── the Fabrique on the copper field ─────────────────────────────────────────

/** The guaranteed copper field's centre (MapGen's own; else the revealed copper nearest r 90). */
function copperField(sim: Sim): [number, number] | null {
  if (sim.grid.source instanceof MapGen) return [sim.grid.source.copperField.cx, sim.grid.source.copperField.cy];
  return nearestTile(sim, [CENTER, CENTER - 90], 60, (x, y) => sim.grid.ore(x, y) === itemIdx('copper_ore'));
}

/**
 * A pylon line out to a far point, walking the fog back (D117: no survey beacon — a pylon lifts the
 * fog as far as its wires reach): from the grid's pillar nearest the point, each pylon on the
 * revealed tile within a wire's reach that comes nearest the point, wired to the last, until the
 * point lies in the clear. `wireFar` then wires the works out there from its last pylon.
 */
function surveyTo(b: Builder, at: readonly [number, number]): void {
  const sim = b.sim;
  const pylon = buildingIdx('pylon');
  const R = linkPoint(pylon, sim.mods)?.range ?? 0;
  if (!R || !sim.unlocked(buildingDef(pylon).unlock)) { if (!sim.revealed(at[0], at[1])) b.skip('survey'); return; }
  const to = (x: number, y: number): number => (x - at[0]) * (x - at[0]) + (y - at[1]) * (y - at[1]);
  for (let k = 0; k < 16 && !sim.revealed(at[0], at[1]); k++) {
    // The pillar of the grid nearest the point with a wire to spare.
    let src: Ent | undefined;
    for (const id of [...hearthNetwork(sim)].sort((p, q) => p - q)) {
      const e = sim.ents.get(id), lp = e ? linkPoint(e.def, sim.mods) : null;
      if (!e || !lp || sim.links.degree(e.id) >= lp.slots) continue;
      if (!src || to(e.x, e.y) < to(src.x, src.y)) src = e;
    }
    if (!src) break;
    // The tiles within its reach, nearest the point first, that bring the line nearer.
    const near: Array<[number, number, number]> = [];
    for (let y = src.y - R; y <= src.y + R; y += 2) {
      for (let x = src.x - R; x <= src.x + R; x += 2) {
        if (!inWorld(x, y) || !sim.revealed(x, y) || gap2(src, { def: pylon, x, y, rot: 0 }) > R * R) continue;
        const d = to(x, y);
        if (d < to(src.x, src.y)) near.push([x, y, d]);
      }
    }
    near.sort((p, q) => p[2] - q[2] || p[1] - q[1] || p[0] - q[0]);
    b.affordDef('pylon');
    let placed = false;
    for (const [x, y] of near.slice(0, 40)) {
      const c = sim.canPlace('pylon', x, y, 0);
      if (!c.ok || c.replaces.length) continue;
      const r = sim.place('pylon', x, y, 0);
      if (!r.ok) continue;
      // A pylon placed in reach wires itself to the nearest pillar; else it is wired to the line's end.
      if (sim.links.has(src.id, r.id!) || sim.link(src.id, r.id!).ok || hearthNetwork(sim).has(r.id!)) { placed = true; break; }
      sim.remove(x, y);
    }
    if (!placed) break;
  }
  if (!sim.revealed(at[0], at[1])) b.skip('survey');
}

/** Buy the parcels round a point (the fog lifts with them); the way there surveyed first, by a pylon line. */
function claimAround(b: Builder, at: readonly [number, number], r: number): void {
  surveyTo(b, at);
  b.landAround(at, r);
}

/** Take a laid plan back up (its ribbons, blocks and buildings). */
function unlayPlan(sim: Sim, l: Laid): void {
  for (const [x, y] of l.tiles) if (sim.entityAt(x, y)) sim.remove(x, y);
}

/**
 * The Fabrique (`FABRIQUE`): the copper field's parcels bought, a deep bore on its copper, the
 * plan laid where it fits nearest the bore (its land bought; a neighbouring base's left alone), the
 * bore's line into the plan's copper entry, the post's standing orders; power by a pylon line from
 * the base's grid, then masts. Whether it stands.
 */
export function fabrique(b: Builder): boolean {
  const sim = b.sim;
  const field = copperField(sim);
  if (!field) { b.skip('fabrique:copper'); return false; }
  claimAround(b, field, 10);
  const bore = b.put('boreCu', 'deep_bore', field, { item: 'copper_ore', r: 6, toward: b.heart });
  if (!bore) return false;
  // Where the plan fits round a point between the bore and the Heart, its copper entry nearest the
  // bore first: a short line, not one round the plan's sell line.
  const [bx, by] = b.centre('boreCu');
  const entryOf = (cells: ReadonlyArray<readonly [number, number, string]>): readonly [number, number] => { const c = cells.find(([, , ch]) => ch === 'e'); return c ? [c[0], c[1]] : [0, 0]; };
  const spots = planSpots(sim, FABRIQUE, toward([bx, by], b.heart, 16), 22, (x, y) => buyable(sim, x, y), new Set(), 12)
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
  // The post's trade: glass and motors bought, out of its one exit in turn (D62); its entrance
  // sells what the sell line brings (D64).
  const post = laid.ids.post2!;
  const ask = (it: string): number => Math.floor((sim.prices.ask[itemIdx(it)]! * 3) / 2);
  for (const [item, n] of Object.entries(FABRIQUE_BUY)) if (typeof sim.addImport(post, item, n, ask(item)) !== 'number') b.skip(`import:${item}`);
  // Power: a pylon line over the Crown to the post, then masts to the rest.
  wireFar(b, 'post2');
  b.wire('boreCu', 'mill2', 'mill3', 'plates2', 'circuits', 'circuits2', 'bells', 'observatory2');
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
 * The Ember Fields mine (tier 3: embersalt, a unique the base sells; Atlas Lore, tr6): the site's
 * parcels bought (the fog lifts with them), a deep bore on the embersalt and,
 * beside it, a third trade post (The Crier House, cmK) whose entrance takes the bore's line: the
 * embersalt is sold where it is mined, CrierBelt's lift on the spot (D108: a skydock before, whence
 * drifters flew it to the Fabrique's thermal cores — 125 to 350 tiles from the field on lands 1–3,
 * no line a player would lay). The post buys nothing: its exit stays bare. Both on the base's grid by
 * a pylon line from the nearest pillar. Whether it stands.
 */
export function emberMine(b: Builder): boolean {
  const sim = b.sim, at = emberSite(sim);
  if (!at) return false;
  claimAround(b, at, 9);
  const bore = b.put('boreE', 'deep_bore', at, { item: 'embersalt', r: 5, toward: b.heart });
  if (!bore) return false;
  b.affordDef('trade_post');
  let post = 0;
  for (const [x, y, rot] of spotsNear(sim, 'trade_post', toward(b.centre('boreE'), b.heart, 7), { r: 7, toward: b.centre('boreE') }).slice(0, 16)) {
    const d = sim.place('trade_post', x, y, rot);
    if (!d.ok) continue;
    const line = lay(sim, bore, d.id!);
    if (line) { post = d.id!; b.lines.ember = line; break; }
    sim.remove(x, y);
  }
  if (!post) { b.skip('postE'); const e = sim.ents.get(bore)!; sim.remove(e.x, e.y); delete b.ids.boreE; return false; }
  b.ids.postE = post;
  wireFar(b, 'boreE');
  b.wire('postE');
  return true;
}

// ── the coal pit: coal over the Crown ────────────────────────────────────────

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

/**
 * The cirque's coal drill made a deep bore beside where it stood (D85): on the deposit's free coal,
 * its ribbon into the coal line's first tile from straight behind (the drill's old outlet), more
 * coal for the smelters — where that line is too short and hemmed in for a line from outside to join
 * it (a drill two tiles from the smelters' router). Its other outlet faces open ground (no coal fed
 * into another line). Whether the bore stands; else the drill stands again as it was.
 */
function boreInPlace(b: Builder): boolean {
  const sim = b.sim;
  const drill = b.ids.coal ? sim.ents.get(b.ids.coal) : undefined;
  if (!drill || drill.def !== buildingIdx('drill')) return false;
  sim.ensureCompiled();
  const old = sim.graph.nodeByEnt.get(drill.id) as DrillNode | undefined;
  const out = worldPorts(drill).find((p) => p.io === 'out');
  if (!old || !out) return false;
  const { x, y, rot } = drill;
  b.affordDef('deep_bore');
  sim.remove(x, y);
  const goal = new Map([[tileIndex(out.x, out.y), out.dir]]);
  for (const [bx, by, br] of spotsNear(sim, 'deep_bore', [x, y], { item: 'coal', r: 6 }).slice(0, 24)) {
    const d = sim.place('deep_bore', bx, by, br);
    if (!d.ok) continue;
    sim.ensureCompiled();
    const n = sim.graph.nodeByEnt.get(d.id!) as DrillNode | undefined;
    const outs = worldPorts(sim.ents.get(d.id!)!).filter((p) => p.io === 'out');
    const onLine = outs.find((p) => p.fx === out.fx && p.fy === out.fy && p.dir === out.dir);
    const path = !n || n.item !== old.item || n.rateEp <= old.rateEp ? null : onLine ? [] : layTo(sim, d.id!, goal, -1, 4000);
    const used = onLine ? [out.fx, out.fy] : path?.[0];
    if (path && used && outs.every((p) => (p.fx === used[0] && p.fy === used[1]) || !sim.entityAt(p.fx, p.fy))) {
      b.ids.coal = d.id!;
      if (path.length) b.lines['coal.bore'] = path;
      b.wire('coal');
      return true;
    }
    if (path?.length) unlay(sim, path);
    sim.remove(bx, by);
  }
  const back = sim.place('drill', x, y, rot);
  if (back.ok) { b.ids.coal = back.id!; b.wire('coal'); }
  return false;
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
 * rest of it up): a deep bore on the nearest coal past the Crown, its coal back over the Crown on
 * traction ribbons into the side of the smelters' coal line, ahead of both smelters (before the
 * first routing block set on it: the glass smelter's branch) — D108: flown home by drifters between
 * two skydocks before. Whether it stands; else the bore comes back up, rather than stand with
 * nowhere to send its coal (D85).
 */
export function coalPit(b: Builder, crownOuter: number): boolean {
  const sim = b.sim;
  const line = b.lines['coal'];
  if (!line || cirqueCoalDrills(sim, crownOuter) >= 2 || boreInPlace(b)) return false;
  const at = coalDeposit(sim, crownOuter + 4, COAL_PIT_R);
  if (!at) { b.skip('coalPit'); return false; }
  claimAround(b, at, 8);
  const bore = b.put('boreC', 'deep_bore', at, { item: 'coal', r: 4, toward: b.heart });
  if (!bore) return false;
  const k = line.findIndex(([x, y]) => { const e = sim.entityAt(x, y); return !!e && BUILDING_KIND[e.def] === 'fork'; });
  const upstream = k >= 1 ? line.slice(0, k + 1) : line;
  const goals = sideGoalsOver(sim, upstream);
  let home: OverPath | null = null;
  for (const p of worldPorts(sim.ents.get(bore)!).filter((q) => q.io === 'out')) {
    if (!goals.size) break;
    home = routeOver(sim, [p.fx, p.fy], goals, 40_000);
    if (home && layOver(b, home)) break;
    if (home) unlay(sim, home);
    home = null;
  }
  if (!home) {
    b.skip('coalPit:line');
    const e = sim.ents.get(bore);
    if (e) sim.remove(e.x, e.y);
    delete b.ids.boreC;
    return false;
  }
  b.lines['coalHome'] = home.map(([x, y, r]) => [x, y, r]);
  wireFar(b, 'boreC');
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
