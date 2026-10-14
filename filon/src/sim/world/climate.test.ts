// climate.test.ts — the desert's temperature: a pure, integer, continuous function of the world
// clock with the plan's daily shape (cold at the end of the night, hottest a little after noon),
// and the prepared effects on solar panels and habitat heating.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { WORLD_SEED } from '@/content/world';
import { DAY_EPOCHS, EPOCH, WORLD_EPOCH0 } from '../constants';
import { baseTemp, dayOffsetPermille, epochTemp, heaterKw, solarHeatPermille, temperatureAt } from './climate';

const DAY = DAY_EPOCHS * EPOCH;
const T0 = WORLD_EPOCH0 * EPOCH; // a world day starts here (WORLD_EPOCH0 ≡ 0 mod 36: 20:00)
/** Hour of the 24-hour clock at a day epoch (the HUD's clock: midnight is day epoch 6). */
const hourOf = (dayEpoch: number): number => (((dayEpoch - 6 + DAY_EPOCHS) % DAY_EPOCHS) * 24) / DAY_EPOCHS;

describe('climate', () => {
  it('the daily curve has one value per day epoch', () => {
    expect(BAL.climate.curve.length).toBe(DAY_EPOCHS);
    expect(BAL.climate.curve.every((v) => Number.isInteger(v))).toBe(true);
  });

  it('is deterministic, integer, and the same for every colony (a function of the world clock only)', () => {
    for (let i = 0; i < 500; i++) {
      const t = T0 + i * 7919 + (i % 13);
      const a = temperatureAt(t, WORLD_SEED), b = temperatureAt(t, WORLD_SEED);
      expect(a).toBe(b);
      expect(Number.isInteger(a)).toBe(true);
    }
    // Another world seed gives other days, the same daily shape.
    let differ = 0;
    for (let d = 0; d < 40; d++) if (dayOffsetPermille(d, WORLD_SEED) !== dayOffsetPermille(d, WORLD_SEED + 1)) differ++;
    expect(differ).toBeGreaterThan(30);
  });

  it('stays in the desert range: 2–6 °C at the coldest, 34–40 °C at the hottest', () => {
    let lo = Infinity, hi = -Infinity;
    for (let d = 0; d < 120; d++) {
      let dMin = Infinity, dMax = -Infinity;
      for (let t = 0; t < DAY; t += 60) {
        const v = temperatureAt(T0 + d * DAY + t, WORLD_SEED);
        dMin = Math.min(dMin, v); dMax = Math.max(dMax, v);
      }
      expect(dMin).toBeGreaterThanOrEqual(20);
      expect(dMin).toBeLessThanOrEqual(60);
      expect(dMax).toBeGreaterThanOrEqual(340);
      expect(dMax).toBeLessThanOrEqual(400);
      lo = Math.min(lo, dMin); hi = Math.max(hi, dMax);
    }
    // The per-day variation really varies (over 120 days the extremes spread out).
    expect(hi - lo).toBeGreaterThan(330);
  });

  it('is continuous: ±1 deci-°C from one tick to the next, across epochs and days', () => {
    for (let d = 0; d < 6; d++) {
      let prev = temperatureAt(T0 + d * DAY - 1, WORLD_SEED);
      for (let t = 0; t < DAY; t++) {
        const v = temperatureAt(T0 + d * DAY + t, WORLD_SEED);
        expect(Math.abs(v - prev), `day ${d} tick ${t}`).toBeLessThanOrEqual(1);
        prev = v;
      }
    }
  });

  it('has the daily shape: coldest at the end of the night, hottest a little after noon', () => {
    // The bare curve: its minimum at dawn's first epoch, its maximum early in the afternoon.
    const C = BAL.climate.curve;
    const iMin = C.indexOf(Math.min(...C)), iMax = C.indexOf(Math.max(...C));
    expect(hourOf(iMin)).toBe(4);
    expect(hourOf(iMax)).toBeGreaterThan(12);
    expect(hourOf(iMax)).toBeLessThanOrEqual(15);
    // It falls all night and rises all morning.
    for (let e = 0; e < 12; e++) expect(C[e + 1]!).toBeLessThan(C[e]!);
    for (let e = 12; e < iMax; e++) expect(C[e + 1]!).toBeGreaterThan(C[e]!);
    // Every real day (offsets included): the coldest moment between 02:40 and 05:20, the hottest between 12:40 and 16:00.
    for (let d = 0; d < 60; d++) {
      let tMin = 0, tMax = 0, vMin = Infinity, vMax = -Infinity;
      for (let t = 0; t < DAY; t += 30) {
        const v = temperatureAt(T0 + d * DAY + t, WORLD_SEED);
        if (v < vMin) { vMin = v; tMin = t; }
        if (v > vMax) { vMax = v; tMax = t; }
      }
      expect(tMin / EPOCH, `day ${d} coldest`).toBeGreaterThanOrEqual(10);
      expect(tMin / EPOCH, `day ${d} coldest`).toBeLessThanOrEqual(14);
      expect(tMax / EPOCH, `day ${d} hottest`).toBeGreaterThanOrEqual(25);
      expect(tMax / EPOCH, `day ${d} hottest`).toBeLessThanOrEqual(30);
    }
    // Noon is hot and midnight is cool, every day.
    for (let d = 0; d < 30; d++) {
      expect(temperatureAt(T0 + d * DAY + 24 * EPOCH, WORLD_SEED)).toBeGreaterThan(280);
      expect(temperatureAt(T0 + d * DAY + 6 * EPOCH, WORLD_SEED)).toBeLessThan(120);
    }
  });

  it('the bare curve interpolates between its table values', () => {
    expect(baseTemp(0)).toBe(BAL.climate.curve[0]);
    expect(baseTemp(12 * EPOCH)).toBe(BAL.climate.curve[12]);
    const mid = baseTemp(27 * EPOCH + EPOCH / 2);
    expect(mid).toBe(Math.floor((BAL.climate.curve[27]! + BAL.climate.curve[28]!) / 2));
    // The day wraps: the last epoch runs into the first.
    expect(Math.abs(baseTemp(DAY - 1) - BAL.climate.curve[0]!)).toBeLessThanOrEqual(1);
  });

  it('power reads one value per epoch: its middle tick', () => {
    const ep = WORLD_EPOCH0 + 100;
    expect(epochTemp(ep, WORLD_SEED)).toBe(temperatureAt(ep * EPOCH + EPOCH / 2, WORLD_SEED));
  });

  it('solar panels lose 0.4 %/°C above 25 °C; survival heaters run below their limit', () => {
    expect(solarHeatPermille(100)).toBe(1000);
    expect(solarHeatPermille(250)).toBe(1000);
    expect(solarHeatPermille(350)).toBe(960);
    expect(solarHeatPermille(400)).toBe(940);
    for (let t = 0; t < 600; t += 7) expect(solarHeatPermille(t + 7)).toBeLessThanOrEqual(solarHeatPermille(t));
    expect(heaterKw(BAL.climate.heaterBelow)).toBe(0);
    expect(heaterKw(300)).toBe(0);
    expect(heaterKw(BAL.climate.heaterBelow - 10)).toBe(BAL.climate.heaterKwPerDeg);
    expect(heaterKw(20)).toBe(104); // a 2 °C night: 13 °C under the limit × 8 kW
    for (let t = 0; t < 300; t += 7) expect(heaterKw(t)).toBeGreaterThanOrEqual(heaterKw(t + 7));
  });
});
