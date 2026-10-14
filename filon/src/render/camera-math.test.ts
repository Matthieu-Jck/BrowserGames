import { describe, it, expect } from 'vitest';
import { chunkRange, screenToWorld, tileAt, worldToScreen, zoomAt, ZOOM_MAX, ZOOM_MIN } from './camera-math';

const VW = 1440, VH = 900;

describe('camera maths', () => {
  it('world → screen → world is the identity', () => {
    const c = { cx: 1234.5, cy: -77, zoom: 0.73 };
    for (const [wx, wy] of [[0, 0], [1000, -500], [-3.25, 9999]] as const) {
      const [sx, sy] = worldToScreen(c, VW, VH, wx, wy);
      const [bx, by] = screenToWorld(c, VW, VH, sx, sy);
      expect(bx).toBeCloseTo(wx, 9);
      expect(by).toBeCloseTo(wy, 9);
    }
  });

  it('zooming keeps the world point under the cursor fixed', () => {
    const c = { cx: 500, cy: 300, zoom: 1 };
    const [sx, sy] = [1000, 200];
    const before = screenToWorld(c, VW, VH, sx, sy);
    for (const z of [0.25, 0.6, 1.7]) {
      const after = screenToWorld(zoomAt(c, VW, VH, sx, sy, z), VW, VH, sx, sy);
      expect(after[0]).toBeCloseTo(before[0], 9);
      expect(after[1]).toBeCloseTo(before[1], 9);
    }
  });

  it('clamps zoom to its range', () => {
    const c = { cx: 0, cy: 0, zoom: 1 };
    expect(zoomAt(c, VW, VH, 0, 0, 100).zoom).toBe(ZOOM_MAX);
    expect(zoomAt(c, VW, VH, 0, 0, 0.0001).zoom).toBe(ZOOM_MIN);
  });

  it('chunk ranges floor correctly on negative coordinates', () => {
    const c = { cx: -10, cy: -10, zoom: 1 };
    const [x0, y0, x1, y1] = chunkRange(c, 64, 64, 32, 0);
    // view spans world px [-42, 22] → chunks of 1024 px: -1 .. 0
    expect([x0, y0, x1, y1]).toEqual([-1, -1, 0, 0]);
  });

  it('finds the tile under a screen point', () => {
    const c = { cx: 0, cy: 0, zoom: 1 };
    expect(tileAt(c, VW, VH, VW / 2, VH / 2)).toEqual([0, 0]);
    expect(tileAt(c, VW, VH, VW / 2 - 1, VH / 2 - 1)).toEqual([-1, -1]);
  });
});
