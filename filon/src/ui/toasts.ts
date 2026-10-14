// toasts.ts — short notices at the top of the screen (placements, refusals, demolitions).
// They stack, fade after a few seconds, and repeated identical notices merge.
import { el } from '@/core/dom';
import type { NotifyKind } from '@/core/kinds';

export class Toasts {
  readonly root = el('div.toasts', { 'aria-live': 'polite' });

  show(kind: NotifyKind, text: string, ms = 2600): void {
    const last = this.root.lastElementChild as HTMLElement | null;
    if (last && last.dataset.text === text) { last.dataset.n = String(Number(last.dataset.n ?? 1) + 1); this.arm(last, ms); return; }
    const node = el('div.toast.cartouche', { 'data-kind': kind, 'data-text': text }, text);
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
