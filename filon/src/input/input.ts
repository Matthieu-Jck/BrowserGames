// input.ts — raw input → camera moves and high-level callbacks for the tool layer. Pan with
// ZQSD/WASD/arrows, middle-drag, Space+drag or left-drag on empty ground; wheel zooms to the
// cursor. Hotkeys are ignored while a text field has focus.
import { actionOf, HELD, resolveKey, type Action } from './bindings';

const ZOOM_CODES = new Set(['Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract']);
import type { Camera } from '@/render/camera';

export interface PointerInfo {
  sx: number;
  sy: number;
  button: number;
  shift: boolean;
  ctrl: boolean;
  /** Is the pointer over the game canvas (not over a panel)? */
  overCanvas: boolean;
}

export interface InputHooks {
  /** A tool is active: left-drag goes to the tool instead of panning. */
  toolActive(): boolean;
  onAction(a: Action, e: KeyboardEvent): void;
  onSlot(slot: number, shift: boolean): void;
  onPointerDown(p: PointerInfo): void;
  onPointerMove(p: PointerInfo): void;
  onPointerUp(p: PointerInfo): void;
}

const PAN_SPEED = 900; // screen px / s

export class Input {
  private held = new Set<string>();
  private drag: { id: number; x: number; y: number; moved: number; click: boolean } | null = null;
  private space = false;
  /** Last pointer position (screen CSS px). */
  sx = -1;
  sy = -1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera,
    private readonly view: () => { w: number; h: number },
    private readonly hooks: InputHooks,
  ) {
    canvas.tabIndex = 0;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('keydown', (e) => this.keydown(e));
    window.addEventListener('keyup', (e) => this.keyup(e));
    window.addEventListener('blur', () => { this.held.clear(); this.space = false; });
    // A trackpad pinch (ctrl+wheel; Safari: gesture events) over the HUD or a panel would zoom
    // the whole page instead of the camera — and the browser remembers that zoom per site, so
    // the UI ends up off-screen. The canvas handles its own pinch; elsewhere, swallow it.
    window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
    for (const g of ['gesturestart', 'gesturechange', 'gestureend']) window.addEventListener(g, (e) => e.preventDefault(), { passive: false });
  }

  /** Keys belong to a form control that has focus (text fields, the inspector's selects). */
  private typing(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const { w, h } = this.view();
    // ctrl+wheel is the trackpad pinch gesture: stronger factor.
    const k = e.ctrlKey ? 0.01 : 0.0015;
    this.camera.zoomBy(Math.exp(-e.deltaY * k), e.clientX, e.clientY, w, h);
  }

  private info(e: PointerEvent): PointerInfo {
    return { sx: e.clientX, sy: e.clientY, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, overCanvas: e.target === this.canvas };
  }

  private down(e: PointerEvent): void {
    this.canvas.focus();
    this.sx = e.clientX; this.sy = e.clientY;
    // Left press with no tool pans on drag but still selects on a plain click (on release).
    const noToolLeft = e.button === 0 && !this.space && !this.hooks.toolActive();
    if (e.button === 1 || (e.button === 0 && this.space) || noToolLeft) {
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, click: noToolLeft };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    this.hooks.onPointerDown(this.info(e));
  }

  private move(e: PointerEvent): void {
    this.sx = e.clientX; this.sy = e.clientY;
    if (this.drag && e.pointerId === this.drag.id) {
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      this.camera.panScreen(dx, dy);
      return;
    }
    this.hooks.onPointerMove(this.info(e));
  }

  private up(e: PointerEvent): void {
    if (this.drag && e.pointerId === this.drag.id) {
      const wasClick = this.drag.click && this.drag.moved < 5;
      this.drag = null;
      if (wasClick) this.hooks.onPointerUp(this.info(e));
      return;
    }
    this.hooks.onPointerUp(this.info(e));
  }

  /** True when the last left press turned into a camera drag. */
  dragging(): boolean { return !!this.drag && this.drag.moved >= 5; }

  private keydown(e: KeyboardEvent): void {
    if (this.typing(e)) return;
    if (e.code === 'Space') {
      // Space + drag pans; a UI button keeping focus after a click must not be pressed again.
      if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') (e.target as HTMLElement).blur();
      this.space = true;
      e.preventDefault();
      return;
    }
    // Ctrl/Cmd + = / − would zoom the page (and stick per site): zoom the camera instead.
    // Ctrl/Cmd + 0 is left to the browser, to reset a page zoom.
    if ((e.ctrlKey || e.metaKey) && ZOOM_CODES.has(e.code)) {
      e.preventDefault();
      if (!e.repeat) this.hooks.onAction(e.code === 'Minus' || e.code === 'NumpadSubtract' ? 'zoomOut' : 'zoomIn', e);
      return;
    }
    const r = resolveKey(e);
    if (!r) return;
    if ('slot' in r) { this.hooks.onSlot(r.slot, r.shift); e.preventDefault(); return; }
    const a = r.action;
    if (HELD.has(a)) { this.held.add(a); return; }
    if (e.repeat) return;
    this.hooks.onAction(a, e);
  }

  private keyup(e: KeyboardEvent): void {
    if (e.code === 'Space') { this.space = false; return; }
    const a = actionOf(e);
    if (a && HELD.has(a)) this.held.delete(a);
  }

  /** Continuous effects (keyboard panning). */
  frame(dt: number): void {
    let dx = 0, dy = 0;
    if (this.held.has('panLeft')) dx += 1;
    if (this.held.has('panRight')) dx -= 1;
    if (this.held.has('panUp')) dy += 1;
    if (this.held.has('panDown')) dy -= 1;
    if (dx || dy) {
      const s = PAN_SPEED * dt * (this.held.has('fast') ? 2.5 : 1);
      this.camera.panScreen(dx * s, dy * s);
    }
  }
}
