// neighbours-view.ts — the neighbouring bases on the land (D110; owner, 2026-10-17: « S'il y a un
// endroit possédé par un PNJ, il faut qu'il y ait vraiment une base »). The sim lays each base out
// from the seeds the first time something asks (sim/world/neighbours.ts); this view asks for those
// near the camera, once they are surveyed (their lift pad out of the fog), and hands each to the
// buildings view (its buildings, ribbons and flag, `BuildingsView.layForeign`) and the lights view
// (its lamps at night, `LightsView.layForeign`). A base laid stays laid — culled off screen with
// the claim's buildings — until another colony comes into play (the views' `foreignEpoch`).
// Checked when the view's range of parcels changes or the fog lifts, not every frame.
import { colonyEmblem } from '@/content/emblem';
import { emblemColor } from '../art/emblem';
import { mix, num } from '../art/tokens';
import { WORLD } from '@/sim/constants';
import type { Sim } from '@/sim/state';
import type { Ent } from '@/sim/types';
import { PARCEL } from '@/sim/world/land';
import type { BuildingsView } from './buildings-view';
import type { LightsView } from './lights-view';

/** The ghost entities' ids: out of the claim's range, 64 a base (its hub parcel's), under the buildings view's ranks. */
export const FOREIGN_ID0 = 12_000_000;
/** How far past the view a base is laid (tiles): a parcel and a half, so it is there before it shows. */
const MARGIN = PARCEL + (PARCEL >> 1);
/** How much of its emblem's colour a neighbouring base's buildings take: a hint that they are someone else's. */
const TINT = 0.16;

export class NeighboursView {
  private sim: Sim | null = null;
  private epochs = '';
  private sig = '';

  constructor(private readonly buildings: BuildingsView, private readonly lights: LightsView) {}

  /** Per frame, with the view's tile rect [x0, y0, x1, y1]. */
  update(sim: Sim, view: readonly [number, number, number, number]): void {
    const ep = `${this.buildings.foreignEpoch}:${this.lights.foreignEpoch}`;
    if (sim !== this.sim || ep !== this.epochs) { this.sim = sim; this.epochs = ep; this.sig = ''; }
    const x0 = Math.max(0, Math.floor(view[0]) - MARGIN), y0 = Math.max(0, Math.floor(view[1]) - MARGIN);
    const x1 = Math.min(WORLD, Math.ceil(view[2]) + MARGIN), y1 = Math.min(WORLD, Math.ceil(view[3]) + MARGIN);
    const sig = `${Math.floor(x0 / PARCEL)},${Math.floor(y0 / PARCEL)},${Math.floor(x1 / PARCEL)},${Math.floor(y1 / PARCEL)}:${sim.explored.length}`;
    if (sig === this.sig) return;
    this.sig = sig;
    for (const h of sim.neighbours.inRect(x0, y0, x1, y1)) {
      if (this.buildings.hasForeign(h.hub) && this.lights.hasForeign(h.hub)) continue;
      if (sim.land.neighbour(h.hub) < 0 && h.parcels.every((p) => sim.land.neighbour(p) < 0)) continue;
      const L = sim.neighbours.layout(h);
      const pad = L.structs[0];
      if (!pad || !sim.revealed(pad.x + 2, pad.y + 2)) continue; // still under the fog
      const base = FOREIGN_ID0 + h.hub * 64;
      const ents: Ent[] = L.structs.slice(0, 38).map((s, i) => ({ id: base + i, def: s.def, x: s.x, y: s.y, rot: s.rot, cfg: 0, builtAt: 0, portItems: [] }));
      const emblem = colonyEmblem(sim.worldSeed, h.colony);
      const tint = num(mix('#ffffff', emblemColor(emblem.field), TINT));
      this.buildings.layForeign(h.hub, ents, L.ribbons.slice(0, 20).map((r) => r.tiles), tint, L.flag ? { x: L.flag[0], y: L.flag[1], emblem } : null);
      this.lights.layForeign(h.hub, ents);
    }
  }
}
