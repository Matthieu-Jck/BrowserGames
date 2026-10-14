// focus.ts — the spotlight (D41): a short « black out » that dims the whole game — the world and
// every panel — and lifts one element of the interface out of it, so the player sees what just
// arrived and where it lives. An iris closes from the window onto the element, an inked ring
// stamps around it and pulses, a one-line caption in CrierBelt's voice says what it is. It holds
// at least two seconds, whatever the player does, then waits for them: a click or a key ends it
// (owner, 2026-10-13: "it should stay for 2 sec, and then wait for a player input to disappear"),
// and only then does its hint « Clic ou Échap pour continuer » show. A click, Esc, Enter and Space
// are always swallowed (they never also reach the game); any other key goes through.
// Generic: a shot is an element (or a selector, resolved when it plays) and its words; the HUD
// plays one when an analytics plan is unlocked (ui/analytics.ts), and other unlocks can use it.
//
// Rules: shots queue and play one at a time, only while the stage is clear (`pump(clear)`: no
// full screen, menu or modal over the HUD); under automation (navigator.webdriver: the smoke
// test, the screenshot scripts) a queued shot is dropped — only `play(shot, true)` (FL.focusReveal)
// shows one; with prefers-reduced-motion the iris, the stamp and the pulse give way to a plain
// fade. The layer lives on <body> above the panels, the guide, the building card and the naming
// modal (z 38), and only while a shot plays. The element is re-measured every frame, so a HUD
// that re-lays itself out keeps its hole. Styles: styles/focus.css.
import { bus } from '@/core/bus';
import { el, setAttr } from '@/core/dom';
import './styles/focus.css';

/** What a shot lifts out and says. */
export interface FocusShot {
  /** An id for hooks (`data-focus`, FL.focusReveal). */
  readonly id: string;
  /** The element to lift out, or a selector resolved when the shot plays; null or not found: the caption alone, centred. */
  readonly target: Element | string | null;
  /** A small line over the caption (where it comes from: « Analytique · Télémétrie »). */
  readonly kicker?: string;
  /** Who speaks (CrierBelt), as a tag before the caption. */
  readonly voice?: string;
  /** The one line: what it is and where to find it. */
  readonly caption: string;
  /** How to skip it (« Clic ou Échap pour continuer »). */
  readonly hint?: string;
}

/** The phases' lengths (ms): the iris closing in, the hold before an input may end it, the fade out. */
export interface FocusTiming { readonly inMs: number; readonly holdMs: number; readonly outMs: number }

/** Two seconds held in any case; reduced motion keeps the hold but drops the movement (a quick fade in and out). */
export const focusTiming = (reduced: boolean): FocusTiming =>
  reduced ? { inMs: 150, holdMs: 2000, outMs: 200 } : { inMs: 420, holdMs: 2000, outMs: 380 };

/** May this shot play? Under automation only when forced (a debug hook), never by itself. */
export const mayPlay = (auto: boolean, force: boolean): boolean => force || auto;

export interface Box { x: number; y: number; w: number; h: number }

/** The hole around the element: its box grown by `pad`, kept inside the window. */
export function holeBox(r: Box, pad: number, vw: number, vh: number): Box {
  const x = Math.max(4, r.x - pad), y = Math.max(4, r.y - pad);
  const x2 = Math.min(vw - 4, r.x + r.w + pad), y2 = Math.min(vh - 4, r.y + r.h + pad);
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

/**
 * Where the caption goes: under the hole when it fits (the HUD is at the top), else above it;
 * centred on the hole, kept `margin` px inside the window. Null hole: centred in the window.
 */
export function captionAt(hole: Box | null, capW: number, capH: number, vw: number, vh: number, margin = 16, gap = 18): { x: number; y: number } {
  const clampX = (x: number): number => Math.min(Math.max(margin, x), Math.max(margin, vw - margin - capW));
  if (!hole) return { x: clampX((vw - capW) / 2), y: Math.max(margin, (vh - capH) / 2) };
  const x = clampX(hole.x + hole.w / 2 - capW / 2);
  const below = hole.y + hole.h + gap;
  if (below + capH <= vh - margin) return { x, y: below };
  return { x, y: Math.max(margin, hole.y - gap - capH) };
}

export interface SpotlightOptions {
  /** May queued shots play by themselves? (false under automation) */
  readonly auto: boolean;
  /** Reduced motion, read when a shot starts (default: the media query). */
  readonly reduced?: () => boolean;
}

type Phase = 'in' | 'hold' | 'out';

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Spotlight {
  private readonly waiting: FocusShot[] = [];
  private shot: FocusShot | null = null;
  private phase: Phase | null = null;
  private root: HTMLElement | null = null;
  private hole: HTMLElement | null = null;
  private ring: HTMLElement | null = null;
  private cap: HTMLElement | null = null;
  private target: Element | null = null;
  private timers: number[] = [];
  private raf = 0;
  private lastBox = '';
  /** A press began on the layer: its release is the layer's too, even if the shot ends between. */
  private pressed = false;
  /** The hold is over: the next click or key ends the shot. */
  private ready = false;
  private readonly onKey = (e: KeyboardEvent): void => this.key(e);

  constructor(private readonly opts: SpotlightOptions) {}

  /** The shot on screen: its id and phase (null: none). */
  get state(): { open: boolean; id: string | null; phase: Phase | null; ready: boolean; queued: number } {
    return { open: !!this.shot, id: this.shot?.id ?? null, phase: this.phase, ready: this.ready, queued: this.waiting.length };
  }

  /** Queue a shot; it plays at a `pump` with the stage clear. Dropped under automation. */
  queue(shot: FocusShot): void {
    if (!mayPlay(this.opts.auto, false)) return;
    if (this.shot?.id === shot.id || this.waiting.some((s) => s.id === shot.id)) return;
    this.waiting.push(shot);
  }

  /** At the UI's 4 Hz: play the next queued shot once nothing covers the stage. */
  pump(clear: boolean): void {
    if (this.shot || !clear || !this.waiting.length) return;
    this.play(this.waiting.shift()!);
  }

  /** Play a shot now (a playing one ends first). `force`: even under automation. Returns whether it plays. */
  play(shot: FocusShot, force = false): boolean {
    if (!mayPlay(this.opts.auto, force) || typeof document === 'undefined') return false;
    if (this.shot) this.end();
    const reduced = (this.opts.reduced ?? reducedMotion)();
    const T = focusTiming(reduced);
    this.shot = shot;
    this.target = typeof shot.target === 'string' ? document.querySelector(shot.target) : shot.target;
    const box = this.measure();
    const vw = window.innerWidth, vh = window.innerHeight;
    this.hole = el('div.focus-hole');
    this.ring = el('div.focus-ring', { hidden: box ? null : '' });
    this.cap = el('div.focus-cap.cartouche', { role: 'status', 'aria-live': 'polite' }, [
      shot.kicker ? el('small.focus-kicker', {}, shot.kicker) : null,
      el('p.focus-line', {}, [shot.voice ? el('b.focus-voice.lettering', {}, shot.voice) : null, shot.caption]),
      shot.hint ? el('small.focus-hint', {}, shot.hint) : null,
    ]);
    this.root = el('div.focus', {
      'data-screen': 'focus', 'data-focus': shot.id, 'data-reduced': reduced ? '' : null, 'data-empty': box ? null : '',
      style: `--focus-in:${T.inMs}ms;--focus-out:${T.outMs}ms`,
      // The whole press is the layer's: the world never sees it (no selection, no tool, no drag
      // underneath); its release skips the shot.
      onpointerdown: (e: PointerEvent) => { e.preventDefault(); e.stopPropagation(); this.pressed = true; },
      onpointerup: (e: PointerEvent) => { e.stopPropagation(); if (this.pressed) { this.pressed = false; this.dismiss(); } },
      oncontextmenu: (e: Event) => e.preventDefault(),
    }, [this.hole, this.ring, this.cap]);
    // The iris starts open (the whole window, no dim) and closes onto the element.
    this.place(this.hole, { x: 0, y: 0, w: vw, h: vh });
    this.setPhase('in');
    document.body.append(this.root);
    void this.root.offsetWidth; // flush, so the iris transitions from the open window
    this.lay(box, vw, vh);
    setAttr(this.root, 'data-on', '');
    window.addEventListener('keydown', this.onKey, true);
    this.timers.push(window.setTimeout(() => this.setPhase('hold'), T.inMs));
    // No end by itself: past the hold, it waits for the player.
    this.timers.push(window.setTimeout(() => { this.ready = true; if (this.root) setAttr(this.root, 'data-ready', ''); }, T.inMs + T.holdMs));
    this.raf = requestAnimationFrame(() => this.track());
    bus.emit('sfx', { cue: 'notice' });
    return true;
  }

  /** End the shot on screen at once (a debug hook, the shell), and anything queued behind it stays queued. */
  skip(): void {
    if (this.shot) this.end();
  }

  /** The player's click or key: past the hold, the shot fades out; before it, nothing. */
  private dismiss(): void {
    if (this.shot && this.ready) this.leave();
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    if (this.root) setAttr(this.root, 'data-phase', p);
  }

  /** The fade out, then the end. */
  private leave(): void {
    if (!this.shot || this.phase === 'out') return;
    const T = focusTiming(this.root?.hasAttribute('data-reduced') ?? false);
    this.setPhase('out');
    this.timers.push(window.setTimeout(() => this.end(), T.outMs));
  }

  private end(): void {
    // Ended under a held press: its release must not reach the game either.
    if (this.pressed) {
      this.pressed = false;
      window.addEventListener('pointerup', (e) => e.stopPropagation(), { capture: true, once: true });
    }
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey, true);
    this.root?.remove();
    this.root = this.hole = this.ring = this.cap = null;
    this.target = null;
    this.shot = null;
    this.phase = null;
    this.ready = false;
    this.lastBox = '';
  }

  /** Esc, Enter, Space: the game never sees them. Any key past the hold ends the shot; the others go on to the game. */
  private key(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); }
    this.dismiss();
  }

  /** The element's box in window px, or null when it is gone, hidden or empty. */
  private measure(): Box | null {
    const t = this.target;
    if (!t || !t.isConnected) return null;
    const r = t.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  }

  private place(node: HTMLElement, b: Box): void {
    node.style.left = `${b.x}px`; node.style.top = `${b.y}px`;
    node.style.width = `${b.w}px`; node.style.height = `${b.h}px`;
  }

  /** Hole, ring and caption around the element's box (or the caption alone, centred). */
  private lay(box: Box | null, vw: number, vh: number): void {
    const hole = box ? holeBox(box, 8, vw, vh) : null;
    // No element: the hole closes to a point at the window's centre — a plain dim.
    this.place(this.hole!, hole ?? { x: vw / 2, y: vh / 2, w: 0, h: 0 });
    if (hole) this.place(this.ring!, hole);
    const cw = this.cap!.offsetWidth || 360, ch = this.cap!.offsetHeight || 80;
    const at = captionAt(hole, cw, ch, vw, vh);
    this.cap!.style.left = `${at.x}px`;
    this.cap!.style.top = `${at.y}px`;
    this.lastBox = hole ? `${Math.round(hole.x)},${Math.round(hole.y)},${Math.round(hole.w)},${Math.round(hole.h)}` : '';
  }

  /** Every frame while the shot plays: follow the element (a HUD that re-lays itself out). */
  private track(): void {
    if (!this.shot || !this.root) return;
    if (this.phase !== 'in') {
      const box = this.measure(), vw = window.innerWidth, vh = window.innerHeight;
      const hole = box ? holeBox(box, 8, vw, vh) : null;
      const sig = hole ? `${Math.round(hole.x)},${Math.round(hole.y)},${Math.round(hole.w)},${Math.round(hole.h)}` : '';
      if (sig !== this.lastBox) this.lay(box, vw, vh);
    }
    this.raf = requestAnimationFrame(() => this.track());
  }
}
