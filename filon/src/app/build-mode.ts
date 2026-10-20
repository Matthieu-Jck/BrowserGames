// build-mode.ts — construction. The open category of the build bar (null = not building: iso
// view), the tool in hand (a building, a ribbon, demolition, the landscaping brush), the digit
// row's slots, the bar's hint line, and the toasts answering a tool's result. Opening a
// category morphs the board to the plan view; closing it stands the colony back up in iso.
// The Link tool (power wires, D25) works in either view: taking it puts the tool in hand away,
// and taking any other tool puts it away. The land mode (D60, I or the HUD's « Terrain »: look at
// the parcels, buy or lease one) is a mode of its own: it puts every tool away and turns the
// board to the plan view (zoomed out to see a few parcels), and taking any tool or opening a
// category ends it; ending it stands the colony back up in iso unless a category is open.
// Blueprints (D154): the copy tool (Ctrl/⌘+C; with a building inspected, that building copied),
// the paste (Ctrl/⌘+V: the clipboard in hand; R turns it, M mirrors it when it can), the upgrade
// tool (N, once a faster ribbon is learnt), the library's panel (K), and Ctrl/⌘+Z, the last step
// taken back — each a toast saying what it did.
import { BAL } from '@/content/balance';
import { BUILDING_KIND, buildingDef, buildingIdx, itemDef } from '@/content/registry';
import type { BuildCategory, BuildingDef } from '@/content/types';
import { bus } from '@/core/bus';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import { nodeName } from '@/content/research';
import { originFor, type ToolResult, type Tools } from '@/input/tools';
import type { LinkTool, LinkToolResult } from '@/input/link-tool';
import type { LandTool } from '@/input/land-tool';
import type { Sim } from '@/sim/state';
import type { Rot } from '@/sim/types';
import { footprint } from '@/sim/entities';
import { upgradeOpen, type Blueprint } from '@/sim/systems/blueprint';
import { num } from '@/i18n/format';
import type { BuildBar } from '@/ui/build-bar';
import { modCap } from '@/ui/mod-key';
import type { Toasts } from '@/ui/toasts';
import type { ViewState } from './view';

export interface BuildModeDeps {
  sim(): Sim;
  tools: Tools;
  view: ViewState;
  bar(): BuildBar;
  toasts: Toasts;
  /** Drop the inspected entity (taking a tool in hand closes the inspector). */
  deselect(): void;
  /** The Link tool (D25), and showing the pillar it starts from in the inspector. */
  link: LinkTool;
  select(id: number): void;
  /** The land mode (D60). */
  land: LandTool;
  /** The camera's zoom, read and glided to (the land mode zooms out to show a few parcels). */
  zoom?: { get(): number; glide(z: number): void };
  /** The blueprints' library panel (D154): shown, and toggled. */
  library?: { open(): boolean; toggle(on?: boolean): void };
  /** The entity inspected (0: none): Ctrl/⌘+C copies it. */
  selected?(): number;
}

/** The land mode's zoom at most: a parcel about 180 px on screen in plan (TOP 32 px a tile), several in view. */
const LAND_ZOOM = 0.36;

export class BuildMode {
  /** The open construction category (null: not building, iso view). */
  category: BuildCategory | null = null;
  private last: BuildCategory = 'extraction';
  /** The zoom before the land mode zoomed out (given back when it ends), or null. */
  private landZoom: number | null = null;

  constructor(private readonly d: BuildModeDeps) {}

  /** Open a construction category (plan view), or close building (null: back to iso). */
  open(cat: BuildCategory | null): void {
    this.endLand();
    // A category's tab while a blueprint tool is in hand (D154): its tray comes back, the tool goes.
    const k = this.d.tools.state?.k;
    if (cat && cat !== this.category && (k === 'copy' || k === 'paste' || k === 'upgrade')) this.d.tools.state = null;
    this.category = cat;
    if (cat) this.last = cat;
    else { this.d.tools.state = null; this.d.link.stop(); }
    this.d.view.setMode(cat ? 'plan' : 'iso');
    this.d.bar().refresh();
  }

  toggle(): void {
    this.open(this.category ? null : this.last);
  }

  /** Take a building in hand (opens its category); refused with a toast while locked. */
  pick(def: string, rot?: Rot): void {
    const b = buildingDef(buildingIdx(def)) as BuildingDef;
    if (!this.d.sim().unlocked(b.unlock)) { this.d.toasts.show('warn', t('build.locked', { res: nodeName(b.unlock)[locale()] })); return; }
    this.d.link.stop();
    this.endLand();
    if (this.category !== b.category) this.open(b.category);
    this.d.tools.select(def, rot);
    this.d.deselect();
  }

  /** The demolition tool (toggles). */
  demolish(): void {
    if (this.d.tools.state?.k === 'remove') { this.d.tools.state = null; return; }
    this.d.link.stop();
    this.endLand();
    if (!this.category) this.open(this.last);
    this.d.tools.demolish();
  }

  /** Ready to place something: tools in hand need the plan view — a category open (the last one), the Link tool and the land mode put away. */
  private ready(): void {
    this.d.link.stop();
    this.endLand();
    if (!this.category) this.open(this.last);
  }

  /**
   * Ctrl/⌘+C (D154): the building inspected, copied at once (its blueprint in hand); else the copy
   * tool, toggled — a box dragged over what to copy.
   */
  copy(): void {
    const sel = this.d.selected?.() ?? 0, sim = this.d.sim(), e = sel ? sim.ents.get(sel) : undefined;
    if (e && sel !== sim.hearthId) {
      const [w, h] = footprint(e.def, e.rot);
      const bp = sim.capture(e.x, e.y, e.x + w - 1, e.y + h - 1);
      if (bp) { this.d.tools.clipboard = bp; this.ready(); this.d.tools.paste(bp); this.d.deselect(); this.report({ copied: bp.pieces.length }); return; }
    }
    if (this.d.tools.state?.k === 'copy') { this.d.tools.state = null; return; }
    this.ready();
    this.d.tools.copy();
    this.d.deselect();
  }

  /** Ctrl/⌘+V, or « Poser » in the library: a blueprint in hand (the clipboard by default). */
  paste(bp?: Blueprint): void {
    const b = bp ?? this.d.tools.clipboard;
    if (!b) { this.d.toasts.show('info', t('bp.toast.noCopy', { mod: modCap() })); return; }
    this.ready();
    this.d.tools.paste(b);
    this.d.deselect();
  }

  /** N (D154): the upgrade tool, toggled — once a faster ribbon is learnt (else a toast says which). */
  upgrade(): void {
    if (this.d.tools.state?.k === 'upgrade') { this.d.tools.state = null; return; }
    if (!upgradeOpen(this.d.sim())) { this.d.toasts.show('info', t('bp.toast.noTier', { res: nodeName('xp_swift')[locale()] })); return; }
    this.ready();
    this.d.tools.upgrade();
    this.d.deselect();
  }

  /** M with a blueprint in hand (D154): mirrored, or a toast naming the building that has no mirror twin. True when a blueprint was in hand. */
  mirror(): boolean {
    if (this.d.tools.state?.k !== 'paste') return false;
    const stop = this.d.tools.mirror();
    if (stop) this.d.toasts.show('warn', t('bp.toast.noMirror', { name: buildingDef(buildingIdx(stop)).name[locale()] }));
    return true;
  }

  /** Ctrl/⌘+Z (D154): the last step taken back, and what it did. */
  undo(): void {
    const r = this.d.tools.undoLast();
    const toasts = this.d.toasts;
    if (!r) { toasts.show('info', t('bp.toast.noUndo')); return; }
    toasts.show(r.failed ? 'warn' : 'info', tr('bp.toast.undo', { n: r.removed + r.restored }) + (r.failed ? ` · ${tr('bp.toast.undoFailed', { n: r.failed })}` : ''));
    bus.emit('sfx', { cue: r.removed ? 'demolish' : 'place', n: Math.max(1, r.removed + r.restored) });
  }

  /** K (D154): the library's panel, toggled (the land mode put away). */
  library(): void {
    const lib = this.d.library;
    if (!lib) return;
    if (!lib.open()) { this.endLand(); this.d.deselect(); }
    lib.toggle();
  }

  /** The landscaping brush: dig / fill marks (toggles). */
  mark(): void {
    if (this.d.tools.state?.k === 'mark') { this.d.tools.state = null; return; }
    this.d.link.stop();
    this.endLand();
    if (!this.category) this.open(this.last);
    this.d.tools.mark();
  }

  /**
   * The Link tool (L, the Énergie tray, the inspector's « Relier »): toggles; with a source — a
   * pillar or the Heart — it starts from it (shown in the inspector). Either view.
   */
  link(source = 0): void {
    const l = this.d.link;
    if (l.active && !source) { l.stop(); return; }
    this.d.tools.state = null;
    if (this.d.land.active) { this.endLand(); if (!this.category) this.d.view.setMode('iso'); }
    l.start(source);
    if (l.source) this.d.select(l.source);
  }

  /**
   * The land mode (I, the HUD's « Terrain »): toggles, or `on` sets it. On: every tool put away,
   * the selection dropped, the plan view, zoomed out to show a few parcels. Off: the zoom given
   * back, and the iso view unless a category is open.
   */
  land(on = !this.d.land.active): void {
    if (on === this.d.land.active) return;
    if (on) {
      this.d.tools.state = null;
      this.d.link.stop();
      this.d.deselect();
      this.d.land.start();
      this.d.view.setMode('plan');
      const z = this.d.zoom?.get() ?? 0;
      if (this.d.zoom && z > LAND_ZOOM) { this.landZoom = z; this.d.zoom.glide(LAND_ZOOM); }
    } else {
      this.endLand();
      if (!this.category) this.d.view.setMode('iso');
    }
    this.d.bar().refresh();
  }

  /** Esc / right click in the land mode: the picked parcel first, then the mode. True if something went. */
  landCancel(): boolean {
    const l = this.d.land;
    if (!l.active) return false;
    if (l.selected >= 0) { l.selected = -1; return true; }
    this.land(false);
    return true;
  }

  /** End the land mode without touching the view (another tool or a category takes over); the zoom given back. */
  private endLand(): void {
    if (!this.d.land.active) return;
    this.d.land.stop();
    if (this.landZoom !== null && this.d.zoom) this.d.zoom.glide(this.landZoom);
    this.landZoom = null;
  }

  /** What a click of the Link tool did: a refusal's reason as a toast; a new source in the inspector. */
  reportLink(r: LinkToolResult): void {
    if (r.refused) this.d.toasts.show('bad', t(`link.reason.${r.refused}` as MsgKey));
    // Wired to a sleeping building: why its wire is dashed (its land, or its research given back).
    if (r.asleep) this.d.toasts.show('info', t(r.asleep === 'land' ? 'link.asleep.land' : 'link.asleep.research'));
    if (r.picked) this.d.select(r.picked);
    // Sound (app/sound.ts): a wire strung or cut, or the refusal.
    if (r.linked) bus.emit('sfx', { cue: 'link' });
    else if (r.unlinked) bus.emit('sfx', { cue: 'unlink' });
    else if (r.refused) bus.emit('sfx', { cue: 'refused' });
  }

  /** Digit row: a slot of the open tray (Shift: a category — the n-th tab shown, D27). */
  slot(slot: number, shift: boolean): void {
    if (shift) { const c = this.d.bar().categoryAt(slot); if (c) this.open(c); return; }
    if (!this.category) this.open(this.last);
    const def = this.d.bar().slotDef(slot);
    if (def) this.pick(def);
  }

  /** The bar's hint line for the tool in hand. */
  hint(): MsgKey {
    if (this.d.link.active) return this.d.link.source ? 'build.hint.linkFrom' : 'build.hint.link';
    const k = this.d.tools.state?.k;
    if (k === 'copy' || k === 'paste' || k === 'upgrade') return `build.hint.${k}`;
    return k === 'build' ? 'build.hint.build' : k === 'belt' ? 'build.hint.belt' : k === 'remove' ? 'build.hint.remove' : k === 'mark' ? 'build.hint.mark' : 'build.hint.none';
  }

  /** Toasts for what a tool did (or why it refused). */
  report(r: ToolResult): void {
    const toasts = this.d.toasts;
    // Off the claim's land (D60): the way to it, the land mode's key, after the reason.
    const land = r.refused === 'outside_zone' || r.refused === 'neighbour_land' ? ` · ${t('land.keyHint')}` : '';
    if (r.refused && !r.short) toasts.show('bad', t('toast.refused', { why: t(`reason.${r.refused}` as MsgKey) }) + land);
    // A drag laid in part: the tiles it left out, and why (D77: a step wants a traction ribbon).
    if (r.left) toasts.show('bad', tr('toast.left', { n: r.left.n, why: t(`reason.${r.left.reason}` as MsgKey) }));
    if (r.removed) toasts.show('info', tr('toast.removed', { n: r.removed }));
    if (r.marked) toasts.show('info', tr('toast.marked', { n: r.marked }));
    if (r.cleared) toasts.show('info', tr('toast.cleared', { n: r.cleared }));
    // Blueprints (D154): a copy in hand, an empty box, what a paste or an upgrade lacks, ribbons lifted.
    if (r.copied) toasts.show('good', tr('bp.toast.copied', { n: r.copied }));
    if (r.empty) toasts.show('info', t('bp.toast.empty'));
    if (r.short) toasts.show('bad', t('bp.toast.short', { what: [...r.short].sort((a, b) => a[0] - b[0]).map(([it, mu]) => `${num(Math.ceil(mu / 1000))} ${itemDef(it).name[locale()]}`).join(', ') }));
    if (r.upgraded) toasts.show('info', tr('bp.toast.upgraded', { n: r.upgraded }));
    if (r.skipped) toasts.show('bad', tr('bp.toast.skipped', { n: r.skipped.n, why: t(`reason.${r.skipped.reason}` as MsgKey) }));
    // Sound (app/sound.ts): one cue for what the tool did — a ribbon drag ticks once per tile laid.
    if (r.placed || r.upgraded) bus.emit('sfx', { cue: this.d.tools.state?.k === 'belt' || r.upgraded ? 'ribbon' : 'place', n: r.placed ?? r.upgraded });
    else if (r.copied) bus.emit('sfx', { cue: 'select' });
    else if (r.removed) bus.emit('sfx', { cue: 'demolish', n: r.removed });
    else if (r.marked || r.cleared) bus.emit('sfx', { cue: 'mark' });
    else if (r.refused) bus.emit('sfx', { cue: 'refused' });
  }

  /** Reach circle [cx, cy, r] (tiles) of an excavator / backfiller held in hand, or null. */
  ghostReach(): [number, number, number] | null {
    const held = this.d.tools.def, hv = this.d.tools.hover;
    if (!held || !hv || !this.d.view.building) return null;
    const k = BUILDING_KIND[buildingIdx(held)];
    if (k !== 'excavator' && k !== 'backfiller') return null;
    const st = this.d.tools.state as { rot: Rot };
    const [ox, oy] = originFor(held, st.rot, hv[0], hv[1]);
    const b = buildingDef(buildingIdx(held));
    // An excavator reaches from its footprint's edge (D54): the ring adds half its size.
    return [ox + b.w / 2, oy + b.h / 2, k === 'excavator' ? BAL.digReach + Math.max(b.w, b.h) / 2 : BAL.fillReach];
  }
}
