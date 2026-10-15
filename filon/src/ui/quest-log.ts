// quest-log.ts — the tutorial on screen (decision D28). The quest log on the left, under the
// HUD's research chips: the base's name, CrierBelt's current objective (its message, the
// objectives with their progress, the reward, the guide's hint for the step at hand), the
// objectives already met, ticked; collapsible. Also the wording of the completion toast, and
// the naming modal that opens on an unnamed base once no full screen is up (the main menu
// first): skipped under automation (`navigator.webdriver`, `?nomenu`), where the base keeps
// its placeholder name and quest 0 stays open until a script names it.
//
// Items it names show their icons (mention.ts): objectives, rewards, info lines, and the quest's
// items where its own labels and the guide's hints say them in plain words (`markItems`).
// Reads the engine at 4 Hz (change-only writes; the current objective's block is rebuilt only
// when its signature changes) and acts only through commands (`nameColony`). The arrow is the
// guide's (guide.ts); this log shows its step's hint and the guide's on/off switch.
import { BUILDINGS } from '@/content/buildings';
import { BAL } from '@/content/balance';
import { COLONY_NAME_MAX, QUEST_IDS, QUEST_TITLES, questDef, type QuestDef, type QuestObjective, type QuestReward } from '@/content/quests';
import { RECIPES } from '@/content/recipes';
import { RESEARCH, nodeName } from '@/content/research';
import { ITEM_IDS, buildingDef, buildingIdx, itemDef, itemIdx } from '@/content/registry';
import type { BuildingDef, Loc, RecipeDef, ResearchDef } from '@/content/types';
import { wirePerElectronicsWorkshop } from '@/content/validate';
import { el, setAttr, setStyle, setText } from '@/core/dom';
import { makeStore } from '@/core/store';
import { duration, num } from '@/i18n/format';
import { locale, t } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import { EPOCH, TPS } from '@/sim/constants';
import type { Sim } from '@/sim/state';
import { currentQuest, questProgress, rewardItems, type ObjectiveProgress } from '@/sim/systems/quests';
import { buildingIcon } from './build-bar';
import type { GuideStep } from './guide';
import { itemMention, itemRef, markItems } from './mention';
import { nameVerdict, refusalText, registerOf } from './screens/intro-name';
import { oc, secondsTo } from './trade-view';

export interface QuestLogHost {
  sim(): Sim;
  /** A full screen is up (the main menu, research, the Crier…): the naming modal waits. */
  screenOpen(): boolean;
  /** The guide's current step: its hint goes under the objectives. */
  step(): GuideStep | null;
  /** The guide's on / off switch. */
  guide: { enabled: boolean };
}

/** How long the finished log stays (ticks: 20 game seconds), its last stamp in view. */
const DONE_SHOW_TICKS = 200;

const prefs = makeStore<{ version: 1; folded: boolean; doneOpen: boolean }>('filon.quests.v1', 1, () => ({ version: 1, folded: false, doneOpen: false }));

/** Name ideas for a new base (place names: the same in both languages). */
const NAMES = ['Filon-Clair', 'Haute-Braise', 'Val-de-Cuivre', 'Roche-Fière', 'Belle-Coulée', 'Pierre-Haute', 'Sables-d’Or', 'Vent-Clair', 'Mont-Ferré', 'Fonds-de-Verre', 'Trois-Cols', 'Bonne-Mine'];

/** Automated runs (the smoke test, `?nomenu`): no modal may block them. */
const automated = (): boolean =>
  (typeof navigator !== 'undefined' && navigator.webdriver === true) || new URLSearchParams(location.search).has('nomenu');

const L = (loc: Loc): string => loc[locale()];
const buildingName = (id: string): string => buildingDef(buildingIdx(id)).name[locale()];
const recipeName = (id: string): string => (RECIPES as Record<string, RecipeDef>)[id]?.name[locale()] ?? id;
const researchName = (id: string): string => (RESEARCH as Record<string, ResearchDef>)[id]?.name[locale()] ?? id;
/** Items as « A / B », each with its icon (mention.ts). */
const refs = (ids: readonly string[]): string => ids.map((id) => itemRef(id)).join(' / ');
/** Names as one list in the current language (« A et B »). */
const listOf = (names: readonly string[]): string => new Intl.ListFormat(locale(), { type: 'conjunction' }).format(names);

/** The items a quest names: its objectives' and its steps'. Its labels and hints say them in plain words. */
export function questItems(def: QuestDef): string[] {
  const out = new Set<string>();
  for (const o of [...def.objectives, ...def.steps.flatMap((st) => (st.done ? [st.done] : []))]) {
    if ('items' in o && Array.isArray(o.items)) for (const i of o.items) out.add(i);
    else if ('item' in o && typeof o.item === 'string') out.add(o.item);
  }
  return [...out];
}

/** A guide hint as the log and the guide's bubble show it: the quest's items it names carry their icons. */
export const hintText = (def: QuestDef, hint: Loc): string => markItems(L(hint), questItems(def));

/** The claim's name as shown (a placeholder until it is named): the HUD and the menu may use it too. */
export function baseLabel(sim: Sim): string {
  return sim.colonyName || t('quest.unnamed');
}

/** An objective's line in the log. */
export function objectiveLabel(o: QuestObjective): string {
  // A label of its own (content) that names the objective's item shows it with its icon too.
  if (o.label) return markItems(L(o.label), 'item' in o && typeof o.item === 'string' ? [o.item] : 'items' in o ? o.items : []);
  switch (o.k) {
    case 'name': return t('quest.obj.name');
    case 'build': return t('quest.obj.build', { name: buildingName(o.defs[0]!) });
    case 'stock': return t('quest.obj.stock', { name: refs(o.items) });
    case 'produce': return t('quest.obj.produce', { name: refs(o.items) });
    case 'rate': return t('quest.obj.rate', { name: refs(o.items) });
    case 'linked': return t('quest.obj.linked', { name: buildingName(o.defs[0]!) });
    case 'powered': return t('quest.obj.powered', { name: buildingName(o.defs[0]!) });
    case 'research': return t('quest.obj.research', { name: researchName(o.id) });
    case 'post': return t('quest.obj.post');
    case 'export': return t('quest.obj.export', { name: refs(o.items) });
    case 'order': return t('quest.obj.order', { name: itemRef(o.item) });
    case 'import': return t('quest.obj.import', { name: refs(o.items) });
    case 'dig': return t('quest.obj.dig');
    case 'reach': return t('quest.obj.reach', { r: o.r });
    case 'recipe': return t('quest.obj.recipe', { machine: buildingName(o.defs[0]!), recipe: recipeName(o.recipe) });
    case 'delivers': return t('quest.obj.delivers', { name: buildingName(o.defs[0]!) });
    case 'unlocked': return o.label ? o.label[locale()] : t('quest.obj.unlocked', { name: listOf(o.ids.map((id) => nodeName(id)[locale()])) });
    case 'feeds': return t('quest.obj.feeds', { item: itemRef(o.item), name: buildingName(o.to[0]!) });
    case 'vein': return t('quest.obj.vein');
    default: { const never: never = o; return never; }
  }
}

/** How far it is, as text: « 12/50 », « 24/30 par min », ✓; a yes-or-no objective not met yet says nothing (its box does). */
function progressText(o: QuestObjective, p: ObjectiveProgress): string {
  if (p.met && p.need === 1) return '✓';
  if (o.k === 'rate') return p.measuring ? t('quest.measuring') : t('quest.perMin', { have: num(p.have), need: num(p.need) });
  if (p.need === 1) return '';
  return `${num(Math.min(p.have, p.need))}/${num(p.need)}`;
}

/** A reward in a few words (the completion toast); `title`: the title it granted. */
export function rewardText(r: QuestReward, title?: string): string {
  const parts: string[] = [];
  if (r.kit) parts.push(t('quest.reward.kit', { name: buildingName(r.kit) }));
  else if (r.hearthLevel) parts.push(t('quest.reward.hearth', { n: r.hearthLevel }));
  else for (const { item, mu } of rewardItems(r)) parts.push(`+${num(mu / 1000)} ${itemRef(item)}`);
  if (r.credits) parts.push(`+${oc(r.credits * 100)}`);
  if (r.title) parts.push(title && QUEST_TITLES[title] ? t('quest.reward.titled', { title: L(QUEST_TITLES[title]!) }) : t('quest.reward.title'));
  return parts.join(' · ');
}

/** The completion toast: « CrierBelt : objectif atteint — La fonderie · +20 Charbon ». */
export function questToast(id: string, title?: string): string {
  const def = questDef(id);
  if (!def) return t('quest.toast', { name: id });
  const reward = rewardText(def.reward, title);
  return reward ? t('quest.toastReward', { name: L(def.name), reward }) : t('quest.toast', { name: L(def.name) });
}

/** Live readings some objectives come with (content `info`). */
interface Live { node: HTMLElement; update(sim: Sim): void }

export class QuestLog {
  readonly root: HTMLElement;
  /** The naming modal (mounted by the shell over the UI). */
  readonly modal: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly titlesEl: HTMLElement;
  private readonly guideBtn: HTMLButtonElement;
  private readonly foldBtn: HTMLButtonElement;
  private readonly cur: HTMLElement;
  private readonly doneBtn: HTMLButtonElement;
  private readonly doneList: HTMLElement;
  private sig = '';
  private doneSig = '';
  private lastDone = -1;
  private flashTimer = 0;
  private folded: boolean;
  private doneOpen: boolean;
  /** Per objective of the current quest: its row's live parts. */
  private rows: Array<{ node: HTMLElement; val: HTMLElement; bar: HTMLElement }> = [];
  private hintEl: HTMLElement | null = null;
  private lives: Live[] = [];
  /** Produced counters sampled once a second (live rates for the info lines). */
  private samples: Array<{ tick: number; produced: Float64Array }> = [];
  // ── the naming modal ──
  private readonly input: HTMLInputElement;
  private readonly err: HTMLElement;
  /** Its texts, set on each opening (they follow a language switch). */
  private readonly modalText: Array<[HTMLElement, () => string]> = [];
  private autoOpened = false;
  private suggestion = -1;

  constructor(private readonly atlas: Atlas, private readonly host: QuestLogHost) {
    const p = prefs.load();
    this.folded = p.folded;
    this.doneOpen = p.doneOpen;
    this.nameEl = el('button.ql-name.lettering', { 'data-quest-rename': '', onclick: () => this.openNaming() });
    this.subEl = el('div.ql-sub');
    this.titlesEl = el('div.ql-titles');
    this.guideBtn = el<'button'>('button.ql-icon', { 'data-quest-guide': '', onclick: () => { this.host.guide.enabled = !this.host.guide.enabled; this.refresh(); } }, '☞');
    this.foldBtn = el<'button'>('button.ql-icon', { 'data-quest-fold': '', onclick: () => this.fold(!this.folded) }, '▾');
    this.cur = el('section.ql-cur');
    this.doneBtn = el<'button'>('button.ql-donebtn', { 'data-quest-donebtn': '', onclick: () => { this.doneOpen = !this.doneOpen; this.save(); this.refresh(); } });
    this.doneList = el('ol.ql-donelist');
    this.root = el('aside.qlog.cartouche', { 'data-screen': 'quests' }, [
      el('header.ql-head', {}, [
        el('div.ql-ribbon', {}, [this.nameEl, this.titlesEl]),
        el('div.ql-tools', {}, [this.guideBtn, this.foldBtn]),
        this.subEl,
      ]),
      el('div.ql-body', {}, [this.cur, el('div.ql-done', {}, [this.doneBtn, this.doneList]),
        el('button.ql-skip', { 'data-quest-skip': '', onclick: () => { if (window.confirm(t('quest.skip.confirm'))) { this.host.sim().skipTutorial(); this.refresh(); } } }, t('quest.skip'))]),
    ]);

    // The naming modal: CrierBelt's welcome, a name (a suggestion to start from), register or later.
    this.input = el('input.qn-input.lettering', {
      type: 'text', maxlength: String(COLONY_NAME_MAX), spellcheck: 'false', autocomplete: 'off',
      'data-quest-name-input': '', 'aria-label': t('quest.name.label'),
    }) as HTMLInputElement;
    this.err = el('div.qn-err');
    const txt = <E extends HTMLElement>(node: E, text: () => string): E => { this.modalText.push([node, text]); return node; };
    const reroll = el('button.qn-reroll', { type: 'button', onclick: () => this.reroll() }, '↻');
    const form = el('form.qn.cartouche', {
      onsubmit: (e: Event) => { e.preventDefault(); this.submitName(); },
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); this.closeNaming(); } },
    }, [
      txt(el('div.qn-from'), () => t('quest.name.from')),
      txt(el('h2.qn-title.lettering'), () => t('quest.name.title')),
      txt(el('p.qn-text'), () => t('quest.name.text')),
      el('label.qn-label', {}, [
        txt(el('span'), () => t('quest.name.label')),
        el('span.qn-row', {}, [this.input, reroll]),
      ]),
      this.err,
      el('div.qn-actions', {}, [
        txt(el('button.btn', { type: 'button', 'data-quest-name-later': '', onclick: () => this.closeNaming() }), () => t('quest.name.later')),
        txt(el('button.btn.primary', { type: 'submit', 'data-quest-name-ok': '' }), () => t('quest.name.ok')),
      ]),
    ]);
    this.modalText.push([reroll, () => '↻']);
    this.relabelModal = (): void => {
      for (const [node, text] of this.modalText) setText(node, text());
      setAttr(reroll, 'title', t('quest.name.reroll'));
      setAttr(this.input, 'aria-label', t('quest.name.label'));
    };
    this.relabelModal();
    this.modal = el('div.qn-veil', { 'data-screen': 'name', hidden: true }, [form]);
  }

  /** Is the naming modal up? (The guide stands aside meanwhile.) */
  get modalOpen(): boolean {
    return !this.modal.hasAttribute('hidden');
  }

  private readonly relabelModal: () => void;

  /** Open the naming modal (quest 0, renaming, `FL.nameModal`). */
  openNaming(): void {
    const sim = this.host.sim();
    this.relabelModal();
    if (this.suggestion < 0) this.suggestion = sim.playerSeed % NAMES.length;
    this.input.value = sim.colonyName || NAMES[this.suggestion]!;
    setText(this.err, '');
    setAttr(this.modal, 'hidden', null);
    this.input.focus();
    this.input.select();
  }

  closeNaming(): void {
    setAttr(this.modal, 'hidden', '');
    this.input.blur();
  }

  private reroll(): void {
    this.suggestion = (Math.max(0, this.suggestion) + 1) % NAMES.length;
    this.input.value = NAMES[this.suggestion]!;
    this.input.focus();
  }

  private submitName(): void {
    // The register's rules, as in the intro (D31): no sister claim's name, nothing reserved.
    const sim = this.host.sim();
    const v = nameVerdict(this.input.value, registerOf(sim).taken);
    if (!v.ok) { setText(this.err, refusalText(v, this.input.value)); return; }
    if (!sim.nameColony(v.name)) { setText(this.err, t('quest.name.bad', { n: COLONY_NAME_MAX })); return; }
    this.closeNaming();
    this.refresh();
  }

  private fold(v: boolean): void {
    this.folded = v;
    this.save();
    this.refresh();
  }

  private save(): void {
    prefs.save({ version: 1, folded: this.folded, doneOpen: this.doneOpen });
  }

  /** 4 Hz. */
  refresh(): void {
    const sim = this.host.sim();
    const st = sim.quests;
    // Gone once the tutorial is over (owner, 2026-10-13: "when the tutorial is finished, stop the
    // tutorial from appearing on the left"): skipped, or every objective met — after a short
    // moment for the last stamp (the completion toast says the rest).
    const over = st.skipped || (st.cur >= QUEST_IDS.length && sim.tick - (st.doneAt[st.doneAt.length - 1] ?? 0) > DONE_SHOW_TICKS);
    setAttr(this.root, 'hidden', over ? '' : null);
    if (over) return;
    const q = currentQuest(sim);
    this.sample(sim);
    // The modal: once, on an unnamed base, when nothing else is on screen.
    if (!st.named && !this.autoOpened && !automated() && !this.host.screenOpen() && !document.querySelector('[data-screen="boot"]')) {
      this.autoOpened = true;
      this.openNaming();
    }
    if (st.named && this.modalOpen && !this.input.matches(':focus')) this.closeNaming();

    // Under the HUD's left column (its research chips wrap): keep clear of it and of the build bar.
    const hud = document.querySelector('[data-screen="hud"] .hud-left') ?? document.querySelector('[data-screen="hud"]');
    const top = Math.round(hud ? hud.getBoundingClientRect().bottom + 8 : 104);
    setStyle(this.root, 'top', `${top}px`);
    setStyle(this.root, 'max-height', `${Math.max(120, window.innerHeight - top - 150)}px`);

    // Header.
    setText(this.nameEl, baseLabel(sim));
    setAttr(this.nameEl, 'title', t('quest.rename'));
    setAttr(this.nameEl, 'data-unnamed', st.named ? null : '');
    setText(this.subEl, q ? t('quest.count', { n: q.index + 1, total: QUEST_IDS.length }) : t('quest.partner'));
    setText(this.titlesEl, st.titles.map((id) => (QUEST_TITLES[id] ? L(QUEST_TITLES[id]!) : id)).join(' · '));
    setAttr(this.guideBtn, 'data-on', this.host.guide.enabled ? '' : null);
    setAttr(this.guideBtn, 'title', this.host.guide.enabled ? t('quest.guide.on') : t('quest.guide.off'));
    setText(this.foldBtn, this.folded ? '▸' : '▾');
    setAttr(this.foldBtn, 'title', this.folded ? t('quest.expand') : t('quest.collapse'));
    setAttr(this.root, 'data-folded', this.folded ? '' : null);

    // A quest just completed: the log stamps it.
    if (this.lastDone >= 0 && st.done.length > this.lastDone) {
      setAttr(this.root, 'data-flash', '');
      window.clearTimeout(this.flashTimer);
      this.flashTimer = window.setTimeout(() => setAttr(this.root, 'data-flash', null), 1400);
    }
    this.lastDone = st.done.length;

    // The current objective: rebuilt when the quest or the language changes.
    const sig = `${q?.id ?? '-'}|${locale()}`;
    if (sig !== this.sig) { this.sig = sig; this.buildCurrent(sim); }
    if (q) {
      const pr = questProgress(sim);
      q.def.objectives.forEach((o, i) => {
        const p = pr[i]!, row = this.rows[i];
        if (!row) return;
        setText(row.val, progressText(o, p));
        setAttr(row.node, 'data-met', p.met ? '' : null);
        setAttr(row.node, 'data-one', p.need === 1 ? '' : null);
        const frac = p.met ? 1 : p.need > 0 && !p.measuring ? Math.min(1, Math.max(0, p.have / p.need)) : 0;
        setStyle(row.bar, 'width', `${Math.round(frac * 100)}%`);
      });
      const step = this.host.step();
      if (this.hintEl) setText(this.hintEl, step && step.quest === q.id ? hintText(q.def, step.hint) : '');
      for (const lv of this.lives) lv.update(sim);
    }

    // Objectives already met.
    const doneSig = `${st.done.join(',')}|${locale()}|${this.doneOpen ? 1 : 0}`;
    if (doneSig !== this.doneSig) {
      this.doneSig = doneSig;
      setText(this.doneBtn, `${this.doneOpen ? '▾' : '▸'} ${t('quest.done', { n: st.done.length })}`);
      setAttr(this.doneBtn, 'hidden', st.done.length ? null : '');
      this.doneList.replaceChildren(...(this.doneOpen ? st.done.map((id) => {
        const def = questDef(id);
        return el('li.ql-doneitem', { 'data-quest-done': id }, [el('span.ql-tick', {}, '✓'), el('span', {}, def ? L(def.name) : id)]);
      }) : []));
    }
  }

  /** The current objective's block (its rows' values are written by `refresh`). */
  private buildCurrent(sim: Sim): void {
    const q = currentQuest(sim);
    this.rows = [];
    this.lives = [];
    this.hintEl = null;
    if (!q) {
      this.cur.replaceChildren(el('p.ql-all', {}, t('quest.all')));
      setAttr(this.cur, 'data-quest', null);
      return;
    }
    const def = q.def;
    setAttr(this.cur, 'data-quest', q.id);
    const objs: HTMLElement[] = [];
    def.objectives.forEach((o, i) => {
      if (i > 0 && def.any) objs.push(el('li.ql-or', {}, t('quest.or')));
      const val = el('span.ql-val'), bar = el('span.ql-fill');
      const node = el('li.ql-obj', { 'data-quest-obj': String(i) }, [
        el('span.ql-box'),
        el('span.ql-label', {}, objectiveLabel(o)),
        val,
        el('span.ql-track', {}, bar),
      ]);
      this.rows.push({ node, val, bar });
      objs.push(node);
    });
    this.hintEl = el('p.ql-hint');
    const parts: HTMLElement[] = [
      el('h3.ql-title.lettering', {}, [el('span.ql-num', {}, String(q.index + 1)), L(def.name)]),
      el('blockquote.ql-msg', {}, [el('span.ql-from', {}, t('quest.voice')), L(def.desc)]),
      el('ul.ql-objs', {}, objs),
      ...this.infoLines(sim, def),
      this.rewardRow(def.reward),
      this.hintEl,
    ];
    if (def.objectives.some((o) => o.k === 'name')) parts.push(el('button.btn.primary.ql-namebtn', { 'data-quest-name': '', onclick: () => this.openNaming() }, t('quest.name.button')));
    this.cur.replaceChildren(...parts);
  }

  /** The reward, as chips: items with their icons, ◉, a building's kit, waived fees, a title. */
  private rewardRow(r: QuestReward): HTMLElement {
    const chips: Array<HTMLElement> = [];
    // Few items: their names too; a Heart level's long list: icons and amounts (names on hover).
    const named = (r.items?.length ?? 0) <= 2 && !r.hearthLevel;
    const itemChip = (item: number, mu: number): HTMLElement =>
      el('span.ql-chip', { 'data-item': ITEM_IDS[item] }, [`${num(mu / 1000)}`, itemMention(item, { name: named })]);
    if (r.kit) {
      const b = (BUILDINGS as Record<string, BuildingDef>)[r.kit]!;
      chips.push(el('span.ql-chip.ql-kit', { title: rewardItems({ kit: r.kit }).map((c) => `${num(c.mu / 1000)} ${itemDef(c.item).name[locale()]}`).join(', ') },
        [buildingIcon(this.atlas, r.kit, 22), t('quest.reward.kit', { name: b.name[locale()] })]));
    }
    if (r.hearthLevel) {
      chips.push(el('span.ql-chip.ql-word', {}, t('quest.reward.hearth', { n: r.hearthLevel })));
      for (const [it, n] of BAL.hearthUpgrades[r.hearthLevel - 2]?.cost ?? []) chips.push(itemChip(itemIdx(it), n * 1000));
    }
    for (const [it, n] of r.items ?? []) chips.push(itemChip(itemIdx(it), n * 1000));
    if (r.credits) chips.push(el('span.ql-chip.ql-coin', {}, oc(r.credits * 100)));
    if (r.title) chips.push(el('span.ql-chip.ql-word', {}, t('quest.reward.title')));
    if (!chips.length) chips.push(el('span.ql-chip.ql-word', {}, t('quest.reward.none')));
    return el('div.ql-reward', {}, [el('span.ql-rlabel', {}, t('quest.reward')), ...chips]);
  }

  /** Live lines (content `info`): the vein's shortfall, the next delivery, the price. */
  private infoLines(sim: Sim, def: QuestDef): HTMLElement[] {
    const node = el('p.ql-info');
    const live = (update: (sim: Sim) => string): HTMLElement[] => {
      this.lives.push({ node, update: (s) => setText(node, update(s)) });
      setText(node, update(sim));
      return [node];
    };
    switch (def.info) {
      case 'vein': return live((s) => t('quest.info.vein', { need: num(wirePerElectronicsWorkshop()), have: num(this.ratePerMin(s, 'copper_wire')), item: itemRef('copper_wire') }));
      case 'delivery': {
        const o = def.objectives.find((x) => x.k === 'import');
        const items = o && o.k === 'import' ? o.items.map((i) => itemIdx(i)) : [];
        return live((s) => {
          let next = Infinity;
          for (const sh of s.trade.inflight) if (items.includes(sh.item)) next = Math.min(next, sh.arrive);
          return Number.isFinite(next) ? t('quest.info.delivery', { d: duration(secondsTo(s, next)) }) : t('quest.info.noDelivery');
        });
      }
      case 'shortage': {
        const o = def.objectives.find((x) => x.k === 'export');
        const it = o && o.k === 'export' ? itemIdx(o.items[0]!) : itemIdx('glass');
        return live((s) => t('quest.info.price', { item: itemRef(it), bid: oc(s.prices.bid[it] ?? 0) }));
      }
      default: return [];
    }
  }

  /** Once a game second: the produced counters, for the live rates (last minute). */
  private sample(sim: Sim): void {
    const last = this.samples[this.samples.length - 1];
    if (last && last.tick > sim.tick) this.samples = []; // another base was loaded
    if (last && sim.tick - last.tick < TPS) return;
    this.samples.push({ tick: sim.tick, produced: Float64Array.from(sim.produced) });
    while (this.samples.length > 2 && sim.tick - this.samples[1]!.tick >= EPOCH) this.samples.shift();
  }

  /** Items of a kind made per minute, over the last minute or so. */
  private ratePerMin(sim: Sim, item: string): number {
    const a = this.samples[0];
    const i = itemIdx(item);
    if (!a || sim.tick <= a.tick) return 0;
    return Math.round(((sim.produced[i]! - a.produced[i]!) / 1000) * (EPOCH / (sim.tick - a.tick)) * 10) / 10;
  }
}
