// panels.ts — which panels the inspector shows for each building kind, in order (between the
// header + status and the grid module + Demolish). A new kind gets its panels here; a kind
// without an entry shows only the common parts. What a building makes, draws or stores of power is
// the grid module's (power.ts `gridCard`, D76), the same card for every kind.
import type { BuildingKind } from '@/content/types';
import { hearthPanel, landscapePanel } from './colony';
import type { Panel } from './kit';
import { dockPanel, forkPanel, outletsPanel, ribbonPanel, storePanel } from './logistics';
import { drillPanel, generatorPanel, labPanel, machinePanel, serverPanel } from './production';
import { tradePanel } from './trade';

export const PANELS: Partial<Record<BuildingKind, readonly Panel[]>> = {
  machine: [machinePanel],
  drill: [drillPanel],
  generator: [generatorPanel], // its fuel; its output is the grid module's
  lab: [labPanel],
  server: [serverPanel],
  belt: [ribbonPanel],
  conduit: [ribbonPanel],
  fork: [forkPanel],
  hearth: [hearthPanel], // no outlets to set: the Heart takes, it never gives (but its data outlet, D68)
  storage: [storePanel],
  dock: [storePanel, outletsPanel, dockPanel],
  excavator: [landscapePanel],
  backfiller: [landscapePanel],
  trade: [tradePanel], // no outlets: its one exit hands out everything it bought, in turn (D62)
};
