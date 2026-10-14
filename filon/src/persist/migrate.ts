// migrate.ts — versioned migrations of the payload (SaveData.v), chained one step at a time:
// `MIGRATIONS[v]` turns a version-v save into a version-(v+1) one. Changing the save's shape means
// bumping SAVE_VERSION (sim/serialize.ts) and adding the step here with a test on a fixture; the
// persist layer keeps a « pre-migration » copy before running any. Content changes (an item, a
// building or a recipe inserted, renamed, removed) need no migration: saves carry their content
// table and are re-pointed by id on load (sim/save-remap.ts, D47).
import { BUILDINGS } from '@/content/buildings';
import { BUILDING_IDS } from '@/content/registry';
import { packRuns } from '@/sim/flow/chain';
import { parcelAt } from '@/sim/world/land';
import { SAVE_VERSION, type SaveData } from '@/sim/serialize';

/** A step from version v to v + 1 (input: a parsed save of version v). */
export type Migration = (d: Record<string, unknown>) => Record<string, unknown>;

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
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) granted.add(parcelAt(tx, ty));
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

export const MIGRATIONS: Readonly<Record<number, Migration>> = { 1: ribbonsToCells, 2: zonesToParcels, 3: postsToPads };

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
