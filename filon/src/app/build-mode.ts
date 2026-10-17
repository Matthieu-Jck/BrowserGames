// build-mode.ts — construction. The open category of the build bar (null = not building: iso
// view), the tool in hand (a building, a ribbon, demolition, the landscaping brush), the digit
// row's slots, the bar's hint line, and the toasts answering a tool's result. Opening a
// category morphs the board to the plan view; closing it stands the colony back up in iso.
// The Link tool (power wires, D25) works in either view: taking it puts the tool in hand away,
// and taking any other tool puts it away. The land mode (D60, I or the HUD's « Terrain »: look at
// the parcels, buy or lease one) is a mode of its own: it puts every tool away and turns the
// board to the plan view (zoomed out to see a few parcels), and taking any tool or opening a
// category ends it; ending it stands the colony back up in iso unless a category is open.
import { BAL } from '@/content/balance';
import { BUILDING_KIND, buildingDef, buildingIdx } from '@/content/registry';
import type { BuildCategory, BuildingDef } from '@/content/types';
import { bus } from '@/core/bus';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import { nodeName } from '@/content/research';
import { originFor, type ToolResult, type Tools } from '@/input/tools';
import type { LinkTool, LinkToolResult } from '@/input/link-tool';
import type { LandTool } from '@/input/land-tool';
import type { Sim } from '@/sim/state';
import type { Rot } from '@/sim/types';
import type { BuildBar } from '@/ui/build-bar';
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
    return k === 'build' ? 'build.hint.build' : k === 'belt' ? 'build.hint.belt' : k === 'remove' ? 'build.hint.remove' : k === 'mark' ? 'build.hint.mark' : 'build.hint.none';
  }

  /** Toasts for what a tool did (or why it refused). */
  report(r: ToolResult): void {
    const toasts = this.d.toasts;
    // Off the claim's land (D60): the way to it, the land mode's key, after the reason.
    const land = r.refused === 'outside_zone' || r.refused === 'neighbour_land' ? ` · ${t('land.keyHint')}` : '';
    if (r.refused) toasts.show('bad', t('toast.refused', { why: t(`reason.${r.refused}` as MsgKey) }) + land);
    // A drag laid in part: the tiles it left out, and why (D77: a step wants a traction ribbon).
    if (r.left) toasts.show('bad', tr('toast.left', { n: r.left.n, why: t(`reason.${r.left.reason}` as MsgKey) }));
    if (r.removed) toasts.show('info', tr('toast.removed', { n: r.removed }));
    if (r.marked) toasts.show('info', tr('toast.marked', { n: r.marked }));
    if (r.cleared) toasts.show('info', tr('toast.cleared', { n: r.cleared }));
    // Sound (app/sound.ts): one cue for what the tool did — a ribbon drag ticks once per tile laid.
    if (r.placed) bus.emit('sfx', { cue: this.d.tools.state?.k === 'belt' ? 'ribbon' : 'place', n: r.placed });
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
