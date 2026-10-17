// build-bar.ts — the construction bar at the bottom: the category tabs and, once one is opened,
// its tray of buildings (icons from the plan atlas, digit hotkeys, costs) with the demolish tool
// and the way back to the view. Opening a tab switches to the plan view; the hint line under it
// explains the current tool. It shows only while building (D88, hud.css: « Construire », B or a
// digit opens the last category, Shift+digit the n-th); while it is closed, what a tray holds new
// is a dot on « Construire » (`hasNew`).
//
// Only what is unlocked is shown (owner, D27): a building enters its tray once its plan or its
// research is unlocked in the tech tree (D33), never greyed out before, and a category with
// nothing unlocked has no tab. The hotkeys
// follow what is shown (Shift+n: the n-th visible tab; 1…0: the visible slots). A building that
// unlocks raises a « Nouveau » notice and is tagged (tab badge, slot tag) until its tray is seen.
import type { BuildCategory, BuildingDef } from '@/content/types';
import { BUILDING_IDS, buildingDef, buildingIdx, costOf, isBeltDef } from '@/content/registry';
import { el, setAttr, setText } from '@/core/dom';
import type { NotifyKind } from '@/core/kinds';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import { pipetteCap } from './keycap';
import { CAMO_VENT_KEY, beltKey, btKey, frameCanvas, iKey, type Atlas } from '@/render/art/atlas';
import { BELT_TIERS } from '@/render/art/recipes/belts';
import { TOP_MARGIN, TOP_PX } from '@/render/art/recipes/buildings-top';
import { C } from '@/render/art/tokens';
import { ITEM_IDS } from '@/content/registry';
import type { Sim } from '@/sim/state';
import { revealed } from '@/sim/systems/quests';

export const CATEGORIES: readonly BuildCategory[] = ['extraction', 'logistics', 'distribution', 'production', 'research', 'energy', 'colony', 'commerce'];

/** Buildings offered in a category's tray, in content order (the Hearth is never built). */
export function trayOf(cat: BuildCategory): string[] {
  return BUILDING_IDS.filter((id) => {
    const b = buildingDef(buildingIdx(id)) as BuildingDef;
    return b.category === cat && b.kind !== 'hearth';
  });
}

const defOf = (id: string): BuildingDef => buildingDef(buildingIdx(id)) as BuildingDef;

/** What a tray shows: the category's buildings already unlocked (a locked one is not shown at all). */
export function unlockedTray(sim: Sim, cat: BuildCategory): string[] {
  return trayOf(cat).filter((id) => sim.unlocked(defOf(id).unlock));
}

/**
 * The tabs shown, in bar order: the categories with something unlocked (Shift+1… follow this
 * list). The tutorial only gates the bar as a whole (the `build` reveal, D32): past that, a tab
 * appears the moment a plan or a research unlocks one of its buildings (D27, D33).
 */
export function shownCategories(sim: Sim): BuildCategory[] {
  const rv = revealed(sim);
  if (rv && !rv.has('build')) return [];
  return CATEGORIES.filter((c) => unlockedTray(sim, c).length > 0);
}

/** Building names as one list in the current language (« A, B et C »). */
function nameList(ids: readonly string[]): string {
  const L = locale();
  return new Intl.ListFormat(L, { type: 'conjunction' }).format(ids.map((id) => defOf(id).name[L]));
}

export interface BuildBarHost {
  sim(): Sim;
  /** The open category (null = closed, iso view). */
  category(): BuildCategory | null;
  openCategory(cat: BuildCategory | null): void;
  /** Building id in hand (null = none). */
  current(): string | null;
  demolishing(): boolean;
  marking(): boolean;
  pick(def: string): void;
  demolish(): void;
  mark(): void;
  hint(): MsgKey;
  /** A short notice (a building just unlocked). */
  notify?(kind: NotifyKind, text: string): void;
  /** The Link tool (power wires, D25): take / put away, and whether it is in hand (the Énergie tray's « Relier »). */
  link?(): void;
  linking?(): boolean;
  /** Turn the building in hand (R; D96: the « Tourner » button, shown on touch screens, where there is no R). */
  rotate?(): void;
}

/** The Link tool's icon: two pillar heads and the wire sagging between them, inked. */
function linkIcon(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(size);
  const g = c.getContext('2d')!;
  const s = c.width / 54;
  g.lineCap = 'round';
  g.strokeStyle = C.ink;
  g.lineWidth = 3.2 * s;
  g.beginPath();
  g.moveTo(12 * s, 46 * s); g.lineTo(12 * s, 16 * s);
  g.moveTo(42 * s, 46 * s); g.lineTo(42 * s, 20 * s);
  g.stroke();
  g.lineWidth = 2.4 * s;
  g.beginPath();
  g.moveTo(12 * s, 17 * s); g.quadraticCurveTo(27 * s, 36 * s, 42 * s, 21 * s);
  g.stroke();
  g.strokeStyle = C.ice;
  g.lineWidth = 0.9 * s;
  g.beginPath();
  g.moveTo(12 * s, 16 * s); g.quadraticCurveTo(27 * s, 35 * s, 42 * s, 20 * s);
  g.stroke();
  for (const [x, y] of [[12, 15], [42, 19]] as const) {
    g.fillStyle = C.cyan; g.strokeStyle = C.ink; g.lineWidth = 1.6 * s;
    g.beginPath(); g.arc(x * s, y * s, 4.2 * s, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  return c;
}

/** An item glyph as a small canvas. */
export function itemIcon(atlas: Atlas, item: number, size: number): HTMLCanvasElement | null {
  const f = atlas.frames.get(iKey(ITEM_IDS[item]!));
  return f ? frameCanvas(atlas, iKey(ITEM_IDS[item]!), size / f.w) : null;
}

/** A plan-view icon of a building fitted in a box of `size` px; `lv`: its look at a level (the Heart's, D86), if it has one. */
export function buildingIcon(atlas: Atlas, def: string, size: number, lv = 1): HTMLCanvasElement | null {
  if (isBeltDef(def)) return beltIcon(atlas, def, size);
  const key = atlas.frames.has(btKey(def, 0, lv)) ? btKey(def, 0, lv) : btKey(def, 0);
  const f = atlas.frames.get(key);
  if (!f) return null;
  return frameCanvas(atlas, key, size / Math.max(f.w, f.h));
}

/**
 * Ribbons and conduits have no plan frame (they are baked as belt pieces): their straight piece,
 * upright, one tile wide at the scale of a 1×1 plan frame (so it sits with the router and the
 * junction), repeated down the icon's height — the piece is seamless — so it reads as a line. The
 * camouflaged ribbon (D109), sand on the cream card, lies on a strip of dune ground, its vent tile in
 * the middle, so its icon reads as a trail in the sand.
 */
function beltIcon(atlas: Atlas, def: string, size: number): HTMLCanvasElement | null {
  const key = beltKey(def in BELT_TIERS ? def : 'ribbon', false);
  const f = atlas.frames.get(key);
  if (!f) return null;
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(size);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const s = (TOP_PX * c.width) / (TOP_PX + 2 * TOP_MARGIN); // a tile, as a 1×1 building's frame shows it
  const x = (c.width - s) / 2;
  const camo = !!buildingDef(buildingIdx(def)).camo;
  if (camo) { ctx.fillStyle = C.dune; ctx.globalAlpha = 0.75; ctx.fillRect(x + s * 0.06, 0, s * 0.88, c.height); ctx.globalAlpha = 1; }
  const vent = camo ? atlas.frames.get(CAMO_VENT_KEY) : undefined;
  for (let y = (c.height - s) / 2 - s; y < c.height; y += s) {
    const g = vent && Math.abs(y - (c.height - s) / 2) < 1 ? vent : f;
    ctx.drawImage(atlas.pages[g.page]!, g.x, g.y, g.w, g.h, x, y, s, s);
  }
  return c;
}

export class BuildBar {
  readonly root: HTMLElement;
  private readonly tabs = new Map<BuildCategory, { node: HTMLButtonElement; key: HTMLElement }>();
  private readonly tray: HTMLElement;
  private readonly hintEl: HTMLElement;
  private slots: Array<{ def: string; node: HTMLButtonElement; chips: Array<{ item: number; mu: number; node: HTMLElement }> }> = [];
  /** What the tray was built for (category, language, unlocked set); it is rebuilt when that changes. */
  private traySig = '';
  private readonly demolishBtn: HTMLButtonElement;
  private readonly markBtn: HTMLButtonElement;
  /** « Tourner » (D96): R for a finger, while a building or a ribbon is in hand (responsive.css shows it on touch screens only). */
  private readonly rotateBtn: HTMLButtonElement;
  private readonly backBtn: HTMLButtonElement;
  /** The Énergie tray's « Relier » tool slot (null while another tray is open). */
  private linkBtn: HTMLButtonElement | null = null;
  /** Labels built once and re-set on refresh, so they follow a language switch. */
  private readonly labels: Array<[HTMLElement, MsgKey]> = [];
  // ── what is unlocked ──
  /** The categories that have a tab, in bar order (Shift+1… follow it). */
  private shown: BuildCategory[] = [...CATEGORIES];
  /** The unlocked buildings per category, as a string: a change re-derives tabs and tray. */
  private unlockSig = '';
  /** Buildings seen unlocked; null until the first look (the starting set raises no notice). */
  private known: Set<string> | null = null;
  /** The colony `known` belongs to (a swapped colony starts a new baseline). */
  private knownSim: Sim | null = null;
  /** Unlocked since, not yet seen in their tray: a badge on the tab, a tag on the slot. */
  private readonly fresh = new Set<string>();
  /** The category whose tray is open: its new buildings count as seen once it closes. */
  private seenCat: BuildCategory | null = null;

  constructor(private readonly atlas: Atlas, private readonly host: BuildBarHost) {
    const tabRow = el('div.bb-tabs');
    for (const cat of CATEGORIES) {
      const key = el('span.bb-key');
      const node = el<'button'>('button.bb-tab', { 'data-cat': cat, onclick: () => host.openCategory(host.category() === cat ? null : cat) }, [
        key,
        this.label(el('span.bb-label.lettering'), `build.cat.${cat}` as MsgKey),
      ]);
      this.tabs.set(cat, { node, key });
      tabRow.append(node);
    }
    this.demolishBtn = el<'button'>('button.bb-tab.bb-demolish', { onclick: () => host.demolish() }, [el('span.bb-key', {}, 'X'), this.label(el('span.bb-label.lettering'), 'build.demolish')]);
    this.markBtn = el<'button'>('button.bb-tab.bb-demolish.bb-mark', { onclick: () => host.mark() }, [el('span.bb-key', {}, 'C'), this.label(el('span.bb-label.lettering'), 'build.mark')]);
    this.backBtn = el<'button'>('button.bb-tab.bb-back', { onclick: () => host.openCategory(null) }, [el('span.bb-key', {}, 'B'), this.label(el('span.bb-label.lettering'), 'view.toIso')]);
    this.rotateBtn = el<'button'>('button.bb-tab.bb-rotate', { type: 'button', hidden: true, onclick: () => host.rotate?.() }, [el('span.bb-key', {}, 'R'), el('span.bb-turn', { 'aria-hidden': 'true' }, '⟳'), this.label(el('span.bb-label.lettering'), 'build.rotate')]);
    tabRow.append(this.rotateBtn, this.markBtn, this.demolishBtn, this.backBtn);
    this.tray = el('div.bb-tray');
    this.hintEl = el('div.bb-hint');
    this.root = el('section.buildbar', { 'data-screen': 'buildbar' }, [this.tray, tabRow, this.hintEl]);
    for (const [node, k] of this.labels) setText(node, t(k));
  }

  private label<E extends HTMLElement>(node: E, key: MsgKey): E {
    this.labels.push([node, key]);
    return node;
  }

  /** Re-derive what is shown when the unlocked set changes, and notice what just unlocked. */
  private syncUnlocks(sim: Sim): void {
    if (sim !== this.knownSim) { this.knownSim = sim; this.known = null; this.fresh.clear(); this.unlockSig = ''; }
    const trays = CATEGORIES.map((c) => unlockedTray(sim, c));
    const sig = trays.map((ids) => ids.join(',')).join('|');
    if (sig === this.unlockSig) return;
    this.unlockSig = sig;
    const now = new Set(trays.flat());
    if (this.known) {
      const added = [...now].filter((id) => !this.known!.has(id));
      for (const id of added) this.fresh.add(id);
      if (added.length) this.host.notify?.('good', t('build.new', { name: nameList(added) }));
    }
    for (const id of [...this.fresh]) if (!now.has(id)) this.fresh.delete(id); // locked again (reconversion)
    this.known = now;
    this.shown = CATEGORIES.filter((_, i) => trays[i]!.length > 0);
  }

  /** Does a category hold a building unlocked but not yet seen? */
  private hasFresh(cat: BuildCategory): boolean {
    for (const id of this.fresh) if (defOf(id).category === cat) return true;
    return false;
  }

  /** The open category's tray: one slot per unlocked building, numbered 1…9, 0 in order. */
  private fillTray(cat: BuildCategory | null, sim: Sim): void {
    this.tray.replaceChildren();
    this.slots = [];
    this.linkBtn = null;
    if (!cat) return;
    const L = locale();
    unlockedTray(sim, cat).forEach((def, i) => {
      const b = defOf(def);
      const chips = costOf(buildingIdx(def)).map((c) => ({
        item: c.item, mu: c.mu,
        node: el('span.bb-chip', {}, [itemIcon(this.atlas, c.item, 14), String(Math.round(c.mu / 1000))]),
      }));
      // `data-def` carries the building (the hover card finds slots by it); no native `title`,
      // which would double that card.
      const node = el('button.bb-slot', {
        'data-def': def,
        onclick: () => { this.fresh.delete(def); this.host.pick(def); },
        onpointerenter: () => this.fresh.delete(def),
      }, [
        buildingIcon(this.atlas, def, 54),
        el('span.bb-key', {}, i < 10 ? String((i + 1) % 10) : ''),
        el('span.bb-new', {}, t('build.newTag')),
        el('span.bb-name', {}, b.name[L]),
        el('span.bb-cost', {}, chips.map((c) => c.node)),
      ]) as HTMLButtonElement;
      this.slots.push({ def, node, chips });
      this.tray.append(node);
    });
    // The Énergie tray ends with the Link tool: wires from the pillars and the Heart (L).
    if (cat === 'energy' && this.host.link) {
      const link = this.host.link;
      this.linkBtn = el<'button'>('button.bb-slot.bb-tool', { 'data-tool': 'link', onclick: () => link() }, [
        linkIcon(54),
        el('span.bb-key', {}, 'L'),
        el('span.bb-name', {}, t('build.link')),
      ]);
      this.tray.append(this.linkBtn);
    }
  }

  /** 4 Hz: what is unlocked, the tabs and the open tray, affordability, the tool in hand. */
  refresh(): void {
    const sim = this.host.sim();
    this.syncUnlocks(sim);
    this.shown = shownCategories(sim); // the tutorial reveals tabs as it goes (cheap: seven categories)
    const cat = this.host.category();
    if (cat !== this.seenCat) {
      // The tray that just closed has been seen: its new buildings lose their tag.
      if (this.seenCat) for (const id of [...this.fresh]) if (defOf(id).category === this.seenCat) this.fresh.delete(id);
      this.seenCat = cat;
    }
    const sig = cat ? `${cat}|${locale()}|${this.unlockSig}` : '';
    if (sig !== this.traySig) { this.traySig = sig; this.fillTray(cat, sim); }
    for (const [node, k] of this.labels) setText(node, t(k));
    setAttr(this.root, 'data-open', cat ? '' : null);
    for (const [c, tab] of this.tabs) {
      const i = this.shown.indexOf(c);
      setAttr(tab.node, 'hidden', i < 0 ? '' : null);
      setText(tab.key, i < 0 ? '' : `⇧${i + 1}`);
      setAttr(tab.node, 'data-on', c === cat ? '' : null);
      setAttr(tab.node, 'data-new', c !== cat && this.hasFresh(c) ? '' : null);
    }
    setAttr(this.demolishBtn, 'data-on', this.host.demolishing() ? '' : null);
    setAttr(this.markBtn, 'data-on', this.host.marking() ? '' : null);
    setAttr(this.rotateBtn, 'hidden', this.host.rotate && this.host.current() ? null : '');
    const rv = revealed(sim);
    setAttr(this.markBtn, 'hidden', rv && !rv.has('brush') ? '' : null);
    if (this.linkBtn) setAttr(this.linkBtn, 'data-on', this.host.linking?.() ? '' : null);
    const cur = this.host.current();
    for (const s of this.slots) {
      const afford = costOf(buildingIdx(s.def)).every((c) => sim.stock[c.item]! >= c.mu);
      setAttr(s.node, 'data-poor', afford ? null : '');
      setAttr(s.node, 'data-on', s.def === cur ? '' : null);
      setAttr(s.node, 'data-new', this.fresh.has(s.def) ? '' : null);
      for (const c of s.chips) setAttr(c.node, 'data-poor', sim.stock[c.item]! < c.mu ? '' : null);
    }
    // The pipette's key as this keyboard prints it (keycap.ts), not as the language guesses.
    setText(this.hintEl, cat ? tr(this.host.hint(), { pip: pipetteCap() }) : '');
  }

  /** Does any tray hold a building unlocked but not seen yet (a dot on « Construire » while building is closed, D88)? */
  hasNew(): boolean {
    for (const c of this.shown) if (this.hasFresh(c)) return true;
    return false;
  }

  /** The building in slot i (0..9) of the open tray. */
  slotDef(i: number): string | null {
    return this.slots[i]?.def ?? null;
  }

  /** The category of the i-th tab shown (Shift + digit i+1); null past the last. */
  categoryAt(i: number): BuildCategory | null {
    return shownCategories(this.host.sim())[i] ?? null;
  }
}
