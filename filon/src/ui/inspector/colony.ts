// colony.ts — inspector panels of the base itself, laid out by the kit (D89): the Heart (at the top
// its level as steps and its compute — D122: the AI tokens a minute its compute bay gives research,
// from level 2 —; then its stock as icons and amounts, and the next level: what it mounts on a
// corner, D86, what it adds to the compute, and what it costs — the upgrade itself is the foot's
// action; from level 3 its Archive: the two expertises in place, D93, and « Ouvrir l'Archive » in
// the foot) and
// the landscapers (an excavator's / backfiller's job and its time left, or the marks in reach; the
// stone it holds).
import { BAL } from '@/content/balance';
import { itemIdx } from '@/content/registry';
import { nodeName } from '@/content/research';
import { el, setText } from '@/core/dom';
import { duration, num } from '@/i18n/format';
import { locale, t, tr } from '@/i18n/i18n';
import { footprint } from '@/sim/entities';
import type { Sim } from '@/sim/state';
import { expertiseDef } from '@/content/expertises';
import { archiveOpen, rankOf } from '@/sim/systems/expertise';
import { archiveGlyph, effectFigure, effectLabel, expertiseIcon, romanRank } from '../screens/expertise';
import { costChips, fmt, heldList, itemRow, mark, progressBar, section, type Panel, type PanelCtx } from './kit';

/** The level that mounts the Core's compute bay (D122: the first with a compute of its own, `BAL.coreCompute`). */
const COMPUTE_LEVEL = BAL.coreCompute.findIndex((v) => v > 0) + 1;

/** The Core's compute at a level, tokens a minute, as `Sim.coreComputeRate` reckons it (its research and expertise in). */
function computeAt(sim: Sim, level: number): number {
  const base = BAL.coreCompute[Math.min(BAL.coreCompute.length, level) - 1] ?? 0;
  return base > 0 ? Math.floor(((base + sim.mods.coreCompute) * sim.mods.tokenRate) / 1000) : 0;
}

/** The Heart's level as steps (one inked per level reached), and its compute once mounted (D122: « Calcul du Cœur »). */
export const hearthHero = ({ sim }: PanelCtx): HTMLElement => {
  const lv = sim.hearthLevel, max = BAL.hearthUpgrades.length + 1;
  const steps = el('span.insp-steps', { title: t('insp.hearth.levelOf', { n: lv, max }) }, Array.from({ length: max }, (_, i) => el('i', { 'data-on': i < lv ? '' : null })));
  const parts: HTMLElement[] = [el('div.insp-hero-line', {}, [mark('level'), el('b.insp-hero-name.lettering', {}, t('insp.hearth.level', { n: lv })), steps])];
  // Its compute (D122): the AI tokens a minute it gives research, no power, no ribbon, from the
  // level that mounts its compute bay (D86's south-east corner). Before, the next level's section
  // says which level mounts it.
  const rate = sim.coreComputeRate();
  if (rate > 0) {
    parts.push(el('div.insp-hero-line.insp-compute', { 'data-core-compute': '', title: t('insp.hearth.compute.tip') }, [
      mark('token'), el('span', {}, t('insp.hearth.compute')), el('b', {}, t('insp.hearth.compute.v', { n: num(rate) })),
    ]));
  }
  return el('div.insp-hero', { 'data-hero': 'hearth' }, parts);
};

/** The Heart: the top of its stock; the next level, what it mounts and costs (the upgrade in the foot). */
export const hearthPanel: Panel = ({ sim, host, live, action, atlas }) => {
  const list = heldList(live, () => [...sim.stock.keys()]
    .filter((i) => sim.stock[i]! >= 1000)
    .sort((a, b) => sim.stock[b]! - sim.stock[a]! || a - b)
    .slice(0, 12)
    .map((i) => [i, Math.floor(sim.stock[i]! / 1000)] as const), t('insp.empty'));
  const lv = sim.hearthLevel;
  const up = BAL.hearthUpgrades[lv - 1];
  const out: Array<HTMLElement | null> = [section({ sec: 'stock', title: t('insp.stock'), icon: mark('store') }, [list])];
  // The Archive (D93): the expertises in place, their rank and effect; the window in the foot.
  if (archiveOpen(sim)) {
    const rows = sim.expertise.slots.map((s, i) => {
      const d = s ? expertiseDef(s.id) : undefined;
      if (!s || !d) return el('div.insp-exp-slot', { 'data-empty': '' }, [el('span.ex-slotnum.lettering', {}, String(i + 1)), t('exp.slot.empty')]);
      const rank = rankOf(sim, s.id);
      return el('div.insp-exp-slot', { title: effectLabel(d) }, [
        expertiseIcon(atlas, d.icon, 22), el('b', {}, `${d.name[locale()]} ${romanRank(rank)}`),
        s.on ? mark('on') : mark('order', t('exp.coming')), el('b.ex-fig', {}, effectFigure(d, rank)),
      ]);
    });
    out.push(section({ sec: 'archive', title: t('insp.hearth.archive'), icon: archiveGlyph(), tip: t('exp.tip') }, [el('div.insp-exp-slots', {}, rows)]));
    if (host.openExpertise) action(el('button.btn.insp-recipe', { 'data-insp-act': 'expertise', onclick: () => host.openExpertise?.() }, t('insp.hearth.archive.open')));
  }
  if (!up) return out; // the top block's steps say it is the last level (its tooltip in words)
  const ok = sim.unlocked(up.unlock);
  const locked = t('insp.hearth.locked', { res: nodeName(up.unlock)[locale()] });
  out.push(section({ sec: 'level', title: t('insp.hearth.nextLevel', { n: lv + 1 }), icon: mark('level') }, [
    // What the next level mounts on its corner (D86): the compute bay (D122), shown by the token it
    // computes; past it, what the next level adds to the compute.
    lv + 1 === COMPUTE_LEVEL ? el('p.insp-note', { 'data-core-compute-next': '' }, [mark('token'), ' ', t('insp.hearth.computeAt', { n: lv + 1, v: num(computeAt(sim, lv + 1)) })])
      : lv + 1 > COMPUTE_LEVEL && computeAt(sim, lv + 1) > computeAt(sim, lv)
        ? el('p.insp-note', { 'data-core-compute-next': '' }, [mark('token'), ' ', t('insp.hearth.computeNext', { n: lv + 1, v: num(computeAt(sim, lv + 1)) })]) : null,
    // …the Archive of the expertises (D93), shown by its mark.
    lv + 1 === BAL.expertise.level ? el('p.insp-note', {}, [archiveGlyph(), ' ', t('insp.hearth.archiveAt', { n: lv + 1 })]) : null,
    costChips(sim, up.cost),
    ok ? null : el('p.insp-note', { 'data-tone': 'bad' }, [mark('tree'), ' ', locked]),
  ]));
  action(el('button.btn.primary.insp-recipe', {
    'data-insp-act': 'hearth-up',
    disabled: ok ? null : '',
    title: ok ? null : locked,
    onclick: () => { const r = sim.upgradeHearth(); if (!r.ok) host.notify('bad', t(r.reason === 'locked' ? 'reason.locked' : r.reason === 'reserve' ? 'reason.reserve' : 'reason.unaffordable')); },
  }, t('insp.hearth.up', { n: lv + 1 })));
  return out;
};

/** Excavator / backfiller at the top: the running job (its progress, time left), or the marks in its reach. */
export const landscapeHero = ({ sim, e, kind, node, live }: PanelCtx): HTMLElement => {
  const job = el('div.insp-hero-line'), what = el('b.insp-hero-name'), left = el('span.insp-hero-pct');
  job.append(mark('job'), what, left);
  const bar = progressBar();
  const reach = kind === 'excavator' ? BAL.digReach : BAL.fillReach;
  const want = kind === 'excavator' ? 'dig' : 'fill';
  live(() => {
    const j = sim.jobs.find((q) => q.ent === e.id);
    bar.root.hidden = !j;
    if (j) {
      const net = node?.net ?? -1;
      const sat = net >= 0 ? sim.netPower[net]?.sat ?? 0 : 0;
      const rest = sat > 0 ? Math.max(0, j.dur * 1000 - j.el) / sat / 10 : Infinity;
      setText(what, t(j.kind === 'dig' ? 'insp.job.dig' : 'insp.job.fill'));
      setText(left, Number.isFinite(rest) ? duration(rest) : '—');
      bar.set(j.el / Math.max(1, j.dur * 1000), sat > 0 ? 'good' : 'bad');
    } else {
      const [w, h] = footprint(e.def, e.rot);
      const cx = e.x + w / 2, cy = e.y + h / 2;
      let n = 0;
      for (const [tile, k] of sim.designated) {
        if (k !== want) continue;
        const x = tile % 1024, y = (tile - x) / 1024;
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= reach * reach) n++;
      }
      setText(what, n ? tr('insp.job.marked', { n }) : t(kind === 'excavator' ? 'insp.job.none.dig' : 'insp.job.none.fill'));
      setText(left, '');
    }
  });
  return el('div.insp-hero', { 'data-hero': 'landscape', title: t('insp.reach', { r: reach }) }, [job, bar.root]);
};

/** The stone it holds (dug out, or waiting to fill). */
export const landscapePanel: Panel = ({ sim, e, live }) => {
  const stone = itemIdx('stone');
  const n = el('b');
  live(() => setText(n, fmt((sim.stores.get(e.id)?.[stone] ?? 0) / 1000, 0)));
  return [section({ sec: 'stone', title: t('insp.held.title'), icon: mark('store') }, [itemRow(stone, n)])];
};

