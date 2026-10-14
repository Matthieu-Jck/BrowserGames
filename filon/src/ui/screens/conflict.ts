// conflict.ts — « Ta base est ouverte dans un autre onglet »: one tab pilots the base at a time
// (persist/lock.ts). Shown over the boot veil when a second tab opens, with « Reprendre ici »
// (the other tab saves and steps aside), and over the world in the tab that stepped aside, where
// the same button takes the base back (a reload). Plain DOM, no game state.
import { el } from '@/core/dom';
import { t } from '@/i18n/i18n';

/** The panel, appended to the page; `take` runs on « Reprendre ici » (the button then waits). */
export function showConflict(take: () => void, left = false): HTMLElement {
  const btn = el<'button'>('button.btn.primary.conflict-take', {
    type: 'button', 'data-conflict-take': '',
    onclick: () => { btn.disabled = true; take(); },
  }, t('conflict.take'));
  const root = el('section.conflict', { 'data-screen': 'conflict', ...(left ? { 'data-left': '' } : {}) }, [
    el('div.conflict-box.cartouche', {}, [
      el('h2.lettering', {}, t('conflict.title')),
      el('p', {}, t(left ? 'conflict.left' : 'conflict.body')),
      btn,
    ]),
  ]);
  document.body.append(root);
  btn.focus();
  return root;
}
