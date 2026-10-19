// toasts.ts — short notices at the top of the screen (placements, refusals, demolitions).
// They stack, fade after the time their words take to read, and repeated identical notices merge.
// Each opens with the kit's state mark (D89): a tick for good news, a pause for a warning, a stop for
// a refusal — the tone read before the words (the mark is an SVG: the toast's text stays the notice's
// own). A notice stays while the pointer is on it and goes at a click (owner, 2026-10-19: « the
// notifications shouldn't go away so fast »).
import { el } from '@/core/dom';
import type { NotifyKind } from '@/core/kinds';
import { mark, type MarkId } from './inspector/kit';

/** The mark a notice of each kind opens with (none for plain information). */
const MARK: Readonly<Record<NotifyKind, MarkId | null>> = { good: 'on', warn: 'pause', bad: 'off', info: null };
/** A notice's reading time: a floor, a share a character, a ceiling (ms). */
const READ_MS = 3000, PER_CHAR_MS = 60, MAX_MS = 12000;

export class Toasts {
  readonly root = el('div.toasts', { 'aria-live': 'polite' });

  show(kind: NotifyKind, text: string, ms = 2600): void {
    // At least the time its words take to read: about 3 s and 60 ms a character (a 140-character
    // notice stays 11 s), at most 12 s; a caller's longer time wins.
    const span = Math.max(ms, Math.min(MAX_MS, READ_MS + text.length * PER_CHAR_MS));
    const last = this.root.lastElementChild as HTMLElement | null;
    if (last && last.dataset.text === text) { last.dataset.n = String(Number(last.dataset.n ?? 1) + 1); this.arm(last, span); return; }
    const m = MARK[kind];
    const node = el('div.toast.cartouche', { 'data-kind': kind, 'data-text': text, title: text }, [m ? mark(m) : null, text]);
    // The pointer on it holds it; leaving gives it its time again; a click puts it away.
    node.addEventListener('pointerenter', () => { node.dataset.held = '1'; this.disarm(node); });
    node.addEventListener('pointerleave', () => { delete node.dataset.held; this.arm(node, span); });
    node.addEventListener('click', () => this.out(node));
    this.root.append(node);
    while (this.root.children.length > 4) this.root.firstElementChild?.remove();
    this.arm(node, span);
  }

  private disarm(node: HTMLElement): void {
    const prev = Number(node.dataset.timer ?? 0);
    if (prev) clearTimeout(prev);
    node.dataset.timer = '0';
    node.removeAttribute('data-out');
  }

  private arm(node: HTMLElement, ms: number): void {
    this.disarm(node);
    if (node.dataset.held) return;
    node.dataset.timer = String(window.setTimeout(() => this.out(node), ms));
  }

  private out(node: HTMLElement): void {
    node.setAttribute('data-out', '');
    window.setTimeout(() => node.remove(), 300);
  }
}
