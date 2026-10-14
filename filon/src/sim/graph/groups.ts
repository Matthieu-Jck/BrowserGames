// groups.ts — independent sub-graphs for the offline catch-up: connected components of the
// flow graph, cut at reservoirs (Hearth, silos, waystation stores). While a reservoir item is
// between its bounds, its inflows and outflows do not depend on its level, so each group
// evolves on its own and can be warmed up and extrapolated separately.
import { StateHasher } from '@/core/hash';
import type { Graph } from './compile';
import type { FNode } from '../flow/node';
import type { ReservoirNode } from '../flow/nodes';
import { GeneratorNode } from '../flow/nodes';
import { stepPeriod, type Chain } from '../flow/chain';

export interface Group {
  id: number;
  nodes: FNode[];
  /** Reservoirs this group trades with (indices into graph.reservoirs). */
  res: number[];
  /** Per touched reservoir: the group's edges into it and out of it. */
  resIn: Map<number, number[]>;
  resOut: Map<number, number[]>;
  nets: number[];
  gens: GeneratorNode[];
  /** Its nodes in the tick's accept order (graph `accOrder`: ribbons downstream first). */
  accOrder: FNode[];
  /** lcm of the rotation moduli used by fairness pointers and of its ribbons' step patterns (phase of `now` matters). */
  rotL: number;
  sig: string;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;

export function buildGroups(g: Graph): Group[] {
  const n = g.nodes.length;
  const isRes = (i: number): boolean => g.nodes[i]!.kind === 'reservoir';
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
  for (let e = 0; e < g.nE; e++) {
    const s = g.eSrc[e]!, d = g.eDst[e]!;
    if (isRes(s) || isRes(d)) continue;
    const a = find(s), b = find(d);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  }
  const resIndex = new Map<FNode, number>();
  g.reservoirs.forEach((r, i) => resIndex.set(r, i));
  const byRoot = new Map<number, Group>();
  const groups: Group[] = [];
  for (let i = 0; i < n; i++) {
    if (isRes(i)) continue;
    const r = find(i);
    let grp = byRoot.get(r);
    if (!grp) {
      grp = { id: groups.length, nodes: [], accOrder: [], res: [], resIn: new Map(), resOut: new Map(), nets: [], gens: [], rotL: 1, sig: '' };
      byRoot.set(r, grp);
      groups.push(grp);
    }
    const node = g.nodes[i]!;
    node.group = grp.id;
    grp.nodes.push(node);
    if (node instanceof GeneratorNode) grp.gens.push(node);
    if (node.net >= 0 && !grp.nets.includes(node.net)) grp.nets.push(node.net);
    if (node.inE.length > 1) grp.rotL = lcm(grp.rotL, node.inE.length);
    if (node.outE.length > 1) grp.rotL = lcm(grp.rotL, node.outE.length);
    // A ribbon steps on the world's clock: its pattern's phase is part of the group's state.
    if (node.kind === 'chain' && !(node as Chain).fluid) grp.rotL = lcm(grp.rotL, (node as Chain).period);
  }
  for (const node of g.accOrder) if (node.kind !== 'reservoir') groups[node.group]!.accOrder.push(node);
  // Boundary edges (one end in the group, the other a reservoir).
  for (let e = 0; e < g.nE; e++) {
    const s = g.eSrc[e]!, d = g.eDst[e]!;
    if (isRes(s) === isRes(d)) continue;
    const node = isRes(s) ? g.nodes[d]! : g.nodes[s]!;
    const res = (isRes(s) ? g.nodes[s]! : g.nodes[d]!) as ReservoirNode;
    const grp = groups[node.group]!;
    const ri = resIndex.get(res)!;
    if (!grp.res.includes(ri)) grp.res.push(ri);
    const map = isRes(s) ? grp.resOut : grp.resIn;
    let arr = map.get(ri);
    if (!arr) map.set(ri, (arr = []));
    arr.push(e);
  }
  for (const grp of groups) {
    grp.res.sort((a, b) => a - b);
    grp.nets.sort((a, b) => a - b);
    for (const ri of grp.res) {
      const r = g.reservoirs[ri]!;
      const nIn = grp.resIn.get(ri)?.length ?? 0, nOut = grp.resOut.get(ri)?.length ?? 0;
      if (nIn > 1) grp.rotL = lcm(grp.rotL, nIn);
      if (nOut > 1) grp.rotL = lcm(grp.rotL, nOut);
      // Its outlets hand out an item on their beat (the ribbons' clock): their phase is the group's too.
      if (nOut > 0 && r.portPerMin > 0) grp.rotL = lcm(grp.rotL, stepPeriod(r.portPerMin));
    }
    grp.sig = signature(g, grp);
  }
  return groups;
}

/** Structural signature: same topology + parameters ⇒ same dynamics (cache key part). */
function signature(g: Graph, grp: Group): string {
  const h = new StateHasher();
  for (const node of grp.nodes) {
    h.str(node.kind).int(node.ent).int(node.net).int(node.kw).int(node.idleKw);
    const any = node as unknown as Record<string, unknown>;
    if (node.kind === 'chain') {
      const c = node as Chain;
      h.int(c.tier).ints(c.tiles);
    }
    if (typeof any.speed === 'number') h.int(any.speed);
    if (typeof any.rateEp === 'number') h.int(any.rateEp);
    if (typeof any.outKw === 'number') h.int(any.outKw);
    if (node.kind === 'machine') h.int(((any.recipe as { idx: number } | null)?.idx ?? -1));
    if (node.kind === 'fork') {
      // Routing blocks: their logic, chosen item, buffer, which outputs go straight / aside, filters.
      h.str(String(any.mode)).int(any.sortItem as number).int(any.cap as number)
        .ints(any.fronts as number[]).ints(any.sides as number[]).ints((any.filters as number[]).map((x) => x + 1)).int(any.filtersOn ? 1 : 0);
    }
    for (const e of node.inE) h.int(g.eSrc[e]!).int(g.eSrcPort[e]!);
    for (const e of node.outE) h.int(g.eDst[e]!).int(g.eDstPort[e]!);
  }
  for (const ri of grp.res) h.int(ri).ints(g.reservoirs[ri]!.portItems.map((x) => x + 1));
  return h.digest();
}
