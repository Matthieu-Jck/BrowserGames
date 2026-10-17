// sheet.ts — a side panel as a bottom sheet on a narrow window (D96). Below `NARROW` (ui/fit.ts)
// the inspector, the specialised views' card and the land panel leave the window's right side for
// its bottom (responsive.css); this gives each a grip on its top edge. A tap on the grip folds the
// sheet to its header (« peek ») or opens it half-way; a drag pulls it up to full height (never over
// the HUD: the CSS caps it under `--hud-b`) or down, and it snaps to the nearest of the three on
// release — a flick goes on in its direction. The state is `data-sheet="peek|half|full"` on the
// panel; each time the panel shows again it opens half-way. On a wide window the grip is hidden and
// nothing here acts. The panel's own code knows nothing of it: the shell installs it (app.ts).
import { el, setAttr } from '@/core/dom';
import { t } from '@/i18n/i18n';
import { NARROW } from './fit';
import { lang } from './inspector/kit';

export type SheetState = 'peek' | 'half' | 'full';

/** A drag shorter than this (screen px) is a tap. */
const TAP_PX = 6;
/** A release faster than this (screen px per ms) goes on to the next state in its direction. */
const FLICK = 0.5;

/** Which state a sheet `h` px tall snaps to, given the three heights and the release's speed (+ down). */
export function snapSheet(h: number, heights: Record<SheetState, number>, v: number): SheetState {
  const order: SheetState[] = ['peek', 'half', 'full'];
  if (Math.abs(v) >= FLICK) {
    // A flick: the next state past the height it was released at, in its direction.
    if (v > 0) return [...order].reverse().find((s) => heights[s] < h - 1) ?? 'peek';
    return order.find((s) => heights[s] > h + 1) ?? 'full';
  }
  let best: SheetState = 'half', bd = Infinity;
  for (const s of order) {
    const d = Math.abs(heights[s] - h);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

/** What a tap on the grip does: a folded sheet opens half-way; an open one folds. */
export function tapSheet(s: SheetState): SheetState {
  return s === 'peek' ? 'half' : 'peek';
}

const narrowQuery = `(max-width: ${NARROW - 1}px)`;

/** Give a panel its grip (first child) and the sheet's gestures. */
export function installSheet(panel: HTMLElement): void {
  const grip = el<'button'>('button.sheet-grip', { type: 'button' }, [el('i')]);
  lang(grip, () => t('sheet.grip'), 'aria-label');
  lang(grip, () => t('sheet.grip'), 'title');
  panel.prepend(grip);
  setAttr(panel, 'data-sheet', 'half');
  // Shown again: half-way open (a new selection, the view's card coming back).
  new MutationObserver(() => { if (!panel.hasAttribute('hidden')) setAttr(panel, 'data-sheet', 'half'); })
    .observe(panel, { attributes: true, attributeFilter: ['hidden'] });

  let drag: { id: number; y0: number; h0: number; y: number; t: number; v: number; moved: number } | null = null;

  /** The three heights in screen px: the header alone, half-way, all the room under the HUD. */
  const heights = (): Record<SheetState, number> => {
    const st = getComputedStyle(panel);
    const zoom = Number.parseFloat(document.documentElement.style.getPropertyValue('--ui-zoom')) || 1;
    const px = (name: string, d: number): number => (Number.parseFloat(st.getPropertyValue(name)) || d) * zoom;
    const r = panel.getBoundingClientRect();
    const full = Math.max(80, r.bottom - px('--hud-b', 100) - px('--gap', 12));
    const peek = px('--sheet-peek', 84);
    return { peek, half: Math.max(peek, Math.min(full, window.innerHeight * 0.5)), full };
  };

  grip.addEventListener('pointerdown', (e) => {
    if (!matchMedia(narrowQuery).matches) return;
    e.preventDefault();
    const h0 = panel.getBoundingClientRect().height;
    drag = { id: e.pointerId, y0: e.clientY, h0, y: e.clientY, t: e.timeStamp, v: 0, moved: 0 };
    grip.setPointerCapture(e.pointerId);
    setAttr(panel, 'data-dragging', '');
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dt = Math.max(1, e.timeStamp - drag.t);
    drag.v = (e.clientY - drag.y) / dt;
    drag.y = e.clientY; drag.t = e.timeStamp;
    drag.moved = Math.max(drag.moved, Math.abs(e.clientY - drag.y0));
    const H = heights();
    const h = Math.min(H.full, Math.max(H.peek, drag.h0 - (e.clientY - drag.y0)));
    const zoom = Number.parseFloat(document.documentElement.style.getPropertyValue('--ui-zoom')) || 1;
    panel.style.maxHeight = `${h / zoom}px`;
    panel.style.height = `${h / zoom}px`;
  });
  const end = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    const h = panel.getBoundingClientRect().height;
    panel.style.maxHeight = '';
    panel.style.height = '';
    panel.removeAttribute('data-dragging');
    const now = (panel.getAttribute('data-sheet') ?? 'half') as SheetState;
    const next = d.moved < TAP_PX ? tapSheet(now) : snapSheet(h, heights(), d.v);
    setAttr(panel, 'data-sheet', next);
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  // Keyboard: Enter / Space on the grip folds or opens it, as a tap does.
  grip.addEventListener('click', (e) => {
    if (e.detail !== 0) return; // a pointer's click was handled on pointerup
    setAttr(panel, 'data-sheet', tapSheet((panel.getAttribute('data-sheet') ?? 'half') as SheetState));
  });
}
