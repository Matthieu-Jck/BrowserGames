// building-facts.test.ts — the building card's facts: every building yields them in both
// languages without a missing key or a French spacing slip, the figures follow the content
// tables (ribbon throughput, drill rate, recipes per minute, routing rules), locked recipes stay
// hidden (D27), and every description is one or two sentences whose first one stands alone
// (the build tip shows only it).
import { afterEach, describe, expect, it } from 'vitest';
import { BUILDINGS } from '@/content/buildings';
import { BUILDING_IDS, RESEARCH_IDS, itemIdx } from '@/content/registry';
import { setLocale } from '@/i18n/i18n';
import { baseMods, computeMods } from '@/sim/research/modifiers';
import { buildingFacts, firstSentence, type BuildingFacts, type FactCtx } from './building-facts';
import { plain } from './mention';

/** A new colony: only `start` unlocked. */
const fresh: FactCtx = { unlocked: (u) => u === 'start', mods: baseMods() };
/** Everything researched. */
const all: FactCtx = { unlocked: (u) => u !== 'never', mods: computeMods(new Set(RESEARCH_IDS)) };

/** Every string a card shows. */
function texts(f: BuildingFacts): string[] {
  return [
    f.name, f.sub, f.desc, f.locked ?? '',
    ...f.rows.flatMap((r) => [r.label, r.text]),
    ...(f.rule?.legend.map((l) => l.text) ?? []),
    ...(f.recipes?.map((r) => r.name) ?? []),
  ];
}

/** A row's text as the card reads it (an item named through a mention token: its name). */
const row = (f: BuildingFacts, k: string): string | undefined => {
  const text = f.rows.find((r) => r.k === k)?.text;
  return text === undefined ? undefined : plain(text);
};

describe('building facts', () => {
  afterEach(() => setLocale('fr'));

  it('data makers say what they make, servers their tokens (the research redesign, D68–D71)', () => {
    setLocale('en');
    for (const id of ['data_collector', 'data_relay']) {
      const f = buildingFacts(id, all);
      expect(row(f, 'mines'), id).toBeUndefined(); // no deposit: power alone
      expect(f.rows.find((r) => r.k === 'makes')?.items, id).toEqual([itemIdx('journal_1')]);
      expect(row(f, 'place'), id).not.toMatch(/deposit/);
    }
    expect(row(buildingFacts('data_collector', all), 'makes')).toBe('2/min, anywhere, from power alone');
    expect(row(buildingFacts('sand_collector', all), 'mines')).toBe('The bare ground, no deposit');
    expect(row(buildingFacts('server', all), 'tokens')).toMatch(/^2 k tokens\/min/);
    expect(row(buildingFacts('supercomputer', all), 'tokens')).toMatch(/^20 k tokens\/min/);
    expect(row(buildingFacts('auto_lab', all), 'makes')).toBe('3/min, for its own project');
    expect(row(buildingFacts('observatory', all), 'makes')).toBeUndefined();
  });

  it('every building, in both languages and at both ends of research: no missing key, French spacing kept', () => {
    for (const locale of ['fr', 'en'] as const) {
      setLocale(locale);
      for (const id of BUILDING_IDS) {
        for (const ctx of [fresh, all]) {
          const f = buildingFacts(id, ctx);
          for (const s of texts(f).map(plain)) {
            expect(s, `${id} (${locale})`).not.toContain('⟦');
            expect(s, `${id} (${locale})`).not.toContain('⟪');
            if (locale === 'fr') expect(/ [:;!?%]/.test(s), `${id}: « ${s} »`).toBe(false);
          }
          if (id !== 'hearth') {
            expect(row(f, 'power'), `${id} power`).toBeTruthy();
            expect(row(f, 'place'), `${id} placement`).toBeTruthy();
          }
        }
      }
    }
  });

  it('derives the figures from the content tables', () => {
    setLocale('en');
    expect(row(buildingFacts('ribbon', fresh), 'rate')).toBe('60/min · 1 item per tile');
    expect(row(buildingFacts('ribbon', fresh), 'place')).toBe('Anywhere; costs ×3 off your land, never on a sister claim’s');
    expect(row(buildingFacts('express_ribbon', fresh), 'speed')).toBe('4 tiles/s'); // a tile a step, 240 steps a minute (D57)
    expect(row(buildingFacts('drill', fresh), 'rate')).toBe('Up to 20/min');
    expect(buildingFacts('drill', fresh).rows.find((r) => r.k === 'mines')?.items).toContain(itemIdx('copper_ore'));
    expect(row(buildingFacts('deep_bore', all), 'rate')).toContain('×1.5');
    expect(row(buildingFacts('kiln', fresh), 'power')).toBe('Needs no power');
    expect(row(buildingFacts('kiln', fresh), 'grid')).toBeUndefined();
    expect(row(buildingFacts('wire_mill', fresh), 'power')).toBe('60 kW running · 6 kW idle');
    expect(row(buildingFacts('wire_mill', fresh), 'grid')).toBeTruthy();
    // Ports are drawn, not told: the footprint and each port's tile, side and way (front = N).
    const kp = buildingFacts('kiln', fresh).ports!;
    expect([kp.w, kp.h]).toEqual([2, 2]);
    expect(kp.list.filter((p) => p.io === 'in').map((p) => p.side)).toEqual(['S', 'S']);
    expect(buildingFacts('kiln_compact', all).ports!.list.filter((p) => p.io === 'in').map((p) => p.side).sort()).toEqual(['E', 'S']);
    expect(buildingFacts('router', fresh).ports).toBeNull();
    // The trade post (D62): one entrance, one exit, and its pad in the middle of its scorched apron.
    const tp = buildingFacts('trade_post', fresh).ports!;
    expect([tp.w, tp.h, tp.pad]).toEqual([5, 5, [1, 1, 4, 4]]);
    expect(tp.list.map((p) => `${p.io}:${p.side}`)).toEqual(['in:S', 'out:N']);
    expect(kp.pad).toBeNull();
    // Words only where nothing shows how it works.
    expect(buildingFacts('kiln', fresh).brief).toBeNull();
    expect(buildingFacts('drill', fresh).brief).toBeNull();
    expect(row(buildingFacts('silo', fresh), 'store')).toBe('1,000 items of a single kind');
    expect(row(buildingFacts('fumarole_tap', fresh), 'power')).toBe('Makes 1.5 MW, day and night');
    expect(row(buildingFacts('sunheart', fresh), 'fuel')).toBe('Resonator · 1 every 30 min');
    expect(row(buildingFacts('router', fresh), 'buffer')).toBe('2 items');
    expect(row(buildingFacts('distributor', all), 'buffer')).toBe('8 items');
  });

  it('lists a machine’s unlocked recipes per minute, and hides the locked ones', () => {
    setLocale('en');
    const kiln = buildingFacts('kiln', fresh).recipes!;
    const plate = kiln.find((r) => r.name === 'Iron Plate')!;
    // 6 s a plate (D97): 10 ore and 10 coal a minute.
    expect(plate.ins).toEqual([{ item: itemIdx('iron_ore'), perMin: 10 }, { item: itemIdx('coal'), perMin: 10 }]);
    expect(plate.outs).toEqual([{ item: itemIdx('iron_plate'), perMin: 10 }]);
    // Servomotors need their research (dn4, D81): not on a new colony's electronics workshop, there once researched.
    expect(buildingFacts('workshop', fresh).recipes!.map((r) => r.name)).not.toContain('Servomotor');
    expect(buildingFacts('workshop', all).recipes!.map((r) => r.name)).toContain('Servomotor');
    // The tree's upgraded machines run their family's recipes faster (D70): the forging press ×3.
    const forge = buildingFacts('forge_press', { ...all, mods: baseMods() }).recipes!.find((r) => r.name === 'Gear')!;
    expect(forge.outs[0]!.perMin).toBe(36);
  });

  it('draws the routing rule of each block, Mindustry-style', () => {
    setLocale('en');
    const sorter = buildingFacts('sorter', fresh).rule!;
    expect(sorter.sides).toMatchObject({ S: { flow: 'in' }, N: { flow: 'out', tone: 'a' }, E: { tone: 'b' }, W: { tone: 'b' } });
    const inverted = buildingFacts('inverted_sorter', fresh).rule!;
    expect(inverted.sides).toMatchObject({ N: { tone: 'b' }, E: { tone: 'a' } });
    expect(buildingFacts('overflow_gate', fresh).rule!.sides?.E).toMatchObject({ dashed: true });
    expect(buildingFacts('underflow_gate', fresh).rule!.sides?.N).toMatchObject({ dashed: true });
    expect(buildingFacts('router', fresh).rule!.sides?.W).toMatchObject({ flow: 'both' });
    expect(buildingFacts('unloader', fresh).rule!.sides?.S).toMatchObject({ flow: 'store' });
    expect(buildingFacts('crossing', fresh).rule!.shape).toBe('cross');
    expect(buildingFacts('skybridge', fresh).rule!.shape).toBe('bridge');
    expect(buildingFacts('kiln', fresh).rule).toBeNull();
  });

  it('every description is one or two sentences, and the first stands alone', () => {
    for (const [id, b] of Object.entries(BUILDINGS)) {
      for (const s of [b.desc.fr, b.desc.en]) {
        expect(s.trim().length, id).toBeGreaterThan(10);
        const sentences = s.split(/(?<=[.!?…])\s+(?=\p{Lu})/u);
        expect(sentences.length, `${id}: ${s}`).toBeLessThanOrEqual(2);
        expect(firstSentence(s), id).toBe(sentences[0]);
      }
    }
  });

  it('cuts a description after its first sentence', () => {
    expect(firstSentence('Une foreuse 3×3. Se pose par-dessus une foreuse.')).toBe('Une foreuse 3×3.');
    expect(firstSentence('Fabrique avec deux entrées : circuits… Choisis la recette.')).toBe('Fabrique avec deux entrées : circuits…');
    expect(firstSentence('Makes 1.5 MW. Only on a vent.')).toBe('Makes 1.5 MW.');
    expect(firstSentence('One sentence only.')).toBe('One sentence only.');
  });
});
