// terminals.ts — where a power wire meets each building (D25): its terminal, a precise and
// visible point of its art — a porcelain insulator on a short service mast on a roof, the
// insulators on a pole's crossarm, the Heart's link masts, the charger's free bushing. One table,
// in each building's own unrotated frame (tiles x, y; height z in levels), read by the art (iso
// and plan recipes draw the terminal there) and by the wires (world/wire-geom `wireAnchor` hangs
// the wire there), so the two always agree, in both views and every rotation.
//
// Rotation follows the art: a building whose art turns (`turnsArt`: ports, a long footprint, an
// oriented look) has its terminals turned like its ports (`rotLocal`, the IsoFrame / Frame rule);
// one drawn the same way in every rotation keeps them where its rot-0 art has them.
import { BUILDINGS, type BuildingId } from '@/content/buildings';
import { buildingIdx } from '@/content/registry';
import type { BuildingDef } from '@/content/types';
import { linkable } from '@/sim/power/links';
import type { Rot } from '@/sim/types';

/**
 * A terminal: the point a wire clamps to, in the building's own unrotated frame — tiles x, y and
 * height z (levels). `base`: the roof a service mast stands on (the generic kit draws the mast,
 * its insulator and clamp from there up to z); absent, the recipe draws the terminal itself (a
 * pole's crossarm insulator, the Heart's link mast, a bushing). `hang`: the insulator hangs from
 * `base` down to z (a pylon's suspension string). `bias` (tiles): a head start when a wire picks
 * among several terminals — a pole's top pin takes the wires that run across its crossarm.
 */
export interface Terminal {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly base?: number;
  readonly hang?: boolean;
  readonly bias?: number;
}

/** The insulator on top of a terminal (levels): porcelain and clamp, under the clamp point. */
export const INSULATOR = 0.28;
/** Its clamp: the brass cap the wire is bolted to (levels, the top of `INSULATOR`). */
export const CLAMP = 0.07;
/** How much wider the kit's roof insulators are drawn than a pole's pins (they stand alone on a machine). */
export const KIT_K = 1.12;

/** A service mast on a roof at `base` (levels): a stem of `stem` levels, then the insulator. */
const roof = (x: number, y: number, base: number, stem = 0.27): Terminal => ({ x, y, z: base + stem + INSULATOR, base });

/** Top of the foundation slab most machines stand on (recipes/buildings.ts `SZ`). */
const SZ = 0.3;

// ── the poles' heads (recipes/buildings.ts and buildings-top.ts draw them from these) ─────────

/**
 * The pole (`mast`): a slim post up to `top`, a crossarm at `arm` along the tile diagonal
 * (1, −1) — level across the screen in iso — `half` tiles each side of the post, an insulator
 * pin `pin` tiles out on each side and one on the post's top.
 */
export const POLE = { cx: 0.5, cy: 0.5, top: 2.9, arm: 2.56, armH: 0.075, half: 0.4, pin: 0.3 } as const;
/** The pylon: a lattice from feet `foot` tiles out to its head at `arm`, a peak up to `apex`, a crossarm `half` tiles each side; suspension strings `string` levels long hang `pin` tiles out. */
export const PYLON = { cx: 1, cy: 1, foot: 0.7, apex: 6.2, arm: 5.3, armH: 0.14, half: 0.95, pin: 0.8, string: 0.6 } as const; // 2×2, about three tiles tall (D75)
/** The Heart's two link masts (local tiles): west, between its west ribbons, and east, point-symmetric; their insulator's clamp at `top`. */
export const HEART_MASTS = { top: 3.4, at: [[0.5, 2.0], [4.5, 3.0]] as ReadonlyArray<readonly [number, number]> } as const;
/** The charger's free bushing (the one with no bus bar to the rack), where its line comes in. */
export const CHARGER_BUSHING = { x: 0.42, y: 1.33, z: 1.8 } as const;

/**
 * A point `k` tiles along a pole's crossarm from (cx, cy) — the local tile diagonal (1, −1),
 * level across the screen in iso — and `j` tiles across it (towards the viewer, (1, 1)).
 */
export const onArm = (cx: number, cy: number, k: number, j = 0): [number, number] => [cx + (k + j) * Math.SQRT1_2, cy + (j - k) * Math.SQRT1_2];

/** Where every building that takes part in power takes its wires. */
export const TERMINALS: Readonly<Partial<Record<BuildingId, readonly Terminal[]>>> = {
  hearth: HEART_MASTS.at.map(([x, y]) => ({ x, y, z: HEART_MASTS.top })),
  drill: [roof(1.7, 0.36, 1.0)],
  deep_bore: [roof(0.5, 2.62, 1.15)],
  excavator: [roof(1.0, 2.2, 1.62)],
  pump: [roof(0.77, 0.74, 0.62, 0.72)],
  backfiller: [roof(1.6, 0.3, 2.15, 0.22)],
  sand_collector: [roof(1.76, 0.26, 0.9)],
  skydock: [roof(1.74, 2.02, 1.02)],
  wire_mill: [roof(0.8, 1.0, 0.55, 0.4)],
  workshop: [roof(1.72, 0.3, 1.0)], // on the electronics line's control cabinet
  press: [roof(0.3, 1.74, 1.05)],
  great_workshop: [roof(2.72, 1.25, 1.31, 0.3)],
  great_workshop_compact: [roof(1.75, 0.92, 1.18, 0.3)],
  tower_workshop: [roof(2.0, 2.0, 2.6)],
  ceramic_oven: [roof(1.6, 1.35, 1.45)],
  observatory: [roof(1.7, 1.08, 1.12, 0.22)], // the research lab: on its low instrument cabinet
  mast: [
    { x: POLE.cx, y: POLE.cy, z: POLE.top + INSULATOR, bias: 0.14 },
    ...[-POLE.pin, POLE.pin].map((k) => { const [x, y] = onArm(POLE.cx, POLE.cy, k); return { x, y, z: POLE.arm + POLE.armH + INSULATOR }; }),
  ],
  pylon: [-PYLON.pin, PYLON.pin].map((k) => { const [x, y] = onArm(PYLON.cx, PYLON.cy, k); return { x, y, z: PYLON.arm - PYLON.string, base: PYLON.arm, hang: true }; }),
  brazier: [roof(0.78, 1.8, 0.95, 0.3)],
  wind_flower: [roof(1.43, 1.43, 1.0, 0.22)],
  sun_bulb: [roof(1.65, 1.68, 0.75)],
  accumulator: [roof(1.0, 1.0, SZ, 1.1)],
  cell_charger: [CHARGER_BUSHING],
  fumarole_tap: [roof(0.35, 0.95, 1.0, 0.3)],
  sunheart: [roof(4.3, 4.3, 3.2)],
  trade_post: [roof(3.58, 1.42, 0.66, 0.25)], // on its power pedestal, a corner of its pad (recipes/buildings.ts `TP_PED`)
  // The research redesign and the second tier: on a cabinet, a power pack or a motor house.
  test_bench: [roof(1.66, 1.16, 1.25, 0.22)], // on the instrument rack
  data_collector: [roof(0.37, 1.7, 1.22, 0.22)],
  data_relay: [roof(2.62, 2.62, 1.0)],
  server: [roof(1.76, 1.62, 1.72, 0.2)],
  cooled_server: [roof(2.55, 2.58, 1.3, 0.22)],
  supercomputer: [roof(2.9, 1.1, 1.65, 0.3)],
  auto_lab: [roof(2.57, 1.95, 1.25, 0.22)],
  optics_workshop: [roof(1.74, 1.38, 1.6, 0.2)],
  scriptorium: [roof(2.7, 0.5, 1.0)],
  sifter: [roof(1.34, 1.07, 1.52, 0.2)],
  arc_furnace: [roof(1.76, 0.26, 1.15, 0.22)],
  wire_mill_double: [roof(1.0, 1.72, 0.95, 0.25)],
  forge_press: [roof(2.74, 2.3, 1.05)],
  etcher: [roof(2.67, 1.2, 1.15)],
  chip_fab: [roof(2.85, 3.2, 2.05, 0.25)],
  fast_drill: [roof(1.74, 1.7, 1.0)],
  giant_drill: [roof(2.55, 3.7, 1.35)],
  hp_pump: [roof(0.76, 1.76, 0.9, 0.3)],
  heavy_excavator: [roof(1.0, 2.2, 1.82)],
  big_dock: [roof(2.32, 2.6, 1.12)],
  pitch_turbine: [roof(1.43, 1.43, 1.0, 0.22)],
  big_turbine: [roof(2.12, 2.12, 1.45, 0.22)],
  heavy_accumulator: [roof(1.0, 1.0, 1.9, 0.2)],
  solar_farm: [roof(2.58, 2.56, 0.95)],
  solar_tower: [roof(2.36, 2.36, 0.9, 0.3)],
  cell_generator: [roof(1.71, 0.3, 1.2)],
};

/** The fallback art's terminal (a powered building with none of its own): a mast on its roof hatch. */
const fallbackTerminal = (def: BuildingDef): Terminal => roof(def.w / 2 + 0.16, def.h / 2 - 0.16, 1.48, 0.2);
const NONE: readonly Terminal[] = [];

/**
 * A building's terminals (local frame): its own; the fallback's for a building that takes part in
 * power without any (never empty then); none for one that takes no part in power (a smelter, a
 * silo, a routing block).
 */
export function terminalsOf(id: BuildingId): readonly Terminal[] {
  const own = TERMINALS[id];
  if (own) return own;
  return linkable(buildingIdx(id)) ? [fallbackTerminal(BUILDINGS[id] as BuildingDef)] : NONE;
}

/** Does the generic kit draw this terminal (a service mast on a roof), or does the recipe? */
export const kitDrawn = (t: Terminal): boolean => t.base !== undefined && !t.hang;

/** Asymmetric art without ports: directional routing blocks and bridges, rigs with a front. */
const ORIENTED: ReadonlySet<BuildingId> = new Set<BuildingId>(['drill', 'excavator', 'router', 'sorter', 'inverted_sorter', 'overflow_gate', 'underflow_gate', 'skybridge']);

/**
 * Does a building's art change with its rotation? Ports, a long footprint or an oriented look
 * get four drawings (the atlas bakes them); any other building is drawn once, at rot 0, and that
 * drawing serves every rotation — and so do its terminals.
 */
export function turnsArt(id: BuildingId): boolean {
  const def = BUILDINGS[id] as BuildingDef;
  return def.ports.length > 0 || def.w !== def.h || ORIENTED.has(id);
}

/** The rotation a building's art is drawn in, for a building placed at `rot`. */
export const artRot = (id: BuildingId, rot: Rot): Rot => (turnsArt(id) ? rot : 0);

/**
 * Continuous local coords of an unrotated w × h footprint → the rotated footprint's, a quarter
 * turn clockwise per step: the rule of IsoFrame.r / Frame.p (and of `rotatePoint` on tile
 * centres), so a terminal turns exactly as the art around it.
 */
export function rotLocal(x: number, y: number, w: number, h: number, rot: Rot): [number, number] {
  switch (rot) {
    case 0: return [x, y];
    case 1: return [h - y, x];
    case 2: return [w - x, h - y];
    case 3: return [y, w - x];
  }
}

/** Test hook: when set, every terminal the art draws reports its clamp point (local tiles, levels). */
export const terminalProbe: { fn: ((x: number, y: number, z: number) => void) | null } = { fn: null };
