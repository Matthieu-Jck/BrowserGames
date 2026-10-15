// colony.ts — inspector panels of the base itself, laid out by the kit (D89): the Heart (at the top
// its level as steps and its data outlet; then its stock as icons and amounts, and the next level:
// what it mounts on a corner, D86, and what it costs — the upgrade itself is the foot's action) and
// the landscapers (an excavator's / backfiller's job and its time left, or the marks in reach; the
// stone it holds).
import { BAL } from '@/content/balance';
import { itemIdx } from '@/content/registry';
import { nodeName } from '@/content/research';
import { el, setText } from '@/core/dom';
import { duration } from '@/i18n/format';
import { locale, t, tr } from '@/i18n/i18n';
import { footprint } from '@/sim/entities';
import { itemMention } from '../mention';
import { costChips, equation, fmt, heldList, itemRow, itemTerm, mark, progressBar, section, type Panel, type PanelCtx } from './kit';

/** The Heart's level as steps (one inked per level reached), and its data outlet once mounted (D68, D86). */
export const hearthHero = ({ sim }: PanelCtx): HTMLElement => {
  const lv = sim.hearthLevel, max = BAL.hearthUpgrades.length + 1;
  const steps = el('span.insp-steps', { title: t('insp.hearth.levelOf', { n: lv, max }) }, Array.from({ length: max }, (_, i) => el('i', { 'data-on': i < lv ? '' : null })));
  const parts: HTMLElement[] = [el('div.insp-hero-line', {}, [mark('level'), el('b.insp-hero-name.lettering', {}, t('insp.hearth.level', { n: lv })), steps])];
  // Its data outlet (D68): the files a minute it makes and hands out, once Analytics has it make
  // some — from the level that mounts the outlet (D86); before, which level.
  if (sim.mods.heartData > 0) {
    const file = itemIdx('journal_1');
    parts.push(lv >= BAL.hearthDataLevel
      ? equation([], [itemTerm(file, fmt(sim.mods.heartData / 1000, 0))], t('insp.unit.perMin'))
      : el('p.insp-note', {}, [itemMention(file, { name: false }), ' ', t('insp.hearth.adds', { n: BAL.hearthDataLevel })]));
  }
  return el('div.insp-hero', { 'data-hero': 'hearth' }, parts);
};

/** The Heart: the top of its stock; the next level, what it mounts and costs (the upgrade in the foot). */
export const hearthPanel: Panel = ({ sim, host, live, action }) => {
  const list = heldList(live, () => [...sim.stock.keys()]
    .filter((i) => sim.stock[i]! >= 1000)
    .sort((a, b) => sim.stock[b]! - sim.stock[a]! || a - b)
    .slice(0, 12)
    .map((i) => [i, Math.floor(sim.stock[i]! / 1000)] as const), t('insp.empty'));
  const lv = sim.hearthLevel;
  const up = BAL.hearthUpgrades[lv - 1];
  const out: Array<HTMLElement | null> = [section({ sec: 'stock', title: t('insp.stock'), icon: mark('store') }, [list])];
  if (!up) return out; // the top block's steps say it is the last level (its tooltip in words)
  const ok = sim.unlocked(up.unlock);
  const locked = t('insp.hearth.locked', { res: nodeName(up.unlock)[locale()] });
  out.push(section({ sec: 'level', title: t('insp.hearth.nextLevel', { n: lv + 1 }), icon: mark('level') }, [
    // What the next level mounts on its corner (D86): the data outlet, shown by the file it hands out.
    lv + 1 === BAL.hearthDataLevel ? el('p.insp-note', {}, [itemMention(itemIdx('journal_1'), { name: false }), ' ', t('insp.hearth.adds', { n: lv + 1 })]) : null,
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

