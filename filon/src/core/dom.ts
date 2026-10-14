// dom.ts — tiny hyperscript helpers (from agora) plus change-only writers: the UI refreshes
// at 4 Hz and must never touch the DOM when nothing changed.

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K | string,
  attrs: Record<string, unknown> = {},
  children: Child[] | Child = [],
): HTMLElementTagNameMap[K] {
  const [name, ...classes] = (tag as string).split('.');
  const node = document.createElement(name || 'div') as HTMLElementTagNameMap[K];
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'html') {
      node.innerHTML = String(v);
    } else if (k === 'cls') {
      node.className += (node.className ? ' ' : '') + String(v);
    } else if (k === 'style') {
      node.setAttribute('style', String(v));
    } else {
      node.setAttribute(k, String(v));
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function qs<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  const node = root.querySelector<T>(sel);
  if (!node) throw new Error(`missing element: ${sel}`);
  return node;
}

export function qsa<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(sel)];
}

const lastText = new WeakMap<Node, string>();

/** Write textContent only when it changed. */
export function setText(node: Element, text: string): void {
  if (lastText.get(node) === text) return;
  lastText.set(node, text);
  node.textContent = text;
}

const lastAttr = new WeakMap<Element, Map<string, string | null>>();

/** Set (or remove with null) an attribute only when it changed. */
export function setAttr(node: Element, name: string, value: string | null): void {
  let m = lastAttr.get(node);
  if (!m) { m = new Map(); lastAttr.set(node, m); }
  if (m.get(name) === value) return;
  m.set(name, value);
  if (value === null) node.removeAttribute(name);
  else node.setAttribute(name, value);
}

const lastStyle = new WeakMap<HTMLElement, Map<string, string>>();

/** Set one inline style property only when it changed. */
export function setStyle(node: HTMLElement, prop: string, value: string): void {
  let m = lastStyle.get(node);
  if (!m) { m = new Map(); lastStyle.set(node, m); }
  if (m.get(prop) === value) return;
  m.set(prop, value);
  node.style.setProperty(prop, value);
}
