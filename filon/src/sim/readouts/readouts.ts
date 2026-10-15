// readouts/readouts.ts — what the shell hands the specialised views (D88) once per refresh (4 Hz):
// the active view's readings, one shape for the renderer (render/world/views-view.ts) and the side
// panel (ui/views/view-panel.ts), which may not see each other. Only the active view's part is
// filled; `version` bumps with each new reading.
import type { GridReport, PowerMark } from './power';
import type { ProdMark } from './production';
import type { RibbonLook, RibbonSummary } from './ribbons';

export interface Readouts {
  version: number;
  power: { grids: GridReport[]; marks: PowerMark[] } | null;
  ribbons: RibbonLook[] | null;
  ribbonSummary: RibbonSummary | null;
  production: ProdMark[] | null;
}

export const emptyReadouts = (): Readouts => ({ version: 0, power: null, ribbons: null, ribbonSummary: null, production: null });
