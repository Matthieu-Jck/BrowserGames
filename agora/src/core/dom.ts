// dom.ts — tiny hyperscript helpers; the UI's only "framework".

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
