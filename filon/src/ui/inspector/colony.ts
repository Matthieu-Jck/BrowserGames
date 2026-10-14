// colony.ts — inspector panels of the base itself: the Heart (its stock as icons and amounts,
// its level — and what it takes off the land's price, D60: each level past the first makes the
// parcels cheaper — and the next upgrade) and the landscapers (an excavator's / backfiller's job,
// marks in reach, stone in store).
import { BAL } from '@/content/balance';
import { itemIdx } from '@/content/registry';
import { nodeName } from '@/content/research';
import { el, setText } from '@/core/dom';
import { duration } from '@/i18n/format';
import { locale, t, tr } from '@/i18n/i18n';
import { footprint } from '@/sim/entities';
import { costChips, fmt, heading, heldList, itemRow, note, row, type Panel } from './kit';

/** The Heart: the top of its stock, its level and the next upgrade. */
export const hearthPanel: Panel = ({ sim, host, live }) => {
  const list = heldList(live, () => [...sim.stock.keys()]
    .filter((i) => sim.stock[i]! >= 1000)
    .sort((a, b) => sim.stock[b]! - sim.stock[a]! || a - b)
    .slice(0, 12)
    .map((i) => [i, Math.floor(sim.stock[i]! / 1000)] as const), t('insp.empty'));
  const lv = sim.hearthLevel;
  const up = BAL.hearthUpgrades[lv - 1];
  // Its data outlet (D68): the files a minute it makes and hands out, once Analytics has it make some.
  const data = sim.mods.heartData > 0 ? row(t('insp.hearth.data'), t('insp.hearth.data.v', { n: fmt(sim.mods.heartData / 1000, 0) })) : null;
  const out: Array<HTMLElement | null> = [
    heading(t('insp.stock')), list, data,
    heading(t('insp.hearth.level', { n: lv })),
  ];
  if (!up) { out.push(note(t('insp.hearth.max'))); return out; }
  const ok = sim.unlocked(up.unlock);
  out.push(
    note(t('insp.hearth.next')),
    costChips(sim, up.cost),
    el('button.btn.insp-recipe', {
      disabled: ok ? null : '',
      title: ok ? null : t('insp.hearth.locked', { res: nodeName(up.unlock)[locale()] }),
      onclick: () => { const r = sim.upgradeHearth(); if (!r.ok) host.notify('bad', t(r.reason === 'locked' ? 'reason.locked' : r.reason === 'reserve' ? 'reason.reserve' : 'reason.unaffordable')); },
    }, t('insp.hearth.up', { n: lv + 1 })),
    ok ? null : note(t('insp.hearth.locked', { res: nodeName(up.unlock)[locale()] })),
  );
  return out;
};

/** Excavator / backfiller: the running job (progress, time left) or the marks in reach; the stone it holds. */
export const landscapePanel: Panel = ({ sim, e, kind, node, live }) => {
  const job = el('div.insp-list');
  const stone = itemIdx('stone');
  const held = el('span');
  const reach = kind === 'excavator' ? BAL.digReach : BAL.fillReach;
  const want = kind === 'excavator' ? 'dig' : 'fill';
  live(() => {
    const j = sim.jobs.find((q) => q.ent === e.id);
    if (j) {
      const net = node?.net ?? -1;
      const sat = net >= 0 ? sim.netPower[net]?.sat ?? 0 : 0;
      const left = sat > 0 ? Math.max(0, j.dur * 1000 - j.el) / sat / 10 : Infinity;
      setText(job, `${t(j.kind === 'dig' ? 'insp.job.dig' : 'insp.job.fill')} · ${t('insp.job.progress', { v: Math.floor((j.el * 100) / Math.max(1, j.dur * 1000)), d: Number.isFinite(left) ? duration(left) : '—' })}`);
    } else {
      const [w, h] = footprint(e.def, e.rot);
      const cx = e.x + w / 2, cy = e.y + h / 2;
      let n = 0;
      for (const [tile, k] of sim.designated) {
        if (k !== want) continue;
        const x = tile % 1024, y = (tile - x) / 1024;
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= reach * reach) n++;
      }
      setText(job, n ? tr('insp.job.marked', { n }) : t(kind === 'excavator' ? 'insp.job.none.dig' : 'insp.job.none.fill'));
    }
    const st = sim.stores.get(e.id);
    setText(held, t('insp.held', { n: fmt((st?.[stone] ?? 0) / 1000, 0) }));
  });
  return [note(t('insp.reach', { r: reach })), job, itemRow(stone, held)];
};
