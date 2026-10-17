// production.ts — inspector panels of the producing buildings, laid out by the kit (D89): what each
// does at the top (its `HERO`: a machine's recipe as an icon equation a minute at full speed and
// its craft under way; what a drill cuts a minute and the next item; a generator's fuel against
// the power it makes; a research lab's project and its progress; a server's tokens), then the
// details in their own sections: a machine's recipe choice and its buffers (each input and output
// as a meter of what it holds against its room), a drill's output, a generator's fuel, a lab's
// data (paid of what the project costs, what waits in store), its AI tokens (D68) and what it runs
// next. Every item shows its icon (mention.ts); every number goes through the kit's formats.
import { CRECIPES, ITEM_IDS, recipesFor } from '@/content/registry';
import { RECIPES } from '@/content/recipes';
import { RESEARCH, type ResearchId } from '@/content/research';
import type { RecipeDef, ResearchDef } from '@/content/types';
import { el, setAttr, setText } from '@/core/dom';
import { num } from '@/i18n/format';
import { locale, t } from '@/i18n/i18n';
import { recipeOf } from '@/sim/cfg';
import type { DrillNode, GeneratorNode, MachineNode } from '@/sim/flow/nodes';
import { projectPermille } from '@/sim/research/runtime';
import { St } from '@/sim/types';
import { glyph } from '../glyphs';
import { itemMention } from '../mention';
import {
  equation, fmt, itemTerm, kw, mark, meter, note, perMin, progressBar, row, section, smoothProgress, STATUS_TONE, type Panel, type PanelCtx,
} from './kit';

/** The bar of a task under way, smooth between ticks (owner, 2026-10-13: "a little progress bar"). */
function taskBar(hook: string, title: string): { node: HTMLElement; bar: ReturnType<typeof progressBar> } {
  const bar = progressBar();
  return { node: el('div.insp-progress', { 'data-progress': hook, title }, [bar.root]), bar };
}

// ── a machine ─────────────────────────────────────────────────────────────────

/** Its recipe now and this machine's speed (its own, and a dug floor's): the rate a minute of a spec. */
function machineRates({ e, node }: PanelCtx): { m: MachineNode; cur: (typeof CRECIPES)[number]; per: (mu: number) => number } | null {
  const m = node as MachineNode | undefined;
  const r = recipeOf(e.cfg);
  const cur = r > 0 ? CRECIPES[r - 1] ?? null : null;
  if (!cur || !m?.recipe) return null;
  return { m, cur, per: (mu) => (mu / 1000) * (600 / cur.ticks) * (m.speed / 1000) };
}

/** What it makes: « [ore] 15 + [coal] 15 → [plate] 15 /min » at full speed, and the craft under way. */
export const machineHero = (ctx: PanelCtx): HTMLElement | null => {
  const r = machineRates(ctx);
  if (!r) return null;
  const { m, cur, per } = r;
  const eq = equation(cur.ins.map((s) => itemTerm(s.item, num(per(s.mu)))), cur.outs.map((s) => itemTerm(s.item, num(per(s.mu)))), t('insp.unit.perMin'));
  eq.title = t('insp.eq.tip');
  // The craft: fills once per craft (a few seconds), smoothly between ticks; full and tinted while
  // its output is full, empty while it waits for its inputs.
  const need = m.recipe!.ticks * 1000;
  const task = taskBar('craft', t('insp.craft'));
  const prog = smoothProgress(ctx.sim, () => ({ v: m.crafting ? Math.min(m.p, need) : 0, need, on: m.crafting && (m.status === St.Ok || m.status === St.LowPower) }));
  ctx.anim((ticks) => task.bar.set(prog(ticks), STATUS_TONE[m.status] ?? 'good'));
  return el('div.insp-hero', { 'data-hero': 'machine' }, [eq, task.node]);
};

/** Its recipe choice (the output's icon and the recipe's name) and its buffers, as meters. */
export const machinePanel: Panel = (ctx) => {
  const { sim, e, host, live } = ctx;
  const L = locale();
  const choices = recipesFor(e.def).filter((r) => sim.unlocked(r.unlock));
  const r = recipeOf(e.cfg);
  const cur = r > 0 ? CRECIPES[r - 1] ?? null : null;
  const out: Array<HTMLElement | null> = [];
  // Nothing to choose (its one recipe set, D83): no section; the hero says what it makes.
  if (!(choices.length === 1 && cur?.idx === choices[0]!.idx)) {
    out.push(section({ sec: 'recipe', title: t('insp.recipe'), icon: mark('recipe') }, [
      // The button's text stays the recipe's name alone (the tutorial's guide finds it by it); the icon is an image.
      el('div.insp-recipes', {}, choices.map((c) => el('button.btn.insp-recipe', {
        'data-on': cur?.idx === c.idx ? '' : null,
        'data-recipe': c.id,
        onclick: () => host.setRecipe(e.id, c.id),
      }, [c.outs[0] ? itemMention(c.outs[0].item, { name: false }) : null, (RECIPES[c.id as keyof typeof RECIPES] as RecipeDef).name[L]]))),
    ]));
  }
  const rates = machineRates(ctx);
  if (rates) {
    const { m, cur: rc } = rates;
    // Each input and output: what the machine holds of it against its room — an input short of a
    // craft is peach, an output too full for the next one coral.
    const rows = (specs: typeof rc.ins, buf: ArrayLike<number>, cap: ArrayLike<number>, io: 'in' | 'out'): HTMLElement[] => specs.map((s, j) => {
      const g = meter();
      live(() => {
        const held = buf[j]!, room = cap[j]!;
        const tone = io === 'in' ? (held < s.mu ? 'warn' : 'good') : (held + s.mu > room ? 'bad' : 'good');
        g.set(held, room, tone, `${fmt(held / 1000, 0)}/${fmt(room / 1000, 0)}`);
      });
      return el('div.kbuf', { 'data-io': io, 'data-item': ITEM_IDS[s.item] }, [el('span.kbuf-icon', {}, itemMention(s.item, { name: false })), g.root]);
    });
    out.push(section({ sec: 'buffers', title: t('insp.sec.buffers'), icon: mark('store'), tip: t('insp.io.tip') }, [
      el('small.kbuf-cap', {}, t('insp.inputs')), ...rows(rc.ins, m.inBuf, m.inCap, 'in'),
      el('small.kbuf-cap', {}, t('insp.outputs')), ...rows(rc.outs, m.outBuf, m.outCap, 'out'),
    ]));
  }
  return out;
};

// ── a drill ───────────────────────────────────────────────────────────────────

/** What it cuts a minute at full power, and the next item on its way (whole items leave it, D37). */
export const drillHero = ({ sim, node, anim }: PanelCtx): HTMLElement | null => {
  const d = node as DrillNode | undefined;
  if (!d || d.item < 0) return null;
  const eq = equation([], [itemTerm(d.item, num(d.rateEp / 1000))], t('insp.unit.perMin'));
  eq.title = t('insp.eq.tip');
  const task = taskBar('mine', t('insp.mine'));
  const full = (): boolean => d.outBuf + 1000 > d.outCap;
  const prog = smoothProgress(sim, () => ({ v: full() ? 1000 : d.outBuf % 1000, need: 1000, on: !full() && (d.status === St.Ok || d.status === St.LowPower) }));
  anim((ticks) => task.bar.set(prog(ticks), STATUS_TONE[d.status] ?? 'good'));
  return el('div.insp-hero', { 'data-hero': 'drill' }, [eq, task.node]);
};

/** What waits at its output, against its room. */
export const drillPanel: Panel = ({ node, live }) => {
  const d = node as DrillNode | undefined;
  if (!d || d.item < 0) return [];
  const g = meter();
  live(() => g.set(Math.floor(d.outBuf / 1000), d.outCap / 1000, d.outBuf + 1000 > d.outCap ? 'bad' : 'good', `${fmt(d.outBuf / 1000, 0)}/${fmt(d.outCap / 1000, 0)}`));
  return [section({ sec: 'output', title: t('insp.buffer'), icon: mark('store') }, [
    el('div.kbuf', { 'data-io': 'out', 'data-item': ITEM_IDS[d.item] }, [el('span.kbuf-icon', {}, itemMention(d.item, { name: false })), g.root]),
  ])];
};

// ── a generator ───────────────────────────────────────────────────────────────

/** Its fuel a minute against the power it gives, at full output. */
export const generatorHero = ({ node }: PanelCtx): HTMLElement | null => {
  const g = node as GeneratorNode | undefined;
  if (!g) return null;
  // A steam boiler's water beside its coal (D114).
  const ins = [itemTerm(g.fuelItem, perMin(g.burnEp / 1000)), ...(g.drinks ? [itemTerm(g.waterItem, perMin(g.waterEp / 1000))] : [])];
  const eq = equation(ins, [{ icon: glyph('power'), n: kw(g.outKw) }]);
  eq.title = t('insp.eq.tip');
  return el('div.insp-hero', { 'data-hero': 'generator' }, [eq]);
};

/** The fuel it holds, against its room (and a steam boiler's water, D114). */
export const generatorPanel: Panel = ({ node, live }) => {
  const g = node as GeneratorNode | undefined;
  if (!g) return [];
  const m = meter();
  live(() => m.set(g.fuel, g.fuelCap, g.fuel > 0 ? 'good' : 'bad', `${fmt(g.fuel / 1000, 0)}/${fmt(g.fuelCap / 1000, 0)}`));
  const rows = [el('div.kbuf', { 'data-io': 'in', 'data-item': ITEM_IDS[g.fuelItem] }, [el('span.kbuf-icon', {}, itemMention(g.fuelItem, { name: false })), m.root])];
  if (g.drinks) {
    const w = meter();
    live(() => w.set(g.water, g.waterCap, g.water > 0 ? 'good' : 'bad', `${fmt(g.water / 1000, 0)}/${fmt(g.waterCap / 1000, 0)}`));
    rows.push(el('div.kbuf', { 'data-io': 'in', 'data-item': ITEM_IDS[g.waterItem] }, [el('span.kbuf-icon', {}, itemMention(g.waterItem, { name: false })), w.root]));
  }
  return [section({ sec: 'fuel', title: t('card.fuel'), icon: itemMention(g.fuelItem, { name: false }) }, rows)];
};

// ── a research lab ────────────────────────────────────────────────────────────

/** Tokens in thousands, as research counts them (« 12,5 k »). */
const tokensK = (n: number): string => t('unit.ktokens', { v: fmt(n / 1000, n >= 100_000 ? 0 : 1) });

/** The project it runs and its progress (hours, not seconds: the 4 Hz refresh is smooth enough); none: an empty slot. */
export const labHero = ({ sim, e, live }: PanelCtx): HTMLElement => {
  const name = el('b.insp-hero-name.lettering'), pct = el('span.insp-hero-pct');
  const bar = progressBar();
  const none = el('p.insp-note', {}, t('insp.lab.none'));
  live(() => {
    const p = sim.projects.find((q) => q.lab === e.id);
    setAttr(none, 'hidden', p ? '' : null);
    setAttr(bar.root, 'hidden', p ? null : '');
    if (!p) { setText(name, ''); setText(pct, ''); return; }
    const r = RESEARCH[p.id as ResearchId] as ResearchDef | undefined;
    setText(name, r ? r.name[locale()] : p.id);
    setText(pct, t('hud.powerPct', { v: Math.floor(projectPermille(p) / 10) }));
    bar.set(projectPermille(p) / 1000, sim.credits < 0 && (p.buy ?? 0) > 0 && (p.tokIn ?? 0) < (p.tokens ?? 0) ? 'bad' : 'lilac');
  });
  return el('div.insp-hero', { 'data-hero': 'lab' }, [el('div.insp-hero-line', {}, [mark('tree'), name, pct]), bar.root, none]);
};

/** Per data item, what is paid of what the project costs and what waits in store; its AI tokens; what it runs next. */
export const labPanel: Panel = ({ sim, e, host, live, action }) => {
  const rowsBox = el('div.kbufs');
  // Its AI tokens (D68, D118): delivered of those it needs, and why its bought flow may be paused (the purse in the red).
  const tok = meter(), tokRow = el('div.kbuf', { 'data-k': 'tokens', title: t('insp.lab.tokens') }, [el('span.kbuf-icon', {}, mark('token')), tok.root]);
  const held = el('p.insp-note', { 'data-tone': 'bad' }, t('insp.lab.held'));
  const next = el('span'), nextRow = row(t('insp.lab.next'), next);
  let sig: string | null = null;
  const vals: Array<{ paid: ReturnType<typeof meter>; held: HTMLElement }> = [];
  const sec = section({ sec: 'data', title: t('insp.sec.data'), icon: mark('data'), tip: t('insp.lab.hint'), group: 'production' }, [rowsBox, tokRow, held, nextRow]);
  live(() => {
    const p = sim.projects.find((q) => q.lab === e.id);
    const paused = !!p && sim.credits < 0 && (p.buy ?? 0) > 0 && (p.tokIn ?? 0) < (p.tokens ?? 0);
    setAttr(held, 'hidden', paused ? null : '');
    setAttr(tokRow, 'hidden', p?.tokens ? null : '');
    if (p?.tokens) tok.set(p.tokIn ?? 0, p.tokens, paused ? 'bad' : 'lilac', t('insp.lab.tokens.v', { used: tokensK(p.tokIn ?? 0), of: tokensK(p.tokens) }));
    const q = sim.labQueue.get(e.id);
    setAttr(nextRow, 'hidden', q ? null : '');
    if (q) setText(next, (RESEARCH[q as ResearchId] as ResearchDef | undefined)?.name[locale()] ?? q);
    setAttr(sec, 'hidden', p || q ? null : '');
    const s = p ? p.cost.map((c) => ITEM_IDS[c.item]).join(',') : '';
    if (s !== sig) {
      sig = s;
      vals.length = 0;
      rowsBox.replaceChildren(...(p?.cost ?? []).map((c) => {
        const v = { paid: meter(), held: el('small.kbuf-held') };
        vals.push(v);
        return el('div.kbuf', { 'data-item': ITEM_IDS[c.item] }, [el('span.kbuf-icon', {}, itemMention(c.item, { name: false })), v.paid.root, v.held]);
      }));
    }
    if (!p) return;
    const st = sim.stores.get(e.id);
    p.cost.forEach((c, i) => {
      vals[i]!.paid.set(p.paid[i]!, c.mu, 'lilac', `${fmt(p.paid[i]! / 1000, 0)}/${fmt(c.mu / 1000, 0)}`);
      const h = (st?.[c.item] ?? 0) / 1000;
      setText(vals[i]!.held, t('insp.lab.inStore', { n: fmt(h, 0) }));
    });
  });
  action(el('button.btn.insp-recipe', { onclick: () => host.openResearch() }, [mark('tree'), ' ', t('insp.lab.choose')]));
  return [sec];
};

// ── a server ──────────────────────────────────────────────────────────────────

/** A server (D68): the AI tokens it makes a minute at its grid's power now. */
export const serverHero = ({ sim, e, live }: PanelCtx): HTMLElement => {
  const n = el('b');
  const eq = equation([{ icon: glyph('power') }], [{ icon: mark('token'), n }], t('insp.unit.perMin'));
  live(() => {
    const s = sim.graph?.servers.find((x) => x.ent === e.id);
    const sat = s ? sim.ctx?.sat[s.net] ?? 0 : 0;
    setText(n, tokensK(s ? Math.floor((s.tpm * sat) / 1000) : 0));
    setAttr(n, 'data-tone', sat > 0 ? null : 'bad');
  });
  return el('div.insp-hero', { 'data-hero': 'server' }, [eq]);
};

/** The last minute's bill: what research used, how much its own servers covered, what was lost. */
export const serverPanel: Panel = ({ sim, live }) => {
  const bill = note('');
  live(() => {
    const st = sim.tokenStats;
    setText(bill, t('insp.server.bill', { used: tokensK(st.used), own: tokensK(st.fromServers), lost: tokensK(Math.max(0, st.supply - st.fromServers)) }));
  });
  return [section({ sec: 'tokens', title: t('insp.lab.tokens'), icon: mark('token'), group: 'production' }, [bill])];
};
