// fx.test.ts — the light spy finds what the art bakes in (LED fills → emitters, PV fills →
// cells) for every building, and the night rigs follow the automated base's rules.
import { describe, it, expect } from 'vitest';
import { BUILDING_IDS, buildingDef, isBeltDef } from '@/content/registry';
import type { BuildingId } from '@/content/buildings';
import { C } from '../tokens';
import { light } from '../shapes';
import { pvPanel } from '../solar';
import { artOf, HOT, isoArt, nightRig, planArt } from './fx';

describe('light spy', () => {
  it('turns an LED into one emitter at its centre, in its colour class', () => {
    const art = artOf((ctx) => light(ctx, 40, 30, 3, C.led), 10, 10);
    expect(art.emitters.length).toBe(1);
    expect(art.emitters[0]!.glow).toBe('cold');
    expect(art.emitters[0]!.x).toBeCloseTo(30, 0);
    expect(art.emitters[0]!.y).toBeCloseTo(20, 0);
    expect(art.cells).toEqual([]);
    expect(artOf((ctx) => light(ctx, 0, 0, 2, C.ledRed)).emitters[0]!.glow).toBe('red');
  });

  it('records every solar cell of a panel as a polygon', () => {
    const art = artOf((ctx) => pvPanel(ctx, [[0, 0], [60, 0], [60, 40], [0, 40]], 3, 2));
    expect(art.cells.length).toBe(6);
    for (const c of art.cells) {
      expect(c.length).toBeGreaterThanOrEqual(4);
      for (const [x, y] of c) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(60); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(40); }
    }
    expect(art.emitters).toEqual([]);
  });

  it('runs every building recipe (iso and plan) without drawing anything, and finds their lights', () => {
    let lit = 0;
    for (const id of BUILDING_IDS) {
      if (isBeltDef(id)) continue;
      const iso = isoArt(id as BuildingId, 0), plan = planArt(id as BuildingId, 0);
      for (const e of [...iso.emitters, ...plan.emitters]) {
        expect(Number.isFinite(e.x) && Number.isFinite(e.y) && e.w >= 0 && e.h >= 0, id).toBe(true);
      }
      if (iso.emitters.length) lit++;
    }
    expect(lit).toBeGreaterThan(10);
    // The Heart's solar array is drawn with pvPanel: its cells get day / night states.
    expect(isoArt('hearth', 0).cells.length).toBeGreaterThan(0);
    // The wind turbine's red aviation light, the same object on a second call (cached).
    expect(isoArt('wind_flower', 0).emitters.some((e) => e.glow === 'red')).toBe(true);
    expect(isoArt('wind_flower', 0)).toBe(isoArt('wind_flower', 0));
  });
});

describe('night rigs', () => {
  const rig = (id: BuildingId): ReturnType<typeof nightRig> => nightRig(id, buildingDef(BUILDING_IDS.indexOf(id)));
  it('the Heart is floodlit and carries the uplink beacon', () => {
    expect(rig('hearth').beacon).toBeDefined();
    expect(rig('hearth').pool?.warm).toBe(false);
  });
  it('hot machines glow amber, other machines cold, small blocks and sleeping bulbs not at all', () => {
    for (const id of HOT) expect(rig(id).pool?.warm, id).toBe(true);
    expect(rig('drill').pool?.warm).toBe(false);
    expect(rig('sun_bulb')).toEqual({});
    expect(rig('router')).toEqual({});
    expect(rig('mast')).toEqual({});
  });
});
