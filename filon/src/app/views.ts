// views.ts — the specialised views (D88; owner, 2026-10-15: « Il faut améliorer l'UI. Plus clair,
// plus séparé, des vues spécialisées par exemple pour l'électricité »): which one is on show and
// what it reads. One at a time: Normal, Électricité (P), Logistique (F), Production (O), Vent (V,
// D95: once the Anémométrie plan is learnt), Terrain (I: the land mode, D60, which keeps its own
// controller in build-mode.ts and its own look).
//
// Views are UI and render only: they read the colony and never change it — no command, nothing
// saved. A view keeps whatever the player does around it: the iso or plan view, a building
// category open, a tool in hand; only the Terrain view (the land mode) puts the tools away, as it
// always has. Taking the Terrain view ends another view, and another view ends the land mode.
//
// At the UI's pace (4 Hz) `refresh` reads what the view on show needs — the grids, their
// forecast and each building's part in power; the ribbon lines' throughput; the production
// buildings' states; the wind, its next day and the turbines — into one `Readouts` both the
// renderer's view layer and the side panel use.
// The lines' throughput is sampled a little in every view (once a second), so the Logistique view
// opens on figures rather than on blanks.
import { bus } from '@/core/bus';
import type { MapView } from '@/core/kinds';
import type { LandTool } from '@/input/land-tool';
import { gridReports, idleCount, powerMarks } from '@/sim/readouts/power';
import { prodMarks } from '@/sim/readouts/production';
import { emptyReadouts, type Readouts } from '@/sim/readouts/readouts';
import { RibbonSampler, ribbonSummary } from '@/sim/readouts/ribbons';
import { windReport } from '@/sim/readouts/wind';
import type { Sim } from '@/sim/state';

export interface MapViewsDeps {
  sim(): Sim;
  /** The land mode (the Terrain view): its tool, and the build mode's switch for it (zoom, plan view). */
  land: LandTool;
  setLand(on: boolean): void;
  /** Does a production building look at work (render/world/work-look.ts `WorkLook.isLit`)? */
  lit(id: number): boolean;
}

/** Seconds between two background samples of the ribbon lines (any view). */
const SAMPLE_S = 1;

export class MapViews {
  /** The view chosen other than Terrain (which the land mode's own state says). */
  private chosen: Exclude<MapView, 'land'> = 'normal';
  private readonly ribbons = new RibbonSampler();
  private sinceSample = SAMPLE_S;
  private last: MapView = 'normal';
  /** The active view's readings (only its part is filled). */
  readonly data: Readouts = emptyReadouts();

  constructor(private readonly d: MapViewsDeps) {}

  /** The view on show. */
  get current(): MapView {
    return this.d.land.active ? 'land' : this.chosen;
  }

  /** Is a view other than Normal and Terrain on (the veiled ones)? */
  get veiled(): boolean {
    return !this.d.land.active && this.chosen !== 'normal';
  }

  /** Show a view (Normal hides every view; Terrain is the land mode). */
  set(v: MapView): void {
    if (v === 'land') {
      this.chosen = 'normal';
      if (!this.d.land.active) this.d.setLand(true);
    } else {
      if (this.d.land.active) this.d.setLand(false);
      this.chosen = v;
    }
    this.refresh(0, true);
  }

  /** A view's key or button: on, or back to Normal when it is already on. */
  toggle(v: MapView): void {
    this.set(this.current === v ? 'normal' : v);
  }

  /** Esc: a veiled view goes back to Normal (the land mode unwinds through its own chain). True if one went. */
  cancel(): boolean {
    if (!this.veiled) return false;
    this.set('normal');
    return true;
  }

  /** Forget the view (another colony swapped in: the readings were of the one before). */
  reset(): void {
    this.chosen = 'normal';
    Object.assign(this.data, emptyReadouts(), { version: this.data.version + 1 });
  }

  /**
   * At the UI's pace (`dt` seconds since the last call): the active view's readings, and the
   * ribbon lines sampled once a second whatever the view. `force`: now, a view just changed.
   */
  refresh(dt: number, force = false): void {
    const sim = this.d.sim();
    const v = this.current;
    if (v !== this.last) { this.last = v; bus.emit('mapview:changed', { view: v }); }
    this.sinceSample += dt;
    const data = this.data;
    data.power = null; data.ribbons = null; data.ribbonSummary = null; data.production = null; data.wind = null;
    if (v === 'power') data.power = { grids: gridReports(sim), marks: powerMarks(sim), idle: idleCount(sim) };
    else if (v === 'logistics') { data.ribbons = this.ribbons.read(sim); data.ribbonSummary = ribbonSummary(data.ribbons); this.sinceSample = 0; }
    else if (v === 'production') data.production = prodMarks(sim, (id) => this.d.lit(id));
    else if (v === 'wind') data.wind = windReport(sim);
    if (v !== 'logistics' && (this.sinceSample >= SAMPLE_S || force)) { this.sinceSample = 0; this.ribbons.sample(sim); }
    data.version++;
  }
}
