// tween.ts — minimal tween/easing for UI and render motion (ported from agora). No dependency.

export type Ease = (t: number) => number;
export const linear: Ease = (t) => t;
export const easeInOut: Ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const easeOut: Ease = (t) => 1 - (1 - t) ** 3;
export const easeOutBack: Ease = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

interface Tween {
  t: number;
  dur: number;
  ease: Ease;
  update(k: number): void;
  done?: () => void;
}

const active: Tween[] = [];

export function tween(
  dur: number,
  update: (k: number) => void,
  opts: { ease?: Ease; done?: () => void } = {},
): void {
  active.push({ t: 0, dur, ease: opts.ease ?? easeInOut, update, done: opts.done });
}

export function updateTweens(dt: number): void {
  for (let i = active.length - 1; i >= 0; i--) {
    const tw = active[i]!;
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    tw.update(tw.ease(k));
    if (k >= 1) {
      active.splice(i, 1);
      tw.done?.();
    }
  }
}

// A tiny self-contained animatable scalar — handy for graph values that should
// glide toward a target every frame without a managed tween.
export class Spring {
  value: number;
  private target: number;
  private vel = 0;
  constructor(initial: number, private stiffness = 120, private damping = 22) {
    this.value = initial;
    this.target = initial;
  }
  set(target: number): void { this.target = target; }
  snap(value: number): void { this.value = value; this.target = value; this.vel = 0; }
  step(dt: number): number {
    const a = -this.stiffness * (this.value - this.target) - this.damping * this.vel;
    this.vel += a * dt;
    this.value += this.vel * dt;
    return this.value;
  }
}
