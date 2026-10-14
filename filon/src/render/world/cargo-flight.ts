// cargo-flight.ts — the choreography of a CrierBelt cargo drone working a trade post's deck, as
// pure maths (no Pixi, no DOM: tested; world/cargo-view.ts places the sprites from it). Two
// sequences, in game seconds from the launch:
//
// · a sale ('sell'): the deck's lift opens (an iris) and brings a freight container up; the drone
//   comes straight down from the Ring, braking, and hovers over the deck; it pays out its four
//   cables to the container's lifting eyes, hooks it and strains — the engines burn harder, it
//   sags under the load — then hauls it up, slowly at first, the load swinging a little,
//   drifting downwind until both fade out high above;
// · a purchase ('buy'): the drone comes down with a container slung under it (the swing it
//   picked up dies out before touchdown), sets it on the deck, sags as the cables slacken,
//   unhooks, reels in and climbs away, lighter and faster; then the iris opens and the lift
//   takes the container in.
//
// `poseAt(side, age, out)` fills a Pose without allocating. Altitudes are iso world px above the
// deck's top: the drone's at its nozzles (its drawing's z 0), the container's at its base.
// The deck's place and height mirror the trade post's art (recipes/buildings.ts, `trade_post`).
import type { Rot } from '@/sim/types';
import { CARGO_DRONE, CONTAINER, craneCableZ } from '../art/recipes/cargo';
import { LH } from '../iso';

export type CargoSide = 'sell' | 'buy';

/**
 * The trade post's landing deck, mirrored from recipes/buildings.ts (`DECK_Z`, and the deck
 * cylinder at local (1.5, 1.55) of the unrotated 3 × 3 footprint, radius 0.98): keep in step.
 * `SLAB_Z` is its slab's top (`SZ` there), where the engines' plumes hit outside the deck.
 */
export const DECK_Z = 0.8;
export const DECK_X = 1.5, DECK_Y = 1.55;
export const SLAB_Z = 0.3;

/** A trade post's footprint as the sim places it: its corner, its size once rotated, its rotation. */
export interface CargoPad {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rot: Rot;
}

/** The deck's centre in tile coords: the local point turned with the footprint, as IsoFrame.r turns it. */
export function deckCentre(pad: CargoPad): [number, number] {
  const W = pad.rot & 1 ? pad.h : pad.w, H = pad.rot & 1 ? pad.w : pad.h; // unrotated size
  switch (pad.rot) {
    case 0: return [pad.x + DECK_X, pad.y + DECK_Y];
    case 1: return [pad.x + H - DECK_Y, pad.y + DECK_X];
    case 2: return [pad.x + W - DECK_X, pad.y + H - DECK_Y];
    default: return [pad.x + DECK_Y, pad.y + W - DECK_X];
  }
}

/** The container's height, the cable from the winches to its eyes when it hangs, the winches over the nozzles (px). */
const CH = CONTAINER.h * LH;
export const HANG = 3.6 * LH;
const WINCH = (craneCableZ(CARGO_DRONE) - CARGO_DRONE.zNozzle) * LH;
/** The drone's altitude when the load on its cables stands on the deck: it hovers there to hook it or set it down. */
export const HOVER = CH + HANG - WINCH;
/** Where the drone comes from (px over the deck: above the screen at any zoom), where it fades out climbing. */
const A0 = 30 * LH;
const FADE0 = 12 * LH, FADE1 = 26 * LH;
/** Downwind drift (tiles per level of climb, along the Sough), as the intro's crane leaves. */
const DRIFT = 0.1;

// A sale: the lift brings the container up, the drone arrives, pays out, hooks, strains, lifts off.
const S_OPEN = 0.35;
const S_RISE0 = 0.25, S_RISE1 = 1.35;
const S_SHUT0 = 1.45, S_SHUT1 = 1.8;
const S_ARRIVE0 = 0.5, S_ARRIVE1 = 3.9;
const S_PAY0 = 4.0, S_PAY1 = 4.7;
const S_HOOK = 4.75;
/** The container leaves the deck. */
export const LIFTOFF = 5.6;
/** The climb with the load: pull (px/s²) and first speed (px/s); heavy, slow to start. */
const S_G = 26, S_V = 4;

// A purchase: down with the load, set it down, unhook, reel in, climb away; the lift takes it in.
/** The container touches the deck. */
export const TOUCHDOWN = 3.7;
const B_UNHOOK = 4.0;
const B_REEL1 = 4.6;
const B_CLIMB = 4.35;
const B_G = 60, B_V = 10;
const B_OPEN0 = 4.75, B_OPEN1 = 5.1;
const B_SINK0 = 5.15, B_SINK1 = 6.3;
const B_SHUT0 = 6.35, B_SHUT1 = 6.7;
/** How far the drone sags as the cables slacken (px). */
const SLACK = 3;

/** Seconds of climb until the drone (and its load) has faded out. */
const fadeOut = (g: number, v: number): number => (-v + Math.sqrt(v * v + 4 * g * FADE1)) / (2 * g);

/** When each sequence is over (game seconds from the launch). */
export const SELL_END = LIFTOFF + fadeOut(S_G, S_V);
export const BUY_END = Math.max(B_CLIMB + fadeOut(B_G, B_V), B_SHUT1);
export const endOf = (side: CargoSide): number => (side === 'sell' ? SELL_END : BUY_END);

/**
 * When the next drone may start at the same deck, from this one's launch: once the deck is
 * clear and this drone is high and fading (so the two never cross on the way).
 */
export const followAfter = (side: CargoSide): number => (side === 'sell' ? LIFTOFF + 3.2 : B_SHUT1 + 0.1);

/** Everything the view needs at one instant. */
export interface Pose {
  /** The drone: altitude of its nozzles over the deck (px), opacity, downwind drift (× the Sough's vector, tiles). */
  drone: number;
  droneA: number;
  drift: number;
  /** The container: altitude of its base over the deck (px); how much of it is out of the iris (≤ 0 none, 1 all); opacity. */
  load: number;
  emerge: number;
  loadA: number;
  /** It hangs on the cables: it follows the drone and its drift. */
  hung: boolean;
  /** Its swing (rad; + = its bottom to the left on screen), a pendulum under the drone. */
  swing: number;
  /** Cables paid out: 0 at the winches, 1 down to the container's eyes. */
  cable: number;
  /** Engine burn, 0–1.5 (flame length, halos, dust). */
  burn: number;
  /** The deck's lift iris: 0 shut, 1 open. */
  hatch: number;
}

export const newPose = (): Pose => ({ drone: A0, droneA: 0, drift: 0, load: 0, emerge: 1, loadA: 0, hung: false, swing: 0, cable: 0, burn: 0, hatch: 0 });

const smooth = (a: number, b: number, v: number): number => {
  const k = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return k * k * (3 - 2 * k);
};

/** The container's opacity as it comes out of (or goes into) the iris: it fades at the deck's level. */
const throughHatch = (emerge: number): number => smooth(-0.04, 0.12, emerge);

/**
 * Fill `out` with the pose of a drone of this side, `age` seconds after its launch. Before 0 (it
 * waits its turn) it is its first pose, in which nothing shows yet.
 */
export function poseAt(side: CargoSide, age: number, out: Pose): Pose {
  out.drift = 0;
  out.swing = 0;
  return side === 'sell' ? sell(Math.max(0, age), out) : buy(Math.max(0, age), out);
}

function sell(t: number, out: Pose): Pose {
  // The lift: the iris opens, the container comes up out of it, the iris shuts under it.
  out.hatch = smooth(0, S_OPEN, t) * (1 - smooth(S_SHUT0, S_SHUT1, t));
  out.emerge = 1 - 1.15 * (1 - smooth(S_RISE0, S_RISE1, t));
  out.cable = smooth(S_PAY0, S_PAY1, t);
  if (t < LIFTOFF) {
    out.load = 0;
    out.loadA = throughHatch(out.emerge);
    out.hung = false;
    if (t < S_ARRIVE1) {
      // Straight down from the Ring, braking ever harder.
      const u = Math.max(0, (t - S_ARRIVE0) / (S_ARRIVE1 - S_ARRIVE0));
      out.drone = HOVER + (A0 - HOVER) * (1 - u) ** 2.15;
      out.droneA = t < S_ARRIVE0 ? 0 : smooth(0, 0.12, u);
      out.burn = 0.55 + 0.6 * smooth(0.3, 0.95, u);
      return out;
    }
    // Hovering (a breath of bob until the cables reach), then hooked: the engines strain, it sags and recovers.
    const bob = 1.2 * Math.sin((t - S_ARRIVE1) * 2.6) * (1 - smooth(S_PAY0, S_PAY1, t));
    const sag = 2.5 * smooth(S_HOOK, S_HOOK + 0.25, t) * (1 - smooth(LIFTOFF - 0.35, LIFTOFF, t));
    const tremble = 0.5 * Math.sin(t * 31) * smooth(S_HOOK, S_HOOK + 0.3, t) * (1 - smooth(LIFTOFF - 0.2, LIFTOFF, t));
    out.drone = HOVER + bob - sag + tremble;
    out.droneA = 1;
    out.burn = 0.85 + 0.3 * (1 - smooth(S_ARRIVE1, S_ARRIVE1 + 0.5, t)) + 0.6 * smooth(S_HOOK, LIFTOFF, t);
    return out;
  }
  // Up with the load, slow at first: heavy.
  const c = t - LIFTOFF;
  const climb = S_G * c * c + S_V * c;
  const fade = 1 - smooth(FADE0, FADE1, climb);
  out.drone = HOVER + climb;
  out.load = climb;
  out.hung = true;
  out.drift = (climb / LH) * DRIFT;
  out.swing = 0.13 * Math.sin(2.3 * c) * Math.exp(-0.32 * c);
  out.droneA = fade;
  out.loadA = fade;
  out.burn = 1.45 - 0.15 * smooth(0, 2, c);
  return out;
}

function buy(t: number, out: Pose): Pose {
  out.hatch = smooth(B_OPEN0, B_OPEN1, t) * (1 - smooth(B_SHUT0, B_SHUT1, t));
  out.emerge = 1 - 1.15 * smooth(B_SINK0, B_SINK1, t);
  if (t < TOUCHDOWN) {
    // Down with the load slung under it, braking; the swing dies out before touchdown.
    const u = t / TOUCHDOWN;
    out.load = A0 * (1 - u) ** 2.15;
    out.drone = out.load + HOVER;
    out.hung = true;
    out.swing = 0.1 * Math.sin(2 * t + 0.9) * (1 - smooth(1.4, 3.2, t));
    out.droneA = smooth(0, 0.1, u);
    out.loadA = out.droneA;
    out.cable = 1;
    out.burn = 0.6 + 0.65 * smooth(0.3, 0.95, u);
    return out;
  }
  // Down: the cables slacken (it sags), it unhooks and reels in, then climbs away light.
  out.load = 0;
  out.loadA = throughHatch(out.emerge);
  out.hung = false;
  out.cable = t < B_UNHOOK ? 1 : 1 - smooth(B_UNHOOK, B_REEL1, t);
  const slack = SLACK * smooth(TOUCHDOWN, B_UNHOOK, t);
  const c = Math.max(0, t - B_CLIMB);
  const climb = B_G * c * c + B_V * c;
  out.drone = HOVER - slack + climb;
  out.drift = (climb / LH) * DRIFT;
  out.droneA = 1 - smooth(FADE0, FADE1, climb);
  out.burn = 1.25 - 0.4 * smooth(TOUCHDOWN, B_UNHOOK, t) + 0.3 * smooth(B_CLIMB, B_CLIMB + 0.3, t);
  return out;
}
