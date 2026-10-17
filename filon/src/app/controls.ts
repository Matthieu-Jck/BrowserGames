// controls.ts — what the keyboard and the pointer do. Key actions (input/bindings.ts) map to
// app operations; pointer down / move / up go to the tool in hand while the plan view is in
// effect, and a plain click with nothing in hand inspects (both views). Esc unwinds one layer
// at a time: screen (a page of it first) → the Stock panel (D96) → the purse's card (D102) → the Link tool (its source, then the tool) → the land
// mode (its parcel, then the mode) → tool → selection → a view (D88) → building → the main menu (D27; not under
// automation). While the menu is up, only Esc and the perf overlay get through. The Link tool
// (D25) works in both views: a plain click goes to it with the building under the cursor, a right
// click unwinds it like Esc, a drag pans. The land mode (D60, I) is the same: a plain click picks
// the parcel under the cursor, a right click unwinds, a drag pans. The specialised views (D88: P
// Électricité, F Logistique, O Production, I Terrain) toggle on their keys; Esc takes a view other
// than Terrain back to Normal after the selection, before closing building. A click on the Core's
// Archive (its level-3 corner piece) opens the Expertise window, as E does (D93).
import { BUILDING_IDS } from '@/content/registry';
import { bus } from '@/core/bus';
import type { Action } from '@/input/bindings';
import type { PointerInfo } from '@/input/input';
import type { TouchTool } from '@/input/touch';
import { CENTER } from '@/sim/constants';
import { revealed } from '@/sim/systems/quests';
import type { Reveal } from '@/content/quests';
import { analyticsOn } from '@/ui/analytics';
import { parcelUnder } from '@/ui/land-facts';
import { archiveOpen } from '@/sim/systems/expertise';

/** During the tutorial, what it has not introduced yet stays out of reach (hotkeys included). */
const shows = (app: { sim: import('@/sim/state').Sim }, r: Reveal): boolean => { const rv = revealed(app.sim); return !rv || rv.has(r); };
import type { App } from './app';

/** Keys that only move or look at the world: they keep the interface hidden (U). */
const LOOK: ReadonlySet<Action> = new Set<Action>(['panUp', 'panDown', 'panLeft', 'panRight', 'fast', 'zoomIn', 'zoomOut', 'home', 'viewPower', 'viewLogistics', 'viewProduction', 'perf', 'hideUi']);

export class Controls {
  /** The last pointer state seen (screen px, over the canvas or not). */
  pointer: PointerInfo | null = null;

  constructor(private readonly app: App) {}

  /** Tools act only on the plan side of the morph. */
  get toolActive(): boolean {
    return !!this.app.tools.state && this.app.view.building;
  }

  /** What one finger does with the tool in hand (D96, input/touch.ts): a building is placed by a tap; a ribbon, a box or the brush drag. */
  get touchTool(): TouchTool {
    if (!this.toolActive) return 'none';
    return this.app.tools.state?.k === 'build' ? 'tap' : 'drag';
  }

  /** A second finger came down: the drag or right box under way is dropped, the tool stays in hand. */
  cancelDrag(): void {
    this.app.tools.dropDrag();
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    if (p.button === 2 && (this.app.link.cancel() || this.app.build.landCancel())) return;
    if (!this.app.view.building) return;
    const [x, y] = this.app.picker.tileAt(p.sx, p.sy);
    if (p.button === 0 || p.button === 2) this.app.build.report(this.app.tools.down(x, y, p.button));
  }

  move(p: PointerInfo): void {
    this.pointer = p;
    const [x, y] = this.app.picker.tileAt(p.sx, p.sy);
    this.app.tools.move(x, y);
  }

  up(p: PointerInfo): void {
    this.pointer = p;
    // A plain click with nothing in hand inspects (both views).
    if (p.button === 0 && !this.toolActive) {
      if (!p.overCanvas) return;
      const id = this.app.picker.entityAt(p.sx, p.sy);
      if (this.app.link.active) this.app.build.reportLink(this.app.link.click(id, p.shift));
      else if (this.app.landTool.active) {
        const [x, y] = this.app.picker.tileAt(p.sx, p.sy);
        if (this.app.landTool.click(parcelUnder(x, y))) bus.emit('sfx', { cue: 'select' });
      } else if (id && id === this.app.sim.hearthId && archiveOpen(this.app.sim) && this.app.picker.heartPieceAt(p.sx, p.sy) === 'archive') {
        // The Archive the Core mounts at its level 3 (D86) opens the Expertise window (D93).
        this.app.screens.open('expertise');
        bus.emit('sfx', { cue: 'select' });
      } else {
        this.app.select(id);
        // On bare ground, the deposit card (D99): a tap is how a finger asks for it.
        if (!id) this.app.depositCard.tap(...this.app.picker.seenTileAt(p.sx, p.sy), p.sx, p.sy);
      }
      return;
    }
    if (!this.app.view.building) return;
    const [x, y] = this.app.picker.tileAt(p.sx, p.sy);
    this.app.build.report(this.app.tools.up(x, y, p.button));
  }

  action(a: Action, e: KeyboardEvent): void {
    const app = this.app;
    const { w, h } = { w: app.stage.width, h: app.stage.height };
    if (app.screens.modal && a !== 'cancel' && a !== 'perf') return; // the main menu is up
    // The interface hidden (U): looking around keeps it hidden; Escape, or any key that opens a
    // tool or a screen, brings it back first.
    if (document.body.hasAttribute('data-noui') && !LOOK.has(a)) {
      document.body.removeAttribute('data-noui');
      if (a === 'cancel') return;
    }
    switch (a) {
      case 'hideUi': document.body.toggleAttribute('data-noui'); break;
      case 'perf': app.perf.toggle(); break;
      case 'home': app.camera.glideTo(CENTER + 0.5, CENTER + 0.5); break;
      case 'build': app.build.toggle(); break;
      case 'rotate': app.tools.rotate(e.shiftKey ? -1 : 1); break;
      case 'pipette': this.pipette(); break;
      case 'deconstruct': app.build.demolish(); break;
      case 'mark': if (shows(app, 'brush')) app.build.mark(); break;
      case 'link': if (shows(app, 'build')) app.build.link(); break;
      // The land mode stays within reach from building on (an off-land refusal names this key); its button joins the selector with quest 11 (D32).
      case 'land': if (shows(app, 'build')) app.views.toggle('land'); break;
      case 'viewPower': if (app.viewShown('power')) app.views.toggle('power'); break;
      case 'viewLogistics': if (app.viewShown('logistics')) app.views.toggle('logistics'); break;
      case 'viewProduction': if (app.viewShown('production')) app.views.toggle('production'); break;
      case 'viewWind': if (app.viewShown('wind')) app.views.toggle('wind'); break;
      case 'scrResearch': if (shows(app, 'research')) app.screens.open('research'); break;
      case 'scrStats': if (analyticsOn(app.sim, 'ledger')) app.screens.open('stats'); break; // the ledger plan (D41)
      case 'scrMarket': if (shows(app, 'crier')) app.screens.open('market'); break;
      case 'scrExpertise': if (archiveOpen(app.sim)) app.screens.open('expertise'); break; // D93: once the Core mounts its Archive
      case 'cancel':
        if (app.screens.current) { app.screens.back(); break; }
        if (app.hud.stockOpen) { app.hud.setStock(false); break; } // the Stock panel (D96)
        if (app.hud.purseOpen) { app.hud.setPurse(false); break; } // the purse's card (D102)
        if (app.link.cancel()) break;
        if (app.build.landCancel()) break;
        if (app.tools.cancel()) break;
        if (app.selected) { app.select(0); break; }
        if (app.views.cancel()) break;
        if (app.build.category) { app.build.open(null); break; }
        if (app.screens.escapeTo) app.screens.open(app.screens.escapeTo); // nothing left: the main menu
        break;
      case 'zoomIn': app.camera.zoomBy(1.25, w / 2, h / 2, w, h); break;
      case 'zoomOut': app.camera.zoomBy(0.8, w / 2, h / 2, w, h); break;
      default: break;
    }
  }

  /** Pipette (A): take the building under the cursor in hand, with its rotation. */
  private pipette(): void {
    const app = this.app, hover = app.tools.hover;
    if (!hover) return;
    const id = app.view.building ? app.sim.entityAt(hover[0], hover[1])?.id : this.pointer ? app.picker.entityAt(this.pointer.sx, this.pointer.sy) : 0;
    const ent = id ? app.sim.ents.get(id) : undefined;
    if (ent && BUILDING_IDS[ent.def] !== 'hearth') app.build.pick(BUILDING_IDS[ent.def]!, ent.rot);
  }
}
