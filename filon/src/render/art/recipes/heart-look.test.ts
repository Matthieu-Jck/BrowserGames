// heart-look.test.ts — the Core wears one look per level (D86): bare corners at level 1, one more
// corner piece and more lamps each level, in both views, its data outlet's nozzle only once the
// level has mounted it. Read through the light spy, which re-runs the real recipes.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { BUILDINGS, type BuildingId } from '@/content/buildings';
import type { BuildingDef } from '@/content/types';
import { HEART_CORNERS, artLevelOf, artLevels, heartLook, portDrawn } from './buildings';
import { beaconSpot, isoArt, planArt } from './fx';
import { isoHead } from './buildings';
import { tileToIso } from '../../iso';

const HEART = BUILDINGS.hearth as BuildingDef;

describe('the Core’s looks (D86)', () => {
  it('has one look per level it can reach; every other building has one', () => {
    expect(artLevels('hearth')).toBe(BAL.hearthUpgrades.length + 1);
    expect(artLevels('drill' as BuildingId)).toBe(1);
    expect(artLevelOf('hearth', 3)).toBe(3);
    expect(artLevelOf('hearth', 9)).toBe(artLevels('hearth'));
    expect(artLevelOf('drill' as BuildingId, 4)).toBe(1);
  });

  it('mounts its pieces on four distinct corner tiles, the data outlet on its out port’s, from the level that mounts it', () => {
    const tiles = HEART_CORNERS.map((c) => `${c.tx},${c.ty}`);
    expect(new Set(tiles).size).toBe(4);
    for (const c of HEART_CORNERS) {
      expect([0, HEART.w - 1]).toContain(c.tx);
      expect([0, HEART.h - 1]).toContain(c.ty);
    }
    const out = HEART.ports.find((p) => p.io === 'out')!;
    const outlet = HEART_CORNERS.find((c) => c.piece === 'outlet')!;
    expect([outlet.tx, outlet.ty, outlet.lv]).toEqual([out.x, out.y, BAL.hearthDataLevel]);
    // One piece a level from 2 on; by level 5 (D118) every corner is mounted.
    expect(HEART_CORNERS.filter((c) => c.piece).map((c) => c.lv)).toEqual([2, 3, 4, 5]);
    expect(portDrawn(HEART, out, BAL.hearthDataLevel - 1)).toBe(false);
    expect(portDrawn(HEART, out, BAL.hearthDataLevel)).toBe(true);
    expect(HEART.ports.filter((p) => p.io === 'in').every((p) => portDrawn(HEART, p, 1))).toBe(true);
  });

  it('lights more each level, in iso and in plan, its solar rows the same at every level', () => {
    let iso = -1, plan = -1;
    const cells = isoArt('hearth', 0, 1).cells.length;
    for (let lv = 1; lv <= artLevels('hearth'); lv++) {
      const a = isoArt('hearth', 0, lv), b = planArt('hearth', 0, lv);
      expect(a.emitters.length, `iso level ${lv}`).toBeGreaterThan(iso);
      expect(b.emitters.length, `plan level ${lv}`).toBeGreaterThan(plan);
      expect(a.cells.length).toBe(cells); // the lights view keys the solar overlays by building and rotation
      iso = a.emitters.length; plan = b.emitters.length;
    }
    expect(heartLook(1)).toMatchObject({ beacons: 1, strips: 1, cornice: false, drone: false, floods: false });
    expect(heartLook(4)).toMatchObject({ beacons: 3, strips: 2, cornice: true, pilasters: true, drone: true, skirt: true, floods: true });
  });

  it('blinks its night beacon on the uplink’s feed horn at every level and turn, not on a link mast that projects higher', () => {
    const [X, Y] = tileToIso(HEART.w / 2, HEART.h / 2, isoHead('hearth'));
    for (let lv = 1; lv <= artLevels('hearth'); lv++) {
      for (const rot of [0, 1, 2, 3] as const) {
        const art = isoArt('hearth', rot, lv);
        const [x, y] = beaconSpot(art, HEART.w / 2, HEART.h / 2, isoHead('hearth'));
        // On a light the art bakes (the feed's LED), within a pixel or two of the feed point (sprite px: 2 × world px).
        expect(art.emitters.some((em) => em.x === x && em.y === y), `lv ${lv} rot ${rot}`).toBe(true);
        expect(Math.hypot(x - X * 2, y - Y * 2), `lv ${lv} rot ${rot}`).toBeLessThan(3);
      }
    }
  });
});
