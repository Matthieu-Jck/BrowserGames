// toasts.ts — short notices at the top of the screen (placements, refusals, demolitions).
// They stack, fade after a few seconds, and repeated identical notices merge. Each opens with the
// kit's state mark (D89): a tick for good news, a pause for a warning, a stop for a refusal — the
// tone read before the words (the mark is an SVG: the toast's text stays the notice's own).
import { el } from '@/core/dom';
import type { NotifyKind } from '@/core/kinds';
import { mark, type MarkId } from './inspector/kit';

/** The mark a notice of each kind opens with (none for plain information). */
const MARK: Readonly<Record<NotifyKind, MarkId | null>> = { good: 'on', warn: 'pause', bad: 'off', info: null };

export class Toasts {
  readonly root = el('div.toasts', { 'aria-live': 'polite' });

  show(kind: NotifyKind, text: string, ms = 2600): void {
    const last = this.root.lastElementChild as HTMLElement | null;
    if (last && last.dataset.text === text) { last.dataset.n = String(Number(last.dataset.n ?? 1) + 1); this.arm(last, ms); return; }
    const m = MARK[kind];
    const node = el('div.toast.cartouche', { 'data-kind': kind, 'data-text': text }, [m ? mark(m) : null, text]);
    this.root.append(node);
    while (this.root.children.length > 4) this.root.firstElementChild?.remove();
    this.arm(node, ms);
  }

  private arm(node: HTMLElement, ms: number): void {
    const prev = Number(node.dataset.timer ?? 0);
    if (prev) clearTimeout(prev);
    node.removeAttribute('data-out');
    node.dataset.timer = String(window.setTimeout(() => {
      node.setAttribute('data-out', '');
      window.setTimeout(() => node.remove(), 300);
    }, ms));
  }
}
