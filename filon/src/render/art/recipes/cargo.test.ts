// cargo.test.ts — CrierBelt's freight machines: the sky-crane keeps the numbers the intro was
// drawn with; the cargo drone is the same drawing (port red, starboard green, the hub's LEDs) and
// draws without a canvas; the container fits the deck's iris and the iris the deck; the cables
// splay out from the container's eyes to the winches (so they show beside it); the container
// sunk all the way paints nothing.
import { describe, it, expect } from 'vitest';
import type { Ctx } from '../ink';
import { TP_DECK_R } from './buildings';
import { artOf } from './fx';
import {
  CARGO_DRONE, CONTAINER, DRONE_BAY, IRIS, IRIS_RIM, SKY_CRANE, containerEyes, containerFrame, craneCorners, craneFrame,
  drawContainer, drawCrane, drawHatch, hatchFrame,
} from './cargo';

/** A stand-in 2D context: draws nothing, counts fills. */
function counter(): { ctx: Ctx; fills: () => number } {
  let n = 0;
  const t: Record<string | symbol, unknown> = { fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, lineWidth: 1 };
  const ctx = new Proxy(t, {
    get(o, k): unknown {
      if (k === 'fill' || k === 'fillRect') return () => { n++; };
      if (k in o) return o[k];
      return () => undefined;
    },
    set(o, k, v): boolean { o[k] = v; return true; },
  });
  return { ctx: ctx as unknown as Ctx, fills: () => n };
}


describe('CrierBelt cranes', () => {
  it('the sky-crane keeps the intro’s numbers (the intro must look exactly as it was drawn)', () => {
    expect(SKY_CRANE).toEqual({ margin: 0.8, head: 7.8, eng: -0.3, hook: 0.3, zNozzle: 5.55, zFrame0: 6.5, zFrame1: 6.82, zHub: 7.15, k: 1 });
  });

  it('the cargo drone is the same drawing: red to port (left), green to starboard (right), LEDs on the hub', () => {
    for (const [g, w] of [[SKY_CRANE, 5], [CARGO_DRONE, DRONE_BAY]] as const) {
      const f = craneFrame(w, w, g);
      const [ax, ay] = f.p(g.margin + w / 2, g.margin + w / 2, g.zNozzle);
      const lights = artOf((ctx) => drawCrane(ctx, f, w, w, 7, g), ax, ay).emitters;
      const red = lights.filter((e) => e.glow === 'red'), green = lights.filter((e) => e.glow === 'green');
      expect(red.length).toBe(1);
      expect(green.length).toBe(1);
      expect(red[0]!.x).toBeLessThan(0);
      expect(green[0]!.x).toBeGreaterThan(0);
      expect(lights.filter((e) => e.glow === 'cold').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('the cargo drone’s parts stay inside its canvas', () => {
    const g = CARGO_DRONE;
    // The engines' pods (radius ≤ 0.335 k round their axes, `eng` outside the bay) fit the margin.
    expect(-g.eng + 0.335 * g.k).toBeLessThan(g.margin);
    expect(g.zHub).toBeLessThan(g.head);
  });
});

describe('the Crier’s container and the deck’s iris', () => {
  it('the container passes through the iris, and the iris opens inside the deck', () => {
    expect(Math.hypot(CONTAINER.w / 2, CONTAINER.d / 2)).toBeLessThan(IRIS);
    expect(IRIS + IRIS_RIM).toBeLessThanOrEqual(TP_DECK_R);
  });

  it('the cables splay out from the container’s eyes to the drone’s winches, so they show beside it', () => {
    const winches = craneCorners(DRONE_BAY, DRONE_BAY, CARGO_DRONE.hook).map(([x, y]) => [x - DRONE_BAY / 2, y - DRONE_BAY / 2] as const);
    const eyes = containerEyes().map(([x, y]) => [x - CONTAINER.w / 2, y - CONTAINER.d / 2] as const);
    for (let i = 0; i < 4; i++) {
      const [wx, wy] = winches[i]!, [ex, ey] = eyes[i]!;
      expect(Math.sign(wx)).toBe(Math.sign(ex));
      expect(Math.sign(wy)).toBe(Math.sign(ey));
      expect(Math.abs(wx)).toBeGreaterThan(Math.abs(ex));
      expect(Math.abs(wy)).toBeGreaterThan(Math.abs(ey));
    }
  });

  it('draws without a canvas at any depth in the hatch, and nothing once sunk all the way', () => {
    const f = containerFrame();
    for (const sunk of [0, 0.3, 0.9, 1.29]) {
      const c = counter();
      drawContainer(c.ctx, f, sunk, 3);
      expect(c.fills(), `sunk ${sunk}`).toBeGreaterThan(10);
    }
    const gone = counter();
    drawContainer(gone.ctx, f, CONTAINER.h, 3);
    expect(gone.fills()).toBe(0);
    const h = counter();
    drawHatch(h.ctx, hatchFrame(), 3);
    expect(h.fills()).toBeGreaterThan(5);
  });
});
