// tween.ts — minimal tween/easing for cameras and meshes. No dependency.

export type Ease = (t: number) => number;
export const easeInOut: Ease = (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
export const easeOut: Ease = (t) => 1 - (1 - t) ** 3;
export const linear: Ease = (t) => t;

interface Tween {
  t: number;
  dur: number;
  ease: Ease;
  update(k: number): void;
  done?: () => void;
}

const active: Tween[] = [];

export function tween(dur: number, update: (k: number) => void, opts: { ease?: Ease; done?: () => void } = {}): void {
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
