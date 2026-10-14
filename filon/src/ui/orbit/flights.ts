// flights.ts — cargo pods on the Crier's routes in the orbital view. A pod climbs from where
// the goods are (the cirque for a sale, the supplying colony for a purchase) to the Crier's
// station on the ring, docks a moment, then descends to where they go (a buying colony, or the
// cirque). Each leg is a cubic Bézier in view space: up from the ground, curving over to the
// station, and the mirror on the way down; legs take 1.2–2.6 s of real time, eased so the pod
// lifts off and docks gently. Its vapour trail is a fading string of inked puffs.
import { C } from '@/render/art/tokens';
import { bezier, len3, mix3, scale, shown, sub, type V3 } from './globe';

/** Pods in the air at most; seconds a pod stays docked; trail sampling and lifetime. */
export const MAX_FLIGHTS = 24;
const DOCK_S = 0.45;
const TRAIL_EVERY = 0.032;
const TRAIL_LIFE = 0.85;
const TRAIL_MAX = 28;

type Leg = readonly [V3, V3, V3, V3];

export interface Flight {
  readonly kind: 'sell' | 'buy';
  /** Colony indices it flies from / to; −1 is the cirque. */
  readonly origin: number;
  readonly dest: number;
  readonly up: Leg;
  readonly down: Leg;
  readonly tUp: number;
  readonly tDown: number;
  /** Seconds since take-off (negative while waiting for its slot). */
  t: number;
  docked: boolean;
  landed: boolean;
  /** Last screen state: position (CSS px), heading (radians), depth, drawn or hidden. */
  x: number;
  y: number;
  z: number;
  ang: number;
  vis: boolean;
  /** Trail puffs: [x, y, age, shown] per puff, oldest first. */
  trail: number[];
  trailClock: number;
}

function legLength(l: Leg): number {
  let s = 0, prev = l[0];
  for (let i = 1; i <= 12; i++) {
    const p = bezier(l[0], l[1], l[2], l[3], i / 12);
    s += len3(sub(p, prev));
    prev = p;
  }
  return s;
}

const legTime = (l: Leg): number => Math.min(2.6, Math.max(1.2, 0.8 + 0.75 * legLength(l)));

/** A flight from ground point a to ground point b (unit vectors, view space) through the station. */
export function makeFlight(kind: 'sell' | 'buy', origin: number, dest: number, a: V3, b: V3, station: V3, delay: number): Flight {
  const a1 = scale(a, 1.45), b1 = scale(b, 1.45);
  const up: Leg = [a, a1, mix3(station, a1, 0.3), station];
  const down: Leg = [station, mix3(station, b1, 0.3), b1, b];
  return {
    kind, origin, dest, up, down, tUp: legTime(up), tDown: legTime(down),
    t: -delay, docked: false, landed: false, x: 0, y: 0, z: 0, ang: 0, vis: false, trail: [], trailClock: 0,
  };
}

/** Total duration of a flight (s). */
export const flightTime = (f: Flight): number => f.tUp + DOCK_S + f.tDown;

const ease = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** Where the pod is at its current time (view space), and which leg it is on (0 up, 1 docked, 2 down). */
export function flightAt(f: Flight): { p: V3; leg: 0 | 1 | 2 } {
  if (f.t < f.tUp) return { p: bezier(f.up[0], f.up[1], f.up[2], f.up[3], ease(f.t / f.tUp)), leg: 0 };
  if (f.t < f.tUp + DOCK_S) return { p: f.up[3], leg: 1 };
  const u = ease((f.t - f.tUp - DOCK_S) / f.tDown);
  return { p: bezier(f.down[0], f.down[1], f.down[2], f.down[3], u), leg: 2 };
}

/**
 * Advance a flight by dt and place it on screen with `toPx` (view space → CSS px). Returns what
 * happened this step: 'dock' when it reaches the station, 'land' when it touches down.
 */
export function stepFlight(f: Flight, dt: number, toPx: (p: V3) => readonly [number, number]): 'dock' | 'land' | null {
  f.t += dt;
  // Age the trail whatever happens.
  for (let i = 2; i < f.trail.length; i += 4) f.trail[i] = f.trail[i]! + dt;
  while (f.trail.length && f.trail[2]! > TRAIL_LIFE) f.trail.splice(0, 4);
  if (f.t < 0) { f.vis = false; return null; }
  let ev: 'dock' | 'land' | null = null;
  const { p, leg } = flightAt(f);
  if (leg >= 1 && !f.docked) { f.docked = true; ev = 'dock'; }
  if (f.t >= flightTime(f) && !f.landed) { f.landed = true; ev = 'land'; }
  const [x, y] = toPx(p);
  const dx = x - f.x, dy = y - f.y;
  if (dx * dx + dy * dy > 0.04 && f.vis) f.ang = Math.atan2(dy, dx) + Math.PI / 2;
  else if (!f.vis) f.ang = Math.atan2(p[1] - f.up[0][1], p[0] - f.up[0][0]) + Math.PI / 2;
  f.x = x;
  f.y = y;
  f.z = p[2];
  f.vis = leg !== 1 && !f.landed && shown(p);
  f.trailClock -= dt;
  if (leg !== 1 && !f.landed && f.trailClock <= 0) {
    f.trailClock = TRAIL_EVERY;
    f.trail.push(x, y, 0, shown(p) ? 1 : 0);
    if (f.trail.length > TRAIL_MAX * 4) f.trail.splice(0, 4);
  }
  return ev;
}

/** A finished flight whose trail has blown away. */
export const flightDone = (f: Flight): boolean => f.landed && f.trail.length === 0;

/** Draw the vapour trail: inked puffs growing and fading behind the pod. */
export function drawTrail(g: CanvasRenderingContext2D, f: Flight, size: number): void {
  const tr = f.trail;
  if (!tr.length) return;
  g.save();
  g.lineWidth = 0.7;
  g.strokeStyle = C.ink;
  g.fillStyle = f.kind === 'sell' ? C.salt : C.ice;
  for (let i = 0; i < tr.length; i += 4) {
    if (!tr[i + 3]) continue;
    const k = tr[i + 2]! / TRAIL_LIFE;
    const r = size * (0.09 + 0.2 * Math.sqrt(k));
    g.globalAlpha = 0.8 * (1 - k) ** 1.3;
    g.beginPath();
    g.arc(tr[i]!, tr[i + 1]!, r, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha *= 0.55;
    g.stroke();
  }
  g.restore();
}
