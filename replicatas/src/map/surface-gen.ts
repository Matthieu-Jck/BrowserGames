// surface-gen.ts — pure (planet seedKey → node DAG) for one planet visit.
// Landing → 2 lanes × 1–2 ranks → Departure. Story planets get fixed strips.
import { makeRng } from '@/core/rng';
import { BAL } from '@/core/balance';
import type { PlanetSpec } from './planet-gen';

export type NodeKind =
  | 'landing' | 'combat' | 'elite' | 'event' | 'extraction'
  | 'fabricator' | 'forge' | 'boss' | 'departure';

export interface SurfaceNode {
  id: string;
  kind: NodeKind;
  col: number;
  row: number;
  next: string[];               // ids of reachable nodes
}

export interface SurfaceMap {
  nodes: Record<string, SurfaceNode>;
  start: string;
  end: string;
  cols: number;
}

export interface SurfaceGenOpts {
  planetIndex: number;
  forceForge: boolean;          // every 3rd planet + planets 9/19
  forceFabricator: boolean;     // at least once per 2 planets
}

export function genSurface(spec: PlanetSpec, opts: SurfaceGenOpts): SurfaceMap {
  const rng = makeRng(spec.seedKey + ':surface');

  // ---------------- fixed story strips
  if (spec.story === 'garden' || spec.story === 'foundry') {
    return strip(['landing', 'combat', 'forge', 'boss', 'departure']);
  }
  if (spec.story === 'act3') {
    const strips: NodeKind[][] = [
      ['landing', 'event', 'fabricator', 'departure'],          // Threshold Station
      ['landing', 'elite', 'forge', 'departure'],               // The Veil
      ['landing', 'combat', 'event', 'combat', 'departure'],    // The Echo Field
      ['landing', 'forge', 'boss', 'departure'],                // The Horizon
      ['landing', 'departure'],                                 // The Dive (scripted)
    ];
    return strip(strips[spec.act3Index ?? 0] ?? strips[0]!);
  }

  // ---------------- rolled surface
  const middleCount = BAL.surfaceNodes[spec.size];
  // column layout: distribute middle nodes into columns of width <=2
  const colSizes: number[] = [];
  let left = middleCount;
  while (left > 0) {
    const w = left === 1 ? 1 : 2;
    colSizes.push(w);
    left -= w;
  }

  // roll kinds with constraints
  const kinds: NodeKind[] = [];
  const mix = BAL.nodeMix;
  const wantElite = spec.size === 'rich' && opts.planetIndex > 2;
  for (let i = 0; i < middleCount; i++) {
    const pairs: Array<readonly [NodeKind, number]> = [
      ['combat', mix.combat],
      ['event', mix.event],
      ['extraction', mix.extraction],
      ['fabricator', mix.fabricator],
      ['forge', mix.forge],
      ['elite', opts.planetIndex <= 2 ? 0 : mix.elite],
    ];
    kinds.push(rng.weighted(pairs));
  }
  // constraints
  const count = (k: NodeKind): number => kinds.filter((x) => x === k).length;
  const replaceOne = (from: NodeKind | null, to: NodeKind): void => {
    // replace a node of `from` (or the most common kind) with `to`
    let idx = from ? kinds.indexOf(from) : -1;
    if (idx < 0) {
      // pick index of most frequent kind that isn't `to`
      const freq = new Map<NodeKind, number>();
      for (const k of kinds) freq.set(k, (freq.get(k) ?? 0) + 1);
      let best: NodeKind | null = null, bestN = -1;
      for (const [k, n] of freq) if (k !== to && n > bestN) { best = k; bestN = n; }
      idx = best ? kinds.indexOf(best) : 0;
    }
    if (idx >= 0) kinds[idx] = to;
  };
  if (spec.size !== 'moon' && count('combat') < 2) {
    while (count('combat') < 2) replaceOne(null, 'combat');
  }
  if (spec.type === 'derelict') {
    // no extraction on derelicts
    for (let i = 0; i < kinds.length; i++) if (kinds[i] === 'extraction') kinds[i] = 'combat';
  }
  if (wantElite && count('elite') === 0) replaceOne(null, 'elite');
  if (spec.size === 'rich' && spec.type !== 'derelict' && count('extraction') === 0) replaceOne('combat', 'extraction');
  if (opts.forceForge && count('forge') === 0) replaceOne(null, 'forge');
  if (opts.forceFabricator && count('fabricator') === 0) replaceOne(null, 'fabricator');
  if (count('elite') > 1) { // at most one elite
    let seen = false;
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] === 'elite') {
        if (seen) kinds[i] = 'combat';
        seen = true;
      }
    }
  }

  // build DAG
  const nodes: Record<string, SurfaceNode> = {};
  const start: SurfaceNode = { id: 'n_start', kind: 'landing', col: 0, row: 0, next: [] };
  nodes[start.id] = start;
  const shuffled = rng.shuffle(kinds);
  let ki = 0;
  const colNodes: SurfaceNode[][] = [[start]];
  for (let c = 0; c < colSizes.length; c++) {
    const colArr: SurfaceNode[] = [];
    for (let r = 0; r < colSizes[c]!; r++) {
      const n: SurfaceNode = { id: `n_${c + 1}_${r}`, kind: shuffled[ki++]!, col: c + 1, row: r, next: [] };
      nodes[n.id] = n;
      colArr.push(n);
    }
    colNodes.push(colArr);
  }
  const end: SurfaceNode = { id: 'n_end', kind: 'departure', col: colSizes.length + 1, row: 0, next: [] };
  nodes[end.id] = end;
  colNodes.push([end]);

  // edges: every node connects to 1-2 nodes in the next column; every next-col node reachable
  for (let c = 0; c < colNodes.length - 1; c++) {
    const cur = colNodes[c]!, nxt = colNodes[c + 1]!;
    for (const n of cur) {
      if (nxt.length === 1) { n.next.push(nxt[0]!.id); continue; }
      // connect to the same-row node, and sometimes cross
      const same = nxt[Math.min(n.row, nxt.length - 1)]!;
      n.next.push(same.id);
      if (rng.chance(0.45)) {
        const other = nxt[(Math.min(n.row, nxt.length - 1) + 1) % nxt.length]!;
        if (!n.next.includes(other.id)) n.next.push(other.id);
      }
    }
    // ensure every next node has an inbound edge
    for (const n of nxt) {
      if (!cur.some((p) => p.next.includes(n.id))) {
        cur[rng.int(0, cur.length - 1)]!.next.push(n.id);
      }
    }
  }

  return { nodes, start: start.id, end: end.id, cols: colNodes.length };

  function strip(kindsList: NodeKind[]): SurfaceMap {
    const ns: Record<string, SurfaceNode> = {};
    for (let i = 0; i < kindsList.length; i++) {
      const n: SurfaceNode = {
        id: i === 0 ? 'n_start' : i === kindsList.length - 1 ? 'n_end' : `n_${i}_0`,
        kind: kindsList[i]!, col: i, row: 0, next: [],
      };
      ns[n.id] = n;
    }
    const ids = Object.keys(ns);
    for (let i = 0; i < ids.length - 1; i++) ns[ids[i]!]!.next.push(ids[i + 1]!);
    return { nodes: ns, start: 'n_start', end: 'n_end', cols: kindsList.length };
  }
}
