// junctions-view.ts — the passage under each junction's little bridge. A junction is drawn as a
// humped bridge (its building sprite, art/recipes/buildings.ts `junctionIso`): the north–south
// line rides over its deck, the east–west line runs under it, through a tunnel in its body. The
// bridge's sprite is drawn over the items, and it leaves the line under it see-through: here the
// under line's own ribbon is laid on the ground across the junction's tile (on `belts`, with the
// ribbons), so the items passing under it ride a ribbon that goes on through the tunnel — seen
// through its mouth, and on both sides of the bridge in the plan view. A junction on rock has its
// passage on the column's top, just under its bridge (buildings-view.ts `layBelt`). Rebuilt on
// structural changes, with the items view (which owns it).
import type { Container, Sprite } from 'pixi.js';
import { BUILDING_IDS, BUILDING_KIND } from '@/content/registry';
import type { Sim } from '@/sim/state';
import { worldPorts } from '@/sim/entities';
import type { Ent, Rot } from '@/sim/types';
import { beltKey, type Atlas } from '../art/atlas';
import { BELT_TIERS, type BeltTier } from '../art/recipes/belts';
import { layBelt } from './buildings-view';
import { tileTop } from '../relief';

/** The ribbon under a junction: its tier and the way it runs (east or west). */
export interface UnderPass { tier: BeltTier; rot: Rot }

const isLine = (e: Ent | undefined): boolean => {
  const k = e ? BUILDING_KIND[e.def] : undefined;
  return !!e && e.builtAt === 0 && (k === 'belt' || k === 'conduit' || k === 'bridge');
};

/**
 * The line running under the junction at (x, y), from what stands in line with it east and west
 * (past any junctions next to it, as the engine looks across them): a ribbon, or a building's port
 * facing the junction along that axis (a trade post's exit, a machine's input — the engine links a
 * port to what is past the junctions in front of it, compile.ts `across`). Something feeding the
 * junction sets the way (a ribbon running into it, a port giving out to it); failing that,
 * something fed through it (a ribbon running away, a port taking in). Null when nothing is on
 * that axis; the tier is the ribbon's, `ribbon` when only ports meet it.
 */
export function underPass(sim: Sim, x: number, y: number): UnderPass | null {
  const look = (dx: number): { o: Ent | undefined; tx: number } => {
    let tx = x + dx;
    for (;;) {
      const o = sim.entityAt(tx, y);
      if (!o || BUILDING_KIND[o.def] !== 'crossing') return { o: o ?? undefined, tx };
      tx += dx;
    }
  };
  const tierOf = (o: Ent): BeltTier => { const id = BUILDING_IDS[o.def]!; return id in BELT_TIERS ? (id as BeltTier) : 'ribbon'; };
  /** What a side does at the junction: 'in' feeds it, 'out' is fed by it, null nothing; and the tier if a ribbon. */
  const side = ({ o, tx }: { o: Ent | undefined; tx: number }, dx: number): { way: 'in' | 'out' | null; tier: BeltTier | null } => {
    if (!o) return { way: null, tier: null };
    const toward: Rot = dx < 0 ? 1 : 3; // the way running from this side into the junction
    if (isLine(o)) return { way: o.rot === toward ? 'in' : o.rot === ((toward + 2) & 3) ? 'out' : null, tier: tierOf(o) };
    if (BUILDING_KIND[o.def] === 'crossing') return { way: null, tier: null };
    let way: 'in' | 'out' | null = null;
    for (const p of worldPorts(o)) {
      if (p.y !== y || p.x !== tx || p.dir !== toward) continue;
      if (p.io === 'out') { way = 'in'; break; }
      way = 'out';
    }
    return { way, tier: null };
  };
  const wSide = side(look(-1), -1), eSide = side(look(1), 1);
  const tier = wSide.tier ?? eSide.tier ?? 'ribbon';
  if (wSide.way === 'in') return { tier, rot: 1 };
  if (eSide.way === 'in') return { tier, rot: 3 };
  if (eSide.way === 'out') return { tier, rot: 1 };
  if (wSide.way === 'out') return { tier, rot: 3 };
  return null;
}

export class JunctionsView {
  private sprites: Sprite[] = [];
  /** Passages laid (tests, perf). */
  count = 0;

  /** `layer`: the ribbons' ground layer; `lifted`: the volumes (iso px) and the plan (tile units), for junctions on rock. */
  constructor(private readonly layer: Container, private readonly atlas: Atlas, private readonly lifted?: { volumes: Container; plan: Container }) {}

  /** Lay the ribbon under every built junction a line runs under. */
  rebuild(sim: Sim): void {
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
    let n = 0;
    for (const e of sim.ents.map.values()) {
      if (BUILDING_KIND[e.def] !== 'crossing' || e.builtAt !== 0) continue;
      const pass = underPass(sim, e.x, e.y);
      const tex = pass ? this.atlas.textures.get(beltKey(pass.tier, false)) : undefined;
      if (!pass || !tex) continue;
      const lv = this.lifted ? tileTop(sim.grid, e.x, e.y) : 0;
      const to = { ground: this.layer, volumes: this.lifted?.volumes ?? this.layer, plan: this.lifted?.plan ?? this.layer };
      this.sprites.push(...layBelt(tex, e.x, e.y, pass.rot, false, lv, to, 0.05)); // laid as the ribbons are
      n++;
    }
    this.count = n;
  }
}
