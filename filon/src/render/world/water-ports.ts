// water-ports.ts — where the water meets the buildings, read from the sim for the views (D142;
// the art: art/pipe-ports.ts). Two questions, both asked at each structural rebuild (they are part
// of an entity's drawing signature, buildings-view.ts `sigOf`):
//
// - **Which entrance of a water drinker wears the pipework** (`wetEntranceOf`): what joins each of
//   its entrances in the compiled graph — water (a conduit, or a pump's outlet set straight against
//   it), a dry line (a ribbon, another machine's outlet) or nothing — through `wetEntrance`. The
//   engine lets either entrance take water (D114), so a base that waters the other one wears the
//   variant the atlas bakes for it.
// - **Which edges of a conduit tile meet a port** (`couplingSides`): a building's port opening onto
//   the tile across that edge, that the conduit joins — it flows out through that edge into an
//   intake, or comes in from an outlet there (any way but back into it, as the compile joins them).
//   Each gets the coupling piece. Geometry only (the entities and their ports), so it holds for a
//   ribbon-looking hatch as well: wherever water meets a port, the joint is a pipe joint.
// - **Which pipe a conduit tile shows in iso** (`pipeOf`, D145; the art: art/recipes/pipes.ts): its
//   straight or elbow from its piece (buildings-view.ts `beltPiece`), each end running on to the edge
//   where the tube goes on — fed from behind, feeding the tile ahead (or pouring down its fall) — and
//   stopping at a stub's mouth with a flange where it couples to a port or the line ends open; a
//   straight's side inlets as tee branches; on a run's plain straights a flanged joint every
//   `JOINT_EVERY` tiles along it and now and then a sight-glass, by the tile's place (the same tiles
//   every time, both views alike). A tee (D152, the graph's `tees`: a line drawing water off its side)
//   gets a branch on each side it hands water out of, and its sharing valve (`valve`); a bend with a
//   branch off its outer side is drawn as a straight from its feeder to the branch, its way on the
//   branch. `plan` says which flat pieces the plan lays (its tube, its inlets), in step with iso.
import { BUILDING_KIND, buildingDef } from '@/content/registry';
import { worldPorts } from '@/sim/entities';
import type { Chain } from '@/sim/flow/chain';
import type { Sim } from '@/sim/state';
import { DX, DY, opposite, type Ent, type Rot } from '@/sim/types';
import type { PipeMark } from '../art/recipes/pipes';
import { tileIndex } from '@/sim/world/grid';
import { WORLD } from '@/sim/constants';
import { DRY, WET, homeEntrance, wetEntrance } from '../art/pipe-ports';

/** The entrance a water drinker's pipework is drawn on (a port index), −1 for its own or a building that drinks no water. */
export function wetEntranceOf(sim: Sim, e: Ent): number {
  const def = buildingDef(e.def);
  if (homeEntrance(def) < 0) return -1;
  const g = sim.graph, node = g?.nodeByEnt.get(e.id);
  if (!g || !node) return -1;
  const joined = new Int8Array(def.ports.length);
  for (const ed of node.inE) {
    const port = g.eDstPort[ed]!, src = g.nodes[g.eSrc[ed]!]!;
    const wet = src.kind === 'chain' ? (src as Chain).fluid : BUILDING_KIND[sim.ents.get(src.ent)?.def ?? -1] === 'pump';
    if (port >= 0 && port < joined.length) joined[port] = Math.max(joined[port]!, wet ? WET : DRY);
  }
  return wetEntrance(def, (i) => joined[i]!);
}

/** The edges of conduit `e`'s tile (a mask of sides, bit `1 << side`) where it couples to a building's port. */
export function couplingSides(sim: Sim, e: Ent): number {
  let mask = 0;
  for (let s = 0; s < 4; s++) {
    const nx = e.x + DX[s]!, ny = e.y + DY[s]!;
    if (nx < 0 || ny < 0 || nx >= WORLD || ny >= WORLD) continue;
    const b = sim.ents.get(sim.grid.occ[tileIndex(nx, ny)]!);
    if (!b || b.id === e.id || !buildingDef(b.def).ports.length) continue;
    const kind = BUILDING_KIND[b.def];
    if (kind === 'belt' || kind === 'conduit' || kind === 'bridge') continue;
    for (const p of worldPorts(b)) {
      if (p.fx !== e.x || p.fy !== e.y || p.dir !== opposite(s as Rot)) continue;
      // An intake takes the conduit flowing out through this edge; an outlet feeds it unless it runs back into it.
      if (p.io === 'in' ? e.rot === s : e.rot !== s) mask |= 1 << s;
    }
  }
  return mask;
}

/** A run's plain straights get a flanged joint every this many tiles along it (by their place). */
export const JOINT_EVERY = 3;
/** …and one in this many of the others a sight-glass (a hash of the place). */
export const GLASS_EVERY = 7;

/**
 * A conduit tile's pipe (D145): its main piece's N E S W edges ('0' none, '1' on to the edge, '2' to a
 * stub's mouth), a straight's mark, its tee branches; whether it shares its water (D152: a tee, its
 * valve); its plan pieces — the tube (a bend or a straight, turned, mirrored) and each inlet (turned,
 * mirrored for one from the right).
 */
export interface PipeOf {
  arms: string;
  mark: PipeMark;
  branches: Array<{ side: number; full: boolean }>;
  valve: boolean;
  plan: { corner: boolean; rot: Rot; mirror: boolean; inlets: Array<{ rot: Rot; mirror: boolean }> };
}

/**
 * The pipe conduit `e` shows (D145): `corner` and `enter` its piece (buildings-view.ts `beltPiece`:
 * a bend entering the way `enter`), `fall` whether it pours a terrace down (its way on is the
 * downpipe's). An end goes on to the edge where a tube meets it — the tile behind (or the bend's
 * feeder) feeds it, it feeds the tile ahead — and stops at the stub's mouth where it couples to a
 * port (`couplingSides`) or meets nothing; a straight fed from a side gets a branch there.
 */
export function pipeOf(sim: Sim, e: Ent, corner: boolean, enter: Rot, fall = false, mirror = false): PipeOf {
  const g = sim.graph, t = tileIndex(e.x, e.y);
  const fed = g?.feedDirs.get(t) ?? 0, couple = couplingSides(sim, e), tee = g?.tees.get(t) ?? 0;
  const out = e.rot, back = opposite(corner ? enter : e.rot);
  const nx = e.x + DX[out]!, ny = e.y + DY[out]!;
  const ahead = nx >= 0 && ny >= 0 && nx < WORLD && ny < WORLD && ((g?.feedDirs.get(tileIndex(nx, ny)) ?? 0) & (1 << opposite(out))) !== 0;
  const state = (side: number, joined: boolean): string => (couple & (1 << side) || !joined ? '2' : '1');
  const arms = ['0', '0', '0', '0'];
  const branches: PipeOf['branches'] = [];
  const left = ((out + 3) & 3) as Rot, right = ((out + 1) & 3) as Rot;
  const plan: PipeOf['plan'] = { corner, rot: corner ? enter : out, mirror, inlets: [] };
  if (corner && tee) {
    // A bend with a branch off its outer side (D152): a straight from its feeder on to the branch's
    // edge (a tube meets it there), its way on a branch (to the edge, or to a stub's mouth at a port).
    const on = opposite(back) as Rot;
    arms[back] = state(back, (fed & (1 << back)) !== 0);
    arms[on] = '1';
    branches.push({ side: out, full: state(out, ahead || fall) === '1' });
    plan.corner = false; plan.rot = on; plan.mirror = false;
    plan.inlets.push({ rot: on, mirror: out === ((on + 1) & 3) });
  } else {
    arms[back] = state(back, (fed & (1 << back)) !== 0);
    arms[out] = state(out, ahead || fall);
    // A straight's side inlets (a line merging in) and its tee's ways out (D152: a branch tube runs on to the edge).
    if (!corner) for (const s of [right, left]) if ((fed | tee) & (1 << s)) branches.push({ side: s, full: (tee & (1 << s)) !== 0 || !(couple & (1 << s)) });
    for (const b of branches) plan.inlets.push({ rot: out, mirror: b.side === right });
  }
  let mark: PipeMark = '';
  if (!corner && !branches.length && arms[back] === '1' && arms[out] === '1' && !buildingDef(e.def).gauge) { // a gauge's tile (D155) wears its dial instead
    const along = out & 1 ? e.x : e.y;
    if (along % JOINT_EVERY === 0) mark = 'j';
    else if (((Math.imul(e.x, 0x45d9f3b) ^ Math.imul(e.y, 0x2c1b3c6d)) >>> 0) % GLASS_EVERY === 3) mark = 'g';
  }
  return { arms: arms.join(''), mark, branches, valve: tee !== 0, plan };
}
