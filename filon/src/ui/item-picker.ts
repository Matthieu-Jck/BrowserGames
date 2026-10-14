// item-picker.ts — choosing an item: a button that shows the chosen item (its icon and its name,
// or the « none » choice) and opens an inked list of the items, each with its icon. It stands
// wherever the player picks an item (a router's filters, a store's outlets, a skydock's route),
// because a native <option> cannot hold an image (owner, 2026-10-13: icons next to item names).
//
// Keyboard: on the button ↓ ↑ Enter or Space open the list; in it ↓ ↑ Home End PageUp PageDown
// move, typing the first letters jumps to an item, Enter or Space picks, Esc or Tab close it. The
// keys it uses never reach the game (pan, hotkeys), as a focused <select> did. The list lives on
// <body>, over the panels and the full screens, zoomed with the UI scale like the building card,
// and closes when its button goes (an inspector rebuilt) or the pointer presses elsewhere.
//
// The button keeps a <select>-like surface for the tutorial's guide and scripts: its `value` is
// the item id ('' for none), `data-item` too, and the hooks given in `attrs` sit on it. Items the
// base has already seen can come first (`known`), the others under a quiet divider: the first
// hour's list is short, and nothing is hidden.
import { ITEM_IDS } from '@/content/registry';
import { el, setAttr } from '@/core/dom';
import { t } from '@/i18n/i18n';
import { itemMention, nameOf } from './mention';

export interface ItemPickerOptions {
  /** The items offered (indices), in order. */
  readonly items: readonly number[];
  /** The chosen item (-1: the « none » choice). */
  readonly value: number;
  /** The label of the « none » choice (value -1), first in the list; null: there is none. */
  readonly none: string | null;
  /** The player picked another item (not called by `set`). */
  readonly onPick: (item: number) => void;
  /** Extra attributes on the button: data-* hooks for the guide and the scripts, a title. */
  readonly attrs?: Record<string, unknown>;
  /** The accessible name, when no visible label names the picker. */
  readonly label?: string;
  /** Items the base has seen (made, used or held): listed first, the rest under a divider. */
  readonly known?: (item: number) => boolean;
  /** The button's face for the « none » choice ('' : an empty slot, drawn by CSS); default: `none`'s label. */
  readonly noneFace?: string;
}

/** A value the button may show: an item, or none. */
const NONE = -1;

export class ItemPicker {
  readonly root: HTMLButtonElement;
  private cur: number;
  private readonly face: HTMLElement;

  constructor(readonly opts: ItemPickerOptions) {
    this.cur = opts.value;
    this.face = el('span.ipick-face');
    this.root = el<'button'>('button.ipick', {
      type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': opts.label ?? null,
      ...opts.attrs,
      onclick: () => (popup().owner === this ? popup().close(false) : popup().open(this)),
      onkeydown: (e: KeyboardEvent) => this.key(e),
      onkeyup: (e: KeyboardEvent) => { if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); } },
    }, [this.face, el('span.ipick-caret', { 'aria-hidden': 'true' }, '▾')]);
    this.paint();
  }

  /** The chosen item (-1: none). */
  get value(): number { return this.cur; }

  /** Show another item (the colony changed it): no `onPick`. */
  set(item: number): void {
    if (item === this.cur) return;
    this.cur = item;
    this.paint();
    if (inst?.owner === this) inst.mark(item);
  }

  /** The player chose `item` in the list. */
  choose(item: number): void {
    if (item === this.cur) return;
    this.cur = item;
    this.paint();
    this.opts.onPick(item);
  }

  private paint(): void {
    const has = this.cur >= 0;
    this.face.replaceChildren(has ? itemMention(this.cur) : el('span.ipick-none', { title: this.opts.none ?? '' }, this.opts.noneFace ?? this.opts.none ?? '—'));
    setAttr(this.root, 'value', has ? ITEM_IDS[this.cur]! : '');
    setAttr(this.root, 'data-item', has ? ITEM_IDS[this.cur]! : '');
    setAttr(this.root, 'data-none', has ? null : '');
  }

  private key(e: KeyboardEvent): void {
    const pop = popup();
    const open = pop.owner === this;
    const k = e.key;
    let used = true;
    if (open) used = pop.key(e);
    else if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') pop.open(this);
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { pop.open(this); pop.key(e); }
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }
}

/** A picker over `items` (see `ItemPickerOptions`). */
export const itemPicker = (opts: ItemPickerOptions): ItemPicker => new ItemPicker(opts);

// ── the list (one for the whole page) ─────────────────────────────────────────

/** Fold a name for type-ahead: no case, no accents (« Écume » starts with « ec »). */
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

interface Opt { readonly item: number; readonly node: HTMLElement; readonly key: string }

class ListPop {
  readonly root: HTMLElement;
  owner: ItemPicker | null = null;
  private opts: Opt[] = [];
  private active = 0;
  private typed = '';
  private typedAt = 0;
  private raf = 0;
  private readonly outside = (e: PointerEvent): void => {
    const n = e.target as Node | null;
    if (n && (this.root.contains(n) || this.owner?.root.contains(n))) return;
    this.close(false);
  };

  constructor() {
    this.root = el('div.ipick-pop.cartouche', { role: 'listbox', id: 'ipick-list', 'data-screen': 'item-picker', hidden: '' });
    // Keep the focus on the button while the pointer works the list.
    this.root.addEventListener('pointerdown', (e) => e.preventDefault());
  }

  open(owner: ItemPicker): void {
    if (this.owner && this.owner !== owner) this.close(false);
    this.owner = owner;
    const o = owner.opts;
    const known = o.known;
    const first = known ? o.items.filter((i) => known(i) || i === owner.value) : [...o.items];
    const rest = known ? o.items.filter((i) => !first.includes(i)) : [];
    this.opts = [];
    const kids: HTMLElement[] = [];
    const add = (item: number, face: HTMLElement): void => {
      const k = this.opts.length;
      const node = el('div.ipick-opt', {
        role: 'option', id: `ipick-o${k}`, 'data-item': item >= 0 ? ITEM_IDS[item]! : '',
        onpointermove: () => this.moveTo(k, false),
        onclick: () => this.pick(k),
      }, face);
      this.opts.push({ item, node, key: fold(item >= 0 ? nameOf(item) : o.none ?? '') });
      kids.push(node);
    };
    if (o.none !== null) add(NONE, el('span.ipick-none', {}, o.none));
    for (const i of first) add(i, itemMention(i));
    if (rest.length) {
      kids.push(el('div.ipick-sep', { role: 'presentation' }, t('pick.others')));
      for (const i of rest) add(i, itemMention(i));
    }
    this.root.replaceChildren(...kids);
    setAttr(this.root, 'aria-label', o.label ?? null);
    if (!this.root.isConnected) document.body.append(this.root);
    setAttr(this.root, 'hidden', null);
    owner.root.setAttribute('aria-expanded', 'true');
    owner.root.setAttribute('aria-controls', this.root.id);
    setAttr(owner.root, 'data-open', '');
    this.mark(owner.value);
    this.place();
    document.addEventListener('pointerdown', this.outside, true);
    window.addEventListener('blur', this.onBlur);
    const follow = (): void => {
      if (!this.owner) return;
      // Its button went (an inspector rebuilt) or was hidden (the panel closed): the list goes too.
      const r = this.owner.root.getBoundingClientRect();
      if (!this.owner.root.isConnected || (r.width === 0 && r.height === 0)) { this.close(false); return; }
      this.place();
      this.raf = requestAnimationFrame(follow);
    };
    this.raf = requestAnimationFrame(follow);
  }

  private readonly onBlur = (): void => this.close(false);

  close(refocus: boolean): void {
    const o = this.owner;
    if (!o) return;
    this.owner = null;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('pointerdown', this.outside, true);
    window.removeEventListener('blur', this.onBlur);
    setAttr(this.root, 'hidden', '');
    o.root.setAttribute('aria-expanded', 'false');
    o.root.removeAttribute('aria-activedescendant');
    setAttr(o.root, 'data-open', null);
    this.root.replaceChildren();
    this.opts = [];
    if (refocus && o.root.isConnected) o.root.focus();
  }

  /** Show `item` as the chosen one, and make it the active option. */
  mark(item: number): void {
    let at = 0;
    this.opts.forEach((p, k) => {
      setAttr(p.node, 'aria-selected', p.item === item ? 'true' : 'false');
      if (p.item === item) at = k;
    });
    this.moveTo(at, true);
  }

  private moveTo(k: number, scroll: boolean): void {
    if (!this.opts.length) return;
    this.active = Math.max(0, Math.min(this.opts.length - 1, k));
    this.opts.forEach((p, j) => setAttr(p.node, 'data-active', j === this.active ? '' : null));
    const node = this.opts[this.active]!.node;
    this.owner?.root.setAttribute('aria-activedescendant', node.id);
    if (scroll) {
      const top = node.offsetTop, bottom = top + node.offsetHeight;
      if (top < this.root.scrollTop) this.root.scrollTop = top - 4;
      else if (bottom > this.root.scrollTop + this.root.clientHeight) this.root.scrollTop = bottom - this.root.clientHeight + 4;
    }
  }

  private pick(k: number): void {
    const o = this.owner, p = this.opts[k];
    if (!o || !p) return;
    this.close(true);
    o.choose(p.item);
  }

  /** A key while the list is open; true when it was used. */
  key(e: KeyboardEvent): boolean {
    const page = 8;
    switch (e.key) {
      case 'ArrowDown': this.moveTo(this.active + 1, true); return true;
      case 'ArrowUp': this.moveTo(this.active - 1, true); return true;
      case 'Home': this.moveTo(0, true); return true;
      case 'End': this.moveTo(this.opts.length - 1, true); return true;
      case 'PageDown': this.moveTo(this.active + page, true); return true;
      case 'PageUp': this.moveTo(this.active - page, true); return true;
      case 'Enter': case ' ': this.pick(this.active); return true;
      case 'Escape': this.close(true); return true;
      case 'Tab': this.close(false); return false; // the focus moves on as usual
      default: break;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return false;
    // Type-ahead: the letters typed within a moment; one letter again cycles through its items.
    const now = performance.now();
    const ch = fold(e.key);
    this.typed = now - this.typedAt > 700 ? ch : this.typed + ch;
    this.typedAt = now;
    const same = [...this.typed].every((c) => c === ch);
    const n = this.opts.length;
    const from = same || this.typed.length === 1 ? this.active + 1 : this.active;
    for (let j = 0; j < n; j++) {
      const k = (from + j) % n;
      if (this.opts[k]!.key.startsWith(same ? ch : this.typed)) { this.moveTo(k, true); break; }
    }
    return true;
  }

  /** Under the button (above it when the window has no room below), inside the window. */
  private place(): void {
    const o = this.owner;
    if (!o) return;
    const zoom = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const r = o.root.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 10, above = r.top - 10;
    const down = below >= Math.min(220 * zoom, above) || below >= above;
    const room = Math.max(120 * zoom, down ? below : above);
    const maxH = Math.min(room, 360 * zoom);
    this.root.style.maxHeight = `${Math.floor(maxH / zoom)}px`;
    this.root.style.minWidth = `${Math.ceil(r.width / zoom)}px`;
    const w = this.root.offsetWidth * zoom, h = this.root.offsetHeight * zoom;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
    const y = down ? r.bottom + 4 : r.top - 4 - h;
    this.root.style.left = `${Math.round(x / zoom)}px`;
    this.root.style.top = `${Math.round(y / zoom)}px`;
    setAttr(this.root, 'data-up', down ? null : '');
  }
}

/** The list, made on first use (node tests import this module without a DOM). */
let inst: ListPop | null = null;
const popup = (): ListPop => (inst ??= new ListPop());
