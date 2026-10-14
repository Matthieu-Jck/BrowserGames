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
import type { Ent, Rot } from '@/sim/types';
import { beltKey, type Atlas } from '../art/atlas';
import { BELT_TIERS, type BeltTier } from '../art/recipes/belts';
import { layBelt } from './buildings-view';
import { tileTop } from '../relief';

/** The ribbon under a junction: its tier and the way it runs (east or west). */
export interface UnderPass { tier: BeltTier; rot: Rot }

const isLine = (e: Ent | undefined): e is Ent => {
  const k = e ? BUILDING_KIND[e.def] : undefined;
  return !!e && e.builtAt === 0 && (k === 'belt' || k === 'conduit' || k === 'bridge');
};

/**
 * The line running under the junction at (x, y), from the ribbons in line with it east and west
 * (past any junctions next to it, as the engine looks across them): one running into it feeds it,
 * one running away from it is fed through it. Null when no ribbon runs on that axis.
 */
export function underPass(sim: Sim, x: number, y: number): UnderPass | null {
  const look = (dx: number): Ent | undefined => {
    let tx = x + dx;
    for (;;) {
      const o = sim.entityAt(tx, y);
      if (!o || BUILDING_KIND[o.def] !== 'crossing') return o ?? undefined;
      tx += dx;
    }
  };
  const w = look(-1), e = look(1);
  const tier = (o: Ent): BeltTier => { const id = BUILDING_IDS[o.def]!; return id in BELT_TIERS ? (id as BeltTier) : 'ribbon'; };
  if (isLine(w) && w.rot === 1) return { tier: tier(w), rot: 1 };
  if (isLine(e) && e.rot === 3) return { tier: tier(e), rot: 3 };
  if (isLine(e) && e.rot === 1) return { tier: tier(e), rot: 1 };
  if (isLine(w) && w.rot === 3) return { tier: tier(w), rot: 3 };
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
