// power.ts — the inspector's grid module (D25; one card since 2026-10-14, D76), shown rather than
// told (D53; owner, 2026-10-13: "Power : [electricity icon] 93%, and the power would have a
// not-wired icon if it's not wired, or a no-electricity and 0% if there's no electricity"):
// a bolt and how well its grid serves it; a cut plug when no wire reaches it; a struck bolt and
// 0 % when its grid has nothing to give; then its own part — a producer's nominal × coefficient =
// now, with the reasons of its coefficient one click away. A building that takes no part in power
// shows none of this.
import { BAL } from '@/content/balance';
import { BUILDING_KIND, buildingDef } from '@/content/registry';
import { el, setAttr, setText } from '@/core/dom';
import { num } from '@/i18n/format';
import { locale, t } from '@/i18n/i18n';
import { DAY_EPOCHS } from '@/sim/constants';
import { isLinkPoint, linkable, linkPoint } from '@/sim/power/links';
import type { Sim } from '@/sim/state';
import { GeneratorNode } from '@/sim/flow/nodes';
import { dayEpoch, producerKw, producerOf, sunPermille, weatherAt, windSite, type Producer, type WindSite } from '@/sim/power/network';
import { St, type Ent } from '@/sim/types';
import { glyph } from '../glyphs';
import { progressBar, type PanelCtx } from './kit';

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

/** `asleep`: a dormant building, cut from every grid whatever its wires (not a missing wire). */
type PowerState = 'on' | 'dark' | 'unwired' | 'asleep';

/** A factor ‰ as the player reads it: « ×1,6 ». */
const times = (permille: number): string => `×${num(Math.round(permille / 10) / 100)}`;

/** The hour (0–23) on the HUD's 24-hour clock at the start of a day epoch (midnight mid-night). */
const hourOf = (de: number): number => Math.floor((((de - 6 + DAY_EPOCHS) % DAY_EPOCHS) / DAY_EPOCHS) * 24);

/**
 * A producer now: what it gives at full rate (nominal), the factor the place and the weather put on
 * it (‰), what it gives (kW), and why — the lines under the ⓘ and a small picture: the wind's
 * ladder by height, the sun's curve over the day. `sig` changes when the reasons do.
 */
interface Output { nominal: number; coef: number; kw: number; lines: string[]; viz: 'wind' | 'sun' | null; site?: WindSite; sig: string; /** A factor under ×1 is no fault (a generator burns only what its grid asks). */ calm?: boolean }

function outputOf(sim: Sim, e: Ent, node: PanelCtx['node']): Output | null {
  const ep = sim.absEpoch();
  const w = weatherAt(ep, sim.worldSeed, sim.mods);
  const de = dayEpoch(ep), time = t('hud.time', { h: hourOf(de) });
  if (node instanceof GeneratorNode) {
    const net = sim.graph?.netOfEnt.get(e.id);
    const on = node.status === St.Ok && net !== undefined;
    const d = on ? sim.ctx.dispatch[net] ?? 0 : 0;
    const lines = [node.status === St.NoFuel ? t('insp.pw.why.nofuel') : on ? t('insp.pw.why.dispatch', { pct: Math.round(d / 10) }) : t('insp.pw.why.off')];
    return { nominal: node.outKw, coef: d, kw: Math.round((node.outKw * d) / 1000), lines, viz: null, sig: lines.join('|'), calm: node.fueled() };
  }
  // The producer as the grid would count it, wired or not (an unwired one still shows its rate).
  const net = sim.graph?.netOfEnt.get(e.id);
  const p: Producer | null = (net !== undefined ? sim.graph.nets[net]?.producers.find((q) => q.ent === e.id) : undefined) ?? producerOf(e, buildingDef(e.def), sim.grid, sim.mods);
  if (!p) return null;
  const kw = Math.round(producerKw(p, w));
  const sun = Math.round(w.sun / 10);
  switch (p.kind) {
    case 'wind': {
      const { site } = windSite(sim.grid, e);
      const where = site.k === 'height' ? t('insp.pw.why.height', { n: site.level, f: times(p.local) }) : t(`insp.pw.why.${site.k}`, { f: times(p.local) });
      const lines = [where, t('insp.pw.why.gust', { f: times(w.gust) })];
      return { nominal: p.kw, coef: Math.round((p.local * w.gust) / 1000), kw, lines, viz: 'wind', site, sig: `w${p.local}:${w.gust}` };
    }
    case 'solar': {
      const lines = [t('insp.pw.why.sun', { time, pct: sun })];
      return { nominal: p.kw, coef: p.kw > 0 ? Math.round((kw * 1000) / p.kw) : 0, kw, lines, viz: 'sun', sig: `s${de}:${w.sun}` };
    }
    case 'hearth': {
      const core = p.base ?? 0, nominal = p.kw + core;
      const lines = [t('insp.pw.why.panel', { kw: p.kw, time, pct: sun }), t('insp.pw.why.core', { kw: core })];
      return { nominal, coef: nominal > 0 ? Math.round((kw * 1000) / nominal) : 0, kw, lines, viz: 'sun', sig: `h${de}:${w.sun}:${p.kw}:${core}` };
    }
    case 'geo': {
      const lines = [t('insp.pw.why.geo')];
      return { nominal: p.kw, coef: 1000, kw, lines, viz: null, sig: 'g' };
    }
  }
}

/** The wind's ladder: a bar per kind of place, by its factor, the turbine's own inked. */
function windLadder(site: WindSite): HTMLElement {
  const steps: Array<{ k: string; permille: number; label: string; on: boolean }> = [
    { k: 'cirque', permille: BAL.windCirque, label: t('insp.pw.site.cirque'), on: site.k === 'cirque' },
    { k: 'plain', permille: BAL.windPlain, label: t('insp.pw.site.plain'), on: site.k === 'plain' },
    { k: 'mesa', permille: BAL.windMesa[0]!, label: t('insp.pw.site.mesa'), on: site.k === 'mesa' },
    ...BAL.windHeight.map((permille, i) => ({
      k: `h${i + 1}`, permille, on: site.k === 'height' && Math.min(site.level, BAL.windHeight.length) === i + 1,
      label: t(i + 1 === BAL.windHeight.length ? 'insp.pw.site.levelUp' : 'insp.pw.site.level', { n: i + 1 }),
    })),
  ];
  const top = Math.max(...steps.map((s) => s.permille));
  return el('div.pw-ladder', { 'data-pw-viz': 'wind' }, steps.map((s) => el('div.pw-step', { 'data-on': s.on ? '' : null, 'data-site': s.k, title: `${s.label} ${times(s.permille)}` }, [
    el('small.pw-step-f', {}, times(s.permille)),
    el('i.pw-step-bar', { style: `height:${Math.max(8, Math.round((s.permille * 100) / top))}%` }),
    el('small.pw-step-l', {}, s.label),
  ])));
}

/** The sun's curve over a day, midnight to midnight, a bar an epoch; now inked. */
function sunCurve(sim: Sim): HTMLElement {
  const now = dayEpoch(sim.absEpoch());
  const bars: HTMLElement[] = [];
  for (let i = 0; i < DAY_EPOCHS; i++) {
    const de = (i + 6) % DAY_EPOCHS;
    const s = sunPermille(de);
    bars.push(el('i', { 'data-on': de === now ? '' : null, style: `height:${Math.round(s / 10)}%`, title: `${t('hud.time', { h: hourOf(de) })} · ${t('hud.powerPct', { v: Math.round(s / 10) })}` }));
  }
  return el('div.pw-sun', { 'data-pw-viz': 'sun' }, [
    el('div.pw-sun-bars', {}, bars),
    el('div.pw-sun-axis', {}, [el('small', {}, t('hud.time', { h: 0 })), el('small', {}, t('hud.time', { h: 12 })), el('small', {}, t('hud.time', { h: 24 }))]),
  ]);
}

/**
 * The grid module (owner, 2026-10-14: « un module séparé lorsque l'objet cliqué est connecté à la
 * grid électrique… ce petit rectangle qui contiendra les infos de la grid et qui sera le même
 * partout »): one inked card, the same for every building that takes part in power, in place of
 * the old Énergie / Produit / Charge rows. Its head: the bolt (or a cut plug, or a struck bolt) and
 * how well its grid serves it; a bar of that; what the grid makes and asks (words on hover). Then,
 * by role: what it draws; or, for a producer, « nominal × coefficient = now » (owner: « la
 * production de l'éolienne, le coef, et la production actuelle… accéder à la raison… sans que
 * l'info prenne trop de place »): the coefficient a chip with ⓘ, its reasons on hover, unfolded
 * under it on a click (the wind's ladder by height, the sun's curve); an accumulator's charge; a
 * pillar's wires and « Relier ». Hooks: `[data-power-card]`, `[data-power]` (on|dark|unwired) on
 * its head, `[data-pw=formula|draw|charge|wires]`, `.pw-coef`, `.pw-why`, `[data-pw-viz]`.
 */
export function gridCard({ sim, e, node, host, live }: PanelCtx): HTMLElement[] {
  if (!linkable(e.def)) return [];
  const kind = BUILDING_KIND[e.def];
  const point = isLinkPoint(e.def);
  const marks: Record<PowerState, HTMLElement> = { on: glyph('power'), dark: glyph('noPower'), unwired: glyph('unwired'), asleep: glyph('noPower') };
  const mark = el('span.pw-mark'), pct = el('b.pw-pct'), bar = progressBar(), totals = el('small.pw-totals');
  let shown: PowerState | null = null;
  const rows: HTMLElement[] = [];
  // Its own part: a producer's formula, or what it draws.
  const producer = outputOf(sim, e, node) !== null;
  const nominal = el('b.pw-kw'), now = el('b.pw-kw.pw-now');
  const coefN = el('span.pw-coef-n');
  const coef = el<'button'>('button.pw-coef', { type: 'button', 'aria-expanded': 'false' }, [coefN, el('span.pw-i', {}, 'i')]);
  const whyLines = el('div.pw-why-lines'), whyViz = el('div.pw-why-viz');
  const whyBox = el('div.pw-why', { hidden: '' }, [whyLines, whyViz]);
  let open = false;
  coef.onclick = (): void => { open = !open; setAttr(whyBox, 'hidden', open ? null : ''); setAttr(coef, 'aria-expanded', String(open)); };
  const draw = el('b.pw-kw');
  if (producer) {
    rows.push(el('div.pw-formula', { 'data-pw': 'formula' }, [
      nominal, el('span.pw-op', {}, '×'), coef, el('span.pw-op', {}, '='), now,
      el('small.pw-cap', {}, t('insp.pw.nominal')), el('span'), el('small.pw-cap', {}, t('insp.pw.coef')), el('span'), el('small.pw-cap', {}, t('insp.pw.now')),
    ]), whyBox);
  } else if (kind !== 'pole' && kind !== 'accumulator') {
    rows.push(el('div.pw-row', { 'data-pw': 'draw', title: t('insp.pw.draw.tip') }, [el('span.pw-label', {}, t('insp.pw.draw')), draw]));
  }
  // An accumulator's charge.
  const charge = progressBar(), chargePct = el('b.pw-kw');
  if (kind === 'accumulator') rows.push(el('div.pw-row', { 'data-pw': 'charge' }, [el('span.pw-label', {}, t('insp.charge')), charge.root, chargePct]));
  // A pillar's wires and the Link tool.
  const wires = el('b.pw-kw');
  const btn = point && host.link ? el<'button'>('button.btn.insp-recipe.insp-link', { title: t('build.hint.link'), onclick: () => host.link!(e.id) }, t('insp.link')) : null;
  if (point) rows.push(el('div.pw-row', { 'data-pw': 'wires' }, [el('span.pw-label', {}, t('insp.wires')), wires, btn]));
  const head = el('header.pw-head', { 'data-power': '' }, [mark, el('span.pw-title', {}, t('insp.pw.title')), pct]);
  const card = el('section.pw-card', { 'data-power-card': '' }, [head, el('div.pw-gridline', {}, [bar.root, totals]), ...rows]);
  let whySig = '';
  live(() => {
    const net = sim.graph?.netOfEnt.get(e.id);
    const np = net !== undefined ? sim.netPower[net] : undefined;
    // A grid with nothing to draw from (no generator, fuel or charged accumulator) gives nothing.
    let source = !!np && np.renew + np.fuel > 0;
    if (np && !source) for (const a of sim.graph.nets[net!]?.accs ?? []) if ((sim.accEnergy.get(a.ent) ?? 0) > 0) { source = true; break; }
    const v = np && source ? Math.round(np.sat / 10) : 0;
    const state: PowerState = !np ? (e.builtAt === 0 && sim.isDormant(e) ? 'asleep' : 'unwired') : v > 0 ? 'on' : 'dark';
    if (state !== shown) { shown = state; mark.replaceChildren(marks[state]); setAttr(head, 'data-power', state); }
    setText(pct, state === 'unwired' ? t('insp.pw.unwired') : state === 'asleep' ? t('insp.pw.asleep') : t('hud.powerPct', { v }));
    bar.set(v / 100, state === 'on' ? (v >= 100 ? 'good' : 'warn') : 'bad');
    const supply = np ? Math.round(np.renew + np.fuel) : 0, demand = np ? Math.round(np.demand) : 0;
    setText(totals, np ? t('insp.pw.totals', { s: supply, d: demand }) : state === 'asleep' ? t('insp.pw.asleep.line') : t('insp.wires.none'));
    const ends = sim.linksOf(e.id);
    const tip = [np ? t('hud.powerTip', { d: demand, s: supply }) : state === 'asleep' ? t('insp.pw.asleep.tip') : t('insp.noGrid'), !point && ends.length ? t('insp.wiredTo.list', { list: wireEnds(sim, ends) }) : ''].filter(Boolean).join('\n');
    setAttr(head, 'title', tip);
    setAttr(totals, 'title', tip);
    if (producer) {
      const o = outputOf(sim, e, node);
      if (o) {
        // Unwired, it would give this much, and gives nothing: « now » says 0.
        const kwNow = np ? o.kw : 0;
        setText(nominal, t('insp.kw', { v: o.nominal }));
        setText(now, t('insp.kw', { v: kwNow }));
        setText(coefN, times(o.coef));
        setAttr(coef, 'data-tone', o.coef >= 1000 || o.calm ? 'good' : o.coef > 0 ? 'warn' : 'bad');
        setAttr(now, 'data-tone', kwNow > 0 ? null : 'bad');
        if (o.sig !== whySig) {
          whySig = o.sig;
          whyLines.replaceChildren(...o.lines.map((l) => el('div', {}, l)));
          whyViz.replaceChildren(...(o.viz === 'wind' && o.site ? [windLadder(o.site)] : o.viz === 'sun' ? [sunCurve(sim)] : []));
          setAttr(coef, 'title', [t('insp.pw.coef.tip'), ...o.lines].join('\n'));
        }
      }
    } else {
      setText(draw, t('insp.kw', { v: Math.round(node?.demand() ?? 0) }));
    }
    if (kind === 'accumulator') {
      const acc = net !== undefined ? sim.graph.nets[net]?.accs.find((q) => q.ent === e.id) : undefined;
      const fr = acc && acc.cap > 0 ? (sim.accEnergy.get(e.id) ?? 0) / acc.cap : 0;
      charge.set(fr, acc ? 'good' : 'idle');
      setText(chargePct, t('hud.powerPct', { v: Math.round(fr * 100) }));
    }
    if (point) {
      setText(wires, t('insp.wires.count', { n: ends.length, max: linkPoint(e.def, sim.mods)!.slots }));
      if (btn) setAttr(btn, 'data-on', host.linkSource?.() === e.id ? '' : null);
    }
  });
  return [card];
}
