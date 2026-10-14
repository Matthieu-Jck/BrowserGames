// freight.ts — skydocks, their drifters and the freight routes between docks. A route moves
// one item from dock to dock at the average throughput of its ships (space.ts: C / (2d/v + 2t)
// per ship), only while both docks are powered, never past the destination's capacity. Online
// it moves whole milli-items with a carry; the offline catch-up treats it as a pseudo-flow.
import { BAL } from '@/content/balance';
import { BUILDING_KIND, itemIdx } from '@/content/registry';
import { ReservoirNode } from '../flow/nodes';
import { dockShips, routeDistance, routeRate, type Route } from '../space';
import type { Sim } from '../state';

/** The dock reservoir of an entity, or null. */
export function dockNode(sim: Sim, id: number): ReservoirNode | null {
  const n = sim.graph?.nodeByEnt.get(id);
  return n instanceof ReservoirNode && BUILDING_KIND[sim.ents.get(id)?.def ?? -1] === 'dock' ? n : null;
}

/** A route's throughput (mu per tick) — zero while either dock is unpowered. */
export function routeRateNow(sim: Sim, r: Route, satOf: (net: number) => number): number {
  const a = dockNode(sim, r.from), b = dockNode(sim, r.to);
  if (!a || !b) return 0;
  if ((a.net < 0 ? 0 : satOf(a.net)) <= 0 || (b.net < 0 ? 0 : satOf(b.net)) <= 0) return 0;
  const ea = sim.ents.get(r.from)!, eb = sim.ents.get(r.to)!;
  return routeRate(r.ships, routeDistance(ea.x + 1, ea.y + 1, eb.x + 1, eb.y + 1, sim.mods), sim.mods);
}

/** Move a route's freight for `ticks` (online: whole mu with a carry). Returns the mu moved. */
export function moveFreight(sim: Sim, r: Route, ticks: number, satOf: (net: number) => number = (n) => sim.ctx.sat[n]!, exactMu = true): number {
  const a = dockNode(sim, r.from), b = dockNode(sim, r.to);
  if (!a || !b) return 0;
  const rate = routeRateNow(sim, r, satOf) * ticks;
  const room = Math.max(0, b.cap - b.stock[r.item]!);
  const want = r.carry + rate;
  let mv = Math.min(want, a.stock[r.item]!, room);
  if (exactMu) mv = Math.floor(mv);
  if (mv <= 0) { r.carry = rate > 0 && a.stock[r.item]! > 0 && room > 0 ? want : 0; return 0; }
  a.stock[r.item] = a.stock[r.item]! - mv;
  b.stock[r.item] = b.stock[r.item]! + mv;
  r.carry = mv < Math.floor(want) ? 0 : want - mv;
  return mv;
}

/** Buy a drifter for a dock (materials from the Hearth). */
export function buyDrifter(sim: Sim, dock: number): boolean {
  const e = sim.ents.get(dock);
  if (!e || BUILDING_KIND[e.def] !== 'dock' || e.builtAt !== 0) return false;
  if ((sim.fleet.get(dock) ?? 0) >= dockShips(sim.mods)) return false;
  const cost = Object.entries(BAL.drifterCost).map(([it, n]) => ({ item: itemIdx(it), mu: n * 1000 }));
  if (cost.some((c) => sim.stock[c.item]! < c.mu)) return false;
  for (const c of cost) sim.stock[c.item] = sim.stock[c.item]! - c.mu;
  sim.fleet.set(dock, (sim.fleet.get(dock) ?? 0) + 1);
  sim.log.push({ tick: sim.tick, cmd: { k: 'drifter', dock } });
  return true;
}

/** Ships of a dock not yet flying a route. */
export function freeShips(sim: Sim, dock: number): number {
  let used = 0;
  for (const r of sim.routes) if (r.from === dock) used += r.ships;
  return (sim.fleet.get(dock) ?? 0) - used;
}

/** Open a freight route between two docks with some of the origin's drifters (returns its id, 0 if refused). */
export function addRoute(sim: Sim, from: number, to: number, item: string, ships: number): number {
  if (from === to || !dockNode(sim, from) || !dockNode(sim, to) || ships <= 0 || ships > freeShips(sim, from)) return 0;
  const r: Route = { id: sim.nextRouteId++, from, to, item: itemIdx(item), ships, carry: 0 };
  sim.routes.push(r);
  sim.log.push({ tick: sim.tick, cmd: { k: 'route', from, to, item, ships } });
  return r.id;
}

export function removeRoute(sim: Sim, id: number): boolean {
  const i = sim.routes.findIndex((r) => r.id === id);
  if (i < 0) return false;
  sim.routes.splice(i, 1);
  sim.log.push({ tick: sim.tick, cmd: { k: 'unroute', id } });
  return true;
}

/** Online: every route moves one tick of freight. */
export function freightTick(sim: Sim): void {
  for (const r of sim.routes) moveFreight(sim, r, 1);
}
