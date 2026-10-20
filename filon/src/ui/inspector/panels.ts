// panels.ts — what the inspector shows for each building kind (D89): its `HERO`, at the top beside
// the status line — what it does, at a glance (a recipe as an icon equation, a drill's ore a minute,
// the power a turbine gives, a lab's project, a silo's fill, a trade post's facts, the Core's
// level) — and its `PANELS`, the sections under it, in order (between the top block and the grid
// card + the foot). A new kind gets its hero and panels here; a kind without an entry shows only
// the common parts. What a building makes, draws or stores of power is the grid card's (power.ts
// `gridCard`, D76), the same card for every kind.
import type { BuildingKind } from '@/content/types';
import { hearthHero, hearthPanel, landscapeHero, landscapePanel } from './colony';
import type { Panel, PanelCtx } from './kit';
import { forkPanel, gaugeHero, gaugePanel, ribbonPanel, storeHero, teePanel } from './logistics';
import { producerHero } from './power';
import { drillHero, drillPanel, generatorHero, generatorPanel, labHero, labPanel, machineHero, machinePanel, serverHero, serverPanel } from './production';
import { tradeHero, tradePanel } from './trade';

/** What a kind does, at the top of its inspector (null: nothing to show, e.g. no recipe yet). */
export type Hero = (c: PanelCtx) => HTMLElement | null;

export const HERO: Partial<Record<BuildingKind, Hero>> = {
  machine: machineHero,
  drill: drillHero,
  pump: drillHero,
  generator: generatorHero,
  wind: producerHero,
  solar: producerHero,
  geothermal: producerHero,
  lab: labHero,
  server: serverHero,
  hearth: hearthHero,
  storage: storeHero,
  conduit: gaugeHero, // a pressure gauge's dial (D155); nothing for a plain conduit
  trade: tradeHero,
  excavator: landscapeHero,
  backfiller: landscapeHero,
};

export const PANELS: Partial<Record<BuildingKind, readonly Panel[]>> = {
  machine: [machinePanel],
  drill: [drillPanel],
  pump: [drillPanel],
  generator: [generatorPanel], // its fuel; its output is the grid card's
  lab: [labPanel],
  server: [serverPanel],
  belt: [ribbonPanel],
  conduit: [ribbonPanel, teePanel, gaugePanel], // a tee's water by way (D152); a gauge's network (D155)
  fork: [forkPanel],
  hearth: [hearthPanel], // no outlets to set: the Heart takes, it never gives (D34; its data outlet went with the data, D122)
  // storage: none — a silo's one item is its hero (`storeHero`), nothing more.
  excavator: [landscapePanel],
  backfiller: [landscapePanel],
  trade: [tradePanel], // no outlets: its one exit hands out everything it bought, in turn (D62)
};
