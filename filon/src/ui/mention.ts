// mention.ts — an item named in the UI shows its icon beside its name (owner, 2026-10-13: "when
// in the UI you refer to an item, like iron ore, try to put the icon of the item next to the
// text"). One way to write it, everywhere:
//
//   · `itemMention(item)` builds the mention: the item's glyph (the world's pixels, copied from the
//     atlas) and its name, inline. The icon is sized in em, so it follows the text it sits in and
//     the UI scale; `span.imention[data-item]` is the hook.
//   · `itemRef(item)` is a placeholder value for a translated sentence:
//     `t('toast.vein', { n, item: itemRef(i) })`. It is a short token, « ⟪i:iron_ore⟫ », that the
//     text carries as is (fill, plurals, `Intl.ListFormat`, `setText`'s change check). Once the
//     text is on the page, the mention layer (`installMentions`, a MutationObserver over the body,
//     like the ocelle sign's in coin.ts) swaps each token for the mention. So the sentence keeps
//     its word order in both languages, and every writer — `setText`, `el()`, a toast — gets the
//     icon with no change but the placeholder's value.
//   · A token may carry its own words, « ⟪i:coal|charbon⟫ »: running prose (a hint, content text)
//     keeps its wording and case, and the icon goes in front. `markItems` writes those tokens for
//     the items a text is known to name.
//   · `plain(text)` turns tokens into bare names, for what cannot hold an icon (a `title`, an
//     `aria-label`, `confirm()`). The layer also does it by itself for those attributes and for
//     native `<option>`s, so a token never shows.
//
// A token without words is resolved at render time, in the current language: a language switch
// renames every such mention on the page (`onLocale`). Before `installMentions` (node tests) a
// mention is its name alone. See docs/i18n.md (« Naming an item ») and docs/ui.md.
import { ITEM_IDS, itemDef, itemIdx } from '@/content/registry';
import { el, screenText } from '@/core/dom';
import { locale, onLocale } from '@/i18n/i18n';
import { frameCanvas, iKey, type Atlas } from '@/render/art/atlas';
import './styles/mention.css';

/** The token's delimiters: two characters no message or name uses; `|` opens its own words. */
const OPEN = '⟪';
const CLOSE = '⟫';
const TOKEN = /⟪i:([a-z0-9_]+)(?:\|([^⟪⟫]*))?⟫/g;

/** An item as an index or an id. */
export type ItemLike = number | string;

const idOf = (item: ItemLike): string => (typeof item === 'number' ? (ITEM_IDS[item] ?? '') : item);
const indexOf = (item: ItemLike): number => (typeof item === 'number' ? item : itemIdx(item));

/** The item's name in the current language. */
export const nameOf = (item: ItemLike): string => itemDef(indexOf(item)).name[locale()];

/**
 * A placeholder value naming an item: « ⟪i:iron_ore⟫ », shown on the page as its icon and name; with
 * `words`, those words instead of the name (« ⟪i:coal|charbon⟫ »).
 */
export function itemRef(item: ItemLike, words?: string): string {
  const id = idOf(item);
  itemIdx(id); // an unknown item fails here, loudly, not as a stray token on screen
  const w = words?.replace(/[⟪⟫|]/g, '');
  return w ? `${OPEN}i:${id}|${w}${CLOSE}` : `${OPEN}i:${id}${CLOSE}`;
}

/** Several items as one phrase in the current language: « A, B et C », each a mention. */
export function itemList(items: readonly ItemLike[], type: 'conjunction' | 'disjunction' = 'conjunction'): string {
  return new Intl.ListFormat(locale(), { type }).format(items.map((i) => itemRef(i)));
}

/** Does a text name an item through a token? */
export const hasRef = (text: string): boolean => text.includes(`${OPEN}i:`);

/** A text with every token replaced by its words, or the item's bare name (titles, aria-labels, dialogs, tests). */
export function plain(text: string): string {
  return hasRef(text) ? text.replace(TOKEN, (_, id: string, words?: string) => words || nameOf(id)) : text;
}

/**
 * A text written elsewhere (content: a quest's own label, a guide hint) that names some of `items`
 * in plain words: the first time each name appears as a whole word, in any case, it becomes that
 * item's reference, keeping the text's own words. « Du charbon pour elle » → « Du ⟪i:coal|charbon⟫
 * pour elle ».
 */
export function markItems(text: string, items: readonly ItemLike[]): string {
  let out = text;
  const L = locale();
  for (const it of new Set(items.map(idOf))) {
    const name = nameOf(it);
    const lower = out.toLocaleLowerCase(L), want = name.toLocaleLowerCase(L);
    let at = lower.indexOf(want);
    // Whole words only, and never inside a token already written.
    while (at >= 0) {
      const before = out[at - 1] ?? ' ', after = out[at + name.length] ?? ' ';
      const inToken = out.lastIndexOf(OPEN, at) > out.lastIndexOf(CLOSE, at);
      if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after) && !inToken) break;
      at = lower.indexOf(want, at + 1);
    }
    if (at < 0) continue;
    const found = out.slice(at, at + name.length);
    out = out.slice(0, at) + itemRef(it, found === name ? undefined : found) + out.slice(at + name.length);
  }
  return out;
}

/** A text cut at its tokens: strings and items (with their own words, if any), in order. */
export function splitRefs(text: string): Array<string | { item: string; words?: string }> {
  const out: Array<string | { item: string; words?: string }> = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > at) out.push(text.slice(at, m.index));
    out.push(m[2] ? { item: m[1]!, words: m[2] } : { item: m[1]! });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

// ── the mention ───────────────────────────────────────────────────────────────

/** The atlas the icons come from (set once by `installMentions`). */
let atlas: Atlas | null = null;
/** One PNG per item, baked once from the atlas: every mention of it shares the decoded image. */
const icons = new Map<string, string>();
/** Icon source size in CSS px: crisp up to about 2.5 em at the largest UI scale on a 2× screen. */
const ICON_PX = 40;

/** The item's icon as a data URL ('' without the atlas or the frame). */
function iconUrl(id: string): string {
  let url = icons.get(id);
  if (url !== undefined) return url;
  url = '';
  const f = atlas?.frames.get(iKey(id));
  if (atlas && f) url = frameCanvas(atlas, iKey(id), ICON_PX / f.w)?.toDataURL() ?? '';
  if (atlas) icons.set(id, url); // before the atlas: try again later
  return url;
}

export interface MentionOptions {
  /** Show the name beside the icon (default). Without it the name is the mention's tooltip and accessible label. */
  readonly name?: boolean;
  /** A larger icon (lists, rows where the item is the subject). */
  readonly big?: boolean;
  /** Words to show instead of the item's name (running prose keeps its own); they do not follow a language switch. */
  readonly words?: string;
}

/** An item named in the UI: its icon and its name, inline (`span.imention[data-item]`). */
export function itemMention(item: ItemLike, opts: MentionOptions = {}): HTMLElement {
  const id = idOf(item);
  const name = nameOf(id);
  const url = iconUrl(id);
  const showName = opts.name !== false;
  return el('span.imention', {
    'data-item': id,
    'data-big': opts.big ? '' : null,
    'data-bare': showName ? null : '',
    'data-words': opts.words ? '' : null,
    title: showName ? (opts.words ? name : null) : name,
    role: showName ? null : 'img',
    'aria-label': showName ? null : name,
  }, [
    url ? el('img.imention-icon', { src: url, alt: '', draggable: 'false' }) : null,
    showName ? el('span.imention-name', {}, opts.words || name) : null,
  ]);
}

/** A text's nodes with its tokens as mentions (for a caller that builds DOM without waiting for the layer). */
export function richNodes(text: string): Array<string | HTMLElement> {
  return splitRefs(text).map((p) => (typeof p === 'string' ? p : itemMention(p.item, { words: p.words })));
}

// ── the mention layer ─────────────────────────────────────────────────────────

/** Where an icon cannot go: tokens there become bare names. */
const PLAIN_ONLY = 'select, option, textarea, input, [data-plain]';
/** Attributes that are text for people: their tokens become names. */
const TEXT_ATTRS = ['title', 'aria-label', 'alt', 'placeholder'];

/** Swap the tokens of one text node for mentions (or names where no icon can go). */
function expand(t: Text): void {
  if (!hasRef(t.data)) return;
  const p = t.parentElement;
  if (!p) return;
  if (p.closest(PLAIN_ONLY)) { t.data = plain(t.data); return; }
  const parts = richNodes(t.data);
  t.replaceWith(...parts);
}

function fixAttrs(e: Element): void {
  for (const a of TEXT_ATTRS) {
    const v = e.getAttribute(a);
    if (v && hasRef(v)) e.setAttribute(a, plain(v));
  }
}

function scan(n: Node): void {
  if (n.nodeType === Node.TEXT_NODE) { expand(n as Text); return; }
  if (n.nodeType !== Node.ELEMENT_NODE) return;
  const root = n as Element;
  fixAttrs(root);
  for (const e of root.querySelectorAll('[title], [aria-label], [alt], [placeholder]')) fixAttrs(e);
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: Text[] = [];
  for (let c = walk.nextNode(); c; c = walk.nextNode()) if (hasRef((c as Text).data)) found.push(c as Text);
  for (const t of found) expand(t);
}

/** Rename every mention under `root` in the current language (after a language switch); words of their own stay. */
function rename(root: ParentNode): void {
  for (const m of root.querySelectorAll<HTMLElement>('.imention[data-item]:not([data-words])')) {
    const id = m.dataset.item!;
    const name = nameOf(id);
    const label = m.querySelector('.imention-name');
    if (label) { const shown = screenText(name); if (label.textContent !== shown) label.textContent = shown; } else {
      m.setAttribute('title', name);
      m.setAttribute('aria-label', name);
    }
  }
}

let installed = false;

/**
 * Turn every item token under `root` into its mention, now and as the UI updates; icons come from
 * `atlas`. Called once by the shell at boot, before the UI is built.
 */
export function installMentions(root: HTMLElement, a: Atlas): void {
  atlas = a;
  icons.clear();
  if (installed) return;
  installed = true;
  scan(root);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') scan(r.target);
      else if (r.type === 'attributes') fixAttrs(r.target as Element);
      else for (const n of r.addedNodes) scan(n);
    }
  }).observe(root, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: TEXT_ATTRS });
  onLocale(() => rename(root));
}
