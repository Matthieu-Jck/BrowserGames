// migrate.ts — versioned migrations of the payload (SaveData.v), chained one step at a time:
// `MIGRATIONS[v]` turns a version-v save into a version-(v+1) one. Changing the save's shape means
// bumping SAVE_VERSION (sim/serialize.ts) and adding the step here with a test on a fixture; the
// persist layer keeps a « pre-migration » copy before running any. Content changes (an item, a
// building or a recipe inserted, renamed, removed) need no migration: saves carry their content
// table and are re-pointed by id on load (sim/save-remap.ts, D47).
import { BUILDINGS } from '@/content/buildings';
import { BUILDING_IDS } from '@/content/registry';
import { CENTER, WORLD } from '@/sim/constants';
import { packRuns } from '@/sim/flow/chain';
import { MapGen } from '@/sim/world/mapgen';
import { SAVE_VERSION, type SaveData } from '@/sim/serialize';
import { RESEARCH_RENAMED, TIER2_UP_V10 } from '@/content/retired';

/** A step from version v to v + 1 (input: a parsed save of version v). */
export type Migration = (d: Record<string, unknown>) => Record<string, unknown>;

/**
 * A grid of `size`-tile parcels centred on the Heart, as world/land.ts lays it: frozen here by
 * size, so a step keeps the grid of its own versions whatever `BAL.land.parcel` becomes.
 */
function parcelGrid(size: number): { at: (x: number, y: number) => number; ring: (p: number) => number; centre: (p: number) => [number, number] } {
  const half = size >> 1, home = Math.ceil((CENTER - half) / size), origin = CENTER - half - home * size;
  const cols = Math.floor((WORLD - 1 - origin) / size) + 1;
  const cell = (p: number): [number, number] => { const c = p % cols; return [c, (p - c) / cols]; };
  return {
    at: (x, y) => Math.floor((y - origin) / size) * cols + Math.floor((x - origin) / size),
    ring: (p) => { const [c, r] = cell(p); return Math.max(Math.abs(c - home), Math.abs(r - home)); },
    centre: (p) => { const [c, r] = cell(p); return [origin + c * size + half, origin + r * size + half]; },
  };
}
/** The 16-tile parcels of saves 3–8 (D60) and the 23-tile ones from save 9 (D74). */
const GRID16 = parcelGrid(16), GRID23 = parcelGrid(23);

type V1Chain = { tier: number; head: number; len: number; runs?: number[]; cells?: number[]; credit?: unknown };

/**
 * 1 → 2, the tile-by-tile ribbons (D57): a ribbon's parcels become cells, one item per tile — the
 * whole items packed from its head back in their order; what does not fit and the parts of items
 * go to the Heart's stock (nothing vanishes). Conduits keep their runs. The throughput credits go.
 */
export function ribbonsToCells(d: Record<string, unknown>): Record<string, unknown> {
  const table = (d.content as { buildings?: string[] } | undefined)?.buildings ?? (BUILDING_IDS as readonly string[]);
  const stock = [...((d.stock as number[] | undefined) ?? [])];
  const conduit = (tier: number): boolean => {
    const id = table[tier];
    return !!id && (BUILDINGS as Record<string, { kind: string }>)[id]?.kind === 'conduit';
  };
  const chains = ((d.chains as V1Chain[] | undefined) ?? []).map((c) => {
    const { credit: _credit, ...rest } = c;
    if (conduit(c.tier) || rest.cells) return rest;
    const cells = packRuns(rest.runs ?? [], rest.len, (it, mu) => { stock[it] = (stock[it] ?? 0) + mu; });
    const { runs: _runs, ...key } = rest;
    return { ...key, cells };
  });
  return { ...d, chains, stock };
}

/**
 * 2 → 3, land in parcels (D60, docs/land.md): the influence zones' reclaimed tiles go, and the
 * claim is granted every parcel a building that needs land stands on (waystations included: the
 * remap then takes them down, refunded, their stores to the Heart — `RETIRED_COSTS`), so no base
 * loses a machine to the change. Granted parcels raise no price.
 */
export function zonesToParcels(d: Record<string, unknown>): Record<string, unknown> {
  const table = (d.content as { buildings?: string[] } | undefined)?.buildings ?? (BUILDING_IDS as readonly string[]);
  const defs = BUILDINGS as Record<string, { w: number; h: number; needsZone?: boolean; kind: string }>;
  const ents = (d.ents as number[] | undefined) ?? [];
  const granted = new Set<number>();
  for (let i = 0; i + 6 < ents.length; i += 7) {
    const id = table[ents[i + 1]!], x = ents[i + 2]!, y = ents[i + 3]!, rot = ents[i + 4]!;
    const b = id ? defs[id] : undefined;
    const needs = id === 'outpost' || !!b?.needsZone;
    if (!needs) continue;
    const w = b ? (rot & 1 ? b.h : b.w) : 3, h = b ? (rot & 1 ? b.w : b.h) : 3;
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) granted.add(GRID16.at(tx, ty));
  }
  const { claimed: _claimed, ...rest } = d;
  return { ...rest, land: { bought: [], granted: [...granted].sort((a, b) => a - b), leases: [] } };
}

/**
 * 3 → 4, the trade post's flame apron (D62): the 3×3 post became a 5×5 pad with one entrance and
 * one exit, which cannot grow in place over what stands round it. Saved posts come down — their
 * content id retired (`trade_post_3x3`: the remap refunds them and hands their containers to the
 * Heart) — with the export streams and standing orders that were theirs; goods in flight to them
 * land in the Heart (`tradeEpoch`: a post gone). The claim places the new pad.
 */
export function postsToPads(d: Record<string, unknown>): Record<string, unknown> {
  const content = d.content as { buildings?: string[] } | undefined;
  if (!content?.buildings?.includes('trade_post')) return d;
  const table = content.buildings.map((id) => (id === 'trade_post' ? 'trade_post_3x3' : id));
  const trade = d.trade as { exports?: unknown[]; orders?: unknown[] } | undefined;
  return {
    ...d,
    content: { ...content, buildings: table },
    ...(trade ? { trade: { ...trade, exports: [], orders: [] } } : {}),
  };
}

/**
 * 4 → 5, the trade post without export streams (D64): its entrance takes, and it sells, every
 * tradable item but its cargo — what it bought and holds or awaits. A post's cargo is what its
 * orders buy, what is on its way to it, and what its container holds that its streams did not
 * sell (its purchases); the streams go. A post's stock of a stream item stays in its store and is
 * sold at the next lift, as before.
 */
export function streamsToCargo(d: Record<string, unknown>): Record<string, unknown> {
  const trade = d.trade as { exports?: Array<[number, number[]]>; orders?: Array<{ post: number; item: number }>; inflight?: Array<{ post: number; item: number }> } | undefined;
  if (!trade) return d;
  const { exports = [], ...rest } = trade;
  const cargo = new Map<number, Set<number>>();
  const add = (post: number, it: number): void => { let s = cargo.get(post); if (!s) cargo.set(post, (s = new Set())); s.add(it); };
  for (const o of trade.orders ?? []) add(o.post, o.item);
  for (const s of trade.inflight ?? []) add(s.post, s.item);
  const sells = new Map(exports.map(([post, items]) => [post, items] as const));
  // The trade posts, by the save's own building table (7 numbers an entity: id, def, x, y, rot, cfg, builtAt).
  const table = (d.content as { buildings?: string[] } | undefined)?.buildings ?? (BUILDING_IDS as readonly string[]);
  const ents = (d.ents as number[] | undefined) ?? [];
  const posts = new Set<number>();
  for (let i = 0; i + 6 < ents.length; i += 7) {
    const id = table[ents[i + 1]!];
    if (id && (BUILDINGS as Record<string, { kind: string }>)[id]?.kind === 'trade') posts.add(ents[i]!);
  }
  for (const [id, st] of (d.stores as Array<[number, number[]]> | undefined) ?? []) {
    if (!posts.has(id)) continue;
    st.forEach((mu, it) => { if (mu > 0 && !(sells.get(id) ?? []).includes(it)) add(id, it); });
  }
  return {
    ...d,
    trade: { ...rest, cargo: [...cargo].sort((a, b) => a[0] - b[0]).map(([post, s]) => [post, [...s].sort((a, b) => a - b)]) },
  };
}

/**
 * 5 → 6, the big pylon (D75, owner 2026-10-14: "le pylon est trop petit… qu'il fasse 2x2 de large
 * et 2 voir 3 de haut"): the 1×1 pylons cannot grow in place over what stands round them. Their
 * content id becomes `pylon_1x1`, retired: the remap takes them down, refunded at their cost, and
 * their wires go with them (the player rebuilds the line with the new pylons, which reach 40).
 */
export function pylonsToTowers(d: Record<string, unknown>): Record<string, unknown> {
  const content = d.content as { buildings?: string[] } | undefined;
  if (!content?.buildings?.includes('pylon')) return d;
  return { ...d, content: { ...content, buildings: content.buildings.map((id) => (id === 'pylon' ? 'pylon_1x1' : id)) } };
}

/**
 * 6 → 7, research on data files and AI tokens and the tiered tree (D68–D70): the research a base
 * learnt under an id that changed is held under its successor(s) (`RESEARCH_RENAMED`; a node
 * gone without one is dropped: it unlocked no building), and so are the projects running under
 * them (one renamed into a node already learnt or running goes). The projects themselves are
 * rebased on today's costs when the base loads (serialize.ts: they carry no tokens yet).
 */
export function researchToTokens(d: Record<string, unknown>): Record<string, unknown> {
  const rename = (id: string): readonly string[] => RESEARCH_RENAMED[id] ?? [id];
  const done = new Set<string>();
  for (const id of (d.done as string[] | undefined) ?? []) for (const n of rename(id)) done.add(n);
  const running = new Set<string>();
  const projects = ((d.projects as Array<{ id: string }> | undefined) ?? []).flatMap((p) => {
    if (p.id.startsWith('respec:')) return [p];
    const n = rename(p.id)[0];
    if (!n || done.has(n) || running.has(n)) return [];
    running.add(n);
    return [{ ...p, id: n }];
  });
  return { ...d, done: [...done].sort(), projects };
}

/**
 * 7 → 8, research without the spread penalty (D72, owner 2026-10-15): a project started under it
 * carries a cost and a duration grown (or cut) by what the claim owned. Its tokens are stripped,
 * so the load rebases it on the node's cost today as it does a project from before tokens
 * (serialize.ts): the data it paid and the time it ran kept as shares, the tokens of what it
 * already did taken as paid. Reconversions carry no node cost and stay as they are.
 */
export function researchAtBase(d: Record<string, unknown>): Record<string, unknown> {
  const projects = (d.projects as Array<{ id: string; tokens?: number; tokUsed?: number }> | undefined) ?? [];
  return {
    ...d,
    projects: projects.map((p) => {
      if (p.id.startsWith('respec:')) return p;
      const { tokens: _t, tokUsed: _u, ...rest } = p;
      return rest;
    }),
  };
}

/**
 * 8 → 9, a starting square of nine parcels (D74, owner 2026-10-15: « le joueur ne devrait posséder
 * que 9 parcelles… à peu près exactement le cirque »): parcels grow from 16 to 23 tiles a side and
 * the grant is the 3 × 3 round the Heart's (it was the Crown out to its farthest terrace: 5 × 5,
 * 7 × 7 round a map-1 Closed Cirque). Parcel ids move to the new grid:
 * - a bought parcel stays bought where its middle tile now falls (what it cost carried over, for
 *   Parcel Resale), or is refunded when that is the new starting square;
 * - a lease likewise, at its rent and due tick (two falling together: one lease, both rents); one
 *   falling on land held already is refunded its hour;
 * - every new parcel under a building that needs land, standing wholly on land the claim held, is
 *   granted — no base loses a machine; granted parcels raise no price.
 */
export function parcelsResized(d: Record<string, unknown>): Record<string, unknown> {
  const land = d.land as SaveData['land'] | undefined;
  // The old grant's rings, as world/land.ts measured them then (from the land's Crown).
  const crownReach = new MapGen(d.worldSeed as number, d.playerSeed as number, (d.mapV as number | undefined) ?? 1).crownReach;
  const reach16 = Math.ceil(Math.max(0, crownReach - 8) / 16);
  const bought16 = new Set(land?.bought ?? []), granted16 = new Set(land?.granted ?? []);
  const leases16 = new Map((land?.leases ?? []).map(([p, next, cents]) => [p, { next, cents }] as const));
  const paid16 = new Map(land?.paid ?? []);
  const held16 = (x: number, y: number): boolean => {
    const p = GRID16.at(x, y);
    return GRID16.ring(p) <= reach16 || bought16.has(p) || granted16.has(p) || leases16.has(p);
  };
  const inStart = (q: number): boolean => GRID23.ring(q) <= 1;
  let credits = d.credits as number;
  const bought = new Set<number>(), paid = new Map<number, number>();
  for (const p of [...bought16].sort((a, b) => a - b)) {
    const q = GRID23.at(...GRID16.centre(p)), cents = paid16.get(p);
    if (inStart(q)) { credits += cents ?? 0; continue; }
    bought.add(q);
    if (cents !== undefined) paid.set(q, (paid.get(q) ?? 0) + cents);
  }
  const leases = new Map<number, [number, number]>();
  for (const [p, l] of [...leases16].sort((a, b) => a[0] - b[0])) {
    const q = GRID23.at(...GRID16.centre(p));
    if (inStart(q) || bought.has(q)) { credits += l.cents; continue; }
    const was = leases.get(q);
    leases.set(q, was ? [Math.min(was[0], l.next), was[1] + l.cents] : [l.next, l.cents]);
  }
  const table = (d.content as { buildings?: string[] } | undefined)?.buildings ?? (BUILDING_IDS as readonly string[]);
  const defs = BUILDINGS as Record<string, { w: number; h: number; needsZone?: boolean }>;
  const ents = (d.ents as number[] | undefined) ?? [];
  const granted = new Set<number>();
  for (let i = 0; i + 6 < ents.length; i += 7) {
    const id = table[ents[i + 1]!], x = ents[i + 2]!, y = ents[i + 3]!, rot = ents[i + 4]!;
    const b = id ? defs[id] : undefined;
    if (!b?.needsZone) continue;
    const w = rot & 1 ? b.h : b.w, h = rot & 1 ? b.w : b.h;
    let held = true;
    for (let ty = y; ty < y + h && held; ty++) for (let tx = x; tx < x + w; tx++) if (!held16(tx, ty)) { held = false; break; }
    if (!held) continue; // asleep off the claim's land before: it stays so
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
      const q = GRID23.at(tx, ty);
      if (!inStart(q) && !bought.has(q) && !leases.has(q)) granted.add(q);
    }
  }
  const asc = (a: number, b: number): number => a - b;
  return {
    ...d,
    credits,
    land: {
      bought: [...bought].sort(asc),
      granted: [...granted].sort(asc),
      leases: [...leases].sort((a, b) => a[0] - b[0]).map(([q, [next, cents]]) => [q, next, cents]),
      paid: [...paid].sort((a, b) => a[0] - b[0]),
    },
  };
}

/**
 * 9 → 10, the 3×3 research lab (D84, owner 2026-10-15: "the research lab should be 3x3"): a 2×2
 * lab cannot grow in place over what stands round it (its data line comes in at its back). Its
 * content id becomes `observatory_2x2`, retired: the remap takes it down, refunded at its cost,
 * the files in its store handed to the Heart, its wires gone, and its project cancelled as taking
 * a lab down cancels it — the data it had paid back to the Heart.
 */
export function labsToThree(d: Record<string, unknown>): Record<string, unknown> {
  const content = d.content as { buildings?: string[] } | undefined;
  if (!content?.buildings?.includes('observatory')) return d;
  return { ...d, content: { ...content, buildings: content.buildings.map((id) => (id === 'observatory' ? 'observatory_2x2' : id)) } };
}

/**
 * 10 → 11, the tree's arc (D93): the Synthesis (`tr_synth`) closes Tier 1 — it needs every other
 * Tier 1 node and gives the Core's level 3 — and opens Tier 2 with two expertises chosen. A claim
 * that already holds a node of Tier 2 or beyond (learnt, or under way) holds the Synthesis too: its
 * Tier 2 stays open (`tierTwoOpen` also counts such a node), and the nodes it hangs from stay met.
 * The expertises themselves start empty: a field with its default (nothing earned; the feats read
 * the counters the save already holds at the first minute's boundary).
 */
export function expertiseArc(d: Record<string, unknown>): Record<string, unknown> {
  const done = (d.done as string[] | undefined) ?? [];
  const running = ((d.projects as Array<{ id: string }> | undefined) ?? []).map((p) => p.id);
  if (done.includes('tr_synth') || ![...done, ...running].some((id) => TIER2_UP_V10.has(id))) return d;
  return { ...d, done: [...done, 'tr_synth'].sort() };
}

/**
 * 11 → 12, the Electric Smelting (D106): a Tier 1 node of Machines, `dn_esmelt`, between the
 * Compact Machines and the Twin Wire Mill, and the arc furnace's recipes now unlock with it (the
 * electric smelter runs them too). A claim that holds a node hanging from it — the twin wire mill
 * or the Synthesis (which every Tier 2 claim holds since 10 → 11), learnt or under way — holds it
 * too: the nodes it already has stay met, and its arc furnaces keep their recipes.
 */
export function electricSmelting(d: Record<string, unknown>): Record<string, unknown> {
  const done = (d.done as string[] | undefined) ?? [];
  const running = ((d.projects as Array<{ id: string }> | undefined) ?? []).map((p) => p.id);
  if (done.includes('dn_esmelt') || ![...done, ...running].some((id) => id === 'dn_wiremill' || id === 'tr_synth')) return d;
  return { ...d, done: [...done, 'dn_esmelt'].sort() };
}

/**
 * 12 → 13, the tutorial's first lab on the Core's own data (D101): the data collector now comes with
 * « Traitement des données » (`an_data`), no longer with the lab's plan, and the Face Cutter
 * (`ex_quartz`) is a plan, no longer a research. A claim holding the lab's plan holds `an_data` too,
 * so the collectors it has stand and it may still build them; a Face Cutter under way or queued is
 * its plan taken. A project of either goes (`an_data` learnt, `ex_quartz` no longer researched), the
 * data it had paid back to the Heart — nothing vanishes. Ids frozen here: the tree may change.
 */
export function coreData(d: Record<string, unknown>): Record<string, unknown> {
  const done = (d.done as string[] | undefined) ?? [];
  const projects = (d.projects as Array<{ id: string; cost?: number[]; paid?: number[] }> | undefined) ?? [];
  const queue = (d.labQueue as Array<[number, string]> | undefined) ?? [];
  const grant = new Set<string>();
  if (done.includes('observatory') && !done.includes('an_data')) grant.add('an_data');
  if (!done.includes('ex_quartz') && (projects.some((p) => p.id === 'ex_quartz') || queue.some(([, id]) => id === 'ex_quartz'))) grant.add('ex_quartz');
  // A project of a node granted, or of the Face Cutter (no longer a research), whatever its state.
  const goes = (id: string): boolean => grant.has(id) || id === 'ex_quartz';
  if (!grant.size && !projects.some((p) => goes(p.id)) && !queue.some(([, id]) => goes(id))) return d;
  const stock = [...((d.stock as number[] | undefined) ?? [])];
  for (const p of projects) {
    if (!goes(p.id)) continue;
    (p.paid ?? []).forEach((mu, i) => { const it = p.cost?.[2 * i]; if (it !== undefined && mu > 0) stock[it] = (stock[it] ?? 0) + mu; });
  }
  return {
    ...d,
    done: [...new Set([...done, ...grant])].sort(),
    stock,
    ...(d.projects ? { projects: projects.filter((p) => !goes(p.id)) } : {}),
    ...(d.labQueue ? { labQueue: queue.filter(([, id]) => !goes(id)) } : {}),
  };
}

/**
 * 13 → 14, a sensible tree (D107): the Fast Drill (`ex_fastdrill`, a Tier 2 node before) and the
 * second trade post (`cm_post2`, new) are of Tier 1, which the Synthesis closes whole (D93). A claim
 * that holds the Synthesis (learnt or under way) holds them too, so its Tier 1 stays whole and the
 * Synthesis's prerequisites met. Nothing else moves: a node moved to another tier keeps its id, a
 * project keeps the cost it started at. Ids frozen here: the tree may change, this step may not.
 */
export function tierOneWhole(d: Record<string, unknown>): Record<string, unknown> {
  const done = (d.done as string[] | undefined) ?? [];
  const running = ((d.projects as Array<{ id: string }> | undefined) ?? []).map((p) => p.id);
  if (!done.includes('tr_synth') && !running.includes('tr_synth')) return d;
  const grant = ['ex_fastdrill', 'cm_post2'].filter((id) => !done.includes(id));
  if (!grant.length) return d;
  // A project of a node granted goes, the data it had paid back to the Heart (nothing vanishes).
  const projects = (d.projects as Array<{ id: string; cost?: number[]; paid?: number[] }> | undefined) ?? [];
  const queue = (d.labQueue as Array<[number, string]> | undefined) ?? [];
  const stock = [...((d.stock as number[] | undefined) ?? [])];
  for (const p of projects) {
    if (!grant.includes(p.id)) continue;
    (p.paid ?? []).forEach((mu, i) => { const it = p.cost?.[2 * i]; if (it !== undefined && mu > 0) stock[it] = (stock[it] ?? 0) + mu; });
  }
  return {
    ...d,
    done: [...done, ...grant].sort(),
    ...(projects.some((p) => grant.includes(p.id)) ? { stock, projects: projects.filter((p) => !grant.includes(p.id)) } : {}),
    ...(queue.some(([, id]) => grant.includes(id)) ? { labQueue: queue.filter(([, id]) => !grant.includes(id)) } : {}),
  };
}

export const MIGRATIONS: Readonly<Record<number, Migration>> = { 1: ribbonsToCells, 2: zonesToParcels, 3: postsToPads, 4: streamsToCargo, 5: pylonsToTowers, 6: researchToTokens, 7: researchAtBase, 8: parcelsResized, 9: labsToThree, 10: expertiseArc, 11: electricSmelting, 12: coreData, 13: tierOneWhole };

export class SaveTooNew extends Error {
  constructor(readonly version: number) { super(`save version ${version} is newer than this build (${SAVE_VERSION})`); }
}

/** The save at `target`, and the version it came from. Throws on a newer save or a missing step. */
export function migrate(d: { v: number }, target = SAVE_VERSION, steps: Readonly<Record<number, Migration>> = MIGRATIONS): { data: SaveData; from: number } {
  const from = d.v;
  if (from > target) throw new SaveTooNew(from);
  let cur = d as unknown as Record<string, unknown>;
  for (let v = from; v < target; v++) {
    const step = steps[v];
    if (!step) throw new Error(`no migration from save version ${v}`);
    cur = { ...step(cur), v: v + 1 };
  }
  return { data: cur as unknown as SaveData, from };
}
