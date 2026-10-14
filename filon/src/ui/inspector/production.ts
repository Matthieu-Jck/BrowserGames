// production.ts — inspector panels of the producing buildings: a machine's recipe choice,
// buffers and rates, its speed modules; a drill's deposit and buffer; a generator's fuel; a
// research lab's project (its data files and its AI tokens, D68) and what it runs next; a server's
// tokens. Every item shows its icon beside its name (mention.ts), and
// every number says what it is (held in the machine, per minute at full speed, paid / owed).
import { CRECIPES, ITEM_IDS, itemIdx, recipesFor } from '@/content/registry';
import { RECIPES } from '@/content/recipes';
import { RESEARCH, type ResearchId } from '@/content/research';
import type { RecipeDef, ResearchDef } from '@/content/types';
import { el, setAttr, setText } from '@/core/dom';
import { rate } from '@/i18n/format';
import { locale, t } from '@/i18n/i18n';
import { modulesOf, recipeOf } from '@/sim/cfg';
import type { DrillNode, GeneratorNode, MachineNode } from '@/sim/flow/nodes';
import { projectPermille, tokensDue } from '@/sim/research/runtime';
import { itemMention, itemRef } from '../mention';
import { St } from '@/sim/types';
import { fmt, heading, itemRow, progressBar, row, smoothProgress, STATUS_TONE, type Panel } from './kit';

/** Recipe buttons (the output's icon and the recipe's name); with a recipe, each input and output: held, and per minute. */
export const machinePanel: Panel = ({ sim, e, node, host, live, anim }) => {
  const m = node as MachineNode | undefined;
  const L = locale();
  const choices = recipesFor(e.def).filter((r) => sim.unlocked(r.unlock));
  const r = recipeOf(e.cfg);
  const cur = r > 0 ? CRECIPES[r - 1] ?? null : null;
  const out: Array<HTMLElement | null> = [
    heading(t('insp.recipe')),
    // The button's text stays the recipe's name alone (the tutorial's guide finds it by it); the icon is an image.
    el('div.insp-recipes', {}, choices.map((c) => el('button.btn.insp-recipe', {
      'data-on': cur?.idx === c.idx ? '' : null,
      'data-recipe': c.id,
      onclick: () => host.setRecipe(e.id, c.id),
    }, [c.outs[0] ? itemMention(c.outs[0].item, { name: false }) : null, (RECIPES[c.id as keyof typeof RECIPES] as RecipeDef).name[L]]))),
  ];
  if (cur && m?.recipe) {
    // The craft under way: fills once per craft (a few seconds), smoothly between ticks; full and
    // tinted while its output is full, empty while it waits for its inputs.
    const need = m.recipe.ticks * 1000;
    const bar = progressBar();
    const prog = smoothProgress(sim, () => ({ v: m.crafting ? Math.min(m.p, need) : 0, need, on: m.crafting && (m.status === St.Ok || m.status === St.LowPower) }));
    anim((ticks) => bar.set(prog(ticks), STATUS_TONE[m.status] ?? 'good'));
    out.push(el('div.insp-row.insp-progress', { 'data-progress': 'craft' }, [el('span.insp-label', {}, t('insp.craft')), bar.root]));
    // A small table: each input and output, what the machine holds of it, and how many a minute it
    // uses or makes at full speed (this machine's speed: research, modules, dug floor).
    const perMin = (q: number): string => fmt((q / 1000) * (600 / cur.ticks) * (m.speed / 1000));
    const rows = (specs: typeof cur.ins, buf: () => ArrayLike<number>): HTMLElement[] => specs.flatMap((s, j) => {
      const held = el('span.insp-io-n');
      live(() => setText(held, fmt(buf()[j]! / 1000, 0)));
      return [el('span.insp-io-item', {}, itemMention(s.item)), held, el('span.insp-io-n', {}, perMin(s.mu))];
    });
    const head = (text: string, first: boolean): HTMLElement[] => [
      el('h4.lettering', {}, text),
      el('small.insp-io-col', {}, first ? t('insp.io.held') : ''),
      el('small.insp-io-col', {}, first ? t('insp.io.perMin') : ''),
    ];
    out.push(el('div.insp-io', { title: t('insp.io.tip') }, [
      ...head(t('insp.inputs'), true), ...rows(cur.ins, () => m.inBuf),
      ...head(t('insp.outputs'), false), ...rows(cur.outs, () => m.outBuf),
    ]));
  }
  return out;
};

/** Speed modules: fit one from the Hearth's stock, or take one back (Pace research). */
export const modulesPanel: Panel = ({ sim, e, host, live }) => {
  const max = sim.moduleSlots();
  if (max <= 0) return [];
  const n = modulesOf(e.cfg);
  const mod = itemIdx('pace_bell');
  const held = el('p.insp-note');
  live(() => setText(held, t('insp.modules.note', { item: itemRef(mod), n: Math.floor(sim.stock[mod]! / 1000) })));
  return [
    heading(t('insp.modules', { n, max })),
    held,
    el('div.insp-recipes', {}, [
      el('button.btn.insp-recipe', { disabled: n >= max ? '' : null, onclick: () => { if (!sim.setModule(e.id, true)) host.notify('bad', t('reason.unaffordable')); } }, t('insp.modules.add')),
      el('button.btn.insp-recipe', { disabled: n <= 0 ? '' : null, onclick: () => sim.setModule(e.id, false) }, t('insp.modules.remove')),
    ]),
  ];
};

/** What it mines and how fast (at full power), and what waits at its output. */
export const drillPanel: Panel = ({ sim, node, live, anim }) => {
  const d = node as DrillNode | undefined;
  if (!d || d.item < 0) return [];
  const v = el('span');
  live(() => setText(v, `${fmt(Math.floor(d.outBuf / 1000), 0)}/${fmt(d.outCap / 1000, 0)}`));
  // The next item on its way: what the drill has cut of it (whole items leave it, D37); full while its output is.
  const bar = progressBar();
  const full = (): boolean => d.outBuf + 1000 > d.outCap;
  const prog = smoothProgress(sim, () => ({ v: full() ? 1000 : d.outBuf % 1000, need: 1000, on: !full() && (d.status === St.Ok || d.status === St.LowPower) }));
  anim((ticks) => bar.set(prog(ticks), STATUS_TONE[d.status] ?? 'good'));
  return [
    el('div.insp-row.insp-progress', { 'data-progress': 'mine' }, [el('span.insp-label', {}, t('insp.mine')), bar.root]),
    row(t('card.mines'), el('span', {}, t('insp.drill.rate', { item: itemRef(d.item), rate: rate(d.rateEp / 1000) }))),
    row(t('insp.buffer'), v),
  ];
};

export const generatorPanel: Panel = ({ node, live }) => {
  const g = node as GeneratorNode | undefined;
  if (!g) return [];
  const v = el('span');
  live(() => setText(v, t('insp.held', { n: fmt(g.fuel / 1000) })));
  return [heading(t('card.fuel')), itemRow(g.fuelItem, v)];
};

/** The project a research lab runs: its progress, per data item what is paid of what it costs and what waits in store, its AI tokens used; what it runs next. */
export const labPanel: Panel = ({ sim, e, host, live }) => {
  const line = el('div.insp-list'), table = el('div.insp-io', { hidden: '' });
  // Its AI tokens (D68): used of the project's total, and why it may be paused (the purse in the red).
  const tok = el('span.insp-gv'), tokRow = row(t('insp.lab.tokens'), tok);
  const held = el('div.insp-note', { 'data-tone': 'bad' }, t('insp.lab.held'));
  const next = el('span'), nextRow = row(t('insp.lab.next'), next);
  // The project's progress (hours, not seconds: the 4 Hz refresh is smooth enough).
  const bar = progressBar();
  bar.root.hidden = true;
  let sig = '';
  const vals: Array<{ paid: HTMLElement; held: HTMLElement }> = [];
  live(() => {
    const p = sim.projects.find((q) => q.lab === e.id);
    bar.root.hidden = !p;
    if (p) bar.set(projectPermille(p) / 1000, sim.researchHeld ? 'idle' : 'good');
    held.hidden = !p || !sim.researchHeld;
    tokRow.hidden = !p?.tokens;
    if (p?.tokens) setText(tok, t('insp.lab.tokens.v', { used: tokensK(tokensDue(p)), of: tokensK(p.tokens) }));
    const q = sim.labQueue.get(e.id);
    nextRow.hidden = !q;
    if (q) setText(next, (RESEARCH[q as ResearchId] as ResearchDef | undefined)?.name[locale()] ?? q);
    if (!p) {
      setText(line, t('insp.lab.none'));
      if (sig !== '') { sig = ''; table.replaceChildren(); table.hidden = true; }
      return;
    }
    const r = RESEARCH[p.id as ResearchId] as ResearchDef | undefined;
    setText(line, `${r ? r.name[locale()] : p.id} · ${t('research.progress', { v: Math.floor(projectPermille(p) / 10) })}`);
    const s = p.cost.map((c) => ITEM_IDS[c.item]).join(',');
    if (s !== sig) {
      sig = s;
      vals.length = 0;
      table.hidden = false;
      table.replaceChildren(
        el('span'), el('small.insp-io-col', {}, t('insp.lab.paidCol')), el('small.insp-io-col', {}, t('insp.io.held')),
        ...p.cost.flatMap((c) => {
          const v = { paid: el('span.insp-io-n'), held: el('span.insp-io-n') };
          vals.push(v);
          return [el('span.insp-io-item', {}, itemMention(c.item)), v.paid, v.held];
        }),
      );
    }
    const st = sim.stores.get(e.id);
    p.cost.forEach((c, i) => {
      setText(vals[i]!.paid, `${fmt(p.paid[i]! / 1000, 0)}/${fmt(c.mu / 1000, 0)}`);
      setText(vals[i]!.held, fmt((st?.[c.item] ?? 0) / 1000, 0));
    });
  });
  const head = heading(t('screen.research'));
  head.title = t('insp.lab.hint'); // how data reaches it, on hover (D53)
  return [head, line, bar.root, held, table, tokRow, nextRow, el('button.btn.insp-recipe', { onclick: () => host.openResearch() }, t('insp.lab.choose'))];
};

/** Tokens in thousands, as research counts them (« 12,5 k »). */
const tokensK = (n: number): string => t('unit.ktokens', { v: fmt(n / 1000, n >= 100_000 ? 0 : 1) });

/** A server (D68): the AI tokens it makes a minute at its grid's power now, and the last minute's bill. */
export const serverPanel: Panel = ({ sim, e, live }) => {
  const tpm = el('span.insp-gv'), bill = el('span');
  live(() => {
    const s = sim.graph?.servers.find((x) => x.ent === e.id);
    const sat = s ? sim.ctx?.sat[s.net] ?? 0 : 0;
    setText(tpm, t('insp.server.rate', { v: tokensK(s ? Math.floor((s.tpm * sat) / 1000) : 0) }));
    setAttr(tpm, 'data-tone', sat > 0 ? null : 'bad');
    const st = sim.tokenStats;
    setText(bill, t('insp.server.bill', { used: tokensK(st.used), own: tokensK(st.fromServers), lost: tokensK(Math.max(0, st.supply - st.fromServers)) }));
  });
  return [heading(t('insp.server.title')), row(t('insp.server.makes'), tpm), el('div.insp-note', {}, bill)];
};
