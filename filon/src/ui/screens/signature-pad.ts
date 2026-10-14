// signature-pad.ts — the box at the foot of CrierBelt's registration form (D31) where the player
// signs: a canvas drawn with the pointer (mouse, pen or finger), ink thinning as the hand speeds
// up, the strokes smoothed through their midpoints. From the keyboard (Enter or Space on the
// focused box) it signs for the player: a cursive scrawl drawn from the company's name, the same
// for the same name. `signed` once there is enough ink to be a signature, not a stray click.
// UI only: it stores nothing, the sim never sees it.

/** Least ink (CSS px of stroke) that counts as a signature. */
const MIN_INK = 70;
/** Stroke width (CSS px) when the hand is slow, and the floor when it is fast. */
const W_SLOW = 3.1, W_FAST = 1.3;

type Pt = { x: number; y: number; w: number };

export class SignaturePad {
  readonly canvas: HTMLCanvasElement;
  /** Called whenever the ink changes (a stroke, a clear). */
  onChange: () => void = () => {};
  private readonly ctx: CanvasRenderingContext2D;
  private strokes: Pt[][] = [];
  private ink = 0;
  private live: Pt[] | null = null;
  private lastT = 0;
  private dpr = 1;

  constructor(private readonly w: number, private readonly h: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ir-pad-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('data-intro-sign', '');
    this.ctx = this.canvas.getContext('2d')!;
    this.fit();
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', () => this.up());
    this.canvas.addEventListener('pointercancel', () => this.up());
  }

  /** Enough ink to be a signature. */
  get signed(): boolean {
    return this.ink >= MIN_INK;
  }

  clear(): void {
    this.strokes = [];
    this.live = null;
    this.ink = 0;
    this.paint();
    this.onChange();
  }

  /** Sign for the player (the keyboard's way): a scrawl drawn from the name, the same for the same name. */
  autograph(name: string): void {
    const letters = [...(name.trim() || 'X')].slice(0, 11);
    let seed = 7;
    for (const ch of letters) seed = (seed * 31 + ch.codePointAt(0)!) >>> 0;
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 16777216; };
    const base = this.h * 0.66, step = Math.min(20, (this.w - 46) / (letters.length + 1));
    const pts: Pt[] = [];
    let x = 18;
    // A capital: a tall loop.
    for (let k = 0; k <= 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      pts.push({ x: x + Math.sin(a) * 7 + k * 0.9, y: base - (1 - Math.cos(a)) * this.h * 0.3, w: 0 });
    }
    x += 16;
    // Then one rolling arch or loop per letter, some taller than others.
    for (let i = 1; i < letters.length; i++) {
      const tall = rnd() < 0.3 ? 0.42 : 0.2 + rnd() * 0.08;
      for (let k = 1; k <= 8; k++) {
        const a = (k / 8) * Math.PI;
        pts.push({ x: x + (k / 8) * step - Math.sin(a * 2) * 2.5, y: base - Math.sin(a) * this.h * tall, w: 0 });
      }
      x += step;
    }
    // And the flourish back under it.
    const end = x;
    for (let k = 1; k <= 10; k++) pts.push({ x: end - (k / 10) * (end - 26) * 0.85, y: base + 7 + Math.sin((k / 10) * Math.PI) * 4, w: 0 });
    for (let i = 0; i < pts.length; i++) pts[i]!.w = W_SLOW - (W_SLOW - W_FAST) * Math.min(1, Math.abs(Math.sin(i * 0.7)) * 0.9);
    this.strokes = [pts];
    this.ink = length(pts);
    this.paint();
    this.onChange();
  }

  /** Back-store at the screen's density (call when shown: the pixel ratio may have changed). */
  fit(): void {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    if (dpr === this.dpr && this.canvas.width > 0) return;
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.paint();
  }

  // ── drawing ──────────────────────────────────────────────────────────────

  private at(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * this.w) / (r.width || 1), y: ((e.clientY - r.top) * this.h) / (r.height || 1) };
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.at(e);
    this.live = [{ ...p, w: W_SLOW }];
    this.strokes.push(this.live);
    this.lastT = e.timeStamp;
    this.paint();
  }

  private move(e: PointerEvent): void {
    if (!this.live) return;
    const p = this.at(e);
    const last = this.live[this.live.length - 1]!;
    const d = Math.hypot(p.x - last.x, p.y - last.y);
    if (d < 1.2) return;
    // Faster strokes run thinner (px per ms), eased so the line does not flicker.
    const v = d / Math.max(1, e.timeStamp - this.lastT);
    const w = Math.max(W_FAST, Math.min(W_SLOW, W_SLOW - v * 0.9));
    this.live.push({ ...p, w: last.w * 0.6 + w * 0.4 });
    this.ink += d;
    this.lastT = e.timeStamp;
    this.paint();
    this.onChange();
  }

  private up(): void {
    if (!this.live) return;
    // A tap leaves a dot of ink, not nothing.
    if (this.live.length === 1) this.ink += 2;
    this.live = null;
    this.paint();
    this.onChange();
  }

  private paint(): void {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    c.strokeStyle = getComputedStyle(this.canvas).getPropertyValue('--sig-ink').trim() || '#1e1b2e';
    c.fillStyle = c.strokeStyle;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const s of this.strokes) {
      if (s.length === 1) { c.beginPath(); c.arc(s[0]!.x, s[0]!.y, s[0]!.w / 2, 0, Math.PI * 2); c.fill(); continue; }
      // Through the midpoints, each segment at its own width: a quill, not a marker.
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1]!, b = s[i]!;
        const p0 = i === 1 ? a : mid(s[i - 2]!, a), p1 = mid(a, b);
        c.beginPath();
        c.lineWidth = (a.w + b.w) / 2;
        c.moveTo(p0.x, p0.y);
        c.quadraticCurveTo(a.x, a.y, p1.x, p1.y);
        if (i === s.length - 1) c.lineTo(b.x, b.y);
        c.stroke();
      }
    }
  }
}

const mid = (a: Pt, b: Pt): { x: number; y: number } => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function length(s: readonly Pt[]): number {
  let n = 0;
  for (let i = 1; i < s.length; i++) n += Math.hypot(s[i]!.x - s[i - 1]!.x, s[i]!.y - s[i - 1]!.y);
  return n;
}
