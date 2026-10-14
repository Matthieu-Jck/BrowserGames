// perf-overlay.ts — frame timing + GPU draw-call counter (wraps the WebGL draw entry
// points) shown on Backquote, and read by FL.perf() in the smoke test.
import type { Renderer } from 'pixi.js';
import { el } from '@/core/dom';

export interface PerfStats {
  fps: number;
  frameMs: number;
  maxFrameMs: number;
  tickMs: number;
  renderMs: number;
  drawCalls: number;
  renderer: string;
  [k: string]: number | string;
}

export class PerfMeter {
  readonly stats: PerfStats = {
    fps: 0, frameMs: 0, maxFrameMs: 0, tickMs: 0, renderMs: 0, drawCalls: 0, renderer: '?',
  };
  private calls = 0;
  private acc = 0;
  private frames = 0;
  private maxWin = 0;
  private node: HTMLElement | null = null;

  constructor(renderer: Renderer) {
    this.stats.renderer = renderer.name;
    const gl = (renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
    if (gl) {
      const wrap = <K extends 'drawElements' | 'drawArrays' | 'drawElementsInstanced' | 'drawArraysInstanced'>(k: K): void => {
        const orig = gl[k] as unknown as (...a: unknown[]) => void;
        if (typeof orig !== 'function') return;
        (gl as unknown as Record<string, unknown>)[k] = (...a: unknown[]) => { this.calls++; orig.apply(gl, a); };
      };
      wrap('drawElements'); wrap('drawArrays'); wrap('drawElementsInstanced'); wrap('drawArraysInstanced');
    }
  }

  /** Call once per rendered frame with its wall duration (ms) and dt (s). */
  frame(ms: number, dt: number): void {
    this.stats.drawCalls = this.calls;
    this.calls = 0;
    this.stats.frameMs = ms;
    this.maxWin = Math.max(this.maxWin, ms);
    this.acc += dt;
    this.frames++;
    if (this.acc >= 0.5) {
      this.stats.fps = Math.round(this.frames / this.acc);
      this.stats.maxFrameMs = Math.round(this.maxWin * 10) / 10;
      this.acc = 0; this.frames = 0; this.maxWin = 0;
      if (this.node) this.paint();
    }
  }

  set(key: string, v: number | string): void { this.stats[key] = v; }

  toggle(): void {
    if (this.node) { this.node.remove(); this.node = null; return; }
    this.node = el('div.perf');
    document.body.append(this.node);
    this.paint();
  }

  private paint(): void {
    if (!this.node) return;
    const s = this.stats;
    const lines = Object.entries(s).map(([k, v]) => `${k.padEnd(12)} ${typeof v === 'number' ? Math.round(v * 10) / 10 : v}`);
    this.node.textContent = lines.join('\n');
  }
}
