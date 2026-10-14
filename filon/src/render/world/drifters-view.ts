// drifters-view.ts — the freight made visible: every route's drifters shuttle between their
// skydocks, high over the land in the iso view (a shadow on the ground beneath), lower and
// smaller on the plan. Pure decoration driven by the routes and the clock: the engine moves
// the freight as a flow, these balloons only show it.
import { Container, Sprite, Texture } from 'pixi.js';
import type { Sim } from '@/sim/state';
import { routeDistance } from '@/sim/space';
import { BAL } from '@/content/balance';
import { C } from '../art/tokens';
import { ellipsePts, flat, ink, shape } from '../art/ink';
import { light } from '../art/shapes';
import { LH } from '../iso';
import type { Lin } from '../projection';

function balloonTexture(): Texture {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 72;
  const g = cv.getContext('2d')!;
  g.lineJoin = 'round'; g.lineCap = 'round';
  const env = ellipsePts(32, 26, 24, 18, 7, 0.01, 40);
  shape(g, env, C.ice, { w: 2, seed: 3 });
  flat(g, ellipsePts(40, 32, 16, 10, 8, 0, 30), C.steelL, 0.35);
  ink(g, [[10, 27], [54, 27]], { w: 3, color: C.coral, shade: false, taper: 0 });
  flat(g, ellipsePts(24, 18, 7, 4, 9, 0, 16), '#ffffff', 0.7);
  for (const x of [22, 42]) ink(g, [[x, 40], [32 + (x - 32) * 0.4, 54]], { w: 1.3, color: C.steelDD, shade: false, taper: 0 });
  shape(g, [[22, 54], [42, 54], [39, 62], [25, 62]], C.coral, { w: 1.6, seed: 5 });
  light(g, 32, 58, 2, C.ledWarm);
  const t = Texture.from(cv);
  t.source.scaleMode = 'linear';
  return t;
}

function shadowTexture(): Texture {
  const cv = document.createElement('canvas');
  cv.width = 48; cv.height = 24;
  const g = cv.getContext('2d')!;
  flat(g, ellipsePts(24, 12, 20, 8, 3, 0, 24), C.ink, 0.22);
  return Texture.from(cv);
}

export class DriftersView {
  private readonly balloon = balloonTexture();
  private readonly shade = shadowTexture();
  private readonly pool: Array<{ b: Sprite; s: Sprite }> = [];

  constructor(private readonly layer: Container) {}

  update(sim: Sim, P: Lin, t: number, seconds: number): void {
    let n = 0;
    for (const r of sim.routes) {
      const a = sim.ents.get(r.from), b = sim.ents.get(r.to);
      if (!a || !b) continue;
      const ax = a.x + 1.5, ay = a.y + 1.5, bx = b.x + 1.5, by = b.y + 1.5;
      const d = Math.max(1, routeDistance(Math.floor(ax), Math.floor(ay), Math.floor(bx), Math.floor(by), sim.mods));
      // A round trip takes 2d/v + 2 load minutes of game time (shown at the same pace).
      const trip = ((2 * d) / ((BAL.drifterTilesPerMin * sim.mods.shipSpeed) / 1000) + 2 * BAL.drifterLoadMin) * 60;
      for (let k = 0; k < r.ships; k++) {
        const ph = ((seconds / trip + k / r.ships) % 1 + 1) % 1;
        // Load, fly out, unload, fly back.
        const load = (BAL.drifterLoadMin * 60) / trip;
        const fly = (1 - 2 * load) / 2;
        const s = ph < load ? 0 : ph < load + fly ? (ph - load) / fly : ph < 2 * load + fly ? 1 : 1 - (ph - 2 * load - fly) / fly;
        const x = ax + (bx - ax) * s, y = ay + (by - ay) * s;
        let pair = this.pool[n];
        if (!pair) {
          pair = { b: new Sprite(this.balloon), s: new Sprite(this.shade) };
          pair.b.anchor.set(0.5, 1); pair.s.anchor.set(0.5);
          this.layer.addChild(pair.s, pair.b);
          this.pool.push(pair);
        }
        pair.b.visible = pair.s.visible = true;
        const gx = P.a * x + P.c * y, gy = P.b * x + P.d * y;
        const alt = (5 * LH + Math.sin(seconds * 1.7 + k) * 3) * (1 - t) + 6 * t;
        pair.s.position.set(gx, gy);
        pair.b.position.set(gx, gy - alt);
        const sc = 0.55 - 0.15 * t;
        pair.b.scale.set(sc);
        pair.s.scale.set(sc);
        n++;
      }
    }
    for (let i = n; i < this.pool.length; i++) { this.pool[i]!.b.visible = false; this.pool[i]!.s.visible = false; }
  }
}
