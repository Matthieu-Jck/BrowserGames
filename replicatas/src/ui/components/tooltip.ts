// tooltip.ts — one shared tooltip; hovering [data-kw] (status keywords) or
// [data-tip] populates it. Clamped to the viewport.
import { el } from '../dom';
import { STATUSES } from '@/combat/statuses';

let tipEl: HTMLElement | null = null;

export function initTooltip(): void {
  tipEl = el('div', { id: 'tooltip' });
  document.body.appendChild(tipEl);

  document.addEventListener('pointerover', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-kw],[data-tip]');
    if (!t || !tipEl) { hide(); return; }
    const kw = t.dataset['kw'];
    if (kw) {
      const def = STATUSES[kw];
      if (!def) return;
      tipEl.innerHTML = `<div class="tt-name">${def.icon} ${def.name}</div>${def.desc}`;
    } else if (t.dataset['tip']) {
      tipEl.innerHTML = t.dataset['tip']!;
    } else return;
    tipEl.style.display = 'block';
    position(e as PointerEvent);
  });
  document.addEventListener('pointermove', (e) => {
    if (tipEl?.style.display === 'block') position(e);
  });
  document.addEventListener('pointerout', (e) => {
    const t = (e.target as HTMLElement).closest('[data-kw],[data-tip]');
    if (t) hide();
  });
}

function position(e: PointerEvent): void {
  if (!tipEl) return;
  const pad = 14;
  let x = e.clientX + pad, y = e.clientY + pad;
  const r = tipEl.getBoundingClientRect();
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
  tipEl.style.left = `${x}px`;
  tipEl.style.top = `${y}px`;
}

function hide(): void {
  if (tipEl) tipEl.style.display = 'none';
}

/** Wrap known status names in a card text with keyword spans. */
export function keywordize(text: string): string {
  let out = text;
  for (const def of Object.values(STATUSES)) {
    if (['primed', 'phased', 'echo'].includes(def.id)) continue;
    out = out.replace(new RegExp(`\\b(${def.name})\\b`, 'g'), `<span class="kw" data-kw="${def.id}">$1</span>`);
  }
  out = out.replace(/\[BEAM\]/g, '<span class="kw" data-tip="<b>BEAM</b> — benefits from Charge.">[BEAM]</span>');
  out = out.replace(/\bScout (\d+)\b/g, '<span class="kw" data-tip="<b>Scout X</b> — look at the top X cards of your draw pile; discard any of them.">Scout $1</span>');
  out = out.replace(/\bExhaust\b/g, '<span class="kw" data-tip="<b>Exhaust</b> — removed from your deck for the rest of this combat.">Exhaust</span>');
  return out;
}
