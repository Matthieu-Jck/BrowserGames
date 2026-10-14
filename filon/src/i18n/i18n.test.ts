import { describe, it, expect, afterEach } from 'vitest';
import { fr } from './fr';
import { en } from './en';
import { ITEMS } from '@/content/items';
import { RECIPES } from '@/content/recipes';
import { BUILDINGS } from '@/content/buildings';
import { PLANS, RESEARCH } from '@/content/research';
import { QUESTS, QUEST_TITLES } from '@/content/quests';
import { placeholders, pickLocale, setLocale, t, tr, type Msg, type MsgKey } from './i18n';

const texts = (m: Msg): string[] => (typeof m === 'string' ? [m] : Object.values(m).filter((v): v is string => typeof v === 'string'));

describe('i18n', () => {
  afterEach(() => setLocale('fr'));

  it('every English message carries exactly the placeholders of the French one', () => {
    for (const k of Object.keys(fr) as MsgKey[]) {
      expect(placeholders(en[k]), k).toEqual(placeholders(fr[k]));
    }
  });

  it('French text never puts a plain space before : ; ! ? % (UI strings and content names / descriptions)', () => {
    for (const [k, m] of Object.entries(fr) as Array<[string, Msg]>) {
      for (const s of texts(m)) {
        expect(/ [:;!?%]/.test(s), `${k}: « ${s} »`).toBe(false);
      }
    }
    // Every { fr, en } pair in the content tables: its French half.
    const frOf = (v: unknown, path: string, out: Array<[string, string]>): void => {
      if (!v || typeof v !== 'object') return;
      const o = v as Record<string, unknown>;
      if (typeof o.fr === 'string' && typeof o.en === 'string') { out.push([path, o.fr]); return; }
      for (const [k, x] of Object.entries(o)) frOf(x, `${path}.${k}`, out);
    };
    const found: Array<[string, string]> = [];
    for (const [name, table] of Object.entries({ ITEMS, RECIPES, BUILDINGS, RESEARCH, PLANS, QUESTS, QUEST_TITLES })) frOf(table, name, found);
    expect(found.length).toBeGreaterThan(100);
    for (const [path, s] of found) expect(/ [:;!?%]/.test(s), `${path}: « ${s} »`).toBe(false);
  });

  it('fills placeholders and formats numbers per locale', () => {
    setLocale('fr');
    expect(t('boot.error', { msg: 'x' })).toBe('Impossible de démarrer : x');
    expect(tr('stock.units', { n: 1 })).toBe('1 unité');
    expect(tr('stock.units', { n: 2 })).toBe('2 unités');
    setLocale('en');
    expect(tr('stock.units', { n: 1 })).toBe('1 unit');
    expect(tr('stock.units', { n: 1200 })).toBe('1,200 units');
  });

  it('marks a missing key instead of crashing', () => {
    expect(tr('no.such.key')).toBe('⟦no.such.key⟧');
  });

  it('picks the first supported browser language', () => {
    expect(pickLocale(['fr-FR', 'en-US'])).toBe('fr');
    expect(pickLocale(['de-DE', 'en-GB'])).toBe('en');
    expect(pickLocale(['ja'])).toBe('en');
  });
});
