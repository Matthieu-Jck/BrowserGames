// emblem-designer.ts — the claim's emblem, designed on CrierBelt's register (owner, 2026-10-13:
// "let's make the player design its logo at the very beginning, and the heart will have a flag
// with the logo on it"). Shown rather than told (D53): a preview of the emblem and four rows of
// choices drawn as what they give — the shapes in the field's colour, the symbols, the field's
// colours, the symbol's colours (each a dot of that colour bearing the symbol) — their names only
// on hover. The register reads `value` when it is signed (the shell sets it on the claim:
// `Sim.setEmblem`; the Heart's flag shows it).
import { EMBLEM_COLORS, EMBLEM_SHAPES, EMBLEM_SYMBOLS, type Emblem, type EmblemColor } from '@/content/emblem';
import { el, setAttr } from '@/core/dom';
import { drawEmblem, drawSymbol, emblemColor, shapeOutline } from '@/render/art/emblem';
import { flat, ink } from '@/render/art/ink';
import { C } from '@/render/art/tokens';
import { t, type MsgKey } from '@/i18n/i18n';

/** A canvas of `size` CSS px, painted at the screen's density. */
function paint(c: HTMLCanvasElement, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): void {
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  c.width = c.height = Math.round(size * dpr);
  c.style.width = c.style.height = `${size}px`;
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  draw(ctx, size);
}

type Part = 'shape' | 'symbol' | 'field' | 'ink';

export class EmblemDesigner {
  readonly root: HTMLElement;
  private e: Emblem;
  private readonly preview = el<'canvas'>('canvas.emb-preview', { 'aria-hidden': 'true' });
  private readonly buttons: Array<{ part: Part; v: string; btn: HTMLButtonElement; c: HTMLCanvasElement }> = [];
  /** Off once the register is stamped. */
  locked = false;

  constructor(initial: Emblem) {
    this.e = { ...initial };
    const row = (part: Part, values: readonly string[]): HTMLElement =>
      el('div.emb-row', { 'data-emb': part, role: 'group', 'aria-label': t(`emblem.${part}` as MsgKey) }, values.map((v) => {
        const c = el<'canvas'>('canvas', { 'aria-hidden': 'true' });
        const btn = el<'button'>('button.emb-pick', { type: 'button', 'data-emb-v': v, onclick: () => this.pick(part, v) }, c);
        this.buttons.push({ part, v, btn, c });
        return btn;
      }));
    this.root = el('div.emb', { 'data-emblem': '' }, [
      this.preview,
      el('div.emb-rows', {}, [
        row('shape', EMBLEM_SHAPES), row('symbol', EMBLEM_SYMBOLS), row('field', EMBLEM_COLORS), row('ink', EMBLEM_COLORS),
      ]),
    ]);
    this.redraw();
    this.refresh();
  }

  /** The choices' names (on hover) and the rows' in the language now. */
  refresh(): void {
    for (const b of this.buttons) {
      const name = t((b.part === 'field' || b.part === 'ink' ? `emblem.color.${b.v}` : `emblem.${b.part}.${b.v}`) as MsgKey);
      setAttr(b.btn, 'title', name);
      setAttr(b.btn, 'aria-label', name);
    }
    for (const r of this.root.querySelectorAll<HTMLElement>('.emb-row')) setAttr(r, 'aria-label', t(`emblem.${r.dataset.emb}` as MsgKey));
  }

  /** The emblem as designed. */
  get value(): Emblem { return { ...this.e }; }

  /** Start again from an emblem (a fresh register). */
  set(e: Emblem): void { this.e = { ...e }; this.locked = false; this.redraw(); }

  private pick(part: Part, v: string): void {
    if (this.locked) return;
    const e = { ...this.e, [part]: v } as Emblem;
    // A symbol must show on its field: the other colour gives way.
    if (e.field === e.ink) {
      if (part === 'field') e.ink = (v === 'paper' ? 'ink' : 'paper') as EmblemColor;
      else e.field = (v === 'paper' ? 'ink' : 'paper') as EmblemColor;
    }
    this.e = e;
    this.redraw();
  }

  private redraw(): void {
    const e = this.e;
    paint(this.preview, 76, (ctx, s) => drawEmblem(ctx, e, s / 2, s / 2, s * 0.44, 2.2));
    for (const b of this.buttons) {
      setAttr(b.btn, 'aria-pressed', String(e[b.part] === b.v));
      paint(b.c, 26, (ctx, s) => {
        const m = s / 2;
        switch (b.part) {
          case 'shape':
            flat(ctx, shapeOutline(b.v as Emblem['shape'], m, m, s * 0.4), emblemColor(e.field));
            ink(ctx, shapeOutline(b.v as Emblem['shape'], m, m, s * 0.4), { closed: true, w: 1.3, shade: false, taper: 0, jitter: 0 });
            break;
          case 'symbol':
            drawSymbol(ctx, b.v as Emblem['symbol'], m, m, s * 0.36, C.ink, 1.3);
            break;
          case 'field':
            dot(ctx, m, s * 0.38, emblemColor(b.v as EmblemColor));
            break;
          case 'ink':
            dot(ctx, m, s * 0.38, emblemColor(e.field));
            drawSymbol(ctx, e.symbol, m, m, s * 0.22, emblemColor(b.v as EmblemColor), 1.2);
            break;
        }
      });
    }
  }
}

/** A round swatch, inked. */
function dot(ctx: CanvasRenderingContext2D, m: number, r: number, col: string): void {
  const pts = Array.from({ length: 28 }, (_, i) => { const a = (i / 28) * Math.PI * 2; return [m + Math.cos(a) * r, m + Math.sin(a) * r] as [number, number]; });
  flat(ctx, pts, col);
  ink(ctx, pts, { closed: true, w: 1.2, shade: false, taper: 0, jitter: 0 });
}
