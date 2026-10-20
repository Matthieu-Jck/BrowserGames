// input.ts — raw input → camera moves and high-level callbacks for the tool layer. Pan with
// ZQSD/WASD/arrows, middle-drag, Space+drag or left-drag on empty ground; wheel zooms to the
// cursor. Hotkeys are ignored while a text field has focus. Fingers (D96) go through the touch
// gestures (touch.ts): one-finger pan and tap, a tool's drag, long press for the right button,
// pinch zoom; they reach the app as the same pointer calls the mouse makes.
import { actionOf, HELD, resolveKey, type Action } from './bindings';
import { TouchGestures, type TouchEffect, type TouchTool } from './touch';

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
  /** What one finger does with the tool in hand (D96): pan and click, tap to place, or the tool's drag. Default: a drag while a tool is active. */
  touchTool?(): TouchTool;
  /** A drag or a right box under way is dropped, not laid (a second finger came down: a pinch). */
  onPointerCancel?(): void;
}

const PAN_SPEED = 900; // screen px / s

export class Input {
  private held = new Set<string>();
  private drag: { id: number; x: number; y: number; moved: number; click: boolean } | null = null;
  private space = false;
  /** Fingers on the canvas (D96) and the long-press timer. */
  private readonly touch = new TouchGestures();
  private longTimer: ReturnType<typeof setTimeout> | null = null;
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
    window.addEventListener('pointercancel', (e) => { if (e.pointerType === 'touch') this.touchUp(e, true); });
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
    if (e.pointerType === 'touch') { this.touchDown(e); return; }
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
    if (e.pointerType === 'touch') { this.touchMove(e); return; }
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
    if (e.pointerType === 'touch') { this.touchUp(e, false); return; }
    if (this.drag && e.pointerId === this.drag.id) {
      const wasClick = this.drag.click && this.drag.moved < 5;
      this.drag = null;
      if (wasClick) this.hooks.onPointerUp(this.info(e));
      return;
    }
    this.hooks.onPointerUp(this.info(e));
  }

  // ── fingers (D96) ──────────────────────────────────────────────────────────

  private touchTool(): TouchTool {
    return this.hooks.touchTool?.() ?? (this.hooks.toolActive() ? 'drag' : 'none');
  }

  private touchDown(e: PointerEvent): void {
    this.canvas.focus();
    this.canvas.setPointerCapture(e.pointerId);
    this.applyTouch(this.touch.down(e.pointerId, e.clientX, e.clientY, performance.now()));
    this.armLong();
  }

  /** Only the fingers that came down on the canvas: a touch on a panel is the panel's. */
  private touchMove(e: PointerEvent): void {
    this.applyTouch(this.touch.move(e.pointerId, e.clientX, e.clientY, this.touchTool()));
    this.armLong();
  }

  private touchUp(e: PointerEvent, cancelled: boolean): void {
    this.applyTouch(this.touch.up(e.pointerId, e.clientX, e.clientY, this.touchTool(), cancelled));
    this.armLong();
  }

  /** The long-press timer runs while one finger is still and pending. */
  private armLong(): void {
    const at = this.touch.longAt();
    if (this.longTimer !== null) { clearTimeout(this.longTimer); this.longTimer = null; }
    if (at === null) return;
    this.longTimer = setTimeout(() => {
      this.longTimer = null;
      this.applyTouch(this.touch.timer(performance.now()));
    }, Math.max(0, at - performance.now()));
  }

  private applyTouch(fx: TouchEffect[]): void {
    const { w, h } = this.view();
    const at = (x: number, y: number, button: number): PointerInfo => ({ sx: x, sy: y, button, shift: false, ctrl: false, overCanvas: true });
    for (const f of fx) {
      switch (f.k) {
        case 'hover': this.sx = f.x; this.sy = f.y; this.hooks.onPointerMove(at(f.x, f.y, 0)); break;
        case 'down': this.hooks.onPointerDown(at(f.x, f.y, f.button)); break;
        case 'move': this.sx = f.x; this.sy = f.y; this.hooks.onPointerMove(at(f.x, f.y, 0)); break;
        case 'up': this.hooks.onPointerUp(at(f.x, f.y, f.button)); break;
        case 'cancel': this.hooks.onPointerCancel?.(); break;
        case 'pan': this.camera.panScreen(f.dx, f.dy); break;
        case 'zoom': this.camera.zoomBy(f.f, f.x, f.y, w, h); break;
        case 'long': navigator.vibrate?.(12); break; // a tick under the finger where the device has one
      }
    }
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
    if (e.ctrlKey || e.metaKey) e.preventDefault(); // a chord of ours (undo, copy, paste: D154), not the page's
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
