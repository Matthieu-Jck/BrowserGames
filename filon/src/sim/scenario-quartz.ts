// scenario-quartz.ts — the quartz vein in the debug bases (D87; scenarios.ts). The tutorial level
// plays « Le quartz de la paroi » as a player does: the vein's parcel bought, the Face Cutter's
// research (started at the Survey Data quest) waited for, two face cutters at the wall's foot, their
// poles over the Crown, one line home — up and down the Crown on traction ribbons (`routeOver`),
// into the Heart, the second cutter joining it from the side. Two, because a traction ribbon carries
// 30 a minute: what two cutters cut (15 each), so neither stands backed up (D85). Then, once the
// tutorial's trade lines are laid, the quartz workshop the quest pays for turns that quartz into
// oscillators: fed by a router on the quartz line and one on the wire line, its oscillators into the
// Heart, where the late base's servers take theirs (`quartzWorks`). Laid that early, while the
// floor is open: the later levels route round it, where one laid among the grown base's works drew
// the furnaces' search out (seconds of build). What the land does not allow is skipped and
// reported, never thrown; a land without a vein (none of today's) skips it all.
import { buildingIdx } from '@/content/registry';
import { EPOCH } from './constants';
import { join, placeFed, routeOver, sideGoalsOver, type BeltTiles } from './dev';
import { footprint, worldPorts } from './entities';
import { faceTiles } from './face';
import type { Builder } from './scenarios';
import type { Sim } from './state';
import { opposite, type Rot } from './types';
import { inWorld, tileIndex } from './world/grid';

/** Face cutters the levels set along the vein: what one traction line carries home (30 a minute). */
const VEIN_CUTTERS = 2;
/** Game minutes the build gives the Face Cutter's research (15 Survey Data at 2 a minute: about 8). */
const RESEARCH_WAIT_MIN = 20;

/**
 * Where face cutters stand along the land's vein: on the floor at its foot, each with its back on two
 * face tiles (the pairs 0–1, 2–3…), the middle pairs first (the corridor home starts there). Top-left
 * tile and rotation (the face's `look`: its front away from the wall).
 */
export function veinSpots(sim: Sim): Array<[number, number, Rot]> {
  const V = sim.grid.source.quartzVein;
  if (!V) return [];
  const def = buildingIdx('face_cutter');
  const spots: Array<[number, number, Rot, number]> = [];
  for (let i = 0; i + 1 < V.n; i += 2) {
    const fx = V.x + i * V.dx, fy = V.y + i * V.dy;
    // The footprint's corner nearest the face's first tile: past the face by one tile on the floor side.
    const [w, h] = footprint(def, V.look);
    const x = V.look === 1 ? fx + 1 : V.look === 3 ? fx - w : fx;
    const y = V.look === 2 ? fy + 1 : V.look === 0 ? fy - h : fy;
    const mid = Math.abs(2 * i + 1 - (V.n - 1)); // doubled distance of the pair's middle from the vein's
    spots.push([x, y, V.look, mid]);
  }
  return spots.sort((a, b) => a[3] - b[3] || a[0] - b[0] || a[1] - b[1]).map(([x, y, r]) => [x, y, r]);
}

/** The Heart's free inputs: the tile before each, and the way into it (routeOver's goals). */
function heartInlets(sim: Sim, heart: number): Map<number, Rot> {
  const goals = new Map<number, Rot>();
  for (const p of worldPorts(sim.ents.get(heart)!)) {
    if (p.io === 'in' && inWorld(p.fx, p.fy) && sim.grid.occ[tileIndex(p.fx, p.fy)] === 0) goals.set(tileIndex(p.fx, p.fy), opposite(p.dir));
  }
  return goals;
}

/** Lay an over-the-land path (`routeOver`'s) in runs of one ribbon kind; false (and reported) when a run is refused. */
function layRuns(b: Builder, path: ReadonlyArray<readonly [number, number, Rot, 'ribbon' | 'traction_ribbon']>, what: string): boolean {
  const lifts = path.filter((p) => p[3] === 'traction_ribbon').length;
  b.afford([['iron_plate', 2 * lifts + 4], ['copper_wire', lifts + 2]]);
  for (let i = 0; i < path.length;) {
    let j = i;
    while (j + 1 < path.length && path[j + 1]![3] === path[i]![3]) j++;
    const run: BeltTiles = path.slice(i, j + 1).map(([x, y, r]) => [x, y, r]);
    if (b.sim.placeBelts(path[i]![3], run) !== run.length) { b.skip(what); return false; }
    i = j + 1;
  }
  return true;
}

/**
 * « Le quartz de la paroi » (quest 11): the vein's parcel bought, the Face Cutter learnt for real
 * (its research runs from the Survey Data quest; `power` tops the grid up for the night it runs
 * into), two cutters at the wall's foot, wired, their quartz over the Crown into the Heart.
 */
export function wallQuartz(b: Builder, power: () => void): void {
  const sim = b.sim;
  const spots = veinSpots(sim).slice(0, VEIN_CUTTERS);
  if (!spots.length) { b.skip('vein'); return; }
  const def = buildingIdx('face_cutter');
  // The parcel: the cutters' tiles and the face behind them (one parcel, D87).
  const tiles: Array<[number, number]> = [];
  for (const [x, y, rot] of spots) {
    const [w, h] = footprint(def, rot);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) tiles.push([x + i, y + j]);
    for (const t of faceTiles(sim.grid, def, x, y, rot)) tiles.push(t);
  }
  if (!b.landFor(tiles)) return;
  // The base's power topped up first: the research waits on the collector's data, and the evening comes on (`powerUp`).
  power();
  for (let t = 0; t < RESEARCH_WAIT_MIN * EPOCH && !sim.done.has('ex_quartz'); t += EPOCH) b.run(EPOCH);
  if (!sim.done.has('ex_quartz')) { b.skip('research:ex_quartz'); return; }
  b.affordAll(['face_cutter', spots.length]);
  spots.forEach(([x, y, rot], k) => {
    const r = sim.place('face_cutter', x, y, rot);
    if (r.ok) b.ids[`cutter${k + 1}`] = r.id!;
    else b.skip(`cutter${k + 1}`);
  });
  b.wire(...spots.map((_, k) => `cutter${k + 1}`));
  veinLine(b);
  b.until('wall_quartz');
  // The lab on to Mechanics, as a player goes on (D87: it hangs from the Face Cutter).
  if (b.ids.observatory && !sim.projects.some((p) => p.lab === b.ids.observatory) && !sim.startResearch('tr1', b.ids.observatory).ok) b.skip('research:tr1');
}

/**
 * The quartz line: the first cutter's output over the land into a free input of the Heart, else
 * into the side of a line that leads there; the other cutters joining it from the side. A cutter
 * whose quartz finds no way comes back up (D85: no output to nowhere).
 */
function veinLine(b: Builder): void {
  const sim = b.sim, first = b.ids.cutter1 ? sim.ents.get(b.ids.cutter1) : undefined;
  if (!first) return;
  const out = worldPorts(first).find((p) => p.io === 'out')!;
  // A free input of the Heart of its own (a line merged into another one would send its quartz
  // down that line's branches, where a machine refuses it and the branch jams); the Heart boxed in,
  // the side of a line into it.
  let path = routeOver(sim, [out.fx, out.fy], heartInlets(sim, b.H));
  for (const role of ['wire', 'plates', 'glass']) {
    if (path) break;
    const l = b.lines[role];
    if (l) path = routeOver(sim, [out.fx, out.fy], sideGoalsOver(sim, l));
  }
  if (!path || !layRuns(b, path, 'line:quartz')) {
    b.skip('line:quartz');
    for (let k = 1; b.ids[`cutter${k}`]; k++) { const e = sim.ents.get(b.ids[`cutter${k}`]!); if (e) sim.remove(e.x, e.y); delete b.ids[`cutter${k}`]; }
    return;
  }
  b.lines.quartz = path.map(([x, y, r]) => [x, y, r]);
  for (let k = 2; b.ids[`cutter${k}`]; k++) {
    const role = `cutter${k}`;
    b.crossings();
    const l = join(sim, b.ids[role]!, b.lines.quartz);
    if (l) { b.lines[role] = l; continue; }
    const e = sim.ents.get(b.ids[role]!);
    if (e) sim.remove(e.x, e.y);
    delete b.ids[role];
    b.skip(`line:${role}`);
  }
}

/** Spots `quartzWorks` tries round each point (a cheap search: a crowded base skips it, reported). */
const WORKS_TRIES = 24;
/** Where it looks first: the quartz line this far from the Heart, by the Crown's inner foot (the floor's rim is at 23). */
const WORKS_R = 20;

/**
 * The quartz works (the tutorial level on, after its trade lines): a quartz workshop fed by a router
 * on the quartz line and one on the wire line, its oscillators into the Heart — what Mechanics Data
 * and the servers are built of (D87). Where the quartz line comes down onto the floor first, by the Crown's inner foot (out of
 * the way of the deposits' lines and of the furnaces the later levels set nearer the Heart), then by
 * the wire line, then by the Heart.
 */
export function quartzWorks(b: Builder): void {
  const sim = b.sim, quartz = b.laid('quartz'), wire = b.laid('wire');
  if (!quartz.length || !wire.length) { b.skip('osc'); return; }
  const q = quartz[0]!;
  let foot = q[q.length - 1]!, best = Infinity;
  for (const t of q) {
    const d = Math.abs((t[0] - b.heart[0]) ** 2 + (t[1] - b.heart[1]) ** 2 - WORKS_R * WORKS_R);
    if (sim.grid.level(t[0], t[1]) === 0 && d < best) { best = d; foot = t; }
  }
  b.affordAll(['quartz_workshop', 1], ['router', 2], b.spare);
  for (const at of [[foot[0], foot[1]] as [number, number], b.middle('wire'), b.heart]) {
    const r = placeFed(sim, 'quartz_workshop', at, [{ lines: quartz }, { lines: wire }], b.H, { r: 12, tries: WORKS_TRIES });
    if (!r) continue;
    b.ids.osc = r.id;
    if (r.out) b.lines['osc.out'] = r.out;
    r.lines.forEach((l, k) => { b.lines[`osc.in${k}`] = l; });
    b.wireByPole('osc');
    return;
  }
  b.skip('osc');
}
