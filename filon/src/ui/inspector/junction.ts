// junction.ts — a junction's panel (D158): its deck — which line rides over it, along its rotation's
// axis, and which runs under it — shown as arrows and the compass; and, for one laid before the rule
// (owner, 2026-10-19: « the junction should prevent putting something other than a ribbon on the two
// sides where the junction brings the items »), each deck end that comes down on something other than
// a ribbon: the deck's mark, that building's icon, where, and that it still works as it did (nothing
// is taken down: grandfathered) though laying it again there would be refused.
import { BUILDING_IDS, buildingDef } from '@/content/registry';
import { el } from '@/core/dom';
import { locale, t, type MsgKey } from '@/i18n/i18n';
import { deckBlocks } from '@/sim/systems/build';
import { buildingIcon } from '../build-bar';
import { glyph } from '../glyphs';
import { row, section, type Panel } from './kit';

/** The side (0 N … 3 W) a tile one step from the junction lies on. */
const sideOf = (dx: number, dy: number): number => (dy < 0 ? 0 : dx > 0 ? 1 : dy > 0 ? 2 : 3);

export const junctionPanel: Panel = ({ sim, e, atlas }) => {
  const ns = (e.rot & 1) === 0; // the deck north–south (rot 0, 2) or east–west (1, 3)
  const way = (along: boolean): HTMLElement => el('span', {}, [
    el('span.kjunction-arrow', { 'aria-hidden': 'true' }, along ? '↕' : '↔'), ' ', t(along ? 'insp.junction.axis.ns' : 'insp.junction.axis.ew'),
  ]);
  // Its own deck's ends only (another junction's deck landing on this one is that junction's to show).
  const old = deckBlocks(sim, e.def, e.x, e.y, e.rot).filter(([jx, jy]) => jx === e.x && jy === e.y).map(([, , ex, ey]) => {
    const d = sideOf(ex - e.x, ey - e.y), o = sim.entityAt(ex, ey);
    const at = t(`insp.junction.at.${'NESW'[d]}` as MsgKey);
    const name = o ? buildingDef(o.def).name[locale()] : '';
    return el('p.insp-why.kjunction-old', { 'data-state': 'slow', 'data-deck-end': 'NESW'[d]!, title: name }, [
      glyph('deckEnds'), o ? buildingIcon(atlas, BUILDING_IDS[o.def]!, 18) : null, el('span', {}, t('insp.junction.old', { at })),
    ]);
  });
  return [section({ sec: 'junction', title: () => t('insp.junction.title'), icon: glyph('deckEnds'), group: 'logistics', tip: () => t('insp.junction.tip') }, [
    row(t('insp.junction.over'), way(ns)),
    row(t('insp.junction.under'), way(!ns)),
    ...old,
  ])];
};
