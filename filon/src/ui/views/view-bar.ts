// view-bar.ts — the view selector (D88), top right in the HUD before « Construire »: one inked
// cartouche of icon buttons, each with its key cap — Normal (an eye, Esc), Électricité (the bolt,
// P), Logistique (a ribbon running, F), Production (a gear, O), Vent (the wind, V: with the
// Anémométrie plan, D95), Terrain (a parcel, I: the land
// mode, D60, which keeps its `[data-hud-land]` hook). Shown rather than told: the name and what the
// view shows sit in the tooltip; the button of the view on show is lit. A view the tutorial has not
// reached yet is left out (the shell says which: `ViewBarHost.shows`, from the quests' `view:*`
// reveals, D32), and with Normal alone to choose there is no selector: none before quest 3.
// Hooks: `[data-view=…]`; the Vent button's `[data-hud-wind]` (the Anémométrie plan's spotlight, D95).
import { el, setAttr } from '@/core/dom';
import type { MapView } from '@/core/kinds';
import { t, type MsgKey } from '@/i18n/i18n';
import { viewIconCanvas, type ViewIcon } from '@/render/art/view-icons';
import { glyph } from '../glyphs';

export interface ViewBarHost {
  current(): MapView;
  /** The button of a view: Normal sets it, the others toggle (back to Normal when on). */
  pick(v: MapView): void;
  /** Is this view offered yet (the tutorial reveals them)? */
  shows(v: MapView): boolean;
}

/** The selector's buttons, in order: the view, its mark, its key cap, its tooltip. */
const BUTTONS: ReadonlyArray<{ v: MapView; icon: ViewIcon | 'parcel'; key: string; tip: MsgKey }> = [
  { v: 'normal', icon: 'eye', key: 'Esc', tip: 'mapview.normal.tip' },
  { v: 'power', icon: 'bolt', key: 'P', tip: 'mapview.power.tip' },
  { v: 'logistics', icon: 'flow', key: 'F', tip: 'mapview.logistics.tip' },
  { v: 'production', icon: 'gear', key: 'O', tip: 'mapview.production.tip' },
  { v: 'wind', icon: 'wind', key: 'V', tip: 'mapview.wind.tip' },
  { v: 'land', icon: 'parcel', key: 'I', tip: 'land.tool.tip' },
];

export class ViewBar {
  readonly root: HTMLElement;
  private readonly buttons: Array<{ v: MapView; node: HTMLButtonElement; tip: MsgKey }> = [];

  constructor(private readonly host: ViewBarHost) {
    this.root = el('nav.vbar.cartouche', { 'data-view-bar': '' });
    for (const b of BUTTONS) {
      const mark = b.icon === 'parcel' ? glyph('parcel') : viewIconCanvas(b.icon, 22, false);
      const node = el<'button'>('button.vbar-btn', {
        type: 'button', 'data-view': b.v, 'data-hud-land': b.v === 'land' ? '' : null, 'data-hud-wind': b.v === 'wind' ? '' : null,
        onclick: () => host.pick(b.v),
      }, [mark, el('span.bb-key', {}, b.key)]);
      this.buttons.push({ v: b.v, node, tip: b.tip });
      this.root.append(node);
    }
  }

  /** 4 Hz: the lit button, what the tutorial offers, the tooltips in the language of the day. */
  refresh(): void {
    const cur = this.host.current();
    let shown = 0;
    for (const b of this.buttons) {
      const on = this.host.shows(b.v);
      if (on) shown++;
      setAttr(b.node, 'hidden', on ? null : '');
      setAttr(b.node, 'data-on', b.v === cur ? '' : null);
      setAttr(b.node, 'aria-pressed', b.v === cur ? 'true' : 'false');
      setAttr(b.node, 'title', t(b.tip));
      setAttr(b.node, 'aria-label', t(`mapview.${b.v}` as MsgKey));
    }
    // Nothing but Normal to choose from: no selector at all.
    setAttr(this.root, 'hidden', shown > 1 ? null : '');
  }
}
