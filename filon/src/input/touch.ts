// touch.ts — fingers on the canvas → the same gestures the mouse makes (D96), pure (no DOM, no
// clock of its own: the caller passes the times and runs the long-press timer). `Input` feeds it
// the touch pointers and applies what it returns; mouse and keyboard never come here.
//
//   one finger, nothing in hand ─ drag: pan · tap: a click (select, a Link or land click)
//   one finger, a tool in hand  ─ a drag tool (ribbon, demolish box, brush): the drag is the tool's
//                                 drag, from where the finger came down; a building: a tap places
//                                 it, a drag pans (no building laid by a finger that meant to pan)
//   long press (still, ½ s)     ─ the right button: what a right click does (puts a tool away,
//                                 demolishes in build mode, unwinds the Link tool or the land mode);
//                                 moving on after it drags a right box
//   two fingers                 ─ pinch zoom about their middle and pan with it; whatever one
//                                 finger had started is dropped (`cancel`)
// A finger that has moved less than `SLOP` px is still a tap. After a pinch, the finger left on
// the glass pans; it never clicks.

/** Screen px a finger may wander and still tap or long-press. */
export const SLOP = 10;
/** How long a still finger takes to become a long press (ms). */
export const LONG_MS = 480;

export type TouchEffect =
  | { k: 'hover'; x: number; y: number }
  | { k: 'down'; x: number; y: number; button: 0 | 2 }
  | { k: 'move'; x: number; y: number }
  | { k: 'up'; x: number; y: number; button: 0 | 2 }
  | { k: 'cancel' }
  | { k: 'pan'; dx: number; dy: number }
  | { k: 'zoom'; f: number; x: number; y: number }
  | { k: 'long' };

/** What the tool in hand wants from one finger: none (pan / click), a tap (a building), a drag (ribbon, box, brush). */
export type TouchTool = 'none' | 'tap' | 'drag';

type Mode = 'pending' | 'pan' | 'tool' | 'long' | 'idle';

interface Finger { x: number; y: number }

export class TouchGestures {
  private readonly fingers = new Map<number, Finger>();
  /** The one finger's gesture: where it came down, where it is, what it became. */
  private one: { id: number; x0: number; y0: number; x: number; y: number; t0: number; mode: Mode } | null = null;
  /** Two fingers: their distance and middle at the last step. */
  private pinch: { a: number; b: number; d: number; mx: number; my: number } | null = null;

  /** Fingers on the glass. */
  get count(): number { return this.fingers.size; }

  /** When the pending finger turns into a long press (null: no timer to run). */
  longAt(): number | null {
    return this.one && this.one.mode === 'pending' ? this.one.t0 + LONG_MS : null;
  }

  down(id: number, x: number, y: number, t: number): TouchEffect[] {
    this.fingers.set(id, { x, y });
    if (this.fingers.size === 1) {
      this.pinch = null;
      this.one = { id, x0: x, y0: y, x, y, t0: t, mode: 'pending' };
      return [{ k: 'hover', x, y }];
    }
    if (this.fingers.size === 2) {
      // A second finger: a pinch. A tool's drag or a right box under way is dropped, not laid.
      const out: TouchEffect[] = [];
      if (this.one && (this.one.mode === 'tool' || this.one.mode === 'long')) out.push({ k: 'cancel' });
      this.one = null;
      const [a, b] = [...this.fingers.keys()] as [number, number];
      this.pinch = this.measure(a, b);
      return out;
    }
    return []; // a third finger: ignored
  }

  move(id: number, x: number, y: number, tool: TouchTool): TouchEffect[] {
    const f = this.fingers.get(id);
    if (!f) return [];
    f.x = x; f.y = y;
    if (this.pinch) {
      if (id !== this.pinch.a && id !== this.pinch.b) return [];
      const p = this.measure(this.pinch.a, this.pinch.b);
      const out: TouchEffect[] = [];
      if (p.mx !== this.pinch.mx || p.my !== this.pinch.my) out.push({ k: 'pan', dx: p.mx - this.pinch.mx, dy: p.my - this.pinch.my });
      if (this.pinch.d > 0 && p.d > 0 && p.d !== this.pinch.d) out.push({ k: 'zoom', f: p.d / this.pinch.d, x: p.mx, y: p.my });
      this.pinch = p;
      return out;
    }
    const g = this.one;
    if (!g || g.id !== id) return [];
    const dx = x - g.x, dy = y - g.y;
    g.x = x; g.y = y;
    switch (g.mode) {
      case 'pending': {
        if (Math.abs(x - g.x0) + Math.abs(y - g.y0) < SLOP) return [{ k: 'hover', x, y }];
        if (tool === 'drag') {
          // The tool's drag starts where the finger came down.
          g.mode = 'tool';
          return [{ k: 'hover', x: g.x0, y: g.y0 }, { k: 'down', x: g.x0, y: g.y0, button: 0 }, { k: 'move', x, y }];
        }
        g.mode = 'pan';
        return [{ k: 'pan', dx: x - g.x0, dy: y - g.y0 }];
      }
      case 'pan': return dx || dy ? [{ k: 'pan', dx, dy }] : [];
      case 'tool':
      case 'long': return [{ k: 'move', x, y }];
      default: return [];
    }
  }

  /** The long-press timer ran out (`longAt` passed): the right button goes down where the finger is. */
  timer(t: number): TouchEffect[] {
    const g = this.one;
    if (!g || g.mode !== 'pending' || t < g.t0 + LONG_MS) return [];
    g.mode = 'long';
    return [{ k: 'long' }, { k: 'down', x: g.x0, y: g.y0, button: 2 }];
  }

  /** A finger lifted (`cancelled`: the browser took it back — no tap, a tool's drag dropped). */
  up(id: number, x: number, y: number, tool: TouchTool, cancelled = false): TouchEffect[] {
    if (!this.fingers.has(id)) return [];
    this.fingers.delete(id);
    if (this.pinch) {
      // One finger left of the two: it pans from here, it will not click.
      this.pinch = null;
      const [rest] = [...this.fingers.entries()];
      if (rest) this.one = { id: rest[0], x0: rest[1].x, y0: rest[1].y, x: rest[1].x, y: rest[1].y, t0: 0, mode: 'pan' };
      return [];
    }
    const g = this.one;
    if (!g || g.id !== id) return [];
    this.one = null;
    if (cancelled) return g.mode === 'tool' || g.mode === 'long' ? [{ k: 'cancel' }] : [];
    switch (g.mode) {
      case 'pending':
        // A tap: with a tool in hand, a press and a release on the spot (a building placed, a
        // ribbon tile, a one-tile box); with nothing, a click.
        return tool === 'none'
          ? [{ k: 'hover', x: g.x0, y: g.y0 }, { k: 'up', x: g.x0, y: g.y0, button: 0 }]
          : [{ k: 'hover', x: g.x0, y: g.y0 }, { k: 'down', x: g.x0, y: g.y0, button: 0 }, { k: 'up', x: g.x0, y: g.y0, button: 0 }];
      case 'tool': return [{ k: 'up', x, y, button: 0 }];
      case 'long': return [{ k: 'up', x, y, button: 2 }];
      default: return [];
    }
  }

  private measure(a: number, b: number): { a: number; b: number; d: number; mx: number; my: number } {
    const p = this.fingers.get(a)!, q = this.fingers.get(b)!;
    return { a, b, d: Math.hypot(q.x - p.x, q.y - p.y), mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2 };
  }
}
