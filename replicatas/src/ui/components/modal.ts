// modal.ts — the shared modal: title/body/choices, plus a card-picker variant.
import { el, clear, qs } from '../dom';
import { cardEl } from './card-el';
import type { CardInstance } from '@/combat/combat-types';

export interface ModalChoice {
  label: string;
  sub?: string;
  cls?: string;
  disabled?: boolean;
  fn(): void;
}

let root: HTMLElement | null = null;

export function initModal(): void {
  root = el('div', { id: 'modal-root' });
  document.body.appendChild(root);
}

export function showModal(opts: { title: string; tag?: string; body?: string; choices: ModalChoice[]; content?: HTMLElement }): void {
  if (!root) return;
  clear(root);
  const box = el('div.modal-box.panel', {}, [
    el('div.ptitle', {}, [el('span', {}, opts.title), el('span.tag', {}, opts.tag ?? '')]),
    opts.body ? el('div.modal-body', { html: opts.body }) : null,
    opts.content ?? null,
    el('div.modal-choices', {}, opts.choices.map((c) =>
      el('button', { cls: c.cls ?? '', disabled: c.disabled, onclick: () => { closeModal(); c.fn(); } }, [
        c.label as unknown as Node,
        c.sub ? el('span.sub', {}, c.sub) : null,
      ]),
    )),
  ]);
  root.appendChild(box);
  root.classList.add('visible');
}

export function closeModal(): void {
  root?.classList.remove('visible');
  if (root) clear(root);
}

/** Pick up to `count` cards from a list. onDone receives chosen uids. */
export function cardPicker(opts: {
  title: string;
  cards: CardInstance[];
  count: number;
  filter?: (c: CardInstance) => boolean;
  cancellable?: boolean;
  onDone(uids: string[]): void;
}): void {
  if (!root) return;
  clear(root);
  const chosen = new Set<string>();
  const grid = el('div.card-grid');
  for (const inst of opts.cards) {
    if (opts.filter && !opts.filter(inst)) continue;
    const node = cardEl(inst);
    node.addEventListener('click', () => {
      if (chosen.has(inst.uid)) { chosen.delete(inst.uid); node.classList.remove('selected'); }
      else if (chosen.size < opts.count) { chosen.add(inst.uid); node.classList.add('selected'); }
      qs<HTMLButtonElement>('#picker-done', root!).disabled = chosen.size === 0;
    });
    grid.appendChild(node);
  }
  const box = el('div.modal-box.panel', { style: 'width:min(940px,96vw)' }, [
    el('div.ptitle', {}, [el('span', {}, opts.title), el('span.tag', {}, `choose up to ${opts.count}`)]),
    grid,
    el('div.modal-choices', {}, [
      el('button', { id: 'picker-done', disabled: true, onclick: () => { closeModal(); opts.onDone([...chosen]); } }, 'CONFIRM'),
      opts.cancellable !== false ? el('button.ghost', { onclick: () => { closeModal(); opts.onDone([]); } }, 'CANCEL') : null,
    ]),
  ]);
  root.appendChild(box);
  root.classList.add('visible');
}
