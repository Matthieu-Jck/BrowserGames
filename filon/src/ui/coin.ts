// coin.ts — the ocelle sign (◉), the currency. Prices and balances keep « ◉ » in their strings
// (plain text: easy to translate, to format and to test); on the page every « ◉ » is drawn as
// the ocelle sign — the ring around a dot, in gold, with the two short strokes of a currency
// sign above and below (like the bar of $) — so it reads as money at a glance. A
// MutationObserver wraps each « ◉ » of a text node in a `span.coin` whose CSS (base.css) draws
// the sign; the character itself stays, invisible, for copy, tests and screen readers.
const SIGN = '◉';

/** Wrap every « ◉ » of a text node (and of what follows it) in a span.coin. */
function wrap(t: Text): void {
  const p = t.parentElement;
  if (!p || p.classList.contains('coin') || p.closest('select, option, textarea, input, [data-nocoin]')) return;
  const i = t.data.indexOf(SIGN);
  if (i < 0) return;
  const sign = t.splitText(i);
  const rest = sign.splitText(SIGN.length);
  const span = document.createElement('span');
  span.className = 'coin';
  sign.replaceWith(span);
  span.appendChild(sign);
  wrap(rest);
}

function scan(n: Node): void {
  if (n.nodeType === Node.TEXT_NODE) { wrap(n as Text); return; }
  if (n.nodeType !== Node.ELEMENT_NODE) return;
  const walk = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
  const found: Text[] = [];
  for (let c = walk.nextNode(); c; c = walk.nextNode()) if ((c as Text).data.includes(SIGN)) found.push(c as Text);
  for (const t of found) wrap(t);
}

/** Draw every « ◉ » under `root` as the ocelle sign, now and as the UI updates. */
export function installCoins(root: HTMLElement): void {
  scan(root);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') scan(r.target);
      else for (const n of r.addedNodes) scan(n);
    }
  }).observe(root, { childList: true, characterData: true, subtree: true });
}
