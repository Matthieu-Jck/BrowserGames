// gazette.ts — the Crier's events in words. The market reports events as ids and numbers
// (kind, item, tier, colony, multiplier, epochs); this turns one into a line of the Gazette,
// for the toasts at boundaries and for the Crier screen's Gazette column. The item is named
// through `itemRef`, so the page shows its icon beside its name (mention.ts); `plain()` gives
// the bare words (a tooltip, a log).
import { duration } from '@/i18n/format';
import { locale, t } from '@/i18n/i18n';
import type { ColonyView, MarketEvent } from '@/market/types';
import { itemRef } from './mention';

const item = (id: string | null): string => (id ? itemRef(id) : '');

/** What the event is: « pénurie de ⟪i:glass⟫ à Port-Écume (demande ×2) ». */
export function eventLine(ev: MarketEvent, colonies: readonly ColonyView[]): string {
  const mult = Math.round(ev.mult * 10) / 10;
  const it = item(ev.item);
  switch (ev.kind) {
    case 'shortage': {
      const c = colonies[ev.colony];
      return c ? t('gazette.ev.shortage', { item: it, colony: c.name[locale()], mult }) : t('gazette.ev.shortageWorld', { item: it, mult });
    }
    case 'boom': return t('gazette.ev.boom', { tier: ev.tier, mult });
    case 'glut': return t('gazette.ev.glut', { item: it, mult });
    case 'storm': return t('gazette.ev.storm', { item: it, mult });
    case 'caravan': return t('gazette.ev.caravan', { item: it, mult });
  }
}

/** A toast for news at a boundary: announced (with how long until it starts), started, ended. */
export function gazetteToast(when: 'announced' | 'started' | 'ended', ev: MarketEvent, colonies: readonly ColonyView[], nowEpoch: number): string {
  const what = eventLine(ev, colonies);
  if (when === 'announced') return t('gazette.announced', { what, d: duration(Math.max(1, ev.start - nowEpoch) * 60) });
  return t(when === 'started' ? 'gazette.started' : 'gazette.ended', { what });
}
