// work.ts — what a production building is doing this tick (D83; owner, 2026-10-15: « si une
// machine ne fonctionne pas […] il faut qu'elle ait un style distinct qui le montre »), read from
// the sim and never changing it: the renderer draws a building that does not work switched off
// (render/world/work-look.ts), and the debug bases are checked for buildings that stay off (D85:
// scenarios.ts `settle`, scenarios.test.ts). Rules per kind:
// - machines: crafting, powered (`Ok` / `LowPower`); drills, sand and data collectors, pumps:
//   extracting, powered; fuel generators: burning (dispatched, fuelled); research labs: a project
//   whose clock runs; servers, wind turbines, solar panels, geothermal plants: on a grid (a server
//   on a powered one).
// - A *passing* stop — inputs late (`Starved`), output backed up (`Blocked`), a generator not
//   called on (`Idle`) or waiting for fuel, a lab whose time is done waiting for data — is 'pause';
//   a hard stop — no recipe, no power, no grid, dormant, still being built — 'off'.
// - Logistics, the Heart and the excavator and backfiller (to be redesigned) are always 'on'.
// Beside the three states, one nuance (D91): `weakGrid` — a consumer at work on a grid under 100 %
// runs, but at that fraction of its pace. The look of work stays 'on' (it does work; D85's check
// and the switched-off look read the three states only); the inspector says « Au ralenti » in
// amber and the Production view counts it among the waiting, both with the Électricité view's
// half-bolt.
import { BUILDING_KIND } from '@/content/registry';
import type { BuildingKind } from '@/content/types';
import { DrillNode, GeneratorNode, MachineNode } from '../flow/nodes';
import { projectSat } from './research';
import type { Sim } from '../state';
import { St, type Ent } from '../types';

/** The satisfaction ‰ of a grid, 0 when the building is on none. */
const satOf = (sim: Sim, net: number): number => (net >= 0 ? sim.ctx.sat[net] ?? 0 : 0);

/** The kinds whose look says whether they work. */
export const LOOKS_AT_WORK: ReadonlySet<BuildingKind> = new Set<BuildingKind>([
  'machine', 'drill', 'pump', 'generator', 'geothermal', 'lab', 'server', 'wind', 'solar',
]);

/** Game ticks (4 s) a building in a passing stop keeps the look of work after it last worked. */
export const WORK_GRACE = 40;

/** At work; in a passing stop (inputs late, output backed up, not called on); stopped. */
export type Work = 'on' | 'pause' | 'off';

/** Does this building show whether it works? */
export const looksAtWork = (def: number): boolean => LOOKS_AT_WORK.has(BUILDING_KIND[def] as BuildingKind);

/** What a building is doing this tick, as its look reads it. */
export function workOf(sim: Sim, e: Ent): Work {
  if (e.builtAt !== 0 || sim.isDormant(e)) return 'off';
  const g = sim.graph;
  if (!g) return 'off';
  const sat = (net: number): number => satOf(sim, net);
  switch (BUILDING_KIND[e.def]) {
    case 'machine': {
      const n = g.nodeByEnt.get(e.id);
      if (!(n instanceof MachineNode)) return 'off';
      const s = n.status;
      // Ok without crafting: a craft just done and the next one's inputs not there yet.
      if ((s === St.Ok || s === St.LowPower) && n.crafting) return 'on';
      return s === St.Starved || s === St.Blocked || s === St.Ok || s === St.LowPower ? 'pause' : 'off';
    }
    case 'drill':
    case 'pump': {
      const n = g.nodeByEnt.get(e.id);
      if (!(n instanceof DrillNode)) return 'off';
      return n.status === St.Ok || n.status === St.LowPower ? 'on' : n.status === St.Blocked ? 'pause' : 'off';
    }
    case 'generator': {
      const n = g.nodeByEnt.get(e.id);
      if (!(n instanceof GeneratorNode) || n.net < 0) return 'off';
      return n.status === St.Ok ? 'on' : 'pause'; // not called on, or its fuel late
    }
    case 'lab': {
      const p = sim.projects.find((q) => q.lab === e.id);
      if (!p || projectSat(sim, p, sat) <= 0) return 'off';
      return p.el < p.dur * 1000 ? 'on' : 'pause'; // its time done, the data still owed
    }
    case 'server': {
      const net = g.netOfEnt.get(e.id);
      return net !== undefined && sat(net) > 0 ? 'on' : 'off';
    }
    case 'wind':
    case 'solar':
    case 'geothermal':
      return g.netOfEnt.get(e.id) !== undefined ? 'on' : 'off';
    default:
      return 'on';
  }
}

/**
 * The weak grid that slows a consumer (D91): the satisfaction ‰ (1…999) of the grid a machine,
 * drill, pump, lab or server draws from when that grid is under 100 % — it runs at that fraction of
 * its pace —, else 0 (served in full, on no grid or a dead one, or a building that makes power or
 * draws none). Whether it works is `workOf`'s: callers ask this only of a building at work.
 */
export function weakGrid(sim: Sim, e: Ent): number {
  const g = sim.graph;
  if (!g || e.builtAt !== 0) return 0;
  let s = 1000;
  switch (BUILDING_KIND[e.def]) {
    case 'machine': {
      const n = g.nodeByEnt.get(e.id);
      if (n instanceof MachineNode && n.needsPower) s = satOf(sim, n.net);
      break;
    }
    case 'drill':
    case 'pump': {
      const n = g.nodeByEnt.get(e.id);
      if (n instanceof DrillNode) s = satOf(sim, n.net);
      break;
    }
    case 'lab': {
      const p = sim.projects.find((q) => q.lab === e.id);
      if (p) s = projectSat(sim, p, (net) => satOf(sim, net));
      break;
    }
    case 'server':
      s = satOf(sim, g.netOfEnt.get(e.id) ?? -1);
      break;
    default:
      break;
  }
  return s > 0 && s < 1000 ? s : 0;
}
