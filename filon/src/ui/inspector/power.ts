// power.ts — the inspector's power row (D25), shown rather than told (D53; owner, 2026-10-13:
// "Power : [electricity icon] 93%, and the power would have a not-wired icon if it's not wired,
// or a no-electricity and 0% if there's no electricity"): one row, « Énergie », a bolt and how
// well its grid serves it; a cut plug when no wire reaches it; a struck bolt and 0 % when its grid
// has nothing to give. The figures behind it (demand, supply, the pillars it hangs on) are on
// hover. A pillar or the Heart adds its wires against its slots and the « Relier » button (the
// Link tool, starting from it). A building that takes no part in power shows none of this.
import { buildingDef } from '@/content/registry';
import { el, setAttr, setText } from '@/core/dom';
import { locale, t } from '@/i18n/i18n';
import { isLinkPoint, linkable, linkPoint } from '@/sim/power/links';
import type { Sim } from '@/sim/state';
import { GeneratorNode } from '@/sim/flow/nodes';
import { producerKw, weatherAt } from '@/sim/power/network';
import { St } from '@/sim/types';
import { glyph } from '../glyphs';
import { progressBar, row, type Panel, type PanelCtx } from './kit';

/** « Poteau ×2, Cœur »: the buildings at the other end of some wires, by name. */
function wireEnds(sim: Sim, ids: readonly number[]): string {
  const L = locale();
  const counts = new Map<string, number>();
  for (const id of ids) {
    const o = sim.ents.get(id);
    if (!o) continue;
    const name = buildingDef(o.def).name[L];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(', ');
}

type PowerState = 'on' | 'dark' | 'unwired';

export function powerRows({ sim, e, host, live }: PanelCtx): HTMLElement[] {
  if (!linkable(e.def)) return [];
  const point = isLinkPoint(e.def);
  const value = el('span.insp-gv', { 'data-power': '' });
  const pct = el('span');
  const marks: Record<PowerState, HTMLElement> = {
    on: glyph('power'), dark: glyph('noPower'), unwired: glyph('unwired'),
  };
  let shown: PowerState | null = null;
  const out = [row(t('insp.power'), value)];
  const wires = el('span');
  const btn = point && host.link
    ? el<'button'>('button.btn.insp-recipe.insp-link', { title: t('build.hint.link'), onclick: () => host.link!(e.id) }, t('insp.link'))
    : null;
  if (point) out.push(row(t('insp.wires'), el('span.insp-wires', { style: 'display: inline-flex; align-items: center; gap: 8px' }, [wires, btn])));
  live(() => {
    const net = sim.graph?.netOfEnt.get(e.id);
    const np = net !== undefined ? sim.netPower[net] : undefined;
    // A grid with nothing to draw from (no generator, fuel or charged accumulator) gives nothing.
    let source = !!np && np.renew + np.fuel > 0;
    if (np && !source) for (const a of sim.graph.nets[net!]?.accs ?? []) if ((sim.accEnergy.get(a.ent) ?? 0) > 0) { source = true; break; }
    const v = np && source ? Math.round(np.sat / 10) : 0;
    const state: PowerState = !np ? 'unwired' : v > 0 ? 'on' : 'dark';
    if (state !== shown) {
      shown = state;
      value.replaceChildren(...(state === 'unwired' ? [marks.unwired] : [marks[state], pct]));
      setAttr(value, 'data-power', state);
    }
    setText(pct, t('hud.powerPct', { v }));
    setAttr(value, 'data-tone', state === 'on' ? null : 'bad');
    const ends = sim.linksOf(e.id);
    // On hover: what the grid asks and gives, and where its wires go.
    const tip = [
      np ? t('hud.powerTip', { d: Math.round(np.demand), s: Math.round(np.renew + np.fuel) }) : t('insp.noGrid'),
      !point ? (ends.length ? t('insp.wiredTo.list', { list: wireEnds(sim, ends) }) : t('insp.wires.none')) : '',
    ].filter(Boolean).join('\n');
    setAttr(value, 'title', tip);
    if (point) {
      setText(wires, t('insp.wires.count', { n: ends.length, max: linkPoint(e.def, sim.mods)!.slots }));
      if (btn) setAttr(btn, 'data-on', host.linkSource?.() === e.id ? '' : null);
    }
  });
  return out;
}

/** A producer's output now (kW): the weather's share of a turbine or a panel, a generator's dispatch. */
function outputKw(sim: Sim, id: number, node: PanelCtx['node']): number {
  const net = sim.graph?.netOfEnt.get(id);
  if (node instanceof GeneratorNode) {
    if (node.status !== St.Ok || net === undefined) return 0;
    return Math.round((node.outKw * (sim.ctx.dispatch[net] ?? 0)) / 1000);
  }
  const p = net !== undefined ? sim.graph.nets[net]?.producers.find((q) => q.ent === id) : undefined;
  return p ? Math.round(producerKw(p, weatherAt(sim.absEpoch(), sim.worldSeed, sim.mods))) : 0;
}

/** « Produit  ⚡ 52 kW »: what a turbine, a panel, a tap or a generator gives its grid right now (D53). */
export const outputPanel: Panel = ({ sim, e, node, live }) => {
  const kw = el('span');
  const value = el('span.insp-gv', { 'data-output': '' }, [glyph('power'), kw]);
  live(() => {
    const v = outputKw(sim, e.id, node);
    setText(kw, t('insp.kw', { v }));
    setAttr(value, 'data-tone', v > 0 ? null : 'bad');
  });
  return [row(t('insp.output'), value)];
};

/** An accumulator's charge, as a bar (D53). */
export const chargePanel: Panel = ({ sim, e, live }) => {
  const bar = progressBar();
  live(() => {
    const net = sim.graph?.netOfEnt.get(e.id);
    const acc = net !== undefined ? sim.graph.nets[net]?.accs.find((a) => a.ent === e.id) : undefined;
    const f = acc && acc.cap > 0 ? (sim.accEnergy.get(e.id) ?? 0) / acc.cap : 0;
    bar.set(f, acc ? 'good' : 'idle');
    setAttr(bar.root, 'title', t('hud.powerPct', { v: Math.round(f * 100) }));
  });
  return [el('div.insp-row.insp-progress', { 'data-progress': 'charge' }, [el('span.insp-label', {}, t('insp.charge')), bar.root])];
};
